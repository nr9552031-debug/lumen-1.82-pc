'use strict';
/* Audio & Effects page. This file does the signal ANALYSIS (capture, bands, beats, meters) and sends small frames
   to the main process, which decides what each light does and how often it can be told. */
const FXSPEED = { wiz: 'instant · local', cync: '~2 changes a second · cloud relay', hubspace: 'slow · one change per 2.5 s · cloud' };
const fx = { st: null, cfg: null, cap: null, err: '', poll: null, prev: null, rate: {}, quiet: 0, inputs: [], live: {}, stats: null };
const fxMode = (id) => (fx.st ? fx.st.modes : []).find((m) => m.id === (id || fx.cfg.mode)) || { audio: true };

async function fxInit() {
  if (fx.cfg) return;
  fx.st = await call('fx:status');
  const { active, sent, dropped, rates, palettes, modes, saved, ids, ...opts } = fx.st;
  fx.cfg = { ...opts, ...(saved || {}), ids: saved && saved.ids ? saved.ids.slice() : null };
  if (window.lumen.onFx) window.lumen.onFx((list) => { fx.live = Object.fromEntries(list.map((l) => [l.id, l])); fxPaintLive(); });
  if (navigator.mediaDevices) { navigator.mediaDevices.addEventListener('devicechange', fxInputs); fxInputs(); }
}
const fxEligible = () => S.devices.filter((d) => d.caps && (d.caps.color || d.caps.dim || d.caps.temp));
function fxIds() { // first visit: every light that can take part
  if (!fx.cfg.ids) fx.cfg.ids = fxEligible().filter((d) => d.online !== false).map((d) => d.id);
  return fx.cfg.ids.filter((id) => dev(id));
}
async function fxInputs() {
  try { fx.inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications'); } catch { fx.inputs = []; }
  const sel = $('#fxMic'); if (sel) sel.innerHTML = fxMicOptions();
}
const fxMicOptions = () => `<option value="">Default microphone</option>` + fx.inputs.filter((d) => d.deviceId && d.deviceId !== 'default').map((d, i) => `<option value="${esc(d.deviceId)}" ${d.deviceId === fx.cfg.micId ? 'selected' : ''}>${esc(d.label || `Microphone ${i + 1}`)}</option>`).join('');

/* ---------- capture ---------- */
async function fxCaptureStart() {
  const want = fx.cfg.source === 'mic' ? 'mic:' + (fx.cfg.micId || '') : 'system';
  if (fx.cap && fx.cap.kind === want) return;
  fxCaptureStop();
  let stream;
  try {
    if (fx.cfg.source === 'mic') stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: fx.cfg.micId ? { exact: fx.cfg.micId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    else stream = await navigator.mediaDevices.getDisplayMedia({ video: { width: { max: 320 }, height: { max: 180 }, frameRate: { max: 8 } }, audio: true });
  } catch (e) {
    const why = e.name === 'NotFoundError' || e.name === 'OverconstrainedError' ? 'that microphone is not connected' : e.name === 'NotAllowedError' ? 'Windows or the app refused access' : `${e.name || 'error'}: ${e.message || 'capture refused'}`;
    throw new Error(fx.cfg.source === 'mic' ? `Lumen could not open the microphone (${why}). Check Windows Settings → Privacy → Microphone.` : `Lumen could not start listening to this PC's sound (${why}).`);
  }
  const at = stream.getAudioTracks();
  if (!at.length || at[0].readyState === 'ended') { stream.getTracks().forEach((t) => t.stop()); throw new Error('No system-audio track was provided. On macOS 15 or later, allow Screen & System Audio Recording for Lumen and choose a screen in the system picker; otherwise choose Microphone.'); }
  const ctx = new AudioContext(); try { await ctx.resume(); } catch {}
  const analyser = ctx.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.55;
  ctx.createMediaStreamSource(new MediaStream(at)).connect(analyser); // analysed only: never played back or recorded
  const cap = fx.cap = { kind: want, stream, ctx, analyser, freq: new Uint8Array(analyser.frequencyBinCount), time: new Uint8Array(1024), step: LumenAudio.createTracker(), n: 0, screen: null, beatAt: 0, vu: 0, label: at[0].label || '' };
  const vt = stream.getVideoTracks();
  if (vt.length) { cap.video = document.createElement('video'); cap.video.muted = true; cap.video.srcObject = new MediaStream(vt); cap.video.play().catch(() => {}); const cv = document.createElement('canvas'); cv.width = 32; cv.height = 18; cap.g = cv.getContext('2d', { willReadFrequently: true }); }
  fx.quiet = 0; fx.stats = { frames: 0, silent: 0, beats: 0, peak: 0, since: performance.now() };
  at[0].addEventListener('ended', () => { if (fx.cap === cap) fxStop(fx.cfg.source === 'mic' ? 'The microphone was disconnected, so the show was stopped.' : 'Sound capture ended, so the show was stopped.'); });
  window.lumen.call('fx:note', `capture started: ${fx.cfg.source} "${cap.label.slice(0, 60)}" ${ctx.sampleRate} Hz`);
  cap.timer = setInterval(fxTick, 40); // 25 analysed frames a second
  fxInputs(); // device names become available once access has been granted
}
function fxCaptureStop() {
  const c = fx.cap; if (!c) return; fx.cap = null;
  clearInterval(c.timer); fxNoteStats();
  try { c.stream.getTracks().forEach((t) => t.stop()); } catch {}
  try { if (c.video) c.video.srcObject = null; c.ctx.close(); } catch {}
  fxDraw(null, null);
}
// A line in the diagnostics every 30 s, so "the lights did nothing" can be told apart from "no sound arrived".
function fxNoteStats() {
  const s = fx.stats; if (!s || !s.frames) return;
  window.lumen.call('fx:note', `audio: ${s.frames} frames, ${Math.round(100 * s.silent / s.frames)}% silent, peak level ${s.peak.toFixed(2)}, ${s.beats} beats`);
  fx.stats = { frames: 0, silent: 0, beats: 0, peak: 0, since: performance.now() };
}
function fxTick() {
  const c = fx.cap; if (!c) return;
  c.analyser.getByteFrequencyData(c.freq); c.analyser.getByteTimeDomainData(c.time);
  const raw = LumenAudio.bands(c.freq, c.ctx.sampleRate, c.analyser.fftSize, fx.cfg.edges), f = c.step(raw, performance.now());
  c.vu = Math.max(LumenAudio.rms(c.time) * 2.2, c.vu * 0.86);
  if (fx.cfg.mode === 'screen' && c.g) {
    if (c.n++ % 4 === 0 && c.video.readyState >= 2) { try { c.g.drawImage(c.video, 0, 0, 32, 18); c.screen = LumenAudio.screenColor(c.g.getImageData(0, 0, 32, 18).data); } catch {} }
    f.screen = c.screen;
  }
  if (f.beat) c.beatAt = performance.now();
  fx.quiet = f.silent ? fx.quiet + 1 : 0;
  const s = fx.stats; s.frames++; if (f.silent) s.silent++; if (f.beat) s.beats++; s.peak = Math.max(s.peak, raw.level); if (performance.now() - s.since > 30000) fxNoteStats();
  if (fx.st && fx.st.active) window.lumen.send('fx:frame', f);
  fxDraw(c, f);
}

/* ---------- meters: spectrum, waveform, beat flash, input level ---------- */
function fxDraw(c, f) {
  const cv = $('#fxViz'), vu = $('#fxVu'), hint = $('#fxHint'); if (!cv) return;
  const g = cv.getContext('2d'), W = cv.width, H = cv.height; g.clearRect(0, 0, W, H);
  if (vu) vu.style.width = (c ? Math.min(100, c.vu * 100) : 0) + '%';
  if (!c) { if (hint) hint.textContent = ''; g.fillStyle = '#5d6b85'; g.font = '12px Tahoma'; g.fillText('Not listening', 10, 20); return; }
  if (fx.cfg.mode === 'screen' && c.screen) { g.fillStyle = `rgb(${c.screen.join(',')})`; g.globalAlpha = 0.3; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
  const bars = 64, hz = c.ctx.sampleRate / c.analyser.fftSize, bw = W / bars, e = fx.cfg.edges || { low: 180, high: 2000 };
  for (let i = 0; i < bars; i++) { // log-spaced 40 Hz .. 12 kHz, tinted by which band the bar belongs to
    const lo = 40 * Math.pow(300, i / bars), hi = 40 * Math.pow(300, (i + 1) / bars);
    let a = Math.max(1, Math.floor(lo / hz)), b = Math.max(a, Math.min(c.freq.length - 1, Math.floor(hi / hz))), m = 0;
    for (let k = a; k <= b; k++) m = Math.max(m, c.freq[k]);
    const h = Math.max(2, (m / 255) * (H - 6)), col = fx.cfg.bandColors[lo < e.low ? 'bass' : lo < e.high ? 'mid' : 'treble'];
    g.fillStyle = `rgb(${col.join(',')})`; g.fillRect(i * bw + 1, H - h, bw - 2, h);
  }
  g.beginPath(); g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.2;
  for (let i = 0; i < c.time.length; i += 4) { const x = (i / c.time.length) * W, y = H * 0.28 + ((c.time[i] - 128) / 128) * H * 0.26; i ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.stroke();
  const since = performance.now() - c.beatAt;
  g.beginPath(); g.arc(W - 16, 16, 7, 0, 7); g.fillStyle = since < 160 ? '#fff' : '#2a3550'; g.fill(); g.strokeStyle = '#8fa3c8'; g.stroke();
  if (hint) hint.textContent = fx.quiet > 100 ? (fx.cfg.source === 'mic' ? 'The microphone is silent. Is it muted or the wrong one?' : "No sound detected. Play something through this PC's default speakers or headphones.") : '';
}
function fxPaintLive() { for (const el of $$('[data-live]')) { const l = fx.live[el.dataset.live]; el.style.background = l && l.rgb && fx.st && fx.st.active ? `rgb(${l.rgb.map((v) => Math.round(v * (0.35 + 0.65 * l.bri / 100))).join(',')})` : '#222'; } }

/* ---------- start / stop / live changes ---------- */
const fxCfgOut = () => ({ ...fx.cfg, ids: fxIds() });
async function fxStart() {
  fx.err = '';
  if (!fxIds().length) { fx.err = 'Tick at least one light below.'; return fxPaint(); }
  if (fxMode().strobe && !fx.cfg.strobeOk) { fx.err = 'Strobe flashes the lights. Tick the confirmation under the mode list first.'; return fxPaint(); }
  try { if (fxMode().audio) await fxCaptureStart(); fx.st = await call('fx:start', fxCfgOut()); }
  catch (e) { if (!(fx.st && fx.st.active)) fxCaptureStop(); fx.err = e.message; window.lumen.call('fx:note', 'start failed: ' + e.message); }
  fx.prev = null; fxPoll(); fxPaint();
}
async function fxStop(msg) {
  try { fx.st = await call('fx:stop'); } catch {}
  if (!$('#fxListen') || !$('#fxListen').checked) fxCaptureStop();
  if (msg) fx.err = msg; fx.live = {};
  fxPoll(); fxPaint();
}
// Any setting changed: remember it, and if a show is running apply it straight away.
const fxPush = debounce(async () => {
  const active = fx.st && fx.st.active;
  try {
    if ((active || fx.cap) && fxMode().audio) await fxCaptureStart();
    else if (active && !fxMode().audio && !($('#fxListen') && $('#fxListen').checked)) fxCaptureStop(); // ambient effects need no capture
    fx.st = await call('fx:update', fxCfgOut()); fx.err = '';
  } catch (e) { fx.err = e.message; }
  fxPaint();
}, 150);
function fxPoll() {
  clearInterval(fx.poll); fx.poll = null;
  if (!(fx.st && fx.st.active)) return;
  fx.poll = setInterval(async () => {
    const r = await window.lumen.call('fx:status'); if (!r.ok) return;
    const now = performance.now();
    if (fx.prev) { const dt = (now - fx.prev.t) / 1000; for (const b of Object.keys(r.data.sent)) fx.rate[b] = (r.data.sent[b] - (fx.prev.sent[b] || 0)) / dt; }
    fx.prev = { t: now, sent: r.data.sent }; fx.st = r.data;
    if (!fx.st.active) { fxCaptureStop(); fxPoll(); fxPaint(); } else fxPaintStatus();
  }, 1000);
}

/* ---------- page ---------- */
function renderFx(c) {
  if (!fx.cfg) { c.innerHTML = '<div class="panel"><div class="empty">Loading…</div></div>'; fxInit().then(() => { if (view.t === 'fx') renderFx($('#content')); }); return; }
  if (!$('#fxRoot')) {
    const sl = (id, label, min, max, step, tip) => `<label data-tip="${esc(tip)}">${label}</label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}"><span id="${id}V" class="muted" style="min-width:44px"></span>`;
    c.innerHTML = `<div id="fxRoot">
      <div class="panel"><div class="ph">${ico('fx')}Show<span id="fxPill" class="right" style="font-weight:normal"></span></div><div class="pb">
        <div class="row wrap" style="margin-bottom:8px"><b>Listen to</b><label class="chk"><input type="radio" name="fxSrc" value="system">This PC's sound</label><label class="chk"><input type="radio" name="fxSrc" value="mic">Microphone</label><select id="fxMic" style="max-width:240px"></select>
          <label class="chk" data-tip="Keep the meters running without driving any lights, to check levels"><input type="checkbox" id="fxListen">Monitor only</label><span class="sp"></span><span class="muted">Input level</span><div class="vu" style="width:150px"><i id="fxVu" style="width:0"></i></div></div>
        <canvas id="fxViz" class="scope" width="900" height="120"></canvas>
        <div class="row" style="margin-top:8px"><button class="btn pri" id="fxGo" style="min-width:150px;min-height:28px"></button><span id="fxHint" class="muted"></span><span class="sp"></span><span id="fxStatus" class="muted"></span></div>
        <div id="fxErr"></div></div></div>
      <div class="cols" style="grid-template-columns:minmax(320px,1.25fr) minmax(280px,1fr);align-items:start">
        <div class="panel" style="margin:0"><div class="ph">Mode</div><div class="pb"><div class="sect">Reacts to sound</div><div class="modes" id="fxModesA"></div><div class="sect">Ambient, no sound needed</div><div class="modes" id="fxModesB"></div>
          <div id="fxStrobe" class="note hidden" style="margin:10px 0 0"><label class="chk" style="align-items:flex-start"><input type="checkbox" id="fxStrobeOk"><span>I understand that strobe flashes the lights and can affect people with photosensitive epilepsy. Lumen limits it to 2 flashes a second.</span></label></div></div></div>
        <div class="panel" style="margin:0"><div class="ph">Response</div><div class="pb"><div class="kvgrid">
          ${sl('fxSens', 'Sensitivity', 0.3, 3, 0.1, 'How much sound it takes to reach full brightness')}${sl('fxSmooth', 'Smoothing', 0, 0.95, 0.05, 'Higher is calmer: slower rise and fall, no flicker')}${sl('fxInt', 'Intensity', 0.1, 1, 0.05, 'How far brightness swings between the minimum and maximum')}
          ${sl('fxSpeed', 'Effect speed', 0.25, 4, 0.25, 'Speed of colour cycling and ambient effects')}${sl('fxMin', 'Min brightness', 1, 100, 1, 'Lights never go below this')}${sl('fxMax', 'Max brightness', 10, 100, 1, 'Lights never go above this')}
          ${sl('fxLow', 'Bass up to', 60, 400, 10, 'Where bass ends and mids begin')}${sl('fxHigh', 'Highs from', 800, 6000, 100, 'Where mids end and highs begin')}</div>
          <div id="fxPalRow" style="margin-top:8px"><div class="muted" style="margin-bottom:3px">Palette</div><div class="row wrap" id="fxPals"></div></div>
          <div id="fxBandRow" style="margin-top:8px"><div class="muted" style="margin-bottom:3px">Colour for each band</div><div class="row">${['bass', 'mid', 'treble'].map((b) => `<label class="row" style="gap:4px"><input type="color" data-band="${b}">${b === 'mid' ? 'Mids' : b === 'bass' ? 'Bass' : 'Highs'}</label>`).join('')}</div></div></div></div>
      </div>
      <div class="panel" style="margin-top:12px"><div class="ph">${ico('bulb')}Lights in the show<span class="sp"></span><button class="btn" data-fxall="1">All</button><button class="btn" data-fxall="0">None</button><select id="fxRoomPick" style="font-weight:normal"></select></div>
        <div class="pb"><p class="muted" style="margin-bottom:4px">The dot shows what each light is being asked to do. Local lights follow closely; cloud lights get a slower, smoother version. Colour jumps are capped at 3 a second, and stopping puts every light back how it was.</p><div id="fxLights"></div></div></div></div>`;
    const root = $('#fxRoot');
    root.addEventListener('click', (e) => {
      const m = e.target.closest('[data-mode]'); if (m) { fx.cfg.mode = m.dataset.mode; fxPaint(); return fxPush(); }
      const p = e.target.closest('[data-pal]'); if (p) { if (p.dataset.pal.startsWith('fav:')) { const fp = (S.settings.favPalettes || [])[+p.dataset.pal.slice(4)]; if (fp) { fx.cfg.palette = 'custom'; fx.cfg.colors = fp.colors; fx.cfg.palName = fp.name; } } else fx.cfg.palette = p.dataset.pal; fxPaint(); return fxPush(); }
      if (e.target.closest('#fxGo')) return fx.st && fx.st.active ? fxStop() : fxStart();
      const all = e.target.closest('[data-fxall]'); if (all) { fx.cfg.ids = all.dataset.fxall === '1' ? fxEligible().map((d) => d.id) : []; fxPaint(); return fxPush(); }
    });
    root.addEventListener('change', async (e) => {
      const t = e.target;
      if (t.dataset.fxid) { const ids = new Set(fxIds()); t.checked ? ids.add(t.dataset.fxid) : ids.delete(t.dataset.fxid); fx.cfg.ids = [...ids]; fxPush(); }
      else if (t.dataset.fxband) { fx.cfg.perLight = { ...fx.cfg.perLight, [t.dataset.fxband]: t.value }; fxPush(); }
      else if (t.name === 'fxSrc') { fx.cfg.source = t.value; fxPaint(); fxPush(); }
      else if (t.id === 'fxMic') { fx.cfg.micId = t.value; fxPush(); }
      else if (t.id === 'fxStrobeOk') { fx.cfg.strobeOk = t.checked; fxPush(); }
      else if (t.id === 'fxRoomPick' && t.value) { fx.cfg.ids = fxEligible().filter((d) => d.room === t.value).map((d) => d.id); t.value = ''; fxPaint(); fxPush(); }
      else if (t.id === 'fxListen') { if (t.checked) { try { await fxCaptureStart(); fx.err = ''; } catch (x) { fx.err = x.message; t.checked = false; } } else if (!(fx.st && fx.st.active)) fxCaptureStop(); fxPaint(); }
    });
    const map = { fxSens: 'sensitivity', fxSmooth: 'smoothing', fxInt: 'intensity', fxSpeed: 'speed', fxMin: 'minBrightness', fxMax: 'brightness' };
    root.addEventListener('input', (e) => {
      const t = e.target;
      if (map[t.id]) fx.cfg[map[t.id]] = +t.value; else if (t.id === 'fxLow') fx.cfg.edges = { ...fx.cfg.edges, low: +t.value }; else if (t.id === 'fxHigh') fx.cfg.edges = { ...fx.cfg.edges, high: +t.value };
      else if (t.dataset.band) fx.cfg.bandColors = { ...fx.cfg.bandColors, [t.dataset.band]: C.parseColor(t.value) }; else return;
      if (fx.cfg.minBrightness > fx.cfg.brightness) { if (t.id === 'fxMin') fx.cfg.brightness = fx.cfg.minBrightness; else fx.cfg.minBrightness = fx.cfg.brightness; }
      fxLabels(); fxPush();
    });
    const v = fx.cfg; $('#fxSens').value = v.sensitivity; $('#fxSmooth').value = v.smoothing; $('#fxInt').value = v.intensity; $('#fxSpeed').value = v.speed; $('#fxMin').value = v.minBrightness; $('#fxMax').value = v.brightness; $('#fxLow').value = v.edges.low; $('#fxHigh').value = v.edges.high;
    $$('[data-band]', root).forEach((i) => { i.value = C.hex(v.bandColors[i.dataset.band]); });
    $('#fxMic').innerHTML = fxMicOptions(); fxPoll(); fxDraw(fx.cap, null);
  }
  fxPaint();
}
function fxLabels() {
  const v = fx.cfg, set = (id, t) => { const el = $('#' + id + 'V'); if (el) el.textContent = t; };
  set('fxSens', v.sensitivity.toFixed(1) + '×'); set('fxSmooth', Math.round(v.smoothing * 100) + '%'); set('fxInt', Math.round(v.intensity * 100) + '%'); set('fxSpeed', v.speed + '×'); set('fxMin', v.minBrightness + '%'); set('fxMax', v.brightness + '%'); set('fxLow', v.edges.low + ' Hz'); set('fxHigh', v.edges.high + ' Hz');
  if ($('#fxMin') && !busyDrag) { $('#fxMin').value = v.minBrightness; $('#fxMax').value = v.brightness; }
}
function fxPaint() {
  if (!$('#fxRoot')) return;
  const active = !!(fx.st && fx.st.active), mode = fxMode(), pals = (fx.st && fx.st.palettes) || {}, v = fx.cfg;
  const mb = (m) => `<button class="mode ${m.id === v.mode ? 'on' : ''}" data-mode="${m.id}"><b>${esc(m.name)}</b><small>${esc(m.desc)}</small></button>`;
  $('#fxModesA').innerHTML = fx.st.modes.filter((m) => m.audio).map(mb).join(''); $('#fxModesB').innerHTML = fx.st.modes.filter((m) => !m.audio).map(mb).join('');
  $('#fxStrobe').classList.toggle('hidden', !mode.strobe); $('#fxStrobeOk').checked = !!v.strobeOk;
  $$('input[name=fxSrc]').forEach((r) => { r.checked = r.value === v.source; }); $('#fxMic').classList.toggle('hidden', v.source !== 'mic');
  $('#fxPalRow').classList.toggle('hidden', !!mode.noPalette || ['bass', 'treble', 'bands'].includes(v.mode)); $('#fxBandRow').classList.toggle('hidden', !['bass', 'treble', 'bands', 'spectrum'].includes(v.mode));
  const grad = (cols) => `linear-gradient(90deg,${cols.map((c2) => `rgb(${c2.join(',')})`).join(',')})`;
  $('#fxPals').innerHTML = Object.keys(pals).map((k) => `<button class="btn palbtn ${v.palette === k ? 'down' : ''}" data-pal="${k}"><i style="background:${grad(pals[k])}"></i>${k[0].toUpperCase() + k.slice(1)}</button>`).join('') +
    (S.settings.favPalettes || []).map((p, i) => `<button class="btn palbtn ${v.palette === 'custom' && String(v.colors) === String(p.colors) ? 'down' : ''}" data-pal="fav:${i}" data-tip="Saved in the Colour Studio"><i style="background:${grad(p.colors)}"></i>${esc(p.name)}</button>`).join('');
  $('#fxGo').textContent = active ? '■  Stop the show' : mode.audio ? '▶  Start the show' : '▶  Start effect';
  $('#fxPill').innerHTML = `<i class="led ${active ? 'ok' : fx.cap ? 'warn' : ''}"></i>${active ? 'Running: ' + esc(mode.name) : fx.cap ? 'Listening' : 'Stopped'}`;
  $('#fxErr').innerHTML = fx.err ? `<div class="note err" style="margin:8px 0 0"><i class="led bad"></i><span>${esc(fx.err)}</span></div>` : '';
  $('#fxRoomPick').innerHTML = `<option value="">Pick a room…</option>` + S.rooms.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
  const ids = new Set(fxIds()), list = fxEligible(), bandSel = (d) => `<select data-fxband="${esc(d.id)}" data-tip="Which part of the sound this light follows">${[['auto', 'Automatic'], ['bass', 'Bass'], ['mid', 'Mids'], ['treble', 'Highs'], ['level', 'Overall']].map(([k, l]) => `<option value="${k}" ${(v.perLight[d.id] || 'auto') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  $('#fxLights').innerHTML = list.length ? list.map((d) => `<div class="lightrow"><input type="checkbox" data-fxid="${esc(d.id)}" ${ids.has(d.id) ? 'checked' : ''}><span><b>${esc(d.name)}</b> <span class="tag ${d.brand}">${BRANDS[d.brand]}</span>${d.room ? ` <span class="muted">${esc(roomName(d.room))}</span>` : ''}</span>
      <span class="muted small">${d.online === false ? 'offline' : FXSPEED[d.brand] || ''}${d.caps.color ? '' : ' · white only: follows with brightness'}</span>${bandSel(d)}<i data-live="${esc(d.id)}"></i></div>`).join('') : '<div class="empty">No lights yet. Find or connect some first.</div>';
  fxLabels(); fxPaintStatus(); fxPaintLive();
}
function fxPaintStatus() {
  const el = $('#fxStatus'); if (!el) return; const st = fx.st || {};
  el.textContent = st.active ? Object.keys(st.sent || {}).filter((b) => st.sent[b]).map((b) => `${BRANDS[b]} ${(fx.rate[b] || 0).toFixed(1)} commands/s`).join(' · ') : '';
  const dropped = st.dropped || [];
  if (dropped.length && $('#fxErr') && !fx.err) $('#fxErr').innerHTML = dropped.map((d) => `<div class="note err" style="margin:8px 0 0"><i class="led bad"></i><span>${esc(d.name)} left the show: ${esc(d.reason)}</span></div>`).join('');
}
