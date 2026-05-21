import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import MainLayout from '../../layouts/MainLayout';
import ConfirmationHeader from './components/ConfirmationHeader';
import TransactionDetails from './components/TransactionDetails';
import AllocationBreakdown from './components/AllocationBreakdown';
import ClientAssetInfo from './components/ClientAssetInfo';
import ReceiptActions from './components/ReceiptActions';
import Icon from '../../components/AppIcon';
import { supabase } from '../../lib/supabase';
import { sendPaymentConfirmation } from '../../services/emailService';
import { sendPaymentConfirmationSMS } from '../../services/smsService';

// ── Skeleton loader ───────────────────────────────────────────────────────────
const Sk = ({ className = '' }) => (
  <div className={`animate-pulse bg-gray-200 rounded-xl ${className}`} />
);

const LoadingSkeleton = () => (
  <div className="max-w-2xl mx-auto space-y-5">
    <Sk className="h-10 w-64" />
    <Sk className="h-64" />
    <Sk className="h-48" />
    <Sk className="h-40" />
    <Sk className="h-40" />
  </div>
);

// ── Not found state ───────────────────────────────────────────────────────────
const NotFound = ({ onBack }) => (
  <div className="max-w-2xl mx-auto">
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
        <Icon name="AlertCircle" size={32} color="#ef4444" />
      </div>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Payment Not Found</h2>
      <p className="text-sm text-gray-500 mb-6">
        This payment record could not be loaded. It may have been deleted or the link is invalid.
      </p>
      <button onClick={onBack}
        className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors">
        <Icon name="ArrowLeft" size={15} color="white" />
        Back to Payments
      </button>
    </div>
  </div>
);

