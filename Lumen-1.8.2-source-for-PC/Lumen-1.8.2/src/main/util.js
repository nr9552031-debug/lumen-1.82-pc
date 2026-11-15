'use strict';
const color = require('../shared/color');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uid = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const str = (v, max = 60) => String(v === undefined || v === null ? '' : v).slice(0, max);
const num = (v, lo, hi, dflt) => { v = Number(v); return Number.isFinite(v) ? color.clamp(v, lo, hi) : dflt; };
const rgbOk = (c) => Array.isArray(c) && c.length === 3 && c.every((n) => Number.isFinite(Number(n)));
const rgb = (c) => c.map((n) => color.clamp(Math.round(Number(n)), 0, 255));
module.exports = { ...color, sleep, uid, str, num, rgbOk, rgb };
