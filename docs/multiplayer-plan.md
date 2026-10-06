# Multiplayer plan (2 to 6 people, one server)

Written for the project owner. Line numbers refer to the code at the time of writing (branch `agent/multiplayer`) and will drift.

## 1. Where the game lives today

The game is **one browser's memory that is copied to the server**. There is no server-side game state to share.

| Thing | Lives in | Copied to the server |
|---|---|---|
| Board (tokens, positions, map, combat, lights, map memory) | `localStorage vtt.board.<campaign>` | `data/campaigns/<id>/game.json`, pushed 1.5 s after a change |
| Chat log | `localStorage vtt.chat.<campaign>` | same `game.json` (last 200 lines) |
| Explored fog | `localStorage vtt.fog.<map>` (PNG) | `fog.json` |
| Journal | server (`save.json`) | is the server copy; the DM reads it every turn |
| Characters, party stash, settings, safety, maps | server files | are the server copy |
| Dice mode, voice engine, ambience, DM view | `localStorage` of each browser | no (this is fine: they are per person) |
| Who is the "speaker" token, selected token, view/zoom, pending notes for the DM | JS variables in the page | no |

"Newest copy wins" (`serverSave.pull`, public/index.html:523-570) is the only synchronisation. Two browsers would overwrite each other.

### What assumes a single browser

public/index.html
- `serverSave` (about :523): the browser is the authority; it pushes whole boards with `PUT /game`. Must become "send an intent, receive the new state".
- `store.set` / `saveBoard()` (about :2287) / `commitBoard()`: every change writes localStorage and triggers the push.
- `init()` (about :4060): loads the board from localStorage after `serverSave.pull()`; picks the campaign from `GET /api/campaigns` (`active`), a server-wide single choice.
- `state` (:461): one global object holding the board *and* personal view state (`view`, `dmView`, `ambientOverride`) mixed together.
- `seenByParty()` (:1120), `revealFog()` (:1298): fog and hidden tokens are computed in the browser, so a player who opens dev tools can read hidden tokens. Fine for one table of friends, not for a server that must hide things.
- `reachable()` (:949), drag handlers: any token can be dragged by anyone outside combat; no notion of "my" token (the "speaker" is just a selection).
- `endTurn()` (:1231), `aiTakesItsTurn()` (:3262): the browser that has the DM reply also drives creature turns and sends the follow-up "[Table] It is X's turn." messages. With 4 browsers, all four would do it.
- `sendTurn()` / `jsonPost('/api/chat', ...)` (:3223): the browser sends the whole board, tokens and history on every message; the server trusts it.
- `travelTo()` (:1430): map changes executed in the browser.
- `pendingNotes`, `pendingCorrections`: table events collected in one browser and told to the DM with its next message.
- `pauseBtn` (:4015): sends [PAUSE] as a normal chat message from one browser.
- `window.addEventListener('focus', ... location.reload())`: campaign switching is "whoever clicked Continue".

server.js
- `POST /api/chat` (:1366): stateless; board, history and tokens come from the request. `diceTray()` (:1395) is drawn per request.
- `PUT /api/campaigns/:id/game` (:608): accepts any board from anyone, no revision check.
- `data/campaigns/active.json` (`POST /api/campaigns/active`): one active campaign for the whole server.
- `localOnly` (:1502): loopback address + `Host` in (localhost, 127.0.0.1, [::1]) + same-origin. Anyone else gets 403 on every local-only route.
- `HOST` defaults to 127.0.0.1 (:26): other machines cannot connect at all today.

## 2. Target design

**Principle: the server owns the game.** Browsers send *intents* ("move token X to square Y", "say this to the DM"); the server checks them, updates the one true state, and tells everybody.

### State and revisions
- Move the board and chat from the browser to the server as the live copy (`game.json` stays as the file on disk). Every change bumps a **revision number**. A client that sends an intent includes the revision it saw; if it is stale the server answers "conflict, here is the new state" instead of overwriting.
- Phase 0 (done, see section 5) already has the revision counter and the live stream; the server does not yet own the board.

### Live updates: recommend server-sent events (SSE)
- Why SSE rather than WebSocket: all traffic that matters is server to browser ("the state changed"); browser to server is ordinary `fetch` that already exists. SSE is plain HTTP, works through every proxy and tunnel (ngrok, Cloudflare Tunnel), reconnects by itself, and needs no new npm package. A WebSocket only pays off for high-rate two-way traffic (dragging with live cursors, voice); if that is wanted later it can be added next to SSE.
- Events carry the revision and what kind of thing changed (`game`, `journal`, `party`, `chat`...). Early on clients simply refetch; later events carry the changed token or chat line.

