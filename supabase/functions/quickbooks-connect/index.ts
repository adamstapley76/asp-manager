import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
})

const html = (title: string, message: string, success = false) => new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;background:#f3f5f7;color:#172334;font:16px Aptos,Segoe UI,Arial,sans-serif}.card{max-width:520px;margin:12vh auto;padding:28px;background:#fff;border-radius:14px;box-shadow:0 8px 30px #17233418}.bar{height:5px;background:${success ? '#cda136' : '#b42318'};margin:-28px -28px 24px;border-radius:14px 14px 0 0}h1{margin:0 0 12px}p{line-height:1.6;color:#526173}</style><main class="card"><div class="bar"></div><h1>${title}</h1><p>${message}</p></main>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })

const text = (value: unknown) => String(value ?? '').trim()
const qboBase = (realmId: string) => `https://quickbooks.api.intuit.com/v3/company/${encodeURIComponent(realmId)}`
const stateHash = async (state: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state)))).map(byte => byte.toString(16).padStart(2, '0')).join('')
const randomState = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}
const qboError = async (response: Response) => {
  const body = await response.json().catch(() => ({}))
  const detail = body?.Fault?.Error?.[0]?.Detail || body?.Fault?.Error?.[0]?.Message || body?.error_description || body?.error || response.statusText
  return text(detail) || 'QuickBooks could not complete that request.'
}

const adminClient = () => createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '')

async function authorisedUser(request: Request, admin: ReturnType<typeof adminClient>) {
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!bearer) return null
  const { data, error } = await admin.auth.getUser(bearer)
  return error ? null : data.user
}

function qboConfig() {
  const clientId = Deno.env.get('QUICKBOOKS_CLIENT_ID') || ''
  const clientSecret = Deno.env.get('QUICKBOOKS_CLIENT_SECRET') || ''
  const redirectUri = Deno.env.get('QUICKBOOKS_REDIRECT_URI') || ''
  return clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null
}

async function exchangeCode(code: string) {
  const config = qboConfig()
  if (!config) throw new Error('QuickBooks is not configured yet.')
  const response = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: { authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: config.redirectUri }),
  })
  if (!response.ok) throw new Error(await qboError(response))
  return await response.json()
}

async function refreshConnection(admin: ReturnType<typeof adminClient>, connection: any) {
  const config = qboConfig()
  if (!config) throw new Error('QuickBooks is not configured yet.')
  const response = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: { authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: connection.refresh_token }),
  })
  if (!response.ok) throw new Error('QuickBooks needs reconnecting. Please connect it again.')
  const tokens = await response.json()
  const updated = {
    ...connection,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    access_token_expires_at: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString(),
    refresh_token_expires_at: new Date(Date.now() + Number(tokens.x_refresh_token_expires_in || 8726400) * 1000).toISOString(),
  }
  const { error } = await admin.from('quickbooks_connections').update(updated).eq('owner_id', connection.owner_id)
  if (error) throw error
  return updated
}

async function qboRequest(admin: ReturnType<typeof adminClient>, connection: any, path: string, init: RequestInit = {}) {
  let active = connection
  if (new Date(active.access_token_expires_at).getTime() < Date.now() + 120000) active = await refreshConnection(admin, active)
  const request = () => fetch(`${qboBase(active.realm_id)}${path}`, {
    ...init,
    headers: { accept: 'application/json', authorization: `Bearer ${active.access_token}`, ...(init.headers || {}) },
  })
  let response = await request()
  if (response.status === 401) {
    active = await refreshConnection(admin, active)
    response = await request()
  }
  if (!response.ok) throw new Error(await qboError(response))
  return { body: await response.json(), connection: active }
}

const quote = (value: string) => `'${value.replace(/'/g, "\\'")}'`

async function queryQbo(admin: ReturnType<typeof adminClient>, connection: any, query: string) {
  return await qboRequest(admin, connection, `/query?query=${encodeURIComponent(query)}&minorversion=75`)
}

