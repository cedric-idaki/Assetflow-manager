/**
 * LETTERHEAD — the business identity every document is headed with (pure)
 *
 * A tenant's documents are handed to its customers, members and staff: till
 * receipts, invoices, vouchers, payslips, statements. Each generator used to
 * work out its own header from whatever company row its screen happened to
 * hold, and most of them held nothing — company_profiles is readable only by
 * the tenant owner, so a cashier's receipt fell back to "Ararat".
 *
 * The letterhead is now one record, resolved by public.get_tenant_letterhead()
 * (see src/lib/letterhead.js for the fetch) and shaped here:
 *
 *   {
 *     tenantId, kind,                    whose it is: company | sacco
 *     name, motto,                       how the business names itself
 *     logo: { src, width, height, format } | null
 *                                        a data: URL, already loaded, so a
 *                                        painter can embed it synchronously
 *     registrationNo, kraPin,            the numbers a tax document carries
 *     phone, email, website,
 *     physicalAddress, postalAddress,
 *   }
 *
 * Nothing in this module fetches or draws. It normalises, merges, and renders
 * markup, so what a letterhead SAYS is assertable in a test.
 */

import { html, rawHtml } from './htmlEscape';

const str = (v) => (v === null || v === undefined ? '' : String(v).trim());

/** The fields a letterhead prints, in the order they are merged. */
export const LETTERHEAD_TEXT_FIELDS = [
  'name', 'motto', 'registrationNo', 'kraPin',
  'phone', 'email', 'website', 'physicalAddress', 'postalAddress',
];

/** "https://www.acme.co.ke/" → "www.acme.co.ke" — how a website is printed. */
export const displayWebsite = (url) =>
  str(url).replace(/^https?:\/\//i, '').replace(/\/+$/, '');

/**
 * Only an embedded PNG or JPEG counts as a logo.
 *
 * The HTML documents are written into a window that inherits the app's
 * origin, so a `src` that could be `javascript:` or a remote tracker must
 * never reach them. A data: URL of one of the two formats every renderer here
 * can embed is the only shape accepted.
 */
const LOGO_SRC = /^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=\s]+$/;

export const isUsableLogo = (logo) =>
  Boolean(logo)
  && typeof logo.src === 'string'
  && LOGO_SRC.test(logo.src)
  && Number(logo.width) > 0
  && Number(logo.height) > 0;

const logoFormat = (logo) =>
  (/^data:image\/jpe?g/i.test(logo?.src || '') ? 'JPEG' : 'PNG');

/**
 * Shape any letterhead-like record into the canonical letterhead.
 *
 * Accepts the RPC's snake_case payload and an already-normalised camelCase
 * letterhead alike, so a value can be passed through twice without losing
 * anything. Returns null for nothing at all.
 */
export const normaliseLetterhead = (raw) => {
  if (!raw || typeof raw !== 'object') return null;

  const logo = isUsableLogo(raw.logo)
    ? {
        src:    raw.logo.src,
        width:  Number(raw.logo.width),
        height: Number(raw.logo.height),
        format: raw.logo.format || logoFormat(raw.logo),
      }
    : null;

  return {
    tenantId:        raw.admin_id || raw.tenantId || null,
    kind:            raw.kind === 'sacco' ? 'sacco' : 'company',
    name:            str(raw.name),
    motto:           str(raw.motto),
    registrationNo:  str(raw.registration_no ?? raw.registrationNo),
    kraPin:          str(raw.kra_pin ?? raw.kraPin).toUpperCase(),
    phone:           str(raw.phone),
    email:           str(raw.email),
    website:         displayWebsite(raw.website),
    physicalAddress: str(raw.physical_address ?? raw.physicalAddress),
    postalAddress:   str(raw.postal_address ?? raw.postalAddress),
    logoPath:        str(raw.logo_path ?? raw.logoPath) || null,
    logo,
    configured:      Boolean(raw.configured),
    updatedAt:       raw.updated_at ?? raw.updatedAt ?? null,
  };
};

/**
 * "Westlands, Nairobi" from a location and a city, without printing the city
 * twice when registration already typed it into the location — which is how
 * most rows were filled in ("Westlands,Nairobi" + "Nairobi"). Mirrors
 * public.letterhead_address().
 */
export const joinAddress = (location, city) => {
  const loc = str(location);
  const c = str(city);
  if (!c) return loc;
  if (!loc) return c;
  return loc.toLowerCase().includes(c.toLowerCase()) ? loc : `${loc}, ${c}`;
};

/**
 * A letterhead from a row a screen already holds — a `company_profiles` row,
 * a `saccos` row, or a seller the finance hub resolved. This is the fallback
 * when the tenant's own letterhead cannot be fetched, and what fills any gap
 * the fetched one leaves.
 */
export const letterheadFromRecord = (co) => {
  if (!co || typeof co !== 'object') return null;
  // Already a letterhead (it has been through normaliseLetterhead once).
  if ('physicalAddress' in co || 'registrationNo' in co) return normaliseLetterhead(co);

  return normaliseLetterhead({
    admin_id:        co.admin_id || co.tenantId || null,
    kind:            co.kind || (co.sacco_name || 'sasra_licence_no' in co ? 'sacco' : 'company'),
    name:            co.company_name || co.name || co.sacco_name || '',
    motto:           co.motto,
    registration_no: co.business_registration_number || co.registration_no || co.reg_no || '',
    kra_pin:         co.kra_pin,
    phone:           co.phone,
    email:           co.email,
    website:         co.website,
    physical_address:
      co.physical_address
      || co.address
      || joinAddress(co.location, co.city),
    postal_address:  co.postal_address,
    logo:            co.logo,
  });
};

