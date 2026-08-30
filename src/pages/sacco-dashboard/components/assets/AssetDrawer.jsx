/**
 * One asset, in full: the record, its paperwork, and everything that has
 * happened to it.
 *
 * A side panel rather than a page, because the register is a list people scan
 * and dip into — opening a route per asset would lose the filters and the page
 * they were on every single time.
 *
 * The three numbers at the top are kept visually distinct on purpose. Cost,
 * book value and current value are different claims about the same object, and
 * a panel that stacked them in one column of identical figures would invite
 * exactly the confusion the register exists to prevent.
 */
import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import { useToast } from '../../../../components/Toast';
import { openStoredFile } from '../../../../lib/storageUrl';
import { ASSET_DOC_BUCKET, MAX_DOC_BYTES } from '../../../../hooks/useAssetRegister';
import { KES, fmtDate, GhostButton, PrimaryButton, Field, TextInput, Select, EmptyState } from '../_shared';
import {
  ASSET_DOC_TYPES, docTypeMeta, docTypeLabel, categoryMeta, statusMeta,
  bookValue, reportedValue, ageInYears, depreciationProgress, isFullyDepreciated,
  valuationAge, expiringDocuments,
} from '../../../../config/assetRegister';

const TONE_CLASSES = {
  success: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  danger:  'bg-red-100 text-red-700',
  muted:   'bg-slate-100 text-slate-600',
};

