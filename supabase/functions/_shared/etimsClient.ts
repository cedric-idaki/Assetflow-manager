/// <reference lib="deno.ns" />
/**
 * THE KRA eTIMS HTTP CLIENT — and, more importantly, the policy for what to do
 * when KRA does not answer.
 *
 * ── THE PROBLEM THIS FILE IS MOSTLY ABOUT ───────────────────────────────────
 * Transmitting an invoice is not idempotent. KRA assigns a receipt signature to
 * an invoice number, and re-sending the same number either fails as a duplicate
 * or — worse, and observed — files a second document. So the retry policy is
 * not a detail: it decides whether a tenant's return is right.
 *
 * Three outcomes, three different correct responses:
 *
 *   ANSWERED, ACCEPTED    Store the signature. Done, once, forever.
 *
 *   ANSWERED, REJECTED    KRA read the document and refused it. Nothing was
 *                         filed, so re-sending the SAME invoice number is safe
 *                         — but pointless until the fault is fixed, because a
 *                         rejection is deterministic. These do not retry on a
 *                         timer; they park for a human. Retrying a malformed
 *                         document 40 times is how a real outage gets buried.
 *
 *   NO ANSWER             A timeout, a dropped connection, a 502 from a proxy.
 *                         THIS IS THE DANGEROUS ONE: the request may have been
 *                         processed. Re-sending risks a duplicate filing; not
 *                         re-sending risks an unfiled sale. Neither is safe to
 *                         choose automatically, so the row is marked `uncertain`
 *                         and surfaced for review rather than retried blind.
 *
 * Only genuine pre-flight failures — the connection never opened, or KRA
 * returned a code it defines as transient — retry automatically, because in
 * those cases we know nothing was filed.
 *
 * ── AUTHENTICATION ──────────────────────────────────────────────────────────
 * eTIMS does not use OAuth. A device is initialised once against KRA with its
 * PIN, branch and serial number, and KRA returns a communication key (cmcKey)
 * that authenticates every later call. That key is the credential: it is sealed
 * with SIGNNOW-style AES-GCM before it touches the database (see _shared/
 * crypto.ts) and is never returned to any client.
 */

import { etimsBaseUrl } from "./etims.ts";

/** How long to wait for KRA before giving up on one call. */
const REQUEST_TIMEOUT_MS = 30_000;

/** KRA's own success code. Everything else is a failure of some kind. */
export const RESULT_OK = "000";

/**
 * Codes KRA returns that mean "try again later" rather than "this document is
 * wrong". Anything not listed is treated as permanent, which is the safe
 * default: a permanent classification parks the row for a human, where a wrong
 * "transient" classification burns the retry budget and hides the fault.
 */
const TRANSIENT_RESULT_CODES = new Set([
  "899", // internal server error at KRA
  "894", // service temporarily unavailable
  "802", // device busy
]);

/**
 * Codes meaning "KRA has already accepted a document under this invoice
 * number". Never retried, and never treated as a failure to file: the document
 * IS filed, it just was not this attempt that filed it. Almost always the tail
 * of an earlier `uncertain` outcome.
 */
const DUPLICATE_RESULT_CODES = new Set(["881", "910"]);

export type EtimsOutcome = "accepted" | "rejected" | "duplicate" | "retryable" | "uncertain";

export interface EtimsResponse {
  outcome: EtimsOutcome;
  /** KRA's result code, where it answered at all. */
  resultCd: string | null;
  /** KRA's own message, or a description of the transport failure. */
  message: string;
  /** The parsed body, when there was one. */
  data: unknown;
  /** The raw body, truncated. Kept because KRA's errors are often only in here. */
  raw: string | null;
  httpStatus: number | null;
}

export interface EtimsCredentials {
  pin: string;
  branchId: string;
  /** The communication key KRA issued at device initialisation. */
  cmcKey: string;
  environment: string;
}

/** Only ever store a bounded amount of somebody else's error text. */
const truncate = (s: string, max = 4000) => (s.length > max ? `${s.slice(0, max)}…` : s);

