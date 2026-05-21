import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import { sendStatementEmail } from '../../../services/emailService';

const Statements = ({ assets, payments, clientInfo }) => {
  const [generating, setGenerating] = useState(null);
  const [emailSent, setEmailSent] = useState({});
  const [emailSending, setEmailSending] = useState({});

  const formatCurrency = (val) =>
    new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', minimumFractionDigits: 0 })?.format(val || 0);

  const formatDate = (d) =>
    d ? new Date(d)?.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  const generatePDF = (title, rows, summaryLines) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${title}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; color: #1a1a1a; }
          h1 { font-size: 22px; color: #7c3aed; margin-bottom: 4px; }
          .subtitle { color: #666; font-size: 13px; margin-bottom: 24px; }
          .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 24px; padding: 16px; background: #f8f7ff; border-radius: 8px; }
          .meta-item label { font-size: 11px; color: #888; display: block; }
          .meta-item span { font-size: 13px; font-weight: 600; }
          .summary { margin-bottom: 24px; }
          .summary h2 { font-size: 15px; margin-bottom: 12px; border-bottom: 2px solid #7c3aed; padding-bottom: 6px; }
          .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
          .summary-card { padding: 12px; background: #f8f7ff; border-radius: 6px; }
          .summary-card label { font-size: 11px; color: #888; display: block; }
          .summary-card span { font-size: 16px; font-weight: 700; color: #7c3aed; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th { background: #7c3aed; color: white; padding: 10px 8px; text-align: left; }
          td { padding: 8px; border-bottom: 1px solid #eee; }
          tr:nth-child(even) td { background: #fafafa; }
          .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #eee; font-size: 11px; color: #888; }
          @media print { body { margin: 20px; } }
        </style>
      </head>
      <body>
        <h1>AssetFlow</h1>
        <div class="subtitle">${title}</div>
        <div class="meta">
          <div class="meta-item"><label>Client Name</label><span>${clientInfo?.full_name || 'N/A'}</span></div>
          <div class="meta-item"><label>Account Number</label><span>${clientInfo?.account_number || 'N/A'}</span></div>
          <div class="meta-item"><label>Email</label><span>${clientInfo?.email || 'N/A'}</span></div>
          <div class="meta-item"><label>Generated</label><span>${new Date()?.toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' })}</span></div>
        </div>
        ${summaryLines}
        <table>
          <thead><tr>${rows?.headers?.map(h => `<th>${h}</th>`)?.join('')}</tr></thead>
          <tbody>${rows?.data?.map(row => `<tr>${row?.map(cell => `<td>${cell}</td>`)?.join('')}</tr>`)?.join('')}</tbody>
        </table>
        <div class="footer">This statement was generated automatically by AssetFlow. For queries, contact your account manager.</div>
      </body>
      </html>
    `;
    printWindow?.document?.write(html);
    printWindow?.document?.close();
    setTimeout(() => printWindow?.print(), 500);
  };

  const handleDownloadAsset = (asset) => {
    const stmtId = `asset-${asset?.id}`;
    setGenerating(stmtId);
    const assetPayments = payments?.filter(p => p?.asset_id === asset?.id);
    const totalPaid = assetPayments?.filter(p => p?.payment_status === 'completed')?.reduce((s, p) => s + Number(p?.amount || 0), 0);
    const totalPending = assetPayments?.filter(p => p?.payment_status === 'pending')?.reduce((s, p) => s + Number(p?.amount || 0), 0);

    const summaryLines = `
      <div class="summary">
        <h2>Asset Summary</h2>
        <div class="summary-grid">
          <div class="summary-card"><label>Asset Code</label><span>${asset?.asset_code}</span></div>
          <div class="summary-card"><label>Total Paid</label><span>${formatCurrency(totalPaid)}</span></div>
          <div class="summary-card"><label>Pending</label><span>${formatCurrency(totalPending)}</span></div>
        </div>
      </div>
    `;

    generatePDF(
      `Asset Statement — ${asset?.description}`,
      {
        headers: ['Date', 'Transaction ID', 'Amount', 'Method', 'Reference', 'Status'],
        data: assetPayments?.map(p => [
          formatDate(p?.payment_date),
          p?.transaction_id || '—',
          formatCurrency(p?.amount),
          p?.payment_method?.replace('_', ' ') || '—',
          p?.reference_number || '—',
          p?.payment_status || '—',
        ]) || [],
      },
      summaryLines
    );
    setTimeout(() => setGenerating(null), 1000);
  };

  const handleDownloadConsolidated = () => {
    setGenerating('consolidated');
    const totalPaid = payments?.filter(p => p?.payment_status === 'completed')?.reduce((s, p) => s + Number(p?.amount || 0), 0);
    const totalPending = payments?.filter(p => p?.payment_status === 'pending')?.reduce((s, p) => s + Number(p?.amount || 0), 0);

    const summaryLines = `
      <div class="summary">
        <h2>Account Summary</h2>
        <div class="summary-grid">
          <div class="summary-card"><label>Total Assets</label><span>${assets?.length}</span></div>
          <div class="summary-card"><label>Total Paid</label><span>${formatCurrency(totalPaid)}</span></div>
          <div class="summary-card"><label>Pending</label><span>${formatCurrency(totalPending)}</span></div>
        </div>
      </div>
    `;

    generatePDF(
      'Consolidated Account Statement',
      {
        headers: ['Date', 'Transaction ID', 'Asset', 'Amount', 'Method', 'Reference', 'Status'],
        data: payments?.map(p => [
          formatDate(p?.payment_date),
          p?.transaction_id || '—',
          p?.asset?.asset_code || '—',
          formatCurrency(p?.amount),
          p?.payment_method?.replace('_', ' ') || '—',
          p?.reference_number || '—',
          p?.payment_status || '—',
        ]) || [],
      },
      summaryLines
    );
    setTimeout(() => setGenerating(null), 1000);
  };

  const handleEmailDelivery = async (id, isConsolidated = false, specificAsset = null) => {
    setEmailSending(prev => ({ ...prev, [id]: true }));
    try {
      const recipientEmail = clientInfo?.email;
      if (recipientEmail) {
        const emailAssets = specificAsset ? [specificAsset] : assets;
        const emailPayments = specificAsset
          ? payments?.filter(p => p?.asset_id === specificAsset?.id)
          : payments;
        await sendStatementEmail(recipientEmail, {
          client: clientInfo,
          assets: emailAssets,
          payments: emailPayments,
          period: isConsolidated ? 'Consolidated – All Assets' : `Asset: ${specificAsset?.description || specificAsset?.asset_code}`,
        });
      }
      setEmailSent(prev => ({ ...prev, [id]: true }));
      setTimeout(() => setEmailSent(prev => ({ ...prev, [id]: false })), 3000);
    } catch (err) {
      console.error('Failed to send statement email:', err);
      setEmailSent(prev => ({ ...prev, [id]: true }));
      setTimeout(() => setEmailSent(prev => ({ ...prev, [id]: false })), 3000);
    } finally {
      setEmailSending(prev => ({ ...prev, [id]: false }));
    }
  };

  const SpinnerSVG = ({ size = 13 }) => (
    <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );

  return (
    <div className="space-y-4">
      {/* Consolidated Statement */}
      <div className="bg-gradient-to-r from-violet-50 to-purple-50 dark:from-violet-900/20 dark:to-purple-900/20 border border-violet-200 dark:border-violet-800 rounded-xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Icon name="FileStack" size={18} color="var(--color-primary)" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Consolidated Account Statement</h3>
              <p className="text-xs text-muted-foreground mt-0.5">All assets · All transactions · {payments?.length || 0} records</p>
              <p className="text-xs text-muted-foreground">PDF generated via browser print dialog</p>
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={() => handleEmailDelivery('consolidated', true)}
              disabled={emailSending?.['consolidated']}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                emailSent?.['consolidated']
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : emailSending?.['consolidated']
                  ? 'bg-muted text-muted-foreground opacity-60 cursor-not-allowed' :'bg-muted text-muted-foreground hover:bg-border hover:text-foreground'
              }`}
            >
              {emailSending?.['consolidated'] ? <SpinnerSVG /> : <Icon name={emailSent?.['consolidated'] ? 'CheckCircle' : 'Mail'} size={13} />}
              {emailSent?.['consolidated'] ? 'Sent!' : emailSending?.['consolidated'] ? 'Sending...' : 'Email'}
            </button>
            <button
              onClick={handleDownloadConsolidated}
              disabled={generating === 'consolidated'}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-60"
            >
              {generating === 'consolidated' ? <SpinnerSVG /> : <Icon name="Download" size={13} />}
              Download PDF
            </button>
          </div>
        </div>
      </div>
      {/* Per-Asset Statements */}
      {assets?.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
            <Icon name="FileText" size={22} color="var(--color-muted-foreground)" />
          </div>
          <p className="text-sm font-medium text-foreground">No assets to generate statements for</p>
        </div>
      ) : (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Per-Asset Statements</h4>
          {assets?.map(asset => {
            const assetPayments = payments?.filter(p => p?.asset_id === asset?.id);
            const totalPaid = assetPayments?.filter(p => p?.payment_status === 'completed')?.reduce((s, p) => s + Number(p?.amount || 0), 0);
            const stmtId = `asset-${asset?.id}`;

            return (
              <div key={asset?.id} className="bg-card border border-border rounded-xl p-5 flex items-center gap-4">
                <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
                  <Icon name="FileText" size={16} color="var(--color-muted-foreground)" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{asset?.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {asset?.asset_code} · {assetPayments?.length} transactions · Paid: {formatCurrency(totalPaid)}
                  </p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleEmailDelivery(stmtId, false, asset)}
                    disabled={emailSending?.[stmtId]}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      emailSent?.[stmtId]
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : emailSending?.[stmtId]
                        ? 'bg-muted text-muted-foreground opacity-60 cursor-not-allowed'
                        : 'bg-muted text-muted-foreground hover:bg-border hover:text-foreground'
                    }`}
                  >
                    {emailSending?.[stmtId] ? <SpinnerSVG size={12} /> : <Icon name={emailSent?.[stmtId] ? 'Check' : 'Mail'} size={12} />}
                    {emailSent?.[stmtId] ? 'Sent' : emailSending?.[stmtId] ? 'Sending...' : 'Email'}
                  </button>
                  <button
                    onClick={() => handleDownloadAsset(asset)}
                    disabled={generating === stmtId}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-60"
                  >
                    {generating === stmtId ? <SpinnerSVG size={12} /> : <Icon name="Download" size={12} />}
                    PDF
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Statements;
