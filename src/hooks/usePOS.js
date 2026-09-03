import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { auditLogsService } from '../services/supabaseService';
import { vatRateOn } from '../config/taxRegulations';

// ── Kenya Tax (VAT) ───────────────────────────────────────────────────────────
/**
 * The VAT rate on a sale, as a FRACTION, resolved from the date of supply.
 *
 * Was a `0.16` constant, with "VAT (16%)" typed separately into the two places
 * the till prints it — so a rate change had to be made in three spots or the
 * receipt would state one rate and charge another. The rate now comes from
 * src/config/taxRegulations.js and the label is derived from the same figure.
 *
 * A sale is taxed at the rate in force on the day it is made, which is why the
 * default is today rather than a frozen constant: a till left open across a
 * changeover picks up the new rate on its next sale.
 */
export const vatFractionOn = (asOf = null) => vatRateOn(asOf) / 100;

/** The same rate as a percentage, for anything that prints it. */
export const vatPercentOn = (asOf = null) => vatRateOn(asOf);

// ── Amortisation engine (BRS Section 4.3) ────────────────────────────────────

// The level monthly payment that clears `financed` over `tenureMonths` at
// `annualInterestRate`. Exported so anything that has to restate a plan's
// installment (the Finance Hub invoice, for one) uses this exact formula
// instead of re-deriving it.
export const monthlyInstallmentFor = ({ financed, annualInterestRate, tenureMonths }) => {
  const principal = parseFloat(financed) || 0;
  const months    = parseInt(tenureMonths, 10) || 0;
  if (months <= 0) return 0;
  const monthlyRate = (parseFloat(annualInterestRate) || 0) / 100 / 12;
  if (monthlyRate === 0) return principal / months;
  return (principal * monthlyRate * Math.pow(1 + monthlyRate, months)) /
         (Math.pow(1 + monthlyRate, months) - 1);
};

export const buildInstallmentSchedule = ({
  sellingPrice,
  deposit,
  annualInterestRate,
  tenureMonths,
  startDate,
  penaltyRatePerMonth = 0,
  gracePeriodDays = 0,
}) => {
  const financed    = sellingPrice - deposit;
  const monthlyRate = annualInterestRate / 100 / 12;
  const monthlyInstallment = monthlyInstallmentFor({ financed, annualInterestRate, tenureMonths });

  const schedule = [];
  let openingBalance = financed;
  const start = new Date(startDate);

  for (let i = 1; i <= tenureMonths; i++) {
    const dueDate = new Date(start);
    dueDate.setMonth(dueDate.getMonth() + (i - 1));

    const interestPortion  = openingBalance * monthlyRate;
    const principalPortion = monthlyInstallment - interestPortion;
    const closingBalance   = Math.max(0, openingBalance - principalPortion);

    schedule.push({
      installmentNo:    i,
      dueDate:          dueDate.toISOString().split('T')[0],
      openingBalance:   Math.round(openingBalance * 100) / 100,
      installmentAmount: Math.round(monthlyInstallment * 100) / 100,
      principalPortion:  Math.round(principalPortion * 100) / 100,
      interestPortion:   Math.round(interestPortion * 100) / 100,
      penalty:           0,
      closingBalance:    Math.round(closingBalance * 100) / 100,
      status:            'pending',
      actualPaymentDate: null,
      paymentReference:  null,
    });

    openingBalance = closingBalance;
  }

  const totalInterest = schedule.reduce((s, r) => s + r.interestPortion, 0);
  const totalPayable  = deposit + financed + totalInterest;

  return {
    schedule,
    summary: {
      sellingPrice,
      deposit,
      financed:          Math.round(financed * 100) / 100,
      monthlyInstallment: Math.round(monthlyInstallment * 100) / 100,
      annualInterestRate,
      totalInterest:     Math.round(totalInterest * 100) / 100,
      totalPayable:      Math.round(totalPayable * 100) / 100,
      tenureMonths,
      firstDueDate:      schedule[0]?.dueDate,
      lastDueDate:       schedule[schedule.length - 1]?.dueDate,
    },
  };
};

