import { describe, it, expect } from 'vitest';
import {
  REPORT_SOURCES, FIELD_TYPES, OPERATORS, PERIOD_PRESETS,
  sourcesFor, sourceByKey, fieldByKey, fieldPath,
  operatorsForType, aggregationsForType, canBuildReports,
  unknownModuleKeys, REPORT_BUILDER_ROLES,
} from './reportSchema';

/**
 * These are structural assertions, not behaviour. The catalogue is a contract
 * between four things that cannot see each other — the field picker, the query
 * builder, the CSV writer and the database — and a typo in it does not throw,
 * it produces a report that is quietly missing a column.
 */
describe('the catalogue holds together', () => {
  it('names only modules the module catalogue knows', () => {
    // A module key that exists only here is a source no tenant can ever be
    // shown, because isEnabled() is asked about a key nothing declares.
    expect(unknownModuleKeys()).toEqual([]);
  });

  it('has unique source keys', () => {
    const keys = REPORT_SOURCES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  REPORT_SOURCES.forEach((source) => {
    describe(source.key, () => {
      it('has unique field keys', () => {
        const keys = source.fields.map((f) => f.key);
        expect(new Set(keys).size).toBe(keys.length);
      });

      it('gives every field a known type', () => {
        source.fields.forEach((f) => {
          expect(FIELD_TYPES, `${source.key}.${f.key}`).toContain(f.type);
        });
      });

      it('gives every field somewhere to read from', () => {
        source.fields.forEach((f) => {
          const path = fieldPath(f);
          expect(path.filter(Boolean).length, `${source.key}.${f.key}`).toBe(path.length);
        });
      });

      it('defaults to columns it actually has', () => {
        source.defaultFields.forEach((key) => {
          expect(fieldByKey(source, key), `${source.key} default "${key}"`).toBeTruthy();
        });
      });

      it('names a dateField that exists on the source', () => {
        if (!source.dateField) return;
        const field = fieldByKey(source, source.dateField)
          || source.fields.find((f) => f.column === source.dateField);
        // Without this, the reporting period silently applies to nothing and
        // "this month" quietly returns the whole table.
        expect(field, `${source.key}.dateField`).toBeTruthy();
        expect(['date', 'datetime', 'month']).toContain(field.type);
      });

      it('declares how its rows are scoped to one tenant', () => {
        expect(['column', 'rls']).toContain(source.tenant?.mode);
        if (source.tenant.mode === 'column') expect(source.tenant.column).toBeTruthy();
      });

      it('offers at least one role', () => {
        expect(source.roles.length).toBeGreaterThan(0);
      });

      it('never offers a joined column as filterable or sortable', () => {
        // Filtering or ordering on an embed makes PostgREST inner-join it,
        // which drops every row whose parent is gone.
        source.fields.filter((f) => f.join).forEach((f) => {
          expect(f.filterable, `${source.key}.${f.key}`).toBe(false);
          expect(f.sortable, `${source.key}.${f.key}`).toBe(false);
        });
      });

      it('gives every enum field its options', () => {
        source.fields.filter((f) => f.type === 'enum').forEach((f) => {
          expect(f.options?.length, `${source.key}.${f.key}`).toBeGreaterThan(0);
          f.options.forEach((o) => {
            expect(typeof o.value).toBe('string');
            expect(typeof o.label).toBe('string');
          });
        });
      });

      it('has an operator available for every filterable field', () => {
        source.fields.filter((f) => !f.join && f.filterable !== false).forEach((f) => {
          expect(operatorsForType(f.type).length, `${source.key}.${f.key}`).toBeGreaterThan(0);
        });
      });
    });
  });
});

describe('what the catalogue keeps out', () => {
  it('exposes no encrypted employee PII', () => {
    // These live in employee_private_data under PII_ENC_KEY and are read one
    // deliberate call at a time. A column in this catalogue is a column any
    // staff report can dump to CSV, so the two must never meet.
    const sealed = ['nssf_number', 'bank_account', 'bank_account_number', 'bank_name',
                    'next_of_kin_id', 'national_id', 'id_number'];
    const offending = [];
    REPORT_SOURCES.forEach((s) => {
      s.fields.forEach((f) => {
        if (sealed.includes(f.column) || sealed.includes(f.join?.column)) {
          offending.push(`${s.key}.${f.key}`);
        }
      });
    });
    expect(offending).toEqual([]);
  });

  it('offers nothing at all to a client, a member or an agent', () => {
    ['client', 'sacco_member', 'sales_agent', 'sales'].forEach((role) => {
      expect(sourcesFor({ role }), role).toEqual([]);
      expect(canBuildReports(role), role).toBe(false);
    });
  });

  it('never puts the payroll book in front of a sales or collections role', () => {
    const payrollRoles = sourceByKey('payroll_records').roles;
    ['collections_officer', 'operations', 'manager', 'sales_agent'].forEach((role) => {
      expect(payrollRoles, role).not.toContain(role);
    });
  });

  it('lets an admin see everything the catalogue holds', () => {
    expect(sourcesFor({ role: 'admin' }).length).toBe(REPORT_SOURCES.length);
  });
});

describe('gating', () => {
  it('hides a source whose module the tenant has frozen', () => {
    const isModuleEnabled = (key) => key !== 'payroll';
    const keys = sourcesFor({ role: 'admin', isModuleEnabled }).map((s) => s.key);
    expect(keys).not.toContain('payroll_records');
    expect(keys).toContain('employees');
  });

  it('needs both gates, not either', () => {
    // HR is enabled, but a collections officer is still not offered staff pay.
    const keys = sourcesFor({ role: 'collections_officer', isModuleEnabled: () => true }).map((s) => s.key);
    expect(keys).not.toContain('employees');
    expect(keys).toContain('payments');
  });

  it('lists only roles that exist elsewhere in the app', () => {
    const REAL_ROLES = [
      'super_admin', 'admin', 'sacco_admin', 'director', 'manager', 'finance',
      'accountant', 'collections_officer', 'collections', 'operations', 'hr',
    ];
    REPORT_BUILDER_ROLES.forEach((r) => expect(REAL_ROLES, r).toContain(r));
  });
});

describe('vocabularies', () => {
  it('takes lead sources and lost reasons from the shared CRM vocabulary', () => {
    // Two lists would mean two spellings of one thing, and a report that
    // under-counts both halves. See src/config/crmVocabulary.js.
    const leads = sourceByKey('leads');
    expect(fieldByKey(leads, 'source').options.map((o) => o.value))
      .toEqual(['referral', 'website', 'social_media', 'walk_in', 'cold_call']);
    expect(fieldByKey(leads, 'lost_reason').options.map((o) => o.value))
      .toContain('financing');
  });

  it('offers only loggable channels on the contact log', () => {
    const values = fieldByKey(sourceByKey('crm_interactions'), 'interaction_type')
      .options.map((o) => o.value);
    // 'follow_up' is schedulable but not loggable — you cannot have already had
    // a "check-in on some channel".
    expect(values).not.toContain('follow_up');
    expect(values).toContain('whatsapp');
  });

  it('offers only schedulable channels on follow-ups', () => {
    const values = fieldByKey(sourceByKey('follow_ups'), 'appointment_type')
      .options.map((o) => o.value);
    expect(values).not.toContain('note');   // you cannot book a note
    expect(values).toContain('follow_up');
  });
});

describe('operators and aggregations', () => {
  it('gives every field type something to filter with', () => {
    FIELD_TYPES.forEach((type) => {
      expect(operatorsForType(type).length, type).toBeGreaterThan(0);
    });
  });

  it('offers count on anything and sums only on numbers', () => {
    expect(aggregationsForType('text').map((a) => a.value)).toEqual(['count']);
    expect(aggregationsForType('money').map((a) => a.value)).toEqual(['count', 'sum', 'avg', 'min', 'max']);
  });

  it('declares an arity for every operator', () => {
    OPERATORS.forEach((op) => {
      expect([0, 1, 2, 'list'], op.value).toContain(op.arity);
    });
  });

  it('keeps a custom range in the preset list, since the UI branches on it', () => {
    expect(PERIOD_PRESETS.map((p) => p.value)).toContain('custom');
  });
});