async function ensureCustomer(admin: ReturnType<typeof adminClient>, connection: any, customer: any) {
  if (customer.quickbooks_customer_id) return { id: customer.quickbooks_customer_id, connection }
  const existing = await queryQbo(admin, connection, `select * from Customer where DisplayName = ${quote(text(customer.name))}`)
  let active = existing.connection
  const found = existing.body?.QueryResponse?.Customer?.[0]
  if (found?.Id) {
    await admin.from('customers').update({ quickbooks_customer_id: found.Id, updated_at: new Date().toISOString() }).eq('id', customer.id)
    return { id: found.Id, connection: active }
  }
  const payload: Record<string, unknown> = { DisplayName: text(customer.name) || `Customer ${String(customer.id).slice(0, 6)}` }
  if (text(customer.phone)) payload.PrimaryPhone = { FreeFormNumber: text(customer.phone) }
  if (text(customer.email)) payload.PrimaryEmailAddr = { Address: text(customer.email) }
  if (text(customer.address) || text(customer.postcode)) payload.BillAddr = { Line1: text(customer.address), PostalCode: text(customer.postcode) }
  const created = await qboRequest(admin, active, '/customer?minorversion=75', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
  active = created.connection
  const id = created.body?.Customer?.Id
  if (!id) throw new Error('QuickBooks did not return a customer ID.')
  await admin.from('customers').update({ quickbooks_customer_id: id, updated_at: new Date().toISOString() }).eq('id', customer.id)
  return { id, connection: active }
}

async function ensureSalesSetup(admin: ReturnType<typeof adminClient>, connection: any) {
  let active = connection
  let itemId = text(active.service_item_id)
  if (!itemId) {
    const items = await queryQbo(admin, active, "select * from Item where Name = 'ASP Manager Services'")
    active = items.connection
    itemId = text(items.body?.QueryResponse?.Item?.[0]?.Id)
    if (!itemId) {
      const accounts = await queryQbo(admin, active, "select * from Account where AccountType = 'Income' and Active = true")
      active = accounts.connection
      const incomeId = text(accounts.body?.QueryResponse?.Account?.[0]?.Id)
      if (!incomeId) throw new Error('QuickBooks needs an active income account before invoices can be synced.')
      const created = await qboRequest(admin, active, '/item?minorversion=75', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Name: 'ASP Manager Services', Type: 'Service', IncomeAccountRef: { value: incomeId } }) })
      active = created.connection
      itemId = text(created.body?.Item?.Id)
    }
  }
  let taxCodeId = text(active.tax_code_id)
  if (!taxCodeId) {
    const codes = await queryQbo(admin, active, 'select * from TaxCode')
    active = codes.connection
    const taxable = (codes.body?.QueryResponse?.TaxCode || []).find((code: any) => code.Active !== false && /20/.test(text(code.Name)))
    taxCodeId = text(taxable?.Id)
    if (!taxCodeId) throw new Error('QuickBooks needs an active 20% sales VAT code before invoices can be synced.')
  }
  await admin.from('quickbooks_connections').update({ service_item_id: itemId, tax_code_id: taxCodeId }).eq('owner_id', active.owner_id)
  return { itemId, taxCodeId, connection: active }
}

