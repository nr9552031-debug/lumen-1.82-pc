'use strict';
const { app, BrowserWindow, screen, ipcMain, safeStorage, Menu, Tray, nativeImage, shell, clipboard, dialog, session, desktopCapturer } = require('electron');
const fs = require('fs');
const path = require('path');
const diag = require('./diag');
const { Store } = require('./store');
const { Manager } = require('./manager');
const { WizProvider } = require('./providers/wiz');
const { HubspaceProvider } = require('./providers/hubspace');
const { CyncProvider } = require('./providers/cync');
const { FxEngine } = require('./fx');
const { Automation } = require('./automation');
const { createApi, cleanFrame } = require('./api');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const ICON = path.join(__dirname, '..', '..', 'build', 'icon.png');
const startHidden = process.argv.includes('--hidden');
let win, manager, store, fx, automation, tray = null, quitting = false;

function stopDrivers() {
  const pl = manager && manager.projLights, sp = manager && manager.showPlayer;
  return [fx && fx.active ? fx.stop() : null, pl && pl.active ? pl.stop() : null, sp && sp.state !== 'idle' ? sp.stop() : null].filter(Boolean);
}

function createStore() {
  const crypto = {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (s) => safeStorage.encryptString(s),
    decrypt: (b) => safeStorage.decryptString(b),
  };
  return new Store(app.getPath('userData'), crypto);
}
const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };
function showWindow() { if (!win || win.isDestroyed()) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); }

function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 860, minWidth: 940, minHeight: 620, show: !startHidden,
    // The app draws its own title bar (XP / Windows 7 styling). The window keeps its native resize edges and snapping.
    frame: false, backgroundColor: '#1c4a8c', title: 'Lumen', icon: ICON,
    // backgroundThrottling off: a light show must keep its timing while the window is minimised or behind a game.
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  const winState = () => send('win:state', { maximized: win.isMaximized(), focused: win.isFocused() });
  for (const ev of ['maximize', 'unmaximize', 'focus', 'blur']) win.on(ev, winState);
  win.on('close', (e) => {
    if (quitting) return;
    const st = store.data.settings.startup || {};
    if (st.closeToTray && tray) { e.preventDefault(); win.hide(); return; }
    // Closing mid-show: give the lights their own state back first.
    if (projWin && !projWin.isDestroyed()) projWin.destroy();
    const busy = stopDrivers();
    if (busy.length) {
      e.preventDefault(); quitting = true;
      Promise.allSettled(busy).finally(() => { if (win && !win.isDestroyed()) win.destroy(); });
    }
  });
}

// Notification-area icon with quick controls. Purely a convenience: if it cannot be created the app works without it.
function buildTray() {
  try {
    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
    tray.setToolTip('Lumen');
    tray.on('click', showWindow);
    refreshTray();
  } catch (e) { tray = null; diag.log('app', `tray unavailable: ${e.message}`); }
}
function refreshTray() {
  if (!tray) return;
  const snap = manager.snapshot(), all = { type: 'all' };
  const scenes = [...snap.scenes].sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0)).slice(0, 8);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Lumen', click: showWindow }, { type: 'separator' },
    { label: 'All lights on', click: () => manager.applyTracked(manager.scopeIds(all), { on: true }, 'All on').catch(() => {}) },
    { label: 'All lights off', click: () => manager.applyTracked(manager.scopeIds(all), { on: false }, 'All off').catch(() => {}) },
    { label: 'Scenes', submenu: scenes.map((s) => ({ label: s.name, click: () => { try { Promise.resolve(manager.applyScene(s.id, all)).catch(() => {}); } catch {} } })) },
    { label: 'Stop effect', enabled: fx.active, click: () => fx.stop().catch(() => {}) },
    { type: 'separator' }, { label: 'Exit', click: () => quit() },
  ]));
}
async function quit() {
  if (quitting) return;
  quitting = true;
  const busy = stopDrivers();
  if (busy.length) await Promise.allSettled(busy);
  app.quit();
}
// "Start with Windows". For the portable build the real .exe is the one the user launched, not the unpacked copy.
function applyStartup(st) {
  if (!app.isPackaged) return;
  try { app.setLoginItemSettings({ openAtLogin: !!st.launchAtLogin, path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, args: st.startMinimized ? ['--hidden'] : [] }); }
  catch (e) { diag.log('app', `start-with-Windows not set: ${e.message}`); }
}

