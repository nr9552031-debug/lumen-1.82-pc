'use strict';
/* Projection Studio: map animations onto shapes that fit real things in the room (a wall, a picture frame, a
   doorway), show them through a projector, and let the smart lights follow. Drawing is done by ProjRenderer;
   the lights are driven separately in the main process, so a slow bulb can never slow the picture down. */
const PJ = window.LumenProj;
const pj = { list: null, cur: null, sel: null, tab: 'visuals', undo: [], canvas: null, R: null, timer: null, n: 0, running: false, add: null, drag: null,
  cap: null, feat: null, displays: [], display: '', platform: '', out: { open: false }, thumbs: {}, thumbBusy: false, dom: null, regional: {}, sent: {}, err: '', sample: null, lastTargets: {},
  // 1.7 audiovisual engine
  eng: null, dir: null, sched: null, ov: {}, live: null, rf: null, beatLatch: false, dropLatch: false, shownBeat: 0, cuedBeat: 0, lat: [], thumbCol: {}, next: null, last: null, adv: false, calib: null, sync: {}, fakeF: null };
const PJD = window.LumenDirector, PJF = window.LumenFeatures, PJS = window.LumenSched;
const pjSel = () => pj.cur && pj.cur.regions.find((r) => r.id === pj.sel);
const pjLights = () => S.devices.filter((d) => d.online !== false && d.caps && (d.caps.color || d.caps.dim || d.caps.temp));
const pjActiveIds = () => pjLights().map((d) => d.id).filter((id) => !pj.cur.lights.exclude.includes(id));

/* ---------- data ---------- */
async function pjInit() {
  pj.list = (await call('proj:list')).map(PJ.project);
  const appInfo = await call('app:info');
  pj.platform = /\|\s*darwin\b/i.test(appInfo.runtime || '') ? 'darwin' : 'other';
  pj.cur = pj.list[0] || PJ.project({ name: 'My room', regions: PJ.STARTERS[0].regions });
  pj.sel = pj.cur.regions[0] ? pj.cur.regions[0].id : null;
  pj.displays = await call('proj:displays'); const ext = pj.displays.find((d) => !d.primary); pj.display = (ext || pj.displays[0] || {}).id || '';
  const st = await call('proj:status'); pj.out = st.output; pj.running = st.lights.active;
  if (window.lumen.onProj) window.lumen.onProj((s) => { pj.out = s; pjBar(); });
}
const pjSave = debounce(async () => { if (!pj.cur) return; const saved = await call('proj:save', pj.cur); if (!pj.cur.id) { pj.cur.id = saved.id; pj.list.push(pj.cur); pjBar(); } }, 700);
// What is shown: the saved project, or in Autonomous mode a live copy with the director's choices on top.
const pjView = () => (pj.cur.mode === 'auto' && pj.live ? pj.live : pj.cur);
function pjLive() {
  if (pj.cur.mode !== 'auto') { pj.live = null; return; }
  pj.live = { ...pj.cur, regions: pj.cur.regions.map((r) => (pj.ov[r.id] ? { ...r, ...pj.ov[r.id] } : r)) };
}
const pjPushNow = () => { if (pj.cur) window.lumen.send('proj:state', { ...pjView(), photo: '', flash: !!(pj.calib && pj.calib.flash) }); };
const pjPush = throttle(pjPushNow, 60);
function pjChanged(repaint) { pjLive(); pjSvg(); pjPush(); pjSave(); if (repaint) pjPanel(); pjStatus(); }
function pjSnap() { pj.undo.push(JSON.stringify(pj.cur.regions)); if (pj.undo.length > 60) pj.undo.shift(); }
function pjUndo() { const s = pj.undo.pop(); if (!s) return; pj.cur.regions = JSON.parse(s).map(PJ.region); if (!pjSel()) pj.sel = null; pjChanged(true); }
function pjOpen(p) { pj.cur = p; pj.sel = p.regions[0] ? p.regions[0].id : null; pj.undo = []; pj.add = null; pj.ov = {}; pjDirector(true); pjLive(); pjPaint(); pjPush(); }

/* ---------- drawing loop: preview, colour sampling, light targets ---------- */
function pjEnsureLoop() {
  if (!pj.canvas) { pj.canvas = document.createElement('canvas'); pj.canvas.width = 960; pj.canvas.height = 540; pj.canvas.id = 'pjGl'; pj.R = new ProjRenderer(pj.canvas);
    const s = document.createElement('canvas'); s.width = 48; s.height = 27; pj.sample = s.getContext('2d', { willReadFrequently: true }); }
  if (pj.timer) return;
  pj.timer = setInterval(() => {
    const shown = !!$('#pjRoot');
    if (!shown && !pj.running) { clearInterval(pj.timer); pj.timer = null; return; } // nothing to draw for
    const now = performance.now(), f = pjRenderFeatures(now);
    if (pj.cur.mode === 'auto') pjAutoTick(now);
    if (pj.sched) pj.sched.tick(now, pjApply);
    // The preview must never hold up the music analysis. Drawing cost hides in the graphics pipeline (calls return at
    // once, the page stalls later), so it is judged by how late this page's own timers run: when they lag, the preview
    // draws less often and at a lower resolution; when they are punctual again it steps back up. The projector
    // window draws on its own and is not affected.
    pjPreviewBudget(now);
    if (pj.n % pj.drawEvery === 0) pj.R.render(pjView(), now / 1000, f, PJ.STYLES[pj.cur.audio.style] * pj.cur.audio.sensitivity);
    if (pj.calib) pjCalibTick(now);
    if (pj.n++ % 4) return;
    pjSample();
    if (pj.running && pj.cur.lights.mode !== 'off') {
      const L = pj.cur.lights;
      pj.lastTargets = PJ.lightTargets({ mode: L.mode, ids: pjActiveIds(), custom: L.custom, brightness: L.brightness, sensitivity: L.sensitivity, style: pj.cur.audio.style, dom: pj.dom, regional: pj.regional, audio: pj.cur.mode === 'manual' ? null : f });
      window.lumen.send('proj:lights', pj.lastTargets);
    }
    if (shown && pj.n % 32 === 1) pjPollStatus();
    if (shown && pj.n % 12 === 1 && pj.tab === 'visuals') pjEvoNow();
  }, 33);
}
// Read a tiny copy of the picture: the main colour overall, and the colour inside each shape that has bulbs linked to it.
function pjSample() {
  const g = pj.sample, W = 48, H = 27;
  try { g.drawImage(pj.canvas, 0, 0, W, H); } catch { return; }
  const d = g.getImageData(0, 0, W, H).data;
  pj.dom = pj.cur.blackout ? null : LumenAudio.screenColor(d);
  pj.regional = {};
  for (const r of pj.cur.regions) {
    if (!r.lights.length || r.hidden) continue;
    const px = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (PJ.pointInPoly([(x + 0.5) / W, (y + 0.5) / H], r.pts)) { const i = (y * W + x) * 4; px.push(d[i], d[i + 1], d[i + 2], 255); }
    const c = px.length ? LumenAudio.screenColor(px) : null;
    if (c) for (const id of r.lights) pj.regional[id] = c;
  }
}
async function pjPollStatus() {
  const r = await window.lumen.call('proj:status'); if (!r.ok) return;
  pj.sent = r.data.lights.sent; pj.dropped = r.data.lights.dropped; pj.sync = r.data.lights.sync || {}; pj.cues = r.data.lights.cues || 0; if (pj.out.open !== r.data.output.open) { pj.out = r.data.output; pjBar(); }
  pjStatus();
}

