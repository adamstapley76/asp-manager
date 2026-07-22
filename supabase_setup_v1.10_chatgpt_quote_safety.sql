-- ChatGPT -> ASP Manager quote matching, idempotency and response details.
-- Server-side only: this function remains callable exclusively by service_role.

begin;

alter table public.chatgpt_quote_submissions
  add column if not exists customer_status text check (customer_status in ('matched', 'created'));

update public.chatgpt_quote_submissions
set customer_status = 'matched'
where customer_status is null;

alter table public.chatgpt_quote_submissions
  alter column customer_status set not null;

drop function if exists public.create_chatgpt_quote(uuid, jsonb);

create function public.create_chatgpt_quote(p_owner_id uuid, p_package jsonb)
returns table(
  customer_id uuid,
  customer_status text,
  job_id uuid,
  quote_id uuid,
  quote_number text,
  duplicate boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_customer jsonb := coalesce(p_package->'customer', '{}'::jsonb);
  v_job jsonb := coalesce(p_package->'job', '{}'::jsonb);
  v_quote jsonb := coalesce(p_package->'quote', '{}'::jsonb);
  v_lead jsonb := coalesce(p_package->'lead', '{}'::jsonb);
  v_source_reference text := nullif(btrim(coalesce(p_package->>'source_reference', '')), '');
  v_customer_id uuid;
  v_customer_status text;
  v_job_id uuid;
  v_quote_id uuid;
  v_quote_number text;
  v_existing record;
  v_title text := left(btrim(coalesce(v_job->>'title', '')), 240);
  v_issue_date date := coalesce(nullif(v_quote->>'issue_date', '')::date, current_date);
  v_vat_rate numeric := greatest(0, least(100, coalesce(nullif(v_quote->>'vat_rate', '')::numeric, 20)));
  v_lines jsonb := coalesce(v_quote->'line_items', '[]'::jsonb);
  v_subtotal numeric := 0;
  v_sequence integer;
  v_photo jsonb;
  v_phone text := nullif(regexp_replace(coalesce(v_customer->>'phone', ''), '\\D', '', 'g'), '');
  v_email text := nullif(lower(btrim(coalesce(v_customer->>'email', ''))), '');
  v_address text := nullif(regexp_replace(lower(btrim(coalesce(v_customer->>'address', ''))), '\\s+', ' ', 'g'), '');
  v_postcode text := nullif(regexp_replace(upper(btrim(coalesce(v_customer->>'postcode', ''))), '\\s+', '', 'g'), '');
  v_name text := nullif(regexp_replace(lower(btrim(coalesce(v_customer->>'name', ''))), '\\s+', ' ', 'g'), '');
begin
  if p_owner_id is null then raise exception 'Missing owner.' using errcode = '22023'; end if;
  if v_name is null then raise exception 'customer.name is required.' using errcode = '22023'; end if;
  if v_title = '' then raise exception 'job.title is required.' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtext(p_owner_id::text));

  if v_source_reference is not null then
    select s.customer_id, s.customer_status, s.job_id, s.quote_id, d.document_number
      into v_existing
    from public.chatgpt_quote_submissions s
    join public.documents d on d.id = s.quote_id
    where s.owner_id = p_owner_id and s.source_reference = v_source_reference;
    if found then
      return query select v_existing.customer_id, v_existing.customer_status, v_existing.job_id, v_existing.quote_id, v_existing.document_number, true;
      return;
    end if;
  end if;

  -- Prefer the strongest customer identifiers. Never use a partial address or
  -- name by itself as a reliable match.
  if v_phone is not null then
    select c.id into v_customer_id
    from public.customers c
    where c.owner_id = p_owner_id and c.archived_at is null
      and nullif(regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g'), '') = v_phone
    order by c.updated_at desc nulls last
    limit 1;
  end if;

  if v_customer_id is null and v_email is not null then
    select c.id into v_customer_id
    from public.customers c
    where c.owner_id = p_owner_id and c.archived_at is null
      and nullif(lower(btrim(coalesce(c.email, ''))), '') = v_email
    order by c.updated_at desc nulls last
    limit 1;
  end if;

  if v_customer_id is null and v_address is not null and v_postcode is not null then
    select c.id into v_customer_id
    from public.customers c
    where c.owner_id = p_owner_id and c.archived_at is null
      and nullif(regexp_replace(lower(btrim(coalesce(c.address, ''))), '\\s+', ' ', 'g'), '') = v_address
      and nullif(regexp_replace(upper(btrim(coalesce(c.postcode, ''))), '\\s+', '', 'g'), '') = v_postcode
    order by c.updated_at desc nulls last
    limit 1;
  end if;

  if v_customer_id is null and v_name is not null and v_address is not null then
    select c.id into v_customer_id
    from public.customers c
    where c.owner_id = p_owner_id and c.archived_at is null
      and regexp_replace(lower(btrim(c.name)), '\\s+', ' ', 'g') = v_name
      and nullif(regexp_replace(lower(btrim(coalesce(c.address, ''))), '\\s+', ' ', 'g'), '') = v_address
    order by c.updated_at desc nulls last
    limit 1;
  end if;

  if v_customer_id is null then
    insert into public.customers (owner_id, name, phone, email, address, postcode, status, notes)
    values (
      p_owner_id,
      left(btrim(v_customer->>'name'), 160),
      nullif(left(btrim(coalesce(v_customer->>'phone', '')), 80), ''),
      nullif(lower(left(btrim(coalesce(v_customer->>'email', '')), 320)), ''),
      nullif(left(btrim(coalesce(v_customer->>'address', '')), 800), ''),
      nullif(upper(left(btrim(coalesce(v_customer->>'postcode', '')), 20)), ''),
      'not_contacted',
      'Created from ChatGPT quote intake.'
    ) returning id into v_customer_id;
    v_customer_status := 'created';
  else
    v_customer_status := 'matched';
  end if;

  if jsonb_array_length(v_lines) = 0 then
    v_lines := jsonb_build_array(jsonb_build_object('description', v_title, 'quantity', 1, 'unit_price', coalesce(nullif(v_quote->>'price_ex_vat', '')::numeric, 0)));
  end if;
  select coalesce(sum(greatest(0, coalesce((item->>'quantity')::numeric, 1)) * greatest(0, coalesce((item->>'unit_price')::numeric, 0))), 0)
    into v_subtotal from jsonb_array_elements(v_lines) as item;

  insert into public.jobs (owner_id, customer_id, title, job_type, status, address, postcode, description, quoted_amount, agreed_price, billing_method, lead_source, lead_channel, lead_received_at, property_type, boiler_make, boiler_model, follow_up_date)
  values (
    p_owner_id, v_customer_id, v_title,
    nullif(left(btrim(coalesce(v_job->>'job_type', '')), 120), ''), 'quoted',
    nullif(left(btrim(coalesce(v_customer->>'address', '')), 800), ''),
    nullif(upper(left(btrim(coalesce(v_customer->>'postcode', '')), 20)), ''),
    nullif(left(concat_ws(E'\n\n', nullif(btrim(coalesce(v_job->>'description', '')), ''), nullif(btrim(coalesce(v_quote->>'wording', '')), ''), nullif(btrim(coalesce(p_package->>'notes', '')), ''), nullif(btrim(coalesce(v_job->>'assumptions', '')), '')), 12000), ''),
    v_subtotal, v_subtotal, 'quoted',
    coalesce(nullif(left(btrim(coalesce(v_lead->>'source', '')), 120), ''), 'other'),
    'chatgpt', now(),
    nullif(left(btrim(coalesce(v_job->>'property_type', '')), 120), ''),
    nullif(left(btrim(coalesce(v_job->>'boiler_make', '')), 120), ''),
    nullif(left(btrim(coalesce(v_job->>'boiler_model', '')), 120), ''),
    nullif(v_job->>'follow_up_date', '')::date
  ) returning id into v_job_id;

  select coalesce(max(nullif(regexp_replace(document_number, ('^Q-' || extract(year from v_issue_date)::text || '-'), ''), '')::integer), 0) + 1
    into v_sequence from public.documents
    where owner_id = p_owner_id and type = 'quote' and document_number like ('Q-' || extract(year from v_issue_date)::text || '-%');
  v_quote_number := 'Q-' || extract(year from v_issue_date)::text || '-' || lpad(v_sequence::text, 3, '0');

  insert into public.documents (owner_id, customer_id, job_id, type, document_number, status, title, issue_date, due_date, line_items, subtotal, vat_rate, vat_amount, total, notes)
  values (p_owner_id, v_customer_id, v_job_id, 'quote', v_quote_number, 'draft', v_title, v_issue_date, v_issue_date + 30, v_lines, v_subtotal, v_vat_rate, round(v_subtotal * v_vat_rate / 100, 2), round(v_subtotal * (1 + v_vat_rate / 100), 2), nullif(left(concat_ws(E'\n\n', nullif(btrim(coalesce(v_quote->>'wording', '')), ''), nullif(btrim(coalesce(p_package->>'notes', '')), ''), case when jsonb_array_length(coalesce(v_job->'materials', '[]'::jsonb)) > 0 then 'Materials: ' || (v_job->'materials')::text else null end, case when jsonb_array_length(coalesce(v_job->'follow_up_reminders', '[]'::jsonb)) > 0 then 'Follow-up reminders: ' || (v_job->'follow_up_reminders')::text else null end), 12000), ''))
  returning id into v_quote_id;

  insert into public.lead_events (owner_id, event_type, lead_source, lead_channel, contact_name, phone, email, postcode, message, customer_id, job_id, metadata)
  values (p_owner_id, 'other', coalesce(nullif(left(btrim(coalesce(v_lead->>'source', '')), 120), ''), 'other'), 'chatgpt', left(btrim(v_customer->>'name'), 160), nullif(left(btrim(coalesce(v_customer->>'phone', '')), 80), ''), nullif(lower(left(btrim(coalesce(v_customer->>'email', '')), 320)), ''), nullif(upper(left(btrim(coalesce(v_customer->>'postcode', '')), 20)), ''), nullif(left(concat_ws(E'\n\n', nullif(btrim(coalesce(v_job->>'description', '')), ''), nullif(btrim(coalesce(v_quote->>'wording', '')), '')), 12000), ''), v_customer_id, v_job_id, jsonb_build_object('source', 'chatgpt', 'source_reference', v_source_reference, 'confidence', v_job->>'confidence', 'assumptions', v_job->>'assumptions', 'materials', coalesce(v_job->'materials', '[]'::jsonb), 'follow_up_reminders', coalesce(v_job->'follow_up_reminders', '[]'::jsonb)));

  for v_photo in select value from jsonb_array_elements(coalesce(p_package->'photos', '[]'::jsonb)) loop
    insert into public.job_photos (owner_id, job_id, customer_id, category, description, storage_path, file_name, mime_type, file_size, external_url, is_external_reference)
    values (p_owner_id, v_job_id, v_customer_id, coalesce(nullif(left(btrim(v_photo->>'category'), 80), ''), 'During'), nullif(left(btrim(coalesce(v_photo->>'description', '')), 1000), ''), 'external-reference', coalesce(nullif(left(btrim(coalesce(v_photo->>'file_name', '')), 255), ''), 'ChatGPT photo reference'), nullif(left(btrim(coalesce(v_photo->>'mime_type', '')), 120), ''), nullif(v_photo->>'file_size', '')::bigint, nullif(left(btrim(coalesce(v_photo->>'url', '')), 2000), ''), true);
  end loop;

  insert into public.chatgpt_quote_submissions (owner_id, source_reference, customer_id, customer_status, job_id, quote_id)
  values (p_owner_id, coalesce(v_source_reference, gen_random_uuid()::text), v_customer_id, v_customer_status, v_job_id, v_quote_id);

  return query select v_customer_id, v_customer_status, v_job_id, v_quote_id, v_quote_number, false;
end;
$$;

revoke all on function public.create_chatgpt_quote(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.create_chatgpt_quote(uuid, jsonb) to service_role;

commit;
