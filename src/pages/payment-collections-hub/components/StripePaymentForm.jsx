import React, { useState } from 'react';
import { useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js';
import { supabase } from '../../../lib/supabase';
import Button from '../../../components/ui/Button';
import Icon from '../../../components/AppIcon';

const StripePaymentForm = ({ clientSecret, amount, onSuccess, onCancel }) => {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!stripe || !elements) return;

    setIsProcessing(true);
    setErrorMessage('');

    try {
      const { error, paymentIntent } = await stripe?.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location?.origin}/payment-collections-hub`,
        },
        redirect: 'if_required',
      });

      if (error) {
        setErrorMessage(error?.message || 'Payment failed. Please try again.');
        setIsProcessing(false);
        return;
      }

      if (paymentIntent?.status === 'succeeded') {
        // Confirm on backend and update DB
        const { data, error: confirmError } = await supabase?.functions?.invoke('confirm-payment', {
          body: { paymentIntentId: paymentIntent?.id },
        });

        if (confirmError) {
          console.error('Confirmation error:', confirmError);
        }

        onSuccess?.(paymentIntent, data?.record);
      } else {
        setErrorMessage('Payment was not completed. Please try again.');
      }
    } catch (err) {
      setErrorMessage('An unexpected error occurred. Please try again.');
      console.error('Stripe payment error:', err);
    }

    setIsProcessing(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="p-4 rounded-xl bg-primary/5 border border-primary/20">
        <div className="flex items-center gap-2 mb-1">
          <Icon name="Lock" size={14} color="var(--color-primary)" />
          <span className="text-xs font-medium text-primary">Secure Payment via Stripe</span>
        </div>
        <p className="text-xs text-muted-foreground">Your card details are encrypted and processed securely.</p>
      </div>
      <div className="p-4 rounded-xl border border-border bg-background">
        <PaymentElement
          options={{
            layout: 'tabs',
          }}
        />
      </div>
      {errorMessage && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
          <Icon name="AlertCircle" size={16} color="currentColor" />
          <span>{errorMessage}</span>
        </div>
      )}
      <div className="p-3 rounded-xl bg-muted/50 border border-border">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Total Amount</span>
          <span className="text-2xl font-bold text-foreground">
            ${parseFloat(amount || 0)?.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </span>
        </div>
      </div>
      <div className="flex gap-3">
        <Button
          type="submit"
          variant="default"
          fullWidth
          disabled={!stripe || isProcessing}
          iconName={isProcessing ? 'Loader' : 'CreditCard'}
          iconPosition="left"
          onClick={handleSubmit}
        >
          {isProcessing ? 'Processing...' : `Pay $${parseFloat(amount || 0)?.toFixed(2)}`}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isProcessing}
          iconName="X"
          iconPosition="left"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
};

export default StripePaymentForm;
