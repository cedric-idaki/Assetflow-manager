/**
 * certificatePdf.js
 *
 * The certificates as PDFs, rather than as a print-window full of HTML.
 *
 * WHY A SECOND RENDERER
 * ---------------------
 * The existing certificates are HTML written into a pop-up and sent to
 * window.print(), which is a fine way to put ink on paper and a useless one for
 * getting a document signed: SignNow needs a file, with pages, at known
 * coordinates. These builders produce that file. They deliberately mirror the
 * HTML designs rather than improving on them — a member who has one of each
 * should not be able to tell they came from different code.
 *
 * UNITS
 * -----
 * jsPDF is constructed with unit:'pt' and its origin is the TOP-LEFT of the
 * page, which is also SignNow's origin. So the y a signature line is drawn at
 * here is the same y the signing box is placed at, with no conversion — see
 * certificateSigning.js, which owns both numbers.
 *
 * DRAFT
 * -----
 * Anything that has not come back signed is stamped DRAFT — NOT YET ISSUED
 * across the face. That is the whole enforcement story on the client side: a
 * staff member can always produce a copy, but they cannot produce one that
 * looks issued. The issued document is the file SignNow returns.
 */

import { signatureBlocks, A4, SIG_BLOCK, fieldsForSigners } from './certificateSigning';
import { loadJsPDF } from './jsPdfLoader';

const KES = (n) => 'KES ' + (parseFloat(n) || 0).toLocaleString('en-KE', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const KES0 = (n) => 'KES ' + (parseFloat(n) || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 });
const longDate = (d) => (d ? new Date(d) : new Date()).toLocaleDateString('en-KE', {
  year: 'numeric', month: 'long', day: 'numeric',
});
const int = (v) => Math.trunc(Number(v) || 0);

// Matches the teal the share certificate has always used, and the blue the
// settlement letter has always used, so the PDFs are recognisably the same
// documents as the printed ones.
const TEAL = [29, 168, 197];
const INK = [15, 39, 51];
const SLATE = [92, 124, 136];
const BLUE = [26, 86, 219];

/** Draw the DRAFT stamp. Big, angled, and unmistakably not a finished thing. */
const drawDraftStamp = (doc, { width, height }) => {
  doc.saveGraphicsState();
  doc.setGState(new doc.GState({ opacity: 0.14 }));
  doc.setTextColor(190, 30, 45);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(58);
  doc.text('DRAFT — NOT YET ISSUED', width / 2, height / 2, {
    align: 'center', baseline: 'middle', angle: 22,
  });
  doc.restoreGraphicsState();
  doc.setTextColor(...INK);
};

/**
 * The signature row: a ruled line per office, with the office named under it,
 * positioned by certificateSigning.signatureBlocks so SignNow's boxes land on
 * the lines rather than near them.
 *
 * The signatory's NAME is printed under the office where we know it. A blank
 * line with only "Chairperson" beneath is what these certificates had before,
 * and it is unhelpfully anonymous once the signature is a digital one.
 */
const drawSignatureRow = (doc, signers, geometry, bottomOffset) => {
  const blocks = signatureBlocks(signers.length, geometry, bottomOffset);
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.7);

  signers.forEach((s, i) => {
    const b = blocks[i];
    doc.line(b.x, b.lineY, b.x + b.width, b.lineY);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...SLATE);
    doc.text(String(s.role || '').toUpperCase(), b.x + b.width / 2, b.captionY, { align: 'center' });

    if (s.name) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.text(String(s.name), b.x + b.width / 2, b.captionY + 10, { align: 'center' });
    }
  });

  doc.setTextColor(...INK);
  return blocks;
};

