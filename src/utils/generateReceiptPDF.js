/**
 * generateReceiptPDF.js
 * 
 * Generates a branded PDF receipt for a completed POS sale.
 * Uses jsPDF (loaded via CDN in the component that calls this).
 * 
 * Usage:
 *   import { generateReceiptPDF } from '../../utils/generateReceiptPDF';
 *   await generateReceiptPDF({ saleData, client, asset, companyProfile, schedule });
 */

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n) =>
  'KES ' + (parseFloat(n) || 0).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric',
  }) : '—';

const fmtShort = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  }) : '—';

const PRICING_LABELS = {
  cash:         'Cash Sale (Full Payment)',
  installment:  'Deposit + Monthly Installments',
  balloon:      'Deposit + Balloon Payment',
  zero_deposit: 'Zero-Deposit Installment',
  lease_to_own: 'Lease-to-Own',
};

const PAYMENT_LABELS = {
  mpesa:         'M-Pesa',
  cash:          'Cash',
  bank_transfer: 'Bank Transfer',
  card:          'Card / POS',
  cheque:        'Cheque',
};

// ── Load jsPDF dynamically ────────────────────────────────────────────────────
const loadJsPDF = () => new Promise((resolve, reject) => {
  if (window.jspdf?.jsPDF) return resolve(window.jspdf.jsPDF);
  if (document.getElementById('jspdf-script')) {
    // Already loading — wait for it
    const wait = setInterval(() => {
      if (window.jspdf?.jsPDF) { clearInterval(wait); resolve(window.jspdf.jsPDF); }
    }, 100);
    return;
  }
  const script = document.createElement('script');
  script.id = 'jspdf-script';
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  script.onload = () => resolve(window.jspdf.jsPDF);
  script.onerror = () => reject(new Error('Failed to load jsPDF'));
  document.head.appendChild(script);
});

