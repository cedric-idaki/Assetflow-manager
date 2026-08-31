import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.fn();

vi.mock('../../../lib/supabase', () => ({
  supabase: { functions: { invoke: (...args) => invoke(...args) } },
}));

const RegistrationForm = (await import('./RegistrationForm')).default;

const COMPANY = { name: 'Acme Motors Ltd', city: 'Nairobi' };

const renderForm = (search = '') =>
  render(
    <MemoryRouter initialEntries={[`/user-registration-screen${search}`]}>
      <Routes>
        <Route path="/user-registration-screen" element={<RegistrationForm />} />
        <Route path="/login" element={<div>Sign-in screen</div>} />
      </Routes>
    </MemoryRouter>,
  );

/** Fill everything the second step requires, leaving the agent code alone. */
const fillDetails = async (user) => {
  await user.type(screen.getByPlaceholderText('As it appears on your ID'), 'Grace Wanjiru');
  await user.type(screen.getByPlaceholderText('you@example.com'), 'grace@example.com');
  await user.type(screen.getByPlaceholderText('Create a strong password'), 'Str0ng!Pass');
  await user.type(screen.getByPlaceholderText('Re-enter your password'), 'Str0ng!Pass');
  await user.click(screen.getByRole('checkbox'));
};

const registerResponse = (over = {}) => ({
  data: {
    accountNumber: 'AF-2026-004417',
    acquisitionChannel: 'direct',
    agentName: null,
    company: COMPANY,
    status: 'pending',
    ...over,
  },
  error: null,
});

beforeEach(() => {
  invoke.mockReset();
});

describe('finding out whose client you are becoming', () => {
  it('asks for a registration code before anything else', () => {
    // A name and a password with no tenant behind them is exactly the orphaned
    // account this page used to produce, so there is nothing useful to ask
    // until the code resolves.
    renderForm();

    expect(screen.getByPlaceholderText('K7M2PQR4')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('you@example.com')).not.toBeInTheDocument();
  });

  it('resolves a code carried in the link without the client typing it', async () => {
    invoke.mockResolvedValueOnce({ data: { company: COMPANY }, error: null });

    renderForm('?code=K7M2PQR4');

    expect(await screen.findByText('Acme Motors Ltd · Nairobi')).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('register-client', {
      body: { action: 'resolve', code: 'K7M2PQR4' },
    });
  });

  it('shows the server wording for a code that does not resolve', async () => {
    // The server answers a wrong code and a company with self-signup switched
    // off identically, on purpose. The page passes that wording through rather
    // than inventing its own, which would leak the difference.
    invoke.mockResolvedValueOnce({
      data: null,
      error: { context: { json: async () => ({ error: 'That registration code was not recognised.' }) } },
    });

    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByPlaceholderText('K7M2PQR4'), 'BADCODE1');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByText('That registration code was not recognised.')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('you@example.com')).not.toBeInTheDocument();
  });

  it('uppercases what is typed so a code read off a card still matches', async () => {
    invoke.mockResolvedValueOnce({ data: { company: COMPANY }, error: null });

    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByPlaceholderText('K7M2PQR4'), 'k7m2pqr4');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('register-client', {
      body: { action: 'resolve', code: 'K7M2PQR4' },
    }));
  });
});

describe('registering directly, with no sales agent', () => {
  it('sends no agent code and reports the account as direct', async () => {
    invoke
      .mockResolvedValueOnce({ data: { company: COMPANY }, error: null })
      .mockResolvedValueOnce(registerResponse());

    const user = userEvent.setup();
    renderForm('?code=K7M2PQR4');
    await screen.findByText('Acme Motors Ltd · Nairobi');

    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke.mock.calls[1][1].body).toEqual({
      action: 'register',
      code: 'K7M2PQR4',
      fullName: 'Grace Wanjiru',
      email: 'grace@example.com',
      phone: null,
      agentCode: null,
      password: 'Str0ng!Pass',
    });

    expect(await screen.findByText('Directly')).toBeInTheDocument();
  });

  it('never sends a tenant, an agent id or a channel of its own', async () => {
    // Attribution is decided in register_direct_client() from the two codes.
    // If the page could name any of these, a crafted request could pick its own
    // tenant or claim somebody else's agent.
    invoke
      .mockResolvedValueOnce({ data: { company: COMPANY }, error: null })
      .mockResolvedValueOnce(registerResponse());

    const user = userEvent.setup();
    renderForm('?code=K7M2PQR4');
    await screen.findByText('Acme Motors Ltd · Nairobi');

    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    const sent = Object.keys(invoke.mock.calls[1][1].body);
    ['adminId', 'admin_id', 'agentId', 'agent_id', 'acquisitionChannel', 'acquisition_channel', 'role']
      .forEach((forbidden) => expect(sent).not.toContain(forbidden));
  });

  it('says the account is pending rather than implying it is ready to use', async () => {
    invoke
      .mockResolvedValueOnce({ data: { company: COMPANY }, error: null })
      .mockResolvedValueOnce(registerResponse());

    const user = userEvent.setup();
    renderForm('?code=K7M2PQR4');
    await screen.findByText('Acme Motors Ltd · Nairobi');

    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText(/awaiting activation/i)).toBeInTheDocument();
    expect(screen.getByText('AF-2026-004417')).toBeInTheDocument();
  });
});

