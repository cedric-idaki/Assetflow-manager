import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Button from '../../../components/ui/Button';
import { supabase } from '../../../lib/supabase';

const Toast = ({ message, type, onClose }) => (
  <div className={`fixed bottom-6 right-6 z-[300] flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium
    ${type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
    <Icon name={type === 'success' ? 'CheckCircle' : 'AlertCircle'} size={16} color="white" />
    {message}
    <button onClick={onClose} className="ml-2 opacity-70 hover:opacity-100">
      <Icon name="X" size={14} color="white" />
    </button>
  </div>
);

const PenaltyCalculationPanel = () => {
  const [overdueClients, setOverdueClients] = useState([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [penaltyType, setPenaltyType] = useState('percentage');
  const [penaltyValue, setPenaltyValue] = useState('');
  const [calculatedPenalty, setCalculatedPenalty] = useState(null);
  const [overdueAmount, setOverdueAmount] = useState(0);
  const [applying, setApplying] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Fetch real overdue clients
  useEffect(() => {
    const fetch = async () => {
      setLoadingClients(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        const { data } = await supabase
          .from('clients')
          .select('id, full_name, account_number, outstanding_balance')
          .eq('admin_id', user?.id)
          .gt('outstanding_balance', 0)
          .order('outstanding_balance', { ascending: false });
        setOverdueClients(data || []);
      } catch {
        // silently fail — panel still works without real clients
      } finally {
        setLoadingClients(false);
      }
    };
    fetch();
  }, []);

  const accountOptions = overdueClients.map(c => ({
    value: c.id,
    label: `${c.full_name} (${c.account_number}) — KES ${parseFloat(c.outstanding_balance || 0).toLocaleString()}`,
  }));

  const penaltyTypeOptions = [
    { value: 'percentage', label: 'Percentage of Outstanding Balance' },
    { value: 'fixed',      label: 'Fixed Amount' },
    { value: 'daily',      label: 'Daily Rate × Days Overdue' },
  ];

  const selectedClient = overdueClients.find(c => c.id === selectedAccountId);

  const handleAccountChange = (id) => {
    setSelectedAccountId(id);
    const client = overdueClients.find(c => c.id === id);
    setOverdueAmount(parseFloat(client?.outstanding_balance || 0));
    setCalculatedPenalty(null);
    setPenaltyValue('');
  };

  const handleCalculate = () => {
    const val = parseFloat(penaltyValue);
    if (isNaN(val) || val <= 0) return;
    let penalty = 0;
    if (penaltyType === 'percentage') {
      penalty = (overdueAmount * val) / 100;
    } else if (penaltyType === 'fixed') {
      penalty = val;
    } else if (penaltyType === 'daily') {
      // Estimate days overdue from oldest unpaid payment — default 30 days if unknown
      penalty = val * 30;
    }
    setCalculatedPenalty(penalty);
  };

  const handleApplyPenalty = async () => {
    if (!selectedClient || calculatedPenalty === null) return;
    setApplying(true);
    try {
      // Insert a pending maker-checker request for the penalty
      const { error } = await supabase.from('maker_checker_queue').insert({
        action_type: 'apply_penalty',
        record_id: selectedClient.id,
        table_name: 'clients',
        description: `Penalty of KES ${calculatedPenalty.toFixed(2)} on ${selectedClient.full_name} — ${penaltyTypeOptions.find(t => t.value === penaltyType)?.label}`,
        new_values: {
          penalty_amount: calculatedPenalty,
          penalty_type: penaltyType,
          penalty_value: parseFloat(penaltyValue),
          outstanding_balance: overdueAmount,
          client_id: selectedClient.id,
          client_name: selectedClient.full_name,
        },
        status: 'pending',
        severity: 'medium',
        created_at: new Date().toISOString(),
      });

      if (error) throw error;

      showToast(`Penalty of KES ${calculatedPenalty.toFixed(2)} submitted for maker-checker approval`);
      setSelectedAccountId('');
      setPenaltyValue('');
      setCalculatedPenalty(null);
      setOverdueAmount(0);
    } catch (err) {
      showToast(err.message || 'Failed to submit penalty for approval', 'error');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <div className="flex items-center space-x-3 mb-6">
        <div className="flex items-center justify-center w-10 h-10 md:w-12 md:h-12 rounded-lg bg-warning bg-opacity-10">
          <Icon name="AlertTriangle" size={20} color="var(--color-warning)" />
        </div>
        <h3 className="text-base md:text-xl font-heading font-semibold text-foreground">
          Penalty Calculation
        </h3>
      </div>

      <div className="space-y-4 md:space-y-5">
        {loadingClients ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
            </svg>
            Loading overdue accounts...
          </div>
        ) : overdueClients.length === 0 ? (
          <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 text-sm">
            <Icon name="CheckCircle" size={15} color="currentColor" />
            No overdue accounts found. All clients are up to date.
          </div>
        ) : (
          <Select
            label="Select Overdue Account"
            options={accountOptions}
            value={selectedAccountId}
            onChange={handleAccountChange}
            required
            searchable
            placeholder="Search overdue accounts…"
          />
        )}

        {selectedAccountId && (
          <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg text-sm">
            <p className="font-semibold text-orange-800">{selectedClient?.full_name}</p>
            <p className="text-orange-700 mt-0.5">
              Outstanding: <span className="font-bold">KES {overdueAmount.toLocaleString()}</span>
            </p>
          </div>
        )}

        <Select
          label="Penalty Type"
          options={penaltyTypeOptions}
          value={penaltyType}
          onChange={(v) => { setPenaltyType(v); setCalculatedPenalty(null); }}
          required
        />

        <Input
          label={
            penaltyType === 'percentage' ? 'Penalty Percentage (%)'
            : penaltyType === 'fixed'    ? 'Fixed Penalty Amount (KES)'
            :                              'Daily Rate (KES/day)'
          }
          type="number"
          min="0"
          step="0.01"
          value={penaltyValue}
          onChange={(e) => { setPenaltyValue(e.target.value); setCalculatedPenalty(null); }}
          required
          placeholder="0.00"
          description={
            penaltyType === 'percentage' ? 'Enter % of outstanding balance'
            : penaltyType === 'fixed'    ? 'Enter fixed penalty amount in KES'
            :                              'Applied over estimated 30 days overdue'
          }
        />

        <Button
          variant="outline"
          iconName="Calculator"
          iconPosition="left"
          fullWidth
          onClick={handleCalculate}
          disabled={!selectedAccountId || !penaltyValue || parseFloat(penaltyValue) <= 0}
        >
          Calculate Penalty
        </Button>

        {calculatedPenalty !== null && (
          <div className="p-4 rounded-lg bg-warning bg-opacity-10 border-2 border-warning space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">Calculated Penalty</span>
              <span className="text-2xl font-bold text-warning">
                KES {calculatedPenalty.toFixed(2)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              This penalty will be submitted to the Maker-Checker queue and requires dual approval before being applied.
            </p>
            <Button
              variant="warning"
              iconName="Send"
              iconPosition="left"
              fullWidth
              onClick={handleApplyPenalty}
              disabled={applying}
            >
              {applying ? 'Submitting for Approval…' : 'Submit for Approval'}
            </Button>
          </div>
        )}

        <div className="p-4 rounded-xl bg-muted border border-border">
          <div className="flex items-start space-x-3">
            <Icon name="Info" size={18} color="var(--color-primary)" className="flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground mb-1">Penalty Application Process</p>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>• Penalties calculated on outstanding balance</li>
                <li>• All penalties require dual approval (Maker-Checker)</li>
                <li>• Request appears in System Administration → Approval Queue</li>
                <li>• Client is notified once penalty is approved and applied</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
};

export default PenaltyCalculationPanel;
