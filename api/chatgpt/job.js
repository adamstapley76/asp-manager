const quote = require('./quote');

const {
  text, time, canonicalJson, requestFingerprint, constantTimeTokenMatch,
  legacyPreviewTokenMatch
} = quote._private;

const MAX_BODY_BYTES = 250000;

function json(response, status, body) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  return response.status(status).json(body);
}

function date(value) {
  const candidate = text(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) && !Number.isNaN(Date.parse(`${candidate}T00:00:00Z`)) ? candidate : null;
}

function validUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function bearerToken(request) {
  const match = /^Bearer\s+(.+)$/i.exec(String(request.headers?.authorization || ''));
  return match ? match[1].trim() : '';
}

function requestHeader(request, name) {
  const headers = request.headers || {};
  return text(headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()], 240);
}

function serviceHeaders(serviceRoleKey, extra = {}) {
  return {
    apikey: serviceRoleKey,
    ...(serviceRoleKey.startsWith('sb_secret_') ? {} : { authorization: `Bearer ${serviceRoleKey}` }),
    ...extra
  };
}

function validatePackage(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { errors: ['A JSON work booking package is required.'] };

  const sourceCustomer = raw.customer && typeof raw.customer === 'object' ? raw.customer : {};
  const sourceJob = raw.job && typeof raw.job === 'object' ? raw.job : {};
  const title = text(sourceJob.title, 240);
  const scheduledDate = date(sourceJob.scheduled_date);
  const scheduledTime = time(sourceJob.scheduled_time);
  const bookingConfirmed = sourceJob.booking_confirmed === true;
  const photos = Array.isArray(raw.photos) ? raw.photos.map((photo, index) => ({
    url: text(photo?.url || photo?.URL || photo?.external_url, 2000),
    category: text(photo?.category, 80) || 'During',
    description: text(photo?.description, 1000),
    file_name: text(photo?.file_name, 255),
    mime_type: text(photo?.mime_type, 120),
    file_size: Number.isFinite(Number(photo?.file_size)) ? Math.max(0, Math.floor(Number(photo.file_size))) : 0,
    sort_order: index + 1
  })) : [];

  if (!text(sourceCustomer.name, 160)) errors.push('customer.name is required.');
  if (!title) errors.push('job.title is required.');
  if (!bookingConfirmed) errors.push('job.booking_confirmed must be true before work is booked in.');
  if (!scheduledDate) errors.push('job.scheduled_date is required before work is booked in.');
  photos.forEach((photo, index) => {
    if (!photo.url || !validUrl(photo.url)) errors.push(`photos[${index}].url must be an https URL.`);
  });
  if (errors.length) return { errors };

  return {
    value: {
      source_reference: text(raw.source_reference, 240) || null,
      customer: {
        name: text(sourceCustomer.name, 160),
        phone: text(sourceCustomer.phone, 80),
        email: text(sourceCustomer.email, 320).toLowerCase(),
        address: text(sourceCustomer.address, 800),
        postcode: text(sourceCustomer.postcode, 20).toUpperCase()
      },
      lead: raw.lead && typeof raw.lead === 'object' ? raw.lead : {},
      job: {
        title,
        job_type: text(sourceJob.job_type, 120),
        description: text(sourceJob.description, 12000),
        property_type: text(sourceJob.property_type, 120),
        boiler_make: text(sourceJob.boiler_make, 120),
        boiler_model: text(sourceJob.boiler_model, 120),
        materials: Array.isArray(sourceJob.materials) ? sourceJob.materials : [],
        confidence: text(sourceJob.confidence, 80),
        assumptions: text(sourceJob.assumptions, 6000),
        booking_confirmed: true,
        scheduled_date: scheduledDate,
        scheduled_time: scheduledTime
      },
      photos,
      notes: text(raw.notes, 12000)
    }
  };
}

async function callRpc(url, serviceRoleKey, payload) {
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/create_chatgpt_job`, {
    method: 'POST',
    headers: serviceHeaders(serviceRoleKey, { 'content-type': 'application/json', prefer: 'return=representation' }),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(text(body?.message || body?.hint || body?.details, 500) || 'ASP Manager could not book this work.');
    error.status = response.status;
    throw error;
  }
  return Array.isArray(body) ? body[0] : body;
}

async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return json(response, 405, { success: false, error: 'Use POST.' });
  }
  if (Number(request.headers?.['content-length'] || 0) > MAX_BODY_BYTES) return json(response, 413, { success: false, error: 'Work booking package is too large.' });

  const expectedToken = text(process.env.CHATGPT_QUOTE_API_TOKEN, 500);
  const suppliedToken = bearerToken(request);
  if (!expectedToken || (!constantTimeTokenMatch(suppliedToken, expectedToken) && !legacyPreviewTokenMatch(suppliedToken))) {
    return json(response, 401, { success: false, error: 'Unauthorised.' });
  }

  const checked = validatePackage(request.body);
  if (checked.errors) return json(response, 400, { success: false, error: checked.errors.join(' ') });

  const supabaseUrl = text(process.env.SUPABASE_URL, 500);
  const serviceRoleKey = text(process.env.SUPABASE_SERVICE_ROLE_KEY, 2000);
  const ownerId = text(process.env.ASP_MANAGER_OWNER_ID, 80);
  if (!supabaseUrl || !serviceRoleKey || !ownerId) return json(response, 503, { success: false, error: 'Work booking connection is not configured.' });

  try {
    const idempotencyKey = requestHeader(request, 'idempotency-key');
    const sourceReference = checked.value.source_reference || idempotencyKey || `chatgpt-job-${requestFingerprint(checked.value)}`;
    const saved = await callRpc(supabaseUrl, serviceRoleKey, { p_owner_id: ownerId, p_package: { ...checked.value, source_reference: sourceReference } });
    if (!saved?.customer_id || !saved?.customer_status || !saved?.job_id) throw new Error('ASP Manager returned an incomplete booking result.');
    return json(response, 201, {
      success: true,
      customer_id: saved.customer_id,
      customer_status: saved.customer_status,
      job_id: saved.job_id,
      duplicate: Boolean(saved.duplicate),
      booked_in_diary: true,
      scheduled_date: checked.value.job.scheduled_date,
      scheduled_time: checked.value.job.scheduled_time || null
    });
  } catch (error) {
    console.error('ChatGPT work booking failed', { status: error?.status, message: error?.message });
    return json(response, error?.status >= 400 && error?.status < 500 ? 400 : 500, { success: false, error: 'ASP Manager could not book this work. Please try again.' });
  }
}

module.exports = handler;
module.exports._private = { validatePackage, callRpc, date, time };
