/* Projection Studio audio source policy. Kept pure so platform fallback behavior can be tested without capture hardware. */
(function (root) {
  'use strict';
  function fallbackSource(platform, requested, error) {
    return platform === 'darwin' && requested === 'system' && error && error.noTrack ? 'mic' : requested;
  }
  const api = { fallbackSource };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LumenProjAudio = api;
})(typeof window !== 'undefined' ? window : globalThis);
