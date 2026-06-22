/**
 * generateContractPDF.js
 *
 * Generates a BRS Section 6 compliant Hire Purchase / Sale Agreement PDF.
 * Covers all required fields from BRS 6.2.1, 6.2.2, 6.2.3, 6.2.4.
 *
 * Usage:
 *   import { generateContractPDF } from '../../utils/generateContractPDF';
 *   await generateContractPDF({ sale, client, asset, company, schedule });
 */

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n) =>
  'KES ' + (parseFloat(n) || 0).toLocaleString('en-KE', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
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
  cash:         'Cash Sale Agreement',
  installment:  'Hire Purchase Agreement',
  balloon:      'Balloon Payment Agreement',
  zero_deposit: 'Zero-Deposit Hire Purchase Agreement',
  lease_to_own: 'Lease-to-Own Agreement',
};

// ── Load jsPDF dynamically ────────────────────────────────────────────────────
const loadJsPDF = () => new Promise((resolve, reject) => {
  if (window.jspdf?.jsPDF) return resolve(window.jspdf.jsPDF);
  if (document.getElementById('jspdf-script')) {
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
export const generateContractPDF = async ({ sale, client, asset, company, schedule }) => {
  const JsPDF = await loadJsPDF();
  const doc   = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const W  = 210;
  const M  = 20;
  const CW = W - M * 2;
  let   Y  = M;

  // Colours
  const BLUE  = [26,  86,  219];
  const DARK  = [15,  23,  42];
  const GRAY  = [100, 116, 139];
  const LIGHT = [241, 245, 249];
  const WHITE = [255, 255, 255];
  const AMBER = [217, 119, 6];
  const GREEN = [5,   150, 105];
  const RED   = [220, 38,  38];

  const setColor = (rgb) => doc.setTextColor(...rgb);
  const setFill  = (rgb) => doc.setFillColor(...rgb);
  const setDraw  = (rgb) => doc.setDrawColor(...rgb);
  const setFont  = (style = 'normal', size = 10) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
  };

  const hline = (y, rgb = [200, 214, 230]) => {
    setDraw(rgb);
    doc.setLineWidth(0.3);
    doc.line(M, y, W - M, y);
  };

  const rect = (x, y, w, h, rgb, style = 'F', radius = 0) => {
    setFill(rgb);
    if (radius > 0) doc.roundedRect(x, y, w, h, radius, radius, style);
    else doc.rect(x, y, w, h, style);
  };

  const txt = (str, x, y, opts = {}) => doc.text(String(str || '—'), x, y, opts);

  const sectionHeader = (label, y) => {
    rect(M, y, CW, 8, BLUE, 'F', 2);
    setFont('bold', 10);
    setColor(WHITE);
    txt(label, M + 4, y + 5.5);
    return y + 10;
  };

  const fieldRow = (label, value, y, highlight = false) => {
    const bg = highlight ? [232, 246, 255] : WHITE;
    rect(M, y, CW, 7, bg);
    setFont('normal', 8.5);
    setColor(GRAY);
    txt(label, M + 3, y + 4.8);
    setFont(highlight ? 'bold' : 'normal', 8.5);
    setColor(DARK);
    const lines = doc.splitTextToSize(String(value || '—'), CW * 0.55);
    doc.text(lines, W - M - 3, y + 4.8, { align: 'right' });
    hline(y + 7, LIGHT);
    return y + 7;
  };

  const checkPage = (needed = 20) => {
    if (Y + needed > 275) {
      doc.addPage();
      Y = M;
      // Subtle header on continuation pages
      setFont('normal', 7);
      setColor(GRAY);
      txt(`${PRICING_LABELS[sale?.pricing_model] || 'Agreement'} — ${sale?.invoice_number || ''}  (continued)`, M, Y);
      Y += 8;
    }
  };

  const contractTitle = PRICING_LABELS[sale?.pricing_model] || 'Sale Agreement';
  const today         = fmtDate(new Date());
  const isCash        = sale?.pricing_model === 'cash';

  // ════════════════════════════════════════════════════════════
  // PAGE 1 — COVER / HEADER
  // ════════════════════════════════════════════════════════════
  // Top blue banner
  rect(0, 0, W, 48, BLUE, 'F');

  // Company name
  setFont('bold', 16);
  setColor(WHITE);
  txt(company?.company_name || 'AssetFlow Ltd', M, 16);

  setFont('normal', 8);
  setColor([180, 210, 255]);
  txt(company?.address          || '', M, 22);
  txt(`Tel: ${company?.phone   || ''}`, M, 27);
  txt(`Email: ${company?.email || ''}`, M, 32);
  txt(`KRA PIN: ${company?.kra_pin || ''}`, M, 37);

  // Contract title on right
  setFont('bold', 13);
  setColor(WHITE);
  txt(contractTitle.toUpperCase(), W - M, 16, { align: 'right' });

  setFont('normal', 8);
  setColor([180, 210, 255]);
  txt(`Ref: ${sale?.invoice_number || ''}`,   W - M, 22, { align: 'right' });
  txt(`Date: ${today}`,                        W - M, 27, { align: 'right' });
  txt(`Status: EXECUTED`,                      W - M, 32, { align: 'right' });

  Y = 56;

  // Agreement preamble
  setFont('bold', 11);
  setColor(DARK);
  txt('THIS AGREEMENT is entered into on ' + today, M, Y);
  Y += 6;

  setFont('normal', 9);
  setColor(GRAY);
  const preamble = `BETWEEN ${(company?.company_name || 'the Vendor').toUpperCase()} (hereinafter referred to as "the Vendor") AND ${(client?.full_name || '').toUpperCase()} (hereinafter referred to as "the Buyer"), collectively referred to as "the Parties".`;
  const preambleLines = doc.splitTextToSize(preamble, CW);
  doc.text(preambleLines, M, Y);
  Y += preambleLines.length * 5 + 6;

  hline(Y, [180, 200, 220]);
  Y += 8;

  // ════════════════════════════════════════════════════════════
  // SECTION 1 — PARTIES (BRS 6.2.1)
  // ════════════════════════════════════════════════════════════
  Y = sectionHeader('1. PARTIES TO THE AGREEMENT (BRS 6.2.1)', Y);

  // Vendor
  setFont('bold', 9);
  setColor(BLUE);
  txt('1.1 VENDOR / SELLER', M + 3, Y + 5);
  Y += 8;

  Y = fieldRow('Company Legal Name',     company?.company_name        || '—', Y);
  Y = fieldRow('Registration Number',    company?.registration_number || '—', Y);
  Y = fieldRow('Physical Address',       company?.address             || '—', Y);
  Y = fieldRow('KRA PIN',               company?.kra_pin             || '—', Y);
  Y = fieldRow('Authorized Signatory',   company?.signatory_name      || 'Managing Director', Y);
  Y = fieldRow('Signatory Title',        company?.signatory_title     || 'Authorized Officer', Y);
  Y += 4;

  checkPage(50);

  // Client
  setFont('bold', 9);
  setColor(BLUE);
  txt('1.2 BUYER / CLIENT', M + 3, Y + 5);
  Y += 8;

  Y = fieldRow('Full Legal Name',        client?.full_name     || '—', Y);
  Y = fieldRow('National ID / Passport', client?.national_id || client?.passport_number || '—', Y);
  Y = fieldRow('KRA PIN',               client?.kra_pin       || '—', Y);
  Y = fieldRow('Physical Address',       client?.physical_address || client?.city || '—', Y);
  Y = fieldRow('Phone Number',           client?.phone         || '—', Y);
  Y = fieldRow('Email Address',          client?.email         || '—', Y);
  Y = fieldRow('Account Number',         client?.account_number || '—', Y);
  Y += 6;

  // ════════════════════════════════════════════════════════════
  // SECTION 2 — ASSET DETAILS (BRS 6.2.2)
  // ════════════════════════════════════════════════════════════
  checkPage(60);
  Y = sectionHeader('2. ASSET / SUBJECT MATTER (BRS 6.2.2)', Y);

  Y = fieldRow('Asset Description',   asset?.description         || '—', Y);
  Y = fieldRow('Asset ID / Code',     asset?.asset_code          || '—', Y);
  Y = fieldRow('Asset Type',          asset?.asset_type          || '—', Y);
  Y = fieldRow('Make / Model',        `${asset?.make || ''} ${asset?.model || ''}`.trim() || '—', Y);
  Y = fieldRow('Year',                asset?.year                || '—', Y);
  Y = fieldRow('Color',               asset?.color               || '—', Y);
  Y = fieldRow('Plate / Serial No.',  asset?.plate_number || asset?.chassis_number || '—', Y);
  Y = fieldRow('Location at Sale',    asset?.location            || '—', Y);
  Y = fieldRow('Condition',           asset?.condition           || 'New', Y);
  Y = fieldRow('Encumbrances',        'None declared',           Y);
  Y += 6;

  // ════════════════════════════════════════════════════════════
  // SECTION 3 — FINANCIAL TERMS (BRS 6.2.3)
  // ════════════════════════════════════════════════════════════
  checkPage(90);
  Y = sectionHeader('3. FINANCIAL TERMS (BRS 6.2.3)', Y);

  Y = fieldRow('Pricing Model',          contractTitle,                        Y);
  Y = fieldRow('Cash / Full Selling Price (KES)', fmt(sale?.selling_price),    Y, true);

  if (sale?.discount_amount > 0) {
    Y = fieldRow('Discount Applied (KES)',   fmt(sale?.discount_amount),       Y);
    Y = fieldRow('Discount Reason',          sale?.discount_reason || '—',     Y);
  }

  if (sale?.vat_amount > 0) {
    Y = fieldRow('VAT (16%) (KES)',          fmt(sale?.vat_amount),            Y);
  }

  Y = fieldRow('Total Agreed Price (KES)',   fmt(sale?.total_amount),          Y, true);

  if (!isCash) {
    Y = fieldRow('Deposit Paid (KES)',       fmt(sale?.deposit_amount),        Y, true);
    Y = fieldRow('Deposit Payment Reference', sale?.mpesa_reference || sale?.bank_reference || '—', Y);
    Y = fieldRow('Deposit Payment Date',     fmtDate(sale?.sale_date),         Y);
    Y = fieldRow('Financed Balance (KES)',   fmt(sale?.finance_balance),       Y);
    Y = fieldRow('Annual Interest Rate',     `${sale?.interest_rate || 0}% per annum`, Y);

    const totalInterest = schedule
      ? schedule.reduce((s, r) => s + (r.interest_portion || 0), 0) : 0;
    Y = fieldRow('Total Interest Payable (KES)', fmt(totalInterest),           Y);
    Y = fieldRow('Total Amount Payable (KES)',    fmt((sale?.total_amount || 0) + totalInterest), Y, true);
    Y = fieldRow('Installment Tenure (months)',   String(sale?.tenure_months || 0), Y);

    const monthlyInstallment = schedule?.[0]?.installment_amount;
    Y = fieldRow('Monthly Installment (KES)',     fmt(monthlyInstallment),     Y, true);
    Y = fieldRow('First Installment Due Date',    fmtDate(sale?.payment_start_date), Y);
    Y = fieldRow('Last Installment Due Date',     fmtDate(schedule?.[schedule.length - 1]?.due_date), Y);
    Y = fieldRow('Payment Due Day (monthly)',      new Date(sale?.payment_start_date).getDate() + 'th of each month', Y);
    Y = fieldRow('Late Payment Grace Period',      `${asset?.grace_period_days || 7} days`, Y);
    Y = fieldRow('Late Payment Penalty Rate',      `${asset?.penalty_rate_monthly || 2}% per month on overdue amount`, Y);
    Y = fieldRow('Early Settlement Discount',      `${asset?.early_settlement_discount || 0}%`, Y);
  }

  Y = fieldRow('Payment Method',          sale?.payment_method?.replace(/_/g, ' ') || '—', Y);
  Y += 6;

  // ════════════════════════════════════════════════════════════
  // SECTION 4 — INSTALLMENT SCHEDULE (BRS 6.2.3)
  // ════════════════════════════════════════════════════════════
  if (!isCash && schedule?.length > 0) {
    checkPage(30);
    Y = sectionHeader('4. FULL INSTALLMENT REPAYMENT SCHEDULE (BRS 6.2.3)', Y);

    // Column headers
    const cols = [
      { label: '#',            x: M + 3,     align: 'left'  },
      { label: 'Due Date',     x: M + 14,    align: 'left'  },
      { label: 'Opening Bal',  x: M + 56,    align: 'right' },
      { label: 'Installment',  x: M + 88,    align: 'right' },
      { label: 'Principal',    x: M + 118,   align: 'right' },
      { label: 'Interest',     x: M + 145,   align: 'right' },
      { label: 'Closing Bal',  x: W - M - 2, align: 'right' },
    ];

    rect(M, Y, CW, 7, [30, 50, 80], 'F');
    setFont('bold', 7);
    setColor(WHITE);
    cols.forEach(c => txt(c.label, c.x, Y + 4.8, { align: c.align === 'right' ? 'right' : 'left' }));
    Y += 7;

    schedule.forEach((row, i) => {
      checkPage(7);
      const bg = i % 2 === 0 ? WHITE : [248, 250, 252];
      rect(M, Y, CW, 6, bg);

      setFont('normal', 7);
      setColor(DARK);
      txt(String(row.installment_no || row.installmentNo || i + 1), cols[0].x, Y + 4);
      txt(fmtShort(row.due_date || row.dueDate), cols[1].x, Y + 4);

      setColor(GRAY);
      txt(fmt(row.opening_balance || row.openingBalance), cols[2].x, Y + 4, { align: 'right' });

      setFont('bold', 7);
      setColor(DARK);
      txt(fmt(row.installment_amount || row.installmentAmount), cols[3].x, Y + 4, { align: 'right' });

      setFont('normal', 7);
      setColor([37, 99, 235]);
      txt(fmt(row.principal_portion || row.principalPortion), cols[4].x, Y + 4, { align: 'right' });

      setColor(AMBER[0] ? AMBER : [217, 119, 6]);
      doc.setTextColor(217, 119, 6);
      txt(fmt(row.interest_portion || row.interestPortion), cols[5].x, Y + 4, { align: 'right' });

      setColor(DARK);
      txt(fmt(row.closing_balance || row.closingBalance), cols[6].x, Y + 4, { align: 'right' });

      Y += 6;
    });

    // Totals row
    checkPage(8);
    rect(M, Y, CW, 7, [220, 235, 255]);
    setFont('bold', 7);
    setColor(BLUE);
    txt('TOTALS', cols[0].x, Y + 4.8);
    const totInstall  = schedule.reduce((s, r) => s + parseFloat(r.installment_amount || r.installmentAmount || 0), 0);
    const totPrinc    = schedule.reduce((s, r) => s + parseFloat(r.principal_portion  || r.principalPortion  || 0), 0);
    const totInterest = schedule.reduce((s, r) => s + parseFloat(r.interest_portion   || r.interestPortion   || 0), 0);
    txt(fmt(totInstall),  cols[3].x, Y + 4.8, { align: 'right' });
    setColor([37, 99, 235]);
    txt(fmt(totPrinc),    cols[4].x, Y + 4.8, { align: 'right' });
    doc.setTextColor(217, 119, 6);
    txt(fmt(totInterest), cols[5].x, Y + 4.8, { align: 'right' });
    Y += 10;
  }

  // ════════════════════════════════════════════════════════════
  // SECTION 5 — STANDARD CONTRACTUAL CLAUSES (BRS 6.2.4)
  // ════════════════════════════════════════════════════════════
  checkPage(120);
  const clauseNo = isCash ? '4' : '5';
  Y = sectionHeader(`${clauseNo}. STANDARD CONTRACTUAL CLAUSES (BRS 6.2.4)`, Y);

  const clauses = [
    {
      title: `${clauseNo}.1 Ownership Transfer`,
      body: 'Ownership of the asset described herein transfers to the Buyer only upon receipt of the final installment payment in full. Until such time, the Vendor retains full legal title to the asset. The Buyer shall not sell, transfer, pledge, or encumber the asset without prior written consent from the Vendor.',
    },
    {
      title: `${clauseNo}.2 Default & Repossession`,
      body: 'In the event of three (3) or more consecutive missed installment payments, or a total outstanding default of two (2) or more installments at any time, the Vendor reserves the right to repossess the asset without further notice. The Buyer shall bear all costs of repossession, including legal fees and transportation.',
    },
    {
      title: `${clauseNo}.3 Insurance Obligation`,
      body: 'The Buyer is responsible for maintaining comprehensive insurance cover on the asset at all times for the full duration of this agreement. Proof of insurance must be provided to the Vendor within 14 days of this agreement and renewed annually. In the event of loss or damage, insurance proceeds shall first be applied to settle the outstanding balance owed to the Vendor.',
    },
    {
      title: `${clauseNo}.4 Late Payment Penalty`,
      body: `Payments not received within the grace period of ${asset?.grace_period_days || 7} days after the due date shall attract a penalty of ${asset?.penalty_rate_monthly || 2}% per month on the overdue amount, compounded monthly until full settlement. Penalties are applied in addition to the regular installment and do not reduce the outstanding principal.`,
    },
    {
      title: `${clauseNo}.5 Early Settlement`,
      body: `The Buyer may settle the outstanding balance in full at any time before the final installment due date. An early settlement discount of ${asset?.early_settlement_discount || 0}% shall be applied to the remaining principal balance (excluding interest already accrued). A settlement statement valid for 7 days will be issued upon request.`,
    },
    {
      title: `${clauseNo}.6 Governing Law & Dispute Resolution`,
      body: 'This Agreement shall be governed by and construed in accordance with the laws of Kenya. Any dispute arising out of or in connection with this Agreement shall first be referred to mediation. If unresolved within 30 days, the dispute shall be submitted to arbitration in accordance with the Arbitration Act (Cap. 49) of Kenya.',
    },
    {
      title: `${clauseNo}.7 Entire Agreement`,
      body: 'This Agreement constitutes the entire agreement between the Parties with respect to the subject matter hereof and supersedes all prior negotiations, representations, warranties, and understandings of the Parties, whether oral or written.',
    },
    {
      title: `${clauseNo}.8 Amendments`,
      body: 'No amendment, modification, or waiver of any provision of this Agreement shall be effective unless made in writing and signed by authorized representatives of both Parties.',
    },
  ];

  clauses.forEach(clause => {
    checkPage(25);
    setFont('bold', 9);
    setColor(DARK);
    txt(clause.title, M, Y);
    Y += 5;

    setFont('normal', 8.5);
    setColor([55, 65, 81]);
    const lines = doc.splitTextToSize(clause.body, CW);
    doc.text(lines, M, Y);
    Y += lines.length * 4.5 + 5;
  });

  // ════════════════════════════════════════════════════════════
  // SECTION 6 — DECLARATIONS & SIGNATURES
  // ════════════════════════════════════════════════════════════
  checkPage(80);
  const sigNo = parseInt(clauseNo) + 1;
  Y = sectionHeader(`${sigNo}. DECLARATIONS & SIGNATURES`, Y);

  setFont('normal', 9);
  setColor([55, 65, 81]);
  const declaration = 'The Parties hereby acknowledge that they have read, understood, and agree to be bound by all the terms and conditions of this Agreement. By signing below, the Parties confirm that this Agreement is entered into freely and voluntarily.';
  const declLines = doc.splitTextToSize(declaration, CW);
  doc.text(declLines, M, Y);
  Y += declLines.length * 4.5 + 10;

  // Acknowledgement box
  rect(M, Y, CW, 12, [240, 253, 244], 'F', 2);
  setDraw(GREEN);
  doc.setLineWidth(0.5);
  doc.roundedRect(M, Y, CW, 12, 2, 2, 'S');
  setFont('bold', 8.5);
  setColor(GREEN);
  txt('The Buyer confirms they have received a copy of the full Installment Schedule and understands the total cost of credit.', M + 4, Y + 7.5);
  Y += 18;

  // Signature blocks
  const sigBlockW = (CW - 10) / 2;

  // Vendor signature block
  rect(M, Y, sigBlockW, 45, LIGHT, 'F', 2);
  setFont('bold', 8);
  setColor(DARK);
  txt('FOR AND ON BEHALF OF THE VENDOR', M + 4, Y + 7);
  setFont('normal', 7.5);
  setColor(GRAY);
  txt(company?.company_name || '—', M + 4, Y + 13);

  // Signature line
  hline(Y + 30, [150, 180, 220]);
  setFont('normal', 7);
  setColor(GRAY);
  txt('Authorized Signature', M + 4, Y + 34);
  hline(Y + 40, [150, 180, 220]);
  txt(`Name: ${company?.signatory_name || ''}`, M + 4, Y + 43);

  // Date
  txt('Date: ____________________', M + 4, Y + 50 > Y + sigBlockW ? Y + 43 : Y + 49);

  // Client signature block
  const col2X = M + sigBlockW + 10;
  rect(col2X, Y, sigBlockW, 45, LIGHT, 'F', 2);
  setFont('bold', 8);
  setColor(DARK);
  txt('THE BUYER', col2X + 4, Y + 7);
  setFont('normal', 7.5);
  setColor(GRAY);
  txt(client?.full_name || '—', col2X + 4, Y + 13);

  hline(Y + 30, [150, 180, 220]);
  setFont('normal', 7);
  setColor(GRAY);
  txt('Buyer Signature', col2X + 4, Y + 34);
  hline(Y + 40, [150, 180, 220]);
  txt(`ID No: ${client?.national_id || ''}`, col2X + 4, Y + 43);
  txt('Date: ____________________', col2X + 4, Y + 49);

  Y += 55;

  // Witness
  checkPage(30);
  setFont('bold', 8);
  setColor(DARK);
  txt('WITNESS', M, Y);
  Y += 6;
  hline(Y + 15, [150, 180, 220]);
  setFont('normal', 7);
  setColor(GRAY);
  txt('Witness Signature', M, Y + 19);
  txt('Name: ____________________________________', M, Y + 26);
  txt('ID No: _______________  Date: ____________________', M, Y + 32);
  Y += 40;

  // ════════════════════════════════════════════════════════════
  // FOOTER on every page
  // ════════════════════════════════════════════════════════════
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    rect(0, 287, W, 10, BLUE, 'F');
    setFont('normal', 6.5);
    setColor([180, 210, 255]);
    txt(
      `${company?.company_name || 'AssetFlow'} · ${contractTitle} · Ref: ${sale?.invoice_number || ''} · Page ${i} of ${totalPages}`,
      W / 2, 293, { align: 'center' }
    );
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const safeName = (client?.full_name || 'Client').replace(/\s+/g, '_');
  const filename  = `Contract_${sale?.invoice_number || 'DRAFT'}_${safeName}.pdf`;
  doc.save(filename);
  // Return the blob too, so callers can persist the PDF (e.g. to storage for
  // e-signature) instead of only triggering a browser download.
  return { filename, blob: doc.output('blob') };
};

export default generateContractPDF;
