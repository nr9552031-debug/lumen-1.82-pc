/* Lumen audio feature engine (1.7). ONE spectrum per frame (from the AnalyserNode the page already has) becomes
   every musical feature the visuals and the director use, so no animation ever runs its own FFT.

   process(freqBytes, timeBytes, tMs) -> F   (the same object every call: nothing is allocated per frame)
     bands (0..1, normalised to the source's own recent range, each with its own attack / release):
       sub 20-60 Hz · bass 60-250 · lowMid 250-500 · mid 500-2k · highMid 2k-4k · treble 4k-12k
     rms (loudness 0..1) · centroid (how bright the sound is, 0..1) · flux (how much the spectrum changed, 0..1)
     onset / onsetStrength · beat / beatStrength · impulse (a beat that decays over ~0.25 s)
     bpm · bpmConf · beatPhase (0 on the beat .. 1 just before the next) · barBeat (0..3) · barPos (0..1) · barConf
     phraseBar (0..3) · phrasePos (0..1) · phraseConf · dyn (dynamic range 0..1) · energy (slow loudness) · trend (-1..1)
     build (0..1, rising tension) · drop (true on the frame a drop lands) · section · silent
     legacy keys kept for older code: bass, mid, treble, level (= rms), beat
   predict(tMs, kind, n) -> time (ms, same clock) of the n-th next 'beat' | 'bar' | 'phrase', or null when unsure.

   Robust to: silence (gate with hold, features fall to 0), background noise (adaptive noise floor per band),
   any input level (adaptive ceiling, 18 dB minimum range so hiss is never stretched to full scale), clipping
   (byte input is bounded; values clamp), and uneven frame timing (all smoothing uses real elapsed time). */
