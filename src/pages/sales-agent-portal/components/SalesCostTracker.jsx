import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';

const CATEGORY_ICONS = {
  transport: 'Car',
  meetings: 'Users',
  marketing: 'Megaphone',
  other: 'MoreHorizontal',
};

const CATEGORY_COLORS = {
  transport: 'text-blue-600 bg-blue-500/10',
  meetings: 'text-orange-600 bg-orange-500/10',
  marketing: 'text-amber-600 bg-amber-500/10',
  other: 'text-muted-foreground bg-muted',
};

const SalesCostTracker = ({ expenses, leads, onLogExpense, loading }) => {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ category: 'transport', amount: '', description: '', leadId: '', date: new Date()?.toISOString()?.split('T')?.[0] });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const totalExpenses = expenses?.reduce((s, e) => s + parseFloat(e?.amount || 0), 0) || 0;

  const byCategory = ['transport', 'meetings', 'marketing', 'other']?.map((cat) => ({
    category: cat,
    amount: expenses?.filter((e) => e?.category === cat)?.reduce((s, e) => s + parseFloat(e?.amount || 0), 0) || 0,
  }));

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!form?.amount || parseFloat(form?.amount) <= 0) { setFormError('Enter a valid amount'); return; }
    if (!form?.description) { setFormError('Description is required'); return; }
    setSubmitting(true);
    setFormError('');
    try {
      await onLogExpense({ ...form, leadId: form?.leadId || null });
      setForm({ category: 'transport', amount: '', description: '', leadId: '', date: new Date()?.toISOString()?.split('T')?.[0] });
      setShowForm(false);
    } catch (err) {
      setFormError(err?.message || 'Failed to log expense');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-5 animate-pulse">
        <div className="h-5 bg-muted rounded w-40 mb-4" />
        {[...Array(4)]?.map((_, i) => <div key={i} className="h-10 bg-muted rounded mb-2" />)}
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-heading font-semibold text-base text-foreground">Sales Cost Tracker</h3>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-foreground">${totalExpenses?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          <button
            onClick={() => setShowForm(!showForm)}
            className="p-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors"
            title="Log expense"
          >
            <Icon name={showForm ? 'X' : 'Plus'} size={16} color="var(--color-primary)" />
          </button>
        </div>
      </div>
      {/* Category breakdown */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        {byCategory?.map(({ category, amount }) => (
          <div key={category} className={`flex items-center gap-2 p-2.5 rounded-lg ${CATEGORY_COLORS?.[category]}`}>
            <Icon name={CATEGORY_ICONS?.[category]} size={14} />
            <div className="min-w-0">
              <p className="text-xs font-medium capitalize">{category}</p>
              <p className="text-sm font-bold">${amount?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
            </div>
          </div>
        ))}
      </div>
      {/* Recent expenses */}
      <div className="space-y-2 max-h-[180px] overflow-y-auto scrollbar-custom mb-3">
        {expenses?.slice(0, 8)?.map((exp) => (
          <div key={exp?.id} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
            <div className="flex items-center gap-2 min-w-0">
              <Icon name={CATEGORY_ICONS?.[exp?.category] || 'MoreHorizontal'} size={13} color="var(--color-muted-foreground)" />
              <span className="text-xs text-foreground truncate">{exp?.description}</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs text-muted-foreground">{new Date(exp.expense_date)?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              <span className="text-xs font-semibold text-foreground">${parseFloat(exp?.amount)?.toLocaleString()}</span>
            </div>
          </div>
        ))}
        {expenses?.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-3">No expenses logged yet</p>
        )}
      </div>
      {/* Log expense form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="border-t border-border pt-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <select
              value={form?.category}
              onChange={(e) => setForm((p) => ({ ...p, category: e?.target?.value }))}
              className="px-2 py-1.5 bg-background border border-input rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="transport">Transport</option>
              <option value="meetings">Meetings</option>
              <option value="marketing">Marketing</option>
              <option value="other">Other</option>
            </select>
            <input
              type="number"
              placeholder="Amount"
              value={form?.amount}
              onChange={(e) => setForm((p) => ({ ...p, amount: e?.target?.value }))}
              className="px-2 py-1.5 bg-background border border-input rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              min="0"
              step="0.01"
            />
          </div>
          <input
            type="text"
            placeholder="Description"
            value={form?.description}
            onChange={(e) => setForm((p) => ({ ...p, description: e?.target?.value }))}
            className="w-full px-2 py-1.5 bg-background border border-input rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={form?.leadId}
              onChange={(e) => setForm((p) => ({ ...p, leadId: e?.target?.value }))}
              className="px-2 py-1.5 bg-background border border-input rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">No linked lead</option>
              {leads?.map((l) => <option key={l?.id} value={l?.id}>{l?.full_name}</option>)}
            </select>
            <input
              type="date"
              value={form?.date}
              onChange={(e) => setForm((p) => ({ ...p, date: e?.target?.value }))}
              className="px-2 py-1.5 bg-background border border-input rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {formError && <p className="text-xs text-red-500">{formError}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-1.5 px-3 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {submitting ? 'Logging...' : 'Log Expense'}
          </button>
        </form>
      )}
    </div>
  );
};

export default SalesCostTracker;