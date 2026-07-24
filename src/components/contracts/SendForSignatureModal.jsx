import React, { useState } from 'react';
import Icon from '../AppIcon';
import { supabase } from '../../lib/supabase';
import { sendSigningInvite } from '../../services/emailService';

// One-time token for an external signer's secure /sign/:token link.
const genSignToken = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID().replace(/-/g, '')
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

// ── Send for Signature modal — bridges a contract into the e-signature flow ────
// Shared by the company Contracts tab and the sacco Contracts tab. `context`:
//   { source: 'generated'|'company', contractId, documentLabel, defaultClient }
// 'company' rows live in company_contracts (uploads + sacco loan agreements),
// 'generated' rows in generated_contracts (POS sales).
const SendForSignatureModal = ({ context, adminId, onClose, onSent }) => {
  const [signers, setSigners] = useState([{
    name:  context.defaultClient?.name  || '',
    email: context.defaultClient?.email || '',
    role:  'Signer',
    type:  'external',
  }]);
  const [order, setOrder]     = useState('sequential');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError]     = useState('');
  const [doneCount, setDoneCount] = useState(null);

  const setS = (i, k, v) => setSigners(prev => prev.map((p, j) => j === i ? { ...p, [k]: v } : p));
  const addSigner = () => setSigners(p => [...p, { name: '', email: '', role: 'Signer', type: 'external' }]);
  const removeSigner = (i) => setSigners(p => p.filter((_, j) => j !== i));

  const handleSend = async () => {
    const clean = signers.filter(s => s.email.trim());
    if (!clean.length) { setError('Add at least one signer email.'); return; }
    setSending(true); setError('');
    try {
      const expires = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(); // 14-day links
      const rows = clean.map((s, i) => ({
        admin_id:         adminId,
        contract_id:      context.contractId,
        source_type:      context.source,
        name:             s.name || s.email.split('@')[0],
        email:            s.email.trim(),
        role:             s.role,
        signing_order:    order === 'sequential' ? i : 0,
        status:           'pending',
        token:            s.type === 'external' ? genSignToken() : null,
        token_expires_at: s.type === 'external' ? expires : null,
      }));

      const { error: insErr } = await supabase.from('esign_signers').insert(rows);
      if (insErr) throw insErr;

      // Flip the parent contract to "pending" so it shows as awaiting signature.
      const table = context.source === 'company' ? 'company_contracts' : 'generated_contracts';
      await supabase.from(table)
        .update({ esign_status: 'pending', expires_at: expires })
        .eq('id', context.contractId);

      // Audit + in-app notification (best-effort; mirrors the e-signature feed).
      await supabase.from('esign_audit_events').insert({
        admin_id: adminId, contract_id: context.contractId, document_label: context.documentLabel,
        event_type: 'sent', actor: 'You',
        detail: `${order} order · ${clean.length} signer(s) invited`,
      }).then(() => {}, () => {});
      await supabase.from('esign_notifications').insert({
        admin_id: adminId, type: 'info', title: 'Sent for signature',
        detail: `${context.documentLabel} · ${clean.length} signer(s)`, contract_id: context.contractId,
      }).then(() => {}, () => {});

      // Email external signers their one-time link (best-effort).
      const base = window.location.origin;
      await Promise.all(rows.filter(r => r.token).map(r =>
        sendSigningInvite(r.email, {
          signerName: r.name, documentName: context.documentLabel,
          link: `${base}/sign/${r.token}`, message, expiresAt: expires,
        }).catch(e => console.warn('invite email failed:', e.message))
      ));

      setDoneCount(clean.length);
      if (onSent) onSent();
    } catch (err) {
      setError(err.message || 'Failed to send for signature.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center">
              <Icon name="PenTool" size={18} color="#1A56DB" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">Send for Signature</h3>
              <p className="text-xs text-muted-foreground truncate max-w-[240px]">{context.documentLabel}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <Icon name="X" size={18} color="var(--color-muted-foreground)" />
          </button>
        </div>

        {doneCount != null ? (
          <div className="px-6 py-10 text-center">
            <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Icon name="Send" size={26} color="#059669" />
            </div>
            <p className="text-base font-bold text-foreground">Sent to {doneCount} signer(s)</p>
            <p className="text-xs text-muted-foreground mt-1">
              Internal signers can sign it in the E-Signature module. External signers received a secure link by email.
            </p>
            <button onClick={onClose} className="mt-5 px-5 py-2 rounded-lg text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(135deg,#1A56DB,#1E429F)' }}>Done</button>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-4">
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                <Icon name="AlertCircle" size={15} color="currentColor" /> {error}
              </div>
            )}

            {signers.map((s, i) => (
              <div key={i} className="border border-border rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">Signer {i + 1}</span>
                  {signers.length > 1 && (
                    <button onClick={() => removeSigner(i)} className="text-muted-foreground hover:text-red-500">
                      <Icon name="X" size={13} color="currentColor" />
                    </button>
                  )}
                </div>
                <input value={s.name} onChange={e => setS(i, 'name', e.target.value)} placeholder="Full name"
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground" />
                <input value={s.email} onChange={e => setS(i, 'email', e.target.value)} placeholder="email@example.com" type="email"
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground" />
                <div className="grid grid-cols-2 gap-2">
                  <select value={s.type} onChange={e => setS(i, 'type', e.target.value)}
                    className="px-2 py-2 text-xs bg-background border border-border rounded-lg text-muted-foreground focus:outline-none">
                    <option value="external">External (email link)</option>
                    <option value="internal">Internal (sign in-app)</option>
                  </select>
                  <select value={s.role} onChange={e => setS(i, 'role', e.target.value)}
                    className="px-2 py-2 text-xs bg-background border border-border rounded-lg text-muted-foreground focus:outline-none">
                    {['Signer', 'Approver', 'Witness', 'Final Authority'].map(r => <option key={r}>{r}</option>)}
                  </select>
                </div>
              </div>
            ))}

            <button onClick={addSigner} className="text-xs text-primary font-medium hover:underline flex items-center gap-1">
              <Icon name="Plus" size={11} color="currentColor" /> Add signer
            </button>

            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Signing order</label>
              <div className="flex gap-4">
                {['sequential', 'parallel'].map(o => (
                  <label key={o} className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="sfs-order" value={o} checked={order === o} onChange={() => setOrder(o)} />
                    <span className="text-sm text-foreground capitalize">{o}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Message to signers (optional)</label>
              <textarea value={message} onChange={e => setMessage(e.target.value)} rows={2}
                placeholder="Please review and sign this agreement."
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground resize-none" />
            </div>

            <div className="flex items-center justify-end gap-3 pt-1">
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-all">
                Cancel
              </button>
              <button onClick={handleSend} disabled={sending}
                className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg,#1A56DB,#1E429F)' }}>
                {sending ? 'Sending…' : <><Icon name="Send" size={14} color="currentColor" /> Send Invitations</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SendForSignatureModal;
