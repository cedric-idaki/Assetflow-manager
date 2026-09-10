import React, { useState, useMemo, useCallback } from 'react';
import Icon from '../AppIcon';
import { useAdminCrm, buildClientCrmExport, buildActivityExport } from '../../hooks/useAdminCrm';
import { downloadCSV } from '../../utils/exportUtils';
import { Sk } from './crmFormat';

import ClientBookPanel     from './ClientBookPanel';
import ClientCrmDrawer     from './ClientCrmDrawer';
import FollowUpDiaryPanel  from './FollowUpDiaryPanel';
import ActivityLogPanel    from './ActivityLogPanel';
import AdminCrmReports     from './AdminCrmReports';
import CrmOversightTab     from './CrmOversightTab';

// The two write forms are the agent portal's, reused rather than re-cut. They
// already speak the shared CRM vocabulary, already handle the "book the next
// touch in the same breath" case, and a second pair would be two forms to keep
// in step with one set of database constraints. Both take `clients` for this
// caller and default to the agent's shape when they are not given.
import LogInteractionModal   from '../../pages/sales-agent-portal/components/LogInteractionModal';
import ScheduleFollowUpModal from '../../pages/sales-agent-portal/components/ScheduleFollowUpModal';

/**
 * The administrator's CRM.
 *
 * Five views over one tenant's customer relationships:
 *
 *   Clients    — the book, sorted by who has been neglected longest.
 *   Follow-ups — the diary, sorted by what is late.
 *   Activity   — the communication record, filterable and exportable.
 *   Reports    — coverage, channels, outcomes, whether commitments are kept.
 *   Agents     — the existing read-only oversight of the sales force.
 *
 * The last one is the screen that used to BE this tab. It is unchanged and
 * still read-only: watching an agent's pipeline and running your own customer
 * relationships are different jobs, and mixing them is how an admin ends up
 * editing a lead out from under the person working it.
 */

const VIEWS = [
  { id: 'clients',   label: 'Clients',    icon: 'Users',         hint: 'Your customer book' },
  { id: 'followups', label: 'Follow-ups', icon: 'CalendarClock', hint: 'What you have promised' },
  { id: 'activity',  label: 'Activity',   icon: 'MessagesSquare',hint: 'Every contact recorded' },
  { id: 'reports',   label: 'Reports',    icon: 'BarChart3',     hint: 'Coverage and outcomes' },
  { id: 'agents',    label: 'Sales team', icon: 'UserCheck',     hint: 'Agent pipelines (read-only)' },
];

