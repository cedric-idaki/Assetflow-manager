/**
 * PLAIN-ENGLISH TRANSACTION RECIPES
 *
 * WHY THIS EXISTS
 *
 * The Finance Hub's journal composer asks for a debit line and a credit line.
 * That is the right way to STORE a transaction and the wrong way to ASK for
 * one: the person who knows that rent was paid from the M-Pesa till is rarely
 * the person who knows that rent is a debit and the till is a credit. Faced
 * with that grid, a non-accountant either guesses the sides — which posts a
 * balanced, silently backwards entry that no validation can catch — or stops
 * recording altogether and the books go stale.
 *
 * So this module models a transaction the way the user experiences it ("I paid
 * a running cost", "a customer paid me what they owed") and derives the debits
 * and credits from that. The ledger, the reversal rules, the statements and
 * the vouchers are untouched — what changes is only the question asked at the
 * front.
 *
 * WHY ROLES, NOT ACCOUNT CODES
 *
 * The SACCO side can seed templates against fixed account codes because it
 * seeds the chart of accounts too. A company's chart is built by the company:
 * `DEFAULT_COA` is empty and every account in it was typed in by the tenant.
 * One writes "Cash at Bank", the next "Equity Bank — Current". A recipe that
 * hardcoded '1000' would post into a code that tenant has never heard of.
 *
 * A recipe therefore names a ROLE — "the money account", "the expense" — and
 * the role is resolved against whatever chart the tenant actually has, by
 * account type first, then category, then name. Where that leaves a real
 * choice ("which expense?") the user is asked in plain words. Where it leaves
 * none, the account is filled in silently. Where the chart has nothing that
 * can play the role, the UI offers to create it rather than dead-ending.
 *
 * NOTHING HERE TOUCHES REACT, THE DOM OR SUPABASE.
 */

import { classifyVatAccount } from '../utils/vatLedger';

const round2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;

/**
 * How an account is written onto a journal line.
 *
 * `"1000 — Cash at Bank"`, matching the manual composer exactly. It matters
 * that the two agree: the trial balance groups by this string, so one account
 * written two ways becomes two accounts each holding half of its balance.
 */
export const accountLabel = (account) =>
  [account?.account_code, account?.account_name].filter(Boolean).join(' — ');

/** The name half of a posted account string, for reading back in plain words. */
export const accountNameOf = (label) =>
  String(label || '').split(' — ').slice(1).join(' — ') || String(label || '');

// ─────────────────────────────────────────────────────────────────────────────
// ROLES — what a recipe needs, described the way the chart describes accounts
// ─────────────────────────────────────────────────────────────────────────────
//
// `strict` roles only accept accounts that score on category or name. Every
// current asset is a candidate "money account" by type alone, and offering
// Trade Receivables as somewhere cash might have landed is worse than offering
// nothing at all. Loose roles (expense, revenue) accept the whole type,
// because there every account of that type is a legitimate answer.