### Roles
- **DM-host**: the person at the machine running the server (loopback). Can do everything local-only today: settings, keys, campaigns, start over, map setup. The AI is the DM; "host" is the human who administers.
- **Player seat**: bound to **one character** (`player` name on the character record, plus a random seat token). May move only that character's token (and its summons), speak to the AI as that character, roll its dice, use Pause.
- **Spectator**: sees what players see; no intents accepted (this is the `?watch=1` view).
- Identity without accounts: the host creates invite links `/join?seat=<random 128-bit token>`; the player types a display name once; the token is kept in a cookie/localStorage. A seat link can be revoked by the host. The link is a password: do not post it publicly.

### Per-player visibility enforced on the server
- Today each browser computes fog and hidden tokens. In multiplayer the server must send each seat a **filtered state**: hidden tokens removed, tokens outside the party's line of sight removed (or reduced to nothing), DM-only maps and notes never sent. That requires moving `seenByParty`, `visibleFrom` and the lighting rules into a server module (shared code, ideally one file used by both sides so Map Test and the table keep agreeing).
- Fog is shared by the party (everyone sees what any PC has seen), so one fog image per map, owned by the server, is enough. Per-character vision is only needed for "who can see this token right now".
- Until this exists, multiplayer is "friends who agree not to open dev tools". State that honestly in the UI.

### Who moves what
- Outside combat: a seat may drag its own token (existing `FREE_ROAM_FT` and walls rules, re-checked server-side with `reachable`). In combat: only the active token, only by its seat. Host can move anything. The server rejects the rest with a short reason.

### Talking to the AI DM and simultaneous messages
- One **DM queue on the server**: a message is {seat, character, text}. The server processes one AI call at a time; messages arriving meanwhile are queued, shown to everybody as "Edric is waiting", and, if several arrive within about 2 seconds, merged into one call ("Edric: ...; Raechyl: ..."). This also makes the server (not a browser) responsible for creature turns (`aiTakesItsTurn` moves to the server), so costs stay at one call per DM turn.
- The server builds the board state and chat history itself instead of trusting the request. The reply is written to the shared chat and broadcast.
- Option for the host: "turn lock" (only the seat whose turn it is may speak in combat). Default off outside combat.

