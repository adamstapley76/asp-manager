import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const text = (value: unknown) => String(value ?? '').trim()
const esc = (value: unknown) => text(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char))
const money = (value: unknown) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(value || 0))
const date = (value: unknown) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${text(value)}T12:00:00`))

Deno.serve(async request => {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
  const token = new URL(request.url).searchParams.get('token') || ''
  if (!token) return new Response('Receipt not found.', { status: 404 })
  const admin = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '')
  const { data: payment } = await admin.from('job_deposit_payments').select('id, amount, paid_on, method, note, jobs(title, customers(name, address, postcode))').eq('receipt_token', token).maybeSingle()
  if (!payment) return new Response('Receipt not found.', { status: 404 })
  const job = Array.isArray(payment.jobs) ? payment.jobs[0] : payment.jobs
  const customer = Array.isArray(job?.customers) ? job.customers[0] : job?.customers
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Deposit receipt</title><style>body{margin:0;background:#f4f6f8;color:#172334;font:16px Arial,sans-serif}.page{max-width:720px;margin:24px auto;background:#fff;padding:42px;box-sizing:border-box}.accent{height:5px;background:#c9a227;margin:-42px -42px 34px}.top{display:flex;justify-content:space-between;gap:20px;border-bottom:1px solid #dce2e8;padding-bottom:26px}.brand{font-size:24px;font-weight:800}.meta{color:#596579;font-size:14px;line-height:1.55}.label{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#9a6a00;font-weight:bold}.amount{font-size:36px;font-weight:800;color:#10263f;margin:8px 0}.box{margin:32px 0;background:#f6f8fb;padding:22px;border-left:4px solid #c9a227}.footer{border-top:1px solid #dce2e8;padding-top:18px;color:#596579;font-size:12px}@media print{body{background:#fff}.page{margin:0;max-width:none;box-shadow:none}}</style></head><body><main class="page"><div class="accent"></div><section class="top"><div><div class="brand">Adam Stapley Plumbing Ltd</div><div class="meta">23 Hazon Way, Epsom, KT19 8HD<br>info@adamstapley.co.uk · 07966 858348<br>VAT Registration No. 327 0245 29</div></div><div><div class="label">Deposit receipt</div><div class="meta">Date received<br><b>${esc(date(payment.paid_on))}</b></div></div></section><section class="box"><div class="label">Deposit received</div><div class="amount">${esc(money(payment.amount))}</div><div class="meta">Thank you. This deposit will be deducted from the final invoice.</div></section><div class="label">Received from</div><p><b>${esc(customer?.name || 'Customer')}</b><br>${esc([customer?.address, customer?.postcode].filter(Boolean).join(', ') || 'Address not recorded')}</p><div class="label">For</div><p><b>${esc(job?.title || 'Job')}</b>${payment.note ? `<br><span class="meta">${esc(payment.note)}</span>` : ''}</p><footer class="footer">Adam Stapley Plumbing Ltd · Registered in England &amp; Wales · Gas Safe registration 234795</footer></main></body></html>`
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
})
