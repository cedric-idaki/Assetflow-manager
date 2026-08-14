import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../lib/supabase', () => ({ supabase: { auth: {} } }));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'agent-1' } }) }));

import CreateSaccoModal from './CreateSaccoModal';

const open = () => render(
  <CreateSaccoModal isOpen onClose={vi.fn()} agentProfile={{ id: 'a1' }} onSuccess={vi.fn()} />
);

// The labels aren't htmlFor-linked, so find each select by its placeholder option.
const selectWithOption = (text) =>
  screen.getAllByRole('combobox').find(s => within(s).queryByText(text));

describe('CreateSaccoModal county → location cascade', () => {
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
    await user.type(screen.getByPlaceholderText('e.g. Umoja Savings Sacco'), 'Umoja Sacco');
    await user.type(screen.getByPlaceholderText('e.g. CS/2024/001'), 'CS/2024/001');
    await user.type(screen.getByPlaceholderText('e.g. Jane Mwangi'), 'Jane Mwangi');
    await user.type(screen.getByPlaceholderText('admin@sacco.co.ke'), 'jane@sacco.co.ke');
    await user.type(screen.getByPlaceholderText('+254 7XX XXX XXX'), '0712345678');

    await user.click(screen.getByRole('button', { name: /Next/i }));
    expect(screen.getByText('Select the county')).toBeInTheDocument();
    expect(screen.getByText('Location is required')).toBeInTheDocument();

    await user.selectOptions(selectWithOption('Select county'), 'Nairobi');
    await user.selectOptions(selectWithOption('Select location'), 'Westlands');
    await user.click(screen.getByRole('button', { name: /Next/i }));
    expect(screen.queryByText('Select the county')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g. 40')).toBeInTheDocument();
  });
});
