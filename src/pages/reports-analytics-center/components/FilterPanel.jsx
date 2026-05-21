import React from 'react';
import Select from '../../../components/ui/Select';
import Input from '../../../components/ui/Input';
import Button from '../../../components/ui/Button';

const FilterPanel = ({ filters, onFilterChange, onApply, onReset }) => {
  const dateRangeOptions = [
    { value: 'today', label: 'Today' },
    { value: 'week', label: 'This Week' },
    { value: 'month', label: 'This Month' },
    { value: 'quarter', label: 'This Quarter' },
    { value: 'year', label: 'This Year' },
    { value: 'custom', label: 'Custom Range' }
  ];

  const assetTypeOptions = [
    { value: 'all', label: 'All Assets' },
    { value: 'property', label: 'Property' },
    { value: 'vehicles', label: 'Vehicles' },
    { value: 'goods', label: 'Goods' },
    { value: 'services', label: 'Services' }
  ];

  const paymentMethodOptions = [
    { value: 'all', label: 'All Methods' },
    { value: 'cash', label: 'Cash' },
    { value: 'bank_deposit', label: 'Bank Deposit' },
    { value: 'bank_transfer', label: 'Bank Transfer' },
    { value: 'mpesa', label: 'M-Pesa' },
    { value: 'card', label: 'Credit/Debit Card' }
  ];

  const regionOptions = [
    { value: 'all', label: 'All Regions' },
    { value: 'nairobi', label: 'Nairobi' },
    { value: 'mombasa', label: 'Mombasa' },
    { value: 'kisumu', label: 'Kisumu' },
    { value: 'nakuru', label: 'Nakuru' }
  ];

  return (
    <div className="bg-card border border-border rounded-xl p-5 ">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-foreground">Filters</h3>
        <Button variant="ghost" size="sm" iconName="X" onClick={onReset}>
          Clear All
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        <Select
          label="Date Range"
          options={dateRangeOptions}
          value={filters?.dateRange}
          onChange={(value) => onFilterChange('dateRange', value)}
        />

        {filters?.dateRange === 'custom' && (
          <>
            <Input
              label="Start Date"
              type="date"
              value={filters?.startDate}
              onChange={(e) => onFilterChange('startDate', e?.target?.value)}
            />
            <Input
              label="End Date"
              type="date"
              value={filters?.endDate}
              onChange={(e) => onFilterChange('endDate', e?.target?.value)}
            />
          </>
        )}

        <Select
          label="Asset Type"
          options={assetTypeOptions}
          value={filters?.assetType}
          onChange={(value) => onFilterChange('assetType', value)}
        />

        <Select
          label="Payment Method"
          options={paymentMethodOptions}
          value={filters?.paymentMethod}
          onChange={(value) => onFilterChange('paymentMethod', value)}
        />

        <Select
          label="Region"
          options={regionOptions}
          value={filters?.region}
          onChange={(value) => onFilterChange('region', value)}
        />
      </div>
      <div className="flex justify-end">
        <Button variant="default" iconName="Filter" iconPosition="left" onClick={onApply}>
          Apply Filters
        </Button>
      </div>
    </div>
  );
};

export default FilterPanel;