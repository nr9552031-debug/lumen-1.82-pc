/* Pure audio/screen analysis used by the Effects page. Loaded by the renderer as a plain script and by the
   tests through require(), so it must not touch the DOM. */
(function (root) {
  'use strict';
  const clamp01 = (n) => Math.min(1, Math.max(0, n));
  const BANDS = { bass: [30, 180], mid: [180, 2000], treble: [2000, 9000] };
  const KEYS = ['bass', 'mid', 'treble', 'level'];

  // freq: bytes from AnalyserNode.getByteFrequencyData (0..255 per bin). Returns 0..1 energy per band.
  // edges (optional): { low, high } crossover frequencies in Hz between bass/mids and mids/highs.
  function bands(freq, sampleRate, fftSize, edges) {
    const hz = sampleRate / fftSize, out = {}, lo = (edges && edges.low) || BANDS.bass[1], hi = (edges && edges.high) || BANDS.mid[1];
    const R = { bass: [BANDS.bass[0], lo], mid: [lo, hi], treble: [hi, BANDS.treble[1]] };
    for (const name of Object.keys(R)) {
      const a = Math.max(1, Math.floor(R[name][0] / hz)), b = Math.min(freq.length - 1, Math.ceil(R[name][1] / hz));
      let sum = 0; for (let i = a; i <= b; i++) sum += freq[i];
      out[name] = b >= a ? sum / ((b - a + 1) * 255) : 0;
    }
    out.level = out.bass * 0.5 + out.mid * 0.35 + out.treble * 0.15;
    return out;
  }

  // Turns raw band energy into what the light show uses:
  //  - automatic gain, so quiet and loud sources both use the full 0..1 range
  //  - beat detection: a bass spike well above the recent average, never closer together than minBeatGapMs
  function createTracker(opts) {
    const o = Object.assign({ historyMs: 1500, minBeatGapMs: 300, silence: 0.012 }, opts);
    const peak = { bass: 0.05, mid: 0.05, treble: 0.05, level: 0.05 };
    let hist = [], lastBeat = -1e9, prevBass = 0;
    return function step(raw, tMs) {
      const f = { beat: false, silent: raw.level < o.silence };
      for (const k of KEYS) { peak[k] = Math.max(raw[k], peak[k] * 0.997, 0.03); f[k] = f.silent ? 0 : clamp01(raw[k] / peak[k]); }
      while (hist.length && tMs - hist[0][0] > o.historyMs) hist.shift();
      if (!f.silent && hist.length >= 8) {
        let mean = 0; for (const h of hist) mean += h[1]; mean /= hist.length;
        let v = 0; for (const h of hist) v += (h[1] - mean) * (h[1] - mean);
        const sd = Math.sqrt(v / hist.length);
        if (raw.bass > mean + Math.max(0.04, 0.7 * sd) && raw.bass > prevBass && tMs - lastBeat >= o.minBeatGapMs) { f.beat = true; lastBeat = tMs; }
      }
      hist.push([tMs, raw.bass]); prevBass = raw.bass;
      return f;
    };
  }

  // Main colour of an RGBA pixel buffer, weighted toward vivid pixels so a mostly-grey screen with one bright
  // object still gives that object's colour. Returns [r,g,b], or null when the screen is essentially black.
  function screenColor(data) {
    let r = 0, g = 0, b = 0, w = 0, lum = 0, n = 0;
    for (let i = 0; i + 3 < data.length; i += 4) {
      const R = data[i], G = data[i + 1], B = data[i + 2], mx = Math.max(R, G, B), mn = Math.min(R, G, B);
      const k = 0.08 + (mx ? (mx - mn) / mx : 0) * (mx / 255);
      r += R * k; g += G * k; b += B * k; w += k; lum += mx; n++;
    }
    if (!n || lum / n < 10) return null;
    return [Math.round(r / w), Math.round(g / w), Math.round(b / w)];
  }

  // Loudness of a block of time-domain bytes (AnalyserNode.getByteTimeDomainData), 0..1.
  function rms(time) { let s = 0; for (let i = 0; i < time.length; i++) { const v = (time[i] - 128) / 128; s += v * v; } return Math.sqrt(s / (time.length || 1)); }
  const api = { bands, createTracker, screenColor, rms, BANDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LumenAudio = api;
})(typeof window !== 'undefined' ? window : globalThis);
