// Ambient sound and mood, synthesised in the browser with the Web Audio API: no sound files, so nothing to license or download.
// Window.Ambience: setScene(kind), setMood(mood), sfx(name), setVolume(0..1), setEnabled(bool), duck(bool), unlock().
(function (root) {
  'use strict';

  var SCENES = ['none', 'forest', 'night', 'wind', 'cave', 'dungeon', 'tavern', 'town', 'rain', 'fire'];
  var MOODS = ['calm', 'tense', 'combat', 'eerie', 'triumph'];
  var SFX = ['door', 'creak', 'thunder', 'bell', 'roar', 'howl', 'clash', 'magic', 'explosion', 'splash'];
  // Sounds the user rated "Wrong" on the Sound Test page stay switched off in the game (silence is better than a wrong sound) until they are retuned.
  // The ones rated "Good" (scenes forest, wind, rain; mood eerie; effects thunder, clash) are kept as they are.
  var RETIRED = { scene: ['tavern', 'town', 'fire', 'cave', 'dungeon'], mood: ['tense', 'triumph'], sfx: ['door', 'creak', 'magic'] };
  var allowRetired = false;      // the Sound Test page turns this on so every sound can still be played and judged
  var isRetired = function (kind, name) { return !allowRetired && RETIRED[kind].indexOf(name) >= 0; };

  var analyser = null;
  var ctx = null, master = null, sceneBus = null, moodBus = null, noiseBuf = null, brownBuf = null;
  var enabled = true, volume = 0.5, ducked = false;
  var files = {};       // 'scene:forest' -> '/audio/scene-forest.ogg' (the user's own recordings, see public/audio/README.md)
  var buffers = {};
  var scene = { kind: 'none', stop: null };
  var mood = { kind: 'calm', stop: null };

  function ensure() {
    if (ctx) return true;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    sceneBus = ctx.createGain();
    moodBus = ctx.createGain();
    var comp = ctx.createDynamicsCompressor();
    sceneBus.connect(master);
    moodBus.connect(master);
    master.connect(comp);
    comp.connect(ctx.destination);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    comp.connect(analyser);
    applyGain();
    noiseBuf = makeNoise(false);
    brownBuf = makeNoise(true);
    return true;
  }

  function makeNoise(brown) {
    var len = ctx.sampleRate * 3, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0), last = 0;
    for (var i = 0; i < len; i++) {
      var w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }

  function applyGain() {
    if (!ctx) return;
    var g = enabled ? volume * (ducked ? 0.3 : 1) : 0;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(g, ctx.currentTime, 0.25);
  }

  /* ---------------- small building blocks (each returns nodes to stop) ---------------- */
  function noise(brown, loop) {
    var s = ctx.createBufferSource();
    s.buffer = brown ? brownBuf : noiseBuf;
    s.loop = loop !== false;
    return s;
  }
  function filter(type, freq, q) { var f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; if (q) f.Q.value = q; return f; }
  function gain(v) { var g = ctx.createGain(); g.gain.value = v; return g; }
  function lfo(hz, depth, target) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = hz; g.gain.value = depth;
    o.connect(g); g.connect(target); o.start();
    return o;
  }
  function every(fn, minMs, maxMs) {
    var t = null, dead = false;
    function next() { t = setTimeout(function () { if (dead) return; fn(); next(); }, minMs + Math.random() * (maxMs - minMs)); }
    next();
    return function () { dead = true; clearTimeout(t); };
  }
  function burst(freq, q, dur, level, type, bus) {
    var n = noise(false, false), f = filter(type || 'bandpass', freq, q), g = ctx.createGain(), t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f); f.connect(g); g.connect(bus);
    n.start(t, Math.random() * 2); n.stop(t + dur + 0.05);
  }
  function ping(freq, dur, level, bus) {
    var o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.05);
  }

  /* ---------------- recordings dropped into public/audio ---------------- */
  function loadBuffer(url) {
    if (!buffers[url]) buffers[url] = fetch(url).then(function (r) { return r.arrayBuffer(); }).then(function (b) { return ctx.decodeAudioData(b); });
    return buffers[url];
  }
  // A layer that plays a recording (looping or once) instead of synthesising the sound.
  function fileLayer(url, loop) {
    return function (bus) {
      var cancelled = false, src = null;
      loadBuffer(url).then(function (buf) {
        if (cancelled) return;
        src = ctx.createBufferSource(); src.buffer = buf; src.loop = loop; src.connect(bus); src.start();
      }).catch(function () { /* an unreadable file is skipped */ });
      return [{ stop: function () { cancelled = true; if (src) { try { src.stop(); } catch (e) { /* already stopped */ } } } }];
    };
  }

  /* ---------------- ambient scenes ---------------- */
  // Wind: a low body, a mid whoosh that gusts and a high hiss, each swelling at its own slow rate.
  function wind(bus, strength) {
    var out = [];
    [['lowpass', 260, 0.7, 0.09, true], ['bandpass', 850, 0.5, 0.13, true], ['highpass', 2800, 0.4, 0.02, false]].forEach(function (b, i) {
      var n = noise(b[4]), f = filter(b[0], b[1], b[2]), g = gain(b[3] * strength);
      n.connect(f); f.connect(g); g.connect(bus); n.start();
      out.push(n, lfo(0.06 + i * 0.045, b[3] * 0.7 * strength, g.gain));
      if (i === 1) out.push(lfo(0.08, 300, f.frequency));
    });
    return out;
  }
  // Rain: a bright wash, a low patter and many tiny drops.
  function rain(bus, strength) {
    var out = [];
    [['bandpass', 3600, 0.35, 0.05], ['highpass', 6500, 0.5, 0.018], ['lowpass', 400, 0.7, 0.03]].forEach(function (b, i) {
      var n = noise(i === 2), f = filter(b[0], b[1], b[2]), g = gain(b[3] * strength);
      n.connect(f); f.connect(g); g.connect(bus); n.start(); out.push(n);
    });
    out.push({ stop: every(function () { burst(1800 + Math.random() * 4200, 9, 0.012 + Math.random() * 0.02, 0.025 * strength * Math.random(), 'bandpass', bus); }, 12, 45) });
    return out;
  }
  function fire(bus, strength) {
    var n = noise(true), f = filter('lowpass', 500), g = gain(0.1 * strength);
    n.connect(f); f.connect(g); g.connect(bus); n.start();
    var stop = every(function () { burst(1200 + Math.random() * 2400, 3, 0.04 + Math.random() * 0.05, 0.06 * strength * Math.random(), 'bandpass', bus); }, 60, 260);
    return [n, { stop: stop }];
  }
  function crickets(bus, strength) {
    var stops = [];
    [4300, 4650, 5100].forEach(function (hz, i) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = hz; g.gain.value = 0;
      o.connect(g); g.connect(bus); o.start();
      var rate = 7 + i * 1.7;
      var l = ctx.createOscillator(), lg = ctx.createGain();
      l.type = 'square'; l.frequency.value = rate; lg.gain.value = 0.006 * strength;
      var slow = ctx.createOscillator(), sg = ctx.createGain();
      slow.frequency.value = 0.15 + i * 0.05; sg.gain.value = 0.5; slow.connect(sg);
      var gate = ctx.createGain(); gate.gain.value = 0.5; sg.connect(gate.gain);
      l.connect(lg); lg.connect(gate); gate.connect(g.gain); l.start(); slow.start();
      stops.push(o, l, slow);
    });
    return stops;
  }
  function drips(bus, strength) {
    var echo = ctx.createDelay(1); echo.delayTime.value = 0.32;
    var fb = gain(0.45); echo.connect(fb); fb.connect(echo);
    var wet = gain(0.7); echo.connect(wet); wet.connect(bus);
    var stop = every(function () {
      var f = 700 + Math.random() * 1100, g = gain(1); g.connect(bus); g.connect(echo);
      ping(f, 0.18, 0.05 * strength, g);
      setTimeout(function () { try { g.disconnect(); } catch (e) { /* done */ } }, 600);
    }, 900, 4200);
    return [{ stop: stop }, { stop: function () { try { echo.disconnect(); fb.disconnect(); wet.disconnect(); } catch (e) { /* done */ } } }];
  }
  function drone(bus, hz, level) {
    var out = [];
    [hz, hz * 1.503, hz * 0.5].forEach(function (f, i) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = i === 1 ? 'triangle' : 'sine'; o.frequency.value = f + i * 0.4; g.gain.value = level / (i + 1);
      o.connect(g); g.connect(bus); o.start();
      out.push(o, lfo(0.05 + i * 0.03, level * 0.4, g.gain));
    });
    return out;
  }
  // A crowd: noise through speech-like bands that each swell and fade at the rate of syllables, so it reads as many people talking.
  function murmur(bus, strength) {
    var out = [];
    [[480, 3.1], [1300, 4.3], [2300, 5.4], [850, 2.3], [3200, 6.1]].forEach(function (f, i) {
      var n = noise(false), bp = filter('bandpass', f[0], 2.6), g = gain(0.05 * strength);
      n.connect(bp); bp.connect(g); g.connect(bus); n.start();
      out.push(n, lfo(f[1], 0.045 * strength, g.gain), lfo(0.13 + i * 0.07, 140, bp.frequency));
    });
    out.push({ stop: every(function () { ping(2300 + Math.random() * 1500, 0.25, 0.012 * strength, bus); }, 2500, 8000) });
    return out;
  }
  // Birds: short phrases of two to four rising or falling notes, at different pitches.
  function birds(bus, strength) {
    var stop = every(function () {
      var base = 2200 + Math.random() * 2200, notes = 2 + Math.floor(Math.random() * 3), dir = Math.random() < 0.5 ? 1 : -1, t0 = ctx.currentTime;
      for (var k = 0; k < notes; k++) {
        var o = ctx.createOscillator(), g = ctx.createGain(), t = t0 + k * (0.09 + Math.random() * 0.05), f0 = base * (1 + dir * k * 0.1);
        o.type = 'sine';
        o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * (1 + 0.18 * dir), t + 0.07);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.022 * strength, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
        o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.14);
      }
    }, 1400, 5600);
    return [{ stop: stop }];
  }

  var BUILD = {
    none: function () { return []; },
    wind: function (b) { return wind(b, 1); },
    forest: function (b) { return wind(b, 0.5).concat(birds(b, 1)); },
    night: function (b) { return wind(b, 0.4).concat(crickets(b, 1), fire(b, 0.7)); },
    cave: function (b) { return drone(b, 55, 0.05).concat(drips(b, 1), wind(b, 0.25)); },
    dungeon: function (b) { return drone(b, 49, 0.06).concat(drips(b, 0.8), fire(b, 0.25)); },
    tavern: function (b) { return murmur(b, 1).concat(fire(b, 0.6)); },
    town: function (b) { return wind(b, 0.35).concat(murmur(b, 0.35), birds(b, 0.7)); },
    rain: function (b) { return rain(b, 1).concat(wind(b, 0.35)); },
    fire: function (b) { return fire(b, 1).concat(crickets(b, 0.4)); }
  };

  /* ---------------- moods ---------------- */
  var MOOD = {
    calm: function () { return []; },
    tense: function (b) { return drone(b, 62, 0.07); },
    combat: function (b) {
      var out = drone(b, 58, 0.05);
      var beat = 0;
      var stop = every(function () {
        beat = (beat + 1) % 4;
        var t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
        g.gain.setValueAtTime(beat === 0 ? 0.55 : 0.32, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
        o.connect(g); g.connect(b); o.start(t); o.stop(t + 0.3);
        if (beat % 2 === 1) burst(6500, 1, 0.05, 0.07, 'highpass', b);
      }, 430, 430);
      out.push({ stop: stop });
      return out;
    },
    eerie: function (b) {
      var out = [];
      [220, 233.1, 329.6].forEach(function (f, i) {
        var o = ctx.createOscillator(), g = ctx.createGain(), lp = filter('lowpass', 700);
        o.type = 'sawtooth'; o.frequency.value = f; g.gain.value = 0.012;
        o.connect(lp); lp.connect(g); g.connect(b); o.start();
        out.push(o, lfo(0.09 + i * 0.04, 7, o.frequency));
      });
      [1760, 2093, 2637].forEach(function (f, i) {                                    // a glassy shimmer above the low pad
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f; g.gain.value = 0.004;
        o.connect(g); g.connect(b); o.start();
        out.push(o, lfo(0.2 + i * 0.13, 0.003, g.gain), lfo(5 + i, 6, o.frequency));
      });
      out.push({ stop: every(function () { burst(1800 + Math.random() * 1500, 6, 1.4, 0.04, 'bandpass', b); }, 3000, 7000) });
      return out;
    },
    triumph: function (b) {
      var t = ctx.currentTime;
      [261.6, 329.6, 392, 523.3].forEach(function (f, i) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'triangle'; o.frequency.value = f;
        g.gain.setValueAtTime(0, t + i * 0.12); g.gain.linearRampToValueAtTime(0.05, t + 0.5 + i * 0.12); g.gain.exponentialRampToValueAtTime(0.0001, t + 4);
        o.connect(g); g.connect(b); o.start(t + i * 0.12); o.stop(t + 4.2);
      });
      return [];
    }
  };

  function disposeNodes(nodes) {
    nodes.forEach(function (n) {
      try { if (typeof n.stop === 'function') n.stop(); } catch (e) { /* already stopped */ }
      try { if (n.disconnect) n.disconnect(); } catch (e) { /* not connected */ }
    });
  }

  function crossfade(bus, current, build, fadeMs, kind) {
    // The old layer fades out on its own bus; the new one fades in on a fresh bus.
    var old = current.stop;
    if (old) old();
    var layerBus = ctx.createGain();
    layerBus.gain.value = 0;
    layerBus.connect(bus);
    var nodes = (build || function () { return []; })(layerBus);
    layerBus.gain.setTargetAtTime(1, ctx.currentTime, fadeMs / 3000);
    current.kind = kind;
    current.stop = function () {
      layerBus.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
      setTimeout(function () { disposeNodes(nodes); try { layerBus.disconnect(); } catch (e) { /* done */ } }, 2500);
    };
  }

  /* ---------------- sound effects ---------------- */
  // A rusty hinge: a sawtooth that glides down with a fast wobble, through a resonant band.
  function creak(dur, level) {
    var t = ctx.currentTime, o = ctx.createOscillator(), f = filter('bandpass', 1100, 5), g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(420, t); o.frequency.exponentialRampToValueAtTime(230, t + dur);
    lfo(21, 28, o.frequency).stop(t + dur + 0.1);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + 0.12); g.gain.linearRampToValueAtTime(level * 0.6, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  // A growl: a low sawtooth chopped by a fast tremor and shaped by two vowel-like bands.
  function growl(f0a, f0b, dur, level) {
    var t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(), f1 = filter('bandpass', 550, 4), f2 = filter('bandpass', 1150, 5), mix = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0a, t); o.frequency.exponentialRampToValueAtTime(f0b, t + dur);
    var trem = ctx.createGain(); trem.gain.value = 0.6; lfo(26, 0.4, trem.gain).stop(t + dur + 0.1);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + 0.2); g.gain.setValueAtTime(level, t + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(trem); trem.connect(f1); trem.connect(f2); f1.connect(mix); f2.connect(mix); mix.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  var EFFECTS = {
    door: function () {
      [[85, 0.55], [170, 0.32], [330, 0.2]].forEach(function (p) { ping(p[0], 0.5, p[1], master); });   // the wooden body of the door
      burst(1500, 1.2, 0.07, 0.35, 'bandpass', master);                                                 // wood knocking on the frame
      setTimeout(function () { creak(0.9, 0.2); }, 90);
    },
    creak: function () { creak(1.4, 0.35); },
    thunder: function () {
      burst(3200, 0.6, 0.14, 0.5, 'highpass', master);                                                  // the crack
      [[170, 3.4, 1.1], [90, 4.6, 0.9]].forEach(function (p, i) {
        setTimeout(function () { var n = noise(true, false), f = filter('lowpass', p[0]), g = ctx.createGain(), t = ctx.currentTime; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(p[2], t + 0.3 + i * 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + p[1]); n.connect(f); f.connect(g); g.connect(master); n.start(t, 0); n.stop(t + p[1] + 0.1); }, 80 + i * 260);
      });
    },
    bell: function () { [523.3, 1046.5, 1568, 2093, 2637].forEach(function (f, i) { ping(f, 3.4 - i * 0.5, 0.13 / (i + 1), master); }); burst(2400, 2, 0.05, 0.12, 'bandpass', master); },
    roar: function () { growl(95, 55, 1.9, 1.6); burst(500, 1, 1.4, 0.22, 'lowpass', master); },
    howl: function () {
      var t = ctx.currentTime, o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), f = filter('bandpass', 900, 1.2);
      [o, o2].forEach(function (x, i) {
        x.type = i ? 'triangle' : 'sine';
        x.frequency.setValueAtTime(i ? 640 : 320, t); x.frequency.linearRampToValueAtTime(i ? 960 : 480, t + 0.9); x.frequency.setValueAtTime(i ? 960 : 480, t + 1.5); x.frequency.exponentialRampToValueAtTime(i ? 560 : 280, t + 3);
        lfo(5.2, i ? 14 : 8, x.frequency).stop(t + 3.2);
        x.connect(f); x.start(t); x.stop(t + 3.1);
      });
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.14, t + 0.5); g.gain.setValueAtTime(0.14, t + 1.8); g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
      f.connect(g); g.connect(master);
    },
    clash: function () {
      [0, 0.045].forEach(function (d, k) {
        setTimeout(function () { burst(4200, 1.5, 0.06, 0.4, 'highpass', master); [1450, 2210, 3170, 4380, 5900].forEach(function (f, i) { ping(f * (1 + k * 0.01), 1.0 - i * 0.12, 0.07 / (1 + i * 0.3), master); }); }, d * 1000);
      });
    },
    magic: function () { sweep(300, 1800, 0.9, 0.08, 'sine'); [1600, 2100, 2800, 3500].forEach(function (f, i) { setTimeout(function () { ping(f, 0.9, 0.05, master); }, 150 + i * 110); }); },
    explosion: function () {
      burst(900, 0.5, 1.8, 0.8, 'lowpass', master); sweep(120, 35, 1.2, 0.35, 'sine'); burst(3000, 0.5, 0.1, 0.35, 'highpass', master);
      for (var i = 0; i < 14; i++) setTimeout(function () { burst(1500 + Math.random() * 3500, 4, 0.05, 0.1 * Math.random(), 'bandpass', master); }, 200 + Math.random() * 1500);     // falling debris
    },
    splash: function () {
      burst(2600, 0.7, 0.55, 0.32, 'bandpass', master); burst(900, 0.7, 0.45, 0.3, 'lowpass', master); ping(170, 0.25, 0.3, master);
      for (var i = 0; i < 7; i++) setTimeout(function () { var o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime, f = 500 + Math.random() * 700; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 2.2, t + 0.07); g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09); o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.1); }, 80 + Math.random() * 500);   // bubbles
    }
  };
  function sweep(from, to, dur, level, type) {
    var o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.type = type || 'sine';
    o.frequency.setValueAtTime(from, t); o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }

  /* ---------------- public API ---------------- */
  var api = {
    scenes: SCENES, moods: MOODS, sfxNames: SFX, retired: RETIRED,
    isRetired: function (kind, name) { return RETIRED[kind].indexOf(name) >= 0; },
    allowRetired: function (on) { allowRetired = Boolean(on); },
    // Browsers only allow sound after a click or key press; call this from one.
    unlock: function () { if (ensure() && ctx.state === 'suspended') ctx.resume(); },
    setEnabled: function (on) { enabled = Boolean(on); applyGain(); if (enabled) api.unlock(); },
    setVolume: function (v) { volume = Math.min(1, Math.max(0, Number(v) || 0)); applyGain(); },
    duck: function (on) { ducked = Boolean(on); applyGain(); },
    setScene: function (kind) {
      kind = SCENES.indexOf(kind) >= 0 && !isRetired('scene', kind) ? kind : 'none';
      scene.wanted = kind;
      if (!ensure() || ctx.state === 'suspended' || scene.kind === kind) return;
      crossfade(sceneBus, scene, files['scene:' + kind] ? fileLayer(files['scene:' + kind], true) : BUILD[kind], 2500, kind);
    },
    setMood: function (kind) {
      kind = MOODS.indexOf(kind) >= 0 && !isRetired('mood', kind) ? kind : 'calm';
      mood.wanted = kind;
      if (!ensure() || ctx.state === 'suspended' || mood.kind === kind) return;
      crossfade(moodBus, mood, files['mood:' + kind] ? fileLayer(files['mood:' + kind], kind !== 'triumph') : MOOD[kind], kind === 'triumph' ? 200 : 1800, kind);
    },
    sfx: function (name) {
      if (!enabled || isRetired('sfx', name) || !ensure() || ctx.state === 'suspended') return;
      if (files['sfx:' + name]) { loadBuffer(files['sfx:' + name]).then(function (buf) { var s = ctx.createBufferSource(); s.buffer = buf; s.connect(master); s.start(); }).catch(function () { /* skipped */ }); return; }
      if (EFFECTS[name]) EFFECTS[name]();
    },
    // True when a recording in public/audio replaces this sound.
    hasFile: function (kind, name) { return Boolean(files[kind + ':' + name]); },
    // After unlock(), start whatever was asked for before the browser allowed sound.
    resume: function () { api.unlock(); if (scene.wanted && scene.kind !== scene.wanted) { var k = scene.wanted; scene.kind = ''; api.setScene(k); } if (mood.wanted && mood.kind !== mood.wanted) { var m = mood.wanted; mood.kind = ''; api.setMood(m); } },
    // How loud the output is right now (0 to 1): a self-test, since nobody can see sound.
    level: function () { if (!analyser) return 0; var d = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(d); var sum = 0; for (var i = 0; i < d.length; i++) sum += d[i] * d[i]; return Math.sqrt(sum / d.length); },
    // The frequency content right now (0 to 255 per bin, low to high), for the Sound Test spectrogram.
    spectrum: function (out) { if (analyser) analyser.getByteFrequencyData(out); return Boolean(analyser); },
    sampleRate: function () { return ctx ? ctx.sampleRate : 44100; },
    state: function () { return { enabled: enabled, volume: volume, scene: scene.kind, mood: mood.kind, running: Boolean(ctx && ctx.state === 'running') }; }
  };
  // Which recordings exist (the server lists public/audio). Pages can wait on Ambience.ready before showing which sounds are recordings.
  api.ready = typeof fetch === 'function' ? fetch('/api/audio-files').then(function (r) { return r.json(); }).then(function (data) {
    (data.files || []).forEach(function (f) {
      var m = /^(scene|mood|sfx)-([a-z0-9-]+)\.(mp3|ogg|wav|m4a|webm|flac)$/i.exec(f);
      if (m) files[m[1].toLowerCase() + ':' + m[2].toLowerCase()] = '/audio/' + encodeURIComponent(f);
    });
  }).catch(function () { /* no list: everything stays synthesised */ }) : Promise.resolve();
  root.Ambience = api;
})(typeof window !== 'undefined' ? window : globalThis);
