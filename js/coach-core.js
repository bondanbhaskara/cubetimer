/* Coaching metrics, lesson selection, and provider protocol shared by the browser and relay. */
(function (global) {
  'use strict';

  const COACH_PROMPT = [
    'You are a speedcubing practice coach. Use only the supplied solve or session metrics as evidence. Times are milliseconds.',
    'Use the selected CubeSkills lesson topic and practice idea to suggest two specific drills or measurable goals.',
    'Treat the selected observation as a practice opportunity. An initial pause is a recognition proxy, and CFOP splits and case names are inferred.',
    'Mention small samples or estimated timestamps when relevant. If there is no timed phase, keep the advice general.',
    'Keep the answer around 150 words in plain text. The app supplies the lesson link.',
    'Avoid invented lesson details, move sequences, cube rotations, benchmarks, and missing metrics.',
  ].join(' ');
  const BULK_PROMPT = [
    'The selected results are in chronological order and may come from nonconsecutive solves.',
    'A null time is a DNF. Numeric solve times include any +2 penalties.',
    'With solve times only, discuss observable consistency or changes in the selected results without inferring phase timings or causes.',
    'When CFOP splits are present, use only the solves with splits for phase comparisons and mention limited coverage when relevant.',
  ].join(' ');

  const MAX_SOLVES = 50;
  const CHAT_LIMITS = { messages: 8, user: 1500, assistant: 2500 };
  const PHASES = ['Cross', 'F2L', 'OLL', 'PLL'];
  const isTime = (value) => Number.isSafeInteger(value) && value >= 0;

  function prepareBulkReview({ scope, detail, solves }) {
    if (!['times', 'cfop'].includes(detail) || !Array.isArray(solves) ||
        !solves.length || solves.length > MAX_SOLVES) return null;

    const cleaned = [];
    const totals = new Map();
    for (const solve of solves) {
      const timeMs = solve?.timeMs;
      if (timeMs !== null && !isTime(timeMs)) return null;
      const item = { timeMs };
      if (detail === 'cfop' && timeMs !== null && solve.phases != null) {
        if (!Array.isArray(solve.phases) || solve.phases.length > PHASES.length) return null;
        const phases = [];
        const seen = new Set();
        for (const split of solve.phases) {
          const { phase, timeMs: duration, initialPauseMs, executionMs } = split || {};
          if (!PHASES.includes(phase) || seen.has(phase) || !isTime(duration) || duration > timeMs ||
              !isTime(initialPauseMs) || initialPauseMs > duration || executionMs !== duration - initialPauseMs) return null;
          seen.add(phase);
          phases.push({ phase, timeMs: duration, initialPauseMs, executionMs });
          if (!totals.has(phase)) totals.set(phase, { count: 0, duration: 0, pause: 0 });
          const total = totals.get(phase);
          total.count++;
          total.duration += duration;
          total.pause += initialPauseMs;
        }
        if (phases.length) item.phases = phases;
      }
      cleaned.push(item);
    }

    const phases = [...totals].map(([phase, { count, duration, pause }]) => ({
      phase, averageMs: Math.round(duration / count), averagePauseMs: Math.round(pause / count),
    }));
    return { metrics: { scope, detail, solves: cleaned }, phases };
  }

  const TUTORIALS = 'https://www.cubeskills.com/tutorials/';

  const PHASE_LESSONS = {
    Cross: {
      title: 'Intermediate Cross Techniques',
      path: 'intermediate-cross-and-f2l/intermediate-cross-techniques',
      access: 'free account',
      practice: 'Plan the cross before turning, then try cross-only solves and compare quarter turns.',
    },
    F2L: {
      title: 'Efficiency in F2L',
      path: 'intermediate-cross-and-f2l/efficiency-in-f2l',
      access: 'free account',
      practice: 'Replay a solve, try another way to pair and insert an F2L pair, and compare quarter turns.',
    },
    OLL: {
      title: 'OLL Algorithms',
      path: 'oll-algorithms',
      practice: 'Group OLL cases by their sticker shapes and repeat a familiar case, tracking execution separately from the initial pause.',
    },
    PLL: {
      title: 'PLL Algorithms',
      path: 'pll-algorithms',
      practice: 'Repeat a familiar PLL case and track execution time separately from the initial pause.',
    },
  };

  const TRANSITION_LESSONS = {
    F2L: {
      title: 'Improving Cross-F2L Transition',
      path: 'intermediate-cross-and-f2l/improving-crossf2l-transition',
      access: 'free account',
      practice: 'During slow solves, track a candidate first pair while finishing the cross. Compare the pause before the first F2L turn.',
    },
    OLL: {
      title: 'F2L to OLL Transition',
      path: 'intermediate-last-layer/f2l-to-oll-transition',
      access: 'premium',
      practice: 'Repeat just the last F2L pair and OLL, looking for the OLL shape as the pair goes in. Track the pause before OLL.',
    },
    PLL: {
      title: 'PLL Recognition',
      path: 'intermediate-last-layer/pll-recognition',
      access: 'free account',
      practice: 'Identify familiar PLL cases from different angles before executing. Track the pause before the first PLL turn.',
    },
  };

  const AUF_LESSON = {
    title: 'AUF (Adjusting U Face)',
    path: 'intermediate-last-layer/auf-adjusting-u-face',
    access: 'premium',
    practice: 'Practice recognizing the final U-face adjustment and track the pause before making it.',
  };
  const GENERAL_LESSON = {
    title: 'Practicing',
    path: 'practicing',
    practice: 'Isolate one component of the solve for deliberate practice, then collect a baseline before comparing results.',
  };

  function selectPractice(metrics) {
    const history = metrics.scope === 'filtered session history';
    const splits = Array.isArray(metrics.phases) ? metrics.phases : [];
    let longestPhase;
    let longestTransition;
    for (const split of splits) {
      const phase = split?.phase;
      if (typeof phase !== 'string' || !Object.hasOwn(PHASE_LESSONS, phase)) continue;
      const duration = history ? split.averageMs : split.timeMs;
      if (!Number.isFinite(duration) || duration <= 0) continue;
      if (!longestPhase || duration > longestPhase.duration) longestPhase = { phase, duration };

      const pause = history ? split.averagePauseMs : split.initialPauseMs;
      if (Object.hasOwn(TRANSITION_LESSONS, phase) && Number.isFinite(pause) &&
          pause >= duration / 2 && pause <= duration && (!longestTransition || pause > longestTransition.pause)) {
        longestTransition = { phase, duration, pause };
      }
    }

    const focus = longestTransition || longestPhase;
    const aufOnly = !history && focus?.phase === 'PLL' && Array.isArray(metrics.cases) &&
      metrics.cases.some((item) => item?.phase === 'PLL' && item.case === 'AUF only');
    const selected = aufOnly ? AUF_LESSON
      : longestTransition ? TRANSITION_LESSONS[focus.phase]
      : longestPhase ? PHASE_LESSONS[focus.phase]
      : GENERAL_LESSON;

    const observation = longestTransition
      ? `${focus.phase} initial pause: ${focus.pause} ms of ${focus.duration} ms${history ? ' on average' : ''}.`
      : longestPhase
        ? `${focus.phase} recorded duration: ${focus.duration} ms${history ? ' on average' : ''}.`
        : 'There is no timed CFOP phase to compare.';
    const { title, path, access, practice } = selected;
    return { lesson: { title, url: TUTORIALS + path, access }, observation, practice };
  }

  function configureProvider(url, token) {
    let endpoint;
    try {
      endpoint = new URL(url.trim());
    } catch {
      throw new Error('Enter a complete provider URL.');
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
      throw new Error('Enter a valid provider API token. Loopback providers can use a blank token.');
    }
    return { endpoint: endpoint.href, token: token.trim() };
  }

  function configureCoach(url, token, model) {
    const provider = configureProvider(url, token);
    if (!model.trim()) throw new Error('Enter the provider model ID.');
    return { ...provider, model: model.trim() };
  }

  function prepareReview(metrics, conversation = []) {
    if (!Array.isArray(conversation) || conversation.length > CHAT_LIMITS.messages || conversation.length % 2) return null;
    const replies = [];
    for (const [index, message] of conversation.entries()) {
      const role = index % 2 ? 'user' : 'assistant';
      const content = typeof message?.content === 'string' ? message.content.trim() : '';
      if (message?.role !== role || !content || content.length > CHAT_LIMITS[role]) return null;
      replies.push({ role, content });
    }

    let practiceMetrics = metrics;
    const isBulk = metrics?.scope === 'selected solves';
    if (isBulk) {
      const bulk = prepareBulkReview(metrics);
      if (!bulk) return null;
      metrics = bulk.metrics;
      practiceMetrics = { scope: 'filtered session history', phases: bulk.phases };
    } else if (!['single solve', 'filtered session history'].includes(metrics?.scope)) {
      return null;
    }

    const { lesson, observation, practice } = selectPractice(practiceMetrics);
    const prompt = [COACH_PROMPT];
    if (isBulk) prompt.push(BULK_PROMPT);
    prompt.push(`CubeSkills lesson topic: ${lesson.title}`, observation, `Practice idea: ${practice}`);
    if (replies.length) prompt.push('For a follow-up, answer the latest question directly and refer to the earlier conversation when useful.');
    return { lesson, messages: [
      { role: 'system', content: prompt.join('\n') },
      { role: 'user', content: JSON.stringify(metrics) },
      ...replies,
    ] };
  }

  class ProviderError extends Error {
    constructor(message, status = 502) {
      super(message);
      this.status = status;
    }
  }

  async function completeReview(config, { messages, lesson }, signal) {
    const headers = { 'Content-Type': 'application/json' };
    if (config.token) headers.Authorization = 'Bearer ' + config.token;
    const result = await fetch(config.endpoint, {
      method: 'POST',
      credentials: 'omit',
      headers,
      redirect: 'error',
      signal,
      body: JSON.stringify({ model: config.model, messages }),
    });
    if (!result.ok) {
      await result.body?.cancel();
      if ([401, 403].includes(result.status)) throw new ProviderError('The provider rejected the token or model access.');
      if (result.status === 429) throw new ProviderError('The provider rate limit or quota was reached.', 429);
      throw new ProviderError(`The provider returned HTTP ${result.status}.`);
    }
    const data = await result.json().catch(() => null);
    const advice = data?.choices?.[0]?.message?.content;
    if (typeof advice !== 'string' || !advice.trim()) {
      throw new ProviderError('The provider did not return a chat completion.');
    }
    return { advice: advice.trim(), lesson };
  }

  const core = { configureProvider, configureCoach, prepareReview, completeReview, ProviderError, selectPractice, CHAT_LIMITS };
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  else global.CoachCore = core;
})(typeof window !== 'undefined' ? window : globalThis);
