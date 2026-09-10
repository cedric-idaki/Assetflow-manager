import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '../../../../components/Toast';
import Icon from '../../../../components/AppIcon';
import {
  Card, StatCard, Table, Badge, PrimaryButton, GhostButton, Modal, Field,
  Select, EmptyState, KES, fmtDate,
} from '../_shared';
import { int, num, printCertificate } from './_util';
import CertificateVerifier from '../../../../components/CertificateVerifier';
import { formatSerial } from '../../../../utils/certificateSerial';
import SigningStatusChip from '../../../../components/signing/SigningStatusChip';
import SendForSignatureModal from '../../../../components/signing/SendForSignatureModal';
import SigningRequestDrawer from '../../../../components/signing/SigningRequestDrawer';
import { signingStatusFor, loadSigningPolicies, openSignedCertificate } from '../../../../utils/signnowClient';
import { buildShareCertificatePdf } from '../../../../utils/certificatePdf';
import { isIssued } from '../../../../utils/certificateSigning';

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

  // Signing state, one round trip for the whole register rather than one per
  // row — the same reason the dashboards read their totals from an RPC.
  const [signing, setSigning] = useState({});
  const [requireSignature, setRequireSignature] = useState(false);
  const [sendFor, setSendFor] = useState(null);      // the certificate being sent
  const [drawerId, setDrawerId] = useState(null);    // request whose trail is open

  const certIds = useMemo(() => certificates.map((c) => c.id), [certificates]);

  const refreshSigning = useCallback(async () => {
    if (certIds.length === 0) { setSigning({}); return; }
    try {
      setSigning(await signingStatusFor('sacco_share_certificates', certIds));
    } catch (_) {
      // A tenant that has never used signing has no rows and no problem. Losing
      // this must not take the register down with it.
    }
  }, [certIds]);

  useEffect(() => { refreshSigning(); }, [refreshSigning]);

  useEffect(() => {
    let live = true;
    loadSigningPolicies()
      .then((p) => { if (live) setRequireSignature(!!p?.share_certificate?.require_signature); })
      .catch(() => { /* no policy row is the normal case */ });
    return () => { live = false; };
  }, []);

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
  //
  // Three outcomes, and which one you get is the whole point of the signing
  // feature:
  //
  //   * a released certificate hands over the SIGNED PDF SignNow returned —
  //     that is the certificate of record, and nothing else is;
  //   * where signing is required and not finished, printing is refused,
  //     because an unsigned copy of a document that is supposed to carry three
  //     officers' signatures is exactly what this replaced;
  //   * where signing is not required, the existing print path is untouched.
  const downloadCert = async (c) => {
    const state = signing[c.id];

    if (isIssued(state?.status) && state.signedPath) {
      const opened = await openSignedCertificate(state.signedPath);
      if (!opened) toast.error('Allow pop-ups for this site to open the signed certificate.');
      return;
    }

    if (requireSignature) {
      toast.error(state
        ? 'This certificate is still being signed. Open its signing request to see where it has got to.'
        : 'This certificate has to be signed before it can be issued. Send it for signature first.');
      return;
    }

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

  /**
   * The PDF the officers will sign. Handed to the send modal as a callback
   * because the serial and the final panel are only settled once the operator
   * presses Send — the modal supplies both.
   */
  const buildFor = (c) => async ({ serial, signers }) => {
    const m = c.member || memberOf(c.member_id);
    return buildShareCertificatePdf({
      cert: { ...c, serial: serial || c.serial },
      saccoName: sacco?.name,
      memberName: m.full_name,
      memberNo: m.member_no,
      marketValue: ov.price,
      serial: serial || c.serial,
      signers,
      draft: true,
    });
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

      {requireSignature && (
        <div className="flex flex-wrap items-center gap-3 p-4 rounded-xl bg-blue-50 border border-blue-200">
          <Icon name="PenTool" size={18} color="#1d4ed8" />
          <p className="flex-1 text-sm text-foreground min-w-[240px]">
            Share certificates have to be signed through SignNow before they are issued. Until a
            certificate comes back signed, the only copy anyone can print is watermarked
            <strong> DRAFT — NOT YET ISSUED</strong>.
          </p>
        </div>
      )}

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
          <Table columns={['Serial', 'Certificate no.', 'Member', 'Shares', 'Par value', 'Value today', 'Issued', 'Status', 'Signature', '']}>
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
                  <td className="py-2.5 pr-4">
                    {signing[c.id] ? (
                      <button onClick={() => setDrawerId(signing[c.id].requestId)} title="Open the signing request">
                        <SigningStatusChip request={signing[c.id]} requireSignature={requireSignature} />
                      </button>
                    ) : (
                      <SigningStatusChip request={null} requireSignature={requireSignature} />
                    )}
                  </td>
                  <td className="py-2.5 pr-0 text-right whitespace-nowrap">
                    {/* Sending is offered for any active certificate that has no
                        live request — including where signing is not required,
                        because a society may want one signed occasionally
                        without making it the rule for every member. */}
                    {c.status === 'active' && !signing[c.id] && (
                      <button
                        onClick={() => setSendFor(c)}
                        className="text-xs text-primary font-semibold hover:underline mr-3"
                      >
                        Send to sign
                      </button>
                    )}
                    <button onClick={() => downloadCert(c)} className="text-xs text-primary font-semibold hover:underline">
                      {isIssued(signing[c.id]?.status) ? 'Signed copy' : 'Download'}
                    </button>
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

      <SendForSignatureModal
        open={!!sendFor}
        onClose={() => setSendFor(null)}
        onSent={refreshSigning}
        docKind="share_certificate"
        sourceTable="sacco_share_certificates"
        sourceId={sendFor?.id}
        documentName={sendFor
          ? `Share Certificate ${sendFor.certificate_no} — ${(sendFor.member || memberOf(sendFor.member_id)).full_name || ''}`.trim()
          : ''}
        build={sendFor ? buildFor(sendFor) : undefined}
      />

      <SigningRequestDrawer
        open={!!drawerId}
        requestId={drawerId}
        onClose={() => setDrawerId(null)}
        onChanged={refreshSigning}
      />

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
