import React from 'react';
import Icon from '../../../components/AppIcon';

const PaymentMethodSelector = ({ selectedMethod, onMethodChange }) => {
  const paymentMethods = [
    {
      id: 'cash',
      name: 'Cash',
      icon: 'Banknote',
      description: 'Physical cash payment',
    },
    {
      id: 'bank_deposit',
      name: 'Bank Deposit',
      icon: 'Building2',
      description: 'Direct bank deposit',
    },
    {
      id: 'bank_transfer',
      name: 'Bank Transfer',
      icon: 'ArrowRightLeft',
      description: 'Electronic bank transfer',
    },
    {
      id: 'mpesa',
      name: 'M-Pesa',
      icon: 'Smartphone',
      description: 'Mobile money payment',
    },
    {
      id: 'card',
      name: 'Credit/Debit Card',
      icon: 'CreditCard',
      description: 'Card payment',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
      {paymentMethods?.map((method) => (
        <button
          key={method?.id}
          onClick={() => onMethodChange(method?.id)}
          className={`flex items-start p-4 rounded-lg border-2 transition-smooth hover-lift press-scale ${
            selectedMethod === method?.id
              ? 'border-primary bg-primary bg-opacity-5' :'border-border bg-card hover:border-primary hover:border-opacity-30'
          }`}
        >
          <div
            className={`flex items-center justify-center w-10 h-10 md:w-12 md:h-12 rounded-xl flex-shrink-0 ${
              selectedMethod === method?.id
                ? 'bg-primary bg-opacity-10' :'bg-muted'
            }`}
          >
            <Icon
              name={method?.icon}
              size={20}
              color={
                selectedMethod === method?.id
                  ? 'var(--color-primary)'
                  : 'var(--color-muted-foreground)'
              }
            />
          </div>
          <div className="ml-3 text-left">
            <p
              className={`text-sm md:text-base font-medium ${
                selectedMethod === method?.id
                  ? 'text-primary' :'text-foreground'
              }`}
            >
              {method?.name}
            </p>
            <p className="text-xs md:text-sm text-muted-foreground mt-1">
              {method?.description}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
};

export default PaymentMethodSelector;