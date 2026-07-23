-- ASP Manager v1.5 - original Landlord Gas Safety Record workflow

begin;

create table if not exists public.gas_safety_certificates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  job_id uuid references public.jobs(id) on delete set null,
  certificate_number text not null,
  status text not null default 'draft' check (status in ('draft','completed','void')),
  issue_date date not null default current_date,
  renewal_from date,
  expiry_date date,
  property_address text not null,
  property_postcode text,
  landlord_name text,
  landlord_address text,
  landlord_email text,
  landlord_phone text,
  tenant_name text,
  tenant_email text,
  engineer_name text not null default 'Adam Stapley',
  engineer_registration_number text not null default '234795',
  inspection_data jsonb not null default '{}'::jsonb,
  defects jsonb not null default '[]'::jsonb,
  engineer_signature_method text,
  pdf_path text,
  completed_at timestamptz,
  sent_at timestamptz,
  sent_to text[],
  email_provider_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, certificate_number)
);

create table if not exists public.gas_safety_certificate_appliances (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  certificate_id uuid not null references public.gas_safety_certificates(id) on delete cascade,
  sort_order integer not null default 0,
  appliance_type text,
  location text,
  make text,
  model text,
  landlord_appliance text check (landlord_appliance in ('yes','no','na')),
  inspected text check (inspected in ('yes','no','na')),
  serviced text check (serviced in ('yes','no','na')),
  safe_to_use text check (safe_to_use in ('yes','no','na')),
  operating_pressure text,
  heat_input text,
  initial_combustion text,
  final_combustion text,
  safety_device text check (safety_device in ('pass','fail','na')),
  ventilation text check (ventilation in ('pass','fail','na')),
  flue_condition text check (flue_condition in ('pass','fail','na')),
  flue_type text,
  spillage_test text check (spillage_test in ('pass','fail','na')),
  flue_flow_test text check (flue_flow_test in ('pass','fail','na')),
  co_alarm_fitted text check (co_alarm_fitted in ('yes','no','na')),
  co_alarm_test text check (co_alarm_test in ('pass','fail','na')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gas_warning_notices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  certificate_id uuid references public.gas_safety_certificates(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  job_id uuid references public.jobs(id) on delete set null,
  notice_number text not null,
  issue_date date not null default current_date,
  property_address text not null,
  responsible_person_name text,
  classification text not null check(classification in ('ID','AR')),
  appliance_location text not null,
  appliance_description text not null,
  unsafe_situation text not null,
  actions_taken text not null,
  rectification_required text not null,
  gas_isolated boolean not null default false,
  labels_attached boolean not null default false,
  responsible_person_advised boolean not null default false,
  emergency_service_contacted boolean not null default false,
  riddor_applicable boolean not null default false,
  riddor_reference text,
  engineer_name text not null default 'Adam Stapley',
  business_registration_number text not null default '234795',
  signature_method text not null default 'secure-electronic-name',
  pdf_path text,
  completed_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_to text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,notice_number)
);

create table if not exists public.gas_service_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  job_id uuid references public.jobs(id) on delete set null,
  record_number text not null,
  status text not null default 'draft' check(status in ('draft','completed','void')),
  service_date date not null default current_date,
  property_address text not null,
  property_postcode text,
  client_name text,
  client_email text,
  appliance_type text not null,
  appliance_location text not null,
  appliance_make text,
  appliance_model text,
  work_type text not null default 'Service',
  initial_combustion text,
  final_combustion text,
  full_strip_clean text check(full_strip_clean in ('yes','no','na')),
  operating_pressure text,
  heat_input text,
  checks jsonb not null default '{}'::jsonb,
  defects text,
  remedial_action text,
  gas_tightness_carried_out text check(gas_tightness_carried_out in ('yes','no','na')),
  gas_tightness_result text,
  safe_to_use text check(safe_to_use in ('yes','no')),
  responsible_person_advised text check(responsible_person_advised in ('yes','no','na')),
  engineer_name text not null default 'Adam Stapley',
  business_registration_number text not null default '234795',
  signature_method text,
  pdf_path text,
  completed_at timestamptz,
  sent_at timestamptz,
  sent_to text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,record_number)
);

create table if not exists public.gas_legacy_addresses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source_system text not null default 'easy-gas-certs',
  source_addr_id text not null,
  source_company_key text,
  address_type text,
  company_name text,
  title text,
  contact_name text,
  email text,
  phone text,
  mobile text,
  address text,
  postcode text,
  agency_source_addr_id text,
  source_added_at text,
  source_deleted_at text,
  imported_customer_id uuid references public.customers(id) on delete set null,
  raw_data jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  unique(owner_id,source_system,source_addr_id)
);

