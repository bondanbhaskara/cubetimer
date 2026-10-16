/*
 * Statistics: WCA-style averages, rolling averages, distributions,
 * percentiles and time formatting.
 *
 * A solve is { t: ms, p: penalty (0 = OK, 1 = +2, 2 = DNF), s: scramble, d: timestamp, c?: comment }.
 * DNF is represented as Infinity in "effective time" arrays.
 */
(function (global) {
  'use strict';

  const PEN_OK = 0;
  const PEN_PLUS2 = 1;
  const PEN_DNF = 2;

  function effective(solve) {
    if (solve.p === PEN_DNF) return Infinity;
    return solve.t + (solve.p === PEN_PLUS2 ? 2000 : 0);
  }

  // Number of results trimmed from each end: 1 for ao5/ao12, 5% for larger
  // averages (ao50 -> 3, ao100 -> 5). Means (mo3) trim nothing.
  function trimCount(n, isMean) {
    return isMean ? 0 : Math.ceil(n * 0.05);
  }

  // Average of exactly the given results. Returns Infinity for a DNF average.
  function averageOf(times, isMean) {
    const n = times.length;
    if (!n) return null;
    const trim = trimCount(n, isMean);
    const sorted = times.slice().sort((a, b) => a - b);
    const dnfs = sorted.filter((t) => t === Infinity).length;
    if (dnfs > trim) return Infinity;
    let sum = 0;
    for (let i = trim; i < n - trim; i++) sum += sorted[i];
    return sum / (n - 2 * trim);
  }

  function lowerBound(arr, v) {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  // Rolling average of size n over every position. out[i] is the average of
  // times[i-n+1..i], or null when fewer than n results exist.
  function rolling(times, n, isMean) {
    const out = new Array(times.length).fill(null);
    if (n > times.length) return out;
    const trim = trimCount(n, isMean);
    const win = [];
    for (let i = 0; i < times.length; i++) {
      win.splice(lowerBound(win, times[i]), 0, times[i]);
      if (i >= n) win.splice(lowerBound(win, times[i - n]), 1);
      if (i < n - 1) continue;
      let dnfs = 0;
      for (let k = n - 1; k >= 0 && win[k] === Infinity; k--) dnfs++;
      if (dnfs > trim) {
        out[i] = Infinity;
        continue;
      }
      let sum = 0;
      for (let k = trim; k < n - trim; k++) sum += win[k];
      out[i] = sum / (n - 2 * trim);
    }
    return out;
  }

  // Index of the smallest non-null value (ties -> earliest).
  function bestIndex(values, from = 0, to = values.length) {
    let best = -1;
    for (let i = from; i < to; i++) {
      const v = values[i];
      if (v == null) continue;
      if (best < 0 || v < values[best]) best = i;
    }
    return best;
  }

  function finite(times) {
    return times.filter((t) => t !== Infinity && t != null);
  }

  function mean(values) {
    if (!values.length) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  function stdDev(values) {
    if (values.length < 2) return null;
    const m = mean(values);
    const v = values.reduce((a, b) => a + (b - m) * (b - m), 0) / (values.length - 1);
    return Math.sqrt(v);
  }

  // Linear-interpolated percentile of a sorted array (p in 0..1).
  function percentile(sorted, p) {
    if (!sorted.length) return null;
    if (sorted.length === 1) return sorted[0];
    const pos = (sorted.length - 1) * p;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  const NICE_BIN_WIDTHS = [100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 15000, 30000, 60000, 120000, 300000];

  // Bin width giving a readable number of bins (6..24, growing with sample
  // size) over [lo, hi], snapped to a "nice" value in ms.
  function autoBinWidth(n, lo, hi) {
    const span = hi - lo;
    if (n < 2 || !(span > 0)) return 1000;
    const target = Math.max(6, Math.min(24, Math.round(Math.sqrt(n) * 1.5)));
    const raw = span / target;
    return NICE_BIN_WIDTHS.find((x) => x >= raw) || NICE_BIN_WIDTHS[NICE_BIN_WIDTHS.length - 1];
  }

  // Histogram of non-DNF times. Returns bins [lo, hi) with counts and shares.
  // Far outliers (beyond Q3 + 3·IQR, at most 5% of solves) are collected in a
  // final overflow bin so one bad solve doesn't flatten the whole histogram.
  function distribution(times, binWidth) {
    const sorted = finite(times).sort((a, b) => a - b);
    const dnf = times.length - sorted.length;
    const n = sorted.length;
    if (!n) return { bins: [], total: 0, dnf, sorted, width: binWidth || 1000 };
    const min = sorted[0];
    let top = sorted[n - 1];
    if (n >= 10) {
      const q1 = percentile(sorted, 0.25);
      const q3 = percentile(sorted, 0.75);
      const fence = q3 + 3 * (q3 - q1);
      if (fence > min && fence < top && sorted.filter((t) => t > fence).length <= Math.max(1, n * 0.05)) top = fence;
    }
    let w = binWidth === 'auto' || !binWidth ? autoBinWidth(n, min, top) : binWidth;
    // Never produce an absurd number of bins for a manual width.
    while ((top - min) / w > 60) w *= 2;
    const start = Math.floor(min / w) * w;
    const end = Math.floor(top / w) * w + w;
    const bins = [];
    for (let lo = start; lo < end - 1e-9; lo += w) bins.push({ lo, hi: lo + w, count: 0 });
    const overflow = { lo: end, hi: Infinity, count: 0, overflow: true };
    for (const t of sorted) {
      if (t >= end) overflow.count++;
      else bins[Math.floor((t - start) / w)].count++;
    }
    if (overflow.count) bins.push(overflow);
    let cum = 0;
    for (const b of bins) {
      cum += b.count;
      b.share = b.count / n;
      b.cum = cum / n; // share of solves under b.hi ("sub-X")
    }
    return { bins, total: n, dnf, sorted, width: w };
  }

  function summary(times) {
    const sorted = finite(times).sort((a, b) => a - b);
    const n = times.length;
    const q = (p) => percentile(sorted, p);
    const m = mean(sorted);
    const sd = stdDev(sorted);
    return {
      count: n,
      valid: sorted.length,
      dnf: n - sorted.length,
      best: sorted.length ? sorted[0] : null,
      worst: sorted.length ? sorted[sorted.length - 1] : null,
      mean: m,
      sd,
      cv: m && sd != null ? sd / m : null,
      p5: q(0.05),
      p10: q(0.1),
      p25: q(0.25),
      median: q(0.5),
      p75: q(0.75),
      p90: q(0.9),
      p95: q(0.95),
    };
  }

  // Least-squares slope of finite times against solve index (ms per solve).
  function trendSlope(times) {
    const pts = [];
    times.forEach((t, i) => {
      if (t !== Infinity && t != null) pts.push([i, t]);
    });
    if (pts.length < 5) return null;
    const mx = mean(pts.map((p) => p[0]));
    const my = mean(pts.map((p) => p[1]));
    let num = 0;
    let den = 0;
    for (const [x, y] of pts) {
      num += (x - mx) * (y - my);
      den += (x - mx) * (x - mx);
    }
    return den ? num / den : null;
  }

  /* ---------- Formatting ---------- */

  // Singles are truncated (WCA), averages rounded.
  function formatTime(ms, opts = {}) {
    if (ms == null || Number.isNaN(ms)) return '–';
    if (ms === Infinity) return 'DNF';
    const prec = opts.precision === 3 ? 3 : opts.precision === 1 ? 1 : 2;
    const unit = Math.pow(10, 3 - prec);
    const v = opts.round ? Math.round(ms / unit) : Math.floor(ms / unit + 1e-9);
    const perSec = 1000 / unit;
    const total = Math.floor(v / perSec);
    const frac = String(v % perSec).padStart(prec, '0');
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const ss = String(s).padStart(2, '0');
    if (h) return `${h}:${String(m).padStart(2, '0')}:${ss}.${frac}`;
    if (m) return `${m}:${ss}.${frac}`;
    return `${s}.${frac}`;
  }

  function formatSolve(solve, opts = {}) {
    if (solve.p === PEN_DNF) return opts.raw ? `DNF(${formatTime(solve.t, opts)})` : 'DNF';
    if (solve.p === PEN_PLUS2) return formatTime(solve.t + 2000, opts) + '+';
    return formatTime(solve.t, opts);
  }

  // Parse typed input: "12.34", "1:02.34", "1234" (-> 12.34), "DNF",
  // "12.34+" (12.34 with a +2 penalty).
  function parseTime(text) {
    let s = String(text).trim().toUpperCase();
    if (!s) return null;
    if (s === 'DNF') return { t: 0, p: PEN_DNF };
    let p = PEN_OK;
    if (s.endsWith('+')) {
      p = PEN_PLUS2;
      s = s.slice(0, -1);
    }
    let ms;
    if (/^\d+$/.test(s)) {
      // Digits only: last two are centiseconds, then seconds, then minutes.
      const d = s.padStart(3, '0');
      const cs = +d.slice(-2);
      const rest = d.slice(0, -2);
      const sec = +rest.slice(-2);
      const min = +(rest.slice(0, -2) || 0);
      ms = min * 60000 + sec * 1000 + cs * 10;
    } else if (/^(\d+:){0,2}\d+(\.\d+)?$/.test(s)) {
      const parts = s.split(':').map(Number);
      ms = Math.round(parts.reduce((acc, v) => acc * 60 + v, 0) * 1000);
    } else {
      return null;
    }
    if (!(ms > 0)) return null;
    return { t: ms, p };
  }

  global.Stats = {
    PEN_OK,
    PEN_PLUS2,
    PEN_DNF,
    effective,
    trimCount,
    averageOf,
    rolling,
    bestIndex,
    finite,
    mean,
    stdDev,
    percentile,
    distribution,
    summary,
    trendSlope,
    formatTime,
    formatSolve,
    parseTime,
  };
})(typeof window !== 'undefined' ? window : globalThis);
