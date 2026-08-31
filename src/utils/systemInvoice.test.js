/**
 * Turning a stored billing row into a printable invoice.
 *
 * The rule this file exists to protect: AN INVOICE PRINTS WHAT WAS CHARGED.
 * Rows written after the breakdown migration carry their own split and it is
 * used verbatim. Rows written before it carry only a total, so the components
 * are re-derived — but the derivation is then forced back onto the stored
 * total, because a price change must never rewrite a document a tenant has
 * already paid against.
 */

import { describe, it, expect } from 'vitest';
import { invoiceForSubscription, invoiceForSaccoInvoice } from './systemInvoice';
import { VAT_RATE } from '../config/systemBilling';
import { planForUsers, INSTALLATION_FEE as COMPANY_FEE } from '../config/companyPlans';
import { tierForMembers } from '../config/saccoTiers';

const cents = (n) => Math.round(n * 100) / 100;
const sumLines = (bill) => cents(bill.lines.reduce((s, l) => s + l.amount, 0));
const lineFor = (bill, fragment) => bill.lines.find((l) => l.label.includes(fragment));

// ─────────────────────────────────────────────────────────────────────────────
describe('a row with a stored breakdown is printed verbatim', () => {
  const row = {
    id: 'a', plan_name: 'silver', max_users: 5, status: 'active',
    base_fee: 0, user_fee: 1525, module_fee: 250, installation_fee: 4000,
    subtotal: 5000, vat_rate: 16, vat_amount: 775, price_paid: 5775,
  };

  it('uses the stored subtotal, VAT and total rather than recomputing them', () => {
    const bill = invoiceForSubscription(row);
    expect(bill.subtotal).toBe(5000);
    expect(bill.vatAmount).toBe(775);
    expect(bill.total).toBe(5775);
    expect(bill.vatRate).toBe(16);
  });

  it('itemises every non-zero component it stored', () => {
    const bill = invoiceForSubscription(row);
    expect(lineFor(bill, 'Licensed user charges')).toBeTruthy();
    expect(lineFor(bill, 'Additional modules').gross).toBe(250);
    expect(lineFor(bill, 'Installation').gross).toBe(4000);
    // base_fee is 0 — no line, rather than a KES 0 row nobody can explain.
    expect(lineFor(bill, 'Base system price')).toBeUndefined();
  });

  it('states the per-user rate the stored charge implies', () => {
    const users = lineFor(invoiceForSubscription(row), 'Licensed user charges');
    expect(users.qty).toBe(5);
    expect(users.unit).toBe(305);
  });

  it('nets the lines down so they add up to the stored subtotal', () => {
    const bill = invoiceForSubscription(row);
    expect(sumLines(bill)).toBe(bill.subtotal);
    expect(cents(bill.subtotal + bill.vatAmount)).toBe(bill.total);
  });

  it('survives a stored breakdown that does not divide evenly', () => {
    const odd = { ...row, user_fee: 1523, module_fee: 251, subtotal: 4999.13, vat_amount: 799.87, price_paid: 5799 };
    const bill = invoiceForSubscription(odd);
    expect(sumLines(bill)).toBe(bill.subtotal);
    expect(cents(bill.subtotal + bill.vatAmount)).toBe(bill.total);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('a legacy company row is re-derived from what it paid', () => {
  const monthly = (seats) => seats * planForUsers(seats).pricePerUser;

  it('spots the installation fee folded into a first registration', () => {
    const paid = monthly(5) + COMPANY_FEE;
    const bill = invoiceForSubscription({ id: 'a', plan_name: 'silver', max_users: 5, price_paid: paid });
    expect(lineFor(bill, 'Installation').gross).toBe(COMPANY_FEE);
    expect(bill.total).toBe(paid);
  });

  it('does not invent an installation fee on a renewal row', () => {
    const paid = monthly(5);
    const bill = invoiceForSubscription({ id: 'b', plan_name: 'silver', max_users: 5, price_paid: paid });
    expect(lineFor(bill, 'Installation')).toBeUndefined();
    expect(bill.total).toBe(paid);
    expect(lineFor(bill, 'Licensed user charges').gross).toBe(paid);
  });

  it('discloses the VAT inside a legacy total without changing it', () => {
    const paid = monthly(10) + COMPANY_FEE;
    const bill = invoiceForSubscription({ id: 'c', plan_name: 'bronze', max_users: 10, price_paid: paid });
    expect(bill.total).toBe(paid);
    expect(cents(bill.subtotal + bill.vatAmount)).toBe(paid);
    expect(bill.vatRate).toBe(VAT_RATE);
  });

  it('holds the printed total to what was paid even after a price change', () => {
    // A row priced under an older, cheaper rate card. The components are the
    // best available explanation; the total is a matter of record.
    const paid = 3000;
    const bill = invoiceForSubscription({ id: 'd', plan_name: 'silver', max_users: 5, price_paid: paid });
    expect(bill.total).toBe(paid);
    expect(sumLines(bill)).toBe(bill.subtotal);
    expect(cents(bill.subtotal + bill.vatAmount)).toBe(paid);
  });

  it('adds up at every seat count, first registration or renewal', () => {
    const broken = Array.from({ length: 60 }, (_, i) => i + 1).flatMap((n) => [
      { n, kind: 'reg', bill: invoiceForSubscription({ id: `r${n}`, plan_name: planForUsers(n).id, max_users: n, price_paid: monthly(n) + COMPANY_FEE }) },
      { n, kind: 'renew', bill: invoiceForSubscription({ id: `n${n}`, plan_name: planForUsers(n).id, max_users: n, price_paid: monthly(n) }) },
    ]).filter(({ bill }) => sumLines(bill) !== bill.subtotal || cents(bill.subtotal + bill.vatAmount) !== bill.total);
    expect(broken).toEqual([]);
  });

  it('does not fall over on a zero or missing total', () => {
    [{ id: 'e', max_users: 0, price_paid: 0 }, { id: 'f' }].forEach((row) => {
      const bill = invoiceForSubscription(row);
      expect(bill.total).toBe(0);
      expect(bill.lines).toEqual([]);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('sacco invoices', () => {
  const tier = tierForMembers(60);
  const legacy = {
    id: 's1', tier: 'silver', active_members: 60, period: '2026-08-01',
    base_fee: tier.baseFee, per_member_fee_total: 60 * tier.perMemberFee,
    storage_fee: 40, total: tier.baseFee + 60 * tier.perMemberFee + 40,
  };

  it('backs the tax out of a pre-migration total without moving it', () => {
    const bill = invoiceForSaccoInvoice(legacy);
    expect(bill.total).toBe(legacy.total);
    expect(cents(bill.subtotal + bill.vatAmount)).toBe(legacy.total);
    expect(bill.vatRate).toBe(VAT_RATE);
  });

  it('itemises base, members and storage from the columns it already had', () => {
    const bill = invoiceForSaccoInvoice(legacy);
    expect(lineFor(bill, 'Base system price').gross).toBe(tier.baseFee);
    expect(lineFor(bill, 'Active member charges').unit).toBe(tier.perMemberFee);
    expect(lineFor(bill, 'Storage excess').gross).toBe(40);
    expect(sumLines(bill)).toBe(bill.subtotal);
  });

  it('never invents an installation fee — these are monthly billing runs', () => {
    expect(lineFor(invoiceForSaccoInvoice(legacy), 'Installation')).toBeUndefined();
  });

  it('prefers a stored breakdown once the row has one', () => {
    const stored = { ...legacy, module_fee: 300, installation_fee: 0, subtotal: 2500, vat_rate: 16, vat_amount: 400, total: 2900 };
    const bill = invoiceForSaccoInvoice(stored);
    expect(bill.subtotal).toBe(2500);
    expect(bill.vatAmount).toBe(400);
    expect(bill.total).toBe(2900);
    expect(lineFor(bill, 'Additional modules').gross).toBe(300);
    expect(sumLines(bill)).toBe(2500);
  });

  it('honours a zero-rated row rather than forcing 16% onto it', () => {
    const exempt = { ...legacy, vat_rate: 0 };
    const bill = invoiceForSaccoInvoice(exempt);
    expect(bill.vatAmount).toBe(0);
    expect(bill.subtotal).toBe(bill.total);
  });

  it('does not fall over on an empty row', () => {
    const bill = invoiceForSaccoInvoice({});
    expect(bill.total).toBe(0);
    expect(bill.lines).toEqual([]);
  });
});