/* ---------- audio: the persistent session service (audio-service.js); this page only subscribes ---------- */
// Nothing on this page owns the capture: changing animations, settings, tabs, modes or pages can never rebuild
// or stop it. It stops only when the user presses Stop listening.
const SVC = window.LumenAudioSvc;
Object.defineProperties(pj, {
  cap: { get: () => (SVC.active ? SVC : null) },   // truthy while frames are flowing (active or briefly interrupted)
  eng: { get: () => SVC.engine },
  feat: { get: () => SVC.features },
});
async function pjAudioStart() {
  const requested = pj.cur.audio.source === 'mic' ? 'mic' : 'system';
  try { await SVC.start({ source: requested }); }
  catch (e) {
    const source = LumenProjAudio.fallbackSource(pj.platform, requested, e);
    if (source === requested) throw e;
    pj.cur.audio.source = source;
    pj.err = 'macOS did not provide system sound, so Projection Studio switched to the microphone.';
    await SVC.start({ source });
    pjSave();
    pjPanel();
  }
}
function pjAudioStop() { SVC.stop(); }
const pjAudioWanted = () => SVC.wanted || SVC.state === 'requesting';
// Each analysis frame (from the service's own timer, 40 Hz), whatever page or tab is showing.
SVC.subscribe((F, now) => {
  if (!pj.cur) return;
  if (F.beat) pj.beatLatch = true; if (F.drop) pj.dropLatch = true;
  const beat = pjShowBeat(now);
  if (pj.cur.mode !== 'manual') window.lumen.send('proj:audio', pjFrameOut(F, beat));
  pjBeatCues(F, now);
  if (pj.sched) pj.sched.tick(now, pjApply); // timed changes are due on the audio clock too, not only on drawn frames
  if (!$('#pjRoot')) return;
  if (pj.tab === 'auto' && pj.n % 3 === 0) pjAutoLive();
  const m = $('#pjVu'); if (m) { m.style.width = Math.round(F.level * 100) + '%'; for (const k of ['bass', 'mid', 'treble']) { const b = $('#pjB-' + k); if (b) b.style.width = Math.round(F[k] * 100) + '%'; } const bt = $('#pjBeat'); if (bt) bt.classList.toggle('ok', !!F.beat); }
});
// Show the real capture state, as soon as it changes.
SVC.onState(() => { if (!$('#pjRoot')) return; pjAudioState(); pjStatus(); if (pj.tab === 'audio') { const b = $('#pjListenBtn'); if (b) pjPanel(); } });
const AUDIO_STATE = { inactive: ['', 'Not listening'], requesting: ['warn', 'Waiting for permission to listen…'], connecting: ['warn', 'Connecting to the sound…'], active: ['ok', 'Listening'], interrupted: ['warn', 'Interrupted'], reconnecting: ['warn', 'Reconnecting…'], error: ['bad', 'Not listening (error)'] };
function pjAudioLine() {
  const s = SVC.status(), [, label] = AUDIO_STATE[s.state] || ['', s.state];
  const src = s.source === 'mic' ? 'microphone' : 'system sound';
  if (s.state === 'active') return `Listening to ${src}${pj.feat && pj.feat.bpm && pj.feat.bpmConf > 0.35 ? `, ${Math.round(pj.feat.bpm)} BPM` : ''}`;
  if (s.state === 'interrupted' || s.state === 'reconnecting') return `${label} ${s.detail ? '— ' + s.detail : ''}`;
  if (s.state === 'error') return `${label}: ${s.error}`;
  return label;
}
function pjAudioState() { const el = $('#pjAudioState'); if (!el) return; const s = SVC.status(); el.innerHTML = `<i class="led ${(AUDIO_STATE[s.state] || [''])[0]}"></i><span>${esc(pjAudioLine())}</span>`; el.dataset.state = s.state; }

/* ---------- play / stop ---------- */
async function pjPlay() {
  pj.err = '';
  try {
    pj.lat = await call('latency:get').catch(() => []);
    if (pj.cur.mode === 'auto' && !pjAudioWanted()) { try { await pjAudioStart(); } catch (e) { if (['music', 'immersive'].includes(pj.cur.lights.mode)) throw e; pj.err = e.message; } }
    if (['music', 'immersive'].includes(pj.cur.lights.mode) && !pjAudioWanted()) await pjAudioStart();
    if (pj.cur.lights.mode !== 'off') { if (!pjActiveIds().length) throw new Error('No lights are ticked on the Lights tab.'); await call('proj:lights:start', { smooth: pj.cur.lights.smooth }); }
    pj.running = true;
  } catch (e) { pj.err = e.message; }
  pjEnsureLoop(); pjPush(); pjBar(); pjPanel(); pjStatus();
}
async function pjStop() { pj.running = false; try { await call('proj:lights:stop'); } catch {} pj.lastTargets = {}; pjBar(); pjPanel(); pjStatus(); }
// The light mode changed while playing: start or stop the bulb side to match.
async function pjModeChanged() {
  if (!pj.running) return;
  try { if (pj.cur.lights.mode === 'off') await call('proj:lights:stop'); else { if (['music', 'immersive'].includes(pj.cur.lights.mode) && !pjAudioWanted()) await pjAudioStart(); await call('proj:lights:start', { smooth: pj.cur.lights.smooth }); } }
  catch (e) { pj.err = e.message; }
  pjStatus();
}

