/*
 * Scramble generators for every supported puzzle, plus a small NxN sticker
 * simulator used to draw the scramble preview (cube net).
 */
(function (global) {
  'use strict';

  const rand = (n) => Math.floor(Math.random() * n);
  const pick = (arr) => arr[rand(arr.length)];

  const SUFFIX = ['', "'", '2'];
  // Face -> [axis, side]. Axis 0 = x (R/L), 1 = y (U/D), 2 = z (F/B).
  const FACES = { R: [0, 1], L: [0, -1], U: [1, 1], D: [1, -1], F: [2, 1], B: [2, -1] };

  /* ---------- NxN random-move scrambles ---------- */

  // WCA-style move set: outer turns, plus wide turns up to half the cube.
  // On even cubes the deepest wide turn only uses R/U/F (the others are redundant).
  function nxnMoveSet(n) {
    if (n === 2) return ['R', 'U', 'F'];
    const faces = ['R', 'L', 'U', 'D', 'F', 'B'];
    const moves = faces.slice();
    const maxDepth = Math.floor(n / 2);
    for (let d = 2; d <= maxDepth; d++) {
      const prefix = d === 2 ? '' : String(d);
      const fs = n % 2 === 0 && d === maxDepth ? ['R', 'U', 'F'] : faces;
      for (const f of fs) moves.push(prefix + f + 'w');
    }
    return moves;
  }

  // Random-move scramble that never repeats a layer within a run of moves on
  // the same axis (so "R L R" or "Rw R Rw" cannot happen).
  function nxnScramble(n, length) {
    const moves = nxnMoveSet(n);
    const out = [];
    let axis = -1;
    let used = new Set();
    while (out.length < length) {
      const m = pick(moves);
      const a = FACES[m.replace(/[^URFDLB]/g, '')][0];
      if (a === axis) {
        if (used.has(m)) continue;
      } else {
        axis = a;
        used = new Set();
      }
      used.add(m);
      out.push(m + pick(SUFFIX));
    }
    return out.join(' ');
  }

  /* ---------- Other puzzles ---------- */

  function simpleScramble(faces, suffixes, length) {
    const out = [];
    let last = '';
    while (out.length < length) {
      const f = pick(faces);
      if (f === last) continue;
      last = f;
      out.push(f + pick(suffixes));
    }
    return out;
  }

  function pyraminxScramble() {
    const moves = simpleScramble(['U', 'L', 'R', 'B'], ['', "'"], 10);
    for (const tip of ['u', 'l', 'r', 'b']) {
      const r = rand(3);
      if (r) moves.push(tip + (r === 2 ? "'" : ''));
    }
    return moves.join(' ');
  }

  function skewbScramble() {
    return simpleScramble(['R', 'U', 'L', 'B'], ['', "'"], 9).join(' ');
  }

  // Pochmann-style megaminx scramble: 7 lines of R/D double turns ending in U.
  function megaminxScramble() {
    const lines = [];
    for (let i = 0; i < 7; i++) {
      const parts = [];
      for (let j = 0; j < 5; j++) parts.push('R' + pick(['++', '--']), 'D' + pick(['++', '--']));
      parts.push(pick(['U', "U'"]));
      lines.push(parts.join(' '));
    }
    return lines.join('\n');
  }

  function clockScramble() {
    const turn = () => {
      const v = rand(12) - 5;
      return Math.abs(v) + (v < 0 ? '-' : '+');
    };
    const front = ['UR', 'DR', 'DL', 'UL', 'U', 'R', 'D', 'L', 'ALL'].map((p) => p + turn());
    const back = ['U', 'R', 'D', 'L', 'ALL'].map((p) => p + turn());
    return front.concat('y2', back).join(' ');
  }

  // 3BLD: a 3x3 scramble followed by a random wide-move reorientation.
  function bldScramble() {
    const tail = [pick(['', 'Fw', "Fw'", 'Fw2']), pick(['', 'Uw', "Uw'", 'Uw2'])].filter(Boolean);
    return [nxnScramble(3, 22)].concat(tail).join(' ');
  }

  const PUZZLES = {
    '333': { name: '3x3', gen: () => nxnScramble(3, 22), cube: 3 },
    '222': { name: '2x2', gen: () => nxnScramble(2, 11), cube: 2 },
    '444': { name: '4x4', gen: () => nxnScramble(4, 40), cube: 4 },
    '555': { name: '5x5', gen: () => nxnScramble(5, 60), cube: 5 },
    '666': { name: '6x6', gen: () => nxnScramble(6, 80), cube: 6 },
    '777': { name: '7x7', gen: () => nxnScramble(7, 100), cube: 7 },
    '333oh': { name: '3x3 One-Handed', gen: () => nxnScramble(3, 22), cube: 3 },
    '333bld': { name: '3x3 Blindfolded', gen: bldScramble, cube: 3 },
    pyram: { name: 'Pyraminx', gen: pyraminxScramble },
    skewb: { name: 'Skewb', gen: skewbScramble },
    minx: { name: 'Megaminx', gen: megaminxScramble },
    clock: { name: 'Clock', gen: clockScramble },
  };

  /* ---------- NxN sticker simulator ---------- */

  // Quarter turn (+90°, right-hand rule) about each axis.
  const ROT = [
    ([x, y, z]) => [x, -z, y],
    ([x, y, z]) => [z, y, -x],
    ([x, y, z]) => [-y, x, z],
  ];

  // Stickers live on a lattice where cubie centres are at -m..m in steps of 2.
  function createCube(n) {
    const m = n - 1;
    const stickers = [];
    for (const f of Object.keys(FACES)) {
      const [ax, s] = FACES[f];
      const [o1, o2] = [0, 1, 2].filter((i) => i !== ax);
      for (let a = 0; a < n; a++) {
        for (let b = 0; b < n; b++) {
          const p = [0, 0, 0];
          p[ax] = s * m;
          p[o1] = -m + 2 * a;
          p[o2] = -m + 2 * b;
          const nv = [0, 0, 0];
          nv[ax] = s;
          stickers.push({ p, nv, color: f });
        }
      }
    }
    return { n, stickers };
  }

  function applyMove(cube, token) {
    const mt = /^(\d*)([URFDLB])(w?)(['2]?)$/.exec(token);
    if (!mt) return; // rotations / unknown tokens are ignored
    const [ax, s] = FACES[mt[2]];
    const depth = mt[3] ? (mt[1] ? +mt[1] : 2) : 1;
    const turns = mt[4] === "'" ? 3 : mt[4] === '2' ? 2 : 1;
    // Clockwise seen from the face = -90° about its outward normal.
    const q = ((s === 1 ? 3 : 1) * turns) % 4;
    const limit = cube.n - 1 - 2 * (depth - 1);
    const rot = ROT[ax];
    for (const st of cube.stickers) {
      if (st.p[ax] * s < limit) continue;
      for (let i = 0; i < q; i++) {
        st.p = rot(st.p);
        st.nv = rot(st.nv);
      }
    }
  }

  function applyScramble(n, scramble) {
    const cube = createCube(n);
    for (const tok of scramble.split(/\s+/)) if (tok) applyMove(cube, tok);
    return cube;
  }

  // Map a sticker to [faceName, row, col] in the standard unfolded net.
  function netPosition(st, n) {
    const m = n - 1;
    const inc = (c) => (c + m) / 2;
    const dec = (c) => (m - c) / 2;
    const [x, y, z] = st.p;
    const [nx, ny, nz] = st.nv;
    if (ny === 1) return ['U', inc(z), inc(x)];
    if (ny === -1) return ['D', dec(z), inc(x)];
    if (nz === 1) return ['F', dec(y), inc(x)];
    if (nz === -1) return ['B', dec(y), dec(x)];
    if (nx === 1) return ['R', dec(y), dec(z)];
    return ['L', dec(y), inc(z)];
  }

  const NET_ORIGIN = { U: [1, 0], L: [0, 1], F: [1, 1], R: [2, 1], B: [3, 1], D: [1, 2] };

  // Returns the cube net as data: a list of facelets with grid coordinates.
  function cubeNet(n, scramble) {
    const cube = applyScramble(n, scramble);
    return cube.stickers.map((st) => {
      const [face, row, col] = netPosition(st, n);
      const [fx, fy] = NET_ORIGIN[face];
      return { face, row, col, fx, fy, color: st.color };
    });
  }

  global.Scramble = {
    PUZZLES,
    generate: (puzzle) => (PUZZLES[puzzle] || PUZZLES['333']).gen(),
    cubeNet,
    applyScramble,
    netPosition,
  };
})(typeof window !== 'undefined' ? window : globalThis);
