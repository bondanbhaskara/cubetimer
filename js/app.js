/*
 * Cube Timer - app wiring: storage, sessions, timer state machine, views.
 */
(function () {
  'use strict';

  const S = window.Stats;
  const { PUZZLES } = window.Scramble;
  const SmartCube = window.SmartCube;
  const Smart = window.SmartAnalysis;
  const AI = window.AICoach;

  const STORAGE_KEY = 'cubetimer.v1';
  const AVERAGES = [
    { key: 'mo3', n: 3, mean: true },
    { key: 'ao5', n: 5 },
    { key: 'ao12', n: 12 },
    { key: 'ao50', n: 50 },
    { key: 'ao100', n: 100 },
    { key: 'ao1000', n: 1000 },
  ];
  // Chart series: colour follows the entity (fixed categorical slot per average).
  const SERIES = [
    { key: 'ao5', label: 'ao5', color: 'var(--s1)' },
    { key: 'ao12', label: 'ao12', color: 'var(--s2)' },
    { key: 'ao100', label: 'ao100', color: 'var(--s3)' },
  ];
  const DEFAULT_SETTINGS = {
    input: 'timer',
    inspection: false,
    beeps: true,
    holdMs: 300,
    update: 'full',
    precision: 2,
    theme: 'auto',
    preview: true,
  };
  const STICKER = { U: '#ffffff', D: '#ffd500', F: '#009b48', B: '#0046ad', R: '#b71234', L: '#ff5800' };
  // Color schemes (tokens in css/themes.css), named after the macOS Terminal profiles.
  const SCHEMES = [
    ['basic', 'Basic'],
    ['pro', 'Pro'],
    ['homebrew', 'Homebrew'],
    ['ocean', 'Ocean'],
    ['grass', 'Grass'],
    ['red-sands', 'Red Sands'],
    ['man-page', 'Man Page'],
    ['novel', 'Novel'],
    ['silver-aerogel', 'Silver Aerogel'],
    ['speedstacks', 'SpeedStacks'],
    ['competition', 'Competition'],
  ];

  const $ = (sel) => document.querySelector(sel);

  /* ================= DOM helper ================= */

  function h(tag, props, ...children) {
    const e = document.createElement(tag);
    if (props) {
      for (const k in props) {
        const v = props[k];
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'style') Object.assign(e.style, v);
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      e.append(c.nodeType ? c : String(c));
    }
    return e;
  }

  const button = (label, onclick, cls = 'btn', extra = {}) =>
    h('button', Object.assign({ type: 'button', class: cls, onclick }, extra), label);

  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2600);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast('Copied to clipboard');
  }

  /* ================= Storage ================= */

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function newSession(name, puzzle) {
    return { id: uid(), name, puzzle, solves: [], created: Date.now() };
  }

  function freshDb() {
    const s = newSession('3x3', '333');
    return { sessions: [s], current: s.id, settings: Object.assign({}, DEFAULT_SETTINGS) };
  }

  function cleanSolve(x) {
    if (!x || typeof x.t !== 'number' || !isFinite(x.t) || x.t < 0) return null;
    const p = x.p === 1 || x.p === 2 ? x.p : 0;
    const out = { t: Math.round(x.t), p, s: String(x.s || ''), d: Number(x.d) || Date.now() };
    if (x.c) out.c = String(x.c);
    const trace = Smart.cleanTrace(x.smart, out.s, out.t);
    if (trace) out.smart = trace;
    return out;
  }

  function cleanDrill(drill, puzzle) {
    if (!['333', '333oh'].includes(puzzle) || typeof drill?.name !== 'string') return null;
    return Smart.drillSetup(drill.algorithm) ? { name: drill.name.slice(0, 60), algorithm: drill.algorithm } : null;
  }

  function normalize(d) {
    if (!d || !Array.isArray(d.sessions) || !d.sessions.length) return null;
    const sessions = d.sessions
      .filter((s) => s && Array.isArray(s.solves))
      .map((s) => ({
        id: String(s.id || uid()),
        name: String(s.name || 'Session'),
        puzzle: PUZZLES[s.puzzle] ? s.puzzle : '333',
        solves: s.solves.map(cleanSolve).filter(Boolean),
        created: Number(s.created) || Date.now(),
        drill: cleanDrill(s.drill, s.puzzle),
      }));
    if (!sessions.length) return null;
    const current = sessions.some((s) => s.id === d.current) ? d.current : sessions[0].id;
    const settings = Object.assign({}, DEFAULT_SETTINGS, d.settings || {});
    // Older versions stored "light"/"dark".
    settings.theme = { light: 'basic', dark: 'pro' }[settings.theme] || settings.theme;
    if (!SCHEMES.some(([id]) => id === settings.theme)) settings.theme = 'auto';
    return { sessions, current, settings };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return normalize(JSON.parse(raw)) || freshDb();
    } catch {
      /* storage unavailable or corrupt: start fresh */
    }
    return freshDb();
  }

  let db = load();
  const settings = () => db.settings;

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch {
      toast('Could not save — browser storage is full or blocked');
    }
  }

  const session = () => db.sessions.find((s) => s.id === db.current) || db.sessions[0];

  /* ================= Derived data ================= */

  let cache = null;
  function compute() {
    const times = session().solves.map(S.effective);
    const roll = {};
    for (const a of AVERAGES) roll[a.key] = S.rolling(times, a.n, a.mean);
    const pbs = new Set();
    let best = Infinity;
    times.forEach((t, i) => {
      if (t < best) {
        best = t;
        pbs.add(i);
      }
    });
    cache = { times, roll, pbs };
  }

  const fmt = (ms, isAvg) => S.formatTime(ms, { precision: settings().precision, round: !!isAvg });
  const fmtSolve = (solve) => S.formatSolve(solve, { precision: settings().precision });

  /* ================= Scrambles ================= */

  const scr = { list: [], idx: -1 };

  function resetScrambles() {
    scr.list = [];
    scr.idx = -1;
    newScramble();
  }

  function newScramble() {
    const drill = session().drill;
    if (drill && scr.idx >= 0) return renderScramble();
    scr.list.push(drill ? Smart.drillSetup(drill.algorithm) : window.Scramble.generate(session().puzzle));
    if (scr.list.length > 50) scr.list.shift();
    scr.idx = scr.list.length - 1;
    renderScramble();
  }

  const currentScramble = () => scr.list[scr.idx] || '';

  function renderScramble() {
    const el = $('#scramble');
    const text = currentScramble();
    el.textContent = text;
    el.classList.toggle('long', text.length > 110 && text.length <= 260);
    el.classList.toggle('xlong', text.length > 260);
    $('#prev-scramble').disabled = scr.idx <= 0;
    $('#next-scramble').disabled = !!session().drill;
    $('#edit-scramble').hidden = !!session().drill;
    renderPreview($('#preview'), session().puzzle, text);
    updateSmartTarget();
  }

  function renderPreview(container, puzzle, scramble) {
    const p = PUZZLES[puzzle];
    if (!p || !p.cube || !settings().preview) {
      container.replaceChildren();
      container.hidden = true;
      return;
    }
    container.hidden = false;
    renderCubeNet(container, p.cube, window.Scramble.cubeNet(p.cube, scramble), 'Scramble state. White top, green front.');
  }

  function renderCubeNet(container, n, stickers, label) {
    const cell = 10;
    const gap = 3;
    const F = n * cell;
    const W = 4 * F + 3 * gap;
    const H = 3 * F + 2 * gap;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
    for (const f of stickers) {
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', f.fx * (F + gap) + f.col * cell + 0.4);
      r.setAttribute('y', f.fy * (F + gap) + f.row * cell + 0.4);
      r.setAttribute('width', cell - 0.8);
      r.setAttribute('height', cell - 0.8);
      r.setAttribute('rx', 1.6);
      r.setAttribute('fill', STICKER[f.color]);
      r.setAttribute('class', 'facelet');
      svg.appendChild(r);
    }
    container.replaceChildren(svg);
  }

  function renderFacelets(container, facelets, label) {
    const model = window.Scramble.cubeFromFacelets(facelets);
    renderCubeNet(container, 3, window.Scramble.modelNet(model), label);
  }

  /* ================= Solves ================= */

  function addSolve(solve) {
    const s = session();
    const prevBest = S.bestIndex(cache.times) >= 0 ? cache.times[S.bestIndex(cache.times)] : Infinity;
    const prevBestAo = {};
    for (const k of ['ao5', 'ao12']) {
      const i = S.bestIndex(cache.roll[k]);
      prevBestAo[k] = i >= 0 ? cache.roll[k][i] : Infinity;
    }
    s.solves.push(solve);
    save();
    compute();
    const last = s.solves.length - 1;
    const t = cache.times[last];
    if (last > 0 && t < prevBest) toast(`New best single: ${fmt(t)}`);
    else {
      for (const k of ['ao12', 'ao5']) {
        const v = cache.roll[k][last];
        if (v != null && v < prevBestAo[k] && isFinite(prevBestAo[k])) {
          toast(`New best ${k}: ${fmt(v, true)}`);
          break;
        }
      }
    }
    renderAll();
  }

  function setPenalty(i, p) {
    const s = session();
    if (!s.solves[i]) return;
    s.solves[i].p = p;
    save();
    compute();
    renderAll();
    if (i === s.solves.length - 1 && T.state === 'idle') showLastTime();
  }

  function deleteSolve(i, skipConfirm) {
    const s = session();
    if (!s.solves[i]) return false;
    if (!skipConfirm && !confirm(`Delete solve #${i + 1} (${fmtSolve(s.solves[i])})?`)) return false;
    s.solves.splice(i, 1);
    save();
    compute();
    renderAll();
    if (T.state === 'idle') showLastTime();
    return true;
  }

  /* ================= Timer ================= */

  const T = { state: 'idle', start: 0, raf: 0, hold: 0, inspStart: 0, penalty: 0, beeped: {} };
  const timerEl = $('#timer');

  const setTimerClass = (c) => (timerEl.className = 'timer' + (c ? ' ' + c : ''));

  // Pure times get faint "8"s behind each digit (unlit LCD segments); words
  // like DNF / +2 / "solving" don't, since their glyph widths differ.
  // The LCD font has no "+", so a +2 marker is drawn as a small raised sign.
  function setTimerText(text) {
    const m = /^([\d:.]+)(\+?)$/.exec(text);
    if (m && m[2]) timerEl.replaceChildren(m[1], h('span', { class: 'timer-pen' }, '+'));
    else timerEl.textContent = text;
    timerEl.dataset.ghost = m ? m[1].replace(/\d/g, '8') : '';
    // Fixed-width displays (Competition) always show every segment position.
    timerEl.dataset.ghostFull = settings().precision === 3 ? '8:88.888' : '8:88.88';
  }
  const setSolving = (on) => document.body.classList.toggle('solving', on);
  const inspecting = () => T.inspStart > 0;
  const coarse = window.matchMedia('(pointer: coarse)').matches;

  function hint(text) {
    const el = $('#timer-hint');
    const value = text == null ? idleHint() : text;
    if (el.textContent !== value) el.textContent = value;
  }

  function idleHint() {
    if (settings().input === 'typing') return '';
    if (smartTiming()) return smartHint();
    const act = coarse ? 'Touch and hold the timer' : 'Hold Space';
    return settings().inspection ? `${coarse ? 'Tap the timer' : 'Press Space'} to start inspection` : `${act}, release to start`;
  }

  function showLastTime() {
    const s = session();
    const last = s.solves[s.solves.length - 1];
    setTimerText(last ? fmtSolve(last) : fmt(0));
    setTimerClass('');
    renderLastActions();
  }

  function press() {
    if (T.state === 'running') return stop(true);
    // Unlock audio during the key/touch gesture so auto-play can start on release.
    if (metroSettings().auto) metro.prime();
    // A fresh press while "stopped" means we missed the release (focus loss).
    if (T.state === 'stopped') T.state = 'idle';
    if (T.state === 'idle') {
      if (settings().inspection) {
        T.state = 'pre-inspect';
        return;
      }
      return arm();
    }
    if (T.state === 'inspecting') arm();
  }

  function release() {
    switch (T.state) {
      case 'pre-inspect':
        beginInspection();
        break;
      case 'armed':
        clearTimeout(T.hold);
        if (inspecting()) {
          T.state = 'inspecting';
          hint('Inspecting — hold to start the solve');
        } else {
          T.state = 'idle';
          setTimerClass('');
          showLastTime();
          hint();
        }
        break;
      case 'ready':
        startSolve();
        break;
      case 'stopped':
        T.state = 'idle';
        renderLastActions();
        break;
    }
  }

  // Abandon a hold without starting (focus lost, touch cancelled).
  function abortHold() {
    if (T.state !== 'armed' && T.state !== 'ready' && T.state !== 'pre-inspect') return;
    clearTimeout(T.hold);
    if (inspecting()) {
      T.state = 'inspecting';
    } else {
      T.state = 'idle';
      setSolving(false);
      showLastTime();
      hint();
    }
  }

  function arm() {
    T.state = 'armed';
    setTimerClass('holding');
    if (!inspecting()) setTimerText(fmt(0));
    $('#last-actions').hidden = true;
    hint('Keep holding…');
    const ready = () => {
      if (T.state !== 'armed') return;
      T.state = 'ready';
      setTimerClass('ready');
      setSolving(true);
      hint('Release to start');
    };
    if (settings().holdMs > 0) T.hold = setTimeout(ready, settings().holdMs);
    else ready();
  }

  function beginInspection() {
    T.state = 'inspecting';
    T.inspStart = performance.now();
    T.beeped = {};
    setSolving(true);
    $('#last-actions').hidden = true;
    hint(smartTiming() ? 'Inspecting — turn the cube to start' : 'Inspecting — hold to start the solve');
    inspectionLoop();
  }

  function inspectionLoop() {
    if (!inspecting()) return;
    const el = (performance.now() - T.inspStart) / 1000;
    if (el >= 17) return inspectionDNF();
    setTimerText(el < 15 ? String(Math.ceil(15 - el)) : '+2');
    if (T.state === 'inspecting') setTimerClass(el >= 15 ? 'inspect-late' : el >= 8 ? 'inspect-warn' : 'inspect');
    if (settings().beeps) {
      if (el >= 8 && !T.beeped[8]) {
        T.beeped[8] = true;
        beep(1);
      }
      if (el >= 12 && !T.beeped[12]) {
        T.beeped[12] = true;
        beep(2);
      }
    }
    T.raf = requestAnimationFrame(inspectionLoop);
  }

  function inspectionDNF() {
    cancelAnimationFrame(T.raf);
    clearTimeout(T.hold);
    const held = T.state === 'armed' || T.state === 'ready';
    T.inspStart = 0;
    T.state = held ? 'stopped' : 'idle';
    setSolving(false);
    addSolve({ t: 0, p: S.PEN_DNF, s: currentScramble(), d: Date.now() });
    newScramble();
    showLastTime();
    hint('Inspection exceeded 17 s — DNF');
  }

  function startSolve(start = performance.now()) {
    let pen = S.PEN_OK;
    if (inspecting()) {
      const elapsed = start - T.inspStart;
      if (elapsed >= 17000) return inspectionDNF();
      if (elapsed >= 15000) pen = S.PEN_PLUS2;
      cancelAnimationFrame(T.raf);
      T.inspStart = 0;
    }
    T.penalty = pen;
    T.state = 'running';
    T.start = start;
    setTimerClass('');
    setSolving(true);
    hint('');
    if (metroSettings().auto && !metro.playing) {
      metro.start();
      metroAuto = true;
      renderMetronome();
    }
    runLoop();
  }

  function runLoop() {
    if (T.state !== 'running') return;
    const ms = performance.now() - T.start;
    const mode = settings().update;
    setTimerText(mode === 'full' ? fmt(ms) : mode === 'seconds' ? String(Math.floor(ms / 1000)) : 'solving');
    T.raf = requestAnimationFrame(runLoop);
  }

  // awaitRelease: the stopping key/touch is still down; ignore its release.
  function stop(awaitRelease, end = performance.now(), trace = null) {
    const ms = Math.max(0, end - T.start);
    cancelAnimationFrame(T.raf);
    T.state = awaitRelease ? 'stopped' : 'idle';
    setSolving(false);
    stopAutoMetronome();
    const solve = { t: Math.round(ms), p: T.penalty, s: currentScramble(), d: Date.now() };
    if (trace) solve.smart = trace;
    smart.recording = null;
    addSolve(solve);
    newScramble();
    showLastTime();
    hint();
  }

  function cancelTimer() {
    cancelAnimationFrame(T.raf);
    clearTimeout(T.hold);
    T.inspStart = 0;
    T.state = 'idle';
    smart.recording = null;
    setSolving(false);
    stopAutoMetronome();
    showLastTime();
    renderLiveCube();
    hint();
  }

  /* ================= Smart cube ================= */

  const smart = { cube: null, attempt: null, closing: false, guide: null, undo: [], recording: null, inspected: null };
  const smartEligible = () => settings().input === 'timer' && ['333', '333oh'].includes(session().puzzle);
  const smartTiming = () => smart.cube && smartEligible();

  function smartHint() {
    const { facelets, resetRequest } = smart.cube;
    if (resetRequest) return 'Resetting the cube state…';
    if (!facelets) return 'Reading the cube state…';
    if (!smart.guide) return 'Use a scramble with U, R, F, D, L and B face turns.';
    if (facelets === smart.guide.target) return settings().inspection
      ? 'Match the scramble again to restart inspection'
      : 'Scramble matched. Turn the cube to start';
    if (smart.guide.prefixes.has(facelets)) return 'Follow the scramble with white on top and green in front';
    return smart.undo.length ? 'Undo the extra turns to return to the scramble' : 'Solve the cube to restart scramble guidance';
  }

  function renderSmartCube() {
    const btn = $('#smart-cube-btn');
    btn.hidden = !smart.cube && !smartEligible();
    btn.disabled = !!smart.attempt || smart.closing;
    btn.textContent = smart.cube ? 'Disconnect cube' : 'Connect smart cube';
    $('#smart-cube-status').hidden = !smart.cube;
    const name = $('#smart-cube-name');
    const label = smart.cube?.name || '';
    if (name.textContent !== label) name.textContent = label;
    const battery = smart.cube?.battery;
    $('#smart-cube-battery').textContent = battery == null ? '' : `Battery ${battery}%`;
    if ($('#cube-device-info')) renderCubeInfo($('#cube-device-info'));
    const setSolved = $('#cube-set-solved-btn');
    if (setSolved) setSolved.disabled = !smart.cube?.facelets;
    $('#smart-drills-btn').hidden = !smartEligible();
    const drill = session().drill;
    $('#end-drill-btn').hidden = !drill;
    const algorithm = $('#drill-algorithm');
    algorithm.hidden = !drill;
    if (drill) algorithm.textContent = `${drill.name} · ${drill.algorithm}`;
    if (!smart.cube) $('#smart-cube-move').textContent = '';
  }

  function updateSmartTarget() {
    smart.guide = smartTiming() ? Smart.scrambleGuide(currentScramble()) : null;
    smart.undo = [];
    updateSmartReadiness();
  }

  function renderLiveCube() {
    const cube = smart.cube;
    const live = $('#live-cube');
    live.hidden = !smartTiming() || !cube.facelets;
    if (!live.hidden) renderCubeNet($('#live-cube-net'), 3, window.Scramble.modelNet(cube.model), 'Current cube state');
    const guide = $('#scramble-guide');
    guide.hidden = live.hidden || !smart.guide || T.state !== 'idle';
    if (guide.hidden) return;
    const step = smart.guide.prefixes.get(cube.facelets);
    const undo = smart.undo.at(-1);
    guide.textContent = step
      ? step.next ? `${step.index} / ${smart.guide.count} · Next ${step.next}` : 'Scramble matched'
      : undo ? `Undo ${undo}` : 'Off scramble';
  }

  function updateSmartReadiness() {
    renderLiveCube();
    const targetMatched = smart.guide && smart.cube.facelets === smart.guide.target;
    if (!targetMatched) smart.inspected = null;
    if (T.state !== 'idle') return;
    if (targetMatched && smart.inspected !== smart.guide.target && settings().inspection && timerActive()) {
      smart.inspected = smart.guide.target;
      beginInspection();
      $('#scramble-guide').hidden = true;
    } else {
      hint();
    }
  }

  async function disconnectSmartCube(alreadyDisconnected = false) {
    const cube = smart.cube;
    const timing = smartTiming();
    smart.cube = null;
    smart.guide = null;
    if (timing && T.state !== 'idle') cancelTimer();
    if (cube) smart.closing = true;
    renderSmartCube();
    updateSmartReadiness();
    if (cube) {
      await cube.disconnect(alreadyDisconnected).catch(() => {});
      smart.closing = false;
      renderSmartCube();
    }
  }

  function finishCubeAttempt(attempt, message) {
    if (smart.attempt !== attempt) return;
    smart.attempt = null;
    attempt.status.textContent = message || '';
    attempt.connect.disabled = false;
    attempt.actions.hidden = false;
    attempt.retry.hidden = !message || !attempt.selected;
    renderSmartCube();
  }

  function cancelCubeAttempt() {
    const attempt = smart.attempt;
    if (!attempt) return;
    attempt.controller.abort();
    if (smart.cube) disconnectSmartCube().then(() => finishCubeAttempt(attempt));
  }

  function handleCubeEvent(event) {
    const attempt = smart.attempt;
    if (event.type === 'error' || event.type === 'disconnect') {
      const message = event.message || 'Cube disconnected. Reconnect to use Bluetooth timing.';
      const disconnected = disconnectSmartCube(event.type === 'disconnect');
      if (attempt) disconnected.then(() => finishCubeAttempt(attempt, message));
      else toast(message);
      return;
    }

    if (event.type === 'device') {
      renderSmartCube();
      return;
    }

    if (event.type === 'reset-failed') {
      toast(event.message);
      return;
    }

    if (['state', 'syncing', 'resetting', 'reset'].includes(event.type)) {
      if (smartTiming() && T.state !== 'idle') {
        cancelTimer();
        toast('Timing canceled because the cube state changed unexpectedly');
      }
      if (event.type === 'state' && attempt) {
        if (!attempt.status.isConnected || !modal.open || attempt.controller.signal.aborted) {
          disconnectSmartCube().then(() => finishCubeAttempt(attempt));
          return;
        }
        finishCubeAttempt(attempt);
        modal.close();
        smart.cube.readDeviceInfo();
      } else {
        renderSmartCube();
      }
      if (event.type !== 'state') {
        $('#smart-cube-move').textContent = event.type === 'resetting' ? 'Resetting the cube state…' : '';
      }
      updateSmartTarget();
      if (event.type === 'reset') toast('Cube set as solved.');
      return;
    }

    $('#smart-cube-move').textContent = `Last turn ${event.move}`;
    if (!smart.guide) return renderLiveCube();
    const { facelets } = smart.cube;
    if (smart.guide.prefixes.has(facelets)) smart.undo = [];
    else if (T.state !== 'running') {
      if (smart.undo.at(-1) === event.move) smart.undo.pop();
      else if (smart.undo.length || smart.guide.prefixes.has(event.previous)) smart.undo.push(Smart.inverse(event.move));
    }
    if (!timerActive()) return renderLiveCube();
    if (event.previous === smart.guide.target && (inspecting() || (T.state === 'idle' && !settings().inspection))) {
      if (!Number.isFinite(event.time)) {
        cancelTimer();
        renderLiveCube();
        toast('The starting turn arrived late. Match the scramble again to retry.');
        return;
      }
      const inspection = inspecting() ? Math.max(0, Math.floor(event.time - T.inspStart)) : null;
      startSolve(event.time);
      if (T.state === 'running') smart.recording = { events: [], inspection };
    }
    if (smart.recording) {
      const { events, inspection } = smart.recording;
      events.push(event);
      if (events.length > Smart.MAX_TURNS) {
        cancelTimer();
        toast('The solve exceeded the turn limit and was canceled.');
      } else if (facelets === SmartCube.SOLVED) {
        const trace = Smart.finishTrace(events, inspection);
        if (trace) stop(false, T.start + trace.moves.at(-1)[1], trace);
        else {
          cancelTimer();
          toast('The final turn had no timestamp. The solve was canceled.');
        }
        return renderLiveCube();
      }
    }
    updateSmartReadiness();
  }

  let audio = null;
  function beep(times) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      for (let k = 0; k < times; k++) {
        const o = audio.createOscillator();
        const g = audio.createGain();
        const t0 = audio.currentTime + k * 0.16;
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
        o.connect(g).connect(audio.destination);
        o.start(t0);
        o.stop(t0 + 0.13);
      }
    } catch {
      /* audio unavailable */
    }
  }

  /* ================= Metronome ================= */

  const METRO_DEFAULTS = { bpm: 100, beats: 4, sound: 'click', volume: 70, auto: false, open: false };
  const metro = new window.Metronome();
  let metroAuto = false; // started by the current solve (auto-play mode)
  const taps = [];

  function metroSettings() {
    const st = settings();
    if (!st.metronome || typeof st.metronome !== 'object') st.metronome = {};
    for (const k in METRO_DEFAULTS) if (!(k in st.metronome)) st.metronome[k] = METRO_DEFAULTS[k];
    return st.metronome;
  }

  function applyMetroSettings() {
    const m = metroSettings();
    metro.setBpm(m.bpm);
    m.bpm = metro.bpm;
    metro.beats = +m.beats || 1;
    metro.sound = m.sound;
    metro.setVolume(m.volume / 100);
  }

  function renderMetronome() {
    const m = metroSettings();
    $('#metronome').hidden = !m.open;
    const btn = $('#metro-btn');
    btn.setAttribute('aria-pressed', String(!!m.open));
    btn.setAttribute('aria-label', m.open ? 'Hide metronome' : 'Show metronome');
    btn.classList.toggle('playing', metro.playing);
    const play = $('#metro-play');
    play.setAttribute('aria-pressed', String(metro.playing));
    play.setAttribute('aria-label', metro.playing ? 'Stop metronome' : 'Start metronome');
    const input = $('#metro-bpm-input');
    if (document.activeElement !== input) input.value = m.bpm;
    $('#metro-bpm-range').value = m.bpm;
    $('#metro-rate').textContent = `${(m.bpm / 60).toFixed(2)} beats/s`;
    $('#metro-beats').value = String(m.beats);
    $('#metro-sound').value = m.sound;
    $('#metro-volume').value = m.volume;
    $('#metro-auto').checked = !!m.auto;
    const dots = $('#metro-dots');
    const n = Math.max(1, +m.beats || 1);
    if (dots.children.length !== n) {
      dots.replaceChildren(...Array.from({ length: n }, (_, i) => h('span', { class: 'metro-dot' + (i === 0 && n > 1 ? ' accent' : '') })));
    }
  }

  metro.onBeat = (pos) => {
    [...$('#metro-dots').children].forEach((d, i) => d.classList.toggle('on', i === pos));
    if (pos < 0) return;
    const b = $('#metro-btn');
    b.classList.add('tick');
    setTimeout(() => b.classList.remove('tick'), 90);
  };

  function setMetroBpm(v) {
    const m = metroSettings();
    metro.setBpm(v);
    m.bpm = metro.bpm;
    save();
    renderMetronome();
  }

  function toggleMetronome() {
    metro.toggle();
    metroAuto = false;
    renderMetronome();
  }

  function stopAutoMetronome() {
    if (!metroAuto) return;
    metroAuto = false;
    metro.stop();
    renderMetronome();
  }

  function showMetronome(open) {
    metroSettings().open = open;
    save();
    if (open && currentView !== 'timer') setView('timer');
    renderMetronome();
  }

  // Tempo from the average interval of the last few taps.
  function tapTempo() {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now);
    if (taps.length > 6) taps.shift();
    if (taps.length >= 2) setMetroBpm((60000 * (taps.length - 1)) / (now - taps[0]));
  }

  /* ---------- Input: keyboard, touch, typing ---------- */

  const isTyping = (el) =>
    !!el &&
    (el.isContentEditable ||
      el.tagName === 'TEXTAREA' ||
      el.tagName === 'SELECT' ||
      (el.tagName === 'INPUT' && !/^(range|checkbox|radio|button)$/.test(el.type)));
  const timerActive = () => currentView === 'timer' && !$('#modal').open;

  document.addEventListener('keydown', (e) => {
    if (
      e.code === 'KeyM' &&
      !e.altKey && !e.ctrlKey && !e.metaKey && !e.repeat &&
      T.state === 'idle' && !isTyping(e.target) && !$('#modal').open
    ) {
      e.preventDefault();
      toggleMetronome();
      return;
    }
    if (!timerActive()) return;
    if (T.state === 'running') {
      e.preventDefault();
      if (e.code === 'Escape') cancelTimer();
      else if (!e.repeat && !smartTiming()) stop(e.code === 'Space');
      return;
    }
    if (isTyping(e.target)) return;
    if (e.code === 'Escape') {
      if (T.state !== 'idle') cancelTimer();
      return;
    }
    if (e.altKey && T.state === 'idle') {
      const last = session().solves.length - 1;
      if (last < 0) return;
      const map = { Digit1: S.PEN_OK, Digit2: S.PEN_PLUS2, Digit3: S.PEN_DNF };
      if (e.code in map) {
        e.preventDefault();
        setPenalty(last, map[e.code]);
      } else if (e.code === 'KeyZ') {
        e.preventDefault();
        deleteSolve(last);
      }
      return;
    }
    if (e.code === 'Space') {
      if (e.target.closest?.('button') && T.state === 'idle') return;
      e.preventDefault();
      if (e.repeat || settings().input === 'typing' || smartTiming()) return;
      press();
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.code !== 'Space' || isTyping(e.target)) return;
    if (e.target.closest?.('button') && T.state === 'idle') return;
    if (!timerActive() && T.state === 'idle') return;
    e.preventDefault();
    release();
  });

  // Losing focus while holding would leave the timer stuck in "ready".
  window.addEventListener('blur', abortHold);

  // Touch: hold the timer area to start; while running, a touch anywhere stops.
  const touchIgnored = (t) => t.closest('button, input, textarea, select, a');
  $('#timer-area').addEventListener(
    'touchstart',
    (e) => {
      if (settings().input === 'typing' || !timerActive() || T.state === 'running' || smartTiming()) return;
      if (touchIgnored(e.target)) return;
      e.preventDefault();
      press();
    },
    { passive: false }
  );
  document.addEventListener(
    'touchstart',
    (e) => {
      if (T.state !== 'running' || smartTiming()) return;
      e.preventDefault();
      stop(true);
    },
    { passive: false }
  );
  document.addEventListener('touchend', (e) => {
    if (!['pre-inspect', 'armed', 'ready', 'stopped'].includes(T.state)) return;
    e.preventDefault();
    release();
  });
  document.addEventListener('touchcancel', abortHold);
  // Mouse users can stop the running timer by clicking anywhere.
  document.addEventListener('mousedown', () => {
    if (T.state === 'running' && !smartTiming()) stop(false);
  });

  $('#type-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#time-input');
    const parsed = S.parseTime(input.value);
    if (!parsed) {
      toast('Could not read that time — try 12.34, 1:02.34 or DNF');
      return;
    }
    addSolve({ t: parsed.t, p: parsed.p, s: currentScramble(), d: Date.now() });
    newScramble();
    input.value = '';
  });

  /* ================= Timer view rendering ================= */

  let solvesLimit = 150;

  function renderAll() {
    renderSelectors();
    renderStatsTable();
    renderSolves();
    renderQuickAvgs();
    renderLastActions();
    if (currentView === 'history') renderHistory();
  }

  function renderSelectors() {
    const ps = $('#puzzle-select');
    if (!ps.options.length) {
      for (const [k, p] of Object.entries(PUZZLES)) ps.append(h('option', { value: k }, p.name));
    }
    ps.value = session().puzzle;
    const ss = $('#session-select');
    ss.replaceChildren(
      ...db.sessions.map((s) => h('option', { value: s.id }, `${s.name} (${s.solves.length})`))
    );
    ss.value = session().id;
  }

  function renderStatsTable() {
    const tbody = $('#stats-table tbody');
    const n = cache.times.length;
    const rows = [];
    const cell = (v, key, end) => {
      const td = h('td', { text: v == null ? '–' : fmt(v, key !== 'single') });
      if (v != null && end != null) {
        td.className = 'clickable';
        td.title = 'Show details';
        td.addEventListener('click', () => (key === 'single' ? openSolve(end) : openAverage(key, end)));
      }
      return td;
    };
    const bestSingle = S.bestIndex(cache.times);
    rows.push(
      h('tr', null, h('td', null, 'single'), cell(n ? cache.times[n - 1] : null, 'single', n - 1), cell(bestSingle >= 0 ? cache.times[bestSingle] : null, 'single', bestSingle))
    );
    for (const a of AVERAGES) {
      if (a.n > 100 && n < a.n) continue;
      const arr = cache.roll[a.key];
      const cur = n ? arr[n - 1] : null;
      const bi = S.bestIndex(arr);
      rows.push(h('tr', null, h('td', null, a.key), cell(cur, a.key, n - 1), cell(bi >= 0 ? arr[bi] : null, a.key, bi)));
    }
    tbody.replaceChildren(...rows);
    const fin = S.finite(cache.times);
    $('#session-mean').textContent = fin.length ? `mean ${fmt(S.mean(fin), true)} · ${fin.length}/${n}` : '';
  }

  function renderSolves() {
    const solves = session().solves;
    const n = solves.length;
    $('#solve-count').textContent = n ? `(${n})` : '';
    $('#no-solves').hidden = n > 0;
    $('#solves-table').hidden = n === 0;
    const rows = [];
    const lo = Math.max(0, n - solvesLimit);
    for (let i = n - 1; i >= lo; i--) {
      const sv = solves[i];
      const tr = h(
        'tr',
        { onclick: () => openSolve(i), title: sv.c ? sv.c : null },
        h('td', null, String(i + 1) + (sv.c ? ' •' : '')),
        h('td', { class: 'time' + (cache.pbs.has(i) && n > 1 ? ' pb' : '') }, fmtSolve(sv)),
        h('td', null, cache.roll.ao5[i] == null ? '–' : fmt(cache.roll.ao5[i], true)),
        h('td', null, cache.roll.ao12[i] == null ? '–' : fmt(cache.roll.ao12[i], true))
      );
      rows.push(tr);
    }
    $('#solves-table tbody').replaceChildren(...rows);
    $('#more-solves').hidden = lo === 0;
  }

  function renderQuickAvgs() {
    const n = cache.times.length;
    const q = $('#quick-avgs');
    q.replaceChildren();
    for (const k of ['ao5', 'ao12']) {
      const v = n ? cache.roll[k][n - 1] : null;
      q.append(h('span', null, `${k}: `, h('b', null, v == null ? '–' : fmt(v, true))));
    }
  }

  function renderLastActions() {
    const solves = session().solves;
    const box = $('#last-actions');
    const last = solves[solves.length - 1];
    box.hidden = !last || (T.state !== 'idle' && T.state !== 'stopped');
    if (!last) return;
    box.querySelectorAll('[data-pen]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.pen === last.p)));
    $('#last-comment').setAttribute('aria-pressed', String(!!last.c));
  }

  function applyInputMode() {
    const typing = settings().input === 'typing';
    $('#type-form').hidden = !typing;
    timerEl.hidden = typing;
    renderSmartCube();
    updateSmartTarget();
  }

  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

  // "auto" follows the OS: Basic in light mode, Pro in dark mode.
  function resolvedScheme() {
    const t = settings().theme;
    return t === 'auto' ? (darkQuery.matches ? 'pro' : 'basic') : t;
  }

  function applyTheme() {
    document.documentElement.dataset.theme = resolvedScheme();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--page').trim();
  }

  darkQuery.addEventListener('change', () => {
    if (settings().theme === 'auto') applyTheme();
  });

  function setScheme(id) {
    settings().theme = id;
    save();
    applyTheme();
  }

  // "CUBETIMER" badge under the digits of the Competition display (hidden in
  // other schemes via --display-logo).
  function displayLogo() {
    const NS = 'http://www.w3.org/2000/svg';
    const el = (tag, attrs, text) => {
      const e = document.createElementNS(NS, tag);
      for (const k in attrs) e.setAttribute(k, attrs[k]);
      if (text) e.textContent = text;
      return e;
    };
    const svg = el('svg', { class: 'display-logo', viewBox: '0 0 300 44', 'aria-hidden': 'true' });
    for (const [y, len] of [[8, 34], [15, 27], [22, 20]]) {
      svg.append(el('path', { class: 'logo-speed', d: `M${44 - len},${y} h${len} l-2.5,4.5 h${-len} z` }));
    }
    svg.append(el('text', { class: 'logo-text', x: 48, y: 30, textLength: 236, lengthAdjust: 'spacingAndGlyphs' }, 'CUBETIMER'));
    svg.append(el('path', { class: 'logo-swoosh', d: 'M47,35.5 L292,35.5 L289,39 L45,39 Z' }));
    return svg;
  }

  function openSchemes() {
    openModal('Color scheme', (body) => {
      const auto = h('input', { type: 'checkbox', id: 'scheme-auto' });
      const grid = h('div', { class: 'scheme-grid', role: 'group', 'aria-label': 'Color schemes' });
      const sync = () => {
        auto.checked = settings().theme === 'auto';
        grid.querySelectorAll('.scheme-card').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.theme === resolvedScheme())));
      };
      auto.addEventListener('change', () => {
        setScheme(auto.checked ? 'auto' : resolvedScheme());
        sync();
      });
      // Each card carries its own data-theme, so its preview renders in that scheme.
      for (const [id, name] of SCHEMES) {
        const keys = ['--s1', '--s2', '--s3'].map((v) => {
          const k = h('span');
          k.style.background = `var(${v})`;
          return k;
        });
        grid.append(
          button(
            [
              h(
                'span',
                { class: 'scheme-window', 'aria-hidden': 'true' },
                h('span', { class: 'timer-display' }, h('span', { class: 'timer', 'data-ghost': '88.88', 'data-ghost-full': '8:88.88' }, '12.34'), displayLogo()),
                h('span', { class: 'scheme-keys' }, h('span', { class: 'dot' }), ...keys)
              ),
              h('span', { class: 'scheme-name' }, name, h('span', { class: 'check', 'aria-hidden': 'true' }, '✓')),
            ],
            () => {
              setScheme(id);
              sync();
            },
            'scheme-card',
            { 'data-theme': id }
          )
        );
      }
      body.append(h('label', { class: 'scheme-auto', for: 'scheme-auto' }, auto, 'Match system light/dark (Basic / Pro)'), grid);
      sync();
    });
  }

  /* ================= Modals ================= */

  const modal = $('#modal');
  let coachRequest = null;

  function openModal(title, build) {
    coachRequest?.abort();
    cancelCubeAttempt();
    if (smartTiming() && T.state !== 'idle') cancelTimer();
    $('#modal-title').textContent = title;
    const body = $('#modal-body');
    body.replaceChildren();
    build(body);
    if (!modal.open) modal.showModal();
  }

  modal.addEventListener('close', () => {
    if (!modal.open) {
      coachRequest?.abort();
      cancelCubeAttempt();
    }
    const providerToken = $('#coach-provider-token');
    if (providerToken) providerToken.value = '';
    window.Charts.hideTip();
    if (currentView === 'timer') document.activeElement && document.activeElement.blur();
    if (smartTiming()) updateSmartReadiness();
  });

  function openSmartCube() {
    openModal('Connect a smart cube', (body) => {
      if (!window.isSecureContext || !navigator.bluetooth?.requestDevice) {
        body.append(h('p', { class: 'muted small' }, 'Use Chrome or Edge with Web Bluetooth enabled. Open Cube Timer over HTTPS or at localhost.'));
        return;
      }

      const status = h('p', { class: 'muted small', role: 'status' }, 'Loading Bluetooth support…');
      let driver;
      const connect = button('Choose cube', () => startPairing(false), 'btn primary', { disabled: true });
      const retry = button('Use a different address', () => startPairing(true), 'btn', { hidden: true });
      const actions = h('div', { class: 'row end' }, retry, connect);

      function askForAddress(signal, manual) {
        signal.throwIfAborted();
        status.textContent = manual ? 'Enter a Bluetooth address for the selected cube.'
          : 'The browser could not read the cube’s Bluetooth address. Enter it to continue.';
        actions.hidden = true;
        const address = h('input', {
          type: 'text', id: 'cube-address', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off',
          placeholder: 'AA:BB:CC:DD:EE:FF', required: true,
        });
        const form = h('form', null,
          h('label', { class: 'field', for: address.id }, 'Bluetooth address', address),
          h('p', { class: 'small' }, h('a', {
            href: 'https://gist.github.com/afedotov/52057533a8b27a0277598160c384ae71',
            target: '_blank', rel: 'noopener noreferrer',
          }, 'Find your GAN cube’s Bluetooth address')),
          h('div', { class: 'row end' }, h('button', { type: 'submit', class: 'btn primary' }, 'Continue pairing')));
        body.insertBefore(form, actions);
        address.focus();
        return new Promise((resolve, reject) => {
          const close = () => {
            signal.removeEventListener('abort', cancel);
            form.remove();
          };
          const cancel = () => {
            close();
            reject(signal.reason);
          };
          signal.addEventListener('abort', cancel, { once: true });
          address.addEventListener('input', () => address.setCustomValidity(''));
          form.addEventListener('submit', (event) => {
            event.preventDefault();
            const mac = SmartCube.normalizeAddress(address.value);
            if (!mac) {
              address.setCustomValidity('Enter all six bytes of the Bluetooth address.');
              address.reportValidity();
              return;
            }
            close();
            status.textContent = 'Connecting to the cube…';
            resolve(mac);
          });
        });
      }

      async function startPairing(manual) {
        if (!driver || smart.attempt) return;
        const attempt = { status, connect, actions, retry, controller: new AbortController(), selected: false };
        const { signal } = attempt.controller;
        smart.attempt = attempt;
        connect.disabled = true;
        retry.hidden = true;
        status.textContent = 'Select your cube in the browser’s Bluetooth picker.';
        renderSmartCube();
        if (metroSettings().auto) metro.prime();
        try {
          const cube = await SmartCube.connect(driver, {
            signal, manual,
            onSelected: (device, remembered) => {
              attempt.selected = true;
              status.textContent = remembered ? `Connecting to ${device.name || 'the cube'}…`
                : 'Looking up the cube’s Bluetooth address…';
            },
            requestAddress: () => askForAddress(signal, manual),
          });
          if (signal.aborted || !modal.open || !status.isConnected) {
            await cube.disconnect().catch(() => {});
            finishCubeAttempt(attempt);
            return;
          }
          smart.cube = cube;
          renderSmartCube();
          status.textContent = 'Reading the cube state…';
          cube.listen(handleCubeEvent);
        } catch (error) {
          if (smart.cube) await disconnectSmartCube();
          const message = signal.aborted ? ''
            : error.name === 'NotFoundError' && !attempt.selected ? 'No cube was selected. Wake the cube and try again.'
            : error.message || 'Could not connect to the cube.';
          finishCubeAttempt(attempt, message);
        }
      }

      body.append(
        h('p', { class: 'muted small' }, 'Close CubeStation and turn the white face of your GAN iCarry 4 to wake it.'),
        status,
        actions
      );

      SmartCube.loadDriver().then((module) => {
        driver = module;
        status.textContent = '';
        connect.disabled = false;
      }).catch(() => {
        status.textContent = 'Could not load Bluetooth support. Check the internet connection and reload Cube Timer.';
      });
    });
  }

  function renderCubeInfo(container) {
    const cube = smart.cube;
    if (!cube) {
      container.textContent = 'Cube disconnected.';
      return;
    }
    const hardware = cube.hardware;
    const entries = [
      ['Bluetooth name', cube.name],
      ['Battery', cube.battery == null ? 'Unavailable' : `${cube.battery}%`],
      ['Model', hardware?.hardwareName],
      ['Firmware', hardware?.softwareVersion],
      ['Hardware version', hardware?.hardwareVersion],
      ['Gyroscope', hardware?.gyroSupported == null ? null : hardware.gyroSupported ? 'Reported by cube' : 'Unavailable'],
    ];
    container.replaceChildren(...entries.filter(([, value]) => value).flatMap(([label, value]) =>
      [h('dt', null, label), h('dd', null, value)]));
  }

  function openCubeInfo() {
    openModal('Cube info', (body) => {
      const info = h('dl', { id: 'cube-device-info', class: 'cube-device-info' });
      renderCubeInfo(info);
      body.append(
        info,
        h('p', { class: 'muted small' }, 'Solve the physical cube before setting it as solved here. Keep it still until the reset finishes.'),
        h('div', { class: 'row end' },
          button('Refresh device info', () => smart.cube?.readDeviceInfo()),
          button('Resync cube state', () => {
            smart.cube?.sync();
            modal.close();
          }),
          button('Set cube as solved', () => {
            if (smart.cube?.resetSolved()) modal.close();
          }, 'btn primary', { id: 'cube-set-solved-btn', disabled: !smart.cube?.facelets })
        )
      );
    });
  }

  function openDrills() {
    openModal('Algorithm drills', (body) => {
      const preset = h('select', { id: 'drill-preset' },
        ...Object.keys(Smart.DRILLS).map((name) => h('option', { value: name }, name)),
        h('option', { value: 'custom' }, 'Custom algorithm')
      );
      const notation = h('input', { id: 'drill-notation', type: 'text', maxlength: 400, spellcheck: 'false' });
      const error = h('p', { class: 'muted small', role: 'status' });
      notation.value = Smart.DRILLS[preset.value];
      preset.addEventListener('change', () => {
        notation.value = Smart.DRILLS[preset.value] || '';
        error.textContent = '';
        if (preset.value === 'custom') notation.focus();
      });
      notation.addEventListener('input', () => { preset.value = 'custom'; });
      body.append(
        h('p', { class: 'muted small' }, 'Follow the setup, solve the case, then repeat. Reps are saved in a separate session.'),
        h('div', { class: 'settings-grid' },
          h('label', { for: 'drill-preset' }, 'Case'), preset,
          h('label', { for: 'drill-notation' }, 'Algorithm'), notation),
        error,
        h('div', { class: 'row end' }, button('Start drill', () => {
          const algorithm = notation.value.trim().replace(/\s+/g, ' ');
          if (!Smart.drillSetup(algorithm)) {
            error.textContent = 'Enter up to 100 U, R, F, D, L or B turns that change the cube state. Prime and double turns are supported.';
            return;
          }
          startDrill(preset.value === 'custom' ? 'Custom algorithm' : preset.value, algorithm);
          modal.close();
        }, 'btn primary'))
      );
    });
  }

  function startDrill(name, algorithm) {
    const puzzle = session().puzzle;
    let training = db.sessions.find((s) => s.puzzle === puzzle && s.drill?.algorithm === algorithm);
    if (!training) {
      training = newSession(uniqueName(`${name} drill`), puzzle);
      training.drill = { name, algorithm };
      db.sessions.push(training);
    }
    switchSession(training.id);
    if (currentView !== 'timer') setView('timer');
  }

  function exitDrill() {
    const { puzzle } = session();
    let regular = db.sessions.find((s) => !s.drill && s.puzzle === puzzle);
    if (!regular) {
      regular = newSession(uniqueName(PUZZLES[puzzle].name), puzzle);
      db.sessions.push(regular);
    }
    switchSession(regular.id);
  }

  const traceAnalysis = new WeakMap();
  function analyzeSolve(solve) {
    if (!traceAnalysis.has(solve)) {
      const { phases, pairs, xcross, turns, tps, longestPause } = Smart.analyze(solve.s, solve.smart);
      traceAnalysis.set(solve, { phases, pairs, xcross, turns, tps, longestPause });
    }
    return traceAnalysis.get(solve);
  }

  function coachPhaseTiming({ label, duration, pause }) {
    return { phase: label, timeMs: duration, initialPauseMs: pause, executionMs: duration - pause };
  }

  const seconds = (ms) => `${(ms / 1000).toFixed(2)} s`;
  const cfopSplits = ({ phases, pairs }) => phases.flatMap((phase) => phase.label === 'F2L' ? [phase, ...pairs] : [phase]);

  function phaseTable(rows, headers) {
    return h('table', { class: 'smart-phase-table' },
      h('thead', null, h('tr', null, headers.map((label) => h('th', { scope: 'col' }, label)))),
      h('tbody', null, rows.map(([label, ...values]) => h('tr', null,
        h('th', { scope: 'row' }, label), values.map((value) => h('td', null, value)))))
    );
  }

  function caseComparison(phase, cases) {
    if (!phase.case) return { phase: phase.label, skipped: true };
    const group = cases?.get(`${phase.label}:${phase.case.key}`);
    return {
      phase: phase.label,
      case: phase.case.name,
      timeMs: phase.duration,
      initialPauseMs: phase.pause,
      executionMs: phase.duration - phase.pause,
      quarterTurns: phase.turns,
      earlierSolves: group?.count || 0,
      earlierAverageMs: group?.averageMs ?? null,
      earlierAveragePauseMs: group?.averagePauseMs ?? null,
      earlierAverageExecutionMs: group?.averageExecutionMs ?? null,
      earlierBestMs: group?.best ?? null,
    };
  }

  function renderCaseDetails(cases, showHistory) {
    const completed = cases.filter((item) => !item.skipped);
    const rows = cases.map((item) => item.skipped
      ? [`${item.phase} · Skipped`, '–', '–', '–']
      : [`${item.phase} · ${item.case.startsWith(item.phase) ? item.case.slice(item.phase.length + 1) : item.case}`,
        seconds(item.timeMs), seconds(item.initialPauseMs), seconds(item.executionMs)]);
    return h('section', { class: 'case-details', 'aria-label': 'OLL and PLL cases' },
      h('h4', null, 'OLL and PLL cases'),
      phaseTable(rows, ['This solve', 'Time', 'Initial pause', 'Execution']),
      showHistory && completed.length ? h('div', null,
        h('p', { class: 'muted small' }, 'Earlier completed solves of the same case in this session.'),
        phaseTable(completed.map((item) => [
          item.case, String(item.earlierSolves), item.earlierAverageMs == null ? '–' : seconds(item.earlierAverageMs),
          item.earlierAveragePauseMs == null ? '–' : seconds(item.earlierAveragePauseMs),
          item.earlierAverageExecutionMs == null ? '–' : seconds(item.earlierAverageExecutionMs),
        ]), ['Case', 'Solves', 'Avg time', 'Avg pause', 'Avg execution'])) : null);
  }

  function renderReplay(solve, earlierSolves = null) {
    const trace = solve.smart;
    const info = Smart.analyze(solve.s, trace);
    const prior = earlierSolves && Smart.caseStats(earlierSolves.filter((item) => item.smart && item.p !== S.PEN_DNF).map(analyzeSolve));
    const cases = info.phases.filter(({ label }) => label === 'OLL' || label === 'PLL').map((phase) => caseComparison(phase, prior));
    const last = trace.moves.length;
    const net = h('div', { class: 'smart-replay-net' });
    const position = h('p', { class: 'small' });
    const slider = h('input', { type: 'range', min: 0, max: last, value: 0, 'aria-label': 'Replay turn' });
    const speed = h('select', { 'aria-label': 'Replay speed' },
      h('option', { value: '0.5' }, '0.5×'),
      h('option', { value: '1', selected: true }, '1×'),
      h('option', { value: '2' }, '2×'));
    let index = 0;
    let frame = 0;
    const play = button('Play', togglePlayback);
    function show(at) {
      index = at;
      slider.value = at;
      const move = at ? trace.moves[at - 1][0] : 'Setup';
      position.textContent = `${at} / ${last} · ${move} · ${seconds(info.times[at])}`;
      slider.setAttribute('aria-valuetext', position.textContent);
      renderFacelets(net, info.states[at], `Cube after ${at} recorded turns`);
    }
    function pause() {
      cancelAnimationFrame(frame);
      frame = 0;
      play.textContent = 'Play';
    }
    function seek(at) {
      pause();
      show(Math.max(0, Math.min(last, at)));
    }
    function togglePlayback() {
      if (frame) return pause();
      if (index === last) show(0);
      const origin = performance.now();
      const offset = info.times[index];
      const rate = Number(speed.value);
      play.textContent = 'Pause';
      const tick = (now) => {
        if (!modal.open || !net.isConnected) return pause();
        const elapsed = offset + (now - origin) * rate;
        let next = index;
        while (next < last && info.times[next + 1] <= elapsed) next++;
        if (next !== index) show(next);
        if (next === last) return pause();
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }
    slider.addEventListener('input', () => seek(+slider.value));
    speed.addEventListener('change', pause);
    show(0);
    const rows = cfopSplits(info).map(({ label, end, duration, turns, pause: gap, case: detected }) => [
      turns ? button(detected ? detected.name.startsWith(label) ? detected.name : `${label} · ${detected.name}` : label,
        () => seek(end), 'link-btn', { 'aria-label': `Jump to the end of ${label}` }) : label,
      seconds(duration),
      turns,
      turns ? seconds(gap) : '–',
      turns ? seconds(duration - gap) : '–',
    ]);
    const clock = trace.clock === 'cube' ? 'Cube clock' : 'Browser clock';
    return h('section', { class: 'solve-analysis', 'aria-label': 'Smart cube analysis' },
      h('h3', null, 'Smart cube analysis'),
      h('div', { class: 'smart-metrics' },
        kpi('Quarter turns', String(info.turns)),
        kpi('Turns per second', info.tps == null ? '–' : info.tps.toFixed(2)),
        kpi('Longest gap', seconds(info.longestPause)),
        trace.inspection != null ? kpi('Inspection', seconds(trace.inspection)) : null),
      h('p', { class: 'muted small' }, `${clock}${trace.estimated ? ` · ${trace.estimated} estimated turn timestamps` : ''}`),
      h('h4', null, 'Inferred CFOP splits'),
      h('p', { class: 'muted small' }, `${info.crossColor} cross${info.xcross ? ' · X-cross detected' : ''}. Initial pause measures the gap to the phase’s first turn.`),
      phaseTable(rows, ['Phase', 'Time', 'Turns', 'Initial pause', 'Execution']),
      renderCaseDetails(cases, !!prior),
      h('h4', null, 'Solve replay'),
      net, position, slider,
      h('div', { class: 'row replay-controls' },
        button('Previous turn', () => seek(index - 1)), play,
        button('Next turn', () => seek(index + 1)), speed),
      earlierSolves ? renderCoach({
        scope: 'single solve', timeMs: solve.t, penalty: ['OK', '+2', 'DNF'][solve.p],
        inspectionMs: trace.inspection, timingSource: trace.clock, estimatedTimestamps: trace.estimated,
        quarterTurns: info.turns, turnsPerSecond: info.tps, longestGapMs: info.longestPause,
        phases: info.phases.filter((phase) => phase.turns).map((phase) => ({
          ...coachPhaseTiming(phase), quarterTurns: phase.turns,
        })),
        cases,
      }) : null);
  }

  const REPLAY_HASH = '#replay=';
  function copyReplayLink(solve) {
    const { t, p, s, smart: trace } = solve;
    const url = new URL(location.href);
    url.hash = REPLAY_HASH + encodeURIComponent(JSON.stringify({ t, p, s, smart: trace }));
    if (url.hash.length > 16000) return toast('This replay is too long to share as a link.');
    copyText(url.href);
  }

  function openSharedReplay() {
    if (!location.hash.startsWith(REPLAY_HASH) || location.hash.length > 16000) return;
    try {
      const solve = cleanSolve(JSON.parse(decodeURIComponent(location.hash.slice(REPLAY_HASH.length))));
      if (!solve?.smart) throw new Error('Invalid replay');
      openModal('Shared solve replay', (body) => {
        body.append(h('div', { class: 'big-time' }, fmtSolve(solve)),
          h('p', { class: 'scr' }, solve.s), renderReplay(solve));
      });
    } catch {
      toast('Could not open this replay link.');
    }
  }

  function openSolve(i) {
    const s = session();
    const sv = s.solves[i];
    if (!sv) return;
    openModal(`Solve #${i + 1}`, (body) => {
      const date = new Date(sv.d);
      const avgs = ['ao5', 'ao12']
        .map((k) => (cache.roll[k][i] != null ? `${k} ${fmt(cache.roll[k][i], true)}` : null))
        .filter(Boolean)
        .join(' · ');
      body.append(
        h('div', { class: 'big-time' }, sv.p === S.PEN_DNF ? S.formatSolve(sv, { raw: true, precision: settings().precision }) : fmtSolve(sv)),
        h('div', { class: 'meta' }, `${date.toLocaleString()} · ${PUZZLES[s.puzzle].name}${cache.pbs.has(i) ? ' · personal best at the time' : ''}${avgs ? ' · ' + avgs : ''}`)
      );
      const pens = h('div', { class: 'row' });
      [
        ['OK', S.PEN_OK],
        ['+2', S.PEN_PLUS2],
        ['DNF', S.PEN_DNF],
      ].forEach(([label, p]) =>
        pens.append(
          button(label, () => {
            setPenalty(i, p);
            openSolve(i);
          }, 'chip', { 'aria-pressed': String(sv.p === p) })
        )
      );
      body.append(pens, h('p', { class: 'scr' }, sv.s || '(no scramble)'));
      const pv = h('div', { class: 'preview-inline' });
      renderPreview(pv, s.puzzle, sv.s || '');
      if (sv.smart) body.append(renderReplay(sv, s.solves.slice(0, i)));
      else if (!pv.hidden) body.append(pv);
      const note = h('textarea', { rows: '2', placeholder: 'Comment (optional)' });
      note.value = sv.c || '';
      note.addEventListener('input', () => {
        if (note.value.trim()) sv.c = note.value;
        else delete sv.c;
        save();
        renderSolves();
        renderLastActions();
      });
      body.append(note);
      body.append(
        h(
          'div',
          { class: 'row end' },
          button('Delete', () => {
            if (deleteSolve(i)) modal.close();
          }, 'btn danger'),
          button('Copy', () => copyText(`${fmtSolve(sv)}   ${sv.s}`)),
          sv.smart ? button('Copy replay link', () => copyReplayLink(sv)) : null,
          button('Done', () => modal.close(), 'btn primary')
        )
      );
    });
  }

  function openAverage(key, end) {
    const a = AVERAGES.find((x) => x.key === key);
    const solves = session().solves;
    if (!a || end < a.n - 1) return;
    const value = cache.roll[key][end];
    const idx = [];
    for (let i = end - a.n + 1; i <= end; i++) idx.push(i);
    const trim = S.trimCount(a.n, a.mean);
    const cmp = (x, y) => (x === y ? 0 : x < y ? -1 : 1);
    const order = idx.slice().sort((p, q) => cmp(cache.times[p], cache.times[q]) || p - q);
    const trimmed = new Set(trim ? order.slice(0, trim).concat(order.slice(a.n - trim)) : []);
    const counting = idx.filter((i) => !trimmed.has(i)).map((i) => cache.times[i]);
    const sd = counting.every(isFinite) ? S.stdDev(counting) : null;

    openModal(`${key}: ${fmt(value, true)}`, (body) => {
      body.append(
        h('div', { class: 'meta' }, `Solves ${end - a.n + 2}–${end + 1}${trim ? ` · best and worst ${trim} excluded` : ''}${sd != null ? ` · σ ${fmt(sd, true)}` : ''}`)
      );
      const list = h('ol', { class: 'avg-list', start: String(end - a.n + 2) });
      for (const i of idx) {
        const t = fmtSolve(solves[i]);
        list.append(
          h('li', { class: trimmed.has(i) ? 'trimmed' : null }, h('a', { href: '#', onclick: (e) => (e.preventDefault(), openSolve(i)) }, trimmed.has(i) ? `(${t})` : t))
        );
      }
      body.append(list);
      const text =
        `${key}: ${fmt(value, true)}\n\n` +
        idx.map((i, k) => `${k + 1}. ${trimmed.has(i) ? '(' + fmtSolve(solves[i]) + ')' : fmtSolve(solves[i])}   ${solves[i].s.replace(/\n/g, ' ')}`).join('\n');
      body.append(h('div', { class: 'row end' }, button('Copy', () => copyText(text)), button('Done', () => modal.close(), 'btn primary')));
    });
  }

  function renderCoach(metrics, sharing = 'Sends timing and case metrics to the configured AI provider.') {
    const status = h('p', { class: 'muted small', role: 'status' });
    const output = h('div', { class: 'coach-output', hidden: true });
    const source = h('p', { class: 'small', hidden: true });
    const ask = button('Get AI advice', async () => {
      if (coachRequest) return;
      const request = coachRequest = new AbortController();
      const timeout = setTimeout(() => request.abort('timeout'), 45000);
      ask.disabled = true;
      cancel.hidden = false;
      output.hidden = true;
      output.textContent = '';
      source.hidden = true;
      source.replaceChildren();
      status.textContent = 'Waiting for AI advice…';
      try {
        const { advice, lesson } = await AI.review(metrics, request.signal);
        if (request.signal.aborted || !output.isConnected) return;
        output.textContent = advice;
        output.hidden = false;
        if (lesson) {
          const access = lesson.access === 'premium' ? ' (Premium video)'
            : lesson.access === 'free account' ? ' (free account required)' : '';
          source.append(h('a', { href: lesson.url, target: '_blank', rel: 'noopener noreferrer' },
            `CubeSkills · ${lesson.title}`), access);
          source.hidden = false;
        }
        status.textContent = 'AI advice ready.';
      } catch (error) {
        if (status.isConnected) {
          status.textContent = request.signal.aborted
            ? request.signal.reason === 'timeout' ? 'The API request timed out.' : 'Canceled.'
            : error.message;
        }
      } finally {
        clearTimeout(timeout);
        if (coachRequest === request) coachRequest = null;
        ask.disabled = false;
        cancel.hidden = true;
      }
    }, 'btn primary');
    const cancel = button('Cancel request', () => coachRequest?.abort(), 'btn', { hidden: true });
    return h('section', { class: 'ai-coach', 'aria-label': 'AI coach' },
      h('h4', null, 'AI coach'),
      h('p', { class: 'muted small' }, `${sharing} Provider charges may apply.`),
      h('div', { class: 'row' }, ask, cancel), status, output, source);
  }

  const BULK_REVIEW_LIMIT = 50;
  const hasBulkSplits = (solve) => !!solve.smart && solve.p !== S.PEN_DNF;

  function openBulkReview(solves, offset, state = { selected: new Set(), page: 0, detail: 'times' }) {
    const { selected } = state;
    const latestCount = Math.min(BULK_REVIEW_LIMIT, solves.length);
    const pageCount = Math.ceil(solves.length / BULK_REVIEW_LIMIT);
    const restoringSelection = modal.open;
    openModal('Bulk AI review', (body) => {
      const count = h('span', { class: 'muted small', role: 'status' });
      const pageLabel = h('span', { class: 'muted small' });
      const rows = h('tbody');
      const list = h('div', { class: 'bulk-review-list', tabindex: '0', 'aria-label': 'Solves in the selected range' },
        h('table', { class: 'data-table' },
          h('thead', null, h('tr', null, ['Select', 'Solve', 'Time', 'CFOP splits'].map((label) =>
            h('th', { scope: 'col' }, label)))), rows));
      const previous = button('Newer', () => { state.page--; renderPage(); });
      const next = button('Older', () => { state.page++; renderPage(); });
      const selectLatest = button(`Select latest ${latestCount}`, () => {
        selected.clear();
        for (let i = solves.length - latestCount; i < solves.length; i++) selected.add(i);
        state.page = 0;
        renderPage();
      });
      const clear = button('Clear selection', () => {
        selected.clear();
        renderPage();
      });
      const review = button('Review selected solves', () => {
        const includeSplits = state.detail === 'cfop';
        const results = [...selected].sort((a, b) => a - b).map((index) => {
          const solve = solves[index];
          const item = { timeMs: solve.p === S.PEN_DNF ? null : S.effective(solve) };
          if (includeSplits && hasBulkSplits(solve)) {
            item.phases = analyzeSolve(solve).phases.filter((phase) => phase.turns).map(coachPhaseTiming);
          }
          return item;
        });
        const withSplits = results.filter((solve) => solve.phases?.length).length;
        const mode = includeSplits ? `CFOP timings for ${withSplits} of ${results.length}` : 'Solve times only';
        const metrics = { scope: 'selected solves', detail: state.detail, solves: results };
        const summary = h('p', { tabindex: '-1' }, `${results.length} selected · ${mode}`);
        openModal('Bulk AI review', (confirmation) => {
          confirmation.append(
            summary,
            button('Edit selection', () => openBulkReview(solves, offset, state)),
            renderCoach(metrics, includeSplits
              ? 'Sends the selected solve times and available CFOP timings to the configured AI provider.'
              : 'Sends only the selected solve times and DNF results to the configured AI provider.'));
        });
        summary.focus();
      }, 'btn primary');

      function updateSelection() {
        count.textContent = `${selected.size} of ${BULK_REVIEW_LIMIT} selected`;
        review.disabled = clear.disabled = selected.size === 0;
        rows.querySelectorAll('input').forEach((input) => {
          input.disabled = selected.size >= BULK_REVIEW_LIMIT && !input.checked;
        });
      }

      function renderPage() {
        const end = solves.length - state.page * BULK_REVIEW_LIMIT;
        const start = Math.max(0, end - BULK_REVIEW_LIMIT);
        rows.replaceChildren();
        for (let index = end - 1; index >= start; index--) {
          const solve = solves[index];
          const solveNumber = offset + index + 1;
          const select = h('input', { type: 'checkbox', checked: selected.has(index), 'aria-label': `Select solve ${solveNumber}` });
          select.addEventListener('change', () => {
            if (select.checked) selected.add(index);
            else selected.delete(index);
            updateSelection();
          });
          rows.append(h('tr', null, h('td', null, select),
            h('td', null, `#${solveNumber} · ${new Date(solve.d).toLocaleString()}`),
            h('td', null, fmtSolve(solve)), h('td', null, hasBulkSplits(solve) ? 'Available' : '—')));
        }
        previous.disabled = state.page === 0;
        next.disabled = state.page + 1 >= pageCount;
        pageLabel.textContent = `Page ${state.page + 1} of ${pageCount}`;
        list.scrollTop = 0;
        updateSelection();
      }

      const modes = h('fieldset', { class: 'bulk-review-modes' }, h('legend', null, 'Data to share'),
        [['times', 'Solve times only'], ['cfop', 'Solve times and detailed CFOP timings']].map(([value, label]) =>
          h('label', null, h('input', {
            type: 'radio', name: 'bulk-ai-detail', value, checked: state.detail === value,
            onchange: () => { state.detail = value; },
          }), label)));
      body.append(
        h('div', { class: 'row' }, selectLatest, clear, count),
        h('div', { class: 'row', hidden: pageCount < 2 }, previous, next, pageLabel),
        list, modes,
        h('p', { class: 'muted small' }, 'Times include +2 penalties. CFOP details are available for completed smart-cube solves.'),
        h('div', { class: 'row end' }, review));
      renderPage();
      if (restoringSelection) selectLatest.focus();
    });
  }

  function uniqueName(base) {
    const names = new Set(db.sessions.map((s) => s.name));
    if (!names.has(base)) return base;
    for (let k = 2; ; k++) if (!names.has(`${base} (${k})`)) return `${base} (${k})`;
  }

  function switchSession(id) {
    if (smart.cube && T.state !== 'idle') cancelTimer();
    db.current = id;
    save();
    compute();
    resetScrambles();
    solvesLimit = 150;
    renderAll();
    showLastTime();
    renderSmartCube();
  }

  function openSessions() {
    openModal('Sessions', (body) => {
      const list = h('ul', { class: 'session-list' });
      for (const s of db.sessions) {
        const nameInput = h('input', { type: 'text', 'aria-label': 'Session name' });
        nameInput.value = s.name;
        nameInput.addEventListener('change', () => {
          s.name = nameInput.value.trim() || s.name;
          save();
          renderSelectors();
        });
        list.append(
          h(
            'li',
            { class: s.id === db.current ? 'current' : null },
            h('div', { class: 'grow' }, nameInput),
            h('span', { class: 'muted small' }, `${PUZZLES[s.puzzle].name} · ${s.solves.length}`),
            s.id === db.current
              ? h('span', { class: 'muted small' }, 'current')
              : button('Open', () => {
                  switchSession(s.id);
                  openSessions();
                }),
            button('Delete', () => {
              if (!confirm(`Delete session "${s.name}" and its ${s.solves.length} solves?`)) return;
              db.sessions = db.sessions.filter((x) => x !== s);
              if (!db.sessions.length) db.sessions.push(newSession('3x3', '333'));
              if (!db.sessions.some((x) => x.id === db.current)) db.current = db.sessions[0].id;
              switchSession(db.current);
              openSessions();
            }, 'btn danger')
          )
        );
      }
      body.append(list);
      const puzzleSel = h('select', { 'aria-label': 'Puzzle' }, ...Object.entries(PUZZLES).map(([k, p]) => h('option', { value: k }, p.name)));
      puzzleSel.value = session().puzzle;
      body.append(
        h(
          'div',
          { class: 'row' },
          puzzleSel,
          button('New session', () => {
            const s = newSession(uniqueName(PUZZLES[puzzleSel.value].name), puzzleSel.value);
            db.sessions.push(s);
            switchSession(s.id);
            openSessions();
          }, 'btn primary')
        )
      );
    });
  }

  function openSettings() {
    const st = settings();
    const sel = (label, key, options, after) => {
      const id = 'set-' + key;
      const s = h('select', { id }, ...options.map(([v, l]) => h('option', { value: String(v) }, l)));
      s.value = String(st[key]);
      s.addEventListener('change', () => {
        const raw = s.value;
        st[key] = raw === 'true' ? true : raw === 'false' ? false : /^\d+$/.test(raw) ? +raw : raw;
        save();
        if (after) after();
      });
      return [h('label', { for: id }, label), s];
    };
    openModal('Settings', (body) => {
      body.append(
        h('div', { class: 'settings-section' }, 'Timer'),
        h(
          'div',
          { class: 'settings-grid' },
          ...sel('Input method', 'input', [['timer', 'Timer (Space / touch)'], ['typing', 'Type times in']], applyInputMode),
          ...sel('Inspection', 'inspection', [[false, 'Off'], [true, 'WCA 15 s (+2 after 15 s, DNF after 17 s)']], () => hint()),
          ...sel('Inspection beeps at 8 s / 12 s', 'beeps', [[true, 'On'], [false, 'Off']]),
          ...sel('Hold before start', 'holdMs', [[0, 'None'], [300, '0.3 s'], [550, '0.55 s (stackmat)']]),
          ...sel('While solving show', 'update', [['full', 'Running time'], ['seconds', 'Seconds only'], ['none', 'Nothing ("solving")']]),
          ...sel('Precision', 'precision', [[2, '0.01 s'], [3, '0.001 s']], () => {
            renderAll();
            showLastTime();
          })
        ),
        h('div', { class: 'settings-section' }, 'Display'),
        h(
          'div',
          { class: 'settings-grid' },
          ...sel('Color scheme', 'theme', [['auto', 'Match system (Basic / Pro)'], ...SCHEMES], applyTheme),
          ...sel('Scramble preview', 'preview', [[true, 'Show'], [false, 'Hide']], renderScramble)
        ),
        h('div', { class: 'settings-section' }, 'Coaching'),
        button('AI coach', openCoachSettings),
        h('div', { class: 'settings-section' }, 'Data'),
        h(
          'div',
          { class: 'row' },
          button('Export all (JSON)', exportData),
          button('Import…', importData),
          button('Add demo session', addDemoSession),
          button('Clear current session', () => {
            const s = session();
            if (!s.solves.length || !confirm(`Delete all ${s.solves.length} solves in "${s.name}"?`)) return;
            s.solves = [];
            save();
            compute();
            renderAll();
            showLastTime();
          }, 'btn danger')
        ),
        h('p', { class: 'muted small' }, 'Everything is stored in this browser (localStorage). Export regularly to keep a backup.'),
        h('div', { class: 'settings-section' }, 'Shortcuts'),
        h(
          'p',
          { class: 'muted small' },
          'Space: start/stop · Esc: cancel · M: start/stop metronome · Alt+1 / Alt+2 / Alt+3: OK / +2 / DNF on last solve · Alt+Z: delete last solve · ←/→ on the progress chart to step through solves.'
        )
      );
    });
  }

  function openCoachSettings() {
    openModal('AI coach settings', (body) => {
      const status = h('p', { class: 'muted small', role: 'status' }, 'Checking the coach server…');
      const endpoint = h('input', {
        type: 'url', required: true, placeholder: 'https://api.example.com/v1', autocapitalize: 'off', spellcheck: 'false',
      });
      const model = h('input', { type: 'text', required: true, autocapitalize: 'off', spellcheck: 'false' });
      const token = h('input', { id: 'coach-provider-token', type: 'password', autocomplete: 'new-password' });
      const clear = button('Clear saved settings', () => updateSettings('DELETE'), 'btn', { hidden: true });
      const saveSettings = h('button', { type: 'submit', class: 'btn primary' }, 'Save settings');
      const form = h('form', { class: 'coach-settings', autocomplete: 'off', hidden: true },
        h('label', { class: 'field' }, 'Provider URL', endpoint),
        h('label', { class: 'field' }, 'Model ID', model),
        h('label', { class: 'field' }, 'API token', token),
        h('p', { class: 'muted small' }, 'Use an OpenAI-compatible Chat Completions endpoint. A local provider can leave the token blank. The coach server keeps these settings in memory until it restarts.'),
        h('div', { class: 'row' }, saveSettings, clear));
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        updateSettings('PUT', { endpoint: endpoint.value, model: model.value, token: token.value });
      });
      const useBrowser = button('Connect from this browser', () => {
        token.value = '';
        renderBrowserCoachSettings(body, true);
      }, 'btn', { hidden: true });
      body.append(status, form, h('div', { class: 'row' }, useBrowser, button('Back to Settings', openSettings)));

      function displaySettings(settings, saved = false) {
        if (settings && AI.browserSettings()) {
          renderBrowserCoachSettings(body, true);
          return;
        }
        form.hidden = false;
        useBrowser.hidden = false;
        endpoint.value = settings.endpoint;
        model.value = settings.model;
        token.value = '';
        clear.hidden = settings.source !== 'web';
        status.textContent = saved ? 'Provider settings saved.'
          : settings.source === 'web' ? 'Using settings saved for this server run.'
          : settings.source === 'environment' ? 'Using the provider configured in the server environment.'
          : 'Choose a provider to enable AI advice.';
      }

      async function updateSettings(method, values) {
        if (saveSettings.disabled) return;
        const controls = [endpoint, model, token, saveSettings, clear];
        controls.forEach((control) => { control.disabled = true; });
        status.textContent = method === 'PUT' ? 'Saving provider settings…' : 'Clearing provider settings…';
        try {
          const settings = await AI.providerSettings(method, values);
          if (form.isConnected && modal.open) displaySettings(settings, method === 'PUT');
        } catch (error) {
          status.textContent = error.message;
        } finally {
          controls.forEach((control) => { control.disabled = false; });
        }
      }

      (location.protocol === 'file:' ? Promise.resolve(null) : AI.providerSettings())
        .catch(() => null)
        .then((settings) => {
          if (!form.isConnected || !modal.open) return;
          if (settings) displaySettings(settings);
          else renderBrowserCoachSettings(body, false);
        });
    });
  }

  function renderBrowserCoachSettings(body, hasServer) {
    const current = AI.browserSettings();
    const savedMessage = 'Browser connection saved for this tab.';
    const status = h('p', { class: 'muted small', role: 'status' }, current
      ? savedMessage : 'Connect directly to an OpenAI-compatible provider.');
    const endpoint = h('input', {
      type: 'url', required: true, value: current?.endpoint, placeholder: 'https://api.example.com/v1',
      autocapitalize: 'off', spellcheck: 'false',
    });
    const token = h('input', { id: 'coach-provider-token', type: 'password', autocomplete: 'new-password' });
    const models = h('datalist', { id: 'coach-provider-models' });
    const model = h('input', {
      type: 'text', value: current?.model, required: !!current, list: 'coach-provider-models',
      autocapitalize: 'off', spellcheck: 'false',
    });
    const modelField = h('label', { class: 'field', hidden: !current }, 'Model ID', model);
    const connect = h('button', { type: 'submit', class: 'btn primary' }, current ? 'Save connection' : 'Connect');
    const disconnect = button('Disconnect browser', () => {
      AI.clearBrowserProvider();
      renderBrowserCoachSettings(body, hasServer);
    }, 'btn', { hidden: !current });
    const form = h('form', { class: 'coach-settings', autocomplete: 'off' },
      h('label', { class: 'field' }, 'Provider URL', endpoint),
      h('label', { class: 'field' }, 'API token', token),
      modelField, models,
      h('p', { class: 'muted small' }, 'Use a token intended for browser use. It stays in this tab until reload and is sent to the provider URL you enter.'),
      h('div', { class: 'row' }, connect, disconnect));

    endpoint.addEventListener('input', () => {
      model.value = '';
      model.required = false;
      modelField.hidden = true;
      models.replaceChildren();
      connect.textContent = 'Connect';
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (connect.disabled) return;
      const controls = [endpoint, token, model, connect, disconnect];
      controls.forEach((control) => { control.disabled = true; });
      let chooseModel = false;
      try {
        let modelId = model.value.trim();
        if (!modelId) {
          status.textContent = 'Looking up available models…';
          const ids = await AI.providerModels(endpoint.value, token.value);
          if (!form.isConnected || !modal.open) return;
          if (ids.length !== 1) {
            modelField.hidden = false;
            model.required = true;
            models.replaceChildren(...ids.map((id) => h('option', { value: id })));
            connect.textContent = 'Save connection';
            status.textContent = ids.length ? 'Choose a chat model from your provider.' : 'The provider’s model list is unavailable. Enter its model ID.';
            chooseModel = true;
            return;
          }
          [modelId] = ids;
        }
        AI.setBrowserProvider(endpoint.value, token.value, modelId);
        token.value = '';
        endpoint.value = AI.browserSettings().endpoint;
        model.value = modelId;
        model.required = true;
        modelField.hidden = false;
        connect.textContent = 'Save connection';
        disconnect.hidden = false;
        status.textContent = savedMessage;
      } catch (error) {
        status.textContent = error.message;
      } finally {
        controls.forEach((control) => { control.disabled = false; });
        if (chooseModel) model.focus();
      }
    });
    body.replaceChildren(status, form, h('div', { class: 'row' },
      hasServer ? button('Use local coach server', () => {
        AI.clearBrowserProvider();
        openCoachSettings();
      }) : null,
      button('Back to Settings', openSettings)));
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(db, null, 1)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `cube-timer-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function importData() {
    const input = h('input', { type: 'file', accept: 'application/json,.json' });
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const data = normalize(JSON.parse(await file.text()));
        if (!data) throw new Error('bad');
        const count = data.sessions.reduce((a, s) => a + s.solves.length, 0);
        if (!confirm(`Import ${data.sessions.length} session(s) with ${count} solves? They will be added next to your current sessions.`)) return;
        const ids = new Set(db.sessions.map((s) => s.id));
        for (const s of data.sessions) {
          if (ids.has(s.id)) s.id = uid();
          db.sessions.push(s);
        }
        save();
        renderAll();
        toast(`Imported ${count} solves`);
        openSettings();
      } catch {
        toast('That file is not a Cube Timer export');
      }
    });
    input.click();
  }

  // Realistic-looking practice data so the charts can be explored right away.
  function addDemoSession() {
    const s = newSession(uniqueName('Demo 3x3'), '333');
    const total = 420;
    const now = Date.now();
    const start = now - 24 * 86400000;
    let d = start;
    for (let i = 0; i < total; i++) {
      const progress = i / total;
      const base = 24000 - 8500 * Math.pow(progress, 0.7);
      // log-normal-ish noise, right-skewed like real solve times
      const g = (Math.random() + Math.random() + Math.random() - 1.5) * 0.9;
      let t = base * Math.exp(g * 0.13);
      if (Math.random() < 0.025) t *= 1.6 + Math.random(); // occasional pop
      const r = Math.random();
      const p = r < 0.015 ? S.PEN_DNF : r < 0.045 ? S.PEN_PLUS2 : S.PEN_OK;
      d += 30000 + Math.random() * 40000;
      if (i % 30 === 29) d += 86400000 * (1.2 + Math.random() * 0.8);
      if (d > now) d = now - (total - i) * 1000;
      s.solves.push({ t: Math.round(t), p, s: window.Scramble.generate('333'), d: Math.round(d) });
    }
    db.sessions.push(s);
    switchSession(s.id);
    modal.close();
    toast('Demo session added — open History & stats');
  }

  /* ================= History view ================= */

  const hist = {
    range: 'all',
    bin: 'auto',
    visible: { single: true, ao5: true, ao12: true, ao100: false },
  };
  let histChart = null;

  function rangeBounds() {
    const solves = session().solves;
    const n = solves.length;
    const r = hist.range;
    if (r === 'all') return [0, n];
    if (r[0] === 'n') return [Math.max(0, n - +r.slice(1)), n];
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    const days = r === 'today' ? 0 : r === 'd7' ? 6 : 29;
    const cutoff = day.getTime() - days * 86400000;
    let a = n;
    while (a > 0 && solves[a - 1].d >= cutoff) a--;
    return [a, n];
  }

  function rangeLabel(b) {
    if (b.overflow) return `≥ ${fmt(b.lo)}`;
    return `${fmt(b.lo)} – ${fmt(b.hi - (settings().precision === 3 ? 1 : 10))}`;
  }

  function kpi(label, value, sub) {
    return h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value' }, value), sub ? h('div', { class: 'kpi-sub' }, sub) : null);
  }

  function bestIn(arr, a, b) {
    const i = S.bestIndex(arr, a, b);
    return i >= 0 ? { i, v: arr[i] } : null;
  }

  function renderSmartHistory(solves) {
    const recorded = solves.filter((solve) => solve.smart && solve.p !== S.PEN_DNF);
    const results = recorded.map(analyzeSolve);
    $('#smart-history').hidden = !results.length;
    if (!results.length) return;
    const average = (values) => values.length ? S.mean(values) : null;
    const tps = average(results.map((result) => result.tps).filter((value) => value != null));
    const detectedCrosses = results.filter((result) => result.phases[0].turns && result.phases[0].end < result.phases.at(-1).end);
    const xcrosses = detectedCrosses.filter((result) => result.xcross).length;
    $('#smart-history-metrics').replaceChildren(
      kpi('Recorded solves', String(results.length)),
      kpi('Average quarter turns', average(results.map((result) => result.turns)).toFixed(1)),
      kpi('Average TPS', tps == null ? '–' : tps.toFixed(2)),
      kpi('Average longest gap', seconds(average(results.map((result) => result.longestPause)))),
      kpi('X-cross rate', detectedCrosses.length ? `${Math.round(100 * xcrosses / detectedCrosses.length)}%` : '–',
        detectedCrosses.length ? `${xcrosses} of ${detectedCrosses.length} detected crosses` : null)
    );
    const solveSplits = results.map(cfopSplits);
    const splits = solveSplits[0].map(({ label }, i) => {
      const samples = solveSplits.map((sum) => sum[i]).filter((phase) => phase.turns);
      if (!samples.length) return { phase: label, count: 0 };
      return {
        phase: label, count: samples.length,
        averageTurns: average(samples.map((phase) => phase.turns)),
        averageMs: Math.round(average(samples.map((phase) => phase.duration))),
        averagePauseMs: Math.round(average(samples.map((phase) => phase.pause))),
        averageExecutionMs: Math.round(average(samples.map((phase) => phase.duration - phase.pause))),
      };
    });
    const rows = splits.map(({ phase, count, averageTurns, averageMs, averagePauseMs, averageExecutionMs }) =>
      [phase, count, averageTurns?.toFixed(1) ?? '–', ...[averageMs, averagePauseMs, averageExecutionMs].map((value) => value == null ? '–' : seconds(value))]);
    const caseGroups = Smart.caseStats(results);
    const cases = [...caseGroups.values()].sort((a, b) => b.count - a.count || b.averageMs - a.averageMs);
    const historyMetrics = {
      scope: 'filtered session history', recordedSolves: recorded.length, averageTurnsPerSecond: tps,
      averageQuarterTurns: average(results.map((result) => result.turns)),
      estimatedTimingSolves: recorded.filter((solve) => solve.smart.estimated).length,
      phases: splits, distinctCases: cases.length,
      cases: cases.slice(0, 16).map(({ name, type, count, averageMs, averagePauseMs, averageExecutionMs, best }) =>
        ({ name, type, count, averageMs, averagePauseMs, averageExecutionMs, bestMs: best })),
    };
    const container = $('#smart-history-phases');
    const expanded = new Set([...container.querySelectorAll('details[data-case-type][open]')].map((details) => details.dataset.caseType));
    container.replaceChildren(
      h('p', { class: 'muted small' }, 'Inferred CFOP splits for completed smart-cube solves in this range.'),
      phaseTable(rows, ['Phase', 'Solves', 'Avg turns', 'Avg time', 'Avg initial pause', 'Avg execution']),
      renderCaseHistory(caseGroups, expanded),
      session().drill ? null : trainingFocus(recorded, cases),
      h('div', { class: 'row ai-history-actions' }, button('AI practice review', () =>
        openModal('AI practice review', (body) => body.append(renderCoach(historyMetrics)))))
    );
  }

  function renderCaseHistory(cases, expanded) {
    return h('section', { class: 'case-details', 'aria-label': 'OLL and PLL case statistics' },
      h('h3', null, 'OLL and PLL case statistics'),
      ['OLL', 'PLL'].map((type) => {
        const catalog = Smart.caseCatalog(type);
        let seen = 0;
        const rows = catalog.map(({ key, name, skip }) => {
          const group = cases.get(`${type}:${key}`);
          if (!group) return [name, 0, '–', '–', '–', '–', '–'];
          if (!skip) seen++;
          return [name, group.count, group.averageTurns.toFixed(1), seconds(group.averageMs), seconds(group.best),
            seconds(group.averagePauseMs), seconds(group.averageExecutionMs)];
        });
        return h('details', { class: 'case-catalog', 'data-case-type': type, open: expanded.has(type) },
          h('summary', null, `${type} cases · ${seen}/${catalog.length - 1} seen`),
          h('div', { class: 'table-scroll' }, phaseTable(rows, ['Case', 'Solves', 'Avg turns', 'Avg time', 'Best', 'Avg pause', 'Avg execution'])));
      }));
  }

  function trainingFocus(solves, cases) {
    const ranked = cases.filter(({ example }) => example)
      .map((record) => {
        const { index, start, end } = record.example;
        const algorithm = solves[index].smart.moves.slice(start, end).map(([move]) => move).join(' ');
        return { ...record, algorithm };
      })
      .filter(({ algorithm }) => Smart.drillSetup(algorithm))
      .sort((a, b) => b.averageMs - a.averageMs);
    const targets = ['OLL', 'PLL'].map((type) => ranked.find((record) => record.type === type)).filter(Boolean);
    if (!targets.length) return null;
    return h('section', { class: 'training-focus', 'aria-label': 'Training focus' },
      h('h3', null, 'Training focus'),
      ...targets.map(({ name, type, count, averageMs, averagePauseMs, algorithm }) => h('div', { class: 'training-target' },
        h('div', null, h('strong', null, name),
          h('p', { class: 'muted small' }, `${count} ${count === 1 ? 'solve' : 'solves'} · ${seconds(averageMs)} avg ${type} · ${seconds(averagePauseMs)} avg initial pause`)),
        button(`Drill ${type}`, () => startDrill(name, algorithm), 'btn'))));
  }

  function renderHistory() {
    const [a, b] = rangeBounds();
    const solves = session().solves.slice(a, b);
    const times = cache.times.slice(a, b);
    const total = session().solves.length;
    $('#bulk-ai-review').disabled = solves.length === 0;
    $('#history-empty').hidden = solves.length > 0;
    $('#history-content').hidden = solves.length === 0;
    if (solves.length) {
      const d0 = new Date(solves[0].d).toLocaleDateString();
      const d1 = new Date(solves[solves.length - 1].d).toLocaleDateString();
      $('#range-summary').textContent = `${PUZZLES[session().puzzle].name} · solves ${a + 1}–${b} of ${total} · ${d0 === d1 ? d0 : d0 + ' – ' + d1}`;
    } else {
      $('#range-summary').textContent = `${total} solves in session`;
      return;
    }

    const sum = S.summary(times);
    const dist = S.distribution(times, hist.bin === 'auto' ? 'auto' : +hist.bin);

    // KPI row
    const bestSingle = bestIn(cache.times, a, b);
    const b5 = bestIn(cache.roll.ao5, a, b);
    const b12 = bestIn(cache.roll.ao12, a, b);
    const slope = S.trendSlope(times);
    const kp = [
      kpi('Solves', String(sum.count), sum.dnf ? `${sum.dnf} DNF (${((sum.dnf / sum.count) * 100).toFixed(1)}%)` : 'no DNFs'),
      kpi('Best single', bestSingle ? fmt(bestSingle.v) : '–', bestSingle ? `solve #${bestSingle.i + 1}` : null),
      kpi('Mean', fmt(sum.mean, true), sum.sd != null ? `σ ${fmt(sum.sd, true)}` : null),
      kpi('Median', fmt(sum.median, true), sum.p25 != null ? `middle 50%: ${fmt(sum.p25, true)}–${fmt(sum.p75, true)}` : null),
      kpi('Best ao5', b5 ? fmt(b5.v, true) : '–', b5 ? `ending at solve #${b5.i + 1}` : 'needs 5 solves'),
      kpi('Best ao12', b12 ? fmt(b12.v, true) : '–', b12 ? `ending at solve #${b12.i + 1}` : 'needs 12 solves'),
      kpi('Consistency', sum.cv != null ? `${(sum.cv * 100).toFixed(1)}%` : '–', 'σ ÷ mean — lower is steadier'),
      kpi(
        'Trend',
        slope != null ? `${slope <= 0 ? '−' : '+'}${(Math.abs(slope * 100) / 1000).toFixed(2)} s` : '–',
        slope != null ? `per 100 solves${slope < 0 ? ' (getting faster)' : slope > 0 ? ' (getting slower)' : ''}` : 'needs 5 solves'
      ),
    ];
    $('#kpis').replaceChildren(...kp);
    renderSmartHistory(solves);

    // Progress chart
    renderLegend();
    renderProgress(a, b);

    // Histogram + distribution table
    const dnfNote = dist.dnf ? ` · ${dist.dnf} DNF excluded` : '';
    $('#dist-sub').textContent = `${dist.total} completed solves · bin width ${dist.width / 1000} s${dnfNote}. Hover a bar or row to link them.`;
    const rows = [];
    const maxCount = Math.max(1, ...dist.bins.map((x) => x.count));
    const tbody = $('#dist-table tbody');
    dist.bins.forEach((bin, i) => {
      const tr = h(
        'tr',
        {
          onmouseenter: () => histChart && histChart.highlight(i),
          onmouseleave: () => histChart && histChart.highlight(null),
        },
        h('td', { class: 'label' }, rangeLabel(bin)),
        h('td', { class: 'num' + (bin.count ? '' : ' zero') }, String(bin.count)),
        h('td', { class: 'num' + (bin.count ? '' : ' zero') }, `${(bin.share * 100).toFixed(1)}%`),
        h('td', { class: 'num' }, bin.overflow ? '100%' : `${(bin.cum * 100).toFixed(1)}%`, h('span', { class: 'muted' }, bin.overflow ? '' : ` < ${fmt(bin.hi)}`)),
        h('td', { 'aria-hidden': 'true' }, h('div', { class: 'dist-bar', style: { width: `${(bin.count / maxCount) * 100}%`, opacity: bin.count ? 1 : 0 } }))
      );
      rows.push(tr);
    });
    tbody.replaceChildren(...rows);
    histChart = window.Charts.histogram($('#hist-chart'), dist, sum, {
      format: fmt,
      color: 'var(--s1)',
      rangeLabel,
      ariaLabel: `Histogram of ${dist.total} solve times`,
      onHover: (i) => {
        [...tbody.rows].forEach((r, k) => r.classList.toggle('active', k === i));
      },
    });

    // Percentiles table
    const pct = [
      ['Best', sum.best, false],
      ['5th percentile', sum.p5, true],
      ['10th percentile', sum.p10, true],
      ['25th percentile (Q1)', sum.p25, true],
      ['Median', sum.median, true],
      ['75th percentile (Q3)', sum.p75, true],
      ['90th percentile', sum.p90, true],
      ['95th percentile', sum.p95, true],
      ['Worst (non-DNF)', sum.worst, false],
      ['Mean', sum.mean, true],
      ['Standard deviation σ', sum.sd, true],
      ['Interquartile range', sum.p25 != null ? sum.p75 - sum.p25 : null, true],
    ];
    $('#pct-table tbody').replaceChildren(
      ...pct.map(([label, v, avg]) => h('tr', null, h('td', { class: 'label' }, label), h('td', { class: 'num' }, v == null ? '–' : fmt(v, avg))))
    );

    // Averages table (current = at end of range; best/worst = windows ending in range)
    $('#avg-table tbody').replaceChildren(
      ...AVERAGES.map((av) => {
        const arr = cache.roll[av.key];
        const cur = arr[b - 1];
        const best = bestIn(arr, a, b);
        let worst = null;
        for (let i = a; i < b; i++) if (arr[i] != null && (worst == null || arr[i] > worst)) worst = arr[i];
        return h(
          'tr',
          null,
          h('td', { class: 'label' }, av.key),
          h('td', { class: 'num' }, cur == null ? '–' : fmt(cur, true)),
          h('td', { class: 'num' }, best ? fmt(best.v, true) : '–'),
          h('td', { class: 'num' }, worst == null ? '–' : fmt(worst, true))
        );
      })
    );

    // Daily table
    const days = new Map();
    solves.forEach((sv, k) => {
      const dt = new Date(sv.d);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      if (!days.has(key)) days.set(key, { date: dt, times: [] });
      days.get(key).times.push(times[k]);
    });
    const dayRows = [...days.values()].reverse().map((dd) => {
      const sm = S.summary(dd.times);
      const ao5 = S.rolling(dd.times, 5);
      const b5i = S.bestIndex(ao5);
      return h(
        'tr',
        null,
        h('td', { class: 'label' }, dd.date.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })),
        h('td', { class: 'num' }, `${sm.count}${sm.dnf ? ` (${sm.dnf} DNF)` : ''}`),
        h('td', { class: 'num' }, fmt(sm.best)),
        h('td', { class: 'num' }, b5i >= 0 ? fmt(ao5[b5i], true) : '–'),
        h('td', { class: 'num' }, fmt(sm.mean, true)),
        h('td', { class: 'num' }, fmt(sm.median, true)),
        h('td', { class: 'num' }, sm.sd == null ? '–' : fmt(sm.sd, true))
      );
    });
    $('#daily-table tbody').replaceChildren(...dayRows);
  }

  function renderLegend() {
    const items = [{ key: 'single', label: 'single', color: 'var(--single)', dot: true }].concat(SERIES);
    $('#progress-legend').replaceChildren(
      ...items.map((it) =>
        button(
          [h('span', { class: 'legend-key' + (it.dot ? ' dot' : '') }), it.label],
          () => {
            hist.visible[it.key] = !hist.visible[it.key];
            renderLegend();
            renderProgress(...rangeBounds());
          },
          'legend-item',
          { 'aria-pressed': String(!!hist.visible[it.key]), title: `Show/hide ${it.label}` }
        )
      )
    );
    $('#progress-legend').querySelectorAll('.legend-key').forEach((k, i) => k.style.setProperty('--key', items[i].color));
  }

  function renderProgress(a, b) {
    const solves = session().solves;
    const times = cache.times.slice(a, b);
    const pbs = new Set();
    for (let i = a; i < b; i++) if (cache.pbs.has(i)) pbs.add(i - a);
    const model = {
      single: times,
      numbers: times.map((_, k) => a + k + 1),
      dates: solves.slice(a, b).map((s) => s.d),
      series: SERIES.map((s) => Object.assign({}, s, { values: cache.roll[s.key].slice(a, b) })),
      pbs,
    };
    const res = window.Charts.progress($('#progress-chart'), model, {
      visible: hist.visible,
      format: fmt,
      formatSolve: (k) => fmtSolve(solves[a + k]),
      onSelect: (k) => openSolve(a + k),
      ariaLabel: `Progress of ${times.length} solves. Use left and right arrow keys to step through solves.`,
    });
    const notes = [];
    if (hist.visible.single && pbs.size) notes.push('Large solid dots mark a new personal-best single.');
    if (times.some((t) => t === Infinity) && hist.visible.single) notes.push('× along the top marks a DNF.');
    if (res && res.clipped) notes.push('The axis is capped to keep the bulk readable; slower outliers appear as ▲ on the top edge.');
    $('#progress-foot').textContent = notes.join(' ');
  }

  /* ================= Views & wiring ================= */

  let currentView = 'timer';

  function setView(v) {
    if (T.state !== 'idle') cancelTimer();
    currentView = v;
    document.body.classList.toggle('at-timer', v === 'timer');
    document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === v)));
    $('#view-timer').hidden = v !== 'timer';
    $('#view-history').hidden = v !== 'history';
    window.Charts.hideTip();
    if (v === 'history') renderHistory();
    if (v === 'timer' && smartTiming()) updateSmartReadiness();
    if (v === 'timer' && settings().input === 'typing') $('#time-input').focus();
  }

  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));
  $('#open-history').addEventListener('click', () => setView('history'));

  $('#puzzle-select').addEventListener('change', (e) => {
    const v = e.target.value;
    const s = session();
    const existing = db.sessions.filter((x) => x.puzzle === v && !x.drill).sort((x, y) => y.created - x.created)[0];
    if (existing) {
      switchSession(existing.id);
      toast(`Switched to session "${existing.name}"`);
    } else if (!s.solves.length && !s.drill) {
      const isDefaultName = Object.values(PUZZLES).some((p) => p.name === s.name);
      s.puzzle = v;
      if (isDefaultName) s.name = uniqueName(PUZZLES[v].name);
      switchSession(s.id);
    } else {
      const ns = newSession(uniqueName(PUZZLES[v].name), v);
      db.sessions.push(ns);
      switchSession(ns.id);
      toast(`Created session "${ns.name}"`);
    }
  });

  $('#session-select').addEventListener('change', (e) => switchSession(e.target.value));
  $('#session-btn').addEventListener('click', openSessions);
  $('#settings-btn').addEventListener('click', openSettings);
  $('#theme-btn').addEventListener('click', openSchemes);
  $('#smart-cube-btn').addEventListener('click', () => {
    if (smart.attempt || smart.closing) return;
    if (smart.cube) disconnectSmartCube();
    else openSmartCube();
  });
  $('#smart-cube-info').addEventListener('click', openCubeInfo);
  $('#smart-drills-btn').addEventListener('click', openDrills);
  $('#end-drill-btn').addEventListener('click', exitDrill);

  $('#next-scramble').addEventListener('click', () => {
    if (smartTiming() && T.state !== 'idle') cancelTimer();
    if (scr.idx < scr.list.length - 1) {
      scr.idx++;
      renderScramble();
    } else newScramble();
  });
  $('#prev-scramble').addEventListener('click', () => {
    if (smartTiming() && T.state !== 'idle') cancelTimer();
    if (scr.idx > 0) {
      scr.idx--;
      renderScramble();
    }
  });
  $('#copy-scramble').addEventListener('click', () => copyText(currentScramble()));
  $('#edit-scramble').addEventListener('click', () => {
    openModal('Custom scramble', (body) => {
      const ta = h('textarea', { rows: '4', 'aria-label': 'Scramble' });
      ta.value = currentScramble();
      body.append(
        ta,
        h(
          'div',
          { class: 'row end' },
          button('Cancel', () => modal.close()),
          button('Use scramble', () => {
            const v = ta.value.trim();
            if (v) {
              scr.list.push(v);
              scr.idx = scr.list.length - 1;
              renderScramble();
            }
            modal.close();
          }, 'btn primary')
        )
      );
      setTimeout(() => ta.focus(), 0);
    });
  });

  document.querySelectorAll('#last-actions [data-pen]').forEach((b) =>
    b.addEventListener('click', () => setPenalty(session().solves.length - 1, +b.dataset.pen))
  );
  $('#last-delete').addEventListener('click', () => deleteSolve(session().solves.length - 1));
  $('#last-comment').addEventListener('click', () => openSolve(session().solves.length - 1));
  $('#more-solves').addEventListener('click', () => {
    solvesLimit += 300;
    renderSolves();
  });
  $('#metro-btn').addEventListener('click', () => showMetronome(!metroSettings().open || currentView !== 'timer'));
  $('#metro-close').addEventListener('click', () => showMetronome(false));
  $('#metro-play').addEventListener('click', toggleMetronome);
  document.querySelectorAll('.metro-step').forEach((b) =>
    b.addEventListener('click', () => setMetroBpm(metroSettings().bpm + +b.dataset.step))
  );
  $('#metro-bpm-range').addEventListener('input', (e) => setMetroBpm(+e.target.value));
  const bpmInput = $('#metro-bpm-input');
  bpmInput.addEventListener('change', () => setMetroBpm(+bpmInput.value));
  bpmInput.addEventListener('blur', () => (bpmInput.value = metroSettings().bpm));
  bpmInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      if (e.key === 'Enter') setMetroBpm(+bpmInput.value);
      bpmInput.blur();
    }
  });
  // Register taps on press, not release, for accurate timing.
  $('#metro-tap').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    tapTempo();
  });
  $('#metro-tap').addEventListener('click', (e) => {
    if (e.detail === 0) tapTempo(); // keyboard activation
  });
  $('#metro-beats').addEventListener('change', (e) => {
    metroSettings().beats = +e.target.value;
    applyMetroSettings();
    save();
    renderMetronome();
    e.target.blur();
  });
  $('#metro-sound').addEventListener('change', (e) => {
    metroSettings().sound = e.target.value;
    applyMetroSettings();
    save();
    e.target.blur();
  });
  $('#metro-volume').addEventListener('input', (e) => {
    metroSettings().volume = +e.target.value;
    metro.setVolume(+e.target.value / 100);
    save();
  });
  $('#metro-auto').addEventListener('change', (e) => {
    metroSettings().auto = e.target.checked;
    save();
    if (e.target.checked && metro.playing) {
      metro.stop();
      metroAuto = false;
    }
    renderMetronome();
    e.target.blur();
    toast(e.target.checked ? 'Metronome will play only while a solve is running' : 'Metronome is back to manual start/stop');
  });

  // Keep Space for the timer: don't leave focus on clicked controls.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.stage button, .sidebar button, .topbar button, .stage summary');
    if (b && currentView === 'timer') b.blur();
  });

  $('#range-select').addEventListener('change', (e) => {
    hist.range = e.target.value;
    renderHistory();
  });
  $('#bulk-ai-review').addEventListener('click', () => {
    const [start, end] = rangeBounds();
    if (start < end) openBulkReview(session().solves.slice(start, end), start);
  });
  $('#bin-select').addEventListener('change', (e) => {
    hist.bin = e.target.value;
    renderHistory();
  });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (currentView === 'history') renderHistory();
    }, 150);
  });

  // Other tabs editing the same storage.
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY || T.state !== 'idle') return;
    const previous = session();
    db = load();
    const current = session();
    if (previous.id !== current.id || previous.puzzle !== current.puzzle || previous.drill?.algorithm !== current.drill?.algorithm) resetScrambles();
    applyTheme();
    applyInputMode();
    applyMetroSettings();
    renderMetronome();
    compute();
    renderAll();
    showLastTime();
  });

  /* ================= Boot ================= */

  document.body.classList.add('at-timer');
  $('#timer-display').append(displayLogo());
  applyTheme();
  applyMetroSettings();
  renderMetronome();
  compute();
  resetScrambles();
  applyInputMode();
  renderAll();
  showLastTime();
  hint();
  openSharedReplay();
  window.addEventListener('hashchange', openSharedReplay);
})();
