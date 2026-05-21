import React from 'react';
import Icon from '../../../components/AppIcon';

const ConfirmationHeader = ({ transactionId, timestamp, amount }) => {
  return (
    <div className="text-center mb-8">
      <div className="flex items-center justify-center w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-900/30 mx-auto mb-4 shadow-lg shadow-emerald-500/20">
        <div className="flex items-center justify-center w-14 h-14 rounded-full bg-emerald-500">
          <Icon name="CheckCircle" size={32} color="white" />
        </div>
      </div>
      <h1 className="text-2xl font-bold text-foreground mb-1">
        Payment Confirmed
      </h1>
      <p className="text-muted-foreground text-sm mb-4">Your transaction has been successfully processed</p>
      <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-emerald-700 dark:text-emerald-400 text-sm font-semibold">Verified &amp; Processed</span>
      </div>
    </div>
  );
};

export default ConfirmationHeader;
