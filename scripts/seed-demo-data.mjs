#!/usr/bin/env node
/**
 * DEMO DATA GENERATOR
 *
 * Emits two SQL files that fill ONE tenant with a plausible six months of
 * trading, so the company side of the system — above all the Finance Hub — can
 * be exercised against data instead of empty tables:
 *
 *   scripts/seed-demo-data.sql            put it all in
 *   scripts/seed-demo-data-teardown.sql   take it all out again
 *
 * WHY THIS IS GENERATED AND NOT HAND-WRITTEN
 *
 *   1. The payroll figures come from the SAME engine the app uses
 *      (src/utils/kenyaPayroll.js). A hand-typed PAYE number would disagree
 *      with what the Payroll tab recomputes, and the P10 return would then
 *      report one thing while the payslip said another.
 *
 *   2. journal_entries stores ONE debit/credit pair per row, so a five-leg
 *      transaction has to be decomposed into the pairs that reproduce it
 *      exactly. That is `pairJournalLines`, mirrored here from the hook.
 *
 *   3. Every row gets a DETERMINISTIC uuid (v5 over a fixed namespace), so
 *      re-running the generator produces identical SQL, re-running the SQL is a
 *      no-op, and the teardown can name every row it deletes instead of
 *      pattern-matching its way through the tenant's real data.
 *
 * THE LEDGER BALANCES, and this script proves it before writing anything: every
 * entry is paired, the trial balance nets to zero, and the bank never goes
 * negative. Any of those failing exits non-zero rather than emitting a ledger
 * the statements cannot render.
 *
 * USAGE
 *   node scripts/seed-demo-data.mjs --admin you@company.co.ke
 *   node scripts/seed-demo-data.mjs            # leaves a placeholder to edit
 */

import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { registerHooks } from 'node:module';
import { computePayroll, payrollRecordFrom } from '../src/utils/kenyaPayroll.js';

// src/ is written for Vite, which resolves `'../config/taxRegulations'` without
// the extension. Node will not, so the same rule is taught to it here — needed
// because the verification at the bottom runs the real statement and VAT
// engines over the ledger this script emits.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith('.') && !/\.[cm]?js$/.test(specifier)) {
        return next(`${specifier}.js`, context);
      }
      throw err;
    }
  },
});
const { buildIncomeStatement, buildBalanceSheet, buildTrialBalance } =
  await import('../src/utils/financialStatements.js');
const { computeVatReturn } = await import('../src/utils/vatLedger.js');

const HERE = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ADMIN_EMAIL = argOf('--admin', 'REPLACE_WITH_ADMIN_EMAIL');

// ─────────────────────────────────────────────────────────────────────────────
// DETERMINISTIC IDS
//
// uuid v5 over a fixed namespace. The label is the row's meaning ("client:3"),
// so the same label always resolves to the same id however much else in this
// file changes. That is what makes the SQL re-runnable and the teardown exact.
// ─────────────────────────────────────────────────────────────────────────────
const NAMESPACE = 'ararat-demo-seed-v1';
const uid = (label) => {
  const h = createHash('sha1').update(`${NAMESPACE}|${label}`).digest('hex');
  const v = h.slice(0, 32).split('');
  v[12] = '5';                                   // version 5
  v[16] = '89ab'[parseInt(h[16], 16) % 4];       // RFC 4122 variant
  const s = v.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// SQL HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const round2 = (n) => Math.round((parseFloat(n) || 0) * 100) / 100;
const q = (v) => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(round2(v));
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return `'${String(v).replace(/'/g, "''")}'`;
};
const row = (...vals) => `    (${vals.map(q).join(', ')})`;

/** Mirrors pairJournalLines in src/hooks/useFinanceHub.js — see the header. */
const pairJournalLines = (lines) => {
  const debits  = lines.filter(l => round2(l.debit)  > 0).map(l => ({ account: l.account, left: round2(l.debit)  }));
  const credits = lines.filter(l => round2(l.credit) > 0).map(l => ({ account: l.account, left: round2(l.credit) }));
  const pairs = [];
  let i = 0, j = 0;
  while (i < debits.length && j < credits.length) {
    const amount = round2(Math.min(debits[i].left, credits[j].left));
    if (amount <= 0) break;
    pairs.push({ debit_account: debits[i].account, credit_account: credits[j].account, amount });
    debits[i].left  = round2(debits[i].left  - amount);
    credits[j].left = round2(credits[j].left - amount);
    if (debits[i].left  <= 0) i += 1;
    if (credits[j].left <= 0) j += 1;
  }
  return pairs;
};

const VAT = 0.16;
const vatOn = (net) => round2(net * VAT);

// ─────────────────────────────────────────────────────────────────────────────
// CHART OF ACCOUNTS
//
// The codes follow the bands src/config/transactionRecipes.js suggests, so the
// "Record a transaction" tab finds a real account for every role it asks about
// and never has to offer to create one mid-entry.
// ─────────────────────────────────────────────────────────────────────────────
const COA = [
  ['1000', 'Cash at Bank',              'current_asset',     'Cash'],
  ['1010', 'M-Pesa Till',               'current_asset',     'Cash'],
  ['1020', 'Petty Cash',                'current_asset',     'Cash'],
  ['1100', 'Trade Receivables',         'current_asset',     'Receivables'],
  ['1110', 'Hire Purchase Receivables', 'current_asset',     'Receivables'],
  ['1200', 'Inventory',                 'current_asset',     'Inventory'],
  ['1300', 'Input VAT',                 'current_asset',     'Other'],
  ['1500', 'Equipment',                 'non_current_asset', 'Fixed Assets'],
  ['1510', 'Motor Vehicles',            'non_current_asset', 'Fixed Assets'],
  ['1520', 'Furniture and Fittings',    'non_current_asset', 'Fixed Assets'],
  ['1590', 'Accumulated Depreciation',  'non_current_asset', 'Depreciation'],
  ['2000', 'Trade Payables',            'current_liability', 'Payables'],
  ['2100', 'VAT Payable',               'current_liability', 'Statutory'],
  ['2110', 'PAYE Payable',              'current_liability', 'Statutory'],
  ['2120', 'NSSF Payable',              'current_liability', 'Statutory'],
  ['2130', 'SHIF Payable',              'current_liability', 'Statutory'],
  ['2140', 'Housing Levy Payable',      'current_liability', 'Statutory'],
  ['2150', 'Pension Payable',           'current_liability', 'Statutory'],
  ['2200', 'Net Salaries Payable',      'current_liability', 'Payables'],
  ['2300', 'Customer Deposits',         'current_liability', 'Deposits'],
  ['2500', 'Bank Loan',                 'current_liability', 'Other'],
  ['3000', 'Owner Capital',             'equity',            'Capital'],
  ['3100', 'Owner Drawings',            'equity',            'Capital'],
  ['3200', 'Retained Earnings',         'equity',            'Earnings'],
  ['4000', 'Sales Revenue',             'revenue',           'Sales'],
  ['4010', 'Interest Income',           'revenue',           'Finance Income'],
  ['4020', 'Penalty Income',            'revenue',           'Finance Income'],
  ['4030', 'Commission Income',         'revenue',           'Commission'],
  ['5000', 'Cost of Goods Sold',        'cost_of_sales',     'COGS'],
  ['6000', 'General Expenses',          'operating_expense', 'Admin'],
  ['6010', 'Rent',                      'operating_expense', 'Overhead'],
  ['6020', 'Utilities',                 'operating_expense', 'Overhead'],
  ['6030', 'Salaries and Wages',        'operating_expense', 'Personnel'],
  ['6040', 'Marketing and Advertising', 'operating_expense', 'Marketing'],
  ['6050', 'Transport and Fuel',        'operating_expense', 'Overhead'],
  ['6060', 'Professional Fees',         'operating_expense', 'Admin'],
  ['6070', 'Insurance',                 'operating_expense', 'Overhead'],
  ['6080', 'Depreciation',              'operating_expense', 'Overhead'],
  ['6900', 'Interest Expense',          'operating_expense', 'Overhead'],
  ['6910', 'Bank Charges',              'operating_expense', 'Admin'],
];
/** `"1000 — Cash at Bank"` — the spelling the hub's own composers write. */
const A = Object.fromEntries(COA.map(([code, name]) => [code, `${code} — ${name}`]));
const TYPE_OF = Object.fromEntries(COA.map(([code, , type]) => [code, type]));
const CODE_OF = Object.fromEntries(COA.map(([code, name]) => [`${code} — ${name}`, code]));

// ─────────────────────────────────────────────────────────────────────────────
// PEOPLE
//
// Emails are all @example.com — reserved by RFC 2606 and incapable of receiving
// mail, so nothing here can reach a real inbox if a payslip or an invoice is
// sent while testing. Phone numbers are placeholders in the same spirit.
// ─────────────────────────────────────────────────────────────────────────────
const STAFF = [
  { k: 'grace',  name: 'Grace Wanjiru',  role: 'finance',     dept: 'Finance',     basic: 180000, house: 30000, transport: 15000, pension: 12000, insurance: 4500,  gender: 'female', dob: '1989-04-17' },
  { k: 'brian',  name: 'Brian Otieno',   role: 'manager',     dept: 'Sales',       basic: 140000, house: 25000, transport: 15000, pension: 9000,  insurance: 3000,  gender: 'male',   dob: '1986-11-02' },
  { k: 'amina',  name: 'Amina Hassan',   role: 'finance',     dept: 'Finance',     basic:  95000, house: 15000, transport: 10000, pension: 6000,  insurance: 0,     gender: 'female', dob: '1993-06-25' },
  { k: 'peter',  name: 'Peter Kamau',    role: 'operations',  dept: 'Operations',  basic:  70000, house: 10000, transport:  8000, pension: 0,     insurance: 2000,  gender: 'male',   dob: '1991-01-30' },
  { k: 'mercy',  name: 'Mercy Chebet',   role: 'collections', dept: 'Collections', basic:  60000, house:  8000, transport:  8000, pension: 0,     insurance: 0,     gender: 'female', dob: '1995-09-14' },
  { k: 'samuel', name: 'Samuel Njoroge', role: 'operations',  dept: 'Logistics',   basic:  38000, house:  5000, transport:  6000, pension: 0,     insurance: 0,     gender: 'male',   dob: '1990-03-08' },
];
STAFF.forEach((s, i) => {
  s.id    = uid(`staff:${s.k}`);
  s.email = `demo.${s.k}@example.com`;
  s.phone = `+2547000000${String(11 + i).padStart(2, '0')}`;
});

const AGENTS = [
  { k: 'a1', code: 'DEMO-AGT-01', name: 'Caroline Njeri',  region: 'Nairobi',  rate: 5.0,  target: 6000000 },
  { k: 'a2', code: 'DEMO-AGT-02', name: 'Dennis Mutiso',   region: 'Mombasa',  rate: 4.5,  target: 4500000 },
  { k: 'a3', code: 'DEMO-AGT-03', name: 'Faith Chepkoech', region: 'Eldoret',  rate: 5.5,  target: 3000000 },
];
AGENTS.forEach((a, i) => {
  a.id    = uid(`agent:${a.k}`);
  a.email = `demo.agent${i + 1}@example.com`;
  a.phone = `+2547000000${String(21 + i).padStart(2, '0')}`;
});

const CLIENT_NAMES = [
  ['Joseph Mwangi',        'Nairobi',  'active',    'A012345678X'],
  ['Lilian Achieng',       'Kisumu',   'active',    'A023456789Y'],
  ['Ibrahim Noor',         'Garissa',  'active',    'A034567890Z'],
  ['Rose Wambui',          'Nakuru',   'active',    'A045678901P'],
  ['Kevin Ochieng',        'Kisumu',   'active',    'A056789012Q'],
  ['Njeri Holdings Ltd',   'Nairobi',  'active',    'P051234567R'],
  ['Daniel Kiprop',        'Eldoret',  'active',    'A067890123S'],
  ['Halima Yusuf',         'Mombasa',  'pending',   'A078901234T'],
  ['Sarah Muthoni',        'Thika',    'active',    'A089012345U'],
  ['Coastal Cargo Ltd',    'Mombasa',  'active',    'P052345678V'],
  ['Patrick Omondi',       'Nairobi',  'suspended', 'A090123456W'],
  ['Zipporah Chelimo',     'Kericho',  'active',    'A101234567A'],
  ['Victor Barasa',        'Kakamega', 'inactive',  'A112345678B'],
  ['Green Valley Farms',   'Nyeri',    'active',    'P053456789C'],
];
const CLIENTS = CLIENT_NAMES.map(([name, city, status, pin], i) => ({
  id:      uid(`client:${i}`),
  seq:     i + 1,
  name,
  city,
  status,
  pin,
  account: `DEMO-AF-2026-${String(i + 1).padStart(4, '0')}`,
  email:   `demo.client${i + 1}@example.com`,
  phone:   `+2547000001${String(i + 1).padStart(2, '0')}`,
  nid:     `DEMO${String(30000000 + i * 7919)}`,
  agent:   AGENTS[i % AGENTS.length].id,
  type:    name.includes('Ltd') || name.includes('Farms') ? 'account' : (i % 5 === 0 ? 'cash' : 'account'),
}));

const ASSET_ROWS = [
  ['vehicle',   'Toyota Hilux Double Cab 2019',   'Toyota',   'Hilux',      2019, 'KDA 112A', 2850000, 3450000],
  ['vehicle',   'Isuzu FRR Cargo Truck 2017',     'Isuzu',    'FRR',        2017, 'KCX 884B', 4100000, 4980000],
  ['vehicle',   'Toyota Probox 2016',             'Toyota',   'Probox',     2016, 'KCB 447C', 720000,  920000],
  ['vehicle',   'Nissan NV350 Shuttle 2018',      'Nissan',   'NV350',      2018, 'KDD 209D', 1650000, 2050000],
  ['vehicle',   'Toyota Fielder 2015',            'Toyota',   'Fielder',    2015, 'KCP 731E', 830000,  1080000],
  ['equipment', 'Caterpillar 428F Backhoe Loader','Caterpillar','428F',     2016, null,       6200000, 7450000],
  ['equipment', 'Kirloskar 62.5 kVA Generator',   'Kirloskar','62.5 kVA',   2021, null,       980000,  1280000],
  ['equipment', 'Bomag BW120 Road Roller',        'Bomag',    'BW120',      2018, null,       3400000, 4150000],
  ['equipment', 'Grain Dryer 10T Batch Unit',     'Alvan',    'AB-10',      2022, null,       1450000, 1880000],
  ['equipment', 'Solar Irrigation Pump Set 5HP',  'Grundfos', 'SQF-5',      2023, null,       385000,  520000],
  ['property',  'Ruiru Godown 1,200 sq ft',       null,       null,         null, null,       5800000, 7200000],
  ['property',  'Athi River Yard 0.25 acre',      null,       null,         null, null,       4200000, 5400000],
  ['other',     'Office Container Unit 40ft',     null,       null,         2020, null,       620000,  840000],
  ['other',     'Cold Room Panel Set 20 sq m',    null,       null,         2021, null,       910000,  1180000],
];
const ASSETS = ASSET_ROWS.map(([type, desc, make, model, year, plate, cost, price], i) => ({
  id:    uid(`asset:${i}`),
  code:  `DEMO-AST-${String(i + 1).padStart(3, '0')}`,
  type, desc, make, model, year, plate, cost, price,
}));

