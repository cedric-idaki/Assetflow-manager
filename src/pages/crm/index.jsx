import React, { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import MainLayout from '../../layouts/MainLayout';
import ClosePageButton from '../../components/ui/ClosePageButton';
import Icon from '../../components/AppIcon';
import AdminCrmTab, { CRM_VIEWS } from '../../components/crm/AdminCrmTab';
import { downloadCSV } from '../../utils/exportUtils';

/**
 * The CRM, as its own destination.
 *
 * It used to be the ninth chip on the admin dashboard's tab bar, three clicks
 * from a phone ringing and invisible to a director or manager — /admin-dashboard
 * is admin-only, while the database has granted all three of them the tenant's
 * book since 20260830180000. Promoting it to the sidebar is what makes that
 * grant reachable, and gives it the front page (Overview) a tab bar had no room
 * for.
 *
 * The screen itself is AdminCrmTab unchanged; this page contributes the chrome,
 * the export and the URL. The chosen view lives in `?view=` so a refresh, a
 * back button and a link all land on the same place — the same reason the admin
 * dashboard keeps its tab in `?tab=`.
 */

const VIEW_IDS = CRM_VIEWS.map(v => v.id);
const DEFAULT_VIEW = 'overview';

const CrmPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const requested = searchParams.get('view');
  const view = VIEW_IDS.includes(requested) ? requested : DEFAULT_VIEW;

  // The default view carries no parameter, so /crm and /crm?view=overview are
  // the same URL rather than two that render alike.
  const setView = useCallback((next) => {
    setSearchParams(next === DEFAULT_VIEW ? {} : { view: next }, { replace: true });
  }, [setSearchParams]);

  /**
   * CSV export for the agent oversight view.
   *
   * The admin dashboard handed down its own exportCSV from
   * useAdminDashboard; there is no such context here, and the shared helper
   * writes the same file — with the UTF-8 BOM that stops Excel mangling a name
   * like Wanjirũ, which the dashboard's copy never had.
   */
  const exportRows = useCallback((rows, name) => {
    downloadCSV(rows, `${name}_${new Date().toISOString().slice(0, 10)}`);
  }, []);

  return (
    <MainLayout>
      <div className="p-5 space-y-5">

        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
            >
              <Icon name="Contact" size={20} color="#fff" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">CRM</h1>
              <p className="text-sm text-muted-foreground">
                Customer relationships, follow-ups and the sales team
              </p>
            </div>
          </div>
          <ClosePageButton label="Close CRM" />
        </div>

        <AdminCrmTab view={view} onViewChange={setView} onExport={exportRows} />
      </div>
    </MainLayout>
  );
};

export default CrmPage;
