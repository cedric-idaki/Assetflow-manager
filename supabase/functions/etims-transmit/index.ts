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
  buildPurchaseDocument,
  buildStockMasterPayload,
  buildStockMovementDocument,
  etimsVerificationUrl,
  normalisePurchase,
  readEtimsReceipt,
  verifyDocumentTotals,
} from "../_shared/etims.ts";
import {
  backoffSeconds,
  type EtimsCredentials,
  fetchPurchases,
  saveItem,
  saveStockBalance,
  transmitPurchase,
  transmitSalesDocument,
  transmitStockMovement,
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

    // One credentials read (and one key decryption) per tenant per run, not per
    // document — a 200-document backlog for one shop is one decryption. Shared
    // across all three queues below, which all file under the same device.
    const credCache = new Map<string, { creds: EtimsCredentials; row: Creds } | null>();

    // =======================================================================
    // PULLING PURCHASES
    //
    // A read, not a filing, so it is its own action: it changes nothing at KRA
    // and a tenant may want their supplier inbox refreshed without waiting for
    // the drain. The scheduler pulls for every connected tenant; a signed-in
    // owner pulls only their own.
    // =======================================================================
    if (action === "pull_purchases") {
      let targets: string[] = [];

      if (adminId) {
        targets = [adminId];
      } else {
        const { data: active } = await db
          .from("etims_credentials")
          .select("admin_id")
          .eq("is_active", true);
        targets = (active ?? []).map((r: any) => r.admin_id);
      }

      const pulls: Array<Record<string, unknown>> = [];
      for (const target of targets) {
        pulls.push(await pullPurchasesFor({ db, adminId: target, credCache }));
      }

      return json({
        ok: true,
        tenants: targets.length,
        stored: pulls.reduce((n, p) => n + (Number(p.stored) || 0), 0),
        results: pulls,
      });
    }

    if (action !== "drain") return json({ error: `Unknown action '${action}'` }, 400);

    // =======================================================================
    // THE DRAIN
    //
    // Three queues, one pass. They are drained in the order a tax position is
    // built: the invoice first, because a credit note and a stock movement can
    // both refer to it; then stock; then purchases, which are independent of
    // all of it.
    //
    // Each queue gets its own batch budget rather than sharing one, so a large
    // stock backlog cannot starve the invoices — an unfiled invoice is a
    // customer holding an invalid tax receipt, which is the worse failure.
    // =======================================================================
    const limit = Math.min(Math.max(parseInt(String(body?.limit ?? DEFAULT_BATCH), 10) || DEFAULT_BATCH, 1), 100);
    const dueNow = new Date().toISOString();

    const dueIn = async (table: string) => {
      let q = db
        .from(table)
        .select("id")
        .eq("status", "pending")
        .lte("next_attempt_at", dueNow)
        .order("created_at", { ascending: true })
        .limit(limit);
      if (adminId) q = q.eq("admin_id", adminId);
      return await q;
    };

    const { data: dueRows, error: dueErr } = await dueIn("etims_invoices");
    if (dueErr) {
      console.error("Could not read the eTIMS queue:", dueErr.message);
      return json({ error: "Could not read the filing queue." }, 500);
    }

    const results: Array<Record<string, unknown>> = [];
    for (const { id } of dueRows ?? []) {
      const outcome = await processOne({ db, id, credCache, operator });
      results.push({ id, ...outcome });
    }

    // Stock and purchases must not be able to fail the invoice drain: their
    // tables are newer than the sales path and a tenant whose migration has not
    // run yet should still get their invoices filed rather than a 500.
    const stockResults: Array<Record<string, unknown>> = [];
    const { data: dueStock, error: stockErr } = await dueIn("etims_stock_movements");
    if (stockErr) {
      console.error("Could not read the eTIMS stock queue:", stockErr.message);
    } else {
      for (const { id } of dueStock ?? []) {
        stockResults.push({ id, ...await processStockMovement({ db, id, credCache, operator }) });
      }
    }

    const purchaseResults: Array<Record<string, unknown>> = [];
    const { data: duePurchases, error: purErr } = await dueIn("etims_purchases");
    if (purErr) {
      console.error("Could not read the eTIMS purchase queue:", purErr.message);
    } else {
      for (const { id } of duePurchases ?? []) {
        purchaseResults.push({ id, ...await processPurchase({ db, id, credCache, operator }) });
      }
    }

    const sentIn = (rows: Array<Record<string, unknown>>) =>
      rows.filter((r) => r.status === "sent").length;

    return json({
      ok: true,
      considered: dueRows?.length ?? 0,
      sent: sentIn(results),
      results,
      stock: { considered: dueStock?.length ?? 0, sent: sentIn(stockResults), results: stockResults },
      purchases: {
        considered: duePurchases?.length ?? 0,
        sent: sentIn(purchaseResults),
        results: purchaseResults,
      },
    });
  } catch (err) {
    return api.fail(err);
  }
});

