'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// The projector window can receive the picture description and audio levels, and ask to be closed. Nothing else.
contextBridge.exposeInMainWorld('projector', {
  onState: (fn) => ipcRenderer.on('proj:state', (_e, s) => fn(s)),
  onAudio: (fn) => ipcRenderer.on('proj:audio', (_e, s) => fn(s)),
  exit: () => ipcRenderer.send('proj:exit'),
});
