const assert = require('node:assert/strict');
const quoteHandler = require('../api/chatgpt/quote');
const jobHandler = require('../api/chatgpt/job');
const estimatorHandler = require('../api/chatgpt/estimator');
const mcpHandler = require('../api/mcp');
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
const booked = _private.validatePackage({ ...valid, job: { ...valid.job, booking_confirmed: true, scheduled_date: '2026-07-24', scheduled_time: '12:00' } });
assert.equal(booked.errors, undefined);
assert.equal(booked.value.job.booking_confirmed, true);
assert.equal(booked.value.job.scheduled_date, '2026-07-24');
assert.equal(booked.value.job.scheduled_time, '12:00');
const requestedOnly = _private.validatePackage({ ...valid, job: { ...valid.job, scheduled_date: '2026-07-24', scheduled_time: '12:00' } });
assert.equal(requestedOnly.value.job.booking_confirmed, false);
assert.equal(requestedOnly.value.job.scheduled_date, null);
const directBooking = jobHandler._private.validatePackage({
  customer: { name: 'Diary Customer', phone: '07700 900123' },
  job: { title: 'Leak repair', description: 'Inspect and repair leak.', booking_confirmed: true, scheduled_date: '2026-07-24', scheduled_time: '10:15' }
});
assert.equal(directBooking.errors, undefined);
assert.equal(directBooking.value.job.scheduled_date, '2026-07-24');
assert.match(jobHandler._private.validatePackage({ customer: { name: 'Diary Customer' }, job: { title: 'Leak repair' } }).errors.join(' '), /scheduled_date is required/);
assert.match(_private.validatePackage({}).errors.join(' '), /customer\.name is required\. job\.title is required\./);
const noPrice = _private.validatePackage({ ...valid, quote: { issue_date: '2026-07-22' } });
assert.equal(noPrice.errors, undefined);
assert.equal(noPrice.value.quote.chatgpt_supplied_price, null);
const estimated = _private.applyEstimator(noPrice.value, { minimum_charge_ex_vat: 95, vat_rate: 20 }, 4);
assert.equal(estimated.quote.subtotal, 95);
assert.equal(estimated._estimator_config_version, 4);
assert.match(_private.validatePackage({ ...valid, photos: [{ url: 'http://not-secure.example/photo.jpg' }] }).errors.join(' '), /https URL/);
assert.match(_private.validatePackage({ ...valid, quote: { ...valid.quote, price_ex_vat: -1 } }).errors.join(' '), /cannot be negative/);
assert.equal(_private.constantTimeTokenMatch('same-secret', 'same-secret'), true);
assert.equal(_private.constantTimeTokenMatch('wrong-secret', 'same-secret'), false);
assert.equal(_private.requestFingerprint({ b: 1, a: { z: 2, y: 3 } }), _private.requestFingerprint({ a: { y: 3, z: 2 }, b: 1 }));

