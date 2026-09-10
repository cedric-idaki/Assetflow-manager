import React, { useState, useMemo } from 'react';
import Icon from '../AppIcon';
import { fmtDate } from '../crm/crmFormat';
import {
  explainAssignmentProblem, describeAssignment, isManager,
} from '../../config/salesHierarchy';

/**
 * Draw, move, or share a reporting line.
 *
 * ONE dialog for assign / reassign / add-a-second-manager, because the database
 * makes no distinction either — naming a primary manager for an agent who
 * already has one IS the reassignment, and splitting it into two screens would
 * mean two places to get the confirmation wording wrong.
 *
 * Three things are surfaced rather than left implicit, all for the same reason:
 * this dialog quietly moves who can see a book of business.
 *
 *   * The CURRENT manager is shown, and the summary sentence says "will move
 *     from X to Y". "Assign" reads like an addition when it is a move.
 *   * The ADDITIONAL-manager path demands a written authorisation, which is
 *     the constraint agent_manager_secondary_authorized enforces in SQL. Asking
 *     for it here is what makes the refusal there never happen.
 *   * TRANSFERRING HISTORY is off by default and spelled out in full, because
 *     it rewrites commission credit on work that is already done — the one
 *     genuinely irreversible thing this dialog can do.
 */
const AssignManagerModal = ({
  agent,
  managers = [],
  currentManager = null,
  existingLinks = [],
  saving = false,
  onAssign,
  onClose,
}) => {
  const [managerId, setManagerId] = useState('');
  const [isPrimary, setIsPrimary] = useState(true);
  const [note, setNote]           = useState('');
  const [transfer, setTransfer]   = useState(false);
  const [error, setError]         = useState('');

  const eligible = useMemo(
    () => managers.filter(m => isManager(m) && m.id !== agent?.id),
    [managers, agent?.id],
  );

  const manager = eligible.find(m => m.id === managerId) || null;

  const problem = useMemo(
    () => (managerId
      ? explainAssignmentProblem({ agent, manager, isPrimary, note, existingLinks })
      : null),
    [agent, manager, managerId, isPrimary, note, existingLinks],
  );

  const summary = manager
    ? describeAssignment({ agent, manager, isPrimary, current: currentManager })
    : null;

  const isMove = isPrimary && currentManager && currentManager.id !== managerId;

  const submit = async () => {
    setError('');
    if (!managerId) { setError('Choose a sales manager.'); return; }
    if (problem)    { setError(problem); return; }

    const res = await onAssign({
      agentId: agent.id,
      managerId,
      isPrimary,
      note,
      transferHistory: transfer,
    });

    if (res?.error) { setError(res.error); return; }
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-2xl max-h-[92vh] overflow-y-auto">

        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-100 flex items-center justify-center">
              <Icon name="Network" size={18} color="#7e22ce" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">
                {currentManager ? 'Reassign sales agent' : 'Assign a sales manager'}
              </h3>
              <p className="text-xs text-muted-foreground">
                {agent?.full_name} · {agent?.agent_code}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <Icon name="X" size={18} color="var(--color-muted-foreground)" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              <Icon name="AlertCircle" size={15} color="currentColor" />
              <span>{error}</span>
            </div>
          )}

          {/* Where the agent stands today. Shown even when there is no manager,
              because "reports to nobody" is the state this dialog exists to
              fix and it should be named rather than implied by a blank. */}
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-muted/50 border border-border">
            <Icon name="UserCheck" size={15} color="var(--color-muted-foreground)" />
            <div className="text-xs">
              <span className="text-muted-foreground">Currently reports to </span>
              <span className="font-semibold text-foreground">
                {currentManager?.full_name || 'nobody'}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Sales manager *
            </label>
            <select
              value={managerId}
              onChange={(e) => setManagerId(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
            >
              <option value="">Choose a manager…</option>
              {eligible.map(m => (
                <option key={m.id} value={m.id}>
                  {m.full_name} · {m.agent_code}{m.region ? ` · ${m.region}` : ''}
                </option>
              ))}
            </select>
            {eligible.length === 0 && (
              <p className="text-xs text-amber-700 mt-1.5">
                No sales managers yet — promote an agent to manager first.
              </p>
            )}
          </div>

          {/* One manager, unless authorised otherwise. The radio is the whole
              rule, so it is stated in words rather than left to a checkbox
              label nobody reads. */}
          <div className="space-y-2">
            <span className="block text-xs font-medium text-muted-foreground">Reporting line</span>

            <label className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
              isPrimary ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
            }`}>
              <input
                type="radio"
                checked={isPrimary}
                onChange={() => setIsPrimary(true)}
                className="mt-0.5"
              />
              <span className="text-xs">
                <span className="font-semibold text-foreground block">Primary manager</span>
                <span className="text-muted-foreground">
                  The agent reports to this manager and no other.
                  {currentManager ? ' Their current line is closed.' : ''}
                </span>
              </span>
            </label>

            <label className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
              !isPrimary ? 'border-amber-400 bg-amber-50' : 'border-border hover:bg-muted/50'
            }`}>
              <input
                type="radio"
                checked={!isPrimary}
                onChange={() => setIsPrimary(false)}
                className="mt-0.5"
              />
              <span className="text-xs">
                <span className="font-semibold text-foreground block">
                  Additional manager (needs your authorisation)
                </span>
                <span className="text-muted-foreground">
                  The agent keeps their primary manager and this one as well.
                  Your name is recorded against the exception.
                </span>
              </span>
            </label>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              {isPrimary ? 'Note (optional)' : 'Authorisation — why two managers? *'}
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder={isPrimary
                ? 'e.g. Moving to the coast team'
                : 'e.g. Covering the coast region for Q4 alongside their own patch'}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground"
            />
          </div>

          {/* Only offered on a real move: transferring history when there is no
              previous manager transfers nothing, and an option that does
              nothing is worse than no option. */}
          {isMove && (
            <label className="flex items-start gap-2.5 p-3 rounded-lg border border-border cursor-pointer hover:bg-muted/50 transition-colors">
              <input
                type="checkbox"
                checked={transfer}
                onChange={(e) => setTransfer(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-xs">
                <span className="font-semibold text-foreground block">
                  Move past work to the new manager as well
                </span>
                <span className="text-muted-foreground">
                  Off by default. The new manager can already see this agent's live
                  book. This also moves the CREDIT for leads, clients and sales
                  already recorded — including commission reporting — away from
                  {' '}{currentManager?.full_name || 'the previous manager'}. Use it for a
                  restructure, not for a routine move.
                </span>
              </span>
            </label>
          )}

          {summary && !problem && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-xs">
              <Icon name="Info" size={14} color="currentColor" />
              <span>{summary}</span>
            </div>
          )}

          {problem && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">
              <Icon name="AlertTriangle" size={14} color="currentColor" />
              <span>{problem}</span>
            </div>
          )}

          {/* The line the agent is on now, if any, with when it started —
              context for whether a move is overdue or premature. */}
          {currentManager && (
            <p className="text-[11px] text-muted-foreground">
              Reporting to {currentManager.full_name} since{' '}
              {fmtDate(existingLinks.find(
                l => l.is_active && l.is_primary && l.agent_id === agent?.id,
              )?.assigned_at)}.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-all"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving || !managerId || Boolean(problem)}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #7e22ce, #6b21a8)' }}
          >
            {saving ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Saving…
              </>
            ) : (
              <>
                <Icon name="Check" size={15} color="currentColor" />
                {isMove ? 'Reassign' : 'Assign'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AssignManagerModal;
