const IDEAL_POSTCODES_COMPATIBILITY_URL = 'https://ga.ideal-postcodes.co.uk';
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
  return {
    all: source.all !== false,
    top: Math.min(6, Math.max(1, Number.parseInt(source.top, 10) || 6)),
    template: typeof source.template === 'string' ? source.template.slice(0, 1000) : '',
    showPostcode: typeof source.show_postcode === 'boolean' ? source.show_postcode : undefined
  };
}

function safeResponseBodyForLog(text, apiKey, successPayload) {
  if (successPayload) {
    return JSON.stringify({
      suggestions: Array.isArray(successPayload?.suggestions) ? successPayload.suggestions.length : 0
    });
  }
  let safe = String(text || '[empty response]').slice(0, 2000);
  if (apiKey) safe = safe.split(apiKey).join('[redacted]');
  return safe
    .replace(/([?&]api[-_]key=)[^&\s"']+/gi, '$1[redacted]')
    .replace(/((?:api[-_ ]?key|token)["']?\s*[:=]\s*["']?)[^"'\s,}&]+/gi, '$1[redacted]');
}

module.exports = async function getAddressAutocomplete(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ Message: 'Method not allowed' });
  }
  if (!allowSameOrigin(request)) return response.status(403).json({ Message: 'Origin not allowed' });

  const rawApiKey = String(process.env.IDEAL_POSTCODES_API_KEY || process.env.GETADDRESS_API_KEY || '');
  const apiKey = rawApiKey.trim();
  console.info('Ideal Postcodes autocomplete proxy key diagnostics', {
    keyPresent: rawApiKey.length > 0,
    keyLength: rawApiKey.length,
    keyHadLeadingOrTrailingWhitespace: rawApiKey !== apiKey
  });
  if (!apiKey) {
    console.error('Ideal Postcodes autocomplete proxy is missing an API key');
    return response.status(503).json({ Message: 'Address lookup is not configured' });
  }

  const query = String(request.query?.query || '').trim();
  if (query.length < 2 || query.length > 120) {
    return response.status(400).json({ Message: 'Enter at least two address characters' });
  }

  const options = safeAutocompleteOptions(request.body);
  // The compatibility endpoint deliberately preserves the response contract
  // expected by the existing getAddress browser component.
  const upstreamUrl = new URL(`${IDEAL_POSTCODES_COMPATIBILITY_URL}/autocomplete/${encodeURIComponent(query)}`);
  upstreamUrl.searchParams.set('api-key', apiKey);
  upstreamUrl.searchParams.set('top', String(options.top));
  upstreamUrl.searchParams.set('all', String(options.all));
  if(options.template)upstreamUrl.searchParams.set('template',options.template);
  if(options.showPostcode!==undefined)upstreamUrl.searchParams.set('show-postcode',String(options.showPostcode));

  console.info('Ideal Postcodes autocomplete proxy request', {
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

    console.info('Ideal Postcodes autocomplete proxy response', {
      status: upstream.status,
      body: safeResponseBodyForLog(responseText, apiKey, upstream.ok ? payload : null)
    });

    if (!upstream.ok) {
      return response.status(upstream.status).json({ Message: payload.message || payload.Message || 'Address lookup failed' });
    }

    if (!Array.isArray(payload?.suggestions)) {
      console.error('Ideal Postcodes autocomplete upstream returned an invalid response');
      return response.status(502).json({ Message: 'Address lookup returned an invalid response' });
    }

    return response.status(200).json({ suggestions: payload.suggestions });
  } catch (error) {
    const message = String(error?.message || 'Unknown error').replace(/api[-_]key=[^&\s]+/gi, 'api-key=[redacted]');
    console.error('Ideal Postcodes autocomplete proxy request failed', { name: error?.name, message });
    return response.status(502).json({ Message: 'Address lookup request failed' });
  }
};
