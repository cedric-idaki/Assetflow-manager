import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Select from '../../../components/ui/Select';
import { Checkbox } from '../../../components/ui/Checkbox';

const ExportModal = ({ isOpen, onClose, reportTitle, onExport }) => {
  const [exportFormat, setExportFormat] = useState('pdf');
  const [includeSummary, setIncludeSummary] = useState(true);
  const [includeCharts, setIncludeCharts] = useState(true);
  const [includeRawData, setIncludeRawData] = useState(false);

  if (!isOpen) return null;

  const formatOptions = [
    { value: 'pdf', label: 'PDF Document' },
    { value: 'excel', label: 'Excel Spreadsheet' },
    { value: 'csv', label: 'CSV File' }
  ];

  const handleExport = () => {
    onExport({
      format: exportFormat,
      options: {
        includeSummary,
        includeCharts,
        includeRawData
      }
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-background bg-opacity-80">
      <div className="bg-card border border-border rounded-lg shadow-lg w-full max-w-md">
        <div className="flex items-center justify-between p-5  border-b border-border">
          <h3 className="text-base md:text-xl font-semibold text-foreground">Export Report</h3>
          <button
            onClick={onClose}
            className="p-2 rounded-md hover:bg-muted transition-smooth"
            aria-label="Close modal"
          >
            <Icon name="X" size={20} color="var(--color-foreground)" />
          </button>
        </div>

        <div className="p-4 md:p-5 space-y-4">
          <div>
            <p className="text-sm text-muted-foreground mb-2">Report: {reportTitle}</p>
          </div>

          <Select
            label="Export Format"
            options={formatOptions}
            value={exportFormat}
            onChange={setExportFormat}
          />

          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">Include in Export:</p>
            <Checkbox
              label="Summary Statistics"
              checked={includeSummary}
              onChange={(e) => setIncludeSummary(e?.target?.checked)}
            />
            <Checkbox
              label="Charts and Graphs"
              checked={includeCharts}
              onChange={(e) => setIncludeCharts(e?.target?.checked)}
              disabled={exportFormat === 'csv'}
            />
            <Checkbox
              label="Raw Data Tables"
              checked={includeRawData}
              onChange={(e) => setIncludeRawData(e?.target?.checked)}
            />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 p-4 md:p-5 border-t border-border">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button variant="default" iconName="Download" iconPosition="left" onClick={handleExport} className="flex-1">
            Export Report
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ExportModal;