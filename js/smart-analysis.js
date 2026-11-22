/* Browser-side smart-cube timing, scramble guidance and CFOP analysis. */
(function (global) {
  'use strict';

  const { applyMove, applyScramble, cubeFacelets, cubeFromFacelets, netPosition } = global.Scramble;
  const { SOLVED, FACE_TURN } = global.SmartCube;
  const FACES = 'URFDLB';
  const MAX_TURNS = 2048;
  const CLOCK_WRAP = 2 ** 32;
  const CROSS_COLORS = { U: 'White', R: 'Red', F: 'Green', D: 'Yellow', L: 'Orange', B: 'Blue' };
  const DRILLS = {
    Sune: "R U R' U R U2 R'",
    'T-perm': "R U R' U' R' F R2 U' R' U' R U R' F'",
    'Ua-perm': "R U' R U R U R U' R' U' R2",
  };

  function tokens(text) {
    const moves = typeof text === 'string' ? text.trim().split(/\s+/) : [];
    return moves.length && moves.length <= MAX_TURNS && moves.every((move) => FACE_TURN.test(move)) ? moves : null;
  }

  function inverse(move) {
    if (move.endsWith('2')) return move;
    return move.endsWith("'") ? move[0] : move + "'";
  }

  function drillSetup(algorithm) {
    const moves = tokens(algorithm);
    if (!moves || moves.length > 100) return null;
    const setup = moves.reverse().map(inverse).join(' ');
    return cubeFacelets(applyScramble(3, setup)) === SOLVED ? null : setup;
  }

  function scrambleGuide(text) {
    const moves = tokens(text);
    if (!moves) return null;
    const model = cubeFromFacelets(SOLVED);
    const prefixes = new Map();
    moves.forEach((move, index) => {
      prefixes.set(cubeFacelets(model), { index, next: move });
      if (move.endsWith('2')) {
        for (const half of [move[0], move[0] + "'"]) {
          applyMove(model, half);
          prefixes.set(cubeFacelets(model), { index, next: half });
          applyMove(model, inverse(half));
        }
      }
      applyMove(model, move);
    });
    const target = cubeFacelets(model);
    if (target === SOLVED) return null;
    prefixes.set(target, { index: moves.length, next: null });
    return { target, prefixes, count: moves.length };
  }

  // Fit cube clock drift against host timestamps, skipping recovered packets and
  // Bluetooth batches that report the same host time for multiple turns.
  function calibratedClock(events) {
    const first = events[0].cubeTime;
    const last = events.at(-1).cubeTime;
    if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
    const clocks = events.map(({ cubeTime }) => Number.isFinite(cubeTime) ? (cubeTime - first + CLOCK_WRAP) % CLOCK_WRAP : null);
    const duration = clocks.at(-1);
    if (duration <= 0 || duration > 86400000) return null;
    let previous = 0;
    let lastHost = null;
    const anchors = [];
    for (let i = 0; i < events.length; i++) {
      const clock = clocks[i];
      if (clock == null) continue;
      if (clock < previous || clock > duration) return null;
      previous = clock;
      const host = events[i].time;
      if (Number.isFinite(host) && host !== lastHost) {
        anchors.push([clock, host - events[0].time]);
        lastHost = host;
      }
    }
    // Short solves and latency spikes are poor calibration samples.
    let scale = 1;
    if (anchors.length >= 3 && anchors.at(-1)[0] - anchors[0][0] >= 1000) {
      const mean = (column) => anchors.reduce((sum, pair) => sum + pair[column], 0) / anchors.length;
      const x = mean(0);
      const y = mean(1);
      const variance = anchors.reduce((sum, [cube]) => sum + (cube - x) ** 2, 0);
      const covariance = anchors.reduce((sum, [cube, host]) => sum + (cube - x) * (host - y), 0);
      const slope = covariance / variance;
      if (slope >= 0.8 && slope <= 1.2) scale = slope;
    }
    return clocks.map((clock) => clock == null ? null : clock * scale);
  }

  function finishTrace(events, inspection) {
    if (!events.length || events.length > MAX_TURNS || !Number.isFinite(events[0].time)) return null;
    const cubeClock = calibratedClock(events);
    if (!cubeClock && !Number.isFinite(events.at(-1).time)) return null;
    const timeline = cubeClock || events.map(({ time }) => Number.isFinite(time) ? time - events[0].time : null);
    let anchor = 0;
    for (let i = 1; i < timeline.length; i++) {
      if (timeline[i] == null) continue;
      timeline[i] = Math.max(timeline[anchor], timeline[i]);
      // Evenly distribute recovered turns between their surrounding timestamps.
      for (let j = anchor + 1; j < i; j++) {
        timeline[j] = timeline[anchor] + (timeline[i] - timeline[anchor]) * (j - anchor) / (i - anchor);
      }
      anchor = i;
    }
    return {
      clock: cubeClock ? 'cube' : 'browser',
      estimated: events.filter((event) => !Number.isFinite(cubeClock ? event.cubeTime : event.time)).length,
      inspection,
      moves: events.map(({ move }, i) => [move, Math.round(timeline[i])]),
    };
  }

  function cleanTrace(trace, scramble, duration) {
    if (!trace || !Array.isArray(trace.moves) || !trace.moves.length || trace.moves.length > MAX_TURNS ||
        !['cube', 'browser'].includes(trace.clock) || !tokens(scramble)) return null;
    const model = applyScramble(3, scramble);
    if (cubeFacelets(model) === SOLVED) return null;
    let previous = 0;
    const moves = [];
    for (const entry of trace.moves) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !FACE_TURN.test(entry[0]) ||
          !Number.isSafeInteger(entry[1]) || entry[1] < previous || entry[1] > duration) return null;
      previous = entry[1];
      moves.push([entry[0], entry[1]]);
      applyMove(model, entry[0]);
    }
    if (moves[0][1] !== 0 || previous !== duration || cubeFacelets(model) !== SOLVED) return null;
    const inspection = Number.isSafeInteger(trace.inspection) && trace.inspection >= 0 && trace.inspection < 17000
      ? trace.inspection : null;
    const estimated = Number.isSafeInteger(trace.estimated) && trace.estimated >= 0 && trace.estimated <= moves.length
      ? trace.estimated : 0;
    return { clock: trace.clock, estimated, inspection, moves };
  }

  const faceIndex = (sticker) => {
    const [face, row, col] = netPosition(sticker, 3);
    return FACES.indexOf(face) * 9 + row * 3 + col;
  };
  const solvedModel = cubeFromFacelets(SOLVED);
  const dot = (a, b) => a.reduce((sum, coordinate, i) => sum + coordinate * b[i], 0);
  const crossProduct = ([x, y, z], [a, b, c]) => [y * c - z * b, z * a - x * c, x * b - y * a];
  const normals = new Map([...FACES].map((color) => [
    color, solvedModel.stickers.find((sticker) => sticker.color === color).nv,
  ]));
  const faces = [...FACES].map((color) => {
    const normal = normals.get(color);
    const layer = (sticker) => dot(sticker.p, normal);
    const cross = solvedModel.stickers.filter((sticker) => layer(sticker) === 2 &&
      sticker.p.filter((coordinate) => coordinate !== 0).length === 2).map(faceIndex);
    const pairs = solvedModel.stickers.filter((sticker) => layer(sticker) === 2 &&
      sticker.p.every((coordinate) => coordinate !== 0)).map((corner) =>
      solvedModel.stickers.filter((sticker) => sticker.p.every((coordinate, i) =>
        normal[i] ? coordinate === 2 * normal[i] || coordinate === 0 : coordinate === corner.p[i])).map(faceIndex));
    const f2l = solvedModel.stickers.filter((sticker) => layer(sticker) !== -2).map(faceIndex);
    const lastColor = FACES[(FACES.indexOf(color) + 3) % 6];
    const top = normals.get(lastColor);
    const front = [...normals.values()].find((side) => dot(top, side) === 0);
    const right = crossProduct(top, front);
    const oll = solvedModel.stickers.filter((sticker) => sticker.color === lastColor)
      .sort((a, b) => dot(a.p, front) - dot(b.p, front) || dot(a.p, right) - dot(b.p, right)).map(faceIndex);
    const sides = [front, right, front.map((value) => -value), right.map((value) => -value)];
    const sideColors = sides.map((side) => [...FACES].find((candidate) => dot(normals.get(candidate), side) === 1));
    const strips = sideColors.map((side, i) => solvedModel.stickers
      .filter((sticker) => sticker.color === side && layer(sticker) === -2)
      .sort((a, b) => dot(a.p, sides[(i + 1) % 4]) - dot(b.p, sides[(i + 1) % 4])).map(faceIndex));
    return { color, lastColor, cross, pairs, f2l, oll, sideColors, strips };
  });
  const atSolvedPositions = (state, indices) => indices.every((index) => state[index] === SOLVED[index]);

  function caseKey(state, face, phase) {
    const model = cubeFromFacelets(state);
    const keys = [];
    for (let i = 0; i < 4; i++) {
      const facelets = cubeFacelets(model);
      if (phase === 'OLL') {
        keys.push([...face.oll, ...face.strips.flat()].map((index) => facelets[index] === face.lastColor ? '1' : '0').join(''));
      } else {
        const offsets = face.strips.map((strip, side) => strip.map((index) =>
          (face.sideColors.indexOf(facelets[index]) - side + 4) % 4).join(''));
        for (let side = 0; side < 4; side++) keys.push(offsets.slice(side).concat(offsets.slice(0, side)).join(''));
      }
      applyMove(model, face.lastColor);
    }
    return keys.sort()[0];
  }

  const drillNames = new Map();
  const yellow = faces.find((face) => face.color === 'D');
  for (const [name, algorithm] of Object.entries(DRILLS)) {
    const setup = cubeFacelets(applyScramble(3, drillSetup(algorithm)));
    const phase = atSolvedPositions(setup, yellow.oll) ? 'PLL' : 'OLL';
    if (atSolvedPositions(setup, yellow.f2l)) drillNames.set(caseKey(setup, yellow, phase), name);
  }

  function identifyCase(states, face, phase) {
    const { label, start, end } = phase;
    if (start === end || !['PLL', 'OLL'].includes(label)) return null;
    const key = caseKey(states[start], face, label);
    if (key === '000000000000') return { key, name: 'AUF only' };
    const code = parseInt(key, label === 'OLL' ? 2 : 4).toString(36).toUpperCase();
    return { key, name: drillNames.get(key) || `${label} pattern ${code}` };
  }

  function caseStats(results) {
    const groups = new Map();
    results.forEach(({ phases }, index) => {
      for (const phase of phases) {
        const detected = phase.case;
        if (!detected) continue;
        const id = `${phase.label}:${detected.key}`;
        if (!groups.has(id)) {
          groups.set(id, { name: detected.name, type: phase.label, count: 0, time: 0, pause: 0, best: Infinity });
        }
        const group = groups.get(id);
        group.count++;
        group.time += phase.duration;
        group.pause += phase.pause;
        group.best = Math.min(group.best, phase.duration);
        if (phase.end - phase.start <= 100) group.example = { index, start: phase.start, end: phase.end };
      }
    });
    for (const group of groups.values()) {
      group.averageMs = Math.round(group.time / group.count);
      group.averagePauseMs = Math.round(group.pause / group.count);
      group.averageExecutionMs = Math.round((group.time - group.pause) / group.count);
    }
    return groups;
  }

  function analyze(scramble, trace) {
    const model = applyScramble(3, scramble);
    const states = [cubeFacelets(model)];
    const times = [0];
    const turns = [0];
    for (const [move, time] of trace.moves) {
      applyMove(model, move);
      states.push(cubeFacelets(model));
      times.push(time);
      turns.push(turns.at(-1) + (move.endsWith('2') ? 2 : 1));
    }
    const last = states.length - 1;
    const possibilities = faces.map((face) => {
      const f2l = states.findIndex((state) => atSolvedPositions(state, face.f2l));
      let cross = f2l;
      while (cross > 0 && atSolvedPositions(states[cross - 1], face.cross)) cross--;
      const oll = states.findIndex((state, i) => i >= f2l && face.oll.every((index) => state[index] === face.lastColor));
      return { face, cross, f2l, oll };
    });
    possibilities.sort((a, b) => a.f2l - b.f2l || a.cross - b.cross);
    const { face, cross, f2l, oll } = possibilities[0];
    const phases = [
      ['Cross', 0, cross], ['F2L', cross, f2l], ['OLL', f2l, oll], ['PLL', oll, last],
    ].map(([label, start, end]) => ({
      label, start, end,
      duration: times[end] - times[start],
      turns: turns[end] - turns[start],
      pause: end > start ? times[start + 1] - times[start] : 0,
      case: identifyCase(states, face, { label, start, end }),
    }));
    let longestPause = 0;
    for (let i = 2; i < times.length; i++) longestPause = Math.max(longestPause, times[i] - times[i - 1]);
    return {
      states, times, phases, crossColor: CROSS_COLORS[face.color],
      xcross: cross > 0 && cross < last && face.pairs.some((pair) => atSolvedPositions(states[cross], pair)),
      turns: turns[last],
      tps: times[last] > 0 ? 1000 * turns[last] / times[last] : null,
      longestPause,
    };
  }

  global.SmartAnalysis = { analyze, caseStats, cleanTrace, drillSetup, finishTrace, inverse, scrambleGuide, DRILLS, MAX_TURNS };
})(typeof window !== 'undefined' ? window : globalThis);
