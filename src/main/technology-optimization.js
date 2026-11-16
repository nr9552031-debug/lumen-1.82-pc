'use strict';
// Read-only research and dependency inventory for the Technology Optimization page.
const fs = require('fs');
const path = require('path');

function createTechnologyOptimization({ store, projectDir }) {
  const state = () => {
    const saved = store.data.technologyOptimization || (store.data.technologyOptimization = { opportunities: [], history: [], lastAudit: null });
    if (!Array.isArray(saved.opportunities)) saved.opportunities = [];
    if (!Array.isArray(saved.history)) saved.history = [];
    return saved;
  };
  const audit = () => {
    const dir = projectDir || process.cwd();
    const read = (name) => { try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch { return null; } };
    const pkg = read('package.json') || {};
    const lock = read('package-lock.json');
    const direct = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const installed = lock && lock.packages ? lock.packages : {};
    const counts = new Map();
    for (const key of Object.keys(installed)) {
      const m = key.match(/(?:^|node_modules\/)(@[^/]+\/[^/]+|[^/]+)$/);
      if (m) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
    }
    const deps = Object.keys(direct).map((name) => ({ name, range: direct[name], version: (installed['node_modules/' + name] || {}).version || null, copies: counts.get(name) || 0 }));
    const now = new Date().toISOString();
    const findings = deps.filter((d) => !d.version).map((d) => ({ title: `${d.name} is not present in the lockfile`, severity: 'info', detail: 'The dependency is declared directly but no locked version was found.' }));
    state().lastAudit = { time: now, direct: deps, findings, lockPresent: !!lock, status: lock ? 'Inventory complete; vulnerability and unused-code checks require a network/developer audit.' : 'No package lock is available in this installation.' };
    store.save();
    return state().lastAudit;
  };
  return {
    'technology:state': () => state(),
    'technology:audit': () => audit(),
    'technology:search': async (query) => {
      const q = String(query || '').trim().slice(0, 100);
      if (!q) throw new Error('Enter a GitHub search phrase');
      const url = 'https://api.github.com/search/repositories?q=' + encodeURIComponent(q + ' in:name,description') + '&sort=stars&order=desc&per_page=10';
      const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Lumen-Technology-Optimization' }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`GitHub search failed (${response.status})`);
      const data = await response.json();
      return (data.items || []).map((r) => ({ name: r.full_name, description: r.description || '', url: r.html_url, stars: r.stargazers_count, license: r.license && r.license.spdx_id || 'Unknown', updated: r.updated_at, archived: r.archived }));
    },
    'technology:settings': (patch) => { const s = state(); s.settings = { ...(s.settings || {}), ...(patch || {}) }; store.save(); return s.settings; },
    'technology:opportunity': (item) => {
      const s = state(); if (!item || !item.title) throw new Error('Opportunity title is required');
      const entry = { id: String(item.id || Date.now()), title: String(item.title).slice(0, 120), description: String(item.description || '').slice(0, 1500), status: 'pending', createdAt: new Date().toISOString() };
      s.opportunities = [entry, ...s.opportunities.filter((x) => x.id !== entry.id)].slice(0, 100); store.save(); return entry;
    },
    'technology:decision': (id, decision) => {
      const s = state(), item = s.opportunities.find((x) => x.id === String(id)); if (!item) throw new Error('Opportunity not found');
      if (!['approved', 'dismissed', 'completed'].includes(decision)) throw new Error('Invalid opportunity status');
      item.status = decision; item.updatedAt = new Date().toISOString();
      if (decision === 'approved') item.note = 'Approved for a separate development workflow; no code or dependencies were changed.';
      if (decision === 'completed') { s.history.unshift({ ...item, recordedAt: new Date().toISOString(), testResults: 'Not recorded', measurements: 'Not recorded', rollback: 'Revert the implementation commit.' }); s.history = s.history.slice(0, 100); }
      store.save(); return item;
    },
  };
}
module.exports = { createTechnologyOptimization };
