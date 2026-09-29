import { describe, it, expect } from 'vitest';
import {
  PRICING_MODELS,
  TERM_FIELDS,
  buildTerms,
  validateTerms,
  describeTerms,
  termsDiffer,
  blankTermsForm,
  termsToForm,
  isCurrentEngagement,
} from './consultancyPricing';

describe('PRICING_MODELS', () => {
  it('asks each model only for known term columns, each once', () => {
    PRICING_MODELS.forEach((m) => {
      const keys = m.fields.map(f => f.key);
      expect(new Set(keys).size).toBe(keys.length);
      keys.forEach(k => expect(TERM_FIELDS).toContain(k));
    });
  });

  it('gives every model a label, an icon and a hint', () => {
    PRICING_MODELS.forEach((m) => {
      expect(m.label).toBeTruthy();
      expect(m.icon).toBeTruthy();
      expect(m.hint).toBeTruthy();
    });
  });
});

describe('buildTerms', () => {
  it('drops terms the model does not use, the way the database clears them', () => {
    const t = buildTerms({
      pricing_model: 'hourly', amount: '5000', billing_period: 'monthly', success_pct: '10', unit_label: 'report',
    });
    expect(t).toEqual({
      pricing_model: 'hourly', amount: 5000, unit_label: null, included_hours: null, overage_rate: null,
      billing_period: null, success_pct: null, success_basis: null, minimum_fee: null, fee_cap: null, deposit_pct: null,
    });
  });

  it('reads an empty input as "not given", never as zero', () => {
    const t = buildTerms({ pricing_model: 'retainer', amount: '30000', billing_period: 'monthly', included_hours: '', overage_rate: '' });
    expect(t.included_hours).toBeNull();
    expect(t.overage_rate).toBeNull();
    expect(validateTerms(t)).toBeNull();
  });

  it('keeps a typed zero, so the rules can refuse it', () => {
    expect(buildTerms({ pricing_model: 'fixed_fee', amount: '0' }).amount).toBe(0);
  });

  it('trims text terms and treats blank text as missing', () => {
    const t = buildTerms({ pricing_model: 'unit', amount: '2500', unit_label: '  report  ' });
    expect(t.unit_label).toBe('report');
    expect(buildTerms({ pricing_model: 'unit', amount: '2500', unit_label: '   ' }).unit_label).toBeNull();
  });

  it('refuses a model it does not know rather than guessing', () => {
    const t = buildTerms({ pricing_model: 'barter', amount: '5' });
    expect(t.pricing_model).toBeNull();
    expect(t.amount).toBeNull();
  });
});

describe('validateTerms — sound terms pass', () => {
  it.each([
    [{ pricing_model: 'unit', amount: '2500', unit_label: 'report' }],
    [{ pricing_model: 'hourly', amount: '5000' }],
    [{ pricing_model: 'consultant_fee', amount: '15000' }],
    [{ pricing_model: 'hourly_package', amount: '90000', included_hours: '20', billing_period: 'one_off' }],
    [{ pricing_model: 'retainer', amount: '30000', billing_period: 'quarterly', included_hours: '8', overage_rate: '4500' }],
    [{ pricing_model: 'fixed_fee', amount: '250000', deposit_pct: '40' }],
    [{ pricing_model: 'success_fee', success_pct: '5', success_basis: 'funds raised' }],
    [{ pricing_model: 'success_fee', amount: '50000' }],
    [{ pricing_model: 'success_fee', success_pct: '5', minimum_fee: '20000', fee_cap: '20000' }],
  ])('%o', (form) => {
    expect(validateTerms(buildTerms(form))).toBeNull();
  });
});

