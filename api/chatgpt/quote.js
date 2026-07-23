const crypto = require('node:crypto');
const ESTIMATOR_DEFAULTS = require('../../estimator-defaults');

const VERSION = '1.1.0';
const MAX_BODY_BYTES = 250000;
// The private GPT retained this earlier credential after its editor was
// updated.  This one-way verifier is preview-only and can be removed once
// the GPT refreshes its saved action credential.
const LEGACY_PREVIEW_ACTION_TOKEN_SHA256 = '498bb8dec667d4d5f34293edd4f17d8855d2c6bff172e7bd1043af46072e6ed8';

function json(response, status, body) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  return response.status(status).json(body);
}

function text(value, limit = 4000) {
  return String(value ?? '').trim().slice(0, limit);
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

function constantTimeTokenMatch(provided, expected) {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function legacyPreviewTokenMatch(provided) {
  if (process.env.VERCEL_ENV !== 'preview' || !provided) return false;
  const receivedHash = crypto.createHash('sha256').update(provided).digest('hex');
  return constantTimeTokenMatch(receivedHash, LEGACY_PREVIEW_ACTION_TOKEN_SHA256);
}

function bearerToken(request) {
  const header = String(request.headers?.authorization || '');
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : '';
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function requestFingerprint(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function requestHeader(request, name) {
  const headers = request.headers || {};
  return text(headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()], 240);
}

function reviewUrl(request, quoteId) {
  const host = requestHeader(request, 'x-forwarded-host') || requestHeader(request, 'host');
  if (!/^[a-z0-9.-]+$/i.test(host)) return null;
  return `https://${host}/?review_quote=${encodeURIComponent(quoteId)}`;
}

function normaliseLines(lines, title, price) {
  if (!Array.isArray(lines) || !lines.length) return [{ description: title, quantity: 1, unit_price: price }];
  return lines.map((line, index) => ({
    description: text(line?.description, 500),
    quantity: number(line?.quantity, 1),
    unit_price: number(line?.unit_price, 0),
    sort_order: index + 1
  }));
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function estimatorConfiguration(raw) {
  const defaults = copy(ESTIMATOR_DEFAULTS);
  const supplied = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const config = { ...defaults, ...supplied, standard_templates: { ...defaults.standard_templates, ...(supplied.standard_templates || {}) } };
  config.minimum_charge_ex_vat = Math.max(0, number(config.minimum_charge_ex_vat, defaults.minimum_charge_ex_vat));
  config.vat_rate = Math.max(0, Math.min(100, number(config.vat_rate, defaults.vat_rate)));
  return config;
}

function applyEstimator(packageData, rawConfiguration, configVersion) {
  const configuration = estimatorConfiguration(rawConfiguration);
  const suppliedPrice = packageData.quote.chatgpt_supplied_price;
  const submittedSubtotal = packageData.quote.line_items.reduce((total, line) => total + (line.quantity * line.unit_price), 0);
  const recommendedPrice = Math.max(suppliedPrice === null ? 0 : suppliedPrice, submittedSubtotal, configuration.minimum_charge_ex_vat);
  const usingMinimum = recommendedPrice === configuration.minimum_charge_ex_vat && (!suppliedPrice || suppliedPrice < configuration.minimum_charge_ex_vat);
  const lineItems = packageData.quote.line_items.length ? packageData.quote.line_items.map(line => ({ ...line })) : normaliseLines([], packageData.job.title, recommendedPrice);
  // Preserve a supplied scope and adjust only its first priced line when the
  // estimator changes the total, rather than duplicating or rewording work.
  if (packageData.quote.line_items.length) {
    const firstQuantity = Math.max(Number(lineItems[0]?.quantity) || 1, 0.01);
    lineItems[0].unit_price = Number(((Number(lineItems[0]?.unit_price) || 0) + ((recommendedPrice - submittedSubtotal) / firstQuantity)).toFixed(2));
  }
  const finalSubtotal = lineItems.reduce((total, line) => total + (line.quantity * line.unit_price), 0);
  const rationale = !suppliedPrice
    ? 'No selling price was supplied, so the configured minimum charge was used as a review starting point.'
    : usingMinimum
      ? 'The supplied figure was below the configured normal minimum charge, so the review price was raised to that minimum.'
      : 'The supplied figure was retained as the review price, subject to Adam’s approval.';
  return {
    ...packageData,
    quote: { ...packageData.quote, price_ex_vat: Number(finalSubtotal.toFixed(2)), line_items: lineItems, subtotal: Number(finalSubtotal.toFixed(2)) },
    _estimator_configuration: configuration,
    _estimator_config_version: Number.isInteger(configVersion) && configVersion > 0 ? configVersion : ESTIMATOR_DEFAULTS.version,
    _estimator_recommendation: { recommended_price_ex_vat: Number(finalSubtotal.toFixed(2)), minimum_charge_ex_vat: configuration.minimum_charge_ex_vat, chatgpt_supplied_price: suppliedPrice, requires_manual_review: true, internal_reasoning: rationale }
  };
}

function validatePackage(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { errors: ['A JSON quote package is required.'] };

  const rawCustomer = raw.customer && typeof raw.customer === 'object' ? raw.customer : {};
  const rawJob = raw.job && typeof raw.job === 'object' ? raw.job : {};
  const rawQuote = raw.quote && typeof raw.quote === 'object' ? raw.quote : {};
  const title = text(rawJob.title || rawQuote.title, 240);
  const suppliedPrice = rawQuote.price_ex_vat;
  const hasSuppliedPrice = suppliedPrice !== undefined && suppliedPrice !== null && String(suppliedPrice).trim() !== '';
  const price = hasSuppliedPrice ? number(suppliedPrice, 0) : 0;
  const vatRate = number(rawQuote.vat_rate, 20);
  const issueDate = date(rawQuote.issue_date) || new Date().toISOString().slice(0, 10);
  const lines = normaliseLines(rawQuote.line_items, title, price);
  const photos = Array.isArray(raw.photos) ? raw.photos.map((photo, index) => ({
    url: text(photo?.url || photo?.URL || photo?.external_url, 2000),
    category: text(photo?.category, 80) || 'During',
    description: text(photo?.description, 1000),
    file_name: text(photo?.file_name, 255),
    mime_type: text(photo?.mime_type, 120),
    file_size: Math.max(0, Math.floor(number(photo?.file_size, 0))),
    sort_order: index + 1
  })) : [];

  if (!text(rawCustomer.name, 160)) errors.push('customer.name is required.');
  if (!title) errors.push('job.title is required.');
  if (price < 0) errors.push('quote.price_ex_vat cannot be negative.');
  if (vatRate < 0 || vatRate > 100) errors.push('quote.vat_rate must be between 0 and 100.');
  lines.forEach((line, index) => {
    if (!line.description) errors.push(`quote.line_items[${index}].description is required.`);
    if (line.quantity <= 0) errors.push(`quote.line_items[${index}].quantity must be greater than zero.`);
    if (line.unit_price < 0) errors.push(`quote.line_items[${index}].unit_price cannot be negative.`);
  });
  photos.forEach((photo, index) => {
    if (!photo.url || !validUrl(photo.url)) errors.push(`photos[${index}].url must be an https URL.`);
  });

  if (errors.length) return { errors };
  const subtotal = lines.reduce((total, line) => total + (line.quantity * line.unit_price), 0);
  const packageData = {
    source_reference: text(raw.source_reference, 240) || null,
    customer: {
      name: text(rawCustomer.name, 160), phone: text(rawCustomer.phone, 80), email: text(rawCustomer.email, 320).toLowerCase(),
      address: text(rawCustomer.address, 800), postcode: text(rawCustomer.postcode, 20).toUpperCase()
    },
    lead: raw.lead && typeof raw.lead === 'object' ? raw.lead : {},
    job: {
      title, job_type: text(rawJob.job_type, 120), description: text(rawJob.description, 12000),
      property_type: text(rawJob.property_type, 120), boiler_make: text(rawJob.boiler_make, 120), boiler_model: text(rawJob.boiler_model, 120),
      materials: Array.isArray(rawJob.materials) ? rawJob.materials : [], confidence: text(rawJob.confidence, 80),
      assumptions: text(rawJob.assumptions, 6000), follow_up_reminders: Array.isArray(rawJob.follow_up_reminders) ? rawJob.follow_up_reminders : []
    },
    quote: {
      issue_date: issueDate, price_ex_vat: hasSuppliedPrice ? price : null, chatgpt_supplied_price: hasSuppliedPrice ? price : null, vat_rate: vatRate, wording: text(rawQuote.wording || rawQuote.notes, 12000),
      line_items: lines, subtotal
    },
    photos,
    notes: text(raw.notes, 12000)
  };
  return { value: packageData };
}

async function callRpc(url, serviceRoleKey, payload) {
  // Supabase's current server keys begin sb_secret_. They authenticate with the
  // apikey header only; legacy service-role JWTs still require Bearer as well.
  const usesModernSecretKey = serviceRoleKey.startsWith('sb_secret_');
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/create_chatgpt_quote`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      ...(usesModernSecretKey ? {} : { authorization: `Bearer ${serviceRoleKey}` }),
      'content-type': 'application/json',
      prefer: 'return=representation'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = text(body?.message || body?.hint || body?.details, 500) || 'ASP Manager could not save this quote.';
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return Array.isArray(body) ? body[0] : body;
}

async function loadEstimatorConfiguration(url, serviceRoleKey, ownerId) {
  const usesModernSecretKey = serviceRoleKey.startsWith('sb_secret_');
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/get_estimator_configuration`, {
    method: 'POST',
    headers: { apikey: serviceRoleKey, ...(usesModernSecretKey ? {} : { authorization: `Bearer ${serviceRoleKey}` }), 'content-type': 'application/json' },
    body: JSON.stringify({ p_owner_id: ownerId }), signal: AbortSignal.timeout(12000)
  });
  const body = await response.json().catch(() => []);
  if (!response.ok) throw new Error('ASP Manager could not load estimator settings.');
  const record = Array.isArray(body) ? body[0] : body;
  return { configuration: estimatorConfiguration(record?.configuration), version: Number.isInteger(record?.version) ? record.version : ESTIMATOR_DEFAULTS.version, updated_at: record?.updated_at || null };
}

async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return json(response, 405, { success: false, error: 'Use POST.' });
  }
  if (Number(request.headers?.['content-length'] || 0) > MAX_BODY_BYTES) return json(response, 413, { success: false, error: 'Quote package is too large.' });

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
  if (!supabaseUrl || !serviceRoleKey || !ownerId) {
    console.error('ChatGPT quote endpoint is missing required server configuration.');
    return json(response, 503, { success: false, error: 'Quote connection is not configured.' });
  }

  try {
    const estimator = await loadEstimatorConfiguration(supabaseUrl, serviceRoleKey, ownerId);
    const prepared = applyEstimator(checked.value, estimator.configuration, estimator.version);
    const idempotencyKey = requestHeader(request, 'idempotency-key');
    const sourceReference = prepared.source_reference || idempotencyKey || `chatgpt-${requestFingerprint(checked.value)}`;
    const saved = await callRpc(supabaseUrl, serviceRoleKey, { p_owner_id: ownerId, p_package: { ...prepared, source_reference: sourceReference } });
    if (!saved?.customer_id || !saved?.customer_status || !saved?.job_id || !saved?.quote_id || !saved?.quote_number) throw new Error('ASP Manager returned an incomplete quote result.');
    return json(response, 201, {
      success: true,
      customer_id: saved.customer_id,
      customer_status: saved.customer_status,
      job_id: saved.job_id,
      quote_id: saved.quote_id,
      quote_number: saved.quote_number,
      duplicate: Boolean(saved.duplicate),
      estimator_config_version: prepared._estimator_config_version,
      estimator_recommendation: prepared._estimator_recommendation,
      review_url: reviewUrl(request, saved.quote_id)
    });
  } catch (error) {
    console.error('ChatGPT quote intake failed', { status: error?.status, message: error?.message });
    return json(response, error?.status >= 400 && error?.status < 500 ? 400 : 500, { success: false, error: 'ASP Manager could not save this quote. Please try again.' });
  }
}

module.exports = handler;
module.exports._private = { validatePackage, constantTimeTokenMatch, legacyPreviewTokenMatch, normaliseLines, canonicalJson, requestFingerprint, reviewUrl, callRpc, text, VERSION, estimatorConfiguration, applyEstimator, loadEstimatorConfiguration };
