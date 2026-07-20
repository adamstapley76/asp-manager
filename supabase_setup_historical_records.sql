-- Invoice2go historical records
-- These records are intentionally separate from live ASP Manager documents so
-- they cannot affect live invoice numbers, QuickBooks sync, reminders or AI readiness.

begin;

create table if not exists public.historical_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  source text not null default 'invoice2go',
  external_id text not null,
  document_type text not null check (document_type in ('invoice', 'quote')),
  document_number text,
  document_date date,
  customer_name text not null default '',
  customer_email text,
  customer_address text,
  status text not null default 'historical',
  output_status text,
  subtotal numeric(12,2),
  vat_amount numeric(12,2),
  vat_rate numeric(6,2),
  total numeric(12,2),
  amount_paid numeric(12,2),
  balance_due numeric(12,2),
  paid_date date,
  line_items jsonb not null default '[]'::jsonb,
  notes text,
  raw_data jsonb not null default '{}'::jsonb,
  match_status text not null default 'review' check (match_status in ('matched', 'review', 'unmatched')),
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, source, external_id)
);

create index if not exists historical_documents_owner_customer_date_idx
  on public.historical_documents (owner_id, customer_id, document_date desc);

create index if not exists historical_documents_owner_date_idx
  on public.historical_documents (owner_id, document_date desc);

alter table public.historical_documents enable row level security;

grant select, insert, update, delete on public.historical_documents to authenticated;

drop policy if exists "historical documents are private" on public.historical_documents;
create policy "historical documents are private"
  on public.historical_documents
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "owners can add historical documents" on public.historical_documents;
create policy "owners can add historical documents"
  on public.historical_documents
  for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists "owners can update historical documents" on public.historical_documents;
create policy "owners can update historical documents"
  on public.historical_documents
  for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "owners can remove historical documents" on public.historical_documents;
create policy "owners can remove historical documents"
  on public.historical_documents
  for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

commit;
