/**
 * The eTIMS code vocabulary exists in two files and they must agree:
 *
 *   src/config/etimsCodes.js                  — what the UI renders: labels for
 *                                               the classification dropdowns,
 *                                               the environment picker, PIN
 *                                               validation on the settings form
 *   supabase/functions/_shared/etims.ts       — what is actually FILED
 *
 * Two copies exist because a browser must not be able to assert the figures on
 * a tax document, so the builder lives server-side (see that file's header),
 * while the settings and classification screens need the same codes to offer.
 *
 * Drift between them is not a cosmetic problem. If the UI offers a tax code the
 * builder does not recognise, a tenant classifies an item, sees it marked ready,
 * and every invoice for it is refused. If the two disagree on a RATE, the
 * tenant is shown one figure and files another.
 *
 * So this test asserts they match. Change one, change both.
 */

import { describe, it, expect } from 'vitest';
import {
  TAX_CODES,
  TAX_CODE_KEYS,
  taxRateFor as jsTaxRateFor,
  paymentTypeCode as jsPaymentTypeCode,
  PAYMENT_TYPE_CODES as JS_PAYMENT_TYPE_CODES,
  isValidKraPin as jsIsValidKraPin,
  KRA_PIN_PATTERN,
  etimsBaseUrl as jsEtimsBaseUrl,
  ETIMS_ENVIRONMENTS,
  DEFAULT_QUANTITY_UNIT,
  DEFAULT_PACKAGING_UNIT,
  DEFAULT_ITEM_TYPE,
  HEAD_OFFICE_BRANCH,
} from './etimsCodes';
import {
  TAX_CODE_KEYS as TS_TAX_CODE_KEYS,
  taxRateFor as tsTaxRateFor,
  paymentTypeCode as tsPaymentTypeCode,
  PAYMENT_TYPE_CODES as TS_PAYMENT_TYPE_CODES,
  isValidKraPin as tsIsValidKraPin,
  KRA_PIN_PATTERN as TS_KRA_PIN_PATTERN,
  etimsBaseUrl as tsEtimsBaseUrl,
  DEFAULT_QUANTITY_UNIT as TS_DEFAULT_QUANTITY_UNIT,
  DEFAULT_PACKAGING_UNIT as TS_DEFAULT_PACKAGING_UNIT,
  DEFAULT_ITEM_TYPE as TS_DEFAULT_ITEM_TYPE,
  HEAD_OFFICE_BRANCH as TS_HEAD_OFFICE_BRANCH,
} from '../../supabase/functions/_shared/etims.ts';

describe('tax codes', () => {
  it('both files define the same set of codes, in the same order', () => {
    expect(TAX_CODE_KEYS).toEqual(TS_TAX_CODE_KEYS);
  });

  // Across regimes, so a rate that varies by date varies identically in both.
  const dates = ['2019-01-01', '2020-06-01', '2021-06-01', '2026-09-02'];

  it.each(dates)('agrees on every coderate as at %s', (asOf) => {
    for (const code of TAX_CODE_KEYS) {
      expect(jsTaxRateFor(code, asOf), `code ${code} on ${asOf}`)
        .toBe(tsTaxRateFor(code, asOf));
    }
  });

  it('agrees that an unknown code has no rate, rather than a rate of zero', () => {
    expect(jsTaxRateFor('Z')).toBeNull();
    expect(tsTaxRateFor('Z')).toBeNull();
  });

  it('the UI carries a label and a description for every code the builder accepts', () => {
    for (const code of TS_TAX_CODE_KEYS) {
      const entry = TAX_CODES.find((t) => t.code === code);
      expect(entry, `no UI entry for tax code ${code}`).toBeTruthy();
      expect(entry.label).toBeTruthy();
      expect(entry.desc).toBeTruthy();
    }
  });

  it('does not hardcode the standard rate in either file', () => {
    // 'B' means "the standard rate", resolved by date. A fixed number here
    // would recreate the constant taxRegulations.js exists to delete.
    expect(TAX_CODES.find((t) => t.code === 'B').rate).toBeNull();
    expect(tsTaxRateFor('B', '2020-06-01')).toBe(14);
    expect(tsTaxRateFor('B', '2026-09-02')).toBe(16);
  });
});

describe('payment types', () => {
  it('maps the same methods to the same KRA codes', () => {
    expect(JS_PAYMENT_TYPE_CODES).toEqual(TS_PAYMENT_TYPE_CODES);
  });

  it.each(['cash', 'mpesa', 'card', 'cheque', 'bank_transfer', 'barter', null])(
    'agrees on the code for %s',
    (method) => expect(jsPaymentTypeCode(method)).toBe(tsPaymentTypeCode(method)),
  );

  it('covers every payment method the POS can record', () => {
    // src/hooks/usePOS.js paymentMethodMap — a method the till accepts but
    // eTIMS has no code for would file as "other" without anyone noticing.
    for (const method of ['mpesa', 'cash', 'bank_transfer', 'card', 'cheque']) {
      expect(JS_PAYMENT_TYPE_CODES[method], `no KRA code for ${method}`).toBeTruthy();
    }
  });
});

describe('KRA PIN validation', () => {
  it('uses the same pattern', () => {
    expect(KRA_PIN_PATTERN.source).toBe(TS_KRA_PIN_PATTERN.source);
  });

  it.each(['P051234567X', 'A012345678B', '', 'P05123456X', 'X051234567X', ' p051234567x '])(
    'agrees on %s',
    (pin) => expect(jsIsValidKraPin(pin)).toBe(tsIsValidKraPin(pin)),
  );
});

describe('environments', () => {
  it.each(['sandbox', 'production', 'nonsense', null])('resolves the same base URL for %s', (env) => {
    expect(jsEtimsBaseUrl(env)).toBe(tsEtimsBaseUrl(env));
  });

  it('falls back to the sandbox, never to production', () => {
    // Getting this backwards would file real documents from a misconfigured
    // tenant. The sandbox is the safe default in both files.
    expect(jsEtimsBaseUrl(undefined)).toBe(ETIMS_ENVIRONMENTS.sandbox.baseUrl);
    expect(tsEtimsBaseUrl(undefined)).toBe(ETIMS_ENVIRONMENTS.sandbox.baseUrl);
  });
});

describe('defaults', () => {
  it('agrees on the fallbacks a line uses when nothing is recorded', () => {
    expect(DEFAULT_QUANTITY_UNIT).toBe(TS_DEFAULT_QUANTITY_UNIT);
    expect(DEFAULT_PACKAGING_UNIT).toBe(TS_DEFAULT_PACKAGING_UNIT);
    expect(DEFAULT_ITEM_TYPE).toBe(TS_DEFAULT_ITEM_TYPE);
    expect(HEAD_OFFICE_BRANCH).toBe(TS_HEAD_OFFICE_BRANCH);
  });
});
