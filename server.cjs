'use strict';

const { readFile } = require('node:fs/promises');
const { createServer } = require('node:http');
const { extname, join } = require('node:path');
const { configureCoach, prepareReview, completeReview, ProviderError } = require('./js/coach-core.js');

const MAX_METRICS_BYTES = 16 * 1024;
// Allow 50 solves with up to 2,048 recorded moves each (up to 3 bytes per move with spaces).
const MAX_BULK_METRICS_BYTES = 384 * 1024;
const MAX_CHAT_BYTES = 100 * 1024;
const MAX_SETTINGS_BYTES = 16 * 1024;
const ASSET_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};

function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

const isSameOrigin = (request) => request.headers.origin === `http://${request.headers.host}`;

async function readJsonBody(request, response, maxBytes, description) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    return json(response, 415, { error: `${description} must be JSON.` });
  }
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > maxBytes) {
        request.resume();
        return json(response, 413, { error: 'The request is too large.' });
      }
      chunks.push(chunk);
    }
    return { value: JSON.parse(Buffer.concat(chunks).toString('utf8')), size };
  } catch {
    if (!response.destroyed) json(response, 400, { error: `Could not read ${description.toLowerCase()}.` });
  }
}

async function coachRequest(request, response, config) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return json(response, 405, { error: 'Use POST to request coaching.' });
  }
  if (!isSameOrigin(request)) {
    return json(response, 403, { error: 'Open Cube Timer on the same address as the coach server.' });
  }
  if (!config) return json(response, 503, { error: 'Open Settings → AI coach to configure a provider.' });
  const body = await readJsonBody(request, response, MAX_BULK_METRICS_BYTES + MAX_CHAT_BYTES, 'Coaching request');
  if (!body) return;
  const chat = body.value != null && Object.hasOwn(body.value, 'conversation');
  const metrics = chat ? body.value.metrics ?? null : body.value;
  const bulkReview = metrics?.scope === 'selected solves';
  const metricsSize = chat ? Buffer.byteLength(JSON.stringify(metrics)) : body.size;
  if (metricsSize > (bulkReview ? MAX_BULK_METRICS_BYTES : MAX_METRICS_BYTES)) {
    return json(response, 413, { error: 'The coaching request is too large.' });
  }
  const review = prepareReview(metrics, chat ? body.value.conversation : []);
  if (!review) {
    return json(response, 400, { error: chat ? 'Send a valid follow-up about the selected solves.' : bulkReview
      ? 'Select 1 to 50 solves with valid times and choose which data to share.'
      : 'Choose a recorded solve or a session range for advice.' });
  }
  const upstream = new AbortController();
  response.once('close', () => upstream.abort());
  const timer = setTimeout(() => upstream.abort(), 40000);
  try {
    const advice = await completeReview(config, review, upstream.signal);
    if (!response.destroyed) json(response, 200, advice);
  } catch (error) {
    if (response.destroyed) return;
    if (error instanceof ProviderError) return json(response, error.status, { error: error.message });
    json(response, 502, { error: 'The coach server could not get a response from the provider.' });
  } finally {
    clearTimeout(timer);
  }
}

function createAppServer(coach = null) {
  let sessionCoach = null;
  const settingsState = () => ({
    source: sessionCoach ? 'web' : coach ? 'environment' : 'none',
    endpoint: sessionCoach?.endpoint ?? '',
    model: sessionCoach?.model ?? '',
  });

  async function coachSettings(request, response) {
    if (request.method === 'GET') return json(response, 200, settingsState());
    if (!['PUT', 'DELETE'].includes(request.method)) {
      response.setHeader('Allow', 'GET, PUT, DELETE');
      return json(response, 405, { error: 'Use GET, PUT, or DELETE for provider settings.' });
    }
    if (!isSameOrigin(request)) {
      return json(response, 403, { error: 'Open Cube Timer on the same address as the coach server.' });
    }
    if (request.method === 'DELETE') {
      sessionCoach = null;
      return json(response, 200, settingsState());
    }

    const body = await readJsonBody(request, response, MAX_SETTINGS_BYTES, 'Provider settings');
    if (!body) return;
    const { endpoint, model, token = '' } = body.value ?? {};
    if (typeof endpoint !== 'string' || typeof model !== 'string' || typeof token !== 'string') {
      return json(response, 400, { error: 'Enter a provider URL, model ID, and API token when required.' });
    }
    try {
      sessionCoach = configureCoach(endpoint, token, model);
    } catch (error) {
      return json(response, 400, { error: error.message });
    }
    return json(response, 200, settingsState());
  }

  return createServer(async (request, response) => {
    const port = request.socket.localPort;
    if (![`localhost:${port}`, `127.0.0.1:${port}`].includes(request.headers.host)) {
      return json(response, 403, { error: 'Use a loopback address to open Cube Timer.' });
    }
    const path = request.url.split('?')[0];
    if (path === '/api/coach') return coachRequest(request, response, sessionCoach ?? coach);
    if (path === '/api/coach/settings') return coachSettings(request, response);

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
