/*
 * Metronome engine, independent of the solve timer.
 *
 * Uses the Web Audio "look-ahead" pattern: a light ticker wakes every 25 ms and
 * schedules any clicks due in the next 120 ms on the audio clock, so beats stay
 * sample-accurate no matter what the page is doing (timer redraws, charts...).
 */
(function (global) {
  'use strict';

  const TICK_MS = 25;
  const SCHEDULE_AHEAD = 0.12; // seconds
  const MIN_BPM = 30;
  const MAX_BPM = 300;

  const SOUNDS = {
    click: { type: 'square', freq: 1000, accent: 1600, dur: 0.03, gain: 0.35 },
    beep: { type: 'sine', freq: 880, accent: 1320, dur: 0.09, gain: 0.7 },
    wood: { type: 'triangle', freq: 1100, accent: 1500, dur: 0.06, gain: 1, drop: 0.5 },
  };

  // A worker keeps ticking in a background tab (main-thread timers are
  // throttled to ~1 Hz there). Falls back to setInterval where workers from
  // blob URLs aren't allowed.
  function createTicker(onTick) {
    try {
      const src = 'let id=0;onmessage=e=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data)}';
      const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      w.onmessage = onTick;
      return { start: () => w.postMessage(TICK_MS), stop: () => w.postMessage(0) };
    } catch {
      let id = 0;
      return {
        start: () => {
          clearInterval(id);
          id = setInterval(onTick, TICK_MS);
        },
        stop: () => clearInterval(id),
      };
    }
  }

  const clampBpm = (v) => Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(v) || MIN_BPM));

  class Metronome {
    constructor() {
      this.bpm = 100;
      this.beats = 4; // accent every N beats; 1 = no accent
      this.sound = 'click';
      this.volume = 0.7;
      this.playing = false;
      this.onBeat = null; // (beatIndex | -1) => void, called in sync with the audio
      this.ctx = null;
      this.master = null;
      this.queue = [];
      this.ticker = createTicker(() => this._schedule());
    }

    // Create/resume the audio context. Call from a user gesture (click, key)
    // so the browser's autoplay policy allows sound.
    prime() {
      try {
        if (!this.ctx) {
          this.ctx = new (global.AudioContext || global.webkitAudioContext)();
          this.master = this.ctx.createGain();
          this.master.gain.value = this.volume;
          this.master.connect(this.ctx.destination);
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return true;
      } catch {
        return false;
      }
    }

    start() {
      if (this.playing || !this.prime()) return;
      this.playing = true;
      this.beat = 0;
      this.nextTime = this.ctx.currentTime + 0.05;
      this._schedule();
      this.ticker.start();
      this._frame();
    }

    stop() {
      if (!this.playing) return;
      this.playing = false;
      this.ticker.stop();
      this.queue = [];
      if (this.onBeat) this.onBeat(-1);
    }

    toggle() {
      if (this.playing) this.stop();
      else this.start();
    }

    setBpm(v) {
      this.bpm = clampBpm(v); // takes effect from the next beat
    }

    setVolume(v) {
      this.volume = Math.min(1, Math.max(0, v));
      if (this.master) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.01);
    }

    _schedule() {
      if (!this.playing) return;
      const now = this.ctx.currentTime;
      // After a long stall (suspended tab, sleep) resync instead of bursting.
      if (this.nextTime < now - 0.2) this.nextTime = now + 0.05;
      while (this.nextTime < now + SCHEDULE_AHEAD) {
        const bar = Math.max(1, this.beats);
        const pos = this.beat % bar;
        this._click(this.nextTime, bar > 1 && pos === 0);
        this.queue.push({ t: this.nextTime, pos });
        this.nextTime += 60 / this.bpm;
        this.beat++;
      }
    }

    _click(t, accent) {
      const s = SOUNDS[this.sound] || SOUNDS.click;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const f = accent ? s.accent : s.freq;
      o.type = s.type;
      o.frequency.setValueAtTime(f, t);
      if (s.drop) o.frequency.exponentialRampToValueAtTime(f * s.drop, t + s.dur);
      const peak = s.gain * (accent ? 1 : 0.65);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + s.dur);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + s.dur + 0.01);
    }

    // Fire onBeat when each scheduled click actually sounds.
    _frame() {
      if (!this.playing) return;
      const now = this.ctx.currentTime;
      let last = null;
      while (this.queue.length && this.queue[0].t <= now) last = this.queue.shift();
      if (last && this.onBeat) this.onBeat(last.pos);
      requestAnimationFrame(() => this._frame());
    }
  }

  Metronome.MIN_BPM = MIN_BPM;
  Metronome.MAX_BPM = MAX_BPM;
  Metronome.SOUNDS = Object.keys(SOUNDS);
  global.Metronome = Metronome;
})(window);
