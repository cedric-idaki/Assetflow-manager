/**
 * The consultancy pricing rules live twice:
 *
 *   src/config/consultancyPricing.js                        — what the form checks
 *   supabase/migrations/20260925160000_consultancy_services.sql
 *                                                           — what the database enforces
 *
 * Postgres cannot import the bundle, so the copy is unavoidable, and drift is
 * silent in a specific way: add a pricing model here alone and every save of
 * it is refused by a CHECK constraint the form never warned about; loosen a
 * rule in the SQL alone and the form goes on blocking terms the server would
 * take. So this test reads the migration as text and asserts the two still say
 * the same thing — the lists, the columns each model keeps, and every message.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  PRICING_MODELS,
  BILLING_PERIODS,
  ENGAGEMENT_STATUSES,
  TERM_FIELDS,
  TERM_FIELD_MODELS,
  buildTerms,
  validateTerms,
} from './consultancyPricing';

const SQL = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260925160000_consultancy_services.sql'),
  'utf8',
);

/** The body of one SQL function, from its CREATE to the closing $$. */
const functionBody = (name) => {
  const start = SQL.indexOf(`create or replace function public.${name}(`);
  if (start === -1) throw new Error(`Function not found: ${name}`);
  const open = SQL.indexOf('$$', start);
  const close = SQL.indexOf('$$', open + 2);
  return SQL.slice(open + 2, close);
};

/** Every single-quoted identifier inside the parenthesised list after `marker`. */
const literalsAfter = (source, marker) => {
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`Marker not found: ${marker}`);
  const open = source.indexOf('(', start + marker.length - 1);
  const close = source.indexOf(')', open);
  return [...source.slice(open, close).matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
};

const sorted = (xs) => [...xs].sort();

const MODELS = PRICING_MODELS.map(m => m.value);

describe('consultancy pricing — the lists', () => {
  it('offers the same pricing models the database accepts, on both tables', () => {
    expect(sorted(literalsAfter(SQL, 'consultancy_cost_structures_model_chk check (pricing_model in ('))).toEqual(sorted(MODELS));
    expect(sorted(literalsAfter(SQL, 'consultancy_engagements_model_chk check (pricing_model in ('))).toEqual(sorted(MODELS));
    expect(sorted(literalsAfter(functionBody('consultancy_terms_problem'), 'p_model not in ('))).toEqual(sorted(MODELS));
  });

  it('covers all seven ways a consultancy prices its work', () => {
    expect(MODELS).toEqual([
      'unit', 'hourly', 'consultant_fee', 'hourly_package', 'retainer', 'fixed_fee', 'success_fee',
    ]);
  });

  it('offers the same billing periods the database accepts', () => {
    const periods = BILLING_PERIODS.map(p => p.value);
    expect(sorted(literalsAfter(SQL, 'consultancy_cost_structures_period_chk check (billing_period is null or billing_period in ('))).toEqual(sorted(periods));
    expect(sorted(literalsAfter(SQL, 'consultancy_engagements_period_chk check (billing_period is null or billing_period in ('))).toEqual(sorted(periods));
  });

  it('offers the same engagement statuses the database accepts', () => {
    expect(sorted(literalsAfter(SQL, 'consultancy_engagements_status_chk check (status in ('))).toEqual(
      sorted(ENGAGEMENT_STATUSES.map(s => s.value)),
    );
  });
});

