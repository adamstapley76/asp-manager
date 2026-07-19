-- ASP Manager v0.9 - invoice payment tracking and QuickBooks payment matching
-- Records confirmed bank payments. QuickBooks payments are created in Undeposited Funds
-- so that the matching bank-feed transaction can be matched there later.

begin;

create table if not exists public.document_payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  paid_on date not null default current_date,
  method text not null default 'bank_transfer' check (method in ('bank_transfer', 'cash', 'card', 'other')),
  note text,
  quickbooks_payment_id text,
  quickbooks_synced_at timestamptz,
  quickbooks_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists document_payments_owner_document_idx
  on public.document_payments (owner_id, document_id, paid_on desc);

create index if not exists document_payments_document_id_idx
  on public.document_payments (document_id);

create unique index if not exists document_payments_quickbooks_payment_id_key
  on public.document_payments (quickbooks_payment_id)
  where quickbooks_payment_id is not null;

alter table public.document_payments enable row level security;

grant select, insert, update, delete on public.document_payments to authenticated;

create policy "Users can view their own document payments"
  on public.document_payments for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Users can create their own document payments"
  on public.document_payments for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "Users can update their own document payments"
  on public.document_payments for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "Users can delete their own document payments"
  on public.document_payments for delete to authenticated
  using ((select auth.uid()) = owner_id);

commit;
