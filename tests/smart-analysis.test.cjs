const assert = require('node:assert/strict');
const test = require('node:test');
require('../js/scramble.js');
require('../js/smart-cube.js');
require('../js/smart-analysis.js');

const { Scramble, SmartCube, SmartAnalysis: Smart } = globalThis;
const state = (moves) => Scramble.cubeFacelets(Scramble.applyScramble(3, moves));

test('guidance accepts either direction for the two quarter turns in a double', () => {
  const guide = Smart.scrambleGuide('R2 U');
  assert.deepEqual(guide.prefixes.get(SmartCube.SOLVED), { index: 0, next: 'R2' });
  assert.deepEqual(guide.prefixes.get(state('R')), { index: 0, next: 'R' });
  assert.deepEqual(guide.prefixes.get(state("R'")), { index: 0, next: "R'" });
  assert.deepEqual(guide.prefixes.get(state('R2')), { index: 1, next: 'U' });
  assert.deepEqual(guide.prefixes.get(state('R2 U')), { index: 2, next: null });
  assert.equal(Smart.scrambleGuide("R R'"), null);
});

test('uses cube timestamps across rollover and interpolates missing turns', () => {
  const trace = Smart.finishTrace([
    { move: 'R', time: 123, cubeTime: 4294967096 },
    { move: 'U', time: null, cubeTime: null },
    { move: "R'", time: 523, cubeTime: 200 },
    { move: "U'", time: 723, cubeTime: 400 },
  ], 50);
  assert.equal(trace.clock, 'cube');
  assert.equal(trace.estimated, 1);
  assert.equal(trace.inspection, 50);
  assert.deepEqual(trace.moves.map(([, t]) => t), [0, 200, 400, 600]);
});

test('fits device clock drift and falls back to browser timing for a reset device clock', () => {
  const samples = 'R U F L D'.split(' ').map((move, index) => ({
    move, time: 100 + index * 275, cubeTime: 200 + index * 250,
  }));
  const calibrated = Smart.finishTrace(samples, null);
  assert.equal(calibrated.clock, 'cube');
  assert.deepEqual(calibrated.moves.map(([, t]) => t), [0, 275, 550, 825, 1100]);
  samples.at(-1).cubeTime = 20;
  assert.equal(Smart.finishTrace(samples, null).clock, 'browser');
  samples.at(-1).time = null;
  assert.equal(Smart.finishTrace(samples, null), null);
});

test('isolated Bluetooth delays do not change a stable cube clock', () => {
  const moves = Smart.DRILLS.Sune.split(' ');
  for (const delayed of [0, 5, 6]) {
    const samples = moves.map((move, index) => ({
      move, cubeTime: index * 250, time: 1000 + index * 250 + (index === delayed ? 180 : 0),
    }));
    const trace = Smart.finishTrace(samples, null);
    assert.equal(trace.clock, 'cube');
    assert.deepEqual(trace.moves.map(([, time]) => time), [0, 250, 500, 750, 1000, 1250, 1500]);
  }
});

test('presets produce replayable cases with expected CFOP phases', () => {
  for (const [name, algorithm] of Object.entries(Smart.DRILLS)) {
    const scramble = Smart.drillSetup(algorithm);
    const moves = algorithm.split(' ').map((move, i) => [move, 250 * i]);
    const duration = moves.at(-1)[1];
    const trace = Smart.cleanTrace({ clock: 'cube', moves }, scramble, duration);
    assert.ok(trace, name);
    const solve = Smart.analyze(scramble, trace);
    assert.equal(solve.states.at(-1), SmartCube.SOLVED);
    assert.equal(solve.crossColor, 'Yellow');
    assert.equal(solve.phases[name === 'Sune' ? 2 : 3].case.name, name === 'Sune' ? 'OLL 27 (Sune)' : name);
    assert.equal(solve.phases.reduce((sum, phase) => sum + phase.duration, 0), duration);
    assert.equal(solve.turns, algorithm.split(' ').reduce((sum, move) => sum + (move.endsWith('2') ? 2 : 1), 0));
  }
});

test('case recognition works across cross colors and ignores PLL alignment', () => {
  const rotatedSune = Smart.DRILLS.Sune.replace(/[UR]/g, (face) => ({ U: 'R', R: 'D' })[face]);
  const suneMoves = rotatedSune.split(' ').map((move, i) => [move, i * 200]);
  const rotated = Smart.analyze(Smart.drillSetup(rotatedSune), { moves: suneMoves });
  assert.equal(rotated.crossColor, 'Orange');
  assert.equal(rotated.phases[2].case.name, 'OLL 27 (Sune)');

  const algorithm = `U' ${Smart.DRILLS['T-perm']}`;
  const moves = algorithm.split(' ').map((move, i) => [move, i * 200]);
  const aligned = Smart.analyze(Smart.drillSetup(algorithm), { moves });
  assert.equal(aligned.phases[3].case.name, 'T-perm');
});

