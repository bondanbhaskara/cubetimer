const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createServer } = require('node:http');
const test = require('node:test');
const { configureCoach, createAppServer } = require('../server.cjs');
const { selectPractice } = require('../coach-lessons.cjs');
require('../js/ai-coach.js');

const { AICoach: AI } = globalThis;
const metrics = {
  scope: 'single solve', timeMs: 1230,
  phases: [{ phase: 'PLL', timeMs: 900, initialPauseMs: 600, executionMs: 300 }],
};
const pllLesson = {
  title: 'PLL Recognition',
  url: 'https://www.cubeskills.com/tutorials/intermediate-last-layer/pll-recognition',
  access: 'free account',
};

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

test('selects lesson topics using recorded transitions and phase durations', () => {
  assert.deepEqual(selectPractice({
    ...metrics, phases: [...metrics.phases, { phase: 'F2L', timeMs: 300, initialPauseMs: 240 }],
  }).lesson, pllLesson);
  assert.equal(selectPractice({
    ...metrics, cases: [{ phase: 'PLL', case: 'AUF only' }],
  }).lesson.title, 'AUF (Adjusting U Face)');

  const history = {
    scope: 'filtered session history',
    phases: [
      { phase: 'F2L', count: 8, averageMs: 5700, averagePauseMs: 600 },
      { phase: 'OLL', count: 7, averageMs: 1800, averagePauseMs: 900 },
    ],
  };
  const transition = selectPractice(history);
  assert.equal(transition.lesson.title, 'F2L to OLL Transition');
  assert.equal(transition.lesson.access, 'premium');
  assert.match(transition.observation, /900 ms of 1800 ms on average/);
  history.phases[1].averagePauseMs = 300;
  assert.equal(selectPractice(history).lesson.title, 'Efficiency in F2L');
  assert.equal(selectPractice({ ...history, phases: [null, { phase: 'OLL', count: 0 }] }).lesson.title, 'Practicing');
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
    return Response.json({ advice: 'Review the PLL pause.', lesson: pllLesson });
  });
  assert.deepEqual(await AI.review(metrics, controller.signal), { advice: 'Review the PLL pause.', lesson: pllLesson });
  fetch.mock.mockImplementationOnce(async () => Response.json({ advice: 'Review the PLL pause.' }));
  assert.deepEqual(await AI.review(metrics, controller.signal), { advice: 'Review the PLL pause.', lesson: null });
  fetch.mock.mockImplementationOnce(async () => Response.json({
    advice: 'Review the PLL pause.', lesson: { ...pllLesson, url: 'https://www.cubeskills.com.example/tutorials/pll' },
  }));
  assert.deepEqual(await AI.review(metrics, controller.signal), { advice: 'Review the PLL pause.', lesson: null });
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
  assert.deepEqual(await response.json(), { advice: 'Review the PLL pause.', lesson: pllLesson });
  assert.equal(calls[0].path, '/v1/chat/completions');
  assert.equal(calls[0].token, 'Bearer test-token');
  assert.equal(calls[0].payload.model, 'coach-model');
  assert.match(calls[0].payload.messages[0].content, /CubeSkills lesson topic: PLL Recognition/);
  assert.match(calls[0].payload.messages[0].content, /PLL initial pause: 600 ms of 900 ms/);
  assert.deepEqual(JSON.parse(calls[0].payload.messages.at(-1).content), metrics);

  providerStatus = 401;
  const rejected = await send(app);
  assert.equal(rejected.status, 502);
  assert.deepEqual(await rejected.json(), { error: 'The provider rejected the token or model access.' });
});

test('bulk reviews forward only the chosen data, with room for 50 detailed solves', async (t) => {
  const calls = [];
  const provider = await listen(createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    calls.push(JSON.parse(Buffer.concat(chunks).toString('utf8')).messages);
    response.end(JSON.stringify({ choices: [{ message: { content: 'Practice a consistent pace.' } }] }));
  }), t);
  const app = await listen(createAppServer(configureCoach(provider, '', 'coach-model')), t);
  const send = (detail, solves) => fetch(app + '/api/coach', {
    method: 'POST',
    headers: { Origin: app, 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: 'selected solves', detail, solves, sessionName: 'Keep local' }),
  });
  const phase = (phase, timeMs, initialPauseMs) => ({
    phase, timeMs, initialPauseMs, executionMs: timeMs - initialPauseMs,
  });
  const phases = [
    phase('Cross', 2400, 50), phase('F2L', 4500, 300), phase('OLL', 1500, 200), phase('PLL', 2000, 1200),
  ];
  const tracked = { timeMs: 12400, phases, scramble: 'Keep local' };
  const dnf = { timeMs: null };
  const manual = { timeMs: 16300 };

  const times = await send('times', [tracked, dnf, manual]);
  assert.equal(times.status, 200);
  assert.equal((await times.json()).lesson.title, 'Practicing');
  assert.deepEqual(JSON.parse(calls[0][1].content), {
    scope: 'selected solves', detail: 'times', solves: [{ timeMs: 12400 }, dnf, manual],
  });
  assert.match(calls[0][0].content, /chronological order/);

  const selected = Array.from({ length: 50 }, (_, index) => ({ ...tracked, timeMs: tracked.timeMs + index }));
  const detailed = await send('cfop', selected);
  assert.equal(detailed.status, 200);
  assert.deepEqual((await detailed.json()).lesson, pllLesson);
  assert.deepEqual(JSON.parse(calls[1][1].content), {
    scope: 'selected solves', detail: 'cfop',
    solves: selected.map(({ timeMs }) => ({ timeMs, phases })),
  });
  assert.match(calls[1][0].content, /PLL initial pause: 1200 ms of 2000 ms on average/);

  assert.equal((await send('cfop', [tracked, { ...dnf, phases }, manual])).status, 200);
  assert.deepEqual(JSON.parse(calls[2][1].content).solves, [{ timeMs: tracked.timeMs, phases }, dnf, manual]);

  assert.equal((await send('cfop', [...selected, tracked])).status, 400);
  assert.equal((await send('cfop', [{ ...tracked, phases: [phase('unknown', 100, 50)] }])).status, 400);
  assert.equal((await send('times', [])).status, 400);
  assert.equal(calls.length, 3);
});