/* ---------- page ---------- */
function renderProj(c) {
  if (!pj.list) { c.innerHTML = '<div class="panel"><div class="empty">Loading Projection Studio…</div></div>'; if (!pj.loading) { pj.loading = true; pjInit().then(() => { if (view.t === 'proj') render(); }); } return; }
  if ($('#pjRoot')) { if (pj.tab === 'lights' && !busyDrag) pjPanel(); return; }
  c.innerHTML = `<div id="pjRoot" class="pj"><div class="panel"><div class="pb pj-bar" id="pjBar"></div></div>
    <div class="pj-main"><div class="pj-left"><div class="panel"><div class="pj-stage" id="pjStage"><img id="pjPhoto" alt=""><svg id="pjSvg" viewBox="0 0 1600 900" preserveAspectRatio="none"></svg></div>
      <div class="pb pj-status" id="pjStatus"></div></div></div>
    <div class="panel pj-side"><div class="pj-tabs" id="pjTabs"></div><div class="pb" id="pjPanel"></div></div></div></div>`;
  pjEnsureLoop(); $('#pjStage').insertBefore(pj.canvas, $('#pjSvg'));
  pjWire(); pjPaint(); pjPush();
}
function pjPaint() { pjBar(); pjTabs(); pjPanel(); pjSvg(); pjStatus(); }
function pjBar() {
  const b = $('#pjBar'); if (!b) return;
  b.innerHTML = `<select id="pjLayout" data-tip="Saved room layouts">${pj.list.map((p) => `<option value="${esc(p.id)}" ${p === pj.cur ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}${pj.list.includes(pj.cur) ? '' : `<option selected>${esc(pj.cur.name)} (not saved yet)</option>`}</select>
    <button class="btn" data-a="new">New</button><button class="btn" data-a="starter">Starter setups</button><button class="btn" data-a="rename">Rename</button><button class="btn" data-a="delete" ${pj.cur.id ? '' : 'disabled'}>Delete</button>
    <span class="sp"></span><select id="pjDisplay" data-tip="Where the projection is shown">${pj.displays.map((d) => `<option value="${esc(d.id)}" ${d.id === pj.display ? 'selected' : ''}>${esc(d.label)}</option>`).join('') || '<option value="">No display found</option>'}</select>
    ${pj.out.open ? '<button class="btn" data-a="close">Close projection</button>' : '<button class="btn" data-a="project" data-tip="Full screen on the chosen display. Esc closes it.">Project</button><button class="btn" data-a="window" data-tip="Show the projection in a small window">Preview window</button>'}
    <button class="btn ${pj.cur.blackout ? 'on' : ''}" data-a="blackout" data-tip="Projector goes black; lights keep going">${pj.cur.blackout ? 'Blackout is on' : 'Blackout'}</button>
    <span class="pj-modesel" role="group" aria-label="How the projection is driven">${[['manual', 'Manual', 'Animations run on their own'], ['reactive', 'Music reactive', 'The music performs every animation'], ['auto', 'Autonomous', 'Lumen directs the whole show to the music']].map(([k, n, d]) => `<button class="${pj.cur.mode === k ? 'on' : ''}" data-mode="${k}" data-tip="${d}">${n}</button>`).join('')}</span>
    <button class="btn pri pj-play" data-a="${pj.running ? 'stop' : 'play'}">${pj.running ? '■ Stop' : '▶ Play'}</button>`;
}
function pjTabs() { const t = $('#pjTabs'); if (t) t.innerHTML = [['visuals', 'Visuals'], ['auto', 'Autonomous'], ['mapping', 'Mapping'], ['lights', 'Lights'], ['audio', 'Audio']].map(([k, l]) => `<button class="${k === pj.tab ? 'on' : ''}" data-tab="${k}">${l}</button>`).join(''); }
function pjStatus() {
  const el = $('#pjStatus'); if (!el) return;
  const mode = PJ.LIGHT_MODES.find((m) => m[0] === pj.cur.lights.mode)[1], sent = Object.keys(pj.sent || {}).filter((b) => pj.sent[b]).map((b) => `${BRANDS[b] || b} ${pj.sent[b]}`).join(', ');
  const bits = [`${pj.cur.regions.length} shape${pj.cur.regions.length === 1 ? '' : 's'}`, `Projection ${pj.out.open ? 'showing' : 'not showing'}`, `Lights: ${mode}${pj.running && pj.cur.lights.mode !== 'off' ? ` (running${sent ? ', commands sent: ' + sent : ''})` : ''}`, `Music: ${pjAudioLine()}`, `Mode: ${{ manual: 'Manual', reactive: 'Music reactive', auto: 'Autonomous' }[pj.cur.mode]}`];
  const errs = [pj.err, pj.R && pj.R.error, ...(pj.dropped || []).map((d) => `${d.name} left the sync: ${d.reason}`)].filter(Boolean);
  el.innerHTML = `<span>${bits.map(esc).join('. ')}.</span>${pj.add ? '<span class="pj-hint">Click on the stage to place each corner. Double-click to finish.</span>' : ''}${errs.map((m) => `<div class="note err" style="margin:6px 0 0"><i class="led bad"></i><span>${esc(m)}</span></div>`).join('')}`;
}
const pjSlider = (label, key, min, max, step, val, unit = '') => `<div class="f"><label>${label} <span class="muted" id="pjv-${key}">${esc(val + unit)}</span></label><input type="range" data-k="${key}" data-unit="${unit}" min="${min}" max="${max}" step="${step}" value="${val}"></div>`;
function pjPanel() {
  const el = $('#pjPanel'); if (!el) return; const r = pjSel(), L = pj.cur.lights, A = pj.cur.audio;
  const none = '<div class="note"><span>Click a shape on the stage to work on it, or add one on the Mapping tab.</span></div>';
  if (pj.tab === 'auto') { el.innerHTML = pjAutoPanel(); pjAutoLive(); return; }
  if (pj.tab === 'visuals') {
    el.innerHTML = `<div class="sect">Animation${r ? ' for “' + esc(r.name) + '”' : ''}</div><div class="pj-presets">${PJ.GROUPS.map(([gn, ids]) => `<div class="pj-gh">${gn}</div>` + ids.map((k) => { const n = (PJ.PRESETS.find((q) => q[0] === k) || [k, k])[1]; return `<button class="${r && r.preset === k ? 'on' : ''}" data-preset="${k}" data-tip="${esc(n)}"><img data-th="${k}" src="${pj.thumbs[k] || ''}" alt=""><span>${esc(n)}</span></button>`; }).join('')).join('')}</div>
      <div class="row" style="margin:8px 0"><button class="btn" data-a="rand" ${r ? '' : 'disabled'}>Randomize this shape</button><button class="btn" data-a="randall" ${pj.cur.regions.length ? '' : 'disabled'}>Randomize all</button></div>
      ${r ? `<div class="sect">Look</div>${pjSlider('Speed', 'speed', 0, 4, 0.05, r.speed, '×')}${pjSlider('Colour shift', 'hue', 0, 360, 1, r.hue, '°')}${pjSlider('Brightness', 'bright', 0, 2, 0.05, r.bright, '×')}${pjSlider('Opacity', 'opacity', 0, 1, 0.01, r.opacity)}
        <div class="f"><label>Blending with shapes underneath</label><select data-k="blend"><option value="normal" ${r.blend === 'normal' ? 'selected' : ''}>Normal (covers)</option><option value="add" ${r.blend === 'add' ? 'selected' : ''}>Add (glows)</option><option value="screen" ${r.blend === 'screen' ? 'selected' : ''}>Screen (soft light)</option></select></div>` : none}${pjEvoPanel()}`;
    pjThumbs();
  } else if (pj.tab === 'mapping') {
    const surfaces = [...new Set(pj.cur.regions.map((x) => x.surface))];
    el.innerHTML = `<div class="sect">Add a shape</div><div class="row pj-wrap"><button class="btn" data-add="rect">Rectangle</button><button class="btn" data-add="triangle">Triangle</button><button class="btn" data-add="polygon">Polygon</button><button class="btn ${pj.add ? 'on' : ''}" data-add="free">Freeform</button></div>
      <p class="muted pj-p">Drag a shape to move it and drag its corners to fit the real object. Double-click an edge to add a corner; right-click a corner to remove it.</p>
      <div class="row pj-wrap"><button class="btn" data-a="dup" ${r ? '' : 'disabled'}>Duplicate</button><button class="btn" data-a="del" ${r ? '' : 'disabled'}>Delete</button><button class="btn" data-a="undo" ${pj.undo.length ? '' : 'disabled'}>Undo</button><button class="btn" data-a="reset" ${r ? '' : 'disabled'} data-tip="Back to a plain rectangle of the same size">Reset shape</button></div>
      <div class="row pj-wrap" style="margin-top:5px"><button class="btn" data-a="rotl" ${r ? '' : 'disabled'}>Rotate left</button><button class="btn" data-a="rotr" ${r ? '' : 'disabled'}>Rotate right</button><button class="btn" data-a="smaller" ${r ? '' : 'disabled'}>Smaller</button><button class="btn" data-a="larger" ${r ? '' : 'disabled'}>Larger</button><button class="btn" data-a="up" ${r ? '' : 'disabled'} data-tip="Draw this shape above the next one">Bring forward</button><button class="btn" data-a="down" ${r ? '' : 'disabled'}>Send back</button></div>
      ${r ? `<div class="sect">Selected shape</div><div class="f"><label>Name</label><input type="text" data-k="name" value="${esc(r.name)}" maxlength="40"></div><div class="f"><label>Wall or surface</label><input type="text" data-k="surface" value="${esc(r.surface)}" maxlength="40" list="pjSurf"><datalist id="pjSurf">${surfaces.map((s) => `<option value="${esc(s)}">`).join('')}</datalist></div>` : ''}
      <div class="sect">Shapes (top of the list is drawn first)</div><div class="pj-list">${surfaces.map((s) => `<div class="muted">${esc(s)}</div>` + pj.cur.regions.filter((x) => x.surface === s).map((x) => `<div class="pj-item ${x.id === pj.sel ? 'on' : ''}" data-pick="${x.id}"><input type="checkbox" data-vis="${x.id}" ${x.hidden ? '' : 'checked'} data-tip="Show or hide"><span>${esc(x.name)}</span><small>${esc((PJ.PRESETS.find((p) => p[0] === x.preset) || [])[1] || '')}</small></div>`).join('')).join('') || '<div class="muted">No shapes yet.</div>'}</div>
      <div class="sect">Alignment help</div><label class="pj-chk"><input type="checkbox" data-flag="grid" ${pj.cur.grid ? 'checked' : ''}>Show calibration grid on the projector</label><label class="pj-chk"><input type="checkbox" data-flag="outlines" ${pj.cur.outlines ? 'checked' : ''}>Show shape outlines on the projector</label>
      <div class="row pj-wrap" style="margin-top:6px"><button class="btn" data-a="photo">Room photo…</button><button class="btn" data-a="nophoto" ${pj.cur.photo ? '' : 'disabled'}>Remove photo</button></div>${pj.cur.photo ? pjSlider('Photo visibility', 'photoOpacity', 0, 1, 0.05, pj.cur.photoOpacity) : ''}<input type="file" id="pjFile" accept="image/*" hidden>`;
  } else if (pj.tab === 'lights') {
    const all = pjLights();
    el.innerHTML = `<div class="sect">What the bulbs do</div><div class="pj-modes">${PJ.LIGHT_MODES.map(([k, n, d]) => `<button class="mode ${L.mode === k ? 'on' : ''}" data-lmode="${k}"><b>${n}</b><small>${d}</small></button>`).join('')}</div>
      ${pjSlider('Brightness', 'L.brightness', 5, 100, 1, L.brightness, '%')}${pjSlider('Sensitivity', 'L.sensitivity', 0.3, 3, 0.1, L.sensitivity, '×')}${pjSlider('Smoothness of changes', 'L.smooth', 0, 0.95, 0.05, L.smooth)}
      <div class="row pj-wrap"><button class="btn ${pj.cur.blackout ? 'on' : ''}" data-a="blackout" data-tip="Projector black, bulbs keep following">Lights only</button><button class="btn" data-a="restore" ${pj.running ? '' : 'disabled'} data-tip="Stop and put every bulb back how it was">Restore previous lighting</button></div>
      <div class="sect">Bulbs taking part</div>${all.length ? `<div class="pj-list">${all.map((d) => `<div class="pj-item"><input type="checkbox" data-inc="${esc(d.id)}" ${L.exclude.includes(d.id) ? '' : 'checked'}><span>${esc(d.name)}</span><small>${BRANDS[d.brand]}${d.caps.color ? '' : ', white only'}</small>
        ${L.mode === 'custom' ? `<select data-cust="${esc(d.id)}">${[['match', 'Match'], ['ambient', 'Ambient'], ['music', 'Music'], ['immersive', 'Immersive'], ['off', 'Leave alone']].map(([k, n]) => `<option value="${k}" ${(L.custom[d.id] || 'match') === k ? 'selected' : ''}>${n}</option>`).join('')}</select>` : ''}
        ${r ? `<label class="pj-link" data-tip="This bulb takes the colour inside “${esc(r.name)}” instead of the whole picture"><input type="checkbox" data-link="${esc(d.id)}" ${r.lights.includes(d.id) ? 'checked' : ''}>follows shape</label>` : ''}</div>`).join('')}</div>
        <p class="muted pj-p">WiZ follows about 11 times a second. Cync and Hubspace go through their clouds, so they follow more slowly and smoothly. White-only bulbs follow with brightness and warmth, not colour.</p>` : '<div class="note"><span>No lights are available. Find or connect lights first.</span></div>'}`;
  } else {
    el.innerHTML = `<div class="sect">Music response</div><div class="f"><label>Listen to</label><select data-k="A.source"><option value="system" ${A.source === 'system' ? 'selected' : ''}>${pj.platform === 'darwin' ? 'System sound (microphone fallback)' : 'What this PC is playing'}</option><option value="mic" ${A.source === 'mic' ? 'selected' : ''}>Microphone</option></select></div>
      <div class="row pj-wrap">${[['subtle', 'Subtle'], ['balanced', 'Balanced'], ['intense', 'Intense']].map(([k, n]) => `<button class="btn ${A.style === k ? 'on' : ''}" data-style="${k}">${n}</button>`).join('')}</div>
      ${pjSlider('Sensitivity', 'A.sensitivity', 0.3, 3, 0.1, A.sensitivity, '×')}
      <div class="row"><button class="btn pri" id="pjListenBtn" data-a="${SVC.wanted ? 'unlisten' : 'listen'}">${SVC.wanted ? 'Stop listening' : SVC.state === 'error' ? 'Try again' : 'Start listening'}</button><i class="led" id="pjBeat" data-tip="Beat"></i></div><div class="pj-astate" id="pjAudioState"></div>
      <div class="pj-meters"><span>Level</span><div class="vu"><i id="pjVu" style="width:0"></i></div><span>Bass</span><div class="vu"><i id="pjB-bass" style="width:0"></i></div><span>Mids</span><div class="vu"><i id="pjB-mid" style="width:0"></i></div><span>Treble</span><div class="vu"><i id="pjB-treble" style="width:0"></i></div></div>
      <p class="muted pj-p">${pj.platform === 'darwin' ? 'macOS does not provide system sound capture here; choosing System sound switches to the microphone if no system track is available.' : 'Listening carries on while you change animations, settings, tabs or pages; it stops only when you press Stop listening.'} If the sound source drops out (for example the audio device changes), Lumen reconnects by itself. Sound is only measured, never recorded or sent anywhere. To make the bulbs follow the music too, choose Music Sync or Immersive on the Lights tab.</p>
      ${r ? `<div class="sect">How “${esc(r.name)}” reacts</div>${pjSlider('Amount', 'react', 0, 1, 0.05, r.react)}<div class="f"><label>Reacts to</label><select data-k="band">${[['bass', 'Bass'], ['mid', 'Mids'], ['treble', 'Treble'], ['level', 'Overall level']].map(([k, n]) => `<option value="${k}" ${r.band === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>` : none}`;
    pjAudioState();
  }
}
// Small still pictures of every animation, drawn once with a second tiny renderer.
function pjThumbs() {
  if (pj.thumbBusy || PJ.PRESET_IDS.every((k) => pj.thumbs[k])) return;
  pj.thumbBusy = true;
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 72; const R = new ProjRenderer(cv), todo = PJ.PRESET_IDS.filter((k) => !pj.thumbs[k]);
  const next = () => {
    const k = todo.shift(); if (!k || R.error) { pj.thumbBusy = false; return; }
    const one = PJ.project({ regions: [{ id: 't', preset: k, pts: PJ.shape('rect', 0.5, 0.5, 1, 1) }] }); R.clock = {}; R.lastT = 0;
    R.render(one, 0, null); R.render(one, 0.1, null); R.clock.t = 7.3; R.render(one, 0.1, null);
    try { pj.thumbs[k] = cv.toDataURL('image/jpeg', 0.75); } catch { pj.thumbs[k] = ''; }
    const img = $(`[data-th="${k}"]`); if (img) img.src = pj.thumbs[k];
    setTimeout(next, 15);
  };
  next();
}

/* ---------- stage: shapes drawn over the preview ---------- */
function pjSvg() {
  const svg = $('#pjSvg'); if (!svg) return; const W = 1600, H = 900, map = pj.tab === 'mapping';
  const ph = $('#pjPhoto'); if (ph) { ph.style.display = pj.cur.photo ? '' : 'none'; if (pj.cur.photo && ph.getAttribute('src') !== pj.cur.photo) ph.src = pj.cur.photo; ph.style.opacity = pj.cur.photoOpacity; }
  if (pj.canvas) pj.canvas.style.opacity = pj.cur.photo && map ? 0.75 : 1;
  const P = (pts) => pts.map(([x, y]) => `${(x * W).toFixed(1)},${(y * H).toFixed(1)}`).join(' ');
  let h = map && pj.cur.grid ? `<g class="pj-grid">${Array.from({ length: 15 }, (_, i) => `<line x1="${((i + 1) * W) / 16}" y1="0" x2="${((i + 1) * W) / 16}" y2="${H}"/>`).join('')}${Array.from({ length: 8 }, (_, i) => `<line x1="0" y1="${((i + 1) * H) / 9}" x2="${W}" y2="${((i + 1) * H) / 9}"/>`).join('')}</g>` : '';
  for (const r of pj.cur.regions) { if (r.hidden) continue; const [cx, cy] = PJ.centre(r.pts);
    h += `<polygon class="pj-shape ${r.id === pj.sel ? 'on' : ''}" data-r="${r.id}" points="${P(r.pts)}"/><text class="pj-label" x="${cx * W}" y="${cy * H}">${esc(r.name)}</text>`; }
  const r = pjSel();
  if (r && map && !r.hidden) h += r.pts.map(([x, y], i) => `<circle class="pj-handle" data-v="${i}" cx="${x * W}" cy="${y * H}" r="13"/>`).join('');
  if (pj.add) h += `<polyline class="pj-draft" points="${P(pj.add)}"/>` + pj.add.map(([x, y]) => `<circle class="pj-handle" cx="${x * W}" cy="${y * H}" r="9"/>`).join('');
  svg.innerHTML = h; svg.classList.toggle('adding', !!pj.add);
}
function pjWire() {
  const root = $('#pjRoot'), svg = $('#pjSvg');
  const at = (e) => { const b = svg.getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)), Math.max(0, Math.min(1, (e.clientY - b.top) / b.height))]; };
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (pj.add) { pj.add.push(at(e)); pjSvg(); return; }
    const v = e.target.closest('[data-v]'), sh = e.target.closest('[data-r]');
    if (v && pjSel()) { pjSnap(); pj.drag = { v: +v.dataset.v }; }
    else if (sh) { const was = pj.sel; pj.sel = sh.dataset.r; if (pj.tab === 'mapping') { pjSnap(); pj.drag = { from: at(e), pts: pjSel().pts.map((p) => p.slice()), moved: false }; } if (was !== pj.sel) pjPanel(); pjSvg(); }
    else if (pj.sel) { pj.sel = null; pjPanel(); pjSvg(); }
    if (pj.drag) { busyDrag = true; svg.setPointerCapture(e.pointerId); }
  });
  svg.addEventListener('pointermove', (e) => {
    const d = pj.drag, r = pjSel(); if (!d || !r) return; const p = at(e);
    if (d.v !== undefined) r.pts[d.v] = p; else { r.pts = PJ.moved(d.pts, p[0] - d.from[0], p[1] - d.from[1]); d.moved = true; }
    pjSvg(); pjPush();
  });
  const end = () => { if (!pj.drag) return; if (pj.drag.v === undefined && !pj.drag.moved) pj.undo.pop(); pj.drag = null; pjChanged(true); };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  svg.addEventListener('dblclick', (e) => {
    if (pj.add) { const pts = pj.add.slice(0, -1); pj.add = null; // the second click of the double-click added a duplicate corner
      if (pts.length >= 3) { pjSnap(); const r = PJ.region({ name: 'Freeform ' + (pj.cur.regions.length + 1), pts, preset: 'plasma' }); pj.cur.regions.push(r); pj.sel = r.id; }
      return pjChanged(true); }
    const r = pjSel(); if (!r || pj.tab !== 'mapping' || !e.target.closest('[data-r]')) return;
    const p = at(e); let best = 0, bd = 1e9; // insert the new corner on the nearest edge
    r.pts.forEach((a, i) => { const b = r.pts[(i + 1) % r.pts.length], dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1))), d = Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); if (d < bd) { bd = d; best = i; } });
    pjSnap(); r.pts.splice(best + 1, 0, p); pjChanged(true);
  });
  svg.addEventListener('contextmenu', (e) => { const v = e.target.closest('[data-v]'), r = pjSel(); if (!v || !r) return; e.preventDefault(); e.stopPropagation(); if (r.pts.length > 3) { pjSnap(); r.pts.splice(+v.dataset.v, 1); pjChanged(true); } });

  root.addEventListener('click', async (e) => {
    const t = e.target, r = pjSel();
    const tab = t.closest('[data-tab]'); if (tab) { pj.tab = tab.dataset.tab; pjTabs(); pjPanel(); pjSvg(); return; }
    const md = t.closest('[data-mode]'); if (md) return pjSetMode(md.dataset.mode);
    const pers = t.closest('[data-pers]'); if (pers) { pj.cur.auto.personality = pers.dataset.pers; pjDirector(); return pjChanged(true); }
    const al = t.closest('[data-pjalign]'); if (al) return pjCalibAnswer(+al.dataset.pjalign);
    const pre = t.closest('[data-preset]');
    if (pre && pj.cur.mode === 'auto' && !t.closest('.pj-excl')) { if (!pj.dir) pjDirector(); pj.dir.override(pre.dataset.preset); pj.tab = 'auto'; pjTabs(); pjPanel(); return; } // manual override: hold this animation
    if (pre && r && r.preset !== pre.dataset.preset) { const id = pre.dataset.preset; pjSnap(); for (const b of document.querySelectorAll('.pj-presets [data-preset]')) b.classList.toggle('on', b.dataset.preset === id); return pjOnBeat(() => { r.preset = id; pjChanged(true); }); }
    if (pre) { pjSnap(); if (r) r.preset = pre.dataset.preset; else { const n = PJ.region({ name: 'Wall', preset: pre.dataset.preset, pts: PJ.shape('rect', 0.5, 0.5, 0.9, 0.86) }); pj.cur.regions.push(n); pj.sel = n.id; } return pjChanged(true); }
    const add = t.closest('[data-add]');
    if (add) { if (add.dataset.add === 'free') { pj.add = pj.add ? null : []; pjPanel(); pjSvg(); pjStatus(); return; }
      pjSnap(); const k = pj.cur.regions.length, n = PJ.region({ name: { rect: 'Rectangle', triangle: 'Triangle', polygon: 'Polygon' }[add.dataset.add] + ' ' + (k + 1), pts: PJ.shape(add.dataset.add, 0.3 + (k % 5) * 0.1, 0.35 + (k % 3) * 0.12, 0.22, 0.3), preset: PJ.PRESET_IDS[(k * 5 + 5) % PJ.PRESET_IDS.length], surface: r ? r.surface : 'Main wall' });
      pj.cur.regions.push(n); pj.sel = n.id; return pjChanged(true); }
    const pick = t.closest('[data-pick]'); if (pick && !t.matches('input')) { pj.sel = pick.dataset.pick; pjPanel(); pjSvg(); return; }
    const lm = t.closest('[data-lmode]'); if (lm) { pj.cur.lights.mode = lm.dataset.lmode; pjChanged(true); return pjModeChanged(); }
    const sty = t.closest('[data-style]'); if (sty) { pj.cur.audio.style = sty.dataset.style; return pjChanged(true); }
    const a = t.closest('[data-a]'); if (!a) return; if (a.tagName === 'A') e.preventDefault(); const act = a.dataset.a, i = r ? pj.cur.regions.indexOf(r) : -1;
    const rnd = (x) => { x.preset = PJ.PRESET_IDS[Math.floor(Math.random() * PJ.PRESET_IDS.length)]; x.hue = Math.round(Math.random() * 360); x.speed = +(0.5 + Math.random() * 1.2).toFixed(2); };
    if (act === 'play') return pjPlay();
    if (act === 'resume') { if (pj.dir) pj.dir.override(null); return pjPanel(); }
    if (act === 'hold') { const m = pjMainRegion(); if (!pj.dir) pjDirector(); if (m) pj.dir.override(pjView().regions.find((x) => x.id === m.id).preset); return pjPanel(); }
    if (act === 'adv') { pj.adv = !pj.adv; return pjPanel(); }
    if (act === 'evoadv') { pj.evoAdv = !pj.evoAdv; return pjPanel(); }
    if (act === 'calib') return pj.calib ? pjCalibStop() : pjCalibStart();
    if (act === 'stop' || act === 'restore') return pjStop();
    if (act === 'blackout') { pj.cur.blackout = !pj.cur.blackout; pjBar(); return pjChanged(true); }
    if (act === 'listen') { pj.err = ''; try { await pjAudioStart(); } catch (x) { pj.err = x.message; } pjPanel(); return pjStatus(); }
    if (act === 'unlisten') { pjAudioStop(); pjPanel(); return pjStatus(); }
    if (act === 'project' || act === 'window') {
      const d = pj.displays.find((x) => x.id === pj.display);
      if (act === 'project' && d && d.primary && !await confirmBox('Project on this screen?', 'The projection will cover this screen, including Lumen. Press Esc to close it.', 'Project')) return;
      pj.out = await call('proj:open', { displayId: pj.display, windowed: act === 'window' }); pjPush(); setTimeout(pjPush, 600); pjBar(); return pjStatus(); }
    if (act === 'close') { pj.out = await call('proj:close'); pjBar(); return pjStatus(); }
    if (act === 'new') { const n = await ask('New room layout', 'New room'); if (n) pjOpen(PJ.project({ name: n })); pjSave(); return; }
    if (act === 'rename') { const n = await ask('Rename layout', pj.cur.name); if (n) { pj.cur.name = n; pjBar(); pjSave(); } return; }
    if (act === 'delete') { if (!await confirmBox('Delete layout', `Delete “${pj.cur.name}” and all its shapes?`, 'Delete')) return; await call('proj:delete', pj.cur.id); pj.list = pj.list.filter((p) => p !== pj.cur); return pjOpen(pj.list[0] || PJ.project({ name: 'My room' })); }
    if (act === 'starter') { const b = a.getBoundingClientRect(); return popup(PJ.STARTERS.map((s) => ({ label: s.name, run: () => { pjOpen(PJ.project({ name: s.name, regions: s.regions.map((x) => ({ ...x, id: PJ.uid() })) })); pjSave(); } })), b.left, b.bottom, a); }
    if (act === 'undo') return pjUndo();
    if (act === 'randall') { pjSnap(); pj.cur.regions.forEach(rnd); return pjChanged(true); }
    if (act === 'photo') return $('#pjFile').click();
    if (act === 'nophoto') { pj.cur.photo = ''; return pjChanged(true); }
    if (!r) return;
    pjSnap();
    if (act === 'rand') rnd(r);
    else if (act === 'dup') { const n = PJ.region({ ...JSON.parse(JSON.stringify(r)), id: '', name: r.name + ' copy', pts: PJ.moved(r.pts, 0.04, 0.04) }); pj.cur.regions.splice(i + 1, 0, n); pj.sel = n.id; }
    else if (act === 'del') { pj.cur.regions.splice(i, 1); pj.sel = null; }
    else if (act === 'reset') { const [cx, cy] = PJ.centre(r.pts), b = PJ.bbox(r.pts); r.pts = PJ.shape('rect', cx, cy, b[2] - b[0], b[3] - b[1]); }
    else if (act === 'rotl' || act === 'rotr') r.pts = PJ.rotated(r.pts, act === 'rotl' ? -5 : 5);
    else if (act === 'smaller' || act === 'larger') r.pts = PJ.scaled(r.pts, act === 'smaller' ? 1 / 1.08 : 1.08);
    else if (act === 'up' && i < pj.cur.regions.length - 1) pj.cur.regions.splice(i + 1, 0, pj.cur.regions.splice(i, 1)[0]);
    else if (act === 'down' && i > 0) pj.cur.regions.splice(i - 1, 0, pj.cur.regions.splice(i, 1)[0]);
    else pj.undo.pop();
    pjChanged(true);
  });
  // sliders, selects, text boxes and tick boxes
  const set = (el) => {
    const k = el.dataset.k, r = pjSel(), v = el.type === 'range' ? +el.value : el.value; if (!k) return;
    if (k.startsWith('L.')) pj.cur.lights[k.slice(2)] = v; else if (k.startsWith('A.')) pj.cur.audio[k.slice(2)] = v; else if (k === 'photoOpacity') pj.cur.photoOpacity = v; else if (r) r[k] = v;
    const lab = $('#pjv-' + CSS.escape(k)); if (lab) lab.textContent = v + (el.dataset.unit || '');
    if (k === 'L.smooth' && pj.running && pj.cur.lights.mode !== 'off') call('proj:lights:start', { smooth: v }).catch(() => {});
    if (k === 'A.source' && SVC.wanted) pjAudioStart().catch((x) => { pj.err = x.message; pjStatus(); }); // the user chose another source: swap the stream, keep the engine
    pjChanged(el.tagName === 'SELECT');
  };
  root.addEventListener('input', (e) => { if (e.target.matches('input[type=range][data-evo]')) return pjEvoSet(e.target); if (e.target.matches('input[type=range][data-k]')) set(e.target); else if (e.target.matches('input[type=range][data-auto]')) { const k = e.target.dataset.auto; pj.cur.auto[k] = +e.target.value; const lab = $('#pjav-' + k) || $('#pjev-' + k); if (lab) lab.textContent = pjPct(+e.target.value, k); pjDirector(); pjSave(); } });
  root.addEventListener('change', (e) => {
    const t = e.target, L = pj.cur.lights, r = pjSel();
    if (t.id === 'pjLayout') { const p = pj.list.find((x) => x.id === t.value); if (p) pjOpen(p); return; }
    if (t.id === 'pjDisplay') { pj.display = t.value; return; }
    if (t.id === 'pjFile') { const f = t.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { const img = new Image(); img.onload = () => { const c = document.createElement('canvas'), k = Math.min(1, 960 / img.width); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); pj.cur.photo = c.toDataURL('image/jpeg', 0.7); pjChanged(true); }; img.src = rd.result; }; rd.readAsDataURL(f); return; }
    if (t.dataset.vis) { const x = pj.cur.regions.find((q) => q.id === t.dataset.vis); if (x) { x.hidden = !t.checked; pjChanged(); } return; }
    if (t.dataset.flag) { pj.cur[t.dataset.flag] = t.checked; return pjChanged(); }
    if (t.dataset.inc) { L.exclude = L.exclude.filter((x) => x !== t.dataset.inc); if (!t.checked) L.exclude.push(t.dataset.inc); return pjChanged(); }
    if (t.dataset.cust) { L.custom[t.dataset.cust] = t.value; return pjChanged(); }
    if (t.dataset.link && r) { r.lights = r.lights.filter((x) => x !== t.dataset.link); if (t.checked) r.lights.push(t.dataset.link); return pjChanged(); }
    if (t.dataset.evo) return pjEvoSet(t);
    if (t.dataset.auto) { const k = t.dataset.auto, A2 = pj.cur.auto; A2[k] = t.type === 'checkbox' ? t.checked : t.type === 'range' ? +t.value : t.value; pjDirector(); return pjChanged(t.type !== 'range'); }
    if (t.dataset.excl) { const A2 = pj.cur.auto; A2.exclude = A2.exclude.filter((x) => x !== t.dataset.excl); if (!t.checked) A2.exclude.push(t.dataset.excl); pjDirector(); return pjChanged(); }
    if (t.dataset.disp !== undefined) { pj.cur.sync.displayMs = Math.max(0, Math.min(500, +t.value || 0)); pjSchedOut(); return pjChanged(); }
    if (t.matches('select[data-k],input[type=text][data-k]')) { if (t.type === 'text' && pjSel()) pjSnap(); set(t); if (t.type === 'text') pjPanel(); }
  });
}


