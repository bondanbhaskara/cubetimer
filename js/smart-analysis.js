/* Browser-side smart-cube timing, scramble guidance and CFOP analysis. */
(function (global) {
  'use strict';

  const { applyMove, applyScramble, cubeFacelets, cubeFromFacelets, netPosition } = global.Scramble;
  const { SOLVED, FACE_TURN } = global.SmartCube;
  const algorithms = typeof module !== 'undefined' && module.exports ? require('./case-algorithms.js') : global.CaseAlgorithms;
  const FACES = 'URFDLB';
  const MAX_TURNS = 2048;
  const CLOCK_WRAP = 2 ** 32;
  const CROSS_COLORS = { U: 'White', R: 'Red', F: 'Green', D: 'Yellow', L: 'Orange', B: 'Blue' };
  const DRILLS = {
    Sune: algorithms.OLL[27],
    'T-perm': algorithms.PLL.T,
    'Ua-perm': algorithms.PLL.Ua,
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

  function clockScale(anchors) {
    if (anchors.length < 5 || anchors.at(-1)[0] - anchors[0][0] < 1000) return 1;

    // Median pairwise slope resists isolated Bluetooth delays. Sample evenly
    // across the solve to bound the work for long traces.
    const count = Math.min(anchors.length, 21);
    const sample = Array.from({ length: count }, (_, i) =>
      anchors[Math.round(i * (anchors.length - 1) / (count - 1))]);
    const slopes = [];
    for (let i = 0; i < sample.length; i++) {
      const [clock, host] = sample[i];
      for (const [laterClock, laterHost] of sample.slice(i + 1)) {
        slopes.push((laterHost - host) / (laterClock - clock));
      }
    }
    slopes.sort((a, b) => a - b);
    const middle = Math.floor(slopes.length / 2);
    const slope = (slopes[middle] + slopes[Math.floor((slopes.length - 1) / 2)]) / 2;
    return slope >= 0.8 && slope <= 1.2 ? slope : 1;
  }

  // Skip recovered packets and duplicate clock readings in the calibration.
  function calibratedClock(events) {
    const first = events[0].cubeTime;
    const last = events.at(-1).cubeTime;
    if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
    const clocks = events.map(({ cubeTime }) => Number.isFinite(cubeTime) ? (cubeTime - first + CLOCK_WRAP) % CLOCK_WRAP : null);
    const duration = clocks.at(-1);
    if (duration <= 0 || duration > 86400000) return null;
    let previous = 0;
    const anchors = [];
    for (let i = 0; i < events.length; i++) {
      const clock = clocks[i];
      if (clock == null) continue;
      if (clock < previous || clock > duration) return null;
      previous = clock;
      const host = events[i].time;
      const lastAnchor = anchors.at(-1);
      if (Number.isFinite(host) && (!lastAnchor || (clock > lastAnchor[0] && host > lastAnchor[1]))) {
        anchors.push([clock, host]);
      }
    }
    const scale = clockScale(anchors);
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
    const pairs = solvedModel.stickers.filter((sticker) => sticker.color === color &&
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

  // Canonical keys from the standard CubeSkills case sheets, in case order.
  const ollPatterns = [
    0x1ff000, // Skip
    0x0105d7, 0x0105bb, 0x0114db, 0x011cb6, 0x01b05b, 0x01b836, 0x0330d9, 0x01e136, 0x072994, 0x072299, // 1–10
    0x01e25a, 0x0338b4, 0x03c658, 0x039c34, 0x039459, 0x03c534, 0x05459a, 0x0154ba, 0x0154d6, 0x155492, // 11–20
    0x0ba145, 0x0ba129, 0x0bf028, 0x0bf044, 0x0fe108, 0x0bb824, 0x0bb049, 0x15f012, 0x09d446, 0x073898, // 21–30
    0x01f056, 0x0370d4, 0x079c18, 0x03d454, 0x076294, 0x05e11a, 0x076198, 0x05e216, 0x07c518, 0x0d618a, // 31–40
    0x073095, 0x09d42a, 0x01f03a, 0x0370b8, 0x079415, 0x03d438, 0x01aa56, 0x01a95a, 0x01a13b, 0x01a237, // 41–50
    0x038635, 0x038539, 0x01a157, 0x01aa3a, 0x038e38, 0x038555, 0x17d410, // 51–57
  ];
  const ollNames = { 21: 'H', 22: 'Pi', 23: 'Headlights', 24: 'Chameleon', 25: 'Bowtie', 26: 'Anti-Sune', 27: 'Sune' };
  const pllPatterns = {
    Skip: '000000000000',
    Aa: '002203303300',
    Ab: '001101102200',
    E: '012210012210',
    F: '000021103320',
    Ga: '011123320030',
    Gb: '020021133310',
    Gc: '001121132230',
    Gd: '002213313320',
    H: '020020020020',
    Ja: '000001113330',
    Jb: '000011133300',
    Na: '022200022200',
    Nb: '002220002220',
    Ra: '001103310030',
    Rb: '010031103300',
    T: '001123300020',
    Ua: '000010010020',
    Ub: '000020030030',
    V: '002210032200',
    Y: '002200012230',
    Z: '010030010030',
  };
  function catalogEntry(key, name, algorithm) {
    const setup = algorithm ? drillSetup(algorithm) : '';
    return [key, { key, name, skip: !algorithm, algorithm: algorithm || null,
      facelets: setup ? cubeFacelets(applyScramble(3, setup)) : SOLVED }];
  }

  const casesByType = {
    OLL: new Map(ollPatterns.map((pattern, id) => {
      const key = pattern.toString(2).padStart(21, '0');
      const label = ollNames[id] ? `OLL ${id} (${ollNames[id]})` : `OLL ${id}`;
      return catalogEntry(key, id ? label : 'OLL skip', algorithms.OLL[id]);
    })),
    PLL: new Map(Object.entries(pllPatterns).map(([id, key]) =>
      catalogEntry(key, id === 'Skip' ? 'PLL skip / AUF only' : `${id}-perm`, algorithms.PLL[id]))),
  };
  const caseCatalog = (type) => [...casesByType[type].values()];

  function identifyCase(states, face, phase) {
    const { label, start, end } = phase;
    if (!casesByType[label]) return null;
    const key = caseKey(states[start], face, label);
    const detected = casesByType[label].get(key);
    if (label === 'PLL' && detected?.skip) return { ...detected, name: start === end ? 'PLL skip' : 'AUF only' };
    return detected ?? null;
  }

  function caseStats(results) {
    const groups = new Map();
    results.forEach(({ phases }, index) => {
      for (const phase of phases) {
        const detected = phase.case;
        if (!detected) continue;
        const id = `${phase.label}:${detected.key}`;
        if (!groups.has(id)) {
          const name = casesByType[phase.label].get(detected.key)?.name ?? detected.name;
          groups.set(id, { name, type: phase.label, count: 0, turns: 0, time: 0, pause: 0, best: Infinity });
        }
        const group = groups.get(id);
        group.count++;
        group.turns += phase.turns;
        group.time += phase.duration;
        group.pause += phase.pause;
        group.best = Math.min(group.best, phase.duration);
        if (!detected.skip && phase.end > phase.start && phase.end - phase.start <= 100) {
          group.example = { index, start: phase.start, end: phase.end };
        }
      }
    });
    for (const group of groups.values()) {
      group.averageMs = Math.round(group.time / group.count);
      group.averageTurns = group.turns / group.count;
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
      const cross = states.findIndex((state) => atSolvedPositions(state, face.cross));
      const oll = states.findIndex((state, i) =>
        i >= f2l && atSolvedPositions(state, face.f2l) && atSolvedPositions(state, face.oll));
      return { face, cross, f2l, oll };
    });
    possibilities.sort((a, b) => a.f2l - b.f2l || a.cross - b.cross);
    const { face, cross, f2l, oll } = possibilities[0];
    const split = (label, start, end) => ({
      label, start, end,
      duration: times[end] - times[start],
      turns: turns[end] - turns[start],
      pause: end > start ? times[start + 1] - times[start] : 0,
      case: identifyCase(states, face, { label, start, end }),
    });
    const phases = [split('Cross', 0, cross), split('F2L', cross, f2l), split('OLL', f2l, oll), split('PLL', oll, last)];
    const pairs = [];
    let pairStart = cross;
    for (let i = cross; i <= f2l && pairs.length < face.pairs.length; i++) {
      if (!atSolvedPositions(states[i], face.cross)) continue;
      const solved = face.pairs.filter((pair) => atSolvedPositions(states[i], pair)).length;
      while (pairs.length < solved) {
        pairs.push(split(`F2L pair ${pairs.length + 1}`, pairStart, i));
        pairStart = i;
      }
    }
    let longestPause = 0;
    for (let i = 2; i < times.length; i++) longestPause = Math.max(longestPause, times[i] - times[i - 1]);
    return {
      states, times, phases, pairs, crossColor: CROSS_COLORS[face.color],
      xcross: cross > 0 && cross < last && face.pairs.some((pair) => atSolvedPositions(states[cross], pair)),
      turns: turns[last],
      tps: times[last] > 0 ? 1000 * turns[last] / times[last] : null,
      longestPause,
    };
  }

  global.SmartAnalysis = { analyze, caseCatalog, caseStats, cleanTrace, drillSetup, finishTrace, inverse, scrambleGuide, DRILLS, MAX_TURNS };
})(typeof window !== 'undefined' ? window : globalThis);
