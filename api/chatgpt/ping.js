const VERSION = '1.0.0';

module.exports = async function chatGPTPing(request, response) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ status: 'error', error: 'Use GET.' });
  }
  return response.status(200).json({ status: 'ok', version: VERSION });
};