/* ================= 1.7: music features for the renderer, autonomous director, shared timing ================= */
const pjPct = (v, k) => (k === 'react' ? Math.round(v * 100) + '%' : Math.round(v * 100) + '%');
// The renderer runs at ~30 fps and the analyser at 50 fps: beats and drops are latched so none is missed, and with
// a confident tempo the beat is taken from the predicted beat grid, shown early by the projector's own delay.
function pjShowBeat(now) {
  const A = pj.cur.auto, e = pj.eng;
  if (A.beatSync && e && e.F.bpmConf > 0.35) {
    const T = e.predict(now, 'beat'); if (T == null) return false;
    if (now >= T - pj.cur.sync.displayMs && Math.abs(T - pj.shownBeat) > 60) { pj.shownBeat = T; pj.renderBeat = true; return true; }
    return false;
  }
  if (pj.beatLatch) { pj.renderBeat = true; return true; }
  return false;
}
function pjRenderFeatures(now) {
  if (pj.cur.mode === 'manual') return null;
  const F = pj.cap && pj.feat ? pj.feat : null; if (!F) return null;
  if (!pj.rf) pj.rf = {};
  const rf = pj.rf; for (const k in F) rf[k] = F[k];
  rf.beat = !!pj.renderBeat; rf.drop = pj.dropLatch; pj.renderBeat = false; pj.beatLatch = false; pj.dropLatch = false;
  void now; return rf;
}
const PJ_OUT = ['sub', 'bass', 'lowMid', 'mid', 'highMid', 'treble', 'rms', 'level', 'centroid', 'flux', 'impulse', 'energy', 'trend', 'build', 'dyn', 'beatPhase', 'barPos', 'bpm', 'beatStrength', 'section', 'silent'];
function pjFrameOut(F, beat) { const o = { beat, drop: !!F.drop }; for (const k of PJ_OUT) o[k] = F[k]; return o; }

