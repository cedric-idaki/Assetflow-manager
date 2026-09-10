import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import Icon from './AppIcon';
import {
  normalizeSerial, formatSerial, isSerialShaped, certTypeLabel, verdictOf,
} from '../utils/certificateSerial';

/**
 * Look a certificate serial up and say whether it is genuine.
 *
 * Works for every kind of certificate the system issues — share, settlement,
 * electronic signature — because they all draw their serial from the one
 * registry. The lookup is system_certificate_verify(), which returns only what
 * is already printed on the face of the document the reader is holding, and
 * records who asked.
 *
 * Deliberately not tenant-scoped: the person checking a certificate is very
 * often not from the organisation that issued it.
 */

const TONE = {
  valid:      { icon: 'ShieldCheck',   ring: 'border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800', text: 'text-emerald-700 dark:text-emerald-400', color: '#059669' },
  superseded: { icon: 'History',       ring: 'border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800',        text: 'text-amber-700 dark:text-amber-400',     color: '#d97706' },
  revoked:    { icon: 'ShieldX',       ring: 'border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-800',               text: 'text-red-700 dark:text-red-400',         color: '#dc2626' },
  tampered:   { icon: 'ShieldAlert',   ring: 'border-red-400 bg-red-50 dark:bg-red-900/20 dark:border-red-800',               text: 'text-red-700 dark:text-red-400',         color: '#dc2626' },
  unknown:    { icon: 'HelpCircle',    ring: 'border-border bg-muted/40',                                                     text: 'text-muted-foreground',                  color: 'var(--color-muted-foreground)' },
};

// The keys inside `detail` are per-certificate-type; these are the ones worth a
// row, in the order a reader expects them. Anything else is shown as-is.
const FACT_LABELS = {
  certificate_no:     'Society certificate no.',
  shares:             'Shares',
  par_value:          'Par value',
  issue_date:         'Issued',
  plan_name:          'Plan',
  total_amount:       'Total settled',
  installment_amount: 'Installment',
  total_installments: 'Installments',
  frequency:          'Frequency',
  asset_description:  'Asset',
  asset_code:         'Asset code',
  asset_serial:       'Serial / chassis',
  plate_number:       'Plate',
  settled_on:         'Settled on',
  document:           'Document',
  source:             'Held in',
};

const humanKey = (k) => FACT_LABELS[k] || k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

const factValue = (k, v) => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (k === 'total_amount' || k === 'installment_amount' || k === 'par_value') {
    return `KES ${Number(v).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
  }
  if (typeof v === 'number') return v.toLocaleString();
  return String(v);
};

const fmtDate = (d) => (d
  ? new Date(d).toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' })
  : '—');

const CertificateVerifier = ({ initialSerial = '', compact = false, className = '' }) => {
  const [serial,  setSerial]  = useState(initialSerial);
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState('');
  // null = nothing checked yet; { result } = checked, result may be null for
  // "no such serial". The two states must stay distinct or a fresh box would
  // open already saying the certificate does not exist.
  const [checked, setChecked] = useState(null);

  const verify = async (e) => {
    e?.preventDefault?.();
    const key = normalizeSerial(serial);
    if (!isSerialShaped(key)) {
      setError('Enter the full serial from the certificate, e.g. ARA-SHR-2026-000412-7QK3.');
      setChecked(null);
      return;
    }
    setBusy(true); setError(''); setChecked(null);
    try {
      const { data, error: err } = await supabase.rpc('system_certificate_verify', { p_serial: key });
      if (err) throw err;
      setChecked({ result: Array.isArray(data) ? (data[0] || null) : (data || null) });
    } catch (err) {
      setError(err.message || 'Could not reach the certificate register.');
    } finally {
      setBusy(false);
    }
  };

  const result  = checked?.result || null;
  const verdict = checked ? verdictOf(result) : null;
  const tone    = verdict ? (TONE[verdict.tone] || TONE.unknown) : null;

  return (
    <div className={className}>
      <form onSubmit={verify} className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[240px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <Icon name="ShieldCheck" size={15} color="var(--color-muted-foreground)" />
          </span>
          <input
            value={serial}
            onChange={(ev) => { setSerial(ev.target.value); setChecked(null); setError(''); }}
            placeholder="ARA-SHR-2026-000412-7QK3"
            aria-label="Certificate serial number"
            className="w-full pl-9 pr-3 py-2 text-sm font-mono rounded-lg border border-border bg-background text-foreground focus:outline-none focus:border-primary"
          />
        </div>
        <button type="submit" disabled={busy}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors">
          <Icon name="Search" size={15} color="currentColor" />
          {busy ? 'Checking…' : 'Verify'}
        </button>
      </form>

      {error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      {verdict && (
        <div className={`mt-4 rounded-xl border p-4 ${tone.ring}`}>
          <div className="flex items-start gap-3">
            <Icon name={tone.icon} size={20} color={tone.color} />
            <div className="min-w-0">
              <p className={`text-sm font-bold ${tone.text}`}>{verdict.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{verdict.detail}</p>
            </div>
          </div>

          {result && (
            <div className="mt-4 pt-4 border-t border-border/60 space-y-2">
              <Row k="Serial"       v={<span className="font-mono">{formatSerial(result.serial_no)}</span>} />
              <Row k="Certificate"  v={result.certificate_title || certTypeLabel(result.certificate_type)} />
              <Row k="Issued by"    v={result.issuer || '—'} />
              <Row k="Issued to"    v={[result.subject, result.subject_reference].filter(Boolean).join(' · ') || '—'} />
              <Row k="Date of issue" v={fmtDate(result.issued_on_date)} />

              {!compact && result.detail && Object.keys(result.detail).length > 0 && (
                <div className="pt-2 mt-2 border-t border-border/60">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                    What the certificate states
                  </p>
                  {Object.entries(result.detail).map(([k, v]) => (
                    <Row key={k} k={humanKey(k)} v={factValue(k, v)} />
                  ))}
                </div>
              )}

              <p className="pt-2 text-[11px] text-muted-foreground">
                Checked {result.times_verified === 1 ? 'for the first time' : `${result.times_verified} times`}.
                Every check is recorded against the certificate.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const Row = ({ k, v }) => (
  <div className="flex justify-between gap-4 text-sm">
    <span className="text-muted-foreground shrink-0">{k}</span>
    <span className="font-medium text-foreground text-right break-words">{v}</span>
  </div>
);

export default CertificateVerifier;
