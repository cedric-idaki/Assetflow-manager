import React from 'react';
import Icon from '../../../../components/AppIcon';
import {
  describeTerms,
  engagementStatusMeta,
  isCurrentEngagement,
  pricingModelLabel,
  pricingModelMeta,
} from '../../../../config/consultancyPricing';

const SHOWN_CLIENTS = 3;

/** One service in the catalogue: its price list and who is on it. */
const ServiceCard = ({
  service,
  options = [],
  engagements = [],
  onEdit,
  onMapClient,
  onOpenMapping,
  onViewMappings,
  onToggleActive,
  onDelete,
}) => {
  const current = engagements.filter(e => isCurrentEngagement(e.status));

  return (
    <div
      data-testid="service-card"
      className={`bg-card border border-border rounded-2xl p-4 flex flex-col hover:shadow-lg transition-all ${
        service.is_active ? '' : 'opacity-80'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground truncate">
            {service.service_code}{service.category ? ` · ${service.category}` : ''}
          </p>
          <h3 className="font-bold text-foreground text-base mt-0.5 line-clamp-2">{service.name}</h3>
        </div>
        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
          service.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}
        >
          {service.is_active ? 'Offered' : 'Retired'}
        </span>
      </div>

      {service.description && (
        <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{service.description}</p>
      )}

      {/* Price list */}
      <div className="mt-4">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">Price options</p>
        {options.length === 0 ? (
          <p className="text-sm text-muted-foreground">No price set — priced per client when mapped</p>
        ) : (
          <ul className="space-y-1.5">
            {options.map(o => (
              <li key={o.id} className="flex items-start gap-2">
                <Icon
                  name={pricingModelMeta(o.pricing_model)?.icon || 'Tag'}
                  size={14}
                  color="#1A56DB"
                  className="mt-0.5 flex-shrink-0"
                />
                <div className="min-w-0 text-sm">
                  <p className="text-foreground">
                    <span className="font-medium">{pricingModelLabel(o.pricing_model)}</span>
                    {o.label && <span className="text-muted-foreground"> · {o.label}</span>}
                    {o.is_default && options.length > 1 && (
                      <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-primary">Default</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{describeTerms(o).headline}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Clients */}
      <div className="mt-4">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">
          Clients ({current.length})
        </p>
        {engagements.length === 0 ? (
          <p className="text-sm text-muted-foreground">No clients mapped yet</p>
        ) : (
          <div className="space-y-0.5">
            {current.slice(0, SHOWN_CLIENTS).map((e) => {
              const st = engagementStatusMeta(e.status);
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onOpenMapping(e)}
                  className="w-full flex items-center justify-between gap-2 text-sm py-1 text-left text-foreground hover:text-primary"
                >
                  <span className="truncate">{e.client?.full_name || 'Client'}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${st.cls}`}>{st.label}</span>
                </button>
              );
            })}
            {(current.length > SHOWN_CLIENTS || engagements.length > current.length) && (
              <button type="button" onClick={onViewMappings} className="text-xs font-medium text-primary hover:underline pt-1">
                View all {engagements.length} {engagements.length === 1 ? 'mapping' : 'mappings'} →
              </button>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="mt-auto pt-4 flex items-center gap-2">
        {service.is_active && (
          <button
            type="button"
            onClick={onMapClient}
            className="flex-1 py-2 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-1.5 transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
          >
            <Icon name="UserPlus" size={14} color="white" /> Map client
          </button>
        )}
        <button
          type="button"
          onClick={onEdit}
          className="flex-1 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all flex items-center justify-center gap-1.5"
        >
          <Icon name="Edit" size={13} color="currentColor" /> Edit
        </button>
        <button
          type="button"
          onClick={onToggleActive}
          className="py-2 px-3 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
        >
          {service.is_active ? 'Retire' : 'Reactivate'}
        </button>
        {engagements.length === 0 && (
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${service.name}`}
            className="p-2 rounded-lg border border-border text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-all"
          >
            <Icon name="Trash2" size={13} color="currentColor" />
          </button>
        )}
      </div>
    </div>
  );
};

export default ServiceCard;
