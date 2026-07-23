-- Worcester boiler registration checklist for completed installations.
-- This stores only the user's confirmation; it does not attempt to register
-- appliances with Worcester Bosch or send data to an external service.

begin;

alter table public.jobs
  add column if not exists worcester_registered_at timestamptz,
  add column if not exists worcester_registration_not_required boolean not null default false;

create index if not exists jobs_owner_worcester_registration_pending_idx
  on public.jobs (owner_id, completed_at desc)
  where worcester_registered_at is null
    and worcester_registration_not_required = false;

commit;
