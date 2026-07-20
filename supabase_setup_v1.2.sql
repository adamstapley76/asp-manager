-- Follow-on work from an existing diary entry.
-- A return visit is kept as its own unbooked job so the original job remains
-- in the diary as an accurate record of the work already carried out.

alter table public.jobs
  add column if not exists is_return_visit boolean not null default false,
  add column if not exists parent_job_id uuid references public.jobs(id) on delete set null;

create index if not exists jobs_owner_return_visit_queue_idx
  on public.jobs (owner_id, is_return_visit, status, scheduled_date);
