/**
 * EXPORT MODAL — pick the format and what goes in the file.
 *
 * Every control here used to be decorative: the handler behind it wrote the
 * whole dashboard as a CSV whatever was chosen. The three checkboxes now name
 * real groups of tables (see SECTION_GROUP in utils/kycReportSections.js), and
 * the format is honoured by the writers in utils/reportExport.js.
 *
 * "Charts and graphs" is the one that needed renaming rather than wiring. A
 * spreadsheet cannot hold a picture of a chart, and printing one into the PDF
 * would mean rasterising live SVG whose colours are CSS variables. What a
 * reader opening the file actually wants is the SERIES behind each chart, so
 * that is what the option offers and what it is now called.
 */

import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Select from '../../../components/ui/Select';
import { Checkbox } from '../../../components/ui/Checkbox';
import { FORMATS } from '../../../utils/reportExport';

const ExportModal = ({ isOpen, onClose, reportTitle, onExport, defaultFormat = 'pdf', busy = false }) => {
  const [exportFormat, setExportFormat] = useState(defaultFormat);
  const [includeSummary, setIncludeSummary] = useState(true);
  const [includeCharts, setIncludeCharts] = useState(true);
  const [includeRawData, setIncludeRawData] = useState(true);

  // The button that opened this said which format it meant, so the modal opens
  // on it. Re-synced per opening rather than once, or "Export Excel" would show
  // PDF for anyone who had already opened the dialog from the PDF button.
  useEffect(() => {
    if (isOpen) setExportFormat(defaultFormat);
  }, [isOpen, defaultFormat]);

  if (!isOpen) return null;

  const nothingChosen = !includeSummary && !includeCharts && !includeRawData;

  const handleExport = () => {
    onExport({
      format: exportFormat,
      options: { includeSummary, includeCharts, includeRawData },
    });
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
            options={FORMATS.map(f => ({ value: f.value, label: f.label, description: f.hint }))}
            value={exportFormat}
            onChange={setExportFormat}
          />

          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">Include in Export:</p>
            <Checkbox
              label="Summary statistics"
              description="The KPI figures at the top of the dashboard"
              checked={includeSummary}
              onChange={(e) => setIncludeSummary(e?.target?.checked)}
            />
            <Checkbox
              label="Chart data"
              description="The series behind each chart, as tables"
              checked={includeCharts}
              onChange={(e) => setIncludeCharts(e?.target?.checked)}
            />
            <Checkbox
              label="Segment breakdown"
              description="The aging analysis, split by client segment"
              checked={includeRawData}
              onChange={(e) => setIncludeRawData(e?.target?.checked)}
            />
            {nothingChosen && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Tick at least one — there would be nothing in the file.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 p-4 md:p-5 border-t border-border">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button
            variant="default"
            iconName={busy ? 'Loader' : 'Download'}
            iconPosition="left"
            onClick={handleExport}
            disabled={nothingChosen || busy}
            className="flex-1"
          >
            {busy ? 'Writing…' : 'Export Report'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ExportModal;
