import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import { supabase } from '../../../lib/supabase';

// Resolve the project's Functions base URL from the same env var the rest of the
// app uses (it may be a bare project ref or a full https URL).
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  ? import.meta.env.VITE_SUPABASE_URL.startsWith('http')
    ? import.meta.env.VITE_SUPABASE_URL
    : `https://${import.meta.env.VITE_SUPABASE_URL}.supabase.co`
  : '';
const ENDPOINT = `${supabaseUrl}/functions/v1/ingest-assets`;

// Generic example — `attributes` is a free-form bag, so it works for any product
// (a car sends mileage/fuel, a house sends bedrooms/size, a laptop sends ram…).
const SAMPLE_PAYLOAD = `{
  "external_ref": "SKU-4821",
  "name": "3-Bedroom Apartment — Westlands",
  "type": "property",
  "price": 8500000,
  "location": "Nairobi",
  "images": ["https://your-site.com/listing/4821-1.jpg"],
  "url": "https://your-site.com/listing/4821",
  "attributes": {
    "bedrooms": 3,
    "size": "120 sqm",
    "title_deed": "available"
  }
}`;

// ── CSV parsing (RFC-4180-ish: handles quotes, embedded commas/newlines) ──────
function parseCsv(text) {
  const rows = [];
  let field = '', row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); field = ''; row = []; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => (c || '').trim() !== ''));
}

// Header aliases → canonical field. Anything unmatched becomes an `attributes` key.
const HEADER_MAP = {
  external_ref: ['external_ref', 'id', 'sku', 'ref', 'listing_id', 'serial', 'serial_number', 'vin', 'stock_number', 'stock'],
  name:         ['name', 'title', 'description', 'item'],
  price:        ['price', 'selling_price', 'amount', 'cost', 'asking_price'],
  type:         ['type', 'asset_type', 'category'],
  location:     ['location', 'city', 'town', 'address'],
  images:       ['images', 'image', 'image_url', 'photo', 'photos', 'picture'],
  url:          ['url', 'link', 'permalink'],
};
function canonicalField(header) {
  const h = (header || '').trim().toLowerCase();
  for (const [field, aliases] of Object.entries(HEADER_MAP)) if (aliases.includes(h)) return field;
  return null;
}

// CSV rows → the endpoint's item objects.
function rowsToItems(rows) {
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map(cells => {
    const item = {}; const attributes = {};
    headers.forEach((header, i) => {
      const val = (cells[i] ?? '').trim();
      if (val === '') return;
      const field = canonicalField(header);
      if (field === 'images') item.images = val.split(/[|;]/).map(s => s.trim()).filter(Boolean);
      else if (field) item[field] = val;
      else attributes[(header || '').trim()] = val;
    });
    if (Object.keys(attributes).length) item.attributes = attributes;
    return item;
  }).filter(it => it.external_ref || it.price);
}

// Small copy-to-clipboard button with transient "Copied" feedback.
const CopyButton = ({ text, label = 'Copy' }) => {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch { /* clipboard blocked — user can select manually */ }
  };
  return (
    <button type="button" onClick={copy}
      className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
      <Icon name={done ? 'Check' : 'Copy'} size={12} color="currentColor" />
      {done ? 'Copied' : label}
    </button>
  );
};

