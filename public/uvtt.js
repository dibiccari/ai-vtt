// Universal VTT (.dd2vtt / .uvtt / .df2vtt) reading, shared by the Map Test and Test Lab pages.
(function (root) {
  'use strict';

  var cross = function (ax, ay, bx, by) { return ax * by - ay * bx; };

  // Convert a parsed Universal VTT file to wall segments in image pixels. `scale` maps the file's image pixels to the target image.
  function toWalls(u, scale) {
    var res = u && u.resolution;
    var ppg = Number(res && res.pixels_per_grid);
    if (!(ppg > 0)) throw new Error('This is not a Universal VTT file (no pixels_per_grid).');
    var ox = Number(res.map_origin && res.map_origin.x) || 0;
    var oy = Number(res.map_origin && res.map_origin.y) || 0;
    var px = function (p) { return { x: (Number(p.x) - ox) * ppg * scale, y: (Number(p.y) - oy) * ppg * scale }; };
    var walls = [];
    var add = function (a, b, type, open) {
      if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return;
      if (type === 'wall' && Math.hypot(b.x - a.x, b.y - a.y) < 0.5) return;
      walls.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, type: type, open: open });
    };
    [].concat(u.line_of_sight || [], u.objects_line_of_sight || []).forEach(function (line) {
      if (!Array.isArray(line)) return;
      var pts = line.map(px).filter(function (p) { return Number.isFinite(p.x) && Number.isFinite(p.y); });
      // Drop points that sit on a straight run so cave outlines do not become thousands of tiny walls.
      var keep = [];
      for (var i = 0; i < pts.length; i++) {
        var a = keep[keep.length - 1], b = pts[i], c = pts[i + 1];
        if (a && c) {
          var abx = b.x - a.x, aby = b.y - a.y, bcx = c.x - b.x, bcy = c.y - b.y;
          var lens = Math.hypot(abx, aby) * Math.hypot(bcx, bcy);
          if (lens > 0 && Math.abs(cross(abx, aby, bcx, bcy)) / lens < 1e-3 && abx * bcx + aby * bcy > 0) continue;
        }
        keep.push(b);
      }
      for (var j = 0; j < keep.length - 1; j++) add(keep[j], keep[j + 1], 'wall', false);
    });
    (u.portals || []).forEach(function (p) {
      if (!p || !Array.isArray(p.bounds) || p.bounds.length < 2) return;
      add(px(p.bounds[0]), px(p.bounds[1]), 'door', p.closed === false);
    });
    return walls;
  }

  function sniffImage(bytes) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return { ext: 'png', type: 'image/png' };
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return { ext: 'jpg', type: 'image/jpeg' };
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return { ext: 'webp', type: 'image/webp' };
    return null;
  }

  // Parse the text of a Universal VTT file and check its header.
  function parse(text) {
    var u;
    try { u = JSON.parse(text); } catch (e) { throw new Error('That file is not valid JSON, so it is not a Universal VTT file.'); }
    toWalls(u, 1);
    return u;
  }

  // Upload the picture inside the file as a new map and save its walls and grid. Returns { url, walls }.
  async function importAsMap(u, baseName) {
    if (typeof u.image !== 'string' || !u.image) throw new Error('This file has no embedded picture. Use "Import walls" on a map you already have.');
    var bin = atob(u.image.replace(/^data:[^,]*,/, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var kind = sniffImage(bytes);
    if (!kind) throw new Error('The embedded picture is not a PNG, JPG or WEBP.');
    var form = new FormData();
    form.append('map', new File([bytes], (baseName || 'map') + '.' + kind.ext, { type: kind.type }));
    var up = await fetch('/api/upload', { method: 'POST', body: form });
    var upData = await up.json().catch(function () { return {}; });
    if (!up.ok) throw new Error(upData.error || 'Upload failed (HTTP ' + up.status + ')');
    var walls = toWalls(u, 1);
    var squares = Math.round(Number(u.resolution.map_size && u.resolution.map_size.x)) || 50;
    var res = await fetch('/api/map-config?map=' + encodeURIComponent(upData.url.split('/').pop()), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ squares: squares, walls: walls, source: 'dd2vtt' })
    });
    if (!res.ok) throw new Error((await res.json().catch(function () { return {}; })).error || 'Could not save the walls (HTTP ' + res.status + ')');
    return { url: upData.url, walls: walls.length, squares: squares };
  }

  var api = { toWalls: toWalls, sniffImage: sniffImage, parse: parse, importAsMap: importAsMap };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Uvtt = api;
})(typeof window !== 'undefined' ? window : globalThis);
