'use strict';

const MAX_SOLVES = 50;
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

module.exports = { prepareBulkReview };
