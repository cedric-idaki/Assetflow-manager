import React, { useState, useEffect, useCallback } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { supabase } from '../../../lib/supabase';

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#f97316', '#ef4444'];
const BUCKETS = ['Current', '1-30 Days', '31-60 Days', '61-90 Days', '90+ Days'];

const Sk = () => <div className="animate-pulse bg-gray-200 rounded-lg w-full h-64" />;

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 shadow-lg">
      <p className="text-sm font-bold text-gray-900">{payload[0].name}</p>
      <p className="text-xs text-gray-600 mt-1">
        KES {payload[0].value.toLocaleString()} &mdash; {payload[0].payload.percentage}%
      </p>
      <p className="text-xs text-gray-500">{payload[0].payload.count} account{payload[0].payload.count !== 1 ? 's' : ''}</p>
    </div>
  );
};

const renderLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percentage }) => {
  if (percentage < 4) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central"
      style={{ fontSize: '11px', fontWeight: '700' }}>
      {`${percentage.toFixed(1)}%`}
    </text>
  );
};

const AgingAnalysisChart = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const today = new Date();

      // Get all active installment plans with charges
      const { data: plans, error } = await supabase
        .from('installment_plans')
        .select(`
  id, total_amount, installment_amount, installments_paid, total_installments,
  installment_charges(id, amount, scheduled_date, charge_status)
`)
.eq('plan_status', 'active');

      if (error) throw error;

      const buckets = [0, 0, 0, 0, 0]; // current, 1-30, 31-60, 61-90, 90+
      const counts = [0, 0, 0, 0, 0];

      (plans || []).forEach(plan => {
        const overdueCharges = (plan.installment_charges || []).filter(
          c => c.charge_status !== 'paid' && c.charge_status !== 'waived'
        );

        overdueCharges.forEach(charge => {
          const dueDate = new Date(charge.scheduled_date);
          const diffDays = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
          const amt = parseFloat(charge.amount || 0);

          if (diffDays <= 0) { buckets[0] += amt; counts[0]++; }
          else if (diffDays <= 30) { buckets[1] += amt; counts[1]++; }
          else if (diffDays <= 60) { buckets[2] += amt; counts[2]++; }
          else if (diffDays <= 90) { buckets[3] += amt; counts[3]++; }
          else { buckets[4] += amt; counts[4]++; }
        });

        // If no charges tracked, estimate from plan
        if (overdueCharges.length === 0) {
          const paidAmt = parseFloat(plan.installments_paid || 0) * parseFloat(plan.installment_amount || 0);
          const remaining = Math.max(0, parseFloat(plan.total_amount || 0) - paidAmt);
          if (remaining > 0) { buckets[0] += remaining; counts[0]++; }
        }
      });

      const grandTotal = buckets.reduce((s, v) => s + v, 0);
      setTotal(grandTotal);

      setData(BUCKETS.map((name, i) => ({
        name,
        value: Math.round(buckets[i]),
        percentage: grandTotal > 0 ? parseFloat(((buckets[i] / grandTotal) * 100).toFixed(1)) : 0,
        count: counts[i],
      })).filter(d => d.value > 0));

    } catch (err) {
      console.error('AgingAnalysisChart error:', err);
      // Fallback: empty state
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <Sk />;

  if (!data.length) return (
    <div className="flex flex-col items-center justify-center h-64 text-gray-400">
      <svg className="w-10 h-10 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
      </svg>
      <p className="text-sm">No aging data yet</p>
      <p className="text-xs mt-1">Add installment plans to see aging analysis</p>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-3 px-1">
        <p className="text-xs text-gray-500">Total Outstanding: <span className="font-bold text-gray-900">KES {total.toLocaleString()}</span></p>
        <button onClick={fetchData} className="text-xs text-blue-600 hover:underline">Refresh</button>
      </div>
      <div className="w-full h-64 md:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" labelLine={false} label={renderLabel}
              outerRadius={90} dataKey="value">
              {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: '12px' }} iconType="circle" />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default AgingAnalysisChart;
