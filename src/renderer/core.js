'use strict';
/* Shared helpers for every page: state, calls to the main process, menus, dialogs, tooltips. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const C = window.LumenColor;
const BRANDS = { wiz: 'WiZ', hubspace: 'Hubspace', cync: 'Cync' };
const SWATCHES = ['#ff3b3b', '#ff8a2b', '#ffd23b', '#4ade80', '#2dd4bf', '#38bdf8', '#6366f1', '#a855f7', '#ec4899', '#ffffff'];
const THEMES = { aero: 'Windows 7 Aero', 'xp-blue': 'Windows XP (Blue)', 'xp-silver': 'Windows XP (Silver)', 'xp-olive': 'Windows XP (Olive Green)' };
const ico = (id, cls = '') => `<svg class="ico ${cls}"><use href="#i-${id}"/></svg>`;
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const throttle = (fn, ms) => { let last = 0, t, args; return (...a) => { args = a; const n = Date.now(); clearTimeout(t); if (n - last >= ms) { last = n; fn(...args); } else t = setTimeout(() => { last = Date.now(); fn(...args); }, ms - (n - last)); }; };

let S = { devices: [], rooms: [], groups: [], scenes: [], layouts: [], schedules: [], settings: {}, accounts: {}, errors: {}, history: {}, fx: {} };
let view = { t: 'home' };
let selected = null;                 // device id shown in the properties pane
let busyDrag = false, pendingRender = false;
let filter = '';                     // toolbar search
const ui = { sort: 'name', dir: 1 };

async function call(ch, ...a) {
  const r = await window.lumen.call(ch, ...a);
  if (!r.ok) { toast(r.error, true); throw new Error(r.error); }
  return r.data;
}
function toast(m, force) {
  if (!force && S.settings && S.settings.toasts === false) return;
  const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3600);
}
const dev = (id) => S.devices.find((d) => d.id === id);
const roomName = (id) => (S.rooms.find((r) => r.id === id) || {}).name || '';
const lightColor = (d) => C.hex(C.stateRgb(d));
const scopeOf = () => view.t === 'room' ? { type: 'room', id: view.id } : view.t === 'group' ? { type: 'group', id: view.id } : { type: 'all' };
function devicesIn(scope) {
  if (scope.type === 'room') return S.devices.filter((d) => d.room === scope.id);
  if (scope.type === 'group') { const g = S.groups.find((x) => x.id === scope.id); return g ? S.devices.filter((d) => g.deviceIds.includes(d.id)) : []; }
  return S.devices;
}
const ago = (t) => { if (!t) return 'never'; const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
const stateText = (d) => d.online === false ? 'Offline' : !d.on ? 'Off' : `${d.caps.dim ? (d.brightness || 100) + '% · ' : ''}${d.mode === 'color' && d.rgb ? 'colour' : (d.kelvin || 2700) + ' K'}`;

/* ---------- popup menus (menu bar, right-click) ---------- */
// items: [{ label, key, icon, checked, disabled, run }] or '-' for a separator
function popup(items, x, y, anchor) {
  closePopup();
  const m = document.createElement('div'); m.className = 'menu'; m.id = 'popup';
  m.innerHTML = items.map((it, i) => it === '-' ? '<hr>' : `<button data-i="${i}" ${it.disabled ? 'disabled' : ''}>${it.checked ? '<span class="ck">✓</span>' : ''}<span>${esc(it.label)}</span>${it.key ? `<span class="k">${esc(it.key)}</span>` : ''}</button>`).join('');
  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(2, Math.min(x, innerWidth - r.width - 4)) + 'px'; m.style.top = Math.max(2, Math.min(y, innerHeight - r.height - 4)) + 'px';
  m.addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (!b) return; const it = items[+b.dataset.i]; closePopup(); if (it.run) it.run(); });
  popup.anchor = anchor || null; if (anchor) anchor.classList.add('open');
}
function closePopup() { const m = $('#popup'); if (m) m.remove(); if (popup.anchor) { popup.anchor.classList.remove('open'); popup.anchor = null; } }
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#popup') && !e.target.closest('#menubar')) closePopup(); }, true);
window.addEventListener('blur', closePopup);