(function (root) {
  'use strict';
  const BANDS = [['sub', 20, 60], ['bass', 60, 250], ['lowMid', 250, 500], ['mid', 500, 2000], ['highMid', 2000, 4000], ['treble', 4000, 12000]];
  // attack / release time constants in ms: low end follows kicks, highs are quick, colour-ish features are slower
  const TC = { sub: [18, 200], bass: [12, 170], lowMid: [25, 200], mid: [30, 230], highMid: [18, 170], treble: [10, 130], rms: [20, 260], centroid: [90, 350], flux: [5, 100] };
  const ENV_HZ = 50, ENV_N = 400; // onset envelope for tempo: 50 Hz, 8 s
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function createFeatureEngine(opts) {
    const o = Object.assign({ sampleRate: 48000, fftSize: 2048, minDb: -100, maxDb: -30, silenceDb: -72, minRange: 18, maxRange: 30, bpmMin: 70, bpmMax: 180 }, opts);
    const binHz = o.sampleRate / o.fftSize, nb = o.fftSize / 2;
    const ranges = BANDS.map(([, lo, hi]) => [Math.max(1, Math.floor(lo / binHz)), Math.min(nb - 1, Math.max(Math.floor(lo / binHz) + 1, Math.ceil(hi / binHz)))]);
    const lowFluxTop = Math.max(2, Math.ceil(160 / binHz));
    const mag = new Float32Array(nb), prev = new Float32Array(nb); // log-magnitude (dB) per bin, this and last frame
    const dbOf = new Float32Array(256); for (let i = 0; i < 256; i++) dbOf[i] = o.minDb + (i / 255) * (o.maxDb - o.minDb);
    const nB = BANDS.length, floor = new Float32Array(nB).fill(-80), ceil = new Float32Array(nB).fill(-38), raw = new Float32Array(nB), sm = new Float32Array(nB);
    const env = new Float32Array(ENV_N); let envIdx = 0, envSlotT = 0;           // low-frequency onset envelope (ring)
    const fluxHist = new Float32Array(64), lowHist = new Float32Array(64); let fhI = 0, fhN = 0, lowPeak = 0.02, lastLow = -1e9; // recent flux for onset thresholds
    const slot = new Float32Array(4);                                                 // bass strength per beat-in-bar slot
    const F = { sub: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, treble: 0, rms: 0, level: 0, centroid: 0, flux: 0, onset: false, onsetStrength: 0,
      beat: false, beatStrength: 0, impulse: 0, bpm: 0, bpmConf: 0, beatPhase: 0, barBeat: 0, barPos: 0, barConf: 0, phraseBar: 0, phrasePos: 0, phraseConf: 0,
      dyn: 0, energy: 0, trend: 0, build: 0, drop: false, section: 'silence', silent: true, t: 0 };
    let last = -1, fluxPeak = 0.02, rmsFloor = -60, rmsCeil = -16, rmsMin = 0, rmsMax = 0, smRms = 0, smCent = 0, smFlux = 0;
    let silentFor = 1e9, loudFor = 0, lastOnset = -1e9, lastBeat = -1e9, period = 0, nextBeat = 0, hits = 0, miss = 0, coast = 0, beatCount = 0, downOff = 0, phraseStart = 0;
    let tapOn = false, tapLast = -1e9, tapT = -1e9, tapKick = false, tapKickS = 0, tapKickT = -1e9, tapMean = 0, tapVar = 0, tapPeak = 6, tapFloor = 0, tapPrevO = 0, tapPrevDb = -120, tapPrevT = 0, tapAcc = 0, beatPend = false, beatPendS = 0;
    const tapH = [-120, -120, -120];
    let lastStrongLow = 0, envFilled = 0, lastTempo = -1e9, cand = 0, candN = 0, eFast = 0, eSlow = 0, eMin2 = 0, lastDrop = -1e9, buildV = 0, centSlow = 0, prevLowFlux = 0;
    const ease = (cur, target, dt, [att, rel]) => cur + (target - cur) * (1 - Math.exp(-dt / (target > cur ? att : rel)));

    function tempo(t) { // autocorrelation of the onset envelope, with a gentle preference for 90-140 BPM
      const lagMin = Math.floor(ENV_HZ * 60 / o.bpmMax), lagMax = Math.ceil(ENV_HZ * 60 / o.bpmMin);
      // only the part of the envelope filled since the music started: a half-empty buffer would make the
      // step from nothing to sound correlate at every lag and fake a confident tempo
      // no kick for 2 s (a breakdown): keep the tempo we had (music rarely changes tempo there) and let the
      // confidence fade slowly, instead of re-estimating from pads and noise and drifting off the grid
      if (F.bpm && t - lastLow > 2000) { F.bpmConf *= 0.97; return; }
      const N = Math.min(envFilled, ENV_N), s0 = (envIdx + ENV_N - N) % ENV_N; if (N < ENV_HZ * 3) return;
      let mean = 0; for (let i = 0; i < N; i++) mean += env[(s0 + i) % ENV_N]; mean /= N;
      let e0 = 0; for (let i = 0; i < N; i++) { const v = env[(s0 + i) % ENV_N] - mean; e0 += v * v; }
      if (e0 < 1e-6) return;
      let best = 0, bestLag = 0, bestRaw = 0;
      const ac = (lag) => { let s = 0; for (let i = 0; i < N - lag; i++) s += (env[(s0 + i) % ENV_N] - mean) * (env[(s0 + i + lag) % ENV_N] - mean); return s / e0; };
      for (let lag = lagMin; lag <= lagMax; lag++) {
        const r = ac(lag), bpm = 60 * ENV_HZ / lag, prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 118) / 0.55, 2));
        const w = r * (0.55 + 0.45 * prior) + 0.25 * Math.max(0, ac(lag * 2 <= N / 2 ? lag * 2 : lag)) * (lag * 2 <= N / 2 ? 1 : 0);
        if (w > best) { best = w; bestLag = lag; bestRaw = r; }
      }
      if (!bestLag || bestRaw < 0.08) { F.bpmConf *= 0.8; return; }
      const a = ac(bestLag - 1), b = bestRaw, c = ac(bestLag + 1), d = a - 2 * b + c, off = d < 0 ? clamp(0.5 * (a - c) / d, -0.5, 0.5) : 0;
      const bpm = 60 * ENV_HZ / (bestLag + off);
      if (F.bpm && Math.abs(bpm / F.bpm - 1) < 0.04) { F.bpm += (bpm - F.bpm) * 0.3; candN = 0; }
      else if (cand && Math.abs(bpm / cand - 1) < 0.04) { if (++candN >= 2 || !F.bpm) { F.bpm = bpm; candN = 0; } }
      else { cand = bpm; candN = 1; if (!F.bpm) F.bpm = bpm; }
      F.bpmConf = clamp(F.bpmConf * 0.6 + clamp(bestRaw * 1.6, 0, 1) * 0.4, 0, 1);
      period = 60000 / F.bpm; if (!nextBeat) nextBeat = t + period; else while (nextBeat < t - period) nextBeat += period; // a lagging grid is advanced by whole beats: its phase is kept
    }

    function process(freq, time, tMs) {
      const t = tMs, dt = last < 0 ? 16 : clamp(t - last, 1, 250); last = t; F.t = t;
      F.onset = false; F.beat = false; F.drop = false;
      // spectrum -> dB per bin, band power, centroid, flux (all from this one spectrum)
      let fluxSum = 0, lowFlux = 0, cNum = 0, cDen = 0, tot = 0;
      for (let i = 1; i < nb; i++) {
        const db = dbOf[freq[i] | 0]; mag[i] = db; const d = db - prev[i]; prev[i] = db;
        if (d > 0) { fluxSum += d; if (i <= lowFluxTop) lowFlux += d; }
        const p = Math.pow(10, db / 10); tot += p; if (i * binHz < 12000) { const am = Math.sqrt(p); cNum += am * Math.log2(Math.max(40, i * binHz)); cDen += am; }
      }
      const totDb = 10 * Math.log10(tot / nb + 1e-12);
      // silence gate with hysteresis (a gap of less than 0.3 s inside music is not silence)
      if (totDb < o.silenceDb) { silentFor += dt; loudFor = 0; } else { loudFor += dt; if (loudFor > 60) silentFor = 0; }
      const silent = silentFor > 300; F.silent = silent;
      for (let b = 0; b < nB; b++) {
        const [a, z] = ranges[b]; let p = 0; for (let i = a; i <= z; i++) p += Math.pow(10, mag[i] / 10);
        const db = 10 * Math.log10(p / (z - a + 1) + 1e-12); raw[b] = db;
        if (!silent) { // adaptive floor (noise) and ceiling (loudest recent), at least minRange dB apart
          floor[b] = db < floor[b] ? floor[b] + (db - floor[b]) * (1 - Math.exp(-dt / 300)) : floor[b] + (dt / 1000) * 0.3;
          ceil[b] = db > ceil[b] ? db : ceil[b] - (dt / 1000) * 0.35;
          if (ceil[b] - floor[b] < o.minRange) ceil[b] = floor[b] + o.minRange;
        }
        const lo = Math.max(floor[b], ceil[b] - o.maxRange), n = silent ? 0 : clamp((db - lo) / (ceil[b] - lo), 0, 1);
        sm[b] = ease(sm[b], n * n * (3 - 2 * n) * 0.35 + n * 0.65, dt, TC[BANDS[b][0]]); F[BANDS[b][0]] = sm[b];
      }
      // loudness: RMS of the waveform when given, else of the spectrum
      let rmsDb = totDb + 10;
      if (time && time.length) { let s = 0; for (let i = 0; i < time.length; i++) { const v = (time[i] - 128) / 128; s += v * v; } rmsDb = 20 * Math.log10(Math.sqrt(s / time.length) + 1e-6); }
      if (!silent) { rmsFloor = rmsDb < rmsFloor ? rmsFloor + (rmsDb - rmsFloor) * (1 - Math.exp(-dt / 500)) : rmsFloor + (dt / 1000) * 0.3; rmsCeil = rmsDb > rmsCeil ? rmsDb : rmsCeil - (dt / 1000) * 0.25; if (rmsCeil - rmsFloor < o.minRange) rmsCeil = rmsFloor + o.minRange; }
      const rlo = Math.max(rmsFloor, rmsCeil - 26), rn = silent ? 0 : clamp((rmsDb - rlo) / (rmsCeil - rlo), 0, 1);
      smRms = ease(smRms, rn, dt, TC.rms); F.rms = F.level = smRms;
      smCent = ease(smCent, silent || !cDen ? smCent * 0.98 : clamp((cNum / cDen - 7) / 5.5, 0, 1), dt, TC.centroid); F.centroid = smCent;
      // flux, normalised by its own recent peak; onsets are flux peaks clearly above the recent average
      const fx = silent ? 0 : fluxSum / nb; fluxPeak = Math.max(fx, fluxPeak * Math.exp(-dt / 3000), 0.02);
      smFlux = ease(smFlux, clamp(fx / fluxPeak, 0, 1), dt, TC.flux); F.flux = smFlux;
      let mean = 0, sd = 0; for (let i = 0; i < fhN; i++) mean += fluxHist[i]; mean = fhN ? mean / fhN : 0; for (let i = 0; i < fhN; i++) sd += (fluxHist[i] - mean) ** 2; sd = fhN ? Math.sqrt(sd / fhN) : 0;
      if (!silent && fhN > 8 && fx > mean + Math.max(0.6 * sd, 0.08 * fluxPeak) && t - lastOnset > 90) { F.onset = true; F.onsetStrength = clamp((fx - mean) / (fluxPeak - mean + 1e-6), 0.1, 1); lastOnset = t; }
      fluxHist[fhI] = fx; fhI = (fhI + 1) % fluxHist.length; fhN = Math.min(fhN + 1, fluxHist.length);
      // Kicks and the tempo envelope come from the audio thread when it is feeding us (exact audio-clock times,
      // immune to how late this frame is); otherwise from the spectrum, timed by this frame.
      const viaTap = tapOn || t - tapLast < 400; // tapOn: the audio-thread tap is attached (a slow page must not switch timing source)
      const lf = silent ? 0 : lowFlux;
      let lm = 0, ls = 0; for (let i = 0; i < fhN; i++) lm += lowHist[i]; lm = fhN ? lm / fhN : 0; for (let i = 0; i < fhN; i++) ls += (lowHist[i] - lm) ** 2; ls = fhN ? Math.sqrt(ls / fhN) : 0;
      lowPeak = Math.max(lf, lowPeak * Math.exp(-dt / 3000), 0.5);
      let lowOnset;
      if (viaTap) { lowOnset = tapKick && !silent; if (lowOnset) { F.onset = true; F.onsetStrength = tapKickS; lastOnset = t; } tapKick = false; }
      else {
        // low-frequency onset envelope on a fixed 50 Hz grid for tempo
        while (t - envSlotT >= 1000 / ENV_HZ) { envSlotT += 1000 / ENV_HZ; if (t - envSlotT > 1000) envSlotT = t; env[envIdx] = 0; envIdx = (envIdx + 1) % ENV_N; envFilled = silent ? 0 : envFilled + 1; }
        const ei = (envIdx + ENV_N - 1) % ENV_N; env[ei] = Math.max(env[ei], lf);
        // the kick: a jump in the LOW bins only, clearly above their own recent level (hats and snares barely move them)
        lowOnset = !silent && fhN > 8 && lf > lm + Math.max(1.2 * ls, 0.25 * lowPeak) && lf > prevLowFlux && t - lastLow > 160 && F.sub + F.bass > 0.4;
        if (lowOnset) { lastLow = t; if (!F.onset) { F.onset = true; F.onsetStrength = clamp(lf / lowPeak, 0.1, 1); lastOnset = t; } }
        beatAt(t, lowOnset, F.onsetStrength, lf > lm + Math.max(2.4 * ls, 0.35 * lowPeak) && lf > lm * 2.5); // no tempo yet: only clear hits
      }
      prevLowFlux = lf; lowHist[(fhI + lowHist.length - 1) % lowHist.length] = lf;
      if (t - lastTempo > 500) { lastTempo = t; tempo(t); }
      const sure = F.bpmConf > 0.35 && period > 0;
      if (viaTap && sure) while (nextBeat < t - period * 0.5) nextBeat += period;
      if (beatPend) { F.beat = true; F.beatStrength = beatPendS; beatPend = false; }
      F.impulse = Math.max(F.beat ? F.beatStrength : 0, F.impulse * Math.exp(-dt / 240));
      F.beatPhase = sure ? clamp(1 - (nextBeat - t) / period, 0, 1) : clamp((t - lastBeat) / 500, 0, 1);
      F.barPos = (F.barBeat + F.beatPhase) / 4; F.phrasePos = (F.phraseBar + F.barPos) / 4;
      // dynamics, energy trend, builds and drops
      rmsMax = Math.max(rmsDb, rmsMax - (dt / 1000) * 6); rmsMin = Math.min(rmsDb, rmsMin + (dt / 1000) * 6); if (silent) { rmsMax = rmsDb; rmsMin = rmsDb; }
      F.dyn = clamp((rmsMax - rmsMin) / 30, 0, 1);
      eFast = ease(eFast, F.rms * 0.6 + (F.sub + F.bass) * 0.2, dt, [400, 900]); eSlow = ease(eSlow, eFast, dt, [6000, 6000]); F.energy = eFast;
      F.trend = clamp((eFast - eSlow) * 4, -1, 1); centSlow = ease(centSlow, F.centroid, dt, [4000, 4000]);
      eMin2 = Math.min(eFast, eMin2 + (dt / 1000) * 0.15);
      const rising = F.trend > 0.1 && F.centroid > centSlow + 0.015;
      buildV = clamp(buildV + (dt / 1000) * (rising ? 0.22 : F.trend < -0.05 ? -0.6 : -0.12), 0, 1); F.build = buildV;
      const eNow = F.rms * 0.5 + (F.sub + F.bass) * 0.25;
      // a drop: a big energy jump on a beat after a build or a quiet stretch, or the kick coming back (a strong low hit) after
      // 3.5 s or more without one. Never in the first seconds after silence (that is just the music starting).
      const strongLow = lowOnset && F.sub + F.bass > 1.0, reentry = strongLow && t - lastStrongLow > 3500 && lastStrongLow > 0; if (strongLow) lastStrongLow = t;
      if (!silent && loudFor > 4000 && t - lastDrop > 8000 && ((F.sub + F.bass > 1.2 && eNow - eMin2 > 0.3 && (buildV > 0.35 || eMin2 < 0.3) && F.beat) || reentry)) {
        if (!F.beat) { fire(t, 1); F.beat = true; F.beatStrength = 1; beatPend = false; }
        F.drop = true; lastDrop = t; buildV = 0; phraseStart = beatCount; downOff = beatCount % 4; // a drop starts a bar and a phrase
      }
      F.section = silent ? 'silence' : F.drop || t - lastDrop < 6000 ? 'drop' : buildV > 0.45 ? 'build' : eFast < 0.25 ? (F.trend < -0.15 ? 'break' : 'quiet') : eFast > 0.62 ? 'peak' : 'groove';
      if (silent) { F.impulse = 0; F.build = buildV = 0; }
      return F;
    }
    // beats: a kick, locked to the tempo once the tempo is known (a phase-locked loop); coasts a few beats without one
    function beatAt(t, kick, s, clear) {
      if (F.bpmConf > 0.35 && period > 0) {
        while (nextBeat < t - period * 0.5) nextBeat += period;
        if (kick) {
          const err = t - nextBeat, e2 = ((err + period / 2) % period + period) % period - period / 2; // nearest predicted beat
          if (Math.abs(e2) < period * 0.22) { nextBeat += e2 * 0.3; hits = Math.min(hits + 1, 16); miss = 0; coast = 0; if (t - lastBeat > period * 0.6) fire(t, s); if (t >= nextBeat - period * 0.22) nextBeat += period; }
          else if (hits < 3 || ++miss >= 2) { nextBeat = t + period; hits = 1; miss = 0; coast = 0; if (t - lastBeat > period * 0.4) fire(t, s); }
        } else if (t >= nextBeat) { if (t - lastBeat > period * 0.6 && hits > 2 && coast < 4) { coast++; fire(t, 0.45); } nextBeat += period; }
      } else { hits = 0; if (kick && clear && t - lastBeat > 250) fire(t, s); } // tempo not trusted: the phase is re-found from the next kicks
    }
    // Low-band energy from the audio thread (see av-tap.js): e[0..n-1], one value per hop of hopMs, the last one ending
    // at tEndMs (same clock as process). Finds kicks at their real time and fills the tempo envelope on an exact grid.
    function feed(e, n, tEndMs, hopMs) {
      const silent = silentFor > 300;
      for (let i = 0; i < n; i++) {
        const t = tEndMs - (n - 1 - i) * hopMs; if (t <= tapT) continue; tapT = t; tapLast = Math.max(tapLast, t);
        const db = 10 * Math.log10(e[i] + 1e-12), ref = (tapH[0] + tapH[1] + tapH[2]) / 3; tapH[2] = tapH[1]; tapH[1] = tapH[0]; tapH[0] = db;
        const o = silent || db < -90 ? 0 : Math.max(0, db - ref);
        tapFloor = db < tapFloor ? db : tapFloor + (hopMs / 1000) * 2; tapPeak = Math.max(o, tapPeak * Math.exp(-hopMs / 3000), 6);
        // peak picking with one hop of delay: the previous hop was a kick if it beat the threshold and this hop is lower
        const sd = Math.sqrt(Math.max(0, tapVar)), thr = tapMean + Math.max(2.5 * sd, 5, 0.3 * tapPeak);
        const was = tapPrevO > thr && o <= tapPrevO && tapPrevDb > tapFloor + 12 && tapPrevT - tapKickT > 160;
        if (was) { tapKickT = tapPrevT; lastLow = tapPrevT; tapKick = true; tapKickS = clamp(tapPrevO / tapPeak, 0.1, 1); }
        if (tapPrevT > 0) beatAt(tapPrevT, was, tapKickS, tapPrevO > tapMean + Math.max(4 * sd, 8));
        tapMean += (o - tapMean) * 0.01; tapVar += ((o - tapMean) ** 2 - tapVar) * 0.01;
        tapPrevO = o; tapPrevDb = db; tapPrevT = t;
        // tempo envelope: 50 Hz slots on the audio clock
        tapAcc = Math.max(tapAcc, o);
        while (t - envSlotT >= 1000 / ENV_HZ) { envSlotT += 1000 / ENV_HZ; if (t - envSlotT > 1000) envSlotT = t; env[envIdx] = tapAcc; tapAcc = 0; envIdx = (envIdx + 1) % ENV_N; envFilled = silent ? 0 : envFilled + 1; }
      }
    }
    function fire(t, s) {
      beatPend = true; beatPendS = s; lastBeat = t; beatCount++;
      // downbeat: the beat slot (of 4) where the low end is usually strongest
      const k = beatCount % 4; for (let i = 0; i < 4; i++) slot[i] *= 0.97; slot[k] += F.sub + F.bass;
      let mx = 0, sum = 0; for (let i = 0; i < 4; i++) { sum += slot[i]; if (slot[i] > slot[mx]) mx = i; }
      if (sum > 4 && slot[mx] > (sum / 4) * 1.12 && beatCount - phraseStart > 8) downOff = mx;
      F.barConf = sum > 0 ? clamp((slot[mx] / (sum / 4) - 1) * 2.5, 0, 1) * clamp(F.bpmConf * 1.4, 0, 1) : 0;
      F.barBeat = ((beatCount - downOff) % 4 + 4) % 4;
      F.phraseBar = Math.floor((((beatCount - phraseStart) % 16) + 16) % 16 / 4);
      F.phraseConf = F.barConf * 0.7;
    }
    // When will the next beat / bar / phrase start (ms, same clock as tMs)? Null if the tempo is not trusted.
    function predict(tMs, kind = 'beat', n = 1) {
      if (!(F.bpmConf > 0.35 && period > 0)) return null;
      let tb = nextBeat, skip = 0; while (tb < tMs) { tb += period; skip++; } // skipped beats keep the bar count right
      if (kind === 'beat') return tb + (n - 1) * period;
      const idx = (F.barBeat + 1 + skip) % 4; // position in the bar of the beat at tb (0 = downbeat)
      if (kind === 'bar') return tb + ((4 - idx) % 4 + (n - 1) * 4) * period;
      const inPhrase = (F.phraseBar * 4 + F.barBeat + 1 + skip) % 16, toPhrase = (16 - inPhrase) % 16;
      return tb + (toPhrase + (n - 1) * 16) * period;
    }
    function reset() { last = -1; envFilled = 0; lastStrongLow = 0; tapLast = -1e9; tapT = -1e9; tapKick = false; beatPend = false; tapH.fill(-120); prev.fill(0); env.fill(0); fhN = 0; slot.fill(0); F.bpm = 0; F.bpmConf = 0; period = 0; nextBeat = 0; hits = 0; beatCount = 0; silentFor = 1e9; buildV = 0; }
    // a new audio connection (restart, reconnect, other source): keep the tempo, but re-find the beat phase from the next
    // kicks, since the new stream may arrive with a different delay
    function setTap(on) { tapOn = !!on; }
    function resync() { hits = 0; miss = 0; coast = 0; tapT = -1e9; tapKick = false; tapPrevT = 0; tapH.fill(-120); }
    return { process, feed, predict, reset, resync, setTap, F, get period() { return period; } };
  }

  const api = { createFeatureEngine, BANDS, FEATURES: ['sub', 'bass', 'lowMid', 'mid', 'highMid', 'treble', 'rms', 'centroid', 'flux', 'impulse', 'energy', 'trend', 'build', 'dyn', 'beatPhase', 'barPos'] };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LumenFeatures = api;
})(typeof window !== 'undefined' ? window : globalThis);