// ---- Projection Studio output: a second, borderless window on the chosen display. It only draws; it has no
// access to lights, accounts or settings (its own tiny preload exposes just the picture feed and "close").
let projWin = null, projLast = null;
const projState = () => ({ open: !!(projWin && !projWin.isDestroyed()) });
function projOpen({ displayId, windowed }) {
  if (projWin && !projWin.isDestroyed()) projWin.destroy();
  const all = screen.getAllDisplays(), d = all.find((x) => String(x.id) === String(displayId)) || screen.getPrimaryDisplay(), b = d.bounds;
  const webPreferences = { preload: path.join(__dirname, 'preload-proj.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false };
  const opened = new BrowserWindow(windowed
    ? { webPreferences, x: b.x + 60, y: b.y + 60, width: 960, height: 540, backgroundColor: '#000', title: 'Lumen projection (preview)', icon: ICON, autoHideMenuBar: true }
    : { webPreferences, x: b.x, y: b.y, width: b.width, height: b.height, frame: false, fullscreen: true, backgroundColor: '#000', title: 'Lumen projection', icon: ICON, skipTaskbar: false, alwaysOnTop: true });
  projWin = opened;
  const wc = opened.webContents;
  opened.setMenu(null);
  projWin.loadFile(path.join(__dirname, '..', 'renderer', 'projector.html'));
  wc.on('will-navigate', (e) => e.preventDefault()); wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.once('did-finish-load', () => { if (projLast) wc.send('proj:state', projLast); });
  opened.on('closed', () => {
    // Reopening on another display destroys the old window first. Its close event must not clear
    // the reference to the replacement window or tell the editor that output has stopped.
    if (projWin !== opened) return;
    projWin = null;
    send('proj:output', { open: false });
  });
  send('proj:output', { open: true });
  diag.log('proj', `output opened ${windowed ? 'windowed' : 'fullscreen'} ${b.width}x${b.height}`);
  return projState();
}
function projClose() { if (projWin && !projWin.isDestroyed()) projWin.close(); return { open: false }; }
const projSend = (ch, payload) => { if (ch === 'proj:state') projLast = payload; if (projWin && !projWin.isDestroyed()) projWin.webContents.send(ch, payload); };
const displays = () => { const prim = screen.getPrimaryDisplay().id; return screen.getAllDisplays().map((d, i) => ({ id: String(d.id), primary: d.id === prim, w: d.size.width, h: d.size.height, label: `${d.label || 'Display ' + (i + 1)} (${d.size.width} x ${d.size.height})${d.id === prim ? ', this screen' : ''}` })); };

const platform = {
  displays, projOpen, projClose, projState,
  version: app.getVersion(),
  runtime: `Electron ${process.versions.electron} | ${process.platform} ${process.arch}`,
  portable: !!process.env.PORTABLE_EXECUTABLE_DIR,
  copy: (text) => clipboard.writeText(text),
  openExternal: (u) => shell.openExternal(u),
  applyStartup,
  win: (what) => { if (!win || win.isDestroyed()) return; if (what === 'minimize') win.minimize(); else if (what === 'maximize') (win.isMaximized() ? win.unmaximize() : win.maximize()); else if (what === 'close') win.close(); },
  saveFile: async (name, text) => {
    const r = await dialog.showSaveDialog(win, { title: 'Save Lumen backup', defaultPath: path.join(app.getPath('documents'), name), filters: [{ name: 'Lumen backup', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, text); return r.filePath;
  },
  openAudio: async (exts) => {
    const r = await dialog.showOpenDialog(win, { title: 'Import music', properties: ['openFile'], filters: [{ name: 'Audio', extensions: exts }, { name: 'All files', extensions: ['*'] }] });
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
  },
  openFile: async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Open Lumen backup', properties: ['openFile'], filters: [{ name: 'Lumen backup', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    if (fs.statSync(r.filePaths[0]).size > 5 * 1024 * 1024) throw new Error('That file is too large to be a Lumen backup');
    return fs.readFileSync(r.filePaths[0], 'utf8');
  },
};

function wire() {
  const api = createApi({ manager, store, fx, automation, diag, platform });
  for (const [ch, fn] of Object.entries(api)) {
    // Requests are only accepted from Lumen's own main window (the projector window has no access).
    ipcMain.handle(ch, async (e, ...a) => { if (!win || win.isDestroyed() || e.sender !== win.webContents) return { ok: false, error: 'Not allowed' }; try { return { ok: true, data: await fn(...a) }; } catch (e) { diag.log('error', `${ch}: ${e.message}`); return { ok: false, error: e.message }; } });
  }
  ipcMain.on('fx:frame', (_e, f) => { const c = cleanFrame(f); if (c) fx.frame(c); });
  // Projection Studio feeds. Only the main window may send them; the projector window can only ask to close.
  const fromMain = (e) => win && !win.isDestroyed() && e.sender === win.webContents;
  ipcMain.on('proj:state', (e, p) => { if (fromMain(e) && p && typeof p === 'object') projSend('proj:state', p); });
  ipcMain.on('proj:audio', (e, f) => { if (fromMain(e)) projSend('proj:audio', cleanFrame(f)); });
  ipcMain.on('proj:lights', (e, t) => { if (fromMain(e)) api['proj:lights:frame'](t); });
  ipcMain.on('proj:cue', (e, list) => { if (fromMain(e)) api['proj:lights:cue'](list); }); // timed bulb cues (1.7)
  ipcMain.on('proj:exit', (e) => { if (projWin && !projWin.isDestroyed() && e.sender === projWin.webContents) projWin.close(); });
  let trayT = null;
  manager.on('changed', (s) => { send('changed', s); clearTimeout(trayT); trayT = setTimeout(refreshTray, 1500); });
  // What each light in a running show is being asked to do, for the on-screen preview.
  setInterval(() => { if (fx.active && win && !win.isDestroyed() && win.isVisible()) send('fx:lights', fx.preview()); }, 120);
}

app.whenReady().then(() => {
  store = createStore();
  manager = new Manager(store, { wiz: new WizProvider(), hubspace: new HubspaceProvider({ store }), cync: new CyncProvider({ store, opts: { allowUnverified: !!store.data.settings.cyncAllowUnverifiedTls } }) });
  fx = new FxEngine({ manager });
  automation = new Automation({ manager, store, fx });
  // Keep the redacted diagnostics in a file too: next to the portable .exe, in the project folder when run from
  // source, otherwise in the app's data folder.
  diag.setFile(path.join(process.env.PORTABLE_EXECUTABLE_DIR || (app.isPackaged ? app.getPath('userData') : app.getAppPath()), 'lumen-diagnostics.log'));
  diag.log('app', `Lumen ${app.getVersion()} started`);
  // Effects: when the app's own page asks to capture the display, hand it the primary screen plus the PC's sound
  // output ("loopback", Windows only). Nothing is recorded or sent anywhere; the page only measures loudness and colour.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const deny = () => { try { callback(null); } catch { try { callback({}); } catch {} } };
    if (!win || win.isDestroyed() || request.frame !== win.webContents.mainFrame) return deny();
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }).then((sources) => {
      if (!sources.length) { diag.log('fx', 'no screen source available for capture'); return deny(); }
      callback(process.platform === 'win32' ? { video: sources[0], audio: 'loopback' } : { video: sources[0] }); // system-sound loopback is Windows-only here
    }).catch((e) => { diag.log('fx', `capture sources failed: ${e.message}`); deny(); });
  });
  wire(); createWindow(); buildTray();
  if (startHidden && !tray) win.minimize();
  automation.start();
  win.webContents.once('did-finish-load', () => { if ((store.data.settings.startup || {}).scanOnStart !== false) manager.scan(); });
  const lightsBusy = () => fx.active || (manager.projLights && manager.projLights.active) || (manager.showPlayer && manager.showPlayer.state === 'playing');
  // status polling and rescans would add cloud traffic and fight the lights while an effect, projection or show is driving them
  setInterval(() => { if (win && win.isVisible() && !win.isMinimized() && !lightsBusy()) manager.refreshStates(); }, 20000);
  setInterval(() => { if (!lightsBusy()) manager.scan(); }, 10 * 60 * 1000);
});
app.on('second-instance', showWindow);
app.on('before-quit', (e) => {
  try { store.saveNow(); } catch {}
  if (quitting) return; // the tray/window paths already waited for active lighting to restore
  // Native quit shortcuts (notably Cmd+Q on macOS) bypass the renderer's window-close path.
  // Hold the quit until all active lighting drivers have completed their restore sequence.
  e.preventDefault(); quitting = true;
  Promise.allSettled(stopDrivers()).finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());
