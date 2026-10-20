// The tabletop, part of public/index.html: microphone, speech to text and the spoken replies.
// Classic script: it shares one global scope with the other files in public/js/tabletop/, loaded in this order by index.html.
'use strict';

/* =====================================================================
   VOICE MODE: microphone (getUserMedia) + speech-to-text + spoken DM replies
   ===================================================================== */
const VOICE_PROFILES = {
  narrator:  { pitch: 1.0,  rate: 1.0,  gender: null },
  gruff:     { pitch: 0.8,  rate: 0.95, gender: 'male' },
  sly:       { pitch: 1.1,  rate: 1.08, gender: 'male' },
  noble:     { pitch: 1.0,  rate: 0.95, gender: 'male' },
  elderly:   { pitch: 0.75, rate: 0.8,  gender: 'male' },
  child:     { pitch: 1.85, rate: 1.12, gender: 'female' },
  monstrous: { pitch: 0.55, rate: 0.82, gender: 'male' },
  ethereal:  { pitch: 1.2,  rate: 0.88, gender: 'female' },
  feminine:  { pitch: 1.05, rate: 1.0,  gender: 'female' },
  masculine: { pitch: 0.9,  rate: 1.0,  gender: 'male' },
  beast:     { pitch: 0.7,  rate: 0.9,  gender: 'male' },
  smallbeast: { pitch: 2.0, rate: 1.3,  gender: 'female' },
  largebeast: { pitch: 0.62, rate: 0.82, gender: 'male' },
  undead:    { pitch: 0.8,  rate: 0.8,  gender: null }
};