/** The one-line claim a reader can actually check, at the foot of every page. */
const drawFooter = (doc, { width, height }, serial, extra = '') => {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(138, 163, 172);
  const line = serial
    ? `Certificate serial ${serial} — verify it in the Ararat certificate register to confirm this document is genuine.`
    : 'This copy carries no certificate serial and is not proof of anything.';
  doc.text(line, width / 2, height - 34, { align: 'center', maxWidth: width - 80 });
  if (extra) doc.text(extra, width / 2, height - 24, { align: 'center', maxWidth: width - 80 });
  doc.setTextColor(...INK);
};

const finish = (doc, { filename, geometry, signers, page, bottomOffset }) => ({
  blob: doc.output('blob'),
  filename,
  page,
  geometry,
  /** Exactly the blocks that were drawn, in the shape signnow-documents wants. */
  fields: fieldsForSigners(signers, page, geometry, bottomOffset),
});

// ===========================================================================
// SHARE CERTIFICATE — A4 landscape, mirroring certificateHtml()
// ===========================================================================

export const buildShareCertificatePdf = async ({
  cert, saccoName, memberName, memberNo, marketValue, serial, signers = [], draft = true,
}) => {
  const JsPDF = await loadJsPDF();
  const geometry = A4.landscape;
  const doc = new JsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const { width: W, height: H } = geometry;
  const M = 40;

  const shares = int(cert?.shares);
  const value = shares * (Number(marketValue) || Number(cert?.par_value) || 0);
  const issued = cert?.issue_date || cert?.created_at;

  // Double frame, as the HTML has.
  doc.setDrawColor(...TEAL);
  doc.setLineWidth(2.5);
  doc.rect(M, M, W - M * 2, H - M * 2);
  doc.setDrawColor(191, 230, 239);
  doc.setLineWidth(0.8);
  doc.rect(M + 6, M + 6, W - M * 2 - 12, H - M * 2 - 12);

  // Society, and the certificate numbers.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...INK);
  doc.text(String(saccoName || 'Sacco Society'), M + 26, M + 44);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...SLATE);
  doc.text('SHARE CERTIFICATE', M + 26, M + 58, { charSpace: 2 });

  doc.setFontSize(8);
  doc.text('Certificate No.', W - M - 26, M + 34, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...INK);
  doc.text(String(cert?.certificate_no || '—'), W - M - 26, M + 50, { align: 'right' });

  if (serial) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...SLATE);
    doc.text('SERIAL', W - M - 26, M + 66, { align: 'right', charSpace: 1.5 });
    doc.setFont('courier', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    doc.text(String(serial), W - M - 26, M + 80, { align: 'right' });
  }

  // Title.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.setTextColor(...INK);
  doc.text('CERTIFICATE OF SHARES', W / 2, M + 118, { align: 'center', charSpace: 4 });
  doc.setDrawColor(...TEAL);
  doc.setLineWidth(2);
  doc.line(W / 2 - 60, M + 130, W / 2 + 60, M + 130);

  // Body.
  let y = M + 170;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text('This is to certify that', W / 2, y, { align: 'center' });

  y += 30;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text(String(memberName || '—'), W / 2, y, { align: 'center' });
  doc.setDrawColor(207, 224, 230);
  doc.setLineWidth(0.6);
  const nameWidth = Math.min(320, doc.getTextWidth(String(memberName || '—')) + 60);
  doc.line(W / 2 - nameWidth / 2, y + 6, W / 2 + nameWidth / 2, y + 6);

  y += 26;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  if (memberNo) {
    doc.text(`member no. ${memberNo}`, W / 2, y, { align: 'center' });
    y += 18;
  }
  doc.text('is the registered holder of', W / 2, y, { align: 'center' });

  y += 26;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.setTextColor(...TEAL);
  doc.text(`${shares.toLocaleString()} ordinary share${shares === 1 ? '' : 's'}`, W / 2, y, { align: 'center' });

  y += 22;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  doc.text(
    `of ${KES(cert?.par_value)} each, fully paid, in the above-named society, subject to its by-laws.`,
    W / 2, y, { align: 'center', maxWidth: W - M * 4 },
  );

  // The four figures, as the HTML lays them out.
  const metaY = y + 42;
  const cells = [
    ['Shares held', shares.toLocaleString()],
    ['Par value', KES(cert?.par_value)],
    ['Value at issue', KES(value)],
    ['Date of issue', longDate(issued)],
  ];
  const cellW = (W - M * 2 - 52) / cells.length;
  cells.forEach(([k, v], i) => {
    const cx = M + 26 + cellW * i + cellW / 2;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...SLATE);
    doc.text(k.toUpperCase(), cx, metaY, { align: 'center', charSpace: 1 });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    doc.text(String(v), cx, metaY + 14, { align: 'center' });
  });

  const bottomOffset = 96;
  drawSignatureRow(doc, signers, geometry, bottomOffset);
  drawFooter(doc, geometry, serial,
    'This certificate is superseded automatically whenever the holding changes.');
  if (draft) drawDraftStamp(doc, geometry);

  return finish(doc, {
    filename: `Share_Certificate_${cert?.certificate_no || 'draft'}.pdf`,
    geometry, signers, page: 0, bottomOffset,
  });
};

