/* Browser client for direct and server-backed coaching. */
(function (global) {
  'use strict';

  const Core = typeof module !== 'undefined' && module.exports ? require('./coach-core.js') : global.CoachCore;
  let browserProvider = null;

  async function review(metrics, signal, conversation = []) {
    if (browserProvider) {
      const prepared = Core.prepareReview(metrics, conversation);
      if (!prepared) throw new Error('Choose valid solve data for advice.');
      try {
        return await Core.completeReview(browserProvider, prepared, signal);
      } catch (error) {
        if (signal?.aborted || error instanceof Core.ProviderError) throw error;
        throw new Error('Could not reach the provider from this page. Check the URL and the provider’s browser access (CORS).');
      }
    }

    let response;
    try {
      response = await fetch('./api/coach', {
        method: 'POST',
        mode: 'same-origin',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify(conversation.length ? { metrics, conversation } : metrics),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error('Could not reach the AI coach. Open Settings → AI coach to connect to a provider.');
    }
    if ([404, 405, 501].includes(response.status)) {
      throw new Error('Open Settings → AI coach to connect to a provider.');
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || `The coach server returned HTTP ${response.status}.`);
    const advice = data?.advice;
    if (typeof advice !== 'string' || !advice.trim()) throw new Error('The coach server did not return advice.');
    const lesson = data.lesson;
    const isTutorial = typeof lesson?.title === 'string' && lesson.title.trim() &&
      typeof lesson.url === 'string' && /^https:\/\/www\.cubeskills\.com\/tutorials\/[a-z0-9/-]+$/.test(lesson.url);
    return { advice: advice.trim(), lesson: isTutorial ? lesson : null };
  }

  async function providerSettings(method = 'GET', settings) {
    const response = await fetch('./api/coach/settings', {
      method,
      mode: 'same-origin',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      ...(settings ? {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      } : {}),
    });
    if ([404, 405, 501].includes(response.status) && method === 'GET') return null;
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || `The coach server returned HTTP ${response.status}.`);
    if (!['none', 'environment', 'web'].includes(data?.source)) {
      throw new Error('The coach server did not return provider settings.');
    }
    return data;
  }

  async function providerModels(endpoint, token) {
    const provider = Core.configureProvider(endpoint, token);
    const url = new URL(provider.endpoint);
    url.pathname = url.pathname.replace(/\/chat\/completions$/, '/models');
    try {
      const response = await fetch(url.href, {
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
        headers: provider.token ? { Authorization: 'Bearer ' + provider.token } : {},
      });
      if (!response.ok) {
        await response.body?.cancel();
        return [];
      }
      const { data } = await response.json();
      if (!Array.isArray(data)) return [];
      return [...new Set(data.map((model) => model?.id).filter((id) => typeof id === 'string' && id.trim()))].sort();
    } catch {
      return [];
    }
  }

  function browserSettings() {
    if (!browserProvider) return null;
    const { endpoint, model } = browserProvider;
    return { endpoint, model };
  }

  function setBrowserProvider(endpoint, token, model) {
    browserProvider = Core.configureCoach(endpoint, token, model);
  }

  function clearBrowserProvider() {
    browserProvider = null;
  }

  global.AICoach = {
    review, providerSettings, providerModels, browserSettings, setBrowserProvider, clearBrowserProvider, chatLimits: Core.CHAT_LIMITS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
