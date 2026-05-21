-- Add Stripe payment columns to payments table
ALTER TABLE public.payments
ADD COLUMN IF NOT EXISTS payment_intent_id TEXT,
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
ADD COLUMN IF NOT EXISTS stripe_charge_id TEXT;

-- Index for fast lookup by payment_intent_id
CREATE INDEX IF NOT EXISTS idx_payments_payment_intent_id ON public.payments(payment_intent_id);
