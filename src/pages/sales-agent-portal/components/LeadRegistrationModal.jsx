import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import { formatKEPhone } from '../../../utils/phoneUtils';
import Select from '../../../components/ui/Select';

const LeadRegistrationModal = ({ isOpen, onClose, onSubmit }) => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    assetInterest: '',
    budgetRange: '',
    priority: 'medium',
    source: '',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const priorityOptions = [
    { value: 'high', label: 'High Priority' },
    { value: 'medium', label: 'Medium Priority' },
    { value: 'low', label: 'Low Priority' },
  ];

  const sourceOptions = [
    { value: 'referral', label: 'Referral' },
    { value: 'website', label: 'Website' },
    { value: 'social_media', label: 'Social Media' },
    { value: 'walk_in', label: 'Walk-in' },
    { value: 'cold_call', label: 'Cold Call' },
  ];

  const handleChange = (field, value) => setFormData((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!formData?.name || !formData?.phone) { setSubmitError('Name and phone are required'); return; }
    setSubmitting(true);
    setSubmitError('');
    try {
      await onSubmit(formData);
      setFormData({ name: '', email: '', phone: '', assetInterest: '', budgetRange: '', priority: 'medium', source: '', notes: '' });
      onClose();
    } catch (err) {
      setSubmitError(err?.message || 'Failed to register lead');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto scrollbar-custom">
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-xl text-foreground">Register New Lead</h2>
          <button onClick={onClose} className="p-2 rounded-md hover:bg-muted transition-colors" aria-label="Close">
            <Icon name="X" size={20} color="var(--color-foreground)" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Full Name *"
              type="text"
              placeholder="Enter lead's full name"
              value={formData?.name}
              onChange={(e) => handleChange('name', e?.target?.value)}
              required
            />
            <Input
              label="Email Address"
              type="email"
              placeholder="lead@example.com"
              value={formData?.email}
              onChange={(e) => handleChange('email', e?.target?.value)}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Phone Number *"
              type="tel"
              placeholder="+254 700 000 000"
              value={formData?.phone}
              onChange={(e) => handleChange('phone', formatKEPhone(e?.target?.value))}
              required
            />
            <Input
              label="Budget Range"
              type="text"
              placeholder="e.g., 2,000,000 - 5,000,000"
              value={formData?.budgetRange}
              onChange={(e) => handleChange('budgetRange', e?.target?.value)}
            />
          </div>

          <Input
            label="Asset Interest"
            type="text"
            placeholder="e.g., 3-bedroom apartment in Westlands"
            value={formData?.assetInterest}
            onChange={(e) => handleChange('assetInterest', e?.target?.value)}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select
              label="Priority"
              options={priorityOptions}
              value={formData?.priority}
              onChange={(value) => handleChange('priority', value)}
            />
            <Select
              label="Lead Source"
              options={sourceOptions}
              value={formData?.source}
              onChange={(value) => handleChange('source', value)}
              placeholder="Select source"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Notes</label>
            <textarea
              value={formData?.notes}
              onChange={(e) => handleChange('notes', e?.target?.value)}
              placeholder="Additional information about the lead..."
              rows={3}
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors"
            />
          </div>

          {submitError && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-200 rounded-lg">
              <Icon name="AlertCircle" size={16} color="var(--color-error)" />
              <p className="text-sm text-red-600">{submitError}</p>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
            <Button type="submit" variant="default" disabled={submitting}>
              {submitting ? 'Registering...' : 'Register Lead'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LeadRegistrationModal;