// ===========================================================================
// SETTLEMENT & OWNERSHIP TRANSFER — A4 portrait
// ===========================================================================

export const buildSettlementCertificatePdf = async ({
  plan, client, asset, company, serial, signers = [], draft = true,
}) => {
  const JsPDF = await loadJsPDF();
  const geometry = A4.portrait;
  const doc = new JsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const { width: W } = geometry;
  const M = 48;
  const co = company || {};

  // Masthead.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...BLUE);
  doc.text(String(co.company_name || 'Ararat'), M, 60);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...SLATE);
  const contact = [co.email, co.phone, co.address].filter(Boolean).join('  ·  ');
  if (contact) doc.text(contact, M, 74, { maxWidth: W - M * 2 });

  doc.setDrawColor(...BLUE);
  doc.setLineWidth(2);
  doc.line(M, 84, W - M, 84);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(17, 17, 17);
  doc.text('CERTIFICATE OF FULL SETTLEMENT', W / 2, 112, { align: 'center', charSpace: 0.8 });
  doc.text('& OWNERSHIP TRANSFER', W / 2, 130, { align: 'center', charSpace: 0.8 });

  if (serial) {
    doc.setFont('courier', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...SLATE);
    doc.text(`Serial ${serial}`, W - M, 150, { align: 'right' });
  }

  let y = 176;

  const section = (title, rows) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...BLUE);
    doc.text(title.toUpperCase(), M, y, { charSpace: 0.8 });
    y += 6;
    doc.setDrawColor(220, 228, 240);
    doc.setLineWidth(0.6);
    doc.line(M, y, W - M, y);
    y += 14;

    doc.setFontSize(9);
    const colW = (W - M * 2) / 2;
    rows.forEach(([k, v], i) => {
      const col = i % 2;
      const x = M + col * colW;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...SLATE);
      doc.text(`${k}:`, x, y);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(17, 17, 17);
      doc.text(String(v ?? '—'), x + 96, y, { maxWidth: colW - 104 });
      if (col === 1 || i === rows.length - 1) y += 15;
    });
    y += 10;
  };

  section('Client details', [
    ['Full name', client?.full_name],
    ['Account no.', client?.account_number],
    ['ID number', client?.id_number],
    ['Phone', client?.phone],
  ]);

  section('Asset details', [
    ['Description', asset?.description],
    ['Asset code', asset?.asset_code],
    ['Serial / chassis', asset?.chassis_number || asset?.serial_number],
    ['Plate number', asset?.plate_number],
  ]);

  section('Payment plan', [
    ['Plan name', plan?.plan_name],
    ['Start date', plan?.start_date ? longDate(plan.start_date) : '—'],
    ['Installments', plan?.total_installments],
    ['Installment', KES0(plan?.installment_amount)],
    ['Frequency', plan?.frequency],
    ['Completed', longDate(plan?.end_date)],
  ]);

  // The figure, boxed — the settlement letter's highlight block.
  doc.setFillColor(240, 245, 255);
  doc.rect(M, y, W - M * 2, 56, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...SLATE);
  doc.text('TOTAL AMOUNT SETTLED', W / 2, y + 18, { align: 'center', charSpace: 1 });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.setTextColor(...BLUE);
  doc.text(KES0(plan?.total_amount), W / 2, y + 40, { align: 'center' });
  y += 76;

  // The operative words.
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(17, 17, 17);
  const paras = [
    `This is to certify that ${client?.full_name || 'the above-named client'} has fully and finally settled all obligations under plan reference ${plan?.plan_name || '—'} with ${co.company_name || 'the company'}. A total of ${plan?.total_installments || 0} installments amounting to ${KES0(plan?.total_amount)} have been received in full.`,
    `With effect from ${longDate(plan?.end_date)}, full legal title and ownership of the asset described above is transferred unconditionally to ${client?.full_name || 'the client'}. ${co.company_name || 'The company'} relinquishes all rights, encumbrances and claims over the said asset with immediate effect.`,
    `The client is authorised to effect the transfer of registration documents and to deal with the asset in any manner they see fit without further reference to ${co.company_name || 'the company'}.`,
  ];
  paras.forEach((p) => {
    const lines = doc.splitTextToSize(p, W - M * 2);
    doc.text(lines, M, y);
    y += lines.length * 12 + 8;
  });

  const bottomOffset = 110;
  drawSignatureRow(doc, signers, geometry, bottomOffset);
  drawFooter(doc, geometry, serial, `Issued by ${co.company_name || 'Ararat'} on ${longDate(new Date())}.`);
  if (draft) drawDraftStamp(doc, geometry);

  return finish(doc, {
    filename: `Settlement_Certificate_${plan?.plan_name || 'draft'}.pdf`.replace(/\s+/g, '_'),
    geometry, signers, page: 0, bottomOffset,
  });
};

