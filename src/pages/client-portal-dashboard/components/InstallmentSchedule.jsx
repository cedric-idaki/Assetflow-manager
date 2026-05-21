import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';

const InstallmentSchedule = ({ installmentCharges, installmentPlans, assets, clientInfo }) => {
  const [selectedPlanId, setSelectedPlanId] = useState('all');

  const formatCurrency = (val) =>
    new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', minimumFractionDigits: 0 })?.format(val || 0);

  const formatDate = (d) =>
    d ? new Date(d)?.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  const daysUntil = (d) => {
    if (!d) return null;
    return Math.ceil((new Date(d) - new Date()) / (1000 * 60 * 60 * 24));
  };

  const getStatusConfig = (charge) => {
    const status = charge?.charge_status;
    const days = daysUntil(charge?.scheduled_date);

    if (status === 'succeeded') return { cls: 'border-emerald-200 dark:border-emerald-800', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', label: 'Paid', icon: 'CheckCircle' };
    if (status === 'failed') return { cls: 'border-red-200 dark:border-red-800', badge: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', label: 'Failed', icon: 'XCircle' };
    if (status === 'cancelled') return { cls: 'border-muted', badge: 'bg-muted text-muted-foreground', label: 'Cancelled', icon: 'MinusCircle' };
    if (status === 'processing') return { cls: 'border-blue-200 dark:border-blue-800', badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', label: 'Processing', icon: 'Loader' };

    // Scheduled
    if (days === null) return { cls: 'border-border', badge: 'bg-muted text-muted-foreground', label: 'Scheduled', icon: 'Clock' };
    if (days < 0) return { cls: 'border-red-300 dark:border-red-700', badge: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', label: `${Math.abs(days)}d overdue`, icon: 'AlertCircle' };
    if (days === 0) return { cls: 'border-red-300 dark:border-red-700', badge: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', label: 'Due today', icon: 'AlertCircle' };
    if (days <= 7) return { cls: 'border-amber-200 dark:border-amber-800', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', label: `${days}d left`, icon: 'Clock' };
    return { cls: 'border-border', badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', label: `${days}d left`, icon: 'Calendar' };
  };

  const filteredCharges = selectedPlanId === 'all'
    ? installmentCharges
    : installmentCharges?.filter(c => c?.plan_id === selectedPlanId);

  const groupedByPlan = filteredCharges?.reduce((acc, charge) => {
    const planId = charge?.plan_id;
    if (!acc?.[planId]) acc[planId] = [];
    acc?.[planId]?.push(charge);
    return acc;
  }, {});

  return (
    <div>
      {/* Plan filter */}
      {installmentPlans?.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-5">
          <button
            onClick={() => setSelectedPlanId('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              selectedPlanId === 'all' ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:bg-border'
            }`}
          >
            All Plans
          </button>
          {installmentPlans?.map(plan => (
            <button
              key={plan?.id}
              onClick={() => setSelectedPlanId(plan?.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                selectedPlanId === plan?.id ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:bg-border'
              }`}
            >
              {plan?.asset?.description || plan?.plan_name}
            </button>
          ))}
        </div>
      )}
      {filteredCharges?.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
            <Icon name="CalendarCheck" size={22} color="var(--color-muted-foreground)" />
          </div>
          <p className="text-sm font-medium text-foreground">No installment schedule found</p>
          <p className="text-xs text-muted-foreground mt-1">Installment charges will appear here once a plan is created</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedByPlan || {})?.map(([planId, charges]) => {
            const plan = installmentPlans?.find(p => p?.id === planId);
            const paidCount = charges?.filter(c => c?.charge_status === 'succeeded')?.length;
            const totalCount = charges?.length;

            return (
              <div key={planId}>
                {/* Plan header */}
                {plan && (
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-border">
                    <div>
                      <h4 className="text-sm font-semibold text-foreground">{plan?.asset?.description || plan?.plan_name}</h4>
                      <p className="text-xs text-muted-foreground">
                        {plan?.asset?.asset_code} · {paidCount}/{totalCount} installments paid
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Monthly</p>
                      <p className="text-sm font-bold text-foreground">
                        {new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', minimumFractionDigits: 0 })?.format(plan?.installment_amount || 0)}
                      </p>
                    </div>
                  </div>
                )}
                {/* Charges list */}
                <div className="space-y-2">
                  {charges?.map((charge, idx) => {
                    const cfg = getStatusConfig(charge);
                    const days = daysUntil(charge?.scheduled_date);

                    return (
                      <div key={charge?.id || idx} className={`bg-card border rounded-xl p-4 ${cfg?.cls}`}>
                        <div className="flex items-center gap-3">
                          {/* Installment number */}
                          <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-muted flex items-center justify-center">
                            <span className="text-xs font-bold text-foreground">#{charge?.installment_number}</span>
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold text-foreground">
                                {new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', minimumFractionDigits: 0 })?.format(charge?.amount || 0)}
                              </span>
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg?.badge}`}>{cfg?.label}</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Due: {formatDate(charge?.scheduled_date)}
                            </p>
                          </div>

                          <Icon name={cfg?.icon} size={16} className={`flex-shrink-0 ${
                            charge?.charge_status === 'succeeded' ? 'text-emerald-500' :
                            charge?.charge_status === 'failed' ? 'text-red-500' :
                            days !== null && days < 0 ? 'text-red-500' :
                            days !== null && days <= 7 ? 'text-amber-500' : 'text-muted-foreground'
                          }`} />
                        </div>
                        {/* Progress bar for upcoming */}
                        {charge?.charge_status === 'scheduled' && days !== null && days >= 0 && days <= 30 && (
                          <div className="mt-2">
                            <div className="h-1 bg-muted rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  days <= 3 ? 'bg-red-500' : days <= 7 ? 'bg-amber-500' : 'bg-primary'
                                }`}
                                style={{ width: `${Math.max(5, (days / 30) * 100)}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default InstallmentSchedule;
