import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const OWNER_ID = '3f957c1d-a1f0-4484-804d-d57b5f52b6e7'
const ALLOWED_ORIGINS = new Set(['https://adamstapley.co.uk', 'https://www.adamstapley.co.uk'])
const allowedEvents = new Set(['form_enquiry', 'phone_click', 'whatsapp_click'])
const text = (value: unknown, max = 500) => String(value ?? '').trim().slice(0, max)
const json = (body: unknown, status = 200, origin = 'https://adamstapley.co.uk') => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    'vary': 'Origin',
  },
})

Deno.serve(async (request) => {
  const origin = request.headers.get('origin') || ''
  if (!ALLOWED_ORIGINS.has(origin)) return json({ error: 'Origin not allowed.' }, 403)
  if (request.method === 'OPTIONS') return json({ ok: true }, 200, origin)
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, origin)

  const payload = await request.json().catch(() => null)
  const eventType = text(payload?.event_type, 40)
  if (!payload || !allowedEvents.has(eventType)) return json({ error: 'Invalid event.' }, 400, origin)
  if (text(payload.website, 200)) return json({ ok: true }, 202, origin) // Honeypot.

  const event = {
    owner_id: OWNER_ID,
    event_type: eventType,
    lead_source: text(payload.lead_source, 50) || 'website',
    lead_channel: text(payload.lead_channel, 50) || (eventType === 'phone_click' ? 'phone' : eventType === 'whatsapp_click' ? 'whatsapp' : 'form'),
    contact_name: text(payload.contact_name, 160) || null,
    phone: text(payload.phone, 50) || null,
    email: text(payload.email, 254).toLowerCase() || null,
    postcode: text(payload.postcode, 20).toUpperCase() || null,
    message: text(payload.message, 4000) || null,
    landing_page: text(payload.landing_page, 1000) || null,
    referrer: text(payload.referrer, 1000) || null,
    gclid: text(payload.gclid, 300) || null,
    gbraid: text(payload.gbraid, 300) || null,
    wbraid: text(payload.wbraid, 300) || null,
    utm_source: text(payload.utm_source, 200) || null,
    utm_medium: text(payload.utm_medium, 200) || null,
    utm_campaign: text(payload.utm_campaign, 300) || null,
    utm_term: text(payload.utm_term, 300) || null,
    utm_content: text(payload.utm_content, 300) || null,
    external_event_id: text(payload.external_event_id, 200) || null,
    metadata: { page_title: text(payload.page_title, 300), form_id: text(payload.form_id, 50) },
  }

  if (eventType === 'form_enquiry' && (!event.contact_name || !event.phone || !event.postcode)) {
    return json({ error: 'Name, phone and postcode are required.' }, 400, origin)
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '')
  const { data: existing } = event.external_event_id
    ? await supabase.from('lead_events').select('id, job_id').eq('owner_id', OWNER_ID).eq('external_event_id', event.external_event_id).maybeSingle()
    : { data: null }
  if (existing) return json({ ok: true, event_id: existing.id, job_id: existing.job_id, duplicate: true }, 200, origin)

  const { data: savedEvent, error: eventError } = await supabase.from('lead_events').insert(event).select('id').single()
  if (eventError) return json({ error: 'Could not record lead interaction.' }, 500, origin)
  if (eventType !== 'form_enquiry') return json({ ok: true, event_id: savedEvent.id }, 201, origin)

  let customerId: string | null = null
  const normalisedPhone = event.phone.replace(/\D/g, '').replace(/^44/, '0')
  const { data: candidates } = await supabase.from('customers').select('id, phone, email').eq('owner_id', OWNER_ID).limit(500)
  const matched = (candidates || []).find((customer: any) => {
    const phone = String(customer.phone || '').replace(/\D/g, '').replace(/^44/, '0')
    return (normalisedPhone && phone === normalisedPhone) || (event.email && String(customer.email || '').toLowerCase() === event.email)
  })
  if (matched) customerId = matched.id
  else {
    const { data: customer, error } = await supabase.from('customers').insert({
      owner_id: OWNER_ID, name: event.contact_name, phone: event.phone, email: event.email || '', postcode: event.postcode,
      status: 'not_contacted', notes: 'Created automatically from the boiler replacement website enquiry form.',
    }).select('id').single()
    if (error) return json({ error: 'Enquiry recorded, but customer creation failed.' }, 500, origin)
    customerId = customer.id
  }

  const source = event.gclid || event.gbraid || event.wbraid || /google.*(cpc|paid)|cpc.*google/i.test(`${event.utm_source} ${event.utm_medium}`) ? 'google_ads' : 'website'
  const { data: job, error: jobError } = await supabase.from('jobs').insert({
    owner_id: OWNER_ID, customer_id: customerId, title: 'Boiler replacement enquiry', job_type: 'Boiler installation', status: 'enquiry',
    postcode: event.postcode, description: event.message || '', lead_source: source, lead_channel: 'form', lead_received_at: new Date().toISOString(),
    lead_campaign: event.utm_campaign, lead_keyword: event.utm_term, lead_landing_page: event.landing_page,
    gclid: event.gclid, gbraid: event.gbraid, wbraid: event.wbraid, utm_source: event.utm_source, utm_medium: event.utm_medium,
    utm_campaign: event.utm_campaign, utm_term: event.utm_term, utm_content: event.utm_content, lead_event_id: savedEvent.id,
  }).select('id').single()
  if (jobError) return json({ error: 'Enquiry recorded, but job creation failed.' }, 500, origin)
  await supabase.from('lead_events').update({ customer_id: customerId, job_id: job.id, lead_source: source }).eq('id', savedEvent.id)
  return json({ ok: true, event_id: savedEvent.id, job_id: job.id }, 201, origin)
})
