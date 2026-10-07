// Shared top navigation for every AI-VTT page. Add a page by adding one line to PAGES.
(function () {
  'use strict';
  // A page is { href, label }; a group is { label, items: [pages] } and shows as a drop-down.
  var PAGES = [
    { href: '/campaigns.html', label: '📖 Campaigns' },
    { href: '/', label: '🎲 Tabletop' },
    { label: '📚 Library', items: [
      { href: '/characters.html', label: '📜 Character Sheets' },
      { href: '/bestiary.html', label: '🐉 Bestiary' },
      { href: '/spells.html', label: '✨ Spells' },
      { href: '/tokens.html', label: '🧿 Tokens' },
      { href: '/market.html', label: '🛒 Market' }
    ] },
    { label: '🛠 Tools', items: [
      { href: '/maps.html', label: '🗺 Maps' },
      { href: '/map-test.html', label: '🗺 Map Test' },
      { href: '/test-lab.html', label: '🧪 Test Lab' },
      { href: '/voice-test.html', label: '🔊 Voice Test' },
      { href: '/sound-test.html', label: '🎵 Sound Test' },
      { href: '/conditions-test.html', label: '🎭 Character conditions' }
    ] },
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
    '.vtt-nav button.group { font:inherit; color:#9ba7b9; background:transparent; cursor:pointer; padding:6px 12px; border-radius:6px; border:1px solid transparent; }',
    '.vtt-nav button.group:hover, .vtt-nav button.group[aria-expanded="true"] { color:#edf1f7; border-color:#3a4558; }',
    '.vtt-nav button.group.here { color:#f0c048; background:#1f2632; border-color:#3a4558; }',
    '.vtt-menu { position:fixed; z-index:60; min-width:190px; background:#0d1117; border:1px solid #3a4558; border-radius:8px; padding:4px; box-shadow:0 8px 24px rgba(0,0,0,.5); font:600 13px "Segoe UI", system-ui, sans-serif; }',
    '.vtt-menu a { display:block; color:#9ba7b9; text-decoration:none; padding:7px 12px; border-radius:6px; }',
    '.vtt-menu a:hover { color:#edf1f7; background:#1f2632; }',
    '.vtt-menu a[aria-current="page"] { color:#f0c048; }',
    'body > .vtt-nav { grid-column:1 / -1; }'
  ].join('\n');
  document.head.appendChild(style);

  var nav = document.createElement('nav');
  nav.className = 'vtt-nav';
  nav.setAttribute('aria-label', 'Pages');


  var menu = null;
  function closeMenu() { if (menu) { menu.remove(); menu = null; } nav.querySelectorAll('button.group').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); }); }
  document.addEventListener('click', function (e) { if (menu && !e.target.closest('.vtt-menu') && !e.target.closest('button.group')) closeMenu(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });

  PAGES.forEach(function (p) {
    if (p.items) {
      var g = document.createElement('button');
      g.type = 'button';
      g.className = 'group' + (p.items.some(function (i) { return i.href === here; }) ? ' here' : '');
      g.textContent = p.label + ' ▾';
      g.setAttribute('aria-haspopup', 'true');
      g.setAttribute('aria-expanded', 'false');
      g.addEventListener('click', function () {
        var wasOpen = g.getAttribute('aria-expanded') === 'true';
        closeMenu();
        if (wasOpen) return;
        g.setAttribute('aria-expanded', 'true');
        menu = document.createElement('div');
        menu.className = 'vtt-menu';
        menu.setAttribute('role', 'menu');
        p.items.forEach(function (i) {
          var a = document.createElement('a');
          a.href = i.href;
          a.textContent = i.label;
          a.setAttribute('role', 'menuitem');
          if (i.href === here) a.setAttribute('aria-current', 'page');
          menu.appendChild(a);
        });
        var box = g.getBoundingClientRect();
        menu.style.left = box.left + 'px';
        menu.style.top = (box.bottom + 4) + 'px';
        document.body.appendChild(menu);
      });
      nav.appendChild(g);
      return;
    }
    var a = document.createElement('a');
    a.href = p.href;
    a.textContent = p.label;
    if (p.href === here) a.setAttribute('aria-current', 'page');
    nav.appendChild(a);
  });

  document.body.insertBefore(nav, document.body.firstChild);
})();
