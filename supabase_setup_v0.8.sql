-- ASP Manager v0.8 - QuickBooks Online connection and invoice sync
-- Tokens remain server-only: RLS is enabled and browser roles have no access.

create table if not exists public.quickbooks_connections (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  realm_id text not null,
  access_token text not null,
  refresh_token text not null,
  access_token_expires_at timestamptz not null,
  refresh_token_expires_at timestamptz,
  service_item_id text,
  tax_code_id text,
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  last_sync_error text
);

create table if not exists public.quickbooks_oauth_states (
  state_hash text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.quickbooks_connections enable row level security;
alter table public.quickbooks_oauth_states enable row level security;

create index if not exists quickbooks_oauth_states_expiry_idx
  on public.quickbooks_oauth_states (expires_at);

revoke all on public.quickbooks_connections, public.quickbooks_oauth_states from public, anon, authenticated;
grant select, insert, update, delete on public.quickbooks_connections, public.quickbooks_oauth_states to service_role;

alter table public.customers
  add column if not exists quickbooks_customer_id text;

alter table public.documents
  add column if not exists quickbooks_invoice_id text,
  add column if not exists quickbooks_synced_at timestamptz,
  add column if not exists quickbooks_sync_error text;

create unique index if not exists customers_quickbooks_customer_id_key
  on public.customers (quickbooks_customer_id)
  where quickbooks_customer_id is not null;

create unique index if not exists documents_quickbooks_invoice_id_key
  on public.documents (quickbooks_invoice_id)
  where quickbooks_invoice_id is not null;
