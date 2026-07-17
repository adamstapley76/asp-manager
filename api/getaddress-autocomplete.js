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

function safeAutocompleteOptions(body) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const options = {
    all: source.all !== false,
    top: Math.min(10, Math.max(1, Number.parseInt(source.top, 10) || 6))
  };
  if (typeof source.template === 'string') options.template = source.template.slice(0, 1000);
  if (typeof source.show_postcode === 'boolean') options.show_postcode = source.show_postcode;
  return options;
}

module.exports = async function getAddressAutocomplete(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ Message: 'Method not allowed' });
  }
  if (!allowSameOrigin(request)) return response.status(403).json({ Message: 'Origin not allowed' });

  const apiKey = String(process.env.GETADDRESS_API_KEY || '').trim();
  if (!apiKey) {
    console.error('getAddress autocomplete proxy is missing GETADDRESS_API_KEY');
    return response.status(503).json({ Message: 'Address lookup is not configured' });
  }

  const query = String(request.query?.query || '').trim();
  if (query.length < 2 || query.length > 120) {
    return response.status(400).json({ Message: 'Enter at least two address characters' });
  }

  const upstreamUrl = new URL(`${GETADDRESS_BASE_URL}/autocomplete/${encodeURIComponent(query)}`);
  upstreamUrl.searchParams.set('api-key', apiKey);
  try {
    const upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(safeAutocompleteOptions(request.body)),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      console.error('getAddress autocomplete upstream failed', { status: upstream.status, message: payload.Message || payload.message || 'No message' });
      return response.status(upstream.status).json({ Message: payload.Message || payload.message || 'Address lookup failed' });
    }
    if (!Array.isArray(payload.suggestions)) {
      console.error('getAddress autocomplete upstream returned an invalid response');
      return response.status(502).json({ Message: 'Address lookup returned an invalid response' });
    }
    return response.status(200).json({ suggestions: payload.suggestions });
  } catch (error) {
    const message = String(error?.message || 'Unknown error').replace(/api-key=[^&\s]+/gi, 'api-key=[redacted]');
    console.error('getAddress autocomplete proxy request failed', { name: error?.name, message });
    return response.status(502).json({ Message: 'Address lookup request failed' });
  }
};