// ── Generate invoice number (BRS 5.3) ─────────────────────────────────────────
const genInvoiceNo = () =>
  `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;

const genReceiptNo = () =>
  `RCP-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;

// ── Reprint support ───────────────────────────────────────────────────────────
/** Columns migration 20260902140000 adds; a sale still records without them. */
const REPRINT_COLUMNS = ['receipt_number', 'vat_percent'];

/**
 * Is this PostgREST error "that column does not exist", for one of `columns`?
 *
 * Exported for test. It has to be narrow: any broader reading would let a real
 * constraint violation be retried as though the schema were merely behind.
 * PostgREST reports an unknown column on write as PGRST204 and names it in the
 * message; a stale schema cache surfaces as 42703 from Postgres itself.
 */
export const isMissingColumnError = (err, columns = []) => {
  if (!err) return false;
  const code = String(err.code || '');
  if (code !== 'PGRST204' && code !== '42703') return false;
  const haystack = `${err.message || ''} ${err.details || ''}`.toLowerCase();
  return columns.some((c) => haystack.includes(c));
};

// ── Hook ──────────────────────────────────────────────────────────────────────
export const usePOS = () => {
  const [adminId, setAdminId]           = useState(null);
  const [agentId, setAgentId]           = useState(null);
  const [userProfile, setUserProfile]   = useState(null);
  const [clients, setClients]           = useState([]);
  const [assets, setAssets]             = useState([]);
  const [companyProfile, setCompanyProfile] = useState(null);
  const [loading, setLoading]           = useState(true);
  const [submitting, setSubmitting]     = useState(false);
  const [error, setError]               = useState(null);

  // ── Boot: get current user context ─────────────────────────────────────────
  useEffect(() => {
    const boot = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('id', user.id)
          .single();

        setUserProfile(profile);

        // Determine admin_id (admin uses own id, staff uses admin_id)
        const aId = profile?.role === 'admin' ? user.id : (profile?.admin_id || user.id);
        setAdminId(aId);

        // Check if user is a sales agent
        if (profile?.role === 'sales_agent' || profile?.role === 'sales') {
          const { data: agent } = await supabase
            .from('agents')
            .select('id')
            .eq('user_id', user.id)
            .single();
          if (agent) setAgentId(agent.id);
        }

        await Promise.all([
          fetchClients(aId),
          fetchAvailableAssets(aId),
          fetchCompanyProfile(aId),
        ]);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    boot();
  }, []);

  // ── Fetch KYC-verified clients ──────────────────────────────────────────────
  const fetchClients = useCallback(async (aId) => {
    try {
      const { data } = await supabase
        .from('clients')
        .select('id, full_name, account_number, email, phone, kyc_status, client_status')
        .eq('admin_id', aId)
        .order('full_name');
      setClients(data || []);
    } catch { setClients([]); }
  }, []);

  // ── Fetch available assets ──────────────────────────────────────────────────
  const fetchAvailableAssets = useCallback(async (aId) => {
    try {
      // Use select('*') to avoid 400 errors from columns that may not exist yet
      const { data, error } = await supabase
        .from('assets')
        .select('*')
        // Tenant-owned stock, however it got registered.
        .eq('admin_id', aId)
        .eq('asset_status', 'available')
        .order('description');

      if (error) throw error;

      // Filter quantity client-side — handles null, undefined, or 0
      const available = (data || []).filter(a =>
        !a.quantity_available || a.quantity_available > 0
      );
      setAssets(available);
    } catch (err) {
      console.error('fetchAvailableAssets error:', err.message);
      setAssets([]);
    }
  }, []);

  // ── Fetch company profile ───────────────────────────────────────────────────
  const fetchCompanyProfile = useCallback(async (aId) => {
    try {
      const { data } = await supabase
        .from('company_profiles')
        .select('*')
        .eq('admin_id', aId)
        .single();
      setCompanyProfile(data);
    } catch { setCompanyProfile(null); }
  }, []);

  // ── Submit POS transaction (BRS Section 5.2) ────────────────────────────────
  const submitSale = useCallback(async (saleData) => {
    setSubmitting(true);
    setError(null);
    try {
      const {
        clientId, asset, pricingModel, sellingPrice, discountAmount,
        discountReason, vatAmount, vatPercent, totalAmount, depositAmount,
        financeBalance, interestRate, tenureMonths, startDate,
        paymentMethod, mpesaRef, bankRef, notes, schedule,
      } = saleData;

      const invoiceNo = genInvoiceNo();
      const receiptNo = genReceiptNo();
      const now = new Date().toISOString();

      // 1. Create payment record (deposit or full amount)
      const paymentAmount = pricingModel === 'cash' ? totalAmount : depositAmount;
      // Map payment method to exact enum values in database
      const paymentMethodMap = {
        mpesa:         'mpesa',
        cash:          'cash',
        bank_transfer: 'bank_transfer',
        card:          'card',
        cheque:        'cheque',
      };
      const dbPaymentMethod = paymentMethodMap[paymentMethod] || 'cash';

      const { data: payment, error: payErr } = await supabase
        .from('payments')
        .insert({
          transaction_id:   invoiceNo,
          client_id:        clientId,
          asset_id:         asset.id,
          agent_id:         agentId || null,
          amount:           paymentAmount,
          payment_method:   dbPaymentMethod,
          payment_date:     now,
          payment_status:   'completed',
          reference_number: mpesaRef || bankRef || receiptNo,
          notes:            notes || null,
          processed_by:     (await supabase.auth.getUser()).data.user?.id || null,
        })
        .select()
        .single();

      if (payErr) {
        console.error('Payment insert error details:', payErr);
        throw new Error('Payment record failed: ' + payErr.message + ' (code: ' + payErr.code + ')');
      }

      // 2. Create sale/contract record
      const saleRow = {
          invoice_number:   invoiceNo,
          client_id:        clientId,
          asset_id:         asset.id,
          agent_id:         agentId || null,
          admin_id:         adminId,
          pricing_model:    pricingModel,
          selling_price:    sellingPrice,
          discount_amount:  discountAmount || 0,
          discount_reason:  discountReason || null,
          vat_amount:       vatAmount || 0,
          total_amount:     totalAmount,
          deposit_amount:   depositAmount || 0,
          finance_balance:  financeBalance || 0,
          interest_rate:    interestRate || 0,
          tenure_months:    tenureMonths || 0,
          payment_start_date: startDate || null,
          payment_method:   paymentMethod,
          mpesa_reference:  mpesaRef || null,
          bank_reference:   bankRef || null,
          notes:            notes || null,
          status:           'active',
          sale_date:        now.split('T')[0],
          // Kept so the receipt can be printed again later. Nothing else reads
          // these two — see migration 20260902140000 for why the number a
          // customer was handed cannot be reconstructed without them.
          receipt_number:   receiptNo,
          vat_percent:      vatPercent ?? null,
      };

      let { data: saleRecord, error: saleErr } = await supabase
        .from('sales').insert(saleRow).select().single();

      // The reprint columns are additive, and this repo's migrations have run
      // ahead of and behind the live schema in both directions. A till that
      // cannot take money is far worse than one that cannot reprint, so an
      // unapplied migration costs the reprint fields and nothing else. Narrow
      // on purpose: only a missing-column error retries, and the failed insert
      // wrote nothing, so there is no risk of a double sale.
      if (saleErr && isMissingColumnError(saleErr, REPRINT_COLUMNS)) {
        console.warn('Sales reprint columns missing; recording the sale without them:', saleErr.message);
        const fallback = { ...saleRow };
        REPRINT_COLUMNS.forEach((c) => delete fallback[c]);
        ({ data: saleRecord, error: saleErr } = await supabase
          .from('sales').insert(fallback).select().single());
      }

      if (saleErr) {
        console.error('Sales insert error details:', saleErr);
        throw new Error('Sale record failed: ' + saleErr.message + ' (code: ' + saleErr.code + ')');
      }

      // 3. Insert installment schedule rows (if installment sale)
      if (pricingModel !== 'cash' && schedule?.length > 0) {
        const scheduleRows = schedule.map(row => ({
          sale_id:            saleRecord.id,
          client_id:          clientId,
          asset_id:           asset.id,
          installment_no:     row.installmentNo,
          due_date:           row.dueDate,
          opening_balance:    row.openingBalance,
          installment_amount: row.installmentAmount,
          principal_portion:  row.principalPortion,
          interest_portion:   row.interestPortion,
          penalty:            0,
          closing_balance:    row.closingBalance,
          status:             'pending',
        }));
        const { error: schErr } = await supabase
          .from('installment_schedules')
          .insert(scheduleRows);
        if (schErr) console.warn('Schedule insert warning:', schErr.message);
      }

      // 4. Update asset status — BRS 9.2 status machine
      // Cash sale → sold immediately on payment confirmation
      // Installment → on_installment (transitions to sold on final payment via DB trigger)
      const newStatus    = pricingModel === 'cash' ? 'sold' : 'on_installment';
      const statusReason = pricingModel === 'cash'
        ? 'Cash sale confirmed — Invoice ' + invoiceNo
        : 'Hire purchase deposit confirmed — Invoice ' + invoiceNo + ' — ' + tenureMonths + ' month installment plan';

      const { data: { user: currentUser } } = await supabase.auth.getUser();

      // Update asset status — BRS 9.2
      // Note: last_status_change_by excluded to avoid FK constraint issues
      const { error: assetUpdateErr } = await supabase
        .from('assets')
        .update({
          asset_status:       newStatus,
          quantity_available: Math.max(0, (asset.quantity_available || 1) - 1),
          last_status_reason: statusReason,
          updated_at:         new Date().toISOString(),
        })
        .eq('id', asset.id);

      if (assetUpdateErr) {
        // Fallback: update only core fields if new columns cause issues
        console.warn('Asset update warning:', assetUpdateErr.message);
        const { error: fallbackErr } = await supabase
          .from('assets')
          .update({
            asset_status:       newStatus,
            quantity_available: Math.max(0, (asset.quantity_available || 1) - 1),
            updated_at:         new Date().toISOString(),
          })
          .eq('id', asset.id);
        if (fallbackErr) console.error('Asset fallback update failed:', fallbackErr.message);
      }

      // 5. Update client status to active
      await supabase
        .from('clients')
        .update({ client_status: 'active' })
        .eq('id', clientId);

      // 6. Audit log
      try {
        await auditLogsService.log(
          'create', 'sales',
          `POS Sale: ${pricingModel.toUpperCase()} — ${asset.description} → Client ${clientId} — Invoice ${invoiceNo} — ${pricingModel === 'cash' ? `KES ${totalAmount.toLocaleString()} full payment` : `KES ${depositAmount.toLocaleString()} deposit, ${tenureMonths}mo installment`}`,
          saleRecord.id, (await supabase.auth.getUser()).data.user?.id,
          { invoiceNo, clientId, assetId: asset.id, pricingModel, totalAmount, depositAmount }
        );
      } catch {}

      return { success: true, saleRecord, payment, invoiceNo, receiptNo };
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setSubmitting(false);
    }
  }, [adminId, agentId]);

  return {
    adminId, userProfile, clients, assets, companyProfile,
    loading, submitting, error,
    submitSale,
    refetchAssets: () => fetchAvailableAssets(adminId),
    refetchClients: () => fetchClients(adminId),
  };
};

