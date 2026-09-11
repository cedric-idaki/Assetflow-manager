/**
 * CREATE A CLIENT RECORD — the one form behind every "new customer" button.
 *
 * WHAT IT IS FOR
 * A client record is the thing that makes somebody billable. Until one exists
 * you cannot raise an invoice, issue a receipt, record a payment against them
 * or carry a balance, because every one of those rows points at a clients.id.
 *
 * WHY IT ASKS FOR SO LITTLE
 * A name. That is the only required field, and the form says so. The full KYC
 * questionnaire belongs to the moment somebody is lent money, not to the moment
 * somebody is billed — and a required field on a form like this is a field that
 * gets "x" typed into it, which is worse than an empty one.
 *
 * WHY THE DUPLICATE PANEL IS THE POINT OF THE SCREEN
 * The same buyer entered twice is two balances and two payment histories, and
 * once invoices have been raised against both there is no way back. So the form
 * asks the server who it already knows WHILE the details are being typed, and
 * shows the answer next to the fields rather than as a rejection at the end.
 * Three outcomes, all of them one click:
 *
 *   Use this record   the lead attaches to the customer already on file, and
 *                     any billing detail they were missing is filled in.
 *   Create anyway     they really are two different people. Recorded as such.
 *   Keep typing       the match was on a name, which is not evidence.
 *
 * The server enforces the same rule independently (finhub_create_client), so a
 * caller that skips this screen still cannot create a silent duplicate.
 */
import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../AppIcon';
import { useClientRecords, useDuplicateWatch, describeMatch, isBlockingMatch, DUPLICATE_CODE } from '../../hooks/useClientRecords';

const F = {
  label:  'block text-xs font-semibold text-muted-foreground mb-1.5',
  input:  'w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all',
  btnPri: 'inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60',
  btnSec: 'inline-flex items-center justify-center gap-2 bg-muted text-foreground px-4 py-2 rounded-lg text-sm font-medium border border-border hover:bg-muted/70 transition-colors',
};

const blankForm = (lead) => ({
  full_name:       lead?.full_name || '',
  phone:           lead?.phone     || '',
  email:           lead?.email     || '',
  kra_pin:         lead?.kra_pin   || '',
  national_id:     '',
  billing_address: lead?.physical_address || '',
  customer_type:   'account',
  notes:           '',
});

/** One row of the "we already know somebody like this" panel. */
const DuplicateRow = ({ row, busy, onUse }) => (
  <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border bg-background">
    <div className="min-w-0">
      <p className="text-sm font-semibold text-foreground truncate">
        {row.full_name}
        {row.account_number && <span className="font-normal text-muted-foreground"> · {row.account_number}</span>}
      </p>
      <p className="text-xs text-muted-foreground mt-0.5">
        {describeMatch(row.matched_on)}
        {row.phone ? ` · ${row.phone}` : ''}
        {row.email ? ` · ${row.email}` : ''}
      </p>
      {!isBlockingMatch(row) && (
        <p className="text-xs text-muted-foreground mt-1 italic">
          Name only — quite possibly a different person.
        </p>
      )}
    </div>
    <button type="button" className={F.btnSec} disabled={busy} onClick={() => onUse(row)}>
      <Icon name="Link2" size={13} color="currentColor" /> Use this record
    </button>
  </div>
);