const voice = (() => {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const synth = window.speechSynthesis || null;
  const mic = { stream: null, audioCtx: null, analyser: null, raf: 0, data: null };
  let recognition = null;
  let listening = false;     // recognition currently running
  let continuous = false;    // Start Listening mode
  let holding = false;       // push-to-talk held
  let pendingFlush = null;   // waiting for the recognizer to finish after a release
  let transcript = '';
  let interim = '';
  let speakGen = 0;
  let speaking = false;      // DM audio is playing
  let ignoreUntil = 0;       // quiet period after the DM stops, so echo and tails are dropped
  const TAIL_GRACE_MS = 1200;
  const assigned = new Map(); // speaker name -> SpeechSynthesisVoice (consistent per NPC)

  const status = (text, live = false) => {
    const el = $('#voiceStatus');
    el.textContent = text;
    el.classList.toggle('live', live);
  };

  async function ensureMic() {
    if (mic.stream && mic.stream.active) return true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      status('This browser has no microphone API (needs https or localhost).');
      toast('Microphone API unavailable in this browser', 'error');
      return false;
    }
    try {
      mic.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      const denied = err.name === 'NotAllowedError' || err.name === 'SecurityError';
      const missing = err.name === 'NotFoundError' || err.name === 'OverconstrainedError';
      status(denied ? 'Microphone permission denied. Allow it in the browser site settings.'
        : missing ? 'No microphone found.' : `Microphone error: ${err.message}`);
      toast(denied ? 'Microphone permission denied' : missing ? 'No microphone found' : `Microphone error: ${err.message}`, 'error', 4000);
      return false;
    }
    if (speaking) mic.stream.getAudioTracks().forEach((t) => { t.enabled = false; });
    try {
      mic.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = mic.audioCtx.createMediaStreamSource(mic.stream);
      mic.analyser = mic.audioCtx.createAnalyser();
      mic.analyser.fftSize = 512;
      mic.data = new Uint8Array(mic.analyser.fftSize);
      source.connect(mic.analyser);
      meterLoop();
    } catch (err) {
      console.warn('Level meter unavailable:', err.message);
    }
    return true;
  }

  function meterLoop() {
    if (!mic.analyser) return;
    mic.analyser.getByteTimeDomainData(mic.data);
    let peak = 0;
    for (let i = 0; i < mic.data.length; i++) peak = Math.max(peak, Math.abs(mic.data[i] - 128));
    $('#micLevel').style.width = `${Math.min(100, Math.round((peak / 128) * 160))}%`;
    mic.raf = requestAnimationFrame(meterLoop);
  }

  // Hard-mute the captured stream while the DM talks (the recognizer is also stopped in speak()).
  function setMicMuted(muted) {
    if (mic.stream) mic.stream.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    if (muted) status('Mic muted while the DM speaks…');
    else if (continuous) status('Listening… speak your action.', true);
    else if (!holding) status(SpeechRec ? 'Microphone idle.' : status_idle_no_stt());
  }
  const status_idle_no_stt = () => 'Microphone idle. Speech-to-text is unsupported here; use Chrome or Edge, or type.';

  function releaseMic() {
    cancelAnimationFrame(mic.raf);
    if (mic.stream) mic.stream.getTracks().forEach((t) => t.stop());
    if (mic.audioCtx) mic.audioCtx.close().catch(() => {});
    mic.stream = null; mic.audioCtx = null; mic.analyser = null;
    $('#micLevel').style.width = '0%';
  }

  function reflectUi() {
    const live = holding || continuous;
    $('#micBtn').classList.toggle('live', holding);
    $('#micBtn').textContent = holding ? '🎙 Listening… release to send' : '🎙 Hold to Talk';
    $('#micToggleBtn').textContent = continuous ? 'Stop Listening' : 'Start Listening';
    $('#micToggleBtn').classList.toggle('btn-danger', continuous);
    if (!live) status(SpeechRec ? 'Microphone idle.' : 'Microphone idle. Speech-to-text is unsupported here; use Chrome or Edge, or type.');
  }

  function buildRecognition() {
    const rec = new SpeechRec();
    rec.lang = navigator.language || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      // Ignore anything heard while the DM is talking (or just finished): it is the DM, not the player.
      if (speaking || Date.now() < ignoreUntil) { transcript = ''; interim = ''; return; }
      interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const piece = e.results[i][0].transcript;
        if (e.results[i].isFinal) transcript += `${piece} `;
        else interim += piece;
      }
      $('#chatInput').value = `${transcript}${interim}`.trim();
      status(`Heard: “${$('#chatInput').value}”`, true);
      if (continuous && !holding && transcript.trim() && !interim) flush();
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      const msg = e.error === 'not-allowed' ? 'Speech recognition permission denied.'
        : e.error === 'network' ? 'Speech recognition needs a network connection in this browser.'
        : `Speech recognition error: ${e.error}`;
      status(msg);
      toast(msg, 'error', 4000);
      continuous = false; holding = false;
      reflectUi();
    };
    rec.onend = () => {
      listening = false;
      if (pendingFlush && !holding) { finishHold(); return; }              // the last words are in: send them
      if ((holding || continuous) && !speaking) { startRecognition(); }
    };
    return rec;
  }

  function startRecognition() {
    if (!SpeechRec || listening) return;
    if (!recognition) recognition = buildRecognition();
    try { recognition.start(); listening = true; } catch (err) { console.warn('recognition.start:', err.message); }
  }

  function stopRecognition() {
    if (recognition && listening) { try { recognition.stop(); } catch { /* already stopped */ } }
  }

  // Send whatever has been transcribed so far.
  function flush() {
    const text = `${transcript}${interim}`.trim();
    transcript = ''; interim = '';
    if (!text) return;
    if ($('#autoSendToggle').checked) { $('#chatInput').value = ''; sendTurn(text); }
    else $('#chatInput').value = text;
  }

  async function beginHold() {
    if (holding || state.busy) return;
    if (!(await ensureMic())) return;
    cancelSpeech();
    clearTimeout(pendingFlush); pendingFlush = null;
    holding = true;
    transcript = ''; interim = '';
    reflectUi();
    if (SpeechRec) { status('Listening…', true); startRecognition(); }
    else status('Mic is live, but this browser cannot transcribe speech. Type your action instead.');
  }

  // The talking is over: send what was heard and, unless Start Listening is on, let the microphone stream go (it is only for the level meter; the speech recognizer listens by itself),
  // so the browser's recording indicator goes out too.
  function finishHold() {
    clearTimeout(pendingFlush); pendingFlush = null;
    if (holding) return;
    flush();
    if (!continuous) { releaseMic(); status(SpeechRec ? 'Microphone idle.' : status_idle_no_stt()); }
  }

  function endHold() {
    if (!holding) return;
    holding = false;
    reflectUi();
    // Give the recognizer a moment to deliver its final result before sending.
    setTimeout(() => {
      if (holding) return;                                                    // pressed again in the meantime
      // Stop the recognizer and send what it heard once it has delivered its last words (its onend); a timer covers a recognizer that never ends.
      if (!continuous && listening) { stopRecognition(); pendingFlush = setTimeout(finishHold, 1500); }
      else finishHold();
    }, 350);
  }

  async function toggleContinuous() {
    if (continuous) {
      continuous = false;
      stopRecognition();
      if (!holding) releaseMic();
      reflectUi();
      return;
    }
    if (!(await ensureMic())) return;
    if (!SpeechRec) { status('Mic is live, but this browser cannot transcribe speech. Use Chrome or Edge, or type.'); toast('Speech-to-text is not supported in this browser', 'error', 4000); return; }
    continuous = true;
    transcript = ''; interim = '';
    reflectUi();
    status('Listening… speak your action.', true);
    startRecognition();
  }

  /* ---------- text-to-speech ---------- */
  function pickVoice(speaker, profileName) {
    const key = speaker.toLowerCase();
    if (assigned.has(key)) return assigned.get(key);
    const all = synth.getVoices().filter((v) => /^en/i.test(v.lang));
    const pool = all.length ? all : synth.getVoices();
    if (!pool.length) return null;
    const gender = (VOICE_PROFILES[profileName] || VOICE_PROFILES.narrator).gender;
    const maleRe = /(david|mark|james|george|daniel|alex|male|guy|ryan|thomas|fred|aaron|brian|davis|jason|tony|christopher|eric|roger|andrew|steffan|liam|oliver|arthur)/i;
    const femaleRe = /(zira|susan|hazel|samantha|female|aria|jenny|karen|fiona|victoria|moira|tessa|libby|sonia|michelle|ana|emma|ava|jane|nancy|sara|amber|ashley)/i;
    // Neural/online voices sound far more human than the legacy desktop ones.
    const quality = (v) => (/natural|neural|online/i.test(v.name) ? 100 : 0)
      + (/premium|enhanced|studio|wavenet/i.test(v.name) ? 60 : 0)
      + (/google/i.test(v.name) ? 40 : 0)
      + (v.localService ? 0 : 20)
      - (/desktop|espeak|compact/i.test(v.name) ? 50 : 0);
    const chosenNarrator = store.get('vtt.narratorVoice', '');       // Settings > Dungeon Master voice, when it is a Microsoft voice (kept per browser)
    if (key === 'narrator' && chosenNarrator) {
      const picked = pool.find((v) => v.name === chosenNarrator);
      if (picked) { assigned.set(key, picked); return picked; }
    }
    let candidates = pool;
    if (gender === 'male') candidates = pool.filter((v) => maleRe.test(v.name) && !femaleRe.test(v.name));
    else if (gender === 'female') candidates = pool.filter((v) => femaleRe.test(v.name));
    if (!candidates.length) candidates = pool;
    candidates = [...candidates].sort((a, b) => quality(b) - quality(a));
    // Distinct NPCs get distinct voices where possible, best quality first.
    const used = new Set(assigned.values());
    const choice = candidates.find((v) => !used.has(v)) || candidates[0];
    assigned.set(key, choice);
    return choice;
  }

  let speechQueue = [];       // replies that came while narration was playing (table nudges), spoken in order
  // What the voices did goes into the play log on the server (data/logs), so a session can be reviewed: when the first sound came, what was cut off, what failed.
  let speechT0 = 0, speechFirst = true;
  const logSpeech = (what, detail, ms) => { if (/[?&](nosave|watch)=1/.test(location.search)) return; try { fetch('/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ what, detail, ms }) }).catch(() => {}); } catch { /* no log */ } };
  const firstSound = (provider) => { if (speechFirst) { speechFirst = false; logSpeech('first sound', provider, performance.now() - speechT0); } };
  function cancelSpeech() {
    chainActive = false;
    if (speaking) logSpeech('cut off', speechQueue.length ? `${speechQueue.length} queued reply(ies) dropped` : 'narration stopped before it finished');
    speechQueue = [];
    speakGen++;
    if (speaking) setMicMuted(false);
    speaking = false;
    ignoreUntil = Date.now() + 400;
    if (synth) synth.cancel();
    cloudStop();
    document.querySelectorAll('.voice-line.speaking').forEach((n) => n.classList.remove('speaking'));
  }

  /* ---------- cloud voices (server /api/tts, OpenAI) ---------- */
  const cloud = { enabled: false, dm: 'openai', npc: 'openai', pronunciations: {}, audio: new Audio(), resolve: null };

  // Settings: the Dungeon Master voice (the narrator) and the NPC voices (the characters the DM plays) are each ChatGPT, Microsoft or None (text only).
  const isNarrator = (line) => String(line.speaker || 'Narrator') === 'Narrator';
  const providerOf = (line) => (isNarrator(line) ? cloud.dm : cloud.npc);

  function updateEngineNote() {
    const name = (p) => (p === 'none' ? 'off' : p === 'browser' ? 'Microsoft' : cloud.enabled ? 'ChatGPT' : 'Microsoft (no OpenAI key)');
    $('#voiceEngine').textContent = cloud.dm === cloud.npc
      ? (cloud.dm === 'none' ? 'Voices: off (text only)' : 'Voices: ' + name(cloud.dm))
      : 'Voices: DM ' + name(cloud.dm) + ', NPCs ' + name(cloud.npc);
  }

  async function checkCloud() {
    try {
      const s = await api('/api/tts/status');
      cloud.enabled = Boolean(s.enabled); cloud.dm = s.dm || 'openai'; cloud.npc = s.npc || cloud.dm; cloud.pronunciations = s.pronunciations || {};
    } catch { cloud.enabled = false; }
    updateEngineNote();
  }

  function cloudStop() {
    cloud.audio.pause();
    if (cloud.resolve) { const r = cloud.resolve; cloud.resolve = null; r(false); }
  }

  async function fetchClip(line) {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: line.text, voice: line.voice, speaker: line.speaker || 'Narrator' })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `text-to-speech ${res.status}`);
    }
    return URL.createObjectURL(await res.blob());
  }

  function playClip(url, onstart, tag) {
    return new Promise((resolve) => {
      cloud.resolve = resolve;
      const a = cloud.audio;
      a.onplaying = () => { if (onstart) onstart(); };
      a.onended = () => { cloud.resolve = null; resolve(true); };
      a.onerror = () => { cloud.resolve = null; resolve(false); };
      a.src = url;
      if (window.VoiceFx) VoiceFx.apply(a, tag);
      a.play().catch(() => { cloud.resolve = null; resolve(false); });
    }).finally(() => URL.revokeObjectURL(url));
  }

  /* ---------- speaking: shared mic muting ---------- */
  function beginSpeaking() {
    cancelSpeech();
    if (window.Ambience) Ambience.duck(true);
    const gen = speakGen;
    // Pause the recognizer while the DM talks so it does not transcribe the speakers.
    if (listening && (continuous || holding)) stopRecognition();
    speaking = true;
    setMicMuted(true);
    return gen;
  }

  function endSpeaking(gen) {
    if (gen !== speakGen) return;
    if (window.Ambience) Ambience.duck(false);
    // Keep the mic deaf briefly after the last word so the tail of the narration is not transcribed.
    ignoreUntil = Date.now() + TAIL_GRACE_MS;
    setTimeout(() => {
      if (gen !== speakGen) return;
      speaking = false;
      setMicMuted(false);
      transcript = ''; interim = '';
      if (continuous) startRecognition();
    }, TAIL_GRACE_MS);
  }

  // The campaign's spoken forms of names (pronunciations.json), for the Microsoft voices; the server applies them itself for ChatGPT.
  const escapeRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c);
  const spokenForm = (text) => Object.entries(cloud.pronunciations).reduce((t, [w, sp]) => t.replace(new RegExp('(?<![\\p{L}\\p{N}])' + escapeRe(w) + '(?![\\p{L}\\p{N}])', 'giu'), sp), String(text));

  // One line spoken by the Microsoft (browser) voices; resolves when it ends.
  function speakBrowserLine(line, node, gen) {
    return new Promise((resolve) => {
      if (!synth) { resolve(); return; }
      const profile = VOICE_PROFILES[line.voice] || VOICE_PROFILES.narrator;
      const u = new SpeechSynthesisUtterance(spokenForm(line.text));
      const v = pickVoice(line.speaker || 'Narrator', line.voice);
      if (v) { u.voice = v; u.lang = v.lang; }
      u.pitch = profile.pitch;
      u.rate = profile.rate;
      u.onstart = () => { firstSound('microsoft'); if (gen === speakGen && node) node.classList.add('speaking'); };
      u.onend = () => { if (node) node.classList.remove('speaking'); resolve(); };
      u.onerror = () => { if (node) node.classList.remove('speaking'); resolve(); };
      synth.speak(u);
    });
  }

  // Every line goes to the voice chosen for it, one after another. ChatGPT clips are all requested at once so later lines are ready while earlier ones play; a clip that fails is spoken by the Microsoft voices instead.
  async function speakLines(lines, msgEl, gen, offset = 0) {
    const clips = lines.map((l) => (providerOf(l) === 'openai' && cloud.enabled ? fetchClip(l) : null));
    clips.forEach((p) => { if (p) p.catch(() => {}); });
    let warned = false;
    for (let i = 0; i < lines.length; i++) {
      if (gen !== speakGen) return;
      const line = lines[i], p = providerOf(line);
      if (p === 'none') continue;
      const node = msgEl ? msgEl.querySelector(`.voice-line[data-line="${offset + i}"]`) : null;
      if (p === 'openai' && clips[i]) {
        try {
          const url = await clips[i];
          if (gen !== speakGen) return;
          const played = await playClip(url, () => { firstSound('chatgpt'); if (gen === speakGen && node) node.classList.add('speaking'); }, line.voice);
          if (node) node.classList.remove('speaking');
          if (gen !== speakGen) return;
          if (played) continue;
        } catch (err) {
          logSpeech('chatgpt clip failed', err.message);
          if (!warned) { warned = true; toast(`ChatGPT voice failed (${err.message}). Using Microsoft voices.`, 'error', 5000); }
        }
      }
      if (gen !== speakGen) return;
      await speakBrowserLine(line, node, gen);
    }
  }

  // opts.queue: a reply to a table nudge, or one more line of a reply that is still being written, waits behind what is being said. opts.offset: the number of the first line in its chat message (for the highlight).
  let chainActive = false;       // something is being said, or waiting to be said, right now
  function speak(lines, msgEl, opts) {
    if (!$('#speakToggle').checked || (cloud.dm === 'none' && cloud.npc === 'none')) return;
    const offset = (opts && opts.offset) || 0;
    if (opts && opts.queue && chainActive) { speechQueue.push([lines, msgEl, offset]); logSpeech('queued', 'waits for the narration that is playing'); return; }
    const gen = beginSpeaking();
    chainActive = true;
    speechT0 = performance.now(); speechFirst = true;
    const run = (ls, el, off) => speakLines(ls, el, gen, off).then(() => next(), () => next());
    const next = () => {
      if (gen !== speakGen) return;
      const q = speechQueue.shift();
      if (q) run(q[0], q[1], q[2]); else { chainActive = false; endSpeaking(gen); }
    };
    run(lines, msgEl, offset);
  }

  function init() {
    if (synth) synth.getVoices(); // kick off async voice loading in Chrome
    if (synth && 'onvoiceschanged' in synth) synth.onvoiceschanged = () => { assigned.clear(); };
    checkCloud();
    // Back from the Settings page: pick up a new key, engine or narrator voice.
    window.addEventListener('focus', () => { assigned.clear(); checkCloud(); });
    const btn = $('#micBtn');
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); btn.setPointerCapture(e.pointerId); beginHold(); });
    btn.addEventListener('pointerup', endHold);
    btn.addEventListener('pointercancel', endHold);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    $('#micToggleBtn').addEventListener('click', toggleContinuous);
    $('#stopSpeechBtn').addEventListener('click', cancelSpeech);
    $('#speakToggle').addEventListener('change', (e) => { if (!e.target.checked) cancelSpeech(); });
    // Spacebar push-to-talk while the chat tab is open: hold Space to talk, release to send. It works with focus on a button (the space does not press it) and in the empty
    // chat box (a leading space there is useless); in any other field, or in the chat box once something is typed, Space is just a space.
    let spaceHeld = false;
    const spaceTalks = () => {
      const el = document.activeElement, tag = el?.tagName;
      if (tag === 'BUTTON') return true;
      if (el && el.id === 'chatInput') return !el.value.trim();
      return !/^(INPUT|TEXTAREA|SELECT)$/.test(tag) && !el?.isContentEditable;
    };
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Space') return;
      if (spaceHeld) { if (spaceTalks()) e.preventDefault(); return; }      // key repeat while holding
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || !spaceTalks()) return;
      if (!$('#panel-chat').classList.contains('active')) return;
      e.preventDefault();
      spaceHeld = true;
      beginHold().then(() => { if (!spaceHeld) endHold(); });                // released before the microphone was ready
    });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space' && spaceHeld) { spaceHeld = false; endHold(); } });
    window.addEventListener('blur', () => { if (spaceHeld) { spaceHeld = false; endHold(); } });
    window.addEventListener('beforeunload', () => { if (synth) synth.cancel(); releaseMic(); });
    reflectUi();
  }

  return { init, speak, cancelSpeech, ensureMic };
})();