/* ----- timing: one scheduler for what the projector shows; bulbs are cued in the main process with their own latency ----- */
function pjSchedOut() { if (!pj.sched) pj.sched = PJS.createScheduler({ now: () => performance.now() }); pj.sched.output('display', { latency: pj.cur.sync.displayMs, interval: 0, maxLate: 400, kind: 'display' }); }
// how far ahead a change must be decided so the slowest output taking part can still show it on time
function pjLead() {
  let lead = pj.cur.sync.displayMs;
  if (pj.running && pj.cur.auto.lightSync && pj.cur.lights.mode !== 'off') for (const l of pj.lat) if (l.enabled !== false && l.online && pjActiveIds().includes(l.id)) lead = Math.max(lead, (l.ms != null ? l.ms : l.def || 0) + (l.offset || 0));
  return Math.min(2600, lead + 120);
}
const pjSpeedOf = (id) => { const l = pj.lat.find((q) => q.id === id); return l ? l.speed : ({ wiz: 'fast', cync: 'medium', hubspace: 'slow' }[(S.devices.find((d) => d.id === id) || {}).brand] || 'medium'); };
// Beat-synced bulb hits: fast bulbs on predicted beats, medium bulbs on bar downbeats; slow bulbs only take part in
// scene changes and drops (pjSceneCue), so they never hold back the others.
function pjBeatCues(F, now) {
  const A = pj.cur.auto, P = PJD.PERSONALITIES[A.personality];
  if (!pj.running || pj.cur.mode === 'manual' || !A.lightSync || !A.beatSync || pj.cur.lights.mode === 'off' || !P.light.beat || !(F.bpmConf > 0.35) || F.silent) return;
  const T = pj.eng.predict(now + 260, 'beat'); if (T == null || Math.abs(T - pj.cuedBeat) < 60 || T - now > 700) return;
  pj.cuedBeat = T; const bar = pj.eng.predict(T - 5, 'bar'), down = bar != null && Math.abs(bar - T) < 40, list = [];
  for (const id of pjActiveIds()) {
    const sp = pjSpeedOf(id); if (sp === 'slow' || (sp === 'medium' && !down)) continue;
    const base = (pj.lastTargets[id] || {}).rgb || pj.dom || [255, 255, 255];
    list.push({ id, in: T - now, rgb: base.map((c) => Math.min(255, c * 0.5 + 128)), bri: down ? 100 : 85, hold: sp === 'fast' ? 130 : 400 });
  }
  if (list.length) window.lumen.send('proj:cue', list);
}
// dominant colour of an animation (from its thumbnail), shifted by the director's colour change
function pjThumbColour(k) {
  if (pj.thumbCol[k] !== undefined) return pj.thumbCol[k];
  const src = pj.thumbs[k]; if (!src) return null;
  const img = new Image(); img.onload = () => { const c = document.createElement('canvas'); c.width = 32; c.height = 18; const g = c.getContext('2d'); g.drawImage(img, 0, 0, 32, 18); pj.thumbCol[k] = LumenAudio.screenColor(g.getImageData(0, 0, 32, 18).data); }; img.src = src;
  pj.thumbCol[k] = null; return null;
}
// Scene change / drop on the bulbs, built with the Lightshow effects engine for the real bulbs, compiled without
// latency (times = when each change should be SEEN) and sent as cues; main sends each bulb early by its own latency.
function pjSceneCue(fx, dec, now) {
  if (!pj.running || pj.cur.lights.mode === 'off' || !window.LumenFx) return 0;
  const ids = pjActiveIds(); if (!ids.length) return 0;
  const devInfo = {}; for (const id of ids) { const d = S.devices.find((x) => x.id === id); if (!d) continue; const l = pj.lat.find((q) => q.id === id) || {}; devInfo[id] = { brand: d.brand, name: d.name, online: true, caps: d.caps, profile: { ms: 0, offset: 0, interval: l.interval, rel: l.rel } }; }
  const col = pjThumbColour(dec.preset) || pj.dom || [120, 80, 255], hsv = LumenShow.hsv(col), A2 = LumenShow.rgbOf([hsv[0] + dec.hue, Math.max(0.6, hsv[1]), 1]), B2 = LumenShow.rgbOf([hsv[0] + dec.hue + 160, 0.9, 1]);
  const bpm = pj.feat && pj.feat.bpm > 40 ? pj.feat.bpm : 120, beats = []; for (let i = 0; i < 40; i++) beats.push(i * 60 / bpm);
  const an = { duration: 20, bpm, beats, downPhase: 0, kicks: [], snares: [], hats: [], sections: [], drops: [], builds: [] };
  const lanes = [{ id: 'c', name: 'c', deviceIds: Object.keys(devInfo) }], len = fx === 'wash' ? Math.max(1.5, dec.fade) : fx === 'explosion' ? 3 : 1.2;
  const p = fx === 'wash' ? { step: 2, fade: 0.9, flow: 0.4, colors: [A2, B2] } : fx === 'snap' ? { on: 'beat', step: 1, split: true, colors: [A2, B2] } : fx === 'flash' ? { on: 'step', step: 1, reps: 1, decay: 0.8, colors: [A2] } : { decay: 2, white: 0.7, split: true, colors: [A2, B2] };
  const show = { lanes, events: [{ id: 'b', t: 0, dur: 20, lane: 'c', type: 'color', rgb: A2, bri: 70, fade: 0 }], clips: [{ id: 'pjc', fx, t: 0, dur: len, lane: '*', p: { ...p, bri: Math.round(100 * dec.bright) } }] };
  const ev = LumenFx.materialize(show, an, devInfo).events, cmds = LumenShow.compile({ lanes, events: ev }, devInfo, Object.fromEntries(Object.entries(devInfo).map(([k, v]) => [k, v.profile]))).cmds.filter((c) => c.t <= len + 0.6 && !c.catchup);
  const list = cmds.map((c, i) => { const nx = cmds.slice(i + 1).find((q) => q.id === c.id); return { id: c.id, in: dec.at - now + c.t * 1000, rgb: c.off ? [0, 0, 0] : c.rgb, bri: c.off ? 1 : c.bri, hold: nx ? (nx.t - c.t) * 1000 : 600 }; });
  if (list.length) window.lumen.send('proj:cue', list);
  return list.length;
}

