import React, { useMemo, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import Input from '../../../../components/ui/Input';
import Select from '../../../../components/ui/Select';
import ServiceCard from './ServiceCard';
import ServiceFormModal from './ServiceFormModal';
import EngagementFormModal from './EngagementFormModal';
import {
  ENGAGEMENT_STATUSES,
  describeTerms,
  engagementStatusMeta,
  isCurrentEngagement,
  termsDiffer,
} from '../../../../config/consultancyPricing';

const AVAILABILITY = [
  { value: 'offered', label: 'Offered' },
  { value: 'retired', label: 'Retired' },
  { value: 'all',     label: 'All services' },
];

const MAPPING_STATUS = [
  { value: 'current', label: 'Current' },
  ...ENGAGEMENT_STATUSES.map(s => ({ value: s.value, label: s.label })),
  { value: 'all', label: 'All statuses' },
];

const formatDate = (d) => (d
  ? new Date(`${d}T00:00:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })
  : null);

const Stat = ({ icon, label, value }) => (
  <div className="bg-card border border-border rounded-xl px-4 py-3 flex items-center gap-3">
    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
      <Icon name={icon} size={16} color="#1A56DB" />
    </div>
    <div className="min-w-0">
      <p className="text-lg font-bold text-foreground leading-tight">{value}</p>
      <p className="text-xs text-muted-foreground truncate">{label}</p>
    </div>
  </div>
);

/** One client on one service, with the terms they agreed. */
const MappingRow = ({ engagement, service, option, onOpen }) => {
  const st = engagementStatusMeta(engagement.status);
  const { headline, details } = describeTerms(engagement);
  // Custom: never came from the price list. Negotiated: came from it, then changed.
  const origin = !engagement.cost_structure_id
    ? 'Custom'
    : option && termsDiffer(option, engagement) ? 'Negotiated' : null;
  const from = formatDate(engagement.start_date);
  const to = formatDate(engagement.end_date);

  return (
    <button
      type="button"
      data-testid="mapping-row"
      onClick={() => onOpen(engagement)}
      className="w-full text-left bg-card border border-border rounded-xl px-4 py-3 hover:border-primary/50 hover:shadow-sm transition-all grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-4 md:items-center"
    >
      <div className="md:col-span-3 min-w-0">
        <p className="font-semibold text-foreground truncate">{engagement.client?.full_name || 'Client'}</p>
        <p className="text-xs text-muted-foreground truncate">{engagement.client?.account_number}</p>
      </div>
      <div className="md:col-span-3 min-w-0">
        <p className="text-sm text-foreground truncate">{service?.name || 'Service'}</p>
        <p className="text-xs text-muted-foreground truncate">{service?.service_code}</p>
      </div>
      <div className="md:col-span-4 min-w-0">
        <p className="text-sm text-foreground">
          <span className="font-medium">{headline}</span>
          {origin && (
            <span className="ml-2 px-1.5 py-0.5 rounded bg-muted text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {origin}
            </span>
          )}
        </p>
        {details.length > 0 && <p className="text-xs text-muted-foreground truncate">{details.join(' · ')}</p>}
      </div>
      <div className="md:col-span-2 flex md:flex-col md:items-end gap-2 md:gap-1">
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${st.cls}`}>{st.label}</span>
        {from && (
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {from}{to ? ` → ${to}` : ''}
          </span>
        )}
      </div>
    </button>
  );
};

/**
 * The Services area of Inventory & Clients: the consultancy's catalogue, the
 * price options behind each service, and the clients mapped to them.
 *
 * `consultancy` is useConsultancyServices(), owned by the page so the tab's
 * count is right before the tab is opened. `clients` is the page's own client
 * list, which the mapping form picks from.
 */
