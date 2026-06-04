-- Luvira OS — Supabase Schema
-- Run this in the Supabase SQL Editor

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ─── USERS (public profile, mirrors auth.users) ───────────────────────────────
create table if not exists public.users (
  id          uuid primary key references auth.users(id) on delete cascade,
  tenant_id   uuid not null default 'a1b2c3d4-0000-0000-0000-000000000001',
  email       text not null,
  full_name   text not null,
  role        text not null check (role in ('owner','partner_admin','therapist','receptionist')),
  avatar_url  text,
  created_at  timestamptz not null default now()
);

alter table public.users enable row level security;

create policy "Users can read own tenant" on public.users
  for select using (tenant_id = 'a1b2c3d4-0000-0000-0000-000000000001');

create policy "Users can update own profile" on public.users
  for update using (id = auth.uid());

-- Trigger: auto-create public.users row on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.users (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    coalesce(new.raw_user_meta_data->>'role', 'receptionist')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── CLIENTS ──────────────────────────────────────────────────────────────────
create table if not exists public.clients (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid not null default 'a1b2c3d4-0000-0000-0000-000000000001',
  full_name   text not null,
  email       text,
  phone       text,
  notes       text,
  created_at  timestamptz not null default now()
);

alter table public.clients enable row level security;

create policy "Clients: tenant access" on public.clients
  for all using (tenant_id = 'a1b2c3d4-0000-0000-0000-000000000001');

-- ─── SERVICES ─────────────────────────────────────────────────────────────────
create table if not exists public.services (
  id                uuid primary key default uuid_generate_v4(),
  tenant_id         uuid not null default 'a1b2c3d4-0000-0000-0000-000000000001',
  name              text not null,
  duration_minutes  int not null default 60,
  price             numeric(10,2) not null default 0,
  description       text,
  created_at        timestamptz not null default now()
);

alter table public.services enable row level security;

create policy "Services: tenant access" on public.services
  for all using (tenant_id = 'a1b2c3d4-0000-0000-0000-000000000001');

-- ─── APPOINTMENTS ─────────────────────────────────────────────────────────────
create table if not exists public.appointments (
  id            uuid primary key default uuid_generate_v4(),
  tenant_id     uuid not null default 'a1b2c3d4-0000-0000-0000-000000000001',
  client_id     uuid not null references public.clients(id) on delete cascade,
  therapist_id  uuid not null references public.users(id),
  service_id    uuid references public.services(id),
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  status        text not null default 'scheduled'
                  check (status in ('scheduled','confirmed','completed','cancelled')),
  notes         text,
  created_at    timestamptz not null default now()
);

alter table public.appointments enable row level security;

create policy "Appointments: tenant access" on public.appointments
  for all using (tenant_id = 'a1b2c3d4-0000-0000-0000-000000000001');

-- ─── TRANSACTIONS ─────────────────────────────────────────────────────────────
create table if not exists public.transactions (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid not null default 'a1b2c3d4-0000-0000-0000-000000000001',
  type        text not null check (type in ('income','expense')),
  category    text not null default 'general',
  amount      numeric(10,2) not null,
  description text not null,
  date        date not null default current_date,
  created_by  uuid references public.users(id),
  created_at  timestamptz not null default now()
);

alter table public.transactions enable row level security;

create policy "Transactions: owner/partner_admin only" on public.transactions
  for all using (
    tenant_id = 'a1b2c3d4-0000-0000-0000-000000000001'
    and exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('owner','partner_admin')
    )
  );

-- ─── SEED: sample services ────────────────────────────────────────────────────
insert into public.services (name, duration_minutes, price, description) values
  ('Masaje Relajante 60 min',  60, 15000, 'Masaje sueco de cuerpo completo'),
  ('Masaje Descontracturante', 60, 17000, 'Trabajo en puntos de tensión'),
  ('Masaje Piedras Calientes', 90, 22000, 'Terapia con piedras volcánicas'),
  ('Reflexología',             45, 12000, 'Masaje en pies y manos')
on conflict do nothing;
