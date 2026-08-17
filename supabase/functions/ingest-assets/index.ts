/**
 * Ararat — ingest-assets Edge Function
 * ----------------------------------------------------------------------------
 * Machine-facing door into the Assets tab. A client's own website (or any
 * script / feed / CSV pipeline) POSTs its inventory here and it lands in
 * public.assets — so items added on their site show up in Ararat
 * automatically, no retyping. Works for ANY asset type: vehicles, property,
 * electronics, furniture, heavy equipment, etc.
 *
 * AUTH: a per-client API key in the `x-api-key` header (NOT a Supabase JWT —
 *       the caller is a website, not a logged-in user). We SHA-256 the key and
 *       match it against asset_ingest_keys.key_hash to resolve the tenant.
 *       => config.toml sets verify_jwt = false for this function.
 *
 * IDEMPOTENT: upsert is keyed on (admin_id, external_ref) — the client's own
 *       listing id / SKU / serial. Re-sending the same item UPDATES it.
 *
 * TENANT-SAFE: runs as service_role and sets assets.admin_id explicitly to the
 *       key's owning tenant — the column RLS and every app query filter on.
 *
 * GENERIC CONTRACT — the only universal, required fields are:
 *   external_ref  (your stable listing id / SKU)   +   price
 * Everything else is optional. Type-specific details go in a free-form
 * `attributes` object, so a car sends {mileage, fuel}, a house sends
 * {bedrooms, size}, a laptop sends {ram, warranty} — all captured the same way.
 *
 * BODY: a single item object, an array, or { items:[…] } / { assets:[…] } /
 *       { vehicles:[…] } (max 500 per request).
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// asset_type / asset_status enum-safe sets. Kept in sync with the DB enums
// (base + 20260721100500_extend_asset_type_enum). Unknown values are clamped to
// the key's default so a stray type from a website can never break the insert.
const ASSET_TYPES = [
  'vehicle', 'property', 'equipment', 'other',
  'construction_dealers', 'electronics', 'furnitures', 'heavy_equipment',
];
const ASSET_STATUSES = ['available', 'reserved', 'sold', 'under_maintenance'];

// Loose synonyms → canonical enum value (best-effort convenience only).
const TYPE_SYNONYMS: Record<string, string> = {
  car: 'vehicle', cars: 'vehicle', auto: 'vehicle', motor: 'vehicle', vehicles: 'vehicle',
  house: 'property', home: 'property', land: 'property', plot: 'property', apartment: 'property',
  realestate: 'property', real_estate: 'property', properties: 'property',
  machine: 'equipment', machinery: 'equipment', tools: 'equipment',
  electronic: 'electronics', gadget: 'electronics', gadgets: 'electronics',
  furniture: 'furnitures', heavy: 'heavy_equipment', construction: 'construction_dealers',
};

const pick = (obj: Record<string, unknown>, keys: string[]): unknown => {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return undefined;
};

const toStr = (v: unknown): string => (v === undefined || v === null ? '' : String(v).trim());
const toNum = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = parseFloat(String(v).replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : null;
};

// SHA-256 hex — must match SQL encode(digest(key,'sha256'),'hex').
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Normalise whatever the site sends for images into [{ url }].
function normaliseImages(raw: unknown): Array<{ url: string }> {
  const out: Array<{ url: string }> = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) out.push({ url: v.trim() });
    else if (v && typeof v === 'object') {
      const u = (v as Record<string, unknown>).url ?? (v as Record<string, unknown>).src;
      if (typeof u === 'string' && u.trim()) out.push({ url: u.trim() });
    }
  };
  if (Array.isArray(raw)) raw.forEach(push);
  else if (raw) push(raw);
  return out.slice(0, 20);
}

// Resolve asset_type: explicit value → synonym → key default. Always enum-safe.
function resolveType(raw: unknown, fallback: string): string {
  const t = toStr(raw).toLowerCase().replace(/\s+/g, '_');
  if (!t) return fallback;
  if (ASSET_TYPES.includes(t)) return t;
  if (TYPE_SYNONYMS[t] && ASSET_TYPES.includes(TYPE_SYNONYMS[t])) return TYPE_SYNONYMS[t];
  return fallback;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── 1. Authenticate & resolve the tenant ──────────────────────────────────
  // Two paths feed the same logic:
  //   (a) a website → per-client API key in x-api-key
  //   (b) the dashboard CSV importer → the logged-in admin's JWT (Bearer)
  let adminId: string | null = null;
  let defaultType = 'other';
  let defaultStatus = 'available';

  const apiKey = req.headers.get('x-api-key') || '';
  if (apiKey) {
    const keyHash = await sha256Hex(apiKey);
    const { data: keyRow } = await admin
      .from('asset_ingest_keys')
      .select('id, admin_id, default_asset_type, default_status, is_active')
      .eq('key_hash', keyHash)
      .maybeSingle();

    if (!keyRow || !keyRow.is_active) return json({ error: 'Invalid or revoked API key.' }, 401);

    adminId = keyRow.admin_id;
    defaultType = ASSET_TYPES.includes(keyRow.default_asset_type) ? keyRow.default_asset_type : 'other';
    defaultStatus = ASSET_STATUSES.includes(keyRow.default_status) ? keyRow.default_status : 'available';
    admin.from('asset_ingest_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRow.id).then();
  } else {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return json({ error: 'Provide an x-api-key header or a logged-in session.' }, 401);

    const { data: { user }, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !user) return json({ error: 'Invalid or expired session.' }, 401);

    const { data: profile } = await admin
      .from('user_profiles')
      .select('role, admin_id')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile || profile.role === 'client') {
      return json({ error: 'Forbidden — only staff/admin accounts can import assets.' }, 403);
    }
    // The TENANT that owns the import, not the uploader: staff import into the
    // admin's catalogue. Same COALESCE as public.current_admin_id().
    adminId = (profile.admin_id as string | null) ?? user.id;
  }

  if (!adminId) return json({ error: 'Could not resolve a tenant for this request.' }, 401);

  // ── 2. Parse body into a list of items ────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Body must be valid JSON.' }, 400);
  }
  const asArray = (b: Record<string, unknown>) =>
    (Array.isArray(b.items) ? b.items
      : Array.isArray(b.assets) ? b.assets
      : Array.isArray(b.vehicles) ? b.vehicles
      : Array.isArray(b.products) ? b.products
      : null) as Record<string, unknown>[] | null;

  const items: Record<string, unknown>[] = Array.isArray(body)
    ? (body as Record<string, unknown>[])
    : body && typeof body === 'object'
    ? (asArray(body as Record<string, unknown>) ?? [body as Record<string, unknown>])
    : [];

  if (items.length === 0) return json({ error: 'No items in payload.' }, 400);
  if (items.length > 500) return json({ error: 'Max 500 items per request.' }, 400);

  // ── 3. Upsert each item ───────────────────────────────────────────────────
  let created = 0;
  let updated = 0;
  const errors: Array<{ ref: string; reason: string }> = [];

  for (const it of items) {
    const externalRef = toStr(pick(it, [
      'external_ref', 'externalRef', 'id', 'listing_id', 'listingId',
      'sku', 'ref', 'serial', 'serial_number', 'vin', 'chassis',
    ]));
    if (!externalRef) {
      errors.push({ ref: '(none)', reason: 'Missing external_ref / id — required so re-syncs update instead of duplicating.' });
      continue;
    }

    const price = toNum(pick(it, ['price', 'selling_price', 'sellingPrice', 'amount', 'asking_price']));
    if (price === null || price <= 0) {
      errors.push({ ref: externalRef, reason: 'Missing or invalid price (must be a number > 0).' });
      continue;
    }

    const assetType = resolveType(pick(it, ['asset_type', 'type', 'category']), defaultType);
    const description =
      toStr(pick(it, ['description', 'title', 'name'])) ||
      toStr(pick(it, ['make', 'brand'])) + ' ' + toStr(pick(it, ['model'])) ||
      `Item ${externalRef}`;
    const location = toStr(pick(it, ['location', 'city', 'town', 'address']));
    const images = normaliseImages(pick(it, ['images', 'photos', 'image', 'image_url', 'thumbnail']));
    const specifications = toStr(pick(it, ['specifications', 'specs', 'features', 'summary']));
    const soldFlag = pick(it, ['sold', 'is_sold']) === true || toStr(pick(it, ['status'])).toLowerCase() === 'sold';

    // Optional structured columns the app already has (all optional). Filled
    // from top-level OR from the attributes bag if the client nests them there.
    const attrs: Record<string, unknown> =
      (it.attributes && typeof it.attributes === 'object' ? it.attributes as Record<string, unknown> : {});
    const src = { ...attrs, ...it }; // top-level wins over attributes
    const make = toStr(pick(src, ['make', 'brand', 'manufacturer']));
    const model = toStr(pick(src, ['model']));
    const year = toNum(pick(src, ['year', 'yom', 'manufacture_year']));
    const color = toStr(pick(src, ['color', 'colour']));
    const plate = toStr(pick(src, ['plate', 'plate_number', 'registration', 'number_plate']));
    const chassis = toStr(pick(src, ['chassis', 'chassis_number', 'vin']));
    const propertyType = toStr(pick(src, ['property_type', 'propertyType']));
    const propertySize = toStr(pick(src, ['property_size', 'propertySize', 'size', 'area']));
    const sourceUrl = toStr(pick(it, ['url', 'link', 'permalink', 'source_url']));

    // metadata = provenance + the whole free-form attributes bag (so ANY asset
    // type's details are preserved and shown), minus the columns we lift out.
    const metadata: Record<string, unknown> = {
      import_source: 'website',
      source_ref: externalRef,
      imported_at: new Date().toISOString(),
    };
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== undefined && v !== null && String(v).trim() !== '') metadata[k] = v;
    }
    if (sourceUrl) metadata.source_url = sourceUrl;

    const columns: Record<string, unknown> = {
      asset_type: assetType,
      description,
      selling_price: price,
      current_value: price,
      location,
      images,
      metadata,
      specifications,
      source: 'website',
    };
    // Only set columns that were actually provided, so we don't blank existing
    // data on update with empty strings.
    if (make) columns.make = make;
    if (model) columns.model = model;
    if (year !== null) columns.year = year;
    if (color) columns.color = color;
    if (plate) columns.plate_number = plate;
    if (chassis) columns.chassis_number = chassis;
    if (propertyType) columns.property_type = propertyType;
    if (propertySize) columns.property_size = propertySize;

    try {
      const { data: existing } = await admin
        .from('assets')
        .select('id')
        // Dedupe within the TENANT: two staff members importing the same feed
        // must not create two copies of the same asset.
        .eq('admin_id', adminId)
        .eq('external_ref', externalRef)
        .maybeSingle();

      if (existing) {
        // UPDATE. Status is one-way: a normal sync never flips a row back to
        // "available" — once a deal starts in Ararat it owns the status.
        // Only an explicit sold flag propagates from the website.
        const patch = { ...columns, updated_at: new Date().toISOString() } as Record<string, unknown>;
        if (soldFlag) patch.asset_status = 'sold';
        const { error } = await admin.from('assets').update(patch).eq('id', existing.id);
        if (error) throw error;
        updated++;
      } else {
        const { error } = await admin.from('assets').insert({
          ...columns,
          asset_code: `AST-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          asset_status: soldFlag ? 'sold' : defaultStatus,
          external_ref: externalRef,
          admin_id: adminId,        // tenant owner — what RLS and every query filter on
          registered_by: adminId,   // provenance: who/what put the row here
        });
        if (error) throw error;
        created++;
      }
    } catch (err) {
      errors.push({ ref: externalRef, reason: (err as { message?: string })?.message || 'insert/update failed' });
    }
  }

  return json({
    ok: true,
    summary: { received: items.length, created, updated, skipped: errors.length },
    errors,
  });
});
