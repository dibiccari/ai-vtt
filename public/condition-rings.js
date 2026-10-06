// Conditions drawn as rings around a token (shared by the Character conditions test page and, later, the tabletop).
// Each condition has a colour and a line style so several rings stay readable: solid, dashed, dotted or double. Rings are drawn outward from the token in the order given.
(function (root) {
  'use strict';

  // name: [label, colour, style, short rule]
  var RINGS = {
    blinded:       ['Blinded',       '#8e8e9a', 'solid',  "Can't see; attacks against it have advantage, its attacks have disadvantage."],
    charmed:       ['Charmed',       '#ff7ac8', 'solid',  "Can't attack the charmer; the charmer has advantage on social checks."],
    deafened:      ['Deafened',      '#9a8e7a', 'dotted', "Can't hear; fails checks that need hearing."],
    frightened:    ['Frightened',    '#b06bff', 'dashed', 'Disadvantage while the source of fear is in sight; cannot move closer to it.'],
    grappled:      ['Grappled',      '#d98a3d', 'solid',  'Speed 0.'],
    incapacitated: ['Incapacitated', '#cc5555', 'double', "Can't take actions or reactions."],
    invisible:     ['Invisible',     '#6fd0e8', 'dashed', 'Cannot be seen without magic; its attacks have advantage, attacks against it have disadvantage. The token is drawn faint.'],
    paralyzed:     ['Paralyzed',     '#e0c040', 'double', "Incapacitated, can't move or speak; attacks against it have advantage."],
    petrified:     ['Petrified',     '#9aa0a6', 'double', 'Turned to stone: incapacitated, unaware, resistant to all damage.'],
    poisoned:      ['Poisoned',      '#4cc46a', 'solid',  'Disadvantage on attack rolls and ability checks.'],
    prone:         ['Prone',         '#c08a5a', 'dotted', 'Crawls; melee attacks against it have advantage, ranged ones disadvantage.'],
    restrained:    ['Restrained',    '#d9a43d', 'dashed', 'Speed 0; attacks against it have advantage, its attacks have disadvantage.'],
    stunned:       ['Stunned',       '#f0a040', 'double', "Incapacitated, can't move; attacks against it have advantage."],
    unconscious:   ['Unconscious',   '#e05050', 'double', 'Incapacitated, unaware, falls prone; hits within 5 ft are critical.'],
    exhaustion:    ['Exhaustion',    '#a07850', 'solid',  'Growing penalties by level; a long rest removes one level.']
  };

  // Effects are not conditions: states and spell effects (concentrating, surprised, a spell like sanctuary). They are drawn as pills beside the token, not as rings.
  // The data lives in /effect-data.json (shared with the DM prompt and the tabletop); call ConditionRings.load() once before drawing effects.
  // name: [label, colour, icon, short rule, what ends it, rounds, minutes, concentration, endsOn]
  var EFFECTS = {};
  var EFFECT_ORDER = [];
  var loading = null;
  function load() {
    if (!loading) loading = fetch('/effect-data.json').then(function (r) { return r.json(); }).then(function (j) {
      Object.keys(j.effects || {}).forEach(function (name) {
        var e = j.effects[name];
        EFFECTS[name] = [e.label, e.color, e.icon, e.rule, e.ends, e.rounds || 0, e.minutes || 0, !!e.concentration, e.endsOn || ''];
      });
      EFFECT_ORDER.length = 0;
      Object.keys(EFFECTS).forEach(function (n) { EFFECT_ORDER.push(n); });
      return EFFECTS;
    });
    return loading;
  }
  // how long an effect lasts, in words
  function lasts(name) {
    var d = EFFECTS[name];
    if (!d) return '';
    var parts = [];
    if (d[5]) parts.push(d[5] + ' round' + (d[5] === 1 ? '' : 's'));
    if (d[6]) parts.push(d[6] >= 60 && d[6] % 60 === 0 ? d[6] / 60 + ' hour' + (d[6] === 60 ? '' : 's') : d[6] + ' minute' + (d[6] === 1 ? '' : 's'));
    var txt = parts.length ? parts.join(' / ') : 'until it is ended';
    return txt + (d[7] ? ', needs concentration' : '');
  }

  function info(name) { return RINGS[name] || [String(name), '#4f9dff', 'solid', '']; }
  function effectInfo(name) { return EFFECTS[name] || null; }
  function isEffect(name) { return !!EFFECTS[name]; }
  function isCondition(name) { return !!RINGS[name]; }

  // Draw the effects of `names` as pills (icon and name) stacked to the right of the token and its rings. `outer` is the radius the rings reach (token radius + what draw() returned).
  function drawEffects(ctx, x, y, outer, names, px, opts) {
    px = px || 1;
    var list = (names || []).filter(function (n) { return EFFECTS[n]; });
    if (!list.length) return 0;
    var labels = !opts || opts.labels !== false;
    var h = 15 * px, gap = 4 * px, total = list.length * h * 2 + (list.length - 1) * gap;
    var top = y - total / 2 + h, left = x + outer + 8 * px;
    ctx.save();
    list.forEach(function (n, i) {
      var d = EFFECTS[n], cy = top + i * (h * 2 + gap), cx = left + h;
      ctx.font = '700 ' + Math.round(h * 1.05) + 'px "Segoe UI", system-ui, sans-serif';
      var textW = labels ? ctx.measureText(d[0]).width : 0, pillW = h * 2 + (labels ? textW + h * 0.9 : 0);
      ctx.fillStyle = 'rgba(12, 16, 24, 0.92)';
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(left - h * 0.2, cy - h, pillW + h * 0.2, h * 2, h) : ctx.rect(left - h * 0.2, cy - h, pillW + h * 0.2, h * 2); ctx.fill();
      ctx.strokeStyle = d[1]; ctx.lineWidth = 2.2 * px; ctx.stroke();
      ctx.fillStyle = d[1]; ctx.font = '700 ' + Math.round(h * 1.25) + 'px "Segoe UI Symbol", "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(d[2], cx, cy + px * 0.5);
      if (labels) { ctx.fillStyle = '#edf1f7'; ctx.font = '700 ' + Math.round(h * 1.05) + 'px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(d[0], left + h * 1.95, cy + px * 0.5); }
    });
    ctx.restore();
    return list.length;
  }


  // Text along a circle, centred on `centre` (radians; -PI/2 is the top), reading clockwise. Shrinks to fit when the name is longer than the arc allows.
  function arcText(ctx, text, x, y, radius, centre, fontPx, color) {
    var size = fontPx;
    ctx.font = '800 ' + size + 'px "Segoe UI", system-ui, sans-serif';
    var widths = function () { return Array.prototype.map.call(text, function (ch) { return ctx.measureText(ch).width + size * 0.08; }); };
    var w = widths(), total = w.reduce(function (a, b) { return a + b; }, 0);
    var limit = radius * Math.PI * 1.7;
    if (total > limit) { size = size * limit / total; ctx.font = '800 ' + size + 'px "Segoe UI", system-ui, sans-serif'; w = widths(); total = w.reduce(function (a, b) { return a + b; }, 0); }
    var angle = centre - total / (2 * radius), done = 0;
    ctx.save();
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (var i = 0; i < text.length; i++) {
      var a = angle + (done + w[i] / 2) / radius;
      ctx.save();
      ctx.translate(x + radius * Math.cos(a), y + radius * Math.sin(a));
      ctx.rotate(a + Math.PI / 2);
      ctx.fillText(text[i], 0, 0);
      ctx.restore();
      done += w[i];
    }
    ctx.restore();
  }
  function inkFor(hex) {                                  // dark text on a light ring, light text on a dark one
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#0b0e14' : '#ffffff';
  }

  // Draw the rings of `names` around a token centred at (x, y) with radius r (pixels). `px` scales line widths (1 = normal).
  // opts.labels: each ring becomes a band with the condition's name written along it, curved with the circumference (the line style is kept on the band's edges).
  // Returns how far the rings reach beyond the token's edge.
  function draw(ctx, x, y, r, names, px, opts) {
    px = px || 1;
    var labels = !!(opts && opts.labels);
    var list = (names || []).filter(function (n) { return RINGS[n]; });
    if (!list.length) return 0;
    var width = labels ? 15 * px : (list.length > 5 ? 2.5 : 3.5) * px, gap = (labels ? 1.2 : 1.6) * px;
    var radius = r + 2 * px + width / 2;
    ctx.save();
    list.forEach(function (name, i) {
      var d = info(name), color = d[1], style = d[2];
      if (labels) {
        ctx.setLineDash([]);
        ctx.strokeStyle = color; ctx.globalAlpha = 0.93; ctx.lineWidth = width;
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
        // the line style on both edges of the band: dashed and dotted rings stay different from solid ones
        ctx.strokeStyle = 'rgba(8, 10, 14, 0.85)'; ctx.lineWidth = 1.4 * px;
        ctx.setLineDash(style === 'dashed' ? [4 * px, 3 * px] : style === 'dotted' ? [1 * px, 2.4 * px] : []);
        [radius - width / 2, radius + width / 2].forEach(function (rr) { ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.stroke(); });
        if (style === 'double') { ctx.setLineDash([]); ctx.lineWidth = 0.9 * px; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke(); }
        ctx.setLineDash([]);
        // start each name at a different place round the ring so they do not stack into one column
        var centre = -Math.PI / 2 + (i % 2 ? Math.PI : 0) * 0 + i * 0.32;
        arcText(ctx, d[0].toUpperCase(), x, y, radius, centre, width * 0.72, inkFor(color));
      } else {
        ctx.strokeStyle = color;
        ctx.lineCap = 'butt';
        if (style === 'double') {
          ctx.setLineDash([]);
          ctx.lineWidth = width * 0.42;
          ctx.beginPath(); ctx.arc(x, y, radius - width * 0.29, 0, Math.PI * 2); ctx.stroke();
          ctx.beginPath(); ctx.arc(x, y, radius + width * 0.29, 0, Math.PI * 2); ctx.stroke();
        } else {
          ctx.lineWidth = width;
          ctx.setLineDash(style === 'dashed' ? [width * 3.2, width * 2] : style === 'dotted' ? [width * 0.9, width * 1.6] : []);
          if (style === 'dotted') ctx.lineCap = 'round';
          ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
        }
      }
      radius += width + gap;
    });
    ctx.restore();
    return radius - r;
  }


  // How see-through the token itself is drawn (an invisible creature shows faintly to its own side).
  function tokenAlpha(names) {
    var list = names || [];
    if (list.indexOf('invisible') >= 0) return 0.4;
    if (list.indexOf('unconscious') >= 0 || list.indexOf('petrified') >= 0) return 0.75;
    return 1;
  }

  // What the conditions do, in the table's own rules (the same numbers as effectiveSpeed() and the blinded/unconscious sight rule in index.html).
  // base = { speed: 30, vision: 60 } in feet. Returns the speed and sight left, whether it can act, and who gets advantage or disadvantage.
  function effects(names, base) {
    var has = function (n) { return (names || []).indexOf(n) >= 0; };
    base = base || { speed: 30, vision: 60 };
    var any = function (list) { return list.filter(has); };
    var out = { speed: base.speed, vision: base.vision, canAct: true, againstAdv: [], againstDis: [], ownAdv: [], ownDis: [], lines: [] };
    // speed
    var stopped = any(['grappled', 'restrained', 'paralyzed', 'petrified', 'stunned', 'unconscious', 'surprised']);
    if (stopped.length) { out.speed = 0; out.lines.push('Speed 0 ft (' + stopped.join(', ') + ').'); }
    else if (has('prone')) { out.speed = Math.floor(base.speed / 2); out.lines.push('Speed ' + out.speed + ' ft: crawling (prone).'); }
    // sight: a blinded or unconscious character feels only their own square (1 ft)
    var blind = any(['blinded', 'unconscious']);
    if (blind.length) { out.vision = 1; out.lines.push('Sight 1 ft: feels only its own square (' + blind.join(', ') + ').'); }
    // actions
    var cannot = any(['incapacitated', 'paralyzed', 'petrified', 'stunned', 'unconscious']);
    if (cannot.length) { out.canAct = false; out.lines.push("Can't take actions or reactions (" + cannot.join(', ') + ').'); }
    // attacks against it
    out.againstAdv = any(['blinded', 'paralyzed', 'petrified', 'restrained', 'stunned', 'unconscious']);
    if (has('prone')) out.againstAdv.push('prone (melee within 5 ft)');
    out.againstDis = any(['invisible']);
    if (has('prone')) out.againstDis.push('prone (ranged)');
    // its own attacks
    out.ownAdv = any(['invisible']);
    out.ownDis = any(['blinded', 'frightened', 'poisoned', 'prone', 'restrained']);
    if (out.againstAdv.length) out.lines.push('Attacks against it have advantage (' + out.againstAdv.join(', ') + ').');
    if (out.againstDis.length) out.lines.push('Attacks against it have disadvantage (' + out.againstDis.join(', ') + ').');
    if (out.ownAdv.length) out.lines.push('Its attacks have advantage (' + out.ownAdv.join(', ') + ').');
    if (out.ownDis.length) out.lines.push('Its attacks have disadvantage (' + out.ownDis.join(', ') + ').');
    if (has('frightened')) out.lines.push('Cannot willingly move closer to what frightens it.');
    if (has('charmed')) out.lines.push("Can't attack the one who charmed it.");
    if (has('deafened')) out.lines.push('Fails anything that needs hearing.');
    if (has('exhaustion')) out.lines.push('Exhaustion: penalties grow by level (see the Party page).');
    (names || []).forEach(function (n) { if (EFFECTS[n]) out.lines.push(EFFECTS[n][0] + ': ' + EFFECTS[n][3] + ' (lasts ' + lasts(n) + ').'); });
    if (has('invisible')) out.lines.push('Not seen by the other side without magic or special senses.');
    return out;
  }

  root.ConditionRings = { RINGS: RINGS, EFFECTS: EFFECTS, EFFECT_ORDER: EFFECT_ORDER, load: load, lasts: lasts, info: info, effectInfo: effectInfo, isEffect: isEffect, isCondition: isCondition, draw: draw, drawEffects: drawEffects, tokenAlpha: tokenAlpha, effects: effects };
})(window);
