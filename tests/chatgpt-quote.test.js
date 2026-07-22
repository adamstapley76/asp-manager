const assert = require('node:assert/strict');
const quoteHandler = require('../api/chatgpt/quote');
const { _private } = quoteHandler;

const valid = {
  source_reference: 'chatgpt-test-001',
  customer: { name: 'Test Customer', email: 'test@example.com', postcode: 'KT19 8HD' },
  job: { title: 'Boiler service', description: 'Annual service' },
  quote: { issue_date: '2026-07-22', price_ex_vat: 100, vat_rate: 20, line_items: [{ description: 'Boiler service', quantity: 1, unit_price: 100 }] },
  photos: [{ url: 'https://example.com/photo.jpg', category: 'Before' }]
};

const checked = _private.validatePackage(valid);
assert.equal(checked.errors, undefined);
assert.equal(checked.value.quote.subtotal, 100);
assert.equal(checked.value.customer.email, 'test@example.com');
assert.equal(checked.value.photos.length, 1);
assert.equal(_private.validatePackage({ ...valid, photos: [{ URL: 'https://example.com/legacy-photo.jpg' }] }).errors, undefined);
assert.match(_private.validatePackage({}).errors.join(' '), /customer\.name is required\. job\.title is required\./);
assert.match(_private.validatePackage({ ...valid, quote: { ...valid.quote, price_ex_vat: undefined } }).errors.join(' '), /price_ex_vat is required/);
assert.match(_private.validatePackage({ ...valid, photos: [{ url: 'http://not-secure.example/photo.jpg' }] }).errors.join(' '), /https URL/);
assert.match(_private.validatePackage({ ...valid, quote: { ...valid.quote, price_ex_vat: -1 } }).errors.join(' '), /cannot be negative/);
assert.equal(_private.constantTimeTokenMatch('same-secret', 'same-secret'), true);
assert.equal(_private.constantTimeTokenMatch('wrong-secret', 'same-secret'), false);

function responseStub() {
  return {
    headers: {}, statusCode: null, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

async function endpointTests() {
  const before = { ...process.env };
  const realFetch = global.fetch;
  process.env.CHATGPT_QUOTE_API_TOKEN = 'test-bearer-token';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  process.env.ASP_MANAGER_OWNER_ID = '00000000-0000-0000-0000-000000000001';
  try {
    let response = responseStub();
    await quoteHandler({ method: 'POST', headers: {}, body: valid }, response);
    assert.equal(response.statusCode, 401);
    assert.equal(response.body.success, false);

    response = responseStub();
    await quoteHandler({ method: 'POST', headers: { authorization: 'Bearer test-bearer-token' }, body: { customer: {}, job: {}, quote: {} } }, response);
    assert.equal(response.statusCode, 400);
    assert.match(response.body.error, /customer\.name is required/);

    global.fetch = async (url, init) => {
      assert.match(url, /\/rest\/v1\/rpc\/create_chatgpt_quote$/);
      assert.equal(init.headers.authorization, 'Bearer test-service-role');
      const payload = JSON.parse(init.body);
      assert.equal(payload.p_owner_id, process.env.ASP_MANAGER_OWNER_ID);
      assert.match(payload.p_package.source_reference, /^chatgpt-/);
      return new Response(JSON.stringify([{ customer_id: 'customer-1', job_id: 'job-1', quote_id: 'quote-1', duplicate: false }]), { status: 200 });
    };
    response = responseStub();
    await quoteHandler({ method: 'POST', headers: { authorization: 'Bearer test-bearer-token' }, body: valid }, response);
    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.body, { success: true, customer_id: 'customer-1', job_id: 'job-1', quote_id: 'quote-1', duplicate: false });

    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test-server-key';
    global.fetch = async (_url, init) => {
      assert.equal(init.headers.apikey, 'sb_secret_test-server-key');
      assert.equal(init.headers.authorization, undefined);
      return new Response(JSON.stringify([{ customer_id: 'customer-2', job_id: 'job-2', quote_id: 'quote-2', duplicate: false }]), { status: 200 });
    };
    response = responseStub();
    await quoteHandler({ method: 'POST', headers: { authorization: 'Bearer test-bearer-token' }, body: valid }, response);
    assert.equal(response.statusCode, 201);
    assert.equal(response.body.quote_id, 'quote-2');
  } finally {
    global.fetch = realFetch;
    Object.keys(process.env).forEach(key => { if (!(key in before)) delete process.env[key]; });
    Object.assign(process.env, before);
  }
}

endpointTests().then(() => console.log('ChatGPT quote validation and endpoint tests passed.'));