export const StatusPill = ({ status }) => {
  const meta = statusMeta(status);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${TONE_CLASSES[meta.tone] || TONE_CLASSES.muted}`}>
      <Icon name={meta.icon} size={11} color="currentColor" />
      {meta.label}
    </span>
  );
};

const ValueBlock = ({ label, amount, hint, accent = false }) => (
  <div className={`rounded-xl border p-3 ${accent ? 'border-primary/40' : 'border-border'}`}
    style={accent ? { background: 'rgba(52,193,221,0.08)' } : {}}>
    <p className="text-[11px] text-muted-foreground">{label}</p>
    <p className={`text-base font-bold font-mono mt-0.5 ${accent ? 'text-primary' : 'text-foreground'}`}>{amount}</p>
    {hint && <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{hint}</p>}
  </div>
);

const Row = ({ label, children }) => (
  <div className="flex items-start justify-between gap-4 py-2 border-b border-border last:border-0">
    <span className="text-xs text-muted-foreground flex-shrink-0">{label}</span>
    <span className="text-xs text-foreground text-right break-words">{children || '—'}</span>
  </div>
);

// ── Documents ───────────────────────────────────────────────────────────────

const UploadForm = ({ onUpload, busy }) => {
  const [file, setFile] = useState(null);
  const [meta, setMeta] = useState({ doc_type: 'invoice', title: '', issued_on: '', expires_on: '' });
  const expires = docTypeMeta(meta.doc_type).expires;

  const submit = async () => {
    await onUpload(file, meta);
    setFile(null);
    setMeta({ doc_type: 'invoice', title: '', issued_on: '', expires_on: '' });
  };

  return (
    <div className="rounded-xl border border-dashed border-border p-3 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Document type">
          <Select value={meta.doc_type} onChange={(e) => setMeta((m) => ({ ...m, doc_type: e.target.value }))}>
            {ASSET_DOC_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </Select>
        </Field>
        <Field label="Label (optional)">
          <TextInput value={meta.title} onChange={(e) => setMeta((m) => ({ ...m, title: e.target.value }))} placeholder="Logbook — original" />
        </Field>
        <Field label="Dated">
          <TextInput type="date" value={meta.issued_on} onChange={(e) => setMeta((m) => ({ ...m, issued_on: e.target.value }))} />
        </Field>
        {/* Only offered where it means something. An expiry date on a purchase
            invoice is a data-entry slip, and the register would then warn about it. */}
        {expires && (
          <Field label="Expires">
            <TextInput type="date" value={meta.expires_on} onChange={(e) => setMeta((m) => ({ ...m, expires_on: e.target.value }))} />
          </Field>
        )}
      </div>

      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border hover:bg-muted transition-all">
          <Icon name="Paperclip" size={14} color="currentColor" /> Choose file
        </span>
        <input
          type="file"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx"
        />
        <span className="truncate">{file ? file.name : `PDF, image or document · up to ${MAX_DOC_BYTES / 1048576} MB`}</span>
      </label>

      <PrimaryButton icon="Upload" onClick={submit} disabled={!file || busy} className="w-full justify-center">
        {busy ? 'Uploading…' : 'Attach document'}
      </PrimaryButton>
    </div>
  );
};

const DocumentRow = ({ doc, onDelete, deleting }) => {
  const meta = docTypeMeta(doc.doc_type);
  const expiry = doc.expires_on ? new Date(doc.expires_on) : null;
  const overdue = expiry && expiry.getTime() < Date.now();

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border last:border-0">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(52,193,221,0.12)' }}>
        <Icon name={meta.icon} size={15} color="#1da8c5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground truncate">{doc.title || doc.file_name}</p>
        <p className="text-[11px] text-muted-foreground">
          {docTypeLabel(doc.doc_type)}
          {doc.size_bytes ? ` · ${(doc.size_bytes / 1024).toFixed(0)} KB` : ''}
          {doc.issued_on ? ` · dated ${fmtDate(doc.issued_on)}` : ''}
          {expiry && (
            <span className={overdue ? 'text-red-600 font-semibold' : 'text-amber-700 font-semibold'}>
              {` · ${overdue ? 'expired' : 'expires'} ${fmtDate(doc.expires_on)}`}
            </span>
          )}
        </p>
      </div>
      <button
        onClick={() => openStoredFile(doc.file_url, { bucket: ASSET_DOC_BUCKET })}
        className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-muted transition-all"
        title="Open"
      >
        <Icon name="ExternalLink" size={15} color="currentColor" />
      </button>
      <button
        onClick={() => onDelete(doc)}
        disabled={deleting}
        className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-muted transition-all disabled:opacity-40"
        title="Remove"
      >
        <Icon name="Trash2" size={15} color="currentColor" />
      </button>
    </div>
  );
};

// ── History ─────────────────────────────────────────────────────────────────

const EVENT_META = {
  registered:     { icon: 'PlusCircle',   color: '#1da8c5' },
  status_changed: { icon: 'RefreshCw',    color: '#ca8a04' },
  moved:          { icon: 'MapPin',       color: '#1da8c5' },
  revalued:       { icon: 'LineChart',    color: '#059669' },
  disposed:       { icon: 'PackageMinus', color: '#dc2626' },
};

const eventSentence = (e) => {
  switch (e.event_type) {
    case 'registered': return `Registered as ${e.to_value || 'a new asset'}`;
    case 'moved':      return `Moved from ${e.from_value || 'no recorded location'} to ${e.to_value || 'no recorded location'}`;
    case 'revalued':   return `Valued at ${KES(e.to_value)}${e.from_value ? `, was ${KES(e.from_value)}` : ''}`;
    case 'disposed':   return `Taken out of service — ${String(e.to_value || '').replace(/_/g, ' ')}`;
    default:           return `Status changed from ${String(e.from_value || '').replace(/_/g, ' ')} to ${String(e.to_value || '').replace(/_/g, ' ')}`;
  }
};

const HistoryRow = ({ event }) => {
  const meta = EVENT_META[event.event_type] || EVENT_META.status_changed;
  return (
    <div className="flex gap-3 py-2.5 border-b border-border last:border-0">
      <Icon name={meta.icon} size={15} color={meta.color} />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-foreground">{eventSentence(event)}</p>
        {event.note && <p className="text-[11px] text-muted-foreground mt-0.5 italic">“{event.note}”</p>}
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {new Date(event.created_at).toLocaleString('en-KE', {
            year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
          })}
        </p>
      </div>
    </div>
  );
};

// ── The drawer ──────────────────────────────────────────────────────────────

const TABS = [
  { id: 'record',    label: 'Record',    icon: 'FileText' },
  { id: 'documents', label: 'Documents', icon: 'Paperclip' },
  { id: 'history',   label: 'History',   icon: 'History' },
];

const AssetDrawer = ({ asset, onClose, onEdit, register }) => {
  const toast = useToast();
  const [tab, setTab] = useState('record');
  const [docs, setDocs] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const assetId = asset?.id;

  const load = useCallback(async () => {
    if (!assetId) return;
    setLoading(true);
    try {
      const [d, e] = await Promise.all([register.listDocuments(assetId), register.listEvents(assetId)]);
      setDocs(d);
      setEvents(e);
    } catch (err) {
      toast.error(err.message, 'Could not load this asset');
    } finally {
      setLoading(false);
    }
  // toast is stable from context; excluding it keeps this from re-running per render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, register.listDocuments, register.listEvents]);

  useEffect(() => { setTab('record'); load(); }, [load]);

  if (!asset) return null;

  const cat = categoryMeta(asset.category);
  const reported = reportedValue(asset);
  const age = ageInYears(asset);
  const progress = depreciationProgress(asset);
  const staleValuation = valuationAge(asset) === 'stale';
  const expiring = expiringDocuments(docs);

  const upload = async (file, meta) => {
    setBusy(true);
    try {
      await register.uploadDocument(assetId, file, meta);
      toast.success('Document attached.');
      await load();
    } catch (err) {
      toast.error(err.message, 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const removeDoc = async (doc) => {
    setBusy(true);
    try {
      await register.deleteDocument(doc);
      toast.success('Document removed.');
      await load();
    } catch (err) {
      toast.error(err.message, 'Could not remove the document');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex justify-end" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div
        className="bg-card border-l border-border w-full max-w-xl h-full overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-border">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(52,193,221,0.12)' }}>
                <Icon name={cat.icon} size={19} color="#1da8c5" />
              </div>
              <div className="min-w-0">
                <p className="font-mono text-[11px] text-muted-foreground">{asset.asset_tag}</p>
                <h3 className="font-semibold text-foreground truncate">{asset.asset_name}</h3>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <StatusPill status={asset.status} />
                  <span className="text-xs text-muted-foreground">{cat.label}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button onClick={() => onEdit(asset)} className="p-2 rounded-lg text-muted-foreground hover:text-primary hover:bg-muted transition-all" title="Edit">
                <Icon name="Pencil" size={17} color="currentColor" />
              </button>
              <button onClick={onClose} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
                <Icon name="X" size={18} color="currentColor" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mt-4">
            <ValueBlock label="Purchase value" amount={KES(asset.cost)} hint={fmtDate(asset.acquisition_date)} />
            <ValueBlock
              label="Book value"
              amount={KES(bookValue(asset))}
              hint={isFullyDepreciated(asset) ? 'Fully depreciated' : `${progress}% depreciated`}
            />
            <ValueBlock
              label="Current value"
              accent
              amount={KES(reported.value)}
              hint={reported.basis === 'valuation'
                ? `${staleValuation ? 'Stale — ' : ''}valued ${fmtDate(asset.valuation_date)}`
                : 'Not valued — showing book value'}
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 pt-3 border-b border-border">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-all ${
                tab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon name={t.icon} size={14} color="currentColor" />
              {t.label}
              {t.id === 'documents' && docs.length > 0 && (
                <span className="ml-0.5 px-1.5 rounded-full bg-muted text-[10px] font-bold text-muted-foreground">{docs.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'record' && (
            <div className="space-y-4">
              {asset.description && (
                <p className="text-sm text-foreground leading-relaxed">{asset.description}</p>
              )}

              {staleValuation && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200">
                  <Icon name="Clock" size={15} color="#ca8a04" />
                  <p className="text-xs text-amber-800">
                    The recorded valuation is over a year old, so “current value” above is a figure from{' '}
                    {fmtDate(asset.valuation_date)}. Revalue it, or the register is quoting history as if it were today.
                  </p>
                </div>
              )}

              {expiring.length > 0 && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200">
                  <Icon name="AlertTriangle" size={15} color="#ca8a04" />
                  <p className="text-xs text-amber-800">
                    {expiring.filter((d) => d.expired).length > 0
                      ? `${expiring.filter((d) => d.expired).length} document(s) have expired`
                      : `${expiring.length} document(s) expire within ${expiring[0].daysToExpiry} day(s)`}
                    {' — '}{expiring.map((d) => docTypeLabel(d.doc_type)).join(', ')}.
                  </p>
                </div>
              )}

              <div>
                <Row label="Location">{asset.location}</Row>
                <Row label="Serial / registration">{asset.serial_number}</Row>
                <Row label="Supplier">{asset.supplier}</Row>
                <Row label="Acquired">{fmtDate(asset.acquisition_date)}{age != null ? ` · ${age} yrs ago` : ''}</Row>
                <Row label="Asset account">{asset.gl_code}</Row>
                <Row label="Useful life">{asset.useful_life_years ? `${asset.useful_life_years} years` : null}</Row>
                <Row label="Method">{asset.method === 'reducing' ? 'Reducing balance' : 'Straight line'}</Row>
                <Row label="Residual value">{KES(asset.residual_value)}</Row>
                <Row label="Accumulated depreciation">{KES(asset.accumulated_depreciation)}</Row>
                {asset.is_disposed && <>
                  <Row label="Disposed on">{fmtDate(asset.disposal_date)}</Row>
                  <Row label="Proceeds">{asset.disposal_proceeds != null ? KES(asset.disposal_proceeds) : null}</Row>
                  <Row label="Reason">{asset.disposal_reason}</Row>
                </>}
                {asset.notes && <Row label="Notes">{asset.notes}</Row>}
              </div>

              <div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                  <span>Depreciated to date</span>
                  <span className="font-mono">{progress}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full transition-all"
                    style={{ width: `${progress}%`, background: progress >= 100 ? '#64748b' : '#1da8c5' }} />
                </div>
                {/* Measured against depreciation CHARGED, not time elapsed: an
                    asset whose period-end job was never run reads 0%, and it
                    should, rather than implying the books are up to date. */}
                <p className="text-[10px] text-muted-foreground mt-1">
                  Charged by the period-end depreciation job in the Finance Hub, not by age.
                </p>
              </div>
            </div>
          )}

          {tab === 'documents' && (
            <div className="space-y-4">
              <UploadForm onUpload={upload} busy={busy} />
              {loading ? (
                <p className="text-xs text-muted-foreground text-center py-4">Loading…</p>
              ) : docs.length === 0 ? (
                <EmptyState icon="Paperclip" title="No supporting documents"
                  hint="Attach the invoice, title deed, logbook, valuation or insurance certificate." />
              ) : (
                <div>{docs.map((d) => <DocumentRow key={d.id} doc={d} onDelete={removeDoc} deleting={busy} />)}</div>
              )}
            </div>
          )}

          {tab === 'history' && (
            loading ? (
              <p className="text-xs text-muted-foreground text-center py-4">Loading…</p>
            ) : events.length === 0 ? (
              <EmptyState icon="History" title="Nothing recorded yet"
                hint="Moves, status changes and revaluations appear here as they happen." />
            ) : (
              <div>{events.map((e) => <HistoryRow key={e.id} event={e} />)}</div>
            )
          )}
        </div>

        <div className="p-4 border-t border-border flex justify-end gap-2">
          <GhostButton onClick={onClose}>Close</GhostButton>
          <PrimaryButton icon="Pencil" onClick={() => onEdit(asset)}>Edit asset</PrimaryButton>
        </div>
      </div>
    </div>
  );
};

export default AssetDrawer;
