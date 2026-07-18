-- ASP Manager v0.8 - QuickBooks Online connection and invoice sync
-- Tokens are intentionally stored in a private schema. They are never exposed
-- to the browser or the public Supabase API.

create schema if not exists integrations;
revoke all on schema integrations from public;
grant usage on schema integrations to service_role;

create table if not exists integrations.quickbooks_connections (
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

create table if not exists integrations.quickbooks_oauth_states (
  state_hash text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table integrations.quickbooks_connections enable row level security;
alter table integrations.quickbooks_oauth_states enable row level security;

create index if not exists quickbooks_oauth_states_expiry_idx
  on integrations.quickbooks_oauth_states (expires_at);

revoke all on all tables in schema integrations from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema integrations to service_role;

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
