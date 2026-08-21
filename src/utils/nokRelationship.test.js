import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  NOK_RELATIONSHIPS,
  isNokRelationship,
  nokRelationshipLabel,
  normalizeNokRelationship,
} from './nokRelationship';

// The sales agent portal used to POST whatever the agent typed into a free-text
// box, and `clients_nok_relationship_check` rejected it — client creation died on
// a raw Postgres error. The guarantee these tests hold is narrow and total: for
// ANY input, normalizeNokRelationship returns either null or a code the constraint
// accepts. Nothing else may reach the column.
describe('normalizeNokRelationship', () => {
  it('only ever returns null or an allowed code', () => {
    const inputs = [
      'Spouse', 'WIFE', ' husband ', 'Mother', 'brother', 'Daughter',
      'family friend', 'ex-wife', 'n/a', '  ', '', null, undefined, 42, {},
    ];
    for (const input of inputs) {
      const out = normalizeNokRelationship(input);
      expect(out === null || isNokRelationship(out)).toBe(true);
    }
  });

  it('accepts the codes the picker emits unchanged', () => {
    for (const { code } of NOK_RELATIONSHIPS) {
      expect(normalizeNokRelationship(code)).toBe(code);
    }
  });

  it('folds the casing and synonyms an agent actually types', () => {
    expect(normalizeNokRelationship('Spouse')).toBe('spouse');
    expect(normalizeNokRelationship('Wife')).toBe('spouse');
    expect(normalizeNokRelationship(' HUSBAND ')).toBe('spouse');
    expect(normalizeNokRelationship('Mother')).toBe('parent');
    expect(normalizeNokRelationship('Sister')).toBe('sibling');
    expect(normalizeNokRelationship('Son')).toBe('child');
  });

  it('keeps the relationships the widened constraint can now store', () => {
    expect(normalizeNokRelationship('Cousin')).toBe('cousin');
    expect(normalizeNokRelationship('Guardian')).toBe('guardian');
    expect(normalizeNokRelationship('Grandmother')).toBe('grandparent');
    expect(normalizeNokRelationship('Nephew')).toBe('niece_nephew');
    expect(normalizeNokRelationship('Mother-in-law')).toBe('in_law');
  });

  it('falls back to other rather than to something unstorable', () => {
    expect(normalizeNokRelationship('business partner ltd')).toBe('other');
    expect(normalizeNokRelationship('deceased')).toBe('other');
  });

  // The column is nullable and a CHECK constraint passes on NULL, so an unanswered
  // optional field must stay empty instead of being invented as 'other'.
  it('leaves an unanswered field empty', () => {
    expect(normalizeNokRelationship('')).toBeNull();
    expect(normalizeNokRelationship('   ')).toBeNull();
    expect(normalizeNokRelationship(null)).toBeNull();
    expect(normalizeNokRelationship(undefined)).toBeNull();
  });
});

describe('nokRelationshipLabel', () => {
  it('renders a stored code for a human', () => {
    expect(nokRelationshipLabel('spouse')).toBe('Spouse');
    expect(nokRelationshipLabel('sibling')).toBe('Sibling');
  });

  it('shows nothing for an empty value and Other for a legacy one', () => {
    expect(nokRelationshipLabel('')).toBe('');
    expect(nokRelationshipLabel(null)).toBe('');
    expect(nokRelationshipLabel('Wife')).toBe('Other');
  });
});

// The bug that started all this was one list of relationships in the UI and a
// different one in the database. Widening the constraint only helps while the two
// stay identical, so read the vocabulary straight out of the migration and compare
// it to the one the pickers render. If someone adds a code to either side alone,
// this fails here instead of failing on a client's registration.
describe('the vocabulary matches the CHECK constraint', () => {
  const MIGRATION = 'supabase/migrations/20260822120000_widen_client_nok_relationship.sql';

  const codesInConstraint = () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const body = sql.split('add constraint clients_nok_relationship_check')[1];
    const list = body.slice(body.indexOf('array['), body.indexOf(']'));
    return [...list.matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
  };

  it('offers exactly the codes the database accepts, in the same order', () => {
    expect(NOK_RELATIONSHIPS.map(r => r.code)).toEqual(codesInConstraint());
  });

  it('read a vocabulary at all, rather than passing on an empty match', () => {
    expect(codesInConstraint().length).toBeGreaterThan(5);
  });
});