/**
 * The tenant's letterhead over what the caller already had.
 *
 * `primary` is the authority — the fetched letterhead, which already merges
 * the tenant's branding over its registration record. `fallback` fills the
 * fields it leaves empty.
 *
 * The two are NEVER merged across tenants. If both name a tenant and the
 * tenants differ, the document keeps the caller's record untouched: printing
 * one business's logo on another business's invoice is the one outcome worse
 * than printing no logo at all.
 */
export const mergeLetterhead = (primary, fallback) => {
  const a = normaliseLetterhead(primary);
  const b = normaliseLetterhead(fallback);
  if (!a) return b;
  if (!b) return a;
  if (a.tenantId && b.tenantId && a.tenantId !== b.tenantId) return b;

  const out = { ...a, tenantId: a.tenantId || b.tenantId };
  LETTERHEAD_TEXT_FIELDS.forEach((k) => { if (!out[k] && b[k]) out[k] = b[k]; });
  if (!out.logo && b.logo) out.logo = b.logo;
  return out;
};

/**
 * The printed lines under the name, in the order a reader scans them: where
 * the business is, how to reach it, and the numbers a tax document must carry.
 *
 *   'stacked'  one fact per line — the A4 letterheads, which have the room.
 *              Registration and PIN stay on separate lines, as they always
 *              have on the vouchers.
 *   'compact'  as few lines as possible — a header band or the 80mm roll.
 */
export const letterheadLines = (lh, { layout = 'stacked' } = {}) => {
  if (!lh) return [];
  const address = [lh.physicalAddress, lh.postalAddress].filter(Boolean).join(' · ');
  const phone   = lh.phone ? `Tel: ${lh.phone}` : '';
  const regNo   = lh.registrationNo ? `Reg No: ${lh.registrationNo}` : '';
  const pin     = lh.kraPin ? `KRA PIN: ${lh.kraPin}` : '';

  if (layout === 'compact') {
    return [
      address,
      [phone, lh.email].filter(Boolean).join(' · '),
      lh.website,
      [regNo, pin].filter(Boolean).join(' · '),
    ].filter(Boolean);
  }

  return [
    address,
    [phone, lh.email, lh.website].filter(Boolean).join(' · '),
    regNo,
    pin,
  ].filter(Boolean);
};

/** One line: how to reach the business. For footers and "contact us" lines. */
export const letterheadContactLine = (lh) =>
  (lh ? [lh.phone ? `Tel: ${lh.phone}` : '', lh.email, lh.website].filter(Boolean).join(' · ') : '');

// ── HTML ─────────────────────────────────────────────────────────────────────
/*
 * Classes are prefixed `lh-` so the block drops into any of the print
 * documents without colliding with their own `.co` / `.muted` styles. Every
 * document that uses letterheadHtml() includes LETTERHEAD_STYLES once.
 */
export const LETTERHEAD_STYLES = `
  .lh { display: flex; align-items: center; gap: 14px; min-width: 0; flex: 1 1 auto; }
  /* In a header row, the block beside the letterhead — the document title and
     number — keeps its own width; the letterhead is what wraps. */
  .lh ~ div { flex: none; }
  .lh-logo { flex: none; display: block; max-height: 64px; max-width: 150px; width: auto; height: auto; object-fit: contain; }
  .lh-id { min-width: 0; }
  .lh-name { font-size: 20px; font-weight: 700; line-height: 1.2; overflow-wrap: anywhere; }
  .lh-motto { font-size: 11px; font-style: italic; color: #555; margin-top: 2px; }
  .lh-line { font-size: 11px; color: #555; line-height: 1.45; overflow-wrap: anywhere; }
  /* The 80mm roll: one centred column, and a logo a thermal head can print —
     it has one colour, so grey tones are left to its own dithering. */
  .lh-roll { flex-direction: column; text-align: center; gap: 3px; }
  .lh-roll .lh-logo { max-height: 56px; max-width: 60mm; margin: 0 auto 2px; filter: grayscale(1); }
  .lh-roll .lh-name { font-size: 14px; text-transform: uppercase; }
  .lh-roll .lh-motto { font-size: 10px; color: #000; }
  .lh-roll .lh-line { font-size: 10px; color: #000; }
`;

/** A colour a style attribute may carry — hex only, nothing that can escape it. */
const safeColour = (c) => (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(str(c)) ? str(c) : '');

/**
 * The letterhead as an escaped HTML fragment (a string; wrap it in rawHtml()
 * to interpolate it into an `html` template).
 *
 *   variant   'page' (default) — logo left, identity beside it.
 *             'roll'           — centred single column for the 80mm receipt.
 *   accent    a hex colour for the business name, to match a document's own
 *             palette. Ignored unless it is a plain hex colour.
 *   lines     override the printed lines (defaults to letterheadLines()).
 */
export const letterheadHtml = (lh, {
  variant = 'page',
  accent = '',
  fallbackName = 'Ararat',
  lines,
} = {}) => {
  const l = normaliseLetterhead(lh) || normaliseLetterhead({ name: fallbackName });
  const name = l.name || fallbackName;
  const printed = lines ?? letterheadLines(l, { layout: variant === 'roll' ? 'compact' : 'stacked' });
  const colour = safeColour(accent);

  return html`<div class="lh ${variant === 'roll' ? 'lh-roll' : 'lh-page'}">${
    l.logo ? rawHtml(html`<img class="lh-logo" src="${l.logo.src}" alt="${name} logo" />`) : ''
  }<div class="lh-id"><div class="lh-name"${
    colour ? rawHtml(` style="color:${colour}"`) : ''
  }>${name}</div>${
    l.motto ? rawHtml(html`<div class="lh-motto">${l.motto}</div>`) : ''
  }${printed.map((line) => rawHtml(html`<div class="lh-line">${line}</div>`))}</div></div>`;
};

export default normaliseLetterhead;
