/*
 * Cube Timer - app wiring: storage, sessions, timer state machine, views.
 */
(function () {
  'use strict';

  const S = window.Stats;
  const { PUZZLES } = window.Scramble;

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
    return out;
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
      }));
    if (!sessions.length) return null;
    const current = sessions.some((s) => s.id === d.current) ? d.current : sessions[0].id;
    return { sessions, current, settings: Object.assign({}, DEFAULT_SETTINGS, d.settings || {}) };
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
    scr.list.push(window.Scramble.generate(session().puzzle));
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
    renderPreview($('#preview'), session().puzzle, text);
  }

  function renderPreview(container, puzzle, scramble) {
    container.replaceChildren();
    const p = PUZZLES[puzzle];
    if (!p || !p.cube || !settings().preview) {
      container.hidden = true;
      return;
    }
    container.hidden = false;
    const n = p.cube;
    const cell = 10;
    const gap = 3;
    const F = n * cell;
    const W = 4 * F + 3 * gap;
    const H = 3 * F + 2 * gap;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Cube state after the scramble (white top, green front)');
    for (const f of window.Scramble.cubeNet(n, scramble)) {
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
    container.appendChild(svg);
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
  const setSolving = (on) => document.body.classList.toggle('solving', on);
  const inspecting = () => T.inspStart > 0;
  const coarse = window.matchMedia('(pointer: coarse)').matches;

  function hint(text) {
    $('#timer-hint').textContent = text == null ? idleHint() : text;
  }

  function idleHint() {
    if (settings().input === 'typing') return '';
    const act = coarse ? 'Touch and hold the timer' : 'Hold Space';
    return settings().inspection ? `${coarse ? 'Tap the timer' : 'Press Space'} to start inspection` : `${act}, release to start`;
  }

  function showLastTime() {
    const s = session();
    const last = s.solves[s.solves.length - 1];
    timerEl.textContent = last ? fmtSolve(last) : fmt(0);
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
    if (!inspecting()) timerEl.textContent = fmt(0);
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
    hint('Inspecting — hold to start the solve');
    inspectionLoop();
  }

  function inspectionLoop() {
    if (!inspecting()) return;
    const el = (performance.now() - T.inspStart) / 1000;
    if (el >= 17) return inspectionDNF();
    timerEl.textContent = el < 15 ? String(Math.ceil(15 - el)) : '+2';
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

  function startSolve() {
    let pen = S.PEN_OK;
    if (inspecting()) {
      if ((performance.now() - T.inspStart) / 1000 >= 15) pen = S.PEN_PLUS2;
      cancelAnimationFrame(T.raf);
      T.inspStart = 0;
    }
    T.penalty = pen;
    T.state = 'running';
    T.start = performance.now();
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
    timerEl.textContent = mode === 'full' ? fmt(ms) : mode === 'seconds' ? String(Math.floor(ms / 1000)) : 'solving';
    T.raf = requestAnimationFrame(runLoop);
  }

  // awaitRelease: the stopping key/touch is still down; ignore its release.
  function stop(awaitRelease) {
    const ms = performance.now() - T.start;
    cancelAnimationFrame(T.raf);
    T.state = awaitRelease ? 'stopped' : 'idle';
    setSolving(false);
    stopAutoMetronome();
    addSolve({ t: Math.round(ms), p: T.penalty, s: currentScramble(), d: Date.now() });
    newScramble();
    showLastTime();
    hint();
  }

  function cancelTimer() {
    cancelAnimationFrame(T.raf);
    clearTimeout(T.hold);
    T.inspStart = 0;
    T.state = 'idle';
    setSolving(false);
    stopAutoMetronome();
    showLastTime();
    hint();
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
      else if (!e.repeat) stop(e.code === 'Space');
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
      e.preventDefault();
      if (e.repeat || settings().input === 'typing') return;
      press();
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.code !== 'Space' || isTyping(e.target)) return;
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
      if (settings().input === 'typing' || !timerActive() || T.state === 'running') return;
      if (touchIgnored(e.target)) return;
      e.preventDefault();
      press();
    },
    { passive: false }
  );
  document.addEventListener(
    'touchstart',
    (e) => {
      if (T.state !== 'running') return;
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
    if (T.state === 'running') stop(false);
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
    hint();
  }

  function applyTheme() {
    const t = settings().theme;
    if (t === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  }

  /* ================= Modals ================= */

  const modal = $('#modal');

  function openModal(title, build) {
    $('#modal-title').textContent = title;
    const body = $('#modal-body');
    body.replaceChildren();
    build(body);
    if (!modal.open) modal.showModal();
  }

  modal.addEventListener('close', () => {
    window.Charts.hideTip();
    if (currentView === 'timer') document.activeElement && document.activeElement.blur();
  });

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
      if (!pv.hidden) body.append(pv);
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

  function uniqueName(base) {
    const names = new Set(db.sessions.map((s) => s.name));
    if (!names.has(base)) return base;
    for (let k = 2; ; k++) if (!names.has(`${base} (${k})`)) return `${base} (${k})`;
  }

  function switchSession(id) {
    db.current = id;
    save();
    compute();
    resetScrambles();
    solvesLimit = 150;
    renderAll();
    showLastTime();
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
          ...sel('Theme', 'theme', [['auto', 'Match system'], ['light', 'Light'], ['dark', 'Dark']], () => {
            applyTheme();
            if (currentView === 'history') renderHistory();
          }),
          ...sel('Scramble preview', 'preview', [[true, 'Show'], [false, 'Hide']], renderScramble)
        ),
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

  function renderHistory() {
    const [a, b] = rangeBounds();
    const solves = session().solves.slice(a, b);
    const times = cache.times.slice(a, b);
    const total = session().solves.length;
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
    if (hist.visible.single && pbs.size) notes.push('Dark dots mark a new personal-best single.');
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
    if (v === 'timer' && settings().input === 'typing') $('#time-input').focus();
  }

  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));
  $('#open-history').addEventListener('click', () => setView('history'));

  $('#puzzle-select').addEventListener('change', (e) => {
    const v = e.target.value;
    const s = session();
    if (!s.solves.length) {
      const isDefaultName = Object.values(PUZZLES).some((p) => p.name === s.name);
      s.puzzle = v;
      if (isDefaultName) s.name = uniqueName(PUZZLES[v].name);
      switchSession(s.id);
      return;
    }
    // Keep stats clean: a session holds one puzzle. Reuse or create one.
    const existing = db.sessions.filter((x) => x.puzzle === v).sort((x, y) => y.created - x.created)[0];
    if (existing) {
      switchSession(existing.id);
      toast(`Switched to session "${existing.name}"`);
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
  $('#theme-btn').addEventListener('click', () => {
    const dark = settings().theme === 'dark' || (settings().theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    settings().theme = dark ? 'light' : 'dark';
    save();
    applyTheme();
    if (currentView === 'history') renderHistory();
  });

  $('#next-scramble').addEventListener('click', () => {
    if (scr.idx < scr.list.length - 1) {
      scr.idx++;
      renderScramble();
    } else newScramble();
  });
  $('#prev-scramble').addEventListener('click', () => {
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
    db = load();
    applyTheme();
    applyMetroSettings();
    renderMetronome();
    compute();
    renderAll();
    showLastTime();
  });

  /* ================= Boot ================= */

  document.body.classList.add('at-timer');
  applyTheme();
  applyMetroSettings();
  renderMetronome();
  compute();
  resetScrambles();
  applyInputMode();
  renderAll();
  showLastTime();
  hint();
})();
