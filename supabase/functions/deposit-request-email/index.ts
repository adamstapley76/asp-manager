import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS', 'content-type': 'application/json' }
const text = (value: unknown) => String(value ?? '').trim()
const esc = (value: unknown) => text(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char))
const money = (value: unknown) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(value || 0))

function customerViewUrl(value: unknown, token: string) {
  try {
    const url = new URL(text(value))
    const allowed = url.protocol === 'https:' && (url.hostname === 'app.adamstapley.co.uk' || url.hostname === 'asp-manager.vercel.app' || url.hostname.endsWith('.vercel.app'))
    if (!allowed || !url.pathname.endsWith('/document.html')) return ''
    url.search = new URLSearchParams({ token }).toString()
    return url.toString()
  } catch { return '' }
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Not found.' }), { status: 404, headers: corsHeaders })
  const admin = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '')
  const auth = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const { data: authData } = auth ? await admin.auth.getUser(auth) : { data: { user: null } }
  const user = authData.user
  if (!user) return new Response(JSON.stringify({ error: 'Sign in again before sending email.' }), { status: 401, headers: corsHeaders })

  const payload = await request.json().catch(() => ({}))
  const amount = Number(payload.amount || 0)
  if (!Number.isFinite(amount) || amount <= 0) return new Response(JSON.stringify({ error: 'Enter a valid deposit amount.' }), { status: 400, headers: corsHeaders })
  const description = text(payload.description) || 'Materials and availability deposit'
  let title = 'your job', quoteNumber = '', customer: any = null, token = ''

  if (text(payload.quote_id)) {
    const { data: quote } = await admin.from('documents').select('id, owner_id, customer_id, document_number, title, public_token, customers(name, email)').eq('id', text(payload.quote_id)).eq('owner_id', user.id).eq('type', 'quote').maybeSingle()
    if (!quote) return new Response(JSON.stringify({ error: 'Quote not found.' }), { status: 404, headers: corsHeaders })
    title = text(quote.title) || 'your quoted work'; quoteNumber = text(quote.document_number); token = text(quote.public_token)
    customer = Array.isArray(quote.customers) ? quote.customers[0] : quote.customers
  } else if (text(payload.job_id)) {
    const { data: job } = await admin.from('jobs').select('id, owner_id, title, customers(name, email)').eq('id', text(payload.job_id)).eq('owner_id', user.id).maybeSingle()
    if (!job) return new Response(JSON.stringify({ error: 'Job not found.' }), { status: 404, headers: corsHeaders })
    title = text(job.title) || 'your job'; customer = Array.isArray(job.customers) ? job.customers[0] : job.customers
  } else return new Response(JSON.stringify({ error: 'Choose a quote or job first.' }), { status: 400, headers: corsHeaders })

  if (!text(customer?.email)) return new Response(JSON.stringify({ error: "Add the customer's email address first." }), { status: 400, headers: corsHeaders })
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) return new Response(JSON.stringify({ error: 'Email sending is not configured yet.' }), { status: 503, headers: corsHeaders })
  const first = text(customer.name).split(/\s+/)[0] || 'there'
  const reference = quoteNumber || 'Deposit'
  const viewUrl = token ? customerViewUrl(payload.view_url, token) : ''
  const quoteBlock = viewUrl ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:30px auto"><tr><td bgcolor="#c9a227" style="border-radius:999px"><a href="${esc(viewUrl)}" style="display:inline-block;padding:16px 34px;color:#10263f;font-size:17px;font-weight:800;text-decoration:none">View quote</a></td></tr></table>` : ''
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Arial,sans-serif;color:#172334"><main style="max-width:600px;margin:24px auto;background:#fff;border-radius:14px;padding:32px"><h1 style="margin:0 0 16px;color:#10263f">Adam Stapley Plumbing</h1><p>Hi ${esc(first)},</p><p>To help secure materials and availability for <b>${esc(title)}</b>, a deposit of <b>${esc(money(amount))}</b> is requested.</p><div style="background:#f6f8fb;border-radius:10px;padding:18px"><b>${esc(description)}</b><br><span style="color:#596579">Deposit requested: ${esc(money(amount))}</span></div><h2 style="color:#10263f;font-size:18px;margin:26px 0 8px">Bank transfer details</h2><p style="line-height:1.6;margin:0">NatWest<br>Sort code: <b>60-08-01</b><br>Account number: <b>62947591</b><br>Payment reference: <b>${esc(reference)}</b></p><p>There is no pressure — please let me know if you would like to discuss arrangements.</p>${quoteBlock}<p style="color:#596579;font-size:13px">Adam Stapley Plumbing<br>07966 858348 &middot; info@adamstapley.co.uk</p></main></body></html>`
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: 'Adam Stapley Plumbing Ltd <info@adamstapley.co.uk>', to: [text(customer.email)], reply_to: 'info@adamstapley.co.uk', subject: `Deposit request from Adam Stapley Plumbing${quoteNumber ? ` — ${quoteNumber}` : ''}`, html }) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !text(result?.id)) return new Response(JSON.stringify({ error: text(result?.message) || 'Email provider could not send the request.' }), { status: 400, headers: corsHeaders })
  return new Response(JSON.stringify({ sent: true }), { headers: corsHeaders })
})
