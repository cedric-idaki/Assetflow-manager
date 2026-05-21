import React from 'react';
import Icon from '../../../components/AppIcon';

const InfoItem = ({ label, value }) => (
  <div>
    <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
    <p className="text-sm font-semibold text-foreground">{value || '-'}</p>
  </div>
);

const ClientAssetInfo = ({ client, asset }) => {
  return (
    <div className="bg-card border border-border rounded-xl p-5 mb-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-secondary/10 flex items-center justify-center">
          <Icon name="Users" size={16} color="var(--color-secondary)" />
        </div>
        <h2 className="text-base font-semibold text-foreground">Client &amp; Asset Information</h2>
      </div>
      <div className="grid grid-cols-2 gap-4 mb-4 pb-4 border-b border-border">
        <InfoItem label="Client Name" value={client?.name} />
        <InfoItem label="Account Number" value={client?.accountNumber} />
        <InfoItem label="Email" value={client?.email} />
        <InfoItem label="Phone" value={client?.phone} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <InfoItem label="Asset Name" value={asset?.name} />
        <InfoItem label="Asset Type" value={asset?.type} />
        <InfoItem label="Asset ID" value={asset?.id} />
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">Ownership Status</p>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
            asset?.status === 'active' || asset?.status === 'reserved' ?'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' :'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
          }`}>
            <div className="w-1.5 h-1.5 rounded-full bg-current" />
            {asset?.status ? asset?.status?.charAt(0)?.toUpperCase() + asset?.status?.slice(1) : 'Active'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default ClientAssetInfo;
