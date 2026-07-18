import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
})

const isToken = (value: string | null) => !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char] || char))
const pounds = (value: unknown) => `£${Number(value || 0).toFixed(2)}`

const quotePage = (quote: any, token: string) => {
  const customer = Array.isArray(quote.customers) ? quote.customers[0] : quote.customers
  const rows = Array.isArray(quote.line_items) ? quote.line_items.map((line: any) => `<tr><td>${escapeHtml(line.description)}</td><td>${escapeHtml(line.quantity)}</td><td>${pounds(line.unit_price)}</td><td>${pounds(Number(line.quantity || 0) * Number(line.unit_price || 0))}</td></tr>`).join('') : ''
  const accepted = quote.status === 'accepted'
  return `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quote ${escapeHtml(quote.document_number)}</title><style>body{margin:0;background:#f3f5f7;color:#172334;font:16px Aptos,Segoe UI,Arial,sans-serif}.page{max-width:760px;margin:0 auto;background:#fff;min-height:100vh;padding:30px 24px;box-sizing:border-box}.bar{height:5px;background:#cda136;margin:-30px -24px 28px}.eyebrow{font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#a77816}.head{display:flex;justify-content:space-between;gap:18px;border-bottom:1px solid #dce2e8;padding-bottom:20px}.head h1{margin:4px 0 0;font-size:30px}.muted{color:#526173;line-height:1.55}.card{margin-top:22px;border:1px solid #dce2e8;border-radius:12px;padding:18px}.card h2{margin:0 0 10px;font-size:14px;text-transform:uppercase;letter-spacing:.08em}.items{width:100%;border-collapse:collapse;margin-top:22px}.items th{background:#172334;color:#fff;padding:10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em}.items td{padding:11px 10px;border-bottom:1px solid #e5e9ed}.items th:not(:first-child),.items td:not(:first-child){text-align:right}.total{margin:22px 0 0 auto;max-width:290px;font-size:18px;font-weight:800;display:flex;justify-content:space-between;border-top:2px solid #172334;border-bottom:2px solid #172334;padding:10px 0}.field{margin-top:18px}.field label{display:block;font-size:13px;font-weight:700;margin-bottom:6px}.field textarea{width:100%;min-height:92px;box-sizing:border-box;border:1px solid #bfc9d3;border-radius:8px;padding:10px;font:inherit}.button{width:100%;margin-top:16px;border:0;border-radius:8px;padding:14px;background:#cda136;color:#172334;font:800 16px inherit;cursor:pointer}.button:disabled{opacity:.65}.success{background:#ecfdf3;border-color:#86efac}.foot{margin-top:30px;color:#778596;font-size:13px;text-align:center}@media(max-width:540px){.page{padding:24px 16px}.bar{margin:-24px -16px 24px}.head{display:block}.items{font-size:13px}.items th,.items td{padding:9px 6px}}</style><main class="page"><div class="bar"></div><div class="head"><div><div class="eyebrow">Adam Stapley Plumbing Ltd</div><h1>Quote</h1><div class="muted">${escapeHtml(quote.document_number)} · Valid until ${escapeHtml(quote.due_date || 'the date shown on your quote')}</div></div><div class="muted">${escapeHtml(customer?.name || '')}<br>${escapeHtml(customer?.address || '')}<br>${escapeHtml(customer?.postcode || '')}</div></div><section class="card"><h2>${escapeHtml(quote.title)}</h2>${quote.notes ? `<div class="muted">${escapeHtml(quote.notes).replace(/\n/g, '<br>')}</div>` : ''}<table class="items"><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table><div class="total"><span>Total inc VAT</span><span>${pounds(quote.total)}</span></div></section>${accepted ? `<section class="card success"><h2>Quote accepted</h2><div class="muted">Thank you. Adam will be in touch to arrange a suitable date.</div></section>` : `<section class="card"><h2>Accept this quote</h2><div class="muted">You can add an optional note for Adam before confirming.</div><div class="field"><label for="comment">Your note (optional)</label><textarea id="comment" placeholder="For example, preferred dates or anything you would like to discuss"></textarea></div><button class="button" id="accept">Accept quote</button><div id="message" class="muted" style="margin-top:12px"></div></section>`}<div class="foot">Adam Stapley Plumbing Ltd · Gas Safe registration 234795</div></main><script>const button=document.getElementById('accept');if(button)button.addEventListener('click',async()=>{button.disabled=true;button.textContent='Saving…';const message=document.getElementById('message');try{const response=await fetch(location.pathname,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:'${token}',comment:document.getElementById('comment').value})});const body=await response.json();if(!response.ok)throw new Error(body.error||'Please try again.');message.textContent='Thank you — your quote has been accepted. Adam will be in touch to arrange a date.';button.remove()}catch(error){message.textContent=error.message||'Please try again.';button.disabled=false;button.textContent='Accept quote'}})</script></html>`
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const url = new URL(request.url)
  const payload = request.method === 'GET' ? {} : await request.json().catch(() => ({}))
  const token = request.method === 'GET' ? url.searchParams.get('token') : String(payload.token || '')
  if (!isToken(token)) return json({ error: 'Quote not found.' }, 404)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  )
  const { data: quote, error } = await supabase
    .from('documents')
    .select('id, customer_id, job_id, type, document_number, status, title, issue_date, due_date, line_items, subtotal, vat_rate, vat_amount, total, notes, accepted_at, accepted_comment, customers(name, address, postcode)')
    .eq('public_token', token)
    .eq('type', 'quote')
    .maybeSingle()
  if (error || !quote) return json({ error: 'Quote not found.' }, 404)

  if (request.method === 'GET') return new Response(quotePage(quote, token || ''), { headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' } })
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  if (quote.status === 'declined' || quote.status === 'void') return json({ error: 'This quote is no longer available.' }, 409)

  const comment = String(payload.comment || '').trim().slice(0, 2000)
  const acceptedAt = quote.accepted_at || new Date().toISOString()
  const { error: acceptError } = await supabase.from('documents').update({
    status: 'accepted', accepted_at: acceptedAt, accepted_comment: comment || null, updated_at: new Date().toISOString(),
  }).eq('id', quote.id)
  if (acceptError) return json({ error: 'We could not save your acceptance. Please try again.' }, 500)

  if (quote.job_id) {
    const { data: job } = await supabase.from('jobs').select('status').eq('id', quote.job_id).maybeSingle()
    if (job && !['booked', 'in_progress', 'completed'].includes(job.status)) {
      await supabase.from('jobs').update({ status: 'to_book', scheduled_date: null, scheduled_time: null, waiting_reason: null, updated_at: new Date().toISOString() }).eq('id', quote.job_id)
    }
  }

  return json({ accepted: true, accepted_at: acceptedAt })
})
