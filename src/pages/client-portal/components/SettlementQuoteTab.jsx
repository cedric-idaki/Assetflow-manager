import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';

const fmt     = (n) => `KES ${parseFloat(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const SettlementQuoteTab = ({ installmentPlans, clientProfile }) => {
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [quote,          setQuote]          = useState(null);
  const [generating,     setGenerating]     = useState(false);

  const activePlans = (installmentPlans || []).filter(p =>
    p.plan_status === 'active' || p.plan_status === 'overdue'
  );

  const selectedPlan = activePlans.find(p => p.id === selectedPlanId);

  const generateQuote = () => {
    if (!selectedPlan) return;
    setGenerating(true);

    setTimeout(() => {
      const totalAmount      = parseFloat(selectedPlan.total_amount || 0);
      const installmentAmt   = parseFloat(selectedPlan.installment_amount || 0);
      const paid             = selectedPlan.installments_paid || 0;
      const total            = selectedPlan.total_installments || 1;
      const remaining        = total - paid;
      const outstandingCapital = installmentAmt * remaining;

      const discountRate    = 0.05;
      const discountAmount  = outstandingCapital * discountRate;
      const settlementAmount = outstandingCapital - discountAmount;

      const validUntil = new Date();
      validUntil.setDate(validUntil.getDate() + 7);

      setQuote({
        plan:              selectedPlan,
        totalAmount,
        amountPaid:        installmentAmt * paid,
        outstandingCapital,
        discountAmount,
        discountRate:      discountRate * 100,
        settlementAmount,
        remainingInstallments: remaining,
        validUntil:        validUntil.toISOString(),
        quoteRef:          `SQ-${Date.now().toString(36).toUpperCase()}`,
        generatedAt:       new Date().toISOString(),
      });
      setGenerating(false);
    }, 800);
  };

  const handlePrint = () => {
    if (!quote) return;
    const w = window.open('', '_blank');
    w.document.write(`
      <html><head><title>Settlement Quote — ${quote.quoteRef}</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 40px auto; color: #111; }
        h1 { font-size: 20px; } h2 { font-size: 16px; color: #1A56DB; }
        .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
        .total { font-weight: bold; font-size: 18px; color: #1A56DB; }
        .note { font-size: 12px; color: #666; margin-top: 20px; }
      </style></head><body>
      <h1>${clientProfile?.full_name || 'Client'} — Settlement Quote</h1>
      <p>Quote Ref: <strong>${quote.quoteRef}</strong> &nbsp;|&nbsp; Valid Until: <strong>${fmtDate(quote.validUntil)}</strong></p>
      <h2>Plan: ${quote.plan.plan_name}</h2>
      <div class="row"><span>Total Contract Amount</span><span>${fmt(quote.totalAmount)}</span></div>
      <div class="row"><span>Amount Already Paid</span><span>${fmt(quote.amountPaid)}</span></div>
      <div class="row"><span>Outstanding Capital</span><span>${fmt(quote.outstandingCapital)}</span></div>
      <div class="row"><span>Early Settlement Discount (${quote.discountRate}%)</span><span>(${fmt(quote.discountAmount)})</span></div>
      <div class="row total"><span>SETTLEMENT AMOUNT DUE</span><span>${fmt(quote.settlementAmount)}</span></div>
      <p class="note">This quote is valid for 7 days from the date of generation. Payment must be received in full by ${fmtDate(quote.validUntil)} to qualify for the discount. Contact us to arrange payment.</p>
      </body></html>
    `);
    w.document.close();
    w.print();
  };

  const handleArrangePayment = () => {
    const phone = clientProfile?.admin?.phone;
    const email = clientProfile?.admin?.email;
    if (phone) {
      window.location.href = `tel:${phone}`;
    } else if (email) {
      window.location.href = `mailto:${email}?subject=Settlement Quote ${quote?.quoteRef}&body=I would like to arrange payment for my settlement quote ${quote?.quoteRef} of ${fmt(quote?.settlementAmount)}.`;
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-foreground">Settlement Quote</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Request an early payoff quote for your active hire purchase plans
        </p>
      </div>

      {activePlans.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
            <Icon name="Calculator" size={24} color="var(--muted-foreground)" />
          </div>
          <p className="text-base font-semibold text-foreground">No active plans</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs">
            You need an active hire purchase plan to request a settlement quote
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Left — selector */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <h3 className="font-semibold text-foreground">Select Plan</h3>

            <div className="space-y-3">
              {activePlans.map(plan => {
                const paid     = plan.installments_paid || 0;
                const total    = plan.total_installments || 1;
                const progress = Math.round((paid / total) * 100);
                return (
                  <div key={plan.id}
                    onClick={() => { setSelectedPlanId(plan.id); setQuote(null); }}
                    className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                      selectedPlanId === plan.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/40'
                    }`}>
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-semibold text-foreground text-sm">{plan.plan_name}</p>
                        <p className="text-xs text-muted-foreground">{plan.asset?.description || '—'}</p>
                      </div>
                      {selectedPlanId === plan.id && (
                        <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                          <Icon name="Check" size={12} color="white" />
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                      <span>{paid}/{total} paid</span>
                      <span className="font-semibold text-foreground">{fmt(plan.total_amount)}</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              onClick={generateQuote}
              disabled={!selectedPlanId || generating}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50">
              {generating ? (
                <><Icon name="Loader" size={14} color="currentColor" className="animate-spin" /> Generating...</>
              ) : (
                <><Icon name="Calculator" size={14} color="currentColor" /> Generate Quote</>
              )}
            </button>
          </div>

          {/* Right — quote result */}
          <div>
            {quote ? (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="bg-primary px-5 py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-primary-foreground/70 uppercase tracking-wider">Settlement Quote</p>
                      <p className="text-lg font-bold text-primary-foreground mt-0.5">{quote.quoteRef}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-primary-foreground/70">Valid Until</p>
                      <p className="text-sm font-bold text-primary-foreground">{fmtDate(quote.validUntil)}</p>
                    </div>
                  </div>
                </div>

                <div className="p-5 space-y-0">
                  {[
                    { label: 'Total Contract Amount',   value: fmt(quote.totalAmount),        color: 'text-foreground' },
                    { label: 'Amount Already Paid',     value: fmt(quote.amountPaid),          color: 'text-emerald-600' },
                    { label: 'Outstanding Capital',     value: fmt(quote.outstandingCapital),  color: 'text-foreground' },
                    { label: `Early Settlement Discount (${quote.discountRate}%)`, value: `(${fmt(quote.discountAmount)})`, color: 'text-emerald-600' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="flex justify-between items-center py-3 border-b border-border">
                      <span className="text-sm text-muted-foreground">{label}</span>
                      <span className={`text-sm font-mono font-semibold ${color}`}>{value}</span>
                    </div>
                  ))}

                  <div className="flex justify-between items-center py-4 bg-primary/5 px-3 rounded-xl mt-3">
                    <span className="font-bold text-foreground">SETTLEMENT AMOUNT DUE</span>
                    <span className="text-2xl font-bold font-mono text-primary">{fmt(quote.settlementAmount)}</span>
                  </div>

                  <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
                    This quote is valid for 7 days. Full payment must be received by{' '}
                    <strong className="text-foreground">{fmtDate(quote.validUntil)}</strong> to qualify for the discount.
                  </p>

                  <div className="flex gap-3 mt-4">
                    <button onClick={handlePrint}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                      <Icon name="Printer" size={14} color="currentColor" /> Print
                    </button>
                    <button onClick={handleArrangePayment}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
                      <Icon name="Phone" size={14} color="currentColor" /> Arrange Payment
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-card border border-border rounded-xl flex flex-col items-center justify-center py-20 text-center">
                <Icon name="Calculator" size={32} color="var(--muted-foreground)" />
                <p className="text-sm text-muted-foreground mt-3">Select a plan and click</p>
                <p className="text-sm font-semibold text-foreground">Generate Quote</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SettlementQuoteTab;
