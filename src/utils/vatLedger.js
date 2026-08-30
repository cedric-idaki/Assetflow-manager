/**
 * VAT FROM THE LEDGER (pure functions)
 *
 * Input VAT used to be `outputVAT * 0.4` — a hardcoded assumption that no
 * purchase ever touched. Net VAT payable is output less input, so that one
 * constant decided the tax figure the VAT panel put in front of a user, and it
 * was wrong by construction for every business that has ever existed.
 *
 * VAT is already in the ledger, because a VAT-registered purchase posts as:
 *
 *     Dr  Expense / Asset      net
 *     Dr  Input VAT           tax        <- reclaimable from KRA
 *         Cr  Cash / Payable  gross
 *
 * and a sale posts the mirror, crediting an output VAT liability. So input VAT
 * is the debit balance on the input-VAT account and output VAT is the credit
 * balance on the output-VAT account. No estimate required — only the ability to
 * tell the two accounts apart.
 *
 * WHY THAT NEEDS A CLASSIFIER
 *
 * The chart of accounts is tenant-defined free text: one company writes "Input
 * VAT", another "VAT Receivable", another "VAT — Purchases". The old code
 * tested `credit_account.includes('VAT')`, which counts a credit to INPUT VAT
 * (what happens when the account is cleared at period end) as output VAT, and
 * inflates the liability. Accounts are classified by role here instead, with
 * the account TYPE breaking ties when the name alone is ambiguous.
 *
 * WHEN NOTHING IS FOUND
 *
 * A tenant with no input-VAT account, or one who posts purchases without
 * splitting the tax out, gets input VAT of zero — which is the truthful answer
 * ("nothing reclaimable has been recorded"), not a failure. `diagnostics` says
 * which of those it is so the UI can tell the user what to do about it, rather
 * than showing a confident zero or, worse, a made-up number.
 */

/** A VAT account at all? */
const VAT_TOKEN = /\bvat\b|value[\s-]*added[\s-]*tax/i;

// Role hints, checked against the account name.
const INPUT_HINT  = /\b(input|purchase[sd]?|recoverable|claimable|receivable|deductible|incurred)\b/i;
const OUTPUT_HINT = /\b(output|payable|sale[s]?|collected|charged|due)\b/i;

const ASSET_TYPES     = ['current_asset', 'non_current_asset'];
const LIABILITY_TYPES = ['current_liability', 'non_current_liability', 'equity'];

/**
 * Classify one account as the input or output side of VAT.
 *
 * Takes either a chart_of_accounts row or a bare account name — journal lines
 * carry only the name, and a tenant can post to an account that was never added
 * to the chart.
 *
 * Returns 'input', 'output', or null (not a VAT account, or too ambiguous to
 * place — which is reported rather than guessed at).
 */
export const classifyVatAccount = (account) => {
  const name = typeof account === 'string' ? account : (account?.account_name || '');
  if (!name || !VAT_TOKEN.test(name)) return null;

  const isInput  = INPUT_HINT.test(name);
  const isOutput = OUTPUT_HINT.test(name);
  // "Input VAT" vs "VAT Payable" — an unambiguous name settles it outright.
  if (isInput && !isOutput) return 'input';
  if (isOutput && !isInput) return 'output';

  // Ambiguous ("VAT Control") or contradictory ("VAT Receivable Payable"): the
  // account's own type is the better evidence. VAT you can reclaim is an asset;
  // VAT you owe is a liability.
  const type = typeof account === 'string' ? '' : (account?.account_type || '');
  if (ASSET_TYPES.includes(type))     return 'input';
  if (LIABILITY_TYPES.includes(type)) return 'output';

  return null;
};

