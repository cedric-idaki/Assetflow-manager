/**
 * generateSaccoLoanContractPDF.js
 *
 * Sacco loan agreement PDF — the sacco counterpart of generateContractPDF.js
 * (which covers company hire-purchase / sale agreements against an asset).
 *
 * A sacco facility has no asset and no vendor: the Sacco lends members' funds to
 * a member, secured on that member's deposits, shares and guarantors. So the
 * sections are Parties → Facility → Financial terms → Amortization schedule →
 * Clauses → Signatures, and the clause text comes from the tenant's
 * contract_templates row when one exists (falling back to sacco defaults).
 *
 * Usage:
 *   const { blob } = await generateSaccoLoanContractPDF({
 *     loan, member, sacco, product, schedule, template,
 *   });
 */

import { AMORTIZATION_METHODS } from './saccoAmortization';

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

// Single source of truth for method names — same list the Loans tab shows.
const methodLabel = (id) => AMORTIZATION_METHODS.find((m) => m.id === id)?.label || id || '—';

// Fallback clause text when the tenant has no contract_templates row for loans.
// Mirrors SACCO_DEFAULT_CLAUSES.loan_agreement in components/contracts.
const FALLBACK_CLAUSES = {
  ownership_clause:     'The loan is advanced from the Sacco\'s members\' funds and remains a debt owed by the Borrower to the Sacco until repaid in full. The Borrower\'s deposits, share capital and any guarantor commitments stand as security for the outstanding balance.',
  default_clause:       'Where three (3) consecutive instalments fall into arrears, the whole outstanding balance becomes immediately due and payable. The Sacco may offset the Borrower\'s deposits and shares, and thereafter call upon the guarantors, in accordance with the Sacco\'s by-laws and the Co-operative Societies Act (Cap. 490).',
  insurance_clause:     'The Borrower shall maintain any loan protection or credit life cover required by the Sacco\'s credit policy for the full term of this facility. Proceeds of any such cover shall first be applied to the outstanding balance.',
  penalty_clause:       'Instalments not received by the due date shall attract the penalty rate set out in the Sacco\'s credit policy, charged monthly on the amount in arrears until the account is regularised.',
  settlement_clause:    'The Borrower may repay the outstanding balance in full at any time. Interest is charged only up to the date of settlement. A settlement statement valid for 7 days will be issued on request.',
  governing_law_clause: 'This Agreement is governed by the laws of Kenya, the Co-operative Societies Act (Cap. 490) and the by-laws of the Sacco. Disputes shall first be referred to the Sacco\'s dispute resolution process, then to the Commissioner for Co-operative Development or arbitration.',
};

