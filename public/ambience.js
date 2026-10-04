// Ambient sound and mood, synthesised in the browser with the Web Audio API: no sound files, so nothing to license or download.
// Window.Ambience: setScene(kind), setMood(mood), sfx(name), setVolume(0..1), setEnabled(bool), duck(bool), unlock().
(function (root) {
  'use strict';

  var SCENES = ['none', 'forest', 'night', 'wind', 'cave', 'dungeon', 'tavern', 'town', 'rain', 'fire'];
  var MOODS = ['calm', 'tense', 'combat', 'eerie', 'triumph'];
  var SFX = ['door', 'creak', 'thunder', 'bell', 'roar', 'howl', 'clash', 'magic', 'explosion', 'splash'];

  var analyser = null;
  var ctx = null, master = null, sceneBus = null, moodBus = null, noiseBuf = null, brownBuf = null;
  var enabled = true, volume = 0.5, ducked = false;
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

  /* ---------------- ambient scenes ---------------- */
  function wind(bus, strength) {
    var n = noise(true), f = filter('bandpass', 380, 0.6), g = gain(0.18 * strength);
    n.connect(f); f.connect(g); g.connect(bus); n.start();
    var l1 = lfo(0.07, 220, f.frequency), l2 = lfo(0.11, 0.07 * strength, g.gain);
    return [n, l1, l2];
  }
  function rain(bus, strength) {
    var n = noise(false), hp = filter('highpass', 1400), lp = filter('lowpass', 7500), g = gain(0.06 * strength);
    n.connect(hp); hp.connect(lp); lp.connect(g); g.connect(bus); n.start();
    return [n];
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
  function murmur(bus, strength) {
    var n = noise(true), f1 = filter('bandpass', 330, 1.2), f2 = filter('bandpass', 1100, 1.5), g = gain(0.2 * strength);
    n.connect(f1); n.connect(f2); f1.connect(g); f2.connect(g); g.connect(bus); n.start();
    var l1 = lfo(0.4, 0.09 * strength, g.gain), l2 = lfo(0.17, 120, f1.frequency);
    var clink = every(function () { ping(2300 + Math.random() * 1500, 0.25, 0.012 * strength, bus); }, 2500, 8000);
    return [n, l1, l2, { stop: clink }];
  }
  function birds(bus, strength) {
    var stop = every(function () {
      var o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime, base = 2400 + Math.random() * 1600;
      o.type = 'sine';
      o.frequency.setValueAtTime(base, t); o.frequency.linearRampToValueAtTime(base * 1.25, t + 0.08); o.frequency.linearRampToValueAtTime(base * 0.9, t + 0.2);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.02 * strength, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
      o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.3);
    }, 1200, 5200);
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
      out.push({ stop: every(function () { burst(1800 + Math.random() * 1500, 6, 1.4, 0.03, 'bandpass', b); }, 4000, 9000) });
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
  var EFFECTS = {
    door: function () { burst(180, 1, 0.5, 0.5, 'lowpass', master); sweep(110, 70, 0.55, 0.12, 'sawtooth'); },
    creak: function () { sweep(260, 150, 1.1, 0.07, 'sawtooth'); },
    thunder: function () { var n = noise(true, false), f = filter('lowpass', 180), g = ctx.createGain(), t = ctx.currentTime; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1.1, t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2); n.connect(f); f.connect(g); g.connect(master); n.start(t, 0); n.stop(t + 3.3); },
    bell: function () { [523.3, 1046.5, 1568, 2093].forEach(function (f, i) { ping(f, 3.2 - i * 0.5, 0.13 / (i + 1), master); }); },
    roar: function () { sweep(95, 60, 1.6, 0.3, 'sawtooth'); burst(500, 1, 1.4, 0.35, 'lowpass', master); },
    howl: function () { sweep(300, 520, 0.8, 0.1, 'sine'); setTimeout(function () { sweep(520, 280, 1.8, 0.1, 'sine'); }, 700); },
    clash: function () { burst(3500, 2, 0.35, 0.4, 'highpass', master); [1900, 2740, 4100].forEach(function (f) { ping(f, 0.5, 0.06, master); }); },
    magic: function () { sweep(300, 1800, 0.9, 0.08, 'sine'); [1600, 2100, 2800].forEach(function (f, i) { setTimeout(function () { ping(f, 0.9, 0.05, master); }, 150 + i * 110); }); },
    explosion: function () { burst(900, 0.5, 1.8, 0.8, 'lowpass', master); sweep(120, 35, 1.2, 0.35, 'sine'); },
    splash: function () { burst(2200, 0.7, 0.7, 0.35, 'bandpass', master); burst(600, 0.7, 0.5, 0.3, 'lowpass', master); }
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
    scenes: SCENES, moods: MOODS, sfxNames: SFX,
    // Browsers only allow sound after a click or key press; call this from one.
    unlock: function () { if (ensure() && ctx.state === 'suspended') ctx.resume(); },
    setEnabled: function (on) { enabled = Boolean(on); applyGain(); if (enabled) api.unlock(); },
    setVolume: function (v) { volume = Math.min(1, Math.max(0, Number(v) || 0)); applyGain(); },
    duck: function (on) { ducked = Boolean(on); applyGain(); },
    setScene: function (kind) {
      kind = SCENES.indexOf(kind) >= 0 ? kind : 'none';
      scene.wanted = kind;
      if (!ensure() || ctx.state === 'suspended' || scene.kind === kind) return;
      crossfade(sceneBus, scene, BUILD[kind], 2500, kind);
    },
    setMood: function (kind) {
      kind = MOODS.indexOf(kind) >= 0 ? kind : 'calm';
      mood.wanted = kind;
      if (!ensure() || ctx.state === 'suspended' || mood.kind === kind) return;
      crossfade(moodBus, mood, MOOD[kind], kind === 'triumph' ? 200 : 1800, kind);
    },
    sfx: function (name) { if (enabled && ensure() && ctx.state !== 'suspended' && EFFECTS[name]) EFFECTS[name](); },
    // After unlock(), start whatever was asked for before the browser allowed sound.
    resume: function () { api.unlock(); if (scene.wanted && scene.kind !== scene.wanted) { var k = scene.wanted; scene.kind = ''; api.setScene(k); } if (mood.wanted && mood.kind !== mood.wanted) { var m = mood.wanted; mood.kind = ''; api.setMood(m); } },
    // How loud the output is right now (0 to 1): a self-test, since nobody can see sound.
    level: function () { if (!analyser) return 0; var d = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(d); var sum = 0; for (var i = 0; i < d.length; i++) sum += d[i] * d[i]; return Math.sqrt(sum / d.length); },
    state: function () { return { enabled: enabled, volume: volume, scene: scene.kind, mood: mood.kind, running: Boolean(ctx && ctx.state === 'running') }; }
  };
  root.Ambience = api;
})(typeof window !== 'undefined' ? window : globalThis);
