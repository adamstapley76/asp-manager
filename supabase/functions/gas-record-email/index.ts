import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS', 'content-type': 'application/json' }
const text = (value: unknown) => String(value ?? '').trim()
const esc = (value: unknown) => text(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Not found.' }), { status: 404, headers })
  const admin = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '')
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const { data: auth } = token ? await admin.auth.getUser(token) : { data: { user: null } }
  if (!auth.user) return new Response(JSON.stringify({ error: 'Sign in again before sending.' }), { status: 401, headers })
  const body = await request.json().catch(() => ({}))
  const type = text(body.record_type), config = type === 'service'
    ? { table: 'gas_service_records', id: 'record_id', number: 'record_number', label: 'Service & Maintenance Record' }
    : type === 'warning'
      ? { table: 'gas_warning_notices', id: 'record_id', number: 'notice_number', label: 'Gas Warning Notice' }
      : null
  if (!config) return new Response(JSON.stringify({ error: 'Unknown gas record type.' }), { status: 400, headers })
  const recipients = [...new Set((Array.isArray(body.recipients) ? body.recipients : []).map(text).filter(validEmail))]
  if (!recipients.length) return new Response(JSON.stringify({ error: 'Choose at least one valid recipient.' }), { status: 400, headers })
  const { data: record, error } = await admin.from(config.table).select('*').eq('id', text(body[config.id])).eq('owner_id', auth.user.id).maybeSingle()
  if (error || !record?.pdf_path) return new Response(JSON.stringify({ error: 'Completed record PDF not found.' }), { status: 404, headers })
  const { data: pdf, error: pdfError } = await admin.storage.from('gas-safety-files').download(record.pdf_path)
  if (pdfError || !pdf) return new Response(JSON.stringify({ error: 'The stored PDF could not be opened.' }), { status: 404, headers })
  const bytes = new Uint8Array(await pdf.arrayBuffer()); let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) return new Response(JSON.stringify({ error: 'Email sending is not configured yet.' }), { status: 503, headers })
  const number = text(record[config.number]), property = text(record.property_address)
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Arial,sans-serif;color:#172334"><main style="max-width:600px;margin:24px auto;background:#fff;border-radius:14px;padding:32px;border-top:7px solid #10263f"><h1 style="margin:0;color:#10263f">${esc(config.label)}</h1><p style="color:#596579">Adam Stapley Plumbing Ltd</p><p>Please find the completed record attached as a PDF.</p><div style="background:#f6f8fb;border-radius:10px;padding:18px"><b>${esc(property)}</b><br><span style="color:#596579">Record: ${esc(number)}</span></div><p>Please keep the attached record somewhere safe.</p><p style="margin-top:28px;color:#596579;font-size:13px">Adam Stapley<br>Gas Safe registered business 234795<br>07966 858348 · info@adamstapley.co.uk</p></main></body></html>`
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: 'Adam Stapley Plumbing Ltd <info@adamstapley.co.uk>', to: recipients, cc: recipients.includes('info@adamstapley.co.uk') ? [] : ['info@adamstapley.co.uk'], reply_to: 'info@adamstapley.co.uk', subject: `${config.label} ${number} - ${property}`, html, attachments: [{ filename: `${number}.pdf`, content: btoa(binary) }] }) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !text(result?.id)) return new Response(JSON.stringify({ error: text(result?.message) || 'The email provider could not send the record.' }), { status: 400, headers })
  const now = new Date().toISOString()
  await admin.from(config.table).update({ sent_at: now, sent_to: recipients, updated_at: now }).eq('id', record.id)
  return new Response(JSON.stringify({ sent: true, recipients }), { headers })
})
