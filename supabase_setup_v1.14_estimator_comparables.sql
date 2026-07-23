-- Comparable-work estimator lookup and seeded editable guidance.
-- Server-side only: the ChatGPT endpoint authenticates before calling this.

begin;

create or replace function public.get_estimator_comparables(
  p_owner_id uuid,
  p_category text,
  p_limit integer default 8
)
returns table(
  document_number text,
  title text,
  price_ex_vat numeric,
  issue_date date,
  document_type text,
  status text
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select d.document_number, d.title, d.subtotal, d.issue_date, d.type, d.status
  from public.documents d
  left join public.jobs j on j.id = d.job_id and j.owner_id = d.owner_id
  where d.owner_id = p_owner_id
    and d.type in ('quote', 'invoice')
    and d.status not in ('draft', 'void')
    and coalesce(d.subtotal, 0) > 0
    and case p_category
      when 'boiler_conversion' then lower(concat_ws(' ', d.title, j.title, j.description)) ~ '(boiler.*(conversion|convert)|((conversion|convert).*(boiler|combi|heating))|conventional.*combi)'
      when 'boiler_installation' then lower(concat_ws(' ', d.title, j.title, j.description)) ~ '(boiler.*(install|replace|replacement|new)|((install|replace).*(boiler|combi)))'
      when 'boiler_service' then lower(concat_ws(' ', d.title, j.title, j.description)) ~ '(boiler.*service|annual.*service|gas.*service)'
      when 'repairs_and_breakdowns' then lower(concat_ws(' ', d.title, j.title, j.description)) ~ '(breakdown|fault|repair|leak|no hot water|no heating)'
      when 'plumbing' then lower(concat_ws(' ', d.title, j.title, j.description)) ~ '(plumb|tap|toilet|waste pipe|radiator|cylinder)'
      when 'bathroom_and_major_work' then lower(concat_ws(' ', d.title, j.title, j.description)) ~ '(bathroom|wet ?room|major alteration|refurb)'
      else false
    end
  order by d.issue_date desc nulls last, d.created_at desc
  limit greatest(1, least(coalesce(p_limit, 8), 12));
$$;

revoke all on function public.get_estimator_comparables(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.get_estimator_comparables(uuid, text, integer) to service_role;

insert into public.estimator_configurations (owner_id, version, configuration)
select distinct d.owner_id, 2,
  jsonb_build_object(
    'version', 2,
    'business_positioning', 'Adam Stapley Plumbing is a premium independent plumbing and heating company based in Epsom, Surrey. Gas engineer first, plumber second. 25+ years experience. Gas Safe Registered and G3 Qualified. Never compete on being the cheapest.',
    'pricing_philosophy', 'Use value-based pricing. Historic invoices and estimates are reference only for scope, wording, likely labour and materials, not automatic future selling prices. Recommend a fair, professional target price.',
    'quoting_rules', 'Consider experience, responsibility, urgency, travel, parking, access, materials, van stock, collection time, testing, commissioning, guarantees, administration, insurance, overheads, waste and profit. Use a fixed price only when the scope is sufficiently clear.',
    'wording_style', 'Use plain British English. Be professional and friendly. Describe a clear scope of works, quality materials, testing and commissioning, tidy completion and sensible exclusions. Never expose internal reasoning to customers.',
    'minimum_charge_ex_vat', 95,
    'target_pricing_guidance', 'Treat the minimum charge as a floor for normal call-outs, not an automatic price for every job. Flag uncertain scope for review rather than inventing a figure.',
    'boiler_pricing_guidance', 'For boiler work, allow for diagnosis, safe isolation, specialist responsibility, commissioning, testing, registration where applicable, materials, warranty and customer handover. Use comparable work as a review range, never as a replacement for proper scope review.',
    'plumbing_pricing_guidance', 'For plumbing work, account for access, investigation, responsibility for leaks or water damage, materials, travel, parking, collection time, testing and making good where included.',
    'recurring_service_behaviour', 'Use clear annual-service wording. Default to a fixed-price service where the appliance and scope are known. Record exclusions for repairs, parts and additional appliances unless specifically included.',
    'category_pricing_guidance', jsonb_build_object(
      'boiler_conversion', 'Use comparable accepted, sent or invoiced boiler conversions to produce an internal review range. Consider boiler size and location, whether tanks and cylinders are removed, flue route, controls, condensate, gas alterations, electrical work, making good, warranty and registration. Never use the £95 minimum charge for a conversion.',
      'boiler_installation', 'Use comparable boiler installation work only as a guide. Account for appliance specification, location, flue, controls, pipework, commissioning, warranty and registration. Require Adam final review.',
      'boiler_service', 'For a known single domestic boiler, use the normal service approach. Repairs, parts, additional appliances and remedial work remain separate unless included.',
      'repairs_and_breakdowns', 'Use the £95 minimum only as a normal starting point for clearly defined call-outs or diagnosis. Increase where access, risk, travel, testing or responsibility justifies it; ask for more detail when scope is unclear.',
      'plumbing', 'For plumbing work, identify whether this is a small defined repair or a larger installation. Use comparable work for larger installations and do not treat a minimum call-out as an installation price.',
      'bathroom_and_major_work', 'Treat bathroom and major alteration work as survey-and-review work. Use comparable projects for a broad internal range only; do not issue a final price without sufficient scope.'
    ),
    'comparable_work_policy', 'For substantial work, use relevant historical quotes and invoices as an internal pricing reference. Prefer similar scope, recent work and completed or accepted outcomes. Show Adam the range and assumptions; do not expose comparable customer details or internal reasoning to customers.',
    'standard_templates', jsonb_build_object(
      'fixed_price_quote', 'We will complete the works described using suitable quality materials, test the completed work and leave the work area tidy. This is a fixed-price quotation based on the scope shown. Any additional work outside that scope will be discussed and agreed before proceeding.',
      'service_quote', 'Carry out the agreed service, complete the relevant safety and operational checks, and provide clear findings. Repairs, replacement parts and work outside the agreed service scope are excluded unless specifically stated.'
    ),
    'default_inclusions', 'Labour for the stated scope; suitable quality materials where listed; testing and commissioning where applicable; tidy completion; sensible administration and guarantee responsibility.',
    'default_exclusions', 'Unforeseen defects, concealed damage, additional work outside the stated scope, specialist access equipment, parking charges, making good and replacement parts unless specifically included.',
    'vat_rate', 20,
    'vat_behaviour', 'Store prices ex VAT. Show VAT separately where required. Apply the configured VAT rate unless a legitimate manual override is recorded.',
    'manual_override_rules', 'The final approved price can be changed by Adam after review. Preserve the original estimator recommendation, source price and reason for any manual override for internal review only.'
  )
from public.documents d
where not exists (
  select 1 from public.estimator_configurations c where c.owner_id = d.owner_id
)
on conflict (owner_id) do nothing;

commit;
