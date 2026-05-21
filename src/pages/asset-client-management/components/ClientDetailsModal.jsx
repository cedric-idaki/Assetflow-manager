import React from 'react';
import Icon from '../../../components/AppIcon';
import Image from '../../../components/AppImage';
import Button from '../../../components/ui/Button';

const ClientDetailsModal = ({ client, onClose }) => {
  const getKycStatusColor = (status) => {
    const colors = {
      verified: 'text-success bg-success bg-opacity-10',
      pending: 'text-warning bg-warning bg-opacity-10',
      incomplete: 'text-error bg-error bg-opacity-10'
    };
    return colors?.[status] || colors?.incomplete;
  };

  return (
    <div className="fixed inset-0 bg-background bg-opacity-50 z-[110] flex items-center justify-center p-4">
      <div className="bg-card rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-5 md:p-6 border-b border-border">
          <h2 className="text-2xl font-semibold text-foreground">
            Client Details
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-md hover:bg-muted transition-smooth"
            aria-label="Close modal"
          >
            <Icon name="X" size={20} color="var(--color-foreground)" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-custom p-4 md:p-6">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-20 h-20 md:w-24 md:h-24 rounded-full overflow-hidden border-4 border-primary flex-shrink-0">
              {client?.photoUrl ? (
                <Image
                  src={client?.photoUrl}
                  alt={`Professional passport photo of ${client?.fullName} for client identification and KYC verification purposes`}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-muted flex items-center justify-center">
                  <Icon name="User" size={40} color="var(--color-muted-foreground)" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-2xl font-semibold text-foreground mb-1">
                {client?.fullName}
              </h3>
              <p className="text-sm text-muted-foreground mb-2">Account: {client?.accountNumber}</p>
              <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium capitalize ${getKycStatusColor(client?.kycStatus)}`}>
                KYC {client?.kycStatus}
              </span>
            </div>
          </div>

          <div className="space-y-6">
            <div>
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Personal Information
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Full Name</p>
                  <p className="font-medium text-foreground">{client?.fullName}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">National ID</p>
                  <p className="font-medium text-foreground">{client?.nationalId || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Passport Number</p>
                  <p className="font-medium text-foreground">{client?.passportNumber || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">KRA PIN</p>
                  <p className="font-medium text-foreground">{client?.kraPin || 'N/A'}</p>
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Contact Information
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Email</p>
                  <p className="font-medium text-foreground">{client?.email}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Phone</p>
                  <p className="font-medium text-foreground">{client?.phone}</p>
                </div>
                {client?.alternatePhone && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Alternate Phone</p>
                    <p className="font-medium text-foreground">{client?.alternatePhone}</p>
                  </div>
                )}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Address Information
              </h4>
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Physical Address</p>
                  <p className="font-medium text-foreground">{client?.physicalAddress}</p>
                </div>
                {client?.postalAddress && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Postal Address</p>
                    <p className="font-medium text-foreground">{client?.postalAddress}</p>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">City</p>
                    <p className="font-medium text-foreground">{client?.city}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Country</p>
                    <p className="font-medium text-foreground">{client?.country}</p>
                  </div>
                </div>
              </div>
            </div>

            {client?.linkedAssets && client?.linkedAssets?.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Linked Assets ({client?.linkedAssets?.length})
                </h4>
                <div className="space-y-2">
                  {client?.linkedAssets?.map((asset, index) => (
                    <div key={index} className="p-4 bg-muted rounded-xl">
                      <p className="font-medium text-foreground">{asset}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 p-4 md:p-6 border-t border-border">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ClientDetailsModal;