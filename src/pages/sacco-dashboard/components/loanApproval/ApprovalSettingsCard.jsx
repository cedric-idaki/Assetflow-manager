import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '../../../../components/Toast';
import Icon from '../../../../components/AppIcon';
import { Card, PrimaryButton, GhostButton, Field, TextInput } from '../_shared';
import { APPROVAL_MODES, fetchApprovalConfig, saveApprovalConfig } from '../../../../services/loanApprovalService';

/**
 * The society's loan approval chain: its levels in order, the person named at
 * each, and whether they decide one after another or all at once.
 *
 * Saving changes FUTURE loans. A loan already in approval keeps the approvers
 * it was sent to — its steps were snapshotted when it was submitted.
 *
 * With no levels the sacco keeps single-click approval.
 */

const blankLevel = () => ({ level_name: '', approver_name: '', approver_email: '', approver_phone: '' });

const sameConfig = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const toForm = (cfg) => ({
  mode: cfg.mode,
  levels: cfg.levels.filter((l) => l.is_active !== false).map((l) => ({
    level_name: l.level_name || '',
    approver_name: l.approver_name || '',
    approver_email: l.approver_email || '',
    approver_phone: l.approver_phone || '',
  })),
});

const ApprovalSettingsCard = ({ saccoId, onSaved }) => {
  const toast = useToast();
  // The provider hands out a new toast object on every render, so it must not
  // be a dependency of load() — an error toast would re-run the load forever.
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [saved, setSaved] = useState({ mode: 'sequential', levels: [] });
  const [form, setForm] = useState({ mode: 'sequential', levels: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!saccoId) return;
    setLoading(true);
    try {
      const f = toForm(await fetchApprovalConfig(saccoId));
      setSaved(f);
      setForm(f);
    } catch (e) {
      toastRef.current.error(e.message || 'Could not load the approval workflow.');
    } finally { setLoading(false); }
  }, [saccoId]);

  useEffect(() => { load(); }, [load]);

  const dirty = !sameConfig(form, saved);
  const setLevel = (i, k, v) => setForm((f) => ({
    ...f, levels: f.levels.map((l, j) => (j === i ? { ...l, [k]: v } : l)),
  }));
  const addLevel = () => setForm((f) => ({ ...f, levels: [...f.levels, blankLevel()] }));
  const removeLevel = (i) => setForm((f) => ({ ...f, levels: f.levels.filter((_, j) => j !== i) }));
  const move = (i, d) => setForm((f) => {
    const levels = [...f.levels];
    const j = i + d;
    if (j < 0 || j >= levels.length) return f;
    [levels[i], levels[j]] = [levels[j], levels[i]];
    return { ...f, levels };
  });

  const save = async () => {
    for (const [i, l] of form.levels.entries()) {
      const n = i + 1;
      if (!l.level_name.trim()) { toast.error(`Level ${n} needs a name.`); return; }
      if (!l.approver_name.trim()) { toast.error(`Level ${n} needs an approver name.`); return; }
      if (!l.approver_email.trim() && !l.approver_phone.trim()) {
        toast.error(`Level ${n} needs an email or phone so the approver can receive the OTP.`);
        return;
      }
    }
    setSaving(true);
    try {
      await saveApprovalConfig(saccoId, form.mode, form.levels);
      toast.success(form.levels.length
        ? `Approval workflow saved — ${form.levels.length} level(s), ${form.mode}.`
        : 'Approval workflow removed — loans are approved with a single click again.');
      await load();
      onSaved?.();
    } catch (e) {
      toast.error(e.message || 'Could not save the approval workflow.');
    } finally { setSaving(false); }
  };

  return (
    <Card
      title="Loan approval workflow"
      subtitle="Approval levels, the approver named at each, and OTP-confirmed decisions"
      actions={
        <div className="flex items-center gap-2">
          {dirty && <GhostButton onClick={() => setForm(saved)} disabled={saving}>Discard</GhostButton>}
          <PrimaryButton icon="Save" onClick={save} disabled={saving || !dirty || loading}>
            {saving ? 'Saving…' : 'Save workflow'}
          </PrimaryButton>
        </div>
      }
    >
      {loading ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {APPROVAL_MODES.map((m) => (
              <label key={m.id} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                form.mode === m.id ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-muted/60'
              }`}
              >
                <input
                  type="radio" name="approval-mode" className="mt-0.5"
                  checked={form.mode === m.id}
                  onChange={() => setForm((f) => ({ ...f, mode: m.id }))}
                />
                <span>
                  <span className="block text-sm font-medium text-foreground">{m.label}</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">{m.hint}</span>
                </span>
              </label>
            ))}
          </div>

          {form.levels.length === 0 ? (
            <div className="flex items-start gap-2 p-3 rounded-lg border bg-amber-50 border-amber-200">
              <Icon name="Info" size={15} color="#ca8a04" />
              <p className="text-xs text-amber-700 leading-relaxed">
                No approval levels. Any staff user can approve a loan with one click. Add at least one
                level to require named, OTP-verified approvals.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {form.levels.map((l, i) => (
                <div key={i} className="p-3 rounded-lg border border-border">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Level {i + 1}{form.mode === 'sequential' && i > 0 ? ' · after level ' + i : ''}
                    </span>
                    <div className="flex items-center gap-1">
                      <button type="button" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}
                        className="p-1 rounded hover:bg-muted disabled:opacity-30"><Icon name="ChevronUp" size={14} color="currentColor" /></button>
                      <button type="button" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === form.levels.length - 1}
                        className="p-1 rounded hover:bg-muted disabled:opacity-30"><Icon name="ChevronDown" size={14} color="currentColor" /></button>
                      <button type="button" aria-label="Remove level" onClick={() => removeLevel(i)}
                        className="p-1 rounded hover:bg-red-50 text-red-600"><Icon name="Trash2" size={14} color="currentColor" /></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <Field label="Level name *">
                      <TextInput value={l.level_name} onChange={(e) => setLevel(i, 'level_name', e.target.value)} placeholder="e.g. Credit Officer" />
                    </Field>
                    <Field label="Approver name *">
                      <TextInput value={l.approver_name} onChange={(e) => setLevel(i, 'approver_name', e.target.value)} placeholder="e.g. Jane Wanjiku" />
                    </Field>
                    <Field label="Approver email">
                      <TextInput type="email" value={l.approver_email} onChange={(e) => setLevel(i, 'approver_email', e.target.value)} placeholder="jane@sacco.co.ke" />
                    </Field>
                    <Field label="Approver phone">
                      <TextInput value={l.approver_phone} onChange={(e) => setLevel(i, 'approver_phone', e.target.value)} placeholder="0712 345 678" />
                    </Field>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between">
            <GhostButton icon="Plus" onClick={addLevel} disabled={form.levels.length >= 10}>Add level</GhostButton>
            <p className="text-xs text-muted-foreground">
              The OTP goes to the approver&apos;s email or phone. Changes apply to new loan applications.
            </p>
          </div>
        </div>
      )}
    </Card>
  );
};

export default ApprovalSettingsCard;