// ===========================================================================
// ASSET VALUATION CERTIFICATE — A4 portrait
// ===========================================================================

export const buildAssetValuationPdf = async ({
  asset, saccoName, serial, signers = [], draft = true,
}) => {
  const JsPDF = await loadJsPDF();
  const geometry = A4.portrait;
  const doc = new JsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const { width: W } = geometry;
  const M = 48;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...INK);
  doc.text(String(saccoName || 'Sacco Society'), M, 60);

  doc.setDrawColor(...TEAL);
  doc.setLineWidth(2);
  doc.line(M, 74, W - M, 74);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('CERTIFICATE OF VALUATION', W / 2, 106, { align: 'center', charSpace: 1 });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...SLATE);
  doc.text('Fixed asset register', W / 2, 122, { align: 'center' });

  if (serial) {
    doc.setFont('courier', 'bold');
    doc.setFontSize(9);
    doc.text(`Serial ${serial}`, W - M, 144, { align: 'right' });
  }

  let y = 176;
  const row = (k, v) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...SLATE);
    doc.text(`${k}:`, M, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...INK);
    doc.text(String(v ?? '—'), M + 140, y, { maxWidth: W - M * 2 - 148 });
    y += 17;
  };

  row('Asset', asset?.asset_name);
  row('Asset tag', asset?.asset_tag);
  row('Category', String(asset?.category || '').replace(/_/g, ' '));
  row('Description', asset?.description);
  row('Location', asset?.location);
  row('Serial number', asset?.serial_number);
  row('Acquired', asset?.acquisition_date ? longDate(asset.acquisition_date) : '—');
  y += 8;

  row('Cost', KES(asset?.cost));
  row('Accumulated depreciation', KES(asset?.accumulated_depreciation));
  row('Net book value', KES(asset?.book_value));
  y += 10;

  // The figure this certificate exists to attest to.
  doc.setFillColor(236, 250, 253);
  doc.rect(M, y, W - M * 2, 62, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...SLATE);
  doc.text('CURRENT VALUATION', W / 2, y + 18, { align: 'center', charSpace: 1 });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...TEAL);
  doc.text(KES(asset?.current_value), W / 2, y + 40, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...SLATE);
  doc.text(
    `${String(asset?.valuation_basis || 'basis not stated').replace(/_/g, ' ')} · valued ${asset?.valuation_date ? longDate(asset.valuation_date) : 'date not stated'}`,
    W / 2, y + 54, { align: 'center' },
  );
  y += 84;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...INK);
  const body = doc.splitTextToSize(
    `The signatories below certify that the asset described above forms part of the fixed asset register of ${saccoName || 'the society'}, and that the valuation stated is, to the best of their knowledge, a fair statement of its worth on the valuation date. Book value is derived from the ledger and is not a valuation.`,
    W - M * 2,
  );
  doc.text(body, M, y);
  y += body.length * 12 + 10;

  const bottomOffset = 120;
  drawSignatureRow(doc, signers, geometry, bottomOffset);
  drawFooter(doc, geometry, serial, 'A valuation certificate is evidence for the register; it is not a transferable instrument.');
  if (draft) drawDraftStamp(doc, geometry);

  return finish(doc, {
    filename: `Valuation_Certificate_${asset?.asset_tag || asset?.id || 'draft'}.pdf`,
    geometry, signers, page: 0, bottomOffset,
  });
};

