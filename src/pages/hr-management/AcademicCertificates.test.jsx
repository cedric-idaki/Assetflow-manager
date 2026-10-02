/**
 * Academic certificates on the HR employee form: any number of them, each with
 * a qualification, the institution it came from and a file, uploaded into the
 * employee's own folder of the private employee-documents bucket and recorded
 * in the user_profiles.academic_certificates jsonb array.
 *
 * Driven through the real page with Supabase mocked at the client, the same
 * way ContactDocuments.test.jsx does it — including the database that has not
 * applied 20261002120000 yet, where every other save must still work.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ employees: [], migrated: true, updates: [], uploads: [] }));

vi.mock('../../lib/supabase', () => {
  const resultFor = (s) => {
    if (s.op === 'update') return { data: null, error: null };
    if (s.table === 'user_profiles') {
      if (!db.migrated && /academic_certificates/.test(s.cols || '')) {
        return { data: null, error: { message: 'column user_profiles.academic_certificates does not exist' } };
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

const STORED = 'https://x.supabase.co/storage/v1/object/public/employee-documents/emp-1/academic_certificate_1_kcse.pdf';

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

const addCertificate = ({ qualification, institution, file }) => {
  fireEvent.click(screen.getByRole('button', { name: /Add certificate/ }));
  const i = screen.getAllByRole('textbox', { name: 'Qualification' }).length - 1;
  if (qualification) fireEvent.change(screen.getAllByRole('textbox', { name: 'Qualification' })[i], { target: { value: qualification } });
  if (institution)   fireEvent.change(screen.getAllByRole('textbox', { name: 'Institution' })[i],   { target: { value: institution } });
  if (file)          fireEvent.change(screen.getAllByLabelText('Certificate file')[i],              { target: { files: [file] } });
};

const pdf = (name) => new File(['pdf'], name, { type: 'application/pdf' });

// Each case renders the whole HR page; adding two certificates took 6.8s once
// the full suite was running in parallel, past Vitest's 5s default.
describe('HR academic certificates', { timeout: 20000 }, () => {
  beforeEach(() => {
    db.updates.length = 0;
    db.uploads.length = 0;
    db.migrated = true;
    db.employees = [{ ...baseEmployee, academic_certificates: [] }];
  });

  it('uploads several certificates into the employee folder and records each one', async () => {
    await openEditForm();
    addCertificate({ qualification: 'BCom (Accounting)', institution: 'University of Nairobi', file: pdf('bcom cert.pdf') });
    addCertificate({ qualification: 'CPA (K)',           institution: 'KASNEB',                file: pdf('cpa.pdf') });

    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(db.updates).toHaveLength(1));

    expect(db.uploads.map(u => u.bucket)).toEqual(['employee-documents', 'employee-documents']);
    expect(db.uploads[0].path).toMatch(/^emp-1\/academic_certificate_\d+_bcom_cert\.pdf$/);
    expect(db.uploads[1].path).toMatch(/^emp-1\/academic_certificate_\d+_cpa\.pdf$/);

    const certs = db.updates[0].payload.academic_certificates;
    expect(certs).toHaveLength(2);
    expect(certs[0]).toMatchObject({
      qualification: 'BCom (Accounting)', institution: 'University of Nairobi', file_name: 'bcom cert.pdf',
    });
    expect(certs[0].url).toContain('/employee-documents/emp-1/academic_certificate_');
    expect(certs[1]).toMatchObject({ qualification: 'CPA (K)', institution: 'KASNEB' });
  });

  it('keeps stored certificates on save and drops one that was removed', async () => {
    db.employees = [{
      ...baseEmployee,
      academic_certificates: [
        { url: STORED, qualification: 'KCSE', institution: 'Alliance Girls High School', file_name: 'kcse.pdf' },
        { url: `${STORED}-2`, qualification: 'Diploma in IT', institution: 'KCA University', file_name: 'dip.pdf' },
      ],
    }];
    await openEditForm();
    expect(screen.getByText('Alliance Girls High School')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Diploma in IT' }));
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(db.updates).toHaveLength(1));

    expect(db.uploads).toHaveLength(0);
    expect(db.updates[0].payload.academic_certificates).toEqual([
      { url: STORED, qualification: 'KCSE', institution: 'Alliance Girls High School', file_name: 'kcse.pdf' },
    ]);
  });

  it('refuses a half-filled certificate but ignores a blank one', async () => {
    await openEditForm();
    addCertificate({});                                                   // left blank
    addCertificate({ qualification: 'BSc Nursing', file: pdf('bsc.pdf') }); // no institution

    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    expect(await screen.findByText(/Each certificate needs a qualification, an institution and a file/)).toBeInTheDocument();
    expect(db.updates).toHaveLength(0);

    fireEvent.change(screen.getAllByRole('textbox', { name: 'Institution' })[1], { target: { value: 'Moi University' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(db.updates).toHaveLength(1));
    expect(db.updates[0].payload.academic_certificates).toHaveLength(1);
  });

  it('still saves on a database without the certificates column, and does not name it', async () => {
    db.migrated = false;
    db.employees = [{ ...baseEmployee }]; // what the fallback column tier returns
    await openEditForm();

    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(db.updates).toHaveLength(1));
    expect(db.updates[0].payload).not.toHaveProperty('academic_certificates');
  });

  it('lists certificates in the detail drawer and on the Documents tab', async () => {
    db.employees = [{
      ...baseEmployee,
      academic_certificates: [{ url: STORED, qualification: 'KCSE', institution: 'Alliance Girls High School' }],
    }];
    render(<HRPage />);

    fireEvent.click(await screen.findByText('Jane Wanjiru'));
    const section = screen.getByText('Academic Certificates', { selector: 'p' }).parentElement;
    expect(within(section).getByText('KCSE')).toBeInTheDocument();
    expect(within(section).getByText('Alliance Girls High School')).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: /View/ })).toBeInTheDocument();
    const drawerButtons = within(section.closest('.fixed')).getAllByRole('button');
    fireEvent.click(drawerButtons[drawerButtons.length - 1]);
    await waitFor(() => expect(screen.queryByText('Academic Certificates', { selector: 'p' })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Documents/ }));
    expect(await screen.findByRole('columnheader', { name: 'Certificates' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /KCSE/ })).toBeInTheDocument();
  });
});
