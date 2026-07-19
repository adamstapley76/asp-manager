import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS', 'content-type': 'application/json' }
const text = (value: unknown) => String(value ?? '').trim()
const esc = (value: unknown) => text(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const money = (value: unknown) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(value || 0))

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
  const { document_id } = await request.json().catch(() => ({}))
  const { data: document, error } = await admin.from('documents').select('id, owner_id, customer_id, type, document_number, title, issue_date, due_date, total, status, public_token, customers(name, email)').eq('id', text(document_id)).eq('owner_id', user.id).maybeSingle()
  if (error || !document) return new Response(JSON.stringify({ error: 'Document not found.' }), { status: 404, headers: corsHeaders })
  const customer = Array.isArray(document.customers) ? document.customers[0] : document.customers
  if (!text(customer?.email)) return new Response(JSON.stringify({ error: 'Add the customer’s email address first.' }), { status: 400, headers: corsHeaders })
  if (!document.public_token) return new Response(JSON.stringify({ error: 'This document needs a customer link before it can be emailed.' }), { status: 400, headers: corsHeaders })
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) return new Response(JSON.stringify({ error: 'Email sending is not configured yet.' }), { status: 503, headers: corsHeaders })
  const kind = document.type === 'quote' ? 'quote' : 'invoice', viewUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/document-view?token=${encodeURIComponent(document.public_token)}`
  const subject = `Your ${kind} ${text(document.document_number)} from Adam Stapley Plumbing`
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Arial,sans-serif;color:#172334"><main style="max-width:600px;margin:24px auto;background:#fff;border-radius:14px;padding:32px"><h1 style="margin:0 0 8px;color:#10263f">Adam Stapley Plumbing</h1><p>Hi ${esc(customer.name || 'there')},</p><p>Your ${kind} <b>${esc(document.document_number)}</b> is ready to view.</p><div style="background:#f6f8fb;border-radius:10px;padding:18px"><b>${esc(document.title)}</b><br><span style="color:#596579">Total: ${esc(money(document.total))}${document.due_date ? ` · ${kind === 'quote' ? 'Valid until' : 'Due'} ${esc(document.due_date)}` : ''}</span></div><p style="text-align:center;margin:28px 0"><a href="${esc(viewUrl)}" style="display:inline-block;background:#c9a227;color:#10263f;text-decoration:none;font-weight:bold;padding:14px 22px;border-radius:8px">View ${kind}</a></p><p>If you have any questions, simply reply to this email.</p><p style="color:#596579;font-size:13px">Adam Stapley Plumbing<br>07966 858348 · info@adamstapley.co.uk</p></main></body></html>`
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: 'Adam Stapley Plumbing <info@adamstapley.co.uk>', to: [text(customer.email)], reply_to: 'info@adamstapley.co.uk', subject, html }) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !text(result?.id)) return new Response(JSON.stringify({ error: text(result?.message) || 'Email provider could not send the message.' }), { status: 400, headers: corsHeaders })
  const now = new Date().toISOString()
  await admin.from('documents').update({ status: document.status === 'draft' ? 'sent' : document.status, sent_at: now, email_sent_at: now, email_sent_to: text(customer.email), email_provider_id: text(result.id), updated_at: now }).eq('id', document.id)
  return new Response(JSON.stringify({ sent: true }), { headers: corsHeaders })
})