/* ----- Autonomous: the director decides, the scheduler makes it happen on time ----- */
function pjDirector(reset) {
  const A = pj.cur.auto;
  if (!pj.dir || reset) pj.dir = PJD.createDirector({ personality: A.personality, settings: A, seed: (Date.now() & 0xffff) + 1 });
  else pj.dir.set({ personality: A.personality, settings: A });
  pjSchedOut();
}
const pjArea = (r) => { const b = PJ.bbox(r.pts); return (b[2] - b[0]) * (b[3] - b[1]); };
const pjMainRegion = () => pj.cur.regions.filter((r) => !r.hidden).sort((a, b) => pjArea(b) - pjArea(a))[0] || null;
function pjAutoTick(now) {
  if (!pj.dir) pjDirector();
  if (pj.n % 3) return; // decide ten times a second; drawing never waits for it
  let F = pj.cap && pj.feat ? pj.feat : null;
  if (!F) { // not listening: still direct, on time alone, at a medium energy
    if (!pj.fakeF) pj.fakeF = { energy: 0.45, section: 'groove', silent: false, bpm: 0, bpmConf: 0, drop: false, beat: false, trend: 0, build: 0 };
    F = pj.fakeF;
  }
  const d = pj.dir.update(F, now, { predict: pj.eng ? pj.eng.predict : null, lead: pjLead(), evolveReady: pjEvolveNudge() });
  if (!d) return;
  pj.next = d;
  pj.sched.clear(); // a new decision replaces one that was not shown yet (a drop outranks a planned change)
  pj.sched.at('display', d.at, d, { priority: 2 }); // the projector switches early by its own delay
  if (pj.cur.auto.lightSync && d.light) pjSceneCue(d.light.fx, d, now);
}
// a scheduled scene change becomes visible: the main shape takes the new animation, the others complementary ones
function pjApply(out, d) {
  if (d && d.manual) { d.manual(); return true; } // a manual change waiting for the beat
  if (out !== 'display' || pj.cur.mode !== 'auto') return true;
  const main = pjMainRegion(); let k = 0;
  for (const r of pj.cur.regions) {
    if (r.hidden) continue;
    const preset = main && r.id === main.id ? d.preset : d.others[k++ % Math.max(1, d.others.length)] || d.preset;
    pj.ov[r.id] = { preset, hue: Math.round((r.hue + d.hue) % 360), speed: +(r.speed * d.speed).toFixed(3), react: Math.min(1, +(r.react * d.react).toFixed(3)), bright: +(r.bright * d.bright).toFixed(3), fade: d.fade, xf: pjXf() };
  }
  pj.last = d; pj.next = null; pjLive(); pjPushNow();
  if (pj.tab === 'auto') pjAutoLive();
  return true;
}
async function pjSetMode(m) {
  if (!PJ.MODES.includes(m) || m === pj.cur.mode) return;
  pj.cur.mode = m; pj.err = '';
  if (m === 'auto') { pjDirector(true); pj.ov = {}; } else { pj.ov = {}; pj.next = null; if (pj.sched) pj.sched.clear(); }
  // switching never stops the music: Autonomous starts listening if needed, and listening simply carries on between modes
  if (m === 'auto' && !pjAudioWanted()) { try { await pjAudioStart(); } catch (e) { pj.err = e.message; } }
  pjLive(); pjPushNow(); pjBar(); pjChanged(true);
}

