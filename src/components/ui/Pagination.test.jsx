import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import Pagination, { pageWindow } from './Pagination';

vi.mock('../AppIcon', () => ({
  default: ({ name }) => <span data-testid={`icon-${name}`} />,
}));

const props = (o = {}) => ({
  page: 0, pageCount: 50, from: 1, to: 25, total: 1240,
  onPageChange: () => {}, noun: 'members', ...o,
});

describe('pageWindow', () => {
  it('keeps the first and last page one click away from the middle', () => {
    expect(pageWindow(20, 50)).toEqual([0, null, 19, 20, 21, null, 49]);
  });

  it('does not insert a gap where the pages are already contiguous', () => {
    expect(pageWindow(1, 4)).toEqual([0, 1, 2, 3]);
    expect(pageWindow(0, 3)).toEqual([0, 1, 2]);
  });

  it('gaps on one side only when the current page hugs an end', () => {
    expect(pageWindow(0, 50)).toEqual([0, 1, null, 49]);
    expect(pageWindow(49, 50)).toEqual([0, null, 48, 49]);
  });

  it('never emits an out-of-range page', () => {
    for (const [p, n] of [[0, 1], [0, 2], [5, 6], [3, 7]]) {
      for (const v of pageWindow(p, n)) {
        if (v !== null) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThan(n);
      }
    }
  });
});

describe('Pagination', () => {
  // The whole point of the component: say how many records exist, so a page of
  // 25 is never mistaken for the entire book.
  it('states the row range and the true total', () => {
    render(<Pagination {...props()} />);
    const nav = screen.getByRole('navigation', { name: /pagination/i });
    expect(nav).toHaveTextContent('1–25');
    expect(nav).toHaveTextContent('1,240');
    expect(nav).toHaveTextContent('members');
  });

  it('renders nothing when everything already fits on one page', () => {
    const { container } = render(<Pagination {...props({ pageCount: 1, total: 12, to: 12 })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('marks the current page for assistive tech', () => {
    render(<Pagination {...props({ page: 2 })} />);
    expect(screen.getByRole('button', { name: 'Page 3' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Page 1' })).not.toHaveAttribute('aria-current');
  });

  it('cannot walk off either end', () => {
    const { unmount } = render(<Pagination {...props({ page: 0 })} />);
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    unmount();

    render(<Pagination {...props({ page: 49 })} />);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('reports the page the user asked for', async () => {
    const onPageChange = vi.fn();
    render(<Pagination {...props({ page: 2, onPageChange })} />);

    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenCalledWith(3);

    await userEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(onPageChange).toHaveBeenCalledWith(1);

    // Numbered buttons are 1-indexed on screen, 0-indexed in state.
    await userEvent.click(screen.getByRole('button', { name: 'Page 1' }));
    expect(onPageChange).toHaveBeenCalledWith(0);
  });

  it('locks the controls while a page is in flight', () => {
    render(<Pagination {...props({ page: 2, loading: true })} />);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Page 1' })).toBeDisabled();
  });
});
