'use strict';
/* Window shell for the Aero interface: caption buttons, menu bar, pop-up menus, tooltips, dialogs,
   notifications and the status bar. Presentation only: every command here calls a function or IPC channel
   that already existed. Loaded before app.js; runs after it (shellInit is called from app.js). */

/* ---------- pop-up menus (menu bar drop-downs and right-click menus share this) ---------- */
let menuOpen = null; // { el, owner }
function closeMenu() {
  if (!menuOpen) return;
  menuOpen.el.remove(); if (menuOpen.owner) menuOpen.owner.classList.remove('open');
  menuOpen = null;
}
// items: [{ label, icon, key, bold, checked, disabled, run } | '-']
function popupMenu(items, x, y, owner) {
  closeMenu(); hideTip();
  const el = document.createElement('div'); el.className = 'menu'; el.setAttribute('role', 'menu');
  el.innerHTML = items.map((it, i) => it === '-' ? '<div class="menu-sep"></div>'
    : `<button class="menu-i ${it.bold ? 'bold' : ''}" role="menuitem" data-i="${i}" ${it.disabled ? 'disabled' : ''}><span class="menu-g">${it.checked ? '<span class="menu-chk"></span>' : it.icon ? ico(it.icon, 16) : ''}</span><span class="menu-l">${esc(it.label)}</span>${it.key ? `<span class="menu-k">${esc(it.key)}</span>` : ''}</button>`).join('');
  document.body.appendChild(el);
  const r = el.getBoundingClientRect();
  el.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
  el.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
  el.addEventListener('click', (e) => {
    const b = e.target.closest('.menu-i'); if (!b || b.disabled) return;
    const it = items[+b.dataset.i]; closeMenu(); if (it && it.run) it.run();
  });
  if (owner) owner.classList.add('open');
  menuOpen = { el, owner };
}
document.addEventListener('pointerdown', (e) => { if (menuOpen && !e.target.closest('.menu') && !e.target.closest('.mb-i')) closeMenu(); }, true);
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);

/* ---------- menu bar ---------- */
const applyAll = (on) => call('apply', { type: 'all' }, { on });
const goTo = (t, id) => { view = { t, id }; selected = null; render(); };
function menuItems(name) {
  const here = (t, id) => view.t === t && (id === undefined || view.id === id);
  if (name === 'file') return [
    { label: 'Scan for lights', icon: 'scan', key: 'F5', disabled: !!S.scanning, run: () => call('scan') }, '-',
    { label: 'Exit', key: 'Alt+F4', run: () => window.lumen.call('win:close') }];
  if (name === 'view') return [
    { label: 'All lights', icon: 'home', checked: here('all'), run: () => goTo('all') },
    ...S.rooms.map((r) => ({ label: r.name, icon: 'room', checked: here('room', r.id), run: () => goTo('room', r.id) })),
    ...S.groups.map((g) => ({ label: g.name, icon: 'group', checked: here('group', g.id), run: () => goTo('group', g.id) })), '-',
    { label: 'Scenes', icon: 'scenes', checked: here('scenes'), run: () => goTo('scenes') },
    { label: 'Effects', icon: 'fx', checked: here('fx'), run: () => goTo('fx') },
    { label: 'Accounts & setup', icon: 'settings', checked: here('settings'), run: () => goTo('settings') }];
  if (name === 'lights') return [
    { label: 'Turn all lights on', icon: 'ok', disabled: !S.devices.length, run: () => applyAll(true) },
    { label: 'Turn all lights off', icon: 'off', disabled: !S.devices.length, run: () => applyAll(false) }, '-',
    { label: 'New room…', icon: 'room', run: () => newRoom() },
    { label: 'New group…', icon: 'group', run: () => newGroup() }];
  return [
    { label: 'Copy diagnostics', icon: 'copy', run: async () => { await call('diag:copy'); toast('Diagnostics copied to the clipboard.'); } }, '-',
    { label: 'About Lumen', icon: 'info', run: aboutBox }];
}
function renderMenuBar() {
  const mb = $('#menubar');
  mb.innerHTML = [['file', 'File'], ['view', 'View'], ['lights', 'Lights'], ['help', 'Help']].map(([k, l]) => `<button class="mb-i" data-menu="${k}">${l}</button>`).join('');
  const open = (b) => { const r = b.getBoundingClientRect(); popupMenu(menuItems(b.dataset.menu), r.left, r.bottom, b); };
  mb.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.mb-i'); if (!b) return;
    if (menuOpen && menuOpen.owner === b) closeMenu(); else open(b);
  });
  mb.addEventListener('pointerover', (e) => { const b = e.target.closest('.mb-i'); if (b && menuOpen && menuOpen.owner && menuOpen.owner !== b && menuOpen.owner.classList.contains('mb-i')) open(b); });
}

