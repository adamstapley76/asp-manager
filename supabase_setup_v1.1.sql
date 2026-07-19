-- ASP Manager v1.1 - job deposits before an invoice exists
-- Deposits belong to a job first, then are applied to the final invoice later.

begin;

create table if not exists public.job_deposit_payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  paid_on date not null default current_date,
  method text not null default 'bank_transfer' check (method in ('bank_transfer', 'cash', 'card', 'other')),
  note text,
  receipt_token uuid not null default gen_random_uuid() unique,
  receipt_sent_at timestamptz,
  receipt_sent_to text,
  receipt_provider_id text,
  applied_document_id uuid references public.documents(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.document_payments
  add column if not exists origin_deposit_id uuid references public.job_deposit_payments(id) on delete set null;

create unique index if not exists document_payments_origin_deposit_id_key
  on public.document_payments (origin_deposit_id)
  where origin_deposit_id is not null;

create index if not exists job_deposit_payments_owner_job_idx
  on public.job_deposit_payments (owner_id, job_id, paid_on desc);

create index if not exists job_deposit_payments_receipt_token_idx
  on public.job_deposit_payments (receipt_token);

alter table public.job_deposit_payments enable row level security;

grant select, insert, update, delete on public.job_deposit_payments to authenticated;

create policy "Users can view their own job deposits"
  on public.job_deposit_payments for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Users can create their own job deposits"
  on public.job_deposit_payments for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "Users can update their own job deposits"
  on public.job_deposit_payments for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "Users can delete their own job deposits"
  on public.job_deposit_payments for delete to authenticated
  using ((select auth.uid()) = owner_id);

commit;
