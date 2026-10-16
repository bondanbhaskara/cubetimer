# Cube Timer

A speedcubing timer in the spirit of cubetimer.com, with a full **History & stats**
view: progress chart, histogram, distribution table, percentiles and per-day stats.

No build step and no dependencies. Open `index.html` in a browser (double-click works),
or serve the folder:

```bash
python3 -m http.server 8080 --directory ~/cube-timer
```

## Timer
- Hold **Space** (or touch and hold the timer on mobile) until the time turns green, release to start; any key stops. **Esc** cancels.
- Optional WCA inspection: 15 s countdown, beeps at 8 s / 12 s, automatic +2 after 15 s and DNF after 17 s.
- Typing mode for entering times from a stackmat: `12.34`, `1234`, `1:02.34`, `DNF`, `12.34+`.
- Scrambles for 2x2–7x7, 3x3 OH/BLD, Pyraminx, Skewb, Megaminx and Clock, with a cube-net preview for NxN.
- Sessions (one puzzle per session); +2 / DNF / comments per solve; Alt+1/2/3 sets penalty on the last solve, Alt+Z deletes it.
- Stats: single, mo3, ao5, ao12, ao50, ao100, ao1000 (current and best), using WCA rules: the best/worst 5% are trimmed (1 each for ao5/ao12), and if more solves are DNF than get trimmed, the average is a DNF.

## Metronome
Click the metronome icon in the top bar (or press **M** to start/stop from anywhere). The metronome runs separately from the timer, so it keeps playing between solves and in the History view.
- 30–300 BPM: use the slider, the −/+ buttons, type a number, or tap a tempo with **Tap**. The panel also shows beats per second, so you can practise a steady turning speed (TPS).
- Accent every 2/3/4/6 beats, three sounds (click, beep, wood block), and volume.
- *Auto-play during solves only*: the metronome starts when a solve starts and stops when it ends.
- Clicks are scheduled on the Web Audio clock, so the beat stays steady while the timer is running.

## History & stats
Filter by range (all, today, last 7/30 days, last N solves). Every section below follows the filter.
- **KPIs**: count and DNF rate, best single, mean ± σ, median and middle-50% range, best ao5/ao12, consistency (σ/mean), and trend (seconds gained per 100 solves).
- **Progress chart**: every solve as a dot, ao5/ao12/ao100 as lines (click the legend to toggle). New PB singles are marked. Hover, or focus the chart and use ←/→, to read values; click a point to open that solve.
- **Histogram** with mean/median markers and a P10–P90 box strip. Bin width is automatic or chosen by you. Extreme outliers go into a final "≥ X" bin.
- **Distribution table**: count, share and cumulative "sub-X" % for each bin. Hovering a row highlights its bar, and hovering a bar highlights its row.
- **Percentiles & spread**, **averages** (current/best/worst in range) and a **by-day** table.

## Data
Everything is saved in the browser's localStorage. Use Settings → Export to back it up as JSON, and Import to restore it.
Settings → *Add demo session* creates 420 realistic solves so you can try the charts.

## Notes
- Scrambles are random-move, not random-state like official WCA TNoodle scrambles. They are fine for practice.
- Fonts: the timer uses **DSEG7 Classic Bold Italic** by keshikan (SIL Open Font License 1.1, bundled in `fonts/` with `DSEG-LICENSE.txt`). The rest of the UI uses **Roboto** from Google Fonts.
- Files: `js/scramble.js` (scramblers + cube simulator), `js/stats.js` (averages, distribution),
  `js/charts.js` (SVG charts), `js/metronome.js` (metronome audio engine), `js/app.js` (UI and timer), `css/style.css`.