const AdminCrmTab = ({ onExport }) => {
  const crm = useAdminCrm();
  const {
    canView, book, interactions, clients, diary, teamDiary, summary,
    loading, error, clientName,
    logContact, scheduleFollowUp, completeFollowUp, rescheduleFollowUp,
    deleteFollowUp, deleteInteraction, saveClientNote, refetch,
  } = crm;

  const [view, setView]       = useState('clients');
  const [openClient, setOpen] = useState(null);
  const [logFor, setLogFor]       = useState(undefined);   // undefined = closed
  const [scheduleFor, setSchedule] = useState(undefined);

  // The drawer holds a client ID rather than the row, so it re-reads the
  // derived book after every write instead of showing a frozen copy of the
  // record as it looked when it was opened.
  const openRecord = useMemo(
    () => (openClient ? book.find(c => c.id === openClient) || null : null),
    [book, openClient],
  );

  /** Client rows in the shape the two agent-portal modals expect. */
  const pickable = useMemo(
    () => clients.map(c => ({ id: c.id, full_name: c.full_name, phone: c.phone })),
    [clients],
  );

  // Destructive actions ask first and report failure out loud. Both of these
  // remove a record somebody wrote on purpose, and RLS can still refuse the
  // write — a silently ignored delete would read as a UI that does nothing.
  const confirmThen = useCallback(async (message, run) => {
    if (!window.confirm(message)) return;
    const res = await run();
    if (res?.error) window.alert(res.error);
  }, []);

  const handleDeleteInteraction = useCallback((i) => confirmThen(
    'Remove this contact record? The client\'s contact counters will be recalculated.',
    () => deleteInteraction(i.id),
  ), [confirmThen, deleteInteraction]);

  const handleDeleteFollowUp = useCallback((f) => confirmThen(
    'Remove this appointment? Its reminder will not be sent.',
    () => deleteFollowUp(typeof f === 'string' ? f : f.id),
  ), [confirmThen, deleteFollowUp]);

  const exportBook = useCallback((rows) => {
    downloadCSV(buildClientCrmExport(rows || book), `crm-client-book-${new Date().toISOString().slice(0, 10)}`);
  }, [book]);

  const exportActivity = useCallback((rows) => {
    downloadCSV(
      buildActivityExport(rows || interactions, clientName),
      `crm-contact-log-${new Date().toISOString().slice(0, 10)}`,
    );
  }, [interactions, clientName]);

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

  return (
    <div className="space-y-4">

      {/* View switch */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {VIEWS.map((v) => {
          const badge = v.id === 'followups' ? diary.overdue
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
          onClick={refetch}
          title="Refresh"
          className="ml-auto p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex-shrink-0"
        >
          <Icon name="RefreshCw" size={15} color="currentColor" />
        </button>
      </div>

      {error && (
        // Carries load failures AND the "contact saved, follow-up was not"
        // case, so the wording stays neutral and the message speaks for itself.
        <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <Icon name="AlertTriangle" size={15} color="currentColor" className="flex-shrink-0 mt-0.5" />
          <p className="flex-1">{error}</p>
          <button
            onClick={refetch}
            className="text-xs font-medium underline hover:no-underline flex-shrink-0"
          >
            Try again
          </button>
        </div>
      )}

      {/* Panels */}
      {view === 'clients' && (
        <ClientBookPanel
          book={book}
          loading={loading}
          onOpen={c => setOpen(c.id)}
          onLog={c => setLogFor(c)}
          onSchedule={c => setSchedule(c)}
          onExport={exportBook}
        />
      )}

      {view === 'followups' && (
        <FollowUpDiaryPanel
          diary={diary}
          teamDiary={teamDiary}
          loading={loading}
          nameFor={clientName}
          onComplete={completeFollowUp}
          onReschedule={rescheduleFollowUp}
          onDelete={handleDeleteFollowUp}
          onSchedule={c => setSchedule(c)}
        />
      )}

      {view === 'activity' && (
        <ActivityLogPanel
          interactions={interactions}
          loading={loading}
          nameFor={clientName}
          onExport={exportActivity}
          onDelete={handleDeleteInteraction}
          onLog={c => setLogFor(c)}
        />
      )}

      {view === 'reports' && (
        loading
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

      {/* Record */}
      {openRecord && (
        <ClientCrmDrawer
          client={openRecord}
          onClose={() => setOpen(null)}
          onLog={c => setLogFor(c)}
          onSchedule={c => setSchedule(c)}
          onCompleteFollowUp={completeFollowUp}
          onRescheduleFollowUp={rescheduleFollowUp}
          onDeleteFollowUp={handleDeleteFollowUp}
          onDeleteInteraction={handleDeleteInteraction}
          onSaveNote={saveClientNote}
        />
      )}

      {/* Write forms */}
      {logFor !== undefined && (
        <LogInteractionModal
          isOpen
          onClose={() => setLogFor(undefined)}
          onSubmit={logContact}
          leads={[]}
          clients={pickable}
          prefillClient={logFor ? { id: logFor.id, full_name: logFor.full_name } : null}
        />
      )}

      {scheduleFor !== undefined && (
        <ScheduleFollowUpModal
          isOpen
          onClose={() => setSchedule(undefined)}
          onSubmit={async (input) => {
            const res = await scheduleFollowUp(input);
            // The modal closes itself on a resolved promise, so a rejected
            // write has to throw for the error to reach its banner.
            if (res?.error) throw new Error(res.error);
            return res;
          }}
          leads={[]}
          clients={pickable}
          prefillClient={scheduleFor ? { id: scheduleFor.id, full_name: scheduleFor.full_name } : null}
        />
      )}
    </div>
  );
};

export default AdminCrmTab;
