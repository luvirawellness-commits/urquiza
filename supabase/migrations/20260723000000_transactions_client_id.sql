-- mp-webhook now writes client_id on the seña deposit transaction (the
-- appointment is created in the same request, so there's no appointment_id
-- to join through beforehand). No reference to transactions.client_id exists
-- anywhere else in the codebase, so this is added defensively with
-- IF NOT EXISTS rather than assumed to already be there.
alter table public.transactions
  add column if not exists client_id uuid references public.clients(id);
