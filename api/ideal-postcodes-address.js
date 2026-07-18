const IDEAL_POSTCODES_URL = 'https://api.ideal-postcodes.co.uk/v1/autocomplete/addresses';
const REQUEST_TIMEOUT_MS = 8000;

function allowSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  const host = request.headers['x-forwarded-host'] || request.headers.host;
  try { return Boolean(host) && new URL(origin).host === host; } catch { return false; }
}

module.exports = async function idealPostcodesAddress(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ Message: 'Method not allowed' });
  }
  if (!allowSameOrigin(request)) return response.status(403).json({ Message: 'Origin not allowed' });

  const apiKey = String(process.env.IDEAL_POSTCODES_API_KEY || '').trim();
  if (!apiKey) return response.status(503).json({ Message: 'Address lookup is not configured' });
  const id = String(request.query?.id || '').trim();
  if (!id || id.length > 500) return response.status(400).json({ Message: 'Address identifier is required' });
  const upstreamUrl = new URL(`${IDEAL_POSTCODES_URL}/${encodeURIComponent(id)}/gbr`);
  upstreamUrl.searchParams.set('api_key', apiKey);

  try {
    const upstream = await fetch(upstreamUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return response.status(upstream.status).json({ Message: payload.message || 'Address lookup failed' });
    const address = payload?.result || payload;
    if (!address || typeof address !== 'object' || Array.isArray(address)) return response.status(502).json({ Message: 'Address lookup returned an invalid response' });
    return response.status(200).json({
      line_1: address.line_1 || address.line1 || '', line_2: address.line_2 || address.line2 || '', line_3: address.line_3 || address.line3 || '',
      town_or_city: address.post_town || address.town || address.town_or_city || '', county: address.county || '', postcode: address.postcode || ''
    });
  } catch (error) {
    console.error('Ideal Postcodes address request failed', { name: error?.name, message: String(error?.message || 'Unknown error') });
    return response.status(502).json({ Message: 'Address lookup request failed' });
  }
};
