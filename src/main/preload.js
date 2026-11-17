'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// The page gets exactly this: request/response calls, three event feeds, and one one-way channel for effect frames.
contextBridge.exposeInMainWorld('lumen', {
  call: (ch, ...a) => ipcRenderer.invoke(ch, ...a),
  onChanged: (fn) => ipcRenderer.on('changed', (_e, s) => fn(s)),
  onWin: (fn) => ipcRenderer.on('win:state', (_e, s) => fn(s)),
  onFx: (fn) => ipcRenderer.on('fx:lights', (_e, s) => fn(s)),
  onProj: (fn) => ipcRenderer.on('proj:output', (_e, s) => fn(s)),
  onTouchDesigner: (fn) => ipcRenderer.on('tdmcp:status', (_e, s) => fn(s)),
  onPhoneScan: (fn) => ipcRenderer.on('phone-scan:status', (_e, s) => fn(s)),
  send: (ch, payload) => { if (['fx:frame', 'proj:state', 'proj:audio', 'proj:lights', 'proj:cue'].includes(ch)) ipcRenderer.send(ch, payload); },
});
