/// <reference lib="deno.ns" />
//
// etims-transmit — the queue drain. The only thing on this platform that files
// a tax document with KRA.
//
// Run it on a schedule (every 5 minutes is ample) the same way
// agent-followup-reminders and kyc-renewal-reminders are run. A tenant can also
// invoke it for their own queue from the compliance screen, which is what the
// "Send now" and "Retry" buttons do.
//
// ── WHY THE SALE DOES NOT CALL THIS ─────────────────────────────────────────
// Nothing in the path of taking a customer's money may depend on KRA being up.
// A sale enqueues a row (trigger, migration 20260902160000) and commits; this
// drains the queue afterwards. A shop keeps trading through a KRA outage, which
// is exactly what the offline-transmission provisions contemplate.
//
// ── THE PART THAT MATTERS: EXACTLY-ONCE ─────────────────────────────────────
// Transmitting is NOT idempotent. KRA binds a receipt signature to an invoice
// number; re-sending the same number either fails as a duplicate or files a
// second document. Three outcomes, three different correct responses, and only
// one of them is "try again":
//
//   accepted   Store the signature. Terminal.
//   rejected   KRA read it and refused. Deterministic, so retrying on a timer
//              achieves nothing but a bigger log. Parked for a human.
//   uncertain  Timed out or the gateway failed mid-flight. THE DOCUMENT MAY OR
//              MAY NOT BE FILED. Re-sending risks a duplicate filing; not
//              re-sending risks an unfiled sale. This function will not choose:
//              it parks the row and the tenant decides, with both risks stated.
//   retryable  We know nothing was filed — the connection never opened, or KRA
//              named the failure as transient. Only this one backs off and
//              retries by itself.
//
// ── AND THE OTHER PART: ONE SENDER AT A TIME ────────────────────────────────
// A scheduled run and a tenant pressing "Send now" can overlap. Each document
// is therefore CLAIMED with a lease before it is sent — a conditional update
// that pushes next_attempt_at forward and is only won by one caller. A row this
// function is mid-flight on is invisible to every other run.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptSecret } from "../_shared/crypto.ts";
import { openRequest } from "../_shared/http.ts";
import { authenticateCaller, isServiceRole, safeEqual } from "../_shared/auth.ts";
import {
  buildEtimsSalesDocument,
  etimsVerificationUrl,
  readEtimsReceipt,
  verifyDocumentTotals,
} from "../_shared/etims.ts";
import {
  backoffSeconds,
  type EtimsCredentials,
  saveItem,
  transmitSalesDocument,
} from "../_shared/etimsClient.ts";

const API_VERSIONS = ["2026-08-21"];

const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

/**
 * How long a claimed document stays invisible to other runs.
 *
 * Longer than the 30s KRA timeout by a wide margin, so a slow call cannot have
 * its row stolen mid-flight and sent twice. If this function dies holding a
 * lease, the row becomes due again after it expires — which is safe, because a
 * process that died before recording an outcome left the document in exactly
 * the ambiguous state the lease protects.
 */
const LEASE_MINUTES = 5;

/** Documents per invocation. Bounded so one tenant's backlog cannot starve the rest. */
const DEFAULT_BATCH = 25;

type Creds = {
  admin_id: string;
  kra_pin: string;
  branch_id: string;
  device_serial: string;
  environment: string;
  cmc_key_enc: string | null;
  is_active: boolean;
};

