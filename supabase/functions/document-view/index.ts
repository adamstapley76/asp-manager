import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const text = (value: unknown) => String(value ?? '').trim()
const esc = (value: unknown) => text(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const money = (value: unknown) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(value || 0))
const html = (body: string, status = 200) => new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Adam Stapley Plumbing</title><style>body{margin:0;background:#f4f6f8;color:#172334;font:16px Arial,sans-serif}.page{max-width:760px;margin:24px auto;background:#fff;padding:32px;border-radius:14px}.brand{color:#10263f;font-weight:800;font-size:26px}.meta{color:#596579}.head{display:flex;justify-content:space-between;gap:16px;border-bottom:3px solid #c9a227;padding-bottom:18px}.line{display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid #e4e8ee}.total{font-size:22px;font-weight:bold}.btn{display:inline-block;background:#c9a227;color:#10263f;text-decoration:none;font-weight:bold;padding:14px 20px;border-radius:8px}@media print{body{background:#fff}.page{margin:0;max-width:none}.no-print{display:none}}</style></head><body><main class="page">${body}</main></body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })

Deno.serve(async (request) => {
  const token = new URL(request.url).searchParams.get('token') || ''
  if (!token) return html('<h1>Document unavailable</h1><p>This customer link is incomplete.</p>', 404)
  const admin = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '')
  const { data: document } = await admin.from('documents').select('id, owner_id, customer_id, type, document_number, title, issue_date, due_date, line_items, subtotal, vat_rate, vat_amount, total, notes, status, public_token, email_viewed_at, customers(name, address, postcode)').eq('public_token', token).maybeSingle()
  if (!document || document.status === 'void') return html('<h1>Document unavailable</h1><p>Please contact Adam Stapley Plumbing if you need a copy.</p>', 404)
  const customer = Array.isArray(document.customers) ? document.customers[0] : document.customers, firstView = !document.email_viewed_at, now = new Date().toISOString()
  if (firstView) {
    await admin.from('documents').update({ email_viewed_at: now, updated_at: now }).eq('id', document.id)
    const apiKey = Deno.env.get('RESEND_API_KEY')
    if (apiKey) {
      const { data: owner } = await admin.auth.admin.getUserById(document.owner_id)
      if (owner?.user?.email) await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: 'ASP Manager <info@adamstapley.co.uk>', to: [owner.user.email], subject: `${document.type === 'quote' ? 'Quote' : 'Invoice'} viewed: ${text(document.document_number)}`, html: `<p><b>${esc(customer?.name || 'A customer')}</b> viewed ${esc(document.document_number)}.</p><p>Total: ${esc(money(document.total))}</p>` }) }).catch(() => null)
    }
  }
  const lines = Array.isArray(document.line_items) ? document.line_items : [], rows = lines.map((line: any) => `<div class="line"><span>${esc(line.description)} × ${esc(line.quantity)}</span><b>${esc(money(Number(line.quantity || 0) * Number(line.unit_price || 0)))}</b></div>`).join('')
  const type = document.type === 'quote' ? 'Quote' : 'Invoice', accept = document.type === 'quote' && document.status !== 'accepted' ? `<p class="no-print" style="margin-top:28px"><a class="btn" href="${esc(`${Deno.env.get('SUPABASE_URL')}/functions/v1/quote-acceptance?token=${encodeURIComponent(token)}`)}">Accept this quote</a></p>` : ''
  return html(`<div class="head"><div><div class="brand">Adam Stapley Plumbing</div><div class="meta">Gas engineer & plumber</div></div><div style="text-align:right"><b>${esc(type.toUpperCase())}</b><br>${esc(document.document_number)}</div></div><p style="margin-top:26px"><b>For:</b><br>${esc(customer?.name || '')}<br>${esc([customer?.address, customer?.postcode].filter(Boolean).join(', '))}</p><h1>${esc(document.title)}</h1>${rows}<div style="margin-top:22px"><div class="line"><span>Subtotal</span><b>${esc(money(document.subtotal))}</b></div><div class="line"><span>VAT (${esc(document.vat_rate)}%)</span><b>${esc(money(document.vat_amount))}</b></div><div class="line total"><span>Total</span><span>${esc(money(document.total))}</span></div></div>${document.notes ? `<p style="margin-top:26px"><b>Notes</b><br>${esc(document.notes).replace(/\n/g, '<br>')}</p>` : ''}${accept}<p class="meta" style="margin-top:36px">Questions? Reply to the email or call 07966 858348.</p><button class="no-print" onclick="window.print()">Print / save PDF</button>`)
})