/**
 * POST one eTIMS call and classify the outcome.
 *
 * `path` is the endpoint after /etims-api, e.g. "saveTrnsSalesOsdc".
 *
 * Never throws for an expected failure. A caller that has to wrap this in
 * try/catch to find out whether an invoice was filed will get it wrong — the
 * outcome is the return value.
 */
export async function callEtims(
  path: string,
  body: Record<string, unknown>,
  creds: EtimsCredentials,
  { timeoutMs = REQUEST_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<EtimsResponse> {
  const url = `${etimsBaseUrl(creds.environment)}/${path.replace(/^\//, "")}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // eTIMS authenticates per call on these three headers.
        tin: creds.pin,
        bhfId: creds.branchId,
        cmcKey: creds.cmcKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const aborted = (err as Error)?.name === "AbortError";
    return {
      // An aborted request may have been processed at the other end. A
      // connection that never opened was not. Only the second is safe to retry.
      outcome: aborted ? "uncertain" : "retryable",
      resultCd: null,
      message: aborted
        ? `KRA did not answer within ${Math.round(timeoutMs / 1000)}s. Whether the document was filed is unknown.`
        : `Could not reach KRA: ${(err as Error)?.message ?? "connection failed"}`,
      data: null,
      raw: null,
      httpStatus: null,
    };
  } finally {
    clearTimeout(timer);
  }

  const raw = truncate(await res.text().catch(() => ""));

  let parsed: any = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    // KRA returns an HTML error page from its gateway often enough that this is
    // an expected branch, not a surprise.
    parsed = null;
  }

  // A 5xx is the gateway, not eTIMS itself. The request may or may not have
  // reached the application behind it, so it is uncertain rather than
  // retryable — except 503/429, which are refusals to accept work at all.
  if (!res.ok && parsed === null) {
    const refused = res.status === 503 || res.status === 429 || res.status === 502;
    return {
      outcome: refused ? "retryable" : res.status >= 500 ? "uncertain" : "rejected",
      resultCd: null,
      message: `KRA returned HTTP ${res.status}.`,
      data: null,
      raw,
      httpStatus: res.status,
    };
  }

  const resultCd = parsed?.resultCd != null ? String(parsed.resultCd) : null;
  const message = String(parsed?.resultMsg ?? `HTTP ${res.status}`);

  if (resultCd === RESULT_OK) {
    return { outcome: "accepted", resultCd, message, data: parsed?.data ?? parsed, raw, httpStatus: res.status };
  }

  if (resultCd && DUPLICATE_RESULT_CODES.has(resultCd)) {
    return { outcome: "duplicate", resultCd, message, data: parsed?.data ?? null, raw, httpStatus: res.status };
  }

  if (resultCd && TRANSIENT_RESULT_CODES.has(resultCd)) {
    return { outcome: "retryable", resultCd, message, data: null, raw, httpStatus: res.status };
  }

  // KRA answered and refused. Deterministic — do not retry on a timer.
  return {
    outcome: resultCd ? "rejected" : "uncertain",
    resultCd,
    message: resultCd ? message : "KRA's reply could not be understood.",
    data: parsed?.data ?? null,
    raw,
    httpStatus: res.status,
  };
}

// ===========================================================================
// THE CALLS THIS SYSTEM MAKES
// ===========================================================================

/**
 * Initialise a device against KRA and collect its communication key.
 *
 * Called once per tenant, from etims-credentials, with the PIN, branch and the
 * device serial number KRA issued when the taxpayer registered for eTIMS. It is
 * the ONLY call that runs without a cmcKey, because obtaining one is its whole
 * purpose.
 */
export async function initialiseDevice(
  { pin, branchId, deviceSerial, environment }: {
    pin: string;
    branchId: string;
    deviceSerial: string;
    environment: string;
  },
): Promise<EtimsResponse> {
  return await callEtims(
    "selectInitOsdcInfo",
    { tin: pin, bhfId: branchId, dvcSrlNo: deviceSerial },
    // No key yet — this call is what returns one.
    { pin, branchId, cmcKey: "", environment },
  );
}

/** Transmit a sales document. The one call that files anything. */
export async function transmitSalesDocument(
  payload: Record<string, unknown>,
  creds: EtimsCredentials,
): Promise<EtimsResponse> {
  return await callEtims("saveTrnsSalesOsdc", payload, creds);
}

/**
 * Register an item in KRA's catalogue.
 *
 * eTIMS rejects a sales line for an item it has never been told about, so every
 * classified item is registered before its first sale. Idempotent at KRA's end:
 * re-sending an existing itemCd updates it.
 */
export async function saveItem(
  item: Record<string, unknown>,
  creds: EtimsCredentials,
): Promise<EtimsResponse> {
  return await callEtims("saveItem", { ...item, tin: creds.pin, bhfId: creds.branchId }, creds);
}

/**
 * Fetch KRA's code lists, which are revised and therefore never pinned in
 * source. `lastReqDt` is 'yyyyMMddHHmmss'; passing an old date returns
 * everything.
 */
export async function fetchCodeList(
  creds: EtimsCredentials,
  lastReqDt = "20180101000000",
): Promise<EtimsResponse> {
  return await callEtims("selectCodeList", { tin: creds.pin, bhfId: creds.branchId, lastReqDt }, creds);
}

/** Fetch the item classification list (the itemClsCd values a line must carry). */
export async function fetchItemClassifications(
  creds: EtimsCredentials,
  lastReqDt = "20180101000000",
): Promise<EtimsResponse> {
  return await callEtims(
    "selectItemClsList",
    { tin: creds.pin, bhfId: creds.branchId, lastReqDt },
    creds,
  );
}

/**
 * Transmit a stock movement.
 *
 * Separate from the balance below on purpose: KRA treats a movement and a
 * balance as different statements, and sending one where the other is meant
 * either double-counts stock or silently fails to correct it.
 */
export async function transmitStockMovement(
  payload: Record<string, unknown>,
  creds: EtimsCredentials,
): Promise<EtimsResponse> {
  return await callEtims("insertStockIO", payload, creds);
}

/** Declare the remaining quantity of one item. Idempotent at KRA's end. */
export async function saveStockBalance(
  payload: Record<string, unknown>,
  creds: EtimsCredentials,
): Promise<EtimsResponse> {
  return await callEtims("saveStockMaster", payload, creds);
}

/**
 * Fetch the purchases suppliers have filed against this tenant's PIN.
 *
 * This is the read that makes a purchase book unnecessary: KRA already holds
 * the supplier's side of every transaction, so the tenant reviews rather than
 * retypes. `lastReqDt` is 'yyyyMMddHHmmss'; an old date returns everything.
 */
export async function fetchPurchases(
  creds: EtimsCredentials,
  lastReqDt = "20180101000000",
): Promise<EtimsResponse> {
  return await callEtims(
    "selectTrnsPurchaseSalesList",
    { tin: creds.pin, bhfId: creds.branchId, lastReqDt },
    creds,
  );
}

/** File the tenant's verdict on a purchase back to KRA. */
export async function transmitPurchase(
  payload: Record<string, unknown>,
  creds: EtimsCredentials,
): Promise<EtimsResponse> {
  return await callEtims("insertTrnsPurchase", payload, creds);
}

/**
 * Whether an outcome means the caller may safely send this invoice number
 * again on a later run.
 *
 * Deliberately narrow. 'uncertain' is excluded: that is the case where the
 * document may already be filed, and choosing for the tenant is not this
 * system's call to make.
 */
export const mayRetry = (outcome: EtimsOutcome): boolean => outcome === "retryable";

/**
 * Exponential backoff with a ceiling, in seconds.
 *
 * Starts at a minute and tops out at six hours. KRA's outages are measured in
 * hours, not seconds, so a tight retry loop achieves nothing but a larger log.
 */
export function backoffSeconds(attempt: number): number {
  const base = 60 * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(base, 6 * 60 * 60);
}