const PERS_D = { ambient: 'Slow, soft and organic. Barely any flashing.', psychedelic: 'Fluid, morphing, unusual colours, always evolving.', electronic: 'Geometry, pulses and lasers locked to the beat.', cinematic: 'Long atmospheric scenes and big gradual changes.', party: 'High energy, quick changes, strong contrasts, drops hit hard.' };
function pjAutoPanel() {
  const A = pj.cur.auto, on = pj.cur.mode === 'auto', sl = (k, label, tip) => `<div class="f"><label data-tip="${tip}">${label} <span class="muted" id="pjav-${k}">${pjPct(A[k], k)}</span></label><input type="range" data-auto="${k}" min="0" max="${k === 'react' ? 2 : 1}" step="0.05" value="${A[k]}"></div>`;
  const names = Object.fromEntries(PJ.PRESETS);
  return `${on ? '' : `<div class="note"><span>Autonomous mode lets Lumen direct the projection to the music: it picks animations, colours and intensity, and changes scene on the beat. Your saved shapes are not changed.</span></div><div class="row" style="margin:6px 0 10px"><button class="btn pri" data-mode="auto">Turn on Autonomous</button></div>`}
    <div class="pj-live" id="pjLive"></div>
    <div class="sect">Personality</div><div class="pj-pers">${Object.entries(PJD.PERSONALITIES).map(([k, P]) => `<button class="${A.personality === k ? 'on' : ''}" data-pers="${k}"><b>${P.name}</b><small>${PERS_D[k]}</small></button>`).join('')}</div>
    ${sl('intensity', 'Intensity', 'How bright and energetic the visuals get')}${sl('change', 'Scene changes', 'How often the animation changes')}${sl('variety', 'Variety', 'How widely it ranges over different animations')}${sl('react', 'Music reactivity', 'How strongly the music moves the animations')}
    <div class="f"><label>Colour</label><select data-auto="colour">${[['auto', 'Personality decides'], ['follow', 'Keep each animation’s colours'], ['drift', 'Slow colour drift'], ['palette', 'Jump between palettes'], ['contrast', 'Strong contrasts']].map(([k, n]) => `<option value="${k}" ${A.colour === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <label class="pj-chk"><input type="checkbox" data-auto="beatSync" ${A.beatSync ? 'checked' : ''}>Change scenes on the beat (bars and phrases)</label>
    <label class="pj-chk"><input type="checkbox" data-auto="lightSync" ${A.lightSync ? 'checked' : ''}>Bulbs join scene changes, drops and beats</label>
    <div class="row pj-wrap" style="margin-top:6px">${pj.dir && pj.dir.state().override ? `<button class="btn" data-a="resume">Resume the director</button><span class="muted">Holding ${esc(names[pj.dir.state().override] || '')}</span>` : `<button class="btn" data-a="hold" ${on ? '' : 'disabled'} data-tip="Keep the current animation until you resume. Or click any animation on the Visuals tab.">Hold this animation</button>`}</div>
    <a href="#" class="small" data-a="adv">${pj.adv ? 'Hide' : 'Show'} advanced: excluded animations, projector delay, sync details</a>
    ${pj.adv ? `<div class="sect">Never use these animations</div><div class="pj-excl">${PJ.PRESETS.map(([k, n]) => `<label class="pj-chk small"><input type="checkbox" data-excl="${k}" ${A.exclude.includes(k) ? '' : 'checked'}>${esc(n)}</label>`).join('')}</div>
      <div class="sect">Projector delay</div><div class="row"><input type="number" data-disp min="0" max="500" step="5" value="${pj.cur.sync.displayMs}" style="width:70px"><span class="muted">ms</span><button class="btn" data-a="calib" ${pj.out.open ? '' : 'disabled'} data-tip="Open the projection first">${pj.calib ? 'Stop lining up' : 'Line up the projector…'}</button></div>
      ${pj.calib ? `<div class="pj-cal"><div class="small">The projector flashes white once a second with a click. Does the flash come before the click, with it, or after it?</div><div class="ls-alignbtns"><button class="btn" data-pjalign="-1">◀ Early</button><button class="btn pri" data-pjalign="0">✔ Together</button><button class="btn" data-pjalign="1">Late ▶</button></div></div>` : '<p class="muted pj-p">Most projectors and TVs show a picture 20–100 ms after they receive it. Lumen sends each change early by this much.</p>'}
      <div class="sect">Sync details</div><div class="pj-sync small" id="pjSync"></div>` : ''}`;
}
function pjAutoLive() {
  const el = $('#pjLive'); if (!el) return;
  const F = pj.feat, st = pj.dir ? pj.dir.state() : null, names = Object.fromEntries(PJ.PRESETS), main = pjMainRegion();
  const cur = main ? pjView().regions.find((r) => r.id === main.id).preset : null, now = performance.now();
  const sec = F ? ({ silence: 'Silence', quiet: 'Quiet', groove: 'Groove', build: 'Build-up', drop: 'Drop', peak: 'Peak', break: 'Breakdown' }[F.section] || F.section) : 'Not listening';
  const nx = pj.next ? `${names[pj.next.preset]} in ${Math.max(0, (pj.next.at - now) / 1000).toFixed(1)} s (${{ start: 'starting', drop: 'drop', section: 'new section', energy: 'energy changed', time: 'scene length', evolve: 'the scene had run its course', override: 'your choice' }[pj.next.reason] || pj.next.reason})` : '—';
  el.innerHTML = `<div class="row"><img src="${(cur && pj.thumbs[cur]) || ''}" alt="" class="pj-livethumb"><div><div><b>${esc(cur ? names[cur] : '—')}</b>${pj.cur.mode === 'auto' ? '' : ' <span class="muted">(Autonomous is off)</span>'}</div><div class="small muted">Next: ${esc(nx)}</div></div></div>
    <div class="pj-meters"><span>Energy</span><div class="vu"><i style="width:${Math.round(((F && F.energy) || 0) * 100)}%"></i></div><span>Section</span><b class="small">${esc(sec)}</b><span>Tempo</span><span class="small">${F && F.bpmConf > 0.35 ? `${Math.round(F.bpm)} BPM, bar ${F.barBeat + 1}/4` : 'finding the beat…'}</span><span>Sync</span><span class="small">${esc(pjSyncLine())}</span></div>`;
  const sy = $('#pjSync'); if (sy) sy.innerHTML = pjSyncTable();
}
function pjSyncLine() {
  if (!pj.running) return 'Press Play to drive the bulbs';
  if (!pj.cur.auto.lightSync || pj.cur.lights.mode === 'off') return 'Bulbs not synced (projector only)';
  const v = Object.values(pj.sync || {}); if (!v.length) return 'Waiting for the first cue';
  const missed = v.reduce((a, x) => a + x.missed, 0), sent = v.reduce((a, x) => a + x.sent, 0);
  return `${sent} timed cues sent${missed ? `, ${missed} skipped (too late to be in step)` : ''}`;
}
function pjSyncTable() {
  const rows = Object.entries(pj.sync || {}).map(([id, x]) => { const d = S.devices.find((q) => q.id === id); return `<tr><td>${esc(d ? d.name : id)}</td><td>${x.latency} ms</td><td>${x.measured == null ? '—' : x.measured + ' ms'}</td><td>${x.jitter} ms</td><td>${x.sent}</td><td>${x.missed}</td></tr>`; }).join('');
  return `<table class="pj-synct"><tr><th>Bulb</th><th>Sent early by</th><th>Cloud reply</th><th>Jitter</th><th>Cues</th><th>Skipped</th></tr><tr><td>Projector</td><td>${pj.cur.sync.displayMs} ms</td><td>—</td><td>—</td><td></td><td></td></tr>${rows}</table>
    <p class="muted pj-p">Each bulb is sent its change early by its own delay, from the Lightshow timing (Bulbs tab, Line up the lights). Cloud bulbs (Hubspace, Cync) vary from moment to moment, so they line up approximately, never perfectly. Beats are predicted from the tempo; anything that cannot be predicted reaches cloud bulbs late.</p>`;
}

/* ----- line up the projector: a white flash and a click; early / together / late adjusts the projector delay ----- */
function pjCalibStart() { if (!pj.calibCtx) pj.calibCtx = new AudioContext(); pj.calib = { step: 40, dir: 0, next: 0, flash: false, until: 0 }; pjPanel(); }
function pjCalibStop() { pj.calib = null; pjPushNow(); pjPanel(); }
function pjCalibTick(now) {
  const c = pj.calib, ctx = pj.calibCtx; if (!ctx) return; if (ctx.state !== 'running') ctx.resume().catch(() => {});
  if (c.flash && now > c.until) { c.flash = false; pjPushNow(); }
  if (now < c.next) return;
  // the click plays 600 ms from now (+ the sound output's own delay); the flash is sent early by the projector delay
  const outMs = ((ctx.outputLatency || 0) + (ctx.baseLatency || 0)) * 1000, clickAt = now + 600 + outMs, when = ctx.currentTime + 0.6;
  const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 1500; g.gain.setValueAtTime(0.6, when); g.gain.exponentialRampToValueAtTime(0.001, when + 0.05); o.connect(g).connect(ctx.destination); o.start(when); o.stop(when + 0.06);
  setTimeout(() => { if (pj.calib) { pj.calib.flash = true; pj.calib.until = performance.now() + 110; pjPushNow(); } }, Math.max(0, clickAt - pj.cur.sync.displayMs - now));
  c.next = now + 1000;
}
function pjCalibAnswer(dir) { // -1: flash before the click (send less early), +1: after it (send earlier)
  const c = pj.calib; if (!c) return;
  if (dir === 0) { pjCalibStop(); toast(`Projector delay saved: ${pj.cur.sync.displayMs} ms`); return pjSave(); }
  if (c.dir && c.dir !== dir) c.step = Math.max(5, Math.round(c.step / 2)); c.dir = dir;
  pj.cur.sync.displayMs = Math.max(0, Math.min(500, pj.cur.sync.displayMs + dir * c.step)); pjSchedOut(); pjSave(); pjPanel();
}


/* ----- 1.8: transitions on the beat, transition styles, evolution status ----- */
// A manual animation change waits for the next beat when the music has a steady tempo (at most ~0.9 s), so even
// hand-made changes land in time. Without music or tempo it happens at once.
function pjOnBeat(fn) {
  const e = SVC.engine, now = performance.now();
  if (!SVC.active || !e || !(e.F.bpmConf > 0.35) || !pj.cur.auto.beatSync) return fn();
  const T = e.predict(now + pj.cur.sync.displayMs + 40, 'beat'); if (T == null || T - now > 900) return fn();
  if (!pj.sched) pjSchedOut();
  pj.sched.at('display', T, { manual: fn }, { priority: 3 });
}
// transition style: the user's choice, or one that suits the Autonomous personality, varied from change to change
const PERS_XF = { ambient: ['fade', 'dissolve', 'morph'], psychedelic: ['morph', 'dissolve', 'bloom'], electronic: ['sweep', 'bloom', 'dissolve'], cinematic: ['fade', 'bloom', 'morph'], party: ['sweep', 'dissolve', 'bloom'] };
function pjXf() {
  const want = pj.cur.evolve.xf; if (want !== 'auto') return want;
  const opts = PERS_XF[pj.cur.auto.personality] || PERS_XF.ambient; let k;
  do { k = opts[Math.floor(Math.random() * opts.length)]; } while (opts.length > 1 && k === pj.lastXf);
  return (pj.lastXf = k);
}
// let the evolution director suggest a scene change in Autonomous mode when a shape has run its course
function pjEvolveNudge() {
  const main = pjMainRegion(), ev = main && pj.R && pj.R.evolver(main.id);
  return !!(ev && window.LumenEvolve && LumenEvolve.takeReady(ev));
}

/* ----- 1.8: evolution controls (Visuals tab). Changing them never touches the audio service. ----- */
const EVO_LABEL = { speed: (v) => (v < 0.4 ? 'very slow' : v < 0.8 ? 'slow' : v < 1.3 ? 'normal' : v < 2 ? 'fast' : 'very fast'), music: (v) => Math.round(v * 100) + '%', intensity: (v) => Math.round(v * 100) + '%', complexity: (v) => Math.round(v * 100) + '%', variation: (v) => (v < 0.15 ? 'none' : v < 0.4 ? 'rare' : v < 0.7 ? 'sometimes' : 'often'), change: (v) => pjPct(v, 'change') };
function pjEvoPanel() {
  const E = pj.cur.evolve, A = pj.cur.auto, r = pjSel();
  const sl = (k, label, min, max, step, tip, val = E[k], attr = 'data-evo') => `<div class="f"><label data-tip="${tip}">${label} <span class="muted" id="pjev-${k}">${EVO_LABEL[k](val)}</span></label><input type="range" ${attr}="${k}" min="${min}" max="${max}" step="${step}" value="${val}"></div>`;
  return `<div class="sect">Evolution</div>
    <label class="pj-chk" data-tip="Animations keep developing on their own: they drift, change shape, form new layers and shift colour, even when no music is playing"><input type="checkbox" data-evo="on" ${E.on ? 'checked' : ''}>Keep the animations evolving</label>
    ${sl('speed', 'Evolution speed', 0, 3, 0.05, 'How quickly the animations develop')}${sl('music', 'Music influence', 0, 2, 0.05, 'How much the music shapes the movement: bass widens it, mids stir it up, treble adds fine detail, drops transform it')}${sl('intensity', 'Visual intensity', 0, 2, 0.05, 'How far the animations move and distort overall')}
    ${r ? `<div class="small muted pj-evonow" id="pjEvoNow"></div>` : ''}
    <a href="#" class="small" data-a="evoadv">${pj.evoAdv ? 'Hide' : 'More'} evolution settings</a>
    ${pj.evoAdv ? `${sl('complexity', 'Complexity', 0, 1, 0.05, 'How much detail and how many layers the animations build up')}${sl('variation', 'Surprises', 0, 1, 0.05, 'How often an animation starts something new by itself: a new layer, a change of direction, a colour shift')}
      ${sl('change', 'Animation changes (Autonomous)', 0, 1, 0.05, 'How often Autonomous mode moves to another animation', A.change, 'data-auto')}
      <div class="f"><label>Transition style</label><select data-evo="xf">${[['auto', 'Varied (suits the mood)'], ['fade', 'Crossfade'], ['dissolve', 'Dissolve'], ['bloom', 'Bloom from the centre'], ['sweep', 'Sweep across'], ['morph', 'Melt / morph']].map(([k, n]) => `<option value="${k}" ${E.xf === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>` : ''}`;
}
function pjEvoSet(t) {
  const k = t.dataset.evo, v = t.type === 'checkbox' ? t.checked : t.type === 'range' ? +t.value : t.value;
  pj.cur.evolve = { ...pj.cur.evolve, [k]: v }; // a new object, so the renderer picks the change up at once
  const lab = $('#pjev-' + k); if (lab && EVO_LABEL[k]) lab.textContent = EVO_LABEL[k](v);
  pjLive(); pjPush(); pjSave();
}
// what the selected shape is doing right now
function pjEvoNow() { const el = $('#pjEvoNow'), r = pjSel(); if (!el || !r || !pj.R) return; const d = pj.cur.evolve.on ? pj.R.describe(r.id) : ''; el.textContent = d ? 'Now: ' + d : ''; }

// preview load control (only while listening, which is what it protects): lag = how late the 33 ms draw timer
// fires, smoothed. The preview canvas keeps its last picture between draws, so bulbs following it still see it.
function pjPreviewBudget(now) {
  if (!pj.drawEvery) { pj.drawEvery = 1; pj.lag = 0; pj.loopAt = now; pj.goodSince = now; }
  const late = Math.max(0, now - pj.loopAt - 33); pj.loopAt = now;
  if (!SVC.active) { pj.drawEvery = 1; pj.lag = 0; return; }
  pj.lag += (late - pj.lag) * 0.2;
  // at most 4x fewer draws: bulbs following the picture still see it change
  if (pj.lag > 25 && pj.drawEvery < 4) { pj.drawEvery = Math.min(4, pj.drawEvery * 2); pj.lag = 0; pj.goodSince = now; }
  else if (pj.lag < 6 && now - pj.goodSince > 3000 && pj.drawEvery > 1) { pj.drawEvery = Math.max(1, pj.drawEvery >> 1); pj.goodSince = now; }
  else if (pj.lag >= 6) pj.goodSince = now;
}
