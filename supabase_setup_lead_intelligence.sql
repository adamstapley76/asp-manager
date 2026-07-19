-- ASP Manager - lead intelligence and optional job-completion data.
-- This extends the existing jobs pipeline without changing current workflows.

begin;

alter table public.jobs
  add column if not exists lead_campaign text,
  add column if not exists lead_keyword text,
  add column if not exists lead_landing_page text,
  add column if not exists lead_cost numeric(12,2),
  add column if not exists lsa_charge numeric(12,2),
  add column if not exists lead_town text,
  add column if not exists lead_outcome text,
  add column if not exists property_type text,
  add column if not exists property_owner_type text,
  add column if not exists access_notes text,
  add column if not exists boiler_make text,
  add column if not exists boiler_model text,
  add column if not exists boiler_serial_number text,
  add column if not exists boiler_install_year integer,
  add column if not exists boiler_warranty text;

create index if not exists jobs_owner_lead_source_idx
  on public.jobs (owner_id, lead_source, lead_received_at desc);

create index if not exists jobs_owner_lead_outcome_idx
  on public.jobs (owner_id, lead_outcome, lead_received_at desc);

commit;