// ─────────────────────────────────────────────────────────────────────────────
// PAYROLL
//
// Run through the real engine, month by month, so every stored figure is the
// one the Payroll tab, the payslip and the P10 return will recompute.
// ─────────────────────────────────────────────────────────────────────────────
const MONTHS = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
/** The books run up to, and stop at, this date. */
const TODAY = '2026-09-12';
const LAST_MONTH = MONTHS[MONTHS.length - 1];
const TODAY_DAY = parseInt(TODAY.slice(8), 10);
const PAYROLL = [];
const payrollTotals = {};                        // pay_month -> the ledger's figures

for (const m of MONTHS) {
  const totals = { gross: 0, paye: 0, nssf: 0, shif: 0, housing: 0, pension: 0, net: 0 };
  for (const s of STAFF) {
    const result = computePayroll({
      payMonth:           m,
      basic:              s.basic,
      housingAllowance:   s.house,
      transportAllowance: s.transport,
      pension:            s.pension,
      insurancePremiums:  s.insurance,
      // A modest bonus in July keeps one month from being a copy of the others.
      bonus:              m === '2026-07' ? Math.round(s.basic * 0.1) : 0,
    });
    const rec = payrollRecordFrom(result);
    PAYROLL.push({
      id:          uid(`payroll:${s.k}:${m}`),
      employee_id: s.id,
      pay_month:   m,
      basic_salary:        s.basic,
      housing_allowance:   s.house,
      transport_allowance: s.transport,
      meal_allowance:      0,
      bonus:               m === '2026-07' ? Math.round(s.basic * 0.1) : 0,
      gift:                0,
      loan_deduction:      0,
      advance_deduction:   0,
      ...rec,
      // September is the month in progress, so its run is still awaiting sign-off.
      status: m === '2026-09' ? 'pending' : 'approved',
    });
    totals.gross   += rec.gross_salary;
    totals.paye    += rec.paye;
    totals.nssf    += rec.nssf;
    totals.shif    += rec.shif;
    totals.housing += rec.housing_levy;
    // The employee's own pension contribution leaves net pay too, so the
    // payroll entry has to credit it somewhere or the entry will not balance.
    totals.pension += rec.pension_contribution;
    totals.net     += rec.net_salary;
  }
  Object.keys(totals).forEach(k => { totals[k] = round2(totals[k]); });
  payrollTotals[m] = totals;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE LEDGER
//
// Each `tx` is one transaction in however many legs it really has; the pairing
// into journal_entries rows happens once, at the end.
// ─────────────────────────────────────────────────────────────────────────────
const TX = [];
let txSeq = 0;
const tx = (date, description, lines, opts = {}) => {
  txSeq += 1;
  const debit  = round2(lines.reduce((s, l) => s + (l.debit  || 0), 0));
  const credit = round2(lines.reduce((s, l) => s + (l.credit || 0), 0));
  if (Math.abs(debit - credit) > 0.011) {
    throw new Error(`Unbalanced entry "${description}" on ${date}: debits ${debit} vs credits ${credit}`);
  }
  TX.push({
    entry_no:  `DEMO-JE-${date.replace(/-/g, '')}-${String(txSeq).padStart(3, '0')}`,
    date, description, lines,
    entry_type: opts.type      || 'general',
    reference:  opts.reference || null,
    trigger:    opts.trigger   || null,
    automated:  !!opts.trigger,
  });
};

// ── Month-by-month trading figures, all net of VAT ───────────────────────────
const BOOKS = {
  '2026-04': { cashSales: 1850000, creditSales: 1200000, cogs: 1620000, restock: 1400000, supplierPay: 1000000, debtorRx:  650000, rent: 180000, utilities: 46500, fuel: 62000, marketing: 120000, profFees:  85000, bankCharges: 4500, interestIncome: 145000, penalty:     0, commission:     0, drawings:      0 },
  '2026-05': { cashSales: 2100000, creditSales: 1450000, cogs: 1880000, restock: 1650000, supplierPay: 1500000, debtorRx:  980000, rent: 180000, utilities: 51200, fuel: 68500, marketing: 145000, profFees:      0, bankCharges: 5200, interestIncome: 168000, penalty: 18500, commission:     0, drawings:      0 },
  '2026-06': { cashSales: 1760000, creditSales: 1320000, cogs: 1540000, restock: 1300000, supplierPay: 1800000, debtorRx: 1120000, rent: 180000, utilities: 43800, fuel: 57300, marketing:  95000, profFees:      0, bankCharges: 4800, interestIncome: 152000, penalty: 12000, commission: 75000, drawings: 200000 },
  '2026-07': { cashSales: 2480000, creditSales: 1610000, cogs: 2150000, restock: 1900000, supplierPay: 1700000, debtorRx: 1340000, rent: 180000, utilities: 55600, fuel: 74200, marketing: 168000, profFees: 110000, bankCharges: 6100, interestIncome: 191000, penalty: 24500, commission:     0, drawings:      0 },
  '2026-08': { cashSales: 2250000, creditSales: 1480000, cogs: 1960000, restock: 1750000, supplierPay: 2000000, debtorRx: 1260000, rent: 198000, utilities: 49400, fuel: 69800, marketing: 132000, profFees:      0, bankCharges: 5400, interestIncome: 176000, penalty: 15800, commission: 96000, drawings: 250000 },
  // September is a part month: today is the 12th, so nothing is dated past it.
  '2026-09': { cashSales:  980000, creditSales:  720000, cogs:  845000, restock:  800000, supplierPay:  900000, debtorRx:  540000, rent: 198000, utilities: 24700, fuel: 31500, marketing:  58000, profFees:      0, bankCharges: 2700, interestIncome:  82000, penalty:  6500, commission:     0, drawings:      0 },
};

// ── Opening position: capital, borrowing, the fixed assets, opening stock ────
tx('2026-04-01', 'Owner capital introduced at start of trading', [
  { account: A['1000'], debit: 5000000 },
  { account: A['3000'], credit: 5000000 },
], { type: 'opening', reference: 'DEMO-CAP-001' });

tx('2026-04-01', 'Asset finance facility drawn down — Equity Bank', [
  { account: A['1000'], debit: 3000000 },
  { account: A['2500'], credit: 3000000 },
], { type: 'financing', reference: 'DEMO-LOAN-001' });

tx('2026-04-02', 'Workshop equipment purchased', [
  { account: A['1500'], debit: 850000 },
  { account: A['1300'], debit: vatOn(850000) },
  { account: A['1000'], credit: round2(850000 + vatOn(850000)) },
], { type: 'purchase', reference: 'DEMO-PO-0001' });

tx('2026-04-02', 'Delivery vehicle purchased', [
  { account: A['1510'], debit: 2400000 },
  { account: A['1300'], debit: vatOn(2400000) },
  { account: A['1000'], credit: round2(2400000 + vatOn(2400000)) },
], { type: 'purchase', reference: 'DEMO-PO-0002' });

tx('2026-04-03', 'Office furniture and fittings', [
  { account: A['1520'], debit: 320000 },
  { account: A['1300'], debit: vatOn(320000) },
  { account: A['1000'], credit: round2(320000 + vatOn(320000)) },
], { type: 'purchase', reference: 'DEMO-PO-0003' });

tx('2026-04-03', 'Opening stock purchased on credit — Mombasa Traders Ltd', [
  { account: A['1200'], debit: 1800000 },
  { account: A['1300'], debit: vatOn(1800000) },
  { account: A['2000'], credit: round2(1800000 + vatOn(1800000)) },
], { type: 'purchase', reference: 'DEMO-PO-0004' });

tx('2026-04-05', 'Annual insurance premium — fleet and premises', [
  { account: A['6070'], debit: 240000 },
  { account: A['1000'], credit: 240000 },
], { type: 'expense', reference: 'DEMO-INS-001' });

// Depreciation: equipment over 5 years, vehicles over 8, furniture over 5.
const DEPRECIATION = round2(850000 / 60 + 2400000 / 96 + 320000 / 60);

// ── The monthly cycle ────────────────────────────────────────────────────────
let loanBalance = 3000000;
const LOAN_PRINCIPAL = 62500;                    // 3,000,000 over 48 months
const LOAN_RATE = 0.14;

MONTHS.forEach((m, i) => {
  const b = BOOKS[m];
  // September is the month in progress. Nothing may be dated after today, or
  // the P&L for "this month" would report trade that has not happened yet and
  // the cash flow would run ahead of the bank. Days past the 12th are pulled
  // back onto it, which is what a part-month close looks like anyway.
  const d = (day) => `${m}-${String(m === LAST_MONTH ? Math.min(day, TODAY_DAY) : day).padStart(2, '0')}`;
  const prev = MONTHS[i - 1] || null;

  // Cash and M-Pesa takings, split roughly 60/40 between the bank and the till.
  const cashBank  = round2(b.cashSales * 0.6);
  const cashTill  = round2(b.cashSales - cashBank);
  tx(d(28), `Cash and M-Pesa takings for ${m}`, [
    { account: A['1000'], debit: round2(cashBank + vatOn(cashBank)) },
    { account: A['1010'], debit: round2(cashTill + vatOn(cashTill)) },
    { account: A['4000'], credit: b.cashSales },
    { account: A['2100'], credit: vatOn(b.cashSales) },
  ], { type: 'sale', trigger: 'cash_sale_completed', reference: `DEMO-SALES-${m}` });

  tx(d(28), `Credit sales invoiced in ${m}`, [
    { account: A['1100'], debit: round2(b.creditSales + vatOn(b.creditSales)) },
    { account: A['4000'], credit: b.creditSales },
    { account: A['2100'], credit: vatOn(b.creditSales) },
  ], { type: 'sale', trigger: 'cash_sale_completed', reference: `DEMO-CRSALES-${m}` });

  tx(d(28), `Cost of goods sold — ${m}`, [
    { account: A['5000'], debit: b.cogs },
    { account: A['1200'], credit: b.cogs },
  ], { type: 'cogs', trigger: 'cogs_on_sale', reference: `DEMO-COGS-${m}` });

  tx(d(8), `Stock replenished on credit — ${m}`, [
    { account: A['1200'], debit: b.restock },
    { account: A['1300'], debit: vatOn(b.restock) },
    { account: A['2000'], credit: round2(b.restock + vatOn(b.restock)) },
  ], { type: 'purchase', reference: `DEMO-PO-${m}` });

  tx(d(11), `Suppliers paid — ${m}`, [
    { account: A['2000'], debit: b.supplierPay },
    { account: A['1000'], credit: b.supplierPay },
  ], { type: 'payment', reference: `DEMO-SUPPAY-${m}` });

  tx(d(12), `Receipts from trade debtors — ${m}`, [
    { account: A['1000'], debit: b.debtorRx },
    { account: A['1100'], credit: b.debtorRx },
  ], { type: 'receipt', trigger: 'payment_received', reference: `DEMO-DEBRX-${m}` });

  tx(d(5), `Office and yard rent — ${m}`, [
    { account: A['6010'], debit: b.rent },
    { account: A['1300'], debit: vatOn(b.rent) },
    { account: A['1000'], credit: round2(b.rent + vatOn(b.rent)) },
  ], { type: 'expense', reference: `DEMO-RENT-${m}` });

  tx(d(9), `Electricity, water and internet — ${m}`, [
    { account: A['6020'], debit: b.utilities },
    { account: A['1300'], debit: vatOn(b.utilities) },
    { account: A['1010'], credit: round2(b.utilities + vatOn(b.utilities)) },
  ], { type: 'expense', reference: `DEMO-UTIL-${m}` });

  tx(d(10), `Fuel, tolls and deliveries — ${m}`, [
    { account: A['6050'], debit: b.fuel },
    { account: A['1010'], credit: b.fuel },
  ], { type: 'expense', reference: `DEMO-FUEL-${m}` });

  tx(d(7), `Marketing and advertising — ${m}`, [
    { account: A['6040'], debit: b.marketing },
    { account: A['1300'], debit: vatOn(b.marketing) },
    { account: A['1000'], credit: round2(b.marketing + vatOn(b.marketing)) },
  ], { type: 'expense', reference: `DEMO-MKT-${m}` });

  if (b.profFees > 0) {
    tx(d(6), `Audit and legal fees — ${m}`, [
      { account: A['6060'], debit: b.profFees },
      { account: A['1300'], debit: vatOn(b.profFees) },
      { account: A['1000'], credit: round2(b.profFees + vatOn(b.profFees)) },
    ], { type: 'expense', reference: `DEMO-PROF-${m}` });
  }

  tx(d(2), `Bank charges and transaction fees — ${m}`, [
    { account: A['6910'], debit: b.bankCharges },
    { account: A['1000'], credit: b.bankCharges },
  ], { type: 'expense', reference: `DEMO-BANKCHG-${m}` });

  // ── Payroll: the charge, the net paid, the statutory balances left behind ──
  //
  // The month in progress is skipped. Salaries are run on the 26th and today is
  // the 12th, so September's run has not happened — which is exactly why its
  // payroll_records are left 'pending' rather than 'approved'. Posting it
  // anyway would charge a full month of salary against twelve days of trade and
  // show the current month at a loss for no reason other than the calendar.
  const p = payrollTotals[m];
  const payrollRun = m !== LAST_MONTH;
  if (payrollRun) {
    tx(d(26), `Payroll charged for ${m}`, [
      { account: A['6030'], debit: p.gross },
      { account: A['2110'], credit: p.paye },
      { account: A['2120'], credit: p.nssf },
      { account: A['2130'], credit: p.shif },
      { account: A['2140'], credit: p.housing },
      { account: A['2150'], credit: p.pension },
      { account: A['2200'], credit: p.net },
    ], { type: 'payroll', trigger: 'payroll_processed', reference: `DEMO-PAY-${m}` });

    tx(d(26), `Net salaries paid for ${m}`, [
      { account: A['2200'], debit: p.net },
      { account: A['1000'], credit: p.net },
    ], { type: 'payroll', reference: `DEMO-PAYNET-${m}` });
  }

  // Statutory deductions fall due on the 9th of the FOLLOWING month.
  if (prev) {
    const pp = payrollTotals[prev];
    tx(d(9), `PAYE, NSSF, SHIF, Housing Levy and pension remitted for ${prev}`, [
      { account: A['2110'], debit: pp.paye },
      { account: A['2120'], debit: pp.nssf },
      { account: A['2130'], debit: pp.shif },
      { account: A['2140'], debit: pp.housing },
      { account: A['2150'], debit: pp.pension },
      { account: A['1000'], credit: round2(pp.paye + pp.nssf + pp.shif + pp.housing + pp.pension) },
    ], { type: 'statutory', trigger: 'paye_payable', reference: `DEMO-STAT-${prev}` });
  }

  // ── Finance income and the loan ──────────────────────────────────────────
  tx(d(28), `Hire purchase interest earned — ${m}`, [
    { account: A['1110'], debit: b.interestIncome },
    { account: A['4010'], credit: b.interestIncome },
  ], { type: 'finance', trigger: 'interest_income_recognised', reference: `DEMO-INT-${m}` });

  if (b.penalty > 0) {
    tx(d(29), `Late payment penalties charged — ${m}`, [
      { account: A['1000'], debit: b.penalty },
      { account: A['4020'], credit: b.penalty },
    ], { type: 'finance', trigger: 'late_payment_penalty', reference: `DEMO-PEN-${m}` });
  }

  if (b.commission > 0) {
    tx(d(20), `Broker commission received — ${m}`, [
      { account: A['1000'], debit: b.commission },
      { account: A['4030'], credit: b.commission },
    ], { type: 'finance', trigger: 'commission_earned', reference: `DEMO-COMM-${m}` });
  }

  const loanInterest = round2(loanBalance * LOAN_RATE / 12);
  tx(d(15), `Asset finance instalment — ${m}`, [
    { account: A['2500'], debit: LOAN_PRINCIPAL },
    { account: A['6900'], debit: loanInterest },
    { account: A['1000'], credit: round2(LOAN_PRINCIPAL + loanInterest) },
  ], { type: 'financing', reference: `DEMO-LOANPAY-${m}` });
  loanBalance = round2(loanBalance - LOAN_PRINCIPAL);

  tx(d(30), `Depreciation charge — ${m}`, [
    { account: A['6080'], debit: DEPRECIATION },
    { account: A['1590'], credit: DEPRECIATION },
  ], { type: 'adjustment', reference: `DEMO-DEP-${m}` });

  // ── Till sweep ───────────────────────────────────────────────────────────
  // The M-Pesa till takes about 40% of the day's trade and pays out only the
  // utility bills and the fuel. Left alone it would hold most of the month's
  // takings, which no business does and which starves the bank account the
  // suppliers, the payroll and the loan are all paid from. So it is banked,
  // less a float kept behind for the following month's small payments.
  const tillIn  = round2(cashTill + vatOn(cashTill));
  const tillOut = round2(b.utilities + vatOn(b.utilities) + b.fuel);
  const sweep   = round2((tillIn - tillOut) * 0.85);
  if (sweep > 0) {
    tx(d(27), `M-Pesa till banked — ${m}`, [
      { account: A['1000'], debit: sweep },
      { account: A['1010'], credit: sweep },
    ], { type: 'transfer', reference: `DEMO-SWEEP-${m}` });
  }

  if (b.drawings > 0) {
    tx(d(18), `Owner drawings — ${m}`, [
      { account: A['3100'], debit: b.drawings },
      { account: A['1000'], credit: b.drawings },
    ], { type: 'equity', reference: `DEMO-DRAW-${m}` });
  }

  // ── NO VAT SETTLEMENT ENTRY, DELIBERATELY ────────────────────────────────
  //
  // The VAT tab computes a return for ONE MONTH by summing the movement on the
  // VAT accounts during it (src/utils/vatLedger.js). A settlement posted on the
  // 20th of month N clears month N-1's balances, so it lands inside month N's
  // window and is subtracted from month N's output VAT — enough to drive the
  // figure negative, which reads as a broken screen rather than a filed return.
  // Dating the clearing entry at the end of the period it settles is no better:
  // it then nets that period's own return to zero.
  //
  // Any clearing entry distorts one month or the other, so this tenant simply
  // has not filed yet. VAT Payable and Input VAT accumulate across the six
  // months, which is a real position for a young business, leaves a genuine
  // liability on the balance sheet for the statutory reminders to chase, and
  // makes every month's VAT return read exactly what it should: 16% of that
  // month's sales against 16% of that month's vatable purchases.
});

// ─────────────────────────────────────────────────────────────────────────────
// PROVE THE BOOKS BEFORE WRITING THEM
// ─────────────────────────────────────────────────────────────────────────────
const JOURNAL = [];
for (const t of TX) {
  const pairs = pairJournalLines(t.lines);
  const legDebit = round2(t.lines.reduce((s, l) => s + (l.debit || 0), 0));
  const paired   = round2(pairs.reduce((s, p) => s + p.amount, 0));
  if (Math.abs(legDebit - paired) > 0.011) {
    throw new Error(`Pairing lost value on "${t.description}": ${legDebit} in, ${paired} out`);
  }
  pairs.forEach((p, n) => {
    JOURNAL.push({
      id:          uid(`je:${t.entry_no}:${n}`),
      entry_no:    t.entry_no,
      entry_date:  t.date,
      description: t.description,
      debit_account:  p.debit_account,
      credit_account: p.credit_account,
      amount:      p.amount,
      entry_type:  t.entry_type,
      reference:   t.reference,
      status:      'posted',
      is_automated: t.automated,
      trigger_event: t.trigger,
      period_month: t.date.slice(0, 7),
    });
  });
}

// Trial balance, by account, across the whole seeded ledger.
const balances = {};
for (const j of JOURNAL) {
  balances[j.debit_account]  = round2((balances[j.debit_account]  || 0) + j.amount);
  balances[j.credit_account] = round2((balances[j.credit_account] || 0) - j.amount);
}
const tbNet = round2(Object.values(balances).reduce((s, v) => s + v, 0));
if (Math.abs(tbNet) > 0.011) throw new Error(`Trial balance does not net to zero: ${tbNet}`);

// The bank account must never be overdrawn — a demo ledger with negative cash
// makes the cash flow statement read as nonsense.
const sorted = [...JOURNAL].sort((a, b) => a.entry_date.localeCompare(b.entry_date));
let bank = 0, lowest = { v: Infinity, on: null };
for (const j of sorted) {
  if (j.debit_account  === A['1000']) bank = round2(bank + j.amount);
  if (j.credit_account === A['1000']) bank = round2(bank - j.amount);
  if (bank < lowest.v) lowest = { v: bank, on: j.entry_date };
}
if (lowest.v < 0) {
  throw new Error(`Cash at Bank goes negative (${lowest.v.toLocaleString()}) on ${lowest.on}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMERCE: sales, the instalment book, payments, statement lines
// ─────────────────────────────────────────────────────────────────────────────
const SALE_PLANS = [
  { ai: 0,  ci: 0,  model: 'installment', deposit: 690000,  tenure: 24, rate: 14, date: '2026-04-14' },
  { ai: 2,  ci: 1,  model: 'cash',        deposit: 0,       tenure: 0,  rate: 0,  date: '2026-04-22' },
  { ai: 6,  ci: 3,  model: 'installment', deposit: 256000,  tenure: 18, rate: 15, date: '2026-05-06' },
  { ai: 4,  ci: 4,  model: 'cash',        deposit: 0,       tenure: 0,  rate: 0,  date: '2026-05-19' },
  { ai: 1,  ci: 5,  model: 'installment', deposit: 996000,  tenure: 36, rate: 13, date: '2026-06-03' },
  { ai: 9,  ci: 8,  model: 'cash',        deposit: 0,       tenure: 0,  rate: 0,  date: '2026-06-17' },
  { ai: 7,  ci: 9,  model: 'installment', deposit: 830000,  tenure: 30, rate: 14, date: '2026-07-08' },
  { ai: 3,  ci: 11, model: 'installment', deposit: 410000,  tenure: 24, rate: 15, date: '2026-07-24' },
  { ai: 12, ci: 6,  model: 'cash',        deposit: 0,       tenure: 0,  rate: 0,  date: '2026-08-11' },
  { ai: 8,  ci: 13, model: 'installment', deposit: 376000,  tenure: 24, rate: 14, date: '2026-08-26' },
  { ai: 13, ci: 2,  model: 'cash',        deposit: 0,       tenure: 0,  rate: 0,  date: '2026-09-04' },
  { ai: 5,  ci: 5,  model: 'installment', deposit: 1490000, tenure: 36, rate: 13, date: '2026-09-09' },
];

/** The level instalment for an amortising plan — same formula as usePOS. */
const monthlyInstallmentFor = (financed, annualRate, months) => {
  const r = (parseFloat(annualRate) || 0) / 100 / 12;
  if (months <= 0) return 0;
  if (r === 0) return round2(financed / months);
  return round2((financed * r) / (1 - Math.pow(1 + r, -months)));
};

const addMonths = (iso, n) => {
  const [y, mo, dd] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1 + n, dd));
  return dt.toISOString().slice(0, 10);
};

const SALES = [];
const SCHEDULES = [];
const PAYMENTS = [];

SALE_PLANS.forEach((p, i) => {
  const asset  = ASSETS[p.ai];
  const client = CLIENTS[p.ci];
  const agent  = AGENTS[i % AGENTS.length];
  const price  = asset.price;
  const vat    = vatOn(price);
  const total  = round2(price + vat);
  const financed = p.model === 'cash' ? 0 : round2(total - p.deposit);
  const saleId = uid(`sale:${i}`);
  const invoiceNo = `DEMO-INV-2026-${String(1001 + i)}`;
  const receiptNo = `DEMO-RCP-2026-${String(1001 + i)}`;

  SALES.push({
    id: saleId, invoice_number: invoiceNo, receipt_number: receiptNo,
    client_id: client.id, asset_id: asset.id, agent_id: agent.id,
    pricing_model: p.model, selling_price: price, vat_amount: vat, vat_percent: 16,
    total_amount: total, deposit_amount: p.deposit, finance_balance: financed,
    interest_rate: p.rate, tenure_months: p.tenure,
    payment_start_date: p.tenure ? addMonths(p.date, 1) : null,
    payment_method: i % 3 === 0 ? 'mpesa' : i % 3 === 1 ? 'bank_transfer' : 'cash',
    sale_date: p.date, status: 'active',
    buyer_kra_pin: client.pin,
    customer_type: client.type,
    notes: 'Demo seed data — safe to delete.',
  });

  // The deposit (or the full price on a cash sale) is a payment in its own right.
  const depositAmount = p.model === 'cash' ? total : p.deposit;
  const method = i % 3 === 0 ? 'mpesa' : i % 3 === 1 ? 'bank_transfer' : 'cash';
  PAYMENTS.push({
    id: uid(`payment:deposit:${i}`),
    transaction_id: invoiceNo,
    client_id: client.id, asset_id: asset.id, agent_id: agent.id,
    amount: depositAmount, payment_method: method, payment_status: 'completed',
    reference_number: receiptNo, payment_date: `${p.date}T09:${String(10 + i).padStart(2, '0')}:00Z`,
    notes: p.model === 'cash' ? 'Demo seed — cash sale settled in full' : 'Demo seed — hire purchase deposit',
    bank_confirmed: method === 'bank_transfer',
  });

  if (p.model === 'cash' || p.tenure === 0) return;

  // ── The amortised schedule, and the instalments already collected ────────
  const instalment = monthlyInstallmentFor(financed, p.rate, p.tenure);
  let opening = financed;
  for (let n = 1; n <= p.tenure; n += 1) {
    const due = addMonths(addMonths(p.date, 1), n - 1);
    const interest = round2(opening * (p.rate / 100 / 12));
    const principal = round2(Math.min(instalment - interest, opening));
    const closing = round2(Math.max(opening - principal, 0));
    const isPast = due <= TODAY;
    // Not every hire purchase book is current, because a collections queue with
    // nothing in it tests nothing. Coastal Cargo has never paid an instalment;
    // Joseph Mwangi paid three and then stopped; Rose Wambui is short on her
    // latest. Everything else that has fallen due is settled.
    let status = 'pending';
    if (isPast) {
      if (p.ci === 9) status = 'overdue';
      else if (p.ci === 0) status = n <= 3 ? 'paid' : 'overdue';
      else if (p.ci === 3 && due > '2026-08-31') status = 'partial';
      else status = 'paid';
    }
    SCHEDULES.push({
      id: uid(`sched:${i}:${n}`),
      sale_id: saleId, client_id: client.id, asset_id: asset.id,
      installment_no: n, due_date: due,
      opening_balance: opening, installment_amount: instalment,
      principal_portion: principal, interest_portion: interest,
      penalty: status === 'overdue' ? 1500 : 0,
      closing_balance: closing,
      amount_paid: status === 'paid' ? instalment
        : status === 'partial' ? round2(instalment * 0.4)
        : 0,
      status,
    });
    if (status === 'paid' || status === 'partial') {
      PAYMENTS.push({
        id: uid(`payment:sched:${i}:${n}`),
        transaction_id: `DEMO-RCP-${String(2000 + i * 40 + n)}`,
        client_id: client.id, asset_id: asset.id, agent_id: agent.id,
        amount: status === 'partial' ? round2(instalment * 0.4) : instalment,
        payment_method: n % 2 === 0 ? 'mpesa' : 'bank_transfer',
        payment_status: 'completed',
        reference_number: `DEMO-REF-${String(2000 + i * 40 + n)}`,
        payment_date: `${due}T11:${String((n * 7) % 60).padStart(2, '0')}:00Z`,
        notes: `Demo seed — instalment ${n} of ${p.tenure}`,
        bank_confirmed: n % 2 !== 0,
      });
    }
    opening = closing;
    if (opening <= 0) break;
  }
});

// A handful of payments that are not yet settled, so the collections queue and
// the reconciliation queue both have work in them.
[
  { ci: 7,  amount: 185000, method: 'cheque',        date: '2026-09-08', status: 'pending' },
  { ci: 10, amount:  96000, method: 'bank_transfer', date: '2026-09-10', status: 'pending' },
  { ci: 4,  amount:  42500, method: 'mpesa',         date: '2026-09-11', status: 'failed'  },
  { ci: 2,  amount: 128000, method: 'bank_transfer', date: '2026-08-29', status: 'pending' },
].forEach((p, n) => {
  PAYMENTS.push({
    id: uid(`payment:open:${n}`),
    transaction_id: `DEMO-TXN-OPEN-${n + 1}`,
    client_id: CLIENTS[p.ci].id, asset_id: null, agent_id: AGENTS[n % AGENTS.length].id,
    amount: p.amount, payment_method: p.method, payment_status: p.status,
    reference_number: `DEMO-REF-OPEN-${n + 1}`,
    payment_date: `${p.date}T14:0${n}:00Z`,
    notes: 'Demo seed — awaiting settlement',
    bank_confirmed: false,
  });
});

// ── Bank statement lines, for the reconciliation screen ──────────────────────
const BANK = [];
PAYMENTS.filter(p => p.payment_status === 'completed' && p.payment_method === 'bank_transfer')
  .slice(0, 14)
  .forEach((p, n) => {
    BANK.push({
      id: uid(`bank:matched:${n}`),
      txn_date: p.payment_date.slice(0, 10),
      description: `RTGS CREDIT ${p.reference_number}`,
      bank_reference: p.reference_number,
      amount: p.amount, direction: 'credit',
      status: 'matched', matched_payment_id: p.id,
      fingerprint: `demo-${uid(`bank:matched:${n}`).slice(0, 18)}`,
    });
  });
[
  ['2026-09-02', 'EFT CREDIT NJERI HOLDINGS',      412000, 'credit'],
  ['2026-09-03', 'CHQ 004417 CLEARING',            185000, 'credit'],
  ['2026-09-05', 'STANDING ORDER RENT',           -229680, 'debit'],
  ['2026-09-08', 'MOBILE CREDIT MPESA SETTLEMENT', 268400, 'credit'],
  ['2026-09-09', 'LEDGER FEES AND COMMISSION',      -2700, 'debit'],
  ['2026-09-10', 'EFT CREDIT COASTAL CARGO',       340000, 'credit'],
  ['2026-09-11', 'UNIDENTIFIED DEPOSIT',            75000, 'credit'],
].forEach(([date, desc, amount, direction], n) => {
  BANK.push({
    id: uid(`bank:open:${n}`),
    txn_date: date, description: desc,
    bank_reference: `DEMO-STMT-${String(n + 1).padStart(3, '0')}`,
    amount, direction, status: 'unmatched', matched_payment_id: null,
    fingerprint: `demo-${uid(`bank:open:${n}`).slice(0, 18)}`,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HAND-RAISED INVOICES (company_invoices + line items)
// ─────────────────────────────────────────────────────────────────────────────
const INVOICE_SPECS = [
  { ci: 5,  issue: '2026-07-03', due: '2026-08-02', status: 'paid',    method: 'bank_transfer', items: [['Equipment hire — Bomag BW120, 12 days', 12, 28000], ['Operator and transport', 1, 96000]] },
  { ci: 9,  issue: '2026-07-19', due: '2026-08-18', status: 'paid',    method: 'mpesa',         items: [['Cold room panel installation', 1, 385000], ['Commissioning and handover', 1, 45000]] },
  { ci: 13, issue: '2026-08-05', due: '2026-09-04', status: 'paid',    method: 'bank_transfer', items: [['Irrigation pump set 5HP', 2, 520000], ['Site survey', 1, 35000]] },
  { ci: 0,  issue: '2026-08-21', due: '2026-09-20', status: 'pending', method: null,            items: [['Service and maintenance contract — Q3', 1, 240000]] },
  { ci: 2,  issue: '2026-08-28', due: '2026-09-27', status: 'pending', method: null,            items: [['Generator servicing — 62.5 kVA', 1, 78000], ['Replacement filters and oil', 4, 9500]] },
  { ci: 10, issue: '2026-07-30', due: '2026-08-29', status: 'pending', method: null,            items: [['Yard storage — August', 1, 180000]] },
  { ci: 7,  issue: '2026-08-02', due: '2026-09-01', status: 'pending', method: null,            items: [['Vehicle refurbishment — Toyota Fielder', 1, 265000]] },
  { ci: 3,  issue: '2026-09-05', due: '2026-10-05', status: 'pending', method: null,            items: [['Backhoe loader hire — 6 days', 6, 42000], ['Fuel surcharge', 1, 38000]] },
  { ci: 11, issue: '2026-09-09', due: '2026-10-09', status: 'draft',   method: null,            items: [['Grain dryer commissioning', 1, 310000]] },
  { ci: 4,  issue: '2026-06-12', due: '2026-07-12', status: 'cancelled', method: null,          items: [['Cancelled order — container unit', 1, 840000]] },
];
const INVOICES = [];
const INVOICE_ITEMS = [];
INVOICE_SPECS.forEach((spec, i) => {
  const client = CLIENTS[spec.ci];
  const invId = uid(`invoice:${i}`);
  const subtotal = round2(spec.items.reduce((s, [, qty, price]) => s + qty * price, 0));
  const vat = vatOn(subtotal);
  INVOICES.push({
    id: invId,
    invoice_no: `DEMO-CI-${String(i + 1).padStart(4, '0')}`,
    client_id: client.id, client_name: client.name, client_email: client.email,
    client_phone: client.phone, account_no: client.account, client_kra_pin: client.pin,
    issue_date: spec.issue, due_date: spec.due,
    subtotal, vat_rate: 16, vat_amount: vat, total: round2(subtotal + vat),
    status: spec.status, payment_method: spec.method,
    reference: spec.status === 'paid' ? `DEMO-RCPT-${String(i + 1).padStart(4, '0')}` : null,
    paid_at: spec.status === 'paid' ? `${spec.due}T10:00:00Z` : null,
    notes: 'Demo seed data — safe to delete.',
  });
  spec.items.forEach(([desc, qty, price], n) => {
    INVOICE_ITEMS.push({
      id: uid(`invoice_item:${i}:${n}`),
      invoice_id: invId, description: desc,
      quantity: qty, unit_price: price, line_total: round2(qty * price),
      sort_order: n,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CRM: the pipeline and the interaction log
// ─────────────────────────────────────────────────────────────────────────────
const LEAD_SPECS = [
  ['Mary Njoki',          'new_lead',      'high',   'Referral',        'Pickup truck',       850000,  '2026-09-20', 20],
  ['Ahmed Farah',         'contacted',     'medium', 'Walk-in',         'Generator set',      1280000, '2026-09-28', 40],
  ['Stephen Mwaura',      'qualified',     'high',   'Website',         'Backhoe loader',     7450000, '2026-10-12', 60],
  ['Jane Atieno',         'proposal_sent', 'high',   'Agent visit',     'Cold room',          1180000, '2026-09-25', 75],
  ['Rift Valley Agro Ltd','qualified',     'medium', 'Trade show',      'Grain dryer',        1880000, '2026-10-30', 55],
  ['Collins Wekesa',      'contacted',     'low',    'Facebook',        'Saloon car',         920000,  '2026-11-05', 25],
  ['Beatrice Nduta',      'new_lead',      'medium', 'Referral',        'Irrigation pump',    520000,  '2026-10-02', 15],
  ['Tabitha Mueni',       'proposal_sent', 'high',   'Website',         'Shuttle van',        2050000, '2026-09-30', 70],
  ['Lake Basin Traders',  'closed',        'high',   'Agent visit',     'Cargo truck',        4980000, '2026-08-28', 100],
  ['Oscar Kiplagat',      'closed',        'medium', 'Walk-in',         'Road roller',        4150000, '2026-07-15', 0],
  ['Nancy Wairimu',       'contacted',     'medium', 'Instagram',       'Office container',   840000,  '2026-10-18', 30],
  ['Hassan Abdi',         'qualified',     'low',    'Referral',        'Storage yard lease', 5400000, '2026-11-20', 45],
];
const LEADS = LEAD_SPECS.map(([name, stage, priority, source, interest, value, close, prob], i) => {
  const lost = name === 'Oscar Kiplagat';
  return {
    id: uid(`lead:${i}`),
    agent_id: AGENTS[i % AGENTS.length].id,
    full_name: name,
    email: `demo.lead${i + 1}@example.com`,
    phone: `+2547000002${String(i + 1).padStart(2, '0')}`,
    asset_interest: interest,
    budget_range: `KES ${(value * 0.9 / 1000).toFixed(0)}k – ${(value * 1.1 / 1000).toFixed(0)}k`,
    priority, stage, source,
    notes: 'Demo seed data — safe to delete.',
    deal_value: value,
    expected_close_date: close,
    win_probability: prob,
    next_follow_up_at: stage === 'closed' ? null : `${close}T09:00:00Z`,
    last_contact_at: `2026-09-0${(i % 9) + 1}T08:30:00Z`,
    interaction_count: 2,
    last_interaction_type: i % 2 === 0 ? 'call' : 'email',
    converted_at: stage === 'closed' && !lost ? '2026-08-28T12:00:00Z' : null,
    converted_entity: stage === 'closed' && !lost ? 'client' : null,
    lost_reason: lost ? 'price' : null,
    lost_notes: lost ? 'Went with a competitor quoting 8% lower on the same unit.' : null,
    lost_at: lost ? '2026-07-15T16:00:00Z' : null,
  };
});

const INTERACTION_KINDS = ['call', 'email', 'meeting', 'whatsapp', 'sms', 'note'];
const INTERACTIONS = [];
/** Nothing in the diary may be logged as having already happened in the future. */
const notAfterToday = (iso) => (iso.slice(0, 10) > TODAY ? `${TODAY}${iso.slice(10)}` : iso);
LEADS.forEach((lead, i) => {
  const count = 2 + (i % 3);
  for (let n = 0; n < count; n += 1) {
    INTERACTIONS.push({
      id: uid(`interaction:${i}:${n}`),
      agent_id: lead.agent_id,
      lead_id: lead.id,
      client_id: null,
      contact_name: lead.full_name,
      interaction_type: INTERACTION_KINDS[(i + n) % INTERACTION_KINDS.length],
      direction: n % 2 === 0 ? 'outbound' : 'inbound',
      subject: n === 0 ? 'First contact' : n === 1 ? 'Quotation discussion' : 'Follow-up on decision',
      summary: n === 0
        ? `Introduced the ${lead.asset_interest.toLowerCase()} options and confirmed budget.`
        : n === 1
          ? 'Talked through the hire purchase terms, deposit and monthly instalment.'
          : 'Chased the signed quotation; asked for a decision by the end of the week.',
      outcome: n === count - 1 ? 'Awaiting decision' : 'Progressed',
      duration_minutes: [12, 25, 8, 40][(i + n) % 4],
      occurred_at: notAfterToday(`2026-0${8 + (n % 2)}-${String(3 + ((i * 2 + n) % 22)).padStart(2, '0')}T10:${String((n * 13) % 60).padStart(2, '0')}:00Z`),
      next_step: n === count - 1 ? 'Call back after the site visit' : null,
    });
  }
});
// A few interactions against real clients, so the client book's diary is not empty.
CLIENTS.slice(0, 6).forEach((c, i) => {
  INTERACTIONS.push({
    id: uid(`interaction:client:${i}`),
    agent_id: c.agent, lead_id: null, client_id: c.id,
    contact_name: c.name,
    interaction_type: i % 2 === 0 ? 'call' : 'whatsapp',
    direction: 'outbound',
    subject: 'Instalment reminder',
    summary: 'Confirmed the next instalment date and the amount falling due.',
    outcome: 'Confirmed',
    duration_minutes: 9,
    occurred_at: `2026-09-0${(i % 9) + 1}T15:${String((i * 11) % 60).padStart(2, '0')}:00Z`,
    next_step: 'Send the statement by email',
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPLIANCE, PAPERWORK AND OVERSIGHT
//
// The screens that are not the Finance Hub but sit next to it on the company
// side: the KYC desk, the audit trail behind the staff activity report, the
// contract register, the approvals queue and the document archive. None of
// these reads a figure off the ledger, so they are built from the clients,
// staff and sales above rather than from the books.
// ─────────────────────────────────────────────────────────────────────────────

// ── KYC documents ───────────────────────────────────────────────────────────
//
// The desk's own list of what a file must contain, from
// src/pages/kyc-management-screen. A client short of any of these shows as
// incomplete, which is the state the reviewer exists to clear.
const REQUIRED_DOCS = [
  'national_id_front',
  'national_id_back',
  'passport_photo',
  'kra_pin',
  'proof_of_residence',
];
const KYC_DOCS = [];
CLIENTS.forEach((c, i) => {
  // Three bands: a complete approved file, one still short of documents, and
  // one carrying a rejection. Without all three the desk has nothing to do.
  const band = i < 8 ? 'complete' : i < 11 ? 'partial' : 'rejected';
  const count = band === 'complete' ? 5 : band === 'partial' ? 3 : 2;
  REQUIRED_DOCS.slice(0, count).forEach((type, n) => {
    const status = band === 'complete' ? 'approved'
      : band === 'partial' ? (n === 0 ? 'approved' : 'pending')
      : (n === 0 ? 'rejected' : 'pending');
    // A few identity documents are near expiry so the renewal screen has a
    // queue; national IDs do not expire, so it is the PIN and residence proof
    // that carry dates.
    const expires = type === 'kra_pin' || type === 'proof_of_residence'
      ? ['2026-10-04', '2026-11-18', '2027-03-30', '2026-09-26'][i % 4]
      : null;
    KYC_DOCS.push({
      id: uid(`kyc:${i}:${type}`),
      client_id: c.id,
      document_type: type,
      document_number: type === 'kra_pin' ? c.pin : type.startsWith('national_id') ? c.nid : null,
      issue_date: `2024-0${(i % 8) + 1}-1${(n % 9)}`,
      expiry_date: expires,
      status,
      file_name: `${type}-${c.account}.pdf`,
      // Deliberately a path, not a working link: nothing is uploaded to storage
      // by a SQL seed, so the viewer will not open. The review workflow —
      // approve, reject, chase — is what this data is here to exercise.
      file_url: `demo/kyc/${c.account}/${type}.pdf`,
      reviewer_notes: status === 'rejected' ? 'Scan is cut off at the edge — ask for a clean copy.' : null,
      notes: 'Demo seed data — safe to delete.',
    });
  });
});

// ── Audit trail ─────────────────────────────────────────────────────────────
//
// What the staff activity report counts. It reads audit_logs by user_id
// against the tenant's staff, so an empty table there reports six people who
// did nothing all year rather than an empty report.
const AUDIT_SHAPES = [
  ['login',   'info',    'Signed in'],
  ['view',    'info',    'Opened the client file'],
  ['create',  'info',    'Recorded a payment'],
  ['update',  'info',    'Updated the client record'],
  ['create',  'info',    'Raised an invoice'],
  ['approve', 'info',    'Approved a payroll run'],
  ['update',  'warning', 'Changed an instalment due date'],
  ['view',    'info',    'Exported a report'],
  ['reject',  'warning', 'Rejected a KYC document'],
  ['logout',  'info',    'Signed out'],
];
const AUDIT = [];
STAFF.forEach((s, si) => {
  MONTHS.forEach((m, mi) => {
    // Volume varies by person so the report can actually rank them, and
    // Samuel the driver is deliberately quiet — the idle-staff flag needs
    // someone to flag.
    const perMonth = s.k === 'samuel' ? 1 : 3 + ((si + mi) % 3);
    for (let n = 0; n < perMonth; n += 1) {
      const [action, severity, description] = AUDIT_SHAPES[(si * 3 + mi + n) % AUDIT_SHAPES.length];
      const client = CLIENTS[(si + mi + n) % CLIENTS.length];
      const day = Math.min(2 + ((si * 5 + mi * 3 + n * 7) % 26), m === LAST_MONTH ? TODAY_DAY : 28);
      AUDIT.push({
        id: uid(`audit:${s.k}:${m}:${n}`),
        user_id: s.id,
        action,
        severity,
        description: `${description} — demo seed`,
        table_name: ['payments', 'clients', 'company_invoices', 'payroll_records', 'kyc_documents'][(si + n) % 5],
        client_id: client.id,
        client_name: client.name,
        created_at: `${m}-${String(day).padStart(2, '0')}T0${(n % 9)}:${String((n * 17) % 60).padStart(2, '0')}:00Z`,
      });
    }
  });
});

// ── Contract register ───────────────────────────────────────────────────────
const CONTRACT_TEMPLATES = [
  {
    k: 'hp', name: 'Hire Purchase Agreement', type: 'hire_purchase',
    ownership: 'Title in the goods remains with the Seller until the final instalment is received in cleared funds.',
    dflt: 'Two consecutive missed instalments place the Buyer in default and the full balance becomes due on demand.',
    insurance: 'The Buyer shall keep the goods comprehensively insured for their full replacement value, with the Seller noted as loss payee.',
    penalty: 'A late payment charge of 2% per month accrues on any instalment outstanding for more than seven days.',
    settlement: 'The Buyer may settle early at any time; interest is rebated on the actuarial basis to the date of settlement.',
    law: 'This agreement is governed by the laws of Kenya, and the parties submit to the courts at Nairobi.',
  },
  {
    k: 'cash', name: 'Cash Sale Agreement', type: 'cash_sale',
    ownership: 'Title and risk pass to the Buyer on payment in full and collection of the goods.',
    dflt: 'Goods not collected within fourteen days of payment may be charged storage at the prevailing rate.',
    insurance: 'The Buyer insures the goods from the moment risk passes.',
    penalty: 'Not applicable to a cash sale.',
    settlement: 'Not applicable to a cash sale.',
    law: 'This agreement is governed by the laws of Kenya, and the parties submit to the courts at Nairobi.',
  },
  {
    k: 'gen', name: 'Equipment Hire Terms', type: 'general',
    ownership: 'The equipment remains at all times the property of the Owner.',
    dflt: 'Hire charges unpaid for thirty days entitle the Owner to repossess without notice.',
    insurance: 'The Hirer insures against damage, theft and third party liability for the whole hire period.',
    penalty: 'Equipment returned late is charged at 150% of the daily rate for each day of delay.',
    settlement: 'Hire may be ended early on seven days written notice; charges are due to the end of the notice period.',
    law: 'This agreement is governed by the laws of Kenya, and the parties submit to the courts at Nairobi.',
  },
];
CONTRACT_TEMPLATES.forEach(t => { t.id = uid(`template:${t.k}`); });

const GENERATED_CONTRACTS = SALES.map((s, i) => {
  const client = CLIENTS.find(c => c.id === s.client_id);
  // Most are signed; one is still out for signature and one was declined, so
  // the e-signature screen has each of its three states on show.
  const state = i === 3 ? 'pending' : i === 7 ? 'declined' : 'signed';
  return {
    id: uid(`gencontract:${i}`),
    sale_id: s.id, invoice_number: s.invoice_number,
    client_id: s.client_id, asset_id: s.asset_id,
    client_name: client?.name || '', pricing_model: s.pricing_model,
    generated_at: `${s.sale_date}T12:00:00Z`,
    esign_status: state,
    signed_at: state === 'signed' ? `${s.sale_date}T14:30:00Z` : null,
    signature_type: state === 'signed' ? 'drawn' : null,
    signature_hash: state === 'signed' ? `demo${uid(`gencontract:${i}`).replace(/-/g, '').slice(0, 56)}` : null,
    expires_at: state === 'pending' ? '2026-09-30T23:59:59Z' : null,
    declined_at: state === 'declined' ? `${s.sale_date}T16:05:00Z` : null,
    decline_reason: state === 'declined' ? 'Buyer asked for the deposit to be restructured before signing.' : null,
    file_url: `demo/contracts/${s.invoice_number}.pdf`,
  };
});

const COMPANY_CONTRACTS = [
  ['Godown Lease — Ruiru',            'lease',     'active',   '2026-04-01', 'signed'],
  ['Supplier Framework — Mombasa Traders', 'supply', 'active',  '2026-04-03', 'signed'],
  ['Insurance Cover Note — Fleet',    'insurance', 'active',   '2026-04-05', 'signed'],
  ['Cleaning Services Contract',      'services',  'expired',  '2026-01-15', 'signed'],
  ['Bank Facility Letter',            'finance',   'active',   '2026-04-01', 'pending'],
].map(([name, type, status, signed, esign], i) => ({
  id: uid(`companycontract:${i}`),
  contract_name: name, contract_type: type, status,
  signed_at: esign === 'signed' ? `${signed}T10:00:00Z` : null,
  esign_status: esign,
  file_url: `demo/contracts/company/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`,
  client_id: null,
}));

// ── Approvals queue ─────────────────────────────────────────────────────────
//
// Only the action types from the original enum are used. A later migration
// adds 'discount_approval' with IF NOT EXISTS, and this repo has a standing
// note that those newer values did not reach the live database — a value that
// is not there would fail the insert outright.
const APPROVALS = [
  ['high_value_transaction', 'Cash sale of 4,980,000 above the till limit', 'Isuzu FRR released to Coastal Cargo Ltd on a single cash settlement. Needs a second pair of eyes on the receipt before the asset is marked sold.', 'pending',  'high',     'payments',        'brian'],
  ['payment_refund',         'Refund 42,500 to Kevin Ochieng',              'M-Pesa collection reversed by the client bank. The refund cannot be released until the original is confirmed off the statement.',                   'pending',  'critical', 'payments',        'mercy'],
  ['debt_adjustment',        'Write off 1,500 penalty for Joseph Mwangi',   'Client disputes the late charge on instalment 4, saying the standing order failed at the bank rather than at his end.',                             'pending',  'medium',   'installment_schedules', 'mercy'],
  ['kyc_approval',           'Approve KYC file for Halima Yusuf',           'Three of five documents are in. Residence proof and PIN certificate are still outstanding.',                                                        'pending',  'low',      'clients',         'peter'],
  ['commission_override',    'Raise Faith Chepkoech to 7% for Q3',          'Requested on the back of the Eldoret numbers. Sits above the standard band, so it needs sign-off rather than an edit.',                              'pending',  'medium',   'agents',          'brian'],
  ['role_change',            'Move Peter Kamau to Collections',             'Operations is over-staffed and collections is behind. Role change only, no pay change.',                                                            'approved', 'low',      'user_profiles',   'grace'],
  ['asset_deletion',         'Remove duplicate asset DEMO-AST-013',         'Container unit was keyed twice during the April stock take. The duplicate has no sale against it.',                                                 'approved', 'low',      'assets',          'peter'],
  ['payment_split_change',   'Split Njeri Holdings deposit across two sales','Client paid one lump sum covering both the backhoe hire and the generator. Needs reallocating before either invoice can be closed.',              'rejected', 'medium',   'payments',        'amina'],
];
const APPROVAL_ROWS = APPROVALS.map(([type, title, description, status, priority, entity, who], i) => {
  const initiator = STAFF.find(s => s.k === who);
  const checker = STAFF.find(s => s.k === 'grace');
  const raised = `2026-09-0${(i % 9) + 1}T09:${String((i * 13) % 60).padStart(2, '0')}:00Z`;
  return {
    id: uid(`approval:${i}`),
    action_type: type, title, description,
    initiator_id: initiator.id, initiator_name: initiator.name, initiator_role: initiator.role,
    checker_id: status === 'pending' ? null : checker.id,
    checker_name: status === 'pending' ? null : checker.name,
    checker_role: status === 'pending' ? null : checker.role,
    status, priority,
    affected_entity: entity,
    checker_comment: status === 'rejected' ? 'Reallocate at the till instead — this does not need an approval.'
      : status === 'approved' ? 'Agreed. Actioned.' : null,
    created_at: raised,
    // 24 hours to answer, which is the default service level on the queue.
    due_at: `2026-09-0${((i % 9) + 2)}T09:${String((i * 13) % 60).padStart(2, '0')}:00Z`,
    resolved_at: status === 'pending' ? null : `2026-09-0${((i % 9) + 1)}T15:00:00Z`,
  };
});

// ── Document archive ────────────────────────────────────────────────────────
const ARCHIVE = [];
INVOICES.filter(v => v.status === 'paid').forEach((v, i) => {
  ARCHIVE.push({
    id: uid(`archive:invoice:${i}`),
    doc_type: 'invoice', module: 'finance',
    title: `Tax invoice ${v.invoice_no}`, reference: v.invoice_no,
    client_id: v.client_id, client_name: v.client_name,
    amount: v.total, file_name: `${v.invoice_no}.pdf`,
    file_path: `demo/archive/invoices/${v.invoice_no}.pdf`,
    file_size: 48000 + i * 1700, issued_at: `${v.issue_date}T09:00:00Z`,
  });
});
SALES.slice(0, 6).forEach((s, i) => {
  const client = CLIENTS.find(c => c.id === s.client_id);
  ARCHIVE.push({
    id: uid(`archive:receipt:${i}`),
    doc_type: 'receipt', module: 'pos',
    title: `Sale receipt ${s.receipt_number}`, reference: s.receipt_number,
    client_id: s.client_id, client_name: client?.name || '',
    amount: s.pricing_model === 'cash' ? s.total_amount : s.deposit_amount,
    file_name: `${s.receipt_number}.pdf`,
    file_path: `demo/archive/receipts/${s.receipt_number}.pdf`,
    file_size: 21000 + i * 900, issued_at: `${s.sale_date}T12:15:00Z`,
  });
});
MONTHS.slice(0, 5).forEach((m, i) => {
  ARCHIVE.push({
    id: uid(`archive:payslip:${m}`),
    doc_type: 'payslip', module: 'hr',
    title: `Payroll register ${m}`, reference: `DEMO-PAYREG-${m}`,
    client_id: null, client_name: null,
    amount: payrollTotals[m].net,
    file_name: `payroll-${m}.pdf`,
    file_path: `demo/archive/payroll/payroll-${m}.pdf`,
    file_size: 63000 + i * 1200, issued_at: `${m}-26T18:00:00Z`,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SQL EMISSION
// ─────────────────────────────────────────────────────────────────────────────
const TENANT = 'select admin_id from _demo_ctx';
const out = [];
const say = (...lines) => out.push(...lines);

say(
  '-- ═══════════════════════════════════════════════════════════════════════════',
  '-- ARARAT — DEMO DATA FOR THE COMPANY SIDE',
  '--',
  `-- Generated by scripts/seed-demo-data.mjs. Do not edit by hand — regenerate.`,
  '--',
  '-- WHAT THIS PUTS IN',
  `--   ${COA.length} chart of accounts lines, ${TX.length} transactions posted as ${JOURNAL.length} journal rows`,
  `--   ${STAFF.length} employees and ${PAYROLL.length} payroll records across ${MONTHS.length} months`,
  `--   ${CLIENTS.length} clients, ${ASSETS.length} assets, ${AGENTS.length} sales agents`,
  `--   ${SALES.length} sales with ${SCHEDULES.length} instalment rows and ${PAYMENTS.length} payments`,
  `--   ${INVOICES.length} hand-raised invoices, ${BANK.length} bank statement lines`,
  `--   ${LEADS.length} CRM leads and ${INTERACTIONS.length} logged interactions`,
  `--   ${KYC_DOCS.length} KYC documents and ${AUDIT.length} audit trail entries`,
  `--   ${CONTRACT_TEMPLATES.length} contract templates, ${GENERATED_CONTRACTS.length} generated contracts, ${COMPANY_CONTRACTS.length} company contracts`,
  `--   ${APPROVAL_ROWS.length} items in the approvals queue and ${ARCHIVE.length} archived documents`,
  '--',
  '-- Everything from the KYC documents down is OPTIONAL: each of those blocks',
  '-- skips itself with a notice if this database has no such table, so a module',
  '-- nobody has migrated cannot take the ledger down with it.',
  '--',
  '-- HOW TO RUN IT',
  '--   Supabase dashboard → SQL Editor → paste → Run. It runs as the database',
  '--   owner, so row level security does not stand in the way.',
  '--',
  '-- IT IS SAFE TO RUN TWICE. Every row carries a fixed id and every insert ends',
  '-- in ON CONFLICT DO NOTHING, so a second run changes nothing.',
  '--',
  '-- TO REMOVE IT ALL AGAIN, run scripts/seed-demo-data-teardown.sql, which',
  '-- deletes these rows by id and touches nothing else.',
  '--',
  '-- EVERY EMAIL IS @example.com — a domain reserved by RFC 2606 that cannot',
  '-- receive mail, so nothing here reaches a real inbox. Phone numbers are',
  '-- placeholders; do not fire bulk SMS at this data.',
  '-- ═══════════════════════════════════════════════════════════════════════════',
  '',
  '-- All or nothing. Without this a failure half way through would leave a',
  '-- partial load behind, and working out which half landed is not a thing',
  '-- anyone should have to do to a production database. Some SQL editors have',
  '-- already opened a transaction by this point and will answer with',
  '-- "there is already a transaction in progress" — that is a warning, not a',
  '-- failure, and the script carries on correctly.',
  'begin;',
  '',
  '-- ── 0. WHICH TENANT ────────────────────────────────────────────────────────',
  '-- Everything below hangs off ONE company admin account.',
  '--',
  '-- Leave the email as it is and the script takes the only admin in the',
  '-- database. If there is more than one it stops and lists them, so put the',
  '-- right address in the line below and run it again.',
  'drop table if exists _demo_ctx;',
  'create temporary table _demo_ctx as',
  'select up.id as admin_id',
  '  from public.user_profiles up',
  " where up.role = 'admin'",
  `   and (${q(ADMIN_EMAIL)} = 'REPLACE_WITH_ADMIN_EMAIL'`,
  `        or lower(up.email) = lower(${q(ADMIN_EMAIL)}));`,
  '',
  'do $$',
  'declare n integer; candidates text;',
  'begin',
  '  select count(*) into n from _demo_ctx;',
  '  if n = 1 then return; end if;',
  '',
  "  select string_agg(up.email, ', ' order by up.email) into candidates",
  "    from public.user_profiles up where up.role = 'admin';",
  '',
  '  if n = 0 then',
  '    raise exception',
  "      'Demo seed: no admin account matched. Admins in this database: %', coalesce(candidates, 'none');",
  '  else',
  '    raise exception',
  "      'Demo seed: % admin accounts matched — name one on the line above. Candidates: %', n, candidates;",
  '  end if;',
  'end $$;',
  '',
);

// ── Chart of accounts ───────────────────────────────────────────────────────
say(
  '-- ── 1. CHART OF ACCOUNTS ───────────────────────────────────────────────────',
  '-- Codes follow the bands src/config/transactionRecipes.js suggests, so the',
  '-- "Record a transaction" tab never has to offer to create an account.',
  '-- An account code the tenant already uses is left alone.',
  'insert into public.chart_of_accounts (id, admin_id, account_code, account_name, account_type, category, is_active)',
  'select v.id::uuid, c.admin_id, v.code, v.name, v.atype, v.cat, true',
  '  from _demo_ctx c',
  '  cross join (values',
  COA.map(([code, name, type, cat]) => row(uid(`coa:${code}`), code, name, type, cat)).join(',\n'),
  '  ) as v(id, code, name, atype, cat)',
  ' where not exists (',
  '   select 1 from public.chart_of_accounts x',
  '    where x.admin_id = c.admin_id and x.account_code = v.code)',
  'on conflict do nothing;',
  '',
);

// ── Employees ───────────────────────────────────────────────────────────────
say(
  '-- ── 2. EMPLOYEES ───────────────────────────────────────────────────────────',
  '-- user_profiles.id references auth.users, so a payroll record needs an auth',
  '-- row behind it. These are payroll records, NOT login accounts: the password',
  '-- column is left unusable and no identity row is created, so none of them can',
  '-- sign in. That is the same stance src/pages/hr-management takes when HR adds',
  '-- an employee through the Edge Function.',
  'insert into auth.users (',
  '  instance_id, id, aud, role, email, encrypted_password,',
  '  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)',
  'select',
  "  '00000000-0000-0000-0000-000000000000'::uuid, v.id::uuid, 'authenticated', 'authenticated',",
  "  v.email, '', now(), '2026-03-20T08:00:00Z'::timestamptz, now(),",
  '  \'{"provider":"email","providers":["email"]}\'::jsonb,',
  '  jsonb_build_object(\'full_name\', v.full_name)',
  'from (values',
  STAFF.map(s => row(s.id, s.email, s.name)).join(',\n'),
  ') as v(id, email, full_name)',
  'on conflict do nothing;',
  '',
  '-- GoTrue reads several token columns as NOT NULL text. Their defaults differ',
  '-- between Supabase versions, so any that exist and came out null are squared',
  '-- away here rather than named in the insert above (naming a column this',
  '-- deployment does not have would fail the whole statement).',
  'do $$',
  'declare col text;',
  'begin',
  '  foreach col in array array[',
  "    'confirmation_token','recovery_token','email_change_token_new','email_change',",
  "    'email_change_token_current','phone_change','phone_change_token','reauthentication_token']",
  '  loop',
  '    if exists (select 1 from information_schema.columns',
  "                where table_schema = 'auth' and table_name = 'users' and column_name = col) then",
  `      execute format('update auth.users set %I = coalesce(%I, %L) where id = any($1)', col, col, '')`,
  `        using array[${STAFF.map(s => `'${s.id}'`).join(', ')}]::uuid[];`,
  '    end if;',
  '  end loop;',
  'end $$;',
  '',
  '-- The handle_new_user trigger normally writes a bare user_profiles row for',
  '-- each of those. This does it explicitly as well, so the seed does not depend',
  '-- on that trigger being in place: without a profile row the UPDATE below is a',
  '-- silent no-op and the payroll insert then fails on a foreign key, which is a',
  '-- confusing way to find out the trigger is missing.',
  'insert into public.user_profiles (id, email, full_name, role)',
  "select v.id::uuid, v.email, v.full_name, 'operations'::public.user_role",
  'from (values',
  STAFF.map(s => row(s.id, s.email, s.name)).join(',\n'),
  ') as v(id, email, full_name)',
  'on conflict (id) do nothing;',
  '',
  '-- Now fill in the tenant, the role and the compensation the payroll engine',
  '-- reads. The role and admin_id columns are guarded by a trigger, which lets',
  '-- this through because the SQL editor carries no JWT — see migration',
  '-- 20260802130000.',
  'update public.user_profiles p set',
  '  admin_id = c.admin_id, full_name = v.full_name, role = v.role::public.user_role,',
  '  department = v.dept, phone = v.phone, gender = v.gender,',
  '  date_of_birth = v.dob::date, is_active = true,',
  '  basic_salary = v.basic, housing_allowance = v.house, transport_allowance = v.transport,',
  '  pension_contribution = v.pension, insurance_premiums = v.insurance,',
  '  next_of_kin_name = v.nok_name, next_of_kin_relationship = v.nok_rel, next_of_kin_phone = v.nok_phone',
  'from _demo_ctx c, (values',
  STAFF.map((s, i) => row(
    s.id, s.name, s.role, s.dept, s.phone, s.gender, s.dob,
    s.basic, s.house, s.transport, s.pension, s.insurance,
    ['Agnes Wanjiru', 'Doris Otieno', 'Yusuf Hassan', 'Lucy Kamau', 'Gideon Chebet', 'Ann Njoroge'][i],
    ['Sister', 'Spouse', 'Father', 'Mother', 'Brother', 'Spouse'][i],
    `+2547000003${String(11 + i).padStart(2, '0')}`,
  )).join(',\n'),
  ') as v(id, full_name, role, dept, phone, gender, dob, basic, house, transport, pension, insurance, nok_name, nok_rel, nok_phone)',
  'where p.id = v.id::uuid;',
  '',
);

// ── Agents ──────────────────────────────────────────────────────────────────
say(
  '-- ── 3. SALES AGENTS ────────────────────────────────────────────────────────',
  'insert into public.agents (id, admin_id, agent_code, full_name, email, phone, agent_status,',
  '  commission_rate, target_amount, region, agent_type, agent_role)',
  "select v.id::uuid, c.admin_id, v.code, v.full_name, v.email, v.phone, 'active'::public.agent_status,",
  "  v.rate, v.target, v.region, 'company', 'agent'",
  'from _demo_ctx c, (values',
  AGENTS.map(a => row(a.id, a.code, a.name, a.email, a.phone, a.rate, a.target, a.region)).join(',\n'),
  ') as v(id, code, full_name, email, phone, rate, target, region)',
  'on conflict do nothing;',
  '',
);

// ── Clients ─────────────────────────────────────────────────────────────────
say(
  '-- ── 4. CLIENTS ─────────────────────────────────────────────────────────────',
  'insert into public.clients (id, admin_id, agent_id, account_number, full_name, email, phone,',
  '  national_id, kra_pin, address, city, country, client_status, customer_type, kyc_status,',
  '  credit_score, notes, created_at)',
  'select v.id::uuid, c.admin_id, v.agent_id::uuid, v.account, v.full_name, v.email, v.phone,',
  "  v.nid, v.pin, v.addr, v.city, 'Kenya', v.status::public.client_status,",
  '  v.ctype::public.customer_type, v.kyc, v.score,',
  "  'Demo seed data — safe to delete.', v.created::timestamptz",
  'from _demo_ctx c, (values',
  CLIENTS.map((cl, i) => row(
    cl.id, cl.agent, cl.account, cl.name, cl.email, cl.phone, cl.nid, cl.pin,
    `P.O. Box ${1000 + i * 37}, ${cl.city}`, cl.city, cl.status, cl.type,
    cl.status === 'pending' ? 'pending' : 'verified',
    520 + ((i * 37) % 280),
    `2026-0${3 + (i % 6)}-${String(2 + (i % 26)).padStart(2, '0')}T08:00:00Z`,
  )).join(',\n'),
  ') as v(id, agent_id, account, full_name, email, phone, nid, pin, addr, city, status, ctype, kyc, score, created)',
  'on conflict do nothing;',
  '',
);

// ── Assets ──────────────────────────────────────────────────────────────────
const soldAssetIds = new Set(SALE_PLANS.map(p => ASSETS[p.ai].id));
const assetBuyer = {};
SALE_PLANS.forEach(p => { assetBuyer[ASSETS[p.ai].id] = CLIENTS[p.ci].id; });
say(
  '-- ── 5. ASSETS ──────────────────────────────────────────────────────────────',
  '-- linked_client_id is set on everything that has been sold: it is the column',
  '-- the asset register and the POS both read to say who an asset went to.',
  'insert into public.assets (id, admin_id, asset_code, asset_type, description, make, model, year,',
  '  plate_number, purchase_price, selling_price, current_value, asset_status, location,',
  '  serial_number, linked_client_id, notes)',
  'select v.id::uuid, c.admin_id, v.code, v.atype::public.asset_type, v.descr, v.make, v.model,',
  '  v.yr::integer, v.plate, v.cost, v.price, v.value, v.status::public.asset_status, v.loc,',
  "  v.serial, v.client_id::uuid, 'Demo seed data — safe to delete.'",
  'from _demo_ctx c, (values',
  ASSETS.map((a, i) => row(
    a.id, a.code, a.type, a.desc, a.make, a.model, a.year, a.plate,
    a.cost, a.price, round2(a.price * 0.95),
    soldAssetIds.has(a.id) ? 'sold' : (i % 5 === 3 ? 'reserved' : 'available'),
    ['Nairobi Yard', 'Mombasa Depot', 'Eldoret Branch', 'Ruiru Godown'][i % 4],
    `DEMO-SN-${String(100000 + i * 1237)}`,
    assetBuyer[a.id] || null,
  )).join(',\n'),
  ') as v(id, code, atype, descr, make, model, yr, plate, cost, price, value, status, loc, serial, client_id)',
  'on conflict do nothing;',
  '',
);

// ── Sales ───────────────────────────────────────────────────────────────────
say(
  '-- ── 6. SALES ───────────────────────────────────────────────────────────────',
  'insert into public.sales (id, admin_id, invoice_number, receipt_number, client_id, asset_id,',
  '  agent_id, pricing_model, selling_price, vat_amount, vat_percent, total_amount,',
  '  deposit_amount, finance_balance, interest_rate, tenure_months, payment_start_date,',
  '  payment_method, sale_date, status, buyer_kra_pin, customer_type, notes)',
  'select v.id::uuid, c.admin_id, v.inv, v.rcp, v.client_id::uuid, v.asset_id::uuid,',
  '  v.agent_id::uuid, v.model, v.price, v.vat, v.vatpc, v.total,',
  '  v.deposit, v.financed, v.rate, v.tenure::integer, v.start_date::date,',
  '  v.method, v.sale_date::date, v.status, v.pin, v.ctype::public.customer_type, v.notes',
  'from _demo_ctx c, (values',
  SALES.map(s => row(
    s.id, s.invoice_number, s.receipt_number, s.client_id, s.asset_id, s.agent_id,
    s.pricing_model, s.selling_price, s.vat_amount, s.vat_percent, s.total_amount,
    s.deposit_amount, s.finance_balance, s.interest_rate, s.tenure_months,
    s.payment_start_date, s.payment_method, s.sale_date, s.status, s.buyer_kra_pin,
    s.customer_type, s.notes,
  )).join(',\n'),
  ') as v(id, inv, rcp, client_id, asset_id, agent_id, model, price, vat, vatpc, total,',
  '       deposit, financed, rate, tenure, start_date, method, sale_date, status, pin, ctype, notes)',
  'on conflict do nothing;',
  '',
);

// ── Instalment schedules ────────────────────────────────────────────────────
say(
  '-- ── 7. INSTALMENT SCHEDULES ────────────────────────────────────────────────',
  '-- Amortised at the plan\'s own rate. Rows already past their due date are',
  '-- marked paid, except for two clients deliberately left in arrears so the',
  '-- collections queue and the overdue alerts have something to show.',
  'insert into public.installment_schedules (id, sale_id, client_id, asset_id, installment_no,',
  '  due_date, opening_balance, installment_amount, principal_portion, interest_portion,',
  '  penalty, closing_balance, amount_paid, status)',
  'values',
  SCHEDULES.map(s => row(
    s.id, s.sale_id, s.client_id, s.asset_id, s.installment_no, s.due_date,
    s.opening_balance, s.installment_amount, s.principal_portion, s.interest_portion,
    s.penalty, s.closing_balance, s.amount_paid, s.status,
  )).join(',\n'),
  'on conflict do nothing;',
  '',
);

// ── Payments ────────────────────────────────────────────────────────────────
say(
  '-- ── 8. PAYMENTS ────────────────────────────────────────────────────────────',
  '-- Completed bank transfers and cheques are marked bank_confirmed, because',
  '-- migration 20260908220000 refuses to let either reach "completed" without a',
  '-- matched statement line.',
  'insert into public.payments (id, admin_id, transaction_id, client_id, asset_id, agent_id,',
  '  amount, payment_method, payment_status, reference_number, payment_date, notes,',
  '  bank_confirmed, bank_confirmed_at, reconciliation_status)',
  'select v.id::uuid, c.admin_id, v.txn, v.client_id::uuid, v.asset_id::uuid, v.agent_id::uuid,',
  '  v.amount, v.method::public.payment_method, v.status::public.payment_status,',
  '  v.reference, v.paid_at::timestamptz, v.notes, v.confirmed,',
  '  case when v.confirmed then v.paid_at::timestamptz end,',
  "  case when v.method = 'cash' then 'not_required'",
  "       when v.confirmed then 'confirmed' else 'pending' end",
  'from _demo_ctx c, (values',
  PAYMENTS.map(p => row(
    p.id, p.transaction_id, p.client_id, p.asset_id, p.agent_id, p.amount,
    p.payment_method, p.payment_status, p.reference_number, p.payment_date,
    p.notes, p.bank_confirmed && p.payment_status === 'completed',
  )).join(',\n'),
  ') as v(id, txn, client_id, asset_id, agent_id, amount, method, status, reference, paid_at, notes, confirmed)',
  'on conflict do nothing;',
  '',
);

// ── Journal ─────────────────────────────────────────────────────────────────
say(
  '-- ── 9. THE LEDGER ──────────────────────────────────────────────────────────',
  `-- ${TX.length} transactions, posted as ${JOURNAL.length} debit/credit pairs — journal_entries`,
  '-- stores one pair per row, so a multi-leg entry is the smallest set of pairs',
  '-- that reproduces it. Rows sharing an entry_no are one entry in the ledger.',
  '--',
  '-- Account strings are written "CODE — NAME", the spelling the hub\'s own',
  '-- composers use and the one src/utils/financialStatements.js indexes.',
  '--',
  '-- The trial balance nets to zero and the bank never goes overdrawn; the',
  '-- generator refuses to emit this file otherwise.',
  'insert into public.journal_entries (id, admin_id, entry_no, entry_date, description,',
  '  debit_account, credit_account, amount, entry_type, reference, status, is_automated,',
  '  trigger_event, period_month)',
  'select v.id::uuid, c.admin_id, v.entry_no, v.entry_date::date, v.descr,',
  '  v.dr, v.cr, v.amount, v.etype, v.reference, v.status, v.automated,',
  '  v.trigger_event, v.period_month',
  'from _demo_ctx c, (values',
  JOURNAL.map(j => row(
    j.id, j.entry_no, j.entry_date, j.description, j.debit_account, j.credit_account,
    j.amount, j.entry_type, j.reference, j.status, j.is_automated, j.trigger_event,
    j.period_month,
  )).join(',\n'),
  ') as v(id, entry_no, entry_date, descr, dr, cr, amount, etype, reference, status,',
  '       automated, trigger_event, period_month)',
  'on conflict do nothing;',
  '',
);

// ── Payroll ─────────────────────────────────────────────────────────────────
say(
  '-- ── 10. PAYROLL ────────────────────────────────────────────────────────────',
  '-- Every figure below came out of src/utils/kenyaPayroll.js, so the Payroll',
  '-- tab, the payslip and the P10 return all recompute exactly these numbers.',
  '-- July carries a 10% bonus; September is left pending sign-off.',
  'insert into public.payroll_records (id, admin_id, employee_id, pay_month, basic_salary,',
  '  housing_allowance, transport_allowance, meal_allowance, bonus, gift, loan_deduction,',
  '  advance_deduction, gross_salary, taxable_pay, paye, nssf, shif, housing_levy,',
  '  personal_relief, insurance_relief, pension_contribution, non_cash_benefits,',
  '  total_deductions, net_salary, rate_version, status)',
  'select v.id::uuid, c.admin_id, v.employee_id::uuid, v.pay_month, v.basic,',
  '  v.house, v.transport, v.meal, v.bonus, v.gift, v.loan, v.advance,',
  '  v.gross, v.taxable, v.paye, v.nssf, v.shif, v.housing,',
  '  v.relief, v.ins_relief, v.pension, v.noncash, v.deductions, v.net, v.rate_version, v.status',
  'from _demo_ctx c, (values',
  PAYROLL.map(p => row(
    p.id, p.employee_id, p.pay_month, p.basic_salary, p.housing_allowance,
    p.transport_allowance, p.meal_allowance, p.bonus, p.gift, p.loan_deduction,
    p.advance_deduction, p.gross_salary, p.taxable_pay, p.paye, p.nssf, p.shif,
    p.housing_levy, p.personal_relief, p.insurance_relief, p.pension_contribution,
    p.non_cash_benefits, p.total_deductions, p.net_salary, p.rate_version, p.status,
  )).join(',\n'),
  ') as v(id, employee_id, pay_month, basic, house, transport, meal, bonus, gift, loan,',
  '       advance, gross, taxable, paye, nssf, shif, housing, relief, ins_relief, pension,',
  '       noncash, deductions, net, rate_version, status)',
  'on conflict do nothing;',
  '',
);

// ── Manual invoices ─────────────────────────────────────────────────────────
say(
  '-- ── 11. HAND-RAISED INVOICES ───────────────────────────────────────────────',
  'insert into public.company_invoices (id, admin_id, invoice_no, client_id, client_name,',
  '  client_email, client_phone, account_no, client_kra_pin, issue_date, due_date, currency,',
  '  subtotal, vat_rate, vat_amount, total, status, payment_method, reference, paid_at, notes)',
  "select v.id::uuid, c.admin_id, v.inv_no, v.client_id::uuid, v.client_name,",
  "  v.client_email, v.client_phone, v.account_no, v.pin, v.issue::date, v.due::date, 'KES',",
  '  v.subtotal, v.vat_rate, v.vat_amount, v.total, v.status, v.method, v.reference,',
  '  v.paid_at::timestamptz, v.notes',
  'from _demo_ctx c, (values',
  INVOICES.map(v => row(
    v.id, v.invoice_no, v.client_id, v.client_name, v.client_email, v.client_phone,
    v.account_no, v.client_kra_pin, v.issue_date, v.due_date, v.subtotal, v.vat_rate,
    v.vat_amount, v.total, v.status, v.payment_method, v.reference, v.paid_at, v.notes,
  )).join(',\n'),
  ') as v(id, inv_no, client_id, client_name, client_email, client_phone, account_no, pin,',
  '       issue, due, subtotal, vat_rate, vat_amount, total, status, method, reference, paid_at, notes)',
  'on conflict do nothing;',
  '',
  'insert into public.company_invoice_items (id, admin_id, invoice_id, description, quantity,',
  '  unit_price, line_total, sort_order)',
  'select v.id::uuid, c.admin_id, v.invoice_id::uuid, v.descr, v.qty, v.price, v.total, v.sort::integer',
  'from _demo_ctx c, (values',
  INVOICE_ITEMS.map(it => row(
    it.id, it.invoice_id, it.description, it.quantity, it.unit_price, it.line_total, it.sort_order,
  )).join(',\n'),
  ') as v(id, invoice_id, descr, qty, price, total, sort)',
  'on conflict do nothing;',
  '',
);

// ── Bank statement ──────────────────────────────────────────────────────────
say(
  '-- ── 12. BANK STATEMENT LINES ───────────────────────────────────────────────',
  '-- Matched lines sit against the payment they settle; the seven unmatched ones',
  '-- at the end are what the reconciliation screen exists to work through.',
  'insert into public.bank_transactions (id, admin_id, bank_account, txn_date, description,',
  '  bank_reference, amount, direction, currency, status, matched_payment_id, matched_at,',
  "  match_method, fingerprint)",
  "select v.id::uuid, c.admin_id, 'Equity 0170xxxxxx901', v.txn_date::date, v.descr,",
  "  v.reference, v.amount, v.direction, 'KES', v.status, v.matched::uuid,",
  "  case when v.matched is not null then v.txn_date::timestamptz end,",
  "  case when v.matched is not null then 'reference' end,",
  '  v.fingerprint',
  'from _demo_ctx c, (values',
  BANK.map(b => row(
    b.id, b.txn_date, b.description, b.bank_reference, b.amount, b.direction,
    b.status, b.matched_payment_id, b.fingerprint,
  )).join(',\n'),
  ') as v(id, txn_date, descr, reference, amount, direction, status, matched, fingerprint)',
  'on conflict do nothing;',
  '',
);

// ── CRM ─────────────────────────────────────────────────────────────────────
say(
  '-- ── 13. CRM PIPELINE ───────────────────────────────────────────────────────',
  '-- Twelve leads spread across every stage, with deal values and win',
  '-- probabilities so the weighted forecast has something to weigh. One is won,',
  '-- one is lost on price — the loss analytics need both.',
  'insert into public.leads (id, admin_id, agent_id, full_name, email, phone, asset_interest,',
  '  budget_range, priority, stage, source, notes, deal_value, expected_close_date,',
  '  win_probability, next_follow_up_at, last_contact_at, interaction_count,',
  '  last_interaction_type, converted_at, converted_entity, lost_reason, lost_notes, lost_at)',
  'select v.id::uuid, c.admin_id, v.agent_id::uuid, v.full_name, v.email, v.phone, v.interest,',
  '  v.budget, v.priority::public.lead_priority, v.stage::public.lead_stage, v.source, v.notes,',
  '  v.value, v.close::date, v.prob::smallint, v.follow_up::timestamptz,',
  '  v.last_contact::timestamptz, v.icount::integer, v.itype,',
  '  v.converted::timestamptz, v.centity, v.lost_reason, v.lost_notes, v.lost_at::timestamptz',
  'from _demo_ctx c, (values',
  LEADS.map(l => row(
    l.id, l.agent_id, l.full_name, l.email, l.phone, l.asset_interest, l.budget_range,
    l.priority, l.stage, l.source, l.notes, l.deal_value, l.expected_close_date,
    l.win_probability, l.next_follow_up_at, l.last_contact_at, l.interaction_count,
    l.last_interaction_type, l.converted_at, l.converted_entity, l.lost_reason,
    l.lost_notes, l.lost_at,
  )).join(',\n'),
  ') as v(id, agent_id, full_name, email, phone, interest, budget, priority, stage, source,',
  '       notes, value, close, prob, follow_up, last_contact, icount, itype, converted,',
  '       centity, lost_reason, lost_notes, lost_at)',
  'on conflict do nothing;',
  '',
  'insert into public.crm_interactions (id, admin_id, agent_id, lead_id, client_id, contact_name,',
  '  interaction_type, direction, subject, summary, outcome, duration_minutes, occurred_at, next_step)',
  'select v.id::uuid, c.admin_id, v.agent_id::uuid, v.lead_id::uuid, v.client_id::uuid, v.contact,',
  '  v.itype::public.crm_interaction_type, v.direction::public.crm_interaction_direction,',
  '  v.subject, v.summary, v.outcome, v.minutes::integer, v.occurred::timestamptz, v.next_step',
  'from _demo_ctx c, (values',
  INTERACTIONS.map(x => row(
    x.id, x.agent_id, x.lead_id, x.client_id, x.contact_name, x.interaction_type,
    x.direction, x.subject, x.summary, x.outcome, x.duration_minutes, x.occurred_at,
    x.next_step,
  )).join(',\n'),
  ') as v(id, agent_id, lead_id, client_id, contact, itype, direction, subject, summary,',
  '       outcome, minutes, occurred, next_step)',
  'on conflict do nothing;',
  '',
);

// ── Report ──────────────────────────────────────────────────────────────────
say(
);

// ─────────────────────────────────────────────────────────────────────────────
// THE OPTIONAL HALF
//
// Everything past here is a module OUTSIDE the Finance Hub, and every block is
// wrapped so it can skip itself.
//
// The reason is the deploy history in this repo: migrations have run ahead of
// and behind the live schema in both directions, more than once. A plain INSERT
// naming a table this database does not have would abort the transaction and
// take the ledger down with it — a KYC table nobody has migrated yet is not a
// good reason to lose the books.
//
// Only `undefined_table` and `undefined_column` are caught, so a genuine
// mistake in the SQL below still fails loudly rather than disappearing into a
// notice.
// ─────────────────────────────────────────────────────────────────────────────
const optional = (label, sql) => {
  say(
    'do $$',
    'begin',
    ...sql,
    'exception',
    '  when undefined_table or undefined_column then',
    `    raise notice 'Skipped ${label}: % — that table is not in this database, everything else is unaffected.', sqlerrm;`,
    'end $$;',
    '',
  );
};

say('-- ── 14. KYC DOCUMENTS ──────────────────────────────────────────────────────',
    '-- The five documents the KYC desk requires, at three levels of completeness:',
    '-- eight complete and approved files, three still short of documents, and',
    '-- three carrying a rejection. The file_url values are paths, not uploads —',
    '-- a SQL seed puts nothing in storage, so the viewer will not open. It is the',
    '-- review workflow that this data is here to exercise.');
optional('kyc_documents', [
  '  insert into public.kyc_documents (id, admin_id, client_id, document_type, document_number,',
  '    issue_date, expiry_date, status, file_name, file_url, reviewer_notes, notes)',
  '  select v.id::uuid, c.admin_id, v.client_id::uuid, v.dtype, v.dnumber,',
  '    v.issued::date, v.expires::date, v.status, v.fname, v.furl, v.reviewer_notes, v.notes',
  '  from _demo_ctx c, (values',
  KYC_DOCS.map(d => row(
    d.id, d.client_id, d.document_type, d.document_number, d.issue_date, d.expiry_date,
    d.status, d.file_name, d.file_url, d.reviewer_notes, d.notes,
  )).join(',\n'),
  '  ) as v(id, client_id, dtype, dnumber, issued, expires, status, fname, furl, reviewer_notes, notes)',
  '  on conflict do nothing;',
]);

say('-- ── 15. AUDIT TRAIL ────────────────────────────────────────────────────────',
    '-- What the staff activity report counts. It reads audit_logs by user_id',
    '-- against the tenant\'s staff, so with this table empty the report says six',
    '-- people did nothing for six months. Samuel is deliberately quiet, because',
    '-- the idle-staff flag needs somebody to flag.');
optional('audit_logs', [
  '  insert into public.audit_logs (id, admin_id, user_id, action, severity, description,',
  '    table_name, client_id, client_name, created_at)',
  '  select v.id::uuid, c.admin_id, v.user_id::uuid, v.action::public.audit_action, v.severity,',
  '    v.descr, v.tname, v.client_id::uuid, v.client_name, v.created::timestamptz',
  '  from _demo_ctx c, (values',
  AUDIT.map(a => row(
    a.id, a.user_id, a.action, a.severity, a.description, a.table_name,
    a.client_id, a.client_name, a.created_at,
  )).join(',\n'),
  '  ) as v(id, user_id, action, severity, descr, tname, client_id, client_name, created)',
  '  on conflict do nothing;',
]);

say('-- ── 16. CONTRACT REGISTER ──────────────────────────────────────────────────',
    '-- Three clause templates, a generated contract for every sale, and the',
    '-- company\'s own paperwork. The generated contracts carry all three',
    '-- e-signature states — signed, still out, and declined — so that screen has',
    '-- each of its branches on show.');
optional('contract_templates', [
  '  insert into public.contract_templates (id, admin_id, template_name, contract_type,',
  '    signatory_name, signatory_title, ownership_clause, default_clause, insurance_clause,',
  '    penalty_clause, settlement_clause, governing_law_clause, is_default, is_active)',
  '  select v.id::uuid, c.admin_id, v.name, v.ctype, v.sig_name, v.sig_title,',
  '    v.ownership, v.dflt, v.insurance, v.penalty, v.settlement, v.law, v.is_default, true',
  '  from _demo_ctx c, (values',
  CONTRACT_TEMPLATES.map((t, i) => row(
    t.id, t.name, t.type, 'Grace Wanjiru', 'Managing Director',
    t.ownership, t.dflt, t.insurance, t.penalty, t.settlement, t.law, i === 0,
  )).join(',\n'),
  '  ) as v(id, name, ctype, sig_name, sig_title, ownership, dflt, insurance, penalty,',
  '         settlement, law, is_default)',
  '  on conflict do nothing;',
]);
optional('generated_contracts', [
  '  insert into public.generated_contracts (id, admin_id, sale_id, invoice_number, client_id,',
  '    asset_id, client_name, pricing_model, generated_at, esign_status, signed_at,',
  '    signature_type, signature_hash, expires_at, declined_at, decline_reason, file_url)',
  '  select v.id::uuid, c.admin_id, v.sale_id::uuid, v.inv, v.client_id::uuid,',
  '    v.asset_id::uuid, v.client_name, v.model, v.generated::timestamptz, v.esign,',
  '    v.signed::timestamptz, v.sig_type, v.sig_hash, v.expires::timestamptz,',
  '    v.declined::timestamptz, v.decline_reason, v.file_url',
  '  from _demo_ctx c, (values',
  GENERATED_CONTRACTS.map(g => row(
    g.id, g.sale_id, g.invoice_number, g.client_id, g.asset_id, g.client_name,
    g.pricing_model, g.generated_at, g.esign_status, g.signed_at, g.signature_type,
    g.signature_hash, g.expires_at, g.declined_at, g.decline_reason, g.file_url,
  )).join(',\n'),
  '  ) as v(id, sale_id, inv, client_id, asset_id, client_name, model, generated, esign,',
  '         signed, sig_type, sig_hash, expires, declined, decline_reason, file_url)',
  '  on conflict do nothing;',
]);
optional('company_contracts', [
  '  insert into public.company_contracts (id, admin_id, client_id, contract_name, contract_type,',
  '    file_url, is_template, status, signed_at, esign_status)',
  '  select v.id::uuid, c.admin_id, v.client_id::uuid, v.name, v.ctype,',
  '    v.file_url, false, v.status, v.signed::timestamptz, v.esign',
  '  from _demo_ctx c, (values',
  COMPANY_CONTRACTS.map(k => row(
    k.id, k.client_id, k.contract_name, k.contract_type, k.file_url, k.status,
    k.signed_at, k.esign_status,
  )).join(',\n'),
  '  ) as v(id, client_id, name, ctype, file_url, status, signed, esign)',
  '  on conflict do nothing;',
]);

say('-- ── 17. APPROVALS QUEUE ────────────────────────────────────────────────────',
    '-- Five items waiting on a decision, two already approved and one rejected.',
    '--',
    '-- Only action types from the ORIGINAL enum appear here. A later migration',
    '-- adds \'discount_approval\' with IF NOT EXISTS, and this repo carries a',
    '-- standing note that those newer values never reached the live database —',
    '-- naming one that is not there would fail the insert outright.',
    '-- approval_thresholds is left alone on purpose: it is global configuration,',
    '-- not tenant data, and demo rows must not change how real approvals route.');
optional('maker_checker_queue', [
  '  insert into public.maker_checker_queue (id, admin_id, action_type, title, description,',
  '    initiator_id, initiator_name, initiator_role, checker_id, checker_name, checker_role,',
  '    status, priority, affected_entity, checker_comment, created_at, due_at, resolved_at)',
  '  select v.id::uuid, c.admin_id, v.atype::public.mc_action_type, v.title, v.descr,',
  '    v.initiator_id::uuid, v.initiator_name, v.initiator_role, v.checker_id::uuid,',
  '    v.checker_name, v.checker_role, v.status::public.mc_status, v.priority::public.mc_priority,',
  '    v.entity, v.comment, v.created::timestamptz, v.due::timestamptz, v.resolved::timestamptz',
  '  from _demo_ctx c, (values',
  APPROVAL_ROWS.map(a => row(
    a.id, a.action_type, a.title, a.description, a.initiator_id, a.initiator_name,
    a.initiator_role, a.checker_id, a.checker_name, a.checker_role, a.status,
    a.priority, a.affected_entity, a.checker_comment, a.created_at, a.due_at, a.resolved_at,
  )).join(',\n'),
  '  ) as v(id, atype, title, descr, initiator_id, initiator_name, initiator_role,',
  '         checker_id, checker_name, checker_role, status, priority, entity, comment,',
  '         created, due, resolved)',
  '  on conflict do nothing;',
]);

say('-- ── 18. DOCUMENT ARCHIVE ───────────────────────────────────────────────────',
    '-- Invoices, till receipts and payroll registers, filed by month. As with',
    '-- KYC, the file paths point at nothing — a SQL seed uploads no files.');
optional('document_archive', [
  '  insert into public.document_archive (id, admin_id, doc_type, module, title, reference,',
  '    client_id, client_name, amount, currency, file_path, file_name, mime_type, file_size, issued_at)',
  "  select v.id::uuid, c.admin_id, v.dtype, v.module, v.title, v.reference,",
  "    v.client_id::uuid, v.client_name, v.amount, 'KES', v.fpath, v.fname,",
  "    'application/pdf', v.fsize::bigint, v.issued::timestamptz",
  '  from _demo_ctx c, (values',
  ARCHIVE.map(a => row(
    a.id, a.doc_type, a.module, a.title, a.reference, a.client_id, a.client_name,
    a.amount, a.file_path, a.file_name, a.file_size, a.issued_at,
  )).join(',\n'),
  '  ) as v(id, dtype, module, title, reference, client_id, client_name, amount,',
  '         fpath, fname, fsize, issued)',
  '  on conflict do nothing;',
]);

say(
  'commit;',
  '',
  '-- ── 19. WHAT LANDED ────────────────────────────────────────────────────────',
  '-- Read this output before closing the editor. A zero anywhere means that',
  '-- table rejected its rows, and the reason will be in the notices above.',
  "select 'chart_of_accounts' as table_name, count(*) as rows from public.chart_of_accounts where admin_id = (" + TENANT + ')',
  "union all select 'journal_entries',    count(*) from public.journal_entries    where admin_id = (" + TENANT + ')',
  "union all select 'user_profiles',      count(*) from public.user_profiles      where admin_id = (" + TENANT + ')',
  "union all select 'payroll_records',    count(*) from public.payroll_records    where admin_id = (" + TENANT + ')',
  "union all select 'clients',            count(*) from public.clients            where admin_id = (" + TENANT + ')',
  "union all select 'assets',             count(*) from public.assets             where admin_id = (" + TENANT + ')',
  "union all select 'agents',             count(*) from public.agents             where admin_id = (" + TENANT + ')',
  "union all select 'sales',              count(*) from public.sales              where admin_id = (" + TENANT + ')',
  "union all select 'payments',           count(*) from public.payments           where admin_id = (" + TENANT + ')',
  "union all select 'company_invoices',   count(*) from public.company_invoices   where admin_id = (" + TENANT + ')',
  "union all select 'bank_transactions',  count(*) from public.bank_transactions  where admin_id = (" + TENANT + ')',
  "union all select 'leads',              count(*) from public.leads              where admin_id = (" + TENANT + ')',
  "union all select 'crm_interactions',   count(*) from public.crm_interactions   where admin_id = (" + TENANT + ')',
  "union all select 'installment_schedules', count(*) from public.installment_schedules s",
  '  join public.sales sa on sa.id = s.sale_id where sa.admin_id = (' + TENANT + ')',
  'order by table_name;',
  '',
  '-- The ledger, read back through the chart the way the Statements tab reads',
  '-- it. Every seeded account string has to find its account here — a class',
  '-- with no rows means a journal line names something the chart does not',
  '-- carry, and that line is invisible on the P&L and the balance sheet.',
  '--',
  '-- Expect: revenue and the two liability classes credit-heavy, assets and the',
  '-- expense classes debit-heavy, and the balance column summing to zero.',
  'with seeded as (',
  '  select debit_account as account, amount as dr, 0::numeric as cr',
  '    from public.journal_entries',
  '   where admin_id = (' + TENANT + ') and entry_no like \'DEMO-JE-%\'',
  '  union all',
  '  select credit_account, 0::numeric, amount',
  '    from public.journal_entries',
  '   where admin_id = (' + TENANT + ') and entry_no like \'DEMO-JE-%\'',
  ')',
  'select coalesce(coa.account_type, \'UNMATCHED — check this\') as account_class,',
  '       round(sum(s.dr), 2) as debits,',
  '       round(sum(s.cr), 2) as credits,',
  '       round(sum(s.dr) - sum(s.cr), 2) as balance',
  '  from seeded s',
  '  left join public.chart_of_accounts coa',
  '    on coa.admin_id = (' + TENANT + ')',
  "   and s.account = coa.account_code || ' — ' || coa.account_name",
  ' group by 1',
  ' order by 1;',
  '',
);

writeFileSync(join(HERE, 'seed-demo-data.sql'), out.join('\n') + '\n', 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// TEARDOWN
//
// Deletes by id, never by pattern. Nothing the tenant created themselves can be
// caught by this, whatever it is named.
// ─────────────────────────────────────────────────────────────────────────────
const idList = (ids) => ids.map(i => `  '${i}'::uuid`).join(',\n');
const down = [
  '-- ═══════════════════════════════════════════════════════════════════════════',
  '-- ARARAT — REMOVE THE DEMO DATA',
  '--',
  '-- Generated by scripts/seed-demo-data.mjs alongside seed-demo-data.sql.',
  '--',
  '-- Every row is deleted BY ID. There is no pattern matching, no "where notes',
  '-- like", nothing that could reach a row the tenant created themselves. Run it',
  '-- top to bottom; the order respects the foreign keys.',
  '--',
  '-- Safe to run twice, and safe to run even if the seed was never applied.',
  '-- ═══════════════════════════════════════════════════════════════════════════',
  '',
  'begin;',
  '',
  '-- The modules outside the Finance Hub go first, and each one is wrapped so a',
  '-- table this database does not have is skipped rather than taking the whole',
  '-- cleanup down. It is also why this file is safe to run against a database',
  '-- where only part of the seed was ever applied.',
  ...[
    ['kyc_documents',        KYC_DOCS.map(d => d.id)],
    ['audit_logs',           AUDIT.map(a => a.id)],
    ['generated_contracts',  GENERATED_CONTRACTS.map(g => g.id)],
    ['company_contracts',    COMPANY_CONTRACTS.map(k => k.id)],
    ['contract_templates',   CONTRACT_TEMPLATES.map(t => t.id)],
    ['maker_checker_queue',  APPROVAL_ROWS.map(a => a.id)],
    ['document_archive',     ARCHIVE.map(a => a.id)],
  ].flatMap(([table, ids]) => [
    'do $$',
    'begin',
    `  delete from public.${table} where id in (\n${idList(ids)});`,
    'exception',
    '  when undefined_table or undefined_column then',
    `    raise notice 'Skipped ${table}: % — nothing of ours can be in a table that is not there.', sqlerrm;`,
    'end $$;',
    '',
  ]),
  '-- Children first.',
  `delete from public.crm_interactions where id in (\n${idList(INTERACTIONS.map(x => x.id))});`,
  '',
  `delete from public.leads where id in (\n${idList(LEADS.map(l => l.id))});`,
  '',
  `delete from public.company_invoice_items where id in (\n${idList(INVOICE_ITEMS.map(i => i.id))});`,
  '',
  `delete from public.company_invoices where id in (\n${idList(INVOICES.map(i => i.id))});`,
  '',
  `delete from public.bank_transactions where id in (\n${idList(BANK.map(b => b.id))});`,
  '',
  `delete from public.installment_schedules where id in (\n${idList(SCHEDULES.map(s => s.id))});`,
  '',
  '-- Payments before sales: a statement line points at a payment, and that',
  '-- reference is cleared by the delete above.',
  `delete from public.payments where id in (\n${idList(PAYMENTS.map(p => p.id))});`,
  '',
  `delete from public.sales where id in (\n${idList(SALES.map(s => s.id))});`,
  '',
  `delete from public.payroll_records where id in (\n${idList(PAYROLL.map(p => p.id))});`,
  '',
  `delete from public.journal_entries where id in (\n${idList(JOURNAL.map(j => j.id))});`,
  '',
  `delete from public.chart_of_accounts where id in (\n${idList(COA.map(([code]) => uid(`coa:${code}`)))});`,
  '',
  '-- Assets and clients reference each other, so clear the link before either.',
  `update public.assets set linked_client_id = null where id in (\n${idList(ASSETS.map(a => a.id))});`,
  '',
  `delete from public.assets where id in (\n${idList(ASSETS.map(a => a.id))});`,
  '',
  `delete from public.clients where id in (\n${idList(CLIENTS.map(c => c.id))});`,
  '',
  '-- Commission ledger rows the payments trigger wrote on the way in. A payment',
  '-- credited to an agent fires trg_payments_sync_agent_totals, which posts a',
  '-- commission row into agent_wallets keyed on the payment. Deleting the',
  '-- payment does not reverse that row, so it is cleared here — otherwise the',
  '-- demo agents leave commission behind after everything else has gone.',
  '--',
  '-- Guarded like the optional modules above, and for the same reason: an',
  '-- unguarded delete naming a table this database does not have would abort the',
  '-- transaction, and then NOTHING gets cleaned up.',
  'do $$',
  'begin',
  `  delete from public.agent_wallets where agent_id in (\n${idList(AGENTS.map(a => a.id))});`,
  'exception',
  '  when undefined_table or undefined_column then',
  "    raise notice 'Skipped agent_wallets: % — no commission rows can exist without it.', sqlerrm;",
  'end $$;',
  '',
  `delete from public.agents where id in (\n${idList(AGENTS.map(a => a.id))});`,
  '',
  '-- The staff rows last. Deleting the auth user cascades to user_profiles.',
  `delete from auth.users where id in (\n${idList(STAFF.map(s => s.id))});`,
  '',
  'commit;',
  '',
  '-- Nothing should come back from this.',
  "select 'journal_entries' as table_name, count(*) as left_over",
  `  from public.journal_entries where entry_no like 'DEMO-JE-%'`,
  "union all select 'clients', count(*) from public.clients where account_number like 'DEMO-%'",
  "union all select 'assets',  count(*) from public.assets  where asset_code like 'DEMO-%'",
  "union all select 'agents',  count(*) from public.agents  where agent_code like 'DEMO-%';",
  '',
];
writeFileSync(join(HERE, 'seed-demo-data-teardown.sql'), down.join('\n') + '\n', 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// READ THE SEEDED LEDGER BACK THROUGH THE APP'S OWN ENGINES
//
// The arithmetic above proves the entries balance. It does not prove the
// Finance Hub can CLASSIFY them — an account string the index cannot place is
// summed into nothing and drops silently off both the P&L and the balance
// sheet. So the same functions the Statements tab and the VAT panel call are
// run here over exactly the rows being emitted, and the seed is rejected if
// anything falls through unclassified or the statements disagree with the
// arithmetic.
// ─────────────────────────────────────────────────────────────────────────────
const chartRows = COA.map(([code, name, type, cat]) => ({
  account_code: code, account_name: name, account_type: type, category: cat, is_active: true,
}));
const LAST = MONTHS[MONTHS.length - 1];
const pl = buildIncomeStatement({ journals: JOURNAL, chartOfAccounts: chartRows });
const bs = buildBalanceSheet({ journals: JOURNAL, chartOfAccounts: chartRows, period: LAST });
const tb = buildTrialBalance({ journals: JOURNAL, chartOfAccounts: chartRows, period: LAST });
const vatReturn = computeVatReturn({ journals: JOURNAL, chartOfAccounts: chartRows });

if (!bs.balanced) {
  throw new Error(
    `The balance sheet engine does not balance: assets ${bs.totalAssets}, ` +
    `liabilities ${bs.totalLiabilities}, equity ${bs.totalEquity}, out by ${bs.difference}`,
  );
}
if (bs.unclassified.length > 0) {
  throw new Error(`Accounts the statements could not place: ${bs.unclassified.map(a => a.name).join(', ')}`);
}
if (vatReturn.diagnostics.unclassifiedAccounts.length > 0) {
  throw new Error(`VAT accounts with no role: ${vatReturn.diagnostics.unclassifiedAccounts.join(', ')}`);
}
if (!(pl.revenue > 0) || !(pl.expenses > 0) || !(pl.cogs > 0) || !(pl.salaries > 0)) {
  throw new Error('The income statement reads zero off the seeded ledger — check the account strings');
}
if (!(vatReturn.outputVAT > 0) || !(vatReturn.inputVAT > 0)) {
  throw new Error('The VAT return reads zero off the seeded ledger — check the VAT account names');
}

// The VAT tab files ONE MONTH at a time, so check the months the way the user
// will read them: every one has to show tax on sales and tax on purchases.
//
// Only the net is allowed to go either way. April is a REFUND month and is
// meant to be: the equipment, the vehicle, the furniture and the opening stock
// are all bought in it, so input tax of 1.15m runs well ahead of 488k of output
// tax. That is what a first month of trading looks like, and having one in the
// set is worth more than six identical payable months.
const vatByMonth = MONTHS.map(m => ({
  month: m,
  ...computeVatReturn({ journals: JOURNAL, chartOfAccounts: chartRows, period: m }),
}));
for (const v of vatByMonth) {
  if (!(v.outputVAT > 0) || !(v.inputVAT > 0)) {
    throw new Error(
      `The VAT return for ${v.month} does not read: output ${v.outputVAT}, input ${v.inputVAT}`,
    );
  }
}
if (!(vatByMonth[0].netVAT < 0) || vatByMonth.slice(1).some(v => v.netVAT <= 0)) {
  throw new Error('Expected April to be a refund month and every month after it to be payable');
}

// Each month's P&L must stand on its own too — the Statements tab has a month
// picker, and an empty or loss-making month in the middle of a demo is noise.
const plByMonth = MONTHS.map(m => ({
  month: m,
  ...buildIncomeStatement({ journals: JOURNAL, chartOfAccounts: chartRows, period: m }),
}));
for (const p of plByMonth) {
  if (!(p.revenue > 0) || !(p.netProfit > 0)) {
    throw new Error(`${p.month} does not trade profitably: revenue ${p.revenue}, profit ${p.netProfit}`);
  }
}
if (tb.rows.length === 0 || Math.abs(round2(tb.totalDebit - tb.totalCredit)) > 1) {
  throw new Error(`The trial balance does not foot: ${tb.totalDebit} vs ${tb.totalCredit}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// WHAT THE BOOKS SAY — printed so the numbers can be sanity-checked without a
// database.
// ─────────────────────────────────────────────────────────────────────────────
const classOf = (acct) => {
  const code = CODE_OF[acct];
  const type = TYPE_OF[code];
  return ({
    current_asset: 'asset', non_current_asset: 'asset',
    current_liability: 'liability', equity: 'equity',
    revenue: 'revenue', cost_of_sales: 'expense', operating_expense: 'expense',
  })[type];
};
const totalFor = (cls) => round2(Object.entries(balances)
  .filter(([acct]) => classOf(acct) === cls)
  .reduce((s, [, v]) => s + v, 0));

const revenue  = -totalFor('revenue');
const expenses = totalFor('expense');
const assets   = totalFor('asset');
const liab     = -totalFor('liability');
const equity   = -totalFor('equity');

console.log('');
console.log('  Demo seed generated');
console.log('  ───────────────────────────────────────────────');
console.log(`  tenant                ${ADMIN_EMAIL}`);
console.log(`  period                ${MONTHS[0]} to ${MONTHS[MONTHS.length - 1]}`);
console.log(`  transactions          ${TX.length}  (${JOURNAL.length} journal rows)`);
console.log(`  chart of accounts     ${COA.length}`);
console.log(`  employees / payroll   ${STAFF.length} / ${PAYROLL.length}`);
console.log(`  clients / assets      ${CLIENTS.length} / ${ASSETS.length}`);
console.log(`  sales / instalments   ${SALES.length} / ${SCHEDULES.length}`);
console.log(`  payments              ${PAYMENTS.length}`);
console.log(`  invoices raised       ${INVOICES.length}  (${INVOICE_ITEMS.length} lines)`);
console.log(`  bank statement lines  ${BANK.length}`);
console.log(`  leads / interactions  ${LEADS.length} / ${INTERACTIONS.length}`);
console.log(`  kyc documents         ${KYC_DOCS.length}`);
console.log(`  audit trail entries   ${AUDIT.length}`);
console.log(`  contracts             ${CONTRACT_TEMPLATES.length} templates, ${GENERATED_CONTRACTS.length} generated, ${COMPANY_CONTRACTS.length} company`);
console.log(`  approvals queued      ${APPROVAL_ROWS.length}`);
console.log(`  archived documents    ${ARCHIVE.length}`);
console.log('  ───────────────────────────────────────────────');
console.log(`  revenue               ${revenue.toLocaleString()}`);
console.log(`  expenses              ${expenses.toLocaleString()}`);
console.log(`  net profit            ${round2(revenue - expenses).toLocaleString()}`);
console.log(`  assets                ${assets.toLocaleString()}`);
console.log(`  liabilities           ${liab.toLocaleString()}`);
console.log(`  equity + profit       ${round2(equity + revenue - expenses).toLocaleString()}`);
console.log(`  balance sheet check   ${round2(assets - liab - equity - revenue + expenses).toLocaleString()} (must be 0)`);
console.log(`  trial balance net     ${tbNet} (must be 0)`);
console.log(`  lowest bank balance   ${lowest.v.toLocaleString()} on ${lowest.on}`);
console.log('  ───────────────────────────────────────────────');
console.log('  month      revenue     net profit    VAT payable');
plByMonth.forEach((p, i) => {
  const v = vatByMonth[i];
  console.log(
    `  ${p.month}  ${String(Math.round(p.revenue).toLocaleString()).padStart(10)}` +
    `  ${String(Math.round(p.netProfit).toLocaleString()).padStart(11)}` +
    `  ${String(Math.round(v.netVAT).toLocaleString()).padStart(13)}` +
    (v.netVAT < 0 ? '  (refund)' : ''),
  );
});
console.log('  ───────────────────────────────────────────────');
console.log('  wrote scripts/seed-demo-data.sql');
console.log('  wrote scripts/seed-demo-data-teardown.sql');
console.log('');
