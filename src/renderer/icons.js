'use strict';
/* Icon set for the Aero interface: original glossy icons drawn as one inline SVG sprite.
   Everything is defined once here and referenced with ico('name'), so gradients are shared and
   nothing is loaded from disk or the network. */
(function () {
  const lg = (id, stops, extra = 'x1="0" y1="0" x2="0" y2="1"') => `<linearGradient id="${id}" ${extra}>${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a !== undefined ? ` stop-opacity="${a}"` : ''}/>`).join('')}</linearGradient>`;
  const rg = (id, stops, extra = 'cx=".36" cy=".3" r=".8"') => `<radialGradient id="${id}" ${extra}>${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</radialGradient>`;
  const defs = [
    lg('g-blue', [[0, '#9ad6ff'], [0.5, '#2f86db'], [1, '#0d4a9c']]),
    lg('g-sky', [[0, '#eaf7ff'], [1, '#8ccbf3']]),
    lg('g-silver', [[0, '#ffffff'], [0.5, '#cfd7e0'], [1, '#8b98a8']]),
    lg('g-steel', [[0, '#f6f9fc'], [1, '#aab7c6']]),
    lg('g-green', [[0, '#c9f79a'], [0.5, '#4cc01f'], [1, '#1c7c0c']]),
    lg('g-red', [[0, '#ffb9a8'], [0.5, '#e2432c'], [1, '#9b1708']]),
    lg('g-gold', [[0, '#fff5b8'], [0.5, '#f7bd27'], [1, '#bb7a00']]),
    lg('g-wood', [[0, '#eebf86'], [1, '#a5642a']]),
    lg('g-paper', [[0, '#ffffff'], [1, '#dde6f0']]),
    lg('g-dark', [[0, '#5d6b7c'], [1, '#232c38']]),
    lg('g-gloss', [[0, '#ffffff', 0.9], [1, '#ffffff', 0]]),
    lg('g-flame', [[0, '#fff7c2'], [0.5, '#ffb52e'], [1, '#e8590c']]),
    rg('g-orb', [[0, '#c9ecff'], [0.5, '#3a92e2'], [1, '#0a3d88']]),
    rg('g-orb-green', [[0, '#d9ffc0'], [0.5, '#4cc01f'], [1, '#14600a']]),
    rg('g-orb-red', [[0, '#ffd3c8'], [0.5, '#e2432c'], [1, '#86110a']]),
    rg('g-orb-silver', [[0, '#ffffff'], [0.55, '#c3ccd6'], [1, '#77828f']]),
  ].join('');
  const gloss = '<ellipse cx="16" cy="9.5" rx="10" ry="6" fill="url(#g-gloss)"/>';
  const orb = (g) => `<circle cx="16" cy="16" r="13.5" fill="url(#${g})" stroke="rgba(0,0,0,.45)"/>${gloss}`;
  const S = {
    // application mark: a glass orb with a lit lamp inside
    lumen: `${orb('g-orb')}<path d="M16 7.5c-3.3 0-5.8 2.5-5.8 5.6 0 2 1 3.3 2 4.5.6.8 1 1.4 1.1 2.4h5.4c.1-1 .5-1.6 1.1-2.4 1-1.2 2-2.5 2-4.5 0-3.1-2.500-5.600-5.8-5.600z" fill="#fffbe0" stroke="#fff" stroke-width=".6"/><rect x="13.3" y="20.6" width="5.4" height="3.2" rx=".8" fill="#eef4fa" stroke="#3b5878" stroke-width=".6"/>`,
    // light bulb whose glass takes the light's real colour (currentColor)
    bulb: `<path d="M16 3c-5.500 0-9.500 4.100-9.500 9.200 0 3.3 1.700 5.500 3.200 7.400 1 1.300 1.600 2.300 1.800 3.900h9c.2-1.600.8-2.600 1.800-3.900 1.500-1.900 3.200-4.100 3.200-7.400C25.500 7.100 21.500 3 16 3z" fill="currentColor" stroke="rgba(0,0,0,.42)"/><path d="M16 4.600c-4.500 0-7.800 3.300-7.800 7.500 0 1.100.2 2.100.7 3C9.900 9.700 13 7.100 17.400 6.400c1.500-.2 3-.1 4.200.3-1.400-1.300-3.300-2.100-5.600-2.100z" fill="#fff" opacity=".7"/><rect x="11.500" y="23.500" width="9" height="5" rx="1" fill="url(#g-silver)" stroke="#5f6b78" stroke-width=".8"/><path d="M11.500 25.300h9M11.500 27h9" stroke="#5f6b78" stroke-width=".7"/><path d="M13.500 28.500h5l-1 1.900h-3z" fill="#4a535e"/>`,
    home: `<path d="M16 4 3.500 15h3.500v12h18V15h3.500z" fill="url(#g-paper)" stroke="#4b6a8f"/><path d="M16 2.800 2.200 15h4.300L16 6.600 25.500 15h4.300z" fill="url(#g-blue)" stroke="#0d3f80" stroke-width=".8"/><rect x="13" y="18" width="6" height="9" fill="url(#g-wood)" stroke="#6b3f17" stroke-width=".7"/><rect x="20.500" y="17" width="3.500" height="3.500" fill="#fff3a6" stroke="#4b6a8f" stroke-width=".7"/>`,
    room: `<rect x="7" y="3" width="18" height="26" rx="1" fill="url(#g-steel)" stroke="#55677c"/><path d="M9.500 5.500 21 7.500v19l-11.500 2z" fill="url(#g-wood)" stroke="#6b3f17" stroke-width=".8"/><circle cx="18.300" cy="17" r="1.300" fill="url(#g-gold)" stroke="#7a5200" stroke-width=".5"/>`,
    group: `<circle cx="11.500" cy="13" r="8" fill="url(#g-orb)" stroke="rgba(0,0,0,.45)"/><circle cx="21" cy="19.500" r="8" fill="url(#g-orb-green)" stroke="rgba(0,0,0,.45)"/><ellipse cx="11.500" cy="9" rx="5.500" ry="3.200" fill="url(#g-gloss)"/><ellipse cx="21" cy="15.500" rx="5.500" ry="3.200" fill="url(#g-gloss)"/>`,
    scenes: `<rect x="3" y="6" width="26" height="20" rx="1.500" fill="url(#g-paper)" stroke="#55677c"/><rect x="5.500" y="8.500" width="21" height="15" fill="url(#g-sky)" stroke="#6f8cab" stroke-width=".6"/><circle cx="21.500" cy="12.500" r="2.300" fill="url(#g-gold)"/><path d="M5.500 23.500 12 14.500l4.500 6 3-3.500 7 6.500z" fill="url(#g-green)"/>`,
    fx: `<path d="M12 6.500 25 4v15.300" fill="none" stroke="url(#g-blue)" stroke-width="2.600"/><path d="M12 6.500v15.800" stroke="#1f6fc4" stroke-width="2.600"/><ellipse cx="9" cy="23" rx="4.300" ry="3.300" fill="url(#g-orb)" stroke="rgba(0,0,0,.45)" stroke-width=".8"/><ellipse cx="22" cy="20" rx="4.300" ry="3.300" fill="url(#g-orb)" stroke="rgba(0,0,0,.45)" stroke-width=".8"/>`,
    settings: `<path d="M13.700 3h4.600l.7 3.300 2.300 1 2.900-1.900 3.200 3.300-1.800 2.900.9 2.300 3.300.7v4.600l-3.300.7-.9 2.300 1.800 2.900-3.200 3.300-2.900-1.900-2.300 1-.7 3.300h-4.600l-.7-3.300-2.300-1-2.900 1.900-3.200-3.300 1.800-2.900-.9-2.300L2.200 21v-4.600l3.300-.7.9-2.300-1.800-2.900 3.200-3.300 2.900 1.900 2.300-1z" transform="translate(0 -2.700)" fill="url(#g-silver)" stroke="#55677c"/><circle cx="16" cy="16" r="4.600" fill="url(#g-orb)" stroke="#24476f"/>`,
    scan: `<circle cx="13" cy="13" r="8.500" fill="url(#g-sky)" stroke="#3f5f85" stroke-width="2.200"/><ellipse cx="11.500" cy="10" rx="4.500" ry="2.600" fill="url(#g-gloss)"/><path d="m19.500 19.500 8 8" stroke="url(#g-wood)" stroke-width="4.200" stroke-linecap="round"/><path d="m19.500 19.500 8 8" stroke="#6b3f17" stroke-width=".8" stroke-linecap="round" fill="none" transform="translate(1.400 -1.400)" opacity=".5"/>`,
    power: `<path d="M16 5v11" stroke="currentColor" stroke-width="3.400" stroke-linecap="round" fill="none"/><path d="M9.800 9.300a9.500 9.500 0 1 0 12.400 0" stroke="currentColor" stroke-width="3.400" stroke-linecap="round" fill="none"/>`,
    info: `${orb('g-orb')}<circle cx="16" cy="9.800" r="2" fill="#fff"/><path d="M13 14h4.300v9H19v2h-6v-2h1.600v-7H13z" fill="#fff"/>`,
    warn: `<path d="M16 3 30 28H2z" fill="url(#g-gold)" stroke="#8a5a00" stroke-linejoin="round"/><path d="M16 6.500 26.500 26h-21z" fill="url(#g-gloss)" opacity=".45"/><path d="M14.700 12h2.600l-.5 8.500h-1.600z" fill="#3a2a00"/><circle cx="16" cy="23.300" r="1.500" fill="#3a2a00"/>`,
    error: `${orb('g-orb-red')}<path d="m11 11 10 10M21 11 11 21" stroke="#fff" stroke-width="3.400" stroke-linecap="round"/>`,
    ok: `${orb('g-orb-green')}<path d="m9.500 16.500 4.500 4.500 8.500-10" stroke="#fff" stroke-width="3.400" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
    off: `${orb('g-orb-silver')}<path d="M10 16h12" stroke="#fff" stroke-width="3.400" stroke-linecap="round"/>`,
    plus: `<path d="M13 4h6v9h9v6h-9v9h-6v-9H4v-6h9z" fill="url(#g-green)" stroke="#16610a" stroke-linejoin="round"/><path d="M13.800 5h4.400v9H27v2H5v-2h8.800z" fill="url(#g-gloss)" opacity=".6"/>`,
    del: `<path d="m8 4 8 8 8-8 4 4-8 8 8 8-4 4-8-8-8 8-4-4 8-8-8-8z" fill="url(#g-red)" stroke="#7d1206" stroke-linejoin="round"/>`,
    rename: `<path d="M5 22.500 20.500 7l4.500 4.500L9.500 27 4 28z" fill="url(#g-gold)" stroke="#8a5a00" stroke-linejoin="round"/><path d="m20.500 7 2.200-2.200a2 2 0 0 1 2.800 0l1.700 1.700a2 2 0 0 1 0 2.800L25 11.500z" fill="url(#g-red)" stroke="#7d1206" stroke-width=".8"/><path d="M5 22.500 9.500 27 4 28z" fill="#3a2a00"/>`,
    copy: `<rect x="5" y="3" width="15" height="19" rx="1" fill="url(#g-paper)" stroke="#55677c"/><rect x="12" y="10" width="15" height="19" rx="1" fill="url(#g-paper)" stroke="#55677c"/><path d="M15 15h9M15 18.500h9M15 22h6" stroke="#7f93aa" stroke-width="1.300"/>`,
    report: `<rect x="6" y="3" width="20" height="26" rx="1.500" fill="url(#g-paper)" stroke="#55677c"/><path d="M9 20h3l2-7 3 11 2.500-8 1.500 4h2" fill="none" stroke="url(#g-blue)" stroke-width="1.800" stroke-linejoin="round"/><path d="M9.500 8h13M9.500 11h9" stroke="#7f93aa" stroke-width="1.300"/>`,
    wifi: `<path d="M4 13a17 17 0 0 1 24 0" fill="none" stroke="url(#g-blue)" stroke-width="3.200" stroke-linecap="round"/><path d="M8.500 17.500a10.600 10.600 0 0 1 15 0" fill="none" stroke="url(#g-blue)" stroke-width="3.200" stroke-linecap="round"/><path d="M12.800 21.800a4.500 4.500 0 0 1 6.400 0" fill="none" stroke="url(#g-blue)" stroke-width="3.200" stroke-linecap="round"/><circle cx="16" cy="26" r="2.300" fill="url(#g-orb)" stroke="#0d3f80" stroke-width=".7"/>`,
    cloud: `<path d="M9.500 25a6.500 6.500 0 0 1-.9-12.900 8.500 8.500 0 0 1 16.300 1.700A5.700 5.700 0 0 1 23.500 25z" fill="url(#g-sky)" stroke="#3f6a99"/><path d="M10 14.500a7 7 0 0 1 13-1.500c-4-2-9-1.500-13 1.500z" fill="#fff" opacity=".8"/>`,
    relay: `<path d="M9.500 21a6 6 0 0 1-.8-11.900 8 8 0 0 1 15.300 1.600A5.300 5.300 0 0 1 22.700 21z" fill="url(#g-sky)" stroke="#3f6a99"/><path d="M11 26h10M16 21v5" stroke="#3f6a99" stroke-width="1.600"/><circle cx="16" cy="27" r="2.300" fill="url(#g-orb-green)" stroke="#14600a" stroke-width=".7"/><circle cx="8.500" cy="27" r="1.800" fill="url(#g-orb)" stroke="#0d3f80" stroke-width=".6"/><circle cx="23.500" cy="27" r="1.800" fill="url(#g-orb)" stroke="#0d3f80" stroke-width=".6"/>`,
    play: `${orb('g-orb-green')}<path d="M12.500 9.500 23 16l-10.500 6.500z" fill="#fff"/>`,
    stop: `${orb('g-orb-red')}<rect x="10.500" y="10.500" width="11" height="11" rx="1" fill="#fff"/>`,
    // effect modes
    pulse: `${orb('g-orb')}<path d="M4.500 17h5l2.500-7 4 13 3-9 1.500 3h7" fill="none" stroke="#fff" stroke-width="2.200" stroke-linejoin="round" stroke-linecap="round"/>`,
    spectrum: `<rect x="2.500" y="4" width="27" height="24" rx="2" fill="url(#g-dark)" stroke="#111922"/><rect x="5.500" y="15" width="3.600" height="10" fill="#57c8ff"/><rect x="10.500" y="9" width="3.600" height="16" fill="#6fe07a"/><rect x="15.500" y="12" width="3.600" height="13" fill="#ffe25a"/><rect x="20.500" y="17" width="3.600" height="8" fill="#ff9a3d"/><rect x="25" y="20" width="2.500" height="5" fill="#ff5a5a"/><rect x="3.500" y="5" width="25" height="9" rx="1.500" fill="url(#g-gloss)" opacity=".25"/>`,
    party: `<path d="m16 2 3.300 8.200 8.800-1.200-5.500 7 5.500 7-8.800-1.200L16 30l-3.300-8.200-8.800 1.200 5.500-7-5.500-7 8.800 1.200z" fill="url(#g-gold)" stroke="#8a5a00" stroke-linejoin="round"/><circle cx="16" cy="16" r="4.500" fill="url(#g-orb-red)" stroke="#86110a" stroke-width=".7"/>`,
    screen: `<rect x="3" y="4" width="26" height="18" rx="1.500" fill="url(#g-dark)" stroke="#111922"/><rect x="5.500" y="6.500" width="21" height="13" fill="url(#g-blue)"/><path d="M5.500 6.500h21v5c-7 0-14 2-21 6z" fill="#fff" opacity=".28"/><path d="M13 22h6l1 4h-8z" fill="url(#g-silver)" stroke="#55677c" stroke-width=".7"/><rect x="9" y="26" width="14" height="2.500" rx="1" fill="url(#g-silver)" stroke="#55677c" stroke-width=".7"/>`,
    aurora: `<rect x="2.500" y="4" width="27" height="24" rx="2" fill="#0b2347" stroke="#06152c"/><path d="M4 22c5-9 8 2 12-6s7-3 12-9" fill="none" stroke="#5dffb0" stroke-width="3" stroke-linecap="round" opacity=".9"/><path d="M4 25c6-7 9 2 13-4s6-3 11-7" fill="none" stroke="#67c7ff" stroke-width="2.400" stroke-linecap="round" opacity=".85"/><rect x="3.500" y="5" width="25" height="8" rx="1.500" fill="url(#g-gloss)" opacity=".18"/>`,
    candle: `<path d="M16 2.500c3 3.500 4.500 6 4.500 8.300a4.500 4.500 0 0 1-9 0c0-2.300 1.500-4.800 4.500-8.300z" fill="url(#g-flame)" stroke="#b34700" stroke-width=".7"/><path d="M16 12v3" stroke="#3a2a00" stroke-width="1.200"/><rect x="11.500" y="15" width="9" height="14" rx="1.200" fill="url(#g-paper)" stroke="#8c7a5a"/><path d="M12.500 16h3v12h-3z" fill="#fff" opacity=".7"/>`,
    // white glyphs laid over a scene's colour orb
    's-game': `<path d="M9 12h14a5 5 0 0 1 5 5v2.500a3 3 0 0 1-5.600 1.500L21.500 19h-11l-.9 2a3 3 0 0 1-5.600-1.500V17a5 5 0 0 1 5-5z" fill="#fff"/><path d="M9.800 14v4M7.800 16h4" stroke="#3a4a66" stroke-width="1.400"/><circle cx="21.300" cy="15" r="1.100" fill="#3a4a66"/><circle cx="23.800" cy="17" r="1.100" fill="#3a4a66"/>`,
    's-movie': `<path d="M5 13h22v12H5z" fill="#fff"/><path d="m5 12.500 21.500-4.500.9 3.900L5.900 16.300z" fill="#fff"/><path d="m9 11.700 2.500 3.400M14.500 10.500 17 14M20 9.400l2.500 3.400" stroke="#3a4a66" stroke-width="1.500"/>`,
    's-relax': `<path d="M10 9.500h12a2.500 2.500 0 0 1 2.500 2.500v3.800h-17V12a2.500 2.500 0 0 1 2.500-2.500z" fill="#fff"/><path d="M5 14.500a2 2 0 0 1 4 0V18h14v-3.500a2 2 0 0 1 4 0V22.500H5z" fill="#fff" stroke="#3a4a66" stroke-width=".9"/><path d="M7.500 22.500V25M24.500 22.500V25" stroke="#fff" stroke-width="2.200" stroke-linecap="round"/>`,
    's-read': `<path d="M16 10.500c-3-2-6.500-2.300-10-1.500v13.500c3.500-.8 7-.5 10 1.500 3-2 6.500-2.300 10-1.500V9c-3.500-.8-7-.5-10 1.500z" fill="#fff"/><path d="M16 10.500V24" stroke="#3a4a66" stroke-width="1.200"/>`,
    's-night': `<path d="M20.500 6.500a10 10 0 1 0 5 16.300A8.500 8.500 0 0 1 20.500 6.500z" fill="#fff"/>`,
    's-star': `<path d="m16 6 2.900 6.400 7 .8-5.200 4.700 1.400 6.900L16 21.300l-6.100 3.500 1.400-6.900L6.100 13.200l7-.8z" fill="#fff"/>`,
    // window buttons
    'cap-min': `<rect x="9" y="18" width="14" height="4.500" fill="#fff" stroke="#3a4350" stroke-width="1.200"/>`,
    'cap-max': `<path d="M8 8h16v15H8zM11 12.500v7.500h10v-7.500z" fill="#fff" fill-rule="evenodd" stroke="#3a4350" stroke-width="1.200"/>`,
    'cap-restore': `<path d="M12 6h13v12h-3.500v-7.500H12zM7 12h13v13H7zM10 16v6h7v-6z" fill="#fff" fill-rule="evenodd" stroke="#3a4350" stroke-width="1.200"/>`,
    'cap-close': `<path d="m9.500 8 6.500 5.800L22.500 8l3 3-6.200 5 6.200 5-3 3-6.500-5.800L9.500 24l-3-3 6.200-5-6.200-5z" fill="#fff" stroke="#5a1a12" stroke-width="1.100" stroke-linejoin="round"/>`,
  };
  const sprite = `<svg id="iconSprite" width="0" height="0" aria-hidden="true" style="position:absolute"><defs>${defs}</defs>${Object.keys(S).map((k) => `<symbol id="i-${k}" viewBox="0 0 32 32">${S[k]}</symbol>`).join('')}</svg>`;
  // Icon markup: ico('bulb', 32, 'extra-class', 'color:#ffaa00')
  window.ico = (name, size = 16, cls = '', style = '') => `<svg class="ico ${cls}" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"${style ? ` style="${style}"` : ''}><use href="#i-${S[name] ? name : 'info'}"/></svg>`;
  window.mountIcons = () => { if (!document.getElementById('iconSprite')) document.body.insertAdjacentHTML('afterbegin', sprite); };
})();
