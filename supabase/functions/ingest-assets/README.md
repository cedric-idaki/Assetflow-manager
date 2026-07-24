# Website → Ararat sync (`ingest-assets`)

Lets a client's own website push its inventory straight into the Ararat
**Assets** tab. Items added / edited / sold on the site appear in Ararat
within seconds — no manual re-entry. **Works for any asset type**: vehicles,
property, electronics, furniture, heavy equipment, etc.

## How it fits together

```
Client website  ──POST item JSON──▶  ingest-assets Edge Function  ──▶  public.assets
   (x-api-key)                       (verifies key → tenant)           (that client's tenant)
```

* **Auth:** a per-client API key in the `x-api-key` header (not a Supabase JWT —
  the caller is a website). The admin generates it in Ararat via
  **Assets & Clients → Website Sync → Generate key**. Only a SHA-256 hash is
  stored; the plaintext is shown once.
* **Idempotent:** upsert is keyed on `(admin_id, external_ref)`. Re-sending the
  same item (same `external_ref`) **updates** it — no duplicates.
* **Tenant-safe:** the key resolves to exactly one client; imported items are
  stamped with that client's `admin_id`, isolated exactly like manual assets.

## Endpoint

```
POST https://<project-ref>.supabase.co/functions/v1/ingest-assets
Headers:
  x-api-key: afk_...        (the client's key)
  Content-Type: application/json
```

The exact URL is shown in the **Website Sync** dialog.

## Payload — generic contract

Send **one item**, an **array**, or `{ "items": [ … ] }` (max 500 per request).
Only two fields are ever required; **everything else is optional** and
type-specific details go in a free-form `attributes` object.

| Field | Required | Aliases | Notes |
|-------|----------|---------|-------|
| `external_ref` | ✅ | `id`, `sku`, `listing_id`, `serial`, `vin` | Your own stable id. The upsert key. |
| `price` | ✅ | `selling_price`, `amount` | Number > 0. |
| `name` | — | `title`, `description` | Display name. Auto-built if omitted. |
| `type` | — | `asset_type`, `category` | Overrides the key's default type. Enum-safe (see below). |
| `location` | — | `city`, `town`, `address` | |
| `images` | — | `photos`, `image`, `image_url` | Array of URLs (or `{url}`), max 20. |
| `url` | — | `link`, `permalink` | Link back to the listing. |
| `attributes` | — | — | **Free-form object** — put anything here (bedrooms, mileage, warranty, dimensions…). It's stored and shown on the asset. |
| `sold` | — | `is_sold`, `status:"sold"` | Marks the item sold in Ararat. |

Type is clamped to the valid set — `vehicle`, `property`, `equipment`,
`electronics`, `furnitures`, `heavy_equipment`, `construction_dealers`, `other`
(common synonyms like `car`, `house`, `land` are mapped). Unknown → the key's
default type. **Status is one-way:** a normal sync never flips an item back to
*available*; once a deal starts in Ararat it owns the status. Only explicit
`"sold": true` propagates.

### Examples (same endpoint, any product)

```jsonc
// Car dealer
{ "external_ref": "car-4821", "type": "vehicle", "price": 8500000,
  "name": "2022 Toyota Land Cruiser",
  "attributes": { "make": "Toyota", "model": "Land Cruiser", "year": 2022,
                  "mileage": 45000, "fuel": "Diesel", "transmission": "Automatic" } }

// Real-estate agency
{ "external_ref": "plot-77", "type": "property", "price": 3200000,
  "name": "1/8 Acre — Kitengela", "location": "Kajiado",
  "attributes": { "size": "0.125 acre", "title_deed": "ready" } }

// Electronics shop
{ "external_ref": "SKU-LP-19", "type": "electronics", "price": 95000,
  "name": "Dell XPS 13",
  "attributes": { "ram": "16GB", "storage": "512GB SSD", "warranty": "1 year" } }
```

### Response

```json
{ "ok": true, "summary": { "received": 3, "created": 2, "updated": 1, "skipped": 0 }, "errors": [] }
```

## Connecting ANY website — three transports

Because the endpoint is just an HTTP POST of JSON, every platform can reach it.
Pick whichever the client can support — they all feed the same endpoint:

1. **Push (best, real-time)** — the site fires on change and POSTs the item.
   Works anywhere you can add code or an automation:
   - **WooCommerce:** `add_action('save_post_product', …)` → `wp_remote_post(...)`.
   - **Shopify:** a `products/create` / `products/update` webhook → a tiny relay
     (Worker/Cloud Function) that maps the product and forwards it.
   - **Custom site:** call the endpoint in the same code that saves a listing.
   - **No-code:** Zapier / Make "on new/updated product → POST webhook".

2. **Pull (for sites that can't push)** — the client gives us ONE feed URL their
   platform already exposes (product feed, REST API, sitemap, or a CSV export
   URL). A scheduled job fetches it periodically and forwards to this endpoint.
   Requires nothing special from their site — just a readable list of products.

3. **Manual CSV (zero-tech fallback, built-in)** — in **Website Sync → Import a
   spreadsheet (CSV)**, the admin uploads a CSV export; it's parsed in the
   browser and POSTed to this same endpoint authenticated by the logged-in
   session (no API key needed). Header row needs at least an `id`/`sku` and
   `price`; unrecognised columns become `attributes`. Works even if the client
   has no developer and no API.

**Recommendation:** offer Push first; for clients who can't, Pull (a feed URL) or
CSV upload covers everyone regardless of platform.

### Plain cURL

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/ingest-assets" \
  -H "x-api-key: afk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "external_ref": "SKU-1", "name": "Sample", "type": "other", "price": 1000 }'
```

## Deploy

```bash
supabase db query --linked -f supabase/migrations/20260721100000_asset_ingest_api.sql
supabase db query --linked -f supabase/migrations/20260721100500_extend_asset_type_enum.sql
supabase functions deploy ingest-assets
```

`SERVICE_ROLE_KEY` and `SUPABASE_URL` must already be set as function secrets
(they are — the other functions use them).
