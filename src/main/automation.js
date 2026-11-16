'use strict';
// Time-based schedules and the sleep timer. Runs only while Lumen is running (it can start with Windows and sit
// in the tray); a schedule whose time passes while the app is closed is skipped, not run late.
const diag = require('./diag');
const { MODES } = require('./fx');
const pad = (n) => String(n).padStart(2, '0');

class Automation {
  constructor({ manager, store, fx, now }) { this.m = manager; this.store = store; this.fx = fx; this.now = now || (() => new Date()); this.sleep = null; this.timer = null; }
  start() { this.timer = setInterval(() => this.tick().catch(() => {}), 15000); if (this.timer.unref) this.timer.unref(); }
  stop() { clearInterval(this.timer); }
  async tick() {
    const d = this.now(), hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`, key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hhmm}`;
    for (const s of this.store.data.schedules) {
      if (!s.enabled || s.time !== hhmm || !s.days.includes(d.getDay()) || s.lastRun === key) continue;
      s.lastRun = key; this.store.save();
      try { await this.run(s); diag.log('auto', `ran schedule "${s.name}" (${s.action.type})`); } catch (e) { diag.log('auto', `schedule "${s.name}" failed: ${e.message}`); }
    }
    if (this.sleep && d.getTime() >= this.sleep.at) {
      const sl = this.sleep; this.sleep = null;
      await this._stopShows();
      await this.m.applyTracked(this.m.scopeIds(sl.scope), { on: false }, 'Sleep timer'); diag.log('auto', 'sleep timer turned lights off');
    }
  }
  // Anything driving the lights (effects, a light show, projection light sync) stops first, or it would undo the change.
  async _stopShows() {
    if (this.fx.active) await this.fx.stop({ restore: false });
    if (this.m.showPlayer && this.m.showPlayer.state !== 'idle') await this.m.showPlayer.stop({ restore: false });
    if (this.m.projLights && this.m.projLights.active) await this.m.projLights.stop({ restore: false });
  }
  async run(s) {
    if (s.action && s.action.type !== 'stopEffect') await this._stopShows();
    return this._run(s);
  }
  _run(s) {
    const a = s.action, ids = () => this.m.scopeIds(a.scope);
    switch (a.type) {
      case 'scene': return this.m.applyScene(a.sceneId, a.scope);
      case 'on': return this.m.applyTracked(ids(), { on: true }, `Schedule: ${s.name}`);
      case 'off': return this.m.applyTracked(ids(), { on: false }, `Schedule: ${s.name}`);
      case 'arrangement': return this.m.applyArrangement(a.layoutId, a.arrId);
      case 'stopEffect': return this.fx.stop();
      case 'effect': // only effects that need no sound can be started without the window
        if (!MODES[a.mode] || MODES[a.mode].audio) throw new Error('Only ambient effects can be scheduled');
        return this.fx.start({ ...(this.store.data.settings.fx || {}), mode: a.mode, ids: ids() });
    }
    throw new Error('Unknown action');
  }
  setSleep(minutes, scope) {
    minutes = Number(minutes);
    if (!(minutes > 0 && minutes <= 720)) throw new Error('Choose between 1 minute and 12 hours');
    this.sleep = { at: this.now().getTime() + minutes * 60000, scope: scope && scope.type ? scope : { type: 'all' } }; this.m._emit(); return this.sleep;
  }
  cancelSleep() { this.sleep = null; this.m._emit(); }
}
module.exports = { Automation };
