/* Lumen persistent audio service (1.8).

   One capture for the whole session, independent of any page, animation or setting:
     audio input -> this service (stream, ONE AudioContext, analyser, audio-thread tap, feature engine) -> subscribers
   Pages and animations only subscribe; nothing they do can rebuild the pipeline. Capture stops only on stop().

   States: inactive | requesting | connecting | active | interrupted | reconnecting | error
   - start() is single-flight: overlapping calls share one request (no second capture, no orphan).
   - Every handler checks it belongs to the CURRENT connection (an old track ending cannot kill a new one).
   - Watchdogs (no extra timers: they run inside the analysis tick):
       track ended            -> reconnect (new stream, same AudioContext, same feature engine)
       track muted > 2 s      -> interrupted; still muted after 8 s -> reconnect
       AudioContext suspended -> resume(); keeps failing -> interrupted; recreated only as a last resort
       audio-thread tap silent while the context runs (graph stalled) -> rebuild the source node
   - Reconnect backoff 0.5, 1, 2, 4, 8, 8 s; after 6 failed attempts -> error (start() again to retry).
     Re-requesting in Electron does not prompt: the main process answers display-capture requests itself, and a
     granted microphone stays granted.
   - status() never says active unless frames are arriving from a live track.

   The environment is injected (browser by default), so the state machine is tested in Node with fakes.     */
