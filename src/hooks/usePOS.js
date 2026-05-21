import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { auditLogsService } from '../services/supabaseService';

// ── Kenya Tax (VAT) ───────────────────────────────────────────────────────────
export const VAT_RATE = 0.16;

// ── Amortisation engine (BRS Section 4.3) ────────────────────────────────────
export const buildInstallmentSchedule = ({
  sellingPrice,
  deposit,
  annualInterestRate,
  tenureMonths,
  startDate,
  penaltyRatePerMonth = 0,
  gracePeriodDays = 0,
}) => {
  const financed   = sellingPrice - deposit;
  const monthlyRate = annualInterestRate / 100 / 12;
  let monthlyInstallment;

  if (monthlyRate === 0) {
    monthlyInstallment = financed / tenureMonths;
  } else {
    // Standard amortisation formula
    monthlyInstallment =
      (financed * monthlyRate * Math.pow(1 + monthlyRate, tenureMonths)) /
      (Math.pow(1 + monthlyRate, tenureMonths) - 1);
  }

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
        .eq('registered_by', aId)
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
        discountReason, vatAmount, totalAmount, depositAmount,
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
      const { data: saleRecord, error: saleErr } = await supabase
        .from('sales')
        .insert({
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
        })
        .select()
        .single();
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

export default usePOS;
