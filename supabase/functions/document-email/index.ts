import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS', 'content-type': 'application/json' }
const text = (value: unknown) => String(value ?? '').trim()
const esc = (value: unknown) => text(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const money = (value: unknown) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(value || 0))
const date = (value: unknown) => { const parsed = new Date(`${text(value)}T12:00:00`); return Number.isNaN(parsed.getTime()) ? text(value) : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(parsed) }
const googleReviewUrl = 'https://search.google.com/local/writereview?placeid=ChIJzd9QSKCxVo4RNtlaVdbXpOU'

function customerViewUrl(value: unknown, token: string) {
  try {
    const url = new URL(text(value))
    const allowed = url.protocol === 'https:' && (url.hostname === 'app.adamstapley.co.uk' || url.hostname === 'asp-manager.vercel.app' || url.hostname.endsWith('.vercel.app'))
    if (!allowed || !url.pathname.endsWith('/document.html')) return ''
    url.search = new URLSearchParams({ token }).toString()
    return url.toString()
  } catch { return '' }
}

function adminClient() { return createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '') }
async function authorisedUser(request: Request, admin: ReturnType<typeof adminClient>) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data } = await admin.auth.getUser(token)
  return data.user || null
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Not found.' }), { status: 404, headers: corsHeaders })

  const admin = adminClient(), user = await authorisedUser(request, admin)
  if (!user) return new Response(JSON.stringify({ error: 'Sign in again before sending email.' }), { status: 401, headers: corsHeaders })

  const { document_id, view_url } = await request.json().catch(() => ({}))
  const { data: document, error } = await admin.from('documents').select('id, owner_id, customer_id, type, document_number, title, issue_date, due_date, total, status, public_token, customers(name, email)').eq('id', text(document_id)).eq('owner_id', user.id).maybeSingle()
  if (error || !document) return new Response(JSON.stringify({ error: 'Document not found.' }), { status: 404, headers: corsHeaders })

  const customer = Array.isArray(document.customers) ? document.customers[0] : document.customers
  if (!text(customer?.email)) return new Response(JSON.stringify({ error: "Add the customer's email address first." }), { status: 400, headers: corsHeaders })
  if (!document.public_token) return new Response(JSON.stringify({ error: 'This document needs a customer link before it can be emailed.' }), { status: 400, headers: corsHeaders })

  const viewUrl = customerViewUrl(view_url, document.public_token)
  if (!viewUrl) return new Response(JSON.stringify({ error: 'Could not create the customer viewing link. Please refresh the app and try again.' }), { status: 400, headers: corsHeaders })
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) return new Response(JSON.stringify({ error: 'Email sending is not configured yet.' }), { status: 503, headers: corsHeaders })

  const kind = document.type === 'quote' ? 'quote' : 'invoice'
  const subject = `Your ${kind} ${text(document.document_number)} from Adam Stapley Plumbing`
  const reviewBlock = kind === 'invoice' ? `<section style="border-top:1px solid #e5e9ef;margin-top:28px;padding-top:24px"><h2 style="color:#10263f;font-size:20px;margin:0 0 8px">Need your boiler serviced?</h2><p style="margin:0 0 10px">I can also help with annual boiler servicing, boiler repairs and plumbing work.</p><p style="margin:0 0 16px"><b>Need a new boiler?</b> I also provide professional boiler replacements, from advice through to installation.</p><p style="margin:0 0 16px"><b>Can I ask a favour?</b> If you were pleased with the service, a Google review makes a real difference to a small local business like mine. Thank you.</p><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="#ffffff" style="border:1px solid #d9dee7;border-radius:999px"><a href="${googleReviewUrl}" style="display:inline-block;padding:12px 21px;color:#10263f;font-size:15px;font-weight:700;text-decoration:none"><span style="color:#4285f4">G</span> Leave a Google review</a></td></tr></table></section>` : ''
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Arial,sans-serif;color:#172334"><main style="max-width:600px;margin:24px auto;background:#fff;border-radius:14px;padding:32px"><h1 style="margin:0 0 8px;color:#10263f">Adam Stapley Plumbing</h1><p>Hi ${esc(customer.name || 'there')},</p><p>Your ${kind} <b>${esc(document.document_number)}</b> is ready to view.</p><div style="background:#f6f8fb;border-radius:10px;padding:18px"><b>${esc(document.title)}</b><br><span style="color:#596579">Total: ${esc(money(document.total))}${document.due_date ? ` &middot; ${kind === 'quote' ? 'Valid until' : 'Due'} ${esc(date(document.due_date))}` : ''}</span></div><table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:36px auto"><tr><td bgcolor="#c9a227" style="border-radius:999px;text-align:center"><a href="${esc(viewUrl)}" style="display:inline-block;background:#c9a227;border:1px solid #b58c1f;border-radius:999px;color:#10263f;font-size:18px;font-weight:800;letter-spacing:.01em;line-height:22px;padding:18px 42px;text-align:center;text-decoration:none">View ${kind}</a></td></tr></table><p>If you have any questions, simply reply to this email.</p>${reviewBlock}<p style="color:#596579;font-size:13px">Adam Stapley Plumbing<br>07966 858348 &middot; info@adamstapley.co.uk</p></main></body></html>`
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: 'Adam Stapley Plumbing Ltd <info@adamstapley.co.uk>', to: [text(customer.email)], reply_to: 'info@adamstapley.co.uk', subject, html }) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !text(result?.id)) return new Response(JSON.stringify({ error: text(result?.message) || 'Email provider could not send the message.' }), { status: 400, headers: corsHeaders })

  const now = new Date().toISOString()
  await admin.from('documents').update({ status: document.status === 'draft' ? 'sent' : document.status, sent_at: now, email_sent_at: now, email_sent_to: text(customer.email), email_provider_id: text(result.id), email_viewed_at: null, updated_at: now }).eq('id', document.id)
  return new Response(JSON.stringify({ sent: true }), { headers: corsHeaders })
})