// ── Load jsPDF dynamically (same CDN copy the company generator uses) ─────────
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
export const generateSaccoLoanContractPDF = async ({
  loan, member, sacco, product, schedule = [], template, download = true,
}) => {
  const JsPDF = await loadJsPDF();
  const doc   = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const W  = 210;
  const M  = 20;
  const CW = W - M * 2;
  let   Y  = M;

  // Colours — sacco teal, matching the sacco dashboard chrome.
  const TEAL  = [29,  168, 197];
  const DARK  = [15,  23,  42];
  const GRAY  = [100, 116, 139];
  const LIGHT = [241, 245, 249];
  const WHITE = [255, 255, 255];
  const GREEN = [5,   150, 105];

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
    rect(M, y, CW, 8, TEAL, 'F', 2);
    setFont('bold', 10);
    setColor(WHITE);
    txt(label, M + 4, y + 5.5);
    return y + 10;
  };

  const fieldRow = (label, value, y, highlight = false) => {
    const bg = highlight ? [232, 250, 253] : WHITE;
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

  const ref = `LN-${String(loan?.id || '').slice(0, 8).toUpperCase()}`;

  const checkPage = (needed = 20) => {
    if (Y + needed > 275) {
      doc.addPage();
      Y = M;
      setFont('normal', 7);
      setColor(GRAY);
      txt(`Loan Agreement — ${ref}  (continued)`, M, Y);
      Y += 8;
    }
  };

  const today   = fmtDate(new Date());
  const clauses = { ...FALLBACK_CLAUSES };
  Object.keys(FALLBACK_CLAUSES).forEach((k) => {
    if (template?.[k]) clauses[k] = template[k];
  });

  const totalInterest = schedule.reduce((s, r) => s + parseFloat(r.interest ?? r.interestPortion ?? 0), 0);
  const totalPayable  = schedule.reduce((s, r) => s + parseFloat(r.payment ?? 0), 0)
                        || (parseFloat(loan?.principal || 0) + totalInterest);
  const firstDue      = schedule[0]?.due_date || schedule[0]?.dueDate;
  const lastDue       = schedule[schedule.length - 1]?.due_date || schedule[schedule.length - 1]?.dueDate;
  const instalment    = schedule[0]?.payment;

  // ════════════════════════════════════════════════════════════
  // PAGE 1 — COVER / HEADER
  // ════════════════════════════════════════════════════════════
  rect(0, 0, W, 48, TEAL, 'F');

  setFont('bold', 16);
  setColor(WHITE);
  txt(sacco?.name || 'Sacco Society', M, 16);

  setFont('normal', 8);
  setColor([210, 245, 252]);
  txt(`${sacco?.location || ''}${sacco?.city ? `, ${sacco.city}` : ''}`, M, 22);
  txt(`Tel: ${sacco?.phone || ''}`, M, 27);
  txt(`Email: ${sacco?.email || ''}`, M, 32);
  txt(`Reg No: ${sacco?.registration_no || '—'}${sacco?.sasra_licence_no ? `  ·  SASRA: ${sacco.sasra_licence_no}` : ''}`, M, 37);

  setFont('bold', 13);
  setColor(WHITE);
  txt('LOAN AGREEMENT', W - M, 16, { align: 'right' });

  setFont('normal', 8);
  setColor([210, 245, 252]);
  txt(`Ref: ${ref}`,                       W - M, 22, { align: 'right' });
  txt(`Date: ${today}`,                    W - M, 27, { align: 'right' });
  txt(`Status: ${String(loan?.status || 'pending').toUpperCase()}`, W - M, 32, { align: 'right' });

  Y = 56;

  // Preamble
  setFont('bold', 11);
  setColor(DARK);
  txt('THIS AGREEMENT is entered into on ' + today, M, Y);
  Y += 6;

  setFont('normal', 9);
  setColor(GRAY);
  const preamble = `BETWEEN ${(sacco?.name || 'the Sacco').toUpperCase()} (hereinafter referred to as "the Sacco") AND ${(member?.full_name || '').toUpperCase()}, member number ${member?.member_no || '—'} (hereinafter referred to as "the Borrower"), collectively referred to as "the Parties".`;
  const preambleLines = doc.splitTextToSize(preamble, CW);
  doc.text(preambleLines, M, Y);
  Y += preambleLines.length * 5 + 6;

  hline(Y, [180, 200, 220]);
  Y += 8;

  // ════════════════════════════════════════════════════════════
  // SECTION 1 — PARTIES
  // ════════════════════════════════════════════════════════════
  Y = sectionHeader('1. PARTIES TO THE AGREEMENT', Y);

  setFont('bold', 9);
  setColor(TEAL);
  txt('1.1 THE SACCO (LENDER)', M + 3, Y + 5);
  Y += 8;

  Y = fieldRow('Society Name',          sacco?.name             || '—', Y);
  Y = fieldRow('Registration Number',   sacco?.registration_no  || '—', Y);
  Y = fieldRow('SASRA Licence No.',     sacco?.sasra_licence_no || 'Not applicable', Y);
  Y = fieldRow('Physical Address',      `${sacco?.location || ''}${sacco?.city ? `, ${sacco.city}` : ''}`.trim() || '—', Y);
  Y = fieldRow('Telephone',             sacco?.phone            || '—', Y);
  Y = fieldRow('Authorised Signatory',  template?.signatory_name  || '—', Y);
  Y = fieldRow('Signatory Title',       template?.signatory_title || 'Authorised Officer', Y);
  Y += 4;

  checkPage(60);

  setFont('bold', 9);
  setColor(TEAL);
  txt('1.2 THE BORROWER (MEMBER)', M + 3, Y + 5);
  Y += 8;

  Y = fieldRow('Full Legal Name',        member?.full_name   || '—', Y);
  Y = fieldRow('Member Number',          member?.member_no   || '—', Y);
  Y = fieldRow('National ID / Passport', member?.national_id || '—', Y);
  Y = fieldRow('Phone Number',           member?.phone       || '—', Y);
  Y = fieldRow('Email Address',          member?.email       || '—', Y);
  Y = fieldRow('Member Since',           fmtDate(member?.joined_at || member?.created_at), Y);
  Y = fieldRow('Next of Kin',            member?.next_of_kin_name
    ? `${member.next_of_kin_name}${member.next_of_kin_relationship ? ` (${member.next_of_kin_relationship})` : ''}`
    : '—', Y);
  Y += 6;

  // ════════════════════════════════════════════════════════════
  // SECTION 2 — THE FACILITY
  // ════════════════════════════════════════════════════════════
  checkPage(50);
  Y = sectionHeader('2. THE FACILITY', Y);

  Y = fieldRow('Loan Reference',      ref, Y);
  Y = fieldRow('Loan Product',        product?.name || loan?.product?.name || 'Custom facility', Y);
  Y = fieldRow('Purpose of Facility', loan?.purpose || '—', Y);
  Y = fieldRow('Application Date',    fmtDate(loan?.created_at), Y);
  Y = fieldRow('Disbursement Date',   fmtDate(loan?.disbursed_at), Y);
  Y = fieldRow('Security',            'Member deposits, share capital and guarantor commitments', Y);
  Y += 6;

  // ════════════════════════════════════════════════════════════
  // SECTION 3 — FINANCIAL TERMS
  // ════════════════════════════════════════════════════════════
  checkPage(80);
  Y = sectionHeader('3. FINANCIAL TERMS', Y);

  Y = fieldRow('Principal Advanced (KES)',    fmt(loan?.principal), Y, true);
  Y = fieldRow('Amortization Method',         methodLabel(loan?.method), Y);
  Y = fieldRow('Annual Interest Rate',        `${loan?.annual_interest_rate || 0}% per annum`, Y);
  Y = fieldRow('Repayment Term',              `${loan?.term_months || 0} months`, Y);
  if (parseFloat(loan?.balloon_amount) > 0) {
    Y = fieldRow('Balloon Amount (KES)',      fmt(loan?.balloon_amount), Y);
  }
  Y = fieldRow('Total Interest Payable (KES)', fmt(totalInterest), Y);
  Y = fieldRow('Total Amount Payable (KES)',   fmt(totalPayable), Y, true);
  Y = fieldRow('Monthly Instalment (KES)',     fmt(instalment), Y, true);
  Y = fieldRow('First Instalment Due',         fmtDate(firstDue), Y);
  Y = fieldRow('Final Instalment Due',         fmtDate(lastDue), Y);
  Y = fieldRow('Late Payment Penalty Rate',    `${product?.penalty_rate ?? 0}% per month on amounts in arrears`, Y);
  Y += 6;

  // ════════════════════════════════════════════════════════════
  // SECTION 4 — AMORTIZATION SCHEDULE
  // ════════════════════════════════════════════════════════════
  if (schedule.length > 0) {
    checkPage(30);
    Y = sectionHeader('4. REPAYMENT (AMORTIZATION) SCHEDULE', Y);

    const cols = [
      { label: '#',           x: M + 3,     align: 'left'  },
      { label: 'Due Date',    x: M + 14,    align: 'left'  },
      { label: 'Opening Bal', x: M + 56,    align: 'right' },
      { label: 'Instalment',  x: M + 88,    align: 'right' },
      { label: 'Principal',   x: M + 118,   align: 'right' },
      { label: 'Interest',    x: M + 145,   align: 'right' },
      { label: 'Closing Bal', x: W - M - 2, align: 'right' },
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
      txt(String(row.period_no ?? row.periodNo ?? i + 1), cols[0].x, Y + 4);
      txt(fmtShort(row.due_date || row.dueDate), cols[1].x, Y + 4);

      setColor(GRAY);
      txt(fmt(row.opening_balance ?? row.openingBalance), cols[2].x, Y + 4, { align: 'right' });

      setFont('bold', 7);
      setColor(DARK);
      txt(fmt(row.payment), cols[3].x, Y + 4, { align: 'right' });

      setFont('normal', 7);
      doc.setTextColor(37, 99, 235);
      txt(fmt(row.principal), cols[4].x, Y + 4, { align: 'right' });

      doc.setTextColor(217, 119, 6);
      txt(fmt(row.interest), cols[5].x, Y + 4, { align: 'right' });

      setColor(DARK);
      txt(fmt(row.closing_balance ?? row.closingBalance), cols[6].x, Y + 4, { align: 'right' });

      Y += 6;
    });

    // Totals row
    checkPage(8);
    rect(M, Y, CW, 7, [220, 245, 250]);
    setFont('bold', 7);
    setColor(TEAL);
    txt('TOTALS', cols[0].x, Y + 4.8);
    const totPay   = schedule.reduce((s, r) => s + parseFloat(r.payment   || 0), 0);
    const totPrinc = schedule.reduce((s, r) => s + parseFloat(r.principal || 0), 0);
    const totInt   = schedule.reduce((s, r) => s + parseFloat(r.interest  || 0), 0);
    txt(fmt(totPay), cols[3].x, Y + 4.8, { align: 'right' });
    doc.setTextColor(37, 99, 235);
    txt(fmt(totPrinc), cols[4].x, Y + 4.8, { align: 'right' });
    doc.setTextColor(217, 119, 6);
    txt(fmt(totInt), cols[5].x, Y + 4.8, { align: 'right' });
    Y += 10;
  }

  // ════════════════════════════════════════════════════════════
  // SECTION 5 — CLAUSES
  // ════════════════════════════════════════════════════════════
  checkPage(120);
  const clauseNo = schedule.length > 0 ? '5' : '4';
  Y = sectionHeader(`${clauseNo}. TERMS AND CONDITIONS`, Y);

  const clauseList = [
    { title: `${clauseNo}.1 Security & Ownership of Funds`, body: clauses.ownership_clause },
    { title: `${clauseNo}.2 Default & Recovery`,            body: clauses.default_clause },
    { title: `${clauseNo}.3 Loan Protection / Insurance`,   body: clauses.insurance_clause },
    { title: `${clauseNo}.4 Late Payment Penalty`,          body: clauses.penalty_clause },
    { title: `${clauseNo}.5 Early Settlement`,              body: clauses.settlement_clause },
    { title: `${clauseNo}.6 Governing Law & Disputes`,      body: clauses.governing_law_clause },
    {
      title: `${clauseNo}.7 Entire Agreement`,
      body: template?.entire_agreement_clause
        || 'This Agreement, together with the Sacco\'s by-laws and credit policy, constitutes the entire agreement between the Parties in respect of this facility and supersedes all prior discussions and representations.',
    },
    {
      title: `${clauseNo}.8 Amendments`,
      body: template?.amendments_clause
        || 'No amendment, modification or waiver of any provision of this Agreement is effective unless made in writing and signed by the Borrower and an authorised officer of the Sacco.',
    },
  ];

  clauseList.forEach(clause => {
    checkPage(25);
    setFont('bold', 9);
    setColor(DARK);
    txt(clause.title, M, Y);
    Y += 5;

    setFont('normal', 8.5);
    setColor([55, 65, 81]);
    const lines = doc.splitTextToSize(clause.body || '—', CW);
    doc.text(lines, M, Y);
    Y += lines.length * 4.5 + 5;
  });

  // ════════════════════════════════════════════════════════════
  // SECTION 6 — DECLARATIONS & SIGNATURES
  // ════════════════════════════════════════════════════════════
  checkPage(90);
  const sigNo = parseInt(clauseNo, 10) + 1;
  Y = sectionHeader(`${sigNo}. DECLARATIONS & SIGNATURES`, Y);

  setFont('normal', 9);
  setColor([55, 65, 81]);
  const declaration = 'The Parties acknowledge that they have read, understood and agree to be bound by the terms of this Agreement, the by-laws of the Sacco and its credit policy. The Borrower confirms that the information supplied in support of this facility is true and complete.';
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
  txt('The Borrower confirms receipt of the full repayment schedule and understands the total cost of this credit.', M + 4, Y + 7.5);
  Y += 18;

  // Signature blocks
  const sigBlockW = (CW - 10) / 2;

  rect(M, Y, sigBlockW, 45, LIGHT, 'F', 2);
  setFont('bold', 8);
  setColor(DARK);
  txt('FOR AND ON BEHALF OF THE SACCO', M + 4, Y + 7);
  setFont('normal', 7.5);
  setColor(GRAY);
  txt(sacco?.name || '—', M + 4, Y + 13);
  hline(Y + 30, [150, 200, 220]);
  setFont('normal', 7);
  setColor(GRAY);
  txt('Authorised Signature', M + 4, Y + 34);
  hline(Y + 40, [150, 200, 220]);
  txt(`Name: ${template?.signatory_name || ''}`, M + 4, Y + 43);
  txt('Date: ____________________', M + 4, Y + 49);

  const col2X = M + sigBlockW + 10;
  rect(col2X, Y, sigBlockW, 45, LIGHT, 'F', 2);
  setFont('bold', 8);
  setColor(DARK);
  txt('THE BORROWER', col2X + 4, Y + 7);
  setFont('normal', 7.5);
  setColor(GRAY);
  txt(member?.full_name || '—', col2X + 4, Y + 13);
  hline(Y + 30, [150, 200, 220]);
  setFont('normal', 7);
  setColor(GRAY);
  txt('Borrower Signature', col2X + 4, Y + 34);
  hline(Y + 40, [150, 200, 220]);
  txt(`ID No: ${member?.national_id || ''}`, col2X + 4, Y + 43);
  txt('Date: ____________________', col2X + 4, Y + 49);

  Y += 55;

  // Guarantors / witness
  checkPage(35);
  setFont('bold', 8);
  setColor(DARK);
  txt('GUARANTOR / WITNESS', M, Y);
  Y += 6;
  hline(Y + 15, [150, 200, 220]);
  setFont('normal', 7);
  setColor(GRAY);
  txt('Signature', M, Y + 19);
  txt('Name: ____________________________________  Member No: ______________', M, Y + 26);
  txt('ID No: _______________  Amount Guaranteed: ______________  Date: ____________', M, Y + 32);
  Y += 40;

  // ════════════════════════════════════════════════════════════
  // FOOTER on every page
  // ════════════════════════════════════════════════════════════
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    rect(0, 287, W, 10, TEAL, 'F');
    setFont('normal', 6.5);
    setColor([210, 245, 252]);
    txt(
      `${sacco?.name || 'Sacco'} · Loan Agreement · Ref: ${ref} · Page ${i} of ${totalPages}`,
      W / 2, 293, { align: 'center' }
    );
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const safeName = (member?.full_name || 'Member').replace(/\s+/g, '_');
  const filename = `Loan_Agreement_${ref}_${safeName}.pdf`;
  if (download) doc.save(filename);
  // Return the blob too, so callers can persist the PDF (storage + e-signature)
  // instead of only triggering a browser download.
  return { filename, blob: doc.output('blob') };
};

export default generateSaccoLoanContractPDF;
