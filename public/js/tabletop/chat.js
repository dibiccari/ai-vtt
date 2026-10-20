// The tabletop, part of public/index.html: tabs and the AI Dungeon Master chat.
// Classic script: it shares one global scope with the other files in public/js/tabletop/, loaded in this order by index.html.
'use strict';

/* =====================================================================
   UI: TABS
   ===================================================================== */
/* =====================================================================
   UI: AI DM CHAT
   ===================================================================== */
function scrollChat() {
  const s = $('#chatScroll');
  requestAnimationFrame(() => { s.scrollTop = s.scrollHeight; });
}

function renderChatMessage(m) {
  const el = document.createElement('div');
  el.className = `msg msg-${m.role}`;
  const who = document.createElement('div');
  who.className = 'who';
  who.textContent = m.role === 'assistant' ? 'Dungeon Master' : m.role === 'user' ? 'Player' : 'System';
  const body = document.createElement('div');
  body.className = 'body';
  if (m.role === 'assistant' && Array.isArray(m.lines) && m.lines.length) {
    m.lines.forEach((line, i) => {
      const span = document.createElement('span');
      span.className = 'voice-line';
      span.dataset.line = String(i);
      if (line.speaker && line.speaker !== 'Narrator') {
        const tag = document.createElement('span');
        tag.className = 'speaker-tag';
        tag.textContent = `${line.speaker}: `;
        span.appendChild(tag);
      }
      span.appendChild(document.createTextNode(line.text));
      body.appendChild(span);
    });
  } else {
    body.textContent = m.content;
  }
  el.append(who, body);
  return el;
}

function renderChat() {
  const log = $('#chatLog');
  log.innerHTML = '';
  for (const m of state.chat) log.appendChild(renderChatMessage(m));
  scrollChat();
  syncBegin();
}

// The Begin button shows while the DM has not said anything yet in this campaign (and nothing is in flight).
function syncBegin() {
  const box = $('#beginBox');
  if (!box) return;
  box.hidden = state.campaignId === 'default' || state.busy || state.chat.some((m) => m.role === 'assistant');
}

