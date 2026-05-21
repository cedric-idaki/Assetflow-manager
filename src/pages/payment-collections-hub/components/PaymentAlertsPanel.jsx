import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { supabase } from '../../../lib/supabase';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n) => `KES ${(parseFloat(n) || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

// ── Alert config ──────────────────────────────────────────────────────────────
const ALERT_CONFIG = {
  reminder_7_days:   { label: '7-Day Reminder',      icon: 'Calendar',      color: 'blue',   bg: 'bg-blue-50   border-blue-200   text-blue-800',   badge: 'bg-blue-100 text-blue-700'   },
  reminder_3_days:   { label: '3-Day Reminder',      icon: 'AlertTriangle', color: 'amber',  bg: 'bg-amber-50  border-amber-200  text-amber-800',  badge: 'bg-amber-100 text-amber-700'  },
  reminder_same_day: { label: 'Due Today',           icon: 'Clock',         color: 'orange', bg: 'bg-orange-50 border-orange-200 text-orange-800', badge: 'bg-orange-100 text-orange-700' },
  overdue_day1:      { label: 'Overdue Day 1',       icon: 'AlertCircle',   color: 'red',    bg: 'bg-red-50    border-red-200    text-red-800',    badge: 'bg-red-100 text-red-700'      },
  grace_expiry:      { label: 'Grace Period Expiry', icon: 'Timer',         color: 'red',    bg: 'bg-red-50    border-red-200    text-red-800',    badge: 'bg-red-100 text-red-700'      },
  escalation_day3:   { label: 'Escalation — Day 3',  icon: 'Siren',         color: 'red',    bg: 'bg-red-100   border-red-300    text-red-900',    badge: 'bg-red-200 text-red-800'      },
  escalation_day7:   { label: 'Escalation — Day 7',  icon: 'ShieldAlert',   color: 'red',    bg: 'bg-red-100   border-red-300    text-red-900',    badge: 'bg-red-200 text-red-800'      },
};

// ── Upcoming installments card ────────────────────────────────────────────────
const InstallmentAlertRow = ({ installment, daysLabel, urgency }) => {
  const colors = {
    critical: 'border-l-4 border-l-red-500 bg-red-50',
    warning:  'border-l-4 border-l-amber-500 bg-amber-50',
    info:     'border-l-4 border-l-blue-500 bg-blue-50',
    success:  'border-l-4 border-l-emerald-500 bg-emerald-50',
  };

  return (
    <div className={`flex items-center justify-between p-3 rounded-xl ${colors[urgency] || colors.info} mb-2`}>
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
          urgency === 'critical' ? 'bg-red-100' :
          urgency === 'warning'  ? 'bg-amber-100' : 'bg-blue-100'
        }`}>
          <Icon name={
            urgency === 'critical' ? 'AlertCircle' :
            urgency === 'warning'  ? 'AlertTriangle' : 'Calendar'
          } size={15} color={
            urgency === 'critical' ? '#dc2626' :
            urgency === 'warning'  ? '#d97706' : '#1d4ed8'
          } />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{installment.client_name}</p>
          <p className="text-xs text-muted-foreground">{installment.account_number} · #{installment.installment_no}</p>
        </div>
      </div>
      <div className="text-right flex-shrink-0 ml-3">
        <p className="text-sm font-bold text-foreground">{fmt(installment.installment_amount)}</p>
        <p className={`text-xs font-semibold ${
          urgency === 'critical' ? 'text-red-600' :
          urgency === 'warning'  ? 'text-amber-600' : 'text-blue-600'
        }`}>{daysLabel}</p>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
