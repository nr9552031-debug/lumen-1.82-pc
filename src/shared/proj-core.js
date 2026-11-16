/* Projection Studio: everything that is not drawing or DOM. Shape geometry, the project format, starter
   setups, and how projected colours become targets for real lights. Loaded by the pages (script tag) and by
   the main process and tests (require). */
(function (root) {
  'use strict';
  const C = typeof module !== 'undefined' && module.exports ? require('./color.js') : root.LumenColor;
  const EVO = typeof module !== 'undefined' && module.exports ? require('./av-evolve.js') : root.LumenEvolve;
  const Q = typeof module !== 'undefined' && module.exports ? require('./proj-quality.js') : root.LumenProjQuality;
  const XF = ['auto', 'fade', 'dissolve', 'bloom', 'sweep', 'morph', 'ripple'];
  const DIR = typeof module !== 'undefined' && module.exports ? require('./av-director.js') : root.LumenDirector; // settings for Autonomous mode
  const MODES = ['manual', 'reactive', 'auto'];
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const PRESETS = [
    ['galaxy', 'Galaxy'], ['stars', 'Stars'], ['nebula', 'Nebula'], ['aurora', 'Aurora'], ['warp', 'Space Travel'],
    ['fire', 'Fire'], ['smoke', 'Smoke'], ['clouds', 'Clouds'], ['ocean', 'Ocean'], ['waves', 'Liquid Waves'],
    ['portal', 'Portal'], ['energy', 'Energy'], ['lightning', 'Lightning'], ['magic', 'Magic'],
    ['particles', 'Particles'], ['plasma', 'Plasma'], ['fractal', 'Fractal'], ['kaleido', 'Kaleidoscope'], ['tunnel', 'Geometric Tunnel'],
    ['gradient', 'Ambient Gradient'], ['glow', 'Animated Light'],
    // added in 1.6.1
    ['flow', 'Silk Flow'], ['lava', 'Lava Lamp'], ['ink', 'Ink in Water'], ['bokeh', 'Bokeh Lights'], ['fireflies', 'Fireflies'], ['rays', 'Underwater Rays'],
    ['rain', 'Rain'], ['snow', 'Snowfall'], ['sunset', 'Sunset'], ['synth', 'Synthwave'], ['rings', 'Pulse Rings'], ['laser', 'Lasers'], ['disco', 'Disco Lights'], ['hex', 'Hex Pulse'],
    // added in 1.8: wall-scale and mapping-friendly studies
    ['wall-tide', 'Wall Tide'], ['ripple-choir', 'Ripple Choir'], ['ribbon-weave', 'Ribbon Weave'],
    ['murmuration', 'Murmuration'], ['frame-drips', 'Frame Drips'], ['cell-garden', 'Cell Garden'],
  ];
  // how the animation picker groups them (every animation appears exactly once)
  const GROUPS = [
    ['Calm', ['flow', 'lava', 'ink', 'bokeh', 'gradient', 'glow', 'plasma', 'wall-tide', 'ripple-choir', 'ribbon-weave', 'cell-garden']],
    ['Nature', ['fireflies', 'rays', 'ocean', 'waves', 'rain', 'snow', 'sunset', 'clouds', 'aurora', 'fire', 'smoke', 'lightning', 'murmuration', 'frame-drips']],
    ['Space', ['galaxy', 'stars', 'nebula', 'warp', 'portal']],
    ['Party', ['rings', 'laser', 'disco', 'synth', 'hex', 'tunnel', 'energy', 'particles', 'magic', 'kaleido', 'fractal']],
  ];
  const PRESET_IDS = PRESETS.map((p) => p[0]);
  // Saved animation IDs are part of the project format. Retarget an old name here if a later
  // overhaul replaces it; until then every current ID resolves to itself.
  const PRESET_ALIASES = Object.freeze(Object.fromEntries(PRESET_IDS.map((id) => [id, id])));
  const presetId = (id) => PRESET_ALIASES[id] || (PRESET_IDS.includes(id) ? id : 'galaxy');

  // Curated neighboring hues keep the palette transitions clear on a wall. Stops are sRGB hex.
  const PALETTES = Object.freeze({
    aurora: Object.freeze(['#07172b', '#176c70', '#63d39b', '#b6d7ef', '#07172b']),
    ember: Object.freeze(['#160d26', '#842943', '#ee693a', '#ffd08a', '#160d26']),
    tide: Object.freeze(['#06162b', '#075d83', '#24b2bb', '#d2f3df', '#06162b']),
    dusk: Object.freeze(['#19153b', '#5b4c8b', '#b96682', '#f1b98b', '#19153b']),
    mono: Object.freeze(['#08111f', '#3b4d62', '#a8bacb', '#f5f4eb', '#08111f']),
  });
  const PALETTE_IDS = Object.freeze(Object.keys(PALETTES));
  const paletteId = (id) => PALETTES[id] ? id : 'aurora';
  const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = (x) => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  const srgb = (x) => x <= 0.0031308 ? 12.92 * x : 1.055 * Math.max(0, x) ** (1 / 2.4) - 0.055;
  // OKLab interpolation is deterministic and avoids the gray midpoint of many direct RGB blends.
  function toLab(rgb) {
    const [r, g, b] = rgb.map(linear);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  }
  function fromLab([L, a, b]) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [srgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), srgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), srgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)].map((v) => clamp(v, 0, 1));
  }
  function paletteColor(id, phase) {
    const stops = PALETTES[paletteId(id)], n = Number(phase), t = Number.isFinite(n) ? clamp(n, 0, 1) : 0;
    const x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), k = x - i;
    const a = toLab(hexRgb(stops[i])), b = toLab(hexRgb(stops[i + 1]));
    return fromLab(a.map((v, j) => v + (b[j] - v) * k));
  }
  function palettePixels(id, size = 256) {
    size = Math.max(2, Math.min(1024, Math.round(Number(size) || 256)));
    const out = new Uint8Array(size * 4);
    for (let i = 0; i < size; i++) { const c = paletteColor(id, i / (size - 1)), j = i * 4; out[j] = Math.round(c[0] * 255); out[j + 1] = Math.round(c[1] * 255); out[j + 2] = Math.round(c[2] * 255); out[j + 3] = 255; }
    return out;
  }

  // Bounded audio semantics shared by profiles and tests. `body`, `air`, and `hit` are
  // derived from the existing analyzer so old saves need no migration.
  function audioFeature(F, key) {
    if (!F || F.silent) return 0;
    if (key === 'body') return clamp(((Number(F.lowMid) || 0) + (Number(F.mid) || 0)) * 0.5, 0, 1);
    if (key === 'air') return clamp(((Number(F.highMid) || 0) + (Number(F.treble) || 0)) * 0.5, 0, 1);
    if (key === 'hit') return clamp(Math.max(Number(F.onsetStrength) || 0, F.beat ? (Number(F.beatStrength) || 0.5) : 0, Number(F.impulse) || 0), 0, 1);
    if (key === 'beat') return F.beat ? 1 : 0;
    if (key === 'drop') return F.drop ? 1 : 0;
    const n = Number(F[key]);
    if (!Number.isFinite(n)) return 0;
    return key === 'trend' ? clamp(n, -1, 1) : clamp(n, 0, 1);
  }

  /* ---------- how each animation is performed by the music (1.7) ----------
     A profile maps audio features (from av-features.js) to visual controls the shaders understand:
       warp  displacement / distortion      turb  turbulence, viscosity, flow agitation
       emit  particle emission / density     swell expansion, amplitude, size
       spin  rotation / direction (signed)   tint  colour-distribution shift
       shim  fine ripples / shimmer          cplx  structural complexity (builds)
       shock beat shockwave strength (number) drop  drop-burst strength (number)
       speed how much energy speeds the animation's own clock (number)
     Each control = sum of weight x feature, limited to 0..1 (spin -1..1), then eased with its own attack/release.
     Features: sub bass lowMid mid highMid treble rms centroid flux impulse energy trend build dyn. */
  const CTRL = ['warp', 'turb', 'emit', 'swell', 'spin', 'tint', 'shim', 'cplx'];
  const EASE = { warp: [40, 260], turb: [140, 700], emit: [20, 220], swell: [30, 320], spin: [400, 1200], tint: [500, 1500], shim: [12, 140], cplx: [900, 2500] };
  const PROFILES = {
    galaxy: { swell: { bass: 0.5 }, spin: { mid: 0.35 }, emit: { treble: 0.9 }, tint: { centroid: 0.5 }, cplx: { build: 0.8 }, shock: 0.5, drop: 0.8, speed: 0.4 },
    stars: { emit: { treble: 0.7, highMid: 0.4 }, shim: { treble: 0.9 }, swell: { sub: 0.3 }, warp: { impulse: 0.2 }, shock: 0.3, drop: 0.6, speed: 0.5 },
    nebula: { swell: { bass: 0.8, sub: 0.3 }, tint: { mid: 0.6, centroid: 0.3 }, emit: { treble: 0.9 }, cplx: { build: 1, energy: 0.3 }, warp: { lowMid: 0.3 }, shock: 0.4, drop: 0.9, speed: 0.3 },
    aurora: { warp: { mid: 0.6, bass: 0.3 }, emit: { highMid: 0.6, treble: 0.3 }, turb: { flux: 0.5 }, shim: { treble: 0.5 }, tint: { centroid: 0.4 }, shock: 0.2, drop: 0.6, speed: 0.4 },
    warp: { swell: { bass: 0.7, sub: 0.4 }, emit: { treble: 0.6, rms: 0.3 }, spin: { mid: 0.4 }, shock: 0.6, drop: 1, speed: 0.9 },
    fire: { swell: { bass: 0.8, sub: 0.3 }, turb: { mid: 0.6, flux: 0.3 }, emit: { treble: 0.6 }, shim: { highMid: 0.4 }, shock: 0.3, drop: 0.9, speed: 0.5 },
    smoke: { turb: { mid: 0.8 }, swell: { bass: 0.5 }, warp: { lowMid: 0.5 }, tint: { centroid: 0.3 }, shock: 0.4, drop: 0.6, speed: 0.4 },
    clouds: { turb: { mid: 0.6 }, swell: { bass: 0.4 }, tint: { centroid: 0.4 }, warp: { lowMid: 0.3 }, shock: 0.2, drop: 0.5, speed: 0.5 },
    ocean: { warp: { bass: 0.8, sub: 0.3 }, turb: { mid: 0.6 }, shim: { treble: 0.9 }, tint: { centroid: 0.3 }, shock: 0.5, drop: 0.7, speed: 0.4 },
    waves: { swell: { bass: 0.9 }, shim: { treble: 0.9, highMid: 0.3 }, spin: { mid: 0.3 }, tint: { centroid: 0.5 }, shock: 0.4, drop: 0.7, speed: 0.5 },
    portal: { swell: { bass: 0.8 }, turb: { mid: 0.7 }, emit: { treble: 0.6 }, spin: { mid: 0.5 }, cplx: { build: 0.8 }, shock: 0.9, drop: 1, speed: 0.6 },
    energy: { swell: { bass: 0.8 }, turb: { mid: 0.6, flux: 0.4 }, shim: { treble: 0.8 }, emit: { highMid: 0.5 }, shock: 0.7, drop: 1, speed: 0.7 },
    lightning: { emit: { impulse: 1, flux: 0.4 }, swell: { bass: 0.5 }, turb: { mid: 0.5 }, shim: { treble: 0.5 }, shock: 0.4, drop: 1, speed: 0.6 },
    magic: { emit: { treble: 0.8, highMid: 0.4 }, swell: { bass: 0.6 }, spin: { mid: 0.6 }, tint: { centroid: 0.5 }, cplx: { build: 0.7 }, shock: 0.6, drop: 0.9, speed: 0.6 },
    particles: { swell: { bass: 0.7 }, emit: { treble: 0.8, flux: 0.3 }, turb: { mid: 0.5 }, shim: { treble: 0.4 }, shock: 0.6, drop: 1, speed: 0.9 },
    plasma: { warp: { bass: 0.6 }, swell: { bass: 0.7, sub: 0.3 }, tint: { mid: 0.6, centroid: 0.4 }, cplx: { build: 0.8, energy: 0.3 }, shim: { treble: 0.5 }, spin: { mid: 0.3 }, shock: 0.5, drop: 0.8, speed: 0.6 },
    fractal: { warp: { bass: 0.7 }, tint: { mid: 0.6 }, cplx: { build: 0.9 }, spin: { lowMid: 0.4 }, shim: { treble: 0.3 }, shock: 0.4, drop: 0.8, speed: 0.4 },
    kaleido: { spin: { mid: 0.8 }, cplx: { build: 0.9, energy: 0.4 }, swell: { bass: 0.6 }, tint: { centroid: 0.5 }, shim: { treble: 0.4 }, shock: 0.6, drop: 1, speed: 0.6 },
    tunnel: { swell: { bass: 0.6 }, spin: { mid: 0.7 }, cplx: { build: 0.7 }, tint: { centroid: 0.4 }, shock: 0.8, drop: 1, speed: 1 },
    gradient: { tint: { mid: 0.5, centroid: 0.4 }, warp: { bass: 0.4 }, swell: { rms: 0.3 }, shock: 0.15, drop: 0.4, speed: 0.3 },
    glow: { swell: { bass: 0.7, rms: 0.3 }, tint: { centroid: 0.4 }, shim: { treble: 0.3 }, shock: 0.3, drop: 0.6, speed: 0.3 },
    // added in 1.6.1
    flow: { swell: { bass: 0.9 }, spin: { mid: 0.7 }, shim: { treble: 0.8 }, cplx: { build: 1, energy: 0.2 }, tint: { centroid: 0.3 }, shock: 0.7, drop: 0.9, speed: 0.4 },
    lava: { swell: { bass: 0.9, sub: 0.3 }, turb: { mid: 0.8 }, shim: { treble: 0.8 }, tint: { centroid: 0.3 }, shock: 0.4, drop: 1, speed: 0.6 },
    ink: { swell: { bass: 0.9 }, turb: { mid: 0.8 }, emit: { treble: 0.9 }, tint: { centroid: 0.4 }, cplx: { build: 0.6 }, shock: 0.9, drop: 0.9, speed: 0.4 },
    bokeh: { swell: { bass: 0.6 }, emit: { treble: 0.7, highMid: 0.3 }, turb: { mid: 0.5 }, tint: { centroid: 0.4 }, shock: 0.3, drop: 0.7, speed: 0.5 },
    fireflies: { swell: { bass: 0.8 }, emit: { treble: 0.9, highMid: 0.3 }, turb: { mid: 0.4 }, shock: 0.4, drop: 0.8, speed: 0.5 },
    rays: { swell: { bass: 0.8 }, turb: { mid: 0.8 }, emit: { treble: 0.9 }, shim: { treble: 0.4 }, tint: { centroid: 0.3 }, shock: 0.3, drop: 0.7, speed: 0.4 },
    rain: { emit: { treble: 0.7, flux: 0.3 }, swell: { bass: 0.6 }, spin: { mid: 0.4 }, shim: { highMid: 0.5 }, shock: 0.4, drop: 0.9, speed: 0.8 },
    snow: { emit: { treble: 0.7 }, swell: { bass: 0.5 }, spin: { mid: 0.6 }, turb: { lowMid: 0.4 }, shock: 0.3, drop: 0.7, speed: 0.5 },
    sunset: { swell: { bass: 0.6 }, shim: { treble: 0.8 }, turb: { mid: 0.5 }, tint: { centroid: 0.4 }, shock: 0.2, drop: 0.6, speed: 0.3 },
    synth: { swell: { bass: 0.8 }, emit: { treble: 0.6 }, cplx: { build: 0.8 }, tint: { centroid: 0.3 }, shim: { highMid: 0.4 }, shock: 0.6, drop: 1, speed: 1 },
    rings: { swell: { bass: 0.9, sub: 0.3 }, emit: { treble: 0.9 }, tint: { centroid: 0.4 }, cplx: { build: 0.6 }, shock: 1, drop: 1, speed: 0.6 },
    laser: { emit: { treble: 0.6, highMid: 0.4 }, turb: { mid: 0.7 }, swell: { bass: 0.6 }, spin: { mid: 0.4 }, tint: { centroid: 0.4 }, shock: 0.5, drop: 1, speed: 0.8 },
    disco: { spin: { mid: 0.7 }, emit: { treble: 0.8 }, swell: { bass: 0.6 }, tint: { centroid: 0.5 }, shock: 0.6, drop: 1, speed: 0.7 },
    hex: { swell: { bass: 0.8 }, emit: { treble: 0.5 }, tint: { mid: 0.5, centroid: 0.3 }, cplx: { build: 0.7 }, shock: 0.9, drop: 1, speed: 0.6 },
    'wall-tide': { swell: { bass: 0.9, sub: 0.25 }, warp: { lowMid: 0.35 }, shim: { treble: 0.65 }, tint: { centroid: 0.25 }, shock: 0.55, drop: 0.8, speed: 0.45 },
    'ripple-choir': { swell: { bass: 0.8, sub: 0.25 }, emit: { treble: 0.65 }, shim: { highMid: 0.45 }, tint: { centroid: 0.3 }, shock: 0.8, drop: 0.8, speed: 0.5 },
    'ribbon-weave': { turb: { mid: 0.65, flux: 0.25 }, spin: { mid: 0.4 }, shim: { treble: 0.8 }, swell: { bass: 0.4 }, tint: { centroid: 0.35 }, shock: 0.5, drop: 0.75, speed: 0.55 },
    murmuration: { emit: { treble: 0.75, flux: 0.25 }, turb: { mid: 0.5 }, swell: { bass: 0.65 }, shim: { highMid: 0.4 }, tint: { centroid: 0.3 }, shock: 0.6, drop: 0.85, speed: 0.7 },
    'frame-drips': { swell: { bass: 0.65 }, turb: { mid: 0.45 }, emit: { treble: 0.7 }, shim: { highMid: 0.35 }, tint: { centroid: 0.2 }, shock: 0.4, drop: 0.65, speed: 0.35 },
    'cell-garden': { swell: { bass: 0.75 }, turb: { mid: 0.65 }, cplx: { build: 0.65 }, tint: { centroid: 0.35 }, shim: { treble: 0.5 }, shock: 0.6, drop: 0.8, speed: 0.4 },
  };
  // Live controls for one shape: st holds eased values between frames (create once with newControls()).
  // out: Float32Array(12) = [warp, turb, emit, swell, spin, tint, shockR, shockA, hit, cplx, shim, drop]. No allocation.
  const newControls = () => ({ v: new Float32Array(8), shockR: 0, shockA: 0, drop: 0, speedK: 1, out: new Float32Array(12) });
  function controls(id, F, dt, st, amount) {
    const P = PROFILES[id] || PROFILES.gradient, out = st.out, k = clamp(amount == null ? 1 : amount, 0, 2);
    for (let i = 0; i < 8; i++) {
      const name = CTRL[i], w = P[name]; let target = 0;
      if (w && F && !F.silent) for (const f in w) target += w[f] * audioFeature(F, f);
      target = name === 'spin' ? clamp(target * k * (audioFeature(F, 'trend') < 0 ? -1 : 1), -1, 1) : clamp(target * k, 0, 1);
      const [a, r] = EASE[name], cur = st.v[i]; st.v[i] = cur + (target - cur) * (1 - Math.exp(-dt * 1000 / (Math.abs(target) > Math.abs(cur) ? a : r)));
    }
    if (F && F.beat && P.shock) { st.shockR = 0; st.shockA = Math.max(st.shockA, clamp(P.shock * (F.beatStrength || 0.5) * k, 0, 1)); }
    st.shockR = Math.min(1, st.shockR + dt / 0.65); st.shockA *= Math.exp(-dt / 0.45);
    if (F && F.drop && P.drop) st.drop = clamp(P.drop * k, 0, 1); else st.drop *= Math.exp(-dt / 1.4);
    const sp = 1 + (P.speed || 0) * k * (F && !F.silent ? (F.energy || 0) * 0.9 + (F.impulse || 0) * 0.4 : 0);
    st.speedK += (sp - st.speedK) * (1 - Math.exp(-dt / 0.6));
    out[0] = st.v[0]; out[1] = st.v[1]; out[2] = st.v[2]; out[3] = st.v[3]; out[4] = st.v[4]; out[5] = st.v[5]; out[6] = st.shockR; out[7] = st.shockA;
    out[8] = F && !F.silent ? (F.impulse || 0) * k : 0; out[9] = st.v[7]; out[10] = st.v[6]; out[11] = st.drop;
    return out;
  }
  const BLENDS = ['normal', 'add', 'screen'];
  const LIGHT_MODES = [
    ['off', 'Projection Only', 'The projector runs on its own. Bulbs are left alone.'],
    ['match', 'Match Colours', 'Bulbs take the main colour of the projection.'],
    ['ambient', 'Ambient', 'Bulbs give a softer, complementary colour to the projection.'],
    ['music', 'Music Sync', 'Bulbs keep the projection colour and pulse with the music.'],
    ['immersive', 'Immersive', 'Colour, brightness and music all drive the bulbs together.'],
    ['custom', 'Custom', 'Choose what each bulb does.'],
  ];
  const STYLES = { subtle: 0.5, balanced: 1, intense: 1.7 };
  const uid = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* ---------- geometry (points are [x, y] in 0..1 of the projector image) ---------- */
  const area2 = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; } return a; };
  function pointInPoly(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  // Ear clipping: works for any simple polygon, convex or not. Returns triangles as index triples.
  function triangulate(poly) {
    const n = poly.length; if (n < 3) return [];
    const idx = poly.map((_, i) => i); if (area2(poly) < 0) idx.reverse();
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const inTri = (p, a, b, c) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
    const out = []; let guard = n * n;
    while (idx.length > 3 && guard-- > 0) {
      let cut = false;
      for (let i = 0; i < idx.length; i++) {
        const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
        if (cross(poly[a], poly[b], poly[c]) <= 1e-12) continue; // reflex or flat corner
        if (idx.some((k) => k !== a && k !== b && k !== c && inTri(poly[k], poly[a], poly[b], poly[c]))) continue;
        out.push([a, b, c]); idx.splice(i, 1); cut = true; break;
      }
      if (!cut) break; // self-intersecting shape: fall back to a fan below
    }
    if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
    else for (let i = 1; i < idx.length - 1; i++) out.push([idx[0], idx[i], idx[i + 1]]);
    return out;
  }
  const bbox = (p) => { const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
  const centre = (p) => { const b = bbox(p); return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; };
  const moved = (p, dx, dy) => p.map(([x, y]) => [x + dx, y + dy]);
  // aspect = image width / height, so a rotation looks like a rotation on the wall
  function rotated(p, deg, aspect = 16 / 9) { const [cx, cy] = centre(p), a = (deg * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a); return p.map(([x, y]) => { const dx = (x - cx) * aspect, dy = y - cy; return [cx + (dx * co - dy * si) / aspect, cy + dx * si + dy * co]; }); }
  function scaled(p, k) { const [cx, cy] = centre(p); return p.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]); }
  const shape = (kind, cx = 0.5, cy = 0.5, w = 0.3, h = 0.3) => {
    if (kind === 'triangle') return [[cx, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
    if (kind === 'polygon') return [0, 1, 2, 3, 4, 5].map((i) => [cx + (Math.cos((i * Math.PI) / 3) * w) / 2, cy + (Math.sin((i * Math.PI) / 3) * h) / 2]);
    return [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
  };

  /* ---------- project format ---------- */
  const num = (v, a, b, d) => { v = Number(v); return Number.isFinite(v) ? clamp(v, a, b) : d; };
  const str = (v, n, d = '') => (typeof v === 'string' ? v.slice(0, n) : d);
  function region(o = {}) {
    const pts = (Array.isArray(o.pts) ? o.pts : []).filter((p) => Array.isArray(p) && p.length === 2).slice(0, 64).map((p) => [num(p[0], -0.5, 1.5, 0.5), num(p[1], -0.5, 1.5, 0.5)]);
    return { id: str(o.id, 40) || uid(), name: str(o.name, 40, 'Shape'), surface: str(o.surface, 40, 'Main wall'), pts: pts.length >= 3 ? pts : shape('rect'),
      preset: presetId(o.preset), speed: num(o.speed, 0, 4, 1), hue: num(o.hue, 0, 360, 0), bright: num(o.bright, 0, 2, 1), opacity: num(o.opacity, 0, 1, 1),
      blend: BLENDS.includes(o.blend) ? o.blend : 'normal', react: num(o.react, 0, 1, 0.5), band: ['bass', 'mid', 'treble', 'level'].includes(o.band) ? o.band : 'bass',
      lights: (Array.isArray(o.lights) ? o.lights : []).filter((x) => typeof x === 'string').slice(0, 50), hidden: !!o.hidden };
  }
  function project(o = {}) {
    const L = o.lights || {}, A = o.audio || {};
    return { id: str(o.id, 40), name: str(o.name, 60, 'New room'), regions: (Array.isArray(o.regions) ? o.regions : []).slice(0, 60).map(region), palette: paletteId(o.palette),
      lights: { mode: LIGHT_MODES.some((m) => m[0] === L.mode) ? L.mode : 'off', brightness: num(L.brightness, 5, 100, 80), sensitivity: num(L.sensitivity, 0.3, 3, 1), smooth: num(L.smooth, 0, 0.95, 0.6),
        exclude: (Array.isArray(L.exclude) ? L.exclude : []).filter((x) => typeof x === 'string').slice(0, 200),
        custom: Object.fromEntries(Object.entries(L.custom && typeof L.custom === 'object' ? L.custom : {}).filter(([, v]) => ['match', 'ambient', 'music', 'immersive', 'off'].includes(v)).slice(0, 200)) },
      audio: { source: A.source === 'mic' ? 'mic' : 'system', style: STYLES[A.style] ? A.style : 'balanced', sensitivity: num(A.sensitivity, 0.3, 3, 1) },
      // 1.7: how the projection is driven. Older projects have no mode: they behave as Music Reactive (as before).
      mode: MODES.includes(o.mode) ? o.mode : 'reactive',
      auto: { personality: DIR && DIR.PERSONALITIES[(o.auto || {}).personality] ? o.auto.personality : 'ambient', ...(DIR ? DIR.normSettings(o.auto) : {}) },
      sync: { displayMs: num((o.sync || {}).displayMs, 0, 500, 40) },
      // 1.8 continuous evolution: on/off, speed, complexity, music influence, autonomous variation, visual intensity, transition style
      evolve: { ...(EVO ? EVO.normSettings(o.evolve) : {}), xf: XF.includes((o.evolve || {}).xf) ? o.evolve.xf : 'auto' },
      quality: Q ? Q.normalize(o.quality) : (['low', 'medium', 'high'].includes(o.quality) ? o.quality : 'medium'), autoQuality: o.autoQuality !== false,
      grid: !!o.grid, outlines: !!o.outlines, blackout: !!o.blackout, photo: typeof o.photo === 'string' && o.photo.startsWith('data:image/') && o.photo.length < 600000 ? o.photo : '', photoOpacity: num(o.photoOpacity, 0, 1, 0.5) };
  }
  const R = (name, preset, pts, extra) => region({ name, preset, pts, ...extra });
  const STARTERS = [
    { name: 'Bedroom galaxy', regions: [
      R('Main wall', 'galaxy', shape('rect', 0.5, 0.5, 0.96, 0.92), { speed: 0.6 }),
      R('Picture frame (left)', 'fire', shape('rect', 0.2, 0.34, 0.16, 0.26), { react: 0.7 }),
      R('Picture frame (right)', 'portal', shape('rect', 0.8, 0.32, 0.15, 0.24)),
      R('Doorway', 'energy', shape('rect', 0.5, 0.62, 0.2, 0.66), { blend: 'add' }),
      R('Around the dresser', 'particles', [[0.62, 0.72], [0.96, 0.72], [0.96, 0.96], [0.62, 0.96]], { blend: 'add', opacity: 0.9 })] },
    { name: 'Fireplace evening', regions: [
      R('Wall glow', 'gradient', shape('rect', 0.5, 0.5, 0.96, 0.92), { hue: 20, bright: 0.6 }),
      R('Fireplace', 'fire', shape('rect', 0.5, 0.74, 0.32, 0.4), { react: 0.3 }),
      R('Smoke above', 'smoke', [[0.38, 0.1], [0.62, 0.1], [0.66, 0.52], [0.34, 0.52]], { blend: 'screen', opacity: 0.7 })] },
    { name: 'Ocean window', regions: [
      R('Window', 'ocean', shape('rect', 0.5, 0.42, 0.5, 0.6)),
      R('Sky strip', 'clouds', shape('rect', 0.5, 0.08, 0.96, 0.12)),
      R('Floor shimmer', 'waves', [[0.1, 0.8], [0.9, 0.8], [1, 0.98], [0, 0.98]], { opacity: 0.8 })] },
  ];

  /* ---------- from projected colour to bulb targets ---------- */
  // in: { mode, ids, custom, brightness, sensitivity, style, dom:[r,g,b]|null, regional:{lightId:[r,g,b]}, audio:{bass,level,beat}|null }
  // out: { lightId: { rgb, bri } }. Never includes an excluded light or one whose behaviour is "off".
  function lightTargets(o) {
    const out = {}, max = o.brightness, a = o.audio || { bass: 0, level: 0, beat: false };
    const drive = clamp((a.bass * 0.7 + a.level * 0.3) * (o.sensitivity || 1) * (STYLES[o.style] || 1), 0, 1);
    (o.ids || []).forEach((id, i) => {
      const how = o.mode === 'custom' ? ((o.custom || {})[id] || 'match') : o.mode;
      if (how === 'off' || !how) return;
      const base = (o.regional || {})[id] || o.dom; if (!base) return; // nothing lit on the wall: leave the bulb as it is
      const [h, s, v] = C.rgbToHsv(base), lum = (0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2]) / 255;
      let rgb = C.hsvToRgb([h, s, 1]), bri;
      if (how === 'match') bri = max * clamp(0.3 + v * 0.7, 0, 1);
      else if (how === 'ambient') { rgb = C.hsvToRgb([(h + 150) % 360, s * 0.6, 1]); bri = max * 0.45; }
      else if (how === 'music') bri = max * (0.15 + 0.85 * drive) * (a.beat ? 1 : 0.92);
      else { rgb = C.hsvToRgb([(h + (i % 2 ? 18 : -18) + 360) % 360, s, 1]); bri = max * clamp(0.25 + 0.4 * lum + 0.55 * drive, 0, 1); }
      out[id] = { rgb: rgb.map(Math.round), bri: clamp(Math.round(bri), 1, 100) };
    });
    return out;
  }

  // dominant hue of each animation (radians, measured from rendered frames; null = mostly grey), used to keep colour
  // continuity when one animation changes into another
  const HUES = {"galaxy":-0.74,"stars":-1.2,"nebula":2.15,"aurora":-1.65,"warp":-1.96,"fire":0.9,"smoke":null,"clouds":-2.17,"ocean":-1.84,"waves":-2.65,"portal":null,"energy":-0.83,"lightning":-1.14,"magic":1.88,"particles":1.43,"plasma":1.29,"fractal":2.57,"kaleido":3.11,"tunnel":-1.87,"gradient":-0.87,"glow":0.96,"flow":-1.49,"lava":0.85,"ink":2.24,"bokeh":1.13,"fireflies":2.33,"rays":-2.33,"rain":-1.81,"snow":-1.94,"sunset":-0.02,"synth":0.15,"rings":1.69,"laser":1.92,"disco":1.71,"hex":-1.05,"wall-tide":-1.84,"ripple-choir":-2.17,"ribbon-weave":-1.49,"murmuration":-1.2,"frame-drips":0.9,"cell-garden":1.29};
  const api = { MODES, XF, HUES, PRESETS, PRESET_IDS, PRESET_ALIASES, presetId, PALETTES, PALETTE_IDS, paletteId, paletteColor, palettePixels, audioFeature, GROUPS, PROFILES, CTRL, newControls, controls, BLENDS, LIGHT_MODES, STYLES, STARTERS, uid, pointInPoly, triangulate, bbox, centre, moved, rotated, scaled, shape, region, project, lightTargets };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LumenProj = api;
})(typeof window !== 'undefined' ? window : globalThis);
