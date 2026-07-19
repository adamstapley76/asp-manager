-- ASP Manager v1.4 - efficient photos on ordinary jobs

begin;

create table if not exists public.job_photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  category text not null default 'During' check (category in ('Before', 'During', 'Completion', 'Certificate evidence', 'Boiler plate', 'Flue', 'Defect')),
  description text,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint,
  created_at timestamptz not null default now()
);

create index if not exists job_photos_owner_job_idx on public.job_photos (owner_id, job_id, created_at desc);
create index if not exists job_photos_owner_customer_idx on public.job_photos (owner_id, customer_id, created_at desc);

alter table public.job_photos enable row level security;
grant select, insert, update, delete on public.job_photos to authenticated;
create policy "Users can view their own job photos" on public.job_photos for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Users can create their own job photos" on public.job_photos for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "Users can update their own job photos" on public.job_photos for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Users can delete their own job photos" on public.job_photos for delete to authenticated using ((select auth.uid()) = owner_id);

insert into storage.buckets (id, name, public) values ('job-photos', 'job-photos', false) on conflict (id) do nothing;
create policy "Users can read their own job photos files" on storage.objects for select to authenticated using (bucket_id = 'job-photos' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "Users can upload their own job photos files" on storage.objects for insert to authenticated with check (bucket_id = 'job-photos' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "Users can update their own job photos files" on storage.objects for update to authenticated using (bucket_id = 'job-photos' and (storage.foldername(name))[1] = (select auth.uid()::text)) with check (bucket_id = 'job-photos' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "Users can delete their own job photos files" on storage.objects for delete to authenticated using (bucket_id = 'job-photos' and (storage.foldername(name))[1] = (select auth.uid()::text));

commit;