/* ---------- right-click menus ---------- */
function deviceMenu(d) {
  const one = { type: 'devices', ids: [d.id] };
  return [
    { label: d.on ? 'Turn off' : 'Turn on', icon: d.on ? 'off' : 'ok', bold: true, disabled: d.online === false, run: () => call('apply', one, { on: !d.on }) },
    { label: 'Light controls', icon: 'bulb', run: () => { selected = d.id; renderDrawer(); renderContent(); } }, '-',
    { label: 'Rename…', icon: 'rename', run: async () => { const n = await ask('Rename light', d.name); if (n) call('device:meta', d.id, { name: n }); } },
    ...(S.rooms.length ? ['-', ...S.rooms.map((r) => ({ label: 'Move to ' + r.name, checked: d.room === r.id, run: () => call('device:meta', d.id, { room: r.id }) })),
      { label: 'No room', checked: !d.room, run: () => call('device:meta', d.id, { room: '' }) }] : []), '-',
    { label: 'Remove from Lumen', icon: 'del', run: () => forgetDevice(d.id) }];
}
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (e.target.closest('input[type=text],input[type=password],input[type=email],pre')) return; // nothing to offer on text yet
  const tile = e.target.closest('.card[data-id]'), nav = e.target.closest('.nav-i[data-id]'), sc = e.target.closest('[data-sc]');
  if (tile) { const d = S.devices.find((x) => x.id === tile.dataset.id); if (d) popupMenu(deviceMenu(d), e.clientX, e.clientY); return; }
  if (nav && nav.dataset.nav === 'room') return popupMenu([
    { label: 'Open', bold: true, icon: 'room', run: () => goTo('room', nav.dataset.id) }, '-',
    { label: 'Rename…', icon: 'rename', run: () => renameRoom(nav.dataset.id) },
    { label: 'Delete', icon: 'del', run: () => deleteRoom(nav.dataset.id) }], e.clientX, e.clientY);
  if (nav && nav.dataset.nav === 'group') return popupMenu([
    { label: 'Open', bold: true, icon: 'group', run: () => goTo('group', nav.dataset.id) }, '-',
    { label: 'Edit members…', icon: 'rename', run: () => editGroup(S.groups.find((g) => g.id === nav.dataset.id)) },
    { label: 'Delete', icon: 'del', run: () => deleteGroup(nav.dataset.id) }], e.clientX, e.clientY);
  if (sc) { const s = S.scenes.find((x) => x.id === sc.dataset.sc); if (!s) return;
    return popupMenu([{ label: 'Apply', bold: true, icon: 'play', run: () => applyScene(s.id) },
      ...(s.builtin ? [] : ['-', { label: 'Delete', icon: 'del', run: () => deleteScene(s.id) }])], e.clientX, e.clientY); }
});