test('PLL starts after both last-layer orientation and first-two-layer repair', () => {
  const sune = Smart.DRILLS.Sune.split(' ');
  const tPerm = Smart.DRILLS['T-perm'].split(' ');
  const bottomPerm = Smart.DRILLS['Ua-perm'].replace(/U/g, 'D').split(' ');
  const inverse = (moves) => moves.slice().reverse().map(Smart.inverse);
  const scramble = inverse([...sune, ...tPerm]).join(' ');
  // Finish Sune while the lower layer is disturbed, then restore it.
  const repair = [...sune.slice(0, -1), ...bottomPerm, "R'", 'R', ...inverse(bottomPerm), "R'"];
  const moves = [...repair, ...tPerm].map((move, index) => [move, index * 200]);
  const trace = Smart.cleanTrace({ clock: 'cube', moves }, scramble, moves.at(-1)[1]);
  assert.ok(trace);
  const { phases, states } = Smart.analyze(scramble, trace);
  assert.equal(states[sune.length + bottomPerm.length].slice(0, 9), 'UUUUUUUUU');
  assert.equal(phases[2].end, repair.length);
  assert.equal(phases[3].start, repair.length);
  assert.equal(phases[3].case.name, 'T-perm');
  assert.deepEqual(trace.moves.slice(phases[3].start).map(([move]) => move), tPerm);
});

test('splits each F2L pair even when insertions temporarily break the aligned cross', () => {
  const algorithm = `D2 R U R' B U B' L U L' F U F' ${Smart.DRILLS.Sune} ${Smart.DRILLS['T-perm']} U2`;
  const moves = algorithm.split(' ').map((move, i) => [move, i * 125]);
  const { phases, pairs } = Smart.analyze(Smart.drillSetup(algorithm), { moves });
  assert.equal(phases[0].turns, 2);
  assert.equal(phases[1].turns, 12);
  assert.equal(phases[1].duration, 1500);
  assert.deepEqual(pairs.map(({ start, end, duration, turns }) => [start, end, duration, turns]), [
    [1, 4, 375, 3], [4, 7, 375, 3], [7, 10, 375, 3], [10, 13, 375, 3],
  ]);
  assert.equal(phases[2].case.name, 'OLL 27 (Sune)');
  assert.equal(phases[3].case.name, 'T-perm');
});

test('includes the full case catalogs, recognizes uncommon cases and records skips', () => {
  for (const [type, total] of [['OLL', 57], ['PLL', 21]]) {
    const catalog = Smart.caseCatalog(type);
    assert.equal(catalog.length, total + 1);
    assert.equal(new Set(catalog.map(({ key }) => key)).size, total + 1);
    assert.equal(catalog.filter(({ skip }) => skip).length, 1);
  }
  const movesFor = (algorithm) => algorithm.split(' ').map((move, i) => [move, i * 125]);
  const oll = "R' F R U R U' R2 F' R2 U' R' U R U R'";
  assert.equal(Smart.analyze(Smart.drillSetup(oll), { moves: movesFor(oll) }).phases[2].case.name, 'OLL 55');
  const gPerm = "D' R U R' U' D R2 U' R U' R' U R' U R2 U";
  assert.equal(Smart.analyze(Smart.drillSetup(gPerm), { moves: movesFor(gPerm) }).phases[3].case.name, 'Gd-perm');
  const alignment = Smart.analyze('U2', { moves: movesFor('U2') });
  assert.equal(alignment.phases[2].case.name, 'OLL skip');
  assert.equal(alignment.phases[3].case.name, 'AUF only');
  assert.deepEqual(alignment.pairs.map(({ turns, duration }) => [turns, duration]), [[0, 0], [0, 0], [0, 0], [0, 0]]);
  const pllSkip = Smart.caseStats([alignment]).get('PLL:000000000000');
  assert.equal(pllSkip.averageTurns, 2);
  assert.equal(pllSkip.example, undefined);
});

