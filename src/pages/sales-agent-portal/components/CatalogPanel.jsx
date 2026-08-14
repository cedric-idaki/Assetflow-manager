import React, { useState, useMemo } from 'react';
import Icon from '../../../components/AppIcon';
import Image from '../../../components/AppImage';
import { firstImage } from '../../../hooks/useAgentCatalog';
import { formatPrice, listingUrl, copyText, revokeShareLink } from '../../../services/shareLinkService';

const TYPE_LABEL = {
  property:             'Property',
  vehicle:              'Vehicle',
  equipment:            'Equipment',
  heavy_equipment:      'Heavy equipment',
  electronics:          'Electronics',
  furnitures:           'Furniture',
  construction_dealers: 'Construction',
  other:                'Other',
};

const relativeDay = (d) => {
  if (!d) return '';
  const days = Math.round((Date.now() - new Date(d)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

// ── One item in the catalogue ────────────────────────────────────────────────
const CatalogCard = ({ asset, links = [], onShare }) => {
  const cover   = firstImage(asset);
  const price   = formatPrice(asset.selling_price);
  const views   = links.reduce((s, l) => s + (l.view_count || 0), 0);
  const asks    = links.reduce((s, l) => s + (l.enquiry_count || 0), 0);
  const shared  = links.length > 0;

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-background hover:border-primary/40 transition-colors flex flex-col">
      <div className="relative h-32 bg-muted flex items-center justify-center">
        {cover ? (
          <Image src={cover} alt={asset.description} className="w-full h-full object-cover" />
        ) : (
          <Icon name="Package" size={26} color="var(--color-muted-foreground)" />
        )}
        {asset.asset_status === 'reserved' && (
          <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500 text-white">
            Reserved
          </span>
        )}
        {shared && (
          <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-xs font-semibold bg-black/60 text-white">
            {views} view{views === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="p-3 flex-1 flex flex-col">
        <p className="text-sm font-semibold text-foreground line-clamp-2" title={asset.description}>
          {asset.description}
        </p>
        <p className="mt-1 text-xs text-muted-foreground truncate">
          {[TYPE_LABEL[asset.asset_type] || 'Item', asset.location].filter(Boolean).join(' · ')}
        </p>
        {price && <p className="mt-1.5 text-sm font-bold text-emerald-600">{price}</p>}

        {shared && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            {links.length} link{links.length === 1 ? '' : 's'} out
            {asks > 0 && <span className="text-emerald-600 font-semibold"> · {asks} enquiry{asks === 1 ? '' : 's'}</span>}
          </p>
        )}

        <button
          onClick={() => onShare(asset)}
          className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
        >
          <Icon name="Share2" size={14} color="white" />
          Share
        </button>
      </div>
    </div>
  );
};

// ── One link the agent has already sent ──────────────────────────────────────
const LinkRow = ({ link, onRevoked, onNotify }) => {
  const [busy, setBusy] = useState(false);
  const url    = listingUrl(link.token);
  const views  = link.view_count || 0;
  const asks   = link.enquiry_count || 0;
  const dead   = !link.is_active || (link.expires_at && new Date(link.expires_at) < new Date());
  const to     = link.recipient_name || link.recipient_phone || link.recipient_email || 'Anyone with the link';

  const copy = async () => {
    const ok = await copyText(url);
    onNotify?.(ok ? 'Link copied.' : 'Could not copy the link.', ok ? 'success' : 'error');
  };

  const revoke = async () => {
    setBusy(true);
    try {
      await revokeShareLink(link.id);
      onNotify?.('Link withdrawn — it will not open again.');
      onRevoked?.();
    } catch (err) {
      onNotify?.(err?.message || 'Could not withdraw the link.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${
      dead ? 'border-border bg-muted/30 opacity-60' : 'border-border bg-background'
    }`}>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
        asks > 0 ? 'bg-emerald-500/10' : views > 0 ? 'bg-blue-500/10' : 'bg-muted'
      }`}>
        <Icon
          name={asks > 0 ? 'MessageSquare' : views > 0 ? 'Eye' : 'Link'}
          size={14}
          color={asks > 0 ? '#059669' : views > 0 ? '#1a56db' : 'var(--color-muted-foreground)'}
        />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground truncate">
          {link.asset?.description || 'Listing'}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          To {to} · {relativeDay(link.created_at)}
          {dead && ' · withdrawn'}
        </p>
      </div>

      <div className="hidden sm:flex items-center gap-3 text-xs flex-shrink-0">
        <span className="text-muted-foreground" title="Views">
          <Icon name="Eye" size={12} color="currentColor" /> {views}
        </span>
        <span className={asks > 0 ? 'text-emerald-600 font-semibold' : 'text-muted-foreground'} title="Enquiries">
          <Icon name="MessageSquare" size={12} color="currentColor" /> {asks}
        </span>
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={copy}
          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
          title="Copy link"
        >
          <Icon name="Copy" size={14} color="currentColor" />
        </button>
        {!dead && (
          <button
            onClick={revoke}
            disabled={busy}
            className="p-1.5 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-600 disabled:opacity-40"
            title="Withdraw link"
          >
            <Icon name="Ban" size={14} color="currentColor" />
          </button>
        )}
      </div>
    </div>
  );
};

// ── The panel ────────────────────────────────────────────────────────────────
const CatalogPanel = ({
  assets = [],
  links = [],
  linksByAsset = {},
  stats,
  loading,
  error,
  onShare,
  onRefresh,
  onNotify,
}) => {
  const [tab, setTab]       = useState('catalog');   // 'catalog' | 'links'
  const [query, setQuery]   = useState('');
  const [type, setType]     = useState('all');

  const types = useMemo(() => {
    const found = new Set((assets || []).map(a => a.asset_type).filter(Boolean));
    return ['all', ...Array.from(found)];
  }, [assets]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (assets || []).filter(a => {
      if (type !== 'all' && a.asset_type !== type) return false;
      if (!q) return true;
      return [a.description, a.location, a.asset_code, a.make, a.model]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(q));
    });
  }, [assets, query, type]);

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-base font-semibold text-foreground">What You Can Sell</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Send a buyer a link — anything they ask through it lands as your lead
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-border overflow-hidden">
            <button
              onClick={() => setTab('catalog')}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                tab === 'catalog' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'
              }`}
            >
              Catalogue
            </button>
            <button
              onClick={() => setTab('links')}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                tab === 'links' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'
              }`}
            >
              Sent links
              {stats?.activeLinks > 0 && (
                <span className="ml-1.5 opacity-70">{stats.activeLinks}</span>
              )}
            </button>
          </div>
          <button
            onClick={onRefresh}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
            title="Refresh"
          >
            <Icon name="RefreshCw" size={14} color="currentColor" />
          </button>
        </div>
      </div>

      {/* Stats strip — the reason the feature exists, in four numbers. */}
      {stats?.linksShared > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          {[
            { label: 'Links sent',  value: stats.linksShared,     colour: 'text-foreground' },
            { label: 'Views',       value: stats.totalViews,      colour: 'text-blue-600' },
            { label: 'Enquiries',   value: stats.totalEnquiries,  colour: 'text-emerald-600' },
            { label: 'Seen, no ask', value: stats.viewedNoEnquiry, colour: 'text-amber-600' },
          ].map(s => (
            <div key={s.label} className="px-3 py-2 rounded-xl bg-muted/40 border border-border">
              <p className={`text-lg font-bold ${s.colour}`}>{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 px-3 py-2.5 mb-3 rounded-xl bg-red-50 border border-red-200">
          <Icon name="AlertCircle" size={15} color="#dc2626" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      {/* ── Catalogue ── */}
      {tab === 'catalog' && (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            <div className="relative flex-1 min-w-[180px]">
              <span className="absolute left-3 top-1/2 -translate-y-1/2">
                <Icon name="Search" size={14} color="var(--color-muted-foreground)" />
              </span>
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search the catalogue…"
                className="w-full pl-9 pr-3 py-2 text-sm bg-background border border-border rounded-xl text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            {types.length > 2 && (
              <select
                value={type}
                onChange={e => setType(e.target.value)}
                className="px-3 py-2 text-sm bg-background border border-border rounded-xl text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {types.map(t => (
                  <option key={t} value={t}>{t === 'all' ? 'All types' : (TYPE_LABEL[t] || t)}</option>
                ))}
              </select>
            )}
          </div>

          {loading ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="animate-pulse">
                  <div className="h-32 bg-muted rounded-t-xl" />
                  <div className="h-24 bg-muted/40 rounded-b-xl" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10">
              <Icon name="PackageSearch" size={30} color="var(--color-muted-foreground)" />
              <p className="mt-2 text-sm font-medium text-foreground">
                {assets.length === 0 ? 'Nothing in the catalogue yet' : 'Nothing matches that'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {assets.length === 0
                  ? 'Items appear here once your admin registers them or syncs them from the website.'
                  : 'Try a different search or type.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {filtered.map(asset => (
                <CatalogCard
                  key={asset.id}
                  asset={asset}
                  links={linksByAsset[asset.id] || []}
                  onShare={onShare}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Sent links ── */}
      {tab === 'links' && (
        loading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-muted rounded-xl animate-pulse" />)}
          </div>
        ) : links.length === 0 ? (
          <div className="text-center py-10">
            <Icon name="Link" size={30} color="var(--color-muted-foreground)" />
            <p className="mt-2 text-sm font-medium text-foreground">You have not sent any links yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Share something from the catalogue and it will show up here with its views and enquiries.
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {links.map(link => (
              <LinkRow key={link.id} link={link} onRevoked={onRefresh} onNotify={onNotify} />
            ))}
          </div>
        )
      )}
    </div>
  );
};

export default CatalogPanel;
