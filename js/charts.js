/*
 * Dependency-free SVG charts: a progress chart (singles + rolling averages)
 * and a histogram with a percentile box strip.
 */
(function (global) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function svgText(parent, x, y, text, attrs) {
    const t = svgEl('text', Object.assign({ x, y }, attrs), parent);
    t.textContent = text;
    return t;
  }

  function niceStep(span, count) {
    const raw = span / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  }

  function ticks(min, max, count) {
    if (!(max > min)) return [min];
    const step = niceStep(max - min, count);
    const out = [];
    for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(9));
    return out;
  }

  // Axis label for a time in ms, with as many decimals as the tick step needs.
  function axisTime(ms, step) {
    const dec = step >= 1000 ? 0 : step >= 100 ? 1 : 2;
    if (ms >= 60000) {
      const m = Math.floor(ms / 60000);
      const s = (ms - m * 60000) / 1000;
      const ss = s.toFixed(dec);
      return `${m}:${s < 10 ? '0' : ''}${ss}`;
    }
    return (ms / 1000).toFixed(dec);
  }

  function minMax(values) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of values) {
      if (v == null || !isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return [lo, hi];
  }

  /* ---------- Tooltip ---------- */

  function tipNode() {
    return document.getElementById('tooltip');
  }

  function showTip(clientX, clientY, build) {
    const t = tipNode();
    t.replaceChildren();
    build(t);
    t.hidden = false;
    const pad = 14;
    const r = t.getBoundingClientRect();
    let x = clientX + pad;
    if (x + r.width > window.innerWidth - 8) x = clientX - pad - r.width;
    let y = clientY + pad;
    if (y + r.height > window.innerHeight - 8) y = clientY - pad - r.height;
    t.style.left = Math.max(8, x) + 'px';
    t.style.top = Math.max(8, y) + 'px';
  }

  function hideTip() {
    const t = tipNode();
    if (t) t.hidden = true;
  }

  function tipHeader(t, text) {
    const h = document.createElement('div');
    h.className = 'tip-head';
    h.textContent = text;
    t.appendChild(h);
  }

  // key: 'line' | 'dot' | 'bar' | null
  function tipRow(t, { color, key, value, label }) {
    const row = document.createElement('div');
    row.className = 'tip-row';
    const k = document.createElement('span');
    k.className = 'tip-key' + (key ? ' tip-key-' + key : '');
    if (color) k.style.setProperty('--key', color);
    const v = document.createElement('strong');
    v.textContent = value;
    const l = document.createElement('span');
    l.className = 'tip-label';
    l.textContent = label;
    row.append(k, v, l);
    t.appendChild(row);
  }

  /* ---------- Progress chart ---------- */

  /*
   * model: {
   *   single: [ms | Infinity], numbers: [solve #], dates: [timestamp],
   *   series: [{ key, label, color, values: [ms | Infinity | null] }],
   *   pbs: Set(local index) - solves that set a new best single
   * }
   * opts: { visible: { key: bool }, format(ms, isAvg), onSelect(i), height }
   */
  function progress(container, model, opts) {
    container.replaceChildren();
    hideTip();
    const n = model.single.length;
    const W = Math.max(280, Math.floor(container.clientWidth));
    const H = opts.height || 320;
    const narrow = W < 520;
    const M = { t: 16, r: narrow ? 14 : 92, b: 30, l: 50 };
    const iw = W - M.l - M.r;
    const ih = H - M.t - M.b;

    const svg = svgEl('svg', {
      width: W,
      height: H,
      viewBox: `0 0 ${W} ${H}`,
      class: 'chart-svg',
      role: 'img',
      tabindex: '0',
      'aria-label': opts.ariaLabel || 'Progress chart',
    });
    container.appendChild(svg);

    const vis = opts.visible;
    const shown = model.series.filter((s) => vis[s.key]);
    let [lo, hi] = minMax([].concat(vis.single ? model.single : [], ...shown.map((s) => s.values)));
    if (!isFinite(lo)) [lo, hi] = minMax(model.single);
    if (!isFinite(lo)) {
      svgText(svg, W / 2, H / 2, n ? 'Only DNFs in this range' : 'No solves in this range', {
        class: 'chart-empty',
        'text-anchor': 'middle',
      });
      return null;
    }

    // Clamp far outliers so one bad solve doesn't flatten the chart; clipped
    // points are drawn as markers on the top edge.
    let clipped = false;
    if (vis.single && n >= 8) {
      const sorted = global.Stats.finite(model.single).sort((a, b) => a - b);
      const q1 = global.Stats.percentile(sorted, 0.25);
      const q3 = global.Stats.percentile(sorted, 0.75);
      const [, avgHi] = minMax([].concat(...shown.map((s) => s.values)));
      const cap = Math.max(q3 + 3 * (q3 - q1), isFinite(avgHi) ? avgHi : -Infinity);
      if (cap > lo && cap < hi) {
        hi = cap;
        clipped = true;
      }
    }
    if (hi - lo < 200) {
      hi += 500;
      lo = Math.max(0, lo - 500);
    }
    const pad = (hi - lo) * 0.06;
    lo = Math.max(0, lo - pad);
    hi += pad;

    const x = (i) => (n === 1 ? M.l + iw / 2 : M.l + (i / (n - 1)) * iw);
    const y = (v) => M.t + ih - ((Math.min(v, hi) - lo) / (hi - lo)) * ih;

    // Grid + y axis
    const grid = svgEl('g', { class: 'grid' }, svg);
    const yt = ticks(lo, hi, Math.max(3, Math.round(ih / 56)));
    const yStep = yt.length > 1 ? yt[1] - yt[0] : 1000;
    for (const v of yt) {
      svgEl('line', { x1: M.l, x2: M.l + iw, y1: y(v), y2: y(v), class: 'gridline' }, grid);
      svgText(grid, M.l - 8, y(v) + 4, axisTime(v, yStep), { class: 'tick', 'text-anchor': 'end' });
    }
    svgEl('line', { x1: M.l, x2: M.l + iw, y1: M.t + ih, y2: M.t + ih, class: 'baseline' }, grid);

    // X axis: solve numbers
    const first = model.numbers[0];
    const last = model.numbers[n - 1];
    const xt = ticks(first, last, Math.max(2, Math.round(iw / 90))).filter((k) => Number.isInteger(k));
    for (const k of xt) {
      svgText(grid, x(k - first), H - M.b + 18, String(k), { class: 'tick', 'text-anchor': 'middle' });
    }

    // Singles
    const dense = n > 60;
    const r = n > 400 ? 2 : n > 120 ? 2.75 : n > 60 ? 3.25 : 4;
    const dots = svgEl('g', { class: 'dots' + (dense ? ' dense' : '') }, svg);
    if (vis.single) {
      for (let i = 0; i < n; i++) {
        const v = model.single[i];
        if (v === Infinity) {
          svgText(dots, x(i), M.t + 4, '×', { class: 'dnf-mark', 'text-anchor': 'middle' });
          continue;
        }
        if (clipped && v > hi) {
          const cx = x(i);
          const cy = M.t + 2;
          svgEl('path', { d: `M${cx - 4},${cy + 6} L${cx},${cy} L${cx + 4},${cy + 6} Z`, class: 'dot-clipped' }, dots);
          continue;
        }
        const pb = model.pbs.has(i);
        svgEl('circle', { cx: x(i), cy: y(v), r: pb ? r + 1.5 : r, class: pb ? 'dot-single dot-pb' : 'dot-single' }, dots);
      }
    }

    // Rolling-average lines
    const lines = svgEl('g', { class: 'lines' }, svg);
    const ends = [];
    for (const s of shown) {
      let d = '';
      let pen = false;
      let lastI = -1;
      s.values.forEach((v, i) => {
        if (v == null || v === Infinity) {
          pen = false;
          return;
        }
        d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1);
        pen = true;
        lastI = i;
      });
      if (!d) continue;
      const p = svgEl('path', { d, class: 'series-line' }, lines);
      p.style.stroke = s.color;
      if (lastI >= 0) ends.push({ s, i: lastI, v: s.values[lastI] });
    }

    // End dots + selective direct labels (dropped when they would collide;
    // the legend and tooltip carry the identity then).
    const endG = svgEl('g', { class: 'ends' }, svg);
    for (const e of ends) {
      const c = svgEl('circle', { cx: x(e.i), cy: y(e.v), r: 4, class: 'end-dot' }, endG);
      c.style.fill = e.s.color;
    }
    if (!narrow) {
      let lastY = -Infinity;
      ends
        .filter((e) => e.i === n - 1)
        .sort((a, b) => y(a.v) - y(b.v))
        .forEach((e) => {
          const ly = y(e.v);
          if (ly - lastY < 14) return;
          lastY = ly;
          const t = svgEl('text', { x: M.l + iw + 10, y: ly + 4, class: 'end-label' }, endG);
          const name = svgEl('tspan', { class: 'end-name' }, t);
          name.textContent = e.s.label + ' ';
          const val = svgEl('tspan', {}, t);
          val.textContent = opts.format(e.v, true);
        });
    }

    // Hover layer: crosshair snaps to the nearest solve.
    const cross = svgEl('line', { y1: M.t, y2: M.t + ih, class: 'crosshair', visibility: 'hidden' }, svg);
    const marks = svgEl('g', { class: 'hover-marks' }, svg);
    const overlay = svgEl(
      'rect',
      { x: M.l - 8, y: M.t - 8, width: iw + 16, height: ih + 16, class: 'overlay' },
      svg
    );
    let current = -1;

    function clientPoint(i, v) {
      const rect = svg.getBoundingClientRect();
      const sx = rect.width / W;
      return [rect.left + x(i) * sx, rect.top + (v != null && isFinite(v) ? y(v) : M.t + ih / 2) * sx];
    }

    function focusIndex(i, cx, cy) {
      current = i;
      cross.setAttribute('x1', x(i));
      cross.setAttribute('x2', x(i));
      cross.setAttribute('visibility', 'visible');
      marks.replaceChildren();
      const sv = model.single[i];
      if (vis.single && isFinite(sv) && !(clipped && sv > hi)) {
        svgEl('circle', { cx: x(i), cy: y(sv), r: Math.max(r + 2, 5), class: 'hover-dot single' }, marks);
      }
      for (const s of shown) {
        const v = s.values[i];
        if (v == null || v === Infinity) continue;
        const c = svgEl('circle', { cx: x(i), cy: y(v), r: 5, class: 'hover-dot' }, marks);
        c.style.fill = s.color;
      }
      if (cx == null) [cx, cy] = clientPoint(i, sv);
      showTip(cx, cy, (t) => {
        const date = new Date(model.dates[i]);
        tipHeader(t, `Solve #${model.numbers[i]} · ${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
        tipRow(t, {
          color: 'var(--single)',
          key: 'dot',
          value: opts.formatSolve(i),
          label: model.pbs.has(i) ? 'single · new PB' : 'single',
        });
        for (const s of model.series) {
          const v = s.values[i];
          if (v == null) continue;
          tipRow(t, { color: s.color, key: 'line', value: opts.format(v, true), label: s.label });
        }
      });
    }

    function clear() {
      current = -1;
      cross.setAttribute('visibility', 'hidden');
      marks.replaceChildren();
      hideTip();
    }

    function indexAt(clientX) {
      const rect = svg.getBoundingClientRect();
      const px = (clientX - rect.left) * (W / rect.width);
      if (n === 1) return 0;
      return Math.max(0, Math.min(n - 1, Math.round(((px - M.l) / iw) * (n - 1))));
    }

    overlay.addEventListener('pointermove', (e) => focusIndex(indexAt(e.clientX), e.clientX, e.clientY));
    overlay.addEventListener('pointerleave', clear);
    overlay.addEventListener('click', (e) => opts.onSelect && opts.onSelect(indexAt(e.clientX)));
    svg.addEventListener('focus', () => focusIndex(current >= 0 ? current : n - 1));
    svg.addEventListener('blur', clear);
    svg.addEventListener('keydown', (e) => {
      let i = current >= 0 ? current : n - 1;
      if (e.key === 'ArrowLeft') i = Math.max(0, i - 1);
      else if (e.key === 'ArrowRight') i = Math.min(n - 1, i + 1);
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = n - 1;
      else if (e.key === 'Enter') {
        if (opts.onSelect) opts.onSelect(i);
        return;
      } else return;
      e.preventDefault();
      focusIndex(i);
    });
    return { clipped };
  }

  /* ---------- Histogram ---------- */

  /*
   * dist: Stats.distribution() result; sum: Stats.summary() result.
   * opts: { format(ms), color, onHover(binIndex | null), height }
   */
  function histogram(container, dist, sum, opts) {
    container.replaceChildren();
    hideTip();
    const bins = dist.bins;
    const W = Math.max(280, Math.floor(container.clientWidth));
    const H = opts.height || 300;
    const M = { t: 40, r: 16, b: 78, l: 52 };
    const iw = W - M.l - M.r;
    const ih = H - M.t - M.b;
    const svg = svgEl('svg', {
      width: W,
      height: H,
      viewBox: `0 0 ${W} ${H}`,
      class: 'chart-svg',
      role: 'img',
      'aria-label': opts.ariaLabel || 'Histogram of solve times',
    });
    container.appendChild(svg);
    if (!bins.length) {
      svgText(svg, W / 2, H / 2, 'No completed solves in this range', { class: 'chart-empty', 'text-anchor': 'middle' });
      return { highlight() {} };
    }

    const w = dist.width;
    const regular = bins.filter((b) => !b.overflow);
    const x0 = regular[0].lo;
    const x1 = regular[regular.length - 1].hi;
    const hasOverflow = bins.length > regular.length;
    const units = x1 - x0 + (hasOverflow ? w * 1.6 : 0);
    const xs = (v) => M.l + ((Math.max(x0, Math.min(v, x1)) - x0) / units) * iw;
    const binX = (b) => (b.overflow ? [xs(x1) + (0.6 * w * iw) / units, M.l + iw] : [xs(b.lo), xs(b.hi)]);
    const maxCount = Math.max(...bins.map((b) => b.count));
    const yt = ticks(0, maxCount, Math.max(2, Math.round(ih / 44))).filter((v) => Number.isInteger(v));
    const yMax = Math.max(maxCount, yt[yt.length - 1] || 1);
    const y = (c) => M.t + ih - (c / yMax) * ih;

    const grid = svgEl('g', { class: 'grid' }, svg);
    for (const v of yt) {
      svgEl('line', { x1: M.l, x2: M.l + iw, y1: y(v), y2: y(v), class: 'gridline' }, grid);
      svgText(grid, M.l - 8, y(v) + 4, String(v), { class: 'tick', 'text-anchor': 'end' });
    }

    // Bars: 2px surface gap between neighbours, 4px rounded data end.
    const barsG = svgEl('g', { class: 'bars' }, svg);
    const barEls = bins.map((b) => {
      if (!b.count) return null;
      const [a, z] = binX(b);
      const bx = a + 1;
      const bw = Math.max(1, z - a - 2);
      const top = y(b.count);
      const h = M.t + ih - top;
      const rr = Math.min(4, bw / 2, h);
      const d =
        `M${bx},${M.t + ih} L${bx},${top + rr} Q${bx},${top} ${bx + rr},${top} ` +
        `L${bx + bw - rr},${top} Q${bx + bw},${top} ${bx + bw},${top + rr} L${bx + bw},${M.t + ih} Z`;
      const p = svgEl('path', { d, class: 'bar' + (b.overflow ? ' bar-overflow' : '') }, barsG);
      p.style.fill = opts.color;
      return p;
    });
    svgEl('line', { x1: M.l, x2: M.l + iw, y1: M.t + ih, y2: M.t + ih, class: 'baseline' }, grid);

    // X tick labels on bin edges, thinned so they never collide.
    const binPx = (w / units) * iw;
    const every = Math.max(1, Math.ceil(44 / binPx));
    const xStep = w * every;
    regular.forEach((b, i) => {
      if (i % every === 0) svgText(grid, xs(b.lo), M.t + ih + 16, axisTime(b.lo, xStep), { class: 'tick', 'text-anchor': 'middle' });
    });
    if (regular.length % every === 0) svgText(grid, xs(x1), M.t + ih + 16, axisTime(x1, xStep), { class: 'tick', 'text-anchor': 'middle' });
    if (hasOverflow) {
      const [a, z] = binX(bins[bins.length - 1]);
      svgText(grid, (a + z) / 2, M.t + ih + 16, '≥' + axisTime(x1, xStep), { class: 'tick', 'text-anchor': 'middle' });
    }

    // Mean & median reference lines with labels pointing away from each other.
    const refs = [
      { key: 'median', v: sum.median },
      { key: 'mean', v: sum.mean },
    ]
      .filter((r) => r.v != null && r.v <= x1)
      .sort((a, b) => a.v - b.v);
    const refG = svgEl('g', { class: 'refs' }, svg);
    refs.forEach((r, k) => {
      const rx = xs(r.v);
      let leftSide = refs.length === 2 ? k === 0 : rx > M.l + iw * 0.7;
      // Rough label width; if it would run off the chart, flip it and lift it
      // a row so it can't collide with the other label.
      const est = (r.key.length + 1 + opts.format(r.v, true).length) * 6.4;
      let ly = M.t - 10;
      if (leftSide ? rx - 5 - est < 0 : rx + 5 + est > W) {
        leftSide = !leftSide;
        ly -= 14;
      }
      svgEl('line', { x1: rx, x2: rx, y1: ly + 4, y2: M.t + ih, class: 'ref-line' }, refG);
      const t = svgText(refG, rx + (leftSide ? -5 : 5), ly, '', {
        class: 'ref-label',
        'text-anchor': leftSide ? 'end' : 'start',
      });
      const nm = svgEl('tspan', { class: 'ref-name' }, t);
      nm.textContent = r.key + ' ';
      const vv = svgEl('tspan', {}, t);
      vv.textContent = opts.format(r.v, true);
    });

    // Percentile strip (box plot): whiskers P10–P90, box P25–P75, median tick.
    const by = H - 22;
    const boxG = svgEl('g', { class: 'boxplot' }, svg);
    if (sum.p10 != null) {
      svgText(boxG, M.l - 8, by + 4, 'P10–90', { class: 'tick', 'text-anchor': 'end' });
      const wx1 = xs(sum.p10);
      const wx2 = xs(sum.p90);
      svgEl('line', { x1: wx1, x2: wx2, y1: by, y2: by, class: 'whisker' }, boxG);
      svgEl('line', { x1: wx1, x2: wx1, y1: by - 5, y2: by + 5, class: 'whisker' }, boxG);
      svgEl('line', { x1: wx2, x2: wx2, y1: by - 5, y2: by + 5, class: 'whisker' }, boxG);
      const bx1 = xs(sum.p25);
      const bx2 = xs(sum.p75);
      const box = svgEl('rect', { x: bx1, y: by - 7, width: Math.max(2, bx2 - bx1), height: 14, rx: 3, class: 'box' }, boxG);
      box.style.fill = opts.color;
      svgEl('line', { x1: xs(sum.median), x2: xs(sum.median), y1: by - 9, y2: by + 9, class: 'box-median' }, boxG);
      const hit = svgEl('rect', { x: M.l, y: by - 14, width: iw, height: 28, class: 'overlay' }, boxG);
      hit.addEventListener('pointermove', (e) =>
        showTip(e.clientX, e.clientY, (t) => {
          tipHeader(t, `Percentiles · ${sum.valid} completed solves`);
          for (const [k, label] of [
            ['p10', '10th percentile'],
            ['p25', '25th percentile'],
            ['median', 'median'],
            ['p75', '75th percentile'],
            ['p90', '90th percentile'],
          ]) {
            tipRow(t, { value: opts.format(sum[k], true), label });
          }
        })
      );
      hit.addEventListener('pointerleave', hideTip);
    }

    // Per-bin hit targets (full plot height, wider than the bar).
    let active = -1;
    function highlight(i) {
      if (active >= 0 && barEls[active]) barEls[active].classList.remove('active');
      active = i == null ? -1 : i;
      if (active >= 0 && barEls[active]) barEls[active].classList.add('active');
      barsG.classList.toggle('has-active', active >= 0 && !!barEls[active]);
    }
    const hits = svgEl('g', {}, svg);
    bins.forEach((b, i) => {
      const [a, z] = binX(b);
      const hit = svgEl('rect', { x: a, y: M.t - 6, width: Math.max(1, z - a), height: ih + 6, class: 'overlay' }, hits);
      hit.addEventListener('pointermove', (e) => {
        highlight(i);
        if (opts.onHover) opts.onHover(i);
        showTip(e.clientX, e.clientY, (t) => {
          tipHeader(t, opts.rangeLabel(b));
          tipRow(t, { color: opts.color, key: 'bar', value: `${b.count} solve${b.count === 1 ? '' : 's'}`, label: `${(b.share * 100).toFixed(1)}% of completed` });
          if (!b.overflow) tipRow(t, { value: `${(b.cum * 100).toFixed(1)}%`, label: `sub-${opts.format(b.hi, true)}` });
        });
      });
      hit.addEventListener('pointerleave', () => {
        highlight(null);
        if (opts.onHover) opts.onHover(null);
        hideTip();
      });
    });

    return { highlight };
  }

  global.Charts = { progress, histogram, hideTip };
})(window);