const ServicesTab = ({ consultancy, clients = [] }) => {
  const {
    services, costStructures, engagements,
    optionsByService, engagementsByService, categories, summary,
    loading, error,
    saveService, setServiceActive, deleteService, saveEngagement, deleteEngagement,
  } = consultancy;

  const [view, setView] = useState('catalogue');
  const [search, setSearch] = useState('');
  const [availability, setAvailability] = useState('offered');
  const [mappingStatus, setMappingStatus] = useState('current');
  const [mappingService, setMappingService] = useState('all');
  const [serviceForm, setServiceForm] = useState(null);       // { service } while open
  const [engagementForm, setEngagementForm] = useState(null); // { engagement?, presetServiceId? }
  const [actionError, setActionError] = useState('');

  const serviceById = useMemo(
    () => Object.fromEntries(services.map(s => [s.id, s])), [services]);
  const optionById = useMemo(
    () => Object.fromEntries(costStructures.map(o => [o.id, o])), [costStructures]);
  const clientsByOption = useMemo(() => {
    const counts = {};
    engagements.forEach((e) => {
      if (e.cost_structure_id) counts[e.cost_structure_id] = (counts[e.cost_structure_id] || 0) + 1;
    });
    return counts;
  }, [engagements]);

  const q = search.trim().toLowerCase();
  const matches = (...values) => !q || values.some(v => String(v || '').toLowerCase().includes(q));

  const visibleServices = services.filter((s) => {
    if (availability === 'offered' && !s.is_active) return false;
    if (availability === 'retired' && s.is_active) return false;
    return matches(s.name, s.service_code, s.category, s.description);
  });

  const visibleMappings = engagements.filter((e) => {
    if (mappingService !== 'all' && e.service_id !== mappingService) return false;
    if (mappingStatus === 'current' && !isCurrentEngagement(e.status)) return false;
    if (mappingStatus !== 'current' && mappingStatus !== 'all' && e.status !== mappingStatus) return false;
    return matches(e.client?.full_name, e.client?.account_number, serviceById[e.service_id]?.name);
  });

  const switchView = (next) => {
    setView(next);
    setSearch('');
  };

  const showMappingsFor = (serviceId) => {
    setMappingService(serviceId);
    setMappingStatus('all');
    switchView('mappings');
  };

  const run = async (action) => {
    setActionError('');
    try {
      await action();
    } catch (err) {
      setActionError(err?.message || 'That did not work. Please try again.');
    }
  };

  const toggleActive = (s) => {
    if (s.is_active && !window.confirm(
      `Retire "${s.name}"? It stays on record with its client mappings, but can no longer be mapped to new clients.`,
    )) return;
    run(() => setServiceActive(s.id, !s.is_active));
  };

  const removeService = (s) => {
    if (!window.confirm(`Delete "${s.name}" and its price list? This cannot be undone.`)) return;
    run(() => deleteService(s.id));
  };

  const hasOfferedService = services.some(s => s.is_active);

  return (
    <div className="space-y-5">
      {(error || actionError) && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 text-sm" role="alert">
          <Icon name="AlertCircle" size={16} color="currentColor" className="flex-shrink-0" />
          <span className="flex-1">{actionError || error}</span>
          {actionError && (
            <button onClick={() => setActionError('')} aria-label="Dismiss">
              <Icon name="X" size={14} color="currentColor" />
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon="Briefcase" label="Services offered" value={summary.activeServices} />
        <Stat icon="Tags" label="Price options" value={summary.priceOptions} />
        <Stat icon="Users" label="Clients served" value={summary.clientsServed} />
        <Stat icon="Link" label="Current mappings" value={summary.currentMappings} />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 p-1 bg-muted rounded-xl" role="tablist" aria-label="Services view">
          {[
            { id: 'catalogue', label: 'Service catalogue' },
            { id: 'mappings',  label: 'Client mappings' },
          ].map(v => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              onClick={() => switchView(v.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-smooth ${
                view === v.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="flex-1 min-w-48">
          <Input
            placeholder={view === 'catalogue' ? 'Search services…' : 'Search clients or services…'}
            value={search}
            onChange={e => setSearch(e.target.value)}
            prefix={<Icon name="Search" size={14} color="currentColor" />}
          />
        </div>
        {view === 'catalogue' ? (
          <Select className="w-40" options={AVAILABILITY} value={availability} onChange={setAvailability} />
        ) : (
          <>
            <Select
              className="w-48"
              options={[{ value: 'all', label: 'All services' }, ...services.map(s => ({ value: s.id, label: s.name }))]}
              value={mappingService}
              onChange={setMappingService}
            />
            <Select className="w-36" options={MAPPING_STATUS} value={mappingStatus} onChange={setMappingStatus} />
          </>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEngagementForm({})}
          disabled={!hasOfferedService}
          title={hasOfferedService ? undefined : 'Add a service first'}
          icon={<Icon name="UserPlus" size={14} color="currentColor" />}
        >
          Map Client
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setServiceForm({ service: null })}
          icon={<Icon name="Plus" size={14} color="white" />}
        >
          Add Service
        </Button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <div key={i} className="h-64 rounded-2xl bg-muted animate-pulse" />)}
        </div>
      ) : view === 'catalogue' ? (
        visibleServices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-center">
            <Icon name="Briefcase" size={48} color="currentColor" />
            <p className="mt-3 text-base font-semibold text-foreground">
              {services.length === 0 ? 'No services yet' : 'No services match'}
            </p>
            <p className="text-sm mt-1 max-w-md">
              {services.length === 0
                ? 'List what your firm offers and how each service is priced — unit, hourly, flat fee, package, retainer, project fee or success fee — then map clients to them.'
                : 'Try another search, or show retired services.'}
            </p>
            {services.length === 0 && (
              <Button
                variant="primary"
                size="sm"
                className="mt-4"
                onClick={() => setServiceForm({ service: null })}
                icon={<Icon name="Plus" size={14} color="white" />}
              >
                Add your first service
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {visibleServices.map(s => (
              <ServiceCard
                key={s.id}
                service={s}
                options={optionsByService[s.id] || []}
                engagements={engagementsByService[s.id] || []}
                onEdit={() => setServiceForm({ service: s })}
                onMapClient={() => setEngagementForm({ presetServiceId: s.id })}
                onOpenMapping={e => setEngagementForm({ engagement: e })}
                onViewMappings={() => showMappingsFor(s.id)}
                onToggleActive={() => toggleActive(s)}
                onDelete={() => removeService(s)}
              />
            ))}
          </div>
        )
      ) : visibleMappings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-center">
          <Icon name="Link" size={48} color="currentColor" />
          <p className="mt-3 text-base font-semibold text-foreground">
            {engagements.length === 0 ? 'No clients mapped yet' : 'No mappings match'}
          </p>
          <p className="text-sm mt-1">
            {engagements.length === 0
              ? 'Map a client to a service to record what they take and the terms they agreed.'
              : 'Try another search, service or status.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="hidden md:grid grid-cols-12 gap-4 px-4 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            <span className="col-span-3">Client</span>
            <span className="col-span-3">Service</span>
            <span className="col-span-4">Agreed terms</span>
            <span className="col-span-2 text-right">Status</span>
          </div>
          {visibleMappings.map(e => (
            <MappingRow
              key={e.id}
              engagement={e}
              service={serviceById[e.service_id]}
              option={e.cost_structure_id ? optionById[e.cost_structure_id] : null}
              onOpen={eng => setEngagementForm({ engagement: eng })}
            />
          ))}
        </div>
      )}

      {serviceForm && (
        <ServiceFormModal
          service={serviceForm.service}
          options={serviceForm.service ? optionsByService[serviceForm.service.id] || [] : []}
          categories={categories}
          clientsByOption={clientsByOption}
          onSave={saveService}
          onClose={() => setServiceForm(null)}
        />
      )}
      {engagementForm && (
        <EngagementFormModal
          engagement={engagementForm.engagement}
          presetServiceId={engagementForm.presetServiceId}
          services={services}
          optionsByService={optionsByService}
          engagementsByService={engagementsByService}
          clients={clients}
          onSave={saveEngagement}
          onDelete={deleteEngagement}
          onClose={() => setEngagementForm(null)}
        />
      )}
    </div>
  );
};

export default ServicesTab;
