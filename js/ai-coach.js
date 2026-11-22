/* Optional browser-side client for OpenAI-compatible chat completions. */
(function (global) {
  'use strict';

  function endpointFor(value) {
    let url;
    try {
      url = new URL(value.trim());
    } catch {
      throw new Error('Enter a complete API URL, such as https://api.openai.com/v1.');
    }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
      throw new Error('Use HTTPS for a remote API or HTTP for a local API on localhost.');
    }
    if (url.username || url.password || url.hash) {
      throw new Error('Use an API URL without credentials or a fragment.');
    }
    const path = url.pathname.replace(/\/+$/, '');
    url.pathname = path.endsWith('/chat/completions') ? path : (path || '/v1') + '/chat/completions';
    return url.href;
  }

  function configure(url, token, model) {
    const endpoint = endpointFor(url);
    if (!token.trim() || /[^\x21-\x7e]/.test(token.trim())) throw new Error('Enter a valid API token.');
    if (!model.trim()) throw new Error('Enter the model ID from your provider.');
    return { endpoint, token: token.trim(), model: model.trim() };
  }

  async function review(config, metrics, signal) {
    let response;
    try {
      response = await fetch(config.endpoint, {
        method: 'POST',
        credentials: 'omit',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.token },
        signal,
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: 'You are a speedcubing practice coach. Use only the supplied aggregate or solve metrics as evidence. Times are milliseconds. Focus on one observed bottleneck, then suggest two specific practice drills or measurable goals. Keep the answer around 150 words in plain text. An initial pause is a recognition proxy, and CFOP splits and case names are inferred. Mention small samples or estimated timestamps when relevant. Do not invent move sequences, cube rotations, benchmarks or missing metrics.' },
            { role: 'user', content: JSON.stringify(metrics) },
          ],
        }),
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new Error('Could not reach the API. Check the URL and whether your provider allows browser requests (CORS).');
    }
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw new Error('The API rejected the token or model access.');
      if (response.status === 429) throw new Error('The API rate limit or quota was reached. Try again later.');
      throw new Error(`The API returned HTTP ${response.status}. Check the endpoint and model ID.`);
    }
    const data = await response.json().catch(() => null);
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('The API did not return a chat completion. Check the endpoint and model ID.');
    return text.trim();
  }

  global.AICoach = { endpointFor, configure, review };
})(typeof window !== 'undefined' ? window : globalThis);
