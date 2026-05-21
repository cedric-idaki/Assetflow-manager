import React, { useState, useEffect } from 'react';
import AppIcon from '../../../components/AppIcon';
import { triggerKYCReminders, fetchReminderLogs, fetchReminderStats } from '../../../services/kycReminderService';

const channelIcon = { email: 'Mail', sms: 'MessageSquare' };
const statusColor = {
  sent: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  skipped: 'bg-gray-100 text-gray-600',
};
const daysBadgeColor = {
  7: 'bg-red-100 text-red-700',
  14: 'bg-orange-100 text-orange-700',
  30: 'bg-yellow-100 text-yellow-700',
};

export default function ReminderLogsPanel() {
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [triggerResult, setTriggerResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [logsData, statsData] = await Promise.all([
        fetchReminderLogs({ limit: 50 }),
        fetchReminderStats(),
      ]);
      setLogs(logsData);
      setStats(statsData);
    } catch (err) {
      setError(err?.message || 'Failed to load reminder logs');
    } finally {
      setLoading(false);
    }
  };

  const handleTrigger = async () => {
    setTriggering(true);
    setTriggerResult(null);
    try {
      const result = await triggerKYCReminders();
      setTriggerResult(result);
      await loadData();
    } catch (err) {
      setTriggerResult({ success: false, error: err?.message });
    } finally {
      setTriggering(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    return new Date(dateStr)?.toLocaleDateString('en-KE', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">KYC Renewal Reminders</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Automated email & SMS sent at 30, 14, and 7 days before expiry</p>
        </div>
        <button
          onClick={handleTrigger}
          disabled={triggering}
          className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors"
        >
          <AppIcon name={triggering ? 'Loader2' : 'Send'} size={14} className={triggering ? 'animate-spin' : ''} />
          {triggering ? 'Sending...' : 'Run Now'}
        </button>
      </div>
      {/* Trigger result */}
      {triggerResult && (
        <div className={`rounded-lg p-3 text-sm border ${
          triggerResult?.success ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          {triggerResult?.success ? (
            <div className="flex items-start gap-2">
              <AppIcon name="CheckCircle" size={15} className="mt-0.5 flex-shrink-0" />
              <span>
                Reminders sent — <strong>{triggerResult?.emailsSent ?? 0}</strong> emails,{' '}
                <strong>{triggerResult?.smsSent ?? 0}</strong> SMS,{' '}
                <strong>{triggerResult?.skipped ?? 0}</strong> skipped (already sent today)
              </span>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <AppIcon name="AlertCircle" size={15} className="mt-0.5 flex-shrink-0" />
              <span>{triggerResult?.error || 'Failed to send reminders'}</span>
            </div>
          )}
        </div>
      )}
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Emails Sent (30d)', value: stats?.emailsSent, icon: 'Mail', color: 'text-blue-600' },
            { label: 'SMS Sent (30d)', value: stats?.smsSent, icon: 'MessageSquare', color: 'text-orange-600' },
            { label: 'Failed', value: stats?.totalFailed, icon: 'AlertCircle', color: 'text-red-600' },
            { label: 'Total Sent (30d)', value: stats?.totalSent, icon: 'Bell', color: 'text-green-600' },
          ]?.map((s) => (
            <div key={s?.label} className="bg-muted/40 rounded-xl p-4">
              <div className="flex items-center gap-1.5 mb-1">
                <AppIcon name={s?.icon} size={13} className={s?.color} />
                <span className="text-xs text-muted-foreground">{s?.label}</span>
              </div>
              <p className={`text-2xl font-bold ${s?.color}`}>{s?.value ?? 0}</p>
            </div>
          ))}
        </div>
      )}
      {/* Schedule info */}
      <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
        <div className="flex items-start gap-2">
          <AppIcon name="Clock" size={14} className="text-blue-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-blue-800 dark:text-blue-300 mb-1">Automated Schedule</p>
            <div className="flex flex-wrap gap-2">
              {[
                { days: 30, label: '30 days before', color: 'bg-yellow-100 text-yellow-700' },
                { days: 14, label: '14 days before', color: 'bg-orange-100 text-orange-700' },
                { days: 7, label: '7 days before', color: 'bg-red-100 text-red-700' },
              ]?.map(({ days, label, color }) => (
                <span key={days} className={`text-xs font-medium px-2 py-0.5 rounded-full ${color}`}>
                  {label}
                </span>
              ))}
            </div>
            <p className="text-xs text-blue-700 dark:text-blue-400 mt-1.5">
              Duplicate reminders are suppressed — each client receives at most one email and one SMS per day per document.
            </p>
          </div>
        </div>
      </div>
      {/* Logs table */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="bg-muted/30 px-4 py-2.5 border-b border-border flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recent Reminder Log</span>
          <button onClick={loadData} className="text-xs text-primary hover:underline flex items-center gap-1">
            <AppIcon name="RefreshCw" size={11} />
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <AppIcon name="Loader2" size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 p-4 text-sm text-red-600">
            <AppIcon name="AlertCircle" size={15} />
            {error}
          </div>
        ) : logs?.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <AppIcon name="Bell" size={28} className="mb-2 opacity-30" />
            <p className="text-sm">No reminders sent yet</p>
            <p className="text-xs mt-1">Click "Run Now" to send reminders for expiring documents</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {['Client', 'Document', 'Expiry', 'Window', 'Channel', 'Recipient', 'Status', 'Sent At']?.map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs?.map((log) => (
                  <tr key={log?.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-foreground text-xs">{log?.clients?.full_name || '—'}</p>
                      <p className="text-xs text-muted-foreground">{log?.clients?.account_number || ''}</p>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-foreground">{log?.document_type}</td>
                    <td className="px-3 py-2.5 text-xs text-foreground">
                      {log?.expiry_date ? new Date(log.expiry_date)?.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        daysBadgeColor?.[log?.days_before_expiry] || 'bg-gray-100 text-gray-600'
                      }`}>
                        {log?.days_before_expiry}d
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1">
                        <AppIcon name={channelIcon?.[log?.channel] || 'Bell'} size={12} className="text-muted-foreground" />
                        <span className="text-xs capitalize text-foreground">{log?.channel}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[140px] truncate">{log?.recipient}</td>
                    <td className="px-3 py-2.5">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusColor?.[log?.status] || 'bg-gray-100 text-gray-600'}`}>
                        {log?.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{formatDate(log?.sent_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
