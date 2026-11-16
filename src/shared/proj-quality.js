/* Shared Projection Studio quality tiers and frame-time fallback policy. */
(function (root) {
  'use strict';
  const TIERS = Object.freeze(['low', 'medium', 'high']);
  const SCALE = Object.freeze({ low: 0.5, medium: 0.75, high: 1 });
  const MAX_PIXELS = 8388608, MAX_DIMENSION = 4096;
  const normalize = (v) => TIERS.includes(v) ? v : 'medium';
  const label = (v) => ({ low: 'Low', medium: 'Medium', high: 'High' })[normalize(v)];
  const index = (v) => TIERS.indexOf(normalize(v));
  function create(requested) { const level = normalize(requested); return { requested: level, level, slow: 0, stable: 0, auto: true }; }
  function configure(state, requested, auto = true) {
    const level = normalize(requested), enabled = auto !== false;
    if (state.requested !== level || state.auto !== enabled) {
      state.requested = level; state.level = level; state.slow = 0; state.stable = 0; state.auto = enabled;
    }
    if (!enabled) state.level = level;
    return state.level;
  }
  // A sustained 20ms frame interval is below 50fps at the 60fps target. Long gaps (window hidden,
  // display change) are ignored, while stable recovery needs six seconds.
  function observe(state, frameMs, targetMs = 1000 / 60) {
    const ms = Number(frameMs), target = Number.isFinite(Number(targetMs)) && Number(targetMs) > 0 ? Number(targetMs) : 1000 / 60;
    if (!state.auto || !Number.isFinite(ms) || ms <= 0 || ms > 250) { state.slow = 0; state.stable = 0; return state.level; }
    const slowAt = Math.max(20, target * 1.2), goodAt = target * 1.05;
    if (ms > slowAt) {
      state.slow = Math.min(1200, state.slow + ms); state.stable = 0;
      if (state.slow >= 1200) { if (index(state.level) > 0) state.level = TIERS[index(state.level) - 1]; state.slow = 0; }
    } else if (ms < goodAt) {
      state.stable = Math.min(6000, state.stable + ms); state.slow = Math.max(0, state.slow - ms * 1.5);
      if (state.stable >= 6000 && index(state.level) < index(state.requested)) { state.level = TIERS[index(state.level) + 1]; state.stable = 0; }
    } else { state.slow = Math.max(0, state.slow - ms); state.stable = 0; }
    return state.level;
  }
  function backingSize(width, height, dpr = 1, tier = 'medium') {
    const widthValue = Number(width), heightValue = Number(height);
    const w = Math.max(1, Number.isFinite(widthValue) ? widthValue : 1), h = Math.max(1, Number.isFinite(heightValue) ? heightValue : 1);
    const ratio = Math.max(1, Math.min(2, Number(dpr) || 1)) * SCALE[normalize(tier)];
    let rw = w * ratio, rh = h * ratio;
    const cap = Math.min(1, MAX_DIMENSION / rw, MAX_DIMENSION / rh, Math.sqrt(MAX_PIXELS / (rw * rh)));
    rw = Math.max(1, Math.floor(rw * cap)); rh = Math.max(1, Math.floor(rh * cap));
    return [rw, rh];
  }
  const api = { TIERS, SCALE, MAX_PIXELS, MAX_DIMENSION, normalize, label, create, configure, observe, backingSize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LumenProjQuality = api;
})(typeof window !== 'undefined' ? window : globalThis);
