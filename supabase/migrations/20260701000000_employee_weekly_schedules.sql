-- Per-day working hours per employee per week, used by the "Horarios" tab in RRHH.
-- One row per (tenant, employee, week). Each weekday has a from/to text pair
-- ("HH:MM"), null when the employee doesn't work that day. total_hours is kept
-- in sync by the app (useUpsertWeeklySchedule) on every write.

create table if not exists public.employee_weekly_schedules (
  id               uuid primary key default uuid_generate_v4(),
  tenant_id        uuid not null,
  user_id          uuid not null references public.users(id) on delete cascade,
  week_start       date not null,
  monday_from      text,
  monday_to        text,
  tuesday_from     text,
  tuesday_to       text,
  wednesday_from   text,
  wednesday_to     text,
  thursday_from    text,
  thursday_to      text,
  friday_from      text,
  friday_to        text,
  saturday_from    text,
  saturday_to      text,
  sunday_from      text,
  sunday_to        text,
  total_hours      numeric(6,2) not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, user_id, week_start)
);

create index if not exists idx_employee_weekly_schedules_tenant_week
  on public.employee_weekly_schedules (tenant_id, week_start);

alter table public.employee_weekly_schedules enable row level security;

create policy "Employee weekly schedules: tenant access"
  on public.employee_weekly_schedules
  for all
  using (tenant_id in (select tenant_id from public.users where id = auth.uid()))
  with check (tenant_id in (select tenant_id from public.users where id = auth.uid()));
