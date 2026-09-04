import React, { useMemo, useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { useAuth } from '../../../contexts/AuthContext';
import { useModules } from '../../../contexts/TenantModulesContext';
import { useEtims } from '../../../hooks/useEtims';
import { classificationStatus, taxCodeOptions, BLOCKER } from '../../../utils/etimsReadiness';
import {
  ETIMS_ENVIRONMENTS,
  QUANTITY_UNITS,
  PACKAGING_UNITS,
  ITEM_TYPES,
  isValidKraPin,
} from '../../../config/etimsCodes';

/**
 * KRA eTIMS — the compliance desk.
 *
 * Three questions, in the order a tenant actually asks them:
 *
 *   1. Am I filing?          the readiness banner and the device form
 *   2. What is stuck?        the queue, and the one decision only a human can
 *                            make (a document that may or may not have reached
 *                            KRA — see etims-transmit's header)
 *   3. What do I owe it?     the items that have no KRA classification yet, and
 *                            therefore cannot be filed at all
 *
 * The screen is deliberately blunt about the sandbox. Filing to it works
 * perfectly and files nothing, which is the failure mode most likely to be
 * discovered months later by a compliance officer, so it is stated on the
 * banner, on the device form and on every row it produced.
 */

const fmtMoney = (n) =>
  (parseFloat(n) || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtWhen = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const STATUS_STYLE = {
  sent:      { label: 'Filed',      cls: 'bg-emerald-100 text-emerald-800', icon: 'CheckCircle2' },
  pending:   { label: 'Queued',     cls: 'bg-amber-100 text-amber-800',     icon: 'Clock' },
  rejected:  { label: 'Refused',    cls: 'bg-red-100 text-red-800',         icon: 'XCircle' },
  uncertain: { label: 'Unknown',    cls: 'bg-orange-100 text-orange-900',   icon: 'HelpCircle' },
  cancelled: { label: 'Cancelled',  cls: 'bg-muted text-muted-foreground',  icon: 'Ban' },
};

// ── Small presentational pieces ──────────────────────────────────────────────

const STAT_TONE = {
  bad: 'text-red-600',
  // Amber, not red: a purchase waiting to be reviewed is work to do, not a
  // fault. Red here would put the compliance screen permanently in alarm for
  // something that is simply a supplier's invoice arriving.
  warn: 'text-amber-600',
  good: 'text-emerald-600',
  default: 'text-foreground',
};

const Stat = ({ label, value, tone = 'default' }) => (
  <div className="rounded-lg border border-border bg-card p-4">
    <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
    <div className={`mt-1 text-2xl font-semibold ${STAT_TONE[tone] || STAT_TONE.default}`}>
      {value}
    </div>
  </div>
);

const Field = ({ label, hint, children }) => (
  <label className="block">
    <span className="text-sm font-medium text-foreground">{label}</span>
    {children}
    {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
  </label>
);

const inputCls =
  'mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none';

// ── The device ───────────────────────────────────────────────────────────────

const DeviceForm = ({ config, saving, onSave, onDisable }) => {
  const [form, setForm] = useState({
    kraPin: config?.kraPin || '',
    branchId: config?.branchId || '00',
    deviceSerial: config?.deviceSerial || '',
    environment: config?.environment || 'sandbox',
  });
  const [result, setResult] = useState(null);
  const [confirmLive, setConfirmLive] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const pinLooksWrong = form.kraPin.length > 0 && !isValidKraPin(form.kraPin);
  const goingLive = form.environment === 'production' && config?.environment !== 'production';

  const submit = async () => {
    setResult(null);
    try {
      const data = await onSave(form);
      setResult({ ok: data?.verified, message: data?.message });
      setConfirmLive(false);
    } catch (err) {
      setResult({ ok: false, message: err.message });
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <h3 className="text-base font-semibold text-foreground">Your KRA device</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        These are the details KRA issued when this business registered for eTIMS. Saving
        initialises the device with KRA — filing only switches on once KRA accepts it.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="KRA PIN" hint="The PIN this business is registered under, e.g. P051234567X.">
          <input
            className={`${inputCls} ${pinLooksWrong ? 'border-red-500' : ''}`}
            value={form.kraPin}
            onChange={(e) => set('kraPin', e.target.value.toUpperCase())}
            placeholder="P051234567X"
          />
          {pinLooksWrong && (
            <span className="mt-1 block text-xs text-red-600">
              A PIN is a letter, nine digits and a check letter.
            </span>
          )}
        </Field>

        <Field label="Branch ID" hint="00 is head office. Use the branch code KRA gave this outlet.">
          <input className={inputCls} value={form.branchId} onChange={(e) => set('branchId', e.target.value)} />
        </Field>

        <Field label="Device serial number" hint="From your eTIMS registration with KRA.">
          <input
            className={inputCls}
            value={form.deviceSerial}
            onChange={(e) => set('deviceSerial', e.target.value)}
          />
        </Field>

        <Field
          label="Environment"
          hint="Sandbox files nothing to the live system. Use it to test, then switch."
        >
          <select
            className={inputCls}
            value={form.environment}
            onChange={(e) => { set('environment', e.target.value); setConfirmLive(false); }}
          >
            {Object.values(ETIMS_ENVIRONMENTS).map((e) => (
              <option key={e.key} value={e.key}>{e.label}</option>
            ))}
          </select>
        </Field>
      </div>

      {/* Going live restarts the device sequence and re-initialises with KRA.
          Said plainly, because a tenant who does it by accident files their next
          document under a number the live device has never seen. */}
      {goingLive && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="font-medium">Switching to live filing</div>
          <p className="mt-1">
            The device will be re-registered against KRA's production system and its invoice
            numbering restarts from one. Anything still queued for the sandbox will not be filed.
            From then on, every sale is a real filing.
          </p>
          <label className="mt-2 flex items-center gap-2">
            <input type="checkbox" checked={confirmLive} onChange={(e) => setConfirmLive(e.target.checked)} />
            <span>I understand — file live to KRA.</span>
          </label>
        </div>
      )}

      {result && (
        <div
          className={`mt-4 rounded-md p-3 text-sm ${
            result.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900'
          }`}
        >
          {result.message}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          onClick={submit}
          disabled={saving || pinLooksWrong || !form.kraPin || !form.deviceSerial || (goingLive && !confirmLive)}
        >
          {saving ? 'Checking with KRA…' : config?.configured ? 'Save and re-check' : 'Register device'}
        </Button>

        {config?.isActive && (
          <Button variant="outline" onClick={onDisable} disabled={saving}>
            Switch filing off
          </Button>
        )}

        {config?.configured && (
          <span className="text-xs text-muted-foreground">
            Device sequence at {config.lastInvoiceNumber ?? 0}
            {config.controlUnitId ? ` · control unit ${config.controlUnitId}` : ''}
          </span>
        )}
      </div>
    </div>
  );
};

// ── A document that may or may not have been filed ───────────────────────────

/**
 * The one decision this system will not make for a tenant.
 *
 * A timed-out transmission leaves the document in a genuinely unknown state.
 * Re-sending risks filing it twice; not re-sending risks not filing it at all.
 * Both options are offered with their risk stated, and neither is preselected.
 */
const ResolvePanel = ({ row, saving, onResolve, onClose }) => {
  const [signature, setSignature] = useState('');
  const [kraNumber, setKraNumber] = useState('');
  const [err, setErr] = useState('');

  const act = async (resolution, extra = {}) => {
    setErr('');
    try {
      await onResolve(row.id, resolution, extra);
      onClose();
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <div className="mt-2 rounded-md border border-orange-300 bg-orange-50 p-4 text-sm text-orange-950">
      <div className="font-medium">
        Invoice {row.invoice_number ?? '—'} may or may not have reached KRA.
      </div>
      <p className="mt-1">
        {row.last_error}
      </p>
      <p className="mt-2">
        Open your KRA eTIMS portal and look for invoice number{' '}
        <strong>{row.invoice_number ?? '—'}</strong>, then tell us what you found. Sending it
        again when KRA already has it would file the sale twice.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Receipt signature from the portal" hint="Only needed if KRA already has it.">
          <input className={inputCls} value={signature} onChange={(e) => setSignature(e.target.value.trim())} />
        </Field>
        <Field label="KRA receipt number" hint="Optional.">
          <input className={inputCls} value={kraNumber} onChange={(e) => setKraNumber(e.target.value.trim())} />
        </Field>
      </div>

      {err && <div className="mt-2 text-red-700">{err}</div>}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={saving || !signature}
          onClick={() => act('mark_filed', {
            receiptSignature: signature,
            kraInvoiceNumber: kraNumber ? Number(kraNumber) : null,
          })}
        >
          KRA has it — record as filed
        </Button>
        <Button size="sm" variant="outline" disabled={saving} onClick={() => act('resend')}>
          KRA does not have it — send again
        </Button>
        <Button size="sm" variant="ghost" disabled={saving} onClick={() => act('cancel')}>
          Cancel this document
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
};

// ── Credit notes ─────────────────────────────────────────────────────────────

/**
 * Reverse a filed invoice.
 *
 * Deliberately offers no amount to edit. A credit note here reverses the whole
 * invoice, because the figures are rebuilt from the original sale server-side
 * and there is no returns flow to say which lines came back — inventing a
 * partial amount in this panel is exactly what the design forbids. It is stated
 * on the panel so nobody goes looking for the box.
 *
 * There is no reason-code dropdown for the same reason there is no picker on
 * the classification form: KRA's list comes from selectCodeList, which nothing
 * fetches yet, and a hand-written list of guesses would be presented as KRA's
 * vocabulary. Left blank the document files under 05 ("other"), which is always
 * accepted, and the remark carries the human explanation.
 */
const CreditNotePanel = ({ row, saving, onRaise, onClose }) => {
  const [reasonCode, setReasonCode] = useState('');
  const [remark, setRemark] = useState('');
  const [err, setErr] = useState('');

  const submit = async () => {
    setErr('');
    try {
      await onRaise(row.id, { reasonCode: reasonCode || null, remark: remark || null });
      onClose();
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <div className="mt-2 rounded-md border border-border bg-muted/40 p-4 text-sm">
      <div className="font-medium text-foreground">
        Reverse invoice {row.invoice_number ?? '—'} with a credit note
      </div>
      <p className="mt-1 text-muted-foreground">
        This credits the whole invoice — KES {fmtMoney(row.total_amount)}
        {row.total_tax != null ? `, including ${fmtMoney(row.total_tax)} of tax` : ''}. The
        amounts are recalculated from the original sale when it is filed, so there is nothing
        to type. Partial credits are not possible yet.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field
          label="KRA refund reason code"
          hint="Optional, two digits. Leave blank to file under 05 (other)."
        >
          <input
            className={inputCls}
            value={reasonCode}
            inputMode="numeric"
            maxLength={2}
            placeholder="05"
            onChange={(e) => setReasonCode(e.target.value.replace(/\D/g, '').slice(0, 2))}
          />
        </Field>
        <Field label="Reason" hint="Sent to KRA with the document.">
          <input
            className={inputCls}
            value={remark}
            maxLength={200}
            placeholder="Goods returned by the customer"
            onChange={(e) => setRemark(e.target.value)}
          />
        </Field>
      </div>

      {err && <div className="mt-2 text-red-700">{err}</div>}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" disabled={saving} onClick={submit}>
          {saving ? 'Queueing…' : 'Queue the credit note'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
};

// ── Purchases ────────────────────────────────────────────────────────────────

/**
 * One purchase a supplier filed against this tenant's PIN.
 *
 * Shows the lines, because "do you recognise this?" is not answerable from a
 * header. There is deliberately no accept-all: accepting claims input VAT, and
 * the liability for claiming tax on a supply that never happened sits with the
 * tenant, so it costs one deliberate click each.
 */
const PurchaseRow = ({ row, saving, onDecide }) => {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');

  const decide = async (decision) => {
    setErr('');
    try {
      await onDecide(row.id, decision, note || null);
    } catch (e) {
      setErr(e.message);
    }
  };

  const undecided = row.decision === 'new';
  const filed = row.status === 'sent';

  return (
    <div className="p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
            undecided
              ? 'bg-amber-100 text-amber-900'
              : row.decision === 'accepted'
                ? 'bg-emerald-100 text-emerald-900'
                : 'bg-red-100 text-red-900'
          }`}
        >
          {undecided ? 'To review' : row.decision === 'accepted' ? 'Accepted' : 'Rejected'}
        </span>

        <span className="text-sm text-foreground">
          {row.supplier_name || row.supplier_pin} · invoice {row.supplier_invoice_no}
        </span>

        <span className="text-xs text-muted-foreground">{row.purchase_date || '—'}</span>

        <span className="text-xs text-muted-foreground">
          KES {fmtMoney(row.total_amount)}
          {row.total_tax != null ? ` · tax ${fmtMoney(row.total_tax)}` : ''}
        </span>

        {filed && <span className="text-xs text-muted-foreground">filed with KRA</span>}

        <button
          type="button"
          className="text-xs text-primary underline"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Hide items' : `Show ${row.items?.length ?? 0} item(s)`}
        </button>
      </div>

      {open && (
        <div className="mt-2 overflow-x-auto rounded border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="p-2 text-left">Item</th>
                <th className="p-2 text-right">Qty</th>
                <th className="p-2 text-right">Price</th>
                <th className="p-2 text-left">Tax</th>
                <th className="p-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {(row.items || []).map((it) => (
                <tr key={it.item_seq} className="border-t border-border">
                  <td className="p-2">{it.item_name || it.item_code}</td>
                  <td className="p-2 text-right">{fmtMoney(it.quantity)}</td>
                  <td className="p-2 text-right">{fmtMoney(it.unit_price)}</td>
                  <td className="p-2">{it.tax_code || '—'}</td>
                  <td className="p-2 text-right">{fmtMoney(it.total_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {row.decision_note && (
        <div className="mt-1 text-xs text-muted-foreground">Note: {row.decision_note}</div>
      )}
      {row.last_error && <div className="mt-1 text-xs text-red-700">{row.last_error}</div>}
      {err && <div className="mt-1 text-xs text-red-700">{err}</div>}

      {undecided && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            className={`${inputCls} max-w-xs`}
            placeholder="Note (optional)"
            value={note}
            maxLength={200}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button size="sm" disabled={saving} onClick={() => decide('accepted')}>
            We bought this
          </Button>
          <Button size="sm" variant="outline" disabled={saving} onClick={() => decide('rejected')}>
            We did not
          </Button>
        </div>
      )}
    </div>
  );
};

// ── Stock ────────────────────────────────────────────────────────────────────

/**
 * Record a stock change a sale cannot explain.
 *
 * The reason is asked for rather than inferred. A quantity that fell from nine
 * to four could be a write-off, breakage, a transfer or a corrected miscount,
 * and each is a different code on a tax filing — guessing would put a
 * fabricated statement into a tax record.
 *
 * Only classified items appear: an unclassified one cannot be filed at all, so
 * offering it here would only produce a queued movement that sticks.
 */
const StockAdjustmentForm = ({ items, saving, disabled, onRecord }) => {
  const [assetId, setAssetId] = useState('');
  const [direction, setDirection] = useState('in');
  const [quantity, setQuantity] = useState('');
  const [movementCode, setMovementCode] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');

  const withAsset = useMemo(() => (items || []).filter((i) => i.asset_id), [items]);

  const submit = async () => {
    setErr('');
    setDone('');
    try {
      await onRecord({
        assetId,
        direction,
        quantity,
        movementCode: movementCode || null,
        note: note || null,
      });
      setDone('Recorded. It files on the next run.');
      setQuantity('');
      setNote('');
      setMovementCode('');
    } catch (e) {
      setErr(e.message);
    }
  };

  if (!withAsset.length) {
    return (
      <div className="border-b border-border p-4 text-sm text-muted-foreground">
        Classify an item below before recording stock movements for it.
      </div>
    );
  }

  return (
    <div className="border-b border-border p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Item">
          <select className={inputCls} value={assetId} onChange={(e) => setAssetId(e.target.value)}>
            <option value="">Choose…</option>
            {withAsset.map((i) => (
              <option key={i.asset_id} value={i.asset_id}>
                {i.item_name || i.item_code}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Direction">
          <select
            className={inputCls}
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
          >
            <option value="in">Came in</option>
            <option value="out">Went out</option>
          </select>
        </Field>

        <Field label="Quantity">
          <input
            className={inputCls}
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value.replace(/[^\d.]/g, ''))}
          />
        </Field>

        <Field label="KRA code" hint="Optional, two digits.">
          <input
            className={inputCls}
            inputMode="numeric"
            maxLength={2}
            placeholder={direction === 'in' ? '02' : '11'}
            value={movementCode}
            onChange={(e) => setMovementCode(e.target.value.replace(/\D/g, '').slice(0, 2))}
          />
        </Field>

        <Field label="Reason">
          <input
            className={inputCls}
            maxLength={200}
            placeholder="Damaged in transit"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>

      {err && <div className="mt-2 text-sm text-red-700">{err}</div>}
      {done && <div className="mt-2 text-sm text-emerald-700">{done}</div>}

      <div className="mt-3">
        <Button
          size="sm"
          disabled={saving || disabled || !assetId || !(parseFloat(quantity) > 0)}
          onClick={submit}
        >
          Record the movement
        </Button>
        {disabled && (
          <span className="ml-2 text-xs text-muted-foreground">
            Register a KRA device first.
          </span>
        )}
      </div>
    </div>
  );
};

// ── Item classification ──────────────────────────────────────────────────────

const ClassificationRow = ({ row, saving, onSave }) => {
  const [draft, setDraft] = useState({
    item_code: row.item_code || '',
    item_name: row.item_name || '',
    asset_id: row.asset_id || null,
    tax_code: row.tax_code || '',
    classification_code: row.classification_code || '',
    quantity_unit: row.quantity_unit || 'U',
    packaging_unit: row.packaging_unit || 'NT',
    item_type: row.item_type || '2',
  });
  const [open, setOpen] = useState(false);
  const status = classificationStatus(draft.tax_code ? draft : row);
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  const options = useMemo(() => taxCodeOptions(), []);
  const chosen = options.find((o) => o.value === draft.tax_code);

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 p-3 text-left"
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">
            {draft.item_name || draft.item_code}
          </div>
          <div className="text-xs text-muted-foreground">
            {draft.item_code}
            {row.sale_count ? ` · ${row.sale_count} sale${row.sale_count === 1 ? '' : 's'} waiting` : ''}
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
            status.complete ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
          }`}
        >
          {status.complete ? (status.registered ? 'Ready' : 'Ready — registers on next sale') : `Needs ${status.missing.join(', ')}`}
        </span>
      </button>

      {open && (
        <div className="border-t border-border p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Tax treatment"
              hint="Exempt, zero-rated and non-VAT all charge nothing but are different lines of a VAT return. Pick the one that is true."
            >
              <select className={inputCls} value={draft.tax_code} onChange={(e) => set('tax_code', e.target.value)}>
                <option value="">— choose —</option>
                {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {chosen && (
                <span className="mt-1 block text-xs text-muted-foreground">
                  {chosen.desc}
                  {chosen.reclaimsInputTax
                    ? ' Input tax on these supplies is reclaimable.'
                    : ' Input tax on these supplies is NOT reclaimable.'}
                </span>
              )}
            </Field>

            <Field label="KRA classification code" hint="From KRA's item classification list, e.g. 5059230800.">
              <input
                className={inputCls}
                value={draft.classification_code}
                onChange={(e) => set('classification_code', e.target.value.trim())}
              />
            </Field>

            <Field label="Sold by">
              <select className={inputCls} value={draft.quantity_unit} onChange={(e) => set('quantity_unit', e.target.value)}>
                {QUANTITY_UNITS.map((u) => <option key={u.code} value={u.code}>{u.label}</option>)}
              </select>
            </Field>

            <Field label="Packaging">
              <select className={inputCls} value={draft.packaging_unit} onChange={(e) => set('packaging_unit', e.target.value)}>
                {PACKAGING_UNITS.map((u) => <option key={u.code} value={u.code}>{u.label}</option>)}
              </select>
            </Field>

            <Field label="Item type">
              <select className={inputCls} value={draft.item_type} onChange={(e) => set('item_type', e.target.value)}>
                {ITEM_TYPES.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
              </select>
            </Field>
          </div>

          {row.last_error && (
            <div className="mt-3 rounded-md bg-red-50 p-2 text-xs text-red-800">
              KRA last said: {row.last_error}
            </div>
          )}

          <div className="mt-4">
            <Button size="sm" disabled={saving} onClick={() => onSave(draft)}>
              {saving ? 'Saving…' : 'Save classification'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── The tab ──────────────────────────────────────────────────────────────────

const EtimsTab = () => {
  const { userProfile } = useAuth();
  const { isEnabled } = useModules();
  const {
    config, summary, recent, classifications, unclassified, readiness,
    loading, saving, error,
    stockSummary, stockRecent, purchases, purchaseSummary,
    saveDevice, disableDevice, sendNow, resolveDocument, raiseCreditNote, saveClassification,
    recordStockAdjustment, pullPurchases, decidePurchase,
  } = useEtims();

  const [resolving, setResolving] = useState(null);
  const [crediting, setCrediting] = useState(null);

  // Which invoices already have a credit note, so the button is not offered
  // twice. Derived from the loaded page only, so an invoice credited before the
  // 50-row window would still show the button — the unique index refuses it and
  // the panel reports "already been credited", which is the correct answer
  // rather than a silent second reversal.
  const credited = useMemo(
    () => new Set(
      recent.filter((r) => r.doc_type === 'credit_note' && r.reverses_id && r.status !== 'cancelled')
        .map((r) => r.reverses_id),
    ),
    [recent],
  );

  const canManage = ['admin', 'sacco_admin', 'super_admin'].includes(userProfile?.role);

  // The rows that need classifying, merged with the ones already saved, so a
  // tenant sees one list rather than hunting between two.
  const classificationRows = useMemo(() => {
    const byCode = new Map();
    for (const c of classifications) byCode.set(c.item_code, { ...c });
    for (const u of unclassified) {
      const key = u.item_code;
      byCode.set(key, {
        ...(byCode.get(key) || {}),
        item_code: key,
        item_name: u.item_name,
        asset_id: u.asset_id,
        sale_count: u.sale_count,
      });
    }
    return [...byCode.values()].sort((a, b) => (b.sale_count || 0) - (a.sale_count || 0));
  }, [classifications, unclassified]);

  if (!isEnabled('etims')) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center">
        <Icon name="Receipt" size={32} className="mx-auto text-muted-foreground" />
        <h3 className="mt-3 text-base font-semibold text-foreground">KRA eTIMS is switched off</h3>
        <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
          eTIMS files every invoice you issue with KRA and prints the receipt signature a valid
          tax invoice needs. It is optional — switch it on under Modules if KRA requires it of
          this business. Nothing is filed until you register a device here.
        </p>
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        Only an account owner can configure KRA eTIMS filing.
      </div>
    );
  }

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading eTIMS status…</div>;
  }

  const blockers = readiness.issues.filter((i) => i.severity === BLOCKER);
  const warnings = readiness.issues.filter((i) => i.severity !== BLOCKER);

  return (
    <div className="space-y-6">
      {/* ── Am I filing? ─────────────────────────────────────────────────── */}
      <div
        className={`rounded-lg border p-4 ${
          readiness.ready
            ? 'border-emerald-300 bg-emerald-50'
            : blockers.length
            ? 'border-red-300 bg-red-50'
            : 'border-amber-300 bg-amber-50'
        }`}
      >
        <div className="flex items-start gap-3">
          <Icon
            name={readiness.ready ? 'ShieldCheck' : 'AlertTriangle'}
            size={20}
            className={readiness.ready ? 'text-emerald-700' : 'text-red-700'}
          />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-foreground">
              {readiness.ready
                ? config?.isSandbox
                  ? 'Filing to the KRA sandbox'
                  : 'Filing to KRA'
                : 'Not filing correctly'}
            </div>

            {[...blockers, ...warnings].length > 0 && (
              <ul className="mt-2 space-y-1.5 text-sm">
                {[...blockers, ...warnings].map((i) => (
                  <li key={i.code} className="flex gap-2">
                    <Icon
                      name={i.severity === BLOCKER ? 'XCircle' : 'AlertCircle'}
                      size={15}
                      className={`mt-0.5 shrink-0 ${i.severity === BLOCKER ? 'text-red-600' : 'text-amber-600'}`}
                    />
                    <span>
                      {i.message}
                      {i.fix && <span className="text-muted-foreground"> {i.fix}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      {/* ── The numbers ──────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Filed" value={summary?.sent ?? 0} />
        <Stat label="Queued" value={summary?.pending ?? 0} />
        <Stat label="Refused" value={summary?.rejected ?? 0} tone={summary?.rejected ? 'bad' : 'default'} />
        <Stat label="Unknown" value={summary?.uncertain ?? 0} tone={summary?.uncertain ? 'bad' : 'default'} />
        <Stat label="Tax filed (KES)" value={fmtMoney(summary?.tax_filed)} />
      </div>

      <DeviceForm config={config} saving={saving} onSave={saveDevice} onDisable={disableDevice} />

      {/* ── The queue ────────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <h3 className="text-base font-semibold text-foreground">Recent filings</h3>
            <p className="text-xs text-muted-foreground">
              Documents transmit on a schedule. Nothing here can delay or block a sale.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={sendNow} disabled={saving || !config?.isActive}>
            {saving ? 'Sending…' : 'Send queued now'}
          </Button>
        </div>

        {recent.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Nothing has been queued yet. Sales are queued automatically once a device is registered.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {recent.map((row) => {
              const s = STATUS_STYLE[row.status] || STATUS_STYLE.pending;
              return (
                <div key={row.id} className="p-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
                      <Icon name={s.icon} size={12} />
                      {s.label}
                    </span>

                    <span className="text-sm text-foreground">
                      {row.doc_type === 'credit_note' ? 'Credit note' : 'Invoice'}{' '}
                      {row.invoice_number ?? '(unnumbered)'}
                    </span>

                    <span className="text-xs text-muted-foreground">
                      {fmtWhen(row.transmitted_at || row.created_at)}
                    </span>

                    {row.total_amount != null && (
                      <span className="text-xs text-muted-foreground">
                        KES {fmtMoney(row.total_amount)}
                        {row.total_tax != null ? ` · tax ${fmtMoney(row.total_tax)}` : ''}
                      </span>
                    )}

                    {row.environment !== 'production' && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        sandbox
                      </span>
                    )}

                    {row.attempts > 1 && (
                      <span className="text-xs text-muted-foreground">{row.attempts} attempts</span>
                    )}
                  </div>

                  {row.receipt_signature && (
                    <div className="mt-1 font-mono text-xs text-muted-foreground">
                      Signature {row.receipt_signature}
                    </div>
                  )}

                  {row.last_error && row.status !== 'uncertain' && (
                    <div className="mt-1 text-xs text-red-700">{row.last_error}</div>
                  )}

                  {row.status === 'uncertain' && (
                    resolving === row.id ? (
                      <ResolvePanel
                        row={row}
                        saving={saving}
                        onResolve={resolveDocument}
                        onClose={() => setResolving(null)}
                      />
                    ) : (
                      <div className="mt-2">
                        <Button size="sm" variant="outline" onClick={() => setResolving(row.id)}>
                          Decide what to do
                        </Button>
                      </div>
                    )
                  )}

                  {/* Only a filed invoice can be reversed: KRA identifies the
                      reversed document by the invoice number the original was
                      accepted under, so there is nothing to point at until it
                      has one. An invoice already credited offers no button —
                      the unique index would refuse a second one anyway, but a
                      button that always errors is worse than no button. */}
                  {row.status === 'sent' && row.doc_type === 'sale' && (
                    credited.has(row.id) ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Reversed by a credit note.
                      </div>
                    ) : crediting === row.id ? (
                      <CreditNotePanel
                        row={row}
                        saving={saving}
                        onRaise={raiseCreditNote}
                        onClose={() => setCrediting(null)}
                      />
                    ) : (
                      <div className="mt-2">
                        <Button size="sm" variant="ghost" onClick={() => setCrediting(row.id)}>
                          Raise a credit note
                        </Button>
                      </div>
                    )
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Purchases ────────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <h3 className="text-base font-semibold text-foreground">Purchases from your suppliers</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              What your suppliers have already filed against your KRA PIN. Nothing here was typed
              in — it comes from KRA, so you review it rather than re-enter it. Accepting a
              purchase is what puts its tax into your input VAT.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={pullPurchases} disabled={saving || !config?.isActive}>
            {saving ? 'Checking…' : 'Check KRA for new purchases'}
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3 border-b border-border p-4 sm:grid-cols-4">
          <Stat
            label="To review"
            value={purchaseSummary?.awaiting ?? 0}
            tone={purchaseSummary?.awaiting ? 'warn' : 'default'}
          />
          <Stat label="Accepted" value={purchaseSummary?.accepted ?? 0} />
          <Stat label="Rejected" value={purchaseSummary?.rejected ?? 0} />
          <Stat label="Input tax accepted (KES)" value={fmtMoney(purchaseSummary?.input_tax)} />
        </div>

        {purchases.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Nothing yet. Use the button above to check KRA for purchases filed against your PIN.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {purchases.map((row) => (
              <PurchaseRow key={row.id} row={row} saving={saving} onDecide={decidePurchase} />
            ))}
          </div>
        )}
      </div>

      {/* ── Stock ────────────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border p-4">
          <h3 className="text-base font-semibold text-foreground">Stock</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Every sale files the stock that left with it, and the remaining quantity is declared
            to KRA from your asset register. Record anything else that changed your stock —
            deliveries received, breakages, write-offs — so KRA's count matches yours.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 border-b border-border p-4 sm:grid-cols-4">
          <Stat label="Queued" value={stockSummary?.pending ?? 0} />
          <Stat label="Filed" value={stockSummary?.sent ?? 0} tone="good" />
          <Stat
            label="Refused"
            value={stockSummary?.rejected ?? 0}
            tone={stockSummary?.rejected ? 'bad' : 'default'}
          />
          <Stat
            label="Unknown"
            value={stockSummary?.uncertain ?? 0}
            tone={stockSummary?.uncertain ? 'bad' : 'default'}
          />
        </div>

        <StockAdjustmentForm
          items={classifications}
          saving={saving}
          disabled={!config?.isActive}
          onRecord={recordStockAdjustment}
        />

        {stockRecent.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No stock movements yet. They are filed automatically as you sell.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {stockRecent.map((row) => {
              const s = STATUS_STYLE[row.status] || STATUS_STYLE.pending;
              return (
                <div key={row.id} className="p-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
                      <Icon name={s.icon} size={12} />
                      {s.label}
                    </span>
                    <span className="text-sm text-foreground">
                      {row.direction === 'in' ? 'In' : 'Out'} {fmtMoney(row.quantity)} ×{' '}
                      {row.item_code}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {fmtWhen(row.transmitted_at || row.occurred_at || row.created_at)}
                    </span>
                    {row.sale_id && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        from a sale
                      </span>
                    )}
                    {row.environment !== 'production' && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        sandbox
                      </span>
                    )}
                  </div>
                  {row.note && (
                    <div className="mt-1 text-xs text-muted-foreground">{row.note}</div>
                  )}
                  {row.last_error && (
                    <div className="mt-1 text-xs text-red-700">{row.last_error}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Item classification ──────────────────────────────────────────── */}
      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border p-4">
          <h3 className="text-base font-semibold text-foreground">Item classification</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            KRA needs to know how each thing you sell is taxed and what it is. An item with no
            classification cannot be filed — its invoices wait here rather than being filed
            under a guess.
          </p>
        </div>

        {classificationRows.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Nothing needs classifying.
          </div>
        ) : (
          <div className="space-y-2 p-3">
            {classificationRows.map((row) => (
              <ClassificationRow
                key={row.item_code}
                row={row}
                saving={saving}
                onSave={saveClassification}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default EtimsTab;
