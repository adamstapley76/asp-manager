import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS', 'content-type': 'application/json' }
const text = (value: unknown) => String(value ?? '').trim()
const esc = (value: unknown) => text(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
const formatDate = (value: unknown) => { const date = new Date(`${text(value)}T12:00:00`); return Number.isNaN(date.getTime()) ? text(value) : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(date) }
const adminClient = () => createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '')

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Not found.' }), { status: 404, headers })
  const admin = adminClient(), token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return new Response(JSON.stringify({ error: 'Sign in again before sending.' }), { status: 401, headers })
  const { data: auth } = await admin.auth.getUser(token), user = auth.user
  if (!user) return new Response(JSON.stringify({ error: 'Sign in again before sending.' }), { status: 401, headers })
  const body = await request.json().catch(() => ({})), recipients = [...new Set((Array.isArray(body.recipients) ? body.recipients : []).map(text).filter(validEmail))]
  if (!recipients.length) return new Response(JSON.stringify({ error: 'Choose at least one valid recipient.' }), { status: 400, headers })
  const { data: certificate, error } = await admin.from('gas_safety_certificates').select('*').eq('id', text(body.certificate_id)).eq('owner_id', user.id).eq('status', 'completed').maybeSingle()
  if (error || !certificate?.pdf_path) return new Response(JSON.stringify({ error: 'Completed certificate PDF not found.' }), { status: 404, headers })
  const { data: pdf, error: pdfError } = await admin.storage.from('gas-safety-files').download(certificate.pdf_path)
  if (pdfError || !pdf) return new Response(JSON.stringify({ error: 'The stored certificate PDF could not be opened.' }), { status: 404, headers })
  const bytes = new Uint8Array(await pdf.arrayBuffer())
  let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  const attachment = btoa(binary), apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) return new Response(JSON.stringify({ error: 'Email sending is not configured yet.' }), { status: 503, headers })
  const subject = `Gas Safety Record ${text(certificate.certificate_number)} - ${text(certificate.property_address)}`
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Arial,sans-serif;color:#172334"><main style="max-width:600px;margin:24px auto;background:#fff;border-radius:14px;padding:32px;border-top:7px solid #10263f"><h1 style="margin:0;color:#10263f">Your Gas Safety Record</h1><p style="color:#596579;margin-top:7px">Adam Stapley Plumbing Ltd</p><p>Please find the completed Landlord Gas Safety Record attached as a PDF.</p><div style="background:#f6f8fb;border-radius:10px;padding:18px"><b>${esc(certificate.property_address)}, ${esc(certificate.property_postcode)}</b><br><span style="color:#596579">Inspection: ${esc(formatDate(certificate.issue_date))}<br>Next check due: ${esc(formatDate(certificate.expiry_date))}<br>Certificate: ${esc(certificate.certificate_number)}</span></div><p>Please keep the attached record somewhere safe. A paper copy is available on request.</p><p style="margin-top:28px;color:#596579;font-size:13px">Adam Stapley<br>Gas Safe registration 234795<br>07966 858348 · info@adamstapley.co.uk</p></main></body></html>`
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: 'Adam Stapley Plumbing Ltd <info@adamstapley.co.uk>', to: recipients, cc: recipients.includes('info@adamstapley.co.uk') ? [] : ['info@adamstapley.co.uk'], reply_to: 'info@adamstapley.co.uk', subject, html, attachments: [{ filename: `${certificate.certificate_number}.pdf`, content: attachment }] }) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !text(result?.id)) return new Response(JSON.stringify({ error: text(result?.message) || 'The email provider could not send the certificate.' }), { status: 400, headers })
  const now = new Date().toISOString()
  await admin.from('gas_safety_certificates').update({ sent_at: now, sent_to: recipients, email_provider_id: text(result.id), updated_at: now }).eq('id', certificate.id)
  return new Response(JSON.stringify({ sent: true, recipients }), { headers })
})
