import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import LinkAssetClientModal from './LinkAssetClientModal';

// The page hands this modal its mapped rows, where `id` is the human-facing
// code and `_id` the database UUID. Keeping the two visibly different here is
// the point of these tests: `assets.linked_client_id` is a UUID foreign key, and
// the modal used to emit the account number instead.
const ASSET = {
  _id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  id: 'AST-1712345678',
  type: 'vehicle',
  description: '2022 Toyota Land Cruiser',
  sellingPrice: 8500000,
  status: 'available',
};

const CLIENT = {
  _id: 'cccccccc-2222-4222-8222-cccccccccccc',
  id: 'ACC-0001',
  accountNumber: 'ACC-0001',
  fullName: 'Jane Wanjiru',
  email: 'jane@example.com',
};

// Shadcn-style Select: the trigger takes its accessible name from the field
// label, so click that, then the option row — skipping the sr-only native
// <option> that mirrors it.
const choose = (fieldLabel, optionLabel) => {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(fieldLabel, 'i') }));
  fireEvent.click(screen.getAllByText(optionLabel).find(el => el.tagName !== 'OPTION'));
};

describe('LinkAssetClientModal', () => {
  it('emits both database UUIDs when linking a client from an asset', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <LinkAssetClientModal
        type="asset"
        subject={ASSET}
        clients={[CLIENT]}
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('2022 Toyota Land Cruiser')).toBeInTheDocument();
    expect(screen.getByText(`ID: ${ASSET.id}`)).toBeInTheDocument();

    choose('select client', 'Jane Wanjiru (ACC-0001)');
    fireEvent.click(screen.getByRole('button', { name: /link client/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(ASSET._id, CLIENT._id));
  });

  it('emits the same two ids in the same order when linking an asset from a client', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <LinkAssetClientModal
        type="client"
        subject={CLIENT}
        assets={[ASSET]}
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Jane Wanjiru')).toBeInTheDocument();
    expect(screen.getByText(`Account: ${CLIENT.accountNumber}`)).toBeInTheDocument();

    choose('select asset', '2022 Toyota Land Cruiser (AST-1712345678)');
    fireEvent.click(screen.getByRole('button', { name: /link asset/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(ASSET._id, CLIENT._id));
  });

  it('shows a failed link instead of closing over it', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Access denied.'));

    render(
      <LinkAssetClientModal
        type="asset"
        subject={ASSET}
        clients={[CLIENT]}
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />
    );

    choose('select client', 'Jane Wanjiru (ACC-0001)');
    fireEvent.click(screen.getByRole('button', { name: /link client/i }));

    expect(await screen.findByText('Access denied.')).toBeInTheDocument();
  });

  it('refuses to submit with nothing selected', async () => {
    const onSubmit = vi.fn();

    render(
      <LinkAssetClientModal
        type="asset"
        subject={ASSET}
        clients={[CLIENT]}
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /link client/i }));

    expect(await screen.findByText('Please select a client')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
