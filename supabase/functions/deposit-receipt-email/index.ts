import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS', 'content-type': 'application/json' }
const text = (value: unknown) => String(value ?? '').trim()
const esc = (value: unknown) => text(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char))
const money = (value: unknown) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(value || 0))

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Not found.' }), { status: 404, headers: corsHeaders })
  const admin = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '')
  const auth = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const { data: authData } = auth ? await admin.auth.getUser(auth) : { data: { user: null } }
  const user = authData.user
  if (!user) return new Response(JSON.stringify({ error: 'Sign in again before sending email.' }), { status: 401, headers: corsHeaders })
  const { deposit_id } = await request.json().catch(() => ({}))
  const { data: payment } = await admin.from('job_deposit_payments').select('id, owner_id, amount, receipt_token, jobs(title, customers(name, email))').eq('id', text(deposit_id)).eq('owner_id', user.id).maybeSingle()
  if (!payment) return new Response(JSON.stringify({ error: 'Deposit not found.' }), { status: 404, headers: corsHeaders })
  const job = Array.isArray(payment.jobs) ? payment.jobs[0] : payment.jobs
  const customer = Array.isArray(job?.customers) ? job.customers[0] : job?.customers
  if (!text(customer?.email)) return new Response(JSON.stringify({ error: 'Add the customer’s email address first.' }), { status: 400, headers: corsHeaders })
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) return new Response(JSON.stringify({ error: 'Email sending is not configured yet.' }), { status: 503, headers: corsHeaders })
  const receiptUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/deposit-receipt?token=${encodeURIComponent(text(payment.receipt_token))}`
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: 'Adam Stapley Plumbing <info@adamstapley.co.uk>', to: [text(customer.email)], reply_to: 'info@adamstapley.co.uk', subject: `Deposit receipt from Adam Stapley Plumbing`, html: `<main style="max-width:600px;margin:24px auto;padding:32px;background:#fff;border-radius:14px;font:16px Arial,sans-serif;color:#172334"><h1 style="margin:0 0 12px;color:#10263f">Thank you, ${esc(customer.name || 'there')}</h1><p>We have received your deposit of <b>${esc(money(payment.amount))}</b> for ${esc(job?.title || 'your job')}.</p><p>This will be deducted from the final invoice.</p><table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:36px auto"><tr><td bgcolor="#c9a227" style="border-radius:999px"><a href="${esc(receiptUrl)}" style="display:inline-block;padding:18px 42px;color:#10263f;font-size:18px;font-weight:800;text-decoration:none">View deposit receipt</a></td></tr></table><p style="color:#596579;font-size:13px">Adam Stapley Plumbing<br>07966 858348 · info@adamstapley.co.uk</p></main>` }) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !text(result?.id)) return new Response(JSON.stringify({ error: text(result?.message) || 'Email provider could not send the receipt.' }), { status: 400, headers: corsHeaders })
  await admin.from('job_deposit_payments').update({ receipt_sent_at: new Date().toISOString(), receipt_sent_to: text(customer.email), receipt_provider_id: text(result.id), updated_at: new Date().toISOString() }).eq('id', payment.id)
  return new Response(JSON.stringify({ sent: true }), { headers: corsHeaders })
})