const WebsiteSyncModal = ({ onClose, assetTypes = [] }) => {
  // Default asset type applied to items synced with each key — set per client to
  // whatever they sell. Falls back to a sensible generic list.
  const typeOptions = (assetTypes.length > 0 ? assetTypes : [
    { value: 'vehicle', label: 'Vehicle' },
    { value: 'property', label: 'Property / Land' },
    { value: 'electronics', label: 'Electronics' },
    { value: 'furnitures', label: 'Furniture' },
    { value: 'heavy_equipment', label: 'Heavy Equipment' },
    { value: 'construction_dealers', label: 'Construction Materials' },
    { value: 'equipment', label: 'Equipment' },
    { value: 'other', label: 'Other' },
  ]).filter(t => t.value && t.value !== 'all');

  const [keys, setKeys]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [label, setLabel]         = useState('');
  const [defaultType, setDefaultType] = useState(typeOptions[0]?.value || 'other');
  const [generating, setGenerating] = useState(false);
  const [newKey, setNewKey]       = useState(null);   // plaintext, shown once
  const [error, setError]         = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    const { data, error: e } = await supabase
      .from('asset_ingest_keys')
      .select('id, label, key_prefix, is_active, last_used_at, created_at')
      .order('created_at', { ascending: false });
    if (e) setError(e.message);
    setKeys(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadKeys(); }, [loadKeys]);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    const { data, error: e } = await supabase.rpc('create_asset_ingest_key', {
      p_label: label.trim() || 'Website',
      p_default_asset_type: defaultType,
      p_default_status: 'available',
    });
    setGenerating(false);
    if (e) { setError(e.message); return; }
    const row = Array.isArray(data) ? data[0] : data;
    setNewKey(row?.api_key || null);
    setLabel('');
    await loadKeys();
  };

  const revoke = async (id) => {
    setError(null);
    const { error: e } = await supabase.rpc('revoke_asset_ingest_key', { p_id: id });
    if (e) { setError(e.message); return; }
    await loadKeys();
  };

  // CSV upload — parse client-side, then POST to the same endpoint using the
  // logged-in session (no API key needed). One code path with website sync.
  const importCsv = async (file) => {
    if (!file) return;
    setImporting(true); setError(null); setImportResult(null);
    try {
      const text = await file.text();
      const items = rowsToItems(parseCsv(text));
      if (items.length === 0) throw new Error('No rows found. Ensure the first line is a header row with at least an id/sku and price column.');

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('No active session.');

      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ items }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out?.error || 'Import failed.');
      setImportResult(out.summary);
    } catch (e) {
      setError(e.message);
    } finally {
      setImporting(false);
    }
  };

  const curlSample = `curl -X POST "${ENDPOINT}" \\
  -H "x-api-key: ${newKey || 'YOUR_API_KEY'}" \\
  -H "Content-Type: application/json" \\
  -d '${SAMPLE_PAYLOAD}'`;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[120] flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Icon name="Globe" size={18} color="#1A56DB" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Website Sync</h2>
              <p className="text-xs text-muted-foreground">Push assets from your website into Ararat automatically</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <Icon name="X" size={18} color="var(--color-muted-foreground)" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 text-sm">
              <Icon name="AlertCircle" size={16} color="currentColor" />
              <span>{error}</span>
            </div>
          )}

          {/* How it works */}
          <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800">
            <Icon name="Info" size={14} color="#1A56DB" />
            <p>
              Give your web developer the endpoint and an API key below. Whenever an item is added,
              updated, or sold on your website, have it POST the item's details here — it appears in
              your Assets list within seconds. Works for any product type. Re-sending the same item
              (same <code>external_ref</code>) updates it instead of creating a duplicate.
            </p>
          </div>

          {/* Endpoint */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-bold text-foreground uppercase tracking-wide">Endpoint URL</p>
              <CopyButton text={ENDPOINT} />
            </div>
            <code className="block bg-muted rounded-xl px-3 py-2.5 text-xs text-foreground break-all">{ENDPOINT}</code>
          </div>

          {/* Newly generated key (shown once) */}
          {newKey && (
            <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Icon name="KeyRound" size={14} color="#059669" />
                <p className="text-xs font-bold text-emerald-800 uppercase tracking-wide">Your new API key — copy it now</p>
              </div>
              <p className="text-xs text-emerald-700">
                This is the only time the full key is shown. Store it somewhere safe; if you lose it, revoke it and generate a new one.
              </p>
              <div className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-emerald-200">
                <code className="flex-1 text-xs text-foreground break-all">{newKey}</code>
                <CopyButton text={newKey} />
              </div>
            </div>
          )}

          {/* Generate a key */}
          <div>
            <p className="text-xs font-bold text-foreground uppercase tracking-wide mb-2">API Keys</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-40">
                <Input label="Label (optional)" placeholder="e.g. Main website"
                  value={label} onChange={e => setLabel(e.target.value)} />
              </div>
              <div className="w-44">
                <Select label="Default asset type" value={defaultType}
                  onChange={e => setDefaultType(e.target.value)} options={typeOptions} />
              </div>
              <Button variant="primary" size="sm" onClick={generate} disabled={generating}>
                <Icon name="Plus" size={14} color="white" />
                {generating ? 'Generating…' : 'Generate key'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Items synced with this key default to this type (each item can override it with a <code>type</code> field).
            </p>

            {/* Existing keys */}
            <div className="mt-3 space-y-2">
              {loading ? (
                <div className="h-10 rounded-xl bg-muted animate-pulse" />
              ) : keys.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">No keys yet. Generate one to connect your website.</p>
              ) : keys.map(k => (
                <div key={k.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border bg-background">
                  <Icon name="KeyRound" size={14} color={k.is_active ? '#1A56DB' : '#9ca3af'} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {k.label || 'Website'} <span className="text-xs text-muted-foreground font-mono">· {k.key_prefix}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {k.is_active ? 'Active' : 'Revoked'}
                      {k.last_used_at ? ` · last used ${new Date(k.last_used_at).toLocaleString()}` : ' · never used'}
                    </p>
                  </div>
                  {k.is_active && (
                    <button onClick={() => revoke(k.id)}
                      className="text-xs font-medium text-red-600 hover:underline flex items-center gap-1">
                      <Icon name="Ban" size={12} color="currentColor" /> Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* CSV upload — universal, no-website-needed path */}
          <div className="rounded-xl border border-border bg-muted/40 p-4">
            <div className="flex items-center gap-2 mb-1">
              <Icon name="FileSpreadsheet" size={14} color="#1A56DB" />
              <p className="text-xs font-bold text-foreground uppercase tracking-wide">Or import a spreadsheet (CSV)</p>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              No website integration needed. Upload a CSV with a header row — an <code>id</code>/<code>sku</code> and
              <code> price</code> column are required; <code>name</code>, <code>type</code>, <code>location</code>,
              <code> image</code>, <code>url</code> are recognised, and any other columns are saved as attributes.
              Re-uploading updates existing rows (matched on id).
            </p>
            <div className="flex items-center gap-3">
              <label className={`inline-flex items-center gap-2 px-3 h-8 rounded-lg text-sm font-medium cursor-pointer border border-border bg-background hover:bg-muted ${importing ? 'opacity-50 pointer-events-none' : ''}`}>
                <Icon name="Upload" size={14} color="currentColor" />
                {importing ? 'Importing…' : 'Choose CSV file'}
                <input type="file" accept=".csv,text/csv" className="hidden"
                  onChange={e => { importCsv(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              {importResult && (
                <span className="text-xs font-medium text-emerald-600">
                  {importResult.created} added · {importResult.updated} updated
                  {importResult.skipped ? ` · ${importResult.skipped} skipped` : ''}
                </span>
              )}
            </div>
          </div>

          {/* Sample request */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-bold text-foreground uppercase tracking-wide">Sample request (for your developer)</p>
              <CopyButton text={curlSample} label="Copy cURL" />
            </div>
            <pre className="bg-muted rounded-xl px-3 py-2.5 text-xs text-foreground overflow-x-auto whitespace-pre">{curlSample}</pre>
            <p className="text-xs text-muted-foreground mt-2">
              Required per item: <code>external_ref</code> (your listing id / SKU) and <code>price</code>. Everything else is optional —
              put any type-specific details (bedrooms, mileage, warranty…) in <code>attributes</code>.
              Send one item, an array, or <code>{'{ "items": [ … ] }'}</code>. Mark an item sold with <code>"sold": true</code>.
            </p>
          </div>

        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-4 border-t border-border flex-shrink-0 bg-card">
          <Button variant="outline" onClick={onClose}>Done</Button>
        </div>

      </div>
    </div>
  );
};

export default WebsiteSyncModal;
