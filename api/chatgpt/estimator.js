const quoteHandler = require('./quote');

const { text, constantTimeTokenMatch, legacyPreviewTokenMatch, loadEstimatorConfiguration, VERSION } = quoteHandler._private;

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

async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return json(response, 405, { success: false, error: 'Use GET.' });
  }
  const expectedToken = text(process.env.CHATGPT_QUOTE_API_TOKEN, 500);
  const suppliedToken = bearerToken(request);
  if (!expectedToken || (!constantTimeTokenMatch(suppliedToken, expectedToken) && !legacyPreviewTokenMatch(suppliedToken))) {
    return json(response, 401, { success: false, error: 'Unauthorised.' });
  }
  const supabaseUrl = text(process.env.SUPABASE_URL, 500);
  const serviceRoleKey = text(process.env.SUPABASE_SERVICE_ROLE_KEY, 2000);
  const ownerId = text(process.env.ASP_MANAGER_OWNER_ID, 80);
  if (!supabaseUrl || !serviceRoleKey || !ownerId) return json(response, 503, { success: false, error: 'Estimator connection is not configured.' });
  try {
    const estimator = await loadEstimatorConfiguration(supabaseUrl, serviceRoleKey, ownerId);
    return json(response, 200, { success: true, api_version: VERSION, ...estimator });
  } catch (error) {
    console.error('Estimator configuration read failed', { message: error?.message });
    return json(response, 500, { success: false, error: 'ASP Manager could not load estimator settings.' });
  }
}

module.exports = handler;
