/* The one place colour maths lives. Loaded by the main process (require) and by the page (script tag). */
(function (root) {
  'use strict';
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const hex = (rgb) => '#' + rgb.map((n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')).join('');
  function rgbToHsv([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
    return [h, mx ? d / mx : 0, mx];
  }
  function hsvToRgb([h, s, v]) {
    h = ((h % 360) + 360) % 360; const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }
  // Approximate RGB of a white of the given colour temperature (for previews and fallbacks).
  function kelvinToRgb(k) {
    const t = clamp(k, 1000, 40000) / 100;
    const r = t <= 66 ? 255 : clamp(329.698727446 * Math.pow(t - 60, -0.1332047592), 0, 255);
    const g = t <= 66 ? clamp(99.4708025861 * Math.log(t) - 161.1195681661, 0, 255) : clamp(288.1221695283 * Math.pow(t - 60, -0.0755148492), 0, 255);
    const b = t >= 66 ? 255 : t <= 19 ? 0 : clamp(138.5177312231 * Math.log(t - 10) - 305.0447927307, 0, 255);
    return [Math.round(r), Math.round(g), Math.round(b)];
  }
  // Colour -> nearest white temperature, for lights that can't do colour.
  function rgbToKelvin(rgb) { return Math.round(clamp(4600 - ((rgb[0] - rgb[2]) / 255) * 2300, 2200, 6500)); }
  const lerpRgb = (a, b, k) => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * k);
  // Accepts #rgb, #rrggbb, "r, g, b", rgb(r,g,b), hsv(h,s%,v%), hsl(h,s%,l%). Returns [r,g,b] or null.
  function parseColor(str) {
    const s = String(str || '').trim().toLowerCase();
    let m = /^#?([0-9a-f]{3})$/.exec(s); if (m) return m[1].split('').map((c) => parseInt(c + c, 16));
    m = /^#?([0-9a-f]{6})$/.exec(s); if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    const nums = (s.match(/-?\d+(\.\d+)?/g) || []).map(Number);
    if (nums.length !== 3) return null;
    if (s.startsWith('hsv')) return hsvToRgb([nums[0], clamp(nums[1], 0, 100) / 100, clamp(nums[2], 0, 100) / 100]);
    if (s.startsWith('hsl')) { const l = clamp(nums[2], 0, 100) / 100, sl = clamp(nums[1], 0, 100) / 100, v = l + sl * Math.min(l, 1 - l); return hsvToRgb([nums[0], v ? 2 * (1 - l / v) : 0, v]); }
    if (/^(rgb\s*\()?[\d\s,.]+\)?$/.test(s) && nums.every((n) => n >= 0 && n <= 255)) return nums.map(Math.round);
    return null;
  }
  // A light's stored state -> the command that reproduces it.
  function statePatch(s) {
    if (!s || s.on === false) return { on: false };
    const p = { on: true };
    if (s.brightness) p.brightness = s.brightness;
    if (s.mode === 'color' && s.rgb) p.rgb = s.rgb; else if (s.rgb && !s.kelvin) p.rgb = s.rgb; else if (s.kelvin) p.kelvin = s.kelvin;
    return p;
  }
  // What colour a light in this state looks like, for swatches and previews.
  const stateRgb = (s) => (s && (s.mode === 'color' || !s.kelvin) && s.rgb) ? s.rgb : kelvinToRgb((s && s.kelvin) || 2700);
  const api = { clamp, hex, rgbToHsv, hsvToRgb, kelvinToRgb, rgbToKelvin, lerpRgb, parseColor, statePatch, stateRgb };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LumenColor = api;
})(typeof window !== 'undefined' ? window : globalThis);
