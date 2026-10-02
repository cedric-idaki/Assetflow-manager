/**
 * The employee form's Branch field is a dropdown that depends on the chosen
 * bank, with an "Other (not listed)" escape to a text box because the branch
 * lists cover main branches only.
 *
 * Driven through the real page with Supabase mocked at the client, the same
 * way ContactDocuments.test.jsx does it.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ employees: [], updates: [] }));

vi.mock('../../lib/supabase', () => {
  const chain = (table) => {
    const s = { op: 'select' };
    const c = {
      select: () => c,
      update: (payload) => { s.op = 'update'; db.updates.push({ table, payload }); return c; },
      not: () => c, order: () => c, limit: () => c, eq: () => c,
      maybeSingle: () => Promise.resolve({
        data: table === 'user_profiles' ? { id: 'admin-1', role: 'admin', admin_id: null } : null,
        error: null,
      }),
      then: (ok, bad) => Promise.resolve(
        s.op === 'update'         ? { data: null, error: null }
        : table === 'user_profiles' ? { data: db.employees, error: null }
        : { data: [], error: null },
      ).then(ok, bad),
    };
    return c;
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) },
      from: chain,
      storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
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
vi.mock('../../services/employeePiiService', async (orig) => ({
  ...(await orig()),
  fetchEmployeePii: async () => ({ ok: true, bank_account: '0011223344', nssf_number: 'NS-1', next_of_kin_id: '12345678' }),
  saveEmployeePii:  async () => ({ ok: true }),
}));

import HRPage from './index';
import { branchesFor } from '../../config/kenyaBanks';

// Every field the form requires, so Save gets past validation.
const baseEmployee = {
  id: 'emp-1', admin_id: 'admin-1', full_name: 'Jane Wanjiru', email: 'jane@example.com',
  phone: '+254700000001', national_id: '30111222', gender: 'female', date_of_birth: '1990-01-01',
  next_of_kin_name: 'Peter Kamau', next_of_kin_relationship: 'Spouse', next_of_kin_phone: '+254700000002',
  secondary_contact_name: 'Mary Achieng', secondary_contact_relationship: 'Friend', secondary_contact_phone: '+254700000003',
  role: 'staff', department: 'Finance', employment_type: 'full_time', date_joined: '2024-01-01',
  leave_balance: 21, kra_pin: 'A000000000X', sha_number: 'SHA-1', bank_name: 'KCB Bank', bank_branch: 'Moi Avenue',
  is_active: true, basic_salary: 50000, id_document_url: null, cv_url: null, photo_url: null,
};

const openEditForm = async () => {
  render(<HRPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  await screen.findByText('Edit — Jane Wanjiru');
  // Wait for the encrypted fields to unlock, or Save would skip them.
  await waitFor(() => expect(screen.getByDisplayValue('12345678')).toBeEnabled());
};

// The form's labels are siblings of their controls, not linked by htmlFor.
const selectFor = (label) => screen.getByText(label).parentElement.querySelector('select');
const optionsOf = (select) => [...select.options].map(o => o.textContent);

const saveAndGetPayload = async () => {
  fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
  await waitFor(() => expect(db.updates).toHaveLength(1));
  return db.updates[0].payload;
};

describe('HR employee form — bank branch dropdown', () => {
  beforeEach(() => {
    db.updates.length = 0;
    db.employees = [{ ...baseEmployee }];
  });

  it('lists the chosen bank\'s branches and clears the branch when the bank changes', async () => {
    await openEditForm();
    const branch = selectFor('Branch *');
    expect(branch.value).toBe('Moi Avenue');
    expect(optionsOf(branch)).toEqual(['— Select —', ...branchesFor('KCB Bank'), 'Other (not listed)…']);

    fireEvent.change(selectFor('Bank Name *'), { target: { value: 'Equity Bank' } });
    expect(selectFor('Branch *').value).toBe('');
    expect(optionsOf(selectFor('Branch *'))).toContain('Tom Mboya');
    expect(optionsOf(selectFor('Branch *'))).not.toContain('Kencom House'); // a KCB-only branch

    fireEvent.change(selectFor('Branch *'), { target: { value: 'Tom Mboya' } });
    const payload = await saveAndGetPayload();
    expect(payload.bank_name).toBe('Equity Bank');
    expect(payload.bank_branch).toBe('Tom Mboya');
  });

  it('blocks the save when the bank changed but no new branch was picked', async () => {
    await openEditForm();
    fireEvent.change(selectFor('Bank Name *'), { target: { value: 'Equity Bank' } });

    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    expect(await screen.findByText('Please fill in all required fields: Branch.')).toBeInTheDocument();
    expect(db.updates).toHaveLength(0);
  });

  it('lets an unlisted branch be typed via "Other (not listed)"', async () => {
    await openEditForm();
    fireEvent.change(selectFor('Branch *'), { target: { value: '__other__' } });

    const typed = screen.getByRole('textbox', { name: 'Branch name' });
    fireEvent.change(typed, { target: { value: 'Kiserian' } });
    expect((await saveAndGetPayload()).bank_branch).toBe('Kiserian');
  });

  it('keeps a stored branch that is not in the bank\'s list', async () => {
    db.employees = [{ ...baseEmployee, bank_branch: 'westlands nrb' }];
    await openEditForm();
    expect(selectFor('Branch *').value).toBe('westlands nrb');
    expect((await saveAndGetPayload()).bank_branch).toBe('westlands nrb');
  });
});
