-- ----------------------------------------------------------------------------
-- Company invoices — raise an invoice from the Finance Hub.
--
-- The Invoices tab was read-only: it synthesised an "invoice" per row in
-- payments, so a company could only ever see money it had ALREADY received.
-- There was no way to bill a client for something not yet paid.
--
--  1. company_invoices      — one header per invoice (client, dates, totals).
--  2. company_invoice_items — its line items (description, qty, unit price).
--
-- Tenant key is admin_id (the standard company model), defaulted by the shared
-- set_admin_id_default() trigger and enforced by the usual tenant policy.
-- Clients may read their own non-draft invoices so the portal can surface them.
--
-- Invoice numbers are unique per tenant; the app allocates the next number and
-- retries on the unique violation if two staff save at the same moment.
--
-- Idempotent — safe to re-run.
-- ----------------------------------------------------------------------------

-- 1. Invoice header -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.company_invoices (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id       UUID,
  invoice_no     TEXT NOT NULL,
  client_id      UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  -- Snapshot of the bill-to details at issue time: an invoice must still print
  -- correctly after the client record is edited or removed.
  client_name    TEXT,
  client_email   TEXT,
  client_phone   TEXT,
  account_no     TEXT,
  asset_id       UUID REFERENCES public.assets(id) ON DELETE SET NULL,
  issue_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date       DATE,
  currency       TEXT NOT NULL DEFAULT 'KES',
  subtotal       DECIMAL(15,2) NOT NULL DEFAULT 0,
  vat_rate       DECIMAL(5,2)  NOT NULL DEFAULT 16,
  vat_amount     DECIMAL(15,2) NOT NULL DEFAULT 0,
  total          DECIMAL(15,2) NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('draft','pending','paid','overdue','cancelled')),
  payment_method TEXT,
  reference      TEXT,
  notes          TEXT,
  paid_at        TIMESTAMPTZ,
  created_by     UUID,
  created_at     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_company_invoices_no
  ON public.company_invoices(admin_id, invoice_no);
CREATE INDEX IF NOT EXISTS idx_company_invoices_admin
  ON public.company_invoices(admin_id);
CREATE INDEX IF NOT EXISTS idx_company_invoices_client
  ON public.company_invoices(client_id);

-- 2. Line items ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.company_invoice_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID,
  invoice_id  UUID NOT NULL REFERENCES public.company_invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity    DECIMAL(12,2) NOT NULL DEFAULT 1,
  unit_price  DECIMAL(15,2) NOT NULL DEFAULT 0,
  line_total  DECIMAL(15,2) NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_company_invoice_items_invoice
  ON public.company_invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_company_invoice_items_admin
  ON public.company_invoice_items(admin_id);

-- 3. admin_id default + updated_at --------------------------------------------
DROP TRIGGER IF EXISTS set_admin_id_company_invoices ON public.company_invoices;
CREATE TRIGGER set_admin_id_company_invoices
  BEFORE INSERT ON public.company_invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_admin_id_default();

DROP TRIGGER IF EXISTS set_admin_id_company_invoice_items ON public.company_invoice_items;
CREATE TRIGGER set_admin_id_company_invoice_items
  BEFORE INSERT ON public.company_invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.set_admin_id_default();

CREATE OR REPLACE FUNCTION public.touch_company_invoice_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_company_invoices_updated_at ON public.company_invoices;
CREATE TRIGGER touch_company_invoices_updated_at
  BEFORE UPDATE ON public.company_invoices
  FOR EACH ROW EXECUTE FUNCTION public.touch_company_invoice_updated_at();

-- 4. RLS ----------------------------------------------------------------------
ALTER TABLE public.company_invoices      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_invoice_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_manage_company_invoices" ON public.company_invoices;
CREATE POLICY "tenant_manage_company_invoices" ON public.company_invoices
  FOR ALL TO authenticated
  USING      ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer())
  WITH CHECK ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer());

-- A client sees the invoices addressed to them, once they are no longer drafts.
DROP POLICY IF EXISTS "client_read_own_company_invoices" ON public.company_invoices;
CREATE POLICY "client_read_own_company_invoices" ON public.company_invoices
  FOR SELECT TO authenticated
  USING (
    status <> 'draft'
    AND EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = company_invoices.client_id
        AND (c.client_auth_id = auth.uid()
             OR lower(c.email) = lower(COALESCE(auth.email(), '')))
    )
  );

DROP POLICY IF EXISTS "tenant_manage_company_invoice_items" ON public.company_invoice_items;
CREATE POLICY "tenant_manage_company_invoice_items" ON public.company_invoice_items
  FOR ALL TO authenticated
  USING      ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer())
  WITH CHECK ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer());

-- Items follow whatever the parent invoice allows the reader to see.
DROP POLICY IF EXISTS "client_read_own_company_invoice_items" ON public.company_invoice_items;
CREATE POLICY "client_read_own_company_invoice_items" ON public.company_invoice_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.company_invoices i
    WHERE i.id = company_invoice_items.invoice_id
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_invoices      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_invoice_items TO authenticated;
