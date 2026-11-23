/*
 * Outer-face adaptations of cfop-tracker’s case algorithms.
 * https://github.com/linluiben/cfop-tracker/blob/130d32b055be06bad2e1b498f929d0ac67f1d057/js/algs.js
 *
 * MIT License
 *
 * Copyright (c) 2026 linluiben
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
(function (global) {
  'use strict';

  const OLL = [
    null,
    "R U2 R2 F R F' U2 R' F R F'", // 1
    "L F L' U2 R U2 R' U2 L F' L'", // 2
    "L' R2 B R' B L U2 L' B R' L", // 3
    "R L2 B' L B' R' U2 R B' R' L", // 4
    "R' F2 L F L' F R", // 5
    "L F2 R' F' R F' L'", // 6
    "L F R' F R F2 L'", // 7
    "R' F' L F' L' F2 R", // 8
    "R U R' U' R' F R2 U R' U' F'", // 9
    "L R2 F2 R F R' F R F R L'", // 10
    "F B' R2 D R D' R D R2 D' F' B", // 11
    "R2 L F' R F' R' F2 R F' R L'", // 12
    "F U R U' R2 F' R U R U' R'", // 13
    "R' F R U R' F' R F U' F'", // 14
    "R' F' R L' U' L U R' F R", // 15
    "L F L' R U R' U' L F' L'", // 16
    "F R' F' R2 L' B R B' R' B' R' L", // 17
    "L F R' F R F2 L2 B' R B' R' B2 L", // 18
    "L' R B R B R' B' R2 L F R F'", // 19
    "L F R' F' R2 L2 B R B' R' B' R' L", // 20
    "R U R' U R U' R' U R U2 R'", // 21
    "R U2 R2 U' R2 U' R2 U2 R", // 22
    "R2 D R' U2 R D' R' U2 R'", // 23
    "L F R' F' L' F R F'", // 24
    "F R' F' L F R F' L'", // 25
    "R U2 R' U' R U' R'", // 26
    "R U R' U R U2 R'", // 27
    "L F R' F' L' R U R U' R'", // 28
    "R L' B R B R' B' R' U R U' R' L", // 29
    "R L' B' L' B' L B L U' L' U R' L", // 30
    "R' U' F U R U' R' F' R", // 31
    "L U F' U' L' U L F L'", // 32
    "R U R' U' R' F R F'", // 33
    "B U B' U' L' B' R B R' L", // 34
    "R U2 R2 F R F' R U2 R'", // 35
    "L' U' L U' L' U L U L F' L' F", // 36
    "F R' F' R U R U' R'", // 37
    "R U R' U R U' R' U' R' F R F'", // 38
    "B' U F U' R' U' R U F' B", // 39
    "B U' F' U L U L' U' F B'", // 40
    "R U R' U R U2 R' F R U R' U' F'", // 41
    "R' F R F' R' F R F' R U R' U' R U R'", // 42
    "R' U' F' U F R", // 43
    "F U R U' R' F'", // 44
    "F R U R' U' F'", // 45
    "R' U' R' F R F' U R", // 46
    "F R' F' R U2 R U' R' U R U2 R'", // 47
    "F R U R' U' R U R' U' F'", // 48
    "L F' L2 B L2 F L2 B' L", // 49
    "R' F R2 B' R2 F' R2 B R'", // 50
    "F U R U' R' U R U' R' F'", // 51
    "R' F' U' F U' R U R' U R", // 52
    "R' F' L F' L' F L F' L' F2 R", // 53
    "L F R' F R F' R' F R F2 L'", // 54
    "R' F U R U' R2 F' R2 U R' U' R", // 55
    "L F L' U R U' R' U R U' R' L F' L'", // 56
    "R U R' U' R' L F R F' L'", // 57
  ];

  const PLL = {
    Aa: "R' F R' B2 R F' R' B2 R2",
    Ab: "R B' R F2 R' B R F2 R2",
    E: "R B' R' F R B R' F' R B R' F R B' R' F'",
    F: "R' U2 R' U' B' R' B2 U' B' U B' R B U' R",
    Ga: "R2 D B' U B' U' B D' R2 F' U F",
    Gb: "F' U' F R2 D B' U B U' B D' R2",
    Gc: "R2 D' F U' F U F' D R2 B U' B'",
    Gd: "R U R' F2 D' L U' L' U L' D F2",
    H: "R2 L2 D R2 L2 U2 R2 L2 D R2 L2",
    Ja: "R' U L' U2 R U' R' U2 R L",
    Jb: "R U2 R' U' R U2 L' U R' U' L",
    Na: "R U R' U R U R' F' R U R' U' R' F R2 U' R' U2 R U' R'",
    Nb: "L' F' U L U' L' U' F L2 F L' U' L' U L F'",
    Ra: "R U' R' U' R U R D R' U' R D' R' U2 R'",
    Rb: "R2 F R U R U' R' F' R U2 R' U2 R",
    T: "R U R' U' R' F R2 U' R' U' R U R' F'",
    Ua: "R U' R U R U R U' R' U' R2",
    Ub: "R2 U R U R' U' R' U' R' U R'",
    V: "R' U R' U' B' R' B2 U' B' U B' R B R",
    Y: "F R U' R' U' R U R' F' R U R' U' R' F R F'",
    Z: "R' L F R2 L2 B R2 L2 F R' L D2 R2 L2",
  };

  const algorithms = { OLL, PLL };
  if (typeof module !== 'undefined' && module.exports) module.exports = algorithms;
  else global.CaseAlgorithms = algorithms;
})(typeof window !== 'undefined' ? window : globalThis);
