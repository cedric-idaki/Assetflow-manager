import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The record's whole job is DEPTH: the lists elsewhere show "7 contacts" and a
// stage, this must show what was actually said. The hook is mocked so these
// assertions are about what reaches the screen, not about Supabase.
const mockRecord = vi.fn();
vi.mock('../../hooks/useCustomerRecord', () => ({
  useCustomerRecord: (...args) => mockRecord(...args),
  default: (...args) => mockRecord(...args),
}));

import CustomerRecord from './CustomerRecord';

const lead = {
  id: 'lead-1',
  full_name: 'Alice Mwangi',
  phone: '+254712345678',
  email: 'alice@example.com',
  stage: 'qualified',
  priority: 'high',
  source: 'referral',
  asset_interest: '3-bedroom apartment in Westlands',
  budget_range: '5,000,000 - 8,000,000',
  kra_pin: 'A012345678Z',
  physical_address: 'Westlands, Nairobi',
  next_of_kin_name: 'John Mwangi',
  next_of_kin_relationship: 'brother',
  next_of_kin_phone: '+254722000000',
  notes: 'Prefers a high floor',
  created_at: '2026-06-12T09:00:00.000Z',
  converted_at: null,
  converted_entity: null,
  converted_ref_id: null,
};

const interaction = (o = {}) => ({
  id: 'i-1',
  interaction_type: 'site_visit',
  direction: 'outbound',
  outcome: 'interested',
  duration_minutes: 45,
  occurred_at: '2026-08-18T10:00:00.000Z',
  summary: 'Walked the 4th floor unit. Loved the balcony, worried about the service charge.',
  next_step: 'Send payment plan PDF before Friday',
  ...o,
});

const emptyRecord = (o = {}) => ({
  interactions: [],
  followUps: [],
  followUpBuckets: { overdue: [], upcoming: [], done: [] },
  client: null,
  payments: [],
  paidTotal: 0,
  outstanding: null,
  subscriptions: [],
  shareLinks: [],
  asset: null,
  summary: { contacts: 0, firstTouchAt: null, lastTouchAt: null, quietDays: null, totalMinutes: 0, inbound: 0 },
  loading: false,
  error: null,
  refetch: vi.fn(),
  ...o,
});

beforeEach(() => {
  mockRecord.mockReset();
  mockRecord.mockReturnValue(emptyRecord());
});