test('all 78 recommendations produce the pictured drill setup and its named CFOP case', () => {
  for (const type of ['OLL', 'PLL']) {
    for (const entry of Smart.caseCatalog(type)) {
      if (entry.skip) {
        assert.equal(entry.algorithm, null, entry.name);
        assert.equal(entry.facelets, SmartCube.SOLVED, entry.name);
        continue;
      }
      const setup = Smart.drillSetup(entry.algorithm);
      assert.ok(setup, entry.name);
      const moves = entry.algorithm.split(' ').map((move, i) => [move, i * 100]);
      const trace = Smart.cleanTrace({ clock: 'cube', moves }, setup, moves.at(-1)[1]);
      assert.ok(trace, entry.name);
      const { states, phases } = Smart.analyze(setup, trace);
      const detected = phases.find(({ label }) => label === type);
      assert.equal(states[0], entry.facelets, entry.name);
      assert.equal(states.at(-1), SmartCube.SOLVED, entry.name);
      assert.equal(detected.start, 0, entry.name);
      assert.equal(detected.case?.key, entry.key, entry.name);
      if (type === 'PLL') assert.equal(phases[2].case?.skip, true, entry.name);
    }
  }
});

test('rejects trace data that cannot reproduce the solved state or time', () => {
  assert.equal(Smart.cleanTrace({ clock: 'browser', moves: [['U', 0]] }, 'R', 0), null);
  assert.equal(Smart.cleanTrace({ clock: 'browser', moves: [["R'", 3]] }, 'R', 3), null);
  assert.equal(Smart.cleanTrace({ clock: 'browser', moves: [["R'", 0]] }, 'R', 1), null);
  assert.equal(Smart.drillSetup("U U'"), null);
  assert.equal(Smart.drillSetup('r U'), null);
});

test('GAN pairing asks for a missing address after selection and remembers only a verified connection', async (t) => {
  const stored = new Map();
  const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key) => stored.get(key), setItem: (key, value) => stored.set(key, value) },
  });
  t.after(() => {
    if (storage) Object.defineProperty(globalThis, 'localStorage', storage);
    else delete globalThis.localStorage;
  });
  const manualDevice = { id: 'manual-gan', name: 'GAN manual' };
  const automaticDevice = { id: 'automatic-gan', name: 'GAN automatic' };
  const phases = [];
  const connect = (device, options, discovered = null) => SmartCube.connect({
    async connectGanCube(resolveAddress) {
      phases.push('picker');
      const mac = await resolveAddress(device, false) ?? discovered ?? await resolveAddress(device, true);
      phases.push(mac);
      return {
        deviceName: device.name, deviceMAC: mac,
        events$: { subscribe: () => ({ unsubscribe() {} }) },
        async sendCubeCommand() {},
        async disconnect() {},
      };
    },
  }, options);
  const requestAddress = async () => {
    phases.push('manual');
    return 'aa-bb-cc-dd-ee-ff';
  };
  const options = {
    requestAddress,
    onSelected: (device, remembered) => phases.push([device.id, remembered]),
  };

  assert.equal(SmartCube.normalizeAddress('8F18'), null);
  const cube = await connect(manualDevice, options);
  assert.deepEqual(phases, ['picker', ['manual-gan', false], 'manual', 'AA:BB:CC:DD:EE:FF']);
  assert.equal(stored.size, 0);
  cube.listen(() => {});
  cube.receive({ type: 'FACELETS', facelets: 'invalid', serial: 0 });
  assert.equal(stored.size, 0);
  cube.receive({ type: 'FACELETS', facelets: SmartCube.SOLVED, serial: 0 });
  assert.deepEqual([...stored.values()], ['AA:BB:CC:DD:EE:FF']);
  await cube.disconnect();

  phases.length = 0;
  const reconnected = await connect(manualDevice, options);
  assert.deepEqual(phases, ['picker', ['manual-gan', true], 'AA:BB:CC:DD:EE:FF']);
  await reconnected.disconnect();

  phases.length = 0;
  const automatic = await connect(automaticDevice, options, '10:20:30:40:50:60');
  assert.deepEqual(phases, ['picker', ['automatic-gan', false], '10:20:30:40:50:60']);
  await automatic.disconnect();

  phases.length = 0;
  const replacement = await connect(manualDevice, {
    ...options, manual: true, requestAddress: async () => '02:03:04:05:06:07',
  });
  assert.deepEqual(phases, ['picker', ['manual-gan', false], '02:03:04:05:06:07']);
  assert.deepEqual([...stored.values()], ['AA:BB:CC:DD:EE:FF']);
  await replacement.disconnect();
});

