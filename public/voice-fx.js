// Playback effects for ChatGPT (OpenAI) voices. The speech model only follows age cues loosely,
// so the browser reshapes the audio: a quavering, thin, slower voice for the old, and a higher, quicker one for children.
(function () {
  'use strict';

  var FX = {
    elderly: { rate: 0.88, keepPitch: true, thin: 190, vibrato: { hz: 5.2, depth: 0.0009 } },
    child: { rate: 1.22, keepPitch: false }
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

    var needsGraph = Boolean(fx && (fx.thin || fx.vibrato));
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

    tail.connect(ctx.destination);
  }

  window.VoiceFx = { apply: apply, FX: FX };
})();
