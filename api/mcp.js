const quoteHandler = require('./chatgpt/quote');

const { validatePackage, constantTimeTokenMatch, requestFingerprint, reviewUrl, callRpc, text } = quoteHandler._private;
const SERVER_NAME = 'ASP Manager';
const SERVER_VERSION = '1.0.0';
const PROTOCOL_VERSION = '2025-03-26';
const MAX_BODY_BYTES = 250000;

const quoteInputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['customer', 'job', 'quote'],
  properties: {
    source_reference: { type: 'string', description: 'Reuse only when retrying this exact quote.' },
    customer: {
      type: 'object', additionalProperties: false, required: ['name'],
      properties: {
        name: { type: 'string' }, phone: { type: ['string', 'null'] }, email: { type: ['string', 'null'] },
        address: { type: ['string', 'null'] }, postcode: { type: ['string', 'null'] }
      }
    },
    lead: { type: 'object', additionalProperties: true },
    job: {
      type: 'object', additionalProperties: false, required: ['title'],
      properties: {
        title: { type: 'string' }, job_type: { type: ['string', 'null'] }, description: { type: ['string', 'null'] },
        property_type: { type: ['string', 'null'] }, boiler_make: { type: ['string', 'null'] }, boiler_model: { type: ['string', 'null'] },
        materials: { type: 'array', items: {} }, confidence: { type: ['string', 'null'] }, assumptions: { type: ['string', 'null'] },
        follow_up_reminders: { type: 'array', items: {} }
      }
    },
    quote: {
      type: 'object', additionalProperties: false, required: ['price_ex_vat'],
      properties: {
        issue_date: { type: ['string', 'null'] }, price_ex_vat: { type: 'number', minimum: 0 }, vat_rate: { type: 'number', minimum: 0, maximum: 100 },
        wording: { type: ['string', 'null'] },
        line_items: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false, required: ['description', 'quantity', 'unit_price'],
            properties: { description: { type: 'string' }, quantity: { type: 'number', minimum: 0.01 }, unit_price: { type: 'number', minimum: 0 } }
          }
        }
      }
    },
    photos: {
      type: 'array',
      description: 'Optional permanent HTTPS photo references. Never pass temporary ChatGPT attachment URLs.',
      items: {
        type: 'object', additionalProperties: false, required: ['url'],
        properties: { url: { type: 'string' }, category: { type: ['string', 'null'] }, description: { type: ['string', 'null'] }, file_name: { type: ['string', 'null'] }, mime_type: { type: ['string', 'null'] }, file_size: { type: ['integer', 'null'], minimum: 0 } }
      }
    },
    notes: { type: ['string', 'null'] }
  }
};

function send(response, status, body) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('MCP-Protocol-Version', PROTOCOL_VERSION);
  return response.status(status).json(body);
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function bearerToken(request) {
  const match = /^Bearer\s+(.+)$/i.exec(String(request.headers?.authorization || ''));
  return match ? match[1].trim() : '';
}

function safeMethod(value) {
  return typeof value === 'string' ? value : '';
}

async function createQuote(argumentsValue, request) {
  const checked = validatePackage(argumentsValue);
  if (checked.errors) return { isError: true, content: [{ type: 'text', text: checked.errors.join(' ') }] };

  const supabaseUrl = text(process.env.SUPABASE_URL, 500);
  const serviceRoleKey = text(process.env.SUPABASE_SERVICE_ROLE_KEY, 2000);
  const ownerId = text(process.env.ASP_MANAGER_OWNER_ID, 80);
  if (!supabaseUrl || !serviceRoleKey || !ownerId) return { isError: true, content: [{ type: 'text', text: 'ASP Manager quote connection is not configured.' }] };

  try {
    const sourceReference = checked.value.source_reference || `chatgpt-mcp-${requestFingerprint(checked.value)}`;
    const saved = await callRpc(supabaseUrl, serviceRoleKey, { p_owner_id: ownerId, p_package: { ...checked.value, source_reference: sourceReference } });
    if (!saved?.customer_id || !saved?.customer_status || !saved?.job_id || !saved?.quote_id || !saved?.quote_number) throw new Error('ASP Manager returned an incomplete quote result.');
    const result = {
      success: true,
      customer_id: saved.customer_id,
      customer_status: saved.customer_status,
      job_id: saved.job_id,
      quote_id: saved.quote_id,
      quote_number: saved.quote_number,
      duplicate: Boolean(saved.duplicate),
      review_url: reviewUrl(request, saved.quote_id)
    };
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
  } catch (error) {
    console.error('ASP Manager MCP quote save failed', { status: error?.status, message: error?.message });
    return { isError: true, content: [{ type: 'text', text: 'ASP Manager could not save this quote. Please try again.' }] };
  }
}

async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return send(response, 405, rpcError(null, -32600, 'Use POST.'));
  }
  if (Number(request.headers?.['content-length'] || 0) > MAX_BODY_BYTES) return send(response, 413, rpcError(null, -32600, 'Request is too large.'));

  const expectedToken = text(process.env.CHATGPT_QUOTE_API_TOKEN, 500);
  if (!expectedToken || !constantTimeTokenMatch(bearerToken(request), expectedToken)) return send(response, 401, rpcError(null, -32001, 'Unauthorised.'));

  const message = request.body;
  if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0') return send(response, 400, rpcError(null, -32600, 'A JSON-RPC 2.0 request is required.'));
  const method = safeMethod(message.method);

  if (method === 'notifications/initialized') return response.status(202).end();
  if (method === 'initialize') {
    return send(response, 200, rpcResult(message.id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions: 'Use create_quote_in_asp_manager only when the user has explicitly asked to send a confirmed quote. Use only actual conversation details; omit anything not supplied.'
    }));
  }
  if (method === 'tools/list') {
    return send(response, 200, rpcResult(message.id, {
      tools: [{
        name: 'create_quote_in_asp_manager',
        title: 'Create ASP Manager quote',
        description: 'Creates or matches the customer, creates the quoted job and saves the quote in ASP Manager. Use only after the user explicitly asks to send it. Do not invent missing details.',
        inputSchema: quoteInputSchema,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
      }]
    }));
  }
  if (method === 'tools/call') {
    if (message.params?.name !== 'create_quote_in_asp_manager') return send(response, 200, rpcError(message.id, -32602, 'Unknown tool.'));
    return send(response, 200, rpcResult(message.id, await createQuote(message.params?.arguments || {}, request)));
  }
  return send(response, 200, rpcError(message.id, -32601, 'Method not found.'));
}

module.exports = handler;
module.exports._private = { quoteInputSchema, createQuote, PROTOCOL_VERSION };
