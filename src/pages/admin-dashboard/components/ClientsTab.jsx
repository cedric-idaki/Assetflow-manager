import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import { formatKEPhone } from '../../../utils/phoneUtils';
import { useAdminDashboardContext } from '../../../contexts/AdminDashboardContext';
import {
  channelMeta, sourceMeta, isAwaitingActivation, signupLink,
} from '../../../config/clientAcquisition';

// Badge tones, keyed off the vocabulary's own `tone` so the client list, the
// agent portal and the reports all colour a channel the same way.
const TONE = {
  blue:    'bg-blue-100 text-blue-700',
  violet:  'bg-violet-100 text-violet-700',
  emerald: 'bg-emerald-100 text-emerald-700',
  slate:   'bg-slate-100 text-slate-600',
};

/**
 * How this client came to the company.
 *
 * Two facts, not one, and the second only when it adds something: a client can
 * be 'direct' because they walked into the office (staff typed them in) or
 * because they found the registration link and signed themselves up. Only the
 * second needs anybody to do anything about it.
 */
const AcquisitionCell = ({ client }) => {
  const channel = channelMeta(client.acquisition_channel);
  const source  = sourceMeta(client.registration_source);
  const selfRegistered = client.registration_source === 'self_service';

  return (
    <div className="flex flex-col gap-1 items-start">
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${TONE[channel.tone] || TONE.slate}`}>
        <Icon name={channel.icon} size={10} color="currentColor" />
        {channel.label}
      </span>
      {selfRegistered && (
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
          <Icon name={source.icon} size={9} color="currentColor" />
          {source.label}
        </span>
      )}
    </div>
  );
};

const InviteClientModal = ({ onClose, onInvite, agents }) => {
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', agentId: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = async () => {
    if (!form.fullName || !form.email) {
      setError('Full name and email are required.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await onInvite(form);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to invite client.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center">
              <Icon name="UserPlus" size={18} color="#1A56DB" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">Invite Client</h3>
              <p className="text-xs text-muted-foreground">Send an invitation link to a new client</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <Icon name="X" size={18} color="var(--color-muted-foreground)" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              <Icon name="AlertCircle" size={15} color="currentColor" />
              {error}
            </div>
          )}
          {[
            { label: 'Full Name *', key: 'fullName', type: 'text', placeholder: 'John Doe' },
            { label: 'Email Address *', key: 'email', type: 'email', placeholder: 'john@email.com' },
            { label: 'Phone Number', key: 'phone', type: 'tel', placeholder: '+254 7XX XXX XXX' },
          ].map(field => (
            <div key={field.key}>
              <label className="block text-xs font-medium text-muted-foreground mb-1">{field.label}</label>
              <input
                type={field.type}
                value={form[field.key]}
                onChange={e => set(field.key, field.key === 'phone' ? formatKEPhone(e.target.value) : e.target.value)}
                placeholder={field.placeholder}
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground"
              />
            </div>
          ))}

          {agents.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Assign to Sales Agent (optional)
              </label>
              <select
                value={form.agentId}
                onChange={e => set('agentId', e.target.value)}
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
              >
                <option value="">No agent assigned</option>
                {agents.map(a => (
                  <option key={a.id} value={a.id}>{a.full_name} — {a.agent_code}</option>
                ))}
              </select>
            </div>
          )}

          <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
            <div className="flex items-start gap-2">
              <Icon name="Info" size={14} color="#1A56DB" />
              <p className="text-xs text-blue-700">
                An invitation link will be created for this client. They will be able to access the system under your company's assets only.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
          >
            {loading ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                </svg>
                Sending...
              </>
            ) : (
              <>
                <Icon name="Send" size={15} color="currentColor" />
                Send Invitation
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Direct client registration -- the company's own front door.
 *
 * A client who has no sales agent still has to land in SOMEBODY's client book,
 * because every clients row is tenant-scoped by admin_id. This code is what
 * says whose. Hand it out on a card, a poster or a WhatsApp message, or send
 * the link and skip the typing.
 *
 * Off by default, and off for every company that existed before this shipped:
 * opening a door into your client book is a decision, not a default.
 */
const SelfSignupPanel = ({ companyProfile, onSetSelfSignup, onRotateSignupCode }) => {
  const [busy, setBusy]     = useState('');
  const [error, setError]   = useState('');
  const [copied, setCopied] = useState('');
  const [confirmRotate, setConfirmRotate] = useState(false);

  const code    = companyProfile?.signup_code || '';
  const enabled = Boolean(companyProfile?.self_signup_enabled);
  const link    = code ? signupLink(code) : '';

  // No company_profiles row yet -- a half-finished registration. Nothing to
  // switch on, and a broken panel is worse than no panel.
  if (!companyProfile) return null;

  const copy = (label, value) => {
    navigator.clipboard?.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(''), 1600);
  };

  const run = async (label, fn) => {
    setBusy(label);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err?.message || 'That did not work. Please try again.');
    } finally {
      setBusy('');
      setConfirmRotate(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl px-5 py-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon name="Globe" size={15} color="var(--color-muted-foreground)" />
            <h3 className="text-sm font-semibold text-foreground">Direct client registration</h3>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {enabled
              ? 'Clients can register themselves with this code. New accounts arrive pending your activation.'
              : 'Switched off. Clients can only be added by you or by a sales agent.'}
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Allow clients to register themselves"
          disabled={busy === 'toggle'}
          onClick={() => run('toggle', () => onSetSelfSignup(!enabled))}
          className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-60 ${
            enabled ? 'bg-emerald-500' : 'bg-slate-300'
          }`}
        >
          <span
            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              enabled ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
          <Icon name="AlertCircle" size={14} color="currentColor" />
          {error}
        </div>
      )}

      {enabled && (
        <div className="space-y-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/60 border border-border flex-shrink-0">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Code</span>
              <span className="font-mono text-sm font-bold tracking-widest text-foreground">{code || '--'}</span>
            </div>

            <button
              onClick={() => copy('code', code)}
              disabled={!code}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all disabled:opacity-50"
            >
              <Icon name={copied === 'code' ? 'Check' : 'Copy'} size={13} color="currentColor" />
              {copied === 'code' ? 'Copied' : 'Copy code'}
            </button>

            <button
              onClick={() => copy('link', link)}
              disabled={!link}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all disabled:opacity-50"
            >
              <Icon name={copied === 'link' ? 'Check' : 'Link'} size={13} color="currentColor" />
              {copied === 'link' ? 'Copied' : 'Copy link'}
            </button>

            {/* Rotating is the answer to a code that has been forwarded somewhere
                it should not have been. Switching the feature off also stops
                that, but it stops the genuine registrations too. */}
            {confirmRotate ? (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => run('rotate', onRotateSignupCode)}
                  disabled={busy === 'rotate'}
                  className="px-3 py-2 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-700 transition-all disabled:opacity-60"
                >
                  {busy === 'rotate' ? 'Replacing...' : 'Yes, replace it'}
                </button>
                <button
                  onClick={() => setConfirmRotate(false)}
                  className="px-3 py-2 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmRotate(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
              >
                <Icon name="RefreshCw" size={13} color="currentColor" />
                New code
              </button>
            )}
          </div>

          {confirmRotate && (
            <p className="text-xs text-red-700">
              Anyone still holding the old code will not be able to register. Links and cards
              already printed with it stop working.
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            A client referred by one of your agents enters that agent&apos;s code on the same
            form -- that is what records the account as agent-acquired rather than direct.
          </p>
        </div>
      )}
    </div>
  );
};

