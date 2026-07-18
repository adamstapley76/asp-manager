const IDEAL_POSTCODES_URL = 'https://api.ideal-postcodes.co.uk/v1/autocomplete/addresses';
const REQUEST_TIMEOUT_MS = 8000;

function allowSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  const host = request.headers['x-forwarded-host'] || request.headers.host;
  try { return Boolean(host) && new URL(origin).host === host; } catch { return false; }
}

module.exports = async function idealPostcodesAutocomplete(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ Message: 'Method not allowed' });
  }
  if (!allowSameOrigin(request)) return response.status(403).json({ Message: 'Origin not allowed' });

  const apiKey = String(process.env.IDEAL_POSTCODES_API_KEY || '').trim();
  if (!apiKey) return response.status(503).json({ Message: 'Address lookup is not configured' });

  const query = String(request.query?.query || '').trim();
  if (query.length < 2 || query.length > 120) return response.status(400).json({ Message: 'Enter at least two address characters' });
  const requestedLimit = Number.parseInt(request.body?.top, 10);
  const limit = Math.min(6, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 6));
  const postcodeAreas = Array.isArray(request.body?.local_postcode_areas)
    ? [...new Set(request.body.local_postcode_areas.map(value => String(value || '').trim().toUpperCase()).filter(value => /^[A-Z]{1,2}$/.test(value)))].slice(0, 5)
    : [];
  const upstreamUrl = new URL(IDEAL_POSTCODES_URL);
  upstreamUrl.searchParams.set('api_key', apiKey);
  upstreamUrl.searchParams.set('query', query);
  upstreamUrl.searchParams.set('limit', String(limit));
  if (postcodeAreas.length) upstreamUrl.searchParams.set('bias_postcode_area', postcodeAreas.join(','));

  try {
    const upstream = await fetch(upstreamUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return response.status(upstream.status).json({ Message: payload.message || 'Address lookup failed' });
    const hits = Array.isArray(payload?.result?.hits) ? payload.result.hits : [];
    return response.status(200).json({ suggestions: hits.map(hit => ({ id: hit.id, address: hit.suggestion || hit.address || '' })).filter(hit => hit.id && hit.address) });
  } catch (error) {
    console.error('Ideal Postcodes autocomplete request failed', { name: error?.name, message: String(error?.message || 'Unknown error') });
    return response.status(502).json({ Message: 'Address lookup request failed' });
  }
};
