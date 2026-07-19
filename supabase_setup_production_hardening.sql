-- ASP Manager production hardening
-- REVIEW BEFORE RUNNING: this file is intentionally not applied by the app.
-- It adds reversible archiving and an owner-scoped audit trail without
-- changing or deleting existing business data.

begin;

-- Keep normal business records recoverable. Existing screens continue to use
-- their current status fields; archived_at is the explicit recovery marker.
alter table public.customers
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null,
  add column if not exists last_modified_by uuid references auth.users(id) on delete set null;

alter table public.jobs
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null,
  add column if not exists last_modified_by uuid references auth.users(id) on delete set null;

alter table public.documents
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null,
  add column if not exists last_modified_by uuid references auth.users(id) on delete set null;

create index if not exists customers_owner_archived_at_idx on public.customers (owner_id, archived_at);
create index if not exists jobs_owner_archived_at_idx on public.jobs (owner_id, archived_at);
create index if not exists documents_owner_archived_at_idx on public.documents (owner_id, archived_at);

-- Document numbers must remain unique within an owner's quote or invoice
-- sequence. The partial index leaves any deliberately blank legacy drafts alone.
create unique index if not exists documents_owner_type_number_unique
  on public.documents (owner_id, type, document_number)
  where document_number is not null and btrim(document_number) <> '';

-- Safe event history: users may add and read their own events, but cannot alter
-- or remove history after it has been written.
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  record_type text not null check (record_type in ('customer', 'job', 'quote', 'invoice', 'payment', 'deposit', 'certificate', 'file', 'service_record')),
  record_id uuid,
  action text not null check (action in ('created', 'updated', 'sent', 'completed', 'reopened', 'payment_recorded', 'archived', 'restored', 'document_sent', 'certificate_completed')),
  summary text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_owner_created_at_idx on public.audit_events (owner_id, created_at desc);
create index if not exists audit_events_owner_record_idx on public.audit_events (owner_id, record_type, record_id, created_at desc);

alter table public.audit_events enable row level security;
grant select, insert on public.audit_events to authenticated;

drop policy if exists "Users can view their own audit events" on public.audit_events;
create policy "Users can view their own audit events"
  on public.audit_events for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Users can create their own audit events" on public.audit_events;
create policy "Users can create their own audit events"
  on public.audit_events for insert to authenticated
  with check ((select auth.uid()) = owner_id);

commit;
