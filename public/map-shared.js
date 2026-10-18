// What the tabletop and the Map Test page share about a map's light and time of day, so the DM reviewing a map sees what the table sees (window.MapShared):
// the time of day (day, dawn, dusk, night: the AI DM sets it on the table) and the light it gives a zone that follows it, the lit part of a map with light zones, and the night wash.
(function (root) {
  'use strict';
  var TIMES = ['day', 'dawn', 'dusk', 'night'];
  var WASH = { night: 'rgba(8, 16, 52, 0.52)', dusk: 'rgba(70, 40, 70, 0.22)', dawn: 'rgba(90, 60, 70, 0.18)' };
  var LABEL = { day: 'Day', dawn: 'Dawn', dusk: 'Dusk', night: 'Night' };

  // Bright by day, dim at dawn and dusk, dark at night.
  function timeLevel(time) { return time === 'night' ? 'dark' : time === 'dawn' || time === 'dusk' ? 'dim' : 'bright'; }
  // A zone's light now: a fixed one, or (level 'time') the one the time of day gives.
  function zoneLevel(zone, time) { return zone.level === 'time' ? timeLevel(time) : zone.level; }
  // The light at a point: the last zone that holds it wins, else the map's own level.
  function levelAt(zones, base, time, x, y, inside) {
    for (var i = (zones || []).length - 1; i >= 0; i--) if (inside(zones[i].points, x, y)) return zoneLevel(zones[i], time);
    return base;
  }
  function anyDark(zones, baseLevel, time) {
    if (baseLevel === 'dark') return true;
    return (zones || []).some(function (z) { return zoneLevel(z, time) === 'dark'; });
  }
  function path(x, pts) { x.beginPath(); x.moveTo(pts[0].x, pts[0].y); for (var i = 1; i < pts.length; i++) x.lineTo(pts[i].x, pts[i].y); x.closePath(); }
  function blank(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  // One remembered picture per kind of canvas, rebuilt when the zones, the base light, the time of day or the size change.
  var caches = {};
  function cached(name, key, build) {
    var c = caches[name];
    if (!c || c.key !== key) caches[name] = c = { key: key, canvas: build() };
    return c.canvas;
  }
  var stamp = function (zones) { return JSON.stringify((zones || []).map(function (z) { return [z.id, z.level, z.points]; })); };

  // White where the ground is lit: the whole map unless its own light is dark, then each zone in order (dark ones cleared, the rest filled).
  function litRegion(zones, baseDark, time, w, h) {
    return cached('lit', [w, h, baseDark, time, stamp(zones)].join('|'), function () {
      var c = blank(w, h), x = c.getContext('2d'); x.fillStyle = '#fff';
      if (!baseDark) x.fillRect(0, 0, w, h);
      zones.forEach(function (z) { x.globalCompositeOperation = zoneLevel(z, time) === 'dark' ? 'destination-out' : 'source-over'; path(x, z.points); x.fill(); });
      return c;
    });
  }
  // The night wash: a dark blue tint over everything whose light follows the time of day: the whole picture unless the map is dark by itself, and the zones that follow the time;
  // a zone with a fixed light keeps it. Null by day.
  function nightWash(zones, baseDark, time, w, h) {
    var colour = WASH[time];
    if (!colour) return null;
    return cached('wash', [w, h, baseDark, time, stamp(zones), (zones || []).map(function (z) { return z.level; }).join(',')].join('|'), function () {
      var c = blank(w, h), x = c.getContext('2d'); x.fillStyle = colour;
      if (!baseDark) x.fillRect(0, 0, w, h);
      (zones || []).forEach(function (z) { x.globalCompositeOperation = z.level === 'time' ? 'source-over' : 'destination-out'; x.fillStyle = z.level === 'time' ? colour : '#000'; path(x, z.points); x.fill(); });
      return c;
    });
  }
  root.MapShared = { TIMES: TIMES, LABEL: LABEL, WASH: WASH, timeLevel: timeLevel, zoneLevel: zoneLevel, levelAt: levelAt, anyDark: anyDark, litRegion: litRegion, nightWash: nightWash };
})(window);
