import React, { useState, useMemo } from 'react';
import Icon from '../AppIcon';
import { useToast } from '../Toast';
import {
  useDocumentArchive, DOC_TYPES, DOC_MODULES, SORTS, EMPTY_FILTERS,
} from '../../hooks/useDocumentArchive';

const fmtBytes = (n) => {
  const b = Number(n || 0);
  if (!b) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};

const fmtWhen = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

const fmtMoney = (n, cur = 'KES') =>
  n === null || n === undefined ? '—'
    : `${cur} ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const TYPE_TONE = {
  receipt:     'bg-emerald-100 text-emerald-700',
  invoice:     'bg-blue-100 text-blue-700',
  voucher:     'bg-indigo-100 text-indigo-700',
  statement:   'bg-purple-100 text-purple-700',
  payslip:     'bg-amber-100 text-amber-800',
  certificate: 'bg-teal-100 text-teal-700',
  contract:    'bg-sky-100 text-sky-700',
  advice:      'bg-orange-100 text-orange-700',
  report:      'bg-gray-100 text-gray-700',
  other:       'bg-gray-100 text-gray-700',
};

/**
 * The document archive, as somebody actually looks for something in it.
 *
 * WHAT MAKES THIS DIFFERENT FROM A FILE LIST. Every filter here narrows the
 * QUERY, not the page — the archive grows without bound and a page-side filter
 * would mean fetching the whole book to show twenty-five rows. The counts in
 * the header come from SQL over everything, so they stay true while the list
 * below is filtered down to one client's April.
 *
 * BULK DOWNLOAD REPORTS WHAT LANDED. Browsers throttle a burst of downloads
 * from one gesture, so the files go one at a time with a pause and the toast
 * states the real number. "Downloaded 40" when eleven arrived is how an audit
 * pack goes out with holes in it.
 */
const DocumentArchivePanel = ({ clients = [] }) => {
  const toast = useToast();
  const {
    documents, summary, loading, error, hasMore,
    filters, setFilters, loadMore, open, download, downloadMany,
  } = useDocumentArchive();

  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy]         = useState('');
  const [progress, setProgress] = useState(null);

  const totals = useMemo(() => {
    const byType = Object.fromEntries((summary || []).map(s => [s.doc_type, s]));
    const count  = (summary || []).reduce((a, s) => a + Number(s.document_count || 0), 0);
    const oldest = (summary || []).map(s => s.earliest).filter(Boolean).sort()[0] || null;
    return { byType, count, oldest };
  }, [summary]);

  const set = (key, value) => setFilters(f => ({ ...f, [key]: value }));
  const activeCount = [
    filters.search, filters.docType !== 'all', filters.module !== 'all',
    filters.clientId, filters.from, filters.to,
  ].filter(Boolean).length;

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const allShown = documents.length > 0 && documents.every(d => selected.has(d.id));
  const toggleAll = () => setSelected(allShown ? new Set() : new Set(documents.map(d => d.id)));

  const act = async (label, fn) => {
    setBusy(label);
    try { await fn(); }
    catch (err) { toast.error(err?.message || `Could not ${label.toLowerCase()} that document.`); }
    finally { setBusy(''); }
  };

  const bulk = async () => {
    const picked = documents.filter(d => selected.has(d.id));
    if (picked.length === 0) return;
    setBusy('bulk');
    setProgress({ done: 0, total: picked.length });
    try {
      const { done, failed } = await downloadMany(picked, (n, total) => setProgress({ done: n, total }));
      if (failed.length === 0) {
        toast.success(`${done} document${done === 1 ? '' : 's'} downloaded.`);
      } else {
        toast.error(`${done} of ${picked.length} downloaded. ${failed.length} could not be fetched — try those individually.`);
      }
      setSelected(new Set());
    } finally {
      setBusy('');
      setProgress(null);
    }
  };

  return (
    <div className="space-y-4">

      {/* What the archive holds, over everything — not over this page */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Documents filed</p>
          <p className="text-2xl font-bold text-foreground mt-1">{totals.count.toLocaleString()}</p>
          {totals.oldest && (
            <p className="text-xs text-muted-foreground">since {new Date(totals.oldest).toLocaleDateString()}</p>
          )}
        </div>
        {['receipt', 'invoice', 'voucher'].map(t => (
          <div key={t} className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide capitalize">{t}s</p>
            <p className="text-2xl font-bold text-foreground mt-1">
              {Number(totals.byType[t]?.document_count || 0).toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-foreground">Document Archive</h2>
            <p className="text-xs text-muted-foreground">
              {documents.length} shown{hasMore ? ' (more available)' : ''}
              {activeCount > 0 ? ` · ${activeCount} filter${activeCount === 1 ? '' : 's'}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <div className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                <Icon name="Search" size={13} color="var(--color-muted-foreground)" />
              </div>
              <input
                value={filters.search}
                onChange={(e) => set('search', e.target.value)}
                placeholder="Reference, client or title…"
                aria-label="Search documents"
                className="pl-8 pr-3 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground w-56"
              />
            </div>
            <select value={filters.sort} onChange={(e) => set('sort', e.target.value)}
              aria-label="Sort documents"
              className="px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground">
              {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            {activeCount > 0 && (
              <button onClick={() => setFilters(EMPTY_FILTERS)}
                className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted">
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-b border-border bg-muted/30 grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground uppercase mb-1" htmlFor="arch-type">Type</label>
            <select id="arch-type" value={filters.docType} onChange={(e) => set('docType', e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground">
              <option value="all">All types</option>
              {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground uppercase mb-1" htmlFor="arch-module">Module</label>
            <select id="arch-module" value={filters.module} onChange={(e) => set('module', e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground">
              <option value="all">All modules</option>
              {DOC_MODULES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground uppercase mb-1" htmlFor="arch-client">Client</label>
            <select id="arch-client" value={filters.clientId} onChange={(e) => set('clientId', e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground">
              <option value="">Any client</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.full_name || c.fullName}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground uppercase mb-1" htmlFor="arch-from">Issued from</label>
            <input id="arch-from" type="date" value={filters.from} onChange={(e) => set('from', e.target.value)}
              className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground uppercase mb-1" htmlFor="arch-to">Issued to</label>
            <input id="arch-to" type="date" value={filters.to} onChange={(e) => set('to', e.target.value)}
              className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground" />
          </div>
        </div>

        {selected.size > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-3 bg-primary/5 border-b border-border">
            <p className="text-xs font-semibold text-foreground">
              {selected.size} selected
              {progress && ` · ${progress.done} of ${progress.total} fetched`}
            </p>
            <div className="flex items-center gap-2">
              <button onClick={bulk} disabled={busy === 'bulk'}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground disabled:opacity-50">
                {busy === 'bulk' ? 'Downloading…' : `Download ${selected.size}`}
              </button>
              <button onClick={() => setSelected(new Set())}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground">
                Clear
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 px-5 py-3 bg-red-50 border-b border-red-200">
            <Icon name="AlertCircle" size={15} color="#dc2626" />
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Loading the archive…</div>
        ) : documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Icon name="FolderSearch" size={28} color="currentColor" />
            <p className="text-sm mt-2">No documents match this view</p>
            <p className="text-xs">Documents are filed automatically as they are issued.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-4 py-3 w-10">
                    <input type="checkbox" aria-label="Select all shown"
                      checked={allShown} onChange={toggleAll} />
                  </th>
                  {['Document', 'Type', 'Client', 'Reference', 'Amount', 'Issued', 'Size', ''].map((h, i) => (
                    <th key={h || `c${i}`} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {documents.map(d => (
                  <tr key={d.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <input type="checkbox" aria-label={`Select ${d.title}`}
                        checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-foreground">{d.title}</p>
                      <p className="text-[11px] text-muted-foreground capitalize">{d.module}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${TYPE_TONE[d.doc_type] || TYPE_TONE.other}`}>
                        {d.doc_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground">{d.client_name || '—'}</td>
                    <td className="px-4 py-3 text-xs font-mono text-muted-foreground">{d.reference || '—'}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-foreground whitespace-nowrap">
                      {fmtMoney(d.amount, d.currency)}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtWhen(d.issued_at)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{fmtBytes(d.file_size)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => act('Open', () => open(d))} disabled={!!busy}
                          title="Open"
                          className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50">
                          <Icon name="ExternalLink" size={13} color="currentColor" />
                        </button>
                        <button onClick={() => act('Download', () => download(d))} disabled={!!busy}
                          title="Download"
                          className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50">
                          <Icon name="Download" size={13} color="currentColor" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {hasMore && (
              <div className="px-5 py-4 border-t border-border text-center">
                <button onClick={loadMore}
                  className="px-4 py-2 rounded-lg text-xs font-semibold border border-border text-muted-foreground hover:text-foreground hover:bg-muted">
                  Load more
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default DocumentArchivePanel;