describe('describeTerms', () => {
  it.each([
    [{ pricing_model: 'unit', amount: 2500, unit_label: 'report' },            'KES 2,500 per report', []],
    [{ pricing_model: 'unit', amount: 2500 },                                  'KES 2,500 per unit', []],
    [{ pricing_model: 'hourly', amount: 5000 },                                'KES 5,000 per hour', []],
    [{ pricing_model: 'consultant_fee', amount: 15000 },                       'KES 15,000 flat fee', []],
    [{ pricing_model: 'hourly_package', amount: 45000, included_hours: 10, billing_period: 'monthly', overage_rate: 5000 },
      'KES 45,000 for 10 hours per month', ['≈ KES 4,500 per hour', 'Extra hours KES 5,000 per hour']],
    [{ pricing_model: 'hourly_package', amount: 9000, included_hours: 1, billing_period: 'one_off', overage_rate: 0 },
      'KES 9,000 for 1 hour', ['≈ KES 9,000 per hour', 'Extra hours not charged']],
    [{ pricing_model: 'retainer', amount: 30000, billing_period: 'monthly', included_hours: 8 },
      'KES 30,000 per month', ['Covers 8 hours per month']],
    [{ pricing_model: 'retainer', amount: 100000, billing_period: 'annually' }, 'KES 100,000 per year', []],
    [{ pricing_model: 'fixed_fee', amount: 250000, deposit_pct: 40 },          'KES 250,000 project fee', ['Deposit 40% (KES 100,000)']],
    [{ pricing_model: 'success_fee', success_pct: 5, success_basis: 'tax recovered', minimum_fee: 10000, fee_cap: 250000 },
      '5% of tax recovered', ['Minimum KES 10,000', 'Capped at KES 250,000']],
    [{ pricing_model: 'success_fee', success_pct: 2.5, amount: 50000 },       '2.5% of the result + KES 50,000 bonus', []],
    [{ pricing_model: 'success_fee', amount: 50000 },                          'KES 50,000 on success', []],
    [{ pricing_model: null },                                                  'No price set', []],
  ])('%o → %s', (terms, headline, details) => {
    expect(describeTerms(terms)).toEqual({ headline, details });
  });

  it('describes a database row, where numbers arrive as strings', () => {
    expect(describeTerms({ pricing_model: 'hourly', amount: '5000.00' }).headline).toBe('KES 5,000 per hour');
  });
});

describe('termsDiffer', () => {
  const list = { pricing_model: 'hourly', amount: '5000.00', billing_period: null };

  it('sees the same terms however they are written', () => {
    expect(termsDiffer(list, { pricing_model: 'hourly', amount: 5000 })).toBe(false);
    // A term the model does not use cannot make two options differ.
    expect(termsDiffer(list, { pricing_model: 'hourly', amount: '5000', billing_period: 'monthly' })).toBe(false);
  });

  it('sees a negotiated rate, a changed model, and a term added or removed', () => {
    expect(termsDiffer(list, { pricing_model: 'hourly', amount: 4500 })).toBe(true);
    expect(termsDiffer(list, { pricing_model: 'consultant_fee', amount: 5000 })).toBe(true);
    const retainer = { pricing_model: 'retainer', amount: 30000, billing_period: 'monthly' };
    expect(termsDiffer(retainer, { ...retainer, included_hours: 8 })).toBe(true);
    expect(termsDiffer({ ...retainer, included_hours: 8 }, retainer)).toBe(true);
  });
});

describe('forms', () => {
  it('starts recurring models monthly and everything else blank', () => {
    expect(blankTermsForm('retainer').billing_period).toBe('monthly');
    expect(blankTermsForm('hourly_package').billing_period).toBe('monthly');
    expect(blankTermsForm('hourly').billing_period).toBe('');
    expect(blankTermsForm('hourly').amount).toBe('');
  });

  it('round-trips a stored row through the form unchanged', () => {
    const row = {
      pricing_model: 'success_fee', amount: null, success_pct: '5.000', success_basis: 'funds raised',
      minimum_fee: '20000.00', fee_cap: null, deposit_pct: null,
    };
    const form = termsToForm(row);
    expect(form.success_pct).toBe('5.000');
    expect(form.amount).toBe('');
    expect(termsDiffer(buildTerms(form), row)).toBe(false);
  });
});

describe('isCurrentEngagement', () => {
  it('counts proposed, active and on-hold work as current, and closed work as not', () => {
    expect(['proposed', 'active', 'on_hold'].every(isCurrentEngagement)).toBe(true);
    expect(['completed', 'cancelled', 'nonsense'].some(isCurrentEngagement)).toBe(false);
  });
});
