// @ts-ignore: Deno global is available in Deno runtime
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { authenticateCaller } from "../_shared/auth.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
// Set EMAIL_FROM to a verified-domain sender (e.g. "Ararat <noreply@yourco.com>")
// so emails deliver to any recipient. The onboarding@resend.dev fallback only
// delivers to the Resend account owner's own address (test mode).
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") || "Ararat <onboarding@resend.dev>";

const formatCurrency = (val: number, currency = "KES") =>
  new Intl.NumberFormat("en-KE", { style: "currency", currency, minimumFractionDigits: 0 }).format(val || 0);

const formatDate = (d: string) =>
  d ? new Date(d).toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" }) : "—";

// ─── Email Templates ──────────────────────────────────────────────────────────

const baseStyle = `
  font-family: 'Segoe UI', Arial, sans-serif;
  background: #f8fafc;
  margin: 0; padding: 0;
`;

const cardStyle = `
  background: #ffffff;
  border-radius: 12px;
  padding: 32px;
  max-width: 600px;
  margin: 24px auto;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
`;

const headerStyle = `
  background: linear-gradient(135deg, #1a56db 0%, #0e9f6e 100%);
  border-radius: 12px 12px 0 0;
  padding: 28px 32px;
  text-align: center;
  color: #ffffff;
`;