const ClientsTab = ({ clients, agents, onInvite, onExport, companyProfile, onSetSelfSignup, onRotateSignupCode }) => {
  const { modals, openModal, closeModal } = useAdminDashboardContext();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  // 'awaiting' is not a client_status -- it is the question staff actually
  // have: who signed themselves up and has nobody looked at yet. A plain
  // 'pending' filter cannot answer it, because an admin-invited client sits at
  // 'pending' too until they are activated.
  const awaitingCount = clients.filter(isAwaitingActivation).length;

  const filtered = clients.filter(c => {
    if (filter === 'awaiting') {
      if (!isAwaitingActivation(c)) return false;
    } else if (filter !== 'all' && c.client_status !== filter) {
      return false;
    }
    if (search) {
      const q = search.toLowerCase();
      return (
        (c.full_name || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.account_number || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card border border-border rounded-xl px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Clients</h2>
          <p className="text-xs text-muted-foreground">
            {clients.length} total · {clients.filter(c => c.client_status === 'active').length} active
            {awaitingCount > 0 && ` · ${awaitingCount} awaiting activation`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onExport(clients.map(c => ({
              name: c.full_name, email: c.email, phone: c.phone,
              account: c.account_number, status: c.client_status,
              kyc: c.kyc_status, balance: c.outstanding_balance,
              acquired_via: channelMeta(c.acquisition_channel).label,
              registered_by: sourceMeta(c.registration_source).label,
            })), 'clients')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            <Icon name="Download" size={13} color="currentColor" />
            Export
          </button>
          <button
            onClick={() => openModal('inviteClient')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all"
            style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
          >
            <Icon name="UserPlus" size={13} color="currentColor" />
            Invite Client
          </button>
        </div>
      </div>

      <SelfSignupPanel
        companyProfile={companyProfile}
        onSetSelfSignup={onSetSelfSignup}
        onRotateSignupCode={onRotateSignupCode}
      />

      {/* Search and Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Icon name="Search" size={14} color="var(--color-muted-foreground)" className="absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, email or account..."
            className="w-full pl-8 pr-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex gap-1">
          {['all', 'active', 'inactive', 'pending', 'awaiting'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all whitespace-nowrap ${
                filter === f
                  ? 'bg-primary text-white'
                  : 'bg-card border border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {f === 'awaiting' ? `Self-registered${awaitingCount ? ` (${awaitingCount})` : ''}` : f}
            </button>
          ))}
        </div>
      </div>

      {/* Clients Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Icon name="Users" size={32} color="currentColor" />
            <p className="text-sm mt-2">
              {filter === 'awaiting' ? 'Nobody is waiting for activation' : 'No clients found'}
            </p>
            <button
              onClick={() => openModal('inviteClient')}
              className="mt-3 px-4 py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
            >
              Invite First Client
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50">
                  {['Client', 'Account', 'Contact', 'Acquired', 'KYC Status', 'Balance', 'Status'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(client => (
                  <tr key={client.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm flex-shrink-0">
                          {(client.full_name || 'C')[0].toUpperCase()}
                        </div>
                        <p className="font-medium text-foreground">{client.full_name}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded text-foreground">
                        {client.account_number}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-foreground">{client.email || '—'}</p>
                      <p className="text-xs text-muted-foreground">{client.phone || '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <AcquisitionCell client={client} />
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${
                        client.kyc_status === 'verified' ? 'bg-emerald-100 text-emerald-700' :
                        client.kyc_status === 'under_review' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {(client.kyc_status || 'unverified').replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-orange-600">
                      KES {parseFloat(client.outstanding_balance || 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${
                        client.client_status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                        client.client_status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {client.client_status || 'pending'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modals.inviteClient && (
        <InviteClientModal
          onClose={() => closeModal('inviteClient')}
          onInvite={onInvite}
          agents={agents}
        />
      )}
    </div>
  );
};

export default ClientsTab;