### Voice and microphone
- Speech-to-text stays **per browser** (each player's mic and Chrome speech recognition), which sends text as that seat's message. No audio is shared between players (they use their own call app for that).
- DM speech (TTS): each browser can play it locally (cached clip files, cheap), or only the host plays it. Provide a per-person toggle. The "mute the mic while the DM speaks" rule stays local and works per browser; add the rule that a spoken DM line is announced to everyone so players do not talk over it.

### Dice
- The shared **dice tray lives on the server** (already crypto-random); the server hands out dice in order for every AI call and for `POST /api/roll`, and logs every roll in the shared chat so nobody can reroll silently. In "player" mode each seat rolls its own character's d20 (server-rolled on request).

### Pause / safety
- The Pause button is available to **every seat**, always, even when the queue is busy and even for spectators-who-are-players. It jumps the queue, shows a banner to all, and sends [PAUSE] to the DM. Safety settings (lines and veils) stay host-edited but are shown to all on join.

### Join flow
1. Host starts the server with `HOST=0.0.0.0` (LAN) or a tunnel, opens Campaigns, ticks "Allow others to join", sees one invite link per party character.
2. Player opens the link, types a name, is shown the table with their character highlighted.
3. A seat shows as connected/disconnected to everyone. The host can kick or re-issue a link.

### The local-only guards
- `localOnly` stays exactly as is for keys, settings, campaign administration, file edits, start over: those are **host-only forever**. Once the server listens beyond loopback the check still holds (a remote address is never loopback), but note the `Host` check is the DNS-rebinding defence: keep it, and do not "fix" a joiner's 403 by loosening it.
- Add a second guard `seatOnly(role)` for table routes: the request must carry a valid seat token (header, not URL after the first visit) and the intent must be allowed for that seat. Today's open routes (`PUT /game`, `DELETE /game`, `POST /api/chat`, `/api/roll`, TTS) all need it, otherwise anyone on the network can run up the Anthropic and OpenAI bill.
- Add a simple per-seat rate limit on `/api/chat` and `/api/tts` (these cost money).

### Security basics
- Do not expose plain HTTP to the internet. Use a tunnel with HTTPS (Cloudflare Tunnel or Tailscale are the simplest; Tailscale keeps it private to invited people, the better default). Browsers also only allow the microphone on HTTPS or localhost, so players' mics need HTTPS anyway.
- Seat tokens: random, 128 bit, stored hashed on the server, sent in a header or secure cookie; if they are in a URL, exchange them for a cookie on first visit and drop them from the address bar (URLs end up in history and screenshots).
- `.env` and keys stay server-only (they already are; `/api/settings` is local-only and never returns full keys). Never serve `data/` or `.env` statically (only `public/` is served; keep it that way, and keep `data/tts-cache` out of public).
- Escape player-supplied names and chat text when rendering (the `esc()` helper exists; check every new place).
- Uploads (`POST /api/upload`) become host-only.

## 3. Phased roadmap

| Phase | Size | What | Demonstrable after |
|---|---|---|---|
| 0 | S (done) | Revision counter, SSE stream, read-only `?watch=1` view | A second browser/phone follows the table live |
| 1 | M | Server owns board + chat: `GET/POST /state`, intents (move, say), revision check, SSE carries the new state. Single browser still plays normally through it | Two windows, same game, no overwrites; stale write rejected |
| 2 | M | Seats: invite links, names, `player` on characters, `seatOnly` guard, seat-bound moves, rate limits | A friend joins from another computer and moves only their hero |
| 3 | L | Server-side visibility: move `seenByParty`/lighting/fog to a shared module; filtered state per seat | Hidden goblin does not appear in a player's network traffic |
| 4 | M | Server DM queue, merged simultaneous messages, server-run creature turns, shared dice log, shared Pause | Four people talk at once and the DM answers once, in order |
| 5 | S/M | Hosting: HTTPS tunnel guide, Allow-others switch, connected-seat list, kick, reconnection polish; per-person voice/TTS toggles | A real session over the internet |

Phase 3 is the biggest because the line-of-sight and lighting code is large and lives in index.html; extracting it is a refactor that also benefits Map Test.

## 4. Risks
- **Rewrite risk**: index.html is a 4,000-line single file written around "state in this page". Phase 1 and 3 touch its core. Mitigate by keeping single-player on the same path (the server is just the only client), and by putting new code in new files.
- **Two sources of truth** during migration (localStorage vs server). Pick one switch day; keep `game.json` format.
- **Cost**: more players means more messages; the queue/merge and rate limits are the cost control. The AI call with a DM map costs about 3k tokens extra per message.
- **Cheating / leaks** until phase 3 (hidden tokens are in the data sent to every browser).
- **Latency**: the AI call takes seconds; players need visible "DM is thinking" and queue feedback or they will resend.
- **Mic and TTS in a shared room**: if two players sit in the same room, their mics hear each other and the DM voice. Per-person toggles, headphones advice.
- **Security of a shared link**: anyone with a seat link can spend API money; revoke and rate limits matter.
- **Conflicts**: two people dragging the same token or the host and a player at once; handled by the revision check, but the UI must say what happened.
- **Restart loses nothing important** (state is on disk) but the in-memory revision resets; clients refetch on reconnect.

## 5. Phase 0, built
- `lib/live.js`: per-campaign revision counter (in memory) and an SSE endpoint `GET /api/campaigns/:id/live` (sends `hello`, then a `change` event {rev, scope, at}, ping every 25 s). A middleware announces every successful write under `/api/campaigns/:id/...` (scope = game, journal, party, settings, safety...) and writes to `/api/characters`, `/api/party` and `/api/chat` (announced to every campaign, scope party/chat). `GET /api/campaigns/:id/game` now also returns `rev`.
- `public/watch.js` + `/?watch=1`: read-only tabletop. Every non-GET request is refused in the browser (cannot save or call the AI), editing controls hidden, board ignores the mouse, the page reloads when the saved game changes. `serverSave.pull` in index.html takes the server copy in watch mode. A reload is crude (the view resets) but safe; phase 1 replaces it with in-place updates.
- Limits: the stream is not authenticated and a watcher sees everything the DM-view would (hidden tokens included, because the browser still gets the full board). Use it on a trusted network only. The server still listens on 127.0.0.1 by default, so other devices need `HOST=0.0.0.0` (then also remember the unprotected write routes above).
