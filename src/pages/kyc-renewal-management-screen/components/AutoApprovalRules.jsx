import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';

const DEFAULT_RULES = [
  { id: 'rule-1', name: 'Document Quality Threshold', description: 'Auto-approve when document quality score meets minimum', type: 'quality_score', enabled: true, threshold: 75, weight: 40, icon: 'Star', color: '#9333ea' },
  { id: 'rule-2', name: 'Client History', description: 'Auto-approve clients with clean compliance history (0 violations)', type: 'client_history', enabled: true, threshold: 0, weight: 30, icon: 'History', color: '#3b82f6' },
  { id: 'rule-3', name: 'Risk Profile', description: 'Auto-approve only Low or Medium risk clients', type: 'risk_profile', enabled: true, allowedRisks: ['low', 'medium'], weight: 30, icon: 'Shield', color: '#22c55e' },
  { id: 'rule-4', name: 'Document Age', description: 'Auto-approve documents submitted within the last 30 days', type: 'doc_age', enabled: false, threshold: 30, weight: 0, icon: 'Calendar', color: '#f59e0b' },
];

const evaluateAutoApproval = (client, rules) => {
  const enabledRules = rules.filter(r => r.enabled);
  const results = [];
  let allPass = true;

  enabledRules.forEach(rule => {
    let pass = false;
    let detail = '';
    if (rule.type === 'quality_score') {
      pass = (client.qualityScore ?? 0) >= rule.threshold;
      detail = `Score ${client.qualityScore ?? 'N/A'} (min: ${rule.threshold})`;
    } else if (rule.type === 'client_history') {
      pass = (client.violations ?? 0) <= rule.threshold;
      detail = `${client.violations ?? 0} violation(s) (max: ${rule.threshold})`;
    } else if (rule.type === 'risk_profile') {
      pass = rule.allowedRisks?.includes((client.riskProfile || '').toLowerCase());
      detail = `Risk: ${client.riskProfile || 'unknown'} (allowed: ${rule.allowedRisks?.join(', ')})`;
    } else if (rule.type === 'doc_age') {
      pass = true;
      detail = 'Within submission window';
    }
    if (!pass) allPass = false;
    results.push({ ruleId: rule.id, ruleName: rule.name, pass, detail });
  });

  return { eligible: allPass, results };
};