(function (root) {
  'use strict';
  const STATES = ['inactive', 'requesting', 'connecting', 'active', 'interrupted', 'reconnecting', 'error'];
  const BACKOFF = [500, 1000, 2000, 4000, 8000, 8000];

  function createAudioService(envIn) {
    const env = Object.assign({
      now: () => performance.now(),
      setInterval: (f, ms) => setInterval(f, ms), clearInterval: (h) => clearInterval(h),
      setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h),
      AudioContext: typeof AudioContext !== 'undefined' ? AudioContext : null,
      MediaStream: typeof MediaStream !== 'undefined' ? MediaStream : null,
      media: typeof navigator !== 'undefined' ? navigator.mediaDevices : null,
      Features: root.LumenFeatures, Tap: root.LumenTap,
      AudioWorkletNode: typeof AudioWorkletNode !== 'undefined' ? AudioWorkletNode : null,
      tickMs: 25,
    }, envIn || {});

    const st = { state: 'inactive', source: 'system', since: env.now(), error: '', detail: '', attempts: 0, reconnects: 0, interruptions: 0, ctxRecreated: 0, lastFrame: 0, label: '', frames: 0 };
    let ctx = null, an = null, engine = null, freq = null, time = null, timer = null, conn = null, pending = null, retryT = null, wantOn = false, tapReady = null;
    const subs = new Set(), stateSubs = new Set();

    function set(state, detail = '', error = '') {
      if (st.state === state && st.detail === detail && st.error === error) return;
      st.state = state; st.detail = detail; st.error = error; st.since = env.now();
      for (const f of stateSubs) { try { f(status()); } catch {} }
    }
    function status() { return { ...st, sampleRate: ctx ? ctx.sampleRate : 0, ctxState: ctx ? ctx.state : 'none', tap: !!(conn && conn.tap), listening: st.state === 'active' }; }

    // ---- the one AudioContext (+ analyser + feature engine) for the session ----
    function ensureContext() {
      if (ctx && ctx.state !== 'closed') return ctx;
      if (!env.AudioContext) throw new Error('This computer did not give Lumen an audio engine (Web Audio).');
      ctx = new env.AudioContext(); tapReady = null;
      an = ctx.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0.25;
      freq = new Uint8Array(an.frequencyBinCount); time = new Uint8Array(an.fftSize);
      engine = env.Features.createFeatureEngine({ sampleRate: ctx.sampleRate, fftSize: an.fftSize });
      return ctx;
    }
    async function request(source) {
      if (!env.media) throw new Error('This computer does not offer sound capture here.');
      let stream;
      try {
        stream = source === 'mic' ? await env.media.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
          : await env.media.getDisplayMedia({ video: { width: { max: 320 }, height: { max: 180 }, frameRate: { max: 5 } }, audio: true });
      } catch (e) { const x = new Error(`Lumen could not start listening (${(e && e.name) || 'error'}: ${(e && e.message) || 'refused'}).`); x.refused = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError'); throw x; }
      const at = stream.getAudioTracks();
      if (!at.length) {
        stream.getTracks().forEach((t) => t.stop());
        const x = new Error(source === 'mic' ? 'The microphone gave no sound track.' : 'The system did not hand over a sound track (on a Mac, system sound cannot be captured: choose Microphone on the Audio tab).'); x.noTrack = true; throw x;
      }
      return { stream, track: at[0] };
    }
    // connect a fresh stream to the persistent context; returns the connection object
    async function connect(source) {
      const { stream, track } = await request(source);
      if (!wantOn) { stream.getTracks().forEach((t) => t.stop()); return null; } // stopped while the request was open
      set(st.state === 'reconnecting' ? 'reconnecting' : 'connecting');
      ensureContext();
      try { if (ctx.state !== 'running') await ctx.resume(); } catch {}
      const ms = env.MediaStream ? new env.MediaStream([track]) : stream;
      const src = ctx.createMediaStreamSource(ms); src.connect(an);
      const c = { stream, track, ms, src, tap: null, tapAt: 0, muted: false, mutedAt: 0, started: env.now(), id: Symbol('conn') };
      // handlers belong to THIS connection only
      track.addEventListener('ended', () => { if (conn === c) lost('The sound source ended.'); });
      track.addEventListener('mute', () => { if (conn === c && !c.muted) { c.muted = true; c.mutedAt = env.now(); } });
      track.addEventListener('unmute', () => { if (conn === c) { c.muted = false; if (st.state === 'interrupted') set('active'); } });
      st.label = track.label || ''; conn = c; engine.resync(); // same tempo, beat phase found again from this stream
      startTap(c).catch((e) => { c.tapErr = String((e && e.message) || e); });
      return c;
    }
    async function startTap(c) {
      if (!env.Tap || !ctx.audioWorklet || !env.AudioWorkletNode) return;
      if (!tapReady) tapReady = ctx.audioWorklet.addModule('data:text/javascript;charset=utf-8,' + encodeURIComponent(env.Tap.workletSource()));
      await tapReady; if (conn !== c) return;
      const node = new env.AudioWorkletNode(ctx, 'lumen-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] }), mute = ctx.createGain(); mute.gain.value = 0;
      c.src.connect(node); node.connect(mute).connect(ctx.destination);
      // audio-clock -> page-clock mapping from the context's own timestamp pair (independent of how late messages
      // arrive); falls back to the smallest observed delivery delay where getOutputTimestamp is unavailable
      let off = Infinity;
      node.port.onmessage = (ev) => {
        if (conn !== c) return; const m = ev.data, now = env.now(), tA = m.t * 1000; c.tapAt = now;
        let o = null;
        if (ctx.getOutputTimestamp) { const ts = ctx.getOutputTimestamp(); if (ts && ts.performanceTime > 0) o = ts.performanceTime - ts.contextTime * 1000 - (ctx.outputLatency || 0) * 1000; }
        if (o == null) { off = Math.min(off + 0.02, now - tA); o = off; } else off = o;
        engine.feed(m.e, m.e.length, tA + o, m.hopS * 1000);
      };
      c.tap = { node, mute }; engine.setTap(true);
    }
    function release(c) {
      if (!c) return;
      try { if (c.tap) { c.tap.node.port.onmessage = null; c.tap.node.disconnect(); c.tap.mute.disconnect(); if (engine) engine.setTap(false); } } catch {}
      try { c.src.disconnect(); } catch {}
      try { c.stream.getTracks().forEach((t) => t.stop()); } catch {}
    }

    // ---- analysis tick: features + watchdogs; one timer for the whole session ----
    function tick() {
      if (!ctx || !conn) return;
      const now = env.now(), c = conn;
      if (c.track.readyState === 'ended') return lost('The sound source ended.');
      if (ctx.state !== 'running') { // suspended or interrupted by the system
        if (!c.resumeAt || now - c.resumeAt > 1000) { c.resumeAt = now; c.resumeTries = (c.resumeTries || 0) + 1; ctx.resume().catch(() => {}); }
        if (c.resumeTries > 3 && st.state !== 'interrupted') { st.interruptions++; set('interrupted', 'The audio engine was paused by the system; trying to resume.'); }
        if (c.resumeTries > 8) return recreateContext();
        return;
      }
      c.resumeTries = 0;
      an.getByteFrequencyData(freq); an.getByteTimeDomainData(time);
      const F = engine.process(freq, time, now); st.lastFrame = now; st.frames++;
      if (c.muted && now - c.mutedAt > 2000) {
        if (st.state === 'active') { st.interruptions++; set('interrupted', 'The sound source is muted.'); }
        if (now - c.mutedAt > 8000) return lost('The sound source stayed muted.');
      } else if (c.tap && c.tapAt && now - c.tapAt > 1500) { // audio thread stopped delivering while the context runs
        c.tapAt = now; st.interruptions++; rebuildSource(c);
      } else if (st.state !== 'active') set('active');
      for (const f of subs) { try { f(F, now); } catch (e) { if (root.console) console.error('[audio] subscriber failed', e); } }
    }
    function rebuildSource(c) {
      try { c.src.disconnect(); } catch {}
      c.src = ctx.createMediaStreamSource(c.ms); c.src.connect(an);
      if (c.tap) c.src.connect(c.tap.node);
    }
    function recreateContext() { // last resort: the system will not resume this context
      const c = conn; conn = null; release(c); try { ctx.close(); } catch {} ctx = null; st.ctxRecreated++; tapReady = null;
      reconnect('The audio engine could not be resumed.');
    }
    function lost(why) { const c = conn; conn = null; release(c); st.interruptions++; reconnect(why); }
    function reconnect(why) {
      if (!wantOn) return;
      if (st.attempts >= BACKOFF.length) { wantOn = false; stopTimer(); return set('error', '', `${why} Lumen tried to reconnect ${BACKOFF.length} times without success.`); }
      const wait = BACKOFF[st.attempts++]; set('reconnecting', `${why} Reconnecting (attempt ${st.attempts} of ${BACKOFF.length})…`);
      if (retryT) env.clearTimeout(retryT);
      retryT = env.setTimeout(async () => {
        retryT = null; if (!wantOn) return;
        try { const c = await connect(st.source); if (c) { st.reconnects++; st.attempts = 0; set('active'); } }
        catch (e) { if (e.refused || e.noTrack) { wantOn = false; stopTimer(); return set('error', '', e.message); } reconnect(why); }
      }, wait);
    }
    function startTimer() { if (!timer) timer = env.setInterval(tick, env.tickMs); }
    function stopTimer() { if (timer) { env.clearInterval(timer); timer = null; } }

    // ---- public ----
    function start(opts = {}) {
      const source = opts.source === 'mic' ? 'mic' : 'system';
      if (pending) return pending; // single flight
      if (conn && wantOn && source === st.source && (st.state === 'active' || st.state === 'interrupted')) return Promise.resolve(status());
      wantOn = true; st.source = source; st.attempts = 0;
      if (retryT) { env.clearTimeout(retryT); retryT = null; }
      const old = conn; conn = null; release(old); // switching source: replace the stream, keep the context
      set('requesting');
      pending = (async () => {
        try {
          const c = await connect(source);
          if (!c) return status();
          startTimer(); set('active'); return status();
        } catch (e) { wantOn = false; stopTimer(); set('error', '', e.message); throw e; }
        finally { pending = null; }
      })();
      return pending;
    }
    function stop() {
      wantOn = false; if (retryT) { env.clearTimeout(retryT); retryT = null; }
      const c = conn; conn = null; release(c); stopTimer();
      if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); // kept for the session: no context churn
      st.attempts = 0; set('inactive');
    }
    return {
      start, stop, status,
      subscribe(f) { subs.add(f); return () => subs.delete(f); },
      onState(f) { stateSubs.add(f); return () => stateSubs.delete(f); },
      get features() { return st.state === 'active' || st.state === 'interrupted' ? engine && engine.F : null; },
      get engine() { return engine; },
      get context() { return ctx; },
      get state() { return st.state; },
      get active() { return st.state === 'active' || st.state === 'interrupted'; },
      get wanted() { return wantOn; },
      _tick: tick, // tests
    };
  }
  const api = { createAudioService, STATES, BACKOFF };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.LumenAudioService = api; root.LumenAudioSvc = createAudioService(); }
})(typeof window !== 'undefined' ? window : globalThis);