// ── Main Component ────────────────────────────────────────────────────────────
const PaymentConfirmationScreen = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const printRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [transaction, setTransaction] = useState(null);
  const [client, setClient] = useState(null);
  const [asset, setAsset] = useState(null);
  const [allocations, setAllocations] = useState([]);

  // ── Fetch real payment from Supabase ──────────────────────────────────────
  const fetchPayment = useCallback(async (paymentId) => {
    try {
      const { data, error } = await supabase
        .from('payments')
        .select(`
          id,
          amount,
          payment_method,
          payment_status,
          payment_date,
          reference_number,
          transaction_id,
          notes,
          client:clients(
            id,
            full_name,
            account_number,
            email,
            phone
          ),
          asset:assets(
            id,
            asset_name,
            asset_type,
            asset_status
          ),
          installment_plan:installment_plans(
            id,
            total_amount,
            installment_amount,
            installments_paid,
            installment_charges(
              id,
              charge_type,
              amount,
              charge_status,
              due_date
            )
          )
        `)
        .eq('id', paymentId)
        .single();

      if (error || !data) {
        setNotFound(true);
        return;
      }

      // ── Map to transaction shape ──
      setTransaction({
        transactionId: data.transaction_id || `TXN-${data.id.slice(0, 8).toUpperCase()}`,
        timestamp: data.payment_date
          ? new Date(data.payment_date).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })
          : new Date().toLocaleString(),
        amount: parseFloat(data.amount || 0),
        paymentMethod: (data.payment_method || 'bank_transfer')
          .replace(/_/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase()),
        referenceNumber: data.reference_number || '—',
        status: data.payment_status || 'completed',
      });

      // ── Map client ──
      setClient({
        name: data.client?.full_name || 'Unknown Client',
        accountNumber: data.client?.account_number || '—',
        email: data.client?.email || '',
        phone: data.client?.phone || '',
      });

      // ── Map asset ──
      setAsset({
        name: data.asset?.asset_name || '—',
        type: data.asset?.asset_type || '—',
        id: data.asset?.id ? `AST-${data.asset.id.slice(0, 6).toUpperCase()}` : '—',
        status: data.asset?.asset_status || 'active',
      });

      // ── Build allocations from installment charges or estimate ──
      const amt = parseFloat(data.amount || 0);
      const plan = data.installment_plan;

      if (plan?.installment_charges?.length) {
        // Use actual charge breakdown
        const relevantCharges = plan.installment_charges
          .filter(c => c.charge_status === 'paid')
          .slice(0, 4);

        if (relevantCharges.length) {
          setAllocations(relevantCharges.map(c => ({
            assetName: (c.charge_type || 'Payment')
              .replace(/_/g, ' ')
              .replace(/\b\w/g, ch => ch.toUpperCase()),
            amount: parseFloat(c.amount || 0),
          })));
        } else {
          setAllocations(buildEstimatedAllocations(amt));
        }
      } else {
        setAllocations(buildEstimatedAllocations(amt));
      }

    } catch (err) {
      console.error('PaymentConfirmationScreen fetch error:', err);
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Estimate allocations when no charge breakdown exists ──
  const buildEstimatedAllocations = (total) => {
    if (total <= 0) return [];
    return [
      { assetName: 'Principal Payment', amount: Math.round(total * 0.68) },
      { assetName: 'Interest Charges',  amount: Math.round(total * 0.18) },
      { assetName: 'Service Fees',      amount: Math.round(total * 0.08) },
      { assetName: 'Insurance Premium', amount: Math.round(total * 0.06) },
    ];
  };

  // ── Load data on mount ──
  useEffect(() => {
    const stateData = location?.state;

    // Priority 1: full data passed via navigation state (from payment hub)
    if (stateData?.transaction && stateData?.client) {
      setTransaction(stateData.transaction);
      setClient(stateData.client);
      setAsset(stateData.asset || null);
      setAllocations(stateData.allocations || []);
      setLoading(false);
      return;
    }

    // Priority 2: payment ID passed via state or URL param
    const paymentId = stateData?.paymentId || searchParams.get('id');
    if (paymentId) {
      fetchPayment(paymentId);
      return;
    }

    // Priority 3: no data at all — show not found
    setNotFound(true);
    setLoading(false);
  }, [location, searchParams, fetchPayment]);

  // ── Receipt text for download ──
  const generateReceiptText = () => {
    const t = transaction;
    const lines = [
      '========================================',
      '         ASSETFLOW MANAGEMENT           ',
      '           PAYMENT RECEIPT              ',
      '========================================',
      '',
      `Transaction ID : ${t?.transactionId}`,
      `Date & Time    : ${t?.timestamp}`,
      `Payment Method : ${t?.paymentMethod}`,
      `Reference No.  : ${t?.referenceNumber}`,
      `Status         : ${(t?.status || 'COMPLETED').toUpperCase()}`,
      '',
      '--- CLIENT INFORMATION ---',
      `Client Name    : ${client?.name}`,
      `Account No.    : ${client?.accountNumber}`,
      `Email          : ${client?.email}`,
      `Phone          : ${client?.phone}`,
      '',
      '--- ASSET INFORMATION ---',
      `Asset Name     : ${asset?.name}`,
      `Asset ID       : ${asset?.id}`,
      `Asset Type     : ${asset?.type}`,
      '',
      '--- ALLOCATION BREAKDOWN ---',
      ...allocations.map(a =>
        `${(a?.assetName || '').padEnd(20)}: KES ${parseFloat(a?.amount || 0).toLocaleString()}`
      ),
      '',
      '========================================',
      `TOTAL AMOUNT   : KES ${parseFloat(t?.amount || 0).toLocaleString()}`,
      '========================================',
      '',
      'Thank you for your payment.',
      `Generated: ${new Date().toLocaleString()}`,
    ];
    return lines.join('\n');
  };

  const handleDownloadPDF = () =>
    new Promise((resolve) => {
      setTimeout(() => {
        const blob = new Blob([generateReceiptText()], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `receipt-${transaction?.transactionId || 'payment'}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        resolve();
      }, 800);
    });

  const handlePrint = () => window.print();

  const handleEmail = () =>
    new Promise(async (resolve) => {
      try {
        if (client?.email) {
          await sendPaymentConfirmation(client.email, { transaction, client, asset, allocations });
        }
      } catch (err) {
        console.error('Email error:', err);
      } finally {
        resolve();
      }
    });

  const handleSMS = () =>
    new Promise(async (resolve) => {
      try {
        if (client?.phone) {
          await sendPaymentConfirmationSMS(client.phone, { transaction, client, asset, allocations });
        }
      } catch (err) {
        console.error('SMS error:', err);
      } finally {
        resolve();
      }
    });

  // ── Render ──
  if (loading) return <MainLayout><LoadingSkeleton /></MainLayout>;
  if (notFound) return <MainLayout><NotFound onBack={() => navigate('/payment-collections-hub')} /></MainLayout>;

  const totalAmount = parseFloat(transaction?.amount || 0);

  return (
    <MainLayout>
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate('/payment-collections-hub')}
            className="flex items-center justify-center w-9 h-9 rounded-lg border border-border hover:bg-muted transition-colors">
            <Icon name="ArrowLeft" size={16} color="var(--color-muted-foreground)" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Payment Confirmation</h1>
            <p className="text-sm text-muted-foreground">Transaction receipt and invoice details</p>
          </div>
          {/* Live indicator */}
          <div className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-full">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-xs font-semibold text-emerald-700">Live Data</span>
          </div>
        </div>

        {/* Confirmation Card */}
        <div ref={printRef} className="bg-background">
          <div className="bg-card border border-border rounded-xl p-6 mb-5 shadow-sm">
            <ConfirmationHeader
              transactionId={transaction?.transactionId}
              timestamp={transaction?.timestamp}
              amount={totalAmount}
            />
            <div className="flex items-center justify-center">
              <div className="px-8 py-4 rounded-2xl bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 text-center">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total Amount Paid</p>
                <p className="text-2xl font-bold text-emerald-600">
                  KES {totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>
          </div>

          <TransactionDetails transaction={transaction} />
          <AllocationBreakdown allocations={allocations} totalAmount={totalAmount} />
          <ClientAssetInfo client={client} asset={asset} />
        </div>

        <ReceiptActions
          onDownloadPDF={handleDownloadPDF}
          onPrint={handlePrint}
          onEmail={handleEmail}
          onSMS={handleSMS}
          onNewTransaction={() => navigate('/payment-collections-hub')}
          onDashboard={() => navigate('/role-based-dashboard')}
        />
      </div>
    </MainLayout>
  );
};

export default PaymentConfirmationScreen;