const PaymentAlertsPanel = () => {
  const [adminId, setAdminId]           = useState(null);
  const [loading, setLoading]           = useState(true);
  const [generating, setGenerating]     = useState(false);
  const [activeTab, setActiveTab]       = useState('upcoming');
  const [reminders, setReminders]       = useState([]);
  const [upcomingInstallments, setUpcomingInstallments] = useState([]);
  const [overdueInstallments, setOverdueInstallments]   = useState([]);
  const [summary, setSummary]           = useState({
    due_today: 0, grace_period: 0, overdue: 0, upcoming: 0,
    due_today_amount: 0, overdue_amount: 0,
  });

  // ── Boot ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const boot = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from('user_profiles').select('role, admin_id').eq('id', user.id).single();
      const aId = profile?.role === 'admin' ? user.id : (profile?.admin_id || user.id);
      setAdminId(aId);
      await Promise.all([
        fetchUpcoming(aId),
        fetchOverdue(aId),
        fetchReminders(aId),
        fetchSummary(aId),
      ]);
      setLoading(false);
    };
    boot();
  }, []);

  // ── Fetch upcoming installments (next 30 days) ────────────────────────────
  const fetchUpcoming = useCallback(async (aId) => {
    try {
      const { data } = await supabase
        .from('installment_schedules')
        .select(`
          id, installment_no, due_date, installment_amount, status,
          client:clients(full_name, account_number, phone, email),
          sale:sales(invoice_number, admin_id)
        `)
        .in('status', ['pending','partial'])
        .gte('due_date', new Date().toISOString().split('T')[0])
        .lte('due_date', new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0])
        .order('due_date', { ascending: true });

      const filtered = (data || []).filter(i => i.sale?.admin_id === aId);
      setUpcomingInstallments(filtered.map(i => ({
        ...i,
        client_name:    i.client?.full_name,
        account_number: i.client?.account_number,
        phone:          i.client?.phone,
        email:          i.client?.email,
        invoice_number: i.sale?.invoice_number,
        days_until_due: Math.ceil((new Date(i.due_date) - new Date()) / 86400000),
      })));
    } catch (err) {
      console.error('fetchUpcoming:', err.message);
    }
  }, []);

  // ── Fetch overdue installments ────────────────────────────────────────────
  const fetchOverdue = useCallback(async (aId) => {
    try {
      const { data } = await supabase
        .from('installment_schedules')
        .select(`
          id, installment_no, due_date, installment_amount, status,
          penalty_amount, overdue_days,
          client:clients(full_name, account_number, phone),
          sale:sales(invoice_number, admin_id)
        `)
        .in('status', ['pending','partial','overdue'])
        .lt('due_date', new Date().toISOString().split('T')[0])
        .order('due_date', { ascending: true });

      const filtered = (data || []).filter(i => i.sale?.admin_id === aId);
      setOverdueInstallments(filtered.map(i => ({
        ...i,
        client_name:    i.client?.full_name,
        account_number: i.client?.account_number,
        phone:          i.client?.phone,
        invoice_number: i.sale?.invoice_number,
        days_overdue:   Math.floor((new Date() - new Date(i.due_date)) / 86400000),
      })));
    } catch (err) {
      console.error('fetchOverdue:', err.message);
    }
  }, []);

  // ── Fetch generated reminders ─────────────────────────────────────────────
  const fetchReminders = useCallback(async (aId) => {
    try {
      const { data } = await supabase
        .from('payment_reminders')
        .select('*, client:clients(full_name, phone)')
        .eq('admin_id', aId)
        .order('created_at', { ascending: false })
        .limit(50);
      setReminders(data || []);
    } catch { setReminders([]); }
  }, []);

  // ── Fetch alert summary ───────────────────────────────────────────────────
  const fetchSummary = useCallback(async (aId) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const { data: dueToday } = await supabase
        .from('installment_schedules')
        .select('installment_amount, sale:sales(admin_id)')
        .eq('due_date', today)
        .in('status', ['pending','partial']);
      const { data: overdue } = await supabase
        .from('installment_schedules')
        .select('installment_amount, sale:sales(admin_id)')
        .lt('due_date', today)
        .in('status', ['pending','partial','overdue']);
      const { data: upcoming } = await supabase
        .from('installment_schedules')
        .select('id, sale:sales(admin_id)')
        .gt('due_date', today)
        .lte('due_date', new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0])
        .in('status', ['pending','partial']);

      const myDueToday  = (dueToday || []).filter(i => i.sale?.admin_id === aId);
      const myOverdue   = (overdue  || []).filter(i => i.sale?.admin_id === aId);
      const myUpcoming  = (upcoming || []).filter(i => i.sale?.admin_id === aId);

      setSummary({
        due_today:        myDueToday.length,
        overdue:          myOverdue.length,
        upcoming:         myUpcoming.length,
        due_today_amount: myDueToday.reduce((s, i) => s + parseFloat(i.installment_amount || 0), 0),
        overdue_amount:   myOverdue.reduce((s, i)  => s + parseFloat(i.installment_amount || 0), 0),
      });
    } catch { }
  }, []);

  // ── Generate reminders via SQL function ───────────────────────────────────
  const handleGenerateReminders = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase
        .rpc('generate_payment_reminders', { p_admin_id: adminId });
      if (error) throw error;
      await fetchReminders(adminId);
      alert(`Generated ${data?.length || 0} reminder(s) for today.`);
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setGenerating(false);
    }
  };

  const getUrgency = (daysUntilDue) => {
    if (daysUntilDue <= 0) return 'critical';
    if (daysUntilDue <= 3) return 'warning';
    return 'info';
  };

  const getDaysLabel = (days) => {
    if (days === 0) return 'Due Today';
    if (days < 0)  return `${Math.abs(days)} day${Math.abs(days) > 1 ? 's' : ''} overdue`;
    return `${days} day${days > 1 ? 's' : ''} remaining`;
  };

  if (loading) return (
    <div className="space-y-3 animate-pulse">
      {[1,2,3].map(i => <div key={i} className="h-16 bg-muted rounded-xl" />)}
    </div>
  );

  return (
    <div className="space-y-5">

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: 'Due Today',   value: summary.due_today,  amount: summary.due_today_amount,  icon: 'Clock',         color: 'text-orange-600', bg: 'bg-orange-50 border-orange-200' },
          { label: 'Overdue',     value: summary.overdue,    amount: summary.overdue_amount,    icon: 'AlertCircle',   color: 'text-red-600',    bg: 'bg-red-50 border-red-200' },
          { label: 'Next 7 Days', value: summary.upcoming,   amount: null,                      icon: 'Calendar',      color: 'text-blue-600',   bg: 'bg-blue-50 border-blue-200' },
        ].map(s => (
          <div key={s.label} className={`p-4 rounded-xl border ${s.bg}`}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-muted-foreground">{s.label}</p>
              <Icon name={s.icon} size={16} color="currentColor" className={s.color} />
            </div>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            {s.amount !== null && (
              <p className="text-xs text-muted-foreground mt-1">{fmt(s.amount)}</p>
            )}
          </div>
        ))}
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 flex-wrap">
        {[
          { id: 'upcoming', label: `Upcoming (${upcomingInstallments.length})` },
          { id: 'overdue',  label: `Overdue (${overdueInstallments.length})` },
          { id: 'reminders',label: `Reminders Log (${reminders.length})` },
        ].map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === t.id ? 'text-white' : 'bg-card border border-border text-muted-foreground hover:text-foreground'
            }`}
            style={activeTab === t.id ? { background: 'linear-gradient(135deg,#1A56DB,#1E429F)' } : {}}>
            {t.label}
          </button>
        ))}
        <button onClick={handleGenerateReminders} disabled={generating}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all disabled:opacity-60">
          {generating ? (
            <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
            </svg>
          ) : <Icon name="RefreshCw" size={13} color="currentColor" />}
          Generate Today's Reminders
        </button>
      </div>

      {/* ── Upcoming installments ── */}
      {activeTab === 'upcoming' && (
        <div>
          {upcomingInstallments.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Icon name="CheckCircle" size={28} color="#059669" />
              <p className="text-sm font-medium text-emerald-600 mt-2">All clear — no upcoming installments in the next 30 days</p>
            </div>
          ) : (
            <div className="space-y-2">
              {upcomingInstallments.map(inst => (
                <InstallmentAlertRow
                  key={inst.id}
                  installment={inst}
                  daysLabel={getDaysLabel(inst.days_until_due)}
                  urgency={getUrgency(inst.days_until_due)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Overdue installments ── */}
      {activeTab === 'overdue' && (
        <div>
          {overdueInstallments.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Icon name="CheckCircle" size={28} color="#059669" />
              <p className="text-sm font-medium text-emerald-600 mt-2">No overdue installments</p>
            </div>
          ) : (
            <div className="space-y-2">
              {overdueInstallments.map(inst => (
                <div key={inst.id} className="border-l-4 border-l-red-500 bg-red-50 border border-red-200 rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-sm text-foreground">{inst.client_name}</p>
                      <p className="text-xs text-muted-foreground">{inst.account_number} · #{inst.installment_no} · {inst.invoice_number}</p>
                      <p className="text-xs text-red-600 font-semibold mt-1">
                        {inst.days_overdue} day{inst.days_overdue > 1 ? 's' : ''} overdue since {fmtDate(inst.due_date)}
                        {inst.days_overdue > 7 && ' — PENALTY ACCRUING'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-red-600">{fmt(inst.installment_amount)}</p>
                      {inst.penalty_amount > 0 && (
                        <p className="text-xs text-red-500">+ {fmt(inst.penalty_amount)} penalty</p>
                      )}
                      <p className="text-xs text-muted-foreground">{inst.phone}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Reminders log ── */}
      {activeTab === 'reminders' && (
        <div>
          {reminders.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Icon name="Bell" size={28} color="currentColor" />
              <p className="text-sm mt-2">No reminders generated yet</p>
              <p className="text-xs mt-1">Click "Generate Today's Reminders" to create reminders based on today's due dates</p>
            </div>
          ) : (
            <div className="space-y-2">
              {reminders.map(r => {
                const cfg = ALERT_CONFIG[r.reminder_type] || ALERT_CONFIG.reminder_7_days;
                return (
                  <div key={r.id} className={`flex items-start gap-3 p-3 rounded-xl border ${cfg.bg}`}>
                    <Icon name={cfg.icon} size={16} color="currentColor" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${cfg.badge}`}>
                          {cfg.label}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {r.client?.full_name} · {fmtDate(r.due_date)}
                        </span>
                      </div>
                      <p className="text-xs text-foreground mt-1">{r.message}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs font-bold text-foreground">{fmt(r.amount_due)}</p>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        r.status === 'sent'    ? 'bg-emerald-100 text-emerald-700' :
                        r.status === 'failed'  ? 'bg-red-100 text-red-700' :
                        'bg-muted text-muted-foreground'
                      }`}>{r.status}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PaymentAlertsPanel;
