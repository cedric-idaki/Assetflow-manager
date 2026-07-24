/**
 * useSaccoFinance
 *
 * Data + mutations for the SACCO/Chama accounting engine that backs the Sacco
 * branch of the Finance Hub. Every write goes through the database posting
 * engine (public.sacco_post_journal) so the §10.2 rules hold no matter what the
 * UI does: entries must balance, accounts must exist in the society's chart,
 * and closed periods reject postings.
 *
 * SACCO/CHAMA ONLY — companies keep using useFinanceHub.js against
 * chart_of_accounts / journal_entries. Nothing here reads those tables.
 *
 * Operational data (members, contributions, loans, schedules, shares) is NOT
 * fetched here — the caller passes it in from SaccoDashboardContext, which
 * already has it loaded and live.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import {
  runProvisioning,
  computeLoanInterestAccrual,
  computeDepositInterestAccrual,
  computeDepreciation,
  buildAppropriation,
  outstandingPrincipal,
  indexTrialBalance,
  sumBalances,
  round2,
} from '../utils/saccoAccounting';

const getUserId = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id || null;
};

/**
 * The owning tenant, resolved exactly the way public.current_admin_id() does it
 * server-side, so the client filter and the RLS policy always agree.
 */
const getAdminId = async () => {
  const uid = await getUserId();
  if (!uid) return null;
  const { data } = await supabase.from('user_profiles').select('admin_id').eq('id', uid).maybeSingle();
  return data?.admin_id || uid;
};

// Which template an operational row posts through.
const contributionTemplate = (type = '') => {
  const t = String(type).toLowerCase();
  if (t.includes('share'))                        return 'MEMBER_SHARE_PURCHASE';
  if (t.includes('welfare') || t.includes('benevolent')) return 'WELFARE_CONTRIBUTION';
  if (t.includes('registration') || t.includes('membership')) return 'MEMBERSHIP_FEE';
  if (t.includes('merry') || t.includes('round'))  return 'MGR_CONTRIBUTION';
  return 'SAVINGS_DEPOSIT';
};

