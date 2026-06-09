import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';
const fmt = (n) => `KES ${parseFloat(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;

const SettlementLetterModal = ({ plan, client, asset, companyProfile, onClose }) => {
  const [letterRef] = useState(`SL-${Date.now().toString(36).toUpperCase()}`);

  const handlePrint = () => {
    const co = companyProfile || {};
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Settlement Letter — ${letterRef}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; padding: 60px; color: #111; font-size: 13px; line-height: 1.6; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; padding-bottom: 20px; border-bottom: 3px solid #1A56DB; }
          .company-name { font-size: 22px; font-weight: bold; color: #1A56DB; }
          .title { font-size: 20px; font-weight: 900; color: #111; text-transform: uppercase; letter-spacing: 1px; text-align: center; margin: 30px 0 10px; }
          .subtitle { text-align: center; color: #555; margin-bottom: 30px; font-size: 12px; }
          .ref { text-align: right; font-size: 12px; color: #555; margin-bottom: 20px; }
          .section { margin-bottom: 20px; }
          .section-title { font-weight: bold; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #1A56DB; margin-bottom: 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 20px; }
          .row { display: flex; gap: 10px; padding: 4px 0; }
          .label { color: #555; min-width: 160px; }
          .value { font-weight: 600; }
          .highlight-box { background: #f0f9ff; border: 2px solid #1A56DB; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center; }
          .highlight-box .amount { font-size: 28px; font-weight: 900; color: #1A56DB; }
          .highlight-box .label { color: #555; font-size: 12px; min-width: 0; }
          .body-text { margin-bottom: 14px; text-align: justify; }
          .signature-block { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 50px; }
          .sig-line { border-top: 1px solid #111; padding-top: 8px; font-size: 12px; }
          .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #888; text-align: center; }
          .stamp { display: inline-block; border: 3px solid #10b981; border-radius: 50%; padding: 12px 16px; color: #10b981; font-weight: 900; font-size: 14px; transform: rotate(-15deg); margin: 10px; letter-spacing: 1px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="company-name">${co.company_name || 'AssetFlow'}</div>
            <div style="font-size:11px; color:#555; margin-top:4px">${co.physical_address || ''}</div>
            <div style="font-size:11px; color:#555">Tel: ${co.phone || ''} | Email: ${co.email || ''}</div>
            <div style="font-size:11px; color:#555">KRA PIN: ${co.kra_pin || 'N/A'}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:11px; color:#555">Date: ${fmtDate(new Date().toISOString())}</div>
            <div style="font-size:11px; color:#555">Ref: <strong>${letterRef}</strong></div>
          </div>
        </div>

        <div class="title">Certificate of Full Settlement & Ownership Transfer</div>
        <div class="subtitle">This letter confirms full and final settlement of all hire purchase obligations</div>

        <div class="section">
          <div class="section-title">Client Details</div>
          <div class="grid">
            <div class="row"><span class="label">Full Name:</span><span class="value">${client?.full_name || '—'}</span></div>
            <div class="row"><span class="label">Account Number:</span><span class="value">${client?.account_number || '—'}</span></div>
            <div class="row"><span class="label">ID Number:</span><span class="value">${client?.id_number || '—'}</span></div>
            <div class="row"><span class="label">Phone:</span><span class="value">${client?.phone || '—'}</span></div>
            <div class="row"><span class="label">Email:</span><span class="value">${client?.email || '—'}</span></div>
          </div>
        </div>

        <div class="section">
          <div class="section-title">Asset Details</div>
          <div class="grid">
            <div class="row"><span class="label">Asset Description:</span><span class="value">${asset?.description || '—'}</span></div>
            <div class="row"><span class="label">Asset Code:</span><span class="value">${asset?.asset_code || '—'}</span></div>
            <div class="row"><span class="label">Make / Model:</span><span class="value">${[asset?.make, asset?.model, asset?.year].filter(Boolean).join(' ') || '—'}</span></div>
            <div class="row"><span class="label">Serial / Chassis No.:</span><span class="value">${asset?.chassis_number || asset?.serial_number || '—'}</span></div>
            <div class="row"><span class="label">Plate Number:</span><span class="value">${asset?.plate_number || '—'}</span></div>
            <div class="row"><span class="label">Color:</span><span class="value">${asset?.color || '—'}</span></div>
          </div>
        </div>

        <div class="section">
          <div class="section-title">Payment Plan Details</div>
          <div class="grid">
            <div class="row"><span class="label">Plan Name:</span><span class="value">${plan?.plan_name || '—'}</span></div>
            <div class="row"><span class="label">Plan Start Date:</span><span class="value">${fmtDate(plan?.start_date)}</span></div>
            <div class="row"><span class="label">Total Installments:</span><span class="value">${plan?.total_installments || '—'}</span></div>
            <div class="row"><span class="label">Installment Amount:</span><span class="value">${fmt(plan?.installment_amount)}</span></div>
            <div class="row"><span class="label">Payment Frequency:</span><span class="value capitalize">${plan?.frequency || '—'}</span></div>
            <div class="row"><span class="label">Completion Date:</span><span class="value">${fmtDate(plan?.end_date || new Date().toISOString())}</span></div>
          </div>
        </div>

        <div class="highlight-box">
          <div class="label">Total Amount Settled</div>
          <div class="amount">${fmt(plan?.total_amount)}</div>
          <div class="label" style="margin-top:6px">All obligations fully discharged ✓</div>
        </div>

        <div class="section">
          <div class="body-text">
            This is to certify that <strong>${client?.full_name || 'the above-named client'}</strong> has fully and finally settled all hire purchase obligations 
            under Plan Reference <strong>${plan?.plan_name}</strong> with <strong>${co.company_name || 'AssetFlow'}</strong>. 
            A total of <strong>${plan?.total_installments} installments</strong> amounting to <strong>${fmt(plan?.total_amount)}</strong> 
            have been received in full.
          </div>
          <div class="body-text">
            With effect from <strong>${fmtDate(new Date().toISOString())}</strong>, full legal title and ownership of the above-described asset 
            is hereby transferred unconditionally to <strong>${client?.full_name || 'the client'}</strong>. 
            ${co.company_name || 'The company'} relinquishes all rights, encumbrances, and claims over the said asset with immediate effect.
          </div>
          <div class="body-text">
            The client is hereby authorized to effect the transfer of registration documents and to deal with the asset 
            in any manner they deem fit without any further reference to ${co.company_name || 'the company'}.
          </div>
        </div>

        <div style="text-align:center; margin: 20px 0;">
          <div class="stamp">SETTLED IN FULL</div>
        </div>

        <div class="signature-block">
          <div>
            <div class="sig-line">
              <strong>Authorized Signatory</strong><br>
              ${co.company_name || 'AssetFlow'}<br>
              <span style="color:#555">Name: ________________________</span><br>
              <span style="color:#555">Designation: ________________________</span><br>
              <span style="color:#555">Date: ________________________</span>
            </div>
          </div>
          <div>
            <div class="sig-line">
              <strong>Client Acknowledgement</strong><br>
              ${client?.full_name || '________________________'}<br>
              <span style="color:#555">Signature: ________________________</span><br>
              <span style="color:#555">ID Number: ________________________</span><br>
              <span style="color:#555">Date: ________________________</span>
            </div>
          </div>
        </div>

        <div class="footer">
          <p>This is an official document issued by ${co.company_name || 'AssetFlow'}. Letter Reference: ${letterRef}</p>
          <p>Generated on ${fmtDate(new Date().toISOString())} | ${co.email || ''} | ${co.phone || ''}</p>
        </div>
      </body>
      </html>
    `;

    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 500);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h3 className="text-base font-bold text-foreground">Settlement Letter</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Ownership Transfer Certificate</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">✕</button>
        </div>

        {/* Preview */}
        <div className="px-6 py-5 space-y-4">
          {/* Success banner */}
          <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl dark:bg-emerald-900/20 dark:border-emerald-800">
            <span className="text-2xl">🎉</span>
            <div>
              <p className="text-sm font-bold text-emerald-800 dark:text-emerald-400">Final Payment Received!</p>
              <p className="text-xs text-emerald-700 dark:text-emerald-500">All {plan?.total_installments} installments completed. Ownership can now be transferred.</p>
            </div>
          </div>

          {/* Summary */}
          <div className="bg-muted/30 rounded-xl p-4 space-y-2">
            {[
              { label: 'Client',          value: client?.full_name || '—' },
              { label: 'Asset',           value: asset?.description || '—' },
              { label: 'Plan',            value: plan?.plan_name || '—' },
              { label: 'Total Settled',   value: fmt(plan?.total_amount) },
              { label: 'Installments',    value: `${plan?.total_installments} × ${fmt(plan?.installment_amount)}` },
              { label: 'Letter Ref',      value: letterRef },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-semibold text-foreground">{value}</span>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            Clicking <strong>Generate & Print</strong> will open a printable PDF-ready settlement letter confirming full ownership transfer to the client.
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3 px-6 py-4 border-t border-border">
          <button onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            Cancel
          </button>
          <button onClick={handlePrint}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
            🖨️ Generate & Print
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettlementLetterModal;
