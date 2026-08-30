/**
 * ASSET REGISTER — what the SACCO owns.
 *
 * The register a treasurer opens to answer four questions, in this order:
 * what do we own, what is it worth, where is it, and can we prove it. The
 * layout follows that order rather than the table's column order.
 *
 * TOTALS COME FROM THE SERVER, NOT FROM THE TABLE. The KPI row reads
 * sacco_asset_register_summary(), which aggregates the whole register in
 * Postgres, while the table below shows one page. Summing the rows on screen
 * would give a total of the page — a figure that shrinks when you filter and
 * changes when you turn the page, which is the single most dangerous number a
 * financial screen can show. Same rule as the sacco dashboard's stats RPC.
 *
 * The default filter is "in the SACCO's hands", not "everything". A register
 * that opens on a list dominated by vehicles sold in 2019 is a register nobody
 * uses; the disposed assets are one click away and never deleted.
 */
import React, { useMemo, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import Pagination from '../../../../components/ui/Pagination';
import { useToast } from '../../../../components/Toast';
import { downloadCSV } from '../../../../utils/exportUtils';
import { useAssetRegister, SORT_OPTIONS } from '../../../../hooks/useAssetRegister';
import {
  ASSET_CATEGORIES, ASSET_STATUSES, categoryMeta,
  bookValue, reportedValue, buildAssetExport, ASSET_EXPORT_COLUMNS,
} from '../../../../config/assetRegister';
import {
  KES, fmtDate, Card, StatCard, Table, EmptyState, GhostButton, PrimaryButton, TextInput, Select,
} from '../_shared';
import AssetFormModal from './AssetFormModal';
import AssetDrawer, { StatusPill } from './AssetDrawer';

const Sk = ({ className = '' }) => <div className={`animate-pulse bg-muted rounded-lg ${className}`} />;

/**
 * The category breakdown, as a bar per category.
 *
 * Reads summary.byCategory — the server's aggregate over the whole register —
 * so it is a picture of everything owned, not of the twenty-five rows below it.
 */
const CategoryBreakdown = ({ byCategory }) => {
  const rows = useMemo(() => ASSET_CATEGORIES
    .map((c) => ({ ...c, ...(byCategory?.[c.value] || { count: 0, cost: 0, value: 0 }) }))
    .filter((c) => Number(c.count) > 0)
    .sort((a, b) => Number(b.value) - Number(a.value)),
  [byCategory]);

  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground py-4 text-center">Nothing registered yet.</p>;
  }

  const max = Math.max(...rows.map((r) => Number(r.value) || 0), 1);

  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.value}>
          <div className="flex items-center justify-between gap-3 mb-1">
            <span className="flex items-center gap-1.5 text-xs text-foreground">
              <Icon name={r.icon} size={13} color="#1da8c5" />
              {r.label}
              <span className="text-muted-foreground">· {r.count}</span>
            </span>
            <span className="font-mono text-xs text-foreground">{KES(r.value)}</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(Number(r.value) / max) * 100}%`, background: '#34c1dd' }} />
          </div>
        </div>
      ))}
    </div>
  );
};

const AssetRow = ({ asset, onOpen }) => {
  const cat = categoryMeta(asset.category);
  const reported = reportedValue(asset);

  return (
    <tr
      className="border-b border-border last:border-0 hover:bg-muted/50 cursor-pointer transition-colors"
      onClick={() => onOpen(asset)}
    >
      <td className="py-2.5 pr-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(52,193,221,0.12)' }}>
            <Icon name={cat.icon} size={15} color="#1da8c5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm text-foreground truncate max-w-[220px]">{asset.asset_name}</p>
            <p className="font-mono text-[11px] text-muted-foreground">{asset.asset_tag}</p>
          </div>
        </div>
      </td>
      <td className="py-2.5 pr-4 text-xs text-muted-foreground whitespace-nowrap">{cat.label}</td>
      <td className="py-2.5 pr-4 text-xs text-foreground max-w-[160px] truncate">{asset.location || '—'}</td>
      <td className="py-2.5 pr-4 text-xs whitespace-nowrap">{fmtDate(asset.acquisition_date)}</td>
      <td className="py-2.5 pr-4 font-mono text-xs text-right whitespace-nowrap">{KES(asset.cost)}</td>
      <td className="py-2.5 pr-4 font-mono text-xs text-right whitespace-nowrap text-muted-foreground">{KES(bookValue(asset))}</td>
      <td className="py-2.5 pr-4 text-right whitespace-nowrap">
        <span className="font-mono text-xs font-semibold text-foreground">{KES(reported.value)}</span>
        {/* Which number this is matters more than the number. A recorded
            valuation and a fallback to book value must never look identical. */}
        <span className="block text-[10px] text-muted-foreground">
          {reported.basis === 'valuation' ? 'valued' : 'book value'}
        </span>
      </td>
      <td className="py-2.5 pr-4"><StatusPill status={asset.status} /></td>
      <td className="py-2.5 text-right">
        <Icon name="ChevronRight" size={15} color="currentColor" className="text-muted-foreground" />
      </td>
    </tr>
  );
};

const AssetRegisterTab = ({ ctx }) => {
  const toast = useToast();
  const { sacco } = ctx;

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('active');
  const [sort, setSort] = useState('acquisition_date');

  const register = useAssetRegister(sacco, { search, category, status, sort });
  const { summary, summaryLoading, pager } = register;

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(null);
  const [exporting, setExporting] = useState(false);

  const openNew = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (asset) => { setEditing(asset); setSelected(null); setFormOpen(true); };

  const save = async (form, { postPurchase }) => {
    setSaving(true);
    try {
      if (editing) {
        await register.updateAsset(editing.id, form);
        toast.success('Asset updated.');
      } else {
        const { asset, posted } = await register.createAsset(form, { postPurchase });
        if (posted?.ok) {
          toast.success(`${asset.asset_tag} registered, and the purchase posted to the ledger.`);
        } else if (posted && !posted.ok) {
          // Registered but not posted. Said out loud rather than swallowed —
          // a treasurer who ticked the box needs to know the journal is missing.
          toast.warning(posted.reason, `${asset.asset_tag} registered, but the purchase was not posted`);
        } else {
          toast.success(`${asset.asset_tag} added to the register.`);
        }
      }
      setFormOpen(false);
      setEditing(null);
    } catch (e) {
      toast.error(e.message, editing ? 'Could not save the asset' : 'Could not register the asset');
    } finally {
      setSaving(false);
    }
  };

  const exportRegister = async () => {
    setExporting(true);
    try {
      // Every asset the tenant owns, not the page on screen — see the hook.
      const all = await register.fetchAllForExport();
      if (all.length === 0) { toast.error('There is nothing to export yet.'); return; }
      downloadCSV(buildAssetExport(all), `asset-register-${new Date().toISOString().slice(0, 10)}`, ASSET_EXPORT_COLUMNS);
      toast.success(`Exported ${all.length} asset${all.length === 1 ? '' : 's'}.`);
    } catch (e) {
      toast.error(e.message, 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const filtered = category !== 'all' || status !== 'active' || search.trim();

  return (
    <div className="space-y-5">
      {/* Whole-register totals */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryLoading ? [1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-card border border-border rounded-xl p-5 space-y-3">
            <Sk className="h-4 w-24" /><Sk className="h-8 w-32" /><Sk className="h-3 w-20" />
          </div>
        )) : <>
          <StatCard
            label="Assets held" value={summary.inService + summary.needsAttention} icon="Package"
            hint={summary.disposed > 0 ? `${summary.disposed} disposed or written off` : 'None disposed'}
          />
          <StatCard
            label="At cost" value={KES(summary.totalCost)} icon="Receipt" tone="muted"
            hint="What was paid, across everything still held"
          />
          <StatCard
            label="Net book value" value={KES(summary.totalBookValue)} icon="TrendingDown" tone="warning"
            hint={`Less ${KES(summary.totalDepreciation)} depreciation`}
          />
          <StatCard
            label="Current value" value={KES(summary.totalCurrentValue)} icon="LineChart" tone="success"
            hint={summary.valuedAssets > 0
              ? `${summary.valuedAssets} valued; the rest at book value`
              : 'Nothing valued yet — this is book value'}
          />
        </>}
      </div>

      {/* Things the register knows are wrong. Shown as one line rather than a
          banner per problem: a register nags once, or it gets ignored. */}
      {!summaryLoading && (summary.undocumented > 0 || summary.expiringDocuments > 0 || summary.needsAttention > 0) && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 p-3 rounded-xl bg-amber-50 border border-amber-200">
          <Icon name="AlertTriangle" size={16} color="#ca8a04" />
          {summary.undocumented > 0 && (
            <span className="text-xs text-amber-800">
              <strong>{summary.undocumented}</strong> asset{summary.undocumented === 1 ? ' has' : 's have'} no supporting document
            </span>
          )}
          {summary.expiringDocuments > 0 && (
            <span className="text-xs text-amber-800">
              <strong>{summary.expiringDocuments}</strong> document{summary.expiringDocuments === 1 ? '' : 's'} expired or expiring within 60 days
            </span>
          )}
          {summary.needsAttention > 0 && (
            <span className="text-xs text-amber-800">
              <strong>{summary.needsAttention}</strong> under maintenance or impaired
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <Card
            title="Asset register"
            subtitle={`${summary.totalAssets} record${summary.totalAssets === 1 ? '' : 's'} · the same register the Balance Sheet and the depreciation job read`}
            actions={<div className="flex items-center gap-2">
              <GhostButton icon="Download" onClick={exportRegister} disabled={exporting}>
                {exporting ? 'Exporting…' : 'Export'}
              </GhostButton>
              <PrimaryButton icon="Plus" onClick={openNew}>Register asset</PrimaryButton>
            </div>}
          >
            {/* Filters */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
              <div className="col-span-2 lg:col-span-1 relative">
                <Icon name="Search" size={14} color="currentColor"
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <TextInput
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name, tag, serial, location…"
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:border-primary"
                />
              </div>
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="all">All categories</option>
                {ASSET_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </Select>
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="active">In the SACCO's hands</option>
                <option value="all">Every record</option>
                <option value="disposed">Disposed, written off or lost</option>
                {ASSET_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </Select>
              <Select value={sort} onChange={(e) => setSort(e.target.value)}>
                {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </div>

            {register.error && (
              <div className="flex items-center gap-2 p-3 mb-3 rounded-xl bg-red-50 border border-red-200">
                <Icon name="AlertCircle" size={15} color="#dc2626" />
                <p className="text-xs text-red-700">{register.error}</p>
              </div>
            )}

            {pager.loading && pager.rows.length === 0 ? (
              <div className="space-y-2">{[1, 2, 3, 4, 5].map((i) => <Sk key={i} className="h-12" />)}</div>
            ) : pager.rows.length === 0 ? (
              <EmptyState
                icon="Package"
                title={filtered ? 'Nothing matches those filters' : 'The register is empty'}
                hint={filtered
                  ? 'Widen the search, or switch the status filter to "Every record".'
                  : 'Add the premises, vehicles, computers, furniture and software the SACCO owns. Everything registered here feeds the depreciation job and the Balance Sheet.'}
              />
            ) : (
              <>
                <Table columns={['Asset', 'Category', 'Location', 'Acquired', 'Cost', 'Book value', 'Current value', 'Status', '']}>
                  {pager.rows.map((a) => <AssetRow key={a.id} asset={a} onOpen={setSelected} />)}
                </Table>
                <Pagination
                  page={pager.page}
                  pageCount={pager.pageCount}
                  from={pager.from}
                  to={pager.to}
                  total={pager.total}
                  onPageChange={pager.setPage}
                  loading={pager.loading}
                  noun={filtered ? 'matching assets' : 'assets'}
                />
              </>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="What we own" subtitle="By category, across the whole register">
            {summaryLoading ? <Sk className="h-40" /> : <CategoryBreakdown byCategory={summary.byCategory} />}
          </Card>

          <Card title="Where things stand">
            {summaryLoading ? <Sk className="h-32" /> : (
              <div className="space-y-2">
                {ASSET_STATUSES.map((s) => {
                  const n = Number(summary.byStatus?.[s.value] || 0);
                  if (n === 0) return null;
                  return (
                    <div key={s.value} className="flex items-center justify-between gap-3">
                      <StatusPill status={s.value} />
                      <span className="font-mono text-sm text-foreground">{n}</span>
                    </div>
                  );
                })}
                {Object.keys(summary.byStatus || {}).length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-2">Nothing registered yet.</p>
                )}
              </div>
            )}
          </Card>

          <div className="rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 mb-2">
              <Icon name="Info" size={14} color="#1da8c5" />
              <h4 className="text-xs font-bold uppercase tracking-wide text-foreground">Cost, book value, current value</h4>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              <strong className="text-foreground">Cost</strong> is what was paid and never changes.{' '}
              <strong className="text-foreground">Book value</strong> is cost less the depreciation the period-end job has
              charged — the figure the Balance Sheet defends.{' '}
              <strong className="text-foreground">Current value</strong> is a valuation you record; where none exists the
              register shows book value and says so. Recording a valuation does not post to the ledger — a revaluation is
              an equity movement and needs its own journal.
            </p>
          </div>
        </div>
      </div>

      <AssetFormModal
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        onSave={save}
        editing={editing}
        saving={saving}
        canPost={register.canPost}
      />

      {selected && (
        <AssetDrawer
          asset={pager.rows.find((a) => a.id === selected.id) || selected}
          onClose={() => setSelected(null)}
          onEdit={openEdit}
          register={register}
        />
      )}
    </div>
  );
};

export default AssetRegisterTab;
