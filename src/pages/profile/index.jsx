import React, { useState } from 'react';
import MainLayout from '../../layouts/MainLayout';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import Icon from '../../components/AppIcon';
import { formatKEPhone } from '../../utils/phoneUtils';
import { planForUsers, subscriptionPriceFor } from '../../config/companyPlans';
import useAdminSubscription from '../../hooks/useAdminSubscription';

// ── Formatting helpers ───────────────────────────────────────────────────────
const fmtKES  = (n) => `KES ${parseFloat(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const TIER_META = {
  silver: { label: 'Silver', icon: 'Shield', accent: '#64748b', bg: '#f1f5f9' },
  bronze: { label: 'Bronze', icon: 'Award',  accent: '#b45309', bg: '#fef3c7' },
  gold:   { label: 'Gold',   icon: 'Crown',  accent: '#a16207', bg: '#fef9c3' },
};
const tierMeta = (id) => TIER_META[id] || { label: id || '—', icon: 'Layers', accent: '#1A56DB', bg: '#e8f0fe' };

// ── Reusable card shell ──────────────────────────────────────────────────────
const Card = ({ icon, title, subtitle, accent = '#1A56DB', children, right }) => (
  <div className="bg-card border border-border rounded-xl overflow-hidden">
    <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${accent}1a` }}>
          <Icon name={icon} size={17} color={accent} />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
    <div className="p-5">{children}</div>
  </div>
);

const Banner = ({ kind, children }) => {
  if (!children) return null;
  const map = {
    success: { bg: '#dcfce7', color: '#15803d', icon: 'CheckCircle2' },
    error:   { bg: '#fee2e2', color: '#b91c1c', icon: 'AlertTriangle' },
    info:    { bg: '#dbeafe', color: '#1d4ed8', icon: 'Info' },
    warn:    { bg: '#fef3c7', color: '#b45309', icon: 'AlertTriangle' },
  };
  const s = map[kind] || map.info;
  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-xs font-medium mb-4" style={{ background: s.bg, color: s.color }}>
      <Icon name={s.icon} size={14} color={s.color} />
      <span>{children}</span>
    </div>
  );
};

const inputCls = 'w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all';
const btnPri   = 'inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const btnSec   = 'inline-flex items-center justify-center gap-2 bg-muted text-foreground px-4 py-2 rounded-lg text-sm font-medium border border-border hover:bg-muted/70 transition-colors disabled:opacity-50';

