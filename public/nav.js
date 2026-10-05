// Shared top navigation for every AI-VTT page. Add a page by adding one line to PAGES.
(function () {
  'use strict';
  var PAGES = [
    { href: '/campaigns.html', label: '📖 Campaigns' },
    { href: '/', label: '🎲 Tabletop' },
    { href: '/bestiary.html', label: '🐉 Bestiary' },
    { href: '/spells.html', label: '✨ Spells' },
    { href: '/characters.html', label: '📜 Character Sheets' },
    { href: '/map-test.html', label: '🗺 Map Test' },
    { href: '/tokens.html', label: '🧿 Tokens' },
    { href: '/test-lab.html', label: '🧪 Test Lab' },
    { href: '/voice-test.html', label: '🔊 Voice Test' },
    { href: '/sound-test.html', label: '🎵 Sound Test' },
    { href: '/settings.html', label: '⚙ Settings' }
  ];

  // A tiny emoji favicon so browsers stop asking for /favicon.ico.
  if (!document.querySelector('link[rel~="icon"]')) {
    var icon = document.createElement('link');
    icon.rel = 'icon';
    icon.href = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🎲</text></svg>');
    document.head.appendChild(icon);
  }

  // Embedded in the tabletop's sidebar (?embed=1): no navigation bar.
  if (/[?&]embed=1/.test(location.search)) { document.documentElement.classList.add('embed'); return; }

  var here = location.pathname === '/index.html' ? '/' : location.pathname;

  var style = document.createElement('style');
  style.textContent = [
    '.vtt-nav { display:flex; align-items:center; gap:4px; padding:6px 12px; background:#0d1117; border-bottom:1px solid #2a3242;',
    '  position:sticky; top:0; z-index:40; font:600 13px "Segoe UI", system-ui, sans-serif; overflow-x:auto; white-space:nowrap; }',
    '.vtt-nav a { color:#9ba7b9; text-decoration:none; padding:6px 12px; border-radius:6px; border:1px solid transparent; }',
    '.vtt-nav a:hover { color:#edf1f7; border-color:#3a4558; }',
    '.vtt-nav a[aria-current="page"] { color:#f0c048; background:#1f2632; border-color:#3a4558; }',
    '.vtt-nav a:focus-visible { outline:2px solid #4f9dff; outline-offset:2px; }',
    'body > .vtt-nav { grid-column:1 / -1; }'
  ].join('\n');
  document.head.appendChild(style);

  var nav = document.createElement('nav');
  nav.className = 'vtt-nav';
  nav.setAttribute('aria-label', 'Pages');


  PAGES.forEach(function (p) {
    var a = document.createElement('a');
    a.href = p.href;
    a.textContent = p.label;
    if (p.href === here) a.setAttribute('aria-current', 'page');
    nav.appendChild(a);
  });

  document.body.insertBefore(nav, document.body.firstChild);
})();