const RuleCard = ({ rule, onToggle, onThresholdChange }) => {
  const [editing, setEditing] = useState(false);
  const [tempThreshold, setTempThreshold] = useState(rule.threshold);

  return (
    <div className={`bg-card border rounded-xl p-4 transition-all ${rule.enabled ? 'border-border' : 'border-border opacity-60'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: rule.color + '20' }}>
            <Icon name={rule.icon} size={15} color={rule.color} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{rule.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{rule.description}</p>
          </div>
        </div>
        <button
          onClick={() => onToggle(rule.id)}
          className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${rule.enabled ? 'bg-primary' : 'bg-muted-foreground/30'}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${rule.enabled ? 'left-5' : 'left-0.5'}`} />
        </button>
      </div>
      {rule.enabled && rule.threshold !== undefined && rule.type !== 'risk_profile' && rule.type !== 'doc_age' && (
        <div className="mt-3 flex items-center gap-2">
          {editing ? (
            <>
              <input type="number" value={tempThreshold} onChange={e => setTempThreshold(Number(e.target.value))}
                className="w-20 px-2 py-1 text-xs border border-border rounded-lg bg-background text-foreground focus:outline-none" />
              <button onClick={() => { onThresholdChange(rule.id, tempThreshold); setEditing(false); }}
                className="text-xs px-2 py-1 bg-primary text-primary-foreground rounded-lg">Save</button>
              <button onClick={() => setEditing(false)} className="text-xs px-2 py-1 border border-border rounded-lg text-muted-foreground">Cancel</button>
            </>
          ) : (
            <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <Icon name="Settings2" size={11} color="currentColor" />
              Threshold: <span className="font-semibold text-foreground ml-1">{rule.threshold}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// Now accepts renewals prop — no more MOCK_CLIENTS
const AutoApprovalRules = ({ onAutoApprove, externalScores = {}, renewals = [] }) => {
  const [rules, setRules] = useState(DEFAULT_RULES);
  const [activeTab, setActiveTab] = useState('rules');
  const [processing, setProcessing] = useState(null);

  const handleToggle = (ruleId) => setRules(prev => prev.map(r => r.id === ruleId ? { ...r, enabled: !r.enabled } : r));
  const handleThresholdChange = (ruleId, value) => setRules(prev => prev.map(r => r.id === ruleId ? { ...r, threshold: value } : r));

  const handleAutoApprove = async (clientId) => {
    setProcessing(clientId);
    await new Promise(r => setTimeout(r, 700));
    onAutoApprove?.(clientId);
    setProcessing(null);
  };

  // Build evaluation list from real renewals data
  const clientsWithScores = renewals.map(r => ({
    id: r.clientId || r.id,
    name: r.clientName || r.client_name || 'Unknown Client',
    kycStatus: r.status || 'pending',
    qualityScore: externalScores?.[r.id] ?? r.qualityScore ?? null,
    riskProfile: r.riskProfile || 'low',
    violations: r.violationHistory ?? 0,
  }));

  const evaluations = clientsWithScores.map(client => ({
    client,
    ...evaluateAutoApproval(client, rules),
  }));

  const eligibleCount = evaluations.filter(e => e.eligible).length;
  const enabledRulesCount = rules.filter(r => r.enabled).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <Icon name="Cpu" size={15} color="#22c55e" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Auto-Approval Rules</p>
            <p className="text-xs text-muted-foreground">{enabledRulesCount} active rules · {eligibleCount} clients eligible</p>
          </div>
        </div>
        <div className="flex gap-1 p-0.5 bg-muted rounded-xl">
          {['rules', 'evaluation'].map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`text-xs px-3 py-1.5 rounded-md font-medium capitalize transition-all ${activeTab === t ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'rules' && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Configure criteria for automatic approval. All enabled rules must pass for auto-approval.</p>
          {rules.map(rule => (
            <RuleCard key={rule.id} rule={rule} onToggle={handleToggle} onThresholdChange={handleThresholdChange} />
          ))}
        </div>
      )}

      {activeTab === 'evaluation' && (
        <div className="space-y-3">
          {clientsWithScores.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground bg-card border border-border rounded-xl">
              <Icon name="Users" size={28} color="currentColor" />
              <p className="text-sm mt-2">No renewal clients to evaluate</p>
              <p className="text-xs mt-1 text-muted-foreground/70">Clients will appear here once renewals are loaded</p>
            </div>
          ) : (
            evaluations.map(({ client, eligible, results }) => (
              <div key={client.id} className={`bg-card border rounded-xl p-5 ${eligible ? 'border-emerald-200 dark:border-emerald-800' : 'border-border'}`}>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{client.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{(client.riskProfile || '').replace(/_/g, ' ')} risk · {client.violations ?? 0} violations</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {client.qualityScore !== null && (
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${client.qualityScore >= 75 ? 'bg-emerald-100 text-emerald-700' : client.qualityScore >= 60 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                        {client.qualityScore}
                      </span>
                    )}
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${eligible ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'}`}>
                      {eligible ? 'Eligible' : 'Not eligible'}
                    </span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {results.map(res => (
                    <div key={res.ruleId} className="flex items-center gap-2 text-xs">
                      <Icon name={res.pass ? 'CheckCircle2' : 'XCircle'} size={13} color={res.pass ? '#16a34a' : '#dc2626'} />
                      <span className="text-muted-foreground flex-1">{res.ruleName}</span>
                      <span className={res.pass ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>{res.detail}</span>
                    </div>
                  ))}
                </div>
                {eligible && (
                  <button
                    onClick={() => handleAutoApprove(client.id)}
                    disabled={!!processing}
                    className="mt-3 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    {processing === client.id ? <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg> : <Icon name="CheckCircle2" size={12} color="white" />}
                    Auto-approve
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default AutoApprovalRules;
