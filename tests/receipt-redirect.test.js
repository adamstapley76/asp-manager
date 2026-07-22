const assert = require('node:assert/strict');
const receiptRedirect = require('../api/receipts/deposit');

function responseStub() {
  return {
    headers: {}, statusCode: null, body: null, redirectUrl: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
    redirect(code, url) { this.statusCode = code; this.redirectUrl = url; return this; }
  };
}

async function run() {
  const original = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  try {
    let response = responseStub();
    await receiptRedirect({ method: 'GET', query: { token: 'not-a-token' } }, response);
    assert.equal(response.statusCode, 404);

    response = responseStub();
    await receiptRedirect({ method: 'GET', query: { token: '11111111-1111-4111-8111-111111111111' } }, response);
    assert.equal(response.statusCode, 302);
    assert.equal(response.redirectUrl, 'https://example.supabase.co/functions/v1/deposit-receipt?token=11111111-1111-4111-8111-111111111111');
  } finally {
    if (original === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = original;
  }
}

run().then(() => console.log('Receipt redirect tests passed.'));
