import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

import AssetRegistrationForm from './AssetRegistrationForm';

const open = () => render(<AssetRegistrationForm onClose={vi.fn()} onSubmit={vi.fn()} />);

// Asset Type uses the shadcn-style Select: click the trigger, then the option
// row (skipping the sr-only native <option> that mirrors it).
const chooseAssetType = async (user, label) => {
  await user.click(screen.getByRole('button', { name: /asset type/i }));
  const row = screen.getAllByText(label).find(el => el.tagName !== 'OPTION');
  await user.click(row);
};

// Type-specific fields are native selects whose labels aren't htmlFor-linked,
// so find each one by its placeholder option.
const selectWithOption = (text) =>
  screen.getAllByRole('combobox').find(s => within(s).queryByText(text));

const optionsOf = (text) => selectWithOption(text);

describe('AssetRegistrationForm type-specific dropdowns', () => {
  it('offers curated Property / Land options', async () => {
    const user = userEvent.setup();
    open();
    await chooseAssetType(user, 'Property / Land');

    const type = optionsOf('Select Property Type');
    expect(within(type).getByText('Land - Freehold')).toBeInTheDocument();
    expect(within(type).getByText('Agricultural Land')).toBeInTheDocument();
    expect(within(type).getByText('Godown / Warehouse')).toBeInTheDocument();
    expect(within(optionsOf('Select Beds / Baths')).getByText('3 Bed / 2 Bath')).toBeInTheDocument();
  });

  it('offers curated Electronics options', async () => {
    const user = userEvent.setup();
    open();
    await chooseAssetType(user, 'Electronics');

    expect(within(optionsOf('Select Brand')).getByText('Samsung')).toBeInTheDocument();
    expect(within(optionsOf('Select Condition')).getByText('Refurbished')).toBeInTheDocument();
    expect(within(optionsOf('Select Warranty')).getByText('1 Year')).toBeInTheDocument();
    expect(within(optionsOf('Select Color / Finish')).getByText('Space Grey')).toBeInTheDocument();
  });

  it('offers curated Furniture options', async () => {
    const user = userEvent.setup();
    open();
    await chooseAssetType(user, 'Furniture');

    expect(within(optionsOf('Select Category')).getByText('Sofa / Couch')).toBeInTheDocument();
    expect(within(optionsOf('Select Material')).getByText('Mahogany')).toBeInTheDocument();
    expect(within(optionsOf('Select Condition')).getByText('Brand New')).toBeInTheDocument();
  });

  it('offers curated Construction Materials options', async () => {
    const user = userEvent.setup();
    open();
    await chooseAssetType(user, 'Construction Materials');

    expect(within(optionsOf('Select Category')).getByText('Cement')).toBeInTheDocument();
    expect(within(optionsOf('Select Brand / Supplier')).getByText('Bamburi Cement')).toBeInTheDocument();
    expect(within(optionsOf('Select Unit of Measure')).getByText('Bags')).toBeInTheDocument();
    expect(within(optionsOf('Select Grade / Standard')).getByText('Grade 42.5N')).toBeInTheDocument();
  });

  it('cascades Heavy Equipment brand → model and clears a stale model', async () => {
    const user = userEvent.setup();
    open();
    await chooseAssetType(user, 'Heavy Equipment');

    const brand = optionsOf('Select Brand / Make');
    expect(within(brand).getByText('Caterpillar')).toBeInTheDocument();
    expect(optionsOf('Select Brand / Make first')).toBeDisabled();

    await user.selectOptions(brand, 'Caterpillar');
    const model = optionsOf('Select Model');
    expect(model).toBeEnabled();
    expect(within(model).getByText('320D')).toBeInTheDocument();

    await user.selectOptions(model, '320D');
    expect(model).toHaveValue('320D');

    await user.selectOptions(brand, 'Komatsu');
    expect(optionsOf('Select Model')).toHaveValue('');
    expect(within(optionsOf('Select Model')).getByText('PC200-8')).toBeInTheDocument();
  });

  it('falls back to a free-text Model for a brand with no model list', async () => {
    const user = userEvent.setup();
    open();
    await chooseAssetType(user, 'Heavy Equipment');

    await user.selectOptions(optionsOf('Select Brand / Make'), 'Liebherr');
    expect(optionsOf('Select Model')).toBeUndefined();
    expect(screen.getByPlaceholderText('e.g. CAT 320D')).toBeInTheDocument();
  });

  it('keeps the vehicle make → model cascade working', async () => {
    const user = userEvent.setup();
    open();
    await chooseAssetType(user, 'Vehicle / Car Dealer');

    const make = optionsOf('Select Make');
    await user.selectOptions(make, 'Toyota');
    const model = optionsOf('Select Model');
    expect(within(model).getByText('Land Cruiser')).toBeInTheDocument();

    await user.selectOptions(model, 'Land Cruiser');
    await user.selectOptions(make, 'Nissan');
    expect(optionsOf('Select Model')).toHaveValue('');
  });

  it('still allows an unlisted value through "Other…"', async () => {
    const user = userEvent.setup();
    open();
    await chooseAssetType(user, 'Electronics');

    await user.selectOptions(optionsOf('Select Brand'), '__other__');
    const free = screen.getByPlaceholderText('e.g. Samsung, LG, Apple');
    await user.type(free, 'Bruhm Kenya');
    expect(free).toHaveValue('Bruhm Kenya');
  });
});
