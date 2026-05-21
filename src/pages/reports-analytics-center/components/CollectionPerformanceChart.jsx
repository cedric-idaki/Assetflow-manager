import React, { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { supabase } from '../../../lib/supabase';

const Sk = () => <div className="animate-pulse bg-gray-200 rounded-lg w-full h-64" />;

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 shadow-lg min-w-[160px]">
      <p className="text-sm font-bold text-gray-900 mb-2">{d?.month}</p>
      <p className="text-xs text-emerald-600">Collected: KES {(d?.collected || 0).toLocaleString()}</p>
      <p className="text-xs text-gray-400">Transactions: {d?.count}</p>
      {d?.efficiency !== null && (
        <p className={`text-xs mt-1 font-semibold ${d.efficiency >= 100 ? 'text-emerald-600' : d.efficiency >= 80 ? 'text-amber-600' : 'text-red-500'}`}>
          Efficiency: {d.efficiency}%
        </p>
      )}
    </div>
  );
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const CollectionPerformanceChart = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: payments, error } = await supabase
        .from('payments')
        .select('amount, payment_date, payment_status')
        .eq('payment_status', 'completed')
        .gte('payment_date', `${year}-01-01`)
        .lte('payment_date', `${year}-12-31`)
        .order('payment_date');

      if (error) throw error;

      // Group by month
      const monthly = {};
      MONTHS.forEach((m, i) => { monthly[i] = { collected: 0, count: 0 }; });

      (payments || []).forEach(p => {
        const m = new Date(p.payment_date).getMonth();
        monthly[m].collected += parseFloat(p.amount || 0);
        monthly[m].count++;
      });

      // Calculate avg for reference line
      const nonZero = Object.values(monthly).filter(m => m.collected > 0);
      const avg = nonZero.length ? nonZero.reduce((s, m) => s + m.collected, 0) / nonZero.length : 0;

      const currentMonth = new Date().getMonth();
      const currentYear = new Date().getFullYear();

      const chartData = MONTHS.map((name, i) => {
        const isFuture = year === currentYear && i > currentMonth;
        return {
          month: name,
          collected: isFuture ? null : Math.round(monthly[i].collected),
          count: monthly[i].count,
          efficiency: avg > 0 && !isFuture ? parseFloat(((monthly[i].collected / avg) * 100).toFixed(1)) : null,
        };
      }).filter((_, i) => !(year === currentYear && i > currentMonth));

      setData({ rows: chartData, avg: Math.round(avg) });
    } catch (err) {
      console.error('CollectionPerformanceChart error:', err);
      setData({ rows: [], avg: 0 });
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <Sk />;

  const rows = data?.rows || [];
  const totalCollected = rows.reduce((s, r) => s + (r.collected || 0), 0);

  if (!rows.length || totalCollected === 0) return (
    <div className="flex flex-col items-center justify-center h-64 text-gray-400">
      <svg className="w-10 h-10 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
      <p className="text-sm">No payment data for {year}</p>
      <p className="text-xs mt-1">Completed payments will appear here</p>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-3 px-1">
        <p className="text-xs text-gray-500">
          Total {year}: <span className="font-bold text-gray-900">KES {totalCollected.toLocaleString()}</span>
          {data.avg > 0 && <span className="ml-2 text-gray-400">· Avg/month: KES {data.avg.toLocaleString()}</span>}
        </p>
        <div className="flex items-center gap-2">
          <button onClick={() => setYear(y => y - 1)} className="text-xs text-blue-600 hover:underline">← {year - 1}</button>
          <span className="text-xs font-bold text-gray-700">{year}</span>
          {year < new Date().getFullYear() && (
            <button onClick={() => setYear(y => y + 1)} className="text-xs text-blue-600 hover:underline">{year + 1} →</button>
          )}
        </div>
      </div>
      <div className="w-full h-64 md:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" stroke="#9ca3af" style={{ fontSize: '12px' }} />
            <YAxis stroke="#9ca3af" style={{ fontSize: '11px' }}
              tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: '12px' }} iconType="circle" />
            {data.avg > 0 && (
              <ReferenceLine y={data.avg} stroke="#6366f1" strokeDasharray="4 4"
                label={{ value: 'Avg', position: 'right', fontSize: 10, fill: '#6366f1' }} />
            )}
            <Bar dataKey="collected" fill="#10b981" name="Collected (KES)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default CollectionPerformanceChart;