export const ROLES = {
  money: {
    question: 'Which account did the money move through?',
    hint: 'The bank account, M-Pesa till or cash box the money actually moved through.',
    types: ['current_asset'],
    categories: ['Cash'],
    namePattern: /\b(cash|bank|m-?pesa|till|petty|paybill|wallet|float)\b/i,
    excludePattern: /\b(receivable|debtor|prepaid|inventory|stock)\b/i,
    strict: true,
    suggest: { account_name: 'Cash at Bank', account_type: 'current_asset', category: 'Cash', band: [1000, 1099] },
  },
  money_to: {
    question: 'Which account did the money go into?',
    hint: 'The account that received the transfer.',
    types: ['current_asset'],
    categories: ['Cash'],
    namePattern: /\b(cash|bank|m-?pesa|till|petty|paybill|wallet|float)\b/i,
    excludePattern: /\b(receivable|debtor|prepaid|inventory|stock)\b/i,
    strict: true,
    suggest: { account_name: 'Cash at Bank', account_type: 'current_asset', category: 'Cash', band: [1000, 1099] },
  },
  receivable: {
    question: 'Where should the amount owed be recorded?',
    hint: 'What customers owe the business until they pay.',
    types: ['current_asset'],
    categories: ['Receivables'],
    namePattern: /\b(receivable|debtor|owed)\w*/i,
    strict: true,
    suggest: { account_name: 'Trade Receivables', account_type: 'current_asset', category: 'Receivables', band: [1100, 1199] },
  },
  inventory: {
    question: 'Where should the stock be recorded?',
    hint: 'Goods held for resale, until they are sold.',
    types: ['current_asset'],
    categories: ['Inventory'],
    namePattern: /\b(inventor|stock|goods|merchandis)\w*/i,
    strict: true,
    suggest: { account_name: 'Inventory', account_type: 'current_asset', category: 'Inventory', band: [1200, 1299] },
  },
  fixed_asset: {
    question: 'What did you buy?',
    hint: 'Equipment, vehicles, furniture — things the business will use for years.',
    types: ['non_current_asset'],
    excludePattern: /deprecia/i,
    suggest: { account_name: 'Equipment', account_type: 'non_current_asset', category: 'Fixed Assets', band: [1500, 1599] },
  },
  payable: {
    question: 'Who is owed?',
    hint: 'What the business owes suppliers until it pays them.',
    types: ['current_liability'],
    categories: ['Payables'],
    namePattern: /\b(payable|creditor|supplier|owing)\w*/i,
    // Statutory balances are payables too, but a supplier bill posted against
    // PAYE is a genuinely painful thing to unpick, so they are never offered.
    excludePattern: /\b(paye|nssf|shif|nhif|housing|levy|statutory|tax|vat)\b/i,
    strict: true,
    suggest: { account_name: 'Trade Payables', account_type: 'current_liability', category: 'Payables', band: [2000, 2099] },
  },
  loan: {
    question: 'Which loan?',
    hint: 'The borrowing this money relates to.',
    types: ['current_liability', 'non_current_liability'],
    namePattern: /\b(loan|borrow\w*|overdraft|mortgage|financ\w*|debenture)\b/i,
    strict: true,
    suggest: { account_name: 'Bank Loan', account_type: 'current_liability', category: 'Other', band: [2500, 2599] },
  },
  equity: {
    question: 'Where should the money put in be recorded?',
    hint: 'The stake the owner holds in the business.',
    types: ['equity'],
    categories: ['Capital'],
    namePattern: /\b(capital|equity|contribut\w*|investment)\b/i,
    excludePattern: /\b(drawing|retained)\w*/i,
    strict: true,
    suggest: { account_name: 'Owner Capital', account_type: 'equity', category: 'Capital', band: [3000, 3099] },
  },
  drawings: {
    question: 'Where should the money taken out be recorded?',
    hint: 'Money the owner takes for personal use. It reduces their stake.',
    types: ['equity'],
    namePattern: /\b(drawing|withdrawal|distribution|dividend)\w*/i,
    strict: true,
    suggest: { account_name: 'Owner Drawings', account_type: 'equity', category: 'Capital', band: [3100, 3199] },
  },
  revenue: {
    question: 'What was the money for?',
    hint: 'The kind of sale or income this was.',
    types: ['revenue'],
    suggest: { account_name: 'Sales Revenue', account_type: 'revenue', category: 'Sales', band: [4000, 4099] },
  },
  expense: {
    question: 'What was it for?',
    hint: 'Rent, salaries, fuel, airtime, licences — the running cost this paid.',
    types: ['operating_expense', 'cost_of_sales'],
    suggest: { account_name: 'General Expenses', account_type: 'operating_expense', category: 'Admin', band: [6000, 6099] },
  },
  interest_expense: {
    question: 'Where should the interest be recorded?',
    hint: 'The cost of the borrowing, as opposed to paying the loan itself down.',
    types: ['operating_expense'],
    namePattern: /\b(interest|finance\s+(cost|charge)|bank\s+charge)\w*/i,
    strict: true,
    suggest: { account_name: 'Interest Expense', account_type: 'operating_expense', category: 'Overhead', band: [6900, 6999] },
  },
  vat_input: {
    question: 'Where should the reclaimable VAT be recorded?',
    hint: 'VAT paid on a purchase, which KRA lets you reclaim.',
    types: ['current_asset'],
    vatRole: 'input',
    strict: true,
    suggest: { account_name: 'Input VAT', account_type: 'current_asset', category: 'Other', band: [1300, 1399] },
  },
  vat_output: {
    question: 'Where should the VAT charged be recorded?',
    hint: 'VAT collected on a sale, which is owed to KRA.',
    types: ['current_liability'],
    vatRole: 'output',
    strict: true,
    suggest: { account_name: 'VAT Payable', account_type: 'current_liability', category: 'Statutory', band: [2100, 2199] },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// RESOLVING A ROLE AGAINST THIS TENANT'S CHART
// ─────────────────────────────────────────────────────────────────────────────

const scoreAccount = (role, account) => {
  let score = 0;
  if (role.categories?.includes(account.category)) score += 4;
  if (role.namePattern?.test(account.account_name)) score += 3;
  return score;
};

/**
 * Accounts in this chart that can play `roleKey`, best first.
 *
 * A VAT account never answers a non-VAT question and vice versa. "VAT Payable"
 * is a current liability, so without that rule it would turn up in the list of
 * suppliers you might owe money to.
 */
export const candidatesForRole = (roleKey, chartOfAccounts = []) => {
  const role = ROLES[roleKey];
  if (!role) return [];

  const usable = (chartOfAccounts || []).filter(
    (a) => a && a.is_active !== false && a.account_name && a.account_code,
  );

  if (role.vatRole) {
    return usable
      .filter((a) => classifyVatAccount(a) === role.vatRole)
      .sort((a, b) => String(a.account_code).localeCompare(String(b.account_code)));
  }

  return usable
    .filter((a) => role.types.includes(a.account_type))
    .filter((a) => !classifyVatAccount(a))
    .filter((a) => !role.excludePattern?.test(a.account_name))
    .map((a) => ({ account: a, score: scoreAccount(role, a) }))
    .filter(({ score }) => !role.strict || score > 0)
    .sort((x, y) => y.score - x.score
      || String(x.account.account_code).localeCompare(String(y.account.account_code)))
    .map(({ account }) => account);
};

/**
 * The account to offer creating when a role has no candidate at all.
 *
 * Kept inside the role's conventional code band so a chart grown this way
 * still reads in the usual order, and never reusing a code the tenant already
 * has — `addAccountToCOA` would reject that, and the user would have been
 * shown a button that cannot work.
 */
export const suggestedAccountFor = (roleKey, chartOfAccounts = []) => {
  const role = ROLES[roleKey];
  if (!role?.suggest) return null;
  const { band, ...rest } = role.suggest;
  const taken = new Set((chartOfAccounts || []).map((a) => String(a?.account_code)));
  const [from, to] = band;
  for (let code = from; code <= to; code += 1) {
    if (!taken.has(String(code))) return { ...rest, account_code: String(code), is_active: true };
  }
  return { ...rest, account_code: String(from), is_active: true };
};

// ─────────────────────────────────────────────────────────────────────────────
// AMOUNTS — one number the user actually knows, split three ways
// ─────────────────────────────────────────────────────────────────────────────

export const VAT_TREATMENTS = [
  { key: 'inclusive', label: 'Total includes VAT', hint: 'The figure on the receipt already has VAT in it.' },
  { key: 'exclusive', label: 'VAT is on top',      hint: 'The figure is before VAT, which is added to it.' },
  { key: 'none',      label: 'No VAT',             hint: 'Not a VAT transaction, or there is no VAT receipt.' },
];

/**
 * Split the amount the user typed into net, tax and total.
 *
 * `amount` reads as the TOTAL under 'inclusive' and as the net under
 * 'exclusive', which is exactly how the two are quoted in the wild. Either way
 * `total` is what moves through the money account, so a recipe line only has
 * to name which of the three it takes.
 *
 * The tax is taken out of the total rather than the net added to it, so the
 * rounded parts always sum back to the figure the user typed. Grossing up
 * instead leaves entries a cent out, and a cent out is an unbalanced entry.
 */
export const splitAmount = ({ amount, treatment = 'none', rate = 0, interest = 0 } = {}) => {
  const entered = round2(amount);
  const r = (Number(rate) || 0) / 100;

  let net = entered;
  let tax = 0;
  if (r > 0 && treatment === 'inclusive') {
    tax = round2(entered * r / (1 + r));
    net = round2(entered - tax);
  } else if (r > 0 && treatment === 'exclusive') {
    net = entered;
    tax = round2(entered * r);
  }

  const total = round2(net + tax);
  const interestPart = Math.max(0, Math.min(round2(interest), total));
  return {
    net,
    tax,
    total,
    interest: interestPart,
    principal: round2(total - interestPart),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// RECIPES
// ─────────────────────────────────────────────────────────────────────────────
//
// An `axis` folds the "have you paid yet?" question into a recipe instead of
// doubling the menu. A sale settled now and a sale on credit differ in exactly
// one account, so they are one recipe with a switch rather than two entries
// the user has to tell apart.

export const AXES = {
  receipt: {
    key: 'receipt',
    question: 'Have you been paid?',
    options: [
      { key: 'money',      label: 'Yes, paid now',   role: 'money' },
      { key: 'receivable', label: 'No, they owe me', role: 'receivable' },
    ],
  },
  settlement: {
    key: 'settlement',
    question: 'Have you paid for it?',
    options: [
      { key: 'money',   label: 'Yes, paid now', role: 'money' },
      { key: 'payable', label: 'No, I owe it',  role: 'payable' },
    ],
  },
};

export const GROUPS = [
  { key: 'in',   label: 'Money coming in', icon: 'ArrowDownLeft' },
  { key: 'out',  label: 'Money going out', icon: 'ArrowUpRight' },
  { key: 'move', label: 'Moving money',    icon: 'ArrowLeftRight' },
];

export const RECIPES = [
  {
    code: 'SALE',
    ledger: 'Sale',
    group: 'in',
    icon: 'ShoppingBag',
    name: 'I made a sale',
    blurb: 'Sold goods or services, whether the customer paid on the spot or still owes you.',
    entryType: 'revenue',
    axis: 'receipt',
    vat: 'output',
    party: { label: 'Customer (optional)', placeholder: 'Who bought from you?' },
    picks: ['revenue'],
    lines: [
      { role: '@axis',      side: 'debit',  amount: 'total' },
      { role: 'revenue',    side: 'credit', amount: 'net' },
      { role: 'vat_output', side: 'credit', amount: 'tax', whenTax: true },
    ],
  },
  {
    code: 'CUSTOMER_PAYMENT',
    ledger: 'Customer payment',
    group: 'in',
    icon: 'HandCoins',
    name: 'A customer paid what they owed',
    blurb: 'Settling an invoice or balance already recorded. The sale itself is not recorded a second time.',
    entryType: 'general',
    party: { label: 'Customer (optional)', placeholder: 'Who paid you?' },
    picks: ['money', 'receivable'],
    lines: [
      { role: 'money',      side: 'debit',  amount: 'total' },
      { role: 'receivable', side: 'credit', amount: 'total' },
    ],
  },
  {
    code: 'OWNER_IN',
    ledger: 'Capital introduced',
    group: 'in',
    icon: 'PiggyBank',
    name: 'The owner put money into the business',
    blurb: 'Capital introduced from the owner’s own pocket. It is not income and must not show up as profit.',
    entryType: 'general',
    picks: ['money', 'equity'],
    lines: [
      { role: 'money',  side: 'debit',  amount: 'total' },
      { role: 'equity', side: 'credit', amount: 'total' },
    ],
  },
  {
    code: 'LOAN_IN',
    ledger: 'Loan received',
    group: 'in',
    icon: 'Landmark',
    name: 'The business received a loan',
    blurb: 'Borrowed money arriving. It is a debt, not income, however welcome it feels.',
    entryType: 'general',
    party: { label: 'Lender (optional)', placeholder: 'Who lent the money?' },
    picks: ['money', 'loan'],
    lines: [
      { role: 'money', side: 'debit',  amount: 'total' },
      { role: 'loan',  side: 'credit', amount: 'total' },
    ],
  },
  {
    code: 'EXPENSE',
    ledger: 'Expense',
    group: 'out',
    icon: 'Receipt',
    name: 'I paid a running cost',
    blurb: 'Rent, salaries, fuel, airtime, licences — anything used up in running the business.',
    entryType: 'expense',
    axis: 'settlement',
    vat: 'input',
    party: { label: 'Paid to (optional)', placeholder: 'Who did you pay?' },
    picks: ['expense'],
    lines: [
      { role: 'expense',   side: 'debit',  amount: 'net' },
      { role: 'vat_input', side: 'debit',  amount: 'tax', whenTax: true },
      { role: '@axis',     side: 'credit', amount: 'total' },
    ],
  },
  {
    code: 'SUPPLIER_PAYMENT',
    ledger: 'Supplier payment',
    group: 'out',
    icon: 'CreditCard',
    name: 'I paid a supplier I already owed',
    blurb: 'Clearing a bill already recorded. The cost itself is not recorded a second time.',
    entryType: 'general',
    party: { label: 'Supplier (optional)', placeholder: 'Who did you pay?' },
    picks: ['payable', 'money'],
    lines: [
      { role: 'payable', side: 'debit',  amount: 'total' },
      { role: 'money',   side: 'credit', amount: 'total' },
    ],
  },
  {
    code: 'STOCK',
    ledger: 'Stock purchase',
    group: 'out',
    icon: 'Package',
    name: 'I bought stock to resell',
    blurb: 'Goods bought to sell on. They sit on the balance sheet until sold, so this is not yet a cost.',
    entryType: 'general',
    axis: 'settlement',
    vat: 'input',
    party: { label: 'Supplier (optional)', placeholder: 'Who did you buy from?' },
    picks: ['inventory'],
    lines: [
      { role: 'inventory', side: 'debit',  amount: 'net' },
      { role: 'vat_input', side: 'debit',  amount: 'tax', whenTax: true },
      { role: '@axis',     side: 'credit', amount: 'total' },
    ],
  },
  {
    code: 'ASSET',
    ledger: 'Asset purchase',
    group: 'out',
    icon: 'Truck',
    name: 'I bought equipment or another long-term item',
    blurb: 'Something the business will use for years. Not a cost this month — it is depreciated over its life.',
    entryType: 'general',
    axis: 'settlement',
    vat: 'input',
    party: { label: 'Supplier (optional)', placeholder: 'Who did you buy from?' },
    picks: ['fixed_asset'],
    lines: [
      { role: 'fixed_asset', side: 'debit',  amount: 'net' },
      { role: 'vat_input',   side: 'debit',  amount: 'tax', whenTax: true },
      { role: '@axis',       side: 'credit', amount: 'total' },
    ],
  },
  {
    code: 'OWNER_OUT',
    ledger: 'Owner drawings',
    group: 'out',
    icon: 'Wallet',
    name: 'The owner took money out',
    blurb: 'Money drawn for personal use. It reduces the owner’s stake and is not a business cost.',
    entryType: 'general',
    picks: ['drawings', 'money'],
    lines: [
      { role: 'drawings', side: 'debit',  amount: 'total' },
      { role: 'money',    side: 'credit', amount: 'total' },
    ],
  },
  {
    code: 'LOAN_OUT',
    ledger: 'Loan repayment',
    group: 'out',
    icon: 'Undo2',
    name: 'I made a loan repayment',
    blurb: 'Part pays the debt down and part is interest. Only the interest is a cost.',
    entryType: 'general',
    party: { label: 'Lender (optional)', placeholder: 'Who did you repay?' },
    // The split is the whole point of this recipe. Treating the instalment as
    // all cost overstates expenses; treating it as all principal hides the
    // cost of borrowing entirely. Neither is visible in the bank statement.
    interest: {
      label: 'How much of that was interest?',
      hint: 'From the lender’s statement. Leave it at zero if the whole payment reduces the loan.',
    },
    picks: ['loan', 'money'],
    lines: [
      { role: 'loan',             side: 'debit',  amount: 'principal', whenPositive: true },
      { role: 'interest_expense', side: 'debit',  amount: 'interest',  whenInterest: true },
      { role: 'money',            side: 'credit', amount: 'total' },
    ],
  },
  {
    code: 'TRANSFER',
    ledger: 'Transfer between accounts',
    group: 'move',
    icon: 'ArrowLeftRight',
    name: 'I moved money between the business’s own accounts',
    blurb: 'Bank to M-Pesa, till to bank. Nothing is earned or spent — the money only changes place.',
    entryType: 'general',
    picks: ['money', 'money_to'],
    lines: [
      { role: 'money_to', side: 'debit',  amount: 'total' },
      { role: 'money',    side: 'credit', amount: 'total' },
    ],
  },
];

export const recipeByCode = (code) => RECIPES.find((r) => r.code === code) || null;

/**
 * Every role this recipe needs an account for, given the choices made so far.
 *
 * The VAT role only appears once there is VAT to post, and the interest
 * account only once a repayment actually carries interest. Asking for either
 * up front would put an accounting question in front of someone who does not
 * have that part of the transaction at all.
 */
export const rolesForRecipe = (recipe, { axisOption = null, hasTax = false, hasInterest = false } = {}) => {
  if (!recipe) return [];
  const axis = AXES[recipe.axis];
  const chosen = axis ? (axis.options.find((o) => o.key === axisOption) || axis.options[0]) : null;

  const roles = [];
  for (const line of recipe.lines) {
    const role = line.role === '@axis' ? chosen?.role : line.role;
    if (!role) continue;
    if (line.whenTax && !hasTax) continue;
    if (line.whenInterest && !hasInterest) continue;
    if (!roles.includes(role)) roles.push(role);
  }
  return roles;
};

// ─────────────────────────────────────────────────────────────────────────────
// BUILDING THE ENTRY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Turn a recipe plus the user's answers into journal lines.
 *
 * `accounts` maps a role to the chart row chosen for it. The return shape is
 * what `postJournalEntry` already takes, so the simplified path and the manual
 * composer post through the same code and land in the same ledger.
 *
 * The balance check at the end is not defensive padding. A recipe whose lines
 * did not add up would post a silently lopsided entry that the database
 * accepts and the trial balance then carries for ever, so it fails here.
 */
export const buildRecipeEntry = ({ recipe, accounts = {}, amounts, axisOption = null } = {}) => {
  if (!recipe) throw new Error('Choose what kind of transaction this was');
  const amt = amounts || splitAmount({ amount: 0 });
  if (!(amt.total > 0)) throw new Error('Enter an amount greater than zero');

  const axis = AXES[recipe.axis];
  const chosen = axis ? (axis.options.find((o) => o.key === axisOption) || axis.options[0]) : null;

  const lines = [];
  for (const spec of recipe.lines) {
    const role = spec.role === '@axis' ? chosen?.role : spec.role;
    if (!role) continue;
    if (spec.whenTax && !(amt.tax > 0)) continue;
    if (spec.whenInterest && !(amt.interest > 0)) continue;

    const value = round2(amt[spec.amount]);
    if (!(value > 0)) continue;

    const account = accounts[role];
    if (!account) throw new Error(`Choose an account for: ${ROLES[role]?.question || role}`);

    lines.push({
      role,
      account: accountLabel(account),
      debit:  spec.side === 'debit'  ? value : 0,
      credit: spec.side === 'credit' ? value : 0,
    });
  }

  const totalDr = round2(lines.reduce((s, l) => s + l.debit, 0));
  const totalCr = round2(lines.reduce((s, l) => s + l.credit, 0));
  if (totalDr <= 0) throw new Error('Enter an amount greater than zero');
  if (totalDr !== totalCr) {
    throw new Error(`This does not balance (${totalDr} against ${totalCr}). Nothing has been posted.`);
  }

  return { lines, totalDr, totalCr };
};

// ─────────────────────────────────────────────────────────────────────────────
// THE PLAIN-ENGLISH READBACK
// ─────────────────────────────────────────────────────────────────────────────
//
// Derived from the role and the side rather than written out per recipe, so a
// recipe cannot describe itself as doing one thing while posting another.

const PHRASE = {
  money:            { debit: (n) => `${n} arrives in`, credit: (n) => `${n} leaves` },
  money_to:         { debit: (n) => `${n} arrives in`, credit: (n) => `${n} leaves` },
  receivable:       { debit: (n) => `${n} is now owed to you, held in`,  credit: (n) => `${n} less is owed to you in` },
  payable:          { debit: (n) => `${n} less is owed by you in`,       credit: (n) => `${n} is now owed by you, held in` },
  inventory:        { debit: (n) => `${n} of stock is added to`,         credit: (n) => `${n} of stock leaves` },
  fixed_asset:      { debit: (n) => `${n} is added to`,                  credit: (n) => `${n} leaves` },
  expense:          { debit: (n) => `${n} is recorded as a cost in`,     credit: (n) => `${n} is taken back off` },
  revenue:          { debit: (n) => `${n} is taken back off`,            credit: (n) => `${n} is recorded as income in` },
  equity:           { debit: (n) => `${n} reduces the owner’s stake in`, credit: (n) => `${n} increases the owner’s stake in` },
  drawings:         { debit: (n) => `${n} is drawn by the owner, recorded in`, credit: (n) => `${n} is returned by the owner to` },
  loan:             { debit: (n) => `${n} is paid off the loan in`,      credit: (n) => `${n} is added to the loan in` },
  interest_expense: { debit: (n) => `${n} is the cost of borrowing, recorded in`, credit: (n) => `${n} is taken back off` },
  vat_input:        { debit: (n) => `${n} of VAT becomes reclaimable in`, credit: (n) => `${n} of reclaimable VAT is reversed in` },
  vat_output:       { debit: (n) => `${n} of VAT owed is reversed in`,    credit: (n) => `${n} of VAT is now owed to KRA in` },
};

/**
 * What the entry does, in sentences a non-accountant can check.
 *
 * This is what replaces the safeguard a debit/credit grid gave an accountant.
 * They could see a wrong entry in the sides; this user sees it in the words.
 * "10,000 leaves M-Pesa Till" is wrong in a way anybody spots. "Cr 1002" is
 * not.
 */
export const describeEntry = ({ lines = [], money = (n) => String(n) } = {}) =>
  lines.map((l) => {
    const phrase = PHRASE[l.role]?.[l.debit > 0 ? 'debit' : 'credit'];
    const value = money(l.debit > 0 ? l.debit : l.credit);
    const name = accountNameOf(l.account);
    return phrase ? `${phrase(value)} ${name}.` : `${value} to ${name}.`;
  });
