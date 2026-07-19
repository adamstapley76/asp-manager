const SUPABASE_RECEIPT_URL = 'https://njlxklvpbcmmyaartboh.supabase.co/functions/v1/deposit-receipt';
const RECEIPT_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async function receipt(request, response) {
  const token = String(request.query?.token || '').trim();
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).send('Method not allowed');
  }
  if (!RECEIPT_TOKEN.test(token)) return response.status(404).send('Receipt not found.');

  try {
    const upstream = await fetch(`${SUPABASE_RECEIPT_URL}?token=${encodeURIComponent(token)}`, {
      headers: { Accept: 'text/html' },
      signal: AbortSignal.timeout(8000)
    });
    const content = await upstream.text();
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', upstream.headers.get('content-type') || 'text/html; charset=utf-8');
    return response.status(upstream.status).send(content);
  } catch (error) {
    console.error('Deposit receipt request failed', { name: error?.name, message: String(error?.message || 'Unknown error') });
    return response.status(502).send('The receipt could not be loaded. Please try again shortly.');
  }
};
