-- Dedicated ChatGPT diary booking intake. Apply after v1.12.
-- This is server-only: browser users cannot call the intake function or read
-- its idempotency records.

begin;

create table if not exists public.chatgpt_job_submissions (
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_reference text not null,
  customer_id uuid not null references public.customers(id) on delete cascade,
  customer_status text not null check (customer_status in ('matched', 'created')),
  job_id uuid not null references public.jobs(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, source_reference)
);

alter table public.chatgpt_job_submissions enable row level security;
revoke all on public.chatgpt_job_submissions from public, anon, authenticated;
grant select, insert, update, delete on public.chatgpt_job_submissions to service_role;

create or replace function public.create_chatgpt_job(p_owner_id uuid, p_package jsonb)
returns table(customer_id uuid, customer_status text, job_id uuid, duplicate boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_customer jsonb := coalesce(p_package->'customer', '{}'::jsonb);
  v_job jsonb := coalesce(p_package->'job', '{}'::jsonb);
  v_lead jsonb := coalesce(p_package->'lead', '{}'::jsonb);
  v_source_reference text := nullif(left(btrim(coalesce(p_package->>'source_reference', '')), 240), '');
  v_customer_id uuid; v_customer_status text; v_job_id uuid; v_existing record;
  v_title text := left(btrim(coalesce(v_job->>'title', '')), 240);
  v_scheduled_date date := nullif(v_job->>'scheduled_date', '')::date;
  v_scheduled_time time := nullif(v_job->>'scheduled_time', '')::time;
  v_booking_confirmed boolean := coalesce((v_job->>'booking_confirmed')::boolean, false);
  v_phone text := nullif(regexp_replace(coalesce(v_customer->>'phone', ''), '\D', '', 'g'), '');
  v_email text := nullif(lower(btrim(coalesce(v_customer->>'email', ''))), '');
  v_address text := nullif(regexp_replace(lower(btrim(coalesce(v_customer->>'address', ''))), '\s+', ' ', 'g'), '');
  v_postcode text := nullif(regexp_replace(upper(btrim(coalesce(v_customer->>'postcode', ''))), '\s+', '', 'g'), '');
  v_name text := nullif(regexp_replace(lower(btrim(coalesce(v_customer->>'name', ''))), '\s+', ' ', 'g'), '');
  v_photo jsonb;
begin
  if p_owner_id is null then raise exception 'Missing owner.' using errcode = '22023'; end if;
  if v_name is null then raise exception 'customer.name is required.' using errcode = '22023'; end if;
  if v_title = '' then raise exception 'job.title is required.' using errcode = '22023'; end if;
  if not v_booking_confirmed or v_scheduled_date is null then raise exception 'A confirmed scheduled date is required.' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtext(p_owner_id::text));
  if v_source_reference is not null then
    select s.customer_id, s.customer_status, s.job_id into v_existing
      from public.chatgpt_job_submissions s
      where s.owner_id = p_owner_id and s.source_reference = v_source_reference;
    if found then
      return query select v_existing.customer_id, v_existing.customer_status, v_existing.job_id, true;
      return;
    end if;
  end if;

  if v_customer_id is null and v_phone is not null then
    select c.id into v_customer_id from public.customers c
      where c.owner_id = p_owner_id and c.archived_at is null
      and nullif(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), '') = v_phone
      order by c.updated_at desc nulls last limit 1;
  end if;
  if v_customer_id is null and v_email is not null then
    select c.id into v_customer_id from public.customers c
      where c.owner_id = p_owner_id and c.archived_at is null
      and nullif(lower(btrim(coalesce(c.email, ''))), '') = v_email
      order by c.updated_at desc nulls last limit 1;
  end if;
  if v_customer_id is null and v_address is not null and v_postcode is not null then
    select c.id into v_customer_id from public.customers c
      where c.owner_id = p_owner_id and c.archived_at is null
      and nullif(regexp_replace(lower(btrim(coalesce(c.address, ''))), '\s+', ' ', 'g'), '') = v_address
      and nullif(regexp_replace(upper(btrim(coalesce(c.postcode, ''))), '\s+', '', 'g'), '') = v_postcode
      order by c.updated_at desc nulls last limit 1;
  end if;
  if v_customer_id is null and v_name is not null and v_address is not null then
    select c.id into v_customer_id from public.customers c
      where c.owner_id = p_owner_id and c.archived_at is null
      and regexp_replace(lower(btrim(c.name)), '\s+', ' ', 'g') = v_name
      and nullif(regexp_replace(lower(btrim(coalesce(c.address, ''))), '\s+', ' ', 'g'), '') = v_address
      order by c.updated_at desc nulls last limit 1;
  end if;
  if v_customer_id is null then
    insert into public.customers (owner_id, name, phone, email, address, postcode, status, notes)
    values (
      p_owner_id, left(btrim(v_customer->>'name'), 160),
      nullif(left(btrim(coalesce(v_customer->>'phone', '')), 80), ''),
      nullif(lower(left(btrim(coalesce(v_customer->>'email', '')), 320)), ''),
      nullif(left(btrim(coalesce(v_customer->>'address', '')), 800), ''),
      nullif(upper(left(btrim(coalesce(v_customer->>'postcode', '')), 20)), ''),
      'not_contacted', 'Created from ChatGPT work booking.'
    ) returning id into v_customer_id;
    v_customer_status := 'created';
  else
    v_customer_status := 'matched';
  end if;

  insert into public.jobs (
    owner_id, customer_id, title, job_type, status, scheduled_date, scheduled_time,
    address, postcode, description, billing_method, lead_source, lead_channel,
    lead_received_at, property_type, boiler_make, boiler_model
  ) values (
    p_owner_id, v_customer_id, v_title,
    nullif(left(btrim(coalesce(v_job->>'job_type', '')), 120), ''), 'booked',
    v_scheduled_date, v_scheduled_time,
    nullif(left(btrim(coalesce(v_customer->>'address', '')), 800), ''),
    nullif(upper(left(btrim(coalesce(v_customer->>'postcode', '')), 20)), ''),
    nullif(left(concat_ws(E'\n\n', nullif(btrim(coalesce(v_job->>'description', '')), ''), nullif(btrim(coalesce(p_package->>'notes', '')), ''), nullif(btrim(coalesce(v_job->>'assumptions', '')), '')), 12000), ''),
    'time_materials', coalesce(nullif(left(btrim(coalesce(v_lead->>'source', '')), 120), ''), 'other'),
    'chatgpt', now(),
    nullif(left(btrim(coalesce(v_job->>'property_type', '')), 120), ''),
    nullif(left(btrim(coalesce(v_job->>'boiler_make', '')), 120), ''),
    nullif(left(btrim(coalesce(v_job->>'boiler_model', '')), 120), '')
  ) returning id into v_job_id;

  insert into public.lead_events (owner_id, event_type, lead_source, lead_channel, contact_name, phone, email, postcode, message, customer_id, job_id, metadata)
  values (
    p_owner_id, 'other', coalesce(nullif(left(btrim(coalesce(v_lead->>'source', '')), 120), ''), 'other'), 'chatgpt',
    left(btrim(v_customer->>'name'), 160), nullif(left(btrim(coalesce(v_customer->>'phone', '')), 80), ''),
    nullif(lower(left(btrim(coalesce(v_customer->>'email', '')), 320)), ''), nullif(upper(left(btrim(coalesce(v_customer->>'postcode', '')), 20)), ''),
    nullif(left(btrim(coalesce(v_job->>'description', '')), 12000), ''), v_customer_id, v_job_id,
    jsonb_build_object('source', 'chatgpt', 'source_reference', v_source_reference, 'scheduled_date', v_scheduled_date, 'scheduled_time', v_scheduled_time)
  );

  for v_photo in select value from jsonb_array_elements(coalesce(p_package->'photos', '[]'::jsonb)) loop
    insert into public.job_photos (owner_id, job_id, customer_id, category, description, storage_path, file_name, mime_type, file_size, external_url, is_external_reference)
    values (
      p_owner_id, v_job_id, v_customer_id, coalesce(nullif(left(btrim(v_photo->>'category'), 80), ''), 'During'),
      nullif(left(btrim(coalesce(v_photo->>'description', '')), 1000), ''), 'external-reference',
      coalesce(nullif(left(btrim(coalesce(v_photo->>'file_name', '')), 255), ''), 'ChatGPT photo reference'),
      nullif(left(btrim(coalesce(v_photo->>'mime_type', '')), 120), ''), nullif(v_photo->>'file_size', '')::bigint,
      nullif(left(btrim(coalesce(v_photo->>'url', '')), 2000), ''), true
    );
  end loop;

  insert into public.chatgpt_job_submissions (owner_id, source_reference, customer_id, customer_status, job_id)
  values (p_owner_id, coalesce(v_source_reference, gen_random_uuid()::text), v_customer_id, v_customer_status, v_job_id);
  return query select v_customer_id, v_customer_status, v_job_id, false;
end;
$$;

revoke all on function public.create_chatgpt_job(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.create_chatgpt_job(uuid, jsonb) to service_role;

commit;
