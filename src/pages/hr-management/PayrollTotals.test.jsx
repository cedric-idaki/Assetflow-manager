/**
 * The Payroll tab's summary cards and totals row.
 *
 * Driven through the real page with Supabase mocked at the client. The cases
 * that matter: the figures come from payroll_totals() — covering payslips the
 * capped list never loaded — and when that function is missing the page still
 * shows totals, summed from what it has.
 */

import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  employees: [],
  payroll: [],
  rpc: null,          // { data, error } for payroll_totals
  rpcCalls: [],
}));

vi.mock('../../lib/supabase', () => {
  const chain = (table) => {
    const c = {
      select: () => c, not: () => c, order: () => c, limit: () => c, eq: () => c,
      maybeSingle: () => Promise.resolve({
        data: table === 'user_profiles' ? { id: 'admin-1', role: 'admin', admin_id: null } : null,
        error: null,
      }),
      then: (ok, bad) => Promise.resolve({
        data: table === 'user_profiles' ? db.employees : table === 'payroll_records' ? db.payroll : [],
        error: null,
      }).then(ok, bad),
    };
    return c;
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) },
      from: chain,
      rpc: async (fn, args) => { db.rpcCalls.push({ fn, args }); return db.rpc; },
    },
  };
});

vi.mock('../../contexts/AdminDashboardContext', async () => {
  const { useState } = await import('react');
  return {
    useAdminDashboardContext: () => {
      const [modals, setModals] = useState({});
      return {
        modals,
        openModal:  (k, v) => setModals(m => ({ ...m, [k]: v })),
        closeModal: (k)    => setModals(m => ({ ...m, [k]: null })),
      };
    },
  };
});

vi.mock('../../layouts/MainLayout', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../../components/ui/ClosePageButton', () => ({ default: () => null }));
vi.mock('../../hooks/useSignedUrl', () => ({ useSignedUrl: (v) => ({ url: v || null, loading: false }) }));
vi.mock('../../hooks/useStatutoryCalendar', () => ({ useStatutoryCalendar: () => ({ loading: false, error: null }) }));
vi.mock('./components/StatutoryCalendarPanel', () => ({ default: () => null }));

import HRPage from './index';

const emp = (id, name, extra = {}) => ({
  id, admin_id: 'admin-1', full_name: name, email: `${id}@example.com`, role: 'staff',
  department: 'Finance', is_active: true, basic_salary: 50000, ...extra,
});

const slip = (employee_id, pay_month, over = {}) => ({
  id: `${employee_id}-${pay_month}`, employee_id, admin_id: 'admin-1', pay_month, status: 'pending',
  basic_salary: 50000, housing_allowance: 5000, transport_allowance: 0,
  meal_allowance: 0, bonus: 0, gift: 0, loan_deduction: 0, advance_deduction: 0,
  gross_salary: 55000, taxable_pay: 50000, paye: 8000, nssf: 3300, shif: 1512.5,
  housing_levy: 825, net_salary: 41362.5, ...over,
});

// The summary card whose label is exactly `label` ("SHIF" is also a column
// heading, so the card is picked by its own markup).
const card = (label) => screen.getAllByText(label)
  .map(el => el.closest('div'))
  .find(d => d && d.className.includes('rounded-xl p-4'));

const openPayroll = async () => {
  render(<HRPage />);
  fireEvent.click(await screen.findByRole('button', { name: /Payroll/ }));
};

describe('Payroll tab totals', () => {
  beforeEach(() => {
    db.employees = [emp('e1', 'Jane Wanjiru'), emp('e2', 'Peter Kamau'), emp('e3', 'Idle Person')];
    db.payroll = [slip('e1', '2026-09'), slip('e2', '2026-09'), slip('e1', '2026-08')];
    db.rpc = null;
    db.rpcCalls.length = 0;
  });

  it('shows gross, PAYE, NSSF and SHIF from payroll_totals — including payslips the list never loaded', async () => {
    // The RPC answers for 250 payslips; the page only holds 3. Numeric comes
    // back from PostgREST as strings.
    db.rpc = {
      data: [{
        records: 250, employees: 2, months: 2,
        basic: '12500000', allowances: '1250000', additions: '0', gross: '13750000.00',
        taxable_pay: '12500000', paye: '2000000.00', nssf: '825000.00', shif: '378125.00',
        housing_levy: '206250', other_deductions: '0', net: '10340625.00',
      }],
      error: null,
    };
    await openPayroll();

    expect(await within(card('Total Gross')).findByText('KES 13,750,000')).toBeInTheDocument();
    expect(within(card('PAYE Due to KRA')).getByText('KES 2,000,000')).toBeInTheDocument();
    expect(within(card('NSSF (Employee)')).getByText('KES 825,000')).toBeInTheDocument();
    expect(within(card('NSSF (Employee)')).getByText(/Remit KES 1,650,000 incl\. employer match/)).toBeInTheDocument();
    expect(within(card('SHIF')).getByText('KES 378,125')).toBeInTheDocument();
    // Distinct employees against the active staff count, not payslips.
    expect(within(card('Employees Paid')).getByText('2')).toBeInTheDocument();
    expect(within(card('Employees Paid')).getByText(/of 3 active employee\(s\) · 250 payslips, 2 months/)).toBeInTheDocument();

    // Totals row agrees with the cards, and says the table is cut short.
    const foot = document.querySelector('tfoot');
    expect(within(foot).getByText(/Total · 250 payslip\(s\), 2 employee\(s\)/)).toBeInTheDocument();
    expect(within(foot).getByText('KES 13,750,000')).toBeInTheDocument();
    expect(within(foot).getByText('(KES 825,000)')).toBeInTheDocument();
    expect(within(foot).getByText('(KES 378,125)')).toBeInTheDocument();
    expect(within(foot).getByText(/lists the latest 3 of 250 payslips/)).toBeInTheDocument();

    expect(db.rpcCalls[0]).toMatchObject({ fn: 'payroll_totals', args: { p_admin_id: 'admin-1', p_month: null } });
  });

  it('falls back to summing the loaded payslips when payroll_totals is not deployed', async () => {
    db.rpc = { data: null, error: { message: 'Could not find the function public.payroll_totals' } };
    await openPayroll();

    // 3 × 55,000 gross; 3 × 3,300 NSSF; 3 × 1,512.5 SHIF (rounded on screen).
    expect(await within(card('Total Gross')).findByText('KES 165,000')).toBeInTheDocument();
    expect(within(card('NSSF (Employee)')).getByText('KES 9,900')).toBeInTheDocument();
    expect(within(card('SHIF')).getByText('KES 4,538')).toBeInTheDocument();
    expect(within(card('PAYE Due to KRA')).getByText('KES 24,000')).toBeInTheDocument();
    expect(within(card('Employees Paid')).getByText('2')).toBeInTheDocument();
    // Nothing unlisted, and the list was not capped, so no warnings.
    expect(screen.queryByText(/lists the latest/)).toBeNull();
    expect(screen.queryByText(/may be short/)).toBeNull();
  });

  it('passes the month filter through to payroll_totals', async () => {
    db.rpc = { data: [{ records: 2, employees: 2, months: 1, gross: '110000' }], error: null };
    await openPayroll();
    await within(card('Total Gross')).findByText('KES 110,000');

    const monthSelect = screen.getAllByRole('combobox')
      .find(s => [...s.options].some(o => o.value === '2026-09'));
    fireEvent.change(monthSelect, { target: { value: '2026-09' } });

    await vi.waitFor(() => expect(db.rpcCalls.at(-1).args.p_month).toBe('2026-09'));
  });
});
