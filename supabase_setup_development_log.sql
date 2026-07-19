-- ASP Manager private development log.
-- Stores small, compressed screenshot evidence and notes separately from
-- customer/job records, so development work can be reviewed on any device.

begin;

create table if not exists public.development_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  notes text not null default '',
  screenshot_path text,
  source text not null default 'app' check (source in ('app', 'chat')),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists development_items_owner_status_created_idx
  on public.development_items (owner_id, status, created_at desc);

alter table public.development_items enable row level security;
grant select, insert, update, delete on public.development_items to authenticated;

drop policy if exists "Users can view their own development items" on public.development_items;
create policy "Users can view their own development items"
  on public.development_items for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Users can create their own development items" on public.development_items;
create policy "Users can create their own development items"
  on public.development_items for insert to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Users can update their own development items" on public.development_items;
create policy "Users can update their own development items"
  on public.development_items for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Users can delete their own development items" on public.development_items;
create policy "Users can delete their own development items"
  on public.development_items for delete to authenticated
  using ((select auth.uid()) = owner_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('development-files', 'development-files', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "Users can view their own development files" on storage.objects;
create policy "Users can view their own development files"
  on storage.objects for select to authenticated
  using (bucket_id = 'development-files' and owner_id = (select auth.uid()::text));

drop policy if exists "Users can upload their own development files" on storage.objects;
create policy "Users can upload their own development files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'development-files'
    and owner_id = (select auth.uid()::text)
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "Users can delete their own development files" on storage.objects;
create policy "Users can delete their own development files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'development-files' and owner_id = (select auth.uid()::text));

commit;
