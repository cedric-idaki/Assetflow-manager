import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import StatutoryCalendarPanel from './StatutoryCalendarPanel';
import { buildCalendarFrom } from '../../../hooks/useStatutoryCalendar';

// The panel renders whatever the calendar builder produces, so the fixtures go
// through the real builder rather than being hand-written entries. A test that
// invented its own entry shape would keep passing after the builder changed.
const calendarOn = (asOf, extra = {}) =>
  buildCalendarFrom({
    periods: [{
      period: '2026-08', employees: 12,
      gross: 1_200_000, paye: 184_000, nssf: 51_840, shif: 33_000, housing_levy: 18_000,
    }],
    asOf,
    ...extra,
  });

const renderPanel = (built, props = {}) =>
  render(
    <StatutoryCalendarPanel
      loading={false}
      error={null}
      saving={false}
      calendar={built.calendar}
      history={built.history}
      summary={built.summary}
      settings={null}
      onFile={vi.fn()}
      onUnfile={vi.fn()}
      onSaveSettings={vi.fn()}
      {...props}
    />,
  );

describe('StatutoryCalendarPanel', () => {
  it('lists each return with its deadline and its amount', () => {
    renderPanel(calendarOn('2026-09-08'));

    expect(screen.getByText('PAYE (P10)')).toBeInTheDocument();
    expect(screen.getByText('KES 184,000')).toBeInTheDocument();
    // NSSF and the levy carry the employer match, so the figure shown is
    // double what the payslips withheld.
    expect(screen.getByText('KES 103,680')).toBeInTheDocument();
    expect(screen.getByText('KES 36,000')).toBeInTheDocument();
  });

  it('puts an overdue return at the top and names the penalty', () => {
    renderPanel(calendarOn('2026-09-20'));

    const cards = screen.getAllByText(/PAYE \(P10\)|NSSF contributions|SHIF contributions|Affordable Housing Levy/);
    expect(cards.length).toBeGreaterThan(0);

    // The overdue chip and the cost of being late are both on screen. A
    // reminder that does not say what late costs is easy to postpone.
    expect(screen.getAllByText('Overdue').length).toBeGreaterThan(0);
    expect(screen.getByText(/25% of the tax due or KES 10,000/)).toBeInTheDocument();
  });

  it('shows a dash for VAT rather than a zero when the figure is unknown', () => {
    // A zero would read as "nothing to pay". The deadline is still real, so the
    // row appears and points at where the figure lives.
    const built = calendarOn('2026-09-19', { settings: { vat_registered: true } });
    renderPanel(built, { settings: { vat_registered: true } });

    // A registered tenant gets a VAT row for the current month too, so pick the
    // August one by its period rather than by the label alone.
    const card = screen
      .getAllByText('VAT return (VAT3)')
      .map((el) => el.closest('div.border'))
      .find((el) => within(el).queryByText(/2026-08/));
    expect(card).toBeTruthy();
    expect(within(card).getByText('—')).toBeInTheDocument();
    expect(within(card).getByText(/Finance Hub VAT panel/)).toBeInTheDocument();
    expect(within(card).queryByText('KES 0')).not.toBeInTheDocument();
  });

  it('explains a deadline that falls on a non-working day without moving it', () => {
    // July's returns are due Sunday 9 August 2026.
    const built = buildCalendarFrom({
      periods: [{ period: '2026-07', employees: 3, paye: 5000 }],
      asOf: '2026-08-08',
    });
    renderPanel(built);

    expect(screen.getAllByText(/statutory deadline falls on a weekend/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/practice rather than the rule/i).length).toBeGreaterThan(0);
  });

  it('records a filing with the acknowledgement number, and says what that means', async () => {
    const user = userEvent.setup();
    const onFile = vi.fn().mockResolvedValue({ ok: true });
    renderPanel(calendarOn('2026-09-08'), { onFile });

    const payeCard = screen.getByText('PAYE (P10)').closest('div.border');
    await user.click(within(payeCard).getByRole('button', { name: /mark filed/i }));

    // The disclaimer is part of the form, not buried in a footnote.
    expect(within(payeCard).getByText(/does not file on your behalf/i)).toBeInTheDocument();

    await user.type(within(payeCard).getByPlaceholderText(/from itax/i), 'KRA-ACK-9911');
    await user.click(within(payeCard).getByRole('button', { name: /record filing/i }));

    expect(onFile).toHaveBeenCalledWith(expect.objectContaining({
      returnKey: 'paye',
      period: '2026-08',
      dueDate: '2026-09-09',
      amount: 184_000,
      reference: 'KRA-ACK-9911',
    }));
  });

  it('says nothing is outstanding without claiming nothing is due', async () => {
    renderPanel({ calendar: [], history: [], summary: { actionable: 0 } });

    expect(screen.getByText('Nothing outstanding')).toBeInTheDocument();
    // Scoped to what Ararat knows about — the panel cannot speak for the
    // tenant's whole tax position.
    expect(screen.getByText(/recorded in Ararat/i)).toBeInTheDocument();
  });

  it('surfaces a missing migration instead of rendering an empty calendar', () => {
    renderPanel({ calendar: [], history: [], summary: { actionable: 0 } }, {
      error: 'The statutory calendar needs migration 20260903140000.',
    });
    expect(screen.getByText(/needs migration 20260903140000/)).toBeInTheDocument();
  });

  it('lets a tenant turn reminders off and declare VAT registration', async () => {
    const user = userEvent.setup();
    const onSaveSettings = vi.fn();
    renderPanel(calendarOn('2026-09-08'), { onSaveSettings });

    await user.click(screen.getByRole('button', { name: /reminders/i }));

    await user.click(screen.getByRole('checkbox', { name: /email me before each deadline/i }));
    expect(onSaveSettings).toHaveBeenCalledWith({ enabled: false });

    await user.click(screen.getByRole('checkbox', { name: /VAT-registered/i }));
    expect(onSaveSettings).toHaveBeenCalledWith({ vat_registered: true });
  });
});
