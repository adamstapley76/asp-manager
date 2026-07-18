const IDEAL_POSTCODES_BASE_URL = 'https://api.ideal-postcodes.co.uk/v1';
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
  if (successPayload) {
    return JSON.stringify({
      addressResolved: Boolean(successPayload?.result?.postcode || successPayload?.result?.line_1)
    });
  }
  let safe = String(text || '[empty response]').slice(0, 2000);
  if (apiKey) safe = safe.split(apiKey).join('[redacted]');
  return safe
    .replace(/([?&]api_key=)[^&\s"']+/gi, '$1[redacted]')
    .replace(/((?:api[-_ ]?key|token)["']?\s*[:=]\s*["']?)[^"'\s,}&]+/gi, '$1[redacted]');
}

function mapAddress(address) {
  const line1 = String(address.line_1 || '');
  const line2 = String(address.line_2 || '');
  const line3 = String(address.line_3 || '');
  const town = String(address.post_town || '');
  const county = String(address.county || '');

  return {
    postcode: String(address.postcode || ''),
    latitude: address.latitude ?? null,
    longitude: address.longitude ?? null,
    formatted_address: [line1, line2, line3, town, county],
    thoroughfare: String(address.thoroughfare || ''),
    building_name: String(address.building_name || ''),
    sub_building_name: String(address.sub_building_name || ''),
    sub_building_number: '',
    building_number: String(address.building_number || ''),
    line_1: line1,
    line_2: line2,
    line_3: line3,
    line_4: '',
    locality: String(address.dependant_locality || ''),
    town_or_city: town,
    county,
    district: String(address.district || ''),
    country: String(address.country || ''),
    residential: !address.organisation_name && !address.po_box,
    uprn: address.uprn ?? null,
    udprn: address.udprn ?? null
  };
}

module.exports = async function getAddressAddress(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ Message: 'Method not allowed' });
  }
  if (!allowSameOrigin(request)) return response.status(403).json({ Message: 'Origin not allowed' });

  const rawApiKey = String(process.env.IDEAL_POSTCODES_API_KEY || '');
  const apiKey = rawApiKey.trim();
  console.info('Ideal Postcodes address proxy key diagnostics', {
    keyPresent: rawApiKey.length > 0,
    keyLength: rawApiKey.length,
    keyHadLeadingOrTrailingWhitespace: rawApiKey !== apiKey
  });
  if (!apiKey) {
    console.error('Ideal Postcodes address proxy is missing IDEAL_POSTCODES_API_KEY');
    return response.status(503).json({ Message: 'Address lookup is not configured' });
  }

  const id = String(request.query?.id || '').trim();
  if (!id || id.length > 500) return response.status(400).json({ Message: 'Address identifier is required' });

  const upstreamUrl = new URL(`${IDEAL_POSTCODES_BASE_URL}/autocomplete/addresses/${encodeURIComponent(id)}/gbr`);
  upstreamUrl.searchParams.set('api_key', apiKey);

  console.info('Ideal Postcodes address proxy request', {
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

    console.info('Ideal Postcodes address proxy response', {
      status: upstream.status,
      body: safeResponseBodyForLog(responseText, apiKey, upstream.ok ? payload : null)
    });

    if (!upstream.ok) {
      return response.status(upstream.status).json({ Message: payload.message || payload.Message || 'Address lookup failed' });
    }

    const resolved = payload?.result;
    if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) {
      console.error('Ideal Postcodes address upstream returned an invalid response');
      return response.status(502).json({ Message: 'Address lookup returned an invalid response' });
    }

    return response.status(200).json(mapAddress(resolved));
  } catch (error) {
    const message = String(error?.message || 'Unknown error').replace(/api_key=[^&\s]+/gi, 'api_key=[redacted]');
    console.error('Ideal Postcodes address proxy request failed', { name: error?.name, message });
    return response.status(502).json({ Message: 'Address lookup request failed' });
  }
};
