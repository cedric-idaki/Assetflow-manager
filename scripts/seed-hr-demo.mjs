// HR DEMO DATA — employees and three months of payroll for ONE live tenant.
//
//   node scripts/seed-hr-demo.mjs
//
// writes scripts/seed-hr-demo.sql and scripts/seed-hr-demo-teardown.sql, to be
// run in the Supabase SQL editor (or `supabase db query --linked -f`). This
// machine has no service-role key, so data that has to bypass RLS goes in as
// SQL run by the database owner — same as scripts/seed-demo-data.mjs.
//
// Narrower than seed-demo-data on purpose: that script builds a whole company
// (ledger, POS, CRM, ...) for a tenant that has nothing. This one drops a staff
// list and its payroll next to a tenant's EXISTING employees, to show the
// Payroll tab's totals, and touches nothing else:
//
//   * payroll rows go in as 'paid' / 'pending', never 'approved'. The
//     journal_payroll_trigger posts to the ledger only on an UPDATE to
//     'approved', so the tenant's books are untouched. (Approving one of these
//     in the app WILL post it — the teardown does not reverse journal entries.)
//   * the figures come from the SAME engine the app uses
//     (src/utils/kenyaPayroll.js), so what the tab recomputes, the payslip and
//     the P10 return all agree with what is stored.
//   * every id is a deterministic uuid v5, so the seed is idempotent and the
//     teardown deletes by explicit id, never by pattern.
//   * emails are demo.hr.*@example.com — a reserved domain that can never
//     receive mail — and no login identity is created, so none can sign in.

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computePayroll, payrollRecordFrom } from '../src/utils/kenyaPayroll.js';

const here = dirname(fileURLToPath(import.meta.url));

// The tenant, pinned by its owner's email. The SQL re-checks that this is an
// admin account and aborts otherwise, so a changed or mistyped address fails
// loudly instead of seeding the wrong business.
const TENANT_EMAIL = 'sbcdevwork5812@gmail.com';
const MONTHS = ['2026-07', '2026-08', '2026-09'];
// September is the month in progress: its run is still awaiting sign-off.
const statusFor = (m) => (m === '2026-09' ? 'pending' : 'paid');

const NAMESPACE = 'ararat-hr-demo-v1';
const uid = (label) => {
  const h = createHash('sha1').update(`${NAMESPACE}|${label}`).digest('hex');
  const v = h.slice(0, 32).split('');
  v[12] = '5';
  v[16] = '89ab'[parseInt(h[16], 16) % 4];
  const s = v.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
};

const round2 = (n) => Math.round((parseFloat(n) || 0) * 100) / 100;
const q = (v) => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(round2(v));
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return `'${String(v).replace(/'/g, "''")}'`;
};
const row = (...vals) => `    (${vals.map(q).join(', ')})`;

