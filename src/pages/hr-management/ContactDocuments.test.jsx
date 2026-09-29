/**
 * Next-of-kin and secondary-contact documents on the HR page: an ID scan and a
 * photo for each contact, uploaded from the employee form into the employee's
 * own folder of the private employee-documents bucket.
 *
 * Driven through the real page with Supabase mocked at the client. The second
 * case matters as much as the first: on a database that has not yet applied
 * 20260925190000, saving an employee must still work — it just must not name
 * the four new columns.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const CONTACT_COLS = [
  'next_of_kin_id_document_url',
  'next_of_kin_photo_url',
  'secondary_contact_id_document_url',
  'secondary_contact_photo_url',
];

const db = vi.hoisted(() => ({
  employees: [],
  migrated: true,
  updates: [],
  uploads: [],
}));

vi.mock('../../lib/supabase', () => {
  const resultFor = (s) => {
    if (s.op === 'update') return { data: null, error: null };
    if (s.table === 'user_profiles') {
      if (!db.migrated && /next_of_kin_photo_url/.test(s.cols || '')) {
        return { data: null, error: { message: 'column user_profiles.next_of_kin_photo_url does not exist' } };
      }
      return { data: db.employees, error: null };
    }
    return { data: [], error: null };
  };
  const chain = (table) => {
    const s = { table, op: 'select', cols: null };
    const c = {
      select: (cols) => { if (s.op === 'select') s.cols = cols; return c; },
      update: (payload) => { s.op = 'update'; db.updates.push({ table, payload }); return c; },
      not: () => c, order: () => c, limit: () => c, eq: () => c,
      maybeSingle: () => Promise.resolve({
        data: table === 'user_profiles' ? { id: 'admin-1', role: 'admin', admin_id: null } : null,
        error: null,
      }),
      then: (ok, bad) => Promise.resolve(resultFor(s)).then(ok, bad),
    };
    return c;
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) },
      from: chain,
      storage: {
        from: (bucket) => ({
          upload: async (path) => { db.uploads.push({ bucket, path }); return { error: null }; },
          getPublicUrl: (path) => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
        }),
      },
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

const fileInputs = () => [...document.querySelectorAll('input[type="file"]')];

describe('HR next-of-kin / secondary-contact documents', () => {
  beforeEach(() => {
    db.updates.length = 0;
    db.uploads.length = 0;
    db.migrated = true;
    db.employees = [{ ...baseEmployee, ...Object.fromEntries(CONTACT_COLS.map(c => [c, null])) }];
  });

  it('uploads a contact photo into the employee folder and records it on the profile', async () => {
    await openEditForm();

    // Form order: next of kin ID + photo, secondary ID + photo, then the employee's own three.
    // Re-queried after each pick: DocField is declared inside the modal, so every
    // render mounts fresh inputs and an earlier node is detached.
    expect(fileInputs()).toHaveLength(7);
    const nokPhoto = new File(['img'], 'kin photo.png', { type: 'image/png' });
    const secId    = new File(['pdf'], 'contact-id.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInputs()[1], { target: { files: [nokPhoto] } });
    fireEvent.change(fileInputs()[2], { target: { files: [secId] } });
    expect(screen.getByText('kin photo.png')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(db.updates).toHaveLength(1));

    expect(db.uploads.map(u => u.bucket)).toEqual(['employee-documents', 'employee-documents']);
    expect(db.uploads[0].path).toMatch(/^emp-1\/next_of_kin_photo_url_\d+_kin_photo\.png$/);
    expect(db.uploads[1].path).toMatch(/^emp-1\/secondary_contact_id_document_url_\d+_contact-id\.pdf$/);

    const { payload } = db.updates[0];
    expect(payload.next_of_kin_photo_url).toContain('/employee-documents/emp-1/next_of_kin_photo_url_');
    expect(payload.secondary_contact_id_document_url).toContain('/employee-documents/emp-1/secondary_contact_id_document_url_');
    expect(payload.next_of_kin_id_document_url).toBeNull();
    expect(payload.secondary_contact_photo_url).toBeNull();
  });

  it('still saves on a database without the contact-document columns, and does not name them', async () => {
    db.migrated = false;
    db.employees = [{ ...baseEmployee }]; // what the fallback column tier returns
    await openEditForm();

    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(db.updates).toHaveLength(1));

    const { payload } = db.updates[0];
    for (const col of CONTACT_COLS) expect(payload).not.toHaveProperty(col);
    expect(payload.next_of_kin_name).toBe('Peter Kamau'); // the tier fallback kept the contact details
    expect(screen.queryByText(/could not|missing migration/i)).not.toBeInTheDocument();
  });

  it('shows each contact\'s ID and photo in the detail drawer and on the Documents tab', async () => {
    db.employees = [{
      ...baseEmployee,
      next_of_kin_id_document_url: 'https://x.supabase.co/storage/v1/object/public/employee-documents/emp-1/nok-id.pdf',
      next_of_kin_photo_url:       'https://x.supabase.co/storage/v1/object/public/employee-documents/emp-1/nok.png',
      secondary_contact_id_document_url: null,
      secondary_contact_photo_url:       null,
    }];
    render(<HRPage />);

    fireEvent.click(await screen.findByText('Jane Wanjiru'));
    const kin = screen.getByText('Next of Kin', { selector: 'p' }).parentElement;
    expect(within(kin).getByText('View ID')).toBeInTheDocument();
    expect(within(kin).getByAltText('Next of kin')).toBeInTheDocument();
    const secondary = screen.getByText('Secondary Contact', { selector: 'p' }).parentElement;
    expect(within(secondary).getAllByText('Not uploaded')).toHaveLength(2);
    // Close the drawer (its only buttons are Edit, Delete and the trailing X).
    const drawerButtons = within(kin.closest('.fixed')).getAllByRole('button');
    fireEvent.click(drawerButtons[drawerButtons.length - 1]);
    await waitFor(() => expect(screen.queryByText('Next of Kin', { selector: 'p' })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Documents/ }));
    expect(await screen.findByRole('columnheader', { name: 'Next of Kin' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Secondary Contact' })).toBeInTheDocument();
    expect(screen.getAllByAltText('Next of kin')).toHaveLength(1);
  });
});
