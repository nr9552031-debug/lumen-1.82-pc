'use strict';
/* The projector window: draws the current project full screen. No Lumen interface is shown here. */
(() => {
  const gl = document.getElementById('gl'), ov = document.getElementById('ov'), R = new ProjRenderer(gl);
  let project = null, audio = null, audioAt = 0, dirty = true;
  const size = () => { const k = Math.min(window.devicePixelRatio || 1, 2); for (const c of [gl, ov]) { c.width = Math.round(innerWidth * k); c.height = Math.round(innerHeight * k); } dirty = true; };
  size(); addEventListener('resize', size);
  // Calibration grid and shape outlines are drawn on a separate layer above the animations.
  function overlay() {
    const g = ov.getContext('2d'), W = ov.width, H = ov.height; g.clearRect(0, 0, W, H); dirty = false;
    if (!project || project.blackout) return;
    if (project.grid) {
      g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = Math.max(1, W / 960); g.fillStyle = '#fff'; g.font = `${Math.round(H / 45)}px Segoe UI, sans-serif`;
      for (let i = 0; i <= 16; i++) { const x = Math.min(W - 1, (i / 16) * W); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
      for (let j = 0; j <= 9; j++) { const y = Math.min(H - 1, (j / 9) * H); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      g.strokeStyle = '#ff3b3b'; g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
      g.beginPath(); g.arc(W / 2, H / 2, H / 4, 0, 7); g.stroke();
    }
    if (project.outlines || project.grid) {
      g.strokeStyle = '#00e5ff'; g.lineWidth = Math.max(2, W / 640);
      for (const r of project.regions) { g.beginPath(); r.pts.forEach(([x, y], i) => (i ? g.lineTo(x * W, y * H) : g.moveTo(x * W, y * H))); g.closePath(); g.stroke(); }
    }
  }
  window.projector.onState((p) => { project = LumenProj.project(p); project.flash = !!(p && p.flash); for (let i = 0; i < project.regions.length; i++) project.regions[i].fade = (p.regions[i] || {}).fade || 0; dirty = true; });
  window.projector.onAudio((f) => { audio = f; audioAt = performance.now(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') window.projector.exit(); });
  setTimeout(() => { document.getElementById('hint').style.opacity = 0; }, 4000);
  const loop = (t) => {
    const a = audio && performance.now() - audioAt < 500 && !(project && project.mode === 'manual') ? audio : null; // no fresh audio (or Manual mode): animations run on their own
    R.render(project, t / 1000, a, project ? LumenProj.STYLES[project.audio.style] : 1);
    if (dirty) overlay();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})();
