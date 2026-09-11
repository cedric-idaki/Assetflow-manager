/**
 * The Finance Hub's own design tokens and the three primitives every tab
 * builds out of.
 *
 * These lived inside index.jsx while it was the only file on this side of the
 * hub. A second file now renders into the same tab strip, and two copies of a
 * token set drift: one panel gets a new border radius and the tab beside it
 * does not. So they moved here, and index.jsx imports what it always used.
 *
 * The SACCO side keeps its own set under sacco-dashboard/components/_shared —
 * it is a different product surface with a different palette, and merging them
 * would mean one of the two changes appearance for no reason.
 */
import React from 'react';
import Icon from '../../../components/AppIcon';

export const fmt = (n) =>
  `KES ${parseFloat(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS (FINNOVA-inspired dark-mode aesthetic adapted for Ararat)
// ─────────────────────────────────────────────────────────────────────────────
export const S = {
  page:     'min-h-screen bg-background',
  panel:    'bg-card border border-border rounded-xl',
  header:   'flex items-center justify-between px-5 py-4 border-b border-border',
  body:     'p-5',
  th:       'text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40',
  td:       'px-4 py-3 text-sm text-muted-foreground border-t border-border',
  tdFirst:  'px-4 py-3 text-sm font-medium text-foreground border-t border-border',
  row:      'hover:bg-muted/30 transition-colors',
  input:    'w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all',
  select:   'bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all',
  btnPri:   'inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors',
  btnSec:   'inline-flex items-center gap-2 bg-muted text-foreground px-4 py-2 rounded-lg text-sm font-medium border border-border hover:bg-muted/70 transition-colors',
  btnGhost: 'inline-flex items-center gap-2 text-muted-foreground px-3 py-1.5 rounded-lg text-sm hover:text-foreground hover:bg-muted transition-colors',
  label:    'block text-xs font-semibold text-muted-foreground mb-1.5',
};

export const Sk = ({ className = '' }) => <div className={`animate-pulse bg-muted rounded-md ${className}`} />;

export const Empty = ({ icon, text, sub }) => (
  <div className="flex flex-col items-center justify-center py-16 text-center">
    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
      <Icon name={icon} size={20} color="var(--color-muted-foreground)" />
    </div>
    <p className="text-sm font-medium text-foreground mb-1">{text}</p>
    {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
  </div>
);

// Toast — writes into the single #fh-toast node the hub renders.
let _toastTimer;
export const toast = (msg, type = 'success') => {
  const el = document.getElementById('fh-toast');
  if (!el) return;
  const colors = { success: '#10b981', error: '#ef4444', info: '#3b82f6', warning: '#f59e0b' };
  const icons  = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  el.textContent = `${icons[type]} ${msg}`;
  el.style.borderColor = colors[type];
  el.style.opacity = '1';
  el.style.transform = 'translateY(0)';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
  }, 3500);
};
