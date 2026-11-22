const assert = require('node:assert/strict');
const test = require('node:test');
require('../js/ai-coach.js');

const { AICoach: AI } = globalThis;

test('normalizes API roots, versioned prefixes and full chat endpoints', () => {
  assert.equal(AI.endpointFor('https://api.example'), 'https://api.example/v1/chat/completions');
  assert.equal(AI.endpointFor('https://api.example/openai/v1/'), 'https://api.example/openai/v1/chat/completions');
  assert.equal(AI.endpointFor('http://localhost:8000/v1/chat/completions?version=2'), 'http://localhost:8000/v1/chat/completions?version=2');
  assert.throws(() => AI.endpointFor('https://user:pass@api.example/v1'));
  assert.throws(() => AI.endpointFor('http://api.example/v1'));
  assert.throws(() => AI.configure('https://api.example', '', 'model'));
});

test('sends a chat request with metrics and a Bearer token and handles provider errors', async (t) => {
  const config = AI.configure('https://api.example/v1', 'test-key', 'coach-model');
  const controller = new AbortController();
  const metrics = { count: 2, averageMs: 1230 };
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    const payload = JSON.parse(options.body);
    assert.equal(url, config.endpoint);
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    assert.equal(options.signal, controller.signal);
    assert.equal(payload.model, 'coach-model');
    assert.deepEqual(JSON.parse(payload.messages.at(-1).content), metrics);
    assert(!options.body.includes('test-key'));
    return Response.json({ choices: [{ message: { content: 'Review the PLL pause.' } }] });
  });
  assert.equal(await AI.review(config, metrics, controller.signal), 'Review the PLL pause.');
  fetch.mock.mockImplementationOnce(async () => new Response('secret echoed by provider', { status: 401 }));
  await assert.rejects(AI.review(config, metrics, controller.signal), /^Error: The API rejected the token or model access\.$/);
  fetch.mock.mockImplementationOnce(async () => Response.json({ choices: [] }));
  await assert.rejects(AI.review(config, metrics, controller.signal), /did not return a chat completion/);
});
