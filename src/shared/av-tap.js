/* Lumen audio tap (1.7): low-band energy measured on the AUDIO thread.

   The page reads the analyser (spectrum) on a timer, and under heavy drawing that timer can fire every 100-200 ms
   instead of every 20 ms, which smears beat timing. This tap runs inside an AudioWorklet, sees every sample, and
   reports the energy of the low band (two one-pole low-pass stages at ~150 Hz: kick and bass) every 10 ms, stamped
   with the audio clock. The feature engine (av-features.js feed()) finds kicks and the tempo from it at their real
   times. It is not an FFT: the analyser's one FFT is still the only one.

   tapCore(sampleRate) -> { push(Float32Array mono) -> hops filled since the last take; take(dst) -> n; hop (samples) }
   workletSource() -> source text of the AudioWorklet module (registers 'lumen-tap'), loaded through a Blob URL so
   it works from file:// pages in Electron and in tests.                                                          */
(function (root) {
  'use strict';
  // Self-contained (it is also serialised into the worklet): no references to anything outside this function.
  function tapCore(sampleRate) {
    const hop = Math.max(64, Math.round(sampleRate / 100)), a = 1 - Math.exp(-2 * Math.PI * 150 / sampleRate);
    const out = new Float32Array(64); let y1 = 0, y2 = 0, acc = 0, k = 0, n = 0;
    return {
      hop,
      push(x) {
        for (let i = 0; i < x.length; i++) {
          y1 += a * (x[i] - y1); y2 += a * (y1 - y2); acc += y2 * y2;
          if (++k >= hop) { if (n < out.length) out[n++] = acc / hop; acc = 0; k = 0; }
        }
        return n;
      },
      take(dst) { const m = Math.min(n, dst.length); for (let i = 0; i < m; i++) dst[i] = out[i]; n = 0; return m; },
    };
  }
  function workletSource() {
    return `const tapCore = ${tapCore.toString()};
class LumenTap extends AudioWorkletProcessor {
  constructor() { super(); this.c = tapCore(sampleRate); this.buf = new Float32Array(64); this.since = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]; if (!ch) return true;
    let mono = ch; const ch2 = inputs[0][1];
    if (ch2) { if (!this.m || this.m.length !== ch.length) this.m = new Float32Array(ch.length); for (let i = 0; i < ch.length; i++) this.m[i] = (ch[i] + ch2[i]) * 0.5; mono = this.m; }
    const n = this.c.push(mono); this.since += ch.length;
    if (n >= 8) { const m = this.c.take(this.buf); this.port.postMessage({ t: currentTime + ch.length / sampleRate, hopS: this.c.hop / sampleRate, e: this.buf.slice(0, m) }); }
    return true;
  }
}
registerProcessor('lumen-tap', LumenTap);`;
  }
  const api = { tapCore, workletSource };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LumenTap = api;
})(typeof window !== 'undefined' ? window : globalThis);
