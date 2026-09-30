import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({
  supabase: { from: vi.fn(), auth: { getSession: vi.fn(), getUser: vi.fn() }, rpc: vi.fn() },
  getCurrentUser: vi.fn(),
  invokeSupabaseFunction: vi.fn(),
}));

const { catalogueSaleLines, catalogueItemDescription, isCatalogueLine } = await import('./usePOS');

/**
 * The till sells from the Services catalogue (20260930120000). Each price
 * option of an offered service becomes one line, shaped like an asset so the
 * receipt reads it unchanged, but marked so its id never reaches asset_id.
 */
const SERVICE = {
  id: 'svc-1',
  service_code: 'SVC-00001',
  name: 'Tax Advisory',
  category: 'Tax',
  is_active: true,
  consultancy_cost_structures: [
    { id: 'cs-hourly', pricing_model: 'hourly', amount: 5000, sort_order: 2, is_default: false },
    { id: 'cs-pack', pricing_model: 'hourly_package', label: null, amount: 30000,
      included_hours: 3, billing_period: 'monthly', sort_order: 1, is_default: true },
    { id: 'cs-success', pricing_model: 'success_fee', success_pct: 10, success_basis: 'tax recovered',
      amount: null, sort_order: 3, is_default: false },
  ],
};

describe('catalogueSaleLines', () => {
  it('offers every price option of an offered service, default first', () => {
    const lines = catalogueSaleLines([SERVICE]);
    expect(lines.map(l => l.consultancy_cost_structure_id)).toEqual(['cs-pack', 'cs-hourly', 'cs-success']);
    lines.forEach((l) => {
      expect(isCatalogueLine(l)).toBe(true);
      expect(l.consultancy_service_id).toBe('svc-1');
      expect(l.asset_type).toBe('services');
      expect(l.description).toBe('Tax Advisory');
      expect(l.asset_code).toBe('SVC-00001');
    });
  });

  it('gives each line an id that is unique and never a bare uuid', () => {
    const ids = catalogueSaleLines([SERVICE]).map(l => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach(id => expect(id.startsWith('svc:')).toBe(true));
  });

  it('prices a package at its package price, with its terms in words', () => {
    const pack = catalogueSaleLines([SERVICE])[0];
    expect(pack.selling_price).toBe(30000);
    expect(pack.per_quantity).toBe(false);
    expect(pack.option_label).toBe('Hourly billing package');
    expect(pack.terms_headline).toBe('KES 30,000 for 3 hours per month');
  });

  it('asks how many hours for a per-hour option', () => {
    const hourly = catalogueSaleLines([SERVICE]).find(l => l.consultancy_cost_structure_id === 'cs-hourly');
    expect(hourly.per_quantity).toBe(true);
    expect(hourly.quantity_unit).toBe('hour');
    expect(hourly.unit_rate).toBe(5000);
  });

  it('names the unit of a per-unit option, or falls back to "unit"', () => {
    const [named, plain] = catalogueSaleLines([{
      ...SERVICE,
      consultancy_cost_structures: [
        { id: 'u1', pricing_model: 'unit', amount: 800, unit_label: 'report', sort_order: 1 },
        { id: 'u2', pricing_model: 'unit', amount: 900, sort_order: 2 },
      ],
    }]);
    expect(named.quantity_unit).toBe('report');
    expect(plain.quantity_unit).toBe('unit');
  });

  it('leaves the price to the till when a success fee has no fixed bonus', () => {
    const success = catalogueSaleLines([SERVICE]).find(l => l.consultancy_cost_structure_id === 'cs-success');
    expect(success.selling_price).toBe(0);
    expect(success.terms_headline).toBe('10% of tax recovered');
  });

  it('still sells a service with no price list, priced at the till', () => {
    const [line] = catalogueSaleLines([{ ...SERVICE, consultancy_cost_structures: [] }]);
    expect(line.consultancy_cost_structure_id).toBeNull();
    expect(line.selling_price).toBe(0);
    expect(line.id).toBe('svc:svc-1');
  });

  it('never offers a retired service', () => {
    expect(catalogueSaleLines([{ ...SERVICE, is_active: false }])).toEqual([]);
  });

  it('tolerates nothing to sell', () => {
    expect(catalogueSaleLines()).toEqual([]);
    expect(catalogueSaleLines([null])).toEqual([]);
  });
});

describe('catalogueItemDescription', () => {
  const [pack, hourly] = catalogueSaleLines([SERVICE]);

  it('says what was sold on what terms', () => {
    expect(catalogueItemDescription(pack))
      .toBe('Tax Advisory — Hourly billing package (KES 30,000 for 3 hours per month)');
  });

  it('carries the count for a per-hour sale', () => {
    expect(catalogueItemDescription(hourly, 3))
      .toBe('Tax Advisory — Per-hour cost (3 × KES 5,000 per hour)');
  });

  it('leaves an Inventory item described as it always was', () => {
    expect(catalogueItemDescription({ id: 'a1', description: 'Dell XPS 13', asset_type: 'electronics' }))
      .toBe('Dell XPS 13');
    expect(isCatalogueLine({ id: 'a1', asset_type: 'services' })).toBe(false);
  });
});