export const useSaccoFinance = (sacco) => {
  const saccoId = sacco?.id || null;

  const [config,             setConfig]             = useState(null);
  const [coa,                setCoa]                = useState([]);
  const [periods,            setPeriods]            = useState([]);
  const [templates,          setTemplates]          = useState([]);
  const [entries,            setEntries]            = useState([]);
  const [provisionPolicy,    setProvisionPolicy]    = useState([]);
  const [appropriationRules, setAppropriationRules] = useState([]);
  const [classifications,    setClassifications]    = useState([]);
  const [fixedAssets,        setFixedAssets]        = useState([]);
  const [mgrCycles,          setMgrCycles]          = useState([]);
  const [mgrContributions,   setMgrContributions]   = useState([]);
  const [welfareClaims,      setWelfareClaims]      = useState([]);

  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const saccoIdRef = useRef(null);
  useEffect(() => { saccoIdRef.current = saccoId; }, [saccoId]);

  // Cached so every fetcher scopes to the tenant without a round-trip each time.
  const adminIdRef = useRef(null);
  const adminId = useCallback(async () => {
    if (!adminIdRef.current) adminIdRef.current = await getAdminId();
    return adminIdRef.current;
  }, []);

  const isSeeded = !!config?.coa_seeded_at && coa.length > 0;

  // ── Fetchers ──────────────────────────────────────────────────────────────
  const fetchConfig = useCallback(async () => {
    const { data } = await supabase.from('sacco_society_config').select('*')
      .eq('admin_id', await adminId()).maybeSingle();
    setConfig(data || null);
    return data;
  }, [adminId]);

  const fetchCoa = useCallback(async () => {
    const { data } = await supabase.from('sacco_chart_of_accounts').select('*')
      .eq('admin_id', await adminId()).order('account_code');
    setCoa(data || []);
    return data || [];
  }, [adminId]);

  const fetchPeriods = useCallback(async () => {
    const { data } = await supabase.from('sacco_fiscal_periods').select('*')
      .eq('admin_id', await adminId())
      .order('start_date', { ascending: false });
    setPeriods(data || []);
    return data || [];
  }, [adminId]);

  const fetchTemplates = useCallback(async () => {
    const { data } = await supabase.from('sacco_journal_templates').select('*')
      .eq('admin_id', await adminId())
      .eq('is_active', true).order('sort_order');
    setTemplates(data || []);
    return data || [];
  }, [adminId]);

  const fetchEntries = useCallback(async () => {
    const { data } = await supabase.from('sacco_journal_entries')
      .select('*, lines:sacco_journal_lines(*), member:sacco_members(full_name, member_no)')
      .eq('admin_id', await adminId())
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1000);
    const rows = (data || []).map((e) => ({
      ...e,
      lines: [...(e.lines || [])].sort((a, b) => (a.line_no || 0) - (b.line_no || 0)),
    }));
    setEntries(rows);
    return rows;
  }, []);

  const fetchPolicies = useCallback(async () => {
    const [{ data: prov }, { data: appr }] = await Promise.all([
      supabase.from('sacco_provision_policy').select('*').order('sort_order'),
      supabase.from('sacco_appropriation_rules').select('*').order('sort_order'),
    ]);
    setProvisionPolicy(prov || []);
    setAppropriationRules(appr || []);
    return { prov: prov || [], appr: appr || [] };
  }, []);

  const fetchClassifications = useCallback(async () => {
    const { data } = await supabase.from('sacco_loan_classifications')
      .select('*, member:sacco_members(full_name, member_no)')
      .order('created_at', { ascending: false }).limit(1000);
    setClassifications(data || []);
    return data || [];
  }, []);

  const fetchFixedAssets = useCallback(async () => {
    const { data } = await supabase.from('sacco_fixed_assets').select('*')
      .order('acquisition_date', { ascending: false });
    setFixedAssets(data || []);
    return data || [];
  }, []);

  const fetchChama = useCallback(async () => {
    const [{ data: cycles }, { data: contribs }, { data: claims }] = await Promise.all([
      supabase.from('sacco_mgr_cycles')
        .select('*, beneficiary:sacco_members!beneficiary_member_id(full_name, member_no)')
        .order('cycle_no', { ascending: false }),
      supabase.from('sacco_mgr_contributions').select('*'),
      supabase.from('sacco_welfare_claims')
        .select('*, member:sacco_members(full_name, member_no)')
        .order('claim_date', { ascending: false }),
    ]);
    setMgrCycles(cycles || []);
    setMgrContributions(contribs || []);
    setWelfareClaims(claims || []);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([
        fetchConfig(), fetchCoa(), fetchPeriods(), fetchTemplates(),
        fetchEntries(), fetchPolicies(), fetchClassifications(),
        fetchFixedAssets(), fetchChama(),
      ]);
    } catch (err) {
      setError(err.message || 'Failed to load the accounting ledger');
    } finally {
      setLoading(false);
    }
  }, [fetchConfig, fetchCoa, fetchPeriods, fetchTemplates, fetchEntries,
      fetchPolicies, fetchClassifications, fetchFixedAssets, fetchChama]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Trial balance (§10.3) ─────────────────────────────────────────────────
  const trialBalance = useCallback(async (from = null, to = null) => {
    const { data, error: err } = await supabase.rpc('sacco_trial_balance', { p_from: from, p_to: to });
    if (err) throw err;
    return data || [];
  }, []);

  // ── Setup ─────────────────────────────────────────────────────────────────
  const seedChart = useCallback(async () => {
    if (!saccoIdRef.current) throw new Error('No sacco record found for this account');
    const { error: err } = await supabase.rpc('sacco_fin_seed', { p_sacco_id: saccoIdRef.current });
    if (err) throw err;
    await Promise.all([fetchConfig(), fetchCoa(), fetchTemplates(), fetchPolicies()]);
  }, [fetchConfig, fetchCoa, fetchTemplates, fetchPolicies]);

  const saveConfig = useCallback(async (patch) => {
    const payload = { ...patch, sacco_id: saccoIdRef.current, updated_at: new Date().toISOString() };
    if (config?.id) {
      const { error: err } = await supabase.from('sacco_society_config').update(payload).eq('id', config.id);
      if (err) throw err;
    } else {
      const { error: err } = await supabase.from('sacco_society_config').insert(payload);
      if (err) throw err;
    }
    await fetchConfig();
  }, [config?.id, fetchConfig]);

  const saveProvisionBand = useCallback(async (id, patch) => {
    const { error: err } = await supabase.from('sacco_provision_policy').update(patch).eq('id', id);
    if (err) throw err;
    await fetchPolicies();
  }, [fetchPolicies]);

  const saveAppropriationRule = useCallback(async (id, patch) => {
    const { error: err } = await supabase.from('sacco_appropriation_rules').update(patch).eq('id', id);
    if (err) throw err;
    await fetchPolicies();
  }, [fetchPolicies]);

  // ── Chart of accounts ─────────────────────────────────────────────────────
  const addAccount = useCallback(async (form) => {
    const { error: err } = await supabase.from('sacco_chart_of_accounts').insert({
      sacco_id: saccoIdRef.current,
      account_code:   String(form.account_code).trim(),
      account_name:   form.account_name,
      account_class:  form.account_class,
      normal_balance: form.normal_balance,
      segment:        form.segment || 'both',
      parent_code:    form.parent_code || null,
      is_contra:      !!form.is_contra,
      is_system:      false,
      notes:          form.notes || null,
    });
    if (err) throw err;
    await fetchCoa();
  }, [fetchCoa]);

  const updateAccount = useCallback(async (id, patch) => {
    const { error: err } = await supabase.from('sacco_chart_of_accounts')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (err) throw err;
    await fetchCoa();
  }, [fetchCoa]);

  // ── Periods (§10.4) ───────────────────────────────────────────────────────
  const ensurePeriods = useCallback(async (fiscalYear) => {
    const { error: err } = await supabase.rpc('sacco_ensure_periods', {
      p_sacco_id: saccoIdRef.current, p_fiscal_year: fiscalYear,
    });
    if (err) throw err;
    await fetchPeriods();
  }, [fetchPeriods]);

  const closePeriod = useCallback(async (periodId) => {
    const { error: err } = await supabase.rpc('sacco_close_period', { p_period_id: periodId });
    if (err) throw err;
    await fetchPeriods();
  }, [fetchPeriods]);

  const reopenPeriod = useCallback(async (periodId) => {
    const { error: err } = await supabase.rpc('sacco_reopen_period', { p_period_id: periodId });
    if (err) throw err;
    await fetchPeriods();
  }, [fetchPeriods]);

  const setChecklistItem = useCallback(async (periodId, key, value) => {
    const period = periods.find((p) => p.id === periodId);
    const next = { ...(period?.checklist || {}), [key]: value };
    const { error: err } = await supabase.from('sacco_fiscal_periods')
      .update({ checklist: next }).eq('id', periodId);
    if (err) throw err;
    await fetchPeriods();
  }, [periods, fetchPeriods]);

  // ── Posting engine ────────────────────────────────────────────────────────
  const post = useCallback(async ({
    date, description, lines, templateCode = null, reference = null,
    memberId = null, sourceTable = null, sourceId = null, isAutomated = false, batchRef = null,
  }) => {
    if (!saccoIdRef.current) throw new Error('No sacco record found for this account');
    const { data, error: err } = await supabase.rpc('sacco_post_journal', {
      p_sacco_id:      saccoIdRef.current,
      p_entry_date:    date,
      p_description:   description,
      p_lines:         lines,
      p_template_code: templateCode,
      p_reference:     reference,
      p_member_id:     memberId,
      p_source_table:  sourceTable,
      p_source_id:     sourceId,
      p_is_automated:  isAutomated,
      p_batch_ref:     batchRef,
    });
    if (err) throw err;
    return data;
  }, []);

  /**
   * §10.2 — the UI never picks raw debit/credit accounts. It picks a template
   * and an amount; the template supplies both sides.
   */
  const postFromTemplate = useCallback(async ({
    templateCode, amount, date, description, reference, memberId,
    debitAccount, creditAccount, sourceTable, sourceId, isAutomated, batchRef,
  }) => {
    const tpl = templates.find((t) => t.template_code === templateCode);
    if (!tpl) throw new Error(`Unknown transaction type: ${templateCode}`);
    const dr = debitAccount  || tpl.debit_account;
    const cr = creditAccount || tpl.credit_account;
    const amt = round2(amount);
    if (!(amt > 0)) throw new Error('Amount must be greater than zero');

    const id = await post({
      date, description: description || tpl.name, reference, memberId,
      templateCode, sourceTable, sourceId, isAutomated, batchRef,
      lines: [
        { account_code: dr, debit: amt, credit: 0, member_id: memberId || null },
        { account_code: cr, debit: 0, credit: amt, member_id: memberId || null },
      ],
    });
    await fetchEntries();
    return id;
  }, [templates, post, fetchEntries]);

  const postManual = useCallback(async ({ date, description, reference, memberId, lines }) => {
    const clean = (lines || [])
      .filter((l) => l.account_code && (round2(l.debit) > 0 || round2(l.credit) > 0))
      .map((l) => ({
        account_code: l.account_code,
        debit:  round2(l.debit),
        credit: round2(l.credit),
        member_id: l.member_id || memberId || null,
        memo: l.memo || null,
      }));
    if (clean.length < 2) throw new Error('A journal entry needs at least two lines');
    const id = await post({ date, description, reference, memberId, lines: clean });
    await fetchEntries();
    return id;
  }, [post, fetchEntries]);

  const reverseEntry = useCallback(async (entryId, reason) => {
    const { error: err } = await supabase.rpc('sacco_reverse_journal', {
      p_entry_id: entryId, p_reason: reason || null, p_date: null,
    });
    if (err) throw err;
    await fetchEntries();
  }, [fetchEntries]);

  // ── Operations sync — turns sacco activity into journal entries ───────────
  /**
   * Builds the list of postings that the operational tables imply but the
   * ledger does not yet carry. Nothing is written: the caller shows the
   * preview and then calls postOperations() with whatever the admin approved.
   */
  const previewOperations = useCallback(({
    contributions = [], loans = [], schedules = [], shares = [], sources = {},
  }) => {
    const posted = new Set(entries
      .filter((e) => e.source_id && e.status !== 'reversed')
      .map((e) => `${e.source_table}:${e.source_id}:${e.template_code}`));

    const proposals = [];
    const push = (p) => {
      const key = `${p.sourceTable}:${p.sourceId}:${p.templateCode}`;
      if (!posted.has(key)) proposals.push({ ...p, key });
    };

    if (sources.contributions !== false) {
      contributions.filter((c) => c.status === 'paid' && round2(c.amount) > 0).forEach((c) => {
        push({
          group: 'contributions',
          templateCode: contributionTemplate(c.contribution_type),
          amount: round2(c.amount),
          date: c.paid_date || c.created_at?.slice(0, 10),
          description: `${c.contribution_type || 'Contribution'} — ${c.member?.full_name || 'member'}`,
          reference: c.reference || null,
          memberId: c.member_id,
          sourceTable: 'sacco_contributions',
          sourceId: c.id,
        });
      });
    }

    if (sources.loans !== false) {
      loans.filter((l) => ['active', 'disbursed', 'closed', 'defaulted'].includes(l.status) && round2(l.principal) > 0)
        .forEach((l) => {
          push({
            group: 'loans',
            templateCode: 'LOAN_DISBURSEMENT',
            amount: round2(l.principal),
            date: (l.disbursed_at || l.created_at || '').slice(0, 10),
            description: `Loan disbursed — ${l.member?.full_name || 'member'}${l.product?.name ? ` (${l.product.name})` : ''}`,
            reference: null,
            memberId: l.member_id,
            sourceTable: 'sacco_loans',
            sourceId: l.id,
          });
        });
    }

    if (sources.repayments !== false) {
      const loanById = Object.fromEntries(loans.map((l) => [l.id, l]));
      schedules.filter((s) => s.paid).forEach((s) => {
        const loan = loanById[s.loan_id];
        const who  = loan?.member?.full_name || 'member';
        const when = s.paid_date || s.due_date;
        if (round2(s.principal) > 0) {
          push({
            group: 'repayments',
            templateCode: 'LOAN_REPAY_PRINCIPAL',
            amount: round2(s.principal),
            date: when,
            description: `Loan repayment (principal) period ${s.period_no} — ${who}`,
            memberId: loan?.member_id || null,
            sourceTable: 'sacco_loan_schedule',
            sourceId: s.id,
          });
        }
        if (round2(s.interest) > 0) {
          push({
            group: 'repayments',
            templateCode: 'LOAN_REPAY_INTEREST',
            amount: round2(s.interest),
            date: when,
            description: `Loan repayment (interest) period ${s.period_no} — ${who}`,
            memberId: loan?.member_id || null,
            sourceTable: 'sacco_loan_schedule',
            sourceId: s.id,
          });
        }
      });
    }

    // Share holdings are a SNAPSHOT, not a ledger — posting them books the
    // holding as opening share capital once. Later changes need their own entry.
    if (sources.shares === true) {
      shares.forEach((sh) => {
        const value = round2((parseInt(sh.shares_held, 10) || 0) * (Number(sh.par_value) || 0));
        if (value <= 0) return;
        push({
          group: 'shares',
          templateCode: 'MEMBER_SHARE_PURCHASE',
          amount: value,
          date: (sh.created_at || '').slice(0, 10),
          description: `Opening share capital — ${sh.member?.full_name || 'member'} (${sh.shares_held} shares)`,
          memberId: sh.member_id,
          sourceTable: 'sacco_shares',
          sourceId: sh.id,
        });
      });
    }

    return proposals.filter((p) => !!p.date);
  }, [entries]);

  const postOperations = useCallback(async (proposals = []) => {
    const result = { posted: 0, skipped: 0, failed: [] };
    for (const p of proposals) {
      try {
        await post({
          date: p.date,
          description: p.description,
          reference: p.reference || null,
          memberId: p.memberId || null,
          templateCode: p.templateCode,
          sourceTable: p.sourceTable,
          sourceId: p.sourceId,
          isAutomated: true,
          batchRef: 'ops-sync',
          lines: (() => {
            const tpl = templates.find((t) => t.template_code === p.templateCode);
            if (!tpl) throw new Error(`Unknown template ${p.templateCode}`);
            return [
              { account_code: tpl.debit_account,  debit: p.amount, credit: 0, member_id: p.memberId || null },
              { account_code: tpl.credit_account, debit: 0, credit: p.amount, member_id: p.memberId || null },
            ];
          })(),
        });
        result.posted += 1;
      } catch (err) {
        // 23505 = the source-dedupe index caught a row already in the ledger.
        if (err?.code === '23505') result.skipped += 1;
        else result.failed.push({ key: p.key, message: err.message });
      }
    }
    await fetchEntries();
    return result;
  }, [post, templates, fetchEntries]);

  // ── §10.4 Period-end batch jobs ───────────────────────────────────────────
  const monthsIn = (period) => {
    if (!period?.start_date || !period?.end_date) return 1;
    const s = new Date(period.start_date);
    const e = new Date(period.end_date);
    return Math.max(1, Math.round((e - s) / (30.44 * 86400000)));
  };

  /** Step 1 — interest accrual on loans and on member deposits. */
  const runAccrualJob = useCallback(async ({ period, loans, schedules, contributions }) => {
    const out = { loanInterest: 0, depositInterest: 0, entries: [] };

    const loanAccrual = computeLoanInterestAccrual({
      loans, schedules, periodStart: period.start_date, periodEnd: period.end_date,
    });
    if (loanAccrual.total > 0) {
      const id = await postFromTemplate({
        templateCode: 'INTEREST_ACCRUAL_LOANS',
        amount: loanAccrual.total,
        date: period.end_date,
        description: `Interest accrued on performing loans — ${period.label}`,
        sourceTable: 'period_job', sourceId: period.id,
        isAutomated: true, batchRef: `accrual:${period.id}`,
      });
      out.loanInterest = loanAccrual.total;
      out.entries.push(id);
    }

    const depositBalance = round2((contributions || [])
      .filter((c) => c.status === 'paid')
      .reduce((s, c) => s + (Number(c.amount) || 0), 0));
    const depositInterest = computeDepositInterestAccrual({
      depositBalance,
      annualRatePct: config?.deposit_interest_rate_pct || 0,
      months: monthsIn(period),
    });
    if (depositInterest > 0) {
      const id = await postFromTemplate({
        templateCode: 'INTEREST_ACCRUAL_DEPOSITS',
        amount: depositInterest,
        date: period.end_date,
        description: `Interest accrued on member deposits — ${period.label}`,
        sourceTable: 'period_job', sourceId: period.id,
        isAutomated: true, batchRef: `accrual:${period.id}`,
      });
      out.depositInterest = depositInterest;
      out.entries.push(id);
    }

    await fetchEntries();
    return out;
  }, [postFromTemplate, config?.deposit_interest_rate_pct, fetchEntries]);

  /** Step 2 — loan aging, classification and the provision MOVEMENT. */
  const runProvisioningJob = useCallback(async ({ period, loans, schedules }) => {
    const result = runProvisioning({
      loans, schedules, policy: provisionPolicy, asOf: new Date(period.end_date),
    });

    // Persist the per-loan classification so the run is auditable.
    if (result.rows.length > 0) {
      const payload = result.rows.map((r) => ({
        sacco_id: saccoIdRef.current,
        period_id: period.id,
        loan_id: r.loanId,
        member_id: r.memberId,
        outstanding: r.outstanding,
        days_in_arrears: r.daysInArrears,
        classification: r.classification,
        provision_pct: r.provisionPct,
        provision_amount: r.provisionAmount,
      }));
      const { error: err } = await supabase.from('sacco_loan_classifications')
        .upsert(payload, { onConflict: 'period_id,loan_id' });
      if (err) throw err;
    }

    // Post only the movement against the balance already carried on 1190.
    const tb = indexTrialBalance(await trialBalance(null, period.end_date));
    const carried  = sumBalances(tb, ['1190']);
    const movement = round2(result.requiredProvision - carried);

    let entryId = null;
    if (Math.abs(movement) >= 0.01) {
      entryId = await postFromTemplate({
        templateCode: movement > 0 ? 'PROVISION_INCREASE' : 'PROVISION_RELEASE',
        amount: Math.abs(movement),
        date: period.end_date,
        description: `${movement > 0 ? 'Increase' : 'Release'} in loan loss provision — ${period.label}`,
        sourceTable: 'period_job', sourceId: period.id,
        isAutomated: true, batchRef: `provisioning:${period.id}`,
      });
    }

    await Promise.all([fetchClassifications(), fetchEntries()]);
    return { ...result, carried, movement, entryId };
  }, [provisionPolicy, trialBalance, postFromTemplate, fetchClassifications, fetchEntries]);

  /** Step 3 — depreciation and amortisation. */
  const runDepreciationJob = useCallback(async ({ period }) => {
    const result = computeDepreciation({
      assets: fixedAssets, months: monthsIn(period), asOf: new Date(period.end_date),
    });

    const ids = [];
    if (result.depreciation > 0) {
      ids.push(await postFromTemplate({
        templateCode: 'DEPRECIATION',
        amount: result.depreciation,
        date: period.end_date,
        description: `Depreciation charge — ${period.label}`,
        sourceTable: 'period_job', sourceId: period.id,
        isAutomated: true, batchRef: `depreciation:${period.id}`,
      }));
    }
    if (result.amortisation > 0) {
      ids.push(await postFromTemplate({
        templateCode: 'AMORTISATION',
        amount: result.amortisation,
        date: period.end_date,
        description: `Amortisation of intangibles — ${period.label}`,
        sourceTable: 'period_job', sourceId: period.id,
        isAutomated: true, batchRef: `depreciation:${period.id}`,
      }));
    }

    // Roll the charge into each asset's accumulated depreciation.
    for (const row of result.rows) {
      const asset = fixedAssets.find((a) => a.id === row.assetId);
      await supabase.from('sacco_fixed_assets').update({
        accumulated_depreciation: round2((Number(asset?.accumulated_depreciation) || 0) + row.charge),
        last_depreciated_period: period.id,
        updated_at: new Date().toISOString(),
      }).eq('id', row.assetId);
    }

    await Promise.all([fetchFixedAssets(), fetchEntries()]);
    return { ...result, entries: ids };
  }, [fixedAssets, postFromTemplate, fetchFixedAssets, fetchEntries]);

  /** Step 8 (year-end) — the §2.4 appropriation waterfall. */
  const runAppropriationJob = useCallback(async ({ period, netSurplus }) => {
    const plan = buildAppropriation(netSurplus, appropriationRules);
    const templateFor = {
      statutory_reserve: 'STATUTORY_RESERVE',
      education:         'EDUCATION_FUND',
      development:       'DEVELOPMENT_FUND',
      welfare:           'WELFARE_RESERVE',
      honoraria:         'WELFARE_RESERVE',
      dividend:          'DIVIDEND_DECLARED',
      iod:               'IOD_DECLARED',
    };

    const posted = [];
    for (const line of plan.lines) {
      if (line.amount <= 0) continue;
      const id = await post({
        date: period.end_date,
        description: `${line.name} appropriation (${line.percent}% of net surplus) — ${period.label}`,
        templateCode: templateFor[line.ruleType] || null,
        sourceTable: 'appropriation', sourceId: period.id,
        isAutomated: true, batchRef: `appropriation:${period.id}:${line.ruleType}`,
        lines: [
          { account_code: '3200', debit: line.amount, credit: 0 },
          { account_code: line.targetAccount, debit: 0, credit: line.amount },
        ],
      }).catch((err) => {
        if (err?.code === '23505') return null;   // already appropriated
        throw err;
      });
      if (id) posted.push({ ...line, entryId: id });
    }

    await fetchEntries();
    return { ...plan, posted };
  }, [appropriationRules, post, fetchEntries]);

  // ── Fixed assets ──────────────────────────────────────────────────────────
  const addFixedAsset = useCallback(async (form, { postPurchase = true } = {}) => {
    const { data, error: err } = await supabase.from('sacco_fixed_assets').insert({
      sacco_id: saccoIdRef.current,
      asset_name:        form.asset_name,
      gl_code:           form.gl_code || '1310',
      acquisition_date:  form.acquisition_date,
      cost:              round2(form.cost),
      residual_value:    round2(form.residual_value || 0),
      useful_life_years: Number(form.useful_life_years) || 4,
      method:            form.method || 'straight_line',
      notes:             form.notes || null,
    }).select().maybeSingle();
    if (err) throw err;

    if (postPurchase && round2(form.cost) > 0) {
      await postFromTemplate({
        templateCode: 'FIXED_ASSET_PURCHASE',
        debitAccount: form.gl_code || '1310',
        creditAccount: form.paid_from || '1020',
        amount: round2(form.cost),
        date: form.acquisition_date,
        description: `Purchase of ${form.asset_name}`,
        sourceTable: 'sacco_fixed_assets', sourceId: data.id,
      });
    }
    await Promise.all([fetchFixedAssets(), fetchEntries()]);
    return data;
  }, [postFromTemplate, fetchFixedAssets, fetchEntries]);

  // ── §9.4 Merry-go-round ───────────────────────────────────────────────────
  const addMgrCycle = useCallback(async (form) => {
    const nextNo = (mgrCycles[0]?.cycle_no || 0) + 1;
    const { data, error: err } = await supabase.from('sacco_mgr_cycles').insert({
      sacco_id: saccoIdRef.current,
      cycle_no: form.cycle_no || nextNo,
      label: form.label || `Cycle ${form.cycle_no || nextNo}`,
      cycle_date: form.cycle_date,
      contribution_per_member: round2(form.contribution_per_member),
      beneficiary_member_id: form.beneficiary_member_id || null,
      status: 'open',
      notes: form.notes || null,
    }).select().maybeSingle();
    if (err) throw err;
    await fetchChama();
    return data;
  }, [mgrCycles, fetchChama]);

  const updateMgrCycle = useCallback(async (id, patch) => {
    const { error: err } = await supabase.from('sacco_mgr_cycles')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (err) throw err;
    await fetchChama();
  }, [fetchChama]);

  /** Records a member's contribution to a cycle and posts Dr Cash / Cr 2320. */
  const recordMgrContribution = useCallback(async ({ cycle, memberId, amount, reference }) => {
    const amt = round2(amount);
    const { data, error: err } = await supabase.from('sacco_mgr_contributions').upsert({
      cycle_id: cycle.id, member_id: memberId, amount: amt,
      paid: true, paid_date: new Date().toISOString().slice(0, 10), reference: reference || null,
    }, { onConflict: 'cycle_id,member_id' }).select().maybeSingle();
    if (err) throw err;

    await postFromTemplate({
      templateCode: 'MGR_CONTRIBUTION',
      amount: amt,
      date: new Date().toISOString().slice(0, 10),
      description: `${cycle.label || `Cycle ${cycle.cycle_no}`} contribution`,
      memberId,
      reference: reference || null,
      sourceTable: 'sacco_mgr_contributions', sourceId: data.id,
    }).catch((e) => { if (e?.code !== '23505') throw e; });

    await Promise.all([fetchChama(), fetchEntries()]);
    return data;
  }, [postFromTemplate, fetchChama, fetchEntries]);

  /** Pays the cycle beneficiary and posts Dr 2320 / Cr Cash. */
  const payMgrCycle = useCallback(async (cycle) => {
    const collected = round2(mgrContributions
      .filter((c) => c.cycle_id === cycle.id && c.paid)
      .reduce((s, c) => s + (Number(c.amount) || 0), 0));
    if (collected <= 0) throw new Error('Nothing has been collected for this cycle yet');
    if (!cycle.beneficiary_member_id) throw new Error('Set the cycle beneficiary first');

    const today = new Date().toISOString().slice(0, 10);
    await postFromTemplate({
      templateCode: 'MGR_PAYOUT',
      amount: collected,
      date: today,
      description: `${cycle.label || `Cycle ${cycle.cycle_no}`} payout to beneficiary`,
      memberId: cycle.beneficiary_member_id,
      sourceTable: 'sacco_mgr_cycles', sourceId: cycle.id,
    });
    await updateMgrCycle(cycle.id, { status: 'paid', payout_amount: collected, payout_date: today });
    await fetchEntries();
    return collected;
  }, [mgrContributions, postFromTemplate, updateMgrCycle, fetchEntries]);

  // ── §9.5 Welfare claims ───────────────────────────────────────────────────
  const addWelfareClaim = useCallback(async (form) => {
    const { error: err } = await supabase.from('sacco_welfare_claims').insert({
      sacco_id: saccoIdRef.current,
      claim_no: form.claim_no || `WC-${Date.now().toString().slice(-6)}`,
      member_id: form.member_id,
      claim_date: form.claim_date,
      category: form.category || 'other',
      reason: form.reason || null,
      amount_requested: round2(form.amount_requested),
      status: 'pending',
    });
    if (err) throw err;
    await fetchChama();
  }, [fetchChama]);

  const decideWelfareClaim = useCallback(async (claim, { approve, amount }) => {
    const uid = await getUserId();
    const { error: err } = await supabase.from('sacco_welfare_claims').update({
      status: approve ? 'approved' : 'rejected',
      amount_approved: approve ? round2(amount ?? claim.amount_requested) : 0,
      approved_by: uid, approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', claim.id);
    if (err) throw err;
    await fetchChama();
  }, [fetchChama]);

  /** Pays an approved claim: Dr 2310 Welfare Fund Payable / Cr Cash. */
  const payWelfareClaim = useCallback(async (claim) => {
    const amt = round2(claim.amount_approved || claim.amount_requested);
    if (amt <= 0) throw new Error('Approve an amount before paying the claim');
    const today = new Date().toISOString().slice(0, 10);
    await postFromTemplate({
      templateCode: 'WELFARE_CLAIM_PAID',
      amount: amt,
      date: today,
      description: `Welfare claim ${claim.claim_no} — ${claim.member?.full_name || 'member'}`,
      memberId: claim.member_id,
      sourceTable: 'sacco_welfare_claims', sourceId: claim.id,
    });
    const { error: err } = await supabase.from('sacco_welfare_claims').update({
      status: 'paid', amount_paid: amt, paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', claim.id);
    if (err) throw err;
    await Promise.all([fetchChama(), fetchEntries()]);
  }, [postFromTemplate, fetchChama, fetchEntries]);

  return {
    // state
    saccoId, config, coa, periods, templates, entries, provisionPolicy,
    appropriationRules, classifications, fixedAssets, mgrCycles,
    mgrContributions, welfareClaims, loading, error, isSeeded,
    // reads
    trialBalance,
    // setup
    seedChart, saveConfig, saveProvisionBand, saveAppropriationRule,
    addAccount, updateAccount,
    // periods
    ensurePeriods, closePeriod, reopenPeriod, setChecklistItem,
    // posting
    postFromTemplate, postManual, reverseEntry,
    previewOperations, postOperations,
    // batch jobs
    runAccrualJob, runProvisioningJob, runDepreciationJob, runAppropriationJob,
    // registers
    addFixedAsset,
    addMgrCycle, updateMgrCycle, recordMgrContribution, payMgrCycle,
    addWelfareClaim, decideWelfareClaim, payWelfareClaim,
    // misc
    refetch: loadAll,
    helpers: { outstandingPrincipal },
  };
};

export default useSaccoFinance;
