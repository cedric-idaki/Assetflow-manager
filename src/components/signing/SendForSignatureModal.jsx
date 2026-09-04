import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../AppIcon';
import { useToast } from '../Toast';
import { docKindLabel, defaultPanelFor, cleanPanel } from '../../utils/certificateSigning';
import { sendForSignature, loadSigningPolicies } from '../../utils/signnowClient';

/**
 * "Send this certificate for signature."
 *
 * The screen that owns the record passes `build` — a function that draws the
 * PDF once the serial and the final panel are known. It is a callback rather
 * than a finished blob because both of those are decided HERE: the serial is
 * minted as part of sending, and the signature blocks have to be laid out for
 * however many officers the operator ends up naming.
 *
 * The panel is pre-filled from the tenant's standing signatories, so the common
 * case is: open, glance, send.
 *
 * PINNED SIGNERS
 * --------------
 * Some documents have a signatory who is not a choice. A guarantee agreement is
 * signed by the member who gave the guarantee — nobody else can, and an
 * operator who could retype that email could collect somebody else's signature
 * on it. `pinnedSigners` are merged into the panel by role, shown read-only,
 * and cannot be removed. One marked `required` blocks the send outright when
 * their email is missing, because a panel that has quietly dropped the
 * guarantor would produce an "executed" agreement they never signed — which is
 * worse than not sending at all.
 */

const inputCls =
  'w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground ' +
  'focus:outline-none focus:border-primary placeholder:text-muted-foreground';

/**
 * Merge the pinned signatories into whatever panel the tenant has stored.
 *
 * By ROLE, not by position: a society that renamed its second officer must not
 * end up with the guarantor's email against the Treasurer's line.
 */
const withPins = (rows, pins) => {
  if (!pins?.length) return rows;
  const merged = rows.map((r) => {
    const pin = pins.find((p) => (p.role || '').toLowerCase() === (r.role || '').toLowerCase());
    return pin ? { ...r, ...pin, pinned: true } : r;
  });
  pins.forEach((p) => {
    if (!merged.some((r) => (r.role || '').toLowerCase() === (p.role || '').toLowerCase())) {
      merged.push({ name: '', email: '', ...p, pinned: true });
    }
  });
  return merged
    .sort((a, b) => (Number(a.order) || 99) - (Number(b.order) || 99))
    .map((r, i) => ({ ...r, order: i + 1 }));
};

