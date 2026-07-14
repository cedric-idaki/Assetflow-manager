// @ts-ignore: Deno global is available in Deno runtime
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
// Set EMAIL_FROM to a verified-domain sender (e.g. "AssetFlow <noreply@yourco.com>")
// so emails deliver to any recipient. The onboarding@resend.dev fallback only
// delivers to the Resend account owner's own address (test mode).
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") || "AssetFlow <onboarding@resend.dev>";

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
      <p style="margin:0;font-size:13px;color:#6b7280">Thank you for your payment. This is an automated receipt from <strong>AssetFlow Management</strong>.</p>
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
      <p style="margin:0;font-size:13px;color:#1e40af">Please ensure payment is made by the due date. For queries, contact <strong>AssetFlow Management</strong>.</p>
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
      <p style="margin:0;font-size:13px;color:#6b7280">This statement was generated automatically by <strong>AssetFlow Management</strong>.</p>
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
      <p style="margin:0;font-size:13px;color:#6b7280">If you have already made this payment, please disregard this reminder. Contact <strong>AssetFlow Management</strong> for assistance.</p>
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
    <h1 style="margin:0;font-size:22px;font-weight:700">Welcome to AssetFlow</h1>
    <p style="margin:6px 0 0;opacity:0.85;font-size:14px">Your client portal account is ready</p>
  </div>
  <div style="padding:28px 0 0">
    <p style="margin:0 0 16px;font-size:15px;color:#374151">Dear <strong>${fullName || "Client"}</strong>,</p>
    <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6">
      An account has been created for you on the AssetFlow client portal. Use the credentials below to sign in. For your security, please change your password after your first login.
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
        subject = `Invoice ${data?.invoice?.invoiceNumber || data?.invoice?.invoice_number || ""} – AssetFlow Management`;
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
        subject = "Your AssetFlow client portal login";
        html = buildCredentialsEmail(data);
        break;
      case "sacco_member_welcome":
        subject = `Your ${data?.saccoName ? `${data.saccoName} ` : ""}member portal login`;
        html = buildMemberCredentialsEmail(data);
        break;
      case "signing_otp":
        subject = `Your signing code: ${data?.code || ""}`;
        html = buildSigningOtpEmail(data);
        break;
      case "esign_security_alert":
        subject = `🛡️ Your signature was used${data?.documentName ? ` on ${data.documentName}` : ""}`;
        html = buildSignatureAlertEmail(data);
        break;
      case "signing_invite":
        subject = `Signature requested${data?.documentName ? `: ${data.documentName}` : ""}`;
        html = buildSigningInviteEmail(data);
        break;
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
