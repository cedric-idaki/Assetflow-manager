import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../lib/supabase', () => ({ supabase: { auth: {} } }));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'agent-1' } }) }));

import CreateCompanyModal from './CreateCompanyModal';

const open = () => render(
  <CreateCompanyModal isOpen onClose={vi.fn()} agentProfile={{ id: 'a1' }} onSuccess={vi.fn()} />
);

// The labels aren't htmlFor-linked, so find each select by its placeholder option.
const selectWithOption = (text) =>
  screen.getAllByRole('combobox').find(s => within(s).queryByText(text));

describe('CreateCompanyModal county → location cascade', () => {
  it('disables the location picker until a county is chosen', () => {
    open();
    expect(selectWithOption('Select county')).toBeEnabled();
    expect(selectWithOption('Select county first')).toBeDisabled();
  });

  it('offers the chosen county locations and clears a stale pick on change', async () => {
    const user = userEvent.setup();
    open();
    const county = selectWithOption('Select county');

    await user.selectOptions(county, 'Nairobi');
    const location = selectWithOption('Select location');
    expect(location).toBeEnabled();
    expect(within(location).getByText('Westlands')).toBeInTheDocument();

    await user.selectOptions(location, 'Westlands');
    expect(location).toHaveValue('Westlands');

    await user.selectOptions(county, 'Mombasa');
    expect(location).toHaveValue('');
    expect(within(location).queryByText('Westlands')).not.toBeInTheDocument();
    expect(within(location).getByText('Nyali')).toBeInTheDocument();
  });

  it('blocks step 1 until both county and location are picked', async () => {
    const user = userEvent.setup();
    open();
    await user.type(screen.getByPlaceholderText('e.g. Acme Ltd'), 'Acme Ltd');
    await user.type(screen.getByPlaceholderText('e.g. Jane Mwangi'), 'Jane Mwangi');
    await user.type(screen.getByPlaceholderText('admin@company.com'), 'jane@company.co.ke');
    await user.type(screen.getByPlaceholderText('+254 7XX XXX XXX'), '0712345678');
    await user.selectOptions(selectWithOption('Select gender'), 'male');

    await user.click(screen.getByRole('button', { name: /Next/i }));
    expect(screen.getByText('County is required')).toBeInTheDocument();
    expect(screen.getByText('Location is required')).toBeInTheDocument();

    await user.selectOptions(selectWithOption('Select county'), 'Nairobi');
    await user.selectOptions(selectWithOption('Select location'), 'Westlands');
    await user.click(screen.getByRole('button', { name: /Next/i }));
    expect(screen.queryByText('County is required')).not.toBeInTheDocument();
    expect(screen.getByText('Asset Types Dealt In *')).toBeInTheDocument();
  });
});
