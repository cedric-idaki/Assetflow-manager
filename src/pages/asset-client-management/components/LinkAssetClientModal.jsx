import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Select from '../../../components/ui/Select';

/**
 * Attach one asset to one client.
 *
 * Opened from either side — an asset card ("who owns this?") or a client card
 * ("what are they buying?") — and in both cases hands the parent the same two
 * arguments in the same order: the assets.id and the clients.id, both database
 * UUIDs. Two things used to be wrong here and each on its own was enough to
 * stop the link from ever being saved:
 *
 *   - `subject` arrived as the wrapper object the page kept in state, so the
 *     parent's lookup of the asset never matched and the update was skipped
 *     without an error;
 *   - the client options carried `accountNumber`, human-facing text, while
 *     `assets.linked_client_id` is a UUID foreign key to clients(id).
 */
const LinkAssetClientModal = ({ onClose, onSubmit, type, subject, assets, clients }) => {
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const isLinkingAsset = type === 'asset';

  const options = isLinkingAsset
    ? (clients || []).map(client => ({
        value: client?._id,
        label: `${client?.fullName} (${client?.accountNumber})`,
        description: client?.email
      }))
    : (assets || []).map(asset => ({
        value: asset?._id,
        label: `${asset?.description} (${asset?.id})`,
        // The current holder is named so staff can see they are about to move
        // an asset off another client rather than filling an empty slot.
        description: [
          asset?.type,
          `KES ${Number(asset?.sellingPrice || 0).toLocaleString()}`,
          asset?.linkedClient ? `currently ${asset.linkedClient}` : null
        ].filter(Boolean).join(' · ')
      }));

  const handleSubmit = async () => {
    if (!selectedId) {
      setError(isLinkingAsset ? 'Please select a client' : 'Please select an asset');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSubmit(
        isLinkingAsset ? subject?._id : selectedId,   // assets.id
        isLinkingAsset ? selectedId  : subject?._id   // clients.id
      );
    } catch (err) {
      setError(err?.message || 'Could not save the link. Please try again.');
    } finally {
      setSaving(false);
    }
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
              {isLinkingAsset ? subject?.description : subject?.fullName}
            </p>
            <p className="text-sm text-muted-foreground">
              {isLinkingAsset ? `ID: ${subject?.id}` : `Account: ${subject?.accountNumber}`}
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
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="default"
            iconName="Link"
            iconPosition="left"
            loading={saving}
            onClick={handleSubmit}
          >
            Link {isLinkingAsset ? 'Client' : 'Asset'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default LinkAssetClientModal;