// Sheet changes the DM made were already saved by the server; show them and refresh the table's copy of each character.
function applyCharacterUpdates(updates, problems) {
  let changed = false;
  for (const u of Array.isArray(updates) ? updates : []) {
    if (!u || !u.character) continue;
    const i = state.characters.findIndex((c) => c.id === u.character.id);
    if (i >= 0) state.characters[i] = u.character; else state.characters.push(u.character);
    for (const note of Array.isArray(u.notes) ? u.notes : []) addChat('system', `↳ ${u.name}: ${note}`);
    if (u.readyLevel) addChat('system', `★ ${u.name} has enough XP to reach level ${u.readyLevel}. Ask the DM to level up.`);
    changed = true;
  }
  for (const p of Array.isArray(problems) ? problems : []) addChat('system', `⚠ ${p}`);
  if (changed) {
    syncTokensWithCharacters();
    commitBoard();
  }
}

async function applyMapUpdates(updates) {
  if (!updates.length) return;
  const travel = updates.find((u) => u.type === 'changeMap');
  if (travel) await travelTo(travel);
  let wallsTouched = false;
  const hpSaves = [];
  // Dash: the table has no Dash button, so the DM sends condition "dashing"; it adds one more move's worth of movement (done first, so the moves in the same reply can use it).
  for (const u of updates) {
    if (u.type !== 'addCondition' || String(u.condition || '').toLowerCase().trim() !== 'dashing') continue;
    const t = state.tokens.find((x) => x.id === u.tokenId);
    if (t && state.combat.active && !hasCondition(t, 'dashing')) { t.movementRemaining = (Number(t.movementRemaining) || 0) + effectiveSpeed(t); if (seenByParty(t)) addChat('system', `↳ ${t.name} dashes (${t.movementRemaining} ft of movement this turn)`); }
  }
  for (const u of updates) {
    switch (u.type) {
      case 'readyToken': {
        const t = state.tokens.find((x) => x.id === u.tokenId);
        if (!t) break;
        // Readying takes the action; when the trigger happens (ready sent again with no text) the reaction is spent.
        const had = t.readied;
        t.readied = String(u.text || '').trim().slice(0, 120);
        if (t.readied) t.spent = { ...(t.spent || { a: false, b: false, r: false }), a: true };
        else if (had) t.spent = { ...(t.spent || { a: false, b: false, r: false }), r: true };
        if (t.readied && seenByParty(t)) addChat('system', `⏳ ${t.name} readies: ${t.readied}`);
        break;
      }
      case 'reactToken': {
        // The DM resolved a reaction (an opportunity attack, Shield, a readied action): it is spent until that combatant's next turn starts.
        const t = state.tokens.find((x) => x.id === u.tokenId);
        if (t) { t.spent = { ...(t.spent || { a: false, b: false, r: false }), r: true }; if (seenByParty(t)) addChat('system', `↳ ${t.name} uses their reaction`); }
        break;
      }
      case 'delayToken': {
        const t = state.tokens.find((x) => x.id === u.tokenId);
        if (t && !delayTurn(t)) state.pendingNotes.push(`${t.name} cannot delay now: only the combatant whose turn it is can delay.`);
        break;
      }
      case 'resumeToken': {
        const t = state.tokens.find((x) => x.id === u.tokenId);
        if (t) resumeTurn(t);
        break;
      }
      case 'dmNote': {
        // DM-only notes: never printed in the chat; the tabletop shows them only with DM view on.
        const text = String(u.text || '').trim();
        if (u.tokenId === 'dm') state.dmPad = text.slice(0, 1500);
        else { const t = state.tokens.find((x) => x.id === u.tokenId); if (t) t.dmNote = text.slice(0, 300); }
        break;
      }
      case 'template':
        addTemplate(u);
        break;
      case 'elevateToken': {
        // How high a creature is above the ground, in feet (0 lands). Only a flyer can choose to stay up; a fall is checked when something takes its flight away.
        const t = state.tokens.find((x) => x.id === u.tokenId);
        if (!t) break;
        const h = clamp(Math.round(Number(u.feet) || 0), 0, 5000);
        t.elevation = h;
        if (seenByParty(t)) addChat('system', h ? `↳ ${t.name} is ${h} ft in the air` : `↳ ${t.name} is on the ground`);
        break;
      }
      case 'discoverPlace': {
        // The DM has the party learn of a named place (or forget it): town and regional maps show the places the players know.
        const slug = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const pin = state.placePins.find((p) => p.name === slug(u.place) || (p.label && slug(p.label) === slug(u.place)));
        if (!pin) { state.pendingNotes.push(`There is no place called "${u.place}" on this map to discover. The places here: ${state.places.filter((p) => !p.dmOnly).map((p) => p.name).join(', ') || 'none'}.`); break; }
        const url = state.map.url, list = (state.knownPlaces[url] = state.knownPlaces[url] || []);
        if (u.on && !list.includes(pin.name)) { list.push(pin.name); if (PlacePins.appliesTo(state.mapKind)) addChat('system', `📍 New place on the map: ${PlacePins.label(pin)}`); }
        else if (!u.on) state.knownPlaces[url] = list.filter((n) => n !== pin.name);
        requestRender();
        break;
      }
      case 'openShop': {
        // The DM opens a merchant's shop for a character: the gear dialog at the Shop tab, with that merchant's stock and prices. What was bought goes back to the DM as a table note.
        if (window.WATCH === true) break;
        const buyerTok = state.tokens.find((x) => x.id === u.buyer && x.characterId) || activeToken();
        const buyer = buyerTok && buyerTok.characterId ? buyerTok.characterId : '';
        if (!buyer) { state.pendingNotes.push(`The shop of ${u.merchant} could not open: say which player character is shopping.`); break; }
        addChat('system', `🛒 ${u.merchant} opens their shop for ${buyerTok.name}`);
        openShopFor(buyer, u);
        break;
      }
      case 'doorAction': {
        // The DM works a door by its number (the order of the doors in the wall list): open, close, lock, unlock, or reveal a secret door.
        const door = state.walls.filter((w) => w.type === 'door')[u.n - 1];
        if (!door) { state.pendingNotes.push(`There is no door ${u.n}: the doors are numbered 1 to ${state.walls.filter((w) => w.type === 'door').length}.`); break; }
        const mid = { x: (door.x1 + door.x2) / 2, y: (door.y1 + door.y2) / 2 }, say = (t) => { if (seenByPartyPoint(mid.x, mid.y)) addChat('system', '↳ ' + t); };
        if (u.op === 'reveal') { if (door.secret) { delete door.secret; addChat('system', '↳ A hidden door is revealed'); } }
        else if (u.op === 'unlock') { if (door.locked) { delete door.locked; say('A door is unlocked'); } }
        else if (u.op === 'lock') { door.open = false; door.locked = true; say('A door is locked'); }
        else if (u.op === 'open') { if (door.secret) state.pendingNotes.push(`Door ${u.n} is still a secret door: reveal it first.`); else if (door.locked) state.pendingNotes.push(`Door ${u.n} is locked: unlock it first.`); else if (!door.open) { door.open = true; say('A door opens'); } }
        else if (u.op === 'close') { if (!door.secret && door.open) { door.open = false; say('A door closes'); } }
        wallsChanged();
        break;
      }
      case 'resizeToken': {
        // Enlarge, reduce or polymorph: a new size. The footprint stays anchored at its top-left square; if it no longer fits there it moves to the nearest place it does.
        const t = state.tokens.find((x) => x.id === u.tokenId);
        if (!t) break;
        t.size = TokenSize.normalize(u.size);
        const n = fp(t);
        const others = state.tokens.filter((x) => x !== t && !(x.dead && !x.isPC)).map((x) => ({ col: x.col, row: x.row, n: fp(x) }));
        const here = { col: clamp(t.col, 0, cols() - n), row: clamp(t.row, 0, rows() - n), n };
        if (others.some((o) => TokenSize.overlaps(here, o))) { t.col = -100; t.row = -100; const spot = freeSquareNear(here.col, here.row, n); t.col = spot.col; t.row = spot.row; } else { t.col = here.col; t.row = here.row; }
        if (seenByParty(t)) addChat('system', `↳ ${t.name} is now ${t.size}`);
        break;
      }
      case 'setWhere': {
        const t = state.tokens.find((x) => x.id === u.tokenId);
        if (!t || !t.isPC) break;
        const note = String(u.where || '').trim().slice(0, 80);
        if (note) {
          t.where = note;
          addChat('system', `↳ ${t.name} is not with the group: ${note}`);
          if (t === activeToken()) { const here = state.tokens.find((x) => x.isPC && !isElsewhere(x)); if (here) state.activeIndex = state.tokens.indexOf(here); }
        } else if (isElsewhere(t)) {
          delete t.where;
          const mates = state.tokens.filter((x) => x.isPC && x !== t && !isElsewhere(x));
          const anchor = mates[0] || t;
          const spot = freeSquareNear(clamp(anchor.col, 0, cols() - 1), clamp(anchor.row, 0, rows() - 1));
          t.col = spot.col; t.row = spot.row;
          addChat('system', `↳ ${t.name} rejoins the group`);
        }
        revealFog();
        break;
      }
      case 'moveToken': {
        const t = state.tokens.find((x) => x.id === u.tokenId);
        if (!t || !Number.isInteger(u.col) || !Number.isInteger(u.row)) break;
        const fromX = tcx(t), fromY = tcy(t);
        let col = clamp(u.col, 0, cols() - fp(t)), row = clamp(u.row, 0, rows() - fp(t));
        // The DM's moves obey the table's walls and the token's speed: a move that cannot be done stops at the nearest square that can.
        const shoved = u.mode === 'forced' || u.mode === 'teleport';       // not the creature's own walking: no opportunity attacks, no movement spent
        if (u.mode === 'teleport') { const spot = freeSquareNear(col, row, fp(t)); col = spot.col; row = spot.row; }
        else if (!plainMap() && !(col === t.col && row === t.row)) {
          const saved = t.movementRemaining;
          t.movementRemaining = u.mode === 'forced' ? 120 : effectiveSpeed(t) * (hasCondition(t, 'dashing') ? 2 : 1);
          const reach = reachable(t);
          t.movementRemaining = saved;
          if (!reach.has(sqKey(col, row))) {
            let best = null, bestD = Math.hypot(col - t.col, row - t.row);
            for (const k of reach.keys()) {
              const [c, r] = k.split(',').map(Number);
              const d = Math.hypot(col - c, row - r);
              if (d < bestD) { bestD = d; best = { c, r }; }
            }
            const note = `${t.name} could not reach (${col}, ${row}) (speed ${effectiveSpeed(t) * (hasCondition(t, 'dashing') ? 2 : 1)} ft and the walls): it went to (${best ? best.c : t.col}, ${best ? best.r : t.row}) instead`;
            state.pendingCorrections.push(note);
            if (seenByParty(t)) addChat('system', '↳ ' + note);
            if (best) { col = best.c; row = best.r; } else { col = t.col; row = t.row; }
          }
        }
        const fromCol = t.col, fromRow = t.row;
        t.col = col;
        t.row = row;
        settleBody(t);
        animateToken(t, fromX, fromY);
        if (seenByParty(t)) addChat('system', `↳ ${t.name} moved to (${t.col}, ${t.row})`);
        if (!t.isPC && !shoved) noteOpportunityAttacks(t, fromCol, fromRow);
        break;
      }
      case 'addToken': {
        if (!u.tokenId || !Number.isInteger(u.col) || !Number.isInteger(u.row)) break;
        const existing = state.tokens.find((x) => x.id === u.tokenId);
        // (col, row) is the top-left square of the footprint. A big creature put exactly on a module-area pin is centred on it when it fits.
        const n = existing ? fp(existing) : TokenSize.squares(u.size);
        let want = { col: u.col, row: u.row };
        if (n > 1 && state.areaPins.some((p) => p.col === u.col && p.row === u.row)) want = TokenSize.topLeftFor(u.col, u.row, n);
        let spot;
        if (existing) spot = { col: clamp(u.col, 0, cols() - n), row: clamp(u.row, 0, rows() - n) };
        else {
          const wc = clamp(want.col, 0, cols() - n), wr = clamp(want.row, 0, rows() - n);
          // Creatures asked for on a pin (the DM gives the pin's square) or on a taken square are spread around it, not stacked tile by tile: a group of goblins stands in the vicinity.
          const onPin = state.areaPins.some((p) => p.col === wc && p.row === wr) || state.places.some((p) => p.col === wc && p.row === wr);
          const taken = state.tokens.filter((t) => !(t.dead && !t.isPC)).map((t) => ({ col: t.col, row: t.row, n: fp(t) }));
          const occupied = taken.some((o) => TokenSize.overlaps({ col: wc, row: wr, n }, o));
          spot = null;
          if (u.isPC !== true && (onPin || occupied) && !plainMap()) {
            const walls = blockingWalls(), keepN = moveN;
            spot = TokenSize.scatter({ col: wc, row: wr, n, id: u.tokenId, taken,
              fits: (c, r) => { if (!inBounds(c, r) || !inBounds(c + n - 1, r + n - 1) || taken.some((o) => TokenSize.overlaps({ col: c, row: r, n }, o))) return false; moveN = n; const b = moveBlocked(wc, wr, c, r, walls); moveN = keepN; return !b; } });
          }
          if (!spot) spot = freeSquareNear(wc, wr, n);
        }
        let token = existing;
        if (existing) {
          Object.assign(existing, spot, { name: u.name || existing.name, color: /^#[0-9a-f]{6}$/i.test(u.color || '') ? u.color : existing.color });
          if (typeof u.hidden === 'boolean') existing.hidden = u.hidden;
          if (u.kind === 'trap' || u.kind === 'creature') existing.kind = u.kind;
        } else {
          token = makeToken({
            id: String(u.tokenId),
            name: u.name || 'Creature',
            color: /^#[0-9a-f]{6}$/i.test(u.color || '') ? u.color : '#a04545',
            isPC: false,
            hidden: u.hidden === true,
            kind: u.kind,
            speed: u.speed != null && Number.isFinite(Number(u.speed)) && Number(u.speed) >= 0 && (Number(u.speed) > 0 || Number(u.flySpeed) > 0) ? Number(u.speed) : 30,
            size: u.size, flySpeed: u.flySpeed, hover: u.hover === true,
            ...spot
          });
          if (Number(u.maxHp) > 0) Object.assign(token, { hp: Number(u.maxHp), maxHp: Number(u.maxHp) });
          if (Number(u.ac) > 0) token.ac = Number(u.ac);
          if (u.monster) token.monster = String(u.monster);
          if (/^\/tokens\/[\w.-]+$/.test(String(u.image || ''))) token.image = u.image;
          if (Number.isFinite(Number(u.dexMod))) token.dexMod = Number(u.dexMod);
          if (Number(u.passivePerception) > 0) token.passivePerception = Number(u.passivePerception);
          if (Number(u.xp) > 0) token.xp = Number(u.xp);
          // Several creatures with the same name get their id number ("Goblin 1", "Goblin 2") so the chat, the rolls and the tracker can tell them apart.
          const numbered = (x) => { const m = /-(\d+)$/.exec(String(x.id)); return m ? m[1] : ''; };
          const twins = state.tokens.filter((x) => !x.isPC && x.name === token.name && numbered(x));
          if (twins.length && numbered(token)) {
            for (const x of [...twins, token]) x.name = `${x.name} ${numbered(x)}`;
          } else if (/ \d+$/.test(token.name) === false && numbered(token) && state.tokens.some((x) => !x.isPC && x.name.replace(/ \d+$/, '') === token.name && x.name !== token.name)) {
            token.name = `${token.name} ${numbered(token)}`;
          }
          state.tokens.push(token);
          joinCombat(token);
        }
        // Nothing is said in the chat about a token the players cannot see.
        if (seenByParty(token)) addChat('system', `↳ ${u.name || u.tokenId} appears at (${spot.col}, ${spot.row})`);
        break;
      }
      case 'removeToken': {
        const idx = state.tokens.findIndex((x) => x.id === u.tokenId);
        if (idx < 0) break;
        const wasSeen = seenByParty(state.tokens[idx]);
        const [removed] = state.tokens.splice(idx, 1);
        if (idx < state.activeIndex || state.activeIndex >= state.tokens.length) state.activeIndex = Math.max(0, state.activeIndex - 1);
        if (wasSeen) addChat('system', `↳ ${removed.name} removed from the board`);
        break;
      }
      case 'revealToken': {
        const t = state.tokens.find((x) => x.id === u.tokenId);
        if (!t) break;
        t.hidden = false;
        addChat('system', `↳ ${t.name} is revealed at (${t.col}, ${t.row})`);
        break;
      }
      case 'hideToken': {
        const t = state.tokens.find((x) => x.id === u.tokenId);
        if (t && !t.isPC) t.hidden = true;
        break;
      }
      case 'setHp': {
        const c = state.characters.find((x) => x.id === u.characterId)
          || characterFor(state.tokens.find((x) => x.id === u.characterId || x.id === u.tokenId));
        if (!c || !Number.isFinite(u.hp)) break;
        const before = c.hp;
        c.hp = clamp(Math.round(u.hp), 0, c.maxHp);
        hpSaves.push(c);
        addChat('system', `↳ ${c.name} HP ${before} → ${c.hp}/${c.maxHp}`);
        break;
      }
      case 'addWall': {
        if (![u.x1, u.y1, u.x2, u.y2].every(Number.isFinite)) break;
        state.walls.push({ x1: u.x1, y1: u.y1, x2: u.x2, y2: u.y2, type: u.wallType === 'door' ? 'door' : 'wall', open: false, added: true });
        wallsTouched = true;
        addChat('system', `↳ A ${u.wallType === 'door' ? 'door' : 'wall'} was added to the map`);
        break;
      }
      case 'addCondition': {
        const t = state.tokens.find((x) => x.id === u.tokenId);
        const rounds = Number(u.rounds);
        const ds = /^death ?saves?:? ?(success|fail)/i.exec(String(u.condition || ''));
        if (ds && t && t.isPC && hpOf(t) === 0 && !t.stable) { setDeathSave(t, ds[1].toLowerCase() === 'fail' ? 'fail' : 'success', (t.deathSaves ? t.deathSaves[ds[1].toLowerCase() === 'fail' ? 'fail' : 'success'] : 0) + (rounds > 0 ? Math.round(rounds) : 1)); break; }
        if (!t || !setCondition(t, u.condition, rounds, { minutes: u.minutes, source: u.source })) break;
        if (seenByParty(t)) addChat('system', `↳ ${t.name} is ${conditionKey(u.condition)}${leftText(t.conditions.find((c) => c.name === conditionKey(u.condition)) || {})}`);
        // Surprise is decided right after startCombat: if the combatant whose turn it already is turns out to be surprised, that turn is lost at once.
        if (conditionKey(u.condition) === 'surprised' && state.combat.active && activeToken() === t) { t.spent = { a: true, b: true, r: true }; nextCombatTurn(); }
        break;
      }
      case 'removeCondition': {
        const t = state.tokens.find((x) => x.id === u.tokenId);
        if (t && clearCondition(t, u.condition) && seenByParty(t)) addChat('system', `↳ ${t.name} is no longer ${conditionKey(u.condition)}`);
        break;
      }
      case 'damageToken':
      case 'healToken': {
        const t = state.tokens.find((x) => x.id === u.tokenId);
        const amount = Math.abs(Math.round(Number(u.value)));
        if (!t || !(amount > 0)) break;
        if (u.type === 'damageToken' && state.combat.active) noteAttackBy(activeToken(), t);       // the active combatant dealt it (see END TRIGGERS)
        const r = changeHp(t, u.type === 'damageToken' ? -amount : amount);
        if (r && seenByParty(t) && !t.isPC) addChat('system', `↳ ${t.name} ${u.type === 'damageToken' ? 'takes' : 'recovers'} ${amount}`);
        break;
      }
      case 'setInitiative': {
        const t = state.tokens.find((x) => x.id === u.tokenId);
        if (!t || !Number.isFinite(Number(u.value))) break;
        t.initiative = Math.round(Number(u.value));
        if (state.combat.active) {
          if (!state.combat.order.includes(t.id)) joinCombat(t);
          sortCombat();
          // Before the first turn has been taken the active combatant is simply the top of the order, whoever set the numbers.
          if (state.combat.fresh) { const first = combatTokens()[0]; if (first && first !== activeToken()) { state.activeIndex = state.tokens.indexOf(first); beginTurn(first); } }
        }
        break;
      }
      case 'restParty':
        restTokens(u.kind);
        break;
      case 'setMood':
        state.mood = Ambience.moods.includes(u.mood) && u.mood !== 'calm' ? u.mood : '';
        syncAmbience();
        if (u.mood === 'triumph') Ambience.setMood('triumph');
        break;
      case 'playSound':
        Ambience.sfx(u.sound);
        break;
      case 'summonToken': {
        const owner = state.tokens.find((x) => x.id === u.ownerId) || activeToken();
        const t = SUMMONS[u.kind] ? conjure(u.kind, owner, u.tokenId, u.col, u.row) : null;
        if (!t) addChat('system', `The DM tried to conjure something unknown (${u.kind}).`);
        break;
      }
      case 'timeOfDay': setTimeOfDay(u.value); break;
      case 'lightToken': {
        // A token that carries a light, or one of the map's own lights (a campfire, a torch).
        const t = state.tokens.find((x) => x.id === u.tokenId);
        if (t && LIGHT_NEEDS_ITEM.has(u.kind) && !(t.isPC ? gearLightKinds(t).includes(u.kind) : false)) { addChat('system', `↳ ${t.name} has no ${LIGHT_KINDS[u.kind][2]} to light.`); state.pendingNotes.push(`The table refused to light a ${LIGHT_KINDS[u.kind][2]} for ${t.name}: they do not carry and wield one (see lightItems in the party block).`); }
        else if (t) { t.lightKind = LIGHT_KINDS[u.kind] ? u.kind : ''; if (seenByParty(t)) addChat('system', `↳ ${t.name} ${t.lightKind ? 'lights a ' + LIGHT_KINDS[t.lightKind][2].toLowerCase() : 'puts out their light'}`); }
        else if (state.lights.some((l) => l.id === u.tokenId)) { setMapLight(u.tokenId, Number(u.value) !== 0); addChat('system', `↳ The ${u.tokenId} ${Number(u.value) !== 0 ? 'is lit' : 'goes out'}`); }
        break;
      }
      case 'startCombat':
        if (!state.combat.active) startCombat();
        break;
      case 'endCombat':
        endCombat();
        break;
      case 'endTurn':
        // The DM finished a creature's turn (or a player said they are done in the chat): only the token whose turn it is can end it.
        if (state.combat.active && activeToken() && activeToken().id === u.tokenId) nextCombatTurn();
        else if (state.combat.active) logTable('turn', `endTurn for ${(state.tokens.find((t) => t.id === u.tokenId) || {}).name || u.tokenId} ignored: it is ${activeToken() ? activeToken().name : 'nobody'}'s turn`);       // logged, so a turn that did not move can be explained
        break;
      case 'changeMap':
        break;                                    // handled before the loop
      default:
        console.warn('Unknown map update', u);
    }
  }
  if (wallsTouched) wallsChanged();
  for (const c of hpSaves) {
    jsonPost('/api/characters', c).catch((err) => toast(`Could not save ${c.name}'s HP: ${err.message}`, 'error'));
  }
  revealFog();
  commitBoard();
}