test('GAN battery packets, serial rollover, recovered turns and gaps follow the state stream', async () => {
  const commands = [];
  let receive;
  const connection = {
    deviceName: 'GAN test cube',
    events$: { subscribe: (handler) => { receive = handler; return { unsubscribe() {} }; } },
    sendCubeCommand: async (command) => { commands.push(command.type); },
    disconnect: async () => {},
  };
  const cube = new SmartCube(connection);
  const events = [];
  cube.listen((event) => events.push(event));
  receive({ type: 'FACELETS', facelets: SmartCube.SOLVED, serial: 255 });
  await cube.readDeviceInfo();
  receive({ type: 'BATTERY', batteryLevel: 76 });
  receive({ type: 'MOVE', move: 'R', serial: 0, localTimestamp: null, cubeTimestamp: 100 });
  assert.equal(cube.battery, 76);
  assert.equal(cube.facelets, state('R'));
  assert.equal(events.at(-1).cubeTime, 100);
  receive({ type: 'MOVE', move: 'F', serial: 0 });
  assert.equal(cube.facelets, state('R'));
  receive({ type: 'MOVE', move: 'F', serial: 2 });
  assert.equal(cube.facelets, null);
  assert.deepEqual(commands, ['REQUEST_FACELETS', 'REQUEST_BATTERY', 'REQUEST_HARDWARE', 'REQUEST_FACELETS']);
  await cube.disconnect();
});

test('reset waits for the cube to confirm solved facelets and resumes tracking at the new serial', async (t) => {
  const commands = [];
  const events = [];
  let finishReset;
  let confirmRead;
  const readRequested = new Promise((resolve) => { confirmRead = resolve; });
  const cube = new SmartCube({
    events$: { subscribe: () => ({ unsubscribe() {} }) },
    async sendCubeCommand({ type }) {
      commands.push(type);
      if (type === 'REQUEST_RESET') await new Promise((resolve) => { finishReset = resolve; });
      else if (commands.length > 1) confirmRead();
    },
    async disconnect() {},
  });
  t.after(() => cube.disconnect());
  cube.listen((event) => events.push(event.type));
  cube.receive({ type: 'FACELETS', facelets: state('F'), serial: 90 });

  assert.equal(cube.resetSolved(), true);
  assert.equal(cube.resetSolved(), false);
  assert.equal(events.at(-1), 'resetting');
  cube.receive({ type: 'FACELETS', facelets: SmartCube.SOLVED, serial: 89 });
  assert.equal(cube.facelets, null);
  finishReset();
  await readRequested;
  assert.deepEqual(commands, ['REQUEST_FACELETS', 'REQUEST_RESET', 'REQUEST_FACELETS']);
  cube.receive({ type: 'FACELETS', facelets: state('F'), serial: 90 });
  assert.equal(cube.facelets, null);

  cube.receive({ type: 'FACELETS', facelets: SmartCube.SOLVED, serial: 0 });
  assert.equal(events.at(-1), 'reset');
  assert.equal(cube.facelets, SmartCube.SOLVED);
  cube.receive({ type: 'MOVE', move: 'R', serial: 1, localTimestamp: 100 });
  assert.equal(events.at(-1), 'move');
  assert.equal(cube.facelets, state('R'));
});

test('a failed reset resyncs the cube without reporting a solved state', async (t) => {
  const commands = [];
  const events = [];
  let confirmRecovery;
  const recoveryRequested = new Promise((resolve) => { confirmRecovery = resolve; });
  const cube = new SmartCube({
    events$: { subscribe: () => ({ unsubscribe() {} }) },
    async sendCubeCommand({ type }) {
      commands.push(type);
      if (type === 'REQUEST_RESET') throw new Error('Bluetooth write failed');
      if (commands.length > 1) confirmRecovery();
    },
    async disconnect() {},
  });
  t.after(() => cube.disconnect());
  cube.listen((event) => events.push(event.type));
  cube.receive({ type: 'FACELETS', facelets: state('F'), serial: 12 });
  cube.resetSolved();
  await recoveryRequested;
  assert.deepEqual(events.slice(-2), ['reset-failed', 'syncing']);
  cube.receive({ type: 'FACELETS', facelets: state('F'), serial: 12 });
  assert.equal(events.at(-1), 'state');
  assert.equal(cube.facelets, state('F'));
  assert.equal(events.includes('reset'), false);
});

test('case summaries keep distinct patterns separate and aggregate timing', () => {
  const result = (key, duration, pause, label = 'PLL') => ({
    phases: [{ label, case: { key, name: key }, duration, pause, turns: 6, start: 3, end: 8 }],
  });
  const cases = Smart.caseStats([
    result('A', 1000, 200), result('A', 1400, 400),
    result('B', 1100, 100), result('A', 500, 100, 'OLL'),
  ]);
  assert.equal(cases.size, 3);
  const group = cases.get('PLL:A');
  assert.equal(group.count, 2);
  assert.equal(group.averageMs, 1200);
  assert.equal(group.averageTurns, 6);
  assert.equal(group.averagePauseMs, 300);
  assert.equal(group.averageExecutionMs, 900);
  assert.equal(group.best, 1000);
  assert.deepEqual(group.example, { index: 1, start: 3, end: 8 });
});
