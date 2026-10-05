// The left rail of the Map Tools pages: Test (try out a map) and Maker (generate new maps and improve them with feedback).
// Put <script src="/maptools-rail.js"></script> where the rail should go (as a direct child of <body>, before the page's own content).
(function () {
  'use strict';
  var LINKS = [
    { href: '/map-test.html', label: 'Test', hint: 'Try a map: walls, doors, fog of war, line of sight, difficult terrain, pins' },
    { href: '/map-maker.html', label: 'Maker', hint: 'Ask for new maps and give feedback to improve them' }
  ];
  var style = document.createElement('style');
  style.textContent = [
    '.mt-rail { background:#0d1117; border-right:1px solid #2a3242; padding:14px 8px; display:flex; flex-direction:column; gap:4px; font:600 13px "Segoe UI", system-ui, sans-serif; }',
    '.mt-rail h2 { margin:0 0 8px 6px; font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:#9ba7b9; }',
    '.mt-rail a { color:#9ba7b9; text-decoration:none; padding:8px 12px; border-radius:6px; border:1px solid transparent; }',
    '.mt-rail a:hover { color:#edf1f7; border-color:#3a4558; }',
    '.mt-rail a[aria-current="page"] { color:#f0c048; background:#1f2632; border-color:#3a4558; }'
  ].join('\n');
  document.head.appendChild(style);
  var rail = document.createElement('nav');
  rail.className = 'mt-rail';
  rail.setAttribute('aria-label', 'Map tools');
  var h = document.createElement('h2');
  h.textContent = 'Map tools';
  rail.appendChild(h);
  LINKS.forEach(function (l) {
    var a = document.createElement('a');
    a.href = l.href;
    a.textContent = l.label;
    a.title = l.hint;
    if (location.pathname === l.href) a.setAttribute('aria-current', 'page');
    rail.appendChild(a);
  });
  var here = document.currentScript;
  here.parentNode.insertBefore(rail, here);
})();