const ClientRecordModal = ({
  isOpen,
  onClose,
  onCreated,
  lead     = null,
  agentId  = null,
  heading  = 'New Client Record',
}) => {
  const { findDuplicates, createClient } = useClientRecords({ enabled: false });

  const [form,    setForm]    = useState(() => blankForm(lead));
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [force,   setForce]   = useState(false);
  const [refused, setRefused] = useState(false);   // the server said duplicate

  // Re-prefill whenever a different lead is converted through the same mount.
  useEffect(() => {
    if (!isOpen) return;
    setForm(blankForm(lead));
    setError(''); setForce(false); setRefused(false);
  }, [isOpen, lead]);

  const { matches, checking, blocking } = useDuplicateWatch(form, findDuplicates, { enabled: isOpen });

  const set = (k, v) => { setForm(p => ({ ...p, [k]: v })); setError(''); setRefused(false); };

  const nameGiven = form.full_name.trim().length > 0;
  const canSave   = nameGiven && !saving && (blocking.length === 0 || force);

  // A tax invoice needs the buyer's PIN. Not a blocker — plenty of customers
  // are not VAT registered — but the operator should know what they are about
  // to be unable to produce.
  const pinMissing = useMemo(() => !form.kra_pin.trim(), [form.kra_pin]);

  const finish = (client, linked) => {
    onCreated?.(client, { linked, leadId: lead?.id || null });
    onClose?.();
  };

  const submit = async ({ useExistingId = null } = {}) => {
    if (!nameGiven && !useExistingId) { setError('A client record needs a name.'); return; }
    setSaving(true);
    setError('');
    try {
      const client = await createClient(form, {
        leadId: lead?.id || null,
        agentId,
        useExistingId,
        force: useExistingId ? false : force,
      });
      finish(client, Boolean(useExistingId));
    } catch (err) {
      if (err?.code === DUPLICATE_CODE) setRefused(true);
      setError(err?.message || 'Could not save the client record.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">

        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Icon name="UserPlus" size={18} color="var(--color-primary)" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">{heading}</h2>
              <p className="text-xs text-muted-foreground">
                Enough to invoice, receipt and take payment. A name is all that is required.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg" aria-label="Close">
            <Icon name="X" size={18} color="var(--color-muted-foreground)" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">

          {lead && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs text-foreground flex items-start gap-2">
              <Icon name="GitBranch" size={14} color="var(--color-primary)" />
              <span>
                Converting lead <span className="font-semibold">{lead.full_name}</span>. The record stays
                linked to it, so converting this lead again will reopen the same customer rather than
                creating a second one.
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className={F.label} htmlFor="cr-name">Full name or company name *</label>
              <input id="cr-name" className={F.input} value={form.full_name}
                placeholder="Who the invoice is addressed to"
                onChange={e => set('full_name', e.target.value)} />
            </div>
            <div>
              <label className={F.label} htmlFor="cr-phone">Phone</label>
              <input id="cr-phone" className={F.input} value={form.phone}
                placeholder="0712 345 678" onChange={e => set('phone', e.target.value)} />
            </div>
            <div>
              <label className={F.label} htmlFor="cr-email">Email</label>
              <input id="cr-email" type="email" className={F.input} value={form.email}
                placeholder="For sending the invoice" onChange={e => set('email', e.target.value)} />
            </div>
            <div>
              <label className={F.label} htmlFor="cr-pin">KRA PIN</label>
              <input id="cr-pin" className={F.input} value={form.kra_pin} maxLength={11}
                placeholder="e.g. A001234567X"
                onChange={e => set('kra_pin', e.target.value.toUpperCase().replace(/\s+/g, ''))} />
            </div>
            <div>
              <label className={F.label} htmlFor="cr-id">National ID</label>
              <input id="cr-id" className={F.input} value={form.national_id}
                placeholder="Optional" onChange={e => set('national_id', e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <label className={F.label} htmlFor="cr-address">Billing address</label>
              <input id="cr-address" className={F.input} value={form.billing_address}
                placeholder="Printed on the invoice" onChange={e => set('billing_address', e.target.value)} />
            </div>
            <div>
              <label className={F.label} htmlFor="cr-type">Customer type</label>
              <select id="cr-type" className={F.input} value={form.customer_type}
                onChange={e => set('customer_type', e.target.value)}>
                <option value="account">Account customer — may be sold to on terms</option>
                <option value="cash">Cash customer — invoice and receipt only</option>
              </select>
            </div>
            <div>
              <label className={F.label} htmlFor="cr-notes">Notes</label>
              <input id="cr-notes" className={F.input} value={form.notes}
                placeholder="Optional" onChange={e => set('notes', e.target.value)} />
            </div>
          </div>

          {pinMissing && (
            <p className="text-xs text-muted-foreground flex items-start gap-2">
              <Icon name="Info" size={13} color="var(--color-muted-foreground)" />
              Without a KRA PIN their invoice is a bill, not a tax invoice — a VAT-registered
              customer cannot claim the input tax on it. It can be added later.
            </p>
          )}

          {/* ── Who we already know ─────────────────────────────────────── */}
          {checking && matches.length === 0 && (
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              <Icon name="Loader" size={13} color="currentColor" className="animate-spin" />
              Looking for an existing customer…
            </p>
          )}

          {matches.length > 0 && (
            <div className={`rounded-xl border p-3 space-y-2 ${
              blocking.length > 0
                ? 'border-amber-300 bg-amber-50 dark:border-amber-700/50 dark:bg-amber-900/15'
                : 'border-border bg-muted/30'
            }`}>
              <p className="text-xs font-semibold text-foreground flex items-center gap-2">
                <Icon name={blocking.length > 0 ? 'AlertTriangle' : 'Search'} size={14}
                  color={blocking.length > 0 ? '#d97706' : 'var(--color-muted-foreground)'} />
                {blocking.length > 0
                  ? `Already on file — ${blocking.length} record${blocking.length === 1 ? '' : 's'} share these details`
                  : 'Possible match'}
              </p>
              {matches.map(row => (
                <DuplicateRow key={row.id} row={row} busy={saving}
                  onUse={(r) => submit({ useExistingId: r.id })} />
              ))}
              {blocking.length > 0 && (
                <label className="flex items-start gap-2 text-xs text-foreground pt-1 cursor-pointer">
                  <input type="checkbox" checked={force} className="mt-0.5"
                    onChange={e => { setForce(e.target.checked); setRefused(false); }} />
                  <span>
                    These are different people — create a separate record anyway.
                    <span className="text-muted-foreground"> Recorded against your name in the audit log.</span>
                  </span>
                </label>
              )}
            </div>
          )}

          {error && (
            <div className={`rounded-xl border p-3 text-xs ${
              refused
                ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/50 dark:bg-amber-900/15 dark:text-amber-200'
                : 'border-red-300 bg-red-50 text-red-700 dark:border-red-800/50 dark:bg-red-900/15 dark:text-red-300'
            }`}>
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border sticky bottom-0 bg-card">
          <button className={F.btnSec} onClick={onClose} disabled={saving}>Cancel</button>
          <button className={F.btnPri} onClick={() => submit()} disabled={!canSave}>
            <Icon name={saving ? 'Loader' : 'Check'} size={14} color="currentColor"
              className={saving ? 'animate-spin' : ''} />
            {saving ? 'Saving…' : 'Create client record'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ClientRecordModal;
