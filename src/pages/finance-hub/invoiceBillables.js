/**
 * What an invoice line is built from — an asset, a catalogue service, or the
 * terms a client agreed for a service — and how a client's linked items fill
 * the New Invoice form.
 *
 * Lines carry an `origin`. Only 'client' lines are the form's own doing: they
 * were filled because the client has those items linked, so choosing a
 * different client swaps them for the new client's. Lines the user typed or
 * picked from the Asset / Service dropdowns are never touched.
 */
import { describeTerms, pricingModelLabel } from '../../config/consultancyPricing';

export const emptyInvoiceLine = () => ({ description: '', quantity: 1, unit_price: '' });

const isEmptyLine = (it) =>
  !String(it?.description ?? '').trim() && String(it?.unit_price ?? '') === '';

export const assetLabel = (a) =>
  a.description || [a.make, a.model, a.year].filter(Boolean).join(' ') || a.asset_code || 'Asset';

/** An asset bills at its selling price, named with its code and plate. */
export const assetInvoiceLine = (a) => {
  const label = assetLabel(a);
  const ref   = [a.asset_code, a.plate_number].filter(Boolean).join(' · ');
  return {
    description: ref ? `${label} (${ref})` : label,
    quantity:    1,
    unit_price:  a.selling_price ?? '',
  };
};

/**
 * A service bills at the amount its terms name, e.g.
 *   "Tax Advisory — Retainer (KES 50,000 per month)"   1 × 50,000
 *   "Tax Advisory — Per-hour cost (KES 5,000 per hour)" 1 × 5,000 — the
 *   quantity is the hours, left for the user to set.
 * Terms with no fixed amount (a success fee that is only a percentage) leave
 * the price blank to be typed, rather than billing zero.
 */
export const serviceInvoiceLine = ({ name, label, terms }) => {
  const headline = terms?.pricing_model ? describeTerms(terms).headline : '';
  const amount   = Number(terms?.amount) || 0;
  return {
    description: `${name}${label ? ` — ${label}` : ''}${headline ? ` (${headline})` : ''}`,
    quantity:    1,
    unit_price:  amount > 0 ? amount : '',
  };
};

/** Every price option of every offered catalogue service, default option first. */
export const catalogueServiceOptions = (services = []) => services
  .filter(s => s && s.is_active !== false)
  .flatMap((s) => {
    const options = [...(s.consultancy_cost_structures || [])].sort((a, b) =>
      (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0) || (a.sort_order ?? 0) - (b.sort_order ?? 0));
    if (options.length === 0) return [{ key: `svc:${s.id}`, name: s.name, label: '', terms: null }];
    return options.map(cs => ({
      key:   `svc:${s.id}:${cs.id}`,
      name:  s.name,
      label: cs.label || pricingModelLabel(cs.pricing_model),
      terms: cs,
    }));
  });

/**
 * A client's engagement, priced on the terms THEY agreed — copied onto the
 * engagement and possibly negotiated, so not necessarily the list price.
 */
export const engagementServiceOption = (e) => ({
  key:   `eng:${e.id}`,
  name:  e.service?.name || 'Service',
  label: e.cost_structure?.label || pricingModelLabel(e.pricing_model),
  terms: e,
});

/** How an option reads in the dropdown. */
export const serviceOptionText = (o) => {
  const headline = o.terms?.pricing_model ? describeTerms(o.terms).headline : 'price set on the invoice';
  return `${o.name}${o.label ? ` · ${o.label}` : ''} — ${headline}`;
};

/** The lines a client's linked assets and active engagements fill in. */
export const clientLinkedLines = ({ assets = [], engagements = [] } = {}) => [
  ...assets.map(a => ({ ...assetInvoiceLine(a), origin: 'client' })),
  ...engagements.map(e => ({ ...serviceInvoiceLine(engagementServiceOption(e)), origin: 'client' })),
];

/**
 * The previous client's filled lines out, this client's in. Whatever the user
 * typed or picked stays, ahead of them; blank lines are dropped, unless
 * nothing at all is left.
 */
export const withClientLines = (items = [], lines = []) => {
  const kept = items.filter(it => it.origin !== 'client' && !isEmptyLine(it));
  const next = [...kept, ...lines];
  return next.length > 0 ? next : [emptyInvoiceLine()];
};

/** A picked asset or service goes into the first blank line, or a new one. */
export const fillFirstEmptyLine = (items = [], line) => {
  const idx = items.findIndex(isEmptyLine);
  return idx === -1 ? [...items, line] : items.map((it, i) => (i === idx ? line : it));
};
