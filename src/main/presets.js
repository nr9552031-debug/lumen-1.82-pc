'use strict';
// color: {rgb:[r,g,b]} or {kelvin:n}.  brightness 1-100.
const PRESETS = [
  { id: 'preset-gaming', name: 'Gaming',  icon: '🎮', builtin: true, entry: { on: true, brightness: 60,  rgb: [110, 40, 255] } },
  { id: 'preset-movie',  name: 'Movie',   icon: '🎬', builtin: true, entry: { on: true, brightness: 15,  kelvin: 2200 } },
  { id: 'preset-relax',  name: 'Relax',   icon: '🛋️', builtin: true, entry: { on: true, brightness: 45,  kelvin: 2400 } },
  { id: 'preset-reading',name: 'Reading', icon: '📖', builtin: true, entry: { on: true, brightness: 90,  kelvin: 4000 } },
  { id: 'preset-night',  name: 'Night',   icon: '🌙', builtin: true, entry: { on: true, brightness: 8,   kelvin: 2200 } },
];
module.exports = { PRESETS };
