/* Lumen continuous evolution engine (1.8).

   Every shape keeps an evolving internal state, so an animation keeps developing on its own, with or without music:
     direction, velocity, position drift, turbulence, distortion, complexity, colour migration, particle density,
     flow, an extra layer, a structure/morph value, an evolution phase and a mood (calm .. intense).
   Three influences, one state (they add up, they do not fight):
     1. continuous evolution  - slow seeded noise and eased targets: always moving, also in silence
     2. music influence       - bass widens movement, mids stir turbulence, treble adds fine detail, beats nudge,
                                builds raise complexity, drops trigger a major transformation
     3. autonomous variation  - an evolution director occasionally starts a development (new layer, direction
                                change, palette migration, burst, structure change, calm or surge), with cooldowns
                                and context, never constantly
   Each animation has its own rules (RULES): rate, drift style, ranges, what bass/mids/treble do, which variations.
   Deterministic for a seed (both windows evolve alike); no allocation per step; no timers.

   createEvolver(id, seed) -> ev;  step(ev, id, F|null, dt, opts) fills
     ev.out  Float32Array(8):  E0 = [flowX, flowY, phase, morph]   E1 = [layer, detail, density, mood]
     ev.add  Float32Array(12): added to the 12 music controls (warp, turb, emit, swell, spin, tint, -, -, -, cplx, shim, -)
   setRules(ev, id) when the shape changes animation: the state carries over (continuity).                         */
