/* Browser client for the same-origin AI coaching endpoint. */
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
      throw new Error('AI coaching requires the local coach server. See the README for setup.');
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || `The coach server returned HTTP ${response.status}.`);
    const advice = data?.advice;
    if (typeof advice !== 'string' || !advice.trim()) throw new Error('The coach server did not return advice.');
    return advice.trim();
  }

  global.AICoach = { review };
})(typeof window !== 'undefined' ? window : globalThis);
