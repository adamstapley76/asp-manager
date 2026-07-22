-- ASP Manager v1.7 - unified work-to-organise list
-- Existing jobs remain Normal priority unless you choose otherwise.

begin;

alter table public.jobs
  add column if not exists priority text not null default 'normal'
  check (priority in ('urgent','high','normal','low'));

create index if not exists jobs_owner_work_list_idx
  on public.jobs (owner_id, priority, status, follow_up_date)
  where scheduled_date is null and status in ('to_book','waiting');

commit;
