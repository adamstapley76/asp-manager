import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS', 'content-type': 'application/json' }
const text = (value: unknown) => String(value ?? '').trim()
const esc = (value: unknown) => text(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char))
const money = (value: unknown) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(value || 0))
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

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Not found.' }), { status: 404, headers: corsHeaders })
  const admin = adminClient()
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const { data: authData } = token ? await admin.auth.getUser(token) : { data: { user: null } }
  const user = authData.user
  if (!user) return new Response(JSON.stringify({ error: 'Sign in again before sending the receipt.' }), { status: 401, headers: corsHeaders })

  const { document_id, view_url } = await request.json().catch(() => ({}))
  const { data: document, error } = await admin.from('documents').select('id, owner_id, type, document_number, title, total, status, public_token, customers(name, email)').eq('id', text(document_id)).eq('owner_id', user.id).maybeSingle()
  if (error || !document || document.type !== 'invoice') return new Response(JSON.stringify({ error: 'Invoice not found.' }), { status: 404, headers: corsHeaders })
  if (document.status !== 'paid') return new Response(JSON.stringify({ error: 'The invoice must be fully paid before a receipt can be sent.' }), { status: 400, headers: corsHeaders })
  const customer = Array.isArray(document.customers) ? document.customers[0] : document.customers
  if (!text(customer?.email)) return new Response(JSON.stringify({ error: "Add the customer's email address before sending a receipt." }), { status: 400, headers: corsHeaders })
  if (!document.public_token) return new Response(JSON.stringify({ error: 'This invoice needs a customer link before its receipt can be emailed.' }), { status: 400, headers: corsHeaders })
  const viewUrl = customerViewUrl(view_url, document.public_token)
  if (!viewUrl) return new Response(JSON.stringify({ error: 'Could not create the receipt link. Please refresh the app and try again.' }), { status: 400, headers: corsHeaders })
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) return new Response(JSON.stringify({ error: 'Email sending is not configured yet.' }), { status: 503, headers: corsHeaders })

  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Arial,sans-serif;color:#172334"><main style="max-width:600px;margin:24px auto;background:#fff;border-radius:14px;padding:32px"><h1 style="margin:0 0 12px;color:#10263f">Thank you, ${esc(customer.name || 'there')}</h1><p>We have received payment in full for invoice <b>${esc(document.document_number)}</b>.</p><div style="background:#f6f8fb;border-radius:10px;padding:18px"><b>${esc(document.title)}</b><br><span style="color:#596579">Paid: ${esc(money(document.total))}</span></div><table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:36px auto"><tr><td bgcolor="#c9a227" style="border-radius:999px"><a href="${esc(viewUrl)}" style="display:inline-block;padding:18px 42px;color:#10263f;font-size:18px;font-weight:800;text-decoration:none">View payment receipt</a></td></tr></table><section style="border-top:1px solid #e5e9ef;margin-top:28px;padding-top:24px"><h2 style="color:#10263f;font-size:20px;margin:0 0 8px">Need your boiler serviced?</h2><p style="margin:0 0 16px">I can also help with annual boiler servicing, boiler repairs and plumbing work.</p><p style="margin:0 0 16px"><b>Can I ask a favour?</b> If you were pleased with the service, a Google review makes a real difference to a small local business like mine. Thank you.</p><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="#ffffff" style="border:1px solid #d9dee7;border-radius:999px"><a href="${googleReviewUrl}" style="display:inline-block;padding:12px 21px;color:#10263f;font-size:15px;font-weight:700;text-decoration:none"><span style="color:#4285f4">G</span> Leave a Google review</a></td></tr></table></section><p style="color:#596579;font-size:13px">Adam Stapley Plumbing<br>07966 858348 &middot; info@adamstapley.co.uk</p></main></body></html>`
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: 'Adam Stapley Plumbing <info@adamstapley.co.uk>', to: [text(customer.email)], reply_to: 'info@adamstapley.co.uk', subject: `Payment received — ${text(document.document_number)}`, html }) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !text(result?.id)) return new Response(JSON.stringify({ error: text(result?.message) || 'Email provider could not send the receipt.' }), { status: 400, headers: corsHeaders })
  return new Response(JSON.stringify({ sent: true, provider_id: text(result.id) }), { headers: corsHeaders })
})