const buildPaymentConfirmationEmail = (data: any) => {
  const { transaction, client, asset, allocations } = data;
  const total = parseFloat(transaction?.amount || 0);
  const allocationRows = (allocations || []).map((a: any) => `
    <tr>
      <td style="padding:10px 0;color:#374151;font-size:14px;border-bottom:1px solid #f3f4f6">${a.assetName || a.label}</td>
      <td style="padding:10px 0;color:#111827;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid #f3f4f6">${formatCurrency(a.amount)}</td>
    </tr>`).join("");

  return `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${baseStyle}">
<div style="${cardStyle}">
  <div style="${headerStyle}">
    <div style="width:56px;height:56px;background:rgba(255,255,255,0.2);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px">
      <span style="font-size:28px">✓</span>
    </div>
    <h1 style="margin:0;font-size:22px;font-weight:700">Payment Confirmed</h1>
    <p style="margin:6px 0 0;opacity:0.85;font-size:14px">Your payment has been successfully processed</p>
  </div>

  <div style="padding:28px 0 0">
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:20px;text-align:center;margin-bottom:24px">
      <p style="margin:0 0 4px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em">Total Amount Paid</p>
      <p style="margin:0;font-size:32px;font-weight:800;color:#059669">${formatCurrency(total)}</p>
    </div>

    <h3 style="font-size:13px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 12px">Transaction Details</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
      <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Transaction ID</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${transaction?.transactionId || transaction?.transaction_id}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Date &amp; Time</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${transaction?.timestamp || formatDate(transaction?.payment_date)}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Payment Method</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${transaction?.paymentMethod || transaction?.payment_method}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Reference No.</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${transaction?.referenceNumber || transaction?.reference_number}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Status</td><td style="padding:8px 0;text-align:right"><span style="background:#d1fae5;color:#065f46;font-size:12px;font-weight:700;padding:3px 10px;border-radius:20px">SUCCESSFUL</span></td></tr>
    </table>

    ${allocations?.length ? `
    <h3 style="font-size:13px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 12px">Allocation Breakdown</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
      ${allocationRows}
      <tr><td style="padding:12px 0;color:#111827;font-size:15px;font-weight:700">Total</td><td style="padding:12px 0;color:#059669;font-size:15px;font-weight:800;text-align:right">${formatCurrency(total)}</td></tr>
    </table>` : ""}

    ${client ? `
    <h3 style="font-size:13px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 12px">Client Information</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
      <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Client Name</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${client?.name || client?.full_name}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Account No.</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${client?.accountNumber || client?.account_number}</td></tr>
      ${asset ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Asset</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${asset?.name || asset?.description}</td></tr>` : ""}
    </table>` : ""}

    <div style="background:#f8fafc;border-radius:8px;padding:16px;text-align:center;margin-top:8px">
      <p style="margin:0;font-size:13px;color:#6b7280">Thank you for your payment. This is an automated receipt from <strong>Ararat Management</strong>.</p>
    </div>
  </div>
</div>
</body></html>`;
};

const buildInvoiceEmail = (data: any) => {
  const { invoice, client, asset, lineItems } = data;
  const total = parseFloat(invoice?.total || 0);
  const itemRows = (lineItems || []).map((item: any) => `
    <tr>
      <td style="padding:10px 0;color:#374151;font-size:14px;border-bottom:1px solid #f3f4f6">${item.description}</td>
      <td style="padding:10px 0;color:#374151;font-size:14px;text-align:center;border-bottom:1px solid #f3f4f6">${item.quantity || 1}</td>
      <td style="padding:10px 0;color:#374151;font-size:14px;text-align:right;border-bottom:1px solid #f3f4f6">${formatCurrency(item.unitPrice || item.amount)}</td>
      <td style="padding:10px 0;color:#111827;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid #f3f4f6">${formatCurrency((item.quantity || 1) * (item.unitPrice || item.amount))}</td>
    </tr>`).join("");

  return `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${baseStyle}">
<div style="${cardStyle}">
  <div style="background:linear-gradient(135deg,#1e40af 0%,#3b82f6 100%);border-radius:12px 12px 0 0;padding:28px 32px;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <h1 style="margin:0;font-size:24px;font-weight:800;color:#fff">INVOICE</h1>
        <p style="margin:4px 0 0;color:rgba(255,255,255,0.8);font-size:13px">${invoice?.invoiceNumber || invoice?.invoice_number || "INV-" + Date.now()}</p>
      </div>
      <div style="text-align:right">
        <p style="margin:0;color:rgba(255,255,255,0.8);font-size:12px">Issue Date</p>
        <p style="margin:2px 0 0;color:#fff;font-size:13px;font-weight:600">${formatDate(invoice?.issueDate || invoice?.issue_date || new Date().toISOString())}</p>
        <p style="margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:12px">Due Date</p>
        <p style="margin:2px 0 0;color:#fbbf24;font-size:13px;font-weight:700">${formatDate(invoice?.dueDate || invoice?.due_date)}</p>
      </div>
    </div>
  </div>

  <div style="padding:28px 0 0">
    ${client ? `
    <div style="display:flex;gap:24px;margin-bottom:24px">
      <div style="flex:1">
        <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase">Bill To</p>
        <p style="margin:0;font-size:15px;font-weight:700;color:#111827">${client?.name || client?.full_name}</p>
        <p style="margin:2px 0;font-size:13px;color:#6b7280">${client?.accountNumber || client?.account_number}</p>
        <p style="margin:2px 0;font-size:13px;color:#6b7280">${client?.email}</p>
        ${client?.phone ? `<p style="margin:2px 0;font-size:13px;color:#6b7280">${client.phone}</p>` : ""}
      </div>
      ${asset ? `
      <div style="flex:1">
        <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase">Asset</p>
        <p style="margin:0;font-size:15px;font-weight:700;color:#111827">${asset?.name || asset?.description}</p>
        <p style="margin:2px 0;font-size:13px;color:#6b7280">${asset?.id || asset?.asset_code}</p>
        <p style="margin:2px 0;font-size:13px;color:#6b7280">${asset?.type || asset?.asset_type}</p>
      </div>` : ""}
    </div>` : ""}

    <h3 style="font-size:13px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 12px">Invoice Items</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
      <thead>
        <tr style="background:#f8fafc">
          <th style="padding:10px 0;text-align:left;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase">Description</th>
          <th style="padding:10px 0;text-align:center;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase">Qty</th>
          <th style="padding:10px 0;text-align:right;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase">Unit Price</th>
          <th style="padding:10px 0;text-align:right;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase">Amount</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
      <tfoot>
        <tr><td colspan="3" style="padding:14px 0;font-size:15px;font-weight:700;color:#111827">Total Due</td><td style="padding:14px 0;font-size:18px;font-weight:800;color:#1e40af;text-align:right">${formatCurrency(total)}</td></tr>
      </tfoot>
    </table>

    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;text-align:center">
      <p style="margin:0;font-size:13px;color:#1e40af">Please ensure payment is made by the due date. For queries, contact <strong>Ararat Management</strong>.</p>
    </div>
  </div>
</div>
</body></html>`;
};

const buildStatementEmail = (data: any) => {
  const { client, assets, payments, period } = data;
  const totalPaid = (payments || []).filter((p: any) => p.payment_status === "completed").reduce((s: number, p: any) => s + (p.amount || 0), 0);
  const totalPending = (payments || []).filter((p: any) => p.payment_status === "pending").reduce((s: number, p: any) => s + (p.amount || 0), 0);
  const totalOverdue = (payments || []).filter((p: any) => p.payment_status === "pending" && new Date(p.payment_date) < new Date()).reduce((s: number, p: any) => s + (p.amount || 0), 0);

  const recentPayments = (payments || []).slice(0, 10);
  const paymentRows = recentPayments.map((p: any) => `
    <tr>
      <td style="padding:9px 0;font-size:13px;color:#374151;border-bottom:1px solid #f3f4f6">${formatDate(p.payment_date)}</td>
      <td style="padding:9px 0;font-size:13px;color:#374151;border-bottom:1px solid #f3f4f6">${p.transaction_id || "—"}</td>
      <td style="padding:9px 0;font-size:13px;color:#374151;border-bottom:1px solid #f3f4f6">${p.asset?.asset_code || p.asset_code || "—"}</td>
      <td style="padding:9px 0;font-size:13px;font-weight:600;color:#111827;text-align:right;border-bottom:1px solid #f3f4f6">${formatCurrency(p.amount)}</td>
      <td style="padding:9px 0;text-align:right;border-bottom:1px solid #f3f4f6">
        <span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;background:${p.payment_status === "completed" ? "#d1fae5" : p.payment_status === "pending" ? "#fef3c7" : "#fee2e2"};color:${p.payment_status === "completed" ? "#065f46" : p.payment_status === "pending" ? "#92400e" : "#991b1b"}">${(p.payment_status || "").toUpperCase()}</span>
      </td>
    </tr>`).join("");

  return `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${baseStyle}">
<div style="${cardStyle}">
  <div style="background:linear-gradient(135deg,#5b21b6 0%,#7c3aed 100%);border-radius:12px 12px 0 0;padding:28px 32px;">
    <h1 style="margin:0;font-size:22px;font-weight:800;color:#fff">Account Statement</h1>
    <p style="margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:13px">${period || "All time"} · Generated ${new Date().toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" })}</p>
  </div>

  <div style="padding:28px 0 0">
    ${client ? `
    <div style="margin-bottom:20px">
      <p style="margin:0;font-size:15px;font-weight:700;color:#111827">${client?.full_name || client?.name}</p>
      <p style="margin:2px 0;font-size:13px;color:#6b7280">Account: ${client?.account_number || client?.accountNumber}</p>
      <p style="margin:2px 0;font-size:13px;color:#6b7280">${client?.email}</p>
    </div>` : ""}

    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px">
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px;text-align:center">
        <p style="margin:0 0 4px;font-size:11px;color:#6b7280;text-transform:uppercase">Total Paid</p>
        <p style="margin:0;font-size:16px;font-weight:800;color:#059669">${formatCurrency(totalPaid)}</p>
      </div>
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px;text-align:center">
        <p style="margin:0 0 4px;font-size:11px;color:#6b7280;text-transform:uppercase">Pending</p>
        <p style="margin:0;font-size:16px;font-weight:800;color:#d97706">${formatCurrency(totalPending)}</p>
      </div>
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px;text-align:center">
        <p style="margin:0 0 4px;font-size:11px;color:#6b7280;text-transform:uppercase">Overdue</p>
        <p style="margin:0;font-size:16px;font-weight:800;color:#dc2626">${formatCurrency(totalOverdue)}</p>
      </div>
    </div>

    <h3 style="font-size:13px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 12px">Recent Transactions</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
      <thead>
        <tr style="background:#f8fafc">
          <th style="padding:9px 0;text-align:left;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase">Date</th>
          <th style="padding:9px 0;text-align:left;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase">Txn ID</th>
          <th style="padding:9px 0;text-align:left;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase">Asset</th>
          <th style="padding:9px 0;text-align:right;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase">Amount</th>
          <th style="padding:9px 0;text-align:right;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase">Status</th>
        </tr>
      </thead>
      <tbody>${paymentRows}</tbody>
    </table>

    ${(assets || []).length > 0 ? `
    <h3 style="font-size:13px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 12px">Portfolio Summary</h3>
    <p style="margin:0 0 16px;font-size:13px;color:#6b7280">${assets.length} asset(s) in portfolio</p>` : ""}

    <div style="background:#f8fafc;border-radius:8px;padding:16px;text-align:center">
      <p style="margin:0;font-size:13px;color:#6b7280">This statement was generated automatically by <strong>Ararat Management</strong>.</p>
    </div>
  </div>
</div>
</body></html>`;
};

const buildReminderEmail = (data: any) => {
  const { client, payment, asset, daysUntilDue, isOverdue } = data;
  const amount = parseFloat(payment?.amount || 0);
  const urgencyColor = isOverdue ? "#dc2626" : daysUntilDue <= 3 ? "#d97706" : "#2563eb";
  const urgencyBg = isOverdue ? "#fef2f2" : daysUntilDue <= 3 ? "#fffbeb" : "#eff6ff";
  const urgencyBorder = isOverdue ? "#fecaca" : daysUntilDue <= 3 ? "#fde68a" : "#bfdbfe";
  const urgencyLabel = isOverdue
    ? `⚠️ ${Math.abs(daysUntilDue)} day(s) overdue`
    : daysUntilDue === 0
    ? "⚡ Due today"
    : `🔔 Due in ${daysUntilDue} day(s)`;

  return `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${baseStyle}">
<div style="${cardStyle}">
  <div style="background:linear-gradient(135deg,${urgencyColor} 0%,${isOverdue ? "#b91c1c" : daysUntilDue <= 3 ? "#b45309" : "#1d4ed8"} 100%);border-radius:12px 12px 0 0;padding:28px 32px;text-align:center">
    <div style="font-size:40px;margin-bottom:8px">${isOverdue ? "⚠️" : "🔔"}</div>
    <h1 style="margin:0;font-size:22px;font-weight:800;color:#fff">${isOverdue ? "Payment Overdue" : "Payment Reminder"}</h1>
    <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:14px">${urgencyLabel}</p>
  </div>

  <div style="padding:28px 0 0">
    ${client ? `<p style="margin:0 0 20px;font-size:15px;color:#374151">Dear <strong>${client?.full_name || client?.name}</strong>,</p>` : ""}
    <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6">
      ${isOverdue
        ? `This is a notice that your installment payment is <strong style="color:#dc2626">overdue</strong>. Please make payment as soon as possible to avoid additional penalties.`
        : `This is a friendly reminder that your installment payment is due ${daysUntilDue === 0 ? "today" : `in ${daysUntilDue} day(s)`}. Please ensure timely payment to avoid late fees.`
      }
    </p>

    <div style="background:${urgencyBg};border:1px solid ${urgencyBorder};border-radius:10px;padding:20px;margin-bottom:24px;text-align:center">
      <p style="margin:0 0 4px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em">Amount Due</p>
      <p style="margin:0;font-size:32px;font-weight:800;color:${urgencyColor}">${formatCurrency(amount)}</p>
      <p style="margin:6px 0 0;font-size:13px;color:#6b7280">Due: ${formatDate(payment?.payment_date)}</p>
    </div>

    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
      ${payment?.reference_number ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Reference No.</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${payment.reference_number}</td></tr>` : ""}
      ${asset ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Asset</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${asset?.description || asset?.name}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Asset Code</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${asset?.asset_code || asset?.id}</td></tr>` : ""}
      ${client?.account_number ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Account No.</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${client.account_number}</td></tr>` : ""}
    </table>

    <div style="background:#f8fafc;border-radius:8px;padding:16px;text-align:center">
      <p style="margin:0;font-size:13px;color:#6b7280">If you have already made this payment, please disregard this reminder. Contact <strong>Ararat Management</strong> for assistance.</p>
    </div>
  </div>
</div>
</body></html>`;
};

const buildCredentialsEmail = (data: any) => {
  const { fullName, email, password, accountNumber, portalUrl } = data;
  return `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${baseStyle}">
<div style="${cardStyle}">
  <div style="${headerStyle}">
    <div style="width:56px;height:56px;background:rgba(255,255,255,0.2);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px">
      <span style="font-size:28px">🔑</span>
    </div>
    <h1 style="margin:0;font-size:22px;font-weight:700">Welcome to Ararat</h1>
    <p style="margin:6px 0 0;opacity:0.85;font-size:14px">Your client portal account is ready</p>
  </div>
  <div style="padding:28px 0 0">
    <p style="margin:0 0 16px;font-size:15px;color:#374151">Dear <strong>${fullName || "Client"}</strong>,</p>
    <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6">
      An account has been created for you on the Ararat client portal. Use the credentials below to sign in. For your security, please change your password after your first login.
    </p>
    <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:20px;margin-bottom:24px">
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Login Email</td><td style="padding:8px 0;color:#111827;font-size:14px;font-weight:700;text-align:right">${email}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Temporary Password</td><td style="padding:8px 0;color:#111827;font-size:14px;font-weight:700;text-align:right;font-family:monospace">${password}</td></tr>
        ${accountNumber ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Account No.</td><td style="padding:8px 0;color:#111827;font-size:14px;font-weight:700;text-align:right">${accountNumber}</td></tr>` : ""}
      </table>
    </div>
    ${portalUrl ? `<div style="text-align:center;margin-bottom:24px">
      <a href="${portalUrl}" style="display:inline-block;background:#1a56db;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 28px;border-radius:8px">Sign in to your portal</a>
    </div>` : ""}
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;text-align:center">
      <p style="margin:0;font-size:13px;color:#92400e">Keep these details private. If you didn't expect this email, please contact your provider.</p>
    </div>
  </div>
</div>
</body></html>`;
};

const buildStaffCredentialsEmail = (data: any) => {
  const { fullName, email, password, role, department, companyName, portalUrl } = data;
  const roleLabel = String(role || "staff").replace(/_/g, " ");
  return `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${baseStyle}">
<div style="${cardStyle}">
  <div style="${headerStyle}">
    <div style="width:56px;height:56px;background:rgba(255,255,255,0.2);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px">
      <span style="font-size:28px">🔑</span>
    </div>
    <h1 style="margin:0;font-size:22px;font-weight:700">Welcome to ${companyName || "Ararat"}</h1>
    <p style="margin:6px 0 0;opacity:0.85;font-size:14px">Your staff portal account is ready</p>
  </div>
  <div style="padding:28px 0 0">
    <p style="margin:0 0 16px;font-size:15px;color:#374151">Dear <strong>${fullName || "Colleague"}</strong>,</p>
    <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6">
      An account has been created for you${companyName ? ` at <strong>${companyName}</strong>` : ""} with the role of
      <strong style="text-transform:capitalize">${roleLabel}</strong>. Sign in with the temporary password below —
      <strong>you will be required to set your own password the first time you log in</strong>.
    </p>
    <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:20px;margin-bottom:24px">
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Login Email</td><td style="padding:8px 0;color:#111827;font-size:14px;font-weight:700;text-align:right">${email}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Temporary Password</td><td style="padding:8px 0;color:#111827;font-size:14px;font-weight:700;text-align:right;font-family:monospace">${password}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Role</td><td style="padding:8px 0;color:#111827;font-size:14px;font-weight:700;text-align:right;text-transform:capitalize">${roleLabel}</td></tr>
        ${department ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Department</td><td style="padding:8px 0;color:#111827;font-size:14px;font-weight:700;text-align:right">${department}</td></tr>` : ""}
      </table>
    </div>
    ${portalUrl ? `<div style="text-align:center;margin-bottom:24px">
      <a href="${portalUrl}" style="display:inline-block;background:#1a56db;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 28px;border-radius:8px">Sign in to the portal</a>
    </div>` : ""}
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;text-align:center">
      <p style="margin:0;font-size:13px;color:#92400e">This temporary password stops being valid once you set your own. Keep these details private — if you didn't expect this email, contact your administrator.</p>
    </div>
  </div>
</div>
</body></html>`;
};

const buildMemberCredentialsEmail = (data: any) => {
  const { fullName, email, password, memberNo, saccoName, portalUrl } = data;
  return `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${baseStyle}">
<div style="${cardStyle}">
  <div style="${headerStyle}">
    <div style="width:56px;height:56px;background:rgba(255,255,255,0.2);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px">
      <span style="font-size:28px">🔑</span>
    </div>
    <h1 style="margin:0;font-size:22px;font-weight:700">Welcome to ${saccoName || "your sacco"}</h1>
    <p style="margin:6px 0 0;opacity:0.85;font-size:14px">Your member portal login is ready</p>
  </div>
  <div style="padding:28px 0 0">
    <p style="margin:0 0 16px;font-size:15px;color:#374151">Dear <strong>${fullName || "Member"}</strong>,</p>
    <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6">
      Your sacco administrator has created a member portal account for you. Sign in with the temporary
      password below — <strong>you will be required to set your own password the first time you log in</strong>.
      The portal gives you access to your contributions, loans, shares, voting, contracts and documents.
    </p>
    <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:20px;margin-bottom:24px">
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Login Email</td><td style="padding:8px 0;color:#111827;font-size:14px;font-weight:700;text-align:right">${email}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Temporary Password</td><td style="padding:8px 0;color:#111827;font-size:14px;font-weight:700;text-align:right;font-family:monospace">${password}</td></tr>
        ${memberNo ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Member No.</td><td style="padding:8px 0;color:#111827;font-size:14px;font-weight:700;text-align:right">${memberNo}</td></tr>` : ""}
      </table>
    </div>
    ${portalUrl ? `<div style="text-align:center;margin-bottom:24px">
      <a href="${portalUrl}" style="display:inline-block;background:#1a56db;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 28px;border-radius:8px">Sign in to the member portal</a>
    </div>` : ""}
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;text-align:center">
      <p style="margin:0;font-size:13px;color:#92400e">This temporary password stops being valid once you set your own. Keep these details private — if you didn't expect this email, contact your sacco administrator.</p>
    </div>
  </div>
</div>
</body></html>`;
};

const buildRegistrationConfirmationEmail = (data: any) => {
  const {
    adminName, entityName, entityType, planName, seats,
    regNumber, sasraLicence, location, city, registeredOn, portalUrl,
  } = data;
  const isSacco = entityType === "sacco";
  const entityLabel = isSacco ? "Sacco" : "Company";
  const seatsLabel = isSacco ? "Members" : "Users";
  return `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${baseStyle}">
<div style="${cardStyle}">
  <div style="${headerStyle}">
    <div style="width:56px;height:56px;background:rgba(255,255,255,0.2);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px">
      <span style="font-size:28px">🎉</span>
    </div>
    <h1 style="margin:0;font-size:22px;font-weight:700">${entityLabel} Registered</h1>
    <p style="margin:6px 0 0;opacity:0.85;font-size:14px">${entityName || `Your ${entityLabel.toLowerCase()}`} is now on Ararat Management</p>
  </div>
  <div style="padding:28px 0 0">
    <p style="margin:0 0 16px;font-size:15px;color:#374151">Dear <strong>${adminName || "Administrator"}</strong>,</p>
    <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6">
      This confirms that you have successfully registered
      <strong>${entityName || `your ${entityLabel.toLowerCase()}`}</strong> on Ararat Management
      and your ${isSacco ? "sacco admin" : "admin"} account has been created.
    </p>
    <h3 style="font-size:13px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 12px">Registration Summary</h3>
    <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:20px;margin-bottom:24px">
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">${entityLabel} Name</td><td style="padding:8px 0;color:#111827;font-size:14px;font-weight:700;text-align:right">${entityName || "—"}</td></tr>
        ${regNumber ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Registration No.</td><td style="padding:8px 0;color:#111827;font-size:14px;font-weight:700;text-align:right">${regNumber}</td></tr>` : ""}
        ${sasraLicence ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">SASRA Licence</td><td style="padding:8px 0;color:#111827;font-size:14px;font-weight:700;text-align:right">${sasraLicence}</td></tr>` : ""}
        ${planName ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">${isSacco ? "Tier" : "Plan"}</td><td style="padding:8px 0;color:#111827;font-size:14px;font-weight:700;text-align:right;text-transform:capitalize">${planName}</td></tr>` : ""}
        ${seats ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">${seatsLabel}</td><td style="padding:8px 0;color:#111827;font-size:14px;font-weight:700;text-align:right">${seats}</td></tr>` : ""}
        ${location || city ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Location</td><td style="padding:8px 0;color:#111827;font-size:14px;font-weight:700;text-align:right">${[location, city].filter(Boolean).join(", ")}</td></tr>` : ""}
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Registered On</td><td style="padding:8px 0;color:#111827;font-size:14px;font-weight:700;text-align:right">${registeredOn ? formatDate(registeredOn) : formatDate(new Date().toISOString())}</td></tr>
      </table>
    </div>
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;margin-bottom:24px">
      <p style="margin:0;font-size:13px;color:#1e40af;line-height:1.6">
        <strong>What happens next?</strong> Your dashboard is activated once your subscription payment
        is confirmed. After that, sign in to set up your ${isSacco ? "members, contributions and loans" : "team, clients and assets"}.
      </p>
    </div>
    ${portalUrl ? `<div style="text-align:center;margin-bottom:24px">
      <a href="${portalUrl}" style="display:inline-block;background:#1a56db;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 28px;border-radius:8px">Sign in to your dashboard</a>
    </div>` : ""}
    <div style="background:#f8fafc;border-radius:8px;padding:16px;text-align:center">
      <p style="margin:0;font-size:13px;color:#6b7280">This is an automated confirmation from <strong>Ararat Management</strong>. If you did not register this ${entityLabel.toLowerCase()}, please contact support immediately.</p>
    </div>
  </div>
</div>
</body></html>`;
};

const buildElectionNominationsOpenEmail = (data: any) => {
  const { fullName, saccoName, electionTitle, positions, portalUrl } = data;
  const positionItems = (positions || []).map((p: any) =>
    `<li style="margin:0 0 6px;font-size:14px;color:#374151"><strong>${p.title || p}</strong>${p.seats > 1 ? ` — ${p.seats} seats` : ""}</li>`
  ).join("");
  return `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${baseStyle}">
<div style="${cardStyle}">
  <div style="${headerStyle}">
    <div style="width:56px;height:56px;background:rgba(255,255,255,0.2);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px">
      <span style="font-size:28px">📋</span>
    </div>
    <h1 style="margin:0;font-size:22px;font-weight:700">Nominations are open</h1>
    <p style="margin:6px 0 0;opacity:0.85;font-size:14px">${electionTitle || "Sacco election"}${saccoName ? ` · ${saccoName}` : ""}</p>
  </div>
  <div style="padding:28px 0 0">
    <p style="margin:0 0 16px;font-size:15px;color:#374151">Dear <strong>${fullName || "Member"}</strong>,</p>
    <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6">
      Nominations are now open for <strong>${electionTitle || "your sacco's election"}</strong>.
      You can stand for a position yourself or nominate a fellow member from the member portal.
      All nominations are vetted before the candidate list is confirmed.
    </p>
    ${positionItems ? `
    <h3 style="font-size:13px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 12px">Positions up for election</h3>
    <ul style="margin:0 0 24px;padding-left:20px">${positionItems}</ul>` : ""}
    ${portalUrl ? `<div style="text-align:center;margin-bottom:24px">
      <a href="${portalUrl}" style="display:inline-block;background:#1a56db;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 28px;border-radius:8px">Open the member portal</a>
    </div>` : ""}
    <div style="background:#f8fafc;border-radius:8px;padding:16px;text-align:center">
      <p style="margin:0;font-size:13px;color:#6b7280">You are receiving this because you are a member of <strong>${saccoName || "your sacco"}</strong>.</p>
    </div>
  </div>
</div>
</body></html>`;
};

const buildElectionVotingOpenEmail = (data: any) => {
  const { fullName, saccoName, electionTitle, portalUrl } = data;
  return `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${baseStyle}">
<div style="${cardStyle}">
  <div style="${headerStyle}">
    <div style="width:56px;height:56px;background:rgba(255,255,255,0.2);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px">
      <span style="font-size:28px">🗳️</span>
    </div>
    <h1 style="margin:0;font-size:22px;font-weight:700">Voting is open</h1>
    <p style="margin:6px 0 0;opacity:0.85;font-size:14px">${electionTitle || "Sacco election"}${saccoName ? ` · ${saccoName}` : ""}</p>
  </div>
  <div style="padding:28px 0 0">
    <p style="margin:0 0 16px;font-size:15px;color:#374151">Dear <strong>${fullName || "Member"}</strong>,</p>
    <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6">
      Voting is now open for <strong>${electionTitle || "your sacco's election"}</strong>.
      Sign in to the member portal to cast your ballot.
    </p>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px;margin-bottom:24px">
      <p style="margin:0;font-size:13px;color:#065f46;line-height:1.6">
        <strong>Your vote is secret and final.</strong> Your ballot is stored with no link to your identity —
        after voting you'll receive an anonymous receipt code you can use at any time to confirm your
        ballot was counted exactly as you cast it.
      </p>
    </div>
    ${portalUrl ? `<div style="text-align:center;margin-bottom:24px">
      <a href="${portalUrl}" style="display:inline-block;background:#1a56db;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 28px;border-radius:8px">Cast your ballot</a>
    </div>` : ""}
    <div style="background:#f8fafc;border-radius:8px;padding:16px;text-align:center">
      <p style="margin:0;font-size:13px;color:#6b7280">Every vote counts towards quorum — results are published only after voting closes.</p>
    </div>
  </div>
</div>
</body></html>`;
};

const buildElectionResultsEmail = (data: any) => {
  const { fullName, saccoName, electionTitle, winners, turnoutPercent, quorumMet, hasTies, portalUrl } = data;
  const winnerRows = (winners || []).map((w: any) => `
    <tr>
      <td style="padding:10px 0;color:#374151;font-size:14px;border-bottom:1px solid #f3f4f6">${w.position}</td>
      <td style="padding:10px 0;color:#111827;font-size:14px;font-weight:700;text-align:right;border-bottom:1px solid #f3f4f6">${w.tie ? '<span style="color:#d97706">Tie — runoff required</span>' : w.name}</td>
    </tr>`).join("");
  return `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${baseStyle}">
<div style="${cardStyle}">
  <div style="${headerStyle}">
    <div style="width:56px;height:56px;background:rgba(255,255,255,0.2);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px">
      <span style="font-size:28px">🏆</span>
    </div>
    <h1 style="margin:0;font-size:22px;font-weight:700">Results published</h1>
    <p style="margin:6px 0 0;opacity:0.85;font-size:14px">${electionTitle || "Sacco election"}${saccoName ? ` · ${saccoName}` : ""}</p>
  </div>
  <div style="padding:28px 0 0">
    <p style="margin:0 0 16px;font-size:15px;color:#374151">Dear <strong>${fullName || "Member"}</strong>,</p>
    <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6">
      The results of <strong>${electionTitle || "your sacco's election"}</strong> have been published.
      Full per-candidate counts and the election audit trail are available in the member portal.
    </p>
    ${winnerRows ? `
    <h3 style="font-size:13px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 12px">Elected</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">${winnerRows}</table>` : ""}
    <div style="display:flex;gap:12px;margin-bottom:24px">
      <div style="flex:1;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:14px;text-align:center">
        <p style="margin:0 0 4px;font-size:11px;color:#6b7280;text-transform:uppercase">Turnout</p>
        <p style="margin:0;font-size:16px;font-weight:800;color:#111827">${turnoutPercent != null ? `${turnoutPercent}%` : "—"}</p>
      </div>
      <div style="flex:1;background:${quorumMet ? "#f0fdf4" : "#fef2f2"};border:1px solid ${quorumMet ? "#bbf7d0" : "#fecaca"};border-radius:10px;padding:14px;text-align:center">
        <p style="margin:0 0 4px;font-size:11px;color:#6b7280;text-transform:uppercase">Quorum</p>
        <p style="margin:0;font-size:16px;font-weight:800;color:${quorumMet ? "#059669" : "#dc2626"}">${quorumMet ? "Met" : "Not met"}</p>
      </div>
    </div>
    ${hasTies ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;text-align:center;margin-bottom:24px">
      <p style="margin:0;font-size:13px;color:#92400e">One or more positions ended in a tie. No winner is declared for a tied seat — a runoff election will follow.</p>
    </div>` : ""}
    ${portalUrl ? `<div style="text-align:center;margin-bottom:24px">
      <a href="${portalUrl}" style="display:inline-block;background:#1a56db;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 28px;border-radius:8px">View full results</a>
    </div>` : ""}
    <div style="background:#f8fafc;border-radius:8px;padding:16px;text-align:center">
      <p style="margin:0;font-size:13px;color:#6b7280">Voted? You can verify your ballot any time with your receipt code in the portal.</p>
    </div>
  </div>
</div>
</body></html>`;
};

const buildElectionVotingClosedEmail = (data: any) => {
  const { fullName, saccoName, electionTitle, portalUrl } = data;
  return `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${baseStyle}">
<div style="${cardStyle}">
  <div style="${headerStyle}">
    <div style="width:56px;height:56px;background:rgba(255,255,255,0.2);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px">
      <span style="font-size:28px">⏳</span>
    </div>
    <h1 style="margin:0;font-size:22px;font-weight:700">Voting has closed</h1>
    <p style="margin:6px 0 0;opacity:0.85;font-size:14px">${electionTitle || "Sacco election"}${saccoName ? ` · ${saccoName}` : ""}</p>
  </div>
  <div style="padding:28px 0 0">
    <p style="margin:0 0 16px;font-size:15px;color:#374151">Dear <strong>${fullName || "Member"}</strong>,</p>
    <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6">
      The voting window for <strong>${electionTitle || "your sacco's election"}</strong> has now closed and no
      further ballots can be cast. The results are being finalised and will be published shortly — you'll be
      notified as soon as they are available.
    </p>
    ${portalUrl ? `<div style="text-align:center;margin-bottom:24px">
      <a href="${portalUrl}" style="display:inline-block;background:#1a56db;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 28px;border-radius:8px">Open the member portal</a>
    </div>` : ""}
    <div style="background:#f8fafc;border-radius:8px;padding:16px;text-align:center">
      <p style="margin:0;font-size:13px;color:#6b7280">Voted? You can verify your ballot any time with your receipt code in the portal.</p>
    </div>
  </div>
</div>
</body></html>`;
};

const buildMotionVotingOpenEmail = (data: any) => {
  const { fullName, saccoName, motionTitle, ballotType, votingEnd, portalUrl } = data;
  const secret = ballotType === "secret";
  return `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${baseStyle}">
<div style="${cardStyle}">
  <div style="${headerStyle}">
    <div style="width:56px;height:56px;background:rgba(255,255,255,0.2);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px">
      <span style="font-size:28px">🗳️</span>
    </div>
    <h1 style="margin:0;font-size:22px;font-weight:700">A motion is open for voting</h1>
    <p style="margin:6px 0 0;opacity:0.85;font-size:14px">${motionTitle || "Sacco motion"}${saccoName ? ` · ${saccoName}` : ""}</p>
  </div>
  <div style="padding:28px 0 0">
    <p style="margin:0 0 16px;font-size:15px;color:#374151">Dear <strong>${fullName || "Member"}</strong>,</p>
    <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6">
      Voting is now open on the motion <strong>${motionTitle || "before the sacco"}</strong>.
      Sign in to the member portal to cast your Yes / No / Abstain vote.
    </p>
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:16px;margin-bottom:24px">
      <p style="margin:0;font-size:13px;color:#1e40af;line-height:1.6">
        ${secret
          ? "This is a <strong>secret ballot</strong> — only aggregate totals are published, never individual votes."
          : "This is a <strong>visible ballot</strong> — the full breakdown is shown to members after voting closes."}
        ${votingEnd ? `<br>Voting closes on <strong>${formatDate(votingEnd)}</strong>.` : ""}
      </p>
    </div>
    ${portalUrl ? `<div style="text-align:center;margin-bottom:24px">
      <a href="${portalUrl}" style="display:inline-block;background:#1a56db;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 28px;border-radius:8px">Cast your vote</a>
    </div>` : ""}
    <div style="background:#f8fafc;border-radius:8px;padding:16px;text-align:center">
      <p style="margin:0;font-size:13px;color:#6b7280">You are receiving this because you are a member of <strong>${saccoName || "your sacco"}</strong>.</p>
    </div>
  </div>
</div>
</body></html>`;
};

const buildMotionClosedEmail = (data: any) => {
  const { fullName, saccoName, motionTitle, status, yes, no, abstain, quorumMet, ballotType, portalUrl } = data;
  const passed = status === "passed";
  const secret = ballotType === "secret";
  return `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${baseStyle}">
<div style="${cardStyle}">
  <div style="background:linear-gradient(135deg,${passed ? "#0e9f6e 0%,#059669" : "#dc2626 0%,#b91c1c"} 100%);border-radius:12px 12px 0 0;padding:28px 32px;text-align:center;color:#fff">
    <div style="width:56px;height:56px;background:rgba(255,255,255,0.2);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px">
      <span style="font-size:28px">${passed ? "✅" : "❌"}</span>
    </div>
    <h1 style="margin:0;font-size:22px;font-weight:700">Motion ${passed ? "passed" : "not carried"}</h1>
    <p style="margin:6px 0 0;opacity:0.85;font-size:14px">${motionTitle || "Sacco motion"}${saccoName ? ` · ${saccoName}` : ""}</p>
  </div>
  <div style="padding:28px 0 0">
    <p style="margin:0 0 16px;font-size:15px;color:#374151">Dear <strong>${fullName || "Member"}</strong>,</p>
    <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6">
      Voting has closed on <strong>${motionTitle || "the motion"}</strong>. The motion was
      <strong style="color:${passed ? "#059669" : "#dc2626"}">${passed ? "carried" : "not carried"}</strong>.
    </p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <tr>
        <td style="padding:12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;text-align:center">
          <p style="margin:0 0 4px;font-size:11px;color:#6b7280;text-transform:uppercase">Yes</p>
          <p style="margin:0;font-size:20px;font-weight:800;color:#059669">${yes ?? 0}</p>
        </td>
        <td style="width:8px"></td>
        <td style="padding:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;text-align:center">
          <p style="margin:0 0 4px;font-size:11px;color:#6b7280;text-transform:uppercase">No</p>
          <p style="margin:0;font-size:20px;font-weight:800;color:#dc2626">${no ?? 0}</p>
        </td>
        <td style="width:8px"></td>
        <td style="padding:12px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;text-align:center">
          <p style="margin:0 0 4px;font-size:11px;color:#6b7280;text-transform:uppercase">Abstain</p>
          <p style="margin:0;font-size:20px;font-weight:800;color:#64748b">${abstain ?? 0}</p>
        </td>
      </tr>
    </table>
    <div style="background:${quorumMet ? "#f0fdf4" : "#fffbeb"};border:1px solid ${quorumMet ? "#bbf7d0" : "#fde68a"};border-radius:8px;padding:14px;text-align:center;margin-bottom:24px">
      <p style="margin:0;font-size:13px;color:${quorumMet ? "#065f46" : "#92400e"}">
        Quorum was <strong>${quorumMet ? "met" : "not met"}</strong>.${!quorumMet && !passed ? " A motion cannot carry without quorum." : ""}
      </p>
    </div>
    ${secret ? `<p style="margin:0 0 20px;font-size:12px;color:#9ca3af;text-align:center">Secret ballot — only aggregate totals are shown.</p>` : ""}
    ${portalUrl ? `<div style="text-align:center;margin-bottom:24px">
      <a href="${portalUrl}" style="display:inline-block;background:#1a56db;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 28px;border-radius:8px">View in the portal</a>
    </div>` : ""}
  </div>
</div>
</body></html>`;
};

const buildSigningOtpEmail = (data: any) => {
  const { signerName, code, documentName, expiresMinutes } = data;
  const digits = String(code || "").split("").map((d: string) =>
    `<span style="display:inline-block;min-width:40px;padding:12px 0;margin:0 4px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;font-size:24px;font-weight:700;color:#111827;font-family:monospace">${d}</span>`
  ).join("");
  return `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${baseStyle}">
<div style="${cardStyle}">
  <div style="${headerStyle}">
    <div style="width:56px;height:56px;background:rgba(255,255,255,0.2);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px">
      <span style="font-size:28px">🔐</span>
    </div>
    <h1 style="margin:0;font-size:22px;font-weight:700">Signature Verification Code</h1>
    <p style="margin:6px 0 0;opacity:0.85;font-size:14px">Confirm your identity to sign</p>
  </div>
  <div style="padding:28px 0 0">
    <p style="margin:0 0 16px;font-size:15px;color:#374151">Hi <strong>${signerName || "there"}</strong>,</p>
    <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6">
      Enter the one-time code below to apply your signature${documentName ? ` to <strong>${documentName}</strong>` : ""}.
    </p>
    <div style="text-align:center;margin:0 0 24px">${digits}</div>
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;text-align:center">
      <p style="margin:0;font-size:13px;color:#92400e">This code expires in ${expiresMinutes || 10} minutes. Never share it. If you didn't request to sign a document, contact your administrator immediately.</p>
    </div>
  </div>
</div>
</body></html>`;
};

const buildSignatureAlertEmail = (data: any) => {
  const { ownerName, documentName, actor, time, ip, device } = data;
  return `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${baseStyle}">
<div style="${cardStyle}">
  <div style="${headerStyle}">
    <div style="width:56px;height:56px;background:rgba(255,255,255,0.2);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px">
      <span style="font-size:28px">🛡️</span>
    </div>
    <h1 style="margin:0;font-size:22px;font-weight:700">Your signature was used</h1>
    <p style="margin:6px 0 0;opacity:0.85;font-size:14px">Security notification</p>
  </div>
  <div style="padding:28px 0 0">
    <p style="margin:0 0 16px;font-size:15px;color:#374151">Hi <strong>${ownerName || "there"}</strong>,</p>
    <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6">
      Your saved signature was just applied to a document. If this was you, no action is needed.
    </p>
    <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:20px;margin-bottom:24px">
      <table style="width:100%;border-collapse:collapse">
        ${documentName ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Document</td><td style="padding:8px 0;color:#111827;font-size:14px;font-weight:600;text-align:right">${documentName}</td></tr>` : ""}
        ${actor ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Signed by</td><td style="padding:8px 0;color:#111827;font-size:14px;font-weight:600;text-align:right">${actor}</td></tr>` : ""}
        ${time ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">When</td><td style="padding:8px 0;color:#111827;font-size:14px;font-weight:600;text-align:right">${time}</td></tr>` : ""}
        ${ip ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">IP Address</td><td style="padding:8px 0;color:#111827;font-size:14px;font-weight:600;text-align:right">${ip}</td></tr>` : ""}
        ${device ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Device</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${device}</td></tr>` : ""}
      </table>
    </div>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;text-align:center">
      <p style="margin:0;font-size:13px;color:#991b1b">If you did NOT authorize this, change your password and notify your administrator right away.</p>
    </div>
  </div>
</div>
</body></html>`;
};

const buildSigningInviteEmail = (data: any) => {
  const { signerName, documentName, link, message, expiresAt } = data;
  return `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${baseStyle}">
<div style="${cardStyle}">
  <div style="${headerStyle}">
    <div style="width:56px;height:56px;background:rgba(255,255,255,0.2);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px">
      <span style="font-size:28px">✍️</span>
    </div>
    <h1 style="margin:0;font-size:22px;font-weight:700">You've been asked to sign</h1>
    <p style="margin:6px 0 0;opacity:0.85;font-size:14px">Secure document signing request</p>
  </div>
  <div style="padding:28px 0 0">
    <p style="margin:0 0 16px;font-size:15px;color:#374151">Hi <strong>${signerName || "there"}</strong>,</p>
    <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6">
      You have been requested to review and sign${documentName ? ` <strong>${documentName}</strong>` : " a document"}.
      Click the secure button below to open it. You'll confirm your identity with a one-time code before signing.
    </p>
    ${message ? `<div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:20px"><p style="margin:0;font-size:13px;color:#374151;font-style:italic">"${message}"</p></div>` : ""}
    <div style="text-align:center;margin-bottom:24px">
      <a href="${link}" style="display:inline-block;background:#1a56db;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:13px 32px;border-radius:8px">Review &amp; Sign Document</a>
    </div>
    <p style="margin:0 0 20px;font-size:12px;color:#9ca3af;text-align:center;word-break:break-all">
      Or paste this link into your browser:<br>${link}
    </p>
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;text-align:center">
      <p style="margin:0;font-size:13px;color:#92400e">This is a one-time link${expiresAt ? ` and expires on ${formatDate(expiresAt)}` : ""}. It cannot be reused or shared once the document is signed.</p>
    </div>
  </div>
</div>
</body></html>`;
};

// E-signature reminder. Sent by the esign-reminders worker to a signer whose
// one-time link is still unused — same secure link, gentler nudge framing.
const buildSigningReminderEmail = (data: any) => {
  const { signerName, documentName, link, expiresAt, reminderNumber } = data;
  return `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${baseStyle}">
<div style="${cardStyle}">
  <div style="${headerStyle}">
    <div style="width:56px;height:56px;background:rgba(255,255,255,0.2);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px">
      <span style="font-size:28px">🔔</span>
    </div>
    <h1 style="margin:0;font-size:22px;font-weight:700">Still waiting for your signature</h1>
    <p style="margin:6px 0 0;opacity:0.85;font-size:14px">A friendly reminder${reminderNumber ? ` (reminder ${reminderNumber})` : ""}</p>
  </div>
  <div style="padding:28px 0 0">
    <p style="margin:0 0 16px;font-size:15px;color:#374151">Hi <strong>${signerName || "there"}</strong>,</p>
    <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6">
      ${documentName ? `<strong>${documentName}</strong> is` : "A document is"} still waiting for your signature.
      It only takes a minute — open the secure link below and you'll confirm your identity with a one-time code before signing.
    </p>
    <div style="text-align:center;margin-bottom:24px">
      <a href="${link}" style="display:inline-block;background:#1a56db;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:13px 32px;border-radius:8px">Review &amp; Sign Document</a>
    </div>
    <p style="margin:0 0 20px;font-size:12px;color:#9ca3af;text-align:center;word-break:break-all">
      Or paste this link into your browser:<br>${link}
    </p>
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;text-align:center">
      <p style="margin:0;font-size:13px;color:#92400e">This is a one-time link${expiresAt ? ` and expires on ${formatDate(expiresAt)}` : ""}. After that the sender will need to issue a new request.</p>
    </div>
  </div>
</div>
</body></html>`;
};

// Sales-agent follow-up reminder. Sent by the agent-followup-reminders worker
// when a scheduled follow-up comes due, and addressed to the AGENT (not the
// lead) — it is the agent's own diary nudge.
const buildFollowUpReminderEmail = (data: any) => {
  const { agentName, leadName, leadPhone, leadEmail, appointmentType, scheduledAt, location, notes, portalUrl, isOverdue } = data;

  const accent      = isOverdue ? "#dc2626" : "#1a56db";
  const accentDark  = isOverdue ? "#b91c1c" : "#1e429f";
  const bannerBg    = isOverdue ? "#fef2f2" : "#eff6ff";
  const bannerLine  = isOverdue ? "#fecaca" : "#bfdbfe";
  const typeLabel   = (appointmentType || "follow_up").replace(/_/g, " ");
  const when = scheduledAt
    ? new Date(scheduledAt).toLocaleString("en-KE", {
        weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
      })
    : "—";

  return `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${baseStyle}">
<div style="${cardStyle}">
  <div style="background:linear-gradient(135deg,${accent} 0%,${accentDark} 100%);border-radius:12px 12px 0 0;padding:28px 32px;text-align:center;color:#ffffff;margin:-32px -32px 28px">
    <div style="font-size:36px;margin-bottom:8px">${isOverdue ? "⏰" : "🔔"}</div>
    <h1 style="margin:0;font-size:22px;font-weight:700">${isOverdue ? "Overdue follow-up" : "Follow-up reminder"}</h1>
    <p style="margin:6px 0 0;opacity:0.85;font-size:14px">${isOverdue ? "This one has already passed" : "Coming up on your schedule"}</p>
  </div>

  <p style="margin:0 0 16px;font-size:15px;color:#374151">Hi <strong>${agentName || "there"}</strong>,</p>
  <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6">
    You scheduled a <strong>${typeLabel}</strong> with <strong>${leadName || "a lead"}</strong>.
    ${isOverdue ? "It was due and is still open — close it out or push it to a new date." : "Here are the details so you're ready."}
  </p>

  <div style="background:${bannerBg};border:1px solid ${bannerLine};border-radius:10px;padding:20px;text-align:center;margin-bottom:24px">
    <p style="margin:0 0 4px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em">When</p>
    <p style="margin:0;font-size:20px;font-weight:800;color:${accent}">${when}</p>
  </div>

  <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
    <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Lead</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${leadName || "—"}</td></tr>
    ${leadPhone ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Phone</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${leadPhone}</td></tr>` : ""}
    ${leadEmail ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Email</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${leadEmail}</td></tr>` : ""}
    <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Type</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;text-align:right;text-transform:capitalize">${typeLabel}</td></tr>
    ${location ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Location</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${location}</td></tr>` : ""}
  </table>

  ${notes ? `<div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:24px"><p style="margin:0 0 4px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em">Your notes</p><p style="margin:0;font-size:13px;color:#374151">${notes}</p></div>` : ""}

  ${portalUrl ? `<div style="text-align:center;margin-bottom:8px"><a href="${portalUrl}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:13px 32px;border-radius:8px">Open my portal</a></div>` : ""}
</div>
</body></html>`;
};

// ─── Assist requests (bronze agent → gold agent) ──────────────────────────────
// Sent when a bronze agent asks a gold agent to onboard an admin. The portal
// already shows this in realtime; the email is for the gold agent who is not
// logged in, which is most of the time.
const buildAssistRequestEmail = (data: any) => {
  const { goldName, bronzeName, bronzeCode, bronzePhone, bronzeEmail, adminName, helpType, note, amount, portalUrl } = data;

  return `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${baseStyle}">
<div style="${cardStyle}">
  <div style="background:linear-gradient(135deg,#f59e0b 0%,#d97706 100%);border-radius:12px 12px 0 0;padding:28px 32px;text-align:center;color:#ffffff;margin:-32px -32px 28px">
    <div style="font-size:36px;margin-bottom:8px">🛟</div>
    <h1 style="margin:0;font-size:22px;font-weight:700">An agent needs your help</h1>
    <p style="margin:6px 0 0;opacity:0.85;font-size:14px">${bronzeName || "A bronze agent"} has asked you to onboard an admin</p>
  </div>

  <p style="margin:0 0 16px;font-size:15px;color:#374151">Hi <strong>${goldName || "there"}</strong>,</p>
  <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6">
    <strong>${bronzeName || "A bronze agent"}</strong>${bronzeCode ? ` (${bronzeCode})` : ""} would like you to take
    <strong>${adminName || "an admin"}</strong> through the system. Accept it in your portal, then mark it complete
    when the onboarding is done.
  </p>

  ${helpType || note ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:16px;margin-bottom:24px"><p style="margin:0 0 4px;font-size:12px;color:#92400e;text-transform:uppercase;letter-spacing:0.05em">What they need</p>${helpType ? `<p style="margin:0 0 6px;font-size:15px;color:#111827;font-weight:700">${helpType}</p>` : ""}${note ? `<p style="margin:0;font-size:14px;color:#374151;line-height:1.5">${note}</p>` : ""}</div>` : ""}

  <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
    <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Admin / company</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${adminName || "—"}</td></tr>
    ${helpType ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Help needed</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${helpType}</td></tr>` : ""}
    <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Requested by</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${bronzeName || "—"}</td></tr>
    ${bronzePhone ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Their phone</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${bronzePhone}</td></tr>` : ""}
    ${bronzeEmail ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Their email</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${bronzeEmail}</td></tr>` : ""}
  </table>

  <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:20px;text-align:center;margin-bottom:24px">
    <p style="margin:0 0 4px;font-size:12px;color:#065f46;text-transform:uppercase;letter-spacing:0.05em">You earn on completion</p>
    <p style="margin:0;font-size:22px;font-weight:800;color:#047857">${formatCurrency(amount || 1000)}</p>
  </div>

  ${portalUrl ? `<div style="text-align:center;margin-bottom:8px"><a href="${portalUrl}" style="display:inline-block;background:#d97706;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:13px 32px;border-radius:8px">Open my portal</a></div>` : ""}
</div>
</body></html>`;
};

// Sent to the other party when an assist changes hands: the gold agent accepted,
// declined or finished it, or the bronze agent withdrew it.
const ASSIST_UPDATE_COPY: Record<string, { emoji: string; title: string; accent: string; accentDark: string }> = {
  accepted:  { emoji: "🤝", title: "Your assist was accepted", accent: "#1a56db", accentDark: "#1e429f" },
  declined:  { emoji: "🚫", title: "Your assist was declined",  accent: "#dc2626", accentDark: "#b91c1c" },
  completed: { emoji: "✅", title: "Onboarding complete",       accent: "#059669", accentDark: "#047857" },
  cancelled: { emoji: "↩️", title: "An assist was cancelled",   accent: "#6b7280", accentDark: "#4b5563" },
};

const buildAssistUpdateEmail = (data: any) => {
  const { recipientName, actorName, actorCode, status, adminName, outcome, declineReason, amount, portalUrl } = data;
  const copy = ASSIST_UPDATE_COPY[status] || ASSIST_UPDATE_COPY.accepted;

  const lead = {
    accepted:  `<strong>${actorName || "A gold agent"}</strong> has taken on <strong>${adminName || "the admin"}</strong> and will run the onboarding. They can reach you directly if they need anything.`,
    declined:  `<strong>${actorName || "The gold agent"}</strong> can't take <strong>${adminName || "this admin"}</strong> right now. Ask another gold agent from your portal.`,
    completed: `<strong>${actorName || "The gold agent"}</strong> has finished onboarding <strong>${adminName || "the admin"}</strong>.`,
    cancelled: `<strong>${actorName || "The bronze agent"}</strong> has withdrawn the request to onboard <strong>${adminName || "an admin"}</strong>. No action needed.`,
  }[status as string] || "";

  return `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${baseStyle}">
<div style="${cardStyle}">
  <div style="background:linear-gradient(135deg,${copy.accent} 0%,${copy.accentDark} 100%);border-radius:12px 12px 0 0;padding:28px 32px;text-align:center;color:#ffffff;margin:-32px -32px 28px">
    <div style="font-size:36px;margin-bottom:8px">${copy.emoji}</div>
    <h1 style="margin:0;font-size:22px;font-weight:700">${copy.title}</h1>
    <p style="margin:6px 0 0;opacity:0.85;font-size:14px">${adminName || "An admin"}</p>
  </div>

  <p style="margin:0 0 16px;font-size:15px;color:#374151">Hi <strong>${recipientName || "there"}</strong>,</p>
  <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6">${lead}</p>

  ${declineReason ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:16px;margin-bottom:24px"><p style="margin:0 0 4px;font-size:12px;color:#991b1b;text-transform:uppercase;letter-spacing:0.05em">Reason</p><p style="margin:0;font-size:14px;color:#374151">${declineReason}</p></div>` : ""}
  ${outcome ? `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px;margin-bottom:24px"><p style="margin:0 0 4px;font-size:12px;color:#065f46;text-transform:uppercase;letter-spacing:0.05em">What was done</p><p style="margin:0;font-size:14px;color:#374151">${outcome}</p></div>` : ""}

  <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
    <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Admin / company</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${adminName || "—"}</td></tr>
    <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">${status === "cancelled" ? "Withdrawn by" : "Gold agent"}</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${actorName || "—"}${actorCode ? ` (${actorCode})` : ""}</td></tr>
    ${status === "completed" && amount ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Commission paid</td><td style="padding:8px 0;color:#047857;font-size:13px;font-weight:600;text-align:right">${formatCurrency(amount)}</td></tr>` : ""}
  </table>

  ${portalUrl ? `<div style="text-align:center;margin-bottom:8px"><a href="${portalUrl}" style="display:inline-block;background:${copy.accent};color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:13px 32px;border-radius:8px">Open my portal</a></div>` : ""}
</div>
</body></html>`;
};

// ─── Agent tickets (the bronze ↔ gold conversation channel) ───────────────────
// The portal shows tickets in realtime; these are for the agent who is not
// looking at it, which is most of the time. The message body is quoted in full
// so a short question can be answered from the phone without opening anything.

const TICKET_PRIORITY_STYLE: Record<string, { bg: string; border: string; text: string }> = {
  urgent: { bg: "#fef2f2", border: "#fecaca", text: "#991b1b" },
  high:   { bg: "#fff7ed", border: "#fed7aa", text: "#9a3412" },
  normal: { bg: "#eff6ff", border: "#bfdbfe", text: "#1e40af" },
  low:    { bg: "#f9fafb", border: "#e5e7eb", text: "#4b5563" },
};

const TICKET_CATEGORY_LABEL: Record<string, string> = {
  onboarding:   "Onboarding help",
  lead_support: "Lead support",
  commission:   "Commission",
  training:     "Training",
  system:       "System issue",
  other:        "General",
};

const quoteBlock = (label: string, body: string, accent = "#e5e7eb") => `
  <div style="background:#f9fafb;border-left:3px solid ${accent};border-radius:0 10px 10px 0;padding:16px;margin-bottom:24px">
    <p style="margin:0 0 6px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em">${label}</p>
    <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;white-space:pre-wrap">${body || ""}</p>
  </div>`;

const buildTicketOpenedEmail = (data: any) => {
  const {
    toName, ticketNo, subject, body, category, priority, fromName, fromCode,
    fromTier, fromPhone, fromEmail, adminName, isPool, portalUrl,
  } = data;
  const pri = TICKET_PRIORITY_STYLE[priority] || TICKET_PRIORITY_STYLE.normal;

  return `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${baseStyle}">
<div style="${cardStyle}">
  <div style="background:linear-gradient(135deg,#1a56db 0%,#1e429f 100%);border-radius:12px 12px 0 0;padding:28px 32px;text-align:center;color:#ffffff;margin:-32px -32px 28px">
    <div style="font-size:36px;margin-bottom:8px">🎫</div>
    <h1 style="margin:0;font-size:22px;font-weight:700">${isPool ? "A ticket is waiting to be picked up" : "A new ticket for you"}</h1>
    <p style="margin:6px 0 0;opacity:0.85;font-size:14px">${ticketNo || "Ticket"} · ${subject || ""}</p>
  </div>

  <p style="margin:0 0 16px;font-size:15px;color:#374151">Hi <strong>${toName || "there"}</strong>,</p>
  <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6">
    <strong>${fromName || "An agent"}</strong>${fromCode ? ` (${fromCode})` : ""}${fromTier ? ` · ${fromTier} agent` : ""}
    ${isPool
      ? "has raised a ticket for whichever gold agent can take it. The first to claim it owns the conversation, so open the portal if this is one for you."
      : "has raised a ticket with you. Reply in your portal and the whole exchange stays on the ticket."}
  </p>

  ${quoteBlock("What they said", body, "#1a56db")}

  <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
    <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Ticket</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${ticketNo || "—"}</td></tr>
    <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Subject</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${subject || "—"}</td></tr>
    <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">About</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${TICKET_CATEGORY_LABEL[category] || "General"}</td></tr>
    ${adminName ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Admin / company</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${adminName}</td></tr>` : ""}
    ${fromPhone ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Their phone</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${fromPhone}</td></tr>` : ""}
    ${fromEmail ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Their email</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${fromEmail}</td></tr>` : ""}
  </table>

  <div style="background:${pri.bg};border:1px solid ${pri.border};border-radius:10px;padding:14px;text-align:center;margin-bottom:24px">
    <p style="margin:0;font-size:13px;color:${pri.text};font-weight:700;text-transform:uppercase;letter-spacing:0.05em">${priority || "normal"} priority</p>
  </div>

  ${portalUrl ? `<div style="text-align:center;margin-bottom:8px"><a href="${portalUrl}" style="display:inline-block;background:#1a56db;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:13px 32px;border-radius:8px">${isPool ? "Claim this ticket" : "Open the ticket"}</a></div>` : ""}
</div>
</body></html>`;
};

const buildTicketReplyEmail = (data: any) => {
  const { toName, ticketNo, subject, body, fromName, fromCode, portalUrl } = data;

  return `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${baseStyle}">
<div style="${cardStyle}">
  <div style="background:linear-gradient(135deg,#0891b2 0%,#0e7490 100%);border-radius:12px 12px 0 0;padding:28px 32px;text-align:center;color:#ffffff;margin:-32px -32px 28px">
    <div style="font-size:36px;margin-bottom:8px">💬</div>
    <h1 style="margin:0;font-size:22px;font-weight:700">New reply on your ticket</h1>
    <p style="margin:6px 0 0;opacity:0.85;font-size:14px">${ticketNo || "Ticket"} · ${subject || ""}</p>
  </div>

  <p style="margin:0 0 16px;font-size:15px;color:#374151">Hi <strong>${toName || "there"}</strong>,</p>
  <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6">
    <strong>${fromName || "The other agent"}</strong>${fromCode ? ` (${fromCode})` : ""} has replied on
    <strong>${subject || "your ticket"}</strong>.
  </p>

  ${quoteBlock("Their reply", body, "#0891b2")}

  ${portalUrl ? `<div style="text-align:center;margin-bottom:8px"><a href="${portalUrl}" style="display:inline-block;background:#0891b2;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:13px 32px;border-radius:8px">Reply on the ticket</a></div>` : ""}
</div>
</body></html>`;
};

const TICKET_STATUS_COPY: Record<string, { emoji: string; title: string; accent: string; accentDark: string; lead: string }> = {
  claimed:     { emoji: "🙋", title: "A gold agent took your ticket", accent: "#1a56db", accentDark: "#1e429f", lead: "has taken your ticket out of the pool and will work it with you." },
  resolved:    { emoji: "✅", title: "Your ticket was resolved",      accent: "#059669", accentDark: "#047857", lead: "has marked this resolved. If it isn't, reply on the ticket and it reopens." },
  closed:      { emoji: "📁", title: "A ticket was closed",           accent: "#6b7280", accentDark: "#4b5563", lead: "has closed this ticket. It stays on record with the whole conversation." },
  in_progress: { emoji: "↩️", title: "A ticket was reopened",         accent: "#d97706", accentDark: "#b45309", lead: "has reopened this ticket — there is more to do on it." },
  waiting:     { emoji: "⏳", title: "A ticket is waiting on you",     accent: "#d97706", accentDark: "#b45309", lead: "is waiting on you before this ticket can move." },
};

const buildTicketStatusEmail = (data: any) => {
  const { toName, ticketNo, subject, status, note, actorName, actorCode, portalUrl } = data;
  const copy = TICKET_STATUS_COPY[status] || TICKET_STATUS_COPY.in_progress;

  return `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${baseStyle}">
<div style="${cardStyle}">
  <div style="background:linear-gradient(135deg,${copy.accent} 0%,${copy.accentDark} 100%);border-radius:12px 12px 0 0;padding:28px 32px;text-align:center;color:#ffffff;margin:-32px -32px 28px">
    <div style="font-size:36px;margin-bottom:8px">${copy.emoji}</div>
    <h1 style="margin:0;font-size:22px;font-weight:700">${copy.title}</h1>
    <p style="margin:6px 0 0;opacity:0.85;font-size:14px">${ticketNo || "Ticket"} · ${subject || ""}</p>
  </div>

  <p style="margin:0 0 16px;font-size:15px;color:#374151">Hi <strong>${toName || "there"}</strong>,</p>
  <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6">
    <strong>${actorName || "The other agent"}</strong>${actorCode ? ` (${actorCode})` : ""} ${copy.lead}
  </p>

  ${note ? quoteBlock(status === "resolved" ? "What was done" : "Their note", note, copy.accent) : ""}

  ${portalUrl ? `<div style="text-align:center;margin-bottom:8px"><a href="${portalUrl}" style="display:inline-block;background:${copy.accent};color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:13px 32px;border-radius:8px">Open the ticket</a></div>` : ""}
</div>
</body></html>`;
};

// ─── Main Handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      },
    });
  }

  // `to`, `portalUrl` and the template payload are all caller-controlled, and
  // this sends from a verified Resend domain — unauthenticated, it is a
  // ready-made phishing relay (the staffCredentials/clientCredentials templates
  // even render a password and a login link). Any signed-in user may send
  // (clients email their own statements from the portal); sibling Edge
  // Functions call in with the service-role key.
  const auth = await authenticateCaller(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const { type, to, data } = body;

    if (!to) throw new Error("Recipient email (to) is required");
    if (!type) throw new Error("Email type is required");

    let subject = "";
    let html = "";

    switch (type) {
      case "payment_confirmation":
        subject = `Payment Confirmed – ${data?.transaction?.transactionId || data?.transaction?.transaction_id || "Receipt"}`;
        html = buildPaymentConfirmationEmail(data);
        break;
      case "invoice":
        subject = `Invoice ${data?.invoice?.invoiceNumber || data?.invoice?.invoice_number || ""} – Ararat Management`;
        html = buildInvoiceEmail(data);
        break;
      case "statement":
        subject = `Account Statement – ${data?.client?.full_name || data?.client?.name || "Your Account"}`;
        html = buildStatementEmail(data);
        break;
      case "payment_reminder":
        subject = data?.isOverdue
          ? `⚠️ Overdue Payment – ${data?.client?.full_name || "Action Required"}`
          : `🔔 Payment Reminder – Due ${data?.daysUntilDue === 0 ? "Today" : `in ${data?.daysUntilDue} Day(s)`}`;
        html = buildReminderEmail(data);
        break;
      case "client_welcome":
        subject = "Your Ararat client portal login";
        html = buildCredentialsEmail(data);
        break;
      case "sacco_member_welcome":
        subject = `Your ${data?.saccoName ? `${data.saccoName} ` : ""}member portal login`;
        html = buildMemberCredentialsEmail(data);
        break;
      case "admin_registration_confirmation":
        subject = `🎉 ${data?.entityName || (data?.entityType === "sacco" ? "Your sacco" : "Your company")} is registered on Ararat`;
        html = buildRegistrationConfirmationEmail(data);
        break;
      case "sacco_election_nominations_open":
        subject = `Nominations open – ${data?.electionTitle || "sacco election"}${data?.saccoName ? ` · ${data.saccoName}` : ""}`;
        html = buildElectionNominationsOpenEmail(data);
        break;
      case "sacco_election_voting_open":
        subject = `🗳️ Voting is open – ${data?.electionTitle || "sacco election"}${data?.saccoName ? ` · ${data.saccoName}` : ""}`;
        html = buildElectionVotingOpenEmail(data);
        break;
      case "sacco_election_results":
        subject = `Results published – ${data?.electionTitle || "sacco election"}${data?.saccoName ? ` · ${data.saccoName}` : ""}`;
        html = buildElectionResultsEmail(data);
        break;
      case "sacco_election_voting_closed":
        subject = `⏳ Voting closed – ${data?.electionTitle || "sacco election"}${data?.saccoName ? ` · ${data.saccoName}` : ""}`;
        html = buildElectionVotingClosedEmail(data);
        break;
      case "sacco_motion_voting_open":
        subject = `🗳️ Vote now – ${data?.motionTitle || "sacco motion"}${data?.saccoName ? ` · ${data.saccoName}` : ""}`;
        html = buildMotionVotingOpenEmail(data);
        break;
      case "sacco_motion_closed":
        subject = `${data?.status === "passed" ? "✅ Motion passed" : "❌ Motion not carried"} – ${data?.motionTitle || "sacco motion"}${data?.saccoName ? ` · ${data.saccoName}` : ""}`;
        html = buildMotionClosedEmail(data);
        break;
      case "staff_welcome":
        subject = `Your ${data?.companyName ? `${data.companyName} ` : ""}staff portal login`;
        html = buildStaffCredentialsEmail(data);
        break;
      case "signing_otp":
        subject = `Your signing code: ${data?.code || ""}`;
        html = buildSigningOtpEmail(data);
        break;
      case "esign_security_alert":
        subject = `🛡️ Your signature was used${data?.documentName ? ` on ${data.documentName}` : ""}`;
        html = buildSignatureAlertEmail(data);
        break;
      case "agent_follow_up_reminder":
        subject = data?.isOverdue
          ? `⏰ Overdue follow-up – ${data?.leadName || "a lead"}`
          : `🔔 Follow-up reminder – ${data?.leadName || "a lead"}`;
        html = buildFollowUpReminderEmail(data);
        break;
      case "signing_invite":
        subject = `Signature requested${data?.documentName ? `: ${data.documentName}` : ""}`;
        html = buildSigningInviteEmail(data);
        break;
      case "signing_reminder":
        subject = `🔔 Reminder: signature still needed${data?.documentName ? ` – ${data.documentName}` : ""}`;
        html = buildSigningReminderEmail(data);
        break;
      case "assist_request":
        subject = `🛟 ${data?.bronzeName || "An agent"} needs help onboarding ${data?.adminName || "an admin"}`;
        html = buildAssistRequestEmail(data);
        break;
      case "assist_update": {
        const assistSubjects: Record<string, string> = {
          accepted:  `🤝 ${data?.actorName || "A gold agent"} accepted your assist – ${data?.adminName || "an admin"}`,
          declined:  `🚫 Your assist was declined – ${data?.adminName || "an admin"}`,
          completed: `✅ Onboarding complete – ${data?.adminName || "an admin"}`,
          cancelled: `↩️ Assist cancelled – ${data?.adminName || "an admin"}`,
        };
        subject = assistSubjects[data?.status] || `Assist update – ${data?.adminName || "an admin"}`;
        html = buildAssistUpdateEmail(data);
        break;
      }
      case "ticket_opened":
        subject = data?.isPool
          ? `🎫 Unclaimed ticket – ${data?.subject || "an agent needs help"}`
          : `🎫 ${data?.ticketNo ? `${data.ticketNo} – ` : ""}${data?.subject || "New ticket for you"}`;
        html = buildTicketOpenedEmail(data);
        break;
      case "ticket_reply":
        subject = `💬 ${data?.fromName || "An agent"} replied – ${data?.subject || data?.ticketNo || "your ticket"}`;
        html = buildTicketReplyEmail(data);
        break;
      case "ticket_status": {
        const ticketSubjects: Record<string, string> = {
          claimed:     `🙋 ${data?.actorName || "A gold agent"} took your ticket – ${data?.subject || ""}`,
          resolved:    `✅ Ticket resolved – ${data?.subject || data?.ticketNo || ""}`,
          closed:      `📁 Ticket closed – ${data?.subject || data?.ticketNo || ""}`,
          in_progress: `↩️ Ticket reopened – ${data?.subject || data?.ticketNo || ""}`,
          waiting:     `⏳ Waiting on you – ${data?.subject || data?.ticketNo || ""}`,
        };
        subject = ticketSubjects[data?.status] || `Ticket update – ${data?.subject || data?.ticketNo || ""}`;
        html = buildTicketStatusEmail(data);
        break;
      }
      default:
        throw new Error(`Unknown email type: ${type}`);
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result?.message || "Failed to send email via Resend");
    }

    return new Response(JSON.stringify({ success: true, id: result?.id, type }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
});