// ===========================================================================
// CREDENTIALS
//
// One read and one key decryption per tenant per run, not per document: a
// 200-document backlog for one shop is one decryption. Shared by all three
// queues, which is the whole reason it is a function rather than an inline
// block — a sale, a stock movement and a purchase all file under the same
// device, and three copies of this logic would be three places for the key
// handling to drift.
//
// A null in the cache means "this tenant cannot file right now", which is a
// deliberately different thing from "not looked up yet".
// ===========================================================================

async function loadCreds(
  db: any,
  adminId: string,
  credCache: Map<string, { creds: EtimsCredentials; row: Creds } | null>,
): Promise<{ creds: EtimsCredentials; row: Creds } | null> {
  if (credCache.has(adminId)) return credCache.get(adminId) ?? null;

  const { data: row } = await db
    .from("etims_credentials")
    .select("*")
    .eq("admin_id", adminId)
    .maybeSingle();

  if (!row || !row.is_active || !row.cmc_key_enc) {
    credCache.set(adminId, null);
    return null;
  }

  try {
    const cmcKey = await decryptSecret(row.cmc_key_enc, "etims", {
      recordId: adminId,
      field: "cmc_key_enc",
    });
    const entry = {
      row,
      creds: {
        pin: row.kra_pin,
        branchId: row.branch_id,
        cmcKey,
        environment: row.environment,
      },
    };
    credCache.set(adminId, entry);
    return entry;
  } catch (err) {
    console.error("eTIMS key could not be decrypted for", adminId, (err as Error).message);
    credCache.set(adminId, null);
    return null;
  }
}

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
  const cached = await loadCreds(db, doc.admin_id, credCache);
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
// ONE STOCK MOVEMENT
//
// Same lease-claim-transmit shape as a document, and the same four outcomes,
// because a stock movement carries a device sequence number (sarNo) with
// exactly the invoice sequence's problem: re-sending one either duplicates the
// movement or is refused, and a timeout leaves it genuinely unknown.
//
// After a movement is accepted the BALANCE is declared as well. The two are
// separate calls to KRA and the balance is the one that matters most — it is
// what makes the tenant's stock position right even where a movement was never
// recorded — so a failure to declare it is reported on the row without undoing
// the movement that did succeed.
// ===========================================================================

