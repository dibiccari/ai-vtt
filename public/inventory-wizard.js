// The inventory wizard dialog: Shop (SRD gear and magic items, buy with coin or take for free), Carried (equip, attune, quantity, sell, drop), Coins (spend, gain, make change) and Review.
// Everything is staged in the dialog; nothing is saved until Confirm. A live panel shows the armor class, weapons, weight and warnings the new gear would give (the server works them out).
// InventoryWizard.open({ character, onDone(result), onError(message) }). Needs levelup-wizard.js loaded first (its dialog styles).
(function () {
  'use strict';
  var COINS = ['cp', 'sp', 'ep', 'gp', 'pp'];
  var VALUE = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  async function api(url, body) {
    var res = await fetch(url, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
    return data;
  }
  var style = document.createElement('style');
  style.textContent = '.wiz .tabs { display:flex; gap:6px; margin-top:8px; flex-wrap:wrap; } .wiz .tabs button { padding:3px 12px; border-radius:999px; font-size:12px; } .wiz .tabs button.on { background:var(--accent); border-color:var(--accent); color:#001; }'
    + ' .wiz table { width:100%; border-collapse:collapse; font-size:13px; } .wiz th { text-align:left; color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.06em; padding:3px 6px; border-bottom:1px solid var(--border); } .wiz td { padding:3px 6px; border-bottom:1px solid #1c2330; vertical-align:middle; } .wiz td.num { text-align:right; font-variant-numeric:tabular-nums; }'
    + ' .wiz .live { margin-top:10px; padding:8px 10px; border:1px solid var(--border); border-radius:8px; background:var(--panel2); font-size:12px; } .wiz .live b { color:var(--gold); } .wiz .live .warn { color:#e0a060; } .wiz .live .bad { color:var(--danger); }'
    + ' .wiz .filters { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:6px; } .wiz .coinrow { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin:6px 0; } .wiz .coinrow input { width:80px; }'
    + ' .wiz .shoplist { max-height:300px; overflow:auto; } .wiz .fx { color:var(--gold); font-size:12px; } .wiz .diff li { margin:3px 0; } .wiz .diff .add { color:var(--ok); } .wiz .diff .del { color:var(--danger); }';
  style.textContent += ' .wiz .talkbox { border:1px solid var(--border); border-radius:8px; padding:8px 10px; margin-bottom:8px; background:var(--panel2); } .wiz .talkline { margin:3px 0; font-size:13px; }';
  document.head.appendChild(style);

  function coinText(cp) { var gp = Math.floor(cp / 100), sp = Math.floor((cp % 100) / 10), c = cp % 10; return [gp && gp + ' gp', sp && sp + ' sp', c && c + ' cp'].filter(Boolean).join(' ') || '0 gp'; }
  var totalCp = function (c) { return COINS.reduce(function (n, k) { return n + (Number(c[k]) || 0) * VALUE[k]; }, 0); };
  var norm = function (s) { return String(s || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim(); };

  async function open(cfg) {
    var c = cfg.character, shop;
    try { shop = (await api('/api/party/shop')).items; } catch (err) { cfg.onError(err.message); return; }
    // At a merchant (the DM opened a shop): only their kind of stock, at their prices.
    var sh = cfg.shop || null;
    shop = shop.map(function (i) { return Object.assign({}, i, { base: i.cp }); });
    if (sh) {
      var groups = (sh.groups || []).map(function (g) { return g.toLowerCase(); });
      shop = shop.filter(function (i) { return groups.length ? groups.indexOf(i.group.toLowerCase()) >= 0 : i.group !== 'Magic items'; });
      sh.base = sh.markup || 100;
    }
    function priceAt(m) { shop.forEach(function (i) { if (i.base) { i.cp = Math.ceil(i.base * m / 100); i.cost = coinText(i.cp); } }); }
    if (sh) priceAt(sh.markup || 100);
    var talkHist = [], talkLog = [], merchantSummary = '', merchantDone = false, talking = false, closedOnce = false;
    var byIndex = {}, byName = {};
    shop.forEach(function (i) { byIndex[i.index] = i; byName[norm(i.name)] = i; });
    var known = function (it) { return (it.srd && byIndex[it.srd]) || byName[norm(it.name)] || null; };
    var isBodyArmor = function (e) { return e && e.group === 'Armor' && !/^Shield/.test(e.detail); };
    var isShield = function (e) { return e && e.group === 'Armor' && /^Shield/.test(e.detail); };

    var orig = JSON.parse(JSON.stringify(c.inventory || [])), origCoins = JSON.parse(JSON.stringify(c.coins || {}));
    var inv = JSON.parse(JSON.stringify(orig)), coins = JSON.parse(JSON.stringify(origCoins));
    var spent = [];                                  // lines for the review: what was bought, sold or taken
    var gives = [];                                  // items handed to someone else (or the stash): done on Confirm, before the rest is saved
    var tab = 'Shop', live = null, timer = null, seq = 0;
    var f = { q: '', group: '' };

    var dlg = el('dialog', 'wiz');
    var head = el('header'); head.appendChild(el('h2', '', sh ? c.name + ' at ' + sh.merchant : c.name + ': gear'));
    if (sh) head.appendChild(el('div', 'meta', 'Prices ' + (sh.markup === 100 ? 'as in the SRD' : sh.markup + '% of the SRD price') + '. Selling gets half the SRD price. The Dungeon Master is told what you buy.'));
    var tabsBar = el('div', 'tabs'); head.appendChild(tabsBar);
    var body = el('div', 'body'), foot = el('footer');
    var status = el('span', 'meta'); status.style.marginRight = 'auto';
    var cancel = el('button', '', 'Cancel'), confirm = el('button', 'primary', 'Review changes');
    foot.append(status, cancel, confirm);
    var liveBox = el('div', 'live');
    liveBox.style.margin = '0 18px 8px';
    dlg.append(head, body, liveBox, foot);
    document.body.appendChild(dlg);
    var close = function () {
      dlg.close(); dlg.remove();
      if (sh && cfg.onClose && !closedOnce) { closedOnce = true; cfg.onClose({ summary: merchantSummary, markup: sh.markup, base: sh.base, talked: talkHist.length > 0 }); }
    };
    cancel.addEventListener('click', close);
    dlg.addEventListener('cancel', function () { dlg.remove(); if (sh && cfg.onClose && !closedOnce) { closedOnce = true; cfg.onClose({ summary: merchantSummary, markup: sh.markup, base: sh.base, talked: talkHist.length > 0 }); } });

    function say(t) { status.textContent = t || ''; }
    function changed() { schedulePreview(); drawLive(); }
    function schedulePreview() {
      clearTimeout(timer);
      timer = setTimeout(async function () {
        var mine = ++seq;
        try { var out = await api('/api/party/gear/' + encodeURIComponent(c.id) + '/preview', { inventory: inv, coins: coins }); if (mine === seq) { live = out; drawLive(); } }
        catch (err) { if (mine === seq) { live = { error: err.message }; drawLive(); } }
      }, 150);
    }
    function drawLive() {
      liveBox.innerHTML = '';
      if (!live) { liveBox.textContent = 'Working out the numbers…'; return; }
      if (live.error) { liveBox.appendChild(el('span', 'bad', live.error)); return; }
      var e = live.effective, w = e.weight;
      liveBox.appendChild(el('div', '', '')).innerHTML = '';
      var line = liveBox.lastChild;
      line.appendChild(document.createTextNode('Armor Class '));
      var ac = el('b', '', String(live.ac)); line.appendChild(ac);
      if (live.ac !== c.effective.ac) line.appendChild(document.createTextNode(' (was ' + c.effective.ac + ')'));
      line.appendChild(document.createTextNode(' · carrying '));
      line.appendChild(el('b', '', w.carried + ' lb'));
      line.appendChild(document.createTextNode(' of ' + w.capacity + ' lb' + (w.status !== 'normal' ? ' · ' + w.status : '') + ' · attuned ' + e.attuned.length + '/3 · purse ' + coinText(totalCp(coins))));
      (live.armor && live.armor.parts.length ? [live.armor.parts.join(' + ')] : []).forEach(function (t) { liveBox.appendChild(el('div', 'meta', t)); });
      (live.warnings || []).forEach(function (t) { liveBox.appendChild(el('div', 'warn', '⚠ ' + t)); });
      (live.problems || []).forEach(function (t) { liveBox.appendChild(el('div', 'bad', t)); });
    }

    function addItem(item) {
      var have = inv.filter(function (x) { return x.name.toLowerCase() === item.name.toLowerCase() && (x.srd || '') === (item.srd || ''); })[0];
      if (have) have.qty += item.qty; else inv.push(item);
    }
    async function takeFromShop(entry, qty, pay) {
      var cost = entry.cp * qty;
      if (pay) {
        if (!entry.cp) { say(entry.name + ' has no price. Take it for free instead.'); return; }
        try { coins = (await api('/api/party/pay', { coins: coins, cost: cost })).coins; } catch (err) { say(err.message); return; }
      }
      try {
        var item = (await api('/api/party/srd-item?kind=' + entry.kind + '&index=' + encodeURIComponent(entry.index))).item;
        item.qty = qty; addItem(item);
        spent.push({ text: (pay ? 'Bought ' : 'Took ') + qty + ' × ' + entry.name + (pay ? ' for ' + coinText(cost) : ''), cls: 'add' });
        say((pay ? 'Bought ' : 'Took ') + qty + ' × ' + entry.name + '.');
      } catch (err) { say(err.message); return; }
      draw(); changed();
    }

    async function say2(text, opening) {
      if (!cfg.talk || talking || merchantDone) return;
      talking = true; drawTalk();
      try {
        if (!opening) { talkHist.push({ role: 'player', text: text }); talkLog.push({ who: c.name, text: text }); }
        var r = await cfg.talk({ message: text, opening: !!opening, history: talkHist.slice(0, -1 * (opening ? 0 : 1)), merchant: sh.merchant, groups: sh.groups, markup: sh.markup, base: sh.base });
        talkHist.push({ role: 'merchant', text: r.line }); talkLog.push({ who: sh.merchant, text: r.line, rolls: r.rolls });
        merchantSummary = r.summary || merchantSummary;
        if (r.markup) { sh.markup = r.markup; priceAt(r.markup); }
        if (r.done) merchantDone = true;
        if (cfg.onSay) cfg.onSay(r, sh);
      } catch (err) { talkLog.push({ who: '', text: '(' + err.message + ')' }); }
      talking = false; if (tab === 'Shop') draw(); else drawTalk();
    }
    var talkBox = el('div', 'talkbox');
    function drawTalk() {
      talkBox.innerHTML = '';
      if (!sh || !cfg.talk) return;
      talkLog.slice(-5).forEach(function (m) {
        var d = el('div', 'talkline'); if (m.who) d.appendChild(el('b', '', m.who + ': ')); d.appendChild(document.createTextNode(m.text));
        (m.rolls || []).forEach(function (r) { d.appendChild(el('div', 'meta', '🎲 ' + r)); });
        talkBox.appendChild(d);
      });
      if (talking) talkBox.appendChild(el('div', 'meta', sh.merchant + ' is thinking…'));
      if (merchantDone) { talkBox.appendChild(el('div', 'meta', sh.merchant + ' has ended the conversation.')); return; }
      var row = el('div', 'coinrow'); var inp = el('input'); inp.placeholder = 'Say something to ' + sh.merchant + ' (ask, haggle…)'; inp.style.flex = '1'; inp.style.minWidth = '200px'; inp.disabled = talking;
      var go = el('button', 'small', 'Say'); go.disabled = talking;
      var send = function () { var t = inp.value.trim(); if (t) { inp.value = ''; say2(t, false); } };
      go.addEventListener('click', send); inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); send(); } });
      row.append(inp, go); talkBox.appendChild(row);
      if (!talking) setTimeout(function () { try { inp.focus(); } catch (e) { /* closed */ } }, 0);
    }
    function drawShop() {
      if (sh && cfg.talk) { body.appendChild(talkBox); drawTalk(); }
      var fl = el('div', 'filters');
      var q = el('input'); q.placeholder = 'Search the SRD…'; q.value = f.q; q.style.width = '220px';
      var g = el('select'); [''].concat(Object.keys(shop.reduce(function (m, i) { m[i.group] = 1; return m; }, {}))).forEach(function (n) { var o = el('option', '', n || 'Everything'); o.value = n; g.appendChild(o); }); g.value = f.group;
      fl.append(q, g, el('span', 'meta', 'Purse: ' + coinText(totalCp(coins))));
      body.appendChild(fl);
      var box = el('div', 'shoplist'); body.appendChild(box);
      function fill() {
        box.innerHTML = '';
        var rows = shop.filter(function (i) { return (!f.group || i.group === f.group) && (!f.q || i.name.toLowerCase().indexOf(f.q.toLowerCase()) >= 0); });
        var t = el('table'); var h = el('tr'); ['Item', 'Detail', 'Cost', 'lb', 'Qty', ''].forEach(function (x) { h.appendChild(el('th', '', x)); }); t.appendChild(h);
        rows.slice(0, 80).forEach(function (i) {
          var tr = el('tr'); tr.appendChild(el('td', '', i.name)); tr.appendChild(el('td', 'meta', i.detail)); tr.appendChild(el('td', 'num', i.cost || '—')); tr.appendChild(el('td', 'num', i.weight ? String(i.weight) : ''));
          var qty = el('input'); qty.type = 'number'; qty.min = '1'; qty.value = '1'; qty.style.width = '56px'; var qc = el('td'); qc.appendChild(qty); tr.appendChild(qc);
          var act = el('td'); var buy = el('button', 'small', 'Buy'), take = el('button', 'small', 'Take'); take.title = 'Add it without paying (loot, a gift, starting gear)';
          buy.disabled = !i.cp || merchantDone; buy.addEventListener('click', function () { takeFromShop(i, Math.max(1, Number(qty.value) || 1), true); });
          take.addEventListener('click', function () { takeFromShop(i, Math.max(1, Number(qty.value) || 1), false); });
          act.style.whiteSpace = 'nowrap'; act.append(buy, document.createTextNode(' '), take); tr.appendChild(act); t.appendChild(tr);
        });
        box.appendChild(t);
        if (rows.length > 80) box.appendChild(el('p', 'meta', rows.length + ' match: type more to narrow the list.'));
        if (!rows.length) box.appendChild(el('p', 'meta', 'Nothing matches.'));
      }
      q.addEventListener('input', function () { f.q = q.value; fill(); }); g.addEventListener('change', function () { f.group = g.value; fill(); });
      fill();
      var custom = el('div', 'coinrow'); custom.appendChild(el('b', '', 'Custom item'));
      var n = el('input'); n.placeholder = 'Name'; n.style.width = '160px'; var cq = el('input'); cq.type = 'number'; cq.min = '1'; cq.value = '1'; cq.style.width = '56px'; var cw = el('input'); cw.type = 'number'; cw.min = '0'; cw.step = '0.1'; cw.value = '0'; cw.title = 'Weight of one, in pounds'; cw.style.width = '70px';
      var ca = el('input'); ca.type = 'checkbox'; var cal = el('label', 'meta'); cal.append(ca, document.createTextNode(' needs attunement'));
      var add = el('button', 'small', 'Add');
      add.addEventListener('click', function () { if (!n.value.trim()) { n.focus(); return; } addItem({ name: n.value.trim(), qty: Math.max(1, Number(cq.value) || 1), weight: Number(cw.value) || 0, requiresAttunement: ca.checked, attuned: false, equipped: true, effects: [] }); spent.push({ text: 'Added ' + n.value.trim(), cls: 'add' }); n.value = ''; draw(); changed(); });
      custom.append(n, cq, cw, cal, add); body.appendChild(custom);
    }

    function equipToggle(it, on) {
      var e = known(it);
      if (on && isBodyArmor(e)) inv.forEach(function (o) { if (o !== it && isBodyArmor(known(o))) o.equipped = false; });
      if (on && isShield(e)) inv.forEach(function (o) { if (o !== it && isShield(known(o))) o.equipped = false; });
      it.equipped = on;
    }
    function drawCarried() {
      if (!inv.length) { body.appendChild(el('p', 'meta', 'Nothing carried yet. Use the Shop tab.')); return; }
      var t = el('table'); var h = el('tr'); ['Item', 'Qty', 'lb', 'Worn / wielded', 'Attuned', ''].forEach(function (x) { h.appendChild(el('th', '', x)); }); t.appendChild(h);
      inv.slice().forEach(function (it) {
        var e = known(it), tr = el('tr');
        var nm = el('td'); nm.appendChild(document.createTextNode(it.name));
        if (e && e.detail && e.group !== 'Magic items') nm.appendChild(el('div', 'meta', e.detail));
        if (it.effects && it.effects.length) nm.appendChild(el('div', 'fx', it.effects.map(function (x) { return x.kind === 'abilityMin' ? x.ability.toUpperCase() + ' becomes ' + x.value : (x.value > 0 ? '+' : '') + x.value + ' ' + x.kind; }).join(', ')));
        tr.appendChild(nm);
        var qc = el('td', 'num'); var m = el('button', 'small', '−'), p = el('button', 'small', '+');
        m.addEventListener('click', function () { it.qty -= 1; if (it.qty < 1) inv.splice(inv.indexOf(it), 1); spent.push({ text: 'Dropped 1 × ' + it.name, cls: 'del' }); draw(); changed(); });
        p.addEventListener('click', function () { it.qty += 1; draw(); changed(); });
        qc.append(m, document.createTextNode(' ' + it.qty + ' '), p); tr.appendChild(qc);
        tr.appendChild(el('td', 'num', String(Math.round(it.weight * it.qty * 100) / 100)));
        var wc = el('td'); var matters = (e && (e.group === 'Armor' || e.group === 'Weapon')) || (it.effects && it.effects.length);
        if (matters) { var wb = el('input'); wb.type = 'checkbox'; wb.checked = it.equipped !== false; wb.title = 'Worn or wielded: armor sets Armor Class, weapons get an attack line, magic items only work when worn'; wb.addEventListener('change', function () { equipToggle(it, wb.checked); draw(); changed(); }); wc.appendChild(wb); }
        tr.appendChild(wc);
        var ac = el('td'); if (it.requiresAttunement) { var ab = el('input'); ab.type = 'checkbox'; ab.checked = !!it.attuned; ab.title = 'Attune (three at most)'; ab.addEventListener('change', function () { it.attuned = ab.checked; changed(); }); ac.appendChild(ab); } tr.appendChild(ac);
        var act = el('td');
        if (e && e.base) { var sell = el('button', 'small', 'Sell'); sell.title = 'Sell one for half its price'; sell.addEventListener('click', function () { var half = Math.floor(e.base / 2); coins.cp = (Number(coins.cp) || 0) + half; it.qty -= 1; if (it.qty < 1) inv.splice(inv.indexOf(it), 1); spent.push({ text: 'Sold 1 × ' + it.name + ' for ' + coinText(half), cls: 'del' }); draw(); changed(); }); act.append(sell, document.createTextNode(' ')); }
        if (cfg.others && cfg.others.length) {
          var saved = orig.filter(function (o) { return o.id === it.id; })[0];
          var giveSel = el('select', 'small'); giveSel.title = saved ? 'Give this to someone else or the stash' : 'Confirm what you bought first, then give it';
          giveSel.appendChild(el('option', '', 'Give…')); giveSel.firstChild.value = '';
          [{ id: 'stash', name: 'Party stash' }].concat(cfg.others).forEach(function (o) { var op = el('option', '', o.name); op.value = o.id; giveSel.appendChild(op); });
          giveSel.disabled = !saved;
          giveSel.addEventListener('change', function () { if (!giveSel.value) return; var who = cfg.others.concat([{ id: 'stash', name: 'Party stash' }]).filter(function (o) { return o.id === giveSel.value; })[0]; var qty = Math.min(it.qty, saved.qty); gives.push({ to: giveSel.value, name: it.name, qty: qty, toName: who ? who.name : '' }); spent.push({ text: 'Gave ' + qty + ' × ' + it.name + ' to ' + (who ? who.name : ''), cls: 'del' }); it.qty -= qty; if (it.qty < 1) inv.splice(inv.indexOf(it), 1); draw(); changed(); });
          act.appendChild(giveSel);
        }
        var del = el('button', 'small danger', '✕'); del.title = 'Drop all of it'; del.addEventListener('click', function () { inv.splice(inv.indexOf(it), 1); spent.push({ text: 'Dropped ' + it.qty + ' × ' + it.name, cls: 'del' }); draw(); changed(); });
        act.appendChild(del); tr.appendChild(act); t.appendChild(tr);
      });
      body.appendChild(t);
    }

    function drawCoins() {
      body.appendChild(el('p', 'meta', 'Purse: ' + coinText(totalCp(coins)) + ' (' + (totalCp(coins) / 100).toFixed(2) + ' gp in all)'));
      var row = el('div', 'coinrow');
      COINS.forEach(function (k) { var l = el('label', 'meta'); var i = el('input'); i.type = 'number'; i.min = '0'; i.value = coins[k] || 0; i.addEventListener('change', function () { coins[k] = Math.max(0, Math.round(Number(i.value) || 0)); changed(); drawLiveOnly(); }); l.append(document.createTextNode(k.toUpperCase() + ' '), i); row.appendChild(l); });
      body.appendChild(row);
      var tidy = el('button', 'small', 'Make change (fewer, bigger coins)');
      tidy.addEventListener('click', async function () { try { coins = (await api('/api/party/tidy', { coins: coins })).coins; draw(); changed(); } catch (err) { say(err.message); } });
      body.appendChild(tidy);
      var h = el('h4', '', 'Spend or gain'); body.appendChild(h);
      var amt = el('div', 'coinrow'); var gi = {}; ['gp', 'sp', 'cp'].forEach(function (k) { var l = el('label', 'meta'); var i = el('input'); i.type = 'number'; i.min = '0'; i.value = 0; gi[k] = i; l.append(document.createTextNode(k.toUpperCase() + ' '), i); amt.appendChild(l); });
      var why = el('input'); why.placeholder = 'What for (optional)'; why.style.width = '170px';
      var sp = el('button', 'small', 'Spend'), ga = el('button', 'small', 'Gain');
      var sum = function () { return ['gp', 'sp', 'cp'].reduce(function (n, k) { return n + (Math.max(0, Number(gi[k].value) || 0)) * VALUE[k]; }, 0); };
      sp.addEventListener('click', async function () { var cost = sum(); if (!cost) return; try { coins = (await api('/api/party/pay', { coins: coins, cost: cost })).coins; spent.push({ text: 'Spent ' + coinText(cost) + (why.value ? ' on ' + why.value : ''), cls: 'del' }); say(''); draw(); changed(); } catch (err) { say(err.message); } });
      ga.addEventListener('click', function () { var cost = sum(); if (!cost) return; ['gp', 'sp', 'cp'].forEach(function (k) { coins[k] = (Number(coins[k]) || 0) + Math.max(0, Number(gi[k].value) || 0); }); spent.push({ text: 'Gained ' + coinText(cost) + (why.value ? ' from ' + why.value : ''), cls: 'add' }); draw(); changed(); });
      amt.append(why, sp, ga); body.appendChild(amt);
    }
    function drawLiveOnly() { drawLive(); }

    function diffLines() {
      var out = [];
      var was = {}; orig.forEach(function (i) { was[i.id] = i; });
      inv.forEach(function (i) {
        var o = was[i.id];
        if (!o) out.push({ text: 'New: ' + i.qty + ' × ' + i.name, cls: 'add' });
        else {
          if (o.qty !== i.qty) out.push({ text: i.name + ': quantity ' + o.qty + ' → ' + i.qty, cls: i.qty > o.qty ? 'add' : 'del' });
          if ((o.equipped !== false) !== (i.equipped !== false)) out.push({ text: i.name + (i.equipped !== false ? ' is now worn or wielded' : ' is put away'), cls: '' });
          if (!!o.attuned !== !!i.attuned) out.push({ text: i.name + (i.attuned ? ' is attuned' : ' is no longer attuned'), cls: '' });
        }
      });
      orig.forEach(function (o) { if (!inv.some(function (i) { return i.id === o.id; })) out.push({ text: 'Gone: ' + o.qty + ' × ' + o.name, cls: 'del' }); });
      gives.forEach(function (g) {                      // a gift is one line, not 'gone' and 'quantity changed'
        out = out.filter(function (l) { return !(l.text.indexOf(g.name) >= 0 && (/^Gone: /.test(l.text) || / quantity /.test(l.text))); });
        out.push({ text: 'Gave ' + g.qty + ' × ' + g.name + ' to ' + g.toName, cls: 'del' });
      });
      var d = totalCp(coins) - totalCp(origCoins);
      if (d) out.push({ text: 'Purse ' + (d > 0 ? '+' : '−') + coinText(Math.abs(d)) + ' → ' + coinText(totalCp(coins)), cls: d > 0 ? 'add' : 'del' });
      return out;
    }
    var reason = el('input'); reason.value = 'Gear change'; reason.style.width = '260px';
    function drawReview() {
      var lines = diffLines();
      if (!lines.length) { body.appendChild(el('p', '', 'Nothing has changed yet.')); return; }
      var ul = el('ul', 'diff'); lines.forEach(function (l) { ul.appendChild(el('li', l.cls, l.text)); }); body.appendChild(ul);
      if (live && live.notes && live.notes.length) { body.appendChild(el('h4', '', 'What changes on the sheet')); var u2 = el('ul', 'diff'); live.notes.forEach(function (n) { u2.appendChild(el('li', '', n)); }); body.appendChild(u2); }
      var rl = el('label', 'meta'); rl.append(document.createTextNode('Reason for the log '), reason); body.appendChild(rl);
    }

    var TABS = ['Shop', 'Carried', 'Coins', 'Review'];
    if (sh) { tab = 'Shop'; }
    function draw() {
      tabsBar.innerHTML = '';
      TABS.forEach(function (n) { var b = el('button', tab === n ? 'on' : '', n + (n === 'Carried' ? ' (' + inv.length + ')' : '')); b.addEventListener('click', function () { tab = n; say(''); draw(); }); tabsBar.appendChild(b); });
      body.innerHTML = '';
      if (tab === 'Shop') drawShop(); else if (tab === 'Carried') drawCarried(); else if (tab === 'Coins') drawCoins(); else drawReview();
      drawLive();
      confirm.textContent = tab === 'Review' ? 'Confirm' : 'Review changes';
    }
    confirm.addEventListener('click', async function () {
      if (tab !== 'Review') { tab = 'Review'; draw(); return; }
      if (!diffLines().length && !gives.length) { close(); return; }
      confirm.disabled = true;
      try { for (var g = 0; g < gives.length; g++) await api('/api/party/give', { from: c.id, to: gives[g].to, name: gives[g].name, qty: gives[g].qty }); } catch (err) { confirm.disabled = false; say(err.message); return; }
      try { var out = await api('/api/party/gear/' + encodeURIComponent(c.id) + '/commit', { inventory: inv, coins: coins, reason: reason.value || 'Gear change' }); close(); await cfg.onDone(out); }
      catch (err) { confirm.disabled = false; say(err.message); }
    });
    draw(); schedulePreview();
    dlg.showModal();
    if (sh && cfg.talk) say2('', true);
  }
  window.InventoryWizard = { open: open };
})();
