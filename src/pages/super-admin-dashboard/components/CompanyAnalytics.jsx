import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';

const CompanyAnalytics = ({ data, onExport }) => {
  const [selected, setSelected] = useState(null);
  const fmt = (n) => `KES ${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div>
          <h2 className="text-base font-semibold text-foreground">Company Analytics</h2>
          <p className="text-xs text-muted-foreground">Per-admin (company) transaction breakdown</p>
        </div>
        <button
          onClick={() => onExport(data, 'company_analytics')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
        >
          <Icon name="Download" size={13} color="currentColor" />
          Export
        </button>
      </div>

      {data.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
          <Icon name="Building" size={28} color="currentColor" />
          <p className="text-sm mt-2">No companies registered</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50">
                {['Company', 'Status', 'Clients', 'Revenue', 'Outstanding', 'Transactions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((co) => (
                <React.Fragment key={co.id}>
                  <tr
                    className="hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => setSelected(selected === co.id ? null : co.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm flex-shrink-0">
                          {(co.name || 'U')[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{co.name}</p>
                          <p className="text-xs text-muted-foreground">{co.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                        co.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${co.isActive ? 'bg-emerald-500' : 'bg-red-500'}`} />
                        {co.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-foreground">{co.totalClients}</span>
                      <span className="text-xs text-muted-foreground ml-1">({co.activeClients} active)</span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-emerald-600">{fmt(co.totalRevenue)}</td>
                    <td className="px-4 py-3 font-medium text-orange-600">{fmt(co.outstanding)}</td>
                    <td className="px-4 py-3 text-foreground">{co.transactionCount}</td>
                    <td className="px-4 py-3">
                      <Icon
                        name={selected === co.id ? 'ChevronUp' : 'ChevronDown'}
                        size={15}
                        color="var(--color-muted-foreground)"
                      />
                    </td>
                  </tr>
                  {selected === co.id && (
                    <tr>
                      <td colSpan={7} className="px-4 pb-4 pt-0 bg-muted/20">
                        <div className="rounded-lg border border-border p-4 mt-2 grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div>
                            <p className="text-xs text-muted-foreground">Joined</p>
                            <p className="text-sm font-medium text-foreground">
                              {co.joinedDate ? new Date(co.joinedDate).toLocaleDateString() : '—'}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Email</p>
                            <p className="text-sm font-medium text-foreground">{co.email}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Collection Rate</p>
                            <p className="text-sm font-medium text-foreground">
                              {co.totalRevenue > 0 && co.outstanding > 0
                                ? `${Math.round((co.totalRevenue / (co.totalRevenue + co.outstanding)) * 100)}%`
                                : co.totalRevenue > 0 ? '100%' : '0%'}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Total Portfolio</p>
                            <p className="text-sm font-medium text-foreground">{fmt(co.totalRevenue + co.outstanding)}</p>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default CompanyAnalytics;