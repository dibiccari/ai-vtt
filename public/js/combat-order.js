// Pure turn-order helpers for the combat tracker (shared by the tabletop and the tests).
// CombatOrder.nextActor(items, currentId): who acts after currentId. items are in initiative order, each {id, dead, unseen, delayed}.
//   Dead, unseen and delayed combatants are skipped. Returns {id, wrapped} (wrapped = a new round began) or null.
// CombatOrder.resumeInitiative(items, activeId, id): the initiative for a delayed combatant who acts right after activeId's turn
//   (2014 DMG optional rule: initiative moves to the point after which they act). items are {id, initiative, delayed} in order.
//   A value between the active combatant and the next one; null when the active one has no number.
(function (root) {
  'use strict';

  function nextActor(items, currentId) {
    var n = items.length;
    if (!n) return null;
    var idx = items.findIndex(function (t) { return t.id === currentId; });
    for (var step = 1; step <= n; step++) {
      var at = idx + step;
      var t = items[((at % n) + n) % n];
      if (t.dead || t.unseen || t.delayed) continue;
      return { id: t.id, wrapped: idx >= 0 && at >= n };
    }
    return null;
  }

  function resumeInitiative(items, activeId, id) {
    var active = items.find(function (t) { return t.id === activeId; });
    if (!active || !Number.isFinite(active.initiative)) return null;
    var from = items.indexOf(active), next = null;
    for (var step = 1; step < items.length; step++) {
      var t = items[(from + step) % items.length];
      if (t.id === id || t.delayed) continue;
      next = t;
      break;
    }
    if (next && next.initiative === active.initiative) return active.initiative;   // a tie: the number cannot separate them, placeAfter() does
    var low = next && Number.isFinite(next.initiative) && next.initiative < active.initiative ? next.initiative : active.initiative - 1;
    return Math.round(((active.initiative + low) / 2) * 1000) / 1000;
  }

  // CombatOrder.placeAfter(ids, id, afterId): the id list with id moved to sit right behind afterId (unchanged when either is missing).
  function placeAfter(ids, id, afterId) {
    if (id === afterId || ids.indexOf(id) < 0 || ids.indexOf(afterId) < 0) return ids.slice();
    var rest = ids.filter(function (x) { return x !== id; });
    rest.splice(rest.indexOf(afterId) + 1, 0, id);
    return rest;
  }

  var api = { nextActor: nextActor, resumeInitiative: resumeInitiative, placeAfter: placeAfter };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CombatOrder = api;
})(typeof window !== 'undefined' ? window : globalThis);
