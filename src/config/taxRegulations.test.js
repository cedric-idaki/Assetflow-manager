/**
 * The regulatory tax schedule.
 *
 * Two things are being protected.
 *
 * THE RIGHT RATE FOR THE DATE. A bill is taxed under the instrument in force
 * when it was raised. That means the boundary cases have to be exact — a rate
 * that comes into force ON the 1st governs the 1st, not the 2nd — and it means
 * a bill for a PERIOD resolves against the end of that period, because that is
 * when it falls due. Getting either wrong misstates tax on a document a tenant
 * files.
 *
 * THE TABLE STAYS WELL FORMED. Everything downstream assumes the schedule is
 * ordered, and that resolving any date lands on exactly one regime. A regime
 * inserted in the wrong place would silently shadow its neighbours rather than
 * fail, so the ordering is asserted rather than assumed.
 */

import { describe, it, expect } from 'vitest';
import {
  TAX_REGIMES,
  BASIS_NET,
  BASIS_GROSS,
  resolveTaxRegime,
  previousTaxRegime,
  vatRateOn,
  pricesIncludeTaxOn,
  leviesOn,
  computeLevies,
  currentTaxRegime,
  asOfDate,
  VAT_RATE,
  VAT_INCLUSIVE_PRICES,
} from './taxRegulations';

