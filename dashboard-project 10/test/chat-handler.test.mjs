// Tests for netlify/functions/chat.mjs — the streaming chat endpoint with
// financial tool-calling. No live Anthropic or Firebase calls anywhere here:
// - `verifyAuth`/`loadAppData` take injectable fns (see chat.mjs) so their
//   logic is testable without a real Firebase project or a mocking library
//   (firebase-admin's own exports are non-writable, so monkey-patching them
//   directly doesn't work — this is why the injectable-param seam exists).
// - `runOneRound` is tested against a fake global.fetch producing synthetic
//   Anthropic SSE payloads.
// - The real default-exported handler is tested end-to-end only for the
//   paths that never touch Firebase (missing/malformed auth header, bad
//   input, wrong method) — see AI_ASSISTANT.md "Known limitations" for why
//   the Firebase-touching path isn't covered end-to-end here.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSystemPrompt, parseBearerToken, verifyAuth, rateLimited,
  _resetRateLimitForTests, runOneRound, loadAppData, default as handler,
} from '../netlify/functions/chat.mjs';

const minimalCtx = { today: '2026-08-05', dayName: 'Wednesday', monthName: 'August', tasks: [], habits: [], events: [], projects: [], spent: 0, budget: 0 };

describe('buildSystemPrompt', () => {
  test('includes the financial analysis guardrails', () => {
    const p = buildSystemPrompt(minimalCtx);
    assert.match(p, /Never invent a balance/i);
    assert.match(p, /potentially unusual/i);
    assert.match(p, /Internal transfers are already excluded/i);
  });

  test('does not crash on an empty/minimal context', () => {
    assert.doesNotThrow(() => buildSystemPrompt({ tasks: [], habits: [], events: [], projects: [] }));
  });

  test('never leaks the raw ANTHROPIC_API_KEY value into the prompt', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-should-never-appear-xyz';
    const p = buildSystemPrompt(minimalCtx);
    assert.ok(!p.includes('sk-test-should-never-appear-xyz'));
    delete process.env.ANTHROPIC_API_KEY;
  });
});

describe('parseBearerToken', () => {
  test('extracts the token from a well-formed header', () => {
    assert.equal(parseBearerToken('Bearer abc.def.ghi'), 'abc.def.ghi');
  });
  test('returns null for a missing header', () => {
    assert.equal(parseBearerToken(null), null);
    assert.equal(parseBearerToken(undefined), null);
    assert.equal(parseBearerToken(''), null);
  });
  test('returns null for a malformed header (no Bearer prefix)', () => {
    assert.equal(parseBearerToken('abc.def.ghi'), null);
    assert.equal(parseBearerToken('Basic xyz'), null);
  });
});

describe('verifyAuth — user isolation', () => {
  test('rejects a request with no Authorization header, without calling the verifier at all', async () => {
    let called = false;
    const fakeReq = { headers: new Headers() };
    const result = await verifyAuth(fakeReq, async () => { called = true; return { uid: 'whoever' }; });
    assert.equal(result, null);
    assert.equal(called, false, 'must short-circuit before attempting verification');
  });

  test('accepts a token that verifies as the app\'s single authorized user', async () => {
    const fakeReq = { headers: new Headers({ authorization: 'Bearer good-token' }) };
    const result = await verifyAuth(fakeReq, async (t) => (t === 'good-token' ? { uid: 'aqzJe5gq4IVYdKmUIW0pNJGL2ML2' } : null));
    assert.ok(result);
  });

  test('rejects a token that verifies successfully but for a DIFFERENT uid (user isolation)', async () => {
    const fakeReq = { headers: new Headers({ authorization: 'Bearer someone-elses-token' }) };
    const result = await verifyAuth(fakeReq, async () => ({ uid: 'some-other-uid' }));
    assert.equal(result, null);
  });

  test('rejects when the verifier throws (expired/invalid token)', async () => {
    const fakeReq = { headers: new Headers({ authorization: 'Bearer expired' }) };
    const result = await verifyAuth(fakeReq, async () => { throw new Error('Firebase ID token has expired'); });
    assert.equal(result, null);
  });
});

describe('rateLimited', () => {
  test('allows requests under the per-minute threshold, blocks beyond it', () => {
    _resetRateLimitForTests();
    let blocked = 0;
    for (let i = 0; i < 35; i++) if (rateLimited()) blocked++;
    assert.ok(blocked > 0, 'should start blocking once the threshold is exceeded');
    assert.ok(blocked < 35, 'should not block everything');
    _resetRateLimitForTests();
  });
});

describe('loadAppData', () => {
  test('returns the doc data when it exists', async () => {
    const data = await loadAppData(async () => ({ exists: true, data: () => ({ accounts: [{ id: 'a1' }] }) }));
    assert.deepEqual(data, { accounts: [{ id: 'a1' }] });
  });
  test('returns {} when the doc does not exist, does not throw', async () => {
    const data = await loadAppData(async () => ({ exists: false }));
    assert.deepEqual(data, {});
  });
});

