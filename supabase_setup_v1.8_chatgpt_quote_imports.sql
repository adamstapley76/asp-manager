-- Review-first intake queue for structured quotes prepared in ChatGPT.
-- Nothing becomes a live customer, job or quote until it is reviewed in ASP Manager.

begin;

create table if not exists public.chatgpt_quote_imports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','saved','discarded')),
  source_reference text,
  customer_data jsonb not null default '{}'::jsonb,
  job_data jsonb not null default '{}'::jsonb,
  quote_data jsonb not null default '{}'::jsonb,
  photo_data jsonb not null default '[]'::jsonb,
  notes text not null default '',
  matched_customer_id uuid references public.customers(id) on delete set null,
  match_reason text,
  saved_customer_id uuid references public.customers(id) on delete set null,
  saved_job_id uuid references public.jobs(id) on delete set null,
  saved_document_id uuid references public.documents(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  saved_at timestamptz
);

create index if not exists chatgpt_quote_imports_owner_status_created_idx
  on public.chatgpt_quote_imports (owner_id, status, created_at desc);

create table if not exists public.chatgpt_action_keys (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label text not null default 'ChatGPT quote connection',
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists chatgpt_action_keys_active_idx on public.chatgpt_action_keys (owner_id) where revoked_at is null;

alter table public.chatgpt_quote_imports enable row level security;
alter table public.chatgpt_action_keys enable row level security;
grant select, insert, update, delete on public.chatgpt_quote_imports to authenticated;
grant select, insert, update, delete on public.chatgpt_action_keys to authenticated;

drop policy if exists "Users can view their own ChatGPT quote imports" on public.chatgpt_quote_imports;
create policy "Users can view their own ChatGPT quote imports"
  on public.chatgpt_quote_imports for select to authenticated
  using ((select auth.uid()) = owner_id);
drop policy if exists "Users can create their own ChatGPT quote imports" on public.chatgpt_quote_imports;
create policy "Users can create their own ChatGPT quote imports"
  on public.chatgpt_quote_imports for insert to authenticated
  with check ((select auth.uid()) = owner_id);
drop policy if exists "Users can update their own ChatGPT quote imports" on public.chatgpt_quote_imports;
create policy "Users can update their own ChatGPT quote imports"
  on public.chatgpt_quote_imports for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
drop policy if exists "Users can delete their own ChatGPT quote imports" on public.chatgpt_quote_imports;
create policy "Users can delete their own ChatGPT quote imports"
  on public.chatgpt_quote_imports for delete to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Users can manage their own ChatGPT action keys" on public.chatgpt_action_keys;
create policy "Users can manage their own ChatGPT action keys"
  on public.chatgpt_action_keys for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

commit;
