import React, { useMemo, useState } from 'react';
import { useToast } from '../../../../components/Toast';
import Icon from '../../../../components/AppIcon';
import {
  Card, StatCard, Table, Badge, PrimaryButton, GhostButton, Modal, Field,
  Select, EmptyState, KES, fmtDate,
} from '../_shared';
import { int, num, printCertificate } from './_util';
import CertificateVerifier from '../../../../components/CertificateVerifier';
import { formatSerial } from '../../../../utils/certificateSerial';

/**
 * Share certificates. One live certificate per holder, reissued automatically
 * whenever a holding changes — the superseded ones stay on file as history.
 */
const CertificatesPanel = ({ ctx, ov }) => {
  const {
    certificates = [], members = [], shares = [], sacco,
    reissueCertificate, ensureCertificateSerial, exportCSV,
  } = ctx;
  const toast = useToast();

  const [showSuperseded, setShowSuperseded] = useState(false);
  const [q, setQ] = useState('');
  const [reissueOpen, setReissueOpen] = useState(false);
  const [target, setTarget] = useState('');
  const [saving, setSaving] = useState(false);

  const memberOf = (id) => members.find((m) => m.id === id) || {};

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return certificates
      .filter((c) => (showSuperseded ? true : c.status === 'active'))
      .filter((c) => {
        if (!term) return true;
        const m = c.member || memberOf(c.member_id);
        return `${c.certificate_no} ${c.serial || ''} ${m.full_name || ''} ${m.member_no || ''}`
          .toLowerCase().includes(term);
      });
  }, [certificates, showSuperseded, q, members]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = certificates.filter((c) => c.status === 'active');
  // Holders whose certificate has not caught up — should be nobody, but a
  // holding recorded straight into the register never triggered an issue.
  const missing = shares.filter((r) => int(r.shares_held) > 0
    && !active.some((c) => c.member_id === r.member_id));

  // Deliberately not called `print` — that shadows window.print().
  // A certificate must not leave the system without the serial that makes it
  // checkable, so an unserialised one is minted before the window opens.
  const downloadCert = async (c) => {
    const m = c.member || memberOf(c.member_id);
    let cert = c;
    if (!cert.serial) {
      try {
        const serial = await ensureCertificateSerial(cert.id);
        if (serial) cert = { ...cert, serial };
      } catch (_) { /* print it anyway — a missing serial must not block the paper */ }
    }
    const ok = printCertificate(cert, {
      saccoName: sacco?.name, memberName: m.full_name, memberNo: m.member_no, marketValue: ov.price,
    });
    if (!ok) toast.error('Allow pop-ups for this site to print certificates.');
  };

  const doReissue = async () => {
    if (!target) { toast.error('Choose a member.'); return; }
    setSaving(true);
    try {
      await reissueCertificate(target);
      toast.success('Certificate issued for the current holding.');
      setReissueOpen(false); setTarget('');
    } catch (e) { toast.error(e.message || 'Could not issue the certificate.'); } finally { setSaving(false); }
  };

  const reissueAllMissing = async () => {
    setSaving(true);
    let ok = 0;
    for (const r of missing) {
      try { await reissueCertificate(r.member_id); ok += 1; } catch (_) { /* keep going */ }
    }
    setSaving(false);
    toast.success(`${ok} certificate${ok === 1 ? '' : 's'} issued.`);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Live certificates" value={active.length} icon="Award" tone="primary" />
        <StatCard label="Shares certificated" value={active.reduce((s, c) => s + int(c.shares), 0).toLocaleString()} icon="Layers" tone="muted" />
        <StatCard label="Historic certificates" value={certificates.length - active.length} icon="History" tone="muted"
          hint="Superseded by a later holding" />
        <StatCard label="Awaiting issue" value={missing.length} icon={missing.length ? 'AlertTriangle' : 'Check'}
          tone={missing.length ? 'warning' : 'success'} hint={missing.length ? 'Holders with no live certificate' : 'Every holder is covered'} />
      </div>

      {missing.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
          <Icon name="AlertTriangle" size={18} color="#ca8a04" />
          <p className="flex-1 text-sm text-foreground min-w-[240px]">
            {missing.length} shareholder{missing.length === 1 ? ' has' : 's have'} no live certificate — usually a holding
            that was recorded straight onto the register rather than traded.
          </p>
          <PrimaryButton icon="Award" onClick={reissueAllMissing} disabled={saving}>
            {saving ? 'Issuing…' : 'Issue them all'}
          </PrimaryButton>
        </div>
      )}

      <Card
        title="Certificate register"
        subtitle="Issued automatically on every holding change — download any of them as a printable PDF"
        actions={(
          <div className="flex items-center gap-2">
            {rows.length > 0 && (
              <GhostButton icon="Download" onClick={() => exportCSV(rows.map((c) => {
                const m = c.member || memberOf(c.member_id);
                return {
                  serial: c.serial || '',
                  certificate_no: c.certificate_no, member: m.full_name || '', member_no: m.member_no || '',
                  shares: c.shares, par_value: c.par_value,
                  issue_date: String(c.issue_date || c.created_at).slice(0, 10), status: c.status,
                };
              }), 'share_certificates')}>Export</GhostButton>
            )}
            <PrimaryButton icon="Award" onClick={() => setReissueOpen(true)}>Issue certificate</PrimaryButton>
          </div>
        )}
      >
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="relative flex-1 min-w-[220px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
              <Icon name="Search" size={15} color="var(--color-muted-foreground)" />
            </span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by serial, certificate no. or member"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:border-primary" />
          </div>
          <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={showSuperseded} onChange={(e) => setShowSuperseded(e.target.checked)} />
            Include superseded
          </label>
        </div>

        {rows.length === 0 ? (
          <EmptyState icon="Award" title={q ? 'No certificate matches that search' : 'No certificates issued yet'}
            hint={q ? 'Try a certificate number or member name.' : 'The first time a member acquires shares, their certificate is generated automatically.'} />
        ) : (
          <Table columns={['Serial', 'Certificate no.', 'Member', 'Shares', 'Par value', 'Value today', 'Issued', 'Status', '']}>
            {rows.map((c) => {
              const m = c.member || memberOf(c.member_id);
              return (
                <tr key={c.id} className="border-b border-border/60">
                  <td className="py-2.5 pr-4 font-mono text-xs text-foreground whitespace-nowrap">
                    {c.serial
                      ? formatSerial(c.serial)
                      : <span className="text-muted-foreground italic font-sans">on download</span>}
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-xs text-muted-foreground">{c.certificate_no}</td>
                  <td className="py-2.5 pr-4">
                    <p className="font-medium text-foreground">{m.full_name || '—'}</p>
                    <p className="text-xs text-muted-foreground">{m.member_no || '—'}</p>
                  </td>
                  <td className="py-2.5 pr-4 text-foreground">{int(c.shares).toLocaleString()}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{KES(c.par_value)}</td>
                  <td className="py-2.5 pr-4 font-semibold text-foreground">
                    {KES(int(c.shares) * (ov.price || num(c.par_value)))}
                  </td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{fmtDate(c.issue_date || c.created_at)}</td>
                  <td className="py-2.5 pr-4"><Badge status={c.status === 'active' ? 'active' : 'closed'} /></td>
                  <td className="py-2.5 pr-0 text-right">
                    <button onClick={() => downloadCert(c)} className="text-xs text-primary font-semibold hover:underline">Download</button>
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      <Card
        title="Verify a certificate"
        subtitle="Type the serial from any certificate this platform issued — share, settlement or e-signature — to confirm it is genuine and current"
      >
        <CertificateVerifier />
      </Card>

      <Modal open={reissueOpen} onClose={() => setReissueOpen(false)} title="Issue a share certificate"
        footer={<>
          <GhostButton onClick={() => setReissueOpen(false)}>Cancel</GhostButton>
          <PrimaryButton icon="Check" onClick={doReissue} disabled={saving}>{saving ? 'Issuing…' : 'Issue'}</PrimaryButton>
        </>}>
        <p className="text-sm text-muted-foreground mb-4">
          A new certificate is issued for the member's current holding, and their existing one is
          marked superseded. Members download their own certificates from the portal at any time.
        </p>
        <Field label="Member *">
          <Select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Select member</option>
            {shares.filter((r) => int(r.shares_held) > 0).map((r) => {
              const m = r.member || memberOf(r.member_id);
              return (
                <option key={r.id} value={r.member_id}>
                  {m.full_name || '—'} — {int(r.shares_held).toLocaleString()} shares
                </option>
              );
            })}
          </Select>
        </Field>
      </Modal>
    </div>
  );
};

export default CertificatesPanel;