// What the table itself does (rolls it makes, damage, conditions, refused moves, initiative, XP) and what the players drag, for the play log on the server (data/logs): the DM's own turns are logged by the server.
function logTable(what, detail) {
  if (/[?&](nosave|watch)=1/.test(location.search)) return;
  try { fetch('/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'table', what, detail }) }).catch(() => {}); } catch { /* no log */ }
}

function addChat(role, content, lines) {
  if (role === 'system') logTable('table', content);
  const m = { role, content: String(content), ts: Date.now() };
  if (Array.isArray(lines) && lines.length) m.lines = lines;
  state.chat.push(m);
  if (state.chat.length > 200) state.chat = state.chat.slice(-200);
  store.set(chatKey(), state.chat);
  const el = renderChatMessage(m);
  $('#chatLog').appendChild(el);
  scrollChat();
  return el;
}

function setBusy(busy) {
  state.busy = busy;
  syncBegin();
  $('#sendBtn').disabled = busy;
  $('#sendBtn').textContent = busy ? 'The DM is thinking…' : 'Send Turn to AI DM';
  $('#typing').classList.toggle('show', busy);
  if (busy) scrollChat();
}

// What the DM is shown of the story so far: the players' messages and its own replies, and, after each reply, what the table applied for it (coins and items moved, experience, places found).
// Without that it cannot tell that a payment it narrated was already paid, and sends it again whenever the scene still mentions it (seen in a playtest: the 10 gp for the wagon was paid three times).
function dmHistory() {
  const out = [];
  for (const m of state.chat) {
    if (m.role === 'user' || m.role === 'assistant') out.push({ role: m.role, content: m.content });
    else if (m.role === 'system' && /^(🎒|⭐|📍)/.test(m.content) && out.length && out[out.length - 1].role === 'assistant') out[out.length - 1].content += `\n[Table applied: ${m.content.replace(/^\S+\s*/, '')}]`;
  }
  return out.slice(-20);
}

async function sendTurn(spokenText, opts) {
  if (state.busy) return;
  if (state.campaignId === 'default') { toast('No campaign is selected. Open the Campaigns page and press Continue on one.'); return; }
  const input = $('#chatInput');
  const isVoice = typeof spokenText === 'string' && !(opts && opts.typed);
  const auto = Boolean(opts && opts.auto);                       // the table itself nudging the DM because it is a creature's turn
  if (!auto) state.autoTurns = 0;
  const text = (typeof spokenText === 'string' ? spokenText : input.value).trim();
  if (!text) { toast('Describe your action first'); input.focus(); return; }
  if (!auto) voice.cancelSpeech();       // the table's own nudges must not cut off the narration that is playing (that is how a lot of it went unheard)
  const active = activeToken();
  const speaker = opts && opts.as ? opts.as : active;
  const content = speaker ? `[${speaker.name}] ${text}` : text;
  const history = dmHistory();

  if (!auto) { addChat('user', content); input.value = ''; }
  const combatWasOn = state.combat.active;
  setBusy(true);
  let ok = false;
  try {
    let streamedMsg = null, streamedEl = null, streamedLines = 0, streamedRolls = 0;       // what has already been printed and spoken while the reply was still being written
    const data = await chatStream({
      message: content,
      history,
      activeTokenId: active ? active.id : null,
      tokens: state.tokens.map((t) => ({ ...serializeToken(t), lightKind: lightKindOf(t), visibleToParty: seenByParty(t) })),
      characters: state.characters.map(({ sheetLog, ...rest }) => rest),
      walls: state.walls.map(({ x1, y1, x2, y2, type, open, locked, secret, dc }) => ({ x1, y1, x2, y2, type, open: !!open, ...(locked ? { locked: true } : {}), ...(secret ? { secret: true } : {}), ...(dc ? { dc } : {}) })),
      gridSize: GRID,
      mapUrl: state.map.url || '',
      movementRule: state.moveRule,
      mapName: state.map.url ? prettyMapName(state.map.url) : 'blank grid',
      inputMode: isVoice ? 'voice' : 'text',
      combat: combatForAi(),
      dmPad: state.dmPad,
      corrections: state.pendingCorrections.splice(0, 8),
      notes: state.pendingNotes.splice(0, 8),
      lighting: lightingForAi(),
      areas: state.areaPins.slice(0, 40),
      places: state.places.slice(0, 30),
      visitedMaps: state.visitedMaps.slice(0, 60),
      diceMode: store.get('vtt.diceMode', 'ai') === 'player' ? 'player' : 'ai'
    }, {
      onRoll: (text) => { streamedRolls++; addChat('system', '🎲 ' + text); },
      onLine: (line, index) => {
        if (!streamedMsg) { streamedEl = addChat('assistant', line.text, [line]); streamedMsg = state.chat[state.chat.length - 1]; }
        else { streamedMsg.lines.push(line); streamedMsg.content = streamedMsg.lines.map((l) => l.text).join(' '); const fresh = renderChatMessage(streamedMsg); streamedEl.replaceWith(fresh); streamedEl = fresh; store.set(chatKey(), state.chat); scrollChat(); }
        streamedLines++;
        voice.speak([line], streamedEl, { queue: true, offset: index });
      }
    });
    const lines = Array.isArray(data.voiceLines) ? data.voiceLines : [];
    const rollLines = Array.isArray(data.rolls) ? data.rolls : [];
    for (const line of rollLines.slice(streamedRolls)) addChat('system', '🎲 ' + line);     // every roll first, then the story (the ones already shown while it was being written are not repeated)
    noteRollLines(rollLines);
    let msgEl = streamedEl;
    if (streamedMsg) {
      streamedMsg.lines = lines.length ? lines : streamedMsg.lines; streamedMsg.content = data.narrative || streamedMsg.content;       // the finished reply is the truth
      const fresh = renderChatMessage(streamedMsg); streamedEl.replaceWith(fresh); msgEl = fresh; store.set(chatKey(), state.chat);
    } else msgEl = addChat('assistant', data.narrative || '(The Dungeon Master remains silent.)', lines);
    // Characters first: the server already changed hit points, Hit Dice and features, and the board updates below must start from those numbers.
    if (Array.isArray(data.partyChanged) && data.partyChanged.length) await loadCharacters();
    if (data.clock && Number.isFinite(data.clock.minutes)) setClockTotal(data.clock.minutes);
    await applyMapUpdates(Array.isArray(data.mapUpdates) ? data.mapUpdates : []);
    expireTimedConditions();
    applyCharacterUpdates(data.characterUpdates, data.characterProblems);
    if (Array.isArray(data.partyNotes) && data.partyNotes.length) addChat('system', '🎒 ' + data.partyNotes.join('; '));
    if (Array.isArray(data.journalAdded) && data.journalAdded.length) addChat('system', '📓 Journal: ' + data.journalAdded.map((e) => e.title).join(', '));
    if (lines.length > streamedLines) voice.speak(lines.slice(streamedLines), msgEl, { queue: auto || streamedLines > 0, offset: streamedLines });       // what was not already spoken as it came in; a reply to a table nudge waits for the narration still playing
    ok = true;
  } catch (err) {
    addChat('system', `Could not reach the AI DM: ${err.message}`);
    toast(err.message, 'error');
  } finally {
    setBusy(false);
  }
  if (ok && !combatWasOn && state.combat.active && !state.busy && activeToken() && activeToken().isPC && state.autoTurns < 12) {
    // The fight just began and a player character is first: the DM could not know the order while writing, so hand it over now.
    state.autoTurns += 1;
    const order = combatTokens().map((t) => `${t.name} ${Number.isFinite(t.initiative) ? t.initiative : '?'}`).join(', ');
    sendTurn(`Initiative has been rolled by the table: ${order}. It is ${activeToken().name}'s turn. Say who goes first, give the status and the options for ${activeToken().name}, and wait; do not roll anything.`, { typed: true, auto: true, as: { name: 'Table' } });
    return;
  }
  if (ok) {
    // A move the table refused or shortened: tell the DM now, so it can fix what it just narrated before anyone acts on it.
    if (state.pendingCorrections.length && state.autoTurns < 12) {
      state.autoTurns += 1;
      sendTurn(`[Correction] ${state.pendingCorrections.join('; ')}. In one or two sentences say where they really stand now, without repeating the earlier narration or redoing any rolls.`, { typed: true, auto: true, as: { name: 'Table' } });
    } else {
      // The reply played this creature's turn but did not end it (the DM sometimes forgets endTurn): the table ends it, instead of asking about the same creature again.
      const still = activeToken();
      if (opts && opts.nudgeFor && state.combat.active && still && still.id === opts.nudgeFor) { nextCombatTurn(); commitBoard(); renderCombat(); }
      aiTakesItsTurn();
    }
  }
}

// Nobody has to press anything for a creature to act: when the tracker lands on one, the DM is asked to play its turn (and the next, until a player is up).
function aiTakesItsTurn() {
  const t = activeToken();
  if (!state.combat.active || !t || t.isPC || t.dead || isSummon(t) || state.busy || state.autoTurns >= 12) return;
  if (combatTokens().some((c) => c.isPC && !Number.isFinite(c.initiative))) return;       // the order is not settled until every player has an initiative: asking the DM to play a creature now only makes it loop (it cannot end a turn the tracker will not advance)
  state.autoTurns += 1;
  // One request for the whole run of creatures: the DM plays this one and every creature after it until a player character is up (it used to be one request per creature).
  sendTurn(`It is ${t.name}'s turn. Play it, and then every creature turn that follows it in the order, one after another in this one reply, until a player character is up. Send endTurn for each creature.`, { typed: true, auto: true, nudgeFor: t.id, as: { name: 'Table' } });
}