// ─────────────────────────────────────────────────────────────────────────────
describe('the schedule is well formed', () => {
  it('is ordered oldest to newest, with no two regimes on the same day', () => {
    const dates = TAX_REGIMES.map((r) => r.effectiveFrom);
    expect(dates).toEqual([...dates].sort());
    expect(new Set(dates).size).toBe(dates.length);
  });

  it('gives every regime a version, a citable instrument and a usable rate', () => {
    // The instrument is not decoration: it is the answer to "why was I charged
    // this", and an entry added without one cannot be checked against the law.
    TAX_REGIMES.forEach((r) => {
      expect(r.version, 'version').toBeTruthy();
      expect(r.instrument, `${r.version} instrument`).toBeTruthy();
      expect(r.effectiveFrom, `${r.version} effectiveFrom`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isFinite(r.vatRate), `${r.version} vatRate`).toBe(true);
      expect(r.vatRate, `${r.version} vatRate`).toBeGreaterThanOrEqual(0);
      expect(typeof r.pricesIncludeTax, `${r.version} pricesIncludeTax`).toBe('boolean');
      expect(Array.isArray(r.levies), `${r.version} levies`).toBe(true);
    });
  });

  it('versions each regime by its own effective date', () => {
    // Not required by the resolver, but it is what makes a stored
    // `rate_version` readable at a glance, and what the server mirror is
    // compared on.
    TAX_REGIMES.forEach((r) => expect(r.version).toBe(r.effectiveFrom));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the rate resolves from the billing date', () => {
  it('applies a new rate from the day it comes into force, not the day after', () => {
    // LN 35/2020 cut the standard rate to 14% with effect from 1 April 2020.
    expect(vatRateOn('2020-03-31')).toBe(16);
    expect(vatRateOn('2020-04-01')).toBe(14);
    expect(vatRateOn('2020-04-02')).toBe(14);
  });

  it('holds a rate until the instrument that changes it', () => {
    expect(vatRateOn('2020-12-31')).toBe(14);
    expect(vatRateOn('2021-01-01')).toBe(16);
  });

  it('reprints history at the rate that was charged, not today’s', () => {
    // The whole point of the table. A June 2020 invoice was taxed at 14% and
    // must still say 14% when it is downloaded again years later.
    expect(resolveTaxRegime('2020-06-15').vatRate).toBe(14);
    expect(resolveTaxRegime('2020-06-15').vatRate).not.toBe(VAT_RATE);
  });

  it('resolves a YYYY-MM period against the END of that month', () => {
    // A monthly bill falls due at period end, so a rate that arrives mid-month
    // governs the whole of that month's invoice.
    expect(vatRateOn('2020-04')).toBe(14);      // rate came in on the 1st
    expect(vatRateOn('2020-03')).toBe(16);      // month ends before it
    expect(vatRateOn('2020-12')).toBe(14);
    expect(vatRateOn('2021-01')).toBe(16);
  });

  it('accepts a Date and a full ISO timestamp, not just a date string', () => {
    expect(vatRateOn(new Date('2020-06-15T00:00:00Z'))).toBe(14);
    expect(vatRateOn('2020-06-15T13:45:12.000Z')).toBe(14);
  });

  it('falls back to the current regime when no date is given', () => {
    // "Bill it now" is the common case: a quote, a fresh sale, a blank form.
    [null, undefined, '', 'not a date'].forEach((v) => {
      expect(resolveTaxRegime(v).version, String(v)).toBe(currentTaxRegime().version);
    });
    expect(VAT_RATE).toBe(currentTaxRegime().vatRate);
    expect(VAT_INCLUSIVE_PRICES).toBe(currentTaxRegime().pricesIncludeTax);
  });

  it('flags a date the schedule cannot stand behind rather than guessing', () => {
    const before = resolveTaxRegime('2001-01-01');
    expect(before.version).toBe(TAX_REGIMES[0].version);
    expect(before.beforeHistory).toBe(true);
    // Everything the schedule does cover must NOT carry the flag, or the
    // signal is worthless.
    expect(resolveTaxRegime(TAX_REGIMES[0].effectiveFrom).beforeHistory).toBe(false);
    expect(resolveTaxRegime('2026-09-02').beforeHistory).toBe(false);
  });

  it('lands every date on exactly one regime', () => {
    // Sweep both sides of every boundary: the resolved regime must be the last
    // one whose effective date has passed, always.
    TAX_REGIMES.forEach((regime, i) => {
      const day = regime.effectiveFrom;
      expect(resolveTaxRegime(day).version, `on ${day}`).toBe(regime.version);
      if (i > 0) {
        const prior = new Date(`${day}T00:00:00Z`);
        prior.setUTCDate(prior.getUTCDate() - 1);
        const eve = prior.toISOString().slice(0, 10);
        expect(resolveTaxRegime(eve).version, `eve of ${day}`).toBe(TAX_REGIMES[i - 1].version);
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('date normalisation', () => {
  it('reduces anything date-shaped to a plain YYYY-MM-DD', () => {
    expect(asOfDate('2026-09-02')).toBe('2026-09-02');
    expect(asOfDate('2026-09-02T11:22:33Z')).toBe('2026-09-02');
    expect(asOfDate(new Date('2026-09-02T00:00:00Z'))).toBe('2026-09-02');
    expect(asOfDate('2026-02')).toBe('2026-02-28');   // month end, leap-year aware
    expect(asOfDate('2024-02')).toBe('2024-02-29');
  });

  it('returns null for what is not a date, so the caller can default', () => {
    [null, undefined, '', '   ', 'soon', '2026-13', new Date('nonsense')].forEach((v) => {
      expect(asOfDate(v), String(v)).toBeNull();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the previous regime, for a changeover day', () => {
  it('is the entry immediately before the one in force', () => {
    expect(previousTaxRegime('2021-01-01').version).toBe('2020-04-01');
    expect(previousTaxRegime('2020-04-01').version).toBe('2013-09-02');
  });

  it('is null at the start of the schedule — there is nothing behind it', () => {
    expect(previousTaxRegime('2013-09-02')).toBeNull();
    expect(previousTaxRegime('1999-01-01')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('statutory levies', () => {
  it('charges nothing today, because there are no levies today', () => {
    TAX_REGIMES.forEach((r) => expect(r.levies, r.version).toEqual([]));
    expect(leviesOn('2026-09-02')).toEqual([]);
    expect(computeLevies({ netBase: 100000, grossBase: 116000, levies: leviesOn() })).toEqual([]);
  });

  it('takes a net-based levy off the tax-exclusive value', () => {
    const [levy] = computeLevies({
      netBase: 10000,
      grossBase: 11600,
      levies: [{ key: 'dst', label: 'Digital service tax', rate: 0.015, basis: BASIS_NET, taxable: true }],
    });
    expect(levy.base).toBe(10000);
    expect(levy.amount).toBe(150);
    expect(levy.taxable).toBe(true);
  });

  it('takes a gross-based levy off the advertised price', () => {
    const [levy] = computeLevies({
      netBase: 10000,
      grossBase: 11600,
      levies: [{ key: 'x', label: 'Excise duty', rate: 0.02, basis: BASIS_GROSS, taxable: false }],
    });
    expect(levy.base).toBe(11600);
    expect(levy.amount).toBe(232);
    expect(levy.taxable).toBe(false);
  });

  it('never computes one levy on another, whatever order they are listed in', () => {
    // Compounding would make the total depend on the order of the array, which
    // is an editing accident waiting to happen. Both levies see the same base.
    const levies = [
      { key: 'a', label: 'A', rate: 0.10, basis: BASIS_NET, taxable: true },
      { key: 'b', label: 'B', rate: 0.10, basis: BASIS_NET, taxable: true },
    ];
    const forward = computeLevies({ netBase: 1000, grossBase: 1160, levies });
    const reversed = computeLevies({ netBase: 1000, grossBase: 1160, levies: [...levies].reverse() });

    expect(forward.map((l) => l.amount)).toEqual([100, 100]);
    expect(reversed.map((l) => l.amount)).toEqual([100, 100]);
  });

  it('defaults an unstated basis to net and an unstated taxability to taxable', () => {
    const [levy] = computeLevies({
      netBase: 1000,
      grossBase: 1160,
      levies: [{ key: 'q', label: 'Q', rate: 0.05 }],
    });
    expect(levy.basis).toBe(BASIS_NET);
    expect(levy.taxable).toBe(true);
    expect(levy.amount).toBe(50);
  });

  it('drops a levy that comes to nothing rather than printing a KES 0 line', () => {
    const priced = computeLevies({
      netBase: 1000,
      grossBase: 1160,
      levies: [
        { key: 'zero', label: 'Not yet in force', rate: 0, basis: BASIS_NET, taxable: true },
        { key: 'real', label: 'Real', rate: 0.01, basis: BASIS_NET, taxable: true },
      ],
    });
    expect(priced.map((l) => l.key)).toEqual(['real']);
  });

  it('carries the authority for each levy through to the caller', () => {
    const [levy] = computeLevies({
      netBase: 1000,
      grossBase: 1160,
      levies: [{ key: 'k', label: 'K', instrument: 'Finance Act 2027, s.12', rate: 0.01, basis: BASIS_NET, taxable: true }],
    });
    expect(levy.instrument).toBe('Finance Act 2027, s.12');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('tax-inclusive pricing', () => {
  it('is what every regime in the table says today', () => {
    // Recorded, not assumed. A regime that flips this makes the catalogue net
    // and adds tax on top — a real increase to every tenant's bill — so it must
    // never arrive as a side effect of an unrelated edit.
    TAX_REGIMES.forEach((r) => expect(r.pricesIncludeTax, r.version).toBe(true));
    expect(pricesIncludeTaxOn('2020-06-15')).toBe(true);
    expect(VAT_INCLUSIVE_PRICES).toBe(true);
  });
});
