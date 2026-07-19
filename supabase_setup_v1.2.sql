-- ASP Manager v1.2 - Gas Safety Certificate workflow (records only, no generated PDF)

begin;

create table if not exists public.gas_safety_certificates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  job_id uuid references public.jobs(id) on delete set null,
  certificate_number text not null,
  status text not null default 'draft' check (status in ('draft', 'completed', 'void')),
  issue_date date not null default current_date,
  expiry_date date,
  property_address text,
  property_postcode text,
  engineer_name text,
  engineer_registration_number text,
  engineer_phone text,
  engineer_email text,
  landlord_name text,
  landlord_address text,
  landlord_email text,
  landlord_phone text,
  defects_recommendations text,
  notes text,
  engineer_signature_name text,
  engineer_signature_path text,
  customer_signature_name text,
  customer_signature_path text,
  pdf_path text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, certificate_number)
);

create table if not exists public.gas_safety_certificate_appliances (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  certificate_id uuid not null references public.gas_safety_certificates(id) on delete cascade,
  sort_order integer not null default 0,
  appliance_type text,
  location text,
  make_model text,
  serial_number text,
  flue_type text,
  operating_pressure text,
  heat_input text,
  safety_device text,
  combustion_satisfactory boolean,
  ventilation_satisfactory boolean,
  flue_satisfactory boolean,
  gas_tightness_satisfactory boolean,
  test_results jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gas_safety_certificate_attachments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  certificate_id uuid not null references public.gas_safety_certificates(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  attachment_type text not null check (attachment_type in ('photo', 'pdf', 'signature')),
  category text check (category in ('Before', 'During', 'Completion', 'Certificate evidence', 'Boiler plate', 'Flue', 'Defect')),
  description text,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint,
  created_at timestamptz not null default now()
);

create index if not exists gas_safety_certificates_owner_customer_idx on public.gas_safety_certificates (owner_id, customer_id, issue_date desc);
create index if not exists gas_safety_certificates_owner_job_idx on public.gas_safety_certificates (owner_id, job_id, issue_date desc);
create index if not exists gas_safety_certificates_expiry_idx on public.gas_safety_certificates (owner_id, expiry_date) where status = 'completed';
create index if not exists gas_safety_certificate_appliances_certificate_idx on public.gas_safety_certificate_appliances (certificate_id, sort_order);
create index if not exists gas_safety_certificate_attachments_certificate_idx on public.gas_safety_certificate_attachments (certificate_id, created_at);

alter table public.gas_safety_certificates enable row level security;
alter table public.gas_safety_certificate_appliances enable row level security;
alter table public.gas_safety_certificate_attachments enable row level security;

grant select, insert, update, delete on public.gas_safety_certificates to authenticated;
grant select, insert, update, delete on public.gas_safety_certificate_appliances to authenticated;
grant select, insert, update, delete on public.gas_safety_certificate_attachments to authenticated;

create policy "Users can view their own gas safety certificates" on public.gas_safety_certificates for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Users can create their own gas safety certificates" on public.gas_safety_certificates for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "Users can update their own gas safety certificates" on public.gas_safety_certificates for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Users can delete their own gas safety certificates" on public.gas_safety_certificates for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "Users can view their own gas safety appliances" on public.gas_safety_certificate_appliances for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Users can create their own gas safety appliances" on public.gas_safety_certificate_appliances for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "Users can update their own gas safety appliances" on public.gas_safety_certificate_appliances for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Users can delete their own gas safety appliances" on public.gas_safety_certificate_appliances for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "Users can view their own gas safety attachments" on public.gas_safety_certificate_attachments for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Users can create their own gas safety attachments" on public.gas_safety_certificate_attachments for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "Users can update their own gas safety attachments" on public.gas_safety_certificate_attachments for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Users can delete their own gas safety attachments" on public.gas_safety_certificate_attachments for delete to authenticated using ((select auth.uid()) = owner_id);

insert into storage.buckets (id, name, public)
values ('gas-safety-files', 'gas-safety-files', false)
on conflict (id) do nothing;

create policy "Users can read their own gas safety files" on storage.objects for select to authenticated using (bucket_id = 'gas-safety-files' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "Users can upload their own gas safety files" on storage.objects for insert to authenticated with check (bucket_id = 'gas-safety-files' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "Users can update their own gas safety files" on storage.objects for update to authenticated using (bucket_id = 'gas-safety-files' and (storage.foldername(name))[1] = (select auth.uid()::text)) with check (bucket_id = 'gas-safety-files' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "Users can delete their own gas safety files" on storage.objects for delete to authenticated using (bucket_id = 'gas-safety-files' and (storage.foldername(name))[1] = (select auth.uid()::text));

commit;