// A spread of pay that exercises every band: one earner below the PAYE
// threshold (PAYE 0 after relief), several in the 25-30% bands, two in the top
// bands, one paying off a staff loan, one with pension + insurance relief.
// Departments and roles are values the HR page already offers.
const STAFF = [
  { k: 'wanjiku', name: 'Wanjiku Kariuki',  role: 'manager',     dept: 'Management',     basic: 250000, house: 40000, transport: 20000, pension: 15000, insurance: 5000, gender: 'female', dob: '1982-02-11', type: 'full_time', joined: '2021-01-04' },
  { k: 'odhiambo', name: 'Kevin Odhiambo',  role: 'finance',     dept: 'Finance',        basic: 165000, house: 25000, transport: 15000, pension: 10000, insurance: 3000, gender: 'male',   dob: '1987-07-23', type: 'full_time', joined: '2021-06-14' },
  { k: 'achieng',  name: 'Faith Achieng',   role: 'accountant',  dept: 'Finance',        basic:  98000, house: 15000, transport: 10000, pension: 5000,  insurance: 0,    gender: 'female', dob: '1992-10-05', type: 'full_time', joined: '2022-03-01' },
  { k: 'mwangi',   name: 'Daniel Mwangi',   role: 'sales_agent', dept: 'Sales',          basic:  72000, house: 10000, transport: 12000, pension: 0,     insurance: 0,    gender: 'male',   dob: '1990-04-18', type: 'full_time', joined: '2022-08-15', bonus: 0.15 },
  { k: 'njeri',    name: 'Ruth Njeri',      role: 'sales_agent', dept: 'Sales',          basic:  65000, house: 10000, transport: 12000, pension: 0,     insurance: 0,    gender: 'female', dob: '1994-12-02', type: 'full_time', joined: '2023-02-06', bonus: 0.15 },
  { k: 'kiprono',  name: 'Brian Kiprono',   role: 'operations',  dept: 'Operations',     basic:  58000, house:  8000, transport:  8000, pension: 0,     insurance: 2000, gender: 'male',   dob: '1991-08-29', type: 'full_time', joined: '2022-11-21', loan: 5000 },
  { k: 'atieno',   name: 'Mary Atieno',     role: 'staff',       dept: 'HR',             basic:  75000, house: 10000, transport:  8000, pension: 3000,  insurance: 0,    gender: 'female', dob: '1989-03-14', type: 'full_time', joined: '2021-09-01' },
  { k: 'omondi',   name: 'Collins Omondi',  role: 'staff',       dept: 'IT',             basic: 110000, house: 15000, transport: 10000, pension: 6000,  insurance: 2500, gender: 'male',   dob: '1993-05-09', type: 'full_time', joined: '2023-05-02' },
  { k: 'wambui',   name: 'Grace Wambui',    role: 'staff',       dept: 'Administration', basic:  42000, house:  5000, transport:  5000, pension: 0,     insurance: 0,    gender: 'female', dob: '1996-01-27', type: 'full_time', joined: '2024-01-08' },
  { k: 'mutua',    name: 'James Mutua',     role: 'staff',       dept: 'Operations',     basic:  22000, house:  2000, transport:  2000, pension: 0,     insurance: 0,    gender: 'male',   dob: '1998-06-30', type: 'contract',  joined: '2025-02-03' },
];
STAFF.forEach((s, i) => {
  s.id    = uid(`staff:${s.k}`);
  s.email = `demo.hr.${s.k}@example.com`;
  s.phone = `+2547100000${String(10 + i).padStart(2, '0')}`;
  s.nid   = String(30000000 + i * 1111111).slice(0, 8);
  s.pin   = `A0${String(90000000 + i * 1234567).slice(0, 8)}${'ABCDEFGHJK'[i]}`;
  s.sha   = `SHA${String(700000000 + i * 3571).padStart(9, '0')}`;
});

const PAYROLL = [];
const totals = {};
for (const m of MONTHS) {
  const t = { staff: 0, gross: 0, paye: 0, nssf: 0, shif: 0, ahl: 0, net: 0 };
  for (const s of STAFF) {
    // Sales commission-style bonus in August, so one month differs.
    const bonus = s.bonus && m === '2026-08' ? Math.round(s.basic * s.bonus) : 0;
    const result = computePayroll({
      payMonth: m,
      basic: s.basic,
      housingAllowance: s.house,
      transportAllowance: s.transport,
      bonus,
      pension: s.pension,
      insurancePremiums: s.insurance,
      loanDeduction: s.loan || 0,
    });
    const rec = payrollRecordFrom(result);
    PAYROLL.push({
      id: uid(`payroll:${s.k}:${m}`),
      employee_id: s.id,
      pay_month: m,
      basic_salary: s.basic,
      housing_allowance: s.house,
      transport_allowance: s.transport,
      meal_allowance: 0,
      bonus,
      gift: 0,
      loan_deduction: s.loan || 0,
      advance_deduction: 0,
      ...rec,
      status: statusFor(m),
    });
    t.staff += 1;
    t.gross += rec.gross_salary;
    t.paye  += rec.paye;
    t.nssf  += rec.nssf;
    t.shif  += rec.shif;
    t.ahl   += rec.housing_levy || 0;
    t.net   += rec.net_salary;
  }
  Object.keys(t).forEach((k) => { t[k] = round2(t[k]); });
  totals[m] = t;
}

