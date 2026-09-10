/// <reference lib="deno.ns" />
// Tenant eTIMS device credentials — the write path for KRA compliance.
//
// A business that files through this platform registers its eTIMS device once:
// KRA is given the taxpayer's PIN, branch and the device serial number issued
// when they signed up for eTIMS, and returns a communication key that
// authenticates every later call. That key is the credential.
//
// public.etims_credentials has RLS enabled with zero policies, so nothing in a
// browser can read or write it; this function is the only door, and it runs
// under the service role.
//
// The rules this function exists to enforce, in the order they matter:
//
//  1. THE KEY IS ENCRYPTED BEFORE IT TOUCHES THE DATABASE, under
//     ETIMS_CRED_ENC_KEY, which lives only in Supabase function secrets. This
//     key files tax documents in the tenant's legal name — a database
//     compromise alone must not be enough to do that.
//
//  2. THE KEY IS NEVER RETURNED. Not to the owner, not to a super admin. The
//     response says whether it is present, never what it is. The PIN, branch
//     and environment ARE returned: they are printed on every receipt the
//     business issues, and showing them back is how an operator confirms they
//     configured the right taxpayer.
//
//  3. CREDENTIALS ARE NOT TRUSTED UNTIL KRA ACCEPTS THEM. Saving performs a
//     live device initialisation. is_active is set only when that succeeds,
//     which matters more here than it does for M-Pesa: the enqueue trigger in
//     migration 20260902160000 only queues documents for an ACTIVE device, so a
//     failed check leaves a tenant filing nothing rather than accumulating a
//     queue of documents that can never be sent.
//
//  4. GOING LIVE IS A DELIBERATE ACT. Switching environment from sandbox to
//     production resets the device sequence and forces re-initialisation,
//     because a sandbox key does not authenticate against production and the
//     two sequences are unrelated. A tenant who "went live" by editing one
//     field and kept filing to the sandbox would believe they were compliant
//     while filing nothing at all.
//
// verify_jwt = true: the caller's JWT establishes which tenant these
// credentials belong to. admin_id is never taken from the request body.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encryptSecret } from "../_shared/crypto.ts";
import { openRequest } from "../_shared/http.ts";
import { initialiseDevice } from "../_shared/etimsClient.ts";
import { isValidKraPin, normaliseKraPin } from "../_shared/etims.ts";

const API_VERSIONS = ["2026-08-21"];

/** Roles that own a tenant, and may therefore file tax documents for it. */
const TENANT_OWNER_ROLES = ["admin", "sacco_admin"];

type Row = {
  admin_id: string;
  kra_pin: string;
  branch_id: string;
  device_serial: string;
  environment: string;
  cmc_key_enc: string | null;
  control_unit_id: string | null;
  initialised_at: string | null;
  is_active: boolean;
  verified_at: string | null;
  last_error: string | null;
  last_invoice_number: number;
  updated_at: string | null;
};

/** The safe shape: everything an operator needs, nothing they could leak. */
const publicView = (row: Row | null) => ({
  configured: !!row,
  kraPin: row?.kra_pin ?? null,
  branchId: row?.branch_id ?? "00",
  deviceSerial: row?.device_serial ?? null,
  environment: row?.environment ?? "sandbox",
  controlUnitId: row?.control_unit_id ?? null,
  initialisedAt: row?.initialised_at ?? null,
  isActive: row?.is_active ?? false,
  verifiedAt: row?.verified_at ?? null,
  lastError: row?.last_error ?? null,
  lastInvoiceNumber: row?.last_invoice_number ?? 0,
  updatedAt: row?.updated_at ?? null,
  // Presence only — never the value.
  present: { communicationKey: Boolean(row?.cmc_key_enc) },
  // Filing to the sandbox files nothing. An operator who believes they are live
  // needs to see this without having to interpret a config field.
  isSandbox: (row?.environment ?? "sandbox") !== "production",
  encryptionReady: Boolean(Deno.env.get("ETIMS_CRED_ENC_KEY")),
});

