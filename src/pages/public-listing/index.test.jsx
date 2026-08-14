import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.fn();

vi.mock('../../lib/supabase', () => ({
  supabase: { functions: { invoke: (...args) => invoke(...args) } },
}));

const PublicListingPage = (await import('./index')).default;

const VIEW_RESPONSE = {
  asset: {
    id: 'asset-1',
    reference: 'AST-4821',
    title: '3-Bedroom Apartment — Westlands',
    type: 'property',
    price: 8500000,
    currency: 'KES',
    location: 'Nairobi',
    status: 'available',
    specifications: 'Corner unit with a balcony facing the garden.',
    images: ['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg'],
    specs: [{ label: 'Bedrooms', value: '3' }, { label: 'Size', value: '120 sqm' }],
  },
  agent: { name: 'Jane Doe', phone: '0712345678', email: 'jane@example.com', code: 'AGT-100' },
  company: { name: 'Ararat Properties', phone: null, email: null },
  note: 'Thought of you — the garden is bigger than the photos suggest.',
  addressedTo: 'Alice',
  available: true,
  acceptingEnquiries: true,
};

const renderPage = (token = 'tok_abc123') =>
  render(
    <MemoryRouter initialEntries={[`/listing/${token}`]}>
      <Routes>
        <Route path="/listing/:token" element={<PublicListingPage />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  invoke.mockReset();
});

describe('PublicListingPage', () => {
  it('shows the listing, the agent contact card and the note the agent wrote', async () => {
    invoke.mockResolvedValue({ data: VIEW_RESPONSE, error: null });
    renderPage();

    expect(await screen.findByText('3-Bedroom Apartment — Westlands')).toBeInTheDocument();
    // Matched loosely: the KES symbol Intl emits ("Ksh") varies with the ICU
    // data the runtime was built against, and the digits are the point.
    expect(screen.getByText(/8,500,000/)).toBeInTheDocument();
    expect(screen.getByText('Nairobi')).toBeInTheDocument();
    expect(screen.getByText('120 sqm')).toBeInTheDocument();

    // The agent card is what makes this an attributed link rather than a
    // brochure. The name appears in the card and again in the footer, and the
    // company in the header too — hence getAllByText.
    expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ararat Properties').length).toBeGreaterThan(0);
    expect(screen.getByText(/Thought of you/)).toBeInTheDocument();
    expect(screen.getByText('For Alice')).toBeInTheDocument();
  });

  it('asks the backend for this token, and nothing else', async () => {
    invoke.mockResolvedValue({ data: VIEW_RESPONSE, error: null });
    renderPage('tok_xyz789');

    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(invoke).toHaveBeenCalledWith('listing-public', {
      body: { action: 'view', token: 'tok_xyz789' },
    });
  });

  it('sends an enquiry carrying the token, so the lead lands on the sharing agent', async () => {
    invoke.mockResolvedValueOnce({ data: VIEW_RESPONSE, error: null });
    const user = userEvent.setup();
    renderPage('tok_abc123');

    await screen.findByText('3-Bedroom Apartment — Westlands');

    invoke.mockResolvedValueOnce({
      data: { ok: true, agentName: 'Jane Doe', agentPhone: '0712345678' },
      error: null,
    });

    await user.type(screen.getByPlaceholderText('Your name'), 'Bob Buyer');
    await user.type(screen.getByPlaceholderText('Phone number'), '0722000111');
    await user.click(screen.getByRole('button', { name: /interested/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenLastCalledWith('listing-public', {
        body: {
          action: 'enquire',
          token: 'tok_abc123',
          full_name: 'Bob Buyer',
          phone: '0722000111',
          email: '',
          message: '',
        },
      });
    });

    expect(await screen.findByText(/that's on its way/i)).toBeInTheDocument();
    expect(screen.getByText(/Jane Doe has your details/i)).toBeInTheDocument();
  });

  it('will not submit an enquiry with no way to reply', async () => {
    invoke.mockResolvedValueOnce({ data: VIEW_RESPONSE, error: null });
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('3-Bedroom Apartment — Westlands');
    invoke.mockClear();

    await user.type(screen.getByPlaceholderText('Your name'), 'Bob Buyer');
    await user.click(screen.getByRole('button', { name: /interested/i }));

    expect(await screen.findByText(/phone number or email/i)).toBeInTheDocument();
    // A name with no contact detail is a lead the agent can never call.
    expect(invoke).not.toHaveBeenCalled();
  });

  it('hides the enquiry form once the item is sold', async () => {
    invoke.mockResolvedValue({
      data: { ...VIEW_RESPONSE, available: false, acceptingEnquiries: false },
      error: null,
    });
    renderPage();

    expect(await screen.findByText(/no longer available/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /interested/i })).not.toBeInTheDocument();
  });

  it('passes the server’s own wording through for a withdrawn link', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: { json: async () => ({ error: 'This link has expired or been withdrawn.' }) },
      },
    });
    renderPage();

    expect(await screen.findByText('This link has expired or been withdrawn.')).toBeInTheDocument();
    // Not retryable — trying again cannot un-withdraw a link.
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('turns a transport failure into plain language with a retry', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { message: 'Failed to send a request to the Edge Function' },
    });
    renderPage();

    // A buyer must never be shown the Edge Function's own error string.
    expect(await screen.findByText(/could not reach the listing/i)).toBeInTheDocument();
    expect(screen.queryByText(/Edge Function/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
