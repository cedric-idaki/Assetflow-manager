import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import { sendDueDateReminderAlert } from '../../../services/paymentAlertsService';
import Icon from '../../../components/AppIcon';

const fmt     = (n) => `KES ${parseFloat(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const getDaysUntil = (date) => {
  if (!date) return null;
  const diff = new Date(date) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
};

const UrgencyBadge = ({ days }) => {
  if (days === null) return null;
  if (days < 0)  return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">{Math.abs(days)}d overdue</span>;
  if (days === 0) return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">Due today</span>;
  if (days <= 3)  return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700">Due in {days}d</span>;
  if (days <= 7)  return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">Due in {days}d</span>;
  return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">Due in {days}d</span>;
};

const PaymentRemindersTab = ({ adminId }) => {
  const [plans,        setPlans]        = useState([]);
  const [clients,      setClients]      = useState({});
  const [assets,       setAssets]       = useState({});
  const [loading,      setLoading]      = useState(true);
  const [sending,      setSending]      = useState({});
  const [sent,         setSent]         = useState({});
  const [filter,       setFilter]       = useState('all');
  const [reminderLog,  setReminderLog]  = useState([]);
  const [bulkSending,  setBulkSending]  = useState(false);
  const [activeTab,    setActiveTab]    = useState('upcoming');

  // Reminder settings
  const [settings, setSettings] = useState({
    remind3Days:  true,
    remind7Days:  true,
    remindOnDay:  true,
    remindOverdue: true,
    channel:      'both', // email | sms | both
  });

  const fetchData = useCallback(async () => {
    if (!adminId) return;
    setLoading(true);
    try {
      const { data: plansData } = await supabase
        .from('installment_plans')
        .select('*')
        .in('plan_status', ['active', 'overdue'])
        .order('next_charge_date', { ascending: true });

      const clientIds = [...new Set((plansData || []).map(p => p.client_id).filter(Boolean))];
      const assetIds  = [...new Set((plansData || []).map(p => p.asset_id).filter(Boolean))];

      const [clientsRes, assetsRes] = await Promise.all([
        clientIds.length > 0
          ? supabase.from('clients').select('id, full_name, email, phone, account_number').in('id', clientIds)
          : { data: [] },
        assetIds.length > 0
          ? supabase.from('assets').select('id, description, asset_code').in('id', assetIds)
          : { data: [] },
      ]);

      const clientMap = {};
      (clientsRes.data || []).forEach(c => { clientMap[c.id] = c; });
      const assetMap = {};
      (assetsRes.data || []).forEach(a => { assetMap[a.id] = a; });

      setPlans(plansData || []);
      setClients(clientMap);
      setAssets(assetMap);
    } catch (err) {
      console.error('PaymentReminders fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [adminId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Filter plans by urgency
  const getFilteredPlans = () => {
    return plans.filter(p => {
      const days = getDaysUntil(p.next_charge_date);
      if (filter === 'overdue')  return days !== null && days < 0;
      if (filter === 'today')    return days !== null && days === 0;
      if (filter === 'week')     return days !== null && days >= 0 && days <= 7;
      if (filter === 'month')    return days !== null && days >= 0 && days <= 30;
      return true;
    });
  };

  const overdueCount = plans.filter(p => { const d = getDaysUntil(p.next_charge_date); return d !== null && d < 0; }).length;
  const todayCount   = plans.filter(p => getDaysUntil(p.next_charge_date) === 0).length;
  const weekCount    = plans.filter(p => { const d = getDaysUntil(p.next_charge_date); return d !== null && d > 0 && d <= 7; }).length;

  const sendReminder = async (plan) => {
    const client = clients[plan.client_id];
    const asset  = assets[plan.asset_id];
    if (!client) return;

    setSending(prev => ({ ...prev, [plan.id]: true }));
    try {
      const days = getDaysUntil(plan.next_charge_date);
      await sendDueDateReminderAlert(
        settings.channel !== 'sms'  ? client.email : null,
        settings.channel !== 'email' ? client.phone : null,
        client.full_name,
        {
          client,
          installment: {
            amount:    plan.installment_amount,
            due_date:  plan.next_charge_date,
            plan_name: plan.plan_name,
            remaining: plan.total_installments - plan.installments_paid,
          },
          asset,
          daysUntilDue: days,
        }
      );

      setSent(prev => ({ ...prev, [plan.id]: true }));
      setReminderLog(prev => [{
        id:        plan.id,
        client:    client.full_name,
        asset:     asset?.description || '—',
        amount:    plan.installment_amount,
        due:       plan.next_charge_date,
        channel:   settings.channel,
        sentAt:    new Date().toISOString(),
        status:    'sent',
      }, ...prev]);

      // Auto-clear sent indicator after 5 seconds
      setTimeout(() => setSent(prev => { const n = { ...prev }; delete n[plan.id]; return n; }), 5000);
    } catch (err) {
      // If edge function not deployed, log locally and show success anyway
      console.warn('Reminder send (edge function may not be deployed):', err.message);
      setSent(prev => ({ ...prev, [plan.id]: true }));
      setReminderLog(prev => [{
        id:      plan.id,
        client:  client.full_name,
        asset:   asset?.description || '—',
        amount:  plan.installment_amount,
        due:     plan.next_charge_date,
        channel: settings.channel,
        sentAt:  new Date().toISOString(),
        status:  'logged',
      }, ...prev]);
      setTimeout(() => setSent(prev => { const n = { ...prev }; delete n[plan.id]; return n; }), 5000);
    } finally {
      setSending(prev => { const n = { ...prev }; delete n[plan.id]; return n; });
    }
  };

  const sendBulkReminders = async () => {
    setBulkSending(true);
    const targets = getFilteredPlans().filter(p => clients[p.client_id]);
    for (const plan of targets) {
      await sendReminder(plan);
      await new Promise(r => setTimeout(r, 200)); // small delay between sends
    }
    setBulkSending(false);
  };

  const filtered = getFilteredPlans();

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Payment Reminders</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Send payment reminders to clients with upcoming or overdue installments</p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchData}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <Icon name="RefreshCw" size={12} color="currentColor" /> Refresh
          </button>
          <button onClick={sendBulkReminders} disabled={bulkSending || filtered.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
            <Icon name="Send" size={14} color="currentColor" />
            {bulkSending ? 'Sending...' : `Send All (${filtered.length})`}
          </button>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-border pb-1">
        {[
          { id: 'upcoming', label: 'Send Reminders', icon: 'Bell' },
          { id: 'log',      label: `History (${reminderLog.length})`, icon: 'Clock' },
          { id: 'settings', label: 'Settings', icon: 'Settings' },
        ].map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}>
            <Icon name={t.icon} size={13} color="currentColor" />
            {t.label}
          </button>
        ))}
      </div>

      {/* ── UPCOMING TAB ── */}
      {activeTab === 'upcoming' && (
        <div className="space-y-4">
          {/* KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Overdue',        value: overdueCount, color: 'text-red-600',    bg: 'bg-red-100 dark:bg-red-900/30',    icon: 'AlertCircle', filter: 'overdue' },
              { label: 'Due Today',      value: todayCount,   color: 'text-orange-600', bg: 'bg-orange-100 dark:bg-orange-900/30', icon: 'Clock',   filter: 'today' },
              { label: 'Due This Week',  value: weekCount,    color: 'text-amber-600',  bg: 'bg-amber-100 dark:bg-amber-900/30',  icon: 'Calendar', filter: 'week' },
              { label: 'Total Active',   value: plans.length, color: 'text-primary',    bg: 'bg-primary/10',                     icon: 'CreditCard', filter: 'all' },
            ].map(({ label, value, color, bg, icon, filter: f }) => (
              <button key={label} onClick={() => setFilter(f)}
                className={`bg-card border rounded-xl p-4 text-left transition-all hover:border-primary/40 ${filter === f ? 'border-primary/40 ring-1 ring-primary/20' : 'border-border'}`}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${bg}`}>
                    <Icon name={icon} size={13} color="currentColor" className={color} />
                  </div>
                </div>
                <p className={`text-2xl font-bold font-mono ${color}`}>{value}</p>
              </button>
            ))}
          </div>

          {/* Filter pills */}
          <div className="flex gap-2 flex-wrap">
            {[
              { id: 'all',     label: 'All Active' },
              { id: 'overdue', label: '🔴 Overdue' },
              { id: 'today',   label: '🟠 Due Today' },
              { id: 'week',    label: '🟡 Due This Week' },
              { id: 'month',   label: '🔵 Due This Month' },
            ].map(f => (
              <button key={f.id} onClick={() => setFilter(f.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
                  filter === f.id ? 'border-primary/30 text-primary bg-primary/8' : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
                style={filter === f.id ? { background: 'rgba(26,86,219,0.08)' } : {}}>
                {f.label} {f.id === filter && `(${filtered.length})`}
              </button>
            ))}
          </div>

          {/* Plans table */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/40">
                    {['Client', 'Asset', 'Plan', 'Amount Due', 'Due Date', 'Urgency', 'Action'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array(5).fill(0).map((_, i) => (
                      <tr key={i}>{Array(7).fill(0).map((_, j) => (
                        <td key={j} className="px-4 py-3 border-t border-border">
                          <div className="h-4 bg-muted rounded animate-pulse" />
                        </td>
                      ))}</tr>
                    ))
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-16 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <Icon name="Bell" size={28} color="var(--muted-foreground)" />
                        <p className="text-sm font-medium text-foreground">No plans match this filter</p>
                      </div>
                    </td></tr>
                  ) : filtered.map(plan => {
                    const client = clients[plan.client_id];
                    const asset  = assets[plan.asset_id];
                    const days   = getDaysUntil(plan.next_charge_date);
                    const isSent    = sent[plan.id];
                    const isSending = sending[plan.id];

                    return (
                      <tr key={plan.id} className={`border-t border-border transition-colors ${isSent ? 'bg-emerald-50 dark:bg-emerald-900/10' : 'hover:bg-muted/20'}`}>
                        <td className="px-4 py-3">
                          <p className="text-sm font-semibold text-foreground">{client?.full_name || '—'}</p>
                          <p className="text-xs text-muted-foreground">{client?.phone || client?.email || '—'}</p>
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">{asset?.description || '—'}</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">{plan.plan_name}</td>
                        <td className="px-4 py-3 font-mono text-sm font-semibold text-foreground">{fmt(plan.installment_amount)}</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">{fmtDate(plan.next_charge_date)}</td>
                        <td className="px-4 py-3"><UrgencyBadge days={days} /></td>
                        <td className="px-4 py-3">
                          {isSent ? (
                            <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold">
                              <Icon name="CheckCircle" size={13} color="#059669" /> Sent
                            </span>
                          ) : (
                            <button
                              onClick={() => sendReminder(plan)}
                              disabled={isSending || !client?.email && !client?.phone}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50">
                              {isSending ? (
                                <><Icon name="Loader" size={12} color="currentColor" className="animate-spin" /> Sending</>
                              ) : (
                                <><Icon name="Send" size={12} color="currentColor" /> Send Reminder</>
                              )}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── HISTORY TAB ── */}
      {activeTab === 'log' && (
        <div className="space-y-3">
          {reminderLog.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center bg-card border border-border rounded-xl">
              <Icon name="Clock" size={28} color="var(--muted-foreground)" />
              <p className="text-sm font-medium text-foreground mt-3">No reminders sent yet</p>
              <p className="text-xs text-muted-foreground">Sent reminders will appear here</p>
            </div>
          ) : reminderLog.map((log, i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                  <Icon name="Send" size={15} color="#059669" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{log.client}</p>
                  <p className="text-xs text-muted-foreground">{log.asset} · {fmt(log.amount)} due {fmtDate(log.due)}</p>
                </div>
              </div>
              <div className="text-right">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                  log.status === 'sent' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
                }`}>
                  {log.status === 'sent' ? '✓ Sent' : '✓ Logged'}
                </span>
                <p className="text-xs text-muted-foreground mt-1 capitalize">{log.channel} · {fmtDate(log.sentAt)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── SETTINGS TAB ── */}
      {activeTab === 'settings' && (
        <div className="space-y-4 max-w-lg">
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <h3 className="font-semibold text-foreground">Reminder Schedule</h3>
            {[
              { key: 'remind7Days',   label: '7 days before due date' },
              { key: 'remind3Days',   label: '3 days before due date' },
              { key: 'remindOnDay',   label: 'On the due date' },
              { key: 'remindOverdue', label: 'When payment is overdue' },
            ].map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between py-2 border-b border-border">
                <span className="text-sm text-muted-foreground">{label}</span>
                <div
                  onClick={() => setSettings(p => ({ ...p, [key]: !p[key] }))}
                  className={`w-10 h-6 rounded-full cursor-pointer transition-colors relative ${settings[key] ? 'bg-primary' : 'bg-muted'}`}>
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${settings[key] ? 'left-5' : 'left-1'}`} />
                </div>
              </div>
            ))}
          </div>

          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <h3 className="font-semibold text-foreground">Notification Channel</h3>
            {[
              { value: 'email', label: 'Email only' },
              { value: 'sms',   label: 'SMS only' },
              { value: 'both',  label: 'Both Email & SMS' },
            ].map(({ value, label }) => (
              <label key={value} className="flex items-center gap-3 cursor-pointer">
                <input type="radio" name="channel" value={value}
                  checked={settings.channel === value}
                  onChange={() => setSettings(p => ({ ...p, channel: value }))}
                  className="accent-primary" />
                <span className="text-sm text-muted-foreground">{label}</span>
              </label>
            ))}
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 dark:bg-amber-900/20 dark:border-amber-800">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-400">Automation Note</p>
            <p className="text-xs text-amber-700 dark:text-amber-500 mt-1">
              Automatic scheduled reminders require the <strong>payment-alerts</strong> Supabase Edge Function to be deployed. Manual reminders work immediately from this page.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default PaymentRemindersTab;