/* ---------- dialogs ---------- */
// body: HTML string. buttons: [{ label, value, pri }]. Resolves with the clicked value (null if dismissed).
function dialogBox(title, body, buttons = [{ label: 'OK', value: true, pri: true }], onOpen) {
  return new Promise((res) => {
    const dlg = $('#dlg');
    dlg.innerHTML = `<form method="dialog" class="dlgw"><div class="dt">${esc(title)}</div><div class="db">${body}</div><div class="df">${buttons.map((b, i) => `<button class="btn ${b.pri ? 'pri' : ''}" value="${i}">${esc(b.label)}</button>`).join('')}</div></form>`;
    dlg.returnValue = '';
    dlg.onclose = () => { const b = buttons[+dlg.returnValue]; res(dlg.returnValue === '' || !b ? null : (typeof b.value === 'function' ? b.value(dlg) : b.value)); if (pendingRender) { pendingRender = false; render(); } };
    dlg.showModal(); if (onOpen) onOpen(dlg);
    const first = $('input,select', dlg); if (first) { first.focus(); if (first.select) first.select(); }
  });
}
const ask = (title, value = '', label = 'Name') => dialogBox(title, `<div class="f"><label>${esc(label)}</label><input type="text" id="askV" value="${esc(value)}" style="width:320px" maxlength="60"></div>`,
  [{ label: 'OK', pri: true, value: (d) => $('#askV', d).value.trim() || null }, { label: 'Cancel', value: null }]);
const confirmBox = (title, text, yes = 'Yes') => dialogBox(title, `<div class="row" style="align-items:flex-start;gap:12px;max-width:420px"><div class="led warn" style="width:24px;height:24px;flex:none"></div><div>${esc(text)}</div></div>`, [{ label: yes, value: true, pri: true }, { label: 'Cancel', value: false }]);

/* ---------- tooltips: any element with data-tip ---------- */
(() => {
  let t, cur = null; const tip = () => $('#tip');
  document.addEventListener('pointerover', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]'); if (el === cur) return; cur = el; clearTimeout(t); tip().classList.add('hidden'); if (!el) return;
    t = setTimeout(() => { const r = el.getBoundingClientRect(), b = tip(); b.textContent = el.dataset.tip; b.classList.remove('hidden'); const w = b.getBoundingClientRect();
      b.style.left = Math.max(4, Math.min(r.left, innerWidth - w.width - 6)) + 'px'; b.style.top = (r.bottom + 18 + w.height > innerHeight ? r.top - w.height - 4 : r.bottom + 6) + 'px'; }, 550);
  });
  document.addEventListener('pointerdown', () => { clearTimeout(t); tip().classList.add('hidden'); cur = null; }, true);
})();

/* ---------- theme ---------- */
function applyTheme(name) {
  const th = THEMES[name] ? name : 'aero';
  document.body.dataset.theme = th; document.body.dataset.family = th === 'aero' ? 'aero' : 'xp';
}
const setTheme = (name) => { applyTheme(name); S.settings.theme = name; return call('settings:set', { theme: name }); };
// A light's undoable command helpers used by several pages.
const applyTo = (scope, patch, label) => call('apply', scope, patch, label);
const scopeLabel = (sc) => sc.type === 'room' ? roomName(sc.id) : sc.type === 'group' ? ((S.groups.find((g) => g.id === sc.id) || {}).name || 'Group') : 'All lights';
function scopeOptions(cur) {
  return `<option value="all">All lights</option>` + S.rooms.map((r) => `<option value="room:${r.id}" ${cur === 'room:' + r.id ? 'selected' : ''}>Room: ${esc(r.name)}</option>`).join('') + S.groups.map((g) => `<option value="group:${g.id}" ${cur === 'group:' + g.id ? 'selected' : ''}>Group: ${esc(g.name)}</option>`).join('');
}
const parseScope = (v) => !v || v === 'all' ? { type: 'all' } : { type: v.split(':')[0], id: v.split(':').slice(1).join(':') };

