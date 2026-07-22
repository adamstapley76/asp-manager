import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {'Access-Control-Allow-Origin':'https://chatgpt.com','Access-Control-Allow-Headers':'content-type,x-asp-manager-key','Access-Control-Allow-Methods':'POST,OPTIONS'}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status,headers:{...cors,'content-type':'application/json'}})
const text = (value: unknown, limit = 12000) => String(value ?? '').trim().slice(0,limit)
async function hash(value: string) { const bytes = new TextEncoder().encode(value); const digest = await crypto.subtle.digest('SHA-256',bytes); return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('') }

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null,{headers:cors})
  if (request.method !== 'POST') return json({error:'Use POST.'},405)
  const token = text(request.headers.get('x-asp-manager-key'),500)
  if (!token) return json({error:'Missing ASP Manager connection key.'},401)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const {data:key} = await admin.from('chatgpt_action_keys').select('id,owner_id').eq('token_hash',await hash(token)).is('revoked_at',null).maybeSingle()
  if (!key) return json({error:'Invalid ASP Manager connection key.'},401)
  const body = await request.json().catch(()=>null) as Record<string,unknown> | null
  if (!body) return json({error:'A JSON quote package is required.'},400)
  const customer = typeof body.customer === 'object' && body.customer ? body.customer : {}
  const job = typeof body.job === 'object' && body.job ? body.job : {}
  const quote = typeof body.quote === 'object' && body.quote ? body.quote : {}
  const photos = Array.isArray(body.photos) ? body.photos : []
  if (!text((customer as any).name,160) || !text((job as any).title,240)) return json({error:'Customer name and job title are required.'},400)
  const {data:created,error} = await admin.from('chatgpt_quote_imports').insert({owner_id:key.owner_id,source_reference:text(body.source_reference,240)||null,customer_data:customer,job_data:job,quote_data:quote,photo_data:photos,notes:text(body.notes)}).select('id').single()
  if (error) return json({error:'Could not prepare the quote for review.'},500)
  await admin.from('chatgpt_action_keys').update({last_used_at:new Date().toISOString()}).eq('id',key.id)
  return json({ok:true,import_id:created.id,status:'pending_review',message:'Quote prepared in ASP Manager. Review it before saving.'})
})