describe('CustomerRecord', () => {
  it('shows the fields the summary lists never had room for', () => {
    render(<CustomerRecord lead={lead} onClose={() => {}} />);

    expect(screen.getByText('Alice Mwangi')).toBeInTheDocument();
    expect(screen.getByText('3-bedroom apartment in Westlands')).toBeInTheDocument();
    expect(screen.getByText('A012345678Z')).toBeInTheDocument();
    expect(screen.getByText('Westlands, Nairobi')).toBeInTheDocument();
    // Next of kin is assembled from three columns into one readable line.
    expect(screen.getByText('John Mwangi (brother) · +254722000000')).toBeInTheDocument();
    expect(screen.getByText('Prefers a high floor')).toBeInTheDocument();
  });

  it('renders the full note of a contact rather than a truncated preview', () => {
    mockRecord.mockReturnValue(emptyRecord({
      interactions: [interaction()],
      summary: { contacts: 1, firstTouchAt: interaction().occurred_at, lastTouchAt: interaction().occurred_at, quietDays: 2, totalMinutes: 45, inbound: 0 },
    }));
    render(<CustomerRecord lead={lead} onClose={() => {}} />);

    expect(screen.getByText(/Loved the balcony, worried about the service charge/)).toBeInTheDocument();
    expect(screen.getByText(/Send payment plan PDF before Friday/)).toBeInTheDocument();
    expect(screen.getByText('Interested')).toBeInTheDocument();
    expect(screen.getByText('45 min total')).toBeInTheDocument();
  });

  it('separates overdue follow-ups from upcoming ones', () => {
    mockRecord.mockReturnValue(emptyRecord({
      followUpBuckets: {
        overdue:  [{ id: 'f1', appointment_type: 'phone_call', scheduled_at: '2026-08-01T09:00:00.000Z' }],
        upcoming: [{ id: 'f2', appointment_type: 'site_visit', scheduled_at: '2026-09-01T09:00:00.000Z' }],
        done:     [],
      },
    }));
    render(<CustomerRecord lead={lead} onClose={() => {}} />);

    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.getByText('Upcoming')).toBeInTheDocument();
  });

  it('shows payments and outstanding balance for a converted client', () => {
    mockRecord.mockReturnValue(emptyRecord({
      client: {
        id: 'c1', account_number: 'AF-2026-000123', client_status: 'active',
        kyc_status: 'verified', outstanding_balance: 250000, total_assets: 1,
      },
      payments: [{ id: 'p1', amount: 150000, payment_method: 'mpesa', payment_status: 'completed', payment_date: '2026-08-01T09:00:00.000Z' }],
      paidTotal: 150000,
      outstanding: 250000,
    }));
    render(<CustomerRecord lead={{ ...lead, converted_entity: 'client', converted_ref_id: 'c1' }} onClose={() => {}} />);

    expect(screen.getByText('AF-2026-000123')).toBeInTheDocument();
    expect(screen.getByText('verified')).toBeInTheDocument();
    // Twice on purpose: once as the "Paid to date" total, once as the payment
    // row it is made of.
    expect(screen.getAllByText('KES 150,000')).toHaveLength(2);
    expect(screen.getByText('KES 250,000')).toBeInTheDocument();
  });

  it('shows subscription standing instead of payments for a converted company', () => {
    // A company-mode lead becomes an independent tenant — its payments are its
    // own and are deliberately not readable here.
    mockRecord.mockReturnValue(emptyRecord({
      subscriptions: [{ id: 's1', plan_name: 'growth', status: 'active', price_paid: 45000, end_date: '2027-01-01T00:00:00.000Z' }],
    }));
    render(<CustomerRecord lead={{ ...lead, converted_entity: 'company', converted_ref_id: 'admin-9' }} onClose={() => {}} />);

    expect(screen.getByText('growth')).toBeInTheDocument();
    expect(screen.getByText('KES 45,000')).toBeInTheDocument();
    expect(screen.queryByText('Paid to date')).not.toBeInTheDocument();
  });

  it('says so when the history could not be read, rather than showing an empty timeline', () => {
    mockRecord.mockReturnValue(emptyRecord({ error: 'Contact history could not be loaded for this record.' }));
    render(<CustomerRecord lead={lead} onClose={() => {}} />);
    expect(screen.getByText(/could not be loaded/)).toBeInTheDocument();
  });

  it('hides the action buttons for a supervisor', () => {
    const { rerender } = render(
      <CustomerRecord lead={lead} onClose={() => {}} onLogInteraction={vi.fn()} onScheduleFollowUp={vi.fn()} />,
    );
    expect(screen.getByText('Log contact')).toBeInTheDocument();

    rerender(
      <CustomerRecord lead={lead} readOnly onClose={() => {}} onLogInteraction={vi.fn()} onScheduleFollowUp={vi.fn()} />,
    );
    expect(screen.queryByText('Log contact')).not.toBeInTheDocument();
    expect(screen.queryByText('Schedule follow-up')).not.toBeInTheDocument();
  });

  it('hands the lead back when the agent acts on it', () => {
    const onLog = vi.fn();
    render(<CustomerRecord lead={lead} onClose={() => {}} onLogInteraction={onLog} />);
    fireEvent.click(screen.getByText('Log contact'));
    expect(onLog).toHaveBeenCalledWith(lead);
  });

  it('renders nothing without a lead', () => {
    const { container } = render(<CustomerRecord lead={null} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
