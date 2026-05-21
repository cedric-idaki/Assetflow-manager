import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const CollectionTrendChart = ({ data }) => {
  return (
    <div className="bg-card rounded-lg p-4 md:p-6 shadow-sm border border-border">
      <h3 className="text-lg md:text-xl font-heading font-semibold text-foreground mb-4">
        Collection Trends
      </h3>
      <div className="w-full h-64 md:h-80" aria-label="Monthly Collection Trends Bar Chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey="month" stroke="var(--color-muted-foreground)" />
            <YAxis stroke="var(--color-muted-foreground)" />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--color-card)',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
              }}
            />
            <Legend />
            <Bar dataKey="collected" fill="var(--color-success)" name="Collected" radius={[8, 8, 0, 0]} />
            <Bar dataKey="outstanding" fill="var(--color-warning)" name="Outstanding" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default CollectionTrendChart;