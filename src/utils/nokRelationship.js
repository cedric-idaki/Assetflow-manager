// The next-of-kin relationship vocabulary the clients table will actually accept.
//
// `clients.nok_relationship` carries a CHECK constraint, clients_nok_relationship_check,
// that permits only the codes below. The other half of this list lives in
// supabase/migrations/20260822120000_widen_client_nok_relationship.sql and the two have
// to move together: offering a code here that the constraint does not know turns into a
// raw Postgres error at insert time. That is exactly how the sales agent portal used to
// fail — it posted whatever an agent typed into a free-text box, so "Wife", or even
// "Spouse" with a capital S, was rejected and the client was never created. Both client
// forms now build their picker from this list, and everything written to the column goes
// through normalizeNokRelationship.

export const NOK_RELATIONSHIPS = [
  { code: 'parent',       label: 'Parent'         },
  { code: 'spouse',       label: 'Spouse'         },
  { code: 'sibling',      label: 'Sibling'        },
  { code: 'child',        label: 'Child'          },
  { code: 'grandparent',  label: 'Grandparent'    },
  { code: 'grandchild',   label: 'Grandchild'     },
  { code: 'aunt_uncle',   label: 'Aunt / Uncle'   },
  { code: 'niece_nephew', label: 'Niece / Nephew' },
  { code: 'cousin',       label: 'Cousin'         },
  { code: 'in_law',       label: 'In-law'         },
  { code: 'guardian',     label: 'Guardian'       },
  { code: 'friend',       label: 'Friend'         },
  { code: 'other',        label: 'Other'          },
];

export const isNokRelationship = (code) => NOK_RELATIONSHIPS.some(r => r.code === code);

export const nokRelationshipLabel = (code) =>
  NOK_RELATIONSHIPS.find(r => r.code === code)?.label || (code ? 'Other' : '');

// Free text reaching us from somewhere else — a converted lead's KYC answers, an
// imported row — has to be folded into the vocabulary before it can be stored. The
// synonyms below map what a person actually wrote onto the code they meant; anything
// unrecognised becomes 'other' rather than an insert that fails. Empty stays empty:
// the column is nullable and a CHECK constraint passes on NULL. This table mirrors the
// backfill CASE in the migration, so a lead converted today and a row healed by that
// migration land on the same code.
const SYNONYMS = {
  father: 'parent', mother: 'parent', mum: 'parent', mom: 'parent', dad: 'parent',
  husband: 'spouse', wife: 'spouse', partner: 'spouse',
  brother: 'sibling', sister: 'sibling',
  son: 'child', daughter: 'child',
  grandfather: 'grandparent', grandmother: 'grandparent',
  grandpa: 'grandparent', grandma: 'grandparent',
  grandson: 'grandchild', granddaughter: 'grandchild',
  aunt: 'aunt_uncle', auntie: 'aunt_uncle', uncle: 'aunt_uncle',
  niece: 'niece_nephew', nephew: 'niece_nephew',
  'father-in-law': 'in_law', 'mother-in-law': 'in_law',
  'brother-in-law': 'in_law', 'sister-in-law': 'in_law',
  'son-in-law': 'in_law', 'daughter-in-law': 'in_law',
};

export const normalizeNokRelationship = (value) => {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return null;
  if (isNokRelationship(v)) return v;
  return SYNONYMS[v] || 'other';
};
