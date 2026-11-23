'use strict';

const { readFile } = require('node:fs/promises');
const { createServer } = require('node:http');
const { extname, join } = require('node:path');

const MAX_METRICS_BYTES = 16 * 1024;
const COACH_PROMPT = 'You are a speedcubing practice coach. Use only the supplied aggregate or solve metrics as evidence. Times are milliseconds. Focus on one observed bottleneck, then suggest two specific practice drills or measurable goals. Keep the answer around 150 words in plain text. An initial pause is a recognition proxy, and CFOP splits and case names are inferred. Mention small samples or estimated timestamps when relevant. Do not invent move sequences, cube rotations, benchmarks or missing metrics.';
const ASSET_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};

function configureCoach(url, token, model) {
  let endpoint;
  try {
    endpoint = new URL(url.trim());
  } catch {
    throw new Error('Set CUBETIMER_COACH_API_URL to a complete API URL.');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && loopback)) {
    throw new Error('Use HTTPS for a remote provider or HTTP for a loopback provider.');
  }
  if (endpoint.username || endpoint.password || endpoint.hash) {
    throw new Error('Use a provider URL without credentials or a fragment.');
  }
  const path = endpoint.pathname.replace(/\/+$/, '');
  endpoint.pathname = path.endsWith('/chat/completions') ? path : (path || '/v1') + '/chat/completions';
  if ((!loopback && !token.trim()) || /[^\x21-\x7e]/.test(token.trim())) {
    throw new Error('Set CUBETIMER_COACH_API_TOKEN to a valid provider token.');
  }
  if (!model.trim()) throw new Error('Set CUBETIMER_COACH_MODEL to your provider model ID.');
  return { endpoint: endpoint.href, token: token.trim(), model: model.trim() };
}

function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

async function coachRequest(request, response, config) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return json(response, 405, { error: 'Use POST to request coaching.' });
  }
  if (request.headers.origin !== `http://${request.headers.host}`) {
    return json(response, 403, { error: 'Open Cube Timer on the same address as the coach server.' });
  }
  if (!config) return json(response, 503, { error: 'The AI coach is disabled. Set the provider environment variables and restart the server.' });
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    return json(response, 415, { error: 'Coaching metrics must be JSON.' });
  }
  const chunks = [];
  let size = 0;
  let metrics;
  try {
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > MAX_METRICS_BYTES) {
        request.resume();
        return json(response, 413, { error: 'The coaching request is too large.' });
      }
      chunks.push(chunk);
    }
    metrics = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    if (!response.destroyed) json(response, 400, { error: 'Could not read the coaching metrics.' });
    return;
  }
  if (!['single solve', 'filtered session history'].includes(metrics?.scope)) {
    return json(response, 400, { error: 'Choose a recorded solve or a session range for advice.' });
  }

  const upstream = new AbortController();
  response.once('close', () => upstream.abort());
  const timer = setTimeout(() => upstream.abort(), 40000);
  const headers = { 'Content-Type': 'application/json' };
  if (config.token) headers.Authorization = 'Bearer ' + config.token;
  try {
    const result = await fetch(config.endpoint, {
      method: 'POST',
      headers,
      redirect: 'error',
      signal: upstream.signal,
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: COACH_PROMPT },
          { role: 'user', content: JSON.stringify(metrics) },
        ],
      }),
    });
    if (!result.ok) {
      await result.body?.cancel();
      if ([401, 403].includes(result.status)) return json(response, 502, { error: 'The provider rejected the token or model access.' });
      if (result.status === 429) return json(response, 429, { error: 'The provider rate limit or quota was reached.' });
      return json(response, 502, { error: `The provider returned HTTP ${result.status}.` });
    }
    const data = await result.json();
    const advice = data?.choices?.[0]?.message?.content;
    if (typeof advice !== 'string' || !advice.trim()) {
      return json(response, 502, { error: 'The provider did not return a chat completion.' });
    }
    json(response, 200, { advice: advice.trim() });
  } catch {
    if (!response.destroyed) json(response, 502, { error: 'The coach server could not get a response from the provider.' });
  } finally {
    clearTimeout(timer);
  }
}

function createAppServer(coach = null) {
  return createServer(async (request, response) => {
    const port = request.socket.localPort;
    if (![`localhost:${port}`, `127.0.0.1:${port}`].includes(request.headers.host)) {
      return json(response, 403, { error: 'Use a loopback address to open Cube Timer.' });
    }
    const path = request.url.split('?')[0];
    if (path === '/api/coach') return coachRequest(request, response, coach);

    const file = path === '/' || path === '/index.html' ? 'index.html'
      : /^\/(?:js\/[\w.-]+\.js|css\/[\w.-]+\.css|fonts\/[\w.-]+\.woff2)$/.test(path) ? path.slice(1) : null;
    if (!file || !['GET', 'HEAD'].includes(request.method)) return json(response, 404, { error: 'Page unavailable.' });
    try {
      const data = await readFile(join(__dirname, file));
      response.writeHead(200, { 'Content-Type': ASSET_TYPES[extname(file)], 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch {
      json(response, 404, { error: 'Page unavailable.' });
    }
  });
}

if (require.main === module) {
  const { CUBETIMER_COACH_API_URL: url = '', CUBETIMER_COACH_API_TOKEN: token = '',
    CUBETIMER_COACH_MODEL: model = '', CUBETIMER_PORT: port = '8080' } = process.env;
  const coach = url || token || model ? configureCoach(url, token, model) : null;
  createAppServer(coach).listen(Number(port), '127.0.0.1', function () {
    console.log(`Cube Timer at http://127.0.0.1:${this.address().port} · AI coach ${coach ? 'enabled' : 'disabled'}`);
  });
}

module.exports = { configureCoach, createAppServer };