// Builds a fake Response whose .body is a ReadableStream emitting the given
// raw SSE text, matching the shape runOneRound expects from `fetch`.
function fakeSSEResponse(rawSSE, { ok = true, status = 200 } = {}) {
  const encoder = new TextEncoder();
  return {
    ok,
    status,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(rawSSE));
        controller.close();
      },
    }),
    json: async () => ({ error: { message: 'mock upstream error' } }),
  };
}

describe('runOneRound — streaming + tool_use parsing (mocked fetch, no live API)', () => {
  let originalFetch;
  before(() => { originalFetch = globalThis.fetch; });
  after(() => { globalThis.fetch = originalFetch; });

  test('streams text deltas to onText and reports stop_reason end_turn', async () => {
    const sse = [
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}',
      '',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello, "}}',
      '',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Dan."}}',
      '',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
      '',
      '',
    ].join('\n');
    globalThis.fetch = async () => fakeSSEResponse(sse);
    const chunks = [];
    const { stopReason, assistantBlocks } = await runOneRound([], 'sys', 'fake-key', (t) => chunks.push(t));
    assert.equal(chunks.join(''), 'Hello, Dan.');
    assert.equal(stopReason, 'end_turn');
    assert.equal(assistantBlocks[0].type, 'text');
  });

  test('accumulates a tool_use block\'s streamed JSON input correctly', async () => {
    const sse = [
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tu_1","name":"get_spending_summary"}}',
      '',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"startDate\\":\\"2026"}}',
      '',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"-07-01\\",\\"endDate\\":\\"2026-08-01\\"}"}}',
      '',
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}',
      '',
      '',
    ].join('\n');
    globalThis.fetch = async () => fakeSSEResponse(sse);
    const { stopReason, assistantBlocks } = await runOneRound([], 'sys', 'fake-key', () => {});
    assert.equal(stopReason, 'tool_use');
    assert.equal(assistantBlocks[0].type, 'tool_use');
    assert.deepEqual(assistantBlocks[0].input, { startDate: '2026-07-01', endDate: '2026-08-01' });
  });

  test('a malformed input_json_delta buffer parses to {} instead of throwing', async () => {
    const sse = [
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tu_2","name":"get_accounts"}}',
      '',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{not valid json"}}',
      '',
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}',
      '',
      '',
    ].join('\n');
    globalThis.fetch = async () => fakeSSEResponse(sse);
    const { assistantBlocks } = await runOneRound([], 'sys', 'fake-key', () => {});
    assert.deepEqual(assistantBlocks[0].input, {});
  });

  test('throws a clear error when the upstream API call fails (non-OK response)', async () => {
    globalThis.fetch = async () => fakeSSEResponse('', { ok: false, status: 500 });
    await assert.rejects(() => runOneRound([], 'sys', 'fake-key', () => {}), /API error/);
  });
});

describe('default handler — paths that never touch Firebase', () => {
  test('OPTIONS preflight returns CORS headers without needing an API key or auth', async () => {
    const req = new Request('https://example.com/chat', { method: 'OPTIONS' });
    const res = await handler(req);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('access-control-allow-origin'));
  });

  test('non-POST method is rejected', async () => {
    const req = new Request('https://example.com/chat', { method: 'GET' });
    const res = await handler(req);
    assert.equal(res.status, 405);
  });

  test('missing ANTHROPIC_API_KEY returns a friendly message instead of crashing', async () => {
    const hadKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const req = new Request('https://example.com/chat', { method: 'POST', body: JSON.stringify({ message: 'hi' }) });
    const res = await handler(req);
    const body = await res.json();
    assert.match(body.reply, /ANTHROPIC_API_KEY/);
    if (hadKey) process.env.ANTHROPIC_API_KEY = hadKey;
  });

  test('a request with no Authorization header is rejected as unauthorized (401), before ever reaching Firebase, body parsing, or Anthropic', async () => {
    // Auth is checked before JSON body parsing (deliberate — don't do any
    // work, including parsing a possibly-malicious body, before you know
    // who's asking). That ordering means a malformed-body test needs a
    // token that actually passes real Firebase verification to reach the
    // body-parsing branch, which is out of scope for a mock-free test —
    // see AI_ASSISTANT.md "Known limitations".
    process.env.ANTHROPIC_API_KEY = 'fake-key-for-this-test';
    const req = new Request('https://example.com/chat', { method: 'POST', body: JSON.stringify({ message: 'what is my net worth?' }) });
    const res = await handler(req);
    assert.equal(res.status, 401);
    delete process.env.ANTHROPIC_API_KEY;
  });
});
