import React, { useState, useMemo, useCallback } from 'react';
import Icon from '../AppIcon';
import { useAdminCrm, buildClientCrmExport, buildActivityExport } from '../../hooks/useAdminCrm';
import { useSupervisorLeads, buildLeadExport } from '../../hooks/useSupervisorLeads';
import { downloadCSV } from '../../utils/exportUtils';
import { Sk } from './crmFormat';

import LeadPipelinePanel  from './LeadPipelinePanel';
import ClientBookPanel    from './ClientBookPanel';
import ClientCrmDrawer    from './ClientCrmDrawer';
import FollowUpDiaryPanel from './FollowUpDiaryPanel';
import ActivityLogPanel   from './ActivityLogPanel';
import AdminCrmReports    from './AdminCrmReports';
import CrmOversightTab    from './CrmOversightTab';
import CustomerRecord     from './CustomerRecord';

// Every write form here is the agent portal's, reused rather than re-cut. They
// already speak the shared CRM vocabulary and already handle the cases these
// screens need — registering a prospect, booking the next touch in the same
// breath as logging the last one, asking why a deal died at the moment somebody
// still knows. A second set would be five forms to keep in step with one set of
// database constraints.
import LeadRegistrationModal from '../../pages/sales-agent-portal/components/LeadRegistrationModal';
import LogInteractionModal   from '../../pages/sales-agent-portal/components/LogInteractionModal';
import ScheduleFollowUpModal from '../../pages/sales-agent-portal/components/ScheduleFollowUpModal';
import LostReasonModal       from '../../pages/sales-agent-portal/components/LostReasonModal';
import OpportunitiesPanel    from '../../pages/sales-agent-portal/components/OpportunitiesPanel';

/**
 * The super administrator's CRM.
 *
 * The platform owner had oversight and nothing else: CrmOversightTab, read-only
 * by design, answering "what are my agents doing". That is a supervision tool,
 * not a CRM — it cannot record a single thing the super administrator does
 * themselves, and the person running the business does the largest deals in it.
 *
 * Seven views over one set of relationships:
 *
 *   Pipeline      — the prospects they are working themselves, as a board.
 *   Opportunities — the same deals measured in money: value, forecast, dates.
 *   Clients       — the customer book, sorted by who has been neglected longest.
 *   Follow-ups    — the diary, sorted by what is late.
 *   Activity      — every contact recorded, filterable and exportable.
 *   Reports       — coverage, channels, outcomes, whether promises are kept.
 *   Sales team    — the existing read-only oversight of the sales force.
 *
 * The last one is the screen this tab used to BE. It is unchanged and still
 * read-only: watching an agent's pipeline and running your own relationships
 * are different jobs, and mixing them is how a supervisor ends up editing a
 * lead out from under the person working it. Everything in the other six views
 * is the super administrator's OWN — `agent_id IS NULL` rows, which is exactly
 * what the write policies in 20260830180000 and 20260831140000 accept.
 */

const VIEWS = [
  { id: 'pipeline',      label: 'Pipeline',      icon: 'Target',         hint: 'Prospects you are working' },
  { id: 'opportunities', label: 'Opportunities', icon: 'TrendingUp',     hint: 'What the pipeline is worth' },
  { id: 'clients',       label: 'Clients',       icon: 'Users',          hint: 'Your customer book' },
  { id: 'followups',     label: 'Follow-ups',    icon: 'CalendarClock',  hint: 'What you have promised' },
  { id: 'activity',      label: 'Activity',      icon: 'MessagesSquare', hint: 'Every contact recorded' },
  { id: 'reports',       label: 'Reports',       icon: 'BarChart3',      hint: 'Coverage and outcomes' },
  { id: 'agents',        label: 'Sales team',    icon: 'UserCheck',      hint: 'Agent pipelines (read-only)' },
];

