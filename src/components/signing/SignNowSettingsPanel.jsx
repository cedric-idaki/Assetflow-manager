import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../AppIcon';
import { useToast } from '../Toast';
import { supabase } from '../../lib/supabase';
import { DOC_KINDS, defaultPanelFor, cleanPanel } from '../../utils/certificateSigning';
import {
  signnowStatus, signnowSave, signnowDisable, signnowDisconnect,
  loadSigningPolicies, saveSigningPolicy,
} from '../../utils/signnowClient';

/**
 * Connect SignNow, and decide what has to be signed before it can be issued.
 *
 * Two halves, in the order an operator does them: the account first, then the
 * rules. The rules half is deliberately usable before the account is connected
 * — a society can write down who signs a share certificate long before anyone
 * finds the SignNow credentials — but it says plainly that nothing will send
 * until the connection is live, because a requirement with no way to satisfy it
 * would stop certificates being issued at all.
 */

const inputCls =
  'w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground ' +
  'focus:outline-none focus:border-primary placeholder:text-muted-foreground';

const SignNowSettingsPanel = () => {
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    environment: 'sandbox', clientId: '', clientSecret: '', username: '', password: '',
  });

  const [policies, setPolicies] = useState({});
  const [openKind, setOpenKind] = useState(null);
  const [savingKind, setSavingKind] = useState('');
  // Some document kinds only exist inside a society — a guarantee agreement is
  // welded to sacco_loan_guarantees in the database, so offering it to a
  // company tenant would be offering a switch that can never do anything.
  // The gate is the constraint; this only stops the screen lying about it.
  const [hasSacco, setHasSacco] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, p, saccos] = await Promise.all([
        signnowStatus(),
        loadSigningPolicies(),
        // RLS already scopes this to the caller's tenant, so "any row at all"
        // is the question. head+count reads no data to answer it.
        supabase.from('saccos').select('id', { count: 'exact', head: true }),
      ]);
      setStatus(s);
      setForm((f) => ({ ...f, environment: s?.environment || 'sandbox' }));
      setPolicies(p || {});
      setHasSacco((saccos?.count || 0) > 0);
    } catch (e) {
      setError(e.message || 'Could not read the SignNow settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const result = await signnowSave(form);
      setStatus(result);
      // A save that stored the credentials but failed verification is NOT a
      // success: sending stays off, and saying "saved" would leave the operator
      // believing they had finished.
      if (result?.verified) toast.success(result.message || 'SignNow connected.');
      else setError(result?.message || 'SignNow rejected these credentials.');
      setForm((f) => ({ ...f, clientId: '', clientSecret: '', password: '' }));
    } catch (e) {
      setError(e.message || 'Could not save the connection.');
    } finally {
      setSaving(false);
    }
  };

  const doDisable = async () => {
    try {
      setStatus(await signnowDisable());
      toast.success('SignNow sending switched off.');
    } catch (e) { toast.error(e.message); }
  };

  const doDisconnect = async () => {
    try {
      const r = await signnowDisconnect();
      setStatus(r);
      toast.success(r?.message || 'Disconnected.');
    } catch (e) { toast.error(e.message); }
  };

  // ── Policies ──────────────────────────────────────────────────────────────
  const policyOf = (kind) => policies[kind] || {
    doc_kind: kind, require_signature: false, signatories: defaultPanelFor(kind),
    signing_order: 'sequential', expires_days: null, auto_release: true,
  };

  const patchPolicy = (kind, patch) =>
    setPolicies((p) => ({ ...p, [kind]: { ...policyOf(kind), ...patch } }));

  const persistPolicy = async (kind) => {
    if (savingKind) return;
    const p = policyOf(kind);
    if (p.require_signature && cleanPanel(p.signatories).length === 0) {
      toast.error('Name at least one signatory before requiring a signature.');
      return;
    }
    setSavingKind(kind);
    try {
      await saveSigningPolicy({
        docKind: kind,
        require: p.require_signature,
        signatories: p.signatories,
        signingOrder: p.signing_order,
        expiresDays: p.expires_days,
        autoRelease: p.auto_release,
      });
      toast.success('Saved.');
      setPolicies(await loadSigningPolicies());
    } catch (e) {
      toast.error(e.message || 'Could not save that rule.');
    } finally {
      setSavingKind('');
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground py-6">Loading SignNow settings…</p>;
  }

  const connected = status?.configured;
  const live = status?.isActive;

  return (
    <div className="space-y-6">
      {/* ── Connection ──────────────────────────────────────────────────── */}
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-b border-border">
          <div className="flex items-center gap-2">
            <Icon name="PenTool" size={15} color="var(--color-primary)" />
            <span className="text-sm font-bold text-foreground">SignNow account</span>
          </div>
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${
            live ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : connected ? 'bg-amber-50 text-amber-700 border-amber-200'
                : 'bg-muted/50 text-muted-foreground border-border'}`}>
            {live ? 'Connected' : connected ? 'Not sending' : 'Not connected'}
          </span>
        </div>

        <div className="p-4 space-y-4">
          {!status?.encryptionReady && (
            <Banner tone="danger" icon="ShieldAlert">
              <strong>SIGNNOW_CRED_ENC_KEY is not set on this project.</strong> Credentials cannot be
              stored securely until it is, so saving will be refused. Set it in the Supabase function
              secrets first.
            </Banner>
          )}

          {connected && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <Fact label="Account" value={status.accountEmail} />
              <Fact label="Environment" value={status.environment} />
              <Fact label="Last verified" value={status.verifiedAt ? new Date(status.verifiedAt).toLocaleString('en-GB') : 'never'} />
              <Fact label="Callbacks" value={status.webhook?.registeredAt ? `${status.webhook.events} registered` : 'none'} />
            </div>
          )}

          {connected && status.isSandbox && (
            <Banner tone="warning" icon="FlaskConical">
              This is the SignNow <strong>sandbox</strong> account. Invites sent from it are test
              invites — real signatories will not receive them. Switch to production when you go live.
            </Banner>
          )}

          {connected && !status.webhook?.registeredAt && (
            <Banner tone="warning" icon="BellOff">
              SignNow has no callback registered for this account, so completed signatures will not
              arrive on their own. Certificates can still be issued by opening a signing request and
              pressing <strong>Refresh</strong>. Saving the connection again re-registers the callbacks.
            </Banner>
          )}

          {connected && status.lastError && !live && (
            <Banner tone="danger" icon="AlertCircle">{status.lastError}</Banner>
          )}

          <div className="grid md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">Environment</span>
              <select
                className={`${inputCls} mt-1`}
                value={form.environment}
                onChange={(e) => setForm((f) => ({ ...f, environment: e.target.value }))}
              >
                <option value="sandbox">Sandbox (api-eval.signnow.com)</option>
                <option value="production">Production (api.signnow.com)</option>
              </select>
            </label>
            <Input
              label="Username (account email)"
              value={form.username}
              placeholder={status?.present?.username ? 'unchanged' : 'you@example.com'}
              onChange={(v) => setForm((f) => ({ ...f, username: v }))}
            />
            <Input
              label="API client id"
              value={form.clientId}
              placeholder={status?.present?.clientId ? 'unchanged' : 'from the SignNow developer portal'}
              onChange={(v) => setForm((f) => ({ ...f, clientId: v }))}
            />
            <Input
              label="API client secret"
              type="password"
              value={form.clientSecret}
              placeholder={status?.present?.clientSecret ? 'unchanged' : ''}
              onChange={(v) => setForm((f) => ({ ...f, clientSecret: v }))}
            />
            <Input
              label="Password"
              type="password"
              value={form.password}
              placeholder={status?.present?.password ? 'unchanged' : ''}
              onChange={(v) => setForm((f) => ({ ...f, password: v }))}
            />
          </div>

          <p className="text-[11px] text-muted-foreground">
            Leave a field blank to keep what is already stored. Nothing here is ever shown back to
            anyone, including you — the credentials are encrypted before they reach the database and
            are only ever opened inside the function that talks to SignNow.
          </p>

          {error && <Banner tone="danger" icon="AlertCircle">{error}</Banner>}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={save}
              disabled={saving || !status?.encryptionReady}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              <Icon name={saving ? 'Loader2' : 'Plug'} size={14} color="currentColor" />
              {saving ? 'Verifying with SignNow…' : connected ? 'Save & re-verify' : 'Connect'}
            </button>
            {live && (
              <button onClick={doDisable} className="px-4 py-2 text-sm font-semibold rounded-lg border border-border text-foreground hover:bg-muted/50">
                Switch off sending
              </button>
            )}
            {connected && (
              <button onClick={doDisconnect} className="px-4 py-2 text-sm font-semibold rounded-lg border border-red-200 text-red-700 hover:bg-red-50">
                Disconnect
              </button>
            )}
          </div>

          {connected && (
            <div className="pt-2 border-t border-border">
              <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1">
                Callback URL registered with SignNow
              </p>
              <code className="block text-[11px] font-mono text-foreground break-all bg-muted/40 rounded p-2">
                {status.webhook?.url}
              </code>
            </div>
          )}
        </div>
      </div>

      {/* ── Policies ────────────────────────────────────────────────────── */}
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-muted/30 border-b border-border">
          <span className="text-sm font-bold text-foreground">What must be signed before it is issued</span>
          <p className="text-xs text-muted-foreground mt-0.5">
            Off for everything until you turn it on. A kind that is off keeps behaving exactly as it
            does today.
          </p>
        </div>

        <div className="divide-y divide-border">
          {Object.entries(DOC_KINDS)
            .filter(([kind, meta]) => (
              // Keep a kind a society has already switched on visible even if
              // the sacco probe failed — hiding a live requirement would leave
              // it enforced with no way to turn it off.
              !meta.saccoOnly || hasSacco || policies[kind]?.require_signature
            ))
            .map(([kind, meta]) => {
            const p = policyOf(kind);
            const isOpen = openKind === kind;
            return (
              <div key={kind} className="p-4">
                <div className="flex items-start gap-3">
                  <label className="flex items-center mt-0.5 shrink-0">
                    <input
                      type="checkbox"
                      checked={!!p.require_signature}
                      onChange={(e) => {
                        patchPolicy(kind, { require_signature: e.target.checked });
                        if (e.target.checked) setOpenKind(kind);
                      }}
                    />
                  </label>
                  <div className="flex-1 min-w-0">
                    <button
                      onClick={() => setOpenKind(isOpen ? null : kind)}
                      className="flex items-center gap-1.5 text-sm font-semibold text-foreground"
                    >
                      {meta.label}
                      <Icon name={isOpen ? 'ChevronUp' : 'ChevronDown'} size={13} color="currentColor" />
                    </button>
                    <p className="text-xs text-muted-foreground mt-0.5">{meta.blurb}</p>

                    {isOpen && (
                      <div className="mt-4 space-y-3">
                        <PanelEditor
                          rows={p.signatories?.length ? p.signatories : defaultPanelFor(kind)}
                          onChange={(rows) => patchPolicy(kind, { signatories: rows })}
                        />

                        <div className="grid sm:grid-cols-3 gap-3">
                          <label className="block">
                            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">Order</span>
                            <select
                              className={`${inputCls} mt-1`}
                              value={p.signing_order}
                              onChange={(e) => patchPolicy(kind, { signing_order: e.target.value })}
                            >
                              <option value="sequential">One after another</option>
                              <option value="parallel">All at once</option>
                            </select>
                          </label>
                          <label className="block">
                            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">Invite expires</span>
                            <input
                              type="number"
                              min={1}
                              max={180}
                              className={`${inputCls} mt-1`}
                              placeholder="SignNow default"
                              value={p.expires_days ?? ''}
                              onChange={(e) => patchPolicy(kind, { expires_days: e.target.value || null })}
                            />
                          </label>
                          <label className="flex items-start gap-2 mt-5">
                            <input
                              type="checkbox"
                              checked={p.auto_release !== false}
                              onChange={(e) => patchPolicy(kind, { auto_release: e.target.checked })}
                            />
                            <span className="text-xs text-foreground">
                              Issue automatically
                              <span className="block text-[11px] text-muted-foreground">
                                as soon as the last signature lands
                              </span>
                            </span>
                          </label>
                        </div>

                        <button
                          onClick={() => persistPolicy(kind)}
                          disabled={savingKind === kind}
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
                        >
                          {savingKind === kind ? 'Saving…' : 'Save this rule'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ── Small pieces ────────────────────────────────────────────────────────────

const PanelEditor = ({ rows, onChange }) => {
  const set = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => onChange([...rows, { role: '', name: '', email: '', order: rows.length + 1 }]);
  const remove = (i) => onChange(rows.filter((_, j) => j !== i).map((r, j) => ({ ...r, order: j + 1 })));

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
          Standing signatories
        </span>
        <button onClick={add} className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
          <Icon name="Plus" size={12} color="currentColor" /> Add
        </button>
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-12 gap-2">
            <input className={`${inputCls} col-span-3`} placeholder="Office" value={r.role || ''}
              onChange={(e) => set(i, { role: e.target.value })} />
            <input className={`${inputCls} col-span-4`} placeholder="Name" value={r.name || ''}
              onChange={(e) => set(i, { name: e.target.value })} />
            <input className={`${inputCls} col-span-4`} type="email" placeholder="email@example.com"
              value={r.email || ''} onChange={(e) => set(i, { email: e.target.value })} />
            <button onClick={() => remove(i)} disabled={rows.length <= 1}
              className="col-span-1 text-muted-foreground hover:text-red-600 disabled:opacity-30">
              <Icon name="Trash2" size={14} color="currentColor" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

const Input = ({ label, value, onChange, type = 'text', placeholder = '' }) => (
  <label className="block">
    <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">{label}</span>
    <input
      className={`${inputCls} mt-1`}
      type={type}
      value={value}
      placeholder={placeholder}
      autoComplete="off"
      onChange={(e) => onChange(e.target.value)}
    />
  </label>
);

const Fact = ({ label, value }) => (
  <div>
    <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">{label}</p>
    <p className="text-xs text-foreground mt-0.5 break-all">{value || '—'}</p>
  </div>
);

const BANNER_TONES = {
  danger: 'bg-red-50 border-red-200 text-red-800',
  warning: 'bg-amber-50 border-amber-200 text-amber-900',
  info: 'bg-blue-50 border-blue-200 text-blue-900',
};

const Banner = ({ tone = 'info', icon = 'Info', children }) => (
  <div className={`flex gap-2 p-3 rounded-lg border ${BANNER_TONES[tone]}`}>
    <Icon name={icon} size={15} color="currentColor" />
    <p className="text-xs leading-relaxed">{children}</p>
  </div>
);

export default SignNowSettingsPanel;
