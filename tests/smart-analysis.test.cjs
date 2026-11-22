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
  const samples = [
    { move: 'R', time: 100, cubeTime: 200 },
    { move: 'U', time: 650, cubeTime: 700 },
    { move: 'F', time: 1200, cubeTime: 1200 },
  ];
  const calibrated = Smart.finishTrace(samples, null);
  assert.equal(calibrated.clock, 'cube');
  assert.deepEqual(calibrated.moves.map(([, t]) => t), [0, 550, 1100]);
  samples[2].cubeTime = 20;
  assert.equal(Smart.finishTrace(samples, null).clock, 'browser');
  samples[2].time = null;
  assert.equal(Smart.finishTrace(samples, null), null);
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
    assert.equal(solve.phases[name === 'Sune' ? 2 : 3].case.name, name);
    assert.equal(solve.phases.reduce((sum, phase) => sum + phase.duration, 0), duration);
    assert.equal(solve.turns, algorithm.split(' ').reduce((sum, move) => sum + (move.endsWith('2') ? 2 : 1), 0));
  }
});

test('case recognition works across cross colors and ignores PLL alignment', () => {
  const rotatedSune = Smart.DRILLS.Sune.replace(/[UR]/g, (face) => ({ U: 'R', R: 'D' })[face]);
  const suneMoves = rotatedSune.split(' ').map((move, i) => [move, i * 200]);
  const rotated = Smart.analyze(Smart.drillSetup(rotatedSune), { moves: suneMoves });
  assert.equal(rotated.crossColor, 'Orange');
  assert.equal(rotated.phases[2].case.name, 'Sune');

  const algorithm = `U' ${Smart.DRILLS['T-perm']}`;
  const moves = algorithm.split(' ').map((move, i) => [move, i * 200]);
  const aligned = Smart.analyze(Smart.drillSetup(algorithm), { moves });
  assert.equal(aligned.phases[3].case.name, 'T-perm');
});

test('rejects trace data that cannot reproduce the solved state or time', () => {
  assert.equal(Smart.cleanTrace({ clock: 'browser', moves: [['U', 0]] }, 'R', 0), null);
  assert.equal(Smart.cleanTrace({ clock: 'browser', moves: [["R'", 3]] }, 'R', 3), null);
  assert.equal(Smart.cleanTrace({ clock: 'browser', moves: [["R'", 0]] }, 'R', 1), null);
  assert.equal(Smart.drillSetup("U U'"), null);
  assert.equal(Smart.drillSetup('r U'), null);
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

test('case summaries keep distinct patterns separate and aggregate timing', () => {
  const result = (key, duration, pause, label = 'PLL') => ({
    phases: [{ label, case: { key, name: key }, duration, pause, start: 3, end: 8 }],
  });
  const cases = Smart.caseStats([
    result('A', 1000, 200), result('A', 1400, 400),
    result('B', 1100, 100), result('A', 500, 100, 'OLL'),
  ]);
  assert.equal(cases.size, 3);
  const group = cases.get('PLL:A');
  assert.equal(group.count, 2);
  assert.equal(group.averageMs, 1200);
  assert.equal(group.averagePauseMs, 300);
  assert.equal(group.averageExecutionMs, 900);
  assert.equal(group.best, 1000);
  assert.deepEqual(group.example, { index: 1, start: 3, end: 8 });
});
