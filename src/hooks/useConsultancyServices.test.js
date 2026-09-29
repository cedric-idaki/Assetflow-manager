import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase, resetFakeIds } from '../test-utils/fakeSupabase';

let db;
vi.mock('../lib/supabase', () => ({
  get supabase() { return db; },
}));

const { useConsultancyServices, buildEngagementRow, friendlyError } = await import('./useConsultancyServices');

const ADMIN = 'admin_1';

const seed = () => ({
  consultancy_services: [
    { id: 'svc_tax',   admin_id: ADMIN, name: 'Tax Advisory', service_code: 'SVC-00001', category: 'Tax', is_active: true },
    { id: 'svc_audit', admin_id: ADMIN, name: 'Audit',        service_code: 'SVC-00002', category: 'Assurance', is_active: false },
    { id: 'svc_other', admin_id: 'admin_2', name: 'Not ours', service_code: 'SVC-00003', category: 'Tax', is_active: true },
  ],
  consultancy_cost_structures: [
    { id: 'opt_1', admin_id: ADMIN, service_id: 'svc_tax', pricing_model: 'hourly',   amount: '5000.00',  sort_order: 1 },
    { id: 'opt_2', admin_id: ADMIN, service_id: 'svc_tax', pricing_model: 'retainer', amount: '30000.00', billing_period: 'monthly', sort_order: 2 },
  ],
  consultancy_engagements: [
    { id: 'eng_1', admin_id: ADMIN, service_id: 'svc_tax', client_id: 'cl_1', status: 'active',    pricing_model: 'hourly', amount: '5000.00' },
    { id: 'eng_2', admin_id: ADMIN, service_id: 'svc_tax', client_id: 'cl_1', status: 'proposed',  pricing_model: 'retainer', amount: '30000.00', billing_period: 'monthly' },
    { id: 'eng_3', admin_id: ADMIN, service_id: 'svc_tax', client_id: 'cl_2', status: 'completed', pricing_model: 'hourly', amount: '5000.00' },
  ],
});

const mount = async (opts = {}) => {
  db = createFakeSupabase({ tables: seed(), ...opts });
  const view = renderHook(() => useConsultancyServices(ADMIN));
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
};

beforeEach(() => resetFakeIds());

describe('useConsultancyServices — reading', () => {
  it('loads this tenant\'s catalogue, grouped the way the tab shows it', async () => {
    const { result } = await mount();
    const r = result.current;
    expect(r.services.map(s => s.id).sort()).toEqual(['svc_audit', 'svc_tax']);
    expect(r.optionsByService.svc_tax).toHaveLength(2);
    expect(r.engagementsByService.svc_tax).toHaveLength(3);
    expect(r.categories).toEqual(['Assurance', 'Tax']);
    expect(r.summary).toEqual({
      activeServices: 1, retiredServices: 1, priceOptions: 2,
      currentMappings: 2,   // completed work is on record, not current
      clientsServed: 1,     // two current mappings, one client
    });
    expect(r.error).toBeNull();
  });

  it('says the area is not installed, instead of showing an empty catalogue as fact', async () => {
    const { result } = await mount({
      failures: { 'consultancy_services.select': { code: 'PGRST205', message: "Could not find the table 'public.consultancy_services' in the schema cache" } },
    });
    expect(result.current.error).toMatch(/not installed on this database yet — apply migration 20260925160000/);
  });

  it('subscribes once per mount with a unique channel name', async () => {
    const first = await mount();
    const names = [];
    const realChannel = db.channel;
    db.channel = (name) => { names.push(name); return realChannel(name); };
    first.unmount();
    const a = renderHook(() => useConsultancyServices(ADMIN));
    const b = renderHook(() => useConsultancyServices(ADMIN));
    await waitFor(() => expect(a.result.current.loading || b.result.current.loading).toBe(false));
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
    names.forEach(n => expect(n).toMatch(/^consultancy_services_\d+$/));
  });
});