/**
 * Everything needed to reprint the receipt for one past sale.
 *
 * The list screen holds the sale row already, but a receipt needs three things
 * the list does not carry: the installment schedule (the A4 sheet prints it),
 * the payment (its timestamp is the moment the money was taken, which is what
 * the reprint must show — not the moment somebody pressed Print), and the name
 * of whoever served the customer.
 *
 * Everything but the sale itself is best-effort. A schedule that never
 * persisted, a payment row since edited, a cashier whose profile was deleted —
 * none of those should stop a customer getting their receipt. Each simply
 * leaves its line off the document.
 *
 * Not a hook: the history screen calls it on a click, not on render.
 */
/**
 * The KRA filing for one sale, or null — and NEVER a thrown error.
 *
 * This is the main reason an eTIMS tenant reprints at all: the copy handed over
 * at the till is printed before the document reaches KRA (filing is queued so
 * an outage cannot stop a shop trading), so the compliant receipt carrying the
 * signature only exists once it lands.
 *
 * Wrapped whole, rather than by chaining a rejection handler onto the query,
 * because the two ways this can fail are different in kind and only one of them
 * produces a promise to reject:
 *
 *   the table is not there yet   — this repo's migrations have run ahead of and
 *                                  behind the live schema in both directions,
 *                                  and PostgREST answers with an error
 *   the CHAIN is not there       — a client that does not implement a builder
 *                                  method throws SYNCHRONOUSLY, before any
 *                                  promise exists, and takes the whole
 *                                  Promise.all down with it
 *
 * The second one is the one that matters: it would mean a schema or client
 * detail could stop a customer being handed their receipt, which is precisely
 * the trade the entire eTIMS design refuses to make (see
 * supabase/migrations/20260902160000_etims_integration.sql). So nothing about
 * this lookup is allowed to escape. A tenant with no eTIMS module simply has no
 * row, and the receipt prints exactly as it always did.
 */
