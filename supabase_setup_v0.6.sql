-- Lead tracker fields extend the existing jobs pipeline.
-- No customer, job, document or financial data is removed.

begin;

alter table public.jobs
  add column if not exists lead_received_at timestamptz,
  add column if not exists lead_contacted_at timestamptz,
  add column if not exists lead_lost_at timestamptz,
  add column if not exists lost_reason text;

update public.jobs
set lead_received_at = created_at
where lead_received_at is null;

alter table public.jobs
  alter column lead_received_at set default now();

alter table public.jobs
  drop constraint if exists jobs_status_check;

alter table public.jobs
  add constraint jobs_status_check check (
    status = any (array[
      'enquiry', 'contacted', 'quoted', 'to_book', 'booked',
      'in_progress', 'waiting', 'return_booked', 'completed',
      'lost', 'cancelled'
    ])
  );

create index if not exists jobs_owner_lead_received_idx
  on public.jobs (owner_id, lead_received_at desc);

commit;
