// Totals behind the Payroll tab's summary cards and its totals row.
//
// The authoritative figures come from the payroll_totals() RPC
// (20260930160000), which sums EVERY matching payslip in Postgres. The page
// only lists the newest 200, so reducing over that list is correct for a month
// of a small tenant and silently short for anything bigger. sumPayrollRecords
// is the fallback for when the RPC is unavailable (a frontend that lands before
// its migration), and the caller flags it as possibly incomplete when the list
// was capped.

export const PAYROLL_LIST_CAP = 200;

const FIELDS = [
  'records', 'employees', 'months',
  'basic', 'allowances', 'additions', 'gross', 'taxable_pay',
  'paye', 'nssf', 'shif', 'housing_levy', 'other_deductions', 'net',
];

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * One RPC row -> plain numbers. PostgREST serialises numeric as a string, so
 * without this "1000" + "2000" is "10002000".
 */
export const normalisePayrollTotals = (row) => {
  if (!row) return null;
  const out = {};
  for (const f of FIELDS) out[f] = num(row[f]);
  return out;
};

/** The same totals, reduced in the browser over the records the page holds. */
export const sumPayrollRecords = (records = []) => {
  const t = Object.fromEntries(FIELDS.map((f) => [f, 0]));
  const people = new Set();
  const months = new Set();
  for (const p of records) {
    t.records += 1;
    if (p.employee_id) people.add(p.employee_id);
    if (p.pay_month) months.add(p.pay_month);
    t.basic            += num(p.basic_salary);
    t.allowances       += num(p.housing_allowance) + num(p.transport_allowance);
    t.additions        += num(p.meal_allowance) + num(p.bonus) + num(p.gift);
    t.gross            += num(p.gross_salary);
    t.taxable_pay      += num(p.taxable_pay);
    t.paye             += num(p.paye);
    t.nssf             += num(p.nssf);
    t.shif             += num(p.shif);
    t.housing_levy     += num(p.housing_levy);
    t.other_deductions += num(p.loan_deduction) + num(p.advance_deduction);
    t.net              += num(p.net_salary);
  }
  t.employees = people.size;
  t.months = months.size;
  return t;
};

/**
 * What actually leaves the business for the statutory funds. NSSF and the
 * Affordable Housing Levy are matched shilling for shilling by the employer, so
 * the payment to each is twice what the payslips show; SHIF is withheld only.
 */
export const statutoryRemittance = (t) =>
  (num(t?.nssf) * 2) + num(t?.shif) + (num(t?.housing_levy) * 2);

/**
 * The page's payroll filters -> payroll_totals() arguments. 'all' and blanks
 * become null (no filter). adminId is passed only for a non-super viewer, the
 * same narrowing the list query applies with .eq('admin_id', ...).
 */
export const payrollTotalsArgs = ({
  adminId, isSuper, month, from, to, status, department, role, search,
} = {}) => {
  const opt = (v) => (v && v !== 'all' ? v : null);
  // Not trimmed: the list filters on the raw text, and the totals must match it.
  const q = search || '';
  return {
    p_admin_id:   isSuper ? null : (adminId || null),
    p_month:      opt(month),
    p_from:       opt(from),
    p_to:         opt(to),
    p_status:     opt(status),
    p_department: opt(department),
    p_role:       opt(role),
    p_search:     q || null,
  };
};