describe('consultancy pricing — which terms each model keeps', () => {
  // consultancy_terms_normalise() is a run of
  //   if new.pricing_model <> 'x' then new.a := null; ... end if;
  //   if new.pricing_model not in ('x', 'y') then new.b := null; ... end if;
  // so every cleared column maps to the models allowed to keep it.
  const keptBySql = () => {
    const body = functionBody('consultancy_terms_normalise');
    const kept = {};
    const block = /if new\.pricing_model (?:<> '([a-z_]+)'|not in \(([^)]*)\)) then([\s\S]*?)end if;/g;
    for (const m of body.matchAll(block)) {
      const models = m[1] ? [m[1]] : [...m[2].matchAll(/'([a-z_]+)'/g)].map(x => x[1]);
      for (const f of m[3].matchAll(/new\.([a-z_]+)\s*:=\s*null/g)) kept[f[1]] = sorted(models);
    }
    return kept;
  };

  it('clears exactly the columns a model does not use', () => {
    const kept = keptBySql();
    TERM_FIELDS.filter(f => f !== 'amount').forEach((field) => {
      expect({ field, models: kept[field] }).toEqual({ field, models: sorted(TERM_FIELD_MODELS[field]) });
    });
  });

  it('never clears amount, because every model uses it', () => {
    expect(keptBySql().amount).toBeUndefined();
    expect(sorted(TERM_FIELD_MODELS.amount)).toEqual(sorted(MODELS));
  });

  it('saves every term column through save_consultancy_service, on update and on insert', () => {
    const body = functionBody('save_consultancy_service');
    TERM_FIELDS.forEach((field) => {
      const reads = body.split(`v_row->>'${field}'`).length - 1;
      expect({ field, reads }).toEqual({ field, reads: 2 });
    });
  });

  it('declares every term column on both tables', () => {
    const table = (name) => {
      const start = SQL.indexOf(`create table if not exists public.${name} (`);
      return SQL.slice(start, SQL.indexOf('\n);', start));
    };
    ['consultancy_cost_structures', 'consultancy_engagements'].forEach((name) => {
      TERM_FIELDS.forEach((field) => {
        expect({ name, field, declared: new RegExp(`\\n\\s+${field}\\s`).test(table(name)) })
          .toEqual({ name, field, declared: true });
      });
    });
  });
});

describe('consultancy pricing — the rules, message for message', () => {
  // One case per rule. Each input goes through buildTerms first, as the form
  // does, so terms a model does not use are dropped before validation — the
  // same order the database trigger works in.
  const CASES = [
    [{ pricing_model: '' },                                                         'Choose how this option is priced.'],
    [{ pricing_model: 'hourly', amount: '-5' },                                     'Amounts cannot be negative.'],
    [{ pricing_model: 'unit', amount: '0' },                                        'Enter the price per unit.'],
    [{ pricing_model: 'hourly' },                                                   'Enter the rate per hour.'],
    [{ pricing_model: 'consultant_fee', amount: '' },                               'Enter the consultant fee.'],
    [{ pricing_model: 'hourly_package', included_hours: '10', billing_period: 'monthly' }, 'Enter the package price.'],
    [{ pricing_model: 'retainer', billing_period: 'monthly' },                      'Enter the retainer fee.'],
    [{ pricing_model: 'fixed_fee' },                                                'Enter the project fee.'],
    [{ pricing_model: 'hourly_package', amount: '90000', billing_period: 'monthly' }, 'Enter how many hours the package includes.'],
    [{ pricing_model: 'hourly_package', amount: '90000', included_hours: '20' },   'Choose how often the package is billed.'],
    [{ pricing_model: 'retainer', amount: '30000', billing_period: 'one_off' },    'A retainer recurs — choose weekly, monthly, quarterly or annually.'],
    [{ pricing_model: 'retainer', amount: '30000', billing_period: 'monthly', included_hours: '0' }, 'Hours covered by the retainer must be more than zero.'],
    [{ pricing_model: 'fixed_fee', amount: '100000', deposit_pct: '120' },          'A deposit must be more than 0 and at most 100 percent.'],
    [{ pricing_model: 'success_fee', success_pct: '150' },                         'A success percentage must be more than 0 and at most 100.'],
    [{ pricing_model: 'success_fee' },                                              'Enter a success percentage, a fixed success bonus, or both.'],
    [{ pricing_model: 'success_fee', success_pct: '5', minimum_fee: '50000', fee_cap: '10000' }, 'The fee cap cannot be lower than the minimum fee.'],
  ];

  it.each(CASES)('%o → %s', (form, message) => {
    expect(validateTerms(buildTerms(form))).toBe(message);
  });

  it('uses exactly the messages the database raises', () => {
    const body = functionBody('consultancy_terms_problem');
    // Walk the literals in order, so each opening quote pairs with its own
    // closing one; messages are the literals with a space, model names have none.
    const sqlMessages = [...body.matchAll(/'((?:[^']|'')*)'/g)]
      .map(m => m[1])
      .filter(s => /\s/.test(s));
    expect(sorted(new Set(sqlMessages))).toEqual(sorted(new Set(CASES.map(([, message]) => message))));
  });
});