// ===========================================================================
// LOAN GUARANTEE AGREEMENT — the confirmed undertaking, as an instrument
//
// EVERY WORD ON THIS PAGE COMES FROM THE SERVER
// ---------------------------------------------
// `terms` is exactly what sacco_loan_guarantee_terms() returned — the same
// object the member read in the portal, carrying the clause text and the hash
// of it. Nothing here composes wording of its own, for the same reason
// GuaranteesTab does not: a second copy of the clauses in JavaScript is a
// second copy to drift, and the hash the guarantor is bound by covers the
// server's copy. If this file paraphrased a clause, the paper and the digest
// would disagree and the digest would be the one that was right.
//
// WHY IT PAGINATES AND THE CERTIFICATES DO NOT
// --------------------------------------------
// A certificate is a fixed design that fits by construction. This is a
// contract: the clause list is versioned server-side and will get longer.
// Overflowing off the foot of a fixed page would push the signature blocks
// somewhere SignNow places a signing box nobody can reach — so the flow breaks
// pages, and the signature row is laid out on whichever page turns out to be
// last.
// ===========================================================================

export const buildGuaranteeAgreementPdf = async ({
  terms, saccoName, signatureName, serial, signers = [], draft = true,
}) => {
  const JsPDF = await loadJsPDF();
  const geometry = A4.portrait;
  const doc = new JsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const { width: W, height: H } = geometry;
  const M = 48;

  const society = saccoName || terms?.sacco_name || 'Sacco Society';
  const loan = terms?.loan || {};
  const borrower = terms?.borrower || {};
  const guarantor = terms?.guarantor || {};
  const clauses = Array.isArray(terms?.clauses) ? terms.clauses : [];

  // The foot of the type area. Everything below this belongs to the signature
  // row and the footer, so the flow breaks before it rather than into it.
  const FLOOR = H - 150;
  let y = 0;

  const newPage = () => {
    doc.addPage();
    y = 64;
  };

  /** Break to a fresh page unless `need` points still fit above the floor. */
  const room = (need) => { if (y + need > FLOOR) newPage(); };

  // ── Page 1 masthead ──────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...INK);
  doc.text(String(society), M, 60);

  doc.setDrawColor(...TEAL);
  doc.setLineWidth(2);
  doc.line(M, 74, W - M, 74);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('LOAN GUARANTEE AGREEMENT', W / 2, 106, { align: 'center', charSpace: 1 });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...SLATE);
  doc.text(
    `Guarantor's undertaking${terms?.ref_no ? ` · ${terms.ref_no}` : ''}`,
    W / 2, 122, { align: 'center' },
  );

  if (serial) {
    doc.setFont('courier', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...SLATE);
    doc.text(`Serial ${serial}`, W - M, 144, { align: 'right' });
  }

  y = 168;

  // ── The parties and the facility ─────────────────────────────────────────
  const row = (k, v) => {
    room(17);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...SLATE);
    doc.text(`${k}:`, M, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...INK);
    doc.text(String(v ?? '—'), M + 150, y, { maxWidth: W - M * 2 - 158 });
    y += 17;
  };

  const heading = (text) => {
    room(30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...SLATE);
    doc.text(text.toUpperCase(), M, y, { charSpace: 1 });
    y += 14;
  };

  const withNo = (p) => (p?.name
    ? `${p.name}${p.member_no ? ` (${p.member_no})` : ''}`
    : '—');

  heading('The parties');
  row('Guarantor', withNo(guarantor));
  row('Borrower', withNo(borrower));
  row('Society', society);
  y += 6;

  heading('The facility guaranteed');
  row('Loan', loan.ref || '—');
  row('Product', loan.product || '—');
  row('Principal', KES(loan.principal));
  row('Interest', `${parseFloat(loan.rate || 0)}% p.a.`);
  row('Term', loan.term_months ? `${int(loan.term_months)} months` : '—');
  if (loan.purpose) row('Purpose', loan.purpose);
  y += 6;

  // The figure this agreement exists to fix. Read from the same field the hash
  // covers, so the number on the paper is the number that was agreed.
  room(76);
  doc.setFillColor(236, 250, 253);
  doc.rect(M, y, W - M * 2, 62, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...SLATE);
  doc.text('AMOUNT GUARANTEED', W / 2, y + 18, { align: 'center', charSpace: 1 });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...TEAL);
  doc.text(KES(terms?.amount_guaranteed), W / 2, y + 40, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...SLATE);
  doc.text(
    'The Guarantor’s liability under this agreement is limited to this amount.',
    W / 2, y + 54, { align: 'center' },
  );
  y += 84;

  // ── The undertaking ──────────────────────────────────────────────────────
  room(48);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...INK);
  const recital = doc.splitTextToSize(
    `${guarantor.name || 'The Guarantor'}, a member of ${society}, agrees to guarantee the facility described above on the terms set out below, and consents to their own deposits and shares being attached to the extent of the amount guaranteed.`,
    W - M * 2,
  );
  doc.text(recital, M, y);
  y += recital.length * 12 + 14;

  heading('Terms of the guarantee');

  clauses.forEach((c, i) => {
    const body = doc.splitTextToSize(String(c?.body || ''), W - M * 2 - 18);
    // Heading and first lines stay together — a clause title alone at the foot
    // of a page reads as though the clause it names was left out.
    room(18 + Math.min(body.length, 2) * 12 + 6);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(`${i + 1}.`, M, y);
    doc.text(String(c?.heading || ''), M + 18, y);
    y += 13;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...SLATE);
    body.forEach((line) => {
      room(12);
      doc.text(line, M + 18, y);
      y += 12;
    });
    y += 8;
  });

  // ── What the member already did, in the portal ───────────────────────────
  //
  // This is not decoration and it is not the signature: it is the record of the
  // two-step acceptance that made the agreement final, which is what entitles
  // the society to send this document out at all. The digest is printed in
  // full because it is the agreement's identity — the terms that bind are the
  // ones that reproduce it, and a reader can have that checked.
  room(96);
  doc.setDrawColor(...SLATE);
  doc.setLineWidth(0.4);
  doc.rect(M, y, W - M * 2, 74);
  const boxTop = y;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...SLATE);
  doc.text('CONFIRMED BY THE GUARANTOR IN THE MEMBER PORTAL', M + 12, boxTop + 16, { charSpace: 0.5 });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...INK);
  doc.text(
    terms?.accepted_at
      ? `Read and confirmed on ${longDate(terms.accepted_at)}${signatureName ? `, signed as ${signatureName}` : ''}.`
      : 'Not yet confirmed in the portal.',
    M + 12, boxTop + 32, { maxWidth: W - M * 2 - 24 },
  );
  doc.setFontSize(7.5);
  doc.setTextColor(...SLATE);
  doc.text(`Agreement version ${terms?.version || '—'}`, M + 12, boxTop + 46);
  doc.setFont('courier', 'normal');
  doc.setFontSize(6.5);
  doc.text(`SHA-256 ${terms?.hash || '—'}`, M + 12, boxTop + 60, { maxWidth: W - M * 2 - 24 });
  y = boxTop + 74 + 18;

  // ── Signatures, on whichever page turned out to be last ──────────────────
  const bottomOffset = 120;
  const sigTop = H - bottomOffset - SIG_BLOCK.height;
  // The blocks are positioned from the foot of the page, so if the flow has
  // already reached that far the row would be drawn over the text.
  if (y > sigTop - 24) newPage();

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...SLATE);
  doc.text('Signed by the parties:', M, Math.min(y, sigTop - 14));

  drawSignatureRow(doc, signers, geometry, bottomOffset);

  // ── Footer and DRAFT on every page ───────────────────────────────────────
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    drawFooter(doc, geometry, serial,
      `Page ${p} of ${pages} — this agreement binds the Guarantor only as executed by every signatory below.`);
    if (draft) drawDraftStamp(doc, geometry);
  }

  return finish(doc, {
    filename: `Guarantee_Agreement_${terms?.ref_no || terms?.guarantee_id || 'draft'}.pdf`,
    geometry,
    signers,
    // 0-based, which is what SignNow and signnow-documents both expect.
    page: pages - 1,
    bottomOffset,
  });
};

