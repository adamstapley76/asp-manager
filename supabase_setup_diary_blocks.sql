-- Diary blocks support multi-day work without duplicating a job, invoice or payment.

alter table public.jobs
  add column if not exists estimated_duration_minutes integer;

create table if not exists public.job_diary_blocks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  block_date date not null,
  start_time time not null default '08:00',
  duration_minutes integer not null default 480 check (duration_minutes between 15 and 1440),
  created_at timestamptz not null default now(),
  unique (job_id, block_date)
);

alter table public.job_diary_blocks enable row level security;

drop policy if exists "Owners manage their diary blocks" on public.job_diary_blocks;
create policy "Owners manage their diary blocks"
  on public.job_diary_blocks
  for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create index if not exists job_diary_blocks_owner_date_idx
  on public.job_diary_blocks(owner_id, block_date, start_time);
