'use strict';

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

module.exports = { selectPractice };
