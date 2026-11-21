# Cube Timer

A speedcubing timer in the spirit of cubetimer.com, with a full **History & stats**
view: progress chart, histogram, distribution table, percentiles and per-day stats.

No build step. Open `index.html` in a browser (double-click works for manual timing),
or serve the folder:

```bash
python3 -m http.server 8080 --bind 127.0.0.1
```

## Timer
- Hold **Space** (or touch and hold the timer on mobile) until the time turns green, release to start; any key stops. **Esc** cancels.
- Optional WCA inspection: 15 s countdown, beeps at 8 s / 12 s, automatic +2 after 15 s and DNF after 17 s.
- Typing mode for entering times from a stackmat: `12.34`, `1234`, `1:02.34`, `DNF`, `12.34+`.
- Scrambles for 2x2–7x7, 3x3 OH/BLD, Pyraminx, Skewb, Megaminx and Clock, with a cube-net preview for NxN.
- Sessions (one puzzle per session); +2 / DNF / comments per solve; Alt+1/2/3 sets penalty on the last solve, Alt+Z deletes it.
- Stats: single, mo3, ao5, ao12, ao50, ao100, ao1000 (current and best), using WCA rules: the best/worst 5% are trimmed (1 each for ao5/ao12), and if more solves are DNF than get trimmed, the average is a DNF.

## GAN smart cube

1. Open [localhost:8080](http://localhost:8080) after starting the server above from the repository, or open the app over HTTPS. Use Chrome or Edge with Web Bluetooth enabled. [Chrome’s platform and setup guide](https://developer.chrome.com/docs/capabilities/bluetooth#before-we-start).
2. Close CubeStation and turn the white face to wake the GAN iCarry 4. In a **3x3** or **3x3 One-Handed** session with Timer input selected, click **Connect smart cube**, then **Choose cube**. If the browser cannot read the cube’s Bluetooth address, enter the six-byte MAC address and retry. [GAN’s iCarry 4 instructions](https://www.gancube.com/collections/i-carry-series).
3. Start with a solved cube and follow the scramble with white on top and green in front. Once the app recognizes the scramble, the first turn starts the timer and the turn that solves the cube saves the time to the current session. If inspection is enabled, it starts as soon as the scramble matches. Press **Esc** to cancel, or select **Disconnect cube** to go back to manual timing.

The connection dialog loads [gan-web-bluetooth 3.0.2](https://github.com/afedotov/gan-web-bluetooth) from jsDelivr. The driver detects GAN Gen2, Gen3, and Gen4 services. The iCarry 4 still needs a physical-device test.

## Metronome
Click the metronome icon in the top bar (or press **M** to start/stop from anywhere). The metronome runs separately from the timer, so it keeps playing between solves and in the History view.
- 30–300 BPM: use the slider, the −/+ buttons, type a number, or tap a tempo with **Tap**. The panel also shows beats per second, so you can practise a steady turning speed (TPS).
- Accent every 2/3/4/6 beats, three sounds (click, beep, wood block), and volume.
- *Auto-play during solves only*: the metronome starts when a solve starts and stops when it ends.
- Clicks are scheduled on the Web Audio clock, so the beat stays steady while the timer is running.

## Color schemes
Click the half-circle icon in the top bar to open the scheme chooser, or use Settings → Color scheme. Each card shows a live preview of that scheme.
- **Basic, Pro, Homebrew, Ocean, Grass, Red Sands, Man Page, Novel, Silver Aerogel**, named after the macOS Terminal profiles.
- **SpeedStacks**: a blue and yellow scheme where the timer is drawn as an LCD panel in a dark bezel. A red LED lights while you hold and a green LED when you're ready, like the real timer.
- **Competition**: modeled on the oval competition display board. It has a blue rim, a dark face, upright glowing red LED digits in a fixed-width module that shows all unlit `8:88.88` segments, and a **CUBETIMER** logo underneath. It has the same red/green hold and ready LEDs.
- *Match system light/dark* follows your OS setting, using Basic or Pro.
- For each scheme, the chart line colors were checked for color-blind separation and contrast against that scheme's own background. Text, timer and LED colors were contrast-checked too.

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
- Files: `js/scramble.js` (scramblers + cube simulator), `js/smart-cube.js` (GAN connection and cube state),
  `js/stats.js` (averages, distribution), `js/charts.js` (SVG charts), `js/metronome.js` (metronome audio engine),
  `js/app.js` (UI and timer), `css/style.css` (layout), `css/themes.css` (color schemes).