/** Index every VAT account in the chart by name, so journal lines can be looked up. */
export const vatAccountIndex = (chartOfAccounts = []) => {
  const index = {};
  const unclassified = [];
  for (const account of chartOfAccounts) {
    const name = account?.account_name;
    if (!name || !VAT_TOKEN.test(name)) continue;
    const role = classifyVatAccount(account);
    if (role) index[name] = role;
    else unclassified.push(name);
  }
  return { index, unclassified };
};

const amountOf = (j) => parseFloat(j?.amount || 0) || 0;

/**
 * Build the VAT return for a period from posted journal entries.
 *
 * `period` is 'YYYY-MM'; omit it to compute over everything supplied. A return
 * is filed for a period, so the caller normally passes one — the panel used to
 * label its figures with a month while summing all time.
 *
 * Both sides are computed NET of their own reversals: a credit note debits the
 * output VAT it originally credited, and a returned purchase credits back the
 * input VAT it claimed. Counting only one direction leaves both figures
 * overstated the moment anything is reversed.
 */
export const computeVatReturn = ({
  journals = [],
  chartOfAccounts = [],
  period = null,
  rate = 0.16,
} = {}) => {
  const { index, unclassified } = vatAccountIndex(chartOfAccounts);

  // A journal line can name an account that was never added to the chart, so
  // fall back to classifying the bare name.
  const roleOf = (accountName) => {
    if (!accountName) return null;
    return index[accountName] ?? classifyVatAccount(accountName);
  };

  const inPeriod = (j) => !period || String(j.entry_date || '').slice(0, 7) === period;
  const posted = journals.filter(j => j.status === 'posted' && inPeriod(j));

  let outputVAT = 0;
  let inputVAT = 0;
  const outputEntries = [];
  const inputEntries = [];

  for (const j of posted) {
    const amount = amountOf(j);
    if (!amount) continue;

    const debitRole  = roleOf(j.debit_account);
    const creditRole = roleOf(j.credit_account);

    // Output VAT is a credit balance: credits raise it, debits (credit notes,
    // period-end clearing) reduce it.
    if (creditRole === 'output') { outputVAT += amount; outputEntries.push(j); }
    if (debitRole  === 'output') { outputVAT -= amount; outputEntries.push(j); }

    // Input VAT is a debit balance: the mirror image.
    if (debitRole  === 'input') { inputVAT += amount; inputEntries.push(j); }
    if (creditRole === 'input') { inputVAT -= amount; inputEntries.push(j); }

    // An automated sale posts VAT even where the account name is not one the
    // chart knows about. This is a safety net for that path only — and it must
    // not double count an entry already picked up by its account name above.
    if (j.trigger_event === 'vat_on_cash_sale' && creditRole !== 'output' && debitRole !== 'output') {
      outputVAT += amount;
      outputEntries.push(j);
    }
  }

  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  outputVAT = round2(outputVAT);
  inputVAT  = round2(inputVAT);

  return {
    period,
    rate,
    outputVAT,
    inputVAT,
    netVAT: round2(outputVAT - inputVAT),
    // The tax-exclusive value the VAT was charged on. Derived from the tax at
    // the standard rate, so it is only meaningful where everything is standard
    // rated — the panel labels it as such.
    taxableSales: rate > 0 ? round2(outputVAT / rate) : 0,
    taxablePurchases: rate > 0 ? round2(inputVAT / rate) : 0,

    diagnostics: {
      // Distinguishes "no input VAT account exists" from "one exists but
      // nothing was posted to it this period" — different problems, different
      // fixes, and a bare zero tells the user neither.
      hasInputVatAccount: Object.values(index).includes('input'),
      hasOutputVatAccount: Object.values(index).includes('output'),
      inputEntryCount: inputEntries.length,
      outputEntryCount: outputEntries.length,
      // Accounts whose name says VAT but whose role could not be established.
      // Anything here is silently missing from the return until it is renamed
      // or given a type, so the UI names them rather than dropping them.
      unclassifiedAccounts: unclassified,
    },
    entries: { output: outputEntries, input: inputEntries },
  };
};