/* ---------- colour picker ----------
   Replaces the operating system's colour dialog for every <input type="color"> in Lumen. It opens beside the
   field, stays open while you click and drag inside it, updates live, and closes only on a click outside, Esc,
   or its Close button. Each change is written back to the field and announced as a normal "input" event
   (event.detail = { rgb: full-strength colour, v: 0..1 brightness }), so existing handlers keep working. */
const cp = { el: null, input: null, sel: '', h: 0, s: 1, v: 1, drag: null };
function cpLocate() { // the page may have re-drawn the field while the picker was open: find its replacement
  if (cp.input && cp.input.isConnected) return cp.input;
  const n = cp.sel && document.querySelector(cp.sel);
  if (n) { cp.input = n; n.value = C.hex(cpShown()); if (n.dataset.v !== undefined) n.dataset.v = cp.v; } // show the picker's colour, not a stale one
  return n;
}
function cpSelector(i) {
  if (i.id) return '#' + CSS.escape(i.id);
  const a = Object.keys(i.dataset).map((k) => `[data-${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}="${CSS.escape(i.dataset[k])}"]`).join('');
  return a ? 'input[type=color]' + a : '';
}
function cpOpen(input) {
  cpClose(false);
  const rgb = C.parseColor(input.value) || [255, 255, 255], [h, s, v] = C.rgbToHsv(rgb);
  Object.assign(cp, { input, sel: cpSelector(input), h, s, v: input.dataset.v !== undefined ? C.clamp(+input.dataset.v || 0, 0, 1) : v });
  const el = cp.el = document.createElement('div'); el.id = 'cpick'; el.className = 'cpick'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Choose a colour');
  el.innerHTML = `<div class="cp-sv" data-z="sv" title="Saturation (left to right) and brightness (top to bottom)"><i class="cp-dot"></i></div>
    <div class="cp-hue" data-z="hue" title="Hue"><i class="cp-dot"></i></div>
    <div class="cp-row"><span class="cp-prev"><i class="cp-old"></i><i class="cp-new"></i></span>
      <label>HEX <input type="text" class="cp-hex" maxlength="7" spellcheck="false"></label></div>
    <div class="cp-row">${['R', 'G', 'B'].map((c, i) => `<label>${c} <input type="number" class="cp-rgb" data-i="${i}" min="0" max="255" step="1"></label>`).join('')}</div>
    <div class="cp-row cp-end"><span class="muted cp-note"></span><button class="btn" data-cp-close>Close</button></div>`;
  document.body.appendChild(el);
  el.querySelector('.cp-old').style.background = C.hex(C.hsvToRgb([cp.h, cp.s, cp.v]));
  const r = input.getBoundingClientRect(), w = el.offsetWidth, ht = el.offsetHeight;
  el.style.left = Math.max(4, Math.min(r.left, innerWidth - w - 6)) + 'px';
  el.style.top = (r.bottom + 4 + ht > innerHeight ? Math.max(4, r.top - ht - 4) : r.bottom + 4) + 'px';
  cpPaint();
  cp.watch = setInterval(cpLocate, 150); // the page re-draws freely while the picker is open; keep its field in step
  const pos = (e, z) => { const b = el.querySelector(`[data-z="${z}"]`).getBoundingClientRect(); return [C.clamp((e.clientX - b.left) / b.width, 0, 1), C.clamp((e.clientY - b.top) / b.height, 0, 1)]; };
  const move = (e) => {
    if (!cp.drag) return; const [x, y] = pos(e, cp.drag);
    // The last pixel or two at each edge snaps to the edge, so full saturation, full brightness and the pure
    // primary hues are easy to hit with a mouse.
    const edge = (t) => (t < 0.015 ? 0 : t > 0.985 ? 1 : t);
    if (cp.drag === 'sv') { cp.s = edge(x); cp.v = edge(1 - y); }
    else { const h = edge(x) * 360, n = Math.round(h / 60) * 60; cp.h = Math.abs(h - n) <= 2 ? n % 360 : h; }
    cpPaint(); cpEmit();
  };
  el.addEventListener('pointerdown', (e) => {
    const z = e.target.closest('[data-z]'); if (!z) return;
    e.preventDefault(); cp.drag = z.dataset.z; busyDrag = true; z.setPointerCapture(e.pointerId); move(e);
  });
  el.addEventListener('pointermove', move);
  const up = () => { if (cp.drag) { cp.drag = null; cpEmit(true); } };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
  el.addEventListener('click', (e) => { if (e.target.closest('[data-cp-close]')) cpClose(); });
  el.addEventListener('change', (e) => {
    const t = e.target;
    let rgb = null;
    if (t.classList.contains('cp-hex')) rgb = C.parseColor(t.value);
    else if (t.classList.contains('cp-rgb')) { const v = $$('.cp-rgb', el).map((x) => C.clamp(Math.round(+x.value || 0), 0, 255)); rgb = v; }
    if (!rgb) { cpPaint(); return; }
    const [h, s, v] = C.rgbToHsv(rgb); if (s > 0) cp.h = h; cp.s = s; cp.v = v; cpPaint(); cpEmit(true);
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input')) e.target.blur(); });
}
// Full-strength colour for the hue and saturation; brightness (v) is reported separately.
const cpFull = () => C.hsvToRgb([cp.h, cp.s, 1]);
const cpShown = () => C.hsvToRgb([cp.h, cp.s, cp.v]);
function cpPaint() {
  const el = cp.el; if (!el) return; const rgb = cpShown(), hx = C.hex(rgb);
  el.querySelector('.cp-sv').style.backgroundColor = C.hex(C.hsvToRgb([cp.h, 1, 1]));
  Object.assign(el.querySelector('.cp-sv .cp-dot').style, { left: cp.s * 100 + '%', top: (1 - cp.v) * 100 + '%' });
  el.querySelector('.cp-hue .cp-dot').style.left = (cp.h / 360) * 100 + '%';
  el.querySelector('.cp-new').style.background = hx;
  const a = document.activeElement;
  if (a !== el.querySelector('.cp-hex')) el.querySelector('.cp-hex').value = hx.toUpperCase();
  $$('.cp-rgb', el).forEach((x, i) => { if (a !== x) x.value = rgb[i]; });
}
function cpEmit() {
  const i = cpLocate(); if (!i) return;
  const v = Math.round(cp.v * 1000) / 1000, shown = cpShown();
  i.value = C.hex(shown); if (i.dataset.v !== undefined) i.dataset.v = v;
  i.dispatchEvent(new CustomEvent('input', { bubbles: true, detail: { rgb: cpFull(), v, shown } }));
}
function cpClose(flush = true) {
  if (!cp.el) return;
  clearInterval(cp.watch); cp.el.remove(); cp.el = null; cp.input = null; cp.drag = null; busyDrag = false;
  if (flush && pendingRender) { pendingRender = false; render(); }
}
// Open on click or keyboard instead of the system dialog.
document.addEventListener('click', (e) => { const i = e.target.closest('input[type=color]'); if (!i || i.disabled) return; e.preventDefault(); if (cp.el && cp.input === i) cpClose(); else cpOpen(i); }, true);
document.addEventListener('keydown', (e) => {
  const i = e.target; if (i.matches && i.matches('input[type=color]') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); cpOpen(i); }
  if (e.key === 'Escape' && cp.el) { e.stopImmediatePropagation(); cpClose(); }
}, true);
// A press outside the picker (and outside the field that opened it) closes it; presses inside never do.
document.addEventListener('pointerdown', (e) => { if (cp.el && !cp.el.contains(e.target) && !(cp.input && cp.input.contains(e.target))) cpClose(); }, true);
window.addEventListener('blur', () => { if (cp.el && !cp.drag) cpClose(); });