async function syncInvoice(admin: ReturnType<typeof adminClient>, ownerId: string, documentId: string) {
  const { data: document, error } = await admin.from('documents').select('id, owner_id, customer_id, type, document_number, title, issue_date, due_date, line_items, vat_rate, notes, quickbooks_invoice_id, customers(id, name, address, postcode, phone, email, quickbooks_customer_id)').eq('id', documentId).eq('owner_id', ownerId).maybeSingle()
  if (error || !document || document.type !== 'invoice') throw new Error('Invoice not found.')
  if (document.quickbooks_invoice_id) return { invoiceId: document.quickbooks_invoice_id, alreadySynced: true }
  const customer = Array.isArray(document.customers) ? document.customers[0] : document.customers
  if (!customer) throw new Error('Choose a customer before syncing this invoice to QuickBooks.')
  const { data: connection, error: connectionError } = await admin.from('quickbooks_connections').select('*').eq('owner_id', ownerId).maybeSingle()
  if (connectionError || !connection) throw new Error('Connect QuickBooks before syncing an invoice.')
  try {
    const linkedCustomer = await ensureCustomer(admin, connection, customer)
    const sales = await ensureSalesSetup(admin, linkedCustomer.connection)
    const lines = Array.isArray(document.line_items) ? document.line_items.filter((line: any) => text(line.description) || Number(line.unit_price)) : []
    if (!lines.length) throw new Error('Add at least one invoice line before syncing.')
    const payload = {
      CustomerRef: { value: linkedCustomer.id },
      DocNumber: text(document.document_number),
      TxnDate: text(document.issue_date),
      DueDate: text(document.due_date) || undefined,
      CustomerMemo: text(document.notes) ? { value: text(document.notes) } : undefined,
      Line: lines.map((line: any) => ({
        Description: text(line.description), Amount: Number(line.quantity || 0) * Number(line.unit_price || 0), DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: { ItemRef: { value: sales.itemId }, Qty: Number(line.quantity || 0), UnitPrice: Number(line.unit_price || 0), TaxCodeRef: { value: sales.taxCodeId } },
      })),
    }
    const created = await qboRequest(admin, sales.connection, '/invoice?minorversion=75', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    const invoiceId = text(created.body?.Invoice?.Id)
    if (!invoiceId) throw new Error('QuickBooks did not return an invoice ID.')
    const now = new Date().toISOString()
    await admin.from('documents').update({ quickbooks_invoice_id: invoiceId, quickbooks_synced_at: now, quickbooks_sync_error: null, updated_at: now }).eq('id', document.id)
    await admin.from('quickbooks_connections').update({ last_synced_at: now, last_sync_error: null }).eq('owner_id', ownerId)
    return { invoiceId, alreadySynced: false }
  } catch (error) {
    const message = text(error instanceof Error ? error.message : error).slice(0, 1000)
    await admin.from('documents').update({ quickbooks_sync_error: message, updated_at: new Date().toISOString() }).eq('id', document.id)
    await admin.from('quickbooks_connections').update({ last_sync_error: message }).eq('owner_id', ownerId)
    throw error
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const url = new URL(request.url)
  const mode = url.searchParams.get('mode') || ''
  const admin = adminClient()

  if (request.method === 'GET' && !mode) {
    const code = text(url.searchParams.get('code'))
    const state = text(url.searchParams.get('state'))
    const realmId = text(url.searchParams.get('realmId'))
    if (!code || !state || !realmId) return html('QuickBooks connection not completed', 'No connection approval was received. You can close this page and try again.')
    const hash = await stateHash(state)
    const { data: savedState } = await admin.from('quickbooks_oauth_states').select('*').eq('state_hash', hash).maybeSingle()
    if (!savedState || new Date(savedState.expires_at).getTime() < Date.now()) return html('QuickBooks connection expired', 'Please return to ASP Manager and choose Connect QuickBooks again.')
    await admin.from('quickbooks_oauth_states').delete().eq('state_hash', hash)
    try {
      const tokens = await exchangeCode(code)
      const now = new Date()
      const { error } = await admin.from('quickbooks_connections').upsert({ owner_id: savedState.owner_id, realm_id: realmId, access_token: tokens.access_token, refresh_token: tokens.refresh_token, access_token_expires_at: new Date(now.getTime() + Number(tokens.expires_in || 3600) * 1000).toISOString(), refresh_token_expires_at: new Date(now.getTime() + Number(tokens.x_refresh_token_expires_in || 8726400) * 1000).toISOString(), connected_at: now.toISOString(), last_sync_error: null })
      if (error) throw error
      return html('QuickBooks connected', 'ASP Manager can now securely sync invoices to your QuickBooks company. Return to the app and open an invoice.', true)
    } catch (error) {
      return html('QuickBooks connection failed', text(error instanceof Error ? error.message : error))
    }
  }

  const user = await authorisedUser(request, admin)
  if (!user) return json({ error: 'Sign in to ASP Manager first.' }, 401)
  if (mode === 'status') {
    const { data } = await admin.from('quickbooks_connections').select('realm_id, connected_at, last_synced_at, last_sync_error').eq('owner_id', user.id).maybeSingle()
    return json({ connected: !!data, ...data })
  }
  if (mode === 'start') {
    const config = qboConfig()
    if (!config) return json({ error: 'QuickBooks keys have not been added yet.' }, 503)
    const state = randomState()
    await admin.from('quickbooks_oauth_states').delete().eq('owner_id', user.id)
    const { error } = await admin.from('quickbooks_oauth_states').insert({ state_hash: await stateHash(state), owner_id: user.id, expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() })
    if (error) return json({ error: 'Could not start the QuickBooks connection.' }, 500)
    const authorizationUrl = new URL('https://appcenter.intuit.com/connect/oauth2')
    authorizationUrl.search = new URLSearchParams({ client_id: config.clientId, response_type: 'code', scope: 'com.intuit.quickbooks.accounting', redirect_uri: config.redirectUri, state }).toString()
    return json({ authorization_url: authorizationUrl.toString() })
  }
  if (mode === 'sync-invoice' && request.method === 'POST') {
    const payload = await request.json().catch(() => ({}))
    try { return json(await syncInvoice(admin, user.id, text(payload.document_id))) }
    catch (error) { return json({ error: text(error instanceof Error ? error.message : error) }, 400) }
  }
  return json({ error: 'Not found.' }, 404)
})
