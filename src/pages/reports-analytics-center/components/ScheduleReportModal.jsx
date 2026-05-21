import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Select from '../../../components/ui/Select';
import Input from '../../../components/ui/Input';
import { Checkbox } from '../../../components/ui/Checkbox';

const ScheduleReportModal = ({ isOpen, onClose, reportTitle, onSchedule }) => {
  const [frequency, setFrequency] = useState('weekly');
  const [recipients, setRecipients] = useState('');
  const [includeAttachment, setIncludeAttachment] = useState(true);

  if (!isOpen) return null;

  const frequencyOptions = [
    { value: 'daily',     label: 'Daily' },
    { value: 'weekly',    label: 'Weekly' },
    { value: 'monthly',   label: 'Monthly' },
    { value: 'quarterly', label: 'Quarterly' },
  ];

  const handleSchedule = () => {
    if (!recipients.trim()) return;
    onSchedule({
      frequency,
      recipients: recipients?.split(',')?.map(email => email?.trim()).filter(Boolean),
      includeAttachment,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-background bg-opacity-80">
      <div className="bg-card border border-border rounded-xl shadow-lg w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3 className="text-base font-semibold text-foreground">Schedule Report</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-muted transition-colors"
            aria-label="Close modal"
          >
            <Icon name="X" size={18} color="var(--color-foreground)" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-muted-foreground">
            Report: <span className="font-medium text-foreground">{reportTitle}</span>
          </p>

          <Select
            label="Frequency"
            options={frequencyOptions}
            value={frequency}
            onChange={setFrequency}
          />

          <Input
            label="Recipients"
            type="email"
            placeholder="email1@example.com, email2@example.com"
            description="Separate multiple emails with commas"
            value={recipients}
            onChange={(e) => setRecipients(e?.target?.value)}
          />

          <Checkbox
            label="Include report as attachment"
            checked={includeAttachment}
            onChange={(e) => setIncludeAttachment(e?.target?.checked)}
          />

          {!recipients.trim() && (
            <p className="text-xs text-amber-600">At least one recipient email is required.</p>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2 p-5 border-t border-border">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button
            variant="default"
            iconName="Calendar"
            iconPosition="left"
            onClick={handleSchedule}
            disabled={!recipients.trim()}
            className="flex-1"
          >
            Schedule Report
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ScheduleReportModal;
