import React, { useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import Icon from '../../../components/AppIcon';

const COLORS = ['#7C3AED', '#06B6D4', '#059669', '#D97706', '#EC4899', '#6366F1'];

const CustomTooltip = ({ active, payload }) => {
  if (active && payload?.length) {
    const item = payload?.[0];
    return (
      <div className="bg-card border border-border rounded-lg p-3 shadow-lg">
        <p className="text-sm font-semibold text-foreground">{item?.name}</p>
        <p className="text-sm text-primary font-bold">${parseFloat(item?.value || 0)?.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
        <p className="text-xs text-muted-foreground">{item?.payload?.percentage}% of total</p>
      </div>
    );
  }
  return null;
};

const AllocationBreakdown = ({ allocations = [], totalAmount = 0 }) => {
  const [expanded, setExpanded] = useState(false);

  const chartData = allocations?.map((a, i) => ({
    name: a?.assetName || a?.accountName || `Asset ${i + 1}`,
    value: parseFloat(a?.amount || 0),
    percentage: totalAmount > 0 ? ((parseFloat(a?.amount || 0) / totalAmount) * 100)?.toFixed(1) : 0,
  }));

  if (!allocations?.length) return null;

  return (
    <div className="bg-card border border-border rounded-xl p-5 mb-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
            <Icon name="PieChart" size={16} color="var(--color-accent)" />
          </div>
          <h2 className="text-base font-semibold text-foreground">Allocation Breakdown</h2>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors font-medium"
        >
          {expanded ? 'Collapse' : 'Expand'}
          <Icon name={expanded ? 'ChevronUp' : 'ChevronDown'} size={14} color="currentColor" />
        </button>
      </div>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={85}
              paddingAngle={3}
              dataKey="value"
            >
              {chartData?.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS?.[index % COLORS?.length]} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend
              formatter={(value) => <span className="text-xs text-muted-foreground">{value}</span>}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      {expanded && (
        <div className="mt-4 space-y-2">
          {chartData?.map((item, index) => (
            <div key={index} className="flex items-center justify-between p-3 rounded-lg bg-muted">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS?.[index % COLORS?.length] }} />
                <span className="text-sm text-foreground font-medium">{item?.name}</span>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-foreground">${parseFloat(item?.value || 0)?.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                <p className="text-xs text-muted-foreground">{item?.percentage}%</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AllocationBreakdown;
