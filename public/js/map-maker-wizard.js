// The Map Maker wizard (public/map-maker.html, "Make a map"): type of map, a description (typed, spoken, or invented by "Surprise me"), a layout the AI designs and the code checks
// (battle maps), a picture painted by the service you pick, then a name and Save, which opens the new map in Map Test. Every AI call says what it costs.
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  var KIND_TEXT = {
    battle: ['Battle map', 'A place for one fight, on a grid of 5-foot squares: rooms, caves, camps. The AI draws the layout, you check it, then it is painted.'],
    town: ['Town map', 'A village or city from above, no grid. Painted from your description.'],
    regional: ['Regional map', 'A whole region from above with hexagons of 5 miles. Painted from your description.']
  };
  var STEP_NAMES = { type: 'Type', describe: 'Describe', layout: 'Layout', paint: 'Paint', save: 'Save' };
  var s = { history: [], kind: '', size: 'small', orientation: 'landscape', description: '', name: '', setting: 'indoor', grid: [], layoutOk: false, options: null, paintOptions: null, draft: null, step: 'type', busy: false };

  function steps() { return s.kind === 'battle' ? ['type', 'describe', 'layout', 'paint', 'save'] : ['type', 'describe', 'paint', 'save']; }
  function money(v) { return '$' + (v < 0.01 ? v.toFixed(3) : v.toFixed(2)); }
  function say(text, kind) { var n = $('#wzStatus'); n.textContent = text || ''; n.className = 'status' + (kind ? ' ' + kind : ''); }
  function showError(err) {
    var n = $('#wzStatus'); n.className = 'status bad'; n.textContent = (err && err.message) || String(err);
    var links = (err && err.links) || (err && err.help ? [err.help] : []);
    links.forEach(function (l) { n.appendChild(document.createTextNode(' ')); var a = el('a', '', l.label); a.href = l.url; a.target = '_blank'; a.rel = 'noopener'; n.appendChild(a); });
  }
  function api(url, body) {
    var opt = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    return fetch(url, opt).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (out) {
        if (!res.ok) { var e = new Error(out.error || 'HTTP ' + res.status); e.links = out.links; e.help = out.help; e.problems = out.problems; throw e; }
        return out;
      });
    });
  }
  function busy(on, text) {
    s.busy = on;
    document.querySelectorAll('#make button').forEach(function (b) { if (on) { b.dataset.was = b.disabled ? '1' : ''; b.disabled = true; } else b.disabled = b.dataset.was === '1'; });
    if (on) say(text); else render();
  }

  // ---- the steps bar and which step shows
  function render() {
    var list = steps(), bar = $('#wzSteps');
    bar.innerHTML = '';
    list.forEach(function (id, i) {
      var li = el('li', id === s.step ? 'on' : (list.indexOf(s.step) > i ? 'done' : ''), (i + 1) + '. ' + STEP_NAMES[id]);
      bar.appendChild(li);
    });
    document.querySelectorAll('#make .wz').forEach(function (p) { p.hidden = p.dataset.step !== s.step; });
    $('#szBox').hidden = s.kind !== 'battle';
    document.querySelectorAll('#kindCards .kind').forEach(function (c) { c.classList.toggle('on', c.dataset.kind === s.kind); });
    $('#typeNext').disabled = !s.kind;
    $('#descNext').textContent = s.kind === 'battle' ? 'Design the layout' : 'Next: choose a painter';
    $('#descNext').disabled = !s.description.trim();
    $('#layoutNext').disabled = !s.layoutOk;
  }
  function go(step) { s.step = step; say(''); render(); document.dispatchEvent(new CustomEvent('wizard-step', { detail: step })); if (step === 'paint') loadPaintOptions(); if (step === 'save') { $('#sName').value = s.name || ''; $('#sSummary').textContent = s.kind === 'battle' ? 'The walls, doors, lights, rough ground and start spots from the layout are saved with the picture.' : 'The picture is saved as a ' + s.kind + ' map.'; } }
  function next() { var l = steps(); go(l[l.indexOf(s.step) + 1]); }
  function back() { var l = steps(); go(l[Math.max(0, l.indexOf(s.step) - 1)]); }

  // ---- step 1: type and size
  function buildType() {
    var host = $('#kindCards');
    ['battle', 'town', 'regional'].forEach(function (k) {
      var c = el('button', 'kind'); c.type = 'button'; c.dataset.kind = k;
      c.append(el('b', '', KIND_TEXT[k][0]), el('span', '', KIND_TEXT[k][1]));
      c.addEventListener('click', function () { s.kind = k; s.layoutOk = false; s.draft = null; render(); });
      host.appendChild(c);
    });
    api('/api/map-maker/options').then(function (o) {
      s.options = o;
      var sel = $('#szSize');
      o.sizes.forEach(function (z) { var op = el('option', '', z.label + ': ' + z.cols + ' x ' + z.rows + ' squares, like ' + z.like); op.value = z.id; sel.appendChild(op); });
      sel.value = s.size;
    }).catch(showError);
    $('#szSize').addEventListener('change', function (e) { s.size = e.target.value; });
    $('#szOrient').addEventListener('change', function (e) { s.orientation = e.target.value; });
    $('#typeNext').addEventListener('click', next);
  }

  // ---- step 2: the description, a microphone, Surprise me
  function buildDescribe() {
    var ta = $('#wzText');
    ta.addEventListener('input', function () { s.description = ta.value; s.layoutOk = false; render(); });
    $('#wzSurprise').addEventListener('click', function () {
      busy(true, 'Thinking up a ' + KIND_TEXT[s.kind][0].toLowerCase() + '...');
      api('/api/map-maker/surprise', { kind: s.kind }).then(function (o) { ta.value = o.description; s.description = o.description; s.layoutOk = false; busy(false); say('Here is an idea. Change it however you like.', 'ok'); }).catch(function (e) { busy(false); showError(e); });
    });
    function loadExamples() {
      var host = $('#wzExamples'); host.innerHTML = ''; $('#wzExampleNote').hidden = true;
      if (!s.kind) return;
      api('/api/map-maker/examples?kind=' + s.kind).then(function (o) {
        o.examples.forEach(function (ex) {
          var b = el('button', '', '🏚 ' + ex.title); b.type = 'button';
          b.addEventListener('click', function () {
            ta.value = ex.description; s.description = ex.description; s.layoutOk = false; s.name = '';
            if (ex.size) { s.size = ex.size; $('#szSize').value = ex.size; }
            if (ex.orientation) { s.orientation = ex.orientation; $('#szOrient').value = ex.orientation; }
            var n = $('#wzExampleNote'); n.textContent = ex.note || ''; n.hidden = !ex.note; render();
          });
          host.appendChild(b);
        });
      }).catch(function () { /* the examples are optional */ });
    }
    document.addEventListener('wizard-step', function (ev) { if (ev.detail === 'describe') loadExamples(); });
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition, mic = $('#wzMic'), rec = null;
    if (!SR) { mic.hidden = true; return; }
    mic.addEventListener('click', function () {
      if (rec) { rec.stop(); return; }
      rec = new SR(); rec.continuous = true; rec.interimResults = false; rec.lang = 'en-US';
      var base = ta.value ? ta.value.replace(/\s*$/, ' ') : '';
      rec.onresult = function (ev) { var t = ''; for (var i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript; ta.value = base + t.trim(); s.description = ta.value; s.layoutOk = false; render(); };
      rec.onend = function () { rec = null; mic.textContent = '🎤 Speak'; mic.classList.remove('live'); };
      rec.onerror = function () { say('The microphone did not work here. Type instead.', 'bad'); };
      mic.textContent = '■ Stop'; mic.classList.add('live'); rec.start();
    });
    $('#descBack').addEventListener('click', back);
    $('#descNext').addEventListener('click', function () {
      if (s.kind !== 'battle') { next(); return; }
      designLayout();
    });
  }

  // ---- step 3: the layout (battle maps)
  function designLayout() {
    s.history = [];
    busy(true, 'The AI is drawing the layout (this takes about 20 to 60 seconds)...');
    api('/api/map-maker/layout', { description: s.description, size: s.size, orientation: s.orientation }).then(function (o) {
      busy(false); s.name = s.name || o.name || ''; s.setting = o.setting || 'indoor'; $('#lySetting').value = s.setting;
      $('#lyCost').textContent = 'Designed by ' + o.model + (o.attempts > 1 ? ' (second try)' : '') + ' for about ' + money(o.cost || 0) + '. ' + (o.summary || '');
      go('layout'); showLayout(o);
    }).catch(function (e) { busy(false); showError(e); });
  }
  function showLayout(o) {
    s.grid = o.grid || []; $('#lyUndo').disabled = !s.history.length; s.layoutOk = !!o.ok;
    $('#lySvg').innerHTML = o.svg || '';
    $('#lyGrid').value = s.grid.join('\n');
    var st = o.stats;
    $('#lyStats').textContent = o.cols + ' x ' + o.rows + ' squares' + (st ? ' · ' + Math.round(st.walkable / st.total * 100) + '% floor · ' + st.doors + ' doors · ' + st.lights + ' lights' : '');
    var ul = $('#lyProblems'); ul.innerHTML = '';
    (o.problems || []).forEach(function (p) { ul.appendChild(el('li', p.level === 'error' ? 'bad' : 'warn', p.text)); });
    if (!(o.problems || []).length) ul.appendChild(el('li', 'good', 'No problems found: every room can be reached and the doors are in doorways.'));
    $('#lyOk').textContent = o.ok ? 'Playable' : 'Not playable yet: fix the red items';
    $('#lyOk').className = 'pill ' + (o.ok ? 'good' : 'bad');
    $('#layoutNext').disabled = !o.ok;
  }
  function buildLayout() {
    $('#lyCheck').addEventListener('click', function () {
      busy(true, 'Checking...');
      var before = s.grid.slice(); api('/api/map-maker/layout/check', { grid: $('#lyGrid').value.split('\n').map(function (r) { return r.replace(/\s+$/, ''); }).filter(function (r) { return r.length; }) }).then(function (o) { if (o.grid.join('\n') !== before.join('\n')) { s.history.push(before); s.draft = null; } busy(false); showLayout(o); say('Checked.', 'ok'); }).catch(function (e) { busy(false); showError(e); });
    });
    $('#lyRedo').addEventListener('click', designLayout);
    $('#lyChange').addEventListener('click', function () {
      var words = $('#lyWords').value.trim();
      if (!words) { say('Say what to change first.', 'bad'); $('#lyWords').focus(); return; }
      var before = s.grid.slice();
      busy(true, 'The AI is changing the layout (about 20 to 60 seconds)...');
      api('/api/map-maker/layout/revise', { grid: before, instruction: words, description: s.description }).then(function (o) {
        s.history.push(before); busy(false); showLayout(o); $('#lyWords').value = '';
        $('#lyCost').textContent = 'Changed by ' + o.model + ' for about ' + money(o.cost || 0) + '. ' + (o.summary || '');
        s.draft = null;
      }).catch(function (e) { busy(false); showError(e); });
    });
    $('#lyUndo').addEventListener('click', function () {
      if (!s.history.length) return;
      var prev = s.history.pop();
      busy(true, 'Going back...');
      api('/api/map-maker/layout/check', { grid: prev }).then(function (o) { busy(false); showLayout(o); s.draft = null; say('Went back one change.', 'ok'); }).catch(function (e) { busy(false); showError(e); });
    });
    $('#lySetting').addEventListener('change', function (e) { s.setting = e.target.value; });
    $('#layoutBack').addEventListener('click', back);
    $('#layoutNext').addEventListener('click', next);
  }

  // ---- step 4: paint
  function loadPaintOptions() {
    $('#paintResult').hidden = !s.draft;
    api('/api/map-maker/paint-options?kind=' + s.kind).then(function (o) { s.paintOptions = o; fillPaint(); }).catch(showError);
  }
  function fillPaint() {
    var o = s.paintOptions, usable = o.providers.filter(function (p) { return p.available; });
    $('#paintNone').hidden = usable.length > 0; $('#paintForm').hidden = usable.length === 0;
    if (!usable.length) return;
    var prov = $('#pvProvider'); prov.innerHTML = '';
    usable.forEach(function (p) { var op = el('option', '', p.label); op.value = p.id; prov.appendChild(op); });
    prov.value = o.selected ? o.selected.provider : usable[0].id;
    fillModels(o.selected && o.selected.provider === prov.value ? o.selected : null);
    $('#pvNote').textContent = s.kind === 'battle' ? 'The painter is given your checked layout and told to keep every wall, door and object where it is, so the walls fit the picture.' : 'The picture is made from your description alone. Words are never painted: names can be added later.';
  }
  function provider() { return s.paintOptions.providers.filter(function (p) { return p.id === $('#pvProvider').value; })[0]; }
  function fillModels(pick) {
    var p = provider(), m = $('#pvModel'); m.innerHTML = '';
    p.models.forEach(function (x) { var op = el('option', '', x.label); op.value = x.id; m.appendChild(op); });
    if (pick) m.value = pick.model;
    fillQualities(pick);
  }
  function fillQualities(pick) {
    var model = provider().models.filter(function (x) { return x.id === $('#pvModel').value; })[0], q = $('#pvQuality'); q.innerHTML = '';
    model.qualities.forEach(function (x) { var op = el('option', '', x); op.value = x; q.appendChild(op); });
    q.value = pick && model.qualities.indexOf(pick.quality) >= 0 ? pick.quality : model.qualities[Math.floor(model.qualities.length / 2)];
    priceLine();
  }
  function priceLine() {
    var model = provider().models.filter(function (x) { return x.id === $('#pvModel').value; })[0], cost = model.costs[$('#pvQuality').value];
    $('#pvPaint').textContent = (s.draft ? 'Paint it again' : 'Paint it') + ' (about ' + money(cost) + ')';
    $('#pvCost').textContent = 'A picture costs about ' + money(cost) + ', charged by ' + provider().label + ' to your account. It takes about 20 to 60 seconds.';
  }
  function buildPaint() {
    $('#pvProvider').addEventListener('change', function () { fillModels(null); });
    $('#pvModel').addEventListener('change', function () { fillQualities(null); });
    $('#pvQuality').addEventListener('change', priceLine);
    $('#pvPaint').addEventListener('click', function () {
      busy(true, 'Painting... (about 20 to 60 seconds)');
      api('/api/map-maker/paint', { kind: s.kind, description: s.description, setting: s.setting, grid: s.grid, orientation: s.orientation, provider: $('#pvProvider').value, model: $('#pvModel').value, quality: $('#pvQuality').value }).then(function (o) {
        s.draft = o; busy(false); showDraft(); say('Painted in ' + o.seconds + ' seconds, about ' + money(o.cost) + '.', 'ok');
      }).catch(function (e) { busy(false); showError(e); });
    });
    $('#pvOverlay').addEventListener('input', overlay);
    $('#paintBack').addEventListener('click', back);
    $('#paintNext').addEventListener('click', next);
  }
  function overlay() { $('#pvSvg').style.opacity = String(Number($('#pvOverlay').value) / 100); }
  function showDraft() {
    var d = s.draft; if (!d) { $('#paintResult').hidden = true; return; }
    $('#paintResult').hidden = false;
    $('#pvImg').src = d.url + '?t=' + Date.now();
    var sv = $('#pvSvg'); sv.innerHTML = s.kind === 'battle' ? $('#lySvg').innerHTML : '';
    var svg = sv.querySelector('svg'); if (svg) { svg.setAttribute('preserveAspectRatio', 'none'); svg.removeAttribute('width'); svg.removeAttribute('height'); svg.style.width = '100%'; svg.style.height = '100%'; }
    $('#pvOverlayRow').hidden = s.kind !== 'battle'; overlay();
    var drift = '';
    if (d.drift) drift = 'The painter kept the walls ' + (d.drift.medianPx <= 8 ? 'very close' : d.drift.medianPx <= 20 ? 'fairly close' : 'loosely') + ' to the layout (typical shift ' + d.drift.medianPx + ' px, ' + Math.round(d.drift.within20 * 100) + '% of walls within 20 px). Slide the layout over the picture to see for yourself. ';
    $('#pvFacts').textContent = d.width + ' x ' + d.height + ' px. ' + drift + (d.note || '');
    priceLine();
  }

  // ---- step 5: save
  function buildSave() {
    $('#saveBack').addEventListener('click', back);
    $('#sSave').addEventListener('click', function () {
      var name = $('#sName').value.trim();
      if (!name) { say('Give the map a name first.', 'bad'); $('#sName').focus(); return; }
      busy(true, 'Saving...');
      api('/api/map-maker/save', { draftId: s.draft.draftId, name: name, grid: s.grid, setting: s.setting }).then(function (o) {
        say('Saved. Opening it in Map Test...', 'ok');
        window.location.href = o.url;
      }).catch(function (e) { busy(false); showError(e); });
    });
  }

  function buildTabs() {
    function show(which) {
      $('#make').hidden = which !== 'make'; $('#notes').hidden = which !== 'notes';
      $('#tabMake').classList.toggle('on', which === 'make'); $('#tabNotes').classList.toggle('on', which === 'notes');
    }
    $('#tabMake').addEventListener('click', function () { show('make'); });
    $('#tabNotes').addEventListener('click', function () { show('notes'); });
    show('make');
  }

  buildTabs(); buildType(); buildDescribe(); buildLayout(); buildPaint(); buildSave(); render();
})();