// ═══════════════════════════════════════════════════════════════════════════════
// ACCOUNT DETAILS
// ═══════════════════════════════════════════════════════════════════════════════
const AccountCard = ({ user, userProfile, updateProfile }) => {
  const [fullName, setFullName] = useState(userProfile?.full_name || '');
  const [phone, setPhone]       = useState(userProfile?.phone || '');
  const [saving, setSaving]     = useState(false);
  const [msg, setMsg]           = useState(null);

  const dirty = fullName !== (userProfile?.full_name || '') || phone !== (userProfile?.phone || '');

  const save = async () => {
    setSaving(true); setMsg(null);
    const { error } = await updateProfile({ full_name: fullName.trim(), phone: phone.trim() });
    setSaving(false);
    setMsg(error ? { kind: 'error', text: error.message } : { kind: 'success', text: 'Profile updated.' });
  };

  return (
    <Card icon="User" title="Account details" subtitle="Your personal information">
      {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Full name</label>
          <input className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Phone</label>
          <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07XX XXX XXX" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Email</label>
          <input className={`${inputCls} opacity-60 cursor-not-allowed`} value={user?.email || ''} disabled />
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Role</label>
          <input className={`${inputCls} opacity-60 cursor-not-allowed capitalize`} value={(userProfile?.role || '').replace(/_/g, ' ')} disabled />
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <button className={btnPri} disabled={!dirty || saving} onClick={save}>
          <Icon name="Save" size={15} color="currentColor" />
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </Card>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// CHANGE PASSWORD
// ═══════════════════════════════════════════════════════════════════════════════
const PasswordCard = ({ email }) => {
  const [current, setCurrent] = useState('');
  const [next, setNext]       = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow]       = useState(false);
  const [busy, setBusy]       = useState(false);
  const [msg, setMsg]         = useState(null);

  const rules = [
    { label: '8+ characters', met: next.length >= 8 },
    { label: 'Uppercase',     met: /[A-Z]/.test(next) },
    { label: 'Lowercase',     met: /[a-z]/.test(next) },
    { label: 'Number',        met: /[0-9]/.test(next) },
  ];
  const strongEnough = rules.every((r) => r.met);

  const submit = async () => {
    setMsg(null);
    if (!current) return setMsg({ kind: 'error', text: 'Enter your current password.' });
    if (!strongEnough) return setMsg({ kind: 'error', text: 'New password does not meet the requirements.' });
    if (next !== confirm) return setMsg({ kind: 'error', text: 'New passwords do not match.' });

    setBusy(true);
    const { error: authErr } = await supabase.auth.signInWithPassword({ email, password: current });
    if (authErr) { setBusy(false); return setMsg({ kind: 'error', text: 'Current password is incorrect.' }); }
    const { error: updErr } = await supabase.auth.updateUser({ password: next });
    setBusy(false);
    if (updErr) return setMsg({ kind: 'error', text: updErr.message });
    setCurrent(''); setNext(''); setConfirm('');
    setMsg({ kind: 'success', text: 'Password changed successfully.' });
  };

  return (
    <Card icon="Lock" title="Change password" subtitle="Keep your account secure" accent="#7c3aed">
      {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}
      <div className="space-y-4 max-w-md">
        <div>
          <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Current password</label>
          <input className={inputCls} type={show ? 'text' : 'password'} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted-foreground mb-1.5">New password</label>
          <input className={inputCls} type={show ? 'text' : 'password'} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Confirm new password</label>
          <input className={inputCls} type={show ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </div>

        {next.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {rules.map((r) => (
              <span key={r.label} className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
                style={{ background: r.met ? '#dcfce7' : '#f3f4f6', color: r.met ? '#15803d' : '#9ca3af' }}>
                <Icon name={r.met ? 'Check' : 'Minus'} size={11} color={r.met ? '#15803d' : '#9ca3af'} />
                {r.label}
              </span>
            ))}
          </div>
        )}

        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
          Show passwords
        </label>

        <div className="flex justify-end">
          <button className={btnPri} disabled={busy} onClick={submit}>
            <Icon name="Lock" size={15} color="currentColor" />
            {busy ? 'Updating…' : 'Update password'}
          </button>
        </div>
      </div>
    </Card>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN — upgrade / downgrade user seats
// ═══════════════════════════════════════════════════════════════════════════════
const PlanCard = ({ sub }) => {
  const { subscription, seats, planName, monthlyCost, status, startDate, endDate, daysRemaining, expired, changeSeats, refetch } = sub;
  const [draft, setDraft] = useState(seats || 1);
  const [busy, setBusy]   = useState(false);
  const [msg, setMsg]     = useState(null);
  React.useEffect(() => { setDraft(seats || 1); }, [seats]);

  const meta        = tierMeta(planName);
  const draftPlan   = planForUsers(draft);
  const draftMeta   = tierMeta(draftPlan?.id);
  const projected   = subscriptionPriceFor(draft);
  const changed     = draft !== seats;
  const pending     = subscription?.pending_max_users != null;
  const tierChanged = draftPlan && draftPlan.id !== planName;

  const apply = async () => {
    setBusy(true); setMsg(null);
    try {
      await changeSeats(draft);
      await refetch();
      setMsg(draft === seats
        ? { kind: 'info', text: 'Scheduled change cancelled.' }
        : { kind: 'success', text: `Plan will change to ${draft} user(s) — ${draftMeta.label} — when the current period ends.` });
    } catch (e) {
      setMsg({ kind: e.needsMigration ? 'warn' : 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card icon="Layers" title="My plan" subtitle="Licensed user seats, billed monthly" accent={meta.accent}
      right={
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold" style={{ background: meta.bg, color: meta.accent }}>
          <Icon name={meta.icon} size={12} color={meta.accent} />
          {meta.label}
        </span>
      }
    >
      {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}
      {expired && <Banner kind="warn">Your subscription period has ended. Make a payment below to renew.</Banner>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'User seats',    value: seats,                icon: 'Users' },
          { label: 'Monthly cost',  value: fmtKES(monthlyCost),  icon: 'CreditCard', strong: true },
          { label: 'Status',        value: (status || '—'),       icon: 'Activity', cap: true },
          { label: 'Renews in',     value: daysRemaining != null ? `${daysRemaining} day(s)` : '—', icon: 'CalendarClock' },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <Icon name={s.icon} size={12} color="currentColor" />{s.label}
            </div>
            <div className={`text-sm font-semibold ${s.strong ? 'text-primary' : 'text-foreground'} ${s.cap ? 'capitalize' : ''}`}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-background px-3 py-2.5 mb-5 text-xs text-muted-foreground flex items-center gap-2">
        <Icon name="Calendar" size={13} color="currentColor" />
        Current period: <span className="font-medium text-foreground">{fmtDate(startDate)} – {fmtDate(endDate)}</span>
      </div>

      {pending && (
        <Banner kind="info">
          Scheduled: plan changes to <b>{subscription.pending_max_users} user(s)</b> ({tierMeta(subscription.pending_plan_name).label}, {fmtKES(subscription.pending_price)}/mo) on {fmtDate(subscription.pending_effective_date)}.
        </Banner>
      )}

      <div className="rounded-xl border border-border p-4">
        <div className="text-sm font-semibold text-foreground mb-1">Upgrade or downgrade users</div>
        <p className="text-xs text-muted-foreground mb-4">
          Changes take effect once the current subscription period ends — your current plan stays active until then. The tier adjusts automatically to the number of users.
        </p>

        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5">User seats</label>
            <div className="flex items-center gap-2">
              <button className={btnSec} style={{ padding: '0.5rem' }} disabled={draft <= 1} onClick={() => setDraft((d) => Math.max(1, d - 1))}>
                <Icon name="Minus" size={16} color="currentColor" />
              </button>
              <input type="number" min={1} className={`${inputCls} w-20 text-center`} value={draft}
                onChange={(e) => setDraft(Math.max(1, parseInt(e.target.value, 10) || 1))} />
              <button className={btnSec} style={{ padding: '0.5rem' }} onClick={() => setDraft((d) => d + 1)}>
                <Icon name="Plus" size={16} color="currentColor" />
              </button>
            </div>
          </div>

          <div className="px-3 py-2 rounded-lg bg-muted/40 border border-border">
            <div className="text-xs text-muted-foreground">New tier &amp; monthly cost</div>
            <div className="text-sm font-bold text-foreground flex items-center gap-2">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs" style={{ background: draftMeta.bg, color: draftMeta.accent }}>
                <Icon name={draftMeta.icon} size={11} color={draftMeta.accent} />{draftMeta.label}
              </span>
              {fmtKES(projected)}
              {changed && (
                <span className={`text-xs font-medium ${projected > monthlyCost ? 'text-amber-600' : 'text-green-600'}`}>
                  ({projected > monthlyCost ? '+' : ''}{fmtKES(projected - monthlyCost)})
                </span>
              )}
            </div>
          </div>

          <button className={btnPri} disabled={busy || (!changed && !pending)} onClick={apply}>
            <Icon name={draft > seats ? 'ArrowUpCircle' : draft < seats ? 'ArrowDownCircle' : 'X'} size={15} color="currentColor" />
            {busy ? 'Saving…' : draft === seats ? 'Cancel scheduled change' : 'Schedule change'}
          </button>
        </div>
      </div>
    </Card>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAKE PAYMENT  (records intent in mpesa_subscription_payments; Daraja wired later)
// ═══════════════════════════════════════════════════════════════════════════════
const PaymentCard = ({ sub, defaultPhone }) => {
  const { outstanding, nextCharge, monthlyCost, daysRemaining, almostDepleted, expired, recordPayment } = sub;
  const amount = outstanding > 0 ? outstanding : nextCharge || monthlyCost;
  const [phone, setPhone] = useState(defaultPhone || '');
  const [busy, setBusy]   = useState(false);
  const [msg, setMsg]     = useState(null);

  const pay = async () => {
    setMsg(null);
    if (!phone.trim()) return setMsg({ kind: 'error', text: 'Enter the M-Pesa phone number.' });
    setBusy(true);
    try {
      await recordPayment(phone.trim(), amount);
      setMsg({ kind: 'success', text: `Payment of ${fmtKES(amount)} recorded for ${phone}. An M-Pesa STK push will be sent once the integration is live.` });
    } catch (e) {
      setMsg({ kind: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card icon="Wallet" title="Make a payment" subtitle="Top up before your plan is depleted"
      accent={almostDepleted ? '#b45309' : '#0b7a4e'}>
      {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}
      {almostDepleted && (
        <Banner kind="warn">
          {expired
            ? 'Your subscription has expired — make a payment to renew.'
            : `Your plan is almost depleted${daysRemaining != null ? ` — ${daysRemaining} day(s) left in the current period` : ''}. Make a payment to avoid interruption.`}
        </Banner>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <div className="text-xs text-muted-foreground mb-1">Outstanding balance</div>
          <div className="text-lg font-bold text-foreground">{fmtKES(outstanding)}</div>
        </div>
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <div className="text-xs text-muted-foreground mb-1">Next charge</div>
          <div className="text-lg font-bold text-foreground">{fmtKES(nextCharge || monthlyCost)}</div>
        </div>
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <div className="text-xs text-muted-foreground mb-1">Renews in</div>
          <div className="text-lg font-bold text-foreground">{daysRemaining != null ? `${daysRemaining} day(s)` : '—'}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-semibold text-muted-foreground mb-1.5">M-Pesa phone</label>
          <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07XX XXX XXX" style={{ width: 180 }} />
        </div>
        <button className={btnPri} disabled={busy || amount <= 0} onClick={pay}>
          <Icon name="Smartphone" size={15} color="currentColor" />
          {busy ? 'Submitting…' : `Pay ${fmtKES(amount)}`}
        </button>
        <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
          <Icon name="Clock" size={12} color="currentColor" />
          STK push integration in progress
        </span>
      </div>
    </Card>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// BILLING HISTORY — downloadable invoices
// ═══════════════════════════════════════════════════════════════════════════════
const invoiceNo = (row) => {
  const ym    = (row.start_date ? new Date(row.start_date) : new Date(row.created_at)).toISOString().slice(0, 7).replace('-', '');
  const short = (row.id || '').replace(/-/g, '').slice(0, 6).toUpperCase();
  return `INV-${ym}-${short}`;
};

const buildInvoiceHtml = (row, billTo) => {
  const meta = tierMeta(row.plan_name);
  const statusColor = row.status === 'active' || row.status === 'paid' ? '#15803d' : row.status === 'pending' ? '#b45309' : '#b91c1c';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${invoiceNo(row)}</title>
<style>
  *{box-sizing:border-box;font-family:'Segoe UI',Arial,sans-serif;}
  body{margin:0;padding:40px;color:#0c2037;}
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1A56DB;padding-bottom:20px;}
  .brand{font-size:24px;font-weight:800;color:#0c2037;}
  .brand span{color:#1A56DB;}
  .muted{color:#5a7185;font-size:12px;}
  .grid{display:flex;justify-content:space-between;margin:24px 0;}
  .grid div{font-size:13px;line-height:1.7;}
  table{width:100%;border-collapse:collapse;margin-top:16px;}
  th{background:#f3f6fb;text-align:left;padding:10px 12px;font-size:12px;color:#5a7185;text-transform:uppercase;}
  td{padding:12px;border-bottom:1px solid #e5ebf1;font-size:13px;}
  .right{text-align:right;}
  .total{font-size:18px;font-weight:800;color:#1A56DB;}
  .badge{display:inline-block;padding:4px 12px;border-radius:999px;font-size:12px;font-weight:700;text-transform:uppercase;color:${statusColor};background:${statusColor}1a;}
  .foot{margin-top:40px;font-size:11px;color:#9aa7b4;text-align:center;border-top:1px solid #e5ebf1;padding-top:16px;}
</style></head><body>
  <div class="head">
    <div><div class="brand">Asset<span>Flow</span></div><div class="muted">Platform Subscription</div></div>
    <div class="right"><div style="font-size:20px;font-weight:800;">INVOICE</div><div class="muted">${invoiceNo(row)}</div></div>
  </div>
  <div class="grid">
    <div><strong>Billed to</strong><br>${billTo.name || '—'}<br>${billTo.email || ''}<br>${billTo.phone || ''}</div>
    <div class="right">
      <strong>Issued</strong> ${fmtDate(row.start_date || row.created_at)}<br>
      <strong>Period</strong> ${fmtDate(row.start_date)} – ${fmtDate(row.end_date)}<br>
      <strong>Status</strong> <span class="badge">${row.status || '—'}</span>
    </div>
  </div>
  <table>
    <thead><tr><th>Description</th><th class="right">Users</th><th class="right">Amount</th></tr></thead>
    <tbody>
      <tr>
        <td>${meta.label} plan subscription</td>
        <td class="right">${row.max_users ?? '—'}</td>
        <td class="right">${fmtKES(row.price_paid)}</td>
      </tr>
    </tbody>
  </table>
  <div class="grid" style="margin-top:8px;">
    <div></div>
    <div class="right">Total<br><span class="total">${fmtKES(row.price_paid)}</span></div>
  </div>
  <div class="foot">Thank you for using AssetFlow. Generated on ${new Date().toLocaleDateString('en-GB')}.</div>
  <script>window.onload=function(){window.print();}</script>
</body></html>`;
};

const HistoryCard = ({ history, billTo }) => {
  const download = (row) => {
    const w = window.open('', '_blank', 'width=820,height=920');
    if (!w) return;
    w.document.write(buildInvoiceHtml(row, billTo));
    w.document.close();
  };

  const statusBadge = (s) => {
    const c = s === 'active' || s === 'paid' ? '#15803d' : s === 'pending' ? '#b45309' : '#b91c1c';
    return <span className="px-2 py-0.5 rounded-full text-xs font-semibold capitalize" style={{ color: c, background: `${c}1a` }}>{s || '—'}</span>;
  };

  return (
    <Card icon="ReceiptText" title="Billing history" subtitle="Monthly plans selected — download any as an invoice" accent="#0891b2">
      {history.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground">
          <Icon name="FileText" size={28} color="#9ca3af" className="mx-auto mb-2" />
          No invoices yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Invoice</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Period</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Plan</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Users</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Amount</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Status</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Invoice</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground">{invoiceNo(row)}</td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(row.start_date)} – {fmtDate(row.end_date)}</td>
                  <td className="px-4 py-3 text-muted-foreground capitalize">{tierMeta(row.plan_name).label}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{row.max_users ?? '—'}</td>
                  <td className="px-4 py-3 text-right font-semibold text-foreground">{fmtKES(row.price_paid)}</td>
                  <td className="px-4 py-3">{statusBadge(row.status)}</td>
                  <td className="px-4 py-3 text-right">
                    <button className={btnSec} style={{ padding: '0.4rem 0.7rem' }} onClick={() => download(row)}>
                      <Icon name="Download" size={14} color="currentColor" />
                      Download
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// PAGE
// ═══════════════════════════════════════════════════════════════════════════════
const ProfilePage = () => {
  const { user, userProfile, updateProfile } = useAuth();
  const isAdmin = userProfile?.role === 'admin';
  const sub = useAdminSubscription();

  const initials = (userProfile?.full_name || user?.email || 'U')
    .split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  const billTo = {
    name:  userProfile?.full_name,
    email: user?.email,
    phone: userProfile?.phone ? formatKEPhone(userProfile.phone) : '',
  };

  return (
    <MainLayout>
      <div className="space-y-6 max-w-5xl">

        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-lg font-bold flex-shrink-0"
            style={{ background: 'linear-gradient(135deg,#0c2037,#1A56DB)' }}>
            {initials}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{userProfile?.full_name || 'My Profile'}</h1>
            <p className="text-sm text-muted-foreground">{user?.email}</p>
          </div>
        </div>

        <AccountCard user={user} userProfile={userProfile} updateProfile={updateProfile} />
        <PasswordCard email={user?.email} />

        {isAdmin && (
          sub.loading ? (
            <div className="bg-card border border-border rounded-xl p-8 text-center text-sm text-muted-foreground">
              <Icon name="Loader" size={20} color="#9ca3af" className="mx-auto mb-2 animate-spin" />
              Loading your plan…
            </div>
          ) : sub.error ? (
            <div className="bg-card border border-border rounded-xl p-6">
              <Banner kind="error">Could not load your subscription: {sub.error}</Banner>
            </div>
          ) : !sub.subscription ? (
            <Card icon="Layers" title="My plan" subtitle="Subscription">
              <div className="text-center py-6 text-sm text-muted-foreground">
                <Icon name="PackageOpen" size={28} color="#9ca3af" className="mx-auto mb-2" />
                No active subscription found for your account.
              </div>
            </Card>
          ) : (
            <>
              <PlanCard sub={sub} />
              <PaymentCard sub={sub} defaultPhone={userProfile?.phone} />
              <HistoryCard history={sub.history} billTo={billTo} />
            </>
          )
        )}

      </div>
    </MainLayout>
  );
};

export default ProfilePage;
