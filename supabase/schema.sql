-- ATSC Cena 2026 — ejecutar en Supabase SQL Editor.
-- Antes de producción: definir precio/cupo/fecha reales y revisar políticas con el responsable del club.

create extension if not exists pgcrypto;

create type public.payment_method as enum ('mercadopago', 'naranja_x', 'transferencia');
create type public.order_status as enum ('pendiente', 'pagado', 'rechazado', 'cancelado', 'reembolso');

create table public.event_config (
  id uuid primary key default gen_random_uuid(),
  event_name text not null default 'Cena de Fin de Año 2026 - ATSC',
  event_date timestamptz,
  venue text,
  ticket_price_ars integer check (ticket_price_ars is null or ticket_price_ars >= 0),
  capacity integer check (capacity is null or capacity >= 0),
  sales_enabled boolean not null default false,
  logo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.event_config (event_name, ticket_price_ars, capacity, sales_enabled, logo_url)
values ('Cena de Fin de Año 2026 - ATSC', null, null, false, null);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  buyer_full_name text not null,
  buyer_dni text not null,
  buyer_email text not null,
  buyer_phone text not null,
  quantity integer not null check (quantity between 1 and 10),
  unit_price_ars integer not null default 0 check (unit_price_ars >= 0),
  total_ars integer not null check (total_ars >= 0),
  payment_method public.payment_method not null,
  status public.order_status not null default 'pendiente',
  provider_preference_id text,
  provider_payment_id text,
  transfer_reference text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  constraint orders_provider_payment_unique unique (provider_payment_id)
);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number serial, -- Número correlativo normal para sorteo (1, 2, 3...)
  order_id uuid not null references public.orders(id) on delete restrict,
  attendee_name text,
  qr_token uuid not null unique default gen_random_uuid(),
  status text not null default 'valid' check (status in ('valid', 'used', 'cancelled')),
  checked_in_at timestamptz,
  created_at timestamptz not null default now()
);

create index orders_status_created_idx on public.orders(status, created_at desc);
create index tickets_order_id_idx on public.tickets(order_id);
create index tickets_ticket_number_idx on public.tickets(ticket_number);

-- NOTA: Si ya tenías la base creada en Supabase, ejecutá estas líneas en el SQL Editor para corregir restricciones de bonificaciones:
-- alter table public.tickets add column if not exists ticket_number serial;
-- alter table public.tickets alter column ticket_number drop not null;
-- alter table public.orders drop constraint if exists orders_check;
-- alter table public.orders drop constraint if exists orders_total_ars_check;
-- alter table public.orders add constraint orders_total_ars_non_negative check (total_ars >= 0);

-- Políticas de acceso para la venta y el panel de control:
alter table public.event_config enable row level security;
alter table public.orders enable row level security;
alter table public.tickets enable row level security;

-- Configuración del evento: lectura pública
create policy "event_config_select_policy" on public.event_config
  for select using (true);
create policy "event_config_update_policy" on public.event_config
  for update using (true);

-- Pedidos: creación y consulta
create policy "orders_insert_policy" on public.orders
  for insert with check (true);
create policy "orders_select_policy" on public.orders
  for select using (true);
create policy "orders_update_policy" on public.orders
  for update using (true);

-- Tickets: creación, lectura y validación de check-in en puerta
create policy "tickets_insert_policy" on public.tickets
  for insert with check (true);
create policy "tickets_select_policy" on public.tickets
  for select using (true);
create policy "tickets_update_policy" on public.tickets
  for update using (true);