Deno.serve(async (req) => {
  const api = await openRequest(req, {
    fn: "etims-credentials",
    methods: "POST, OPTIONS",
    versions: API_VERSIONS,
  });
  if (api.halt) return api.halt;

  const json = api.json;

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // ── Identify the caller ─────────────────────────────────────────────────
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Not authenticated" }, 401);

    const { data: userData } = await admin.auth.getUser(jwt);
    const user = userData?.user;
    if (!user) return json({ error: "Not authenticated" }, 401);

    // Saving initialises a device against KRA, so each call is an external
    // round trip. Registering a device happens a handful of times in a tenant's
    // life; anything more is either a mistake or an attempt to probe KRA
    // through our server.
    const over = await api.enforceLimit({
      action: "save",
      identity: `user:${user.id}`,
      limit: 10,
      windowSeconds: 60,
    });
    if (over) return over;

    const { data: profile } = await admin
      .from("user_profiles")
      .select("role, admin_id")
      .eq("id", user.id)
      .maybeSingle();

    if (!TENANT_OWNER_ROLES.includes(profile?.role ?? "")) {
      return json(
        { error: "Only the account owner can connect eTIMS for this organisation." },
        403,
      );
    }

    // Mirrors public.current_admin_id(). The role gate above already excludes
    // staff, but the resolution is kept identical so the two cannot drift.
    const adminId: string = profile?.admin_id ?? user.id;

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body?.action ?? "status";

    const loadRow = async (): Promise<Row | null> => {
      const { data } = await admin
        .from("etims_credentials")
        .select("*")
        .eq("admin_id", adminId)
        .maybeSingle();
      return (data as Row) ?? null;
    };

    // ── status ──────────────────────────────────────────────────────────────
    if (action === "status") {
      return json(publicView(await loadRow()));
    }

    // ── disable ─────────────────────────────────────────────────────────────
    // Stops filing without destroying the registration, so turning it back on
    // does not mean re-initialising a device with KRA. Documents already queued
    // stay queued: switching off is not a way to make an unfiled sale disappear,
    // and the obligation to file it does not go away either.
    if (action === "disable") {
      const existing = await loadRow();
      if (!existing) return json({ error: "eTIMS is not set up for this account." }, 404);

      await admin
        .from("etims_credentials")
        .update({
          is_active: false,
          last_error: "Switched off by the account owner.",
          updated_at: new Date().toISOString(),
        })
        .eq("admin_id", adminId);

      return json({
        ...publicView(await loadRow()),
        message:
          "eTIMS filing switched off. Documents already queued are kept — switching off does not withdraw a filing obligation.",
      });
    }

    // ── save ────────────────────────────────────────────────────────────────
    if (action !== "save") return json({ error: `Unknown action '${action}'` }, 400);

    if (!Deno.env.get("ETIMS_CRED_ENC_KEY")) {
      return json(
        {
          error:
            "ETIMS_CRED_ENC_KEY is not set on this project, so the device key cannot be stored securely. Set it in the Supabase function secrets first.",
          code: "ENC_KEY_MISSING",
        },
        503,
      );
    }

    const existing = await loadRow();

    const kraPin = normaliseKraPin(body.kraPin ?? existing?.kra_pin);
    const branchId = String(body.branchId ?? existing?.branch_id ?? "00").trim() || "00";
    const deviceSerial = String(body.deviceSerial ?? existing?.device_serial ?? "").trim();
    const environment = body.environment === "production"
      ? "production"
      : body.environment === "sandbox"
      ? "sandbox"
      : existing?.environment ?? "sandbox";

    if (!isValidKraPin(kraPin)) {
      return json(
        {
          error: kraPin
            ? `"${kraPin}" is not a valid KRA PIN. A PIN is a letter, nine digits and a check letter — for example P051234567X.`
            : "Enter the KRA PIN this business is registered under.",
        },
        400,
      );
    }

    if (!deviceSerial) {
      return json(
        { error: "Enter the device serial number KRA issued when you registered for eTIMS." },
        400,
      );
    }

    // ── Going live is a deliberate act ──────────────────────────────────────
    // A sandbox communication key does not authenticate against production, and
    // the two device sequences are unrelated. Carrying either across would file
    // nothing while looking configured.
    const movingEnvironment = Boolean(existing) && existing!.environment !== environment;

    // ── Prove KRA accepts the device BEFORE going live ──────────────────────
    const init = await initialiseDevice({ pin: kraPin, branchId, deviceSerial, environment });

    const accepted = init.outcome === "accepted";
    const info = (init.data ?? {}) as Record<string, any>;
    // KRA nests the device block differently between deployments.
    const deviceInfo = info?.info ?? info?.data?.info ?? info;
    const cmcKey: string | null = deviceInfo?.cmcKey ?? info?.cmcKey ?? null;

    if (accepted && !cmcKey) {
      // KRA said yes but gave us nothing to authenticate with later. Storing an
      // "active" device we cannot use would make every subsequent filing fail
      // with a misleading error.
      return json(
        {
          error:
            "KRA accepted the device but returned no communication key, so it cannot be used to file. Check the device serial number with KRA and try again.",
          code: "NO_CMC_KEY",
        },
        502,
      );
    }

    const now = new Date().toISOString();
    const row: Record<string, unknown> = {
      admin_id: adminId,
      kra_pin: kraPin,
      branch_id: branchId,
      device_serial: deviceSerial,
      environment,
      is_active: accepted,
      last_error: accepted ? null : `${init.resultCd ?? "no code"}: ${init.message}`,
      updated_at: now,
    };

    if (accepted) {
      row.cmc_key_enc = await encryptSecret(cmcKey!, "etims", {
        recordId: adminId,
        field: "cmc_key_enc",
      });
      row.control_unit_id = deviceInfo?.sdcId ?? deviceInfo?.dvcId ?? null;
      row.initialised_at = now;
      row.verified_at = now;
    }

    // A device that has moved environment starts a fresh sequence at zero. KRA
    // holds a separate sequence per environment, so continuing the old count
    // would file the first live document under a number the live device has
    // never seen.
    if (movingEnvironment) row.last_invoice_number = 0;

    const { error: upsertErr } = await admin
      .from("etims_credentials")
      .upsert(row, { onConflict: "admin_id" });

    if (upsertErr) {
      console.error("Failed to store eTIMS credentials:", upsertErr.message);
      return json({ error: "Could not save the eTIMS configuration. Please try again." }, 500);
    }

    return json({
      ...publicView(await loadRow()),
      verified: accepted,
      message: accepted
        ? environment === "production"
          ? "KRA accepted this device. Invoices will now be filed to eTIMS."
          : "KRA's sandbox accepted this device. Nothing filed here reaches the live system — switch to Production when you are ready to file for real."
        : `KRA rejected this device, so filing stays off. ${init.message}`,
    });
  } catch (err) {
    return api.fail(err);
  }
});
