import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Select from '../../../components/ui/Select';
import { supabase } from '../../../lib/supabase';

const fmt = (n) => `KES ${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const OverdueAccountsSection = () => {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState('');

  const categories = [
    { value: 'all', label: 'All Overdue' },
    { value: '30',  label: '1–30 Days'  },
    { value: '60',  label: '31–60 Days' },
    { value: '90',  label: '60+ Days'   },
  ];

  const fetchOverdue = useCallback(async () => {
    setLoading(true);
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Get all scheduled charges whose date has passed
      const { data: charges, error } = await supabase
        .from('installment_charges')
        .select(`
          id, amount, scheduled_date, charge_status, client_id,
          plan:installment_plans(
            plan_name,
            client:clients(id, full_name, account_number, phone, email)
          )
        `)
        .eq('charge_status', 'scheduled')
        .lt('scheduled_date', today.toISOString().split('T')[0])
        .order('scheduled_date', { ascending: true });

      if (error) throw error;

      // Group by client
      const clientMap = {};
      (charges || []).forEach(c => {
        const client = c.plan?.client;
        if (!client) return;
        const key = client.id;
        const daysOverdue = Math.floor((today - new Date(c.scheduled_date)) / 86400000);
        const category = daysOverdue > 60 ? '90' : daysOverdue > 30 ? '60' : '30';

        if (!clientMap[key]) {
          clientMap[key] = {
            id: key,
            clientName: client.full_name || 'Unknown',
            accountNumber: client.account_number || '—',
            phone: client.phone || '—',
            email: client.email || '—',
            overdueAmount: 0,
            chargeCount: 0,
            maxDaysOverdue: 0,
            earliestDue: c.scheduled_date,
            category,
          };
        }
        clientMap[key].overdueAmount += parseFloat(c.amount || 0);
        clientMap[key].chargeCount++;
        clientMap[key].maxDaysOverdue = Math.max(clientMap[key].maxDaysOverdue, daysOverdue);
        // Re-derive category from worst charge
        clientMap[key].category = clientMap[key].maxDaysOverdue > 60 ? '90'
          : clientMap[key].maxDaysOverdue > 30 ? '60' : '30';
      });

      setAccounts(Object.values(clientMap).sort((a, b) => b.overdueAmount - a.overdueAmount));
    } catch (err) {
      console.error('Overdue fetch error:', err);
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchOverdue(); }, [fetchOverdue]);

  const filtered = selectedCategory === 'all'
    ? accounts
    : accounts.filter(a => a.category === selectedCategory);

  const getCategoryStyle = (cat) => {
    if (cat === '90') return 'text-red-700 bg-red-100 border-red-300';
    if (cat === '60') return 'text-orange-700 bg-orange-100 border-orange-300';
    return 'text-yellow-700 bg-yellow-100 border-yellow-300';
  };

  const getCategoryLabel = (cat) => {
    if (cat === '90') return '60+ days';
    if (cat === '60') return '31–60 days';
    return '1–30 days';
  };

  const showMsg = (msg) => {
    setActionMsg(msg);
    setTimeout(() => setActionMsg(''), 3000);
  };

  const handleFollowUp = (account) => {
    if (account.phone && account.phone !== '—') {
      window.open(`tel:${account.phone}`);
    }
    showMsg(`Follow-up logged for ${account.clientName}`);
  };

  const handleSendReminder = async (account) => {
    showMsg(`Reminder queued for ${account.clientName} (${account.email})`);
  };

  return (
    <div className="bg-card rounded-xl border border-border p-5">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <h3 className="text-base font-semibold text-foreground">Overdue Accounts</h3>
          {!loading && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {accounts.length} client{accounts.length !== 1 ? 's' : ''} with overdue installments
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={fetchOverdue}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted transition-colors">
            <Icon name="RefreshCw" size={12} color="currentColor" /> Refresh
          </button>
          <div className="w-48">
            <Select options={categories} value={selectedCategory} onChange={setSelectedCategory} placeholder="Filter by aging" />
          </div>
        </div>
      </div>

      {/* Toast */}
      {actionMsg && (
        <div className="mb-4 px-4 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm flex items-center gap-2">
          <Icon name="CheckCircle" size={14} color="#059669" /> {actionMsg}
        </div>
      )}

      {/* Summary Buckets */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: '1–30 Days', cat: '30', bg: 'bg-yellow-50 border-yellow-200', text: 'text-yellow-700' },
          { label: '31–60 Days', cat: '60', bg: 'bg-orange-50 border-orange-200', text: 'text-orange-700' },
          { label: '60+ Days', cat: '90', bg: 'bg-red-50 border-red-200', text: 'text-red-700' },
        ].map(b => {
          const bucket = accounts.filter(a => a.category === b.cat);
          return (
            <button key={b.cat} onClick={() => setSelectedCategory(b.cat === selectedCategory ? 'all' : b.cat)}
              className={`p-4 rounded-xl border-2 text-left transition-all hover:shadow-sm ${b.bg} ${selectedCategory === b.cat ? 'ring-2 ring-offset-1 ring-current' : ''}`}>
              <p className={`text-xs font-medium ${b.text} mb-1`}>{b.label}</p>
              <p className={`text-2xl font-bold ${b.text}`}>{loading ? '—' : bucket.length}</p>
              <p className={`text-xs ${b.text} opacity-70 mt-0.5`}>{loading ? '...' : fmt(bucket.reduce((s, a) => s + a.overdueAmount, 0))}</p>
            </button>
          );
        })}
      </div>

      {/* Account List */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="animate-pulse bg-gray-100 rounded-xl h-20" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-14">
          <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
            <Icon name="CheckCircle2" size={28} color="#059669" />
          </div>
          <p className="text-base font-semibold text-foreground">No overdue accounts</p>
          <p className="text-sm text-muted-foreground mt-1">
            {selectedCategory === 'all' ? 'All payments are up to date!' : 'No accounts in this aging category.'}
          </p>
          {selectedCategory !== 'all' && (
            <button onClick={() => setSelectedCategory('all')} className="mt-3 text-sm text-primary hover:underline">
              Show all categories
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((account, i) => (
            <div key={account.id}
              className="p-4 rounded-xl bg-background border border-border hover:border-primary/30 transition-colors">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">

                {/* Left: Client info */}
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 flex-shrink-0 font-bold text-primary text-sm">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{account.clientName}</p>
                    <p className="text-xs text-muted-foreground">Account: {account.accountNumber}</p>
                    {account.phone !== '—' && (
                      <p className="text-xs text-muted-foreground">📞 {account.phone}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border ${getCategoryStyle(account.category)}`}>
                        {getCategoryLabel(account.category)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {account.chargeCount} missed charge{account.chargeCount !== 1 ? 's' : ''}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Earliest due: {new Date(account.earliestDue).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right: Amount + actions */}
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  <p className="text-xl font-bold text-red-600 whitespace-nowrap">{fmt(account.overdueAmount)}</p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" iconName="Phone" iconPosition="left"
                      onClick={() => handleFollowUp(account)}>
                      Follow-up
                    </Button>
                    <Button variant="outline" size="sm" iconName="Mail" iconPosition="left"
                      onClick={() => handleSendReminder(account)}>
                      Remind
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default OverdueAccountsSection;