create table if not exists public.gas_legacy_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source_system text not null default 'easy-gas-certs',
  source_record_type text not null check(source_record_type in ('DOM','SRV','GWN','OTHER')),
  source_serial_number text not null,
  source_record_id text,
  inspection_date date,
  customer_id uuid references public.customers(id) on delete set null,
  legacy_address_id uuid references public.gas_legacy_addresses(id) on delete set null,
  property_address text,
  property_postcode text,
  client_name text,
  engineer_name text,
  engineer_registration_number text,
  original_pdf_path text not null,
  original_pdf_sha256 text not null,
  extracted_data jsonb not null default '{}'::jsonb,
  imported_certificate_id uuid references public.gas_safety_certificates(id) on delete set null,
  imported_service_record_id uuid references public.gas_service_records(id) on delete set null,
  imported_at timestamptz not null default now(),
  unique(owner_id,source_system,source_record_type,source_serial_number)
);

create index if not exists gas_safety_certificates_customer_idx on public.gas_safety_certificates(owner_id,customer_id,issue_date desc);
create index if not exists gas_safety_certificates_expiry_idx on public.gas_safety_certificates(owner_id,expiry_date) where status='completed';
create index if not exists gas_safety_appliances_certificate_idx on public.gas_safety_certificate_appliances(certificate_id,sort_order);
create index if not exists gas_warning_notices_customer_idx on public.gas_warning_notices(owner_id,customer_id,issue_date desc);
create index if not exists gas_service_records_customer_idx on public.gas_service_records(owner_id,customer_id,service_date desc);
create index if not exists gas_legacy_addresses_agency_idx on public.gas_legacy_addresses(owner_id,agency_source_addr_id);
create index if not exists gas_legacy_records_customer_idx on public.gas_legacy_records(owner_id,customer_id,inspection_date desc);

alter table public.gas_safety_certificates enable row level security;
alter table public.gas_safety_certificate_appliances enable row level security;
alter table public.gas_warning_notices enable row level security;
alter table public.gas_service_records enable row level security;
alter table public.gas_legacy_addresses enable row level security;
alter table public.gas_legacy_records enable row level security;
grant select,insert,update,delete on public.gas_safety_certificates to authenticated;
grant select,insert,update,delete on public.gas_safety_certificate_appliances to authenticated;
grant select,insert,update on public.gas_warning_notices to authenticated;
grant select,insert,update on public.gas_service_records to authenticated;
grant select,insert,update on public.gas_legacy_addresses to authenticated;
grant select,insert,update on public.gas_legacy_records to authenticated;
revoke delete on public.gas_safety_certificates,public.gas_warning_notices,public.gas_service_records,public.gas_legacy_addresses,public.gas_legacy_records from authenticated;

drop policy if exists "Users manage their gas safety certificates" on public.gas_safety_certificates;
create policy "Users manage their gas safety certificates" on public.gas_safety_certificates for all to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
drop policy if exists "Users manage their gas safety appliances" on public.gas_safety_certificate_appliances;
create policy "Users manage their gas safety appliances" on public.gas_safety_certificate_appliances for all to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);

drop policy if exists "Users retain their gas warning notices" on public.gas_warning_notices;
create policy "Users retain their gas warning notices" on public.gas_warning_notices for all to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
drop policy if exists "Users retain their gas service records" on public.gas_service_records;
create policy "Users retain their gas service records" on public.gas_service_records for all to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
drop policy if exists "Users retain their imported gas addresses" on public.gas_legacy_addresses;
create policy "Users retain their imported gas addresses" on public.gas_legacy_addresses for all to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
drop policy if exists "Users retain their imported gas records" on public.gas_legacy_records;
create policy "Users retain their imported gas records" on public.gas_legacy_records for all to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);

insert into storage.buckets(id,name,public) values('gas-safety-files','gas-safety-files',false) on conflict(id) do nothing;
drop policy if exists "Users manage their gas safety files" on storage.objects;
drop policy if exists "Users read their retained gas safety files" on storage.objects;
drop policy if exists "Users create their retained gas safety files" on storage.objects;
drop policy if exists "Users update their retained gas safety files" on storage.objects;
create policy "Users read their retained gas safety files" on storage.objects for select to authenticated
using(bucket_id='gas-safety-files' and (storage.foldername(name))[1]=(select auth.uid()::text));
create policy "Users create their retained gas safety files" on storage.objects for insert to authenticated
with check(bucket_id='gas-safety-files' and (storage.foldername(name))[1]=(select auth.uid()::text));
create policy "Users update their retained gas safety files" on storage.objects for update to authenticated
using(bucket_id='gas-safety-files' and (storage.foldername(name))[1]=(select auth.uid()::text))
with check(bucket_id='gas-safety-files' and (storage.foldername(name))[1]=(select auth.uid()::text));

commit;
