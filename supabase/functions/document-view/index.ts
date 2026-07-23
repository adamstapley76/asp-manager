import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const text = (value: unknown) => String(value ?? '').trim()
const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET, OPTIONS',
  'content-type': 'application/json; charset=utf-8',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders })

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405)

  const token = new URL(request.url).searchParams.get('token') || ''
  if (!token) return json({ error: 'This customer link is incomplete.' }, 404)

  const admin = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '')
  const { data: document } = await admin
    .from('documents')
    .select('id, owner_id, type, document_number, title, issue_date, due_date, line_items, subtotal, vat_rate, vat_amount, total, notes, status, public_token, email_viewed_at, customers(name, address, postcode)')
    .eq('public_token', token)
    .maybeSingle()

  if (!document || document.status === 'void') return json({ error: 'This document is unavailable. Please contact Adam Stapley Plumbing if you need a copy.' }, 404)

  const customer = Array.isArray(document.customers) ? document.customers[0] : document.customers
  const { data: payments, error: paymentsError } = await admin
    .from('document_payments')
    .select('amount, paid_on, method, note, origin_deposit_id')
    .eq('document_id', document.id)
    .order('paid_on', { ascending: true })

  if (paymentsError) return json({ error: 'This document could not load its payment history.' }, 500)
  const paymentHistory = (payments || []).map((payment) => ({
    amount: Number(payment.amount || 0),
    paid_on: payment.paid_on,
    method: text(payment.method),
    note: text(payment.note),
    is_deposit: Boolean(payment.origin_deposit_id),
  }))
  const paidAmount = paymentHistory.reduce((total, payment) => total + payment.amount, 0)
  const balanceDue = Math.max(0, Number(document.total || 0) - paidAmount)
  if (!document.email_viewed_at) {
    const apiKey = Deno.env.get('RESEND_API_KEY')
    if (apiKey) {
      const { data: owner } = await admin.auth.admin.getUserById(document.owner_id)
      if (owner?.user?.email) {
        const notification = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            from: 'Adam Stapley Plumbing Ltd <info@adamstapley.co.uk>',
            to: [owner.user.email],
            subject: `${document.type === 'quote' ? 'Quote' : 'Invoice'} viewed: ${text(document.document_number)}`,
            html: `<p><b>${text(customer?.name || 'A customer')}</b> viewed ${text(document.document_number)}.</p><p>Total: £${Number(document.total || 0).toFixed(2)}</p>`,
          }),
        }).catch(() => null)
        if (notification?.ok) {
          const now = new Date().toISOString()
          await admin.from('documents').update({ email_viewed_at: now, updated_at: now }).eq('id', document.id).is('email_viewed_at', null)
        }
      }
    }
  }

  return json({
    type: document.type,
    number: document.document_number,
    title: document.title,
    issue_date: document.issue_date,
    due_date: document.due_date,
    line_items: Array.isArray(document.line_items) ? document.line_items : [],
    subtotal: document.subtotal,
    vat_rate: document.vat_rate,
    vat_amount: document.vat_amount,
    total: document.total,
    payments: paymentHistory,
    paid_amount: paidAmount,
    balance_due: balanceDue,
    notes: document.notes,
    status: document.status,
    customer: { name: customer?.name || '', address: customer?.address || '', postcode: customer?.postcode || '' },
    can_accept: document.type === 'quote' && document.status !== 'accepted',
    acceptance_endpoint: `${Deno.env.get('SUPABASE_URL')}/functions/v1/quote-acceptance`,
    token,
  })
})
