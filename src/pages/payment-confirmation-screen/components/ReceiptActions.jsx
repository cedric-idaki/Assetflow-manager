import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';

const ReceiptActions = ({ onDownloadPDF, onPrint, onEmail, onSMS, onNewTransaction, onDashboard }) => {
  const [emailSent, setEmailSent] = useState(false);
  const [smsSent, setSmsSent] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const handleEmail = async () => {
    await onEmail?.();
    setEmailSent(true);
    setTimeout(() => setEmailSent(false), 3000);
  };

  const handleSMS = async () => {
    await onSMS?.();
    setSmsSent(true);
    setTimeout(() => setSmsSent(false), 3000);
  };

  const handleDownload = async () => {
    setDownloading(true);
    await onDownloadPDF?.();
    setTimeout(() => setDownloading(false), 1500);
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5 mb-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Icon name="FileDown" size={16} color="var(--color-primary)" />
        </div>
        <h2 className="text-base font-semibold text-foreground">Receipt &amp; Actions</h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-70 shadow-md shadow-primary/20"
        >
          {downloading ? (
            <svg className="animate-spin" width={16} height={16} viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          ) : (
            <Icon name="Download" size={16} color="currentColor" />
          )}
          {downloading ? 'Generating...' : 'Download PDF'}
        </button>

        <button
          onClick={onPrint}
          className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-muted text-foreground font-semibold text-sm hover:bg-muted/80 transition-colors border border-border"
        >
          <Icon name="Printer" size={16} color="currentColor" />
          Print Receipt
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <button
          onClick={handleEmail}
          disabled={emailSent}
          className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm transition-colors border ${
            emailSent
              ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800' :'bg-muted text-foreground hover:bg-muted/80 border-border'
          }`}
        >
          <Icon name={emailSent ? 'CheckCircle' : 'Mail'} size={16} color="currentColor" />
          {emailSent ? 'Email Sent!' : 'Email Receipt'}
        </button>

        <button
          onClick={handleSMS}
          disabled={smsSent}
          className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm transition-colors border ${
            smsSent
              ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800' :'bg-muted text-foreground hover:bg-muted/80 border-border'
          }`}
        >
          <Icon name={smsSent ? 'CheckCircle' : 'MessageSquare'} size={16} color="currentColor" />
          {smsSent ? 'SMS Sent!' : 'Send SMS'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 pt-4 border-t border-border">
        <button
          onClick={onDashboard}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-sm font-medium"
        >
          <Icon name="LayoutDashboard" size={15} color="currentColor" />
          Go to Dashboard
        </button>
        <button
          onClick={onNewTransaction}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-secondary text-secondary-foreground hover:bg-secondary/90 transition-colors text-sm font-semibold shadow-sm"
        >
          <Icon name="Plus" size={15} color="currentColor" />
          New Transaction
        </button>
      </div>
    </div>
  );
};

export default ReceiptActions;
