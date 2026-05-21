import React, { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { supabase } from '../../../lib/supabase';

const Sk = () => <div className="animate-pulse bg-gray-200 rounded-lg w-full h-64" />;

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 shadow-lg min-w-[160px]">
      <p className="text-sm font-bold text-gray-900 mb-2">{d?.month}</p>
      <p className="text-xs text-blue-600">Leads: {d?.leads}</p>
      <p className="text-xs text-emerald-600">Converted: {d?.conversions}</p>
      {d?.rate !== null && (
        <p className={`text-xs mt-1 font-semibold ${d.rate >= 30 ? 'text-emerald-600' : d.rate >= 20 ? 'text-amber-600' : 'text-red-500'}`}>
          Rate: {d.rate}%
        </p>
      )}
    </div>
  );
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const SalesConversionChart = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch leads grouped by month
      const { data: leads, error: leadsError } = await supabase
        .from('leads')
        .select('id, stage, created_at')
        .gte('created_at', `${year}-01-01`)
        .lte('created_at', `${year}-12-31`);

      if (leadsError) throw leadsError;

      const monthly = {};
      MONTHS.forEach((_, i) => { monthly[i] = { leads: 0, conversions: 0 }; });

      (leads || []).forEach(lead => {
        const m = new Date(lead.created_at).getMonth();
        monthly[m].leads++;
        if (['converted', 'won', 'closed', 'active'].includes(lead.stage?.toLowerCase())) {
          monthly[m].conversions++;
        }
      });

      const currentMonth = new Date().getMonth();
      const currentYear = new Date().getFullYear();

      const chartData = MONTHS.map((name, i) => {
        const isFuture = year === currentYear && i > currentMonth;
        if (isFuture) return null;
        const { leads: l, conversions: c } = monthly[i];
        return {
          month: name,
          leads: l,
          conversions: c,
          rate: l > 0 ? parseFloat(((c / l) * 100).toFixed(1)) : 0,
        };
      }).filter(Boolean);

      setData(chartData);
    } catch (err) {
      console.error('SalesConversionChart error:', err);
      // If leads table doesn't exist, show clients as proxy
      try {
        const { data: clients, error } = await supabase
          .from('clients')
          .select('id, client_status, created_at')
          .gte('created_at', `${year}-01-01`)
          .lte('created_at', `${year}-12-31`);

        if (error) throw error;

        const monthly = {};
        MONTHS.forEach((_, i) => { monthly[i] = { leads: 0, conversions: 0 }; });

        (clients || []).forEach(c => {
          const m = new Date(c.created_at).getMonth();
          monthly[m].leads++;
          if (['active', 'verified'].includes(c.client_status?.toLowerCase())) {
            monthly[m].conversions++;
          }
        });

        const currentMonth = new Date().getMonth();
        const currentYear = new Date().getFullYear();

        const chartData = MONTHS.map((name, i) => {
          const isFuture = year === currentYear && i > currentMonth;
          if (isFuture) return null;
          const { leads: l, conversions: c } = monthly[i];
          return {
            month: name,
            leads: l,
            conversions: c,
            rate: l > 0 ? parseFloat(((c / l) * 100).toFixed(1)) : 0,
          };
        }).filter(Boolean);

        setData(chartData);
      } catch {
        setData([]);
      }
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <Sk />;

  const totalLeads = data.reduce((s, r) => s + r.leads, 0);
  const totalConversions = data.reduce((s, r) => s + r.conversions, 0);
  const overallRate = totalLeads > 0 ? parseFloat(((totalConversions / totalLeads) * 100).toFixed(1)) : 0;

  if (!data.length || totalLeads === 0) return (
    <div className="flex flex-col items-center justify-center h-64 text-gray-400">
      <svg className="w-10 h-10 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
      <p className="text-sm">No leads/client data for {year}</p>
      <p className="text-xs mt-1">Sales data will appear here once available</p>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-3 px-1">
        <p className="text-xs text-gray-500">
          {year}: <span className="font-bold text-gray-900">{totalLeads} leads</span>
          <span className="mx-1">·</span>
          <span className="font-bold text-emerald-600">{totalConversions} converted</span>
          <span className="mx-1">·</span>
          <span className={`font-bold ${overallRate >= 30 ? 'text-emerald-600' : overallRate >= 20 ? 'text-amber-600' : 'text-red-500'}`}>
            {overallRate}% rate
          </span>
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
          <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" stroke="#9ca3af" style={{ fontSize: '12px' }} />
            <YAxis stroke="#9ca3af" style={{ fontSize: '11px' }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: '12px' }} iconType="circle" />
            {overallRate > 0 && (
              <ReferenceLine
                y={totalLeads / data.filter(d => d.leads > 0).length || 0}
                stroke="#a855f7" strokeDasharray="4 4"
                label={{ value: 'Avg', position: 'right', fontSize: 10, fill: '#a855f7' }}
                yAxisId={0}
              />
            )}
            <Line type="monotone" dataKey="leads" stroke="#3b82f6" strokeWidth={2}
              dot={{ fill: '#3b82f6', r: 4 }} activeDot={{ r: 6 }} name="Leads" />
            <Line type="monotone" dataKey="conversions" stroke="#10b981" strokeWidth={2}
              dot={{ fill: '#10b981', r: 4 }} activeDot={{ r: 6 }} name="Converted" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default SalesConversionChart;
