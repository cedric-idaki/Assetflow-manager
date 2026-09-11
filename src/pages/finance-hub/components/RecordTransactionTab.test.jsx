/**
 * The simplified composer, driven the way a user drives it.
 *
 * transactionRecipes.test.js proves the recipes produce the right double
 * entry. That is only half the promise: the other half is that this screen
 * never puts a debit or a credit in front of the user before they ask for one,
 * and that what it eventually hands `postJournalEntry` is exactly what the
 * plain-English readback said it would be. Both are properties of the
 * COMPONENT, so they are tested through the rendered DOM rather than through
 * the pure layer underneath it.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import RecordTransactionTab from './RecordTransactionTab';

const CHART = [
  { id: 'a', account_code: '1000', account_name: 'Cash at Bank',      account_type: 'current_asset',     category: 'Cash' },
  { id: 'b', account_code: '1001', account_name: 'M-Pesa Till',       account_type: 'current_asset',     category: 'Cash' },
  { id: 'c', account_code: '1100', account_name: 'Trade Receivables', account_type: 'current_asset',     category: 'Receivables' },
  { id: 'd', account_code: '1300', account_name: 'Input VAT',         account_type: 'current_asset',     category: 'Other' },
  { id: 'e', account_code: '2000', account_name: 'Trade Payables',    account_type: 'current_liability', category: 'Payables' },
  { id: 'f', account_code: '2100', account_name: 'VAT Payable',       account_type: 'current_liability', category: 'Statutory' },
  { id: 'g', account_code: '4000', account_name: 'Sales Revenue',     account_type: 'revenue',           category: 'Sales' },
  { id: 'h', account_code: '6000', account_name: 'Rent',              account_type: 'operating_expense', category: 'Overhead' },
];

// The hub renders one toast node for the whole page; without it `toast` is a
// no-op, which is fine, but the tests read nothing from it either way.
const setup = (props = {}) => {
  const onPost = vi.fn().mockResolvedValue({});
  const onAddAccount = vi.fn();
  const utils = render(
    <RecordTransactionTab
      chartOfAccounts={CHART}
      loading={false}
      onPost={onPost}
      onAddAccount={onAddAccount}
      {...props}
    />,
  );
  return { onPost, onAddAccount, user: userEvent.setup(), ...utils };
};

beforeEach(() => { vi.clearAllMocks(); });

describe('choosing what happened', () => {
  it('opens on plain-English transactions, never on a debit/credit grid', () => {
    setup();
    expect(screen.getByText('I paid a running cost')).toBeInTheDocument();
    expect(screen.getByText('I made a sale')).toBeInTheDocument();
    expect(screen.queryByText(/^Debit$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Credit$/)).not.toBeInTheDocument();
  });

  it('groups them by the direction money moves', () => {
    setup();
    expect(screen.getByText('Money coming in')).toBeInTheDocument();
    expect(screen.getByText('Money going out')).toBeInTheDocument();
    expect(screen.getByText('Moving money')).toBeInTheDocument();
  });
});

describe('recording an expense paid from the till', () => {
  const fill = async () => {
    const ctx = setup();
    const { user } = ctx;
    await user.click(screen.getByText('I paid a running cost'));

    await user.type(screen.getByLabelText(/^Amount \(KES\)/), '11600');
    await user.click(screen.getByRole('button', { name: 'Total includes VAT' }));

    await user.selectOptions(screen.getByLabelText(/What was it for\?/i), '6000');
    await user.selectOptions(screen.getByLabelText(/Which account did the money move through\?/i), '1001');
    return ctx;
  };

  it('reads the entry back as sentences, with no debit or credit in sight', async () => {
    await fill();
    expect(await screen.findByText(/KES 10,000 is recorded as a cost in Rent\./)).toBeInTheDocument();
    expect(screen.getByText(/KES 1,600 of VAT becomes reclaimable in Input VAT\./)).toBeInTheDocument();
    expect(screen.getByText(/KES 11,600 leaves M-Pesa Till\./)).toBeInTheDocument();
  });

  it('keeps the accounting view behind a click, for whoever wants it', async () => {
    const { user } = await fill();
    expect(screen.queryByRole('columnheader', { name: 'Debit' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Show the accounting view/i }));
    expect(screen.getByRole('columnheader', { name: 'Debit' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Credit' })).toBeInTheDocument();
  });

  it('posts exactly what the sentences described', async () => {
    const { user, onPost } = await fill();
    await user.click(screen.getByRole('button', { name: /Record this transaction/i }));

    await waitFor(() => expect(onPost).toHaveBeenCalledTimes(1));
    const entry = onPost.mock.calls[0][0];
    expect(entry.entryType).toBe('expense');
    expect(entry.description).toBe('Expense');
    expect(entry.lines).toEqual([
      { account: '6000 — Rent',         debit: 10000, credit: 0 },
      { account: '1300 — Input VAT',    debit: 1600,  credit: 0 },
      { account: '1001 — M-Pesa Till',  debit: 0,     credit: 11600 },
    ]);
  });

  it('resolves the VAT account without ever asking an accounting question', async () => {
    await fill();
    // Input VAT is posted to, but the user is never asked where VAT goes.
    expect(screen.queryByLabelText(/reclaimable VAT/i)).not.toBeInTheDocument();
    expect(screen.getByText(/of VAT becomes reclaimable in Input VAT/)).toBeInTheDocument();
  });

  it('switches to a supplier debt when the bill has not been paid', async () => {
    const { user, onPost } = setup();
    await user.click(screen.getByText('I paid a running cost'));
    await user.click(screen.getByRole('button', { name: 'No, I owe it' }));
    await user.type(screen.getByLabelText(/^Amount \(KES\)/), '10000');
    await user.selectOptions(screen.getByLabelText(/What was it for\?/i), '6000');

    expect(await screen.findByText(/KES 10,000 is now owed by you, held in Trade Payables\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Record this transaction/i }));

    await waitFor(() => expect(onPost).toHaveBeenCalled());
    expect(onPost.mock.calls[0][0].lines).toEqual([
      { account: '6000 — Rent',           debit: 10000, credit: 0 },
      { account: '2000 — Trade Payables', debit: 0,     credit: 10000 },
    ]);
  });
});

describe('recording a sale', () => {
  it('splits VAT out of the takings and owes it to KRA', async () => {
    const { user, onPost } = setup();
    await user.click(screen.getByText('I made a sale'));
    await user.type(screen.getByLabelText(/^Amount \(KES\)/), '11600');
    await user.click(screen.getByRole('button', { name: 'Total includes VAT' }));
    await user.type(screen.getByLabelText(/Customer/i), 'Grace Wanjiru');

    expect(await screen.findByText(/KES 1,600 of VAT is now owed to KRA in VAT Payable\./)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Record this transaction/i }));
    await waitFor(() => expect(onPost).toHaveBeenCalled());

    const entry = onPost.mock.calls[0][0];
    expect(entry.description).toBe('Sale — Grace Wanjiru');
    expect(entry.entryType).toBe('revenue');
    expect(entry.lines).toEqual([
      { account: '1000 — Cash at Bank',  debit: 11600, credit: 0 },
      { account: '4000 — Sales Revenue', debit: 0,     credit: 10000 },
      { account: '2100 — VAT Payable',   debit: 0,     credit: 1600 },
    ]);
  });

  it('records a debt instead of cash when the customer has not paid', async () => {
    const { user } = setup();
    await user.click(screen.getByText('I made a sale'));
    await user.click(screen.getByRole('button', { name: 'No, they owe me' }));
    await user.type(screen.getByLabelText(/^Amount \(KES\)/), '10000');

    expect(await screen.findByText(/KES 10,000 is now owed to you, held in Trade Receivables\./)).toBeInTheDocument();
    expect(screen.queryByText(/arrives in Cash at Bank/)).not.toBeInTheDocument();
  });
});

describe('when the chart of accounts cannot answer the question', () => {
  const NO_BANK = CHART.filter((a) => a.category !== 'Cash');

  it('offers to create the missing account instead of dead-ending', async () => {
    const onAddAccount = vi.fn().mockResolvedValue({ account_code: '1000', account_name: 'Cash at Bank' });
    const user = userEvent.setup();
    render(
      <RecordTransactionTab
        chartOfAccounts={NO_BANK} loading={false}
        onPost={vi.fn()} onAddAccount={onAddAccount}
      />,
    );

    await user.click(screen.getByText('I paid a running cost'));
    const create = await screen.findByRole('button', { name: /Create "1000 — Cash at Bank"/ });
    await user.click(create);

    await waitFor(() => expect(onAddAccount).toHaveBeenCalledTimes(1));
    expect(onAddAccount.mock.calls[0][0]).toMatchObject({
      account_code: '1000', account_name: 'Cash at Bank',
      account_type: 'current_asset', category: 'Cash',
    });
  });

  it('says so up front when the chart is completely empty', () => {
    render(
      <RecordTransactionTab chartOfAccounts={[]} loading={false} onPost={vi.fn()} onAddAccount={vi.fn()} />,
    );
    expect(screen.getByText('Your chart of accounts is empty')).toBeInTheDocument();
    // and still lets them start, rather than blocking the tab
    expect(screen.getByText('I made a sale')).toBeInTheDocument();
  });
});

describe('a loan repayment', () => {
  const WITH_LOAN = [
    ...CHART,
    { id: 'i', account_code: '2500', account_name: 'Bank Loan',        account_type: 'current_liability', category: 'Other' },
    { id: 'j', account_code: '6900', account_name: 'Interest Expense', account_type: 'operating_expense', category: 'Overhead' },
  ];

  it('costs only the interest, and says which part is which', async () => {
    const onPost = vi.fn().mockResolvedValue({});
    const user = userEvent.setup();
    render(
      <RecordTransactionTab chartOfAccounts={WITH_LOAN} loading={false} onPost={onPost} onAddAccount={vi.fn()} />,
    );

    await user.click(screen.getByText('I made a loan repayment'));
    await user.type(screen.getByLabelText(/^Amount \(KES\)/), '25000');
    await user.type(screen.getByLabelText(/How much of that was interest\?/i), '4000');

    expect(await screen.findByText(/KES 21,000 is paid off the loan in Bank Loan\./)).toBeInTheDocument();
    expect(screen.getByText(/KES 4,000 is the cost of borrowing, recorded in Interest Expense\./)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Record this transaction/i }));
    await waitFor(() => expect(onPost).toHaveBeenCalled());
    expect(onPost.mock.calls[0][0].lines).toEqual([
      { account: '2500 — Bank Loan',        debit: 21000, credit: 0 },
      { account: '6900 — Interest Expense', debit: 4000,  credit: 0 },
      { account: '1000 — Cash at Bank',     debit: 0,     credit: 25000 },
    ]);
  });
});

describe('guard rails', () => {
  it('shows no post button until there is an amount', async () => {
    const { user } = setup();
    await user.click(screen.getByText('I made a sale'));
    expect(screen.queryByRole('button', { name: /Record this transaction/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Enter an amount to see what will be recorded/i)).toBeInTheDocument();
  });

  it('goes back to the menu without posting anything', async () => {
    const { user, onPost } = setup();
    await user.click(screen.getByText('I made a sale'));
    await user.type(screen.getByLabelText(/^Amount \(KES\)/), '5000');
    await user.click(screen.getByRole('button', { name: /Something else/i }));

    expect(screen.getByText('I paid a running cost')).toBeInTheDocument();
    expect(onPost).not.toHaveBeenCalled();
  });

  it('returns to the menu after a successful post, ready for the next one', async () => {
    const { user, onPost } = setup();
    await user.click(screen.getByText('I made a sale'));
    await user.type(screen.getByLabelText(/^Amount \(KES\)/), '5000');
    await user.click(screen.getByRole('button', { name: /Record this transaction/i }));

    await waitFor(() => expect(onPost).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('I paid a running cost')).toBeInTheDocument());
  });

  it('leaves the form intact when posting fails, so nothing is retyped', async () => {
    const onPost = vi.fn().mockRejectedValue(new Error('Row level security'));
    const user = userEvent.setup();
    render(
      <RecordTransactionTab chartOfAccounts={CHART} loading={false} onPost={onPost} onAddAccount={vi.fn()} />,
    );
    await user.click(screen.getByText('I made a sale'));
    await user.type(screen.getByLabelText(/^Amount \(KES\)/), '5000');
    await user.click(screen.getByRole('button', { name: /Record this transaction/i }));

    await waitFor(() => expect(onPost).toHaveBeenCalled());
    expect(screen.getByLabelText(/^Amount \(KES\)/)).toHaveValue(5000);
  });
});
