// Playback effects for ChatGPT (OpenAI) voices. The speech model only follows age cues loosely,
// so the browser reshapes the audio: a quavering, thin, slower voice for the old, and a higher, quicker one for children.
(function () {
  'use strict';

  var FX = {
    elderly: { rate: 0.8, keepPitch: true, thin: 260, vibrato: { hz: 4.6, depth: 0.0019 } },
    child: { rate: 1.22, keepPitch: false },
    // Light distortion adds grit and the highs are rolled off a little, for a rough, weathered voice.
    gruff: { rate: 0.95, keepPitch: false, distort: 2.5, lowpass: 4500 },
    // A touch quicker, with the pitch kept, for a glib, slippery delivery.
    sly: { rate: 1.06, keepPitch: true },
    // A slightly slower, unhurried pace (pitch kept) reads as poised and authoritative.
    noble: { rate: 0.95, keepPitch: true },
    // A small pitch lift (pitch not preserved) makes the voice read clearly female.
    feminine: { rate: 1.08, keepPitch: false },
    // A small pitch drop (pitch not preserved) makes the voice read clearly male.
    masculine: { rate: 0.92, keepPitch: false, bass: 4 },
    // Slower with pitch not preserved = deeper, then crunch it and roll off the highs for a growl.
    monstrous: { rate: 0.78, keepPitch: false, distort: 14, lowpass: 2600 }
  };

  var ctx = null;
  var source = null;
  var bound = null;
  var nodes = [];

  function setPitchPreserve(el, keep) {
    el.preservesPitch = keep;
    el.mozPreservesPitch = keep;
    el.webkitPreservesPitch = keep;
  }

  function teardown() {
    nodes.forEach(function (n) {
      try { if (n.stop) n.stop(); } catch (e) { /* already stopped */ }
      try { n.disconnect(); } catch (e) { /* not connected */ }
    });
    nodes = [];
    if (source) { try { source.disconnect(); } catch (e) { /* not connected */ } }
  }

  // Call after setting el.src and before el.play(). `tag` is the DM voice tag (elderly, child, ...).
  function apply(el, tag) {
    var fx = FX[tag];

    // Changing src resets playback rate, so set both rates every time.
    var rate = fx ? fx.rate : 1;
    el.defaultPlaybackRate = rate;
    el.playbackRate = rate;
    setPitchPreserve(el, fx ? fx.keepPitch : true);

    var needsGraph = Boolean(fx && (fx.thin || fx.vibrato || fx.distort || fx.lowpass || fx.bass));
    if (!needsGraph && !source) return; // nothing to route; leave the element alone

    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      if (bound !== el) { source = ctx.createMediaElementSource(el); bound = el; }
    } catch (e) {
      console.warn('Voice effects unavailable:', e.message);
      return;
    }

    teardown();
    var tail = source;

    if (needsGraph && fx.thin) {
      var hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = fx.thin;
      hp.Q.value = 0.7;
      tail.connect(hp);
      tail = hp;
      nodes.push(hp);
    }

    if (needsGraph && fx.vibrato) {
      // A short delay whose time wobbles slowly makes the pitch quaver.
      var delay = ctx.createDelay(0.05);
      delay.delayTime.value = 0.004;
      var lfo = ctx.createOscillator();
      lfo.frequency.value = fx.vibrato.hz;
      var depth = ctx.createGain();
      depth.gain.value = fx.vibrato.depth;
      lfo.connect(depth);
      depth.connect(delay.delayTime);
      lfo.start();
      tail.connect(delay);
      tail = delay;
      nodes.push(delay, lfo, depth);
    }

    if (needsGraph && fx.bass) {
      // A low-shelf boost (dB) adds chest resonance.
      var shelf = ctx.createBiquadFilter();
      shelf.type = 'lowshelf';
      shelf.frequency.value = 220;
      shelf.gain.value = fx.bass;
      tail.connect(shelf);
      tail = shelf;
      nodes.push(shelf);
    }

    if (needsGraph && fx.distort) {
      // Soft clipping adds harsh harmonics, which reads as a rough, inhuman growl.
      var shaper = ctx.createWaveShaper();
      var curve = new Float32Array(1024);
      for (var i = 0; i < curve.length; i++) {
        var x = (i / (curve.length - 1)) * 2 - 1;
        curve[i] = Math.tanh(x * fx.distort) * 0.6;
      }
      shaper.curve = curve;
      shaper.oversample = '2x';
      tail.connect(shaper);
      tail = shaper;
      nodes.push(shaper);
    }

    if (needsGraph && fx.lowpass) {
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = fx.lowpass;
      lp.Q.value = 0.7;
      tail.connect(lp);
      tail = lp;
      nodes.push(lp);
    }

    tail.connect(ctx.destination);
  }

  window.VoiceFx = { apply: apply, FX: FX };
})();
