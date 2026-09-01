import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../AppIcon';
import { useToast } from '../Toast';
import { signingVerdict, isTerminal } from '../../utils/certificateSigning';
import {
  loadSigningRequest, syncSigningRequest, cancelSigningRequest,
  releaseSigningRequest, openSignedCertificate,
} from '../../utils/signnowClient';

/**
 * One signing request, in full: who was asked, who has signed, what happened
 * and when, and the four things staff can do about it.
 *
 * REFRESH IS NOT DECORATION. A tenant whose callbacks failed to register (or
 * whose webhook delivery was lost) has no other way to find out that a document
 * has been signed — the button runs the identical reconciliation the webhook
 * does, so pressing it can genuinely issue a certificate.
 */

const fmt = (d) => (d
  ? new Date(d).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  : '—');

const SIGNER_TONE = {
  signed: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  declined: 'text-red-700 bg-red-50 border-red-200',
  viewed: 'text-amber-700 bg-amber-50 border-amber-200',
  sent: 'text-blue-700 bg-blue-50 border-blue-200',
  pending: 'text-muted-foreground bg-muted/40 border-border',
  cancelled: 'text-muted-foreground bg-muted/40 border-border',
};

const SigningRequestDrawer = ({ open, requestId, onClose, onChanged }) => {
  const toast = useToast();
  const [data, setData] = useState({ request: null, signers: [], events: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    if (!requestId) return;
    setLoading(true);
    try {
      setData(await loadSigningRequest(requestId));
    } catch (e) {
      toast.error(e.message || 'Could not load the signing request.');
    } finally {
      setLoading(false);
    }
  }, [requestId, toast]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const run = async (label, fn, successMessage) => {
    if (busy) return;
    setBusy(label);
    try {
      const result = await fn();
      await load();
      onChanged?.(result);
      toast.success(typeof successMessage === 'function' ? successMessage(result) : successMessage);
    } catch (e) {
      toast.error(e.message || 'That did not work.');
    } finally {
      setBusy('');
    }
  };

  if (!open) return null;

  const req = data.request;
  const verdict = req ? signingVerdict(req.status) : null;
  const canCancel = req && ['draft', 'sent', 'viewed'].includes(req.status);
  const canRelease = req && req.status === 'signed' && req.signed_path;
  const canRefresh = req && !isTerminal(req.status) && req.provider_document_id;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex justify-end">
      <div className="bg-card w-full max-w-xl h-full shadow-2xl flex flex-col border-l border-border">
        <div className="flex items-start justify-between px-6 py-4 border-b border-border">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-foreground truncate">
              {req?.document_name || 'Signing request'}
            </h3>
            {verdict && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {verdict.label} — {verdict.detail}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0 ml-3">
            <Icon name="X" size={18} color="currentColor" />
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : !req ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            That signing request is no longer on file.
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            {req.status === 'declined' && req.decline_reason && (
              <div className="flex gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
                <Icon name="XCircle" size={15} color="#b91c1c" />
                <p className="text-xs text-red-800">{req.decline_reason}</p>
              </div>
            )}
            {req.status === 'failed' && req.last_error && (
              <div className="flex gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
                <Icon name="AlertCircle" size={15} color="#b91c1c" />
                <p className="text-xs text-red-800">{req.last_error}</p>
              </div>
            )}

            {/* Facts */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
              <Fact label="Certificate serial" value={req.certificate_serial} mono />
              <Fact label="Sent" value={fmt(req.sent_at)} />
              <Fact label="Signed" value={fmt(req.signed_at)} />
              <Fact label="Issued" value={fmt(req.released_at)} />
              <Fact label="Signing order" value={req.signing_order === 'parallel' ? 'All at once' : 'One after another'} />
              <Fact label="Provider" value={`SignNow (${req.provider_environment || 'not sent'})`} />
              <div className="col-span-2">
                <Fact
                  label="Document digest"
                  value={req.draft_digest ? `${req.draft_digest.slice(0, 32)}…` : '—'}
                  mono
                  hint="SHA-256 of the file that was sent. It is what proves the signed document was built on the one this request was opened for."
                />
              </div>
            </div>

            {/* Signers */}
            <div>
              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">
                Signatories
              </h4>
              <div className="space-y-2">
                {data.signers.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 p-3 rounded-lg border border-border">
                    <span className="w-6 h-6 shrink-0 rounded-full bg-muted flex items-center justify-center text-[11px] font-bold text-muted-foreground">
                      {s.signing_order}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground truncate">
                        {s.signer_name || s.signer_email}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {s.role_name} · {s.signer_email}
                      </p>
                      {s.decline_reason && (
                        <p className="text-[11px] text-red-700 mt-0.5">{s.decline_reason}</p>
                      )}
                    </div>
                    <span className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold capitalize shrink-0 ${SIGNER_TONE[s.status] || SIGNER_TONE.pending}`}>
                      {s.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Trail */}
            <div>
              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">
                Trail
              </h4>
              <div className="space-y-2.5">
                {data.events.length === 0 && (
                  <p className="text-xs text-muted-foreground">Nothing recorded yet.</p>
                )}
                {data.events.map((e) => (
                  <div key={e.id} className="flex gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs text-foreground">{e.detail || e.event_type}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {e.actor || 'system'} · {fmt(e.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {req && (
          <div className="flex flex-wrap justify-end gap-2 px-6 py-4 border-t border-border">
            {req.signed_path && (
              <button
                onClick={async () => {
                  const ok = await openSignedCertificate(req.signed_path);
                  if (!ok) toast.error('Allow pop-ups for this site to open the signed certificate.');
                }}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg border border-border text-foreground hover:bg-muted/50"
              >
                <Icon name="FileCheck" size={14} color="currentColor" /> Signed copy
              </button>
            )}
            {canRefresh && (
              <button
                onClick={() => run('sync', () => syncSigningRequest(req.id),
                  (r) => (r?.released ? 'Signed by everyone — the certificate has been issued.' : 'Up to date.'))}
                disabled={!!busy}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg border border-border text-foreground hover:bg-muted/50 disabled:opacity-50"
              >
                <Icon name="RefreshCw" size={14} color="currentColor" />
                {busy === 'sync' ? 'Checking…' : 'Refresh'}
              </button>
            )}
            {canCancel && (
              <button
                onClick={() => run('cancel', () => cancelSigningRequest(req.id, 'Withdrawn by staff.'),
                  'The invite has been withdrawn.')}
                disabled={!!busy}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                <Icon name="Ban" size={14} color="currentColor" />
                {busy === 'cancel' ? 'Withdrawing…' : 'Withdraw'}
              </button>
            )}
            {canRelease && (
              <button
                onClick={() => run('release', () => releaseSigningRequest(req.id), 'Certificate issued.')}
                disabled={!!busy}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                <Icon name="BadgeCheck" size={14} color="currentColor" />
                {busy === 'release' ? 'Issuing…' : 'Issue certificate'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const Fact = ({ label, value, mono = false, hint }) => (
  <div>
    <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">{label}</p>
    <p className={`text-foreground mt-0.5 break-all ${mono ? 'font-mono text-[11px]' : 'text-xs'}`} title={hint}>
      {value || '—'}
    </p>
  </div>
);

export default SigningRequestDrawer;
