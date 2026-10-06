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
    exhaustion:    ['Exhaustion',    '#a07850', 'solid',  'Growing penalties by level; a long rest removes one level.'],
    concentrating: ['Concentrating', '#4f9dff', 'dotted', 'Holding a spell: a hit forces a Constitution save.'],
    surprised:     ['Surprised',     '#c9a0ff', 'dashed', 'Loses its first turn.'],
    disengaged:    ['Disengaged',    '#6fd0e8', 'dotted', 'Its movement this turn does not provoke opportunity attacks.']
  };

  function info(name) { return RINGS[name] || [String(name), '#4f9dff', 'solid', '']; }

  // Draw the rings of `names` around a token centred at (x, y) with radius r (pixels). `px` scales line widths (1 = normal).
  function draw(ctx, x, y, r, names, px) {
    px = px || 1;
    var list = (names || []).filter(Boolean);
    if (!list.length) return 0;
    var width = (list.length > 5 ? 2.5 : 3.5) * px, gap = 1.6 * px;
    var radius = r + 2 * px + width / 2;
    ctx.save();
    list.forEach(function (name) {
      var d = info(name), color = d[1], style = d[2];
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
      radius += width + gap;
    });
    ctx.restore();
    return radius - r;                                    // how far the rings reach beyond the token's edge
  }

  // How see-through the token itself is drawn (an invisible creature shows faintly to its own side).
  function tokenAlpha(names) {
    var list = names || [];
    if (list.indexOf('invisible') >= 0) return 0.4;
    if (list.indexOf('unconscious') >= 0 || list.indexOf('petrified') >= 0) return 0.75;
    return 1;
  }

  root.ConditionRings = { RINGS: RINGS, info: info, draw: draw, tokenAlpha: tokenAlpha };
})(window);
