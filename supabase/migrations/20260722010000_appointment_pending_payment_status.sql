-- Adds 'pending_payment' as a valid appointments.status value: online bookings
-- that require a MercadoPago seña are created in this state and flip to
-- 'pending' once mp-webhook confirms the payment (see create-sena-payment and
-- the 'sena' branch in mp-webhook).
--
-- The live status CHECK constraint isn't in any tracked migration (it predates
-- this migrations folder), so its name is discovered dynamically instead of
-- assumed — review this against the actual constraint before running.
do $$
declare
  con_name text;
begin
  select con.conname into con_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'appointments'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%status%';

  if con_name is not null then
    execute format('alter table public.appointments drop constraint %I', con_name);
  end if;
end $$;

alter table public.appointments
add constraint appointments_status_valid check (
  status in ('pending', 'pending_payment', 'confirmed', 'completed', 'cancelled', 'no_show', 'blocked')
);
