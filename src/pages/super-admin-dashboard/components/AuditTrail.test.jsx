import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import AuditTrail from './AuditTrail';

describe('AuditTrail', () => {
  it('filters the trail to sales and sales leads entries', async () => {
    const user = userEvent.setup();
    const data = [
      {
        id: '1',
        action: 'create',
        table_name: 'sales',
        description: 'Created a sales record',
        created_at: '2026-08-07T10:00:00.000Z',
        user: { full_name: 'Alice', role: 'super_admin' },
      },
      {
        id: '2',
        action: 'create',
        table_name: 'leads',
        description: 'Created a sales lead',
        created_at: '2026-08-07T10:05:00.000Z',
        user: { full_name: 'Bob', role: 'super_admin' },
      },
      {
        id: '3',
        action: 'update',
        table_name: 'clients',
        description: 'Updated a client',
        created_at: '2026-08-07T10:10:00.000Z',
        user: { full_name: 'Carol', role: 'super_admin' },
      },
    ];

    render(<AuditTrail data={data} onExport={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /^sales leads$/i }));
    expect(screen.getByText(/created a sales lead/i)).toBeInTheDocument();
    expect(screen.queryByText(/created a sales record/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^sales$/i }));
    expect(screen.getByText(/created a sales record/i)).toBeInTheDocument();
    expect(screen.queryByText(/created a sales lead/i)).not.toBeInTheDocument();
  });
});
