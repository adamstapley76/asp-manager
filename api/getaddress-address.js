const GETADDRESS_BASE_URL = 'https://api.getaddress.io';
const REQUEST_TIMEOUT_MS = 8000;

function allowSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  const host = request.headers['x-forwarded-host'] || request.headers.host;
  try {
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}

function safeResponseBodyForLog(text, apiKey, successPayload) {
  if (successPayload) return JSON.stringify({ addressResolved: Boolean(successPayload.postcode || successPayload.formatted_address) });
  let safe = String(text || '[empty response]').slice(0, 2000);
  if (apiKey) safe = safe.split(apiKey).join('[redacted]');
  return safe
    .replace(/([?&]api-key=)[^&\s"']+/gi, '$1[redacted]')
    .replace(/((?:api[-_ ]?key|token)["']?\s*[:=]\s*["']?)[^"'\s,}&]+/gi, '$1[redacted]');
}

module.exports = async function getAddressAddress(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ Message: 'Method not allowed' });
  }
  if (!allowSameOrigin(request)) return response.status(403).json({ Message: 'Origin not allowed' });

  const rawApiKey = String(process.env.GETADDRESS_API_KEY || '');
  const apiKey = rawApiKey.trim();
  console.info('getAddress address proxy key diagnostics', {
    keyPresent: rawApiKey.length > 0,
    keyLength: rawApiKey.length,
    keyHadLeadingOrTrailingWhitespace: rawApiKey !== apiKey
  });
  if (!apiKey) {
    console.error('getAddress address proxy is missing GETADDRESS_API_KEY');
    return response.status(503).json({ Message: 'Address lookup is not configured' });
  }

  const id = String(request.query?.id || '').trim();
  if (!id || id.length > 500) return response.status(400).json({ Message: 'Address identifier is required' });

  const upstreamUrl = new URL(`${GETADDRESS_BASE_URL}/get/${encodeURIComponent(id)}`);
  upstreamUrl.searchParams.set('api-key', apiKey);
  console.info('getAddress address proxy request', {
    upstreamHostname: upstreamUrl.hostname,
    upstreamPathname: upstreamUrl.pathname,
    upstreamMethod: 'GET'
  });
  try {
    const upstream = await fetch(upstreamUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    const responseText = await upstream.text();
    let payload = {};
    try { payload = responseText ? JSON.parse(responseText) : {}; } catch { payload = {}; }
    console.info('getAddress address proxy response', {
      status: upstream.status,
      body: safeResponseBodyForLog(responseText, apiKey, upstream.ok ? payload : null)
    });
    if (!upstream.ok) {
      return response.status(upstream.status).json({ Message: payload.Message || payload.message || 'Address lookup failed' });
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      console.error('getAddress address upstream returned an invalid response');
      return response.status(502).json({ Message: 'Address lookup returned an invalid response' });
    }
    return response.status(200).json(payload);
  } catch (error) {
    const message = String(error?.message || 'Unknown error').replace(/api-key=[^&\s]+/gi, 'api-key=[redacted]');
    console.error('getAddress address proxy request failed', { name: error?.name, message });
    return response.status(502).json({ Message: 'Address lookup request failed' });
  }
};
