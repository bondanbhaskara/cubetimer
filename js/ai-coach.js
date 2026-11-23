/* Browser client for the same-origin AI coach. */
(function (global) {
  'use strict';

  async function review(metrics, signal) {
    let response;
    try {
      response = await fetch('./api/coach', {
        method: 'POST',
        mode: 'same-origin',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify(metrics),
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new Error('Could not reach the AI coach. Open Cube Timer through the local coach server.');
    }
    if ([404, 405, 501].includes(response.status)) {
      throw new Error('AI coaching requires the local coach server. See Settings → AI coach for setup.');
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

  global.AICoach = { review, providerSettings };
})(typeof window !== 'undefined' ? window : globalThis);