Deno.serve(async (req) => {
  const api = await openRequest(req, {
    fn: "etims-transmit",
    methods: "POST, OPTIONS",
    versions: API_VERSIONS,
  });
  if (api.halt) return api.halt;

  const json = api.json;

  try {
    const db = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action: string = body?.action ?? "drain";

    // ── Who is calling ──────────────────────────────────────────────────────
    // The scheduler drains every tenant. A signed-in owner drains only their
    // own queue, and adminId is taken from their profile, never from the body.
    const scheduled = isServiceRole(req) ||
      (CRON_SECRET && safeEqual(req.headers.get("x-cron-secret") ?? "", CRON_SECRET));

    let adminId: string | null = null;
    let operator = { id: "system", name: "Scheduled filing" };

    if (!scheduled) {
      const auth = await authenticateCaller(req);
      if (!auth.ok) return json({ error: auth.error }, auth.status);

      const userId = (auth.caller as any)?.id ?? (auth.caller as any)?.userId;
      const { data: profile } = await db
        .from("user_profiles")
        .select("id, role, admin_id, full_name")
        .eq("id", userId)
        .maybeSingle();

      if (!["admin", "sacco_admin"].includes(profile?.role ?? "")) {
        return json({ error: "Only the account owner can file eTIMS documents." }, 403);
      }

      adminId = profile?.admin_id ?? profile?.id ?? null;
      operator = { id: String(profile?.id ?? "system"), name: profile?.full_name ?? "Operator" };

      const over = await api.enforceLimit({
        action: "transmit",
        identity: `user:${userId}`,
        limit: 30,
        windowSeconds: 60,
      });
      if (over) return over;
    }

    // =======================================================================
    // RESOLVING AN `uncertain` DOCUMENT
    //
    // The one decision this function refuses to make for a tenant, surfaced as
    // an explicit choice. Both options are stated with their risk because both
    // carry one, and the tenant is the party liable for the filing.
    // =======================================================================
    if (action === "resolve") {
      if (scheduled) return json({ error: "A scheduled run cannot resolve a document." }, 403);

      const { invoiceId, resolution, kraInvoiceNumber, receiptSignature } = body ?? {};
      if (!invoiceId) return json({ error: "Which document?" }, 400);

      const { data: row } = await db
        .from("etims_invoices")
        .select("*")
        .eq("id", invoiceId)
        .eq("admin_id", adminId)
        .maybeSingle();

      if (!row) return json({ error: "No such document." }, 404);
      if (row.status !== "uncertain" && row.status !== "rejected") {
        return json({ error: `A document that is "${row.status}" does not need resolving.` }, 400);
      }

      // "KRA has it after all" — the tenant checked their eTIMS portal and
      // found the document. Recorded from what they saw, not re-sent.
      if (resolution === "mark_filed") {
        if (!receiptSignature) {
          return json(
            { error: "Enter the receipt signature from your KRA eTIMS portal to record this as filed." },
            400,
          );
        }
        await db.from("etims_invoices").update({
          status: "sent",
          receipt_signature: String(receiptSignature),
          kra_invoice_number: kraInvoiceNumber ?? null,
          qr_url: etimsVerificationUrl({
            pin: row.payload?.tin,
            branchId: row.payload?.bhfId,
            receiptSignature: String(receiptSignature),
            environment: row.environment,
          }),
          transmitted_at: new Date().toISOString(),
          last_error: "Recorded manually from the KRA portal after an uncertain transmission.",
          updated_at: new Date().toISOString(),
        }).eq("id", invoiceId);
        return json({ ok: true, status: "sent" });
      }

      // "Send it again" — the tenant checked and KRA does NOT have it. A new
      // sequence number is allocated rather than reusing the old one: if the
      // original did land after all, reusing its number would be refused as a
      // duplicate and lose the document a second time.
      if (resolution === "resend") {
        await db.from("etims_invoices").update({
          status: "pending",
          invoice_number: null,
          next_attempt_at: new Date().toISOString(),
          last_error: "Released for re-sending by the account owner.",
          updated_at: new Date().toISOString(),
        }).eq("id", invoiceId);
        return json({ ok: true, status: "pending" });
      }

      if (resolution === "cancel") {
        await db.from("etims_invoices").update({
          status: "cancelled",
          last_error: "Cancelled by the account owner.",
          updated_at: new Date().toISOString(),
        }).eq("id", invoiceId);
        return json({ ok: true, status: "cancelled" });
      }

      return json({ error: `Unknown resolution '${resolution}'.` }, 400);
    }

    if (action !== "drain") return json({ error: `Unknown action '${action}'` }, 400);

    // =======================================================================
    // THE DRAIN
    // =======================================================================
    const limit = Math.min(Math.max(parseInt(String(body?.limit ?? DEFAULT_BATCH), 10) || DEFAULT_BATCH, 1), 100);

    let due = db
      .from("etims_invoices")
      .select("id")
      .eq("status", "pending")
      .lte("next_attempt_at", new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(limit);

    if (adminId) due = due.eq("admin_id", adminId);

    const { data: dueRows, error: dueErr } = await due;
    if (dueErr) {
      console.error("Could not read the eTIMS queue:", dueErr.message);
      return json({ error: "Could not read the filing queue." }, 500);
    }

    const results: Array<Record<string, unknown>> = [];
    // One credentials read (and one key decryption) per tenant per run, not per
    // document — a 200-document backlog for one shop is one decryption.
    const credCache = new Map<string, { creds: EtimsCredentials; row: Creds } | null>();

    for (const { id } of dueRows ?? []) {
      const outcome = await processOne({ db, id, credCache, operator });
      results.push({ id, ...outcome });
    }

    return json({
      ok: true,
      considered: dueRows?.length ?? 0,
      sent: results.filter((r) => r.status === "sent").length,
      results,
    });
  } catch (err) {
    return api.fail(err);
  }
});

// ===========================================================================
// ONE DOCUMENT
// ===========================================================================

async function processOne(
  { db, id, credCache, operator }: {
    db: any;
    id: string;
    credCache: Map<string, { creds: EtimsCredentials; row: Creds } | null>;
    operator: { id: string; name: string };
  },
): Promise<Record<string, unknown>> {
  const nowIso = new Date().toISOString();

  // ── Claim it ─────────────────────────────────────────────────────────────
  // A conditional update only one caller can win. `attempts` is incremented
  // here rather than at the end so a run that dies mid-flight still counts its
  // attempt — otherwise a document that crashes the function every time retries
  // forever without its backoff ever growing.
  const leaseUntil = new Date(Date.now() + LEASE_MINUTES * 60_000).toISOString();
  const { data: claimedRows } = await db
    .from("etims_invoices")
    .update({ next_attempt_at: leaseUntil, updated_at: nowIso })
    .eq("id", id)
    .eq("status", "pending")
    .lte("next_attempt_at", nowIso)
    .select("*");

  const doc = claimedRows?.[0];
  if (!doc) return { status: "skipped", reason: "claimed by another run" };

  const fail = async (
    status: "pending" | "rejected" | "uncertain",
    message: string,
    resultCode: string | null = null,
  ) => {
    const attempts = (doc.attempts ?? 0) + 1;
    await db.from("etims_invoices").update({
      status,
      attempts,
      last_error: message,
      last_result_code: resultCode,
      // Only a retryable failure gets a next attempt. A parked row's
      // next_attempt_at is meaningless, but it is pushed far out anyway so a
      // status left inconsistent by a future change cannot silently become a
      // hot retry loop.
      next_attempt_at: status === "pending"
        ? new Date(Date.now() + backoffSeconds(attempts) * 1000).toISOString()
        : new Date(Date.now() + 365 * 24 * 3600_000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    return { status, error: message };
  };

  // ── Credentials ──────────────────────────────────────────────────────────
  if (!credCache.has(doc.admin_id)) {
    const { data: row } = await db
      .from("etims_credentials")
      .select("*")
      .eq("admin_id", doc.admin_id)
      .maybeSingle();

    if (!row || !row.is_active || !row.cmc_key_enc) {
      credCache.set(doc.admin_id, null);
    } else {
      try {
        const cmcKey = await decryptSecret(row.cmc_key_enc, "etims", {
          recordId: doc.admin_id,
          field: "cmc_key_enc",
        });
        credCache.set(doc.admin_id, {
          row,
          creds: {
            pin: row.kra_pin,
            branchId: row.branch_id,
            cmcKey,
            environment: row.environment,
          },
        });
      } catch (err) {
        console.error("eTIMS key could not be decrypted for", doc.admin_id, (err as Error).message);
        credCache.set(doc.admin_id, null);
      }
    }
  }

  const cached = credCache.get(doc.admin_id);
  if (!cached) {
    return await fail(
      "pending",
      "eTIMS is not connected for this account, or its device key could not be read. The document stays queued.",
    );
  }
  const { creds, row: credRow } = cached;

  // The environment a document was queued under is a fact about that document.
  // A tenant who switched to production must not have their sandbox backlog
  // silently filed for real — those documents were never valid filings and
  // re-filing them under live numbers would misstate the return.
  if (doc.environment !== credRow.environment) {
    return await fail(
      "rejected",
      `This document was queued for the ${doc.environment} environment but the device is now on ${credRow.environment}. It has not been filed. Re-issue it if it still needs to be.`,
    );
  }

  // ── Gather what the document is made of ──────────────────────────────────
  const built = await buildFromSale({ db, doc, creds, credRow, operator });
  if (!built.ok) return await fail("rejected", built.problems.join(" "));

  // ── Allocate the device sequence, once ───────────────────────────────────
  // Only on the first attempt. A retry of the SAME document reuses its number,
  // because KRA rejected or never saw it and the number was never consumed.
  let invoiceNumber: number | null = doc.invoice_number ?? null;
  if (invoiceNumber == null) {
    const { data: allocated, error: seqErr } = await db.rpc("etims_next_invoice_number", {
      p_admin: doc.admin_id,
    });
    if (seqErr || allocated == null) {
      return await fail("pending", `Could not allocate an eTIMS invoice number: ${seqErr?.message ?? "no number returned"}`);
    }
    invoiceNumber = Number(allocated);
    await db.from("etims_invoices").update({ invoice_number: invoiceNumber }).eq("id", id);
  }

  // ── Build the payload ────────────────────────────────────────────────────
  const document = buildEtimsSalesDocument({
    docType: doc.doc_type,
    invoiceNumber,
    originalInvoiceNumber: built.originalInvoiceNumber,
    seller: built.seller,
    buyer: built.buyer,
    lines: built.lines,
    // A fact recorded on the document when it was created, not a setting read
    // now. See migration 20260902160000 §3.
    pricesIncludeTax: doc.prices_include_tax === true,
    paymentMethod: built.paymentMethod,
    saleDate: built.saleDate,
    operator,
    // Both are recorded on the row when a credit note is raised, and both are
    // ignored by the builder for an ordinary sale. A null reason code becomes
    // '05' (other) there rather than here, so the default lives in one place.
    refundReasonCode: doc.refund_reason_code ?? null,
    remark: doc.remark ?? null,
  });

  if (!document.ok) {
    await db.from("etims_invoices").update({ payload: document.payload }).eq("id", id);
    return await fail("rejected", document.problems.join(" "));
  }

  // An independent cross-check of the header against its own lines, run even
  // though we built both moments ago. KRA rejects a self-inconsistent document
  // in a way indistinguishable from an outage; catching it here names the real
  // fault instead of spending the retry budget on it.
  const faults = verifyDocumentTotals(document.payload);
  if (faults.length) {
    await db.from("etims_invoices").update({ payload: document.payload }).eq("id", id);
    return await fail("rejected", `The document does not add up: ${faults.join(" ")}`);
  }

  await db.from("etims_invoices").update({
    payload: document.payload,
    total_taxable: document.totals.taxable,
    total_tax: document.totals.tax,
    total_amount: document.totals.total,
  }).eq("id", id);

  // ── Register any item KRA has not been told about ────────────────────────
  // eTIMS refuses a sales line for an unknown itemCd, so this must happen
  // first. A registration failure is not fatal to the attempt — KRA may already
  // know the item from an earlier channel — so it is recorded and the
  // transmission is still tried.
  for (const item of built.unregistered) {
    const res = await saveItem({
      itemCd: item.item_code,
      itemClsCd: item.classification_code,
      itemNm: item.item_name ?? item.item_code,
      itemTyCd: item.item_type,
      itemStdNm: item.item_name ?? item.item_code,
      orgnNatCd: item.origin_country,
      pkgUnitCd: item.packaging_unit,
      qtyUnitCd: item.quantity_unit,
      taxTyCd: item.tax_code,
      dftPrc: 0,
      isrcAplcbYn: "N",
      useYn: "Y",
      regrId: operator.id,
      regrNm: operator.name,
      modrId: operator.id,
      modrNm: operator.name,
    }, creds);

    await db.from("etims_item_classifications").update(
      res.outcome === "accepted" || res.outcome === "duplicate"
        ? { registered_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }
        : { last_error: `${res.resultCd ?? "no code"}: ${res.message}`, updated_at: new Date().toISOString() },
    ).eq("id", item.id);
  }

  // ── Transmit ─────────────────────────────────────────────────────────────
  const res = await transmitSalesDocument(document.payload, creds);

  if (res.outcome === "accepted" || res.outcome === "duplicate") {
    const receipt = readEtimsReceipt(res.data);

    if (!receipt) {
      // KRA said yes but returned nothing to print. The document IS filed —
      // this must never be retried — but the receipt cannot carry the signature
      // a valid tax invoice needs, so it is flagged for a human to fetch from
      // the KRA portal.
      return await fail(
        "uncertain",
        res.outcome === "duplicate"
          ? "KRA reports this invoice number as already filed, but returned no receipt signature. Check the eTIMS portal and record the signature."
          : "KRA accepted the document but returned no receipt signature. Check the eTIMS portal and record the signature.",
        res.resultCd,
      );
    }

    await db.from("etims_invoices").update({
      status: "sent",
      attempts: (doc.attempts ?? 0) + 1,
      receipt_signature: receipt.receiptSignature,
      internal_data: receipt.internalData,
      kra_invoice_number: receipt.kraInvoiceNumber,
      control_unit_id: receipt.controlUnitId ?? credRow.device_serial,
      control_unit_at: receipt.controlUnitDateTime,
      qr_url: etimsVerificationUrl({
        pin: creds.pin,
        branchId: creds.branchId,
        receiptSignature: receipt.receiptSignature,
        environment: creds.environment,
      }),
      transmitted_at: new Date().toISOString(),
      last_error: res.outcome === "duplicate"
        ? "Already filed at KRA under this invoice number; the signature was recovered from KRA's reply."
        : null,
      last_result_code: res.resultCd,
      updated_at: new Date().toISOString(),
    }).eq("id", id);

    return { status: "sent", invoiceNumber, resultCd: res.resultCd };
  }

  if (res.outcome === "retryable") {
    return await fail("pending", res.message, res.resultCd);
  }

  if (res.outcome === "uncertain") {
    return await fail(
      "uncertain",
      `${res.message} Check your KRA eTIMS portal for invoice ${invoiceNumber} before deciding whether to send it again.`,
      res.resultCd,
    );
  }

  return await fail("rejected", `KRA refused this document: ${res.message}`, res.resultCd);
}

// ===========================================================================
// TURNING A SALE INTO LINES
//
// Reads everything from the database. Nothing here comes from a browser: the
// figures on a tax document must not be assertable by the client that
// triggered it.
// ===========================================================================

async function buildFromSale(
  { db, doc, creds, credRow }: {
    db: any;
    doc: any;
    creds: EtimsCredentials;
    credRow: Creds;
    operator: { id: string; name: string };
  },
// A union rather than `ok: boolean` with optional fields: on the success branch
// every field below is always present, and saying so is what lets the caller
// read `built.unregistered` after its `if (!built.ok) return` without a guard
// that would be dead code. The old shape made all of them optional on BOTH
// branches, so the types permitted a future early return that omitted
// `unregistered` — and the loop at the call site would have thrown on it.
): Promise<
  | { ok: false; problems: string[] }
  | {
    ok: true;
    problems: string[];
    seller: Record<string, unknown>;
    buyer: Record<string, unknown>;
    lines: Array<Record<string, unknown>>;
    paymentMethod: string;
    saleDate: string;
    originalInvoiceNumber: number | null;
    unregistered: any[];
  }
> {
  const problems: string[] = [];

  if (!doc.sale_id) {
    return { ok: false, problems: ["This document has no sale attached to it."] };
  }

  const { data: sale } = await db
    .from("sales")
    .select("*, client:clients(*), asset:assets(*)")
    .eq("id", doc.sale_id)
    .maybeSingle();

  if (!sale) return { ok: false, problems: ["The sale this document was raised for no longer exists."] };

  const { data: company } = await db
    .from("company_profiles")
    .select("company_name, physical_address, address")
    .eq("admin_id", doc.admin_id)
    .maybeSingle();

  // ── The item and its classification ──────────────────────────────────────
  const asset = sale.asset;
  const assetCode = asset?.asset_code || asset?.id;

  const { data: classifications } = await db
    .from("etims_item_classifications")
    .select("*")
    .eq("admin_id", doc.admin_id)
    .or(`asset_id.eq.${asset?.id ?? "00000000-0000-0000-0000-000000000000"},item_code.eq.${assetCode ?? ""}`);

  const cls = classifications?.[0] ?? null;

  if (!cls) {
    problems.push(
      `"${asset?.description ?? "the item sold"}" has not been classified for KRA. Classify it under Compliance → eTIMS before this sale can be filed.`,
    );
  }

  // ── The money ────────────────────────────────────────────────────────────
  // The POS captures a selling price and adds tax to it, so the price here is
  // NET and the discount comes off before tax. Reconstructed from the stored
  // sale rather than from anything the client sent.
  const sellingPrice = Number(sale.selling_price ?? 0);
  const discount = Number(sale.discount_amount ?? 0);

  const lines = [{
    description: asset?.description ?? "Item",
    itemCode: cls?.item_code ?? assetCode,
    classificationCode: cls?.classification_code ?? null,
    taxCode: cls?.tax_code ?? null,
    quantity: 1,
    unitPrice: sellingPrice,
    discountAmount: discount,
    quantityUnit: cls?.quantity_unit ?? "U",
    packagingUnit: cls?.packaging_unit ?? "NT",
    itemType: cls?.item_type ?? "2",
  }];

  // A sale recorded with no VAT while the item is classified standard-rated is
  // a genuine contradiction — one of the two is wrong, and filing either
  // reading would assert something the other document denies. Reported rather
  // than resolved.
  const recordedVat = Number(sale.vat_amount ?? 0);
  if (cls?.tax_code === "B" && recordedVat === 0 && sellingPrice > 0) {
    problems.push(
      `The sale charged no VAT but "${asset?.description ?? "the item"}" is classified as standard rated. Correct the classification or the sale before filing.`,
    );
  }
  if (cls && cls.tax_code !== "B" && recordedVat > 0) {
    problems.push(
      `The sale charged VAT of ${recordedVat} but "${asset?.description ?? "the item"}" is classified as ${cls.tax_code} (no VAT). Correct the classification or the sale before filing.`,
    );
  }

  // ── The credit note's parent ─────────────────────────────────────────────
  let originalInvoiceNumber: number | null = null;
  if (doc.doc_type === "credit_note") {
    if (!doc.reverses_id) {
      problems.push("This credit note does not say which document it reverses.");
    } else {
      const { data: parent } = await db
        .from("etims_invoices")
        .select("invoice_number, status")
        .eq("id", doc.reverses_id)
        .maybeSingle();
      if (parent?.status !== "sent" || parent?.invoice_number == null) {
        problems.push("The invoice this credit note reverses has not itself been filed yet.");
      } else {
        originalInvoiceNumber = Number(parent.invoice_number);
      }
    }
  }

  if (problems.length) return { ok: false, problems };

  return {
    ok: true,
    problems: [],
    seller: {
      pin: credRow.kra_pin,
      branchId: credRow.branch_id,
      name: company?.company_name ?? null,
      address: company?.physical_address ?? company?.address ?? null,
    },
    buyer: {
      pin: sale.client?.kra_pin ?? null,
      name: sale.client?.full_name ?? null,
      phone: sale.client?.phone ?? null,
    },
    lines,
    paymentMethod: sale.payment_method ?? "cash",
    saleDate: sale.sale_date ?? sale.created_at ?? new Date().toISOString(),
    originalInvoiceNumber,
    unregistered: cls && !cls.registered_at ? [cls] : [],
  };
}
