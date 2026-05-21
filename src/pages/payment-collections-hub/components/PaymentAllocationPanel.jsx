import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Input from '../../../components/ui/Input';
import Button from '../../../components/ui/Button';

const PaymentAllocationPanel = ({ totalAmount, linkedAssets, onAllocationChange }) => {
  const [allocations, setAllocations] = useState(
    linkedAssets?.map((asset) => ({
      assetId: asset?.id,
      assetName: asset?.name,
      percentage: 0,
      amount: 0,
    }))
  );

  const [totalPercentage, setTotalPercentage] = useState(0);

  useEffect(() => {
    const total = allocations?.reduce((sum, alloc) => sum + alloc?.percentage, 0);
    setTotalPercentage(total);
    onAllocationChange(allocations);
  }, [allocations, onAllocationChange]);

  const handlePercentageChange = (assetId, value) => {
    const percentage = parseFloat(value) || 0;
    const amount = (totalAmount * percentage) / 100;

    setAllocations((prev) =>
      prev?.map((alloc) =>
        alloc?.assetId === assetId
          ? { ...alloc, percentage, amount }
          : alloc
      )
    );
  };

  const handleAutoDistribute = () => {
    const equalPercentage = 100 / linkedAssets?.length;
    setAllocations((prev) =>
      prev?.map((alloc) => ({
        ...alloc,
        percentage: equalPercentage,
        amount: (totalAmount * equalPercentage) / 100,
      }))
    );
  };

  const isValid = Math.abs(totalPercentage - 100) < 0.01;

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <div className="flex items-center justify-between mb-4 md:mb-6">
        <h3 className="text-base md:text-xl font-heading font-semibold text-foreground">
          Payment Allocation
        </h3>
        <Button
          variant="outline"
          size="sm"
          iconName="Percent"
          iconPosition="left"
          onClick={handleAutoDistribute}
        >
          Auto Distribute
        </Button>
      </div>
      <div className="space-y-4">
        {allocations?.map((alloc) => (
          <div
            key={alloc?.assetId}
            className="p-4 rounded-lg bg-muted bg-opacity-50 border border-border"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-3">
                <div className="flex items-center justify-center w-8 h-8 md:w-10 md:h-10 rounded-lg bg-primary bg-opacity-10">
                  <Icon
                    name="Package"
                    size={16}
                    color="var(--color-primary)"
                  />
                </div>
                <div>
                  <p className="text-sm md:text-base font-medium text-foreground">
                    {alloc?.assetName}
                  </p>
                  <p className="text-xs md:text-sm text-muted-foreground">
                    Asset ID: {alloc?.assetId}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
              <Input
                label="Percentage (%)"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={alloc?.percentage}
                onChange={(e) =>
                  handlePercentageChange(alloc?.assetId, e?.target?.value)
                }
                placeholder="0.00"
              />
              <Input
                label="Amount ($)"
                type="text"
                value={alloc?.amount?.toFixed(2)}
                disabled
                className="bg-muted"
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-6 p-4 rounded-xl bg-background border-2 border-border">
        <div className="flex items-center justify-between">
          <span className="text-sm md:text-base font-medium text-foreground">
            Total Allocation
          </span>
          <div className="flex items-center space-x-3">
            <span
              className={`text-base md:text-xl font-heading font-semibold ${
                isValid ? 'text-success' : 'text-error'
              }`}
            >
              {totalPercentage?.toFixed(2)}%
            </span>
            {isValid ? (
              <Icon name="CheckCircle2" size={20} color="var(--color-success)" />
            ) : (
              <Icon name="AlertCircle" size={20} color="var(--color-error)" />
            )}
          </div>
        </div>
        {!isValid && (
          <p className="text-xs md:text-sm text-error mt-2">
            Total allocation must equal 100%
          </p>
        )}
      </div>
    </div>
  );
};

export default PaymentAllocationPanel;