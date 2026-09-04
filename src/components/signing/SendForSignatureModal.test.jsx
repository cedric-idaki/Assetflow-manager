import { describe, it, expect } from 'vitest';
import { withPins } from './SendForSignatureModal';
import { GUARANTOR_ROLE, cleanPanel } from '../../utils/certificateSigning';

/**
 * The pin merge is what stops a guarantee agreement being sent to the wrong
 * person, or being sent without the guarantor on it at all.
 *
 * Every case below is a way the panel could end up not containing the member
 * who is actually bound — which would produce a document signed by the
 * society's officer alone, released as "executed", and worth nothing.
 */
describe('withPins', () => {
  const guarantor = {
    role: GUARANTOR_ROLE, name: 'Jane Wanjiru', email: 'jane@example.com', order: 1, required: true,
  };

  it('leaves a panel alone when nothing is pinned', () => {
    const rows = [{ role: 'Chairperson', name: '', email: '', order: 1 }];
    expect(withPins(rows, [])).toBe(rows);
    expect(withPins(rows, undefined)).toBe(rows);
  });

  it('fills the stored row for that role rather than adding a second one', () => {
    // The society saved a Guarantor line with a placeholder email. The pin must
    // win: that address is read from the member register, not typed by staff.
    const rows = [
      { role: 'Guarantor', name: 'Whoever', email: 'placeholder@example.com', order: 1 },
      { role: 'Authorised Officer', name: 'M. Otieno', email: 'officer@sacco.co.ke', order: 2 },
    ];
    const merged = withPins(rows, [guarantor]);

    expect(merged.filter((r) => r.role === GUARANTOR_ROLE)).toHaveLength(1);
    expect(merged[0]).toMatchObject({ email: 'jane@example.com', name: 'Jane Wanjiru', pinned: true });
    expect(merged[1]).toMatchObject({ role: 'Authorised Officer', email: 'officer@sacco.co.ke' });
    expect(merged[1].pinned).toBeUndefined();
  });

  it('matches the role case-insensitively', () => {
    const merged = withPins([{ role: 'GUARANTOR', name: '', email: '', order: 1 }], [guarantor]);
    expect(merged).toHaveLength(1);
    expect(merged[0].email).toBe('jane@example.com');
  });

  it('adds the pinned signatory when the society never listed one', () => {
    // A society whose standing panel is just its own officer still has to send
    // the agreement to the guarantor.
    const merged = withPins([{ role: 'Secretary', name: '', email: 's@sacco.co.ke', order: 1 }], [guarantor]);
    expect(merged).toHaveLength(2);
    expect(merged.some((r) => r.role === GUARANTOR_ROLE && r.pinned)).toBe(true);
  });

  it('orders by the pin\'s own order and renumbers from one', () => {
    const merged = withPins(
      [{ role: 'Authorised Officer', name: '', email: 'o@sacco.co.ke', order: 1 }],
      [guarantor],
    );
    expect(merged.map((r) => r.role)).toEqual([GUARANTOR_ROLE, 'Authorised Officer']);
    expect(merged.map((r) => r.order)).toEqual([1, 2]);
  });

  it('keeps a pinned row with no email in the panel so the screen can refuse', () => {
    // Dropping it silently is the failure this exists to prevent: cleanPanel
    // would discard it, the send would succeed with the officer alone, and the
    // society would hold an "executed" agreement the guarantor never signed.
    const merged = withPins(
      [{ role: 'Authorised Officer', name: '', email: 'o@sacco.co.ke', order: 2 }],
      [{ ...guarantor, email: '' }],
    );
    const pinned = merged.find((r) => r.role === GUARANTOR_ROLE);
    expect(pinned).toBeTruthy();
    expect(pinned.required).toBe(true);
    // The panel the RPC would receive is missing them — which is exactly why
    // the modal blocks on `missingPin` before it ever gets here.
    expect(cleanPanel(merged).some((r) => r.role === GUARANTOR_ROLE)).toBe(false);
  });
});
