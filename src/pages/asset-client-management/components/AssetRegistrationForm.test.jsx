/**
 * The asset form's structured size and warranty fields.
 *
 * TWO THINGS ARE WORTH A TEST HERE AND THE REST IS NOT.
 *
 *   1. THE LEGACY PARSE. Property records written before land and building
 *      sizes were separate carry one free-text string — "0.5 acres",
 *      "2,500 sq ft". Editing one of those must recover the number and the
 *      unit rather than blanking the field, because a blank field that is then
 *      saved is SILENT DATA LOSS on somebody's listing. That is the failure
 *      this file exists to catch.
 *
 *   2. THE CONDITIONAL WARRANTY. Warranty terms are asked for only when the
 *      status says there is a warranty, and turning the status back off has to
 *      clear the terms rather than hide them. A hidden field that still saves
 *      its old value is how a listing ends up advertising cover that was
 *      removed.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import AssetRegistrationForm, {
  formatMeasure, parseLegacySize, parseLegacyBedsBaths, LAND_UNITS, BUILDING_UNITS,
} from './AssetRegistrationForm';

vi.mock('../../../lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));

describe('formatMeasure', () => {
  it('joins a figure to its unit', () => {
    expect(formatMeasure('0.5', 'Acres')).toBe('0.5 Acres');
    expect(formatMeasure(2500, 'Square Feet')).toBe('2500 Square Feet');
  });

  it('gives nothing back for nothing, rather than a bare unit', () => {
    expect(formatMeasure('', 'Acres')).toBe('');
    expect(formatMeasure(null, 'Acres')).toBe('');
    expect(formatMeasure('   ', 'Acres')).toBe('');
  });
});

describe('parseLegacySize', () => {
  it('recovers acres from the old free-text land size', () => {
    expect(parseLegacySize('0.5 acres', LAND_UNITS)).toEqual({ value: '0.5', unit: 'Acres' });
    expect(parseLegacySize('2 Acres', LAND_UNITS)).toEqual({ value: '2', unit: 'Acres' });
  });

  it('recovers square feet, however they were written, and strips thousands separators', () => {
    ['2,500 sq ft', '2,500 sqft', '2,500 square feet', '2,500 SQ. FT'].forEach(text => {
      expect(parseLegacySize(text, BUILDING_UNITS)).toEqual({ value: '2500', unit: 'Square Feet' });
    });
  });

  it('recovers square metres for either list', () => {
    expect(parseLegacySize('400 sq m', BUILDING_UNITS)).toEqual({ value: '400', unit: 'Square Meters' });
    expect(parseLegacySize('400 square metres', LAND_UNITS)).toEqual({ value: '400', unit: 'Square Meters' });
  });

  it('does not put a building unit on the land field, or the reverse', () => {
    // "2,500 sq ft" is not a land size, so the land field must stay empty and
    // let the user say what the plot is — guessing would invent a figure.
    expect(parseLegacySize('2,500 sq ft', LAND_UNITS)).toBeNull();
    expect(parseLegacySize('0.5 acres', BUILDING_UNITS)).toBeNull();
  });

  it('refuses to guess when there is no number or no unit it knows', () => {
    expect(parseLegacySize('', LAND_UNITS)).toBeNull();
    expect(parseLegacySize('large plot', LAND_UNITS)).toBeNull();
    expect(parseLegacySize('0.5 hectares', LAND_UNITS)).toBeNull();
    expect(parseLegacySize(null, LAND_UNITS)).toBeNull();
  });
});

describe('parseLegacyBedsBaths', () => {
  it('splits the old combined string into two counts', () => {
    expect(parseLegacyBedsBaths('3 Bed / 2 Bath')).toEqual({ bedrooms: '3', bathrooms: '2' });
    expect(parseLegacyBedsBaths('4 bed / 4 bath')).toEqual({ bedrooms: '4', bathrooms: '4' });
  });

  it('takes whichever half is there', () => {
    expect(parseLegacyBedsBaths('6+ Bed')).toEqual({ bedrooms: '6', bathrooms: '' });
  });

  it('gives empties for the values that were never counts', () => {
    expect(parseLegacyBedsBaths('Not Applicable - Land')).toEqual({ bedrooms: '', bathrooms: '' });
    expect(parseLegacyBedsBaths('Studio')).toEqual({ bedrooms: '', bathrooms: '' });
    expect(parseLegacyBedsBaths(undefined)).toEqual({ bedrooms: '', bathrooms: '' });
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

const renderForm = (props = {}) => render(
  <AssetRegistrationForm onSubmit={vi.fn()} onCancel={vi.fn()} {...props} />,
);

/**
 * Open the form already on an asset type.
 *
 * The type picker is the app's own Select, which renders a custom listbox
 * rather than a native <select>, so driving it here would be testing that
 * component instead of these fields. Seeding `editData.type` puts the form in
 * the same state by the route a user editing a record takes.
 */
const formForType = (type, metadata = {}) => renderForm({
  editData: { type, description: 'Test asset', metadata },
});

describe('warranty fields', () => {
  it('asks for warranty terms only once a vehicle is said to have one', async () => {
    const user = userEvent.setup();
    formForType('vehicle');

    expect(screen.getByLabelText(/^warranty$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/warranty details/i)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/^warranty$/i), 'Under Warranty');
    expect(await screen.findByLabelText(/warranty details/i)).toBeInTheDocument();

    // Turning it back off takes the terms away again.
    await user.selectOptions(screen.getByLabelText(/^warranty$/i), 'No Warranty');
    expect(screen.queryByLabelText(/warranty details/i)).not.toBeInTheDocument();
  });

  it('offers the same field on heavy equipment', async () => {
    const user = userEvent.setup();
    formForType('heavy_equipment');

    await user.selectOptions(screen.getByLabelText(/^warranty$/i), 'Under Warranty');
    expect(await screen.findByLabelText(/warranty details/i)).toBeInTheDocument();
  });
});

describe('property sizes', () => {
  it('offers land size in acres or square metres, and building size in feet or metres', () => {
    formForType('property');

    const landUnits = screen.getAllByLabelText('Unit')[0];
    expect([...landUnits.options].map(o => o.value)).toEqual(LAND_UNITS);

    const buildingUnits = screen.getAllByLabelText('Unit')[1];
    expect([...buildingUnits.options].map(o => o.value)).toEqual(BUILDING_UNITS);
  });

  it('counts bedrooms and bathrooms separately', () => {
    formForType('property');

    expect(screen.getByLabelText(/bedrooms/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/bathrooms/i)).toBeInTheDocument();
    // The old combined dropdown is gone: two numbers are filterable, one
    // string is not.
    expect(screen.queryByLabelText(/beds \/ baths/i)).not.toBeInTheDocument();
  });

  it('recovers a legacy size when an old record is opened for editing', async () => {
    renderForm({
      editData: {
        type: 'property',
        description: 'Three bedroom maisonette, Kileleshwa',
        metadata: { propertySize: '0.25 acres', propertyBedsath: '3 Bed / 2 Bath' },
      },
    });

    expect(screen.getByLabelText(/land size/i)).toHaveValue(0.25);
    expect(screen.getAllByLabelText('Unit')[0]).toHaveValue('Acres');
    expect(screen.getByLabelText(/bedrooms/i)).toHaveValue(3);
    expect(screen.getByLabelText(/bathrooms/i)).toHaveValue(2);
  });
});
