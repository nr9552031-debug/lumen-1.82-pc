/* Lumen audiovisual scheduler (1.7): one timing model for the projector and every bulb.

   An event is planned for the moment it should be SEEN (at, ms on a monotonic clock). Each output (the projector,
   each bulb) has its own latency, so it is sent early by exactly that much: at - latency(output). Outputs also have
   a minimum interval between commands (their rate limit) and a staleness limit: a command that can no longer be
   shown close enough to its moment is dropped and counted as missed instead of arriving late and out of step.

   The scheduler only decides WHEN; it never talks to devices (tick() hands due commands to a send function).
   Latency can be corrected from measurements (observe): an exponential average of the measured delay and of its
   variation (jitter), applied as a bounded correction to the calibrated latency.

   createScheduler({ now }) -> s
     s.output(id, { latency, interval, maxLate, kind })   register / update an output
     s.at(id, atMs, payload, { priority, hold })             plan one command (coalesces with a pending one)
     s.tick(nowMs, send)                                     send what is due: send(id, payload, lateMs)
     s.observe(id, measuredMs)                               feed a measured delay (adaptive latency + jitter)
     s.remove(id)                                            output disappeared: its pending commands are dropped
     s.latency(id) · s.stats() · s.pending() · s.clear()                                                        */
(function (root) {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function createScheduler(o) {
    o = o || {};
    const now = o.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    const outs = new Map(), queue = []; // queue sorted by sendAt
    const st = (id) => { let x = outs.get(id); if (!x) { x = { latency: 0, interval: 0, maxLate: 120, kind: 'light', last: -1e12, ew: null, dev: 0, base: null, n: 0, sent: 0, late: 0, missed: 0, coalesced: 0, dropped: 0, worst: 0 }; outs.set(id, x); } return x; };
    function output(id, p) { const x = st(id); if (p) { if (p.latency != null) x.latency = Math.max(0, +p.latency || 0); if (p.interval != null) x.interval = Math.max(0, +p.interval || 0); if (p.maxLate != null) x.maxLate = Math.max(10, +p.maxLate || 0); if (p.kind) x.kind = p.kind; } return x; }
    // calibrated latency plus a bounded correction from what is actually being measured right now
    function latency(id) { const x = outs.get(id); if (!x) return 0; const corr = x.ew != null && x.base != null && x.n >= 5 ? clamp(x.ew - x.base, -0.5 * x.latency, x.latency + 400) : 0; return Math.max(0, x.latency + corr); }
    function at(id, atMs, payload, opt) {
      const x = st(id), pri = (opt && opt.priority) || 1, sendAt = atMs - latency(id);
      // one pending command per output inside its interval: keep the more important / later one
      for (let i = 0; i < queue.length; i++) { const q = queue[i]; if (q.id === id && Math.abs(q.sendAt - sendAt) < Math.max(x.interval, 1)) { if (pri >= q.pri) { q.sendAt = sendAt; q.at = atMs; q.payload = payload; q.pri = pri; q.hold = opt && opt.hold; resort(); } x.coalesced++; return q; } }
      const q = { id, at: atMs, sendAt, payload, pri, hold: opt && opt.hold };
      let i = queue.length; while (i > 0 && queue[i - 1].sendAt > sendAt) i--; queue.splice(i, 0, q); return q;
    }
    function resort() { queue.sort((a, b) => a.sendAt - b.sendAt); }
    function tick(t, send) {
      t = t == null ? now() : t; let n = 0;
      for (let i = 0; i < queue.length;) {
        const q = queue[i]; if (q.sendAt > t) break;
        const x = st(q.id), lateBy = t - q.sendAt;
        if (lateBy > x.maxLate) { queue.splice(i, 1); x.missed++; continue; }                // too late to be in step: skip it
        if (t - x.last < x.interval) { i++; continue; }                                      // rate limit: wait (until stale)
        let ok; try { ok = send(q.id, q.payload, lateBy, q); } catch (e) { ok = true; x.dropped++; }
        if (ok === false) { i++; continue; }                                                  // output busy: try again next tick
        queue.splice(i, 1); x.last = t; x.sent++; if (lateBy > 30) x.late++; x.worst = Math.max(x.worst, lateBy); n++;
      }
      return n;
    }
    function observe(id, ms) { // measured delay for this output (e.g. a cloud bulb's acknowledgement time)
      const x = st(id); if (!(ms >= 0) || ms > 20000) return;
      x.n++; if (x.ew == null) { x.ew = ms; x.base = ms; return; }
      const d = ms - x.ew; x.ew += 0.15 * d; x.dev += 0.15 * (Math.abs(d) - x.dev);
      if (x.n <= 5) x.base = x.base + (ms - x.base) / x.n; // the first few measurements set the baseline
    }
    function remove(id) { const x = outs.get(id); for (let i = queue.length - 1; i >= 0; i--) if (queue[i].id === id) { queue.splice(i, 1); if (x) x.dropped++; } outs.delete(id); }
    function stats() { const o2 = {}; for (const [id, x] of outs) o2[id] = { kind: x.kind, latency: Math.round(latency(id)), calibrated: x.latency, jitter: Math.round(x.dev), measured: x.ew == null ? null : Math.round(x.ew), sent: x.sent, late: x.late, missed: x.missed, coalesced: x.coalesced, dropped: x.dropped, worstLate: Math.round(x.worst) }; return o2; }
    return { output, at, tick, observe, remove, latency, stats, pending: () => queue.length, clear: () => { queue.length = 0; }, now, queue };
  }
  const api = { createScheduler };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LumenSched = api;
})(typeof window !== 'undefined' ? window : globalThis);
