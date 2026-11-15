'use strict';
const fs = require('fs');
const path = require('path');

// Persistent app data. Non-secret data lives in lumen-data.json.
// Secrets (tokens) live in secrets.bin, encrypted through the OS (Windows DPAPI via Electron safeStorage).
class Store {
  constructor(dir, crypto) {
    this.dir = dir;
    this.crypto = crypto; // { encrypt(str)->Buffer, decrypt(Buffer)->str }
    fs.mkdirSync(dir, { recursive: true });
    this.dataFile = path.join(dir, 'lumen-data.json');
    this.secretFile = path.join(dir, 'secrets.bin');
    this.data = {
      devices: {},   // id -> { name, room, brand, cache }
      rooms: [],     // { id, name }
      groups: [],    // { id, name, deviceIds[] }
      scenes: [],    // custom scenes
      layouts: [],   // room visualizer layouts (objects, fixtures, saved arrangements)
      schedules: [], // time-based automations
      settings: { wizIps: [], hubspaceEmail: '', cyncEmail: '' },
    };
    this.secrets = {};
    this._load();
    this._timer = null;
  }
  _load() {
    try { Object.assign(this.data, JSON.parse(fs.readFileSync(this.dataFile, 'utf8'))); } catch {}
    for (const k of ['rooms', 'groups', 'scenes', 'layouts', 'schedules']) if (!Array.isArray(this.data[k])) this.data[k] = [];
    if (!this.data.settings || typeof this.data.settings !== 'object') this.data.settings = {};
    if (!this.data.devices || typeof this.data.devices !== 'object') this.data.devices = {};
    try { this.secrets = JSON.parse(this.crypto.decrypt(fs.readFileSync(this.secretFile))); } catch { this.secrets = {}; }
    this.secretsPersistent = this.crypto.available ? this.crypto.available() : true;
  }
  save() { // debounced
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.saveNow(), 250);
  }
  saveNow() {
    clearTimeout(this._timer);
    const tmp = this.dataFile + '.tmp';
    // A full disk or a locked file must not crash the app: keep the data in memory and try again on the next save.
    try { fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1)); fs.renameSync(tmp, this.dataFile); this.saveError = null; }
    catch (e) { this.saveError = e.message; try { require('./diag').log('store', `could not save settings: ${e.code || e.message}`); } catch {} }
  }
  getSecret(k) { return this.secrets[k]; }
  setSecret(k, v) {
    if (v === undefined || v === null) delete this.secrets[k]; else this.secrets[k] = v;
    // If OS encryption is unavailable, secrets stay in memory only (never written as plaintext).
    if (this.crypto.available && !this.crypto.available()) { this.secretsPersistent = false; return; }
    const tmp = this.secretFile + '.tmp';
    fs.writeFileSync(tmp, this.crypto.encrypt(JSON.stringify(this.secrets)));
    fs.renameSync(tmp, this.secretFile);
  }
}
module.exports = { Store };
