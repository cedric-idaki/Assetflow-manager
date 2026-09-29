import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const save = vi.fn();
let hookState;

vi.mock('../../../hooks/useTenantBranding', async (importOriginal) => ({
  ...(await importOriginal()),
  useTenantBranding: () => hookState,
}));

const toast = { success: vi.fn(), error: vi.fn() };
vi.mock('../../../components/Toast', () => ({ useToast: () => toast }));

const { default: BrandingTab, validateBrandingForm } = await import('./BrandingTab');

const baseState = () => ({
  raw: {
    admin_id: 'tenant-a', kind: 'company', name: 'Acme Ltd', registration_no: 'PVT-1',
    branding: { motto: 'Built right', phone: '', email: '', website: '', physical_address: '', postal_address: '', kra_pin: '' },
    updated_at: '2026-09-25T08:00:00Z',
  },
  logo: null,
  branding: { motto: 'Built right', phone: '', email: '', website: '', physical_address: '', postal_address: '', kra_pin: '' },
  defaults: { phone: '0700 111 222', email: 'owner@acme.co.ke', physicalAddress: 'Westlands, Nairobi', kraPin: '' },
  loading: false,
  error: '',
  reload: vi.fn(),
  save,
});

beforeEach(() => {
  save.mockReset();
  toast.success.mockReset();
  hookState = baseState();
});

describe('validateBrandingForm', () => {
  const ok = { motto: '', phone: '', email: '', website: '', physicalAddress: '', postalAddress: '', kraPin: '' };

  it('accepts an empty form — every field is optional', () => {
    expect(validateBrandingForm(ok)).toEqual({});
  });

  it('accepts well-formed values', () => {
    expect(validateBrandingForm({
      ...ok, phone: '+254 712 345 678 / 0733 000 000', email: 'info@acme.co.ke',
      website: 'https://www.acme.co.ke/', kraPin: 'P051234567X',
    })).toEqual({});
  });

  it('flags each malformed field', () => {
    const errors = validateBrandingForm({
      ...ok, motto: 'x'.repeat(121), phone: 'call me', email: 'nope', website: 'not a site', kraPin: 'X123',
    });
    expect(Object.keys(errors).sort()).toEqual(['email', 'kraPin', 'motto', 'phone', 'website']);
  });
});

describe('BrandingTab', () => {
  it('shows the registration identity as fixed, and what blank fields fall back to', () => {
    render(<BrandingTab />);
    expect(screen.getByText('Acme Ltd')).toBeInTheDocument();
    expect(screen.getByText('Reg No: PVT-1')).toBeInTheDocument();
    expect(screen.getByText(/print the one from your registration: 0700 111 222/)).toBeInTheDocument();
    expect(screen.getByLabelText('Motto or tagline')).toHaveValue('Built right');
  });

  it('keeps Save off until something changes, then saves the form', async () => {
    save.mockResolvedValue({});
    render(<BrandingTab />);
    const saveBtn = screen.getByRole('button', { name: /Save branding/ });
    expect(saveBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Website'), { target: { value: 'www.acme.co.ke' } });
    fireEvent.change(screen.getByLabelText('KRA PIN'), { target: { value: 'p051234567x' } });
    expect(saveBtn).not.toBeDisabled();
    fireEvent.click(saveBtn);

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({
      form: { motto: 'Built right', website: 'www.acme.co.ke', kraPin: 'P051234567X' },
      newLogo: null,
      removeLogo: false,
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it('refuses to save a malformed field and says why', () => {
    render(<BrandingTab />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'not-an-email' } });
    expect(screen.getByText('That email address does not look right.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save branding/ })).toBeDisabled();
  });

  it('shows the database\'s refusal instead of pretending it saved', async () => {
    save.mockRejectedValue(new Error('Only an administrator can change the business branding.'));
    render(<BrandingTab />);
    fireEvent.change(screen.getByLabelText('Motto or tagline'), { target: { value: 'New motto' } });
    fireEvent.click(screen.getByRole('button', { name: /Save branding/ }));
    expect(await screen.findByText('Only an administrator can change the business branding.')).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('previews the letterhead through the real document markup', () => {
    render(<BrandingTab />);
    const frame = screen.getByTitle('Letterhead preview');
    expect(frame.getAttribute('srcdoc')).toContain('Acme Ltd');
    expect(frame.getAttribute('srcdoc')).toContain('Built right');
    expect(frame.getAttribute('sandbox')).toBe('');
  });

  it('explains when branding is not available yet', () => {
    hookState = { ...baseState(), raw: null, error: 'Branding is not switched on for this system yet.' };
    render(<BrandingTab />);
    expect(screen.getByText('Branding could not be loaded.')).toBeInTheDocument();
  });
});
