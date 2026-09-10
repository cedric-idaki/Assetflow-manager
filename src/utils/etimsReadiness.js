/**
 * eTIMS READINESS (pure) — "can this tenant file, and if not, what is missing?"
 *
 * The counterpart to supabase/functions/_shared/etims.ts, and deliberately much
 * smaller than it. That file builds the document and computes the tax; this one
 * computes NO MONEY AT ALL. It only inspects configuration and reports what is
 * not done yet.
 *
 * The split is the point. A browser must not be able to assert the figures on a
 * tax document, so the arithmetic is server-side. But a tenant should not have
 * to make a sale, wait for a queue drain and then read a rejection to discover
 * that half their catalogue is unclassified — so the same faults are named
 * here, before anything is sold, from data the browser already has.
 *
 * Everything here is advisory. Nothing in this file decides whether a document
 * transmits: the server re-checks all of it, because a check that only runs in
 * a browser is not a check.
 */

import { isValidKraPin, taxCode, TAX_CODES } from '../config/etimsCodes';

/** Severity ordering, worst first — the UI lists blockers before warnings. */
export const BLOCKER = 'blocker';
export const WARNING = 'warning';

const issue = (severity, code, message, fix = null) => ({ severity, code, message, fix });

/**
 * What is stopping this tenant from filing.
 *
 * `config` is the etims-credentials status response; `items` is the rows from
 * etims_unclassified_items(). Both may be absent while loading, which reports
 * as "not configured" rather than throwing — a panel that crashes on an empty
 * fetch is worse than one that says nothing yet.
 */
export const etimsReadiness = ({ config = null, unclassifiedCount = 0, queue = null } = {}) => {
  const issues = [];

  if (!config?.configured) {
    issues.push(
      issue(
        BLOCKER,
        'not_configured',
        'No KRA device is registered for this account, so nothing is being filed.',
        'Enter your KRA PIN and eTIMS device serial number below.',
      ),
    );
    // Every other check is downstream of having a device at all.
    return { ready: false, issues, filing: false };
  }

  if (!config.encryptionReady) {
    issues.push(
      issue(
        BLOCKER,
        'no_encryption_key',
        'The platform has no encryption key configured for eTIMS device keys, so credentials cannot be stored securely.',
        'This is a platform setting — contact support.',
      ),
    );
  }

  if (!isValidKraPin(config.kraPin)) {
    issues.push(
      issue(BLOCKER, 'bad_pin', `"${config.kraPin ?? ''}" is not a valid KRA PIN.`),
    );
  }

  if (!config.isActive) {
    issues.push(
      issue(
        BLOCKER,
        'not_active',
        config.lastError
          ? `KRA has not accepted this device: ${config.lastError}`
          : 'Filing is switched off for this account.',
        'Re-check the PIN, branch and device serial number, then save again.',
      ),
    );
  }

  // Not a blocker — the sandbox works perfectly and filing to it is the correct
  // thing to do while testing. It is a WARNING because the failure it prevents
  // is silent: everything looks green and nothing has been filed.
  if (config.isSandbox) {
    issues.push(
      issue(
        WARNING,
        'sandbox',
        'This device is registered against the KRA sandbox. Documents filed here are tests and do not reach the live system.',
        'Switch to Production when you are ready to file for real.',
      ),
    );
  }

  if (unclassifiedCount > 0) {
    issues.push(
      issue(
        BLOCKER,
        'unclassified_items',
        `${unclassifiedCount} item${unclassifiedCount === 1 ? '' : 's'} sold ${
          unclassifiedCount === 1 ? 'has' : 'have'
        } no KRA classification, so ${unclassifiedCount === 1 ? 'its invoice' : 'their invoices'} cannot be filed.`,
        'Classify them under Item classification below.',
      ),
    );
  }

  if (queue?.uncertain > 0) {
    issues.push(
      issue(
        BLOCKER,
        'uncertain',
        `${queue.uncertain} document${queue.uncertain === 1 ? '' : 's'} may or may not have reached KRA and ${
          queue.uncertain === 1 ? 'needs' : 'need'
        } a decision.`,
        'Check each one in your KRA eTIMS portal, then mark it filed or send it again.',
      ),
    );
  }

  if (queue?.rejected > 0) {
    issues.push(
      issue(
        BLOCKER,
        'rejected',
        `KRA refused ${queue.rejected} document${queue.rejected === 1 ? '' : 's'}.`,
        'Fix what each rejection names, then release it.',
      ),
    );
  }

  return {
    // "Filing correctly right now", which is stricter than "switched on".
    ready: issues.every((i) => i.severity !== BLOCKER),
    // Whether documents are being transmitted at all, sandbox or not.
    filing: Boolean(config.isActive),
    issues,
  };
};

/**
 * Is one item's classification complete enough to file with?
 *
 * Mirrors what the builder refuses on, so the classification form can mark a
 * row done without a round trip. `registered_at` is separate: an item can be
 * fully classified and simply not yet announced to KRA, which the transmit
 * function does by itself on the first sale.
 */
export const classificationStatus = (row) => {
  if (!row) return { complete: false, missing: ['everything'] };

  const missing = [];
  if (!taxCode(row.tax_code)) missing.push('tax code');
  if (!row.classification_code) missing.push('KRA classification code');
  if (!row.quantity_unit) missing.push('unit');

  return {
    complete: missing.length === 0,
    missing,
    // Announced to KRA. Not required for the row to be complete — the first
    // sale registers it — but worth showing, because a registration that keeps
    // failing is the tenant's problem to see.
    registered: Boolean(row.registered_at),
  };
};

/**
 * The tax code a sale's VAT figures are consistent with, or null where they are
 * consistent with more than one.
 *
 * Used to pre-select a code on the classification form. A sale that charged tax
 * at the standard rate can only be standard rated; a sale that charged none is
 * exempt, zero-rated OR non-VAT, and this returns null rather than picking —
 * the same refusal the builder makes, for the same reason.
 */
export const suggestTaxCode = ({ vatAmount, sellingPrice } = {}) => {
  const vat = parseFloat(vatAmount) || 0;
  const price = parseFloat(sellingPrice) || 0;
  if (price <= 0) return null;
  return vat > 0 ? 'B' : null;
};

/** The codes a classification form should offer, with their explanations. */
export const taxCodeOptions = () =>
  TAX_CODES.map((t) => ({
    value: t.code,
    label: `${t.code} — ${t.label}`,
    desc: t.desc,
    // A tenant choosing between "exempt" and "zero rated" needs to know this is
    // the difference that matters to them commercially.
    reclaimsInputTax: t.reclaimsInputTax,
  }));

export default etimsReadiness;