async function processStockMovement(
  { db, id, credCache, operator }: {
    db: any;
    id: string;
    credCache: Map<string, { creds: EtimsCredentials; row: Creds } | null>;
    operator: { id: string; name: string };
  },
): Promise<Record<string, unknown>> {
  const nowIso = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + LEASE_MINUTES * 60_000).toISOString();

  const { data: claimedRows } = await db
    .from("etims_stock_movements")
    .update({ next_attempt_at: leaseUntil, updated_at: nowIso })
    .eq("id", id)
    .eq("status", "pending")
    .lte("next_attempt_at", nowIso)
    .select("*");

  const mv = claimedRows?.[0];
  if (!mv) return { status: "skipped", reason: "claimed by another run" };

  const fail = async (
    status: "pending" | "rejected" | "uncertain",
    message: string,
    resultCode: string | null = null,
  ) => {
    const attempts = (mv.attempts ?? 0) + 1;
    await db.from("etims_stock_movements").update({
      status,
      attempts,
      last_error: message,
      last_result_code: resultCode,
      next_attempt_at: status === "pending"
        ? new Date(Date.now() + backoffSeconds(attempts) * 1000).toISOString()
        : new Date(Date.now() + 365 * 24 * 3600_000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    return { status, error: message };
  };

  const cached = await loadCreds(db, mv.admin_id, credCache);
  if (!cached) {
    return await fail("pending", "eTIMS is not connected for this account. The movement stays queued.");
  }
  const { creds, row: credRow } = cached;

  if (mv.environment !== credRow.environment) {
    return await fail(
      "rejected",
      `This movement was queued for the ${mv.environment} environment but the device is now on ${credRow.environment}. It has not been filed.`,
    );
  }

  // ── What moved, and how it is classified ─────────────────────────────────
  const { data: asset } = await db
    .from("assets")
    .select("id, description, asset_code, quantity_available, selling_price")
    .eq("id", mv.asset_id)
    .maybeSingle();

  const { data: classifications } = await db
    .from("etims_item_classifications")
    .select("*")
    .eq("admin_id", mv.admin_id)
    .or(`asset_id.eq.${mv.asset_id ?? "00000000-0000-0000-0000-000000000000"},item_code.eq.${mv.item_code}`);

  const cls = classifications?.[0] ?? null;
  if (!cls) {
    return await fail(
      "pending",
      `"${asset?.description ?? mv.item_code}" has not been classified for KRA, so its stock cannot be filed. Classify it under Compliance → eTIMS.`,
    );
  }

  // The value of what moved. A sale is valued at what it actually sold for.
  //
  // Anything else is valued at the item's list price, which is a compromise
  // worth naming: cost would be the better basis for a write-off, but this
  // database has no cost column — assets.purchase_price is written by the
  // registration form and does not exist on the live table (verified 2026-09-05,
  // the same schema drift 20260817120000 dealt with elsewhere). Rather than
  // send a silent zero, the movement is valued at the price the item carries,
  // and the tenant can see the figure on the row before it files.
  //
  // Zero only when nothing at all is recorded. The document stays
  // self-consistent either way, which is what KRA validates against.
  const { data: sale } = mv.sale_id
    ? await db.from("sales").select("selling_price, discount_amount").eq("id", mv.sale_id).maybeSingle()
    : { data: null };

  const unitPrice = sale
    ? Number(sale.selling_price ?? 0)
    : Number(asset?.selling_price ?? 0);

  // ── Allocate the stock sequence, once ────────────────────────────────────
  let sarNumber: number | null = mv.sar_number ?? null;
  if (sarNumber == null) {
    const { data: allocated, error: seqErr } = await db.rpc("etims_next_sar_number", {
      p_admin: mv.admin_id,
    });
    if (seqErr || allocated == null) {
      return await fail("pending", `Could not allocate an eTIMS stock number: ${seqErr?.message ?? "no number returned"}`);
    }
    sarNumber = Number(allocated);
    await db.from("etims_stock_movements").update({ sar_number: sarNumber }).eq("id", id);
  }

  const document = buildStockMovementDocument({
    sarNumber,
    seller: { pin: credRow.kra_pin, branchId: credRow.branch_id },
    direction: mv.direction,
    movementCode: mv.movement_code ?? null,
    // The POS is tax-exclusive, the same fact the sales enqueue records per
    // document. A stock movement is valued on the same basis as the sale that
    // caused it, so the two cannot disagree about what the tax was.
    pricesIncludeTax: false,
    occurredAt: mv.occurred_at ?? mv.created_at,
    registrationType: mv.sale_id ? "A" : "M",
    operator,
    remark: mv.note ?? null,
    line: {
      description: asset?.description ?? mv.item_code,
      itemCode: cls.item_code,
      classificationCode: cls.classification_code,
      taxCode: cls.tax_code,
      quantity: Number(mv.quantity ?? 0),
      unitPrice,
      quantityUnit: cls.quantity_unit,
      packagingUnit: cls.packaging_unit,
      itemType: cls.item_type,
    },
  });

  await db.from("etims_stock_movements").update({ payload: document.payload }).eq("id", id);

  if (!document.ok) {
    return await fail("rejected", document.problems.join(" "));
  }

  const res = await transmitStockMovement(document.payload, creds);

  if (res.outcome === "accepted" || res.outcome === "duplicate") {
    // ── And now the balance ────────────────────────────────────────────────
    // Declared from assets.quantity_available rather than from the movement,
    // because it is a statement about stock NOW, not about what just changed.
    let balanceError: string | null = null;
    const master = buildStockMasterPayload({
      seller: { pin: credRow.kra_pin, branchId: credRow.branch_id },
      itemCode: cls.item_code,
      remainingQuantity: asset?.quantity_available ?? 0,
      operator,
    });

    if (master.ok) {
      const bal = await saveStockBalance(master.payload, creds);
      if (bal.outcome !== "accepted" && bal.outcome !== "duplicate") {
        balanceError = `The movement was filed but the stock balance was not accepted: ${bal.message}`;
      }
    } else {
      balanceError = `The movement was filed but the stock balance could not be built: ${master.problems.join(" ")}`;
    }

    await db.from("etims_stock_movements").update({
      status: "sent",
      attempts: (mv.attempts ?? 0) + 1,
      transmitted_at: new Date().toISOString(),
      last_error: balanceError,
      last_result_code: res.resultCd,
      updated_at: new Date().toISOString(),
    }).eq("id", id);

    return { status: "sent", sarNumber, resultCd: res.resultCd, balanceError };
  }

  if (res.outcome === "retryable") return await fail("pending", res.message, res.resultCd);

  if (res.outcome === "uncertain") {
    return await fail(
      "uncertain",
      `${res.message} Check your KRA eTIMS portal for stock movement ${sarNumber} before deciding whether to send it again.`,
      res.resultCd,
    );
  }

  return await fail("rejected", `KRA refused this stock movement: ${res.message}`, res.resultCd);
}

// ===========================================================================
// ONE PURCHASE
//
// The tenant has already ruled on it; this files that verdict. The payload is
// KRA's own record echoed back with our identity and decision written over it
// — see buildPurchaseDocument. Nothing here recalculates a supplier's figures.
// ===========================================================================

async function processPurchase(
  { db, id, credCache, operator }: {
    db: any;
    id: string;
    credCache: Map<string, { creds: EtimsCredentials; row: Creds } | null>;
    operator: { id: string; name: string };
  },
): Promise<Record<string, unknown>> {
  const nowIso = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + LEASE_MINUTES * 60_000).toISOString();

  const { data: claimedRows } = await db
    .from("etims_purchases")
    .update({ next_attempt_at: leaseUntil, updated_at: nowIso })
    .eq("id", id)
    .eq("status", "pending")
    .lte("next_attempt_at", nowIso)
    .select("*");

  const pur = claimedRows?.[0];
  if (!pur) return { status: "skipped", reason: "claimed by another run" };

  const fail = async (
    status: "pending" | "rejected" | "uncertain",
    message: string,
    resultCode: string | null = null,
  ) => {
    const attempts = (pur.attempts ?? 0) + 1;
    await db.from("etims_purchases").update({
      status,
      attempts,
      last_error: message,
      last_result_code: resultCode,
      next_attempt_at: status === "pending"
        ? new Date(Date.now() + backoffSeconds(attempts) * 1000).toISOString()
        : new Date(Date.now() + 365 * 24 * 3600_000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    return { status, error: message };
  };

  if (pur.decision !== "accepted" && pur.decision !== "rejected") {
    return await fail("rejected", "This purchase was queued without a decision on it.");
  }

  const cached = await loadCreds(db, pur.admin_id, credCache);
  if (!cached) {
    return await fail("pending", "eTIMS is not connected for this account. The purchase stays queued.");
  }
  const { creds, row: credRow } = cached;

  // A purchase carries the tenant's own invoice sequence when it is filed, the
  // same counter a sale uses — KRA sequences everything a device sends.
  const { data: allocated, error: seqErr } = await db.rpc("etims_next_invoice_number", {
    p_admin: pur.admin_id,
  });
  if (seqErr || allocated == null) {
    return await fail("pending", `Could not allocate an eTIMS number: ${seqErr?.message ?? "no number returned"}`);
  }

  const document = buildPurchaseDocument({
    source: pur.source,
    seller: { pin: credRow.kra_pin, branchId: credRow.branch_id },
    invoiceNumber: Number(allocated),
    accepted: pur.decision === "accepted",
    operator,
    remark: pur.decision_note ?? null,
  });

  if (!document.ok) return await fail("rejected", document.problems.join(" "));

  const res = await transmitPurchase(document.payload, creds);

  if (res.outcome === "accepted" || res.outcome === "duplicate") {
    await db.from("etims_purchases").update({
      status: "sent",
      attempts: (pur.attempts ?? 0) + 1,
      transmitted_at: new Date().toISOString(),
      last_error: null,
      last_result_code: res.resultCd,
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    return { status: "sent", decision: pur.decision, resultCd: res.resultCd };
  }

  if (res.outcome === "retryable") return await fail("pending", res.message, res.resultCd);

  if (res.outcome === "uncertain") {
    return await fail(
      "uncertain",
      `${res.message} Check your KRA eTIMS portal before deciding whether to file this purchase again.`,
      res.resultCd,
    );
  }

  return await fail("rejected", `KRA refused this purchase: ${res.message}`, res.resultCd);
}

// ===========================================================================
// PULLING PURCHASES FROM KRA
//
// The read that makes a supplier book unnecessary. Upserts on
// (admin_id, supplier_pin, supplier_invoice_no), so re-running it sees the same
// purchases without duplicating them — and, importantly, WITHOUT touching a
// decision somebody already made. A tenant who accepted a purchase yesterday
// must not find it back in their inbox because the pull ran again.
// ===========================================================================

async function pullPurchasesFor(
  { db, adminId, credCache }: {
    db: any;
    adminId: string;
    credCache: Map<string, { creds: EtimsCredentials; row: Creds } | null>;
  },
): Promise<Record<string, unknown>> {
  const cached = await loadCreds(db, adminId, credCache);
  if (!cached) return { adminId, ok: false, error: "eTIMS is not connected for this account." };

  const { creds, row: credRow } = cached;
  const res = await fetchPurchases(creds);

  if (res.outcome !== "accepted" && res.outcome !== "duplicate") {
    return { adminId, ok: false, error: res.message, resultCd: res.resultCd };
  }

  // Shape varies by deployment, the same way readEtimsReceipt's does: OSCU and
  // VSCU nest the list differently and the sandbox differs again.
  const envelope = res.data as any;
  const list: any[] = envelope?.saleList ?? envelope?.data?.saleList ?? envelope?.purchaseList ?? [];
  let stored = 0;
  let skipped = 0;

  for (const record of Array.isArray(list) ? list : []) {
    const p = normalisePurchase(record);
    if (!p) {
      skipped++;
      continue;
    }

    // Insert-only on the parent: onConflict with ignoreDuplicates leaves an
    // existing row — and therefore its decision and filing state — untouched.
    const { data: inserted } = await db
      .from("etims_purchases")
      .upsert({
        admin_id: adminId,
        supplier_pin: p.supplierPin,
        supplier_name: p.supplierName,
        supplier_branch: p.supplierBranch,
        supplier_invoice_no: p.supplierInvoiceNo,
        supplier_sdc_id: p.supplierSdcId,
        supplier_mrc_no: p.supplierMrcNo,
        receipt_type: p.receiptType,
        payment_type: p.paymentType,
        purchase_date: p.purchaseDate,
        total_taxable: p.totalTaxable,
        total_tax: p.totalTax,
        total_amount: p.totalAmount,
        source: p.source,
        environment: credRow.environment,
      }, {
        onConflict: "admin_id,supplier_pin,supplier_invoice_no",
        ignoreDuplicates: true,
      })
      .select("id");

    const purchaseId = inserted?.[0]?.id;
    // No id back means the row already existed and was left alone, which is the
    // correct outcome — its lines are already stored too.
    if (!purchaseId) continue;

    if (p.items.length) {
      await db.from("etims_purchase_items").insert(
        p.items.map((it) => ({ ...it, purchase_id: purchaseId })),
      );
    }
    stored++;
  }

  return { adminId, ok: true, considered: list.length, stored, skipped };
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