const fetchEtimsForSale = async (saleId) => {
  try {
    const { data } = await supabase
      .from('etims_invoices')
      .select(
        'status, invoice_number, kra_invoice_number, receipt_signature, internal_data, ' +
          'control_unit_id, control_unit_at, qr_url, environment',
      )
      .eq('sale_id', saleId)
      .eq('doc_type', 'sale')
      .neq('status', 'cancelled')
      .maybeSingle();
    return { data: data ?? null };
  } catch {
    return { data: null };
  }
};

export const fetchSaleForReprint = async (saleId) => {
  const { data: sale, error } = await supabase
    .from('sales')
    // select('*') deliberately, matching fetchAvailableAssets above: this
    // table has drifted from the migrations more than once, and a reprint
    // should not 400 over a column it does not need.
    .select('*, client:clients(*), asset:assets(*)')
    .eq('id', saleId)
    .single();
  if (error) throw error;

  const [{ data: schedule }, { data: payment }, { data: etims }] = await Promise.all([
    supabase
      .from('installment_schedules')
      .select('installment_no, due_date, opening_balance, installment_amount, principal_portion, interest_portion, closing_balance')
      .eq('sale_id', saleId)
      .order('installment_no'),
    // submitSale writes the invoice number as the payment's transaction_id, so
    // this is an exact match rather than a heuristic on client + asset.
    supabase
      .from('payments')
      .select('payment_date, processed_by, reference_number')
      .eq('transaction_id', sale.invoice_number)
      .maybeSingle(),
    fetchEtimsForSale(saleId),
  ]);

  let cashier = '';
  if (payment?.processed_by) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('full_name')
      .eq('id', payment.processed_by)
      .maybeSingle();
    cashier = profile?.full_name || '';
  }

  return { sale, client: sale.client, asset: sale.asset, schedule: schedule || [], payment, cashier, etims: etims || null };
};

export default usePOS;
