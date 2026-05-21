import React, { useState } from 'react';
import { BarChart, Bar, LineChart, Line, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import ExportModal from './ExportModal';
import ScheduleReportModal from './ScheduleReportModal';

// ── Mock KYC data ──────────────────────────────────────────────────────────────
const verificationTrendData = [
  { month: 'Sep', verified: 78, pending: 15, rejected: 7 },
  { month: 'Oct', verified: 82, pending: 12, rejected: 6 },
  { month: 'Nov', verified: 80, pending: 14, rejected: 6 },
  { month: 'Dec', verified: 85, pending: 10, rejected: 5 },
  { month: 'Jan', verified: 88, pending: 8, rejected: 4 },
  { month: 'Feb', verified: 91, pending: 6, rejected: 3 },
];

const expiryBucketData = [
  { bucket: '≤ 30 Days', count: 24, value: 24 },
  { bucket: '31–60 Days', count: 38, value: 38 },
  { bucket: '61–90 Days', count: 52, value: 52 },
  { bucket: '> 90 Days', count: 143, value: 143 },
];

const agingBySegmentData = [
  { segment: 'Business', current: 45, days30: 18, days60: 12, days90: 8 },
  { segment: 'Individual', current: 120, days30: 35, days60: 22, days90: 15 },
  { segment: 'Corporate', current: 28, days30: 9, days60: 6, days90: 4 },
];

const docTypeRatesData = [
  { type: 'National ID', rate: 94, count: 312 },
  { type: 'Passport', rate: 88, count: 145 },
  { type: 'KRA PIN', rate: 97, count: 289 },
  { type: 'Business Cert.', rate: 82, count: 73 },
  { type: 'Utility Bill', rate: 76, count: 198 },
];

const complianceBySegmentData = [
  { segment: 'Corporate', score: 96 },
  { segment: 'Business', score: 89 },
  { segment: 'Individual', score: 83 },
];

const renewalTimelineData = [
  { week: 'W1', completed: 12, pending: 8 },
  { week: 'W2', completed: 18, pending: 6 },
  { week: 'W3', completed: 15, pending: 9 },
  { week: 'W4', completed: 22, pending: 4 },
];

const COLORS = {
  critical: '#ef4444',
  warning: '#f59e0b',
  info: '#3b82f6',
  safe: '#10b981',
  primary: 'var(--color-primary)',
  muted: 'var(--color-muted-foreground)',
};

// ── Sub-components ─────────────────────────────────────────────────────────────
const KPICard = ({ title, value, subtitle, icon, color, trend, trendLabel }) => (
  <div className="bg-card border border-border rounded-xl p-5">
    <div className="flex items-start justify-between mb-3">
      <span className="text-xs md:text-sm text-muted-foreground font-medium">{title}</span>
      <div className={`flex items-center justify-center w-8 h-8 rounded-xl ${color}`}>
        <Icon name={icon} size={16} color="currentColor" />
      </div>
    </div>
    <p className="text-2xl font-bold text-foreground mb-1">{value}</p>
    {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
    {trend !== undefined && (
      <div className={`flex items-center gap-1 mt-2 ${trend >= 0 ? 'text-success' : 'text-error'}`}>
        <Icon name={trend >= 0 ? 'TrendingUp' : 'TrendingDown'} size={12} color="currentColor" />
        <span className="text-xs font-medium">{trendLabel}</span>
      </div>
    )}
  </div>
);

const SectionHeader = ({ title, subtitle }) => (
  <div className="mb-4">
    <h3 className="text-base font-semibold text-foreground">{title}</h3>
    {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
  </div>
);

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-lg">
      <p className="text-xs font-semibold text-foreground mb-1">{label}</p>
      {payload?.map((entry, i) => (
        <p key={i} className="text-xs" style={{ color: entry?.color }}>
          {entry?.name}: {entry?.value}{typeof entry?.value === 'number' && entry?.name?.toLowerCase()?.includes('rate') ? '%' : ''}
        </p>
      ))}
    </div>
  );
};

// ── Main Component ─────────────────────────────────────────────────────────────
const KYCMetricsDashboard = () => {
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportTarget, setExportTarget] = useState('');
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleTarget, setScheduleTarget] = useState('');
  const [scheduledReports, setScheduledReports] = useState([]);

  // Derived stats
  const totalClients = 257;
  const verifiedCount = 234;
  const verificationRate = Math.round((verifiedCount / totalClients) * 100);
  const renewalPending = 47;
  const renewalCompleted = 89;
  const renewalRate = Math.round((renewalCompleted / (renewalCompleted + renewalPending)) * 100);
  const avgVerifyDays = 2.4;
  const overallCompliance = 89;

  const handleExport = (config) => {
    const rows = [
      ['Report', 'KYC Metrics Dashboard'],
      ['Exported At', new Date().toLocaleString('en-GB')],
      [''],
      ['== KPI Summary =='],
      ['Total Clients', totalClients],
      ['Verified Clients', verifiedCount],
      ['Verification Rate', `${verificationRate}%`],
      ['Renewal Pending', renewalPending],
      [''],
      ['== Verification Trend =='],
      ['Month', 'Verified', 'Pending', 'Rejected'],
      ...verificationTrendData.map(r => [r.month, r.verified, r.pending, r.rejected]),
      [''],
      ['== Document Expiry Buckets =='],
      ['Bucket', 'Count'],
      ...expiryBucketData.map(r => [r.bucket, r.count]),
      [''],
      ['== Document Type Verification Rates =='],
      ['Document Type', 'Rate (%)', 'Count'],
      ...docTypeRatesData.map(r => [r.type, r.rate, r.count]),
      [''],
      ['== Compliance by Segment =='],
      ['Segment', 'Score (%)'],
      ...complianceBySegmentData.map(r => [r.segment, r.score]),
    ];

    const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `KYC_Metrics_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setExportModalOpen(false);
  };

  const openExport = (reportName) => {
    setExportTarget(reportName);
    setExportModalOpen(true);
  };

  const openSchedule = (reportName) => {
    setScheduleTarget(reportName);
    setScheduleModalOpen(true);
  };

  const getNextRun = (frequency) => {
    const d = new Date();
    if (frequency === 'daily') d.setDate(d.getDate() + 1);
    else if (frequency === 'weekly') d.setDate(d.getDate() + 7);
    else if (frequency === 'monthly') d.setMonth(d.getMonth() + 1);
    else if (frequency === 'quarterly') d.setMonth(d.getMonth() + 3);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const handleSchedule = (config) => {
    const newSchedule = {
      id: Date.now(),
      reportTitle: scheduleTarget,
      frequency: config.frequency,
      recipients: config.recipients,
      includeAttachment: config.includeAttachment,
      createdAt: new Date().toISOString(),
      nextRun: getNextRun(config.frequency),
    };
    setScheduledReports(prev => [...prev, newSchedule]);
    setScheduleModalOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">KYC Metrics Dashboard</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Compliance verification, renewal tracking, and client segment analysis</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" icon="FileText" onClick={() => openExport('KYC Full Report – PDF')}>
            Export PDF
          </Button>
          <Button variant="outline" size="sm" icon="Table" onClick={() => openExport('KYC Full Report – Excel')}>
            Export Excel
          </Button>
          <Button variant="outline" size="sm" icon="Calendar" onClick={() => openSchedule('KYC Full Report')}>
            Schedule
          </Button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Overall Verification Rate" value={`${verificationRate}%`} subtitle={`${verifiedCount} of ${totalClients} clients verified`} icon="ShieldCheck" color="bg-success bg-opacity-10 text-success" trend={3.2} trendLabel="+3.2% vs last month" />
        <KPICard title="Renewal Completion Rate" value={`${renewalRate}%`} subtitle={`${renewalPending} renewals pending`} icon="RefreshCw" color="bg-primary bg-opacity-10 text-primary" trend={5.1} trendLabel="+5.1% vs last month" />
        <KPICard title="Avg. Verification Time" value={`${avgVerifyDays}d`} subtitle="Average days to complete" icon="Clock" color="bg-accent bg-opacity-10 text-accent" trend={-0.6} trendLabel="-0.6d improvement" />
        <KPICard title="Overall Compliance Score" value={`${overallCompliance}%`} subtitle="Across all client segments" icon="Award" color="bg-warning bg-opacity-10 text-warning" trend={2.0} trendLabel="+2.0% vs last month" />
      </div>

      {/* Row 1: Verification Trend + Expiry Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-1">
            <SectionHeader title="Verification Rate Trend" subtitle="Monthly verified / pending / rejected breakdown" />
            <Button variant="ghost" size="sm" icon="Download" onClick={() => openExport('Verification Trend')} />
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={verificationTrendData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="verified" name="Verified %" stroke={COLORS?.safe} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="pending" name="Pending %" stroke={COLORS?.warning} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="rejected" name="Rejected %" stroke={COLORS?.critical} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-1">
            <SectionHeader title="Document Expiry Timeline" subtitle="Documents expiring in 30 / 60 / 90 day buckets" />
            <Button variant="ghost" size="sm" icon="Download" onClick={() => openExport('Expiry Timeline')} />
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={expiryBucketData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="count" name="Documents" radius={[4, 4, 0, 0]}>
                {expiryBucketData?.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={index === 0 ? COLORS?.critical : index === 1 ? COLORS?.warning : index === 2 ? COLORS?.info : COLORS?.safe} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-3 mt-3">
            {[['≤ 30d', COLORS?.critical, 'Critical'], ['31–60d', COLORS?.warning, 'Warning'], ['61–90d', COLORS?.info, 'Monitor'], ['> 90d', COLORS?.safe, 'Safe']]?.map(([label, color, tag]) => (
              <div key={label} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                <span className="text-xs text-muted-foreground">{label} <span className="font-medium text-foreground">({tag})</span></span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Row 2: Aging Analysis + Renewal Tracking */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-1">
            <SectionHeader title="Aging Analysis by Client Segment" subtitle="Business / Individual / Corporate breakdown" />
            <Button variant="ghost" size="sm" icon="Download" onClick={() => openExport('Aging Analysis')} />
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={agingBySegmentData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="segment" tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="current" name="Current" stackId="a" fill={COLORS?.safe} />
              <Bar dataKey="days30" name="30 Days" stackId="a" fill={COLORS?.info} />
              <Bar dataKey="days60" name="60 Days" stackId="a" fill={COLORS?.warning} />
              <Bar dataKey="days90" name="90+ Days" stackId="a" fill={COLORS?.critical} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-3 gap-2 mt-4">
            {agingBySegmentData?.map(seg => (
              <div key={seg?.segment} className="bg-muted rounded-xl p-3 text-center">
                <p className="text-xs text-muted-foreground">{seg?.segment}</p>
                <p className="text-sm font-bold text-foreground">{seg?.current + seg?.days30 + seg?.days60 + seg?.days90}</p>
                <p className="text-xs text-error">{seg?.days90} critical</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-1">
            <SectionHeader title="Renewal Completion Tracking" subtitle="Weekly renewal progress this month" />
            <Button variant="ghost" size="sm" icon="Download" onClick={() => openExport('Renewal Tracking')} />
          </div>
          <div className="mb-4 p-4 bg-muted rounded-xl">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-foreground">Overall Renewal Rate</span>
              <span className="text-xs font-bold text-primary">{renewalRate}%</span>
            </div>
            <div className="w-full bg-border rounded-full h-2">
              <div className="h-2 rounded-full bg-primary transition-all duration-500" style={{ width: `${renewalRate}%` }} />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-xs text-success">{renewalCompleted} completed</span>
              <span className="text-xs text-warning">{renewalPending} pending</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={renewalTimelineData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="week" tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="completed" name="Completed" fill={COLORS?.safe} radius={[4, 4, 0, 0]} />
              <Bar dataKey="pending" name="Pending" fill={COLORS?.warning} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Row 3: Document Type Rates + Compliance Score */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <SectionHeader title="Document Type Verification Rates" subtitle="Acceptance rate per document category" />
            <Button variant="ghost" size="sm" icon="Download" onClick={() => openExport('Document Type Rates')} />
          </div>
          <div className="space-y-3">
            {docTypeRatesData?.map(doc => (
              <div key={doc?.type}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Icon name="FileText" size={13} color="var(--color-muted-foreground)" />
                    <span className="text-xs font-medium text-foreground">{doc?.type}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{doc?.count} docs</span>
                    <span className={`text-xs font-bold ${doc?.rate >= 90 ? 'text-success' : doc?.rate >= 80 ? 'text-warning' : 'text-error'}`}>{doc?.rate}%</span>
                  </div>
                </div>
                <div className="w-full bg-border rounded-full h-1.5">
                  <div className={`h-1.5 rounded-full transition-all duration-500 ${doc?.rate >= 90 ? 'bg-success' : doc?.rate >= 80 ? 'bg-warning' : 'bg-error'}`} style={{ width: `${doc?.rate}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <SectionHeader title="Compliance Score by Segment" subtitle="KYC compliance health per client category" />
            <Button variant="ghost" size="sm" icon="Download" onClick={() => openExport('Compliance Scores')} />
          </div>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {complianceBySegmentData?.map(seg => (
              <div key={seg?.segment} className="text-center p-3 bg-muted rounded-xl">
                <div className="relative inline-flex items-center justify-center w-16 h-16 mb-2">
                  <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
                    <circle cx="32" cy="32" r="26" fill="none" stroke="var(--color-border)" strokeWidth="6" />
                    <circle cx="32" cy="32" r="26" fill="none" stroke={seg?.score >= 90 ? COLORS?.safe : seg?.score >= 80 ? COLORS?.warning : COLORS?.critical} strokeWidth="6" strokeDasharray={`${(seg?.score / 100) * 163.4} 163.4`} strokeLinecap="round" />
                  </svg>
                  <span className="absolute text-sm font-bold text-foreground">{seg?.score}%</span>
                </div>
                <p className="text-xs font-medium text-foreground">{seg?.segment}</p>
                <p className={`text-xs mt-0.5 ${seg?.score >= 90 ? 'text-success' : seg?.score >= 80 ? 'text-warning' : 'text-error'}`}>
                  {seg?.score >= 90 ? 'Excellent' : seg?.score >= 80 ? 'Good' : 'Needs Attention'}
                </p>
              </div>
            ))}
          </div>
          <div className="border-t border-border pt-4">
            <p className="text-xs font-semibold text-foreground mb-3">Avg. Verification Time by Segment</p>
            <div className="space-y-2">
              {[{ segment: 'Corporate', days: 1.8 }, { segment: 'Business', days: 2.4 }, { segment: 'Individual', days: 3.1 }]?.map(item => (
                <div key={item?.segment} className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{item?.segment}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 bg-border rounded-full h-1.5">
                      <div className="h-1.5 rounded-full bg-primary" style={{ width: `${(item?.days / 4) * 100}%` }} />
                    </div>
                    <span className="text-xs font-medium text-foreground w-8 text-right">{item?.days}d</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Exportable Reports Section */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <SectionHeader title="Exportable KYC Reports" subtitle="Download compliance reports in PDF or Excel format" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            { title: 'KYC Verification Summary', desc: 'Overall verification rates and status breakdown', icon: 'ShieldCheck' },
            { title: 'Document Expiry Report', desc: '30/60/90 day expiry buckets with client details', icon: 'Calendar' },
            { title: 'Renewal Status Report', desc: 'Pending and completed renewals with timelines', icon: 'RefreshCw' },
            { title: 'Aging Analysis Report', desc: 'Client segment aging breakdown and risk scores', icon: 'BarChart3' },
            { title: 'Compliance Score Report', desc: 'Segment-wise compliance health and trends', icon: 'Award' },
            { title: 'Verification Time Report', desc: 'Average processing times by document and segment', icon: 'Clock' },
          ]?.map(report => (
            <div key={report?.title} className="flex items-start gap-3 p-4 border border-border rounded-xl hover:bg-muted transition-colors">
              <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-primary bg-opacity-10 text-primary flex-shrink-0">
                <Icon name={report?.icon} size={15} color="currentColor" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-foreground truncate">{report?.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{report?.desc}</p>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => openExport(`${report?.title} – PDF`)} className="text-xs text-primary hover:underline flex items-center gap-1">
                    <Icon name="FileText" size={11} color="currentColor" /> PDF
                  </button>
                  <button onClick={() => openExport(`${report?.title} – Excel`)} className="text-xs text-primary hover:underline flex items-center gap-1">
                    <Icon name="Table" size={11} color="currentColor" /> Excel
                  </button>
                  <button onClick={() => openSchedule(report?.title)} className="text-xs text-primary hover:underline flex items-center gap-1">
                    <Icon name="Calendar" size={11} color="currentColor" /> Schedule
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Scheduled Reports */}
      {scheduledReports.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold text-foreground">Scheduled Reports</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{scheduledReports.length} active schedule{scheduledReports.length > 1 ? 's' : ''}</p>
            </div>
          </div>
          <div className="space-y-3">
            {scheduledReports.map(s => (
              <div key={s.id} className="flex items-center justify-between p-4 bg-muted/30 border border-border rounded-xl">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Icon name="Calendar" size={14} color="var(--primary)" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{s.reportTitle}</p>
                    <p className="text-xs text-muted-foreground capitalize">{s.frequency} · {s.recipients?.join(', ')}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Next run</p>
                    <p className="text-xs font-semibold text-foreground">{s.nextRun}</p>
                  </div>
                  <button
                    onClick={() => setScheduledReports(prev => prev.filter(r => r.id !== s.id))}
                    className="p-1.5 rounded-xl hover:bg-muted text-muted-foreground hover:text-red-500 transition-colors">
                    <Icon name="Trash2" size={13} color="currentColor" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <ExportModal
        isOpen={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        reportTitle={exportTarget}
        onExport={handleExport}
      />

      <ScheduleReportModal
        isOpen={scheduleModalOpen}
        onClose={() => setScheduleModalOpen(false)}
        reportTitle={scheduleTarget}
        onSchedule={handleSchedule}
      />
    </div>
  );
};

export default KYCMetricsDashboard;