describe('useConsultancyServices — writing', () => {
  it('sends a service and its complete price list in one call, terms already cleaned', async () => {
    const rpc = vi.fn(() => 'svc_new');
    const { result } = await mount({ rpcs: { save_consultancy_service: rpc } });

    await act(() => result.current.saveService({
      service: { name: '  Grant Writing ', category: '', is_active: true },
      costStructures: [
        { pricing_model: 'fixed_fee', amount: '80000', deposit_pct: '50', billing_period: 'monthly', label: ' ', is_default: true },
        { pricing_model: 'success_fee', success_pct: '5', success_basis: 'grant awarded', amount: '' },
      ],
    }));

    expect(rpc).toHaveBeenCalledTimes(1);
    const [args] = rpc.mock.calls[0];
    expect(args.p_service).toEqual({
      id: null, name: 'Grant Writing', service_code: null, category: null, description: null, is_active: true,
    });
    expect(args.p_cost_structures).toEqual([
      expect.objectContaining({ id: null, label: null, is_default: true, pricing_model: 'fixed_fee', amount: 80000, deposit_pct: 50, billing_period: null }),
      expect.objectContaining({ id: null, is_default: false, pricing_model: 'success_fee', success_pct: 5, success_basis: 'grant awarded', amount: null }),
    ]);
  });

  it('surfaces a refusal from the save in plain words', async () => {
    const { result } = await mount({
      rpcs: { save_consultancy_service: () => { throw new Error('duplicate key value violates unique constraint "consultancy_services_name_uniq"'); } },
    });
    await expect(result.current.saveService({ service: { name: 'Tax Advisory' } }))
      .rejects.toThrow('A service with that name already exists.');
  });

  it('maps a client, sending no tenant and no start date — the database supplies both', async () => {
    const { result } = await mount();
    await act(() => result.current.saveEngagement({
      service_id: 'svc_tax', client_id: 'cl_9', cost_structure_id: 'opt_1', status: 'active',
      terms: { pricing_model: 'hourly', amount: '4500', billing_period: 'monthly' },
    }));
    // The fake has no triggers, so the row keeps exactly what the browser sent.
    const { data: [added] } = await db.from('consultancy_engagements').select('*').eq('client_id', 'cl_9');
    expect(added).toMatchObject({
      service_id: 'svc_tax', pricing_model: 'hourly', amount: 4500, billing_period: null, cost_structure_id: 'opt_1',
    });
    expect(added).not.toHaveProperty('admin_id');
    expect(added).not.toHaveProperty('start_date');
  });

  it('treats an update that changed no row as a failure, not a save', async () => {
    const { result } = await mount();
    await expect(result.current.saveEngagement({
      id: 'eng_missing', service_id: 'svc_tax', client_id: 'cl_1', terms: { pricing_model: 'hourly', amount: '1' },
    })).rejects.toThrow(/not saved/);
    await expect(result.current.setServiceActive('svc_missing', false)).rejects.toThrow(/not changed/);
    await expect(result.current.deleteEngagement('eng_missing')).rejects.toThrow(/not removed/);
  });

  it('retires a service in place', async () => {
    const { result } = await mount();
    await act(() => result.current.setServiceActive('svc_tax', false));
    expect(result.current.services.find(s => s.id === 'svc_tax').is_active).toBe(false);
    expect(result.current.summary.activeServices).toBe(0);
  });

  it('explains why a service with clients cannot be deleted', async () => {
    const { result } = await mount({
      failures: { 'consultancy_services.delete': {
        code: '23503',
        message: 'update or delete on table "consultancy_services" violates RESTRICT setting of foreign key constraint "consultancy_engagements_service_id_fkey" on table "consultancy_engagements"',
      } },
    });
    await expect(result.current.deleteService('svc_tax'))
      .rejects.toThrow('Clients are mapped to this service. Retire it instead, or remove its client mappings first.');
  });
});

describe('buildEngagementRow', () => {
  it('keeps only the terms the model uses and trims notes', () => {
    expect(buildEngagementRow({
      id: 'eng_1', service_id: 's', client_id: 'c', cost_structure_id: '', status: 'on_hold',
      start_date: '2026-09-01', end_date: '', notes: '  call Mary  ',
      terms: { pricing_model: 'retainer', amount: '30000', billing_period: 'quarterly', deposit_pct: '40' },
    })).toEqual({
      service_id: 's', client_id: 'c', cost_structure_id: null, status: 'on_hold',
      start_date: '2026-09-01', end_date: null, notes: 'call Mary',
      pricing_model: 'retainer', amount: 30000, unit_label: null, included_hours: null, overage_rate: null,
      billing_period: 'quarterly', success_pct: null, success_basis: null, minimum_fee: null, fee_cap: null, deposit_pct: null,
    });
  });

  it('never blanks the start date of an existing mapping by omission', () => {
    expect(buildEngagementRow({ id: 'eng_1', terms: {} })).toHaveProperty('start_date', null);
    expect(buildEngagementRow({ terms: {} })).not.toHaveProperty('start_date');
  });
});

describe('friendlyError', () => {
  it.each([
    [{ code: '42P01', message: 'relation "public.consultancy_services" does not exist' }, /not installed/],
    [{ code: 'PGRST202', message: 'Could not find the function public.save_consultancy_service' }, /not installed/],
    [{ code: '23505', message: 'duplicate key value violates unique constraint "consultancy_services_code_uniq"' }, /already uses that code/],
    [{ code: '23514', message: 'new row violates check constraint "consultancy_engagements_dates_chk"' }, /end date cannot be before/],
    [{ code: '42501', message: 'The assets module is switched off for this account.' }, /assets module is switched off/],
    [{ code: '23514', message: 'Enter the rate per hour.' }, /^Enter the rate per hour\.$/],
  ])('%o', (err, expected) => {
    expect(friendlyError(err)).toMatch(expected);
  });
});
