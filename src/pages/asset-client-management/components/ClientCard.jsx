import React from 'react';
import Icon from '../../../components/AppIcon';
import Image from '../../../components/AppImage';
import Button from '../../../components/ui/Button';

const ClientCard = ({ client, onEdit, onView, onLink }) => {
  const getKycStatusColor = (status) => {
    const colors = {
      verified: 'text-success bg-success bg-opacity-10',
      pending: 'text-warning bg-warning bg-opacity-10',
      incomplete: 'text-error bg-error bg-opacity-10'
    };
    return colors?.[status] || colors?.incomplete;
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4 md:p-6 hover-lift transition-smooth">
      <div className="flex items-start gap-4 mb-4">
        <div className="w-16 h-16 md:w-20 md:h-20 rounded-full overflow-hidden border-2 border-primary flex-shrink-0">
          {client?.photoUrl ? (
            <Image
              src={client?.photoUrl}
              alt={`Professional passport photo of ${client?.fullName} for client identification and KYC verification purposes`}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-muted flex items-center justify-center">
              <Icon name="User" size={32} color="var(--color-muted-foreground)" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-foreground font-heading line-clamp-1">
                {client?.fullName}
              </h3>
              <p className="text-sm text-muted-foreground">Account: {client?.accountNumber}</p>
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-medium capitalize whitespace-nowrap ${getKycStatusColor(client?.kycStatus)}`}>
              {client?.kycStatus}
            </span>
          </div>
        </div>
      </div>
      <div className="space-y-2 mb-4">
        <div className="flex items-center gap-2 text-sm">
          <Icon name="Mail" size={16} color="var(--color-muted-foreground)" />
          <span className="text-foreground line-clamp-1">{client?.email}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Icon name="Phone" size={16} color="var(--color-muted-foreground)" />
          <span className="text-foreground">{client?.phone}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Icon name="MapPin" size={16} color="var(--color-muted-foreground)" />
          <span className="text-foreground line-clamp-1">{client?.city}, {client?.country}</span>
        </div>
      </div>
      {client?.linkedAssets && client?.linkedAssets?.length > 0 && (
        <div className="mb-4 p-3 bg-muted rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground font-medium">Linked Assets</p>
            <span className="text-xs font-semibold text-primary">{client?.linkedAssets?.length}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {client?.linkedAssets?.slice(0, 3)?.map((asset, index) => (
              <span key={index} className="px-2 py-1 bg-background rounded text-xs text-foreground">
                {asset}
              </span>
            ))}
            {client?.linkedAssets?.length > 3 && (
              <span className="px-2 py-1 bg-background rounded text-xs text-muted-foreground">
                +{client?.linkedAssets?.length - 3} more
              </span>
            )}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" iconName="Edit" iconPosition="left" onClick={() => onEdit(client)}>
          Edit
        </Button>
        <Button variant="outline" size="sm" iconName="Link" iconPosition="left" onClick={() => onLink(client)}>
          Link Asset
        </Button>
        <Button variant="ghost" size="sm" iconName="Eye" iconPosition="left" onClick={() => onView(client)}>
          View
        </Button>
      </div>
    </div>
  );
};

export default ClientCard;