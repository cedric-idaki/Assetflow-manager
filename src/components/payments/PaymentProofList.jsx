import React, { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../AppIcon';
import {
  PROOF_ACCEPT, listPaymentProofs, openPaymentProof, uploadPaymentProof,
} from '../../utils/paymentProofs';

const fmtDate = (d) => (d ? new Date(d).toLocaleString('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
}) : '—');

/**
 * The proofs on one existing payment, with an "add" button.
 *
 * @param {'company'|'sacco'} module
 * @param {string}  recordId  payments.id or sacco_contributions.id
 * @param {string}  adminId   the record's admin_id
 * @param {boolean} canAttach whether to offer the upload button
 * @param {Function} onChange called with the new list after an upload
 */
const PaymentProofList = ({ module, recordId, adminId, canAttach = true, onChange, compact = false }) => {
  const inputRef = useRef(null);
  const [proofs, setProofs]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const map = await listPaymentProofs(module, [recordId]);
      const list = map[recordId] || [];
      setProofs(list);
      return list;
    } catch (e) {
      setError(e.message || 'Could not load the documents.');
      return [];
    } finally {
      setLoading(false);
    }
  }, [module, recordId]);

  useEffect(() => { load(); }, [load]);

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await uploadPaymentProof({ module, recordId, adminId, file });
      const list = await load();
      onChange?.(list);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const open = async (p) => {
    setError(null);
    try { await openPaymentProof(p); } catch (e) { setError(e.message); }
  };

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      {!compact && (
        <p className="text-xs font-bold text-foreground uppercase tracking-wide">Proof of payment</p>
      )}

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : proofs.length === 0 ? (
        <p className="text-xs text-muted-foreground">No supporting document attached.</p>
      ) : (
        <ul className="space-y-1.5">
          {proofs.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => open(p)}
                className="w-full flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-left hover:bg-muted/50 transition-colors">
                <Icon name={p.mime_type === 'application/pdf' ? 'FileText' : 'Image'} size={14} color="currentColor" />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-foreground truncate">{p.file_name}</span>
                  <span className="block text-xs text-muted-foreground">Uploaded {fmtDate(p.created_at)}</span>
                </span>
                <Icon name="ExternalLink" size={13} color="currentColor" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {canAttach && (
        <>
          <button type="button" disabled={busy} onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline disabled:opacity-60">
            <Icon name={busy ? 'Loader2' : 'Upload'} size={13} color="currentColor" className={busy ? 'animate-spin' : ''} />
            {busy ? 'Uploading…' : proofs.length ? 'Add another document' : 'Upload proof of payment'}
          </button>
          <input ref={inputRef} type="file" accept={PROOF_ACCEPT} className="hidden"
            onChange={(e) => upload(e.target.files?.[0])} />
        </>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
};

export default PaymentProofList;
