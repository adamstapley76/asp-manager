-- ASP Manager - website, advertising and contact-channel lead capture.
-- Raw marketing interactions are kept separate from genuine enquiries.

begin;

alter table public.jobs
  add column if not exists lead_channel text,
  add column if not exists gclid text,
  add column if not exists gbraid text,
  add column if not exists wbraid text,
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists utm_term text,
  add column if not exists utm_content text,
  add column if not exists lead_event_id uuid;

create table if not exists public.lead_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('form_enquiry','phone_click','whatsapp_click','phone_call','text_message','whatsapp_message','email_enquiry','lsa_lead','other')),
  lead_source text,
  lead_channel text,
  contact_name text,
  phone text,
  email text,
  postcode text,
  message text,
  landing_page text,
  referrer text,
  gclid text,
  gbraid text,
  wbraid text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  external_event_id text,
  customer_id uuid references public.customers(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists lead_events_owner_external_event_unique
  on public.lead_events (owner_id, external_event_id)
  where external_event_id is not null and btrim(external_event_id) <> '';
create index if not exists lead_events_owner_occurred_idx on public.lead_events (owner_id, occurred_at desc);
create index if not exists lead_events_customer_idx on public.lead_events (customer_id) where customer_id is not null;
create index if not exists lead_events_job_idx on public.lead_events (job_id) where job_id is not null;
create index if not exists jobs_lead_event_idx on public.jobs (lead_event_id) where lead_event_id is not null;

alter table public.lead_events enable row level security;
revoke all on table public.lead_events from anon;
grant select, insert, update, delete on table public.lead_events to authenticated;
grant select, insert, update, delete on table public.lead_events to service_role;

drop policy if exists "Owners can view lead events" on public.lead_events;
create policy "Owners can view lead events" on public.lead_events for select to authenticated using ((select auth.uid()) = owner_id);
drop policy if exists "Owners can create lead events" on public.lead_events;
create policy "Owners can create lead events" on public.lead_events for insert to authenticated with check ((select auth.uid()) = owner_id);
drop policy if exists "Owners can update lead events" on public.lead_events;
create policy "Owners can update lead events" on public.lead_events for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
drop policy if exists "Owners can delete lead events" on public.lead_events;
create policy "Owners can delete lead events" on public.lead_events for delete to authenticated using ((select auth.uid()) = owner_id);

commit;
