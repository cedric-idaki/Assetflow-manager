import React from 'react';
import Icon from '../../../components/AppIcon';
import { includedModules, moduleFeeFor } from '../../../config/systemBilling';
import { moduleLabel } from '../../../config/modules';

/**
 * The itemised bill, exactly as the tenant's invoice states it.
 *
 * Renders what buildSystemInvoice() returned and nothing it worked out for
 * itself, so this screen cannot quote a figure the invoice will not.
 *
 * THE ITEM TABLE IS VAT-INCLUSIVE ON PURPOSE. Each row shows the ADVERTISED
 * rate, so qty x unit = amount exactly and a client can check the line by
 * hand. Net line amounts were tried and reverted: a net unit price rounded to
 * two decimals does not multiply back to its line (240 members at a net 23.28
 * is out by several shillings). The taxable value and the VAT element are
 * disclosed beneath the table instead, which is what a Kenyan tax invoice
 * needs and what the printed document already does.
 */

const fmt = (n) => `KES ${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString(undefined, {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})}`;

const Line = ({ label, sub, value, muted }) => (
  <div className="flex items-start justify-between gap-3 py-2 border-b border-border last:border-0">
    <div className="min-w-0">
      <p className={`text-xs font-medium ${muted ? 'text-muted-foreground' : 'text-foreground'}`}>{label}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
    <p className={`text-xs font-bold whitespace-nowrap ${muted ? 'text-muted-foreground' : 'text-foreground'}`}>
      {value}
    </p>
  </div>
);

/**
 * @param {object}   quote      the buildSystemInvoice() result
 * @param {string}   productLine 'company' | 'sacco' — decides what a plan bundles
 * @param {string[]} modules     module keys the tenant has enabled
 */
const InvoiceBreakdown = ({ quote, productLine = 'company', modules = [] }) => {
  if (!quote) return null;

  // Modules beyond what the plan bundles. Every module fee is 0 today, so the
  // engine suppresses the line — but the component of the bill still has to be
  // ACCOUNTED FOR on the page, or a reader cannot tell "no extra modules" from
  // "extra modules we forgot to bill". A bundled extra is shown at zero.
  const included = includedModules(productLine);
  const extras = (modules || []).filter((k) => !included.includes(k));
  const chargedExtras = extras.filter((k) => moduleFeeFor(k) > 0);
  const bundledExtras = extras.filter((k) => moduleFeeFor(k) === 0);

  return (
    <div className="rounded-xl border border-border bg-background overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border bg-muted/30 flex items-center gap-2">
        <Icon name="ReceiptText" size={13} color="var(--color-muted-foreground)" />
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
          Itemised bill
        </p>
      </div>

      <div className="px-4 py-1">
        {quote.lines.map((l, i) => (
          <Line
            key={`${l.label}-${i}`}
            label={l.label}
            sub={l.qty > 1 ? `${l.qty.toLocaleString()} × ${fmt(l.unit)}` : null}
            value={fmt(l.gross)}
          />
        ))}

        {/* The additional-modules component, stated even when it is free. */}
        {bundledExtras.length > 0 && chargedExtras.length === 0 && (
          <Line
            muted
            label={`Additional modules — ${bundledExtras.length} enabled`}
            sub={`${bundledExtras.map(moduleLabel).join(', ')} · included in the plan`}
            value={fmt(0)}
          />
        )}

        {quote.lines.length === 0 && (
          <p className="py-4 text-center text-xs text-muted-foreground">
            Nothing billable — add users or members.
          </p>
        )}
      </div>

      {/* Tax disclosure */}
      <div className="px-4 py-3 border-t border-border bg-muted/20 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Taxable value</span>
          <span className="text-xs font-semibold text-foreground">{fmt(quote.subtotal)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            VAT @ {quote.vatRate}%
            {quote.vatInclusive && <span className="ml-1 text-[10px]">(included in prices)</span>}
          </span>
          <span className="text-xs font-semibold text-foreground">{fmt(quote.vatAmount)}</span>
        </div>
        <div className="flex items-center justify-between pt-2 border-t border-border">
          <span className="text-sm font-bold text-foreground">Total (incl. VAT)</span>
          <span className="text-lg font-extrabold text-primary">{fmt(quote.total)}</span>
        </div>
      </div>

      {/* Footnotes that change what the number means. */}
      {(quote.minimumApplied || quote.installationFee > 0 || quote.taxRegime) && (
        <div className="px-4 py-2.5 border-t border-border space-y-1">
          {quote.minimumApplied && (
            <p className="text-[11px] text-amber-700 flex items-start gap-1.5">
              <Icon name="Info" size={11} color="currentColor" className="mt-0.5 flex-shrink-0" />
              Billed on {quote.billedSeats} {quote.isSacco ? 'members' : 'users'} — the minimum for
              this product line — rather than {quote.seats}.
            </p>
          )}
          {quote.installationFee > 0 && (
            <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
              <Icon name="Info" size={11} color="currentColor" className="mt-0.5 flex-shrink-0" />
              Includes the one-time installation & onboarding fee. Renewals do not re-charge it.
            </p>
          )}
          {quote.taxRegime && (
            <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
              <Icon name="Scale" size={11} color="currentColor" className="mt-0.5 flex-shrink-0" />
              VAT under {quote.taxRegime.instrument || quote.taxRegime.label}.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default InvoiceBreakdown;
