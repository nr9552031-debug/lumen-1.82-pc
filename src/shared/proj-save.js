/* Debounced Projection Studio saves. Snapshots are keyed by project object so switching layouts cannot
   redirect a pending write to the newly selected layout. */
(function (root) {
  'use strict';
  function createSaveQueue(write, onSaved, onError, delay = 700) {
    const pending = new Map();
    let timer = null, chain = Promise.resolve();
    function flush() {
      if (timer) { clearTimeout(timer); timer = null; }
      const batch = [...pending]; pending.clear();
      if (!batch.length) return chain;
      chain = chain.catch(() => {}).then(async () => {
        for (let i = 0; i < batch.length; i++) {
          const [owner, json] = batch[i];
          try {
            const project = JSON.parse(json);
            if (!project.id && owner.id) project.id = owner.id;
            const saved = await write(project);
            onSaved(owner, saved);
          } catch (error) {
            for (const [key, value] of batch.slice(i)) if (!pending.has(key)) pending.set(key, value);
            onError(error, owner);
            throw error;
          }
        }
      });
      return chain;
    }
    function queue(owner, project) {
      pending.set(owner, JSON.stringify(project));
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { flush().catch(() => {}); }, delay);
    }
    return { queue, flush, pending: () => pending.size };
  }
  function commitProjectPhoto(owner, photo, isCurrent, onCurrent) {
    owner.photo = photo;
    if (isCurrent(owner)) onCurrent(owner);
  }
  function runForCurrentProject(owner, isCurrent, run) {
    if (!isCurrent(owner)) return false;
    run(owner);
    return true;
  }
  const api = { createSaveQueue, commitProjectPhoto, runForCurrentProject };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LumenProjSave = api;
})(typeof window !== 'undefined' ? window : globalThis);
