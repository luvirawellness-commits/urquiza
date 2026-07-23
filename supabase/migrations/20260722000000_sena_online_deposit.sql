-- Configurable online-booking deposit ("seña") policy per tenant, plus the
-- MercadoPago payment id needed to reconcile approved seña payments in the
-- mp-webhook function.

alter table public.tenants
  add column if not exists sena_online_required boolean not null default false,
  add column if not exists sena_online_amount numeric(10,2) not null default 0;

alter table public.appointments
  add column if not exists deposit_payment_id text;
