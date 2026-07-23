const quoteHandler = require('./quote');

const { _private } = quoteHandler;
const MAX_BODY_BYTES = 30000;

function json(response, status, body) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  return response.status(status).json(body);
}

function bearerToken(request) {
  const match = /^Bearer\s+(.+)$/i.exec(String(request.headers?.authorization || ''));
  return match ? match[1].trim() : '';
}

function validToken(request) {
  const expected = _private.text(process.env.CHATGPT_QUOTE_API_TOKEN, 500);
  const supplied = bearerToken(request);
  return Boolean(expected) && (_private.constantTimeTokenMatch(supplied, expected) || _private.legacyPreviewTokenMatch(supplied));
}

function estimatePackage(raw) {
  const job = raw?.job && typeof raw.job === 'object' ? raw.job : {};
  const title = _private.text(job.title, 240);
  if (!title) return { error: 'job.title is required.' };
  return { value: { title, job_type: _private.text(job.job_type, 120), description: _private.text(job.description, 12000) } };
}

async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return json(response, 405, { success: false, error: 'Use POST.' });
  }
  if (Number(request.headers?.['content-length'] || 0) > MAX_BODY_BYTES) return json(response, 413, { success: false, error: 'Estimate request is too large.' });
  if (!validToken(request)) return json(response, 401, { success: false, error: 'Unauthorised.' });

  const checked = estimatePackage(request.body);
  if (checked.error) return json(response, 400, { success: false, error: checked.error });
  const supabaseUrl = _private.text(process.env.SUPABASE_URL, 500);
  const serviceRoleKey = _private.text(process.env.SUPABASE_SERVICE_ROLE_KEY, 2000);
  const ownerId = _private.text(process.env.ASP_MANAGER_OWNER_ID, 80);
  if (!supabaseUrl || !serviceRoleKey || !ownerId) return json(response, 503, { success: false, error: 'Estimate connection is not configured.' });

  try {
    const estimator = await _private.loadEstimatorConfiguration(supabaseUrl, serviceRoleKey, ownerId);
    const comparables = await _private.loadComparableWork(supabaseUrl, serviceRoleKey, ownerId, checked.value);
    const prepared = _private.applyEstimator({ job: checked.value, quote: { chatgpt_supplied_price: null, line_items: [] } }, estimator.configuration, estimator.version, comparables);
    return json(response, 200, {
      success: true,
      api_version: _private.VERSION,
      category: prepared._estimator_recommendation.category,
      estimator_config_version: prepared._estimator_config_version,
      estimator_recommendation: prepared._estimator_recommendation
    });
  } catch (error) {
    console.error('ChatGPT estimate failed', { status: error?.status, message: error?.message });
    return json(response, 500, { success: false, error: 'ASP Manager could not prepare this estimate. Please try again.' });
  }
}

module.exports = handler;
module.exports._private = { estimatePackage, validToken };
