import React, { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import useDragReorder, { ReorderHandle, reorder, newRowUid } from './useDragReorder';

vi.mock('../AppIcon', () => ({
  default: ({ name }) => <span data-testid={`icon-${name}`} />,
}));

// A stand-in for the signatory list: position in the array is the signing order.
function List({ initial }) {
  const [rows, setRows] = useState(initial.map((label) => ({ uid: newRowUid(), label })));
  const drag = useDragReorder(setRows);
  return (
    <ol>
      {rows.map((r, i) => (
        <li key={r.uid} {...drag.rowProps(i)} data-testid={`row-${r.label}`} data-cls={drag.rowClass(i)}>
          <ReorderHandle {...drag.handleProps(i, rows.length, 'signatory')} />
          <span data-testid={`label-${r.label}`}>{r.label}</span>
        </li>
      ))}
    </ol>
  );
}

const order = () => screen.getAllByRole('listitem').map((li) => li.querySelector('[data-testid^="label-"]').textContent);

describe('reorder', () => {
  it('moves an item down to the dropped position', () => {
    expect(reorder(['ceo', 'mgr', 'staff'], 0, 2)).toEqual(['mgr', 'staff', 'ceo']);
  });

  it('moves an item up to the dropped position', () => {
    expect(reorder(['ceo', 'mgr', 'staff'], 2, 0)).toEqual(['staff', 'ceo', 'mgr']);
  });

  it('returns the list untouched for a no-op or out-of-range move', () => {
    const list = ['ceo', 'mgr'];
    expect(reorder(list, 1, 1)).toBe(list);
    expect(reorder(list, 0, 5)).toBe(list);
    expect(reorder(list, -1, 0)).toBe(list);
  });

  it('does not mutate the array it is given', () => {
    const list = ['ceo', 'mgr', 'staff'];
    reorder(list, 0, 2);
    expect(list).toEqual(['ceo', 'mgr', 'staff']);
  });
});

describe('useDragReorder', () => {
  it('promotes a signatory with the up button', async () => {
    render(<List initial={['ceo', 'mgr', 'staff']} />);
    await act(async () => { await userEvent.click(screen.getByLabelText('Move signatory 3 earlier')); });
    expect(order()).toEqual(['ceo', 'staff', 'mgr']);
  });

  it('demotes a signatory with the down button', async () => {
    render(<List initial={['ceo', 'mgr', 'staff']} />);
    await act(async () => { await userEvent.click(screen.getByLabelText('Move signatory 1 later')); });
    expect(order()).toEqual(['mgr', 'ceo', 'staff']);
  });

  it('disables the arrows that would run off the ends', () => {
    render(<List initial={['ceo', 'mgr', 'staff']} />);
    expect(screen.getByLabelText('Move signatory 1 earlier')).toBeDisabled();
    expect(screen.getByLabelText('Move signatory 3 later')).toBeDisabled();
    expect(screen.getByLabelText('Move signatory 1 later')).not.toBeDisabled();
  });

  it('reorders on a drag from the first row onto the last', () => {
    render(<List initial={['ceo', 'mgr', 'staff']} />);
    const from = screen.getByTestId('row-ceo');
    const to = screen.getByTestId('row-staff');
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: () => {}, getData: () => '0' };

    fireEvent.mouseDown(screen.getByTitle('Drag to reorder — signatory 1'));
    fireEvent.dragStart(from, { dataTransfer });
    fireEvent.dragEnter(to, { dataTransfer });
    fireEvent.dragOver(to, { dataTransfer });
    fireEvent.drop(to, { dataTransfer });

    expect(order()).toEqual(['mgr', 'staff', 'ceo']);
  });

  it('leaves a row undraggable until its own grip is held', () => {
    render(<List initial={['ceo', 'mgr', 'staff']} />);
    // Inputs live inside these rows; arming the whole list up front would let the
    // browser hijack text selection.
    expect(screen.getByTestId('row-ceo')).not.toHaveAttribute('draggable', 'true');
    fireEvent.mouseDown(screen.getByTitle('Drag to reorder — signatory 1'));
    expect(screen.getByTestId('row-ceo')).toHaveAttribute('draggable', 'true');
    expect(screen.getByTestId('row-mgr')).not.toHaveAttribute('draggable', 'true');
  });

  it('disarms the row when the mouse is released away from the grip', () => {
    render(<List initial={['ceo', 'mgr']} />);
    fireEvent.mouseDown(screen.getByTitle('Drag to reorder — signatory 1'));
    expect(screen.getByTestId('row-ceo')).toHaveAttribute('draggable', 'true');
    fireEvent.mouseUp(window);
    expect(screen.getByTestId('row-ceo')).not.toHaveAttribute('draggable', 'true');
  });

  it('marks the dragged row and its drop target for the user', () => {
    render(<List initial={['ceo', 'mgr']} />);
    const from = screen.getByTestId('row-ceo');
    const to = screen.getByTestId('row-mgr');
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: () => {}, getData: () => '0' };

    fireEvent.mouseDown(screen.getByTitle('Drag to reorder — signatory 1'));
    fireEvent.dragStart(from, { dataTransfer });
    fireEvent.dragEnter(to, { dataTransfer });

    expect(from.dataset.cls).toContain('opacity-40');
    expect(to.dataset.cls).toContain('ring-primary/50');
  });
});