// ── Main generator ────────────────────────────────────────────────────────────
export const generateReceiptPDF = async ({
  saleData,
  client,
  asset,
  companyProfile,
  schedule,
  invoiceNo,
  receiptNo,
}) => {
  const JsPDF = await loadJsPDF();
  const doc   = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const W  = 210; // A4 width mm
  const M  = 15;  // margin
  const CW = W - M * 2; // content width
  let   Y  = M;  // current Y cursor

  // ── Brand colours ─────────────────────────────────────────────────────────
  const BLUE   = [26,  86,  219];
  const DARK   = [15,  23,  42];
  const GRAY   = [100, 116, 139];
  const LIGHT  = [241, 245, 249];
  const GREEN  = [5,   150, 105];
  const WHITE  = [255, 255, 255];
  const AMBER  = [217, 119, 6];
  const RED    = [220, 38,  38];

  const setColor   = (rgb) => doc.setTextColor(...rgb);
  const setFill    = (rgb) => doc.setFillColor(...rgb);
  const setDraw    = (rgb) => doc.setDrawColor(...rgb);
  const setFont    = (style = 'normal', size = 10) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
  };
  const line = (x1, y1, x2, y2, rgb = LIGHT) => {
    setDraw(rgb);
    doc.setLineWidth(0.3);
    doc.line(x1, y1, x2, y2);
  };
  const rect = (x, y, w, h, rgb, radius = 0) => {
    setFill(rgb);
    if (radius > 0) doc.roundedRect(x, y, w, h, radius, radius, 'F');
    else doc.rect(x, y, w, h, 'F');
  };
  const text = (str, x, y, opts = {}) => {
    doc.text(String(str || '—'), x, y, opts);
  };

  // ════════════════════════════════════════════════════════════
  // HEADER BANNER
  // ════════════════════════════════════════════════════════════
  rect(0, 0, W, 42, BLUE);

  // Company name
  setFont('bold', 18);
  setColor(WHITE);
  text(companyProfile?.company_name || 'AssetFlow', M, 18);

  // Tagline
  setFont('normal', 9);
  setColor([180, 210, 255]);
  text(companyProfile?.address || '', M, 25);
  text(companyProfile?.email   || '', M, 30);
  text(companyProfile?.phone   || '', M, 35);

  // RECEIPT label on right
  setFont('bold', 22);
  setColor(WHITE);
  text('RECEIPT', W - M, 18, { align: 'right' });

  setFont('normal', 9);
  setColor([180, 210, 255]);
  text(invoiceNo || '', W - M, 25, { align: 'right' });
  text(`Date: ${fmtDate(new Date())}`, W - M, 30, { align: 'right' });
  if (receiptNo) text(`Ref: ${receiptNo}`, W - M, 35, { align: 'right' });

  Y = 50;

  // ════════════════════════════════════════════════════════════
  // STATUS BADGE
  // ════════════════════════════════════════════════════════════
  rect(M, Y, 40, 8, GREEN, 2);
  setFont('bold', 9);
  setColor(WHITE);
  text('✓ SALE COMPLETED', M + 20, Y + 5.5, { align: 'center' });

  Y += 16;

  // ════════════════════════════════════════════════════════════
  // CLIENT & ASSET INFO (2 columns)
  // ════════════════════════════════════════════════════════════
  const colW = (CW - 5) / 2;

  // Client box
  rect(M, Y, colW, 36, LIGHT, 2);
  setFont('bold', 8);
  setColor(GRAY);
  text('CLIENT DETAILS', M + 4, Y + 7);
  line(M + 4, Y + 9, M + colW - 4, Y + 9, [200, 214, 230]);

  setFont('bold', 10);
  setColor(DARK);
  text(client?.full_name || '—', M + 4, Y + 16);

  setFont('normal', 8);
  setColor(GRAY);
  text(`Account: ${client?.account_number || '—'}`, M + 4, Y + 22);
  text(`Phone:   ${client?.phone || '—'}`, M + 4, Y + 27);
  text(`Email:   ${client?.email || '—'}`, M + 4, Y + 32);

  // Asset box
  const col2X = M + colW + 5;
  rect(col2X, Y, colW, 36, LIGHT, 2);
  setFont('bold', 8);
  setColor(GRAY);
  text('ASSET DETAILS', col2X + 4, Y + 7);
  line(col2X + 4, Y + 9, col2X + colW - 4, Y + 9, [200, 214, 230]);

  setFont('bold', 10);
  setColor(DARK);
  // Wrap long asset names
  const assetLines = doc.splitTextToSize(asset?.description || '—', colW - 8);
  doc.text(assetLines, col2X + 4, Y + 16);

  setFont('normal', 8);
  setColor(GRAY);
  text(`Code:  ${asset?.asset_code || '—'}`,  col2X + 4, Y + 27);
  text(`Type:  ${asset?.asset_type || '—'}`,  col2X + 4, Y + 32);

  Y += 44;

  // ════════════════════════════════════════════════════════════
  // FINANCIAL SUMMARY TABLE
  // ════════════════════════════════════════════════════════════
  // Table header
  rect(M, Y, CW, 9, BLUE, 2);
  setFont('bold', 9);
  setColor(WHITE);
  text('FINANCIAL SUMMARY', M + CW / 2, Y + 6, { align: 'center' });
  Y += 11;

  const rows = [];

  // Pricing model
  rows.push({ label: 'Pricing Model', value: PRICING_LABELS[saleData?.pricingModel] || saleData?.pricingModel, bold: false });
  rows.push({ label: 'Selling Price', value: fmt(saleData?.sellingPrice), bold: false });

  if (saleData?.discountAmount > 0) {
    rows.push({ label: `Discount (${saleData?.discountPct || ''}%)`, value: `- ${fmt(saleData?.discountAmount)}`, bold: false, color: RED });
    if (saleData?.discountReason) {
      rows.push({ label: 'Discount Reason', value: saleData?.discountReason, bold: false, color: GRAY });
    }
  }

  if (saleData?.vatAmount > 0) {
    rows.push({ label: 'VAT (16%)', value: fmt(saleData?.vatAmount), bold: false });
  }

  rows.push({ label: 'TOTAL AMOUNT', value: fmt(saleData?.totalAmount), bold: true, highlight: true });

  if (saleData?.pricingModel !== 'cash') {
    rows.push({ label: 'Deposit Paid (Today)', value: fmt(saleData?.depositAmount), bold: true, color: GREEN });
    rows.push({ label: 'Finance Balance',      value: fmt(saleData?.financeBalance), bold: false });
    rows.push({ label: 'Annual Interest Rate', value: `${saleData?.interestRate || 0}% p.a.`, bold: false });
    rows.push({ label: 'Installment Tenure',   value: `${saleData?.tenureMonths || 0} months`, bold: false });
    rows.push({ label: 'Monthly Installment',  value: fmt(saleData?.monthlyInstallment), bold: true, color: BLUE });
    rows.push({ label: 'First Payment Due',    value: fmtDate(saleData?.startDate), bold: false });
    if (saleData?.totalPayable) {
      rows.push({ label: 'Total Payable (incl. interest)', value: fmt(saleData?.totalPayable), bold: false });
    }
  }

  rows.push({ label: 'Payment Method', value: PAYMENT_LABELS[saleData?.paymentMethod] || saleData?.paymentMethod, bold: false });
  if (saleData?.mpesaRef) rows.push({ label: 'M-Pesa Reference', value: saleData?.mpesaRef, bold: false });
  if (saleData?.bankRef)  rows.push({ label: 'Bank Reference',   value: saleData?.bankRef,  bold: false });

  // Draw rows
  rows.forEach((row, i) => {
    const rowH = 8;
    const bg   = row.highlight ? [232, 246, 255] : (i % 2 === 0 ? WHITE : [248, 250, 252]);
    rect(M, Y, CW, rowH, bg);

    // Left label
    setFont(row.bold ? 'bold' : 'normal', 9);
    setColor(row.highlight ? BLUE : DARK);
    text(row.label, M + 4, Y + 5.5);

    // Right value
    setFont(row.bold ? 'bold' : 'normal', 9);
    setColor(row.color || (row.highlight ? BLUE : DARK));
    text(row.value, W - M - 4, Y + 5.5, { align: 'right' });

    Y += rowH;
  });

  // Border around table
  setDraw([200, 214, 230]);
  doc.setLineWidth(0.4);
  doc.rect(M, Y - rows.length * 8 - 11, CW, rows.length * 8 + 11);

  Y += 10;

  // ════════════════════════════════════════════════════════════
  // INSTALLMENT SCHEDULE (if not cash sale)
  // ════════════════════════════════════════════════════════════
  if (saleData?.pricingModel !== 'cash' && schedule?.length > 0) {
    // Check if we need a new page
    const schedH = schedule.length * 7 + 20;
    if (Y + schedH > 270) {
      doc.addPage();
      Y = M;
    }

    // Section header
    rect(M, Y, CW, 9, DARK, 2);
    setFont('bold', 9);
    setColor(WHITE);
    text('INSTALLMENT REPAYMENT SCHEDULE', M + CW / 2, Y + 6, { align: 'center' });
    Y += 11;

    // Column headers
    const cols = [
      { label: '#',            x: M + 4,    w: 10, align: 'left' },
      { label: 'Due Date',     x: M + 16,   w: 32, align: 'left' },
      { label: 'Opening Bal',  x: M + 50,   w: 32, align: 'right' },
      { label: 'Installment',  x: M + 84,   w: 30, align: 'right' },
      { label: 'Principal',    x: M + 116,  w: 28, align: 'right' },
      { label: 'Interest',     x: M + 145,  w: 26, align: 'right' },
      { label: 'Closing Bal',  x: W - M - 4,w: 30, align: 'right' },
    ];

    rect(M, Y, CW, 8, [51, 65, 85]);
    setFont('bold', 7.5);
    setColor(WHITE);
    cols.forEach(col => {
      text(col.label, col.x, Y + 5.5, { align: col.align === 'right' ? 'right' : 'left' });
    });
    Y += 8;

    // Schedule rows
    schedule.forEach((row, i) => {
      // New page if needed
      if (Y > 270) {
        doc.addPage();
        Y = M;
        // Re-draw column headers on new page
        rect(M, Y, CW, 8, [51, 65, 85]);
        setFont('bold', 7.5);
        setColor(WHITE);
        cols.forEach(col => {
          text(col.label, col.x, Y + 5.5, { align: col.align === 'right' ? 'right' : 'left' });
        });
        Y += 8;
      }

      const rowH = 6.5;
      const bg   = i % 2 === 0 ? WHITE : [248, 250, 252];
      rect(M, Y, CW, rowH, bg);

      setFont('normal', 7.5);
      setColor(DARK);

      text(String(row.installmentNo),      cols[0].x, Y + 4.5);
      text(fmtShort(row.dueDate),          cols[1].x, Y + 4.5);

      setColor(GRAY);
      text(fmt(row.openingBalance),        cols[2].x, Y + 4.5, { align: 'right' });

      setFont('bold', 7.5);
      setColor(DARK);
      text(fmt(row.installmentAmount),     cols[3].x, Y + 4.5, { align: 'right' });

      setFont('normal', 7.5);
      setColor([37, 99, 235]);
      text(fmt(row.principalPortion),      cols[4].x, Y + 4.5, { align: 'right' });

      setColor(AMBER);
      text(fmt(row.interestPortion),       cols[5].x, Y + 4.5, { align: 'right' });

      setColor(DARK);
      text(fmt(row.closingBalance),        cols[6].x, Y + 4.5, { align: 'right' });

      Y += rowH;
    });

    // Total row
    rect(M, Y, CW, 8, [232, 246, 255]);
    setFont('bold', 8);
    setColor(BLUE);
    const totalInstallment = schedule.reduce((s, r) => s + r.installmentAmount, 0);
    const totalPrincipal   = schedule.reduce((s, r) => s + r.principalPortion, 0);
    const totalInterest    = schedule.reduce((s, r) => s + r.interestPortion, 0);
    text('TOTALS',                         cols[0].x, Y + 5.5);
    text(fmt(totalInstallment),            cols[3].x, Y + 5.5, { align: 'right' });
    setColor([37, 99, 235]);
    text(fmt(totalPrincipal),              cols[4].x, Y + 5.5, { align: 'right' });
    setColor(AMBER);
    text(fmt(totalInterest),              cols[5].x, Y + 5.5, { align: 'right' });
    Y += 10;
  }

  // ════════════════════════════════════════════════════════════
  // FOOTER
  // ════════════════════════════════════════════════════════════
  if (Y > 250) { doc.addPage(); Y = M; }

  // Important notice box
  rect(M, Y, CW, 18, [255, 251, 235], 2);
  setDraw(AMBER);
  doc.setLineWidth(0.5);
  doc.rect(M, Y, CW, 18, 'S');

  setFont('bold', 8);
  setColor(AMBER);
  text('⚠ IMPORTANT NOTICE', M + 4, Y + 6);
  setFont('normal', 7.5);
  setColor([120, 80, 0]);
  text('• Late payments attract a penalty as per the signed agreement.', M + 4, Y + 11);
  text('• This receipt is valid proof of payment. Keep it safe.', M + 4, Y + 15.5);

  Y += 24;

  // Signature lines
  const sigY = Y + 5;
  line(M,           sigY, M + 55,       sigY, [180, 200, 220]);
  line(M + 65,      sigY, M + 120,      sigY, [180, 200, 220]);
  line(W - M - 55,  sigY, W - M,        sigY, [180, 200, 220]);

  setFont('normal', 7);
  setColor(GRAY);
  text('Client Signature',            M + 27,      sigY + 5, { align: 'center' });
  text('Authorised Officer Signature', M + 92,     sigY + 5, { align: 'center' });
  text('Company Stamp',               W - M - 27,  sigY + 5, { align: 'center' });

  Y += 22;

  // Bottom bar
  rect(0, 287, W, 10, BLUE);
  setFont('normal', 7);
  setColor([180, 210, 255]);
  text(
    `${companyProfile?.company_name || 'AssetFlow'} · Generated ${fmtDate(new Date())} · ${invoiceNo}`,
    W / 2, 293, { align: 'center' }
  );

  // ── Save ──────────────────────────────────────────────────────────────────
  const filename = `Receipt_${invoiceNo}_${client?.full_name?.replace(/\s+/g, '_') || 'Client'}.pdf`;
  doc.save(filename);

  return filename;
};

export default generateReceiptPDF;
