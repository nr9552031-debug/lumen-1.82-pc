'use strict';
// Offline music analysis for the Lightshow workspace. Pure JavaScript, no dependencies: it runs in the page (after the
// browser has decoded the file to PCM) and in Node (the tests decode with ffmpeg). Nothing here touches any light.
//
// Output (all times in seconds):
//   { v, duration, bpm, bpmConf, beats[], downPhase, kicks[[t,s]], snares[[t,s]], hats[[t,s]],
//     curve{dt,e,low,mid,high,vox,cent}, sections[{t0,t1,label,group,energy,vocal}], drops[{t,s}], builds[{t0,t1}],
//     breakdowns[{t0,t1}], wave{rate,d[min,max,...] as ints -127..127} }
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.LumenAnalysis = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const N = 1024, H = 256;

  // ---- FFT (radix-2, in place) ----
  const tw = { cos: new Float64Array(N / 2), sin: new Float64Array(N / 2), rev: new Uint16Array(N), win: new Float64Array(N) };
  for (let i = 0; i < N / 2; i++) { tw.cos[i] = Math.cos(2 * Math.PI * i / N); tw.sin[i] = -Math.sin(2 * Math.PI * i / N); }
  for (let i = 0; i < N; i++) { let r = 0, x = i; for (let b = 0; b < 10; b++) { r = (r << 1) | (x & 1); x >>= 1; } tw.rev[i] = r; tw.win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); }
  function fft(re, im) {
    for (let i = 0; i < N; i++) { const j = tw.rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1, step = N / size;
      for (let s = 0; s < N; s += size) for (let k = 0, w = 0; k < half; k++, w += step) {
        const a = s + k, b = a + half, tr = re[b] * tw.cos[w] - im[b] * tw.sin[w], ti = re[b] * tw.sin[w] + im[b] * tw.cos[w];
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }

  // ---- small helpers ----
  function movingStats(x, w) { // mean and std over a centred window of w samples, O(n)
    const n = x.length, ps = new Float64Array(n + 1), pq = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) { ps[i + 1] = ps[i] + x[i]; pq[i + 1] = pq[i] + x[i] * x[i]; }
    const mean = new Float64Array(n), sd = new Float64Array(n), h = w >> 1;
    for (let i = 0; i < n; i++) { const a = Math.max(0, i - h), b = Math.min(n, i + h + 1), c = b - a, m = (ps[b] - ps[a]) / c; mean[i] = m; sd[i] = Math.sqrt(Math.max(0, (pq[b] - pq[a]) / c - m * m)); }
    return { mean, sd };
  }
  const pct = (arr, p) => { const s = Float64Array.from(arr).sort(); return s.length ? s[clamp(Math.floor(p * (s.length - 1)), 0, s.length - 1)] : 0; };
  const median = (a) => pct(a, 0.5);
  function peakPick(x, fps, { k = 1, gap = 0.08, win = 1 } = {}) {
    const { mean, sd } = movingStats(x, Math.round(fps * win)), floor = 0.08 * pct(x, 0.95), out = [];
    for (let i = 2; i < x.length - 2; i++) {
      if (x[i] <= mean[i] + k * sd[i] + floor) continue;
      if (x[i] < x[i - 1] || x[i] < x[i - 2] || x[i] <= x[i + 1] || x[i] < x[i + 2]) continue;
      const last = out[out.length - 1];
      if (last && (i - last.i) / fps < gap) { if (x[i] > last.v) { last.i = i; last.v = x[i]; } continue; }
      out.push({ i, v: x[i] });
    }
    const ref = pct(out.map((p) => p.v), 0.9) || 1;
    return out.map((p) => [r3(p.i / fps), r3(clamp(p.v / ref, 0.05, 1))]);
  }
  const yieldUI = () => new Promise((r) => setTimeout(r, 0));

  // ---- main ----
  async function analyze(pcm, sr, opt = {}) {
    const prog = opt.onProgress || (() => {}), doYield = opt.yield !== false;
    const dur = pcm.length / sr;
    if (dur < 2) throw new Error('That audio is too short to analyse (under 2 seconds).');
    // waveform peaks, 100 per second, from the full-rate signal
    const wr = 100, wn = Math.ceil(dur * wr), wave = new Array(wn * 2), per = sr / wr;
    for (let i = 0; i < wn; i++) { let lo = 0, hi = 0; const a = Math.floor(i * per), b = Math.min(pcm.length, Math.floor((i + 1) * per)); for (let j = a; j < b; j++) { const v = pcm[j]; if (v < lo) lo = v; if (v > hi) hi = v; } wave[2 * i] = lo; wave[2 * i + 1] = hi; }
    let wmax = 1e-9; for (const v of wave) if (Math.abs(v) > wmax) wmax = Math.abs(v);
    for (let i = 0; i < wave.length; i++) wave[i] = Math.round(wave[i] / wmax * 127);
    prog(0.05);
    // decimate to ~22 kHz and normalise
    const f = Math.max(1, Math.round(sr / 22050)), sr2 = sr / f, n2 = Math.floor(pcm.length / f), x = new Float32Array(n2);
    for (let i = 0; i < n2; i++) { let s = 0; for (let j = 0; j < f; j++) s += pcm[i * f + j]; x[i] = s / f; }
    let pk = 1e-9; for (let i = 0; i < n2; i += 7) if (Math.abs(x[i]) > pk) pk = Math.abs(x[i]);
    for (let i = 0; i < n2; i++) x[i] /= pk;
    // STFT
    const nF = Math.max(2, Math.floor(n2 / H)), fps = sr2 / H, binHz = sr2 / N, hzBin = (hz) => clamp(Math.round(hz / binHz), 1, N / 2 - 1);
    const edges = [[20, 60], [60, 250], [250, 500], [500, 2000], [2000, 4000], [4000, Math.min(10500, sr2 / 2 - 100)]].map(([a, b]) => [hzBin(a), hzBin(b)]);
    const rg = { kick: [hzBin(30), hzBin(150)], snareLo: [hzBin(150), hzBin(400)], snareHi: [hzBin(2500), hzBin(8000)], hat: [hzBin(6000), hzBin(Math.min(10500, sr2 / 2 - 100))] };
    const E = edges.map(() => new Float32Array(nF)), fluxAll = new Float32Array(nF), fluxKick = new Float32Array(nF), fluxSn = new Float32Array(nF), fluxHat = new Float32Array(nF), cent = new Float32Array(nF), fluxLin = new Float32Array(nF), pLin = new Float64Array(N / 2 + 1), lin0 = hzBin(30), lin1 = hzBin(200);
    const re = new Float64Array(N), im = new Float64Array(N), prev = new Float64Array(N / 2 + 1), cur = new Float64Array(N / 2 + 1);
    for (let fi = 0; fi < nF; fi++) {
      const start = fi * H - N / 2;
      for (let i = 0; i < N; i++) { const p = start + i; re[i] = (p >= 0 && p < n2 ? x[p] : 0) * tw.win[i]; im[i] = 0; }
      fft(re, im);
      let csum = 0, wsum = 0;
      for (let k = 1; k <= N / 2; k++) { const m = Math.hypot(re[k], im[k]); cur[k] = Math.log1p(m * 20); csum += m * k; wsum += m; if (k < N / 2) { /* bands use magnitude */ } re[k] = m; }
      for (let b = 0; b < 6; b++) { let s = 0; const [a, c] = edges[b]; for (let k = a; k <= c; k++) s += re[k] * re[k]; E[b][fi] = Math.sqrt(s / (c - a + 1)); }
      { let d = 0; for (let k = lin0; k <= lin1; k++) { const v = re[k] - pLin[k]; if (v > 0) d += v; pLin[k] = re[k]; } fluxLin[fi] = d; }
      cent[fi] = wsum > 1e-9 ? csum / wsum * binHz : 0;
      if (fi > 0) {
        let a = 0, ki = 0, sn = 0, hh = 0;
        for (let k = 1; k <= N / 2; k++) { const d = cur[k] - prev[k]; if (d > 0) { a += d; if (k >= rg.kick[0] && k <= rg.kick[1]) ki += d; if ((k >= rg.snareLo[0] && k <= rg.snareLo[1]) || (k >= rg.snareHi[0] && k <= rg.snareHi[1])) sn += d; if (k >= rg.hat[0] && k <= rg.hat[1]) hh += d; } }
        fluxAll[fi] = a / (N / 2); fluxKick[fi] = ki / (rg.kick[1] - rg.kick[0] + 1); fluxSn[fi] = sn / ((rg.snareLo[1] - rg.snareLo[0] + 1) + (rg.snareHi[1] - rg.snareHi[0] + 1)); fluxHat[fi] = hh / (rg.hat[1] - rg.hat[0] + 1);
      }
      prev.set(cur);
      if (doYield && fi % 400 === 0) { prog(0.05 + 0.55 * fi / nF); await yieldUI(); }
    }
    prog(0.62);
    // ---- tempo and beats ----
    const mm = movingStats(fluxAll, Math.round(fps * 0.5)), env = new Float32Array(nF);
    for (let i = 0; i < nF; i++) env[i] = Math.max(0, fluxAll[i] - mm.mean[i]);
    const lagMin = Math.floor(fps * 60 / 200), lagMax = Math.ceil(fps * 60 / 60), maxLag = Math.min(nF - 2, lagMax * 4);
    const ac = new Float64Array(maxLag + 1);
    for (let l = lagMin; l <= maxLag; l++) { let s = 0; for (let i = l; i < nF; i++) s += env[i] * env[i - l]; ac[l] = s / (nF - l); }
    const prior = (bpm) => Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    let bestLag = lagMin, bestScore = -1;
    for (let l = lagMin; l <= lagMax; l++) {
      const bpm = 60 * fps / l; let sc = ac[l] + (2 * l <= maxLag ? 0.5 * ac[2 * l] : 0) + (4 * l <= maxLag ? 0.25 * ac[4 * l] : 0);
      sc *= prior(bpm); if (sc > bestScore) { bestScore = sc; bestLag = l; }
    }
    // very fast tempos are usually the eighth-note pulse of a half-speed groove (hip-hop at 93 read as 186)
    if (60 * fps / bestLag > 165 && 2 * bestLag <= maxLag && ac[2 * bestLag] > 0.35 * ac[bestLag]) bestLag *= 2;
    let lagF = bestLag; if (bestLag > lagMin && bestLag < maxLag) { const a = ac[bestLag - 1], b = ac[bestLag], c = ac[bestLag + 1], d = a - 2 * b + c; if (d < 0) lagF = bestLag + 0.5 * (a - c) / d; }
    const period = lagF;
    // dynamic-programming beat tracker (Ellis 2007): beats on strong onsets, spaced by the tempo
    const sig = period / 32, hw = Math.max(1, Math.ceil(3 * sig)), local = new Float64Array(nF);
    for (let i = 0; i < nF; i++) { let s = 0; for (let k = -hw; k <= hw; k++) { const j = i + k; if (j >= 0 && j < nF) s += env[j] * Math.exp(-0.5 * (k / sig) * (k / sig)); } local[i] = s; }
    const cum = new Float64Array(nF), back = new Int32Array(nF).fill(-1), tight = 100;
    for (let i = 0; i < nF; i++) {
      let best = 0, bj = -1;
      for (let j = Math.max(0, Math.floor(i - 2 * period)); j <= Math.floor(i - period / 2); j++) { const v = cum[j] - tight * Math.pow(Math.log((i - j) / period), 2); if (bj < 0 || v > best) { best = v; bj = j; } }
      if (bj >= 0 && best > 0) { cum[i] = local[i] + best; back[i] = bj; } else cum[i] = local[i];
    }
    const peaks = []; for (let i = 1; i < nF - 1; i++) if (cum[i] >= cum[i - 1] && cum[i] > cum[i + 1]) peaks.push(i);
    const thr = 0.5 * median(peaks.map((i) => cum[i])); let last = peaks.length ? peaks[peaks.length - 1] : nF - 1; for (let k = peaks.length - 1; k >= 0; k--) if (cum[peaks[k]] >= thr) { last = peaks[k]; break; }
    const bi = []; for (let i = last; i >= 0; i = back[i]) { bi.push(i); if (back[i] < 0) break; } bi.reverse();
    let beats = bi.map((i) => { const a = env[i - 1] || 0, b = env[i], c = env[i + 1] || 0, d = a - 2 * b + c, off = d < 0 ? clamp(0.5 * (a - c) / d, -0.5, 0.5) : 0; return (i + off) / fps; });
    const ivs = []; for (let i = 1; i < beats.length; i++) ivs.push(beats[i] - beats[i - 1]);
    const medIv = ivs.length ? median(ivs) : 60 / (60 * fps / period), bpm = 60 / medIv;
    const stable = ivs.length ? ivs.filter((v) => Math.abs(v / medIv - 1) < 0.08).length / ivs.length : 0;
    // the tracker can lock onto the off-beat (hats, bass notes). Kicks and snares normally sit on the beat, so test the half-beat shift.
    if (beats.length > 8) {
      const lowE = new Float32Array(nF); for (let i = 0; i < nF; i++) lowE[i] = fluxLin[i]; const pk95k = pct(lowE, 0.95) || 1, pk95s = pct(fluxSn, 0.95) || 1;
      const lowAt = (t) => { const c0 = Math.round(t * fps); let m = 0; for (let k = -2; k <= 2; k++) { const j = clamp(c0 + k, 0, nF - 1); m = Math.max(m, lowE[j] / pk95k + 0.6 * fluxSn[j] / pk95s); } return m; };
      let s0 = 0, s1 = 0; for (const t of beats) { s0 += lowAt(t); s1 += lowAt(t + medIv / 2); }
      if (s1 > 1.1 * s0) beats = beats.map((t) => t + medIv / 2);
    }
    // fill the grid to both ends of the track so every part of the song has beats to hang events on
    while (beats.length && beats[0] - medIv >= 0) beats.unshift(beats[0] - medIv);
    while (beats.length && beats[beats.length - 1] + medIv <= dur - 0.05) beats.push(beats[beats.length - 1] + medIv);
    beats = beats.map(r3);
    // downbeat: the phase (0-3) whose beats carry the most low-frequency attack
    const fAt = (arr, t) => arr[clamp(Math.round(t * fps), 0, nF - 1)];
    const phScore = [0, 0, 0, 0]; beats.forEach((t, i) => { phScore[i % 4] += fAt(fluxKick, t) + 0.5 * fAt(fluxAll, t); });
    const downPhase = phScore.indexOf(Math.max(...phScore));
    prog(0.7);
    // ---- drum hits ----
    const kicks = peakPick(fluxKick, fps, { k: 1.1, gap: 0.09 }), snaresRaw = peakPick(fluxSn, fps, { k: 1.2, gap: 0.09 }), hats = peakPick(fluxHat, fps, { k: 1.3, gap: 0.06 });
    const snares = snaresRaw.filter(([t, s]) => !kicks.some(([kt, ks]) => Math.abs(kt - t) < 0.05 && ks > s * 1.1));
    // ---- 10 Hz curves ----
    const dt = 0.1, nC = Math.ceil(dur / dt), per2 = Math.max(1, Math.round(fps * dt)), c = { e: [], low: [], mid: [], high: [], vox: [], cent: [] }, tot = [], lowR = [], midR = [], highR = [], voxR = [], centR = [];
    for (let i = 0; i < nC; i++) {
      const a = Math.min(nF - 1, Math.floor(i * dt * fps)), b = Math.min(nF, a + per2); let s = [0, 0, 0, 0, 0, 0], ct = 0;
      for (let j = a; j < b; j++) { for (let k = 0; k < 6; k++) s[k] += E[k][j]; ct += cent[j]; }
      const n = Math.max(1, b - a); s = s.map((v) => v / n);
      const all = Math.sqrt(s.reduce((q, v) => q + v * v, 0));
      tot.push(20 * Math.log10(all + 1e-5)); lowR.push(20 * Math.log10(Math.hypot(s[0], s[1]) + 1e-5)); midR.push(20 * Math.log10(Math.hypot(s[2], s[3]) + 1e-5)); highR.push(20 * Math.log10(Math.hypot(s[4], s[5]) + 1e-5));
      voxR.push((s[3] + 0.5 * s[4]) / (s[0] + s[1] + s[2] + s[3] + s[4] + s[5] + 1e-9)); centR.push(ct / n);
    }
    const norm = (arr) => { const lo = pct(arr, 0.05), hi = pct(arr, 0.98), sp = Math.max(1e-6, hi - lo); return arr.map((v) => r3(clamp((v - lo) / sp, 0, 1))); };
    const smooth = (arr, w) => { const o = arr.slice(), h = w >> 1; for (let i = 0; i < arr.length; i++) { let s = 0, n = 0; for (let j = Math.max(0, i - h); j <= Math.min(arr.length - 1, i + h); j++) { s += arr[j]; n++; } o[i] = s / n; } return o; };
    c.e = norm(smooth(tot, 3)); c.low = norm(smooth(lowR, 3)); c.mid = norm(smooth(midR, 3)); c.high = norm(smooth(highR, 3)); c.vox = smooth(voxR, 11).map(r3); c.cent = norm(smooth(centR, 5)); c.dt = dt;
    const cv = (arr, t) => arr[clamp(Math.floor(t / dt), 0, nC - 1)];
    const meanC = (arr, a, b) => { let s = 0, n = 0; for (let i = clamp(Math.floor(a / dt), 0, nC - 1); i <= clamp(Math.floor(b / dt), 0, nC - 1); i++) { s += arr[i]; n++; } return n ? s / n : 0; };
    // ---- drops, build-ups, breakdowns (beat resolution) ----
    const nb = beats.length, be = beats.map((t, i) => meanC(c.e, t, beats[i + 1] || t + medIv)), bl = beats.map((t, i) => meanC(c.low, t, beats[i + 1] || t + medIv));
    const drops = [];
    for (let i = 4; i < nb - 2; i++) {
      const before = (be[i - 1] + be[i - 2] + be[i - 3]) / 3, after = (be[i] + be[i + 1]) / 2, held = be.slice(i, i + 8).reduce((a, v) => a + v, 0) / Math.min(8, nb - i), lb = (bl[i - 1] + bl[i - 2] + bl[i - 3]) / 3, la = (bl[i] + bl[i + 1]) / 2;
      const jump = (after - before) + 0.8 * (la - lb);
      if (jump > 0.3 && after > 0.55 && held > 0.68) { const last = drops[drops.length - 1]; if (last && i - last.i < 16) { if (jump > last.jump) { last.i = i; last.jump = jump; } continue; } drops.push({ i, jump }); }
    }
    const dropsOut = drops.map((d) => ({ t: beats[d.i], s: r3(clamp(d.jump / 1.0, 0.3, 1)) }));
    const builds = [];
    for (const d of drops) { // walk back from a drop while energy / brightness keeps rising
      let j = d.i - 1; const hi = (k) => 0.6 * be[k] + 0.4 * meanC(c.high, beats[k], beats[k] + medIv);
      while (j > 0 && d.i - j < 40 && hi(j - 1) <= hi(j) + 0.06) j--;
      if (d.i - j >= 4 && hi(d.i - 1) - hi(j) > 0.08) builds.push({ t0: beats[j], t1: beats[d.i] });
    }
    const breakdowns = []; { const mE = median(be); let s = -1; for (let i = 0; i <= nb; i++) { const low = i < nb && bl[i] < 0.3 && be[i] < mE * 0.85; if (low && s < 0) s = i; if (!low && s >= 0) { if (i - s >= 8) breakdowns.push({ t0: beats[s], t1: beats[i - 1] + medIv }); s = -1; } } }
    prog(0.8);
    // ---- sections: novelty on bar-level features ----
    const barIdx = []; for (let i = downPhase; i < nb; i += 4) barIdx.push(i);
    const bars = barIdx.map((bi2, k) => [beats[bi2], k + 1 < barIdx.length ? beats[barIdx[k + 1]] : Math.min(dur, beats[bi2] + 4 * medIv)]);
    if (bars.length && bars[0][0] > 2 * medIv) bars.unshift([0, bars[0][0]]); else if (bars.length) bars[0][0] = 0;
    const feat = bars.map(([a, b]) => [meanC(c.low, a, b), meanC(c.mid, a, b), meanC(c.high, a, b), meanC(c.e, a, b), meanC(c.cent, a, b), clamp(meanC(c.vox, a, b) * 2, 0, 1)]);
    const nBar = bars.length, dist = (p, q) => Math.sqrt(feat[p].reduce((s, v, k) => s + (v - feat[q][k]) * (v - feat[q][k]), 0));
    const bound = new Set([0]);
    if (nBar >= 8) {
      const L = Math.min(4, nBar >> 2), nov = new Float64Array(nBar);
      let maxD = 1e-9; for (let p = 0; p < nBar; p++) for (let q = p; q < Math.min(nBar, p + 2 * L + 1); q++) maxD = Math.max(maxD, dist(p, q));
      const sim = (p, q) => (p < 0 || q < 0 || p >= nBar || q >= nBar) ? 0.5 : 1 - dist(p, q) / Math.max(maxD, 0.5);
      for (let i = L; i <= nBar - L; i++) { let s = 0; for (let a = 0; a < L; a++) for (let b = 0; b < L; b++) s += sim(i - 1 - a, i - 1 - b) + sim(i + a, i + b) - sim(i - 1 - a, i + b) - sim(i + a, i - 1 - b); nov[i] = s; }
      const picks = []; const nm = movingStats(nov, nBar + 1);
      for (let i = L; i <= nBar - L; i++) if (nov[i] > nm.mean[i] + 0.5 * nm.sd[i] && nov[i] >= (nov[i - 1] || 0) && nov[i] >= (nov[i + 1] || 0) && nov[i] > 0.4) picks.push({ i, v: nov[i] });
      picks.sort((a, b) => b.v - a.v);
      for (const p of picks) if (![...bound].some((b) => Math.abs(b - p.i) < 4)) bound.add(p.i);
      for (const d of drops) { const k = bars.findIndex(([a, b]) => beats[d.i] >= a - 0.01 && beats[d.i] < b - 0.01); if (k > 0 && ![...bound].some((b) => Math.abs(b - k) < 2)) bound.add(k); }
    }
    const bl2 = [...bound].sort((a, b) => a - b), secs = [];
    bl2.forEach((b0, k) => { const b1 = k + 1 < bl2.length ? bl2[k + 1] : nBar; if (b1 > b0) secs.push({ t0: r3(bars[b0][0]), t1: r3(k + 1 < bl2.length ? bars[b1][0] : dur), b0, b1 }); });
    for (const s of secs) {
      const v = [0, 0, 0, 0, 0, 0]; for (let b = s.b0; b < s.b1; b++) feat[b].forEach((x, i) => { v[i] += x / (s.b1 - s.b0); }); s.f = v; s.energy = r3(v[3]);
      s.vocal = v[5] > clamp(median(feat.map((q) => q[5])) * 1.05, 0.2, 0.9);
      const e0 = meanC(c.e, s.t0, s.t0 + (s.t1 - s.t0) * 0.25), e1 = meanC(c.e, s.t1 - (s.t1 - s.t0) * 0.25, s.t1); s.slope = e1 - e0;
    }
    const kd = (s) => { let n = 0; for (const [t, v] of kicks) if (t >= s.t0 && t < s.t1 && v >= 0.3) n++; return n / Math.max(1, (s.t1 - s.t0) / medIv); };
    secs.forEach((s) => { s.kd = kd(s); });
    const medKd = median(secs.map((s) => s.kd));
    secs.forEach((s, k) => { // a clear jump in loudness into a loud section is a drop even if the beat-level search missed it
      const prevE = k ? secs[k - 1].energy : 0;
      if (k && s.energy >= 0.7 && s.energy - prevE >= 0.2 && !dropsOut.some((d) => Math.abs(d.t - s.t0) < 4 * medIv)) { dropsOut.push({ t: s.t0, s: r3(clamp(s.energy - prevE + 0.3, 0.3, 1)) }); builds.push({ t0: Math.max(0, s.t0 - Math.min(s.t0 - secs[k - 1].t0, 16 * medIv)), t1: s.t0 }); }
    });
    dropsOut.sort((a, b) => a.t - b.t);
    secs.forEach((s, k) => {
      const hasDrop = dropsOut.some((d) => Math.abs(d.t - s.t0) < 6 * medIv), nextE = k + 1 < secs.length ? secs[k + 1].energy : 0;
      const rising = s.slope > 0.12 && nextE > s.energy + 0.1;
      s.label = k === 0 && s.energy < 0.6 ? 'intro' : k === secs.length - 1 && s.energy < 0.6 ? 'outro' : hasDrop && s.energy >= 0.55 ? 'drop' : rising ? 'build-up' : (s.kd < 0.4 * medKd && s.energy < 0.8) || s.energy < 0.3 ? 'breakdown' : s.energy >= 0.68 ? 'chorus' : 'verse';
    });
    const groups = []; // repeated sections share a group letter
    secs.forEach((s) => { let g = groups.findIndex((q) => q.label === s.label && Math.sqrt(q.f.reduce((a, v, i) => a + (v - s.f[i]) * (v - s.f[i]), 0)) < 0.28 && Math.abs(q.len - (s.b1 - s.b0)) <= Math.max(2, 0.3 * q.len)); if (g < 0) { groups.push({ label: s.label, f: s.f, len: s.b1 - s.b0 }); g = groups.length - 1; } s.group = g; });
    const sections = secs.map((s) => ({ t0: s.t0, t1: s.t1, label: s.label, group: s.group, energy: s.energy, vocal: s.vocal }));
    prog(1);
    return { v: 1, duration: r3(dur), bpm: Math.round(bpm * 10) / 10, bpmConf: r3(clamp(stable, 0, 1)), beats, downPhase, kicks, snares, hats, curve: c, sections, drops: dropsOut, builds: builds.map((b) => ({ t0: r3(b.t0), t1: r3(b.t1) })), breakdowns: breakdowns.map((b) => ({ t0: r3(b.t0), t1: r3(b.t1) })), wave: { rate: wr, d: wave } };
  }
  const cacheKey = (pcm, sr) => { let h = 2166136261; const n = pcm.length, step = Math.max(1, Math.floor(n / 4096)); for (let i = 0; i < n; i += step) { h ^= Math.round(pcm[i] * 32767) & 0xffff; h = Math.imul(h, 16777619); } return `${(h >>> 0).toString(16)}-${n}-${Math.round(sr)}`; };
  return { analyze, cacheKey };
});
