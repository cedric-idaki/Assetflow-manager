import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Select from '../../../components/ui/Select';

const LinkAssetClientModal = ({ onClose, onSubmit, type, data, assets, clients }) => {
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState('');

  const isLinkingAsset = type === 'asset';
  const options = isLinkingAsset
    ? clients?.map(client => ({
        value: client?.accountNumber,
        label: `${client?.fullName} (${client?.accountNumber})`,
        description: client?.email
      }))
    : assets?.map(asset => ({
        value: asset?.id,
        label: `${asset?.description} (${asset?.id})`,
        description: `${asset?.type} - $${asset?.sellingPrice?.toLocaleString()}`
      }));

  const handleSubmit = () => {
    if (!selectedId) {
      setError(isLinkingAsset ? 'Please select a client' : 'Please select an asset');
      return;
    }
    onSubmit(data, selectedId);
  };

  return (
    <div className="fixed inset-0 bg-background bg-opacity-50 z-[110] flex items-center justify-center p-4">
      <div className="bg-card rounded-lg shadow-lg w-full max-w-md">
        <div className="flex items-center justify-between p-4 md:p-6 border-b border-border">
          <h2 className="text-2xl  font-semibold text-foreground">
            {isLinkingAsset ? 'Link Client to Asset' : 'Link Asset to Client'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-md hover:bg-muted transition-smooth"
            aria-label="Close modal"
          >
            <Icon name="X" size={20} color="var(--color-foreground)" />
          </button>
        </div>

        <div className="p-5 md:p-6">
          <div className="mb-6 p-4 bg-muted rounded-xl">
            <p className="text-sm text-muted-foreground mb-1">
              {isLinkingAsset ? 'Asset' : 'Client'}
            </p>
            <p className="font-medium text-foreground">
              {isLinkingAsset ? data?.description : data?.fullName}
            </p>
            <p className="text-sm text-muted-foreground">
              {isLinkingAsset ? `ID: ${data?.id}` : `Account: ${data?.accountNumber}`}
            </p>
          </div>

          <Select
            label={isLinkingAsset ? 'Select Client' : 'Select Asset'}
            required
            searchable
            options={options}
            value={selectedId}
            onChange={(value) => {
              setSelectedId(value);
              setError('');
            }}
            error={error}
            placeholder={isLinkingAsset ? 'Search and select client' : 'Search and select asset'}
          />
        </div>

        <div className="flex items-center justify-end gap-3 p-4 md:p-6 border-t border-border">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="default" iconName="Link" iconPosition="left" onClick={handleSubmit}>
            Link {isLinkingAsset ? 'Client' : 'Asset'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default LinkAssetClientModal;