/* ---------- tooltips (replace the system ones so they match the theme) ---------- */
let tipTimer = null, tipFor = null;
function hideTip() { clearTimeout(tipTimer); tipFor = null; const t = document.getElementById('tip'); if (t) t.classList.remove('show'); }
document.addEventListener('pointerover', (e) => {
  const el = e.target.closest && e.target.closest('[title],[data-tip]'); if (!el || el === tipFor) return;
  if (el.hasAttribute('title')) { el.dataset.tip = el.getAttribute('title'); el.removeAttribute('title'); if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', el.dataset.tip); }
  if (!el.dataset.tip) return;
  hideTip(); tipFor = el;
  tipTimer = setTimeout(() => {
    if (!el.isConnected || menuOpen) return;
    const t = document.getElementById('tip'), r = el.getBoundingClientRect();
    t.textContent = el.dataset.tip; t.classList.add('show');
    const w = t.offsetWidth, h = t.offsetHeight;
    t.style.left = Math.max(4, Math.min(r.left + 8, innerWidth - w - 4)) + 'px';
    t.style.top = (r.bottom + 6 + h > innerHeight ? r.top - h - 6 : r.bottom + 6) + 'px';
  }, 550);
});
document.addEventListener('pointerout', (e) => { if (tipFor && !(e.relatedTarget && tipFor.contains(e.relatedTarget))) hideTip(); });
document.addEventListener('pointerdown', hideTip, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeMenu(); hideTip(); }
  if (e.key === 'F5') { e.preventDefault(); if (!S.scanning) call('scan'); }
});

/* ---------- dialogs ---------- */
// One Aero-framed dialog. buttons: [{ label, value, primary }]. Resolves with the pressed button's value
// (or null when dismissed); onOpen(dialog, done) can wire up fields.
function dialogBox({ title, icon, heading, body = '', buttons, onOpen }) {
  return new Promise((res) => {
    const d = $('#dlg');
    d.innerHTML = `<div class="dlg-win"><div class="dlg-title">${ico('lumen', 16)}<span>${esc(title)}</span><button class="cap close" data-x aria-label="Close">${ico('cap-close', 14)}</button></div>
      <div class="dlg-client"><div class="dlg-body">${icon ? `<div class="dlg-icon">${ico(icon, 32)}</div>` : ''}<div class="dlg-main">${heading ? `<h2>${esc(heading)}</h2>` : ''}${body}</div></div>
      <div class="dlg-btns">${buttons.map((b, i) => `<button class="btn ${b.primary ? 'pri' : ''}" data-b="${i}">${esc(b.label)}</button>`).join('')}</div></div></div>`;
    let settled = false;
    const done = (v) => { if (settled) return; settled = true; d.removeEventListener('cancel', onCancel); d.close(); res(v); };
    const onCancel = (e) => { e.preventDefault(); done(null); };
    d.addEventListener('cancel', onCancel);
    d.querySelector('[data-x]').onclick = () => done(null);
    d.querySelectorAll('[data-b]').forEach((b) => (b.onclick = () => { const def = buttons[+b.dataset.b]; done(typeof def.value === 'function' ? def.value(d) : def.value); }));
    d.showModal();
    const first = d.querySelector('.btn.pri'); if (first) first.focus();
    if (onOpen) onOpen(d, done);
  });
}
function ask(title, value = '', ph = '') {
  return dialogBox({ title, heading: title, body: `<input type="text" id="dlgIn" value="${esc(value)}" placeholder="${esc(ph)}">`,
    buttons: [{ label: 'OK', primary: true, value: (d) => d.querySelector('#dlgIn').value.trim() }, { label: 'Cancel', value: null }],
    onOpen: (d, done) => { const i = d.querySelector('#dlgIn'); i.focus(); i.select(); i.onkeydown = (e) => { if (e.key === 'Enter') done(i.value.trim()); }; } });
}
function confirmBox(heading, text, okLabel = 'Yes') {
  return dialogBox({ title: 'Lumen', icon: 'warn', heading, body: text ? `<p>${esc(text)}</p>` : '', buttons: [{ label: okLabel, primary: true, value: true }, { label: 'Cancel', value: false }] }).then((v) => v === true);
}
async function aboutBox() {
  const r = await window.lumen.call('diag'); const first = r.ok ? String(r.data).split('\n')[0] : 'Lumen';
  dialogBox({ title: 'About Lumen', icon: 'lumen', heading: 'Lumen', body: `<p>${esc(first)}</p><p>One control centre for WiZ, GE Cync and Hubspace lights.</p>`, buttons: [{ label: 'OK', primary: true, value: null }] });
}

/* ---------- notifications ---------- */
function toast(m) {
  const t = $('#toast');
  t.innerHTML = `${ico('info', 24)}<div><b>Lumen</b><span>${esc(m)}</span></div>`;
  t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 4200);
}

/* ---------- status bar ---------- */
function renderStatusBar() {
  const sb = $('#statusbar'); if (!sb) return;
  const on = S.devices.filter((d) => d.on && d.online !== false).length, offline = S.devices.filter((d) => d.online === false).length;
  const n = (b) => S.devices.filter((d) => d.brand === b).length;
  const prov = (b, connected, text) => { const bad = (S.errors || {})[b]; return `<div class="sb-cell" ${bad ? `title="${esc(bad)}"` : ''}>${ico(bad ? 'warn' : connected ? 'ok' : 'off', 14)}<span>${BRANDS[b]}: ${bad ? ((S.needsReauth || {})[b] ? 'sign-in expired' : 'not reachable') : text}</span></div>`; };
  const show = typeof fx !== 'undefined' && fx.st && fx.st.active;
  sb.innerHTML = `<div class="sb-cell sb-main">${ico('bulb', 14, '', 'color:#ffd75e')}<span>${S.devices.length} light${S.devices.length === 1 ? '' : 's'}, ${on} on${offline ? `, ${offline} offline` : ''}</span></div>
    ${prov('wiz', true, `local, ${n('wiz')} found`)}${prov('hubspace', S.accounts.hubspace, S.accounts.hubspace ? `connected, ${n('hubspace')} found` : 'not connected')}${prov('cync', S.accounts.cync, S.accounts.cync ? `connected, ${n('cync')} found` : 'not connected')}
    ${show ? `<div class="sb-cell">${ico('fx', 14)}<span>Light show running</span></div>` : ''}
    <div class="sp"></div>${S.scanning ? '<div class="sb-cell"><span>Searching for lights</span><div class="progress marquee"><i></i></div></div>' : ''}<div class="sb-grip"></div>`;
}

/* ---------- window frame ---------- */
function shellInit() {
  mountIcons();
  $('#tbIcon').innerHTML = ico('lumen', 18);
  $('#wMin').innerHTML = ico('cap-min', 16); $('#wMax').innerHTML = ico('cap-max', 16); $('#wClose').innerHTML = ico('cap-close', 16);
  $('#wMin').onclick = () => window.lumen.call('win:minimize');
  $('#wMax').onclick = () => window.lumen.call('win:maximize');
  $('#wClose').onclick = () => window.lumen.call('win:close');
  const setState = (s) => {
    if (!s) return;
    $('#win').classList.toggle('max', !!s.maximized);
    $('#wMax').innerHTML = ico(s.maximized ? 'cap-restore' : 'cap-max', 16); $('#wMax').dataset.tip = s.maximized ? 'Restore Down' : 'Maximize';
  };
  if (window.lumen.onWindow) window.lumen.onWindow(setState);
  window.lumen.call('win:state').then((r) => { if (r && r.ok) setState(r.data); });
  // Like any Windows 7 window, the glass goes pale when the window is not the active one.
  window.addEventListener('blur', () => $('#win').classList.add('inactive'));
  window.addEventListener('focus', () => $('#win').classList.remove('inactive'));
  renderMenuBar();
}