(function (root) {
  'use strict';
  // r rate, d drift style, a drift speed, t/w/c [base, range] of turbulence / distortion / complexity, n density range,
  // h colour migration (rad/s), bass/mid/tre what each band drives, v allowed variations, s sign of preferred flow
  const R = (r, d, a, t, w, c, n, h, bass, mid, tre, v) => ({ r, d, a, t, w, c, n, h, bass, mid, tre, v: v.split(' ') });
  const RULES = {
    galaxy: R(0.5, 'swirl', 0.02, [0.05, 0.15], [0.05, 0.1], [0.2, 0.4], 0.6, 0.006, 'swell', 'cplx', 'dens', 'layer morph palette calm surge'),
    stars: R(0.9, 'pan', 0.06, [0, 0.05], [0, 0.04], [0, 0.3], 1.2, 0.004, 'drift', 'cplx', 'dens', 'flip burst palette calm'),
    nebula: R(0.45, 'pan', 0.025, [0.1, 0.2], [0.1, 0.25], [0.3, 0.5], 0.7, 0.012, 'swell', 'turb', 'dens', 'layer morph palette calm surge'),
    aurora: R(0.6, 'wind', 0.05, [0.1, 0.3], [0.15, 0.4], [0.2, 0.4], 0.5, 0.01, 'warp', 'turb', 'shim', 'flip layer morph palette calm'),
    warp: R(1.0, 'still', 0, [0, 0.1], [0, 0.1], [0.2, 0.5], 0.8, 0.005, 'drift', 'cplx', 'dens', 'burst surge calm palette'),
    fire: R(0.9, 'rise', 0.06, [0.2, 0.4], [0.05, 0.2], [0.2, 0.3], 0.7, 0.002, 'swell', 'turb', 'dens', 'burst surge calm morph'),
    smoke: R(0.55, 'rise', 0.035, [0.2, 0.5], [0.1, 0.3], [0.2, 0.4], 0.4, 0.004, 'swell', 'turb', 'detail', 'flip morph layer calm'),
    clouds: R(0.4, 'wind', 0.04, [0.1, 0.4], [0.1, 0.3], [0.3, 0.4], 0.3, 0.003, 'swell', 'turb', 'detail', 'flip morph layer calm palette'),
    ocean: R(0.6, 'pan', 0.04, [0.2, 0.3], [0.2, 0.4], [0.3, 0.4], 0.3, 0.004, 'warp', 'turb', 'shim', 'flip morph surge calm'),
    waves: R(0.7, 'wind', 0.05, [0.05, 0.2], [0.1, 0.3], [0.2, 0.4], 0.3, 0.008, 'swell', 'warp', 'shim', 'flip layer palette calm surge'),
    portal: R(0.8, 'swirl', 0.03, [0.2, 0.4], [0.1, 0.2], [0.3, 0.5], 0.6, 0.01, 'swell', 'turb', 'dens', 'morph layer burst palette surge'),
    energy: R(1.0, 'swirl', 0.03, [0.2, 0.4], [0.05, 0.15], [0.2, 0.4], 0.7, 0.006, 'swell', 'turb', 'shim', 'burst surge calm morph'),
    lightning: R(1.0, 'wind', 0.04, [0.2, 0.4], [0.05, 0.1], [0.2, 0.4], 0.8, 0.003, 'swell', 'turb', 'dens', 'burst surge calm flip'),
    magic: R(0.8, 'swirl', 0.03, [0.1, 0.2], [0.05, 0.15], [0.2, 0.4], 0.8, 0.012, 'swell', 'cplx', 'dens', 'burst layer palette calm surge'),
    particles: R(0.9, 'rise', 0.05, [0.2, 0.4], [0, 0.1], [0.2, 0.4], 0.9, 0.008, 'drift', 'turb', 'dens', 'burst flip layer palette calm'),
    plasma: R(0.8, 'pan', 0.05, [0.05, 0.15], [0.2, 0.5], [0.2, 0.6], 0.2, 0.015, 'warp', 'cplx', 'shim', 'morph palette flip surge calm'),
    fractal: R(0.5, 'swirl', 0.02, [0, 0.1], [0.1, 0.3], [0.2, 0.5], 0.2, 0.01, 'warp', 'cplx', 'detail', 'morph palette layer calm'),
    kaleido: R(0.7, 'swirl', 0.04, [0.05, 0.15], [0.1, 0.3], [0.2, 0.6], 0.3, 0.012, 'swell', 'cplx', 'detail', 'morph palette layer flip surge'),
    tunnel: R(1.0, 'still', 0, [0, 0.1], [0, 0.1], [0.2, 0.5], 0.3, 0.008, 'drift', 'cplx', 'detail', 'morph palette surge calm flip'),
    gradient: R(0.35, 'pan', 0.03, [0.05, 0.1], [0.1, 0.3], [0.1, 0.3], 0.2, 0.01, 'swell', 'warp', 'detail', 'palette flip morph calm'),
    glow: R(0.35, 'orbit', 0.03, [0, 0.05], [0.02, 0.08], [0.1, 0.2], 0.2, 0.005, 'swell', 'warp', 'detail', 'palette calm surge morph'),
    flow: R(0.6, 'pan', 0.04, [0.1, 0.25], [0.15, 0.35], [0.3, 0.5], 0.3, 0.007, 'swell', 'turb', 'detail', 'flip morph palette layer calm'),
    lava: R(0.45, 'still', 0, [0.1, 0.3], [0.05, 0.15], [0.2, 0.4], 0.3, 0.006, 'swell', 'turb', 'detail', 'morph palette burst calm'),
    ink: R(0.55, 'pan', 0.03, [0.3, 0.4], [0.1, 0.3], [0.3, 0.5], 0.7, 0.008, 'swell', 'turb', 'dens', 'burst layer flip morph palette'),
    bokeh: R(0.5, 'orbit', 0.03, [0.05, 0.2], [0, 0.05], [0.2, 0.3], 0.6, 0.008, 'swell', 'turb', 'dens', 'burst palette calm flip'),
    fireflies: R(0.6, 'orbit', 0.04, [0.05, 0.2], [0, 0.05], [0.2, 0.3], 0.7, 0.003, 'swell', 'turb', 'dens', 'burst morph calm flip'),
    rays: R(0.5, 'wind', 0.025, [0.1, 0.3], [0.05, 0.15], [0.2, 0.4], 0.6, 0.004, 'swell', 'turb', 'dens', 'flip layer calm palette'),
    rain: R(0.8, 'fall', 0.05, [0.05, 0.15], [0, 0.05], [0.2, 0.3], 0.8, 0.002, 'drift', 'turb', 'dens', 'burst flip calm surge'),
    snow: R(0.55, 'fall', 0.03, [0.1, 0.3], [0, 0.05], [0.2, 0.3], 0.8, 0.002, 'drift', 'turb', 'dens', 'burst flip calm'),
    sunset: R(0.3, 'wind', 0.02, [0.05, 0.15], [0.05, 0.1], [0.1, 0.3], 0.3, 0.004, 'swell', 'turb', 'shim', 'palette calm morph'),
    synth: R(0.8, 'still', 0, [0, 0.05], [0, 0.05], [0.2, 0.5], 0.6, 0.006, 'drift', 'cplx', 'dens', 'morph palette surge calm'),
    rings: R(0.8, 'still', 0, [0.05, 0.15], [0.05, 0.15], [0.2, 0.4], 0.7, 0.01, 'swell', 'cplx', 'dens', 'burst morph layer palette'),
    laser: R(1.0, 'swirl', 0.04, [0.1, 0.3], [0, 0.05], [0.2, 0.5], 0.7, 0.01, 'spin', 'turb', 'dens', 'burst flip palette surge calm'),
    disco: R(0.9, 'swirl', 0.04, [0, 0.1], [0, 0.05], [0.2, 0.4], 0.7, 0.012, 'spin', 'cplx', 'dens', 'burst flip palette surge'),
    hex: R(0.8, 'pan', 0.03, [0, 0.1], [0.02, 0.08], [0.2, 0.4], 0.5, 0.01, 'swell', 'cplx', 'detail', 'morph palette flip surge calm'),
    'wall-tide': R(0.45, 'wind', 0.025, [0.05, 0.16], [0.1, 0.25], [0.2, 0.35], 0.2, 0.004, 'swell', 'warp', 'shim', 'flip palette calm surge'),
    'ripple-choir': R(0.55, 'orbit', 0.02, [0.08, 0.18], [0.06, 0.14], [0.2, 0.35], 0.25, 0.006, 'swell', 'turb', 'detail', 'layer palette calm surge'),
    'ribbon-weave': R(0.65, 'wind', 0.04, [0.12, 0.25], [0.14, 0.3], [0.2, 0.4], 0.35, 0.008, 'swell', 'turb', 'detail', 'flip layer palette morph calm'),
    murmuration: R(0.8, 'orbit', 0.045, [0.15, 0.3], [0.05, 0.16], [0.2, 0.4], 0.8, 0.007, 'swell', 'turb', 'dens', 'flip layer burst palette calm'),
    'frame-drips': R(0.35, 'fall', 0.02, [0.06, 0.16], [0.05, 0.15], [0.1, 0.25], 0.15, 0.003, 'swell', 'turb', 'detail', 'morph palette calm'),
    'cell-garden': R(0.4, 'pan', 0.025, [0.1, 0.22], [0.08, 0.18], [0.2, 0.35], 0.35, 0.006, 'swell', 'turb', 'detail', 'morph layer palette calm surge'),
  };
  const VARIATIONS = ['flip', 'layer', 'burst', 'morph', 'palette', 'calm', 'surge'];
  const DEFAULTS = { on: true, speed: 1, complexity: 0.5, music: 1, variation: 0.5, intensity: 1 };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), num = (v, d, a, b) => (typeof v === 'number' && isFinite(v) ? clamp(v, a, b) : d);
  function normSettings(o) {
    o = o && typeof o === 'object' ? o : {};
    return { on: o.on !== false, speed: num(o.speed, 1, 0, 3), complexity: num(o.complexity, 0.5, 0, 1), music: num(o.music, 1, 0, 2), variation: num(o.variation, 0.5, 0, 1), intensity: num(o.intensity, 1, 0, 2) };
  }
  function hashSeed(s) { let h = 2166136261 >>> 0; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h || 1; }

  // indices into the state array (one Float64Array per shape; doubles keep long sessions precise)
  const K = { et: 0, dir: 1, dirT: 2, vel: 3, x: 4, y: 5, phase: 6, morph: 7, morphT: 8, layer: 9, layerT: 10, dens: 11, densT: 12, turb: 13, warp: 14, cplx: 15, cplxT: 16, hue: 17, hueT: 18, mood: 19, moodT: 20, spin: 21, detail: 22, act: 23, nextEval: 24, lastEvent: 25, onK: 26, impulse: 27, sinceDrop: 28, age: 29, lastPhaseMark: 30, ready: 31, swirl: 32, burst: 33, offX: 34, offY: 35 };
  const NS = 36;

  function createEvolver(id, seed) {
    let s = hashSeed(seed == null ? id : seed);
    const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const S = new Float64Array(NS), fq = new Float64Array(24), ph = new Float64Array(24);
    for (let i = 0; i < 24; i++) { fq[i] = 0.013 + rnd() * 0.06 * (1 + (i % 3)); ph[i] = rnd() * 6.2832; }
    S[K.dir] = S[K.dirT] = rnd() * 6.2832; S[K.morph] = S[K.morphT] = 0.1 * rnd(); // every animation starts from its classic form and evolves away S[K.hue] = S[K.hueT] = 0; S[K.nextEval] = 4 + rnd() * 4; S[K.lastEvent] = -30; S[K.onK] = 1;
    S[K.x] = (rnd() - 0.5) * 4; S[K.y] = (rnd() - 0.5) * 4;
    const ev = { id, rules: RULES[id] || RULES.gradient, S, fq, ph, rnd, out: new Float32Array(8), add: new Float32Array(12), last: '', lastAt: -1, count: 0 };
    return ev;
  }
  function setRules(ev, id) { ev.id = id; ev.rules = RULES[id] || RULES.gradient; ev.S[K.age] = 0; ev.cont = true; } // outputs stay continuous across the change (see step)
  // smooth seeded noise, -1..1 (three incommensurate sines per channel)
  function sn(ev, i, t) { const f = ev.fq, p = ev.ph, j = (i * 3) % 24; return (Math.sin(t * f[j] * 6.2832 + p[j]) + 0.6 * Math.sin(t * f[j + 1] * 9.7 + p[j + 1]) + 0.4 * Math.sin(t * f[j + 2] * 15.1 + p[j + 2])) / 2; }
  const ease = (v, target, dt, tau) => v + (target - v) * (1 - Math.exp(-dt / Math.max(1e-3, tau)));
  const wrapPi = (a) => { a = (a + Math.PI) % 6.2832831; if (a < 0) a += 6.2832831; return a - Math.PI; };

  // the evolution director: decide whether to start a development now (controlled unpredictability)
  function evaluate(ev, F, o, ctx) {
    const S = ev.S, Rl = ev.rules, et = S[K.et], since = et - S[K.lastEvent];
    const cool = 18 - 13 * o.variation; // evolution-seconds between developments: 18 s (rare) .. 5 s (lively)
    S[K.nextEval] = et + 3 + ev.rnd() * 3;
    if (since < cool || o.variation <= 0) return;
    const p = o.variation * (0.25 + 0.55 * Math.min(1, (since - cool) / 20));
    if (ev.rnd() > p) return;
    const e = F ? F.energy || 0 : 0.3, act = S[K.act], quiet = e < 0.22, loud = e > 0.6 || act > 0.6;
    let total = 0; const w = ev._w || (ev._w = new Float64Array(VARIATIONS.length + 1));
    for (let i = 0; i < VARIATIONS.length; i++) {
      const v = VARIATIONS[i]; let x = Rl.v.indexOf(v) >= 0 ? 1 : 0;
      if (!x) { w[i] = 0; continue; }
      if (v === ev.last) x *= 0.15; // rarely the same development twice in a row
      if (v === 'calm') x *= quiet ? 0.4 : loud ? 0.5 : S[K.mood] > 0.3 ? 1.6 : 0.8;
      if (v === 'surge') x *= loud ? 1.8 : quiet ? 0.25 : S[K.mood] < -0.2 ? 1.3 : 0.7;
      if (v === 'burst') x *= loud ? 1.6 : quiet ? 0.5 : 1;
      if (v === 'palette' || v === 'flip') x *= quiet ? 1.5 : 1;
      if (v === 'layer') x *= S[K.cplx] > 0.75 && S[K.layerT] < 0.5 ? 0.3 : S[K.layerT] > 0.5 ? 1.4 : 1;
      if (v === 'morph') x *= S[K.age] > 40 ? 2 : 1;
      w[i] = x * (0.5 + o.complexity); total += w[i];
    }
    w[VARIATIONS.length] = ctx && ctx.allowTransition && S[K.age] > 60 ? 0.6 * o.variation : 0; total += w[VARIATIONS.length];
    if (total <= 0) return;
    let r = ev.rnd() * total, pick = -1;
    for (let i = 0; i <= VARIATIONS.length; i++) { r -= w[i]; if (r <= 0) { pick = i; break; } }
    if (pick < 0) pick = VARIATIONS.length - 1;
    apply(ev, pick === VARIATIONS.length ? 'transition' : VARIATIONS[pick], o);
  }
  function apply(ev, v, o) {
    const S = ev.S, rnd = ev.rnd;
    S[K.lastEvent] = S[K.et]; ev.last = v; ev.lastAt = S[K.et]; ev.count++;
    if (v === 'flip') S[K.dirT] += (rnd() < 0.5 ? -1 : 1) * Math.PI * (0.55 + 0.45 * rnd());
    else if (v === 'layer') S[K.layerT] = S[K.layerT] > 0.5 ? 0 : 0.7 + 0.3 * rnd();
    else if (v === 'burst') { S[K.densT] = Math.min(1, S[K.densT] + 0.6 + 0.3 * rnd()); S[K.burst] = 1; }
    else if (v === 'morph') { let m; do { m = rnd(); } while (Math.abs(m - S[K.morphT]) < 0.35); S[K.morphT] = m; }
    else if (v === 'palette') S[K.hueT] += (rnd() < 0.5 ? -1 : 1) * (0.7 + 1.1 * rnd());
    else if (v === 'calm') { S[K.moodT] = -0.5 - 0.3 * rnd(); S[K.cplxT] = Math.max(0, S[K.cplxT] - 0.3); }
    else if (v === 'surge') { S[K.moodT] = 0.5 + 0.4 * rnd(); S[K.cplxT] = Math.min(1, S[K.cplxT] + 0.35 * (0.5 + o.complexity)); }
    else if (v === 'transition') S[K.ready] = 1;
  }

  function step(ev, id, F, dt, oIn, ctx) {
    if (ev.id !== id) setRules(ev, id);
    const o = oIn || DEFAULTS, S = ev.S, Rl = ev.rules, out = ev.out, add = ev.add;
    dt = Math.min(0.1, Math.max(0, dt));
    if (!ev.started) { ev.started = true; S[K.onK] = o.on ? 1 : 0; } // first frame: no fade-in or fade-out
    S[K.onK] = ease(S[K.onK], o.on ? 1 : 0, dt, 0.8); // switching evolution off fades it out instead of popping
    if (Math.abs(S[K.onK] - (o.on ? 1 : 0)) < 2e-3) S[K.onK] = o.on ? 1 : 0; // settle exactly (off really freezes)
    const on = S[K.onK], mus = o.music * (F && !F.silent ? 1 : 0);
    const bass = F ? (F.bass || 0) : 0, mid = F ? (F.mid || 0) : 0, tre = F ? (F.treble || 0) : 0, e = F ? (F.energy || 0) : 0;
    S[K.act] = ease(S[K.act], F ? Math.min(1, e * 0.7 + (F.beat ? 0.6 : 0)) : 0, dt, 2.5);
    // 1. evolution time: always advancing; music quickens it
    const sp = o.speed * Rl.r, edt = dt * sp * (0.75 + 0.6 * e * mus);
    S[K.et] += edt; S[K.age] += dt; S[K.sinceDrop] += dt; const et = S[K.et];
    // 2. music events: beats nudge, builds raise complexity, drops transform
    if (F && mus > 0) {
      if (F.beat) { S[K.impulse] = Math.min(1.5, S[K.impulse] + (F.beatStrength || 0.6) * mus * 0.6); S[K.dir] += (ev.rnd() - 0.5) * 0.5 * mus * (F.beatStrength || 0.5); S[K.phase] += 0.02 * mus; }
      if (F.build > 0.3) S[K.cplxT] = Math.min(1, S[K.cplxT] + F.build * 0.08 * dt * mus);
      if (F.drop && S[K.sinceDrop] > 2) { S[K.sinceDrop] = 0; apply(ev, Rl.v.indexOf('morph') >= 0 ? 'morph' : 'burst', o); S[K.moodT] = 0.8; S[K.impulse] = 1.5; S[K.morph] += (S[K.morphT] - S[K.morph]) * 0.35; }
    }
    S[K.impulse] *= Math.exp(-dt / 0.6); S[K.burst] *= Math.exp(-dt / 2.5);
    // 3. autonomous variation, evaluated every few evolution-seconds (no timers)
    if (on > 0.5 && et >= S[K.nextEval]) evaluate(ev, F, o, ctx);
    // direction: a slowly wandering target, biased by the animation's drift style
    S[K.dirT] += sn(ev, 0, et) * 0.18 * edt;
    let target = S[K.dirT];
    if (Rl.d === 'rise') target = Math.PI / 2 + 0.55 * Math.sin(S[K.dirT]);
    else if (Rl.d === 'fall') target = -Math.PI / 2 + 0.55 * Math.sin(S[K.dirT]);
    else if (Rl.d === 'wind') target = (Math.cos(S[K.dirT]) >= 0 ? 0 : Math.PI) + 0.35 * Math.sin(S[K.dirT] * 1.7);
    S[K.dir] += wrapPi(target - S[K.dir]) * (1 - Math.exp(-dt / 3.5));
    // velocity: base drift, breathing, bass widens it, beats push it
    S[K.vel] = Rl.a * (0.65 + 0.35 * sn(ev, 1, et)) * (1 + (Rl.bass === 'drift' ? 2.2 : 1.1) * bass * mus + 1.2 * S[K.impulse] + 0.8 * S[K.burst]);
    if (Rl.d === 'orbit') { S[K.x] = 1.6 * Math.sin(et * 0.11 + ev.ph[0]) + 0.6 * sn(ev, 2, et); S[K.y] = 1.2 * Math.sin(et * 0.083 + ev.ph[1]) + 0.6 * sn(ev, 3, et); }
    else if (Rl.d !== 'still') { const v = S[K.vel] * sp * dt * 10; S[K.x] += Math.cos(S[K.dir]) * v; S[K.y] += Math.sin(S[K.dir]) * v; if (Math.abs(S[K.x]) > 2048) S[K.x] -= Math.sign(S[K.x]) * 4096; if (Math.abs(S[K.y]) > 2048) S[K.y] -= Math.sign(S[K.y]) * 4096; }
    else { S[K.x] = 0.35 * sn(ev, 2, et); S[K.y] = 0.35 * sn(ev, 3, et); }
    // swirl animations turn back and forth slowly instead of drifting
    if (Rl.d === 'swirl') S[K.swirl] = 0.9 * sn(ev, 4, et * 0.7) + (Rl.bass === 'spin' ? 0.6 * bass * mus : 0);
    else S[K.swirl] = Rl.bass === 'spin' ? 0.6 * bass * mus : 0;
    // turbulence, distortion, complexity, density, detail
    const cx = o.complexity;
    const turbT = Rl.t[0] + Rl.t[1] * (0.5 + 0.5 * sn(ev, 5, et)) + (Rl.mid === 'turb' ? 0.7 : 0.25) * mid * mus + 0.4 * S[K.burst];
    const warpT = Rl.w[0] + Rl.w[1] * (0.5 + 0.5 * sn(ev, 6, et)) + (Rl.mid === 'warp' || Rl.bass === 'warp' ? 0.6 : 0.15) * (Rl.bass === 'warp' ? bass : mid) * mus + 0.5 * Math.max(0, S[K.moodT]) * S[K.impulse];
    S[K.turb] = ease(S[K.turb], turbT, dt, 0.5); S[K.warp] = ease(S[K.warp], warpT, dt, 0.6);
    S[K.cplxT] += (Rl.c[0] + Rl.c[1] * cx - S[K.cplxT]) * (1 - Math.exp(-dt / 40)); // complexity relaxes to the user's level over time
    S[K.cplx] = ease(S[K.cplx], clamp(S[K.cplxT] + 0.15 * sn(ev, 7, et) + (Rl.mid === 'cplx' ? 0.5 * mid * mus : 0), 0, 1.4), dt, 2);
    S[K.densT] += (0 - S[K.densT]) * (1 - Math.exp(-dt / 12));
    S[K.dens] = ease(S[K.dens], clamp(S[K.densT] + Rl.n * 0.4 * sn(ev, 8, et) + (Rl.tre === 'dens' ? 0.9 * tre * mus : 0) + (Rl.bass === 'dens' ? 0.8 * bass * mus : 0), -1, 1.5), dt, 0.35);
    S[K.detail] = ease(S[K.detail], clamp((Rl.tre === 'detail' || Rl.tre === 'shim' ? 0.9 : 0.35) * tre * mus + 0.3 * cx * (0.5 + 0.5 * sn(ev, 9, et)), 0, 1.2), dt, 0.25);
    // structure, layer, colour, mood
    S[K.morph] = ease(S[K.morph], S[K.morphT] + 0.12 * sn(ev, 10, et), dt, S[K.sinceDrop] < 2 ? 1.2 : 7 / Math.max(0.2, sp));
    S[K.layer] = ease(S[K.layer], S[K.layerT], dt, 4);
    S[K.hueT] += Rl.h * edt * 6; // slow continuous colour migration
    S[K.hue] = ease(S[K.hue], S[K.hueT], dt, 9);
    const moodBase = clamp((S[K.act] - 0.35) * 1.4, -0.6, 0.8);
    S[K.moodT] += (moodBase - S[K.moodT]) * (1 - Math.exp(-dt / 25));
    S[K.mood] = ease(S[K.mood], S[K.moodT], dt, 5);
    S[K.phase] += edt * (0.12 + 0.2 * e * mus) * on; // frozen when evolution is off
    // outputs (intensity scales how far everything moves; off fades to nothing)
    const k = on * o.intensity, fsc = Rl.d === 'still' || Rl.d === 'swirl' ? 1 : 0.15;
    let ox = S[K.x] * fsc * on, oy = S[K.y] * fsc * on;
    if (ev.cont) { ev.cont = false; S[K.offX] = on > 1e-3 ? (out[0] - ox) / on : 0; S[K.offY] = on > 1e-3 ? (out[1] - oy) / on : 0; } // new rules: keep the picture where it was
    S[K.offX] *= Math.exp(-dt / 4); S[K.offY] *= Math.exp(-dt / 4); ox += S[K.offX] * on; oy += S[K.offY] * on;
    out[0] = ox; out[1] = oy; out[2] = S[K.phase] % 4096; out[3] = clamp(S[K.morph], -0.2, 1.2) * on;
    out[4] = S[K.layer] * on; out[5] = S[K.detail] * k; out[6] = S[K.dens] * k; out[7] = clamp(S[K.mood], -1, 1) * on;
    add[0] = S[K.warp] * k; add[1] = S[K.turb] * k; add[2] = (0.35 * S[K.dens] + 0.4 * S[K.burst]) * k; add[3] = 0.12 * sn(ev, 11, et) * k; add[4] = S[K.swirl] * k; add[5] = S[K.hue] * on;
    add[6] = 0; add[7] = 0; add[8] = 0; add[9] = S[K.cplx] * 0.6 * k; add[10] = S[K.detail] * 0.25 * k; add[11] = 0;
    return ev;
  }
  // a short human description of what a shape is doing now (for the live status)
  function describe(ev) {
    const S = ev.S, Rl = ev.rules, d = S[K.dir], dirName = Rl.d === 'swirl' ? 'turning' : Rl.d === 'still' || Rl.d === 'orbit' ? 'wandering' : ['drifting right', 'drifting up', 'drifting left', 'drifting down'][((Math.round(d / (Math.PI / 2)) % 4) + 4) % 4];
    const bits = [dirName, S[K.mood] > 0.35 ? 'intense' : S[K.mood] < -0.3 ? 'calm' : 'steady'];
    if (S[K.layer] > 0.35) bits.push('extra layer');
    if (S[K.cplx] > 0.75) bits.push('complex'); else if (S[K.cplx] < 0.25) bits.push('simple');
    if (ev.last && S[K.et] - ev.lastAt < 8) bits.push({ flip: 'changing direction', layer: S[K.layerT] > 0.5 ? 'new layer forming' : 'layer fading', burst: 'burst', morph: 'transforming', palette: 'colours shifting', calm: 'settling', surge: 'building up', transition: 'ready for a change' }[ev.last] || ev.last);
    return bits.join(' · ');
  }
  function takeReady(ev) { if (ev.S[K.ready] > 0) { ev.S[K.ready] = 0; return true; } return false; }

  const api = { RULES, VARIATIONS, DEFAULTS, K, normSettings, createEvolver, setRules, step, describe, takeReady, hashSeed };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LumenEvolve = api;
})(typeof window !== 'undefined' ? window : globalThis);