// ===========================================================================
// CONTRACTS — an execution page appended to a document that already exists
// ===========================================================================

// pdf-lib, loaded exactly as applySignatureToPDF loads it.
const loadPdfLib = () => new Promise((resolve, reject) => {
  if (window.PDFLib) return resolve(window.PDFLib);
  if (document.getElementById('pdflib-script')) {
    const wait = setInterval(() => {
      if (window.PDFLib) { clearInterval(wait); resolve(window.PDFLib); }
    }, 100);
    return;
  }
  const script = document.createElement('script');
  script.id = 'pdflib-script';
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
  script.onload = () => resolve(window.PDFLib);
  script.onerror = () => reject(new Error('Failed to load pdf-lib'));
  document.head.appendChild(script);
});

/**
 * Append an execution page to an existing contract and return it ready to send.
 *
 * WHY APPEND RATHER THAN PLACE FIELDS ON THE CONTRACT ITSELF
 * ----------------------------------------------------------
 * Because we do not know what is on the last page. A contract generated by
 * generateContractPDF ends wherever its schedule ended, an uploaded one could
 * end mid-sentence, and dropping a signature box at a fixed offset from the
 * bottom would sooner or later land it on top of a clause. A page we drew is a
 * page we know is empty.
 *
 * COORDINATES: pdf-lib measures from the BOTTOM-left, and everything else in
 * this feature measures from the top-left. The flip happens here and nowhere
 * else — `fields` comes back in top-left space, like every other builder's.
 */
