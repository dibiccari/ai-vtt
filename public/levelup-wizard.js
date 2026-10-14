// The level-up wizard dialog, shared by the Party page (real characters) and the Level-up test page (a throwaway one).
// LevelUpWizard.open({ character, fetchOptions() -> options, apply(choices) -> result, onDone(result), onError(message) })
(function () {
  'use strict';
  var ABIL = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  var signed = function (n) { return (n > 0 ? '+' : '') + n; };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  var style = document.createElement('style');
  style.textContent = ".wiz .meta { color:var(--muted); }\n  .wiz button.small { padding:2px 8px; font-size:12px; }\n  "+"  dialog.wiz { background:var(--panel); color:var(--text); border:1px solid var(--border); border-radius:14px; padding:0; width:min(680px, 94vw); max-height:90vh; }\n  dialog.wiz::backdrop { background:rgba(0,0,0,.65); }\n  .wiz header { padding:14px 18px 8px; border-bottom:1px solid var(--border); } .wiz header h2 { margin:0; font-size:18px; }\n  .wiz .steps { display:flex; gap:6px; margin-top:8px; flex-wrap:wrap; } .wiz .steps span { font-size:11px; padding:1px 9px; border-radius:999px; border:1px solid #3a4558; color:var(--muted); } .wiz .steps span.on { background:var(--accent); border-color:var(--accent); color:#001; font-weight:700; } .wiz .steps span.done { color:var(--ok); border-color:var(--ok); }\n  .wiz .body { padding:14px 18px; overflow:auto; max-height:56vh; } .wiz footer { padding:10px 18px; border-top:1px solid var(--border); display:flex; gap:8px; justify-content:flex-end; align-items:center; }\n  .wiz .opt { display:flex; gap:10px; align-items:flex-start; padding:8px 10px; border:1px solid var(--border); border-radius:8px; margin:6px 0; cursor:pointer; } .wiz .opt.on { border-color:var(--accent); background:rgba(79,157,255,.1); } .wiz .opt small { color:var(--muted); display:block; }\n  .wiz .feat { border-left:3px solid var(--gold); padding:2px 10px; margin:8px 0; } .wiz .feat b { color:var(--gold); } .wiz .feat div { color:var(--muted); font-size:12px; white-space:pre-wrap; }\n  .wiz .abil6 { display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; } .wiz .abil6 .a { background:var(--panel2); border:1px solid var(--border); border-radius:8px; padding:6px; text-align:center; } .wiz .abil6 .a b { font-size:18px; display:block; }\n  .wiz .spells { display:grid; grid-template-columns:repeat(auto-fill, minmax(190px, 1fr)); gap:4px; max-height:300px; overflow:auto; margin-top:6px; } .wiz .spells label { display:flex; gap:6px; align-items:center; font-size:13px; padding:2px 6px; border-radius:6px; } .wiz .spells label:hover { background:var(--panel2); }\n";
  document.head.appendChild(style);
  async function open(cfg) {
    var c = cfg.character, opt;
    try { opt = await cfg.fetchOptions(); } catch (err) { cfg.onError(err.message); return; }
    if (!opt.ok) { cfg.onError(opt.reason); return; }
    var pick = { hp: { mode: 'average', value: opt.hp.average }, asiKind: 'asi', inc: {}, feat: '', subclass: '', spells: [] };
    var steps = ['Hit points', 'New features'];
    if (opt.asi) steps.push('Ability scores');
    if (opt.subclass) steps.push('Subclass');
    opt.spellChoices.forEach(function (sc) { steps.push(sc.level === 0 ? 'Cantrips' : opt.class === 'Wizard' ? 'Spellbook' : 'Spells'); });
    steps.push('Review');
    var at = 0;
    var dlg = el('dialog', 'wiz');
    var head = el('header'); head.appendChild(el('h2', '', c.name + ': level ' + opt.level + ' → ' + opt.next + ' (' + opt.class + ')'));
    var stepBar = el('div', 'steps'); head.appendChild(stepBar);
    var body = el('div', 'body'), foot = el('footer');
    var status = el('span', 'meta'); status.style.marginRight = 'auto';
    var back = el('button', '', 'Back'), next = el('button', '', 'Next'), cancel = el('button', '', 'Cancel');
    foot.append(status, cancel, back, next);
    dlg.append(head, body, foot);
    document.body.appendChild(dlg);
    function close() { dlg.close(); dlg.remove(); }
    cancel.addEventListener('click', close);
    dlg.addEventListener('cancel', function () { dlg.remove(); });

    function option(label, sub, on, click) { var o = el('div', 'opt' + (on ? ' on' : '')); var t = el('div'); t.appendChild(el('b', '', label)); if (sub) t.appendChild(el('small', '', sub)); o.appendChild(t); o.addEventListener('click', click); return o; }
    function stepHp() {
      body.appendChild(el('p', 'meta', 'Hit die d' + opt.hitDie + ', Constitution ' + signed(opt.hp.conMod) + '. At least 1 hit point is always gained.'));
      body.appendChild(option('Take the average: ' + opt.hp.average, 'The fixed value from the class (' + opt.hp.average + ' + Constitution)', pick.hp.mode === 'average', function () { pick.hp = { mode: 'average' }; draw(); }));
      body.appendChild(option('Roll ' + opt.hp.roll + ' for me', 'Real dice are rolled when you confirm', pick.hp.mode === 'roll', function () { pick.hp = { mode: 'roll' }; draw(); }));
      var man = option('I rolled it myself', 'Enter the die result (1 to ' + opt.hitDie + ')', pick.hp.mode === 'manual', function () { pick.hp = { mode: 'manual', value: pick.hp.value || 1 }; draw(); });
      if (pick.hp.mode === 'manual') { var inp = el('input'); inp.type = 'number'; inp.min = '1'; inp.max = String(opt.hitDie); inp.value = pick.hp.value || 1; inp.addEventListener('click', function (e) { e.stopPropagation(); }); inp.addEventListener('input', function () { pick.hp.value = Number(inp.value); }); man.appendChild(inp); }
      body.appendChild(man);
    }
    function stepFeatures() {
      body.appendChild(el('p', 'meta', 'Proficiency bonus +' + opt.profBonus + '.' + (opt.caster ? ' New spell slots are added automatically.' : '')));
      if (!opt.features.length) body.appendChild(el('p', '', 'No new class features at this level.'));
      opt.features.forEach(function (f) { var d = el('div', 'feat'); d.appendChild(el('b', '', f.name)); d.appendChild(el('div', '', f.text)); body.appendChild(d); });
      if (opt.prepares) body.appendChild(el('p', 'meta', 'You prepare ' + opt.prepares.count + ' spells each day (level + ' + opt.prepares.ability.toUpperCase() + ' modifier).'));
    }
    function total() { return Object.keys(pick.inc).reduce(function (n, k) { return n + pick.inc[k]; }, 0); }
    function stepAsi() {
      body.appendChild(option('Increase ability scores', 'Raise one score by 2 or two scores by 1 (maximum 20)', pick.asiKind === 'asi', function () { pick.asiKind = 'asi'; draw(); }));
      body.appendChild(option('Take a feat instead', 'The SRD includes only the Grappler feat', pick.asiKind === 'feat', function () { pick.asiKind = 'feat'; draw(); }));
      if (pick.asiKind === 'asi') {
        body.appendChild(el('p', 'meta', 'Points spent: ' + total() + ' of 2'));
        var g = el('div', 'abil6');
        ABIL.forEach(function (a) {
          var cell = el('div', 'a'); var now = c.abilities[a] + (pick.inc[a] || 0);
          cell.appendChild(el('span', 'meta', a.toUpperCase())); cell.appendChild(el('b', '', now + (pick.inc[a] ? ' (+' + pick.inc[a] + ')' : '')));
          var m = el('button', 'small', '−'), p = el('button', 'small', '+');
          m.addEventListener('click', function () { if (pick.inc[a]) { pick.inc[a]--; if (!pick.inc[a]) delete pick.inc[a]; draw(); } });
          p.addEventListener('click', function () { if (total() < 2 && now < 20) { pick.inc[a] = (pick.inc[a] || 0) + 1; draw(); } });
          cell.append(m, document.createTextNode(' '), p); g.appendChild(cell);
        });
        body.appendChild(g);
      } else {
        opt.feats.forEach(function (f) { var o = option(f.name, (f.needs.length ? 'Needs ' + f.needs.join(', ') + '. ' : '') + f.text.split('\n')[0], pick.feat === f.name, function () { pick.feat = f.name; draw(); }); body.appendChild(o); });
      }
    }
    function stepSubclass() {
      body.appendChild(el('p', 'meta', 'Choose your ' + opt.class + ' subclass. The SRD lists one; type another for a subclass from a book you own.'));
      opt.subclass.options.forEach(function (s) { body.appendChild(option(s.name, '', pick.subclass === s.name, function () { pick.subclass = s.name; draw(); })); });
      var other = el('input'); other.placeholder = 'Another subclass…'; other.style.width = '260px'; other.value = opt.subclass.options.some(function (s) { return s.name === pick.subclass; }) ? '' : pick.subclass;
      other.addEventListener('input', function () { pick.subclass = other.value.trim(); });
      body.appendChild(other);
    }
    function stepSpells(sc) {
      var cantrips = sc.level === 0;
      var chosen = pick.spells.filter(function (s) { return cantrips ? s.level === 0 : s.level > 0; });
      body.appendChild(el('p', 'meta', 'Choose ' + sc.count + (cantrips ? ' new cantrip' : ' new spell') + (sc.count === 1 ? '' : 's') + '. Chosen: ' + chosen.length + '.' + (opt.class === 'Wizard' && !cantrips ? ' They are copied into your spellbook.' : '')));
      var find = el('input'); find.placeholder = 'Search'; body.appendChild(find);
      var list = el('div', 'spells'); body.appendChild(list);
      var options = sc.options.map(function (o) { return typeof o === 'string' ? { name: o, level: 0 } : o; });
      function fill() {
        list.innerHTML = '';
        options.filter(function (o) { return o.name.toLowerCase().indexOf(find.value.toLowerCase()) >= 0; }).forEach(function (o) {
          var lab = el('label'); var cb = el('input'); cb.type = 'checkbox';
          cb.checked = pick.spells.some(function (s) { return s.name === o.name; });
          cb.addEventListener('change', function () {
            if (cb.checked) { var now = pick.spells.filter(function (s) { return cantrips ? s.level === 0 : s.level > 0; }).length; if (now >= sc.count) { cb.checked = false; status.textContent = 'Already ' + sc.count + ' chosen: untick one first.'; return; } pick.spells.push({ name: o.name, level: o.level }); }
            else pick.spells = pick.spells.filter(function (s) { return s.name !== o.name; });
            status.textContent = '';
          });
          lab.append(cb, document.createTextNode(o.name + (o.level ? ' (' + o.level + ')' : '')));
          list.appendChild(lab);
        });
      }
      find.addEventListener('input', fill); fill();
    }
    function stepReview() {
      var ul = el('ul', 'sum');
      var hpText = pick.hp.mode === 'average' ? 'average ' + opt.hp.average : pick.hp.mode === 'roll' ? 'a rolled ' + opt.hp.roll : 'your roll of ' + pick.hp.value;
      ul.appendChild(el('li', '', 'Hit points: ' + hpText + ' ' + signed(opt.hp.conMod) + ' Constitution'));
      if (opt.asi) ul.appendChild(el('li', '', pick.asiKind === 'feat' ? 'Feat: ' + (pick.feat || '(none chosen)') : 'Abilities: ' + (Object.keys(pick.inc).map(function (k) { return k.toUpperCase() + ' +' + pick.inc[k]; }).join(', ') || '(none chosen)')));
      if (opt.subclass) ul.appendChild(el('li', '', 'Subclass: ' + (pick.subclass || '(none chosen)')));
      if (pick.spells.length) ul.appendChild(el('li', '', 'Spells: ' + pick.spells.map(function (s) { return s.name; }).join(', ')));
      opt.features.forEach(function (f) { ul.appendChild(el('li', '', 'Feature: ' + f.name)); });
      body.appendChild(el('p', '', c.name + ' becomes a level ' + opt.next + ' ' + opt.class + '. The change goes in the sheet log, where you can undo it.'));
      body.appendChild(ul);
    }
    function draw() {
      stepBar.innerHTML = '';
      steps.forEach(function (n, i) { stepBar.appendChild(el('span', i === at ? 'on' : i < at ? 'done' : '', (i + 1) + '. ' + n)); });
      body.innerHTML = ''; body.scrollTop = 0;
      var name = steps[at];
      if (name === 'Hit points') stepHp(); else if (name === 'New features') stepFeatures(); else if (name === 'Ability scores') stepAsi(); else if (name === 'Subclass') stepSubclass();
      else if (name === 'Review') stepReview();
      else stepSpells(opt.spellChoices[name === 'Cantrips' ? opt.spellChoices.findIndex(function (x) { return x.level === 0; }) : opt.spellChoices.findIndex(function (x) { return x.level !== 0; })]);
      back.disabled = at === 0;
      next.textContent = at === steps.length - 1 ? 'Level up' : 'Next';
    }
    function problem() {
      var name = steps[at];
      if (name === 'Hit points' && pick.hp.mode === 'manual' && !(pick.hp.value >= 1 && pick.hp.value <= opt.hitDie)) return 'Enter a number from 1 to ' + opt.hitDie + '.';
      if (name === 'Ability scores') { if (pick.asiKind === 'asi' && total() !== 2) return 'Spend exactly 2 points.'; if (pick.asiKind === 'feat' && !pick.feat) return 'Choose a feat.'; }
      if (name === 'Subclass' && !pick.subclass) return 'Choose a subclass.';
      if (name === 'Cantrips' || name === 'Spells' || name === 'Spellbook') {
        var sc = opt.spellChoices[name === 'Cantrips' ? opt.spellChoices.findIndex(function (x) { return x.level === 0; }) : opt.spellChoices.findIndex(function (x) { return x.level !== 0; })];
        var n = pick.spells.filter(function (s) { return name === 'Cantrips' ? s.level === 0 : s.level > 0; }).length;
        if (n !== sc.count) return 'Choose ' + sc.count + ' (' + n + ' so far).';
      }
      return '';
    }
    back.addEventListener('click', function () { status.textContent = ''; at = Math.max(0, at - 1); draw(); });
    next.addEventListener('click', async function () {
      var p = problem(); if (p) { status.textContent = p; return; }
      status.textContent = '';
      if (at < steps.length - 1) { at++; draw(); return; }
      next.disabled = true;
      var send = { hp: pick.hp, spells: pick.spells };
      if (opt.asi) send.asi = pick.asiKind === 'feat' ? { kind: 'feat', name: pick.feat } : { kind: 'asi', increases: pick.inc };
      if (opt.subclass) send.subclass = pick.subclass;
      try { var out = await cfg.apply(send); close(); await cfg.onDone(out); }
      catch (err) { next.disabled = false; status.textContent = err.message; }
    });
    draw();
    dlg.showModal();
  }


  window.LevelUpWizard = { open: open };
})();