const SuperAdminCrmTab = ({ onExport }) => {
  const crm  = useAdminCrm();
  const pipe = useSupervisorLeads();

  const {
    canView, book, interactions, clients, diary, teamDiary, summary,
    loading, error, clientName,
    logContact, scheduleFollowUp, completeFollowUp, rescheduleFollowUp,
    deleteFollowUp, deleteInteraction, saveClientNote, refetch,
  } = crm;

  const [view, setView]            = useState('pipeline');
  const [openClient, setOpen]      = useState(null);
  const [openLead, setOpenLead]    = useState(null);
  const [logFor, setLogFor]        = useState(undefined);   // undefined = closed
  const [scheduleFor, setSchedule] = useState(undefined);
  const [showNewLead, setNewLead]  = useState(false);
  const [pendingClose, setClose]   = useState(null);

  // Both drawers hold an ID rather than the row, so they re-read the derived
  // list after every write instead of showing a frozen copy of the record as it
  // looked when it was opened.
  const openRecord = useMemo(
    () => (openClient ? book.find(c => c.id === openClient) || null : null),
    [book, openClient],
  );

  const leadRecord = useMemo(
    () => (openLead ? pipe.leads.find(l => l.id === openLead) || null : null),
    [pipe.leads, openLead],
  );

  /** Client rows in the shape the two agent-portal modals expect. */
  const pickableClients = useMemo(
    () => clients.map(c => ({ id: c.id, full_name: c.full_name, phone: c.phone })),
    [clients],
  );

  /**
   * Name resolution across both books.
   *
   * The diary and the activity log carry rows that point at a lead OR a client,
   * and neither hook alone can name both. Without this, a follow-up booked
   * against a prospect renders with a blank subject in the very list it exists
   * to appear in.
   */
  const nameFor = useCallback(
    (row) => pipe.leadName(row) || clientName(row) || row?.contact_name || row?.lead_name || '',
    [pipe, clientName],
  );

  // Destructive actions ask first and report failure out loud. Each removes a
  // record somebody wrote on purpose, and RLS can still refuse the write — a
  // silently ignored delete would read as a UI that does nothing.
  const confirmThen = useCallback(async (message, run) => {
    if (!window.confirm(message)) return;
    const res = await run();
    if (res?.error) window.alert(res.error);
  }, []);

  const handleDeleteInteraction = useCallback((i) => confirmThen(
    'Remove this contact record? The contact counters will be recalculated.',
    () => deleteInteraction(i.id),
  ), [confirmThen, deleteInteraction]);

  const handleDeleteFollowUp = useCallback((f) => confirmThen(
    'Remove this appointment? Its reminder will not be sent.',
    () => deleteFollowUp(typeof f === 'string' ? f : f.id),
  ), [confirmThen, deleteFollowUp]);

  const handleDeleteLead = useCallback((lead) => confirmThen(
    `Remove ${lead.full_name} from your pipeline? Everything logged against them goes too.`,
    () => pipe.deleteLead(lead.id),
  ), [confirmThen, pipe]);

  /**
   * A stage move, with the lost-reason prompt on the way to 'closed'.
   *
   * Asked at the moment of closing because that is when somebody knows the
   * answer; asked later it is a guess. Skippable on purpose — closing forty
   * stale prospects must not be held up by a form — and the reason can be added
   * afterwards from the record.
   */
  const handleMoveStage = useCallback(async (leadId, stage) => {
    const lead = pipe.leads.find(l => l.id === leadId);
    if (stage === 'closed' && lead && !lead.converted_at) {
      setClose(lead);
      return;
    }
    const res = await pipe.moveLeadStage(leadId, stage);
    if (res?.error) window.alert(res.error);
  }, [pipe]);

  const confirmClose = useCallback(async (lost) => {
    const lead = pendingClose;
    if (!lead) return;
    const res = await pipe.moveLeadStage(lead.id, 'closed', lost);
    // Thrown, not swallowed, and the modal is cleared only on success: it shows
    // its own error and closing it first would take the message with it.
    if (res?.error) throw new Error(res.error);
    setClose(null);
  }, [pendingClose, pipe]);

  /**
   * Price a deal from the opportunities list.
   *
   * The panel's rows report a failure by catching, so a rejected write has to
   * throw for the message to land next to the field the person just typed in —
   * this hook reports by return value like the rest of the CRM writes.
   */
  const handleSaveDeal = useCallback(async (leadId, patch) => {
    const res = await pipe.saveDeal(leadId, patch);
    if (res?.error) throw new Error(res.error);
    return res;
  }, [pipe]);

  const handleCreateLead = useCallback(async (form) => {
    const res = await pipe.createLead(form);
    // The modal closes itself on a resolved promise, so a rejected write has to
    // throw for the error to reach its banner.
    if (res?.error) throw new Error(res.error);
    return res;
  }, [pipe]);

  const exportBook = useCallback((rows) => {
    downloadCSV(buildClientCrmExport(rows || book), `crm-client-book-${new Date().toISOString().slice(0, 10)}`);
  }, [book]);

  const exportActivity = useCallback((rows) => {
    downloadCSV(
      buildActivityExport(rows || interactions, nameFor),
      `crm-contact-log-${new Date().toISOString().slice(0, 10)}`,
    );
  }, [interactions, nameFor]);

  const exportPipeline = useCallback((rows) => {
    downloadCSV(buildLeadExport(rows || pipe.leads), `crm-pipeline-${new Date().toISOString().slice(0, 10)}`);
  }, [pipe.leads]);

  if (!canView) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center">
        <Icon name="Lock" size={22} color="var(--color-muted-foreground)" />
        <p className="text-sm font-medium text-foreground mt-3">The CRM is not available for your role</p>
        <p className="text-xs text-muted-foreground mt-1">
          Customer relationships are managed by admins, directors and managers.
        </p>
      </div>
    );
  }

  // Both hooks load independently, so a view waits only on the data it uses.
  const busy = loading || pipe.loading;

  return (
    <div className="space-y-4">

      {/* View switch */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {VIEWS.map((v) => {
          const badge = v.id === 'followups' ? diary.overdue
            : v.id === 'pipeline' ? pipe.summary.unworked.length
            : v.id === 'clients' ? summary.clients.never
            : 0;
          return (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              title={v.hint}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium transition-all border whitespace-nowrap ${
                view === v.id
                  ? 'border-primary/40 text-primary bg-primary/5'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <Icon name={v.icon} size={15} color="currentColor" />
              {v.label}
              {badge > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold">
                  {badge}
                </span>
              )}
            </button>
          );
        })}

        <button
          onClick={() => { refetch(); pipe.refetch(); }}
          title="Refresh"
          className="ml-auto p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex-shrink-0"
        >
          <Icon name="RefreshCw" size={15} color="currentColor" />
        </button>
      </div>

      {(error || pipe.error) && (
        // Carries load failures AND the "contact saved, follow-up was not" case,
        // so the wording stays neutral and the message speaks for itself.
        <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <Icon name="AlertTriangle" size={15} color="currentColor" className="flex-shrink-0 mt-0.5" />
          <p className="flex-1">{error || pipe.error}</p>
          <button
            onClick={() => { refetch(); pipe.refetch(); }}
            className="text-xs font-medium underline hover:no-underline flex-shrink-0"
          >
            Try again
          </button>
        </div>
      )}

      {/* Panels */}
      {view === 'pipeline' && (
        <LeadPipelinePanel
          leads={pipe.leads}
          board={pipe.board}
          summary={pipe.summary}
          loading={pipe.loading}
          onAdd={() => setNewLead(true)}
          onOpen={lead => setOpenLead(lead.id)}
          onMoveStage={handleMoveStage}
          onLog={lead => setLogFor({ kind: 'lead', row: lead })}
          onSchedule={lead => setSchedule({ kind: 'lead', row: lead })}
          onDelete={handleDeleteLead}
          onExport={exportPipeline}
        />
      )}

      {view === 'opportunities' && (
        <OpportunitiesPanel
          leads={pipe.leads}
          loading={pipe.loading}
          error={pipe.error}
          onSaveDeal={handleSaveDeal}
          onOpenLead={lead => setOpenLead(lead.id)}
          onRefresh={pipe.refetch}
        />
      )}

      {view === 'clients' && (
        <ClientBookPanel
          book={book}
          loading={loading}
          onOpen={c => setOpen(c.id)}
          onLog={c => setLogFor({ kind: 'client', row: c })}
          onSchedule={c => setSchedule({ kind: 'client', row: c })}
          onExport={exportBook}
        />
      )}

      {view === 'followups' && (
        <FollowUpDiaryPanel
          diary={diary}
          teamDiary={teamDiary}
          loading={loading}
          nameFor={nameFor}
          onComplete={completeFollowUp}
          onReschedule={rescheduleFollowUp}
          onDelete={handleDeleteFollowUp}
          onSchedule={c => setSchedule(c ? { kind: 'client', row: c } : null)}
        />
      )}

      {view === 'activity' && (
        <ActivityLogPanel
          interactions={interactions}
          loading={loading}
          nameFor={nameFor}
          onExport={exportActivity}
          onDelete={handleDeleteInteraction}
          onLog={c => setLogFor(c ? { kind: 'client', row: c } : null)}
        />
      )}

      {view === 'reports' && (
        busy
          ? <div className="space-y-4"><Sk className="h-24" /><Sk className="h-56" /></div>
          : (
            <AdminCrmReports
              summary={summary}
              loading={loading}
              onOpenClient={c => setOpen(c.id)}
              onExportBook={() => exportBook()}
              onExportActivity={() => exportActivity()}
            />
          )
      )}

      {/* The screen this tab used to be, kept whole. */}
      {view === 'agents' && <CrmOversightTab onExport={onExport} />}

      {/* Records */}
      {openRecord && (
        <ClientCrmDrawer
          client={openRecord}
          onClose={() => setOpen(null)}
          onLog={c => setLogFor({ kind: 'client', row: c })}
          onSchedule={c => setSchedule({ kind: 'client', row: c })}
          onCompleteFollowUp={completeFollowUp}
          onRescheduleFollowUp={rescheduleFollowUp}
          onDeleteFollowUp={handleDeleteFollowUp}
          onDeleteInteraction={handleDeleteInteraction}
          onSaveNote={saveClientNote}
        />
      )}

      {leadRecord && (
        <CustomerRecord
          lead={leadRecord}
          readOnly={false}
          onClose={() => setOpenLead(null)}
          onLogInteraction={lead => setLogFor({ kind: 'lead', row: lead })}
          onScheduleFollowUp={lead => setSchedule({ kind: 'lead', row: lead })}
        />
      )}

      {/* Write forms */}
      <LeadRegistrationModal
        isOpen={showNewLead}
        onClose={() => setNewLead(false)}
        onSubmit={handleCreateLead}
      />

      <LostReasonModal
        open={Boolean(pendingClose)}
        lead={pendingClose}
        onCancel={() => setClose(null)}
        onConfirm={confirmClose}
      />

      {logFor !== undefined && (
        <LogInteractionModal
          isOpen
          onClose={() => setLogFor(undefined)}
          onSubmit={logContact}
          leads={pipe.pickable}
          clients={pickableClients}
          prefillLead={logFor?.kind === 'lead' ? { id: logFor.row.id, full_name: logFor.row.full_name } : null}
          prefillClient={logFor?.kind === 'client' ? { id: logFor.row.id, full_name: logFor.row.full_name } : null}
        />
      )}

      {scheduleFor !== undefined && (
        <ScheduleFollowUpModal
          isOpen
          onClose={() => setSchedule(undefined)}
          onSubmit={async (input) => {
            const res = await scheduleFollowUp(input);
            // The modal closes itself on a resolved promise, so a rejected write
            // has to throw for the error to reach its banner.
            if (res?.error) throw new Error(res.error);
            return res;
          }}
          leads={pipe.pickable}
          clients={pickableClients}
          prefillLead={scheduleFor?.kind === 'lead' ? { id: scheduleFor.row.id, full_name: scheduleFor.row.full_name } : null}
          prefillClient={scheduleFor?.kind === 'client' ? { id: scheduleFor.row.id, full_name: scheduleFor.row.full_name } : null}
        />
      )}
    </div>
  );
};

export default SuperAdminCrmTab;