const fmt = (n) => n.toLocaleString('en-KE', { maximumFractionDigits: 2 });
const expected = MONTHS.map((m) => {
  const t = totals[m];
  return `--   ${m}: ${t.staff} staff  gross ${fmt(t.gross)}  PAYE ${fmt(t.paye)}  NSSF ${fmt(t.nssf)}  SHIF ${fmt(t.shif)}  AHL ${fmt(t.ahl)}  net ${fmt(t.net)}`;
});

const staffIds = `array[${STAFF.map((s) => `'${s.id}'`).join(', ')}]::uuid[]`;
const payrollIds = `array[${PAYROLL.map((p) => `'${p.id}'`).join(', ')}]::uuid[]`;

const PAY_COLS = [
  'id', 'employee_id', 'pay_month', 'basic_salary', 'housing_allowance', 'transport_allowance',
  'meal_allowance', 'bonus', 'gift', 'loan_deduction', 'advance_deduction',
  'gross_salary', 'taxable_pay', 'paye', 'nssf', 'shif', 'housing_levy',
  'personal_relief', 'insurance_relief', 'pension_contribution', 'non_cash_benefits',
  'total_deductions', 'net_salary', 'rate_version', 'status',
];

const seed = [
  '-- ═══════════════════════════════════════════════════════════════════════════',
  '-- HR DEMO DATA — employees + payroll for one tenant',
  '--',
  '-- Generated by scripts/seed-hr-demo.mjs. Do not edit by hand — regenerate.',
  '-- Undo with scripts/seed-hr-demo-teardown.sql.',
  '--',
  `-- Tenant: the admin account ${TENANT_EMAIL}. Aborts if that is not an admin.`,
  `-- ${STAFF.length} employees (demo.hr.*@example.com, cannot sign in) and`,
  `-- ${PAYROLL.length} payroll records for ${MONTHS.join(', ')}. The tenant's own`,
  '-- employees and ledger are not touched.',
  '--',
  '-- Expected totals for these employees alone, per month:',
  ...expected,
  '--',
  '-- Idempotent: re-running changes nothing.',
  '-- ═══════════════════════════════════════════════════════════════════════════',
  'begin;',
  '',
  'create temp table _hr_demo_ctx on commit drop as',
  "  select up.id as admin_id from public.user_profiles up",
  `   where lower(up.email) = lower(${q(TENANT_EMAIL)}) and up.role = 'admin';`,
  'do $$',
  'begin',
  '  if (select count(*) from _hr_demo_ctx) <> 1 then',
  `    raise exception 'HR demo seed: expected exactly one admin account for ${TENANT_EMAIL}';`,
  '  end if;',
  'end $$;',
  '',
  '-- user_profiles.id references auth.users, so each employee needs an auth row.',
  '-- No identity row and an unusable password: these are payroll records, not',
  '-- logins — the same stance the HR page takes when it adds an employee.',
  'insert into auth.users (',
  '  instance_id, id, aud, role, email, encrypted_password,',
  '  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)',
  'select',
  "  '00000000-0000-0000-0000-000000000000'::uuid, v.id::uuid, 'authenticated', 'authenticated',",
  "  v.email, '', now(), now(), now(),",
  '  \'{"provider":"email","providers":["email"]}\'::jsonb,',
  "  jsonb_build_object('full_name', v.full_name)",
  'from (values',
  STAFF.map((s) => row(s.id, s.email, s.name)).join(',\n'),
  ') as v(id, email, full_name)',
  'on conflict do nothing;',
  '',
  '-- GoTrue reads these token columns as NOT NULL text; square away any nulls.',
  'do $$',
  'declare col text;',
  'begin',
  '  foreach col in array array[',
  "    'confirmation_token','recovery_token','email_change_token_new','email_change',",
  "    'email_change_token_current','phone_change','phone_change_token','reauthentication_token']",
  '  loop',
  '    if exists (select 1 from information_schema.columns',
  "                where table_schema = 'auth' and table_name = 'users' and column_name = col) then",
  "      execute format('update auth.users set %I = coalesce(%I, %L) where id = any($1)', col, col, '')",
  `        using ${staffIds};`,
  '    end if;',
  '  end loop;',
  'end $$;',
  '',
  '-- handle_new_user normally writes the bare profile; do it explicitly too so',
  '-- the seed does not depend on that trigger.',
  'insert into public.user_profiles (id, email, full_name, role)',
  "select v.id::uuid, v.email, v.full_name, 'staff'::public.user_role",
  'from (values',
  STAFF.map((s) => row(s.id, s.email, s.name)).join(',\n'),
  ') as v(id, email, full_name)',
  'on conflict (id) do nothing;',
  '',
  '-- Tenant, role and the pay the payroll engine reads. admin_id and role are',
  '-- trigger-guarded, which lets this through because the SQL editor has no JWT.',
  'update public.user_profiles p set',
  '  admin_id = c.admin_id, full_name = v.full_name, role = v.role::public.user_role,',
  '  department = v.dept, phone = v.phone, gender = v.gender, date_of_birth = v.dob::date,',
  '  is_active = true, employment_type = v.emp_type, date_joined = v.joined::date,',
  '  basic_salary = v.basic, housing_allowance = v.house, transport_allowance = v.transport,',
  '  pension_contribution = v.pension, insurance_premiums = v.insurance,',
  '  national_id = v.nid, kra_pin = v.pin, sha_number = v.sha',
  'from _hr_demo_ctx c, (values',
  STAFF.map((s) => row(
    s.id, s.name, s.role, s.dept, s.phone, s.gender, s.dob, s.type, s.joined,
    s.basic, s.house, s.transport, s.pension, s.insurance, s.nid, s.pin, s.sha,
  )).join(',\n'),
  ') as v(id, full_name, role, dept, phone, gender, dob, emp_type, joined, basic, house, transport, pension, insurance, nid, pin, sha)',
  'where p.id = v.id::uuid;',
  '',
  `insert into public.payroll_records (admin_id, ${PAY_COLS.join(', ')})`,
  `select c.admin_id, ${PAY_COLS.map((k) => `v.${k}${k === 'id' || k === 'employee_id' ? '::uuid' : ''}`).join(', ')}`,
  'from _hr_demo_ctx c, (values',
  PAYROLL.map((p) => row(...PAY_COLS.map((k) => p[k]))).join(',\n'),
  `) as v(${PAY_COLS.join(', ')})`,
  'on conflict do nothing;',
  '',
  '-- What went in, for the log.',
  "select 'employees' as what, count(*) as n from public.user_profiles where id = any(" + staffIds + ')',
  "union all select 'payroll_records', count(*) from public.payroll_records where id = any(" + payrollIds + ');',
  '',
  'commit;',
  '',
];

const teardown = [
  '-- Undo scripts/seed-hr-demo.sql. Deletes by explicit id only.',
  '-- Generated by scripts/seed-hr-demo.mjs.',
  '--',
  '-- Does NOT reverse journal entries: if any of these payslips were approved in',
  '-- the app, the ledger postings that made stay behind and must be reversed there.',
  'begin;',
  `delete from public.payroll_records where id = any(${payrollIds});`,
  '-- Any payslip the app re-ran for these employees has a new id; catch it by employee.',
  `delete from public.payroll_records where employee_id = any(${staffIds});`,
  `delete from public.user_profiles where id = any(${staffIds});`,
  `delete from auth.users where id = any(${staffIds});`,
  'commit;',
  '',
];

writeFileSync(join(here, 'seed-hr-demo.sql'), seed.join('\n'));
writeFileSync(join(here, 'seed-hr-demo-teardown.sql'), teardown.join('\n'));
console.log(`seed-hr-demo.sql: ${STAFF.length} employees, ${PAYROLL.length} payroll records`);
console.log(expected.map((l) => l.replace(/^-- {3}/, '')).join('\n'));
