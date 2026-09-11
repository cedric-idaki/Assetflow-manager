/**
 * RECORD A TRANSACTION — the Finance Hub without debits and credits.
 *
 * The Journal Entries tab asks for an account, a debit column and a credit
 * column. That is the right way to store a transaction and the wrong way to
 * ask for one, so this tab asks the question the user can actually answer —
 * "what happened?" — and derives the double entry from the answer.
 *
 * THREE THINGS THIS HAS TO GET RIGHT
 *
 * 1. It must not become a second ledger. Every entry posted here goes through
 *    the same `postJournalEntry` the manual composer uses, in the same account
 *    string format, so it appears in the same Journal Ledger, reverses the
 *    same way and reaches the statements by the same path. Nothing downstream
 *    can tell the two composers apart, which is the point.
 *
 * 2. It must not hide the entry, only the jargon. A user who cannot check
 *    debits and credits has lost the one safeguard an accountant had, so the
 *    entry is read back in plain sentences before it is posted — "11,600
 *    leaves M-Pesa Till" is wrong in a way anybody can spot. The debit/credit
 *    view is still there, one click away, for whoever audits the books later.
 *
 * 3. It must not dead-end on an empty chart. A company builds its own chart of
 *    accounts, so a recipe can need an account this tenant has never created.
 *    That offers to create the account inline rather than refusing to post.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { S, Empty, toast, fmt } from './_shared';
import { vatRateOn } from '../../../config/taxRegulations';
import {
  RECIPES, GROUPS, ROLES, AXES, VAT_TREATMENTS,
  recipeByCode, rolesForRecipe, candidatesForRole, suggestedAccountFor,
  splitAmount, buildRecipeEntry, describeEntry,
} from '../../../config/transactionRecipes';

const todayISO = () => new Date().toISOString().split('T')[0];
const blankForm = () => ({ amount: '', date: todayISO(), party: '', reference: '', description: '' });

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — what happened?
// ─────────────────────────────────────────────────────────────────────────────
const RecipePicker = ({ onPick }) => (
  <div className="space-y-5">
    {GROUPS.map((group) => {
      const list = RECIPES.filter((r) => r.group === group.key);
      if (list.length === 0) return null;
      return (
        <div key={group.key} className={S.panel}>
          <div className={S.header}>
            <div className="flex items-center gap-2">
              <Icon name={group.icon} size={16} color="var(--color-primary)" />
              <span className="font-semibold text-foreground">{group.label}</span>
            </div>
          </div>
          <div className={`${S.body} grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3`}>
            {list.map((r) => (
              <button
                key={r.code}
                onClick={() => onPick(r.code)}
                className="text-left p-4 rounded-xl border border-border hover:border-primary/50 hover:bg-muted/40 transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                    <Icon name={r.icon} size={16} color="var(--color-primary)" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{r.name}</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{r.blurb}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      );
    })}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// One question about one account
// ─────────────────────────────────────────────────────────────────────────────
const AccountQuestion = ({ role, options, value, onChange, onCreate, creating }) => {
  const meta = ROLES[role];
  if (!meta) return null;

  // Nothing in this tenant's chart can play the role. Refusing to post here
  // would leave the user with a question they cannot answer and no way
  // forward, so the account they are missing is offered instead.
  if (options.length === 0) {
    const suggestion = onCreate?.suggestion;
    return (
      <div className="p-3 rounded-lg border border-amber-200 bg-amber-50/60 dark:bg-amber-900/15 dark:border-amber-800">
        <p className={S.label}>{meta.question}</p>
        <p className="text-xs text-muted-foreground mb-2">
          Your chart of accounts has nothing that fits. {meta.hint}
        </p>
        {suggestion && (
          <button className={S.btnSec} onClick={onCreate.run} disabled={creating}>
            <Icon name={creating ? 'Loader' : 'Plus'} size={13} color="currentColor" className={creating ? 'animate-spin' : ''} />
            {creating ? 'Creating…' : `Create "${suggestion.account_code} — ${suggestion.account_name}"`}
          </button>
        )}
      </div>
    );
  }

  const id = `rt-role-${role}`;
  return (
    <div>
      <label className={S.label} htmlFor={id}>{meta.question}</label>
      <select id={id} className={`${S.input} ${S.select}`} value={value || ''} onChange={(e) => onChange(e.target.value)}>
        {options.map((a) => (
          <option key={a.account_code} value={a.account_code}>{a.account_name}</option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground mt-1">{meta.hint}</p>
    </div>
  );
};

/** A two-option answer rendered as buttons, not a dropdown — it is a fork, not a list. */
const Choice = ({ question, options, value, onChange, hintOf }) => (
  <div role="group" aria-label={question}>
    <p className={S.label}>{question}</p>
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = value === o.key;
        return (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            className={`px-3 py-2 rounded-lg text-sm font-medium border transition-all ${
              active
                ? 'border-primary text-primary bg-primary/10'
                : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
    {hintOf?.(value) && <p className="text-xs text-muted-foreground mt-1">{hintOf(value)}</p>}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — the details, and the readback
// ─────────────────────────────────────────────────────────────────────────────
const RecordTransactionTab = ({ chartOfAccounts = [], loading, onPost, onAddAccount, onSeeJournal }) => {
  const [code, setCode] = useState(null);
  const [axisOption, setAxisOption] = useState(null);
  const [treatment, setTreatment] = useState('none');
  const [interest, setInterest] = useState('');
  const [form, setForm] = useState(blankForm);
  const [picked, setPicked] = useState({});
  const [touchedDescription, setTouchedDescription] = useState(false);
  const [showLedgerView, setShowLedgerView] = useState(false);
  const [posting, setPosting] = useState(false);
  const [creating, setCreating] = useState(null);

  const recipe = recipeByCode(code);

  // The rate is resolved from the transaction's OWN date, not today's. A
  // September entry typed in October is charged at September's rate.
  const rate = recipe?.vat ? vatRateOn(form.date) : 0;

  const amounts = useMemo(
    () => splitAmount({
      amount: form.amount,
      treatment,
      rate,
      interest: recipe?.interest ? interest : 0,
    }),
    [form.amount, treatment, rate, interest, recipe],
  );

  const roles = useMemo(
    () => rolesForRecipe(recipe, {
      axisOption,
      hasTax: amounts.tax > 0,
      hasInterest: amounts.interest > 0,
    }),
    [recipe, axisOption, amounts.tax, amounts.interest],
  );

  const optionsByRole = useMemo(() => Object.fromEntries(
    roles.map((role) => [role, candidatesForRole(role, chartOfAccounts)]),
  ), [roles, chartOfAccounts]);

  // The chosen account per role: what the user picked, or the best candidate.
  // A role the user has not been asked about still resolves, so VAT and
  // interest accounts fill themselves in without an accounting question.
  const accounts = useMemo(() => {
    const out = {};
    for (const role of roles) {
      const list = optionsByRole[role] || [];
      out[role] = list.find((a) => a.account_code === picked[role]) || list[0] || null;
    }
    return out;
  }, [roles, optionsByRole, picked]);

  // Roles the user is asked about: the recipe's own picks plus whichever side
  // of the axis they chose. VAT and interest are resolved silently and shown
  // in the readback instead.
  const askedRoles = useMemo(() => {
    if (!recipe) return [];
    const axis = AXES[recipe.axis];
    const chosen = axis?.options.find((o) => o.key === axisOption) || axis?.options[0];
    return roles.filter((role) => recipe.picks.includes(role) || role === chosen?.role);
  }, [recipe, roles, axisOption]);

  const missingRoles = roles.filter((role) => !accounts[role]);

  let entry = null;
  let entryError = null;
  try {
    if (recipe && amounts.total > 0 && missingRoles.length === 0) {
      entry = buildRecipeEntry({ recipe, accounts, amounts, axisOption });
    }
  } catch (e) { entryError = e.message; }

  const defaultDescription = useMemo(() => {
    if (!recipe) return '';
    return [recipe.ledger, form.party.trim()].filter(Boolean).join(' — ');
  }, [recipe, form.party]);

  const description = touchedDescription ? form.description : defaultDescription;

  const reset = useCallback(() => {
    setCode(null); setAxisOption(null); setTreatment('none'); setInterest('');
    setForm(blankForm()); setPicked({}); setTouchedDescription(false); setShowLedgerView(false);
  }, []);

  const pickRecipe = (nextCode) => {
    const next = recipeByCode(nextCode);
    setCode(nextCode);
    setAxisOption(AXES[next?.axis]?.options[0]?.key || null);
    setTreatment('none');
    setInterest('');
    setPicked({});
    setTouchedDescription(false);
    setShowLedgerView(false);
    setForm((p) => ({ ...blankForm(), date: p.date }));
  };

  // A role whose account was just created has to become the selected one, or
  // the user creates an account and the question still looks unanswered.
  const createFor = (role) => async () => {
    const suggestion = suggestedAccountFor(role, chartOfAccounts);
    if (!suggestion) return;
    setCreating(role);
    try {
      const created = await onAddAccount(suggestion);
      setPicked((p) => ({ ...p, [role]: created?.account_code || suggestion.account_code }));
      toast(`Added ${suggestion.account_code} — ${suggestion.account_name} to your chart of accounts`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setCreating(null); }
  };

  const handlePost = async () => {
    if (!entry) { toast(entryError || 'Fill in the amount and the accounts first', 'error'); return; }
    if (!description.trim()) { toast('Describe what the transaction was for', 'error'); return; }
    setPosting(true);
    try {
      await onPost({
        date: form.date,
        description: description.trim(),
        reference: form.reference.trim() || null,
        entryType: recipe.entryType,
        lines: entry.lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit })),
      });
      toast(`${recipe.ledger} recorded — ${fmt(entry.totalDr)}`, 'success');
      reset();
    } catch (e) { toast(e.message, 'error'); }
    finally { setPosting(false); }
  };

  // Esc backs out of a half-filled transaction, which is the one thing a user
  // who picked the wrong card will reach for.
  useEffect(() => {
    if (!code) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !posting) reset(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [code, posting, reset]);

  if (loading) {
    return (
      <div className={S.panel}>
        <div className={S.body}><Empty icon="Loader" text="Loading your accounts…" /></div>
      </div>
    );
  }

  if (!recipe) {
    return (
      <div className="space-y-5">
        <div className="flex items-start gap-3 p-4 rounded-xl border border-border bg-muted/30">
          <Icon name="Sparkles" size={18} color="var(--color-primary)" />
          <div>
            <p className="text-sm font-semibold text-foreground">Pick what happened. The bookkeeping is worked out for you.</p>
            <p className="text-xs text-muted-foreground mt-1">
              You never have to decide what is a debit and what is a credit. Every transaction recorded here
              lands in the same journal as everything else, and you can see the full double entry before posting.
            </p>
          </div>
        </div>
        {chartOfAccounts.length === 0 && (
          <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-200 bg-amber-50/60 dark:bg-amber-900/15 dark:border-amber-800">
            <Icon name="AlertTriangle" size={18} color="#d97706" />
            <div>
              <p className="text-sm font-semibold text-foreground">Your chart of accounts is empty</p>
              <p className="text-xs text-muted-foreground mt-1">
                You can still start here — each transaction offers to create the accounts it needs as you go.
              </p>
            </div>
          </div>
        )}
        <RecipePicker onPick={pickRecipe} />
      </div>
    );
  }

  const axis = AXES[recipe.axis];
  const sentences = entry ? describeEntry({ lines: entry.lines, money: fmt }) : [];

  return (
    <div className="space-y-5">
      {/* What we are recording */}
      <div className={S.panel}>
        <div className={S.header}>
          <div className="flex items-center gap-2 min-w-0">
            <Icon name={recipe.icon} size={16} color="var(--color-primary)" />
            <span className="font-semibold text-foreground truncate">{recipe.name}</span>
          </div>
          <button className={S.btnGhost} onClick={reset} disabled={posting}>
            <Icon name="ArrowLeft" size={13} color="currentColor" /> Something else
          </button>
        </div>

        <div className={`${S.body} space-y-4`}>
          <p className="text-xs text-muted-foreground">{recipe.blurb}</p>

          {axis && (
            <Choice
              question={axis.question}
              options={axis.options}
              value={axisOption || axis.options[0].key}
              onChange={(key) => { setAxisOption(key); setPicked({}); }}
            />
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className={S.label} htmlFor="rt-amount">Amount (KES) *</label>
              <input
                id="rt-amount"
                type="number" step="0.01" min="0" inputMode="decimal"
                className={`${S.input} font-mono`} placeholder="0.00"
                value={form.amount}
                onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
              />
            </div>
            <div>
              <label className={S.label} htmlFor="rt-date">Date *</label>
              <input
                id="rt-date"
                type="date" className={S.input} value={form.date}
                onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
              />
            </div>
            {recipe.party && (
              <div>
                <label className={S.label} htmlFor="rt-party">{recipe.party.label}</label>
                <input
                  id="rt-party"
                  className={S.input} placeholder={recipe.party.placeholder}
                  value={form.party}
                  onChange={(e) => setForm((p) => ({ ...p, party: e.target.value }))}
                />
              </div>
            )}
          </div>

          {recipe.vat && rate > 0 && (
            <div>
              <Choice
                question={`Was VAT charged on this? (${rate}%)`}
                options={VAT_TREATMENTS}
                value={treatment}
                onChange={setTreatment}
                hintOf={(key) => VAT_TREATMENTS.find((t) => t.key === key)?.hint}
              />
              {amounts.tax > 0 && (
                <div className="flex flex-wrap gap-4 mt-2 text-xs">
                  <span className="text-muted-foreground">Before VAT <b className="font-mono text-foreground">{fmt(amounts.net)}</b></span>
                  <span className="text-muted-foreground">VAT <b className="font-mono text-foreground">{fmt(amounts.tax)}</b></span>
                  <span className="text-muted-foreground">Total <b className="font-mono text-foreground">{fmt(amounts.total)}</b></span>
                </div>
              )}
            </div>
          )}

          {recipe.interest && (
            <div className="md:max-w-sm">
              <label className={S.label} htmlFor="rt-interest">{recipe.interest.label}</label>
              <input
                id="rt-interest"
                type="number" step="0.01" min="0" inputMode="decimal"
                className={`${S.input} font-mono`} placeholder="0.00"
                value={interest}
                onChange={(e) => setInterest(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">{recipe.interest.hint}</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {askedRoles.map((role) => (
              <AccountQuestion
                key={role}
                role={role}
                options={optionsByRole[role] || []}
                value={accounts[role]?.account_code}
                onChange={(value) => setPicked((p) => ({ ...p, [role]: value }))}
                onCreate={{ suggestion: suggestedAccountFor(role, chartOfAccounts), run: createFor(role) }}
                creating={creating === role}
              />
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className={S.label} htmlFor="rt-description">Description *</label>
              <input
                id="rt-description"
                className={S.input} placeholder="What this transaction was for…"
                value={description}
                onChange={(e) => { setTouchedDescription(true); setForm((p) => ({ ...p, description: e.target.value })); }}
              />
            </div>
            <div>
              <label className={S.label} htmlFor="rt-reference">Reference / Doc #</label>
              <input
                id="rt-reference"
                className={S.input} placeholder="Receipt or M-Pesa code…"
                value={form.reference}
                onChange={(e) => setForm((p) => ({ ...p, reference: e.target.value }))}
              />
            </div>
          </div>
        </div>
      </div>

      {/* The readback — the safeguard that replaces reading debits and credits */}
      <div className={S.panel}>
        <div className={S.header}>
          <div className="flex items-center gap-2">
            <Icon name="Eye" size={16} color="var(--color-primary)" />
            <span className="font-semibold text-foreground">What this will record</span>
          </div>
          {entry && (
            <button className={S.btnGhost} onClick={() => setShowLedgerView((v) => !v)}>
              <Icon name={showLedgerView ? 'ChevronUp' : 'ChevronDown'} size={13} color="currentColor" />
              {showLedgerView ? 'Hide the accounting view' : 'Show the accounting view'}
            </button>
          )}
        </div>
        <div className={S.body}>
          {!entry ? (
            <p className="text-sm text-muted-foreground">
              {entryError
                || (missingRoles.length > 0
                  ? 'Create the missing account above and this will fill itself in.'
                  : 'Enter an amount to see what will be recorded.')}
            </p>
          ) : (
            <>
              <ul className="space-y-2">
                {sentences.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                    <Icon name="CornerDownRight" size={14} color="var(--color-muted-foreground)" className="mt-0.5 flex-shrink-0" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>

              {showLedgerView && (
                <div className="mt-4 border border-border rounded-lg overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th className={S.th}>Account</th>
                        <th className={`${S.th} w-40 text-right`}>Debit</th>
                        <th className={`${S.th} w-40 text-right`}>Credit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entry.lines.map((l, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className={S.tdFirst}>{l.account}</td>
                          <td className={`${S.td} text-right font-mono ${l.debit > 0 ? 'text-emerald-600' : 'text-muted-foreground/40'}`}>
                            {l.debit > 0 ? fmt(l.debit) : '—'}
                          </td>
                          <td className={`${S.td} text-right font-mono ${l.credit > 0 ? 'text-red-500' : 'text-muted-foreground/40'}`}>
                            {l.credit > 0 ? fmt(l.credit) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-border bg-muted/40">
                        <td className="px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Totals</td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-emerald-600">{fmt(entry.totalDr)}</td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-red-500">{fmt(entry.totalCr)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 mt-5">
                <button className={S.btnPri} onClick={handlePost} disabled={posting}>
                  {posting
                    ? <><Icon name="Loader" size={14} color="currentColor" className="animate-spin" /> Recording…</>
                    : <><Icon name="CheckCircle" size={14} color="currentColor" /> Record this transaction</>}
                </button>
                <button className={S.btnSec} onClick={reset} disabled={posting}>Cancel</button>
                {onSeeJournal && (
                  <button className={S.btnGhost} onClick={onSeeJournal}>
                    <Icon name="BookOpen" size={13} color="currentColor" /> Open the journal
                  </button>
                )}
                <span className="text-xs text-muted-foreground">
                  Posted entries are never edited. A mistake is corrected with a reversal in the journal.
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default RecordTransactionTab;
