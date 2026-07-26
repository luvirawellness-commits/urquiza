-- generate-invoice has always received `concept` in every caller's request
-- body (InvoiceModal, Facturacion.tsx's TabEmitir, and the Stage 1/2
-- auto-invoicing flow) but never stored it, so every PDF re-download falls
-- back to a generic "Servicios prestados" string regardless of what was
-- actually invoiced. The column isn't in any tracked migration (the
-- `invoices` table predates this migrations folder, same as other schema
-- drift found this session), so — as with earlier defensive migrations —
-- this can't be confirmed against the live DB from here and uses
-- IF NOT EXISTS rather than assuming it's missing.
--
-- This only fixes invoices issued from now on. Existing rows have nothing to
-- backfill concept from, so they keep reading as NULL — every read site
-- already falls back to 'Servicios prestados' for that case (see
-- Facturacion.tsx's TabHistorial.handlePDF and Finanzas.tsx's invoice-action
-- component), so old rows are unaffected either way.
alter table public.invoices
  add column if not exists concept text;
