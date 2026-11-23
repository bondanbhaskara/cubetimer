const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createServer } = require('node:http');
const test = require('node:test');
const { configureCoach, createAppServer } = require('../server.cjs');
require('../js/ai-coach.js');

const { AICoach: AI } = globalThis;
const metrics = { scope: 'single solve', timeMs: 1230 };

async function listen(server, t) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('normalizes provider URLs and requires credentials for remote providers', () => {
  const endpoint = (url) => configureCoach(url, 'test-token', 'coach-model').endpoint;
  assert.equal(endpoint('https://api.example'), 'https://api.example/v1/chat/completions');
  assert.equal(endpoint('https://api.example/openai/v1/'), 'https://api.example/openai/v1/chat/completions');
  assert.equal(endpoint('http://localhost:8000/v1/chat/completions?version=2'), 'http://localhost:8000/v1/chat/completions?version=2');
  assert.throws(() => endpoint('https://user:pass@api.example/v1'));
  assert.throws(() => endpoint('http://api.example/v1'));
  assert.throws(() => configureCoach('https://api.example', '', 'coach-model'));
  assert.equal(configureCoach('http://localhost:11434/v1', '', 'coach-model').token, '');
});

test('the browser sends only metrics to the same-origin route', async (t) => {
  const controller = new AbortController();
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, './api/coach');
    assert.equal(options.mode, 'same-origin');
    assert.equal(options.redirect, 'error');
    assert.equal(options.signal, controller.signal);
    assert.deepEqual(options.headers, { 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(options.body), metrics);
    return Response.json({ advice: 'Review the PLL pause.' });
  });
  assert.equal(await AI.review(metrics, controller.signal), 'Review the PLL pause.');
  fetch.mock.mockImplementationOnce(async () => new Response('', { status: 501 }));
  await assert.rejects(AI.review(metrics, controller.signal), /requires the local coach server/);
});

test('the relay keeps the provider token server-side and rejects cross-origin requests', async (t) => {
  const calls = [];
  let providerStatus = 200;
  const provider = await listen(createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    calls.push({
      path: request.url, token: request.headers.authorization,
      payload: JSON.parse(Buffer.concat(chunks).toString('utf8')),
    });
    response.writeHead(providerStatus, { 'Content-Type': 'application/json' });
    response.end(providerStatus === 200
      ? JSON.stringify({ choices: [{ message: { content: 'Review the PLL pause.' } }] })
      : JSON.stringify({ error: 'provider echoed test-token' }));
  }), t);
  const config = configureCoach(provider, 'test-token', 'coach-model');
  const app = await listen(createAppServer(config), t);
  const endpoint = app + '/api/coach';
  const send = (origin, body = JSON.stringify(metrics)) => fetch(endpoint, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body,
  });

  assert.equal((await send('https://other.example')).status, 403);
  assert.equal((await send(app, JSON.stringify({ ...metrics, padding: 'x'.repeat(17 * 1024) }))).status, 413);
  assert.equal((await fetch(app + '/server.cjs')).status, 404);
  assert.equal((await fetch(app + '/')).status, 200);
  assert.equal((await fetch(app + '/js/ai-coach.js')).status, 200);
  assert.equal(calls.length, 0);

  const response = await send(app);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { advice: 'Review the PLL pause.' });
  assert.equal(calls[0].path, '/v1/chat/completions');
  assert.equal(calls[0].token, 'Bearer test-token');
  assert.equal(calls[0].payload.model, 'coach-model');
  assert.deepEqual(JSON.parse(calls[0].payload.messages.at(-1).content), metrics);

  providerStatus = 401;
  const rejected = await send(app);
  assert.equal(rejected.status, 502);
  assert.deepEqual(await rejected.json(), { error: 'The provider rejected the token or model access.' });
});
