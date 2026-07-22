function safeToken(value) {
  const token = String(value || '').trim();
  return /^[0-9a-f-]{36}$/i.test(token) ? token : '';
}

module.exports = async function depositReceiptRedirect(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).send('Method not allowed');
  }
  const token = safeToken(request.query?.token);
  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  if (!token || !supabaseUrl) return response.status(404).send('Receipt not found');
  return response.redirect(302, `${supabaseUrl}/functions/v1/deposit-receipt?token=${encodeURIComponent(token)}`);
};
