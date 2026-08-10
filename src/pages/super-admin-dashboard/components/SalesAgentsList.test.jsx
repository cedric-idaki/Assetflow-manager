import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import SalesAgentsList from './SalesAgentsList';

describe('SalesAgentsList', () => {
  it('calls onUpgradeAgent when a bronze agent is upgraded to gold', async () => {
    const onUpgradeAgent = vi.fn();
    const user = userEvent.setup();

    render(
      <SalesAgentsList
        agents={[
          {
            id: 'agent-1',
            full_name: 'Jane Doe',
            email: 'jane@example.com',
            agent_code: 'AGT-100',
            region: 'Nairobi',
            commission_rate: 5,
            total_sales: 10000,
            total_commission: 500,
            target_amount: 20000,
            agent_status: 'active',
            agent_plan: 'bronze',
          },
        ]}
        rejections={[]}
        onCreateNew={vi.fn()}
        onExport={vi.fn()}
        onUpgradeAgent={onUpgradeAgent}
      />
    );

    await user.click(screen.getByRole('button', { name: /upgrade to gold/i }));

    expect(onUpgradeAgent).toHaveBeenCalledWith('agent-1');
  });
});
