import React from 'react';
import Icon from '../AppIcon';

/**
 * Page controls for a server-paginated list (see hooks/usePagedQuery).
 *
 * The row readout is the point of this component, not the arrows. A capped
 * list that silently shows the first N rows reads as missing data; "Showing
 * 26–50 of 1,240" tells the user the rest of the book exists and is reachable,
 * which is the difference between a paged table and an apparent data loss.
 *
 * Renders nothing when everything fits on one page — controls for a single
 * page are noise, and the caller already shows the total in its header.
 */

/** How many numbered buttons to show around the current page. */
const WINDOW = 1;

/**
 * Page numbers to render, with `null` marking a gap:
 *   1 … 5 6 [7] 8 9 … 50
 * Always keeps the first and last page reachable in one click, so "jump to the
 * end" never means clicking next forty times.
 */
export const pageWindow = (page, pageCount) => {
  const wanted = new Set([0, pageCount - 1]);
  for (let i = page - WINDOW; i <= page + WINDOW; i += 1) {
    if (i >= 0 && i < pageCount) wanted.add(i);
  }
  const sorted = [...wanted].sort((a, b) => a - b);

  const out = [];
  let prev = null;
  for (const p of sorted) {
    if (prev !== null && p - prev > 1) out.push(null);
    out.push(p);
    prev = p;
  }
  return out;
};

const numberCls = (active) =>
  `min-w-[2rem] h-8 px-2 rounded-lg text-sm font-medium transition-all ${
    active
      ? 'bg-primary text-primary-foreground'
      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
  }`;

const arrowCls =
  'inline-flex items-center justify-center h-8 w-8 rounded-lg border border-border text-muted-foreground ' +
  'hover:text-foreground hover:bg-muted transition-all disabled:opacity-40 disabled:cursor-not-allowed ' +
  'disabled:hover:bg-transparent disabled:hover:text-muted-foreground';

const Pagination = ({
  page,
  pageCount,
  from,
  to,
  total,
  onPageChange,
  loading = false,
  /** Plural noun for the readout, e.g. "members". */
  noun = 'records',
  className = '',
}) => {
  if (pageCount <= 1) return null;

  const n = (v) => Number(v || 0).toLocaleString('en-KE');

  return (
    <nav
      aria-label="Pagination"
      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 mt-4 border-t border-border ${className}`}
    >
      <p className="text-xs text-muted-foreground" aria-live="polite">
        Showing <span className="font-medium text-foreground">{n(from)}–{n(to)}</span> of{' '}
        <span className="font-medium text-foreground">{n(total)}</span> {noun}
      </p>

      <div className="flex items-center gap-1">
        <button
          type="button"
          className={arrowCls}
          onClick={() => onPageChange(page - 1)}
          disabled={page === 0 || loading}
          aria-label="Previous page"
        >
          <Icon name="ChevronLeft" size={16} color="currentColor" />
        </button>

        {pageWindow(page, pageCount).map((p, i) =>
          p === null ? (
            <span key={`gap-${i}`} className="px-1 text-xs text-muted-foreground select-none">…</span>
          ) : (
            <button
              key={p}
              type="button"
              className={numberCls(p === page)}
              onClick={() => onPageChange(p)}
              disabled={loading}
              aria-label={`Page ${p + 1}`}
              aria-current={p === page ? 'page' : undefined}
            >
              {p + 1}
            </button>
          )
        )}

        <button
          type="button"
          className={arrowCls}
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pageCount - 1 || loading}
          aria-label="Next page"
        >
          <Icon name="ChevronRight" size={16} color="currentColor" />
        </button>
      </div>
    </nav>
  );
};

export default Pagination;
