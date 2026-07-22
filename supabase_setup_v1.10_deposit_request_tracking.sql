-- ASP Manager v1.10 - track requested deposits before the payment arrives.
-- A request is not an invoice and does not create a QuickBooks transaction.

begin;

create table if not exists public.job_deposit_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  quote_id uuid references public.documents(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  description text,
  channel text not null check (channel in ('email', 'whatsapp', 'text')),
  sent_to text,
  status text not null default 'requested' check (status in ('requested', 'received', 'cancelled')),
  requested_at timestamptz not null default now(),
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_deposit_requests_has_link check (job_id is not null or quote_id is not null)
);

create index if not exists job_deposit_requests_owner_status_idx
  on public.job_deposit_requests (owner_id, status, requested_at desc);

create index if not exists job_deposit_requests_job_idx
  on public.job_deposit_requests (job_id, requested_at desc)
  where job_id is not null;

create index if not exists job_deposit_requests_quote_idx
  on public.job_deposit_requests (quote_id, requested_at desc)
  where quote_id is not null;

alter table public.job_deposit_requests enable row level security;

grant select, insert, update, delete on public.job_deposit_requests to authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='job_deposit_requests' and policyname='Users can view their own deposit requests') then
    create policy "Users can view their own deposit requests" on public.job_deposit_requests for select to authenticated using ((select auth.uid()) = owner_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='job_deposit_requests' and policyname='Users can create their own deposit requests') then
    create policy "Users can create their own deposit requests" on public.job_deposit_requests for insert to authenticated with check ((select auth.uid()) = owner_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='job_deposit_requests' and policyname='Users can update their own deposit requests') then
    create policy "Users can update their own deposit requests" on public.job_deposit_requests for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='job_deposit_requests' and policyname='Users can delete their own deposit requests') then
    create policy "Users can delete their own deposit requests" on public.job_deposit_requests for delete to authenticated using ((select auth.uid()) = owner_id);
  end if;
end $$;

commit;