function responseStub() {
  return {
    headers: {}, statusCode: null, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { this.ended = true; return this; }
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

    response = responseStub();
    await estimatorHandler({ method: 'GET', headers: {} }, response);
    assert.equal(response.statusCode, 401);

    global.fetch = async (url) => {
      assert.match(url, /\/rest\/v1\/rpc\/get_estimator_configuration$/);
      return new Response(JSON.stringify([{ version: 7, configuration: { minimum_charge_ex_vat: 110, vat_rate: 20 } }]), { status: 200 });
    };
    response = responseStub();
    await estimatorHandler({ method: 'GET', headers: { authorization: 'Bearer test-bearer-token' } }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.version, 7);
    assert.equal(response.body.configuration.minimum_charge_ex_vat, 110);

    global.fetch = async (url, init) => {
      if (url.endsWith('/rpc/get_estimator_configuration')) {
        return new Response(JSON.stringify([{ version: 3, configuration: { minimum_charge_ex_vat: 95, vat_rate: 20 } }]), { status: 200 });
      }
      assert.match(url, /\/rest\/v1\/rpc\/create_chatgpt_quote$/);
      assert.equal(init.headers.authorization, 'Bearer test-service-role');
      const payload = JSON.parse(init.body);
      assert.equal(payload.p_owner_id, process.env.ASP_MANAGER_OWNER_ID);
      assert.match(payload.p_package.source_reference, /^chatgpt-/);
      return new Response(JSON.stringify([{ customer_id: 'customer-1', customer_status: 'created', job_id: 'job-1', quote_id: 'quote-1', quote_number: 'Q-2026-100', duplicate: false }]), { status: 200 });
    };
    response = responseStub();
    await quoteHandler({ method: 'POST', headers: { authorization: 'Bearer test-bearer-token', host: 'preview.example.test' }, body: valid }, response);
    assert.equal(response.statusCode, 201);
    assert.equal(response.body.success, true);
    assert.equal(response.body.quote_id, 'quote-1');
    assert.equal(response.body.estimator_config_version, 3);
    assert.equal(response.body.review_url, 'https://preview.example.test/?review_quote=quote-1');

    global.fetch = async (url, init) => {
      assert.match(url, /\/rest\/v1\/rpc\/create_chatgpt_job$/);
      assert.equal(init.headers.authorization, 'Bearer test-service-role');
      const payload = JSON.parse(init.body);
      assert.match(payload.p_package.source_reference, /^chatgpt-job-/);
      return new Response(JSON.stringify([{ customer_id: 'customer-job-1', customer_status: 'created', job_id: 'job-booked-1', duplicate: false }]), { status: 200 });
    };
    response = responseStub();
    await jobHandler({
      method: 'POST', headers: { authorization: 'Bearer test-bearer-token' },
      body: { customer: { name: 'Diary Customer' }, job: { title: 'Leak repair', booking_confirmed: true, scheduled_date: '2026-07-24', scheduled_time: '10:15' } }
    }, response);
    assert.equal(response.statusCode, 201);
    assert.equal(response.body.job_id, 'job-booked-1');
    assert.equal(response.body.booked_in_diary, true);

    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test-server-key';
    global.fetch = async (url, init) => {
      if (url.endsWith('/rpc/get_estimator_configuration')) return new Response(JSON.stringify([]), { status: 200 });
      assert.equal(init.headers.apikey, 'sb_secret_test-server-key');
      assert.equal(init.headers.authorization, undefined);
      return new Response(JSON.stringify([{ customer_id: 'customer-2', customer_status: 'matched', job_id: 'job-2', quote_id: 'quote-2', quote_number: 'Q-2026-101', duplicate: false }]), { status: 200 });
    };
    response = responseStub();
    await quoteHandler({ method: 'POST', headers: { authorization: 'Bearer test-bearer-token' }, body: valid }, response);
    assert.equal(response.statusCode, 201);
    assert.equal(response.body.quote_id, 'quote-2');
    assert.equal(response.body.customer_status, 'matched');

    response = responseStub();
    await mcpHandler({ method: 'POST', headers: { authorization: 'Bearer test-bearer-token' }, body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } } }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.result.serverInfo.name, 'ASP Manager');

    response = responseStub();
    await mcpHandler({ method: 'POST', headers: { authorization: 'Bearer test-bearer-token' }, body: { jsonrpc: '2.0', id: 2, method: 'tools/list' } }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.result.tools[0].name, 'create_quote_in_asp_manager');

    global.fetch = async (url, init) => {
      if (url.endsWith('/rpc/get_estimator_configuration')) return new Response(JSON.stringify([]), { status: 200 });
      const payload = JSON.parse(init.body);
      assert.match(payload.p_package.source_reference, /^chatgpt-mcp-/);
      return new Response(JSON.stringify([{ customer_id: 'customer-3', customer_status: 'created', job_id: 'job-3', quote_id: 'quote-3', quote_number: 'Q-2026-102', duplicate: false }]), { status: 200 });
    };
    response = responseStub();
    await mcpHandler({ method: 'POST', headers: { authorization: 'Bearer test-bearer-token', host: 'preview.example.test' }, body: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'create_quote_in_asp_manager', arguments: { ...valid, source_reference: undefined } } } }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.result.structuredContent.quote_number, 'Q-2026-102');
    assert.equal(response.body.result.structuredContent.review_url, 'https://preview.example.test/?review_quote=quote-3');

    response = responseStub();
    await mcpHandler({ method: 'POST', headers: {}, body: { jsonrpc: '2.0', id: 4, method: 'tools/list' } }, response);
    assert.equal(response.statusCode, 401);
  } finally {
    global.fetch = realFetch;
    Object.keys(process.env).forEach(key => { if (!(key in before)) delete process.env[key]; });
    Object.assign(process.env, before);
  }
}

endpointTests().then(() => console.log('ChatGPT quote validation and endpoint tests passed.'));
