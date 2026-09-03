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

const Stat = ({ label, value, tone = 'default' }) => (
  <div className="rounded-lg border border-border bg-card p-4">
    <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
    <div className={`mt-1 text-2xl font-semibold ${tone === 'bad' ? 'text-red-600' : 'text-foreground'}`}>
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
    saveDevice, disableDevice, sendNow, resolveDocument, saveClassification,
  } = useEtims();

  const [resolving, setResolving] = useState(null);

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