export const appendContractSignaturePage = async (pdfBytes, {
  title, serial, signers = [], subtitle = '',
}) => {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvB = await pdf.embedFont(StandardFonts.HelveticaBold);

  const geometry = A4.portrait;
  const { width: W, height: H } = geometry;
  const page = pdf.addPage([W, H]);
  const pageIndex = pdf.getPageCount() - 1;

  // Top-left y → pdf-lib's bottom-left y.
  const flip = (topY) => H - topY;
  const M = 56;

  page.drawText('EXECUTION PAGE', {
    x: M, y: flip(80), size: 16, font: helvB, color: rgb(0.06, 0.15, 0.2),
  });
  page.drawLine({
    start: { x: M, y: flip(92) }, end: { x: W - M, y: flip(92) },
    thickness: 1.5, color: rgb(0.11, 0.66, 0.77),
  });

  page.drawText(String(title || 'Agreement').slice(0, 90), {
    x: M, y: flip(116), size: 11, font: helv, color: rgb(0.2, 0.28, 0.33),
  });
  if (subtitle) {
    page.drawText(String(subtitle).slice(0, 110), {
      x: M, y: flip(132), size: 9, font: helv, color: rgb(0.36, 0.49, 0.53),
    });
  }
  if (serial) {
    page.drawText(`Certificate serial ${serial}`, {
      x: M, y: flip(152), size: 9, font: helvB, color: rgb(0.36, 0.49, 0.53),
    });
  }

  const preamble =
    'The parties below have read the agreement to which this page is attached and, '
    + 'by signing electronically through SignNow, adopt those signatures as their own '
    + 'and agree to be bound by its terms.';
  const words = preamble.split(' ');
  let line = '';
  let y = 186;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (helv.widthOfTextAtSize(test, 10) > W - M * 2) {
      page.drawText(line, { x: M, y: flip(y), size: 10, font: helv, color: rgb(0.1, 0.1, 0.1) });
      y += 14;
      line = w;
    } else {
      line = test;
    }
  }
  if (line) page.drawText(line, { x: M, y: flip(y), size: 10, font: helv, color: rgb(0.1, 0.1, 0.1) });

  // The signature lines, from the one source of truth for their positions.
  const bottomOffset = 150;
  const blocks = signatureBlocks(signers.length, geometry, bottomOffset);
  signers.forEach((s, i) => {
    const b = blocks[i];
    page.drawLine({
      start: { x: b.x, y: flip(b.lineY) }, end: { x: b.x + b.width, y: flip(b.lineY) },
      thickness: 0.8, color: rgb(0.06, 0.15, 0.2),
    });
    const role = String(s.role || '').toUpperCase();
    page.drawText(role, {
      x: b.x + (b.width - helvB.widthOfTextAtSize(role, 7.5)) / 2,
      y: flip(b.captionY), size: 7.5, font: helvB, color: rgb(0.36, 0.49, 0.53),
    });
    if (s.name) {
      const nm = String(s.name);
      page.drawText(nm, {
        x: b.x + (b.width - helv.widthOfTextAtSize(nm, 7)) / 2,
        y: flip(b.captionY + 10), size: 7, font: helv, color: rgb(0.36, 0.49, 0.53),
      });
    }
  });

  const foot = serial
    ? `Certificate serial ${serial} — verify it in the Ararat certificate register.`
    : 'Executed through Ararat and SignNow.';
  page.drawText(foot, {
    x: M, y: 34, size: 7, font: helv, color: rgb(0.54, 0.64, 0.67),
  });

  const bytes = await pdf.save();
  return {
    blob: new Blob([bytes], { type: 'application/pdf' }),
    filename: `${String(title || 'Agreement').replace(/\s+/g, '_')}_for_signature.pdf`,
    page: pageIndex,
    geometry,
    fields: fieldsForSigners(signers, pageIndex, geometry, bottomOffset),
  };
};

/**
 * The builder for a document kind. Contracts are absent on purpose: they are
 * already generated by generateContractPDF() and go through the signing flow as
 * an existing file with an execution page appended, not redrawn here.
 */
export const CERTIFICATE_BUILDERS = {
  share_certificate: buildShareCertificatePdf,
  settlement_certificate: buildSettlementCertificatePdf,
  asset_valuation: buildAssetValuationPdf,
  guarantee_agreement: buildGuaranteeAgreementPdf,
};
