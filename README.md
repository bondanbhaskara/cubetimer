# Cube Timer

Cube Timer is a speedcubing timer you can use with a keyboard, a touchscreen, recorded times from a physical timer, or a GAN Bluetooth smart cube. It runs in the browser and includes session statistics, move-by-move replays, CFOP splits, algorithm drills, a metronome, and an optional AI coach.

- [Get started](#get-started)
- [Time a solve](#time-a-solve)
- [Connect a GAN smart cube](#connect-a-gan-smart-cube)
- [Analyze and replay a smart-cube solve](#analyze-and-replay-a-smart-cube-solve)
- [Practice algorithms](#practice-algorithms)
- [Read History & stats](#read-history--stats)
- [Configure the AI coach](#configure-the-ai-coach)
- [Manage sessions and backups](#manage-sessions-and-backups)
- [Use the metronome and color schemes](#use-the-metronome-and-color-schemes)
- [Keyboard shortcuts](#keyboard-shortcuts)

## Get started

Use an HTTPS-hosted copy of the app, or use Git and Python 3 to run a local copy.

```bash
git clone https://github.com/bondanbhaskara/cubetimer.git
cd cubetimer
python3 -m http.server 8080 --bind 127.0.0.1
```

Open [http://localhost:8080](http://localhost:8080). There is no build step. You can also double-click `index.html` for manual timing. For Bluetooth, use localhost or HTTPS in a browser and on a platform with Web Bluetooth support. [Chrome Web Bluetooth requirements](https://developer.chrome.com/docs/capabilities/bluetooth#before-we-start)

Choose a **Puzzle** and **Session** in the top bar. The default session is **3x3**. To explore example charts before recording a solve, select **Settings → Add demo session**. It creates a separate session with 420 example times.

## Time a solve

1. In **Timer**, apply the scramble at the top of the screen. Use the previous and next arrows to browse scrambles, **Copy** to copy the current scramble, or **Edit** to enter your own.
2. Hold **Space** or touch and hold the timer until the display turns green. Release to start.
3. Press a key, click, or tap to stop and save the result. Press **Esc** to cancel an active attempt.
4. Use **OK**, **+2**, or **DNF** under the timer to change the last result. Use **Note** or **Delete** to edit or remove it. Select any row in **Solves** to open its details, change the penalty, add a comment, or copy the result and scramble.

Cube Timer generates scrambles for 2x2 through 7x7, 3x3 One-Handed, 3x3 Blindfolded, Pyraminx, Skewb, Megaminx, and Clock. Use **Settings → Scramble preview** to show or hide the NxN sticker net. The scrambles use random moves for practice. Official WCA scrambles use a separate generator.

### Inspection and timer settings

- Turn on **Settings → Inspection → WCA 15 s**. Press and release **Space** or tap the timer once to begin inspection, then hold and release as usual to start the solve. The optional beeps sound at 8 and 12 seconds. The timer applies **+2** at 15 seconds and records **DNF** at 17 seconds.
- Set **Hold before start** to none, 0.3 s, or 0.55 s. Use **While solving show** to display the running time, whole seconds, or the word **solving**.
- Set **Precision** to 0.01 s or 0.001 s.

### Enter a time from a physical timer

In **Settings → Input method**, select **Type times in**. Enter a result and press **Enter** to save it to the current session. Examples include `12.34`, `1234` for 12.34 seconds, `1:02.34`, `DNF`, and `12.34+` for a raw time of 12.34 seconds with a +2 penalty.

## Connect a GAN smart cube

### Pair a GAN iCarry 4

1. Open Cube Timer at localhost or over HTTPS in Chrome or Edge with Web Bluetooth enabled. Turn on Bluetooth in the operating system.
2. Close CubeStation and other apps using the cube. Rotate the white face to wake the iCarry 4. [GAN iCarry 4 manual and product page](https://www.gancube.com/products/gan-i-carry-4-smart-cube)
3. Select a **3x3** or **3x3 One-Handed** session. In **Settings → Input method**, select **Timer (Space / touch)**.
4. Select **Connect smart cube → Choose cube**, then select the GAN device in the browser’s Bluetooth picker. If Cube Timer asks for the Bluetooth address, enter the cube’s six-byte MAC address, such as `AA:BB:CC:DD:EE:FF`, and choose the cube again.
5. Wait for the cube name and **Live cube** sticker net to appear. Open **Cube info** to read the battery and hardware details the cube reports. Use **Refresh device info** to request them again.

The connection uses [gan-web-bluetooth 3.0.2](https://github.com/afedotov/gan-web-bluetooth), loaded from jsDelivr. The driver detects GAN Gen2, Gen3, and Gen4 Bluetooth services. Software checks used simulated GAN notifications. Physical pairing with an iCarry 4 is still unverified.

### Record a smart-cube solve

1. Begin with the physical cube solved. Hold it with **white on top** and **green in front** to follow the displayed notation. The guide shows progress and the next turn. For a double turn such as `R2`, either direction works.
2. If you turn away from a recognized scramble position, follow the **Undo** instruction. If you connect while scrambled and the app cannot identify the position in the scramble, solve the cube to start again.
3. When the display says **Scramble matched**, turn the cube to start solving. If inspection is enabled, it starts when the scramble matches and the first solve turn ends inspection.
4. The turn that solves the cube stops the timer and saves the result and move timeline. Press **Esc** to abort an attempt. Select **Disconnect cube** to return to manual timing.

The timer prefers cube timestamps. It estimates clock drift from multiple turns and uses a median slope to reduce the effect of delayed Bluetooth notifications. It uses browser timing when needed and marks interpolated timestamps in the replay. The iCarry 4 has a replaceable battery and lacks a gyroscope. The live net and replay show sticker states in a fixed orientation. [iCarry 4 hardware details](https://acubemy.com/blog/gan-icarry-4-review)

| What you see | What to try |
| --- | --- |
| **Connect smart cube** is missing | Select **3x3** or **3x3 One-Handed** and switch the input method to **Timer**. |
| The browser cannot use Bluetooth | Open the app on localhost or HTTPS in a supported browser. Check OS Bluetooth permissions and adapter availability. |
| The picker cannot find the cube | Close CubeStation, wake the cube again, and keep it near the computer or phone. |
| The cube connects but the app cannot read its state | Check the MAC address. If the app is still connected, open **Cube info → Resync cube state**. Otherwise, reconnect and retry. |

## Analyze and replay a smart-cube solve

From **Solves**, select a recorded smart-cube result. You can also select its dot on the **History & stats** progress chart.

- **Smart cube analysis** shows quarter turns, average turns per second (TPS), longest gap between turns, and inspection time when recorded.
- **Inferred CFOP splits** shows time, quarter turns, initial pause, and execution for Cross, F2L total and each of the four pairs, OLL, and PLL. The app splits at the first aligned cross and the first time each number of F2L slots is solved with that cross. Pairs already in place can share a checkpoint. Initial pause is the gap before the first turn of a phase. Execution is the rest of that phase’s elapsed time.
- **OLL and PLL cases** shows the detected case, its time breakdown, and stats from earlier completed attempts in the session. The app recognizes all [57 OLL](https://www.cubeskills.com/uploads/pdf/tutorials/oll-algorithms.pdf) and [21 PLL](https://www.cubeskills.com/uploads/pdf/tutorials/pll-algorithms.pdf) cases, plus skips. **AUF only** means the last layer only needed alignment.
- **Solve replay** lets you play at 0.5×, 1×, or 2×, scrub the timeline, step one turn at a time, or select a phase name to jump to its end.
- **Copy replay link** includes the scramble, move timeline, and result in the URL fragment. Open or share it using an address where the recipient can reach the app. A `localhost` link works on the machine serving it. The replay link omits comments and session names.

## Practice algorithms

1. In a **3x3** or **3x3 One-Handed** session with **Timer** input, select **Algorithm drills**.
2. Choose **Sune**, **T-perm**, **Ua-perm**, or **Custom algorithm**. Custom algorithms accept up to 100 outer-face turns using `U R F D L B`, with primes such as `R'` and doubles such as `U2`.
3. Select **Start drill**. Cube Timer reverses the algorithm to generate the setup. Scramble to that state, solve the case, then repeat from the same setup. Repetitions have a dedicated session. Use a connected smart cube to record moves for analysis, or time repetitions manually.
4. Select **Exit drill** to go back to a regular session. Use the **Session** selector to revisit the saved drill.

After recording smart-cube solves, open **History & stats → Smart cube performance → Training focus**. **Drill OLL** and **Drill PLL** repeat a sequence from a recorded case that took the longest on average in the selected range.

## Read History & stats

Select **History & stats** in the top bar or **Charts →** in the solves panel. Pick a **Range** to report all solves, today, the last 7 or 30 days, or the last 12, 50, 100, 500, or 1,000 solves in the current session.

| Section | How to use it |
| --- | --- |
| **Summary** | Compare solve count, DNF rate, best times, mean, median, middle 50%, consistency, and estimated change in time per 100 solves. |
| **Progress** | Inspect individual solves and rolling ao5, ao12, and ao100. Toggle series in the legend. Hover over a point or focus the chart and use **← / →** to inspect results. Select a point to open that solve. |
| **Distribution** | Use automatic histogram bins or choose **Bin width**. Read the mean, median, and P10–P90 strip. The table shows counts, shares, and the cumulative share below each time threshold. Hover over a row or bar to highlight its counterpart. |
| **Percentiles & spread**, **Averages**, **By day** | Review spread, current/best/worst rolling averages, and daily results. Rolling averages are shown by the date or solve where the window ends. |
| **Smart cube performance** | Review completed smart-cube solves, average TPS and quarter turns, longest gaps, inferred phase and F2L pair averages, and X-cross frequency. Expand the OLL and PLL tables to see every case with its count, average turns and time, best time, pause, and execution in the selected range. |

The **Timer** tab shows current and best single, mo3, ao5, ao12, ao50, ao100, and ao1000 as results become available. Select a time or average there to inspect its solves. A mean of three uses all three results. Averages trim the fastest and slowest 5%, rounded up on each end. An average is DNF if it has more DNFs than the number of results trimmed from the slow end.

## Configure the AI coach

The local coach server uses Node.js 22 or later and an OpenAI-compatible **Chat Completions** provider. Configure the provider through the server environment.

- `CUBETIMER_COACH_API_URL` accepts an HTTPS base URL such as `https://api.openai.com/v1` or the full endpoint ending in `/chat/completions`. A provider running on loopback can use HTTP, for example `http://127.0.0.1:11434/v1`.
- `CUBETIMER_COACH_MODEL` is the exact model ID from the provider.
- `CUBETIMER_COACH_API_TOKEN` is the provider token. A loopback provider that accepts unauthenticated requests can leave it unset.

Stop the Python server if it is running, then start the coach server with `node server.cjs` from the repository. Open [http://localhost:8080](http://localhost:8080) using the same address as your previous local session to keep access to its browser storage. Open a recorded smart-cube solve or **History & stats → AI practice review**, then select **Get AI advice**.

The local server forwards timing and case metrics when you request advice. The request omits raw moves, scrambles, comments, session names, and Bluetooth identifiers. The provider token stays on the server. Provider usage charges may apply.

The included server listens on loopback for personal use. A public deployment can host the core timer as static files. To offer coaching on a public site, provide an authenticated, rate-limited same-origin `POST /api/coach` endpoint that accepts the metrics and returns `{ "advice": "…" }`.

## Manage sessions and backups

- Use the **Session** selector to switch between histories. Use **Manage sessions** in the top bar to create, rename, or delete a session. Each session tracks one puzzle. The **Puzzle** selector switches to or creates a regular session for the selected puzzle.
- **Settings → Export all (JSON)** saves a backup of sessions, solves, comments, move timelines, drill configurations, and app preferences. **Settings → Import…** adds the sessions from a Cube Timer export alongside the current sessions.
- **Settings → Clear current session** removes the solves in the selected session after confirmation. **Settings → Add demo session** gives you practice data to explore the charts.

Timer data, analysis, and drills are processed in the browser. Saved data uses localStorage for the current browser profile and app address. Export a backup before clearing browser storage or moving to a different browser or address.

## Use the metronome and color schemes

### Metronome

Select the metronome icon in the top bar, then press the play button. You can also press **M** when the timer is idle. Hiding the panel keeps the metronome playing, including while viewing History.

- Set **30–300 BPM** with the slider, the −/+ buttons, a typed number, or repeated presses on **Tap**. The beats-per-second readout helps you practice a steady turning rate.
- Under **Options**, choose a click, beep, or wood block sound, set volume, and accent every 2, 3, 4, or 6 beats.
- Enable **Auto-play during solves only** to start the beat with a solve and stop it when the solve ends. The app schedules clicks using Web Audio.

### Color schemes

Use the half-circle icon in the top bar for live previews, or select **Settings → Color scheme**. Choose **Basic**, **Pro**, **Homebrew**, **Ocean**, **Grass**, **Red Sands**, **Man Page**, **Novel**, or **Silver Aerogel**. **Match system light/dark** follows your OS using Basic or Pro.

**SpeedStacks** shows an LCD-style display. **Competition** uses an oval blue bezel and fixed-width red LED digits. Both styles show red while holding and green when ready.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| **Space** | Hold and release to start manual timing. With inspection enabled, press and release once to start inspection. |
| **Esc** | Cancel an active timing attempt. |
| **M** | Start or stop the metronome when idle. |
| **Alt+1**, **Alt+2**, **Alt+3** | Set the last solve to OK, +2, or DNF. |
| **Alt+Z** | Delete the last solve after confirmation. |
| **← / →** | Step through solves when the progress chart is focused. |

## Development

Use a recent version of Node.js to run the regression tests.

```bash
node --test tests/*.test.cjs
```

The app loads directly from [index.html](index.html). [scramble.js](js/scramble.js) generates scrambles and models sticker states, [smart-cube.js](js/smart-cube.js) handles GAN Bluetooth, and [smart-analysis.js](js/smart-analysis.js) handles timing and CFOP analysis. [ai-coach.js](js/ai-coach.js) makes same-origin requests to the optional local coach server in [server.cjs](server.cjs). [app.js](js/app.js) connects these features to browser storage and the interface. [stats.js](js/stats.js), [charts.js](js/charts.js), and [metronome.js](js/metronome.js) provide their respective engines.

Timer digits use DSEG7 Classic Bold Italic by keshikan under the [SIL Open Font License](fonts/DSEG-LICENSE.txt). The interface uses Roboto from Google Fonts.