describe('registering through a sales agent', () => {
  it('carries an agent code out of the link and reports the agent back', async () => {
    invoke
      .mockResolvedValueOnce({ data: { company: COMPANY }, error: null })
      .mockResolvedValueOnce(registerResponse({
        acquisitionChannel: 'agent',
        agentName: 'Peter Otieno',
      }));

    const user = userEvent.setup();
    renderForm('?code=K7M2PQR4&agent=AGT-1042');
    await screen.findByText('Acme Motors Ltd · Nairobi');

    expect(screen.getByPlaceholderText('e.g. AGT-1042')).toHaveValue('AGT-1042');

    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke.mock.calls[1][1].body.agentCode).toBe('AGT-1042');

    expect(await screen.findByText('Through Peter Otieno')).toBeInTheDocument();
  });

  it('surfaces an agent code the server rejects instead of filing it as direct', async () => {
    // Silently dropping an unrecognised agent code is how an agent loses a
    // commission they earned, so the server raises and the page says so.
    invoke
      .mockResolvedValueOnce({ data: { company: COMPANY }, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { context: { json: async () => ({ error: 'That sales agent code was not recognised.' }) } },
      });

    const user = userEvent.setup();
    renderForm('?code=K7M2PQR4&agent=NOPE-1');
    await screen.findByText('Acme Motors Ltd · Nairobi');

    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText('That sales agent code was not recognised.')).toBeInTheDocument();
    // Still on the form, with what they typed intact, so they can correct it.
    expect(screen.getByPlaceholderText('you@example.com')).toHaveValue('grace@example.com');
  });
});

describe('what the form refuses to send', () => {
  it('will not submit a password that fails the policy the server enforces', async () => {
    invoke.mockResolvedValueOnce({ data: { company: COMPANY }, error: null });

    const user = userEvent.setup();
    renderForm('?code=K7M2PQR4');
    await screen.findByText('Acme Motors Ltd · Nairobi');

    await user.type(screen.getByPlaceholderText('As it appears on your ID'), 'Grace Wanjiru');
    await user.type(screen.getByPlaceholderText('you@example.com'), 'grace@example.com');
    await user.type(screen.getByPlaceholderText('Create a strong password'), 'weakpass');
    await user.type(screen.getByPlaceholderText('Re-enter your password'), 'weakpass');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText('Password does not meet all requirements')).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledTimes(1); // the resolve only
  });

  it('will not submit without the terms accepted', async () => {
    invoke.mockResolvedValueOnce({ data: { company: COMPANY }, error: null });

    const user = userEvent.setup();
    renderForm('?code=K7M2PQR4');
    await screen.findByText('Acme Motors Ltd · Nairobi');

    await user.type(screen.getByPlaceholderText('As it appears on your ID'), 'Grace Wanjiru');
    await user.type(screen.getByPlaceholderText('you@example.com'), 'grace@example.com');
    await user.type(screen.getByPlaceholderText('Create a strong password'), 'Str0ng!Pass');
    await user.type(screen.getByPlaceholderText('Re-enter your password'), 'Str0ng!Pass');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText('You must accept the terms of service')).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('will not submit mismatched passwords', async () => {
    invoke.mockResolvedValueOnce({ data: { company: COMPANY }, error: null });

    const user = userEvent.setup();
    renderForm('?code=K7M2PQR4');
    await screen.findByText('Acme Motors Ltd · Nairobi');

    await user.type(screen.getByPlaceholderText('As it appears on your ID'), 'Grace Wanjiru');
    await user.type(screen.getByPlaceholderText('you@example.com'), 'grace@example.com');
    await user.type(screen.getByPlaceholderText('Create a strong password'), 'Str0ng!Pass');
    await user.type(screen.getByPlaceholderText('Re-enter your password'), 'Str0ng!Pas');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