const SendForSignatureModal = ({
  open, onClose, onSent,
  docKind, sourceTable, sourceId, documentName, build,
  pinnedSigners, intro,
}) => {
  const toast = useToast();
  const [panel, setPanel] = useState([]);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [loadingPanel, setLoadingPanel] = useState(true);

  // A fresh array literal from the caller on every render would restart the
  // effect below forever; the roles and emails are what actually matter.
  const pinKey = JSON.stringify(pinnedSigners || []);

  useEffect(() => {
    if (!open) return;
    let live = true;
    const pins = JSON.parse(pinKey);
    setLoadingPanel(true);
    setError('');
    (async () => {
      try {
        const policies = await loadSigningPolicies();
        const stored = policies?.[docKind]?.signatories;
        if (!live) return;
        setPanel(withPins(
          Array.isArray(stored) && stored.length > 0
            ? stored.map((s, i) => ({
              role: s.role || '', name: s.name || '', email: s.email || '', order: s.order || i + 1,
            }))
            : defaultPanelFor(docKind),
          pins,
        ));
      } catch {
        // A tenant that has never opened Settings has no policy row, and that is
        // the normal first-time case rather than a failure.
        if (live) setPanel(withPins(defaultPanelFor(docKind), pins));
      } finally {
        if (live) setLoadingPanel(false);
      }
    })();
    return () => { live = false; };
  }, [open, docKind, pinKey]);

  // A required signatory with nothing to send to. Named rather than counted,
  // because the fix is in that person's member record and the operator needs to
  // know whose.
  const missingPin = useMemo(
    () => panel.find((r) => r.pinned && r.required && !String(r.email || '').trim()),
    [panel],
  );

  const ready = useMemo(
    () => cleanPanel(panel).length > 0 && !missingPin,
    [panel, missingPin],
  );

  const setRow = (i, patch) =>
    setPanel((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const addRow = () =>
    setPanel((rows) => [...rows, { role: '', name: '', email: '', order: rows.length + 1 }]);

  const removeRow = (i) =>
    setPanel((rows) => rows.filter((_, j) => j !== i).map((r, j) => ({ ...r, order: j + 1 })));

  const send = async () => {
    if (sending) return;
    if (missingPin) {
      setError(`${missingPin.name || missingPin.role} has no email address on file, so they cannot be invited to sign. Add one to their record first.`);
      return;
    }
    const usable = cleanPanel(panel);
    if (usable.length === 0) {
      setError('Every signatory needs an office and a valid email address.');
      return;
    }
    setSending(true);
    setError('');
    try {
      const result = await sendForSignature({
        docKind, sourceTable, sourceId, documentName,
        signers: usable, message: message.trim() || null, build,
      });
      toast.success(result?.message || 'Sent for signature.');
      onSent?.(result);
      onClose?.();
    } catch (e) {
      setError(e.message || 'The document could not be sent for signature.');
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-2xl shadow-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-start justify-between px-6 py-4 border-b border-border">
          <div>
            <h3 className="text-base font-bold text-foreground">Send for signature</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {docKindLabel(docKind)} · {documentName}
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <Icon name="X" size={18} color="currentColor" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 overflow-y-auto">
          <div className="flex gap-3 p-3.5 rounded-xl bg-blue-50 border border-blue-200">
            <Icon name="Info" size={16} color="#1d4ed8" />
            <p className="text-xs text-blue-900 leading-relaxed">
              {intro || (
                <>
                  Each signatory gets a SignNow invite with a signing box on the certificate itself.
                  The certificate is <strong>not issued</strong> until every one of them has signed —
                  until then, any copy printed carries a DRAFT watermark.
                </>
              )}
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
                Signatories
              </label>
              <button
                onClick={addRow}
                className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
              >
                <Icon name="Plus" size={12} color="currentColor" /> Add
              </button>
            </div>

            {loadingPanel ? (
              <p className="text-sm text-muted-foreground py-4">Loading the standing panel…</p>
            ) : (
              <div className="space-y-2">
                {panel.map((row, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-1 text-center text-xs font-bold text-muted-foreground">
                      {row.pinned
                        ? <Icon name="Lock" size={12} color="currentColor" className="mx-auto" />
                        : i + 1}
                    </div>
                    <input
                      className={`${inputCls} col-span-3 ${row.pinned ? 'opacity-70' : ''}`}
                      placeholder="Office"
                      value={row.role}
                      readOnly={row.pinned}
                      onChange={(e) => setRow(i, { role: e.target.value })}
                    />
                    <input
                      className={`${inputCls} col-span-3 ${row.pinned ? 'opacity-70' : ''}`}
                      placeholder="Name"
                      value={row.name}
                      readOnly={row.pinned}
                      onChange={(e) => setRow(i, { name: e.target.value })}
                    />
                    <input
                      className={`${inputCls} col-span-4 ${row.pinned ? 'opacity-70' : ''}`}
                      placeholder={row.pinned ? 'No email on file' : 'email@example.com'}
                      type="email"
                      value={row.email}
                      readOnly={row.pinned}
                      onChange={(e) => setRow(i, { email: e.target.value })}
                    />
                    <button
                      onClick={() => removeRow(i)}
                      disabled={row.pinned || panel.length <= 1}
                      className="col-span-1 text-muted-foreground hover:text-red-600 disabled:opacity-30"
                      title={row.pinned ? 'This signatory cannot be changed' : 'Remove'}
                    >
                      <Icon name="Trash2" size={14} color="currentColor" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {missingPin ? (
              <div className="flex gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 mt-2">
                <Icon name="AlertTriangle" size={15} color="#b45309" />
                <p className="text-xs text-amber-900">
                  <strong>{missingPin.name || missingPin.role}</strong> has no email address on
                  file, so they cannot be invited to sign. Add one to their record, then send
                  this again — sending without them would produce a signed document they are not
                  party to.
                </p>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground mt-2">
                The office is printed under the signature line on the certificate, so use the title
                the document should carry — Chairperson, Treasurer, Secretary.
              </p>
            )}
          </div>

          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
              Note to the signatories (optional)
            </label>
            <textarea
              rows={2}
              className={`${inputCls} mt-2 resize-none`}
              placeholder="Anything they should know before signing."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>

          {error && (
            <div className="flex gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
              <Icon name="AlertCircle" size={15} color="#b91c1c" />
              <p className="text-xs text-red-800">{error}</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            disabled={sending}
            className="px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={send}
            disabled={sending || !ready || loadingPanel}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Icon name={sending ? 'Loader2' : 'Send'} size={14} color="currentColor" />
            {sending ? 'Sending…' : 'Send for signature'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SendForSignatureModal;
