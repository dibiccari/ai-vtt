# AI-VTT

Self-hosted D&D 5e virtual tabletop. **Claude (Anthropic API) is the Dungeon Master**; the browser draws the battlemap and speaks the DM's replies. Currently loaded with the *Lost Mine of Phandelver* campaign.

## Run it

```
npm install
npm run dev      # node --watch server.js  -> http://localhost:3000
npm run check    # syntax-checks server.js and the inline <script> of public/index.html
```

Keys live in `.env` (git-ignored). Easiest way to set them: open **Settings** (`/settings.html`) and paste them in. It writes `.env` and applies instantly, no restart. `.env.example` lists every variable.

## Layout

```
server.js              Express + Multer, ES modules only (no require). All API routes.
public/index.html      The tabletop: ONE file, vanilla JS + canvas. Grid, tokens, walls, fog, DM chat sidebar, voice. The Character Sheets and Map Tools tabs were removed (Oct 2026): sheets live on characters.html, map/wall setup on map-test.html, so the tabletop has no map picker, token library or wall-drawing UI (the map comes from the saved board; walls load from data/maps/).
public/voice-test.html Voice test page: mic/speaker check, every voice with Play/Stop, "Talk to the AI DM" panel.
public/settings.html   API keys, models, voice engine choice.
public/characters.html Character sheets: the official WotC 5E fillable PDF drawn with live fields over it (pdf.js), token picker, rename, save, Download PDF (pdf-lib).
public/map-test.html   Map Test: Pins (arrival spots: add, drag, remove, copy to another map), fog of war + line of sight check with test tokens, open/close doors, grid calibration, .dd2vtt/.uvtt import. The hand wall/door drawing tools were removed (Oct 2026) because the purchased dd2vtt maps carry their walls; settings autosave to data/maps/. Goblin Ambush, Cragmaw Hideout and Wyvern Tor have no walls in any variant of the pack.
public/tokens.html     Token gallery (names, categories, search) driven by public/tokens/manifest.json.
public/vendor/         pdf.js, its worker and pdf-lib (self-hosted, with licenses).
public/campaigns.html  Campaign selector: pick the active campaign (what the DM runs), read/delete its documents, import the adventure PDF (read in the browser by public/pdf-extract.js, split by PDF bookmarks).
public/test-lab.html   Test Lab: one click sets up the Rusty Flagon tavern-brawl scenario (campaign + map + 4 PCs + 8 NPC tokens) and lists prompts to try with the AI.
lib/                   Server-side modules: journal.js (journal/save file), sheet-edit.js (applies the DM's sheet edits), sheet-fields.json (official sheet field map), campaign-maps.js (places each campaign can move to).
public/journal.html    Campaign journal + save file: entries by category, delete, "Previously on..." recap, Export/Import save (journal + board + chat as one JSON file).
public/scenes.js       Ready-made starting boards (map + party + NPCs) for the Lost Mine and tavern campaigns.
public/uvtt.js         Shared Universal VTT (.dd2vtt) reader/importer used by Map Test and Test Lab.
public/scenarios/      rusty-flagon.dd2vtt (generated tavern map with walls/doors/lights, 50 px squares) and rusty-flagon-campaign.md (scenario text the server seeds).
public/nav.js          Shared top navigation bar (add a page = add one line).
public/voice-fx.js     Playback effects for ChatGPT voices (old = thin/slow/quaver, child = higher/faster).
scripts/check.mjs      Syntax check used by `npm run check`.
data/characters/*.json Character sheets (4 seeded PCs).
data/maps/<image>.json Per-map walls, doors and grid calibration (image-pixel coordinates; "source":"dd2vtt" marks imported maps). Tracked in git.
data/campaigns/<id>/    One folder per campaign: *.md text the DM is given, voices.json (named NPC voices), campaign.json, plus save.json (the journal) and data/campaigns/active.json. (Old: data/campaign/, moved automatically.)
data/campaign/         (legacy) Campaign text (*.txt/*.md) given to the DM + voices.json.
public/uploads/        Map images (the purchased lmop-* dd2vtt maps and the older Phandelver images).   public/tokens/  Token art (73 numbered PNGs + ~1,130 named ones, with manifest.json).
data/tts-cache/        Cached generated voice clips. GIT-IGNORED (the only data folder that is).
```

## What git tracks

Everything is tracked except four things: **`.env`** (the only file with secrets: API keys, set on the Settings page), `node_modules/`, `.DS_Store`, and `data/tts-cache/` (voice clips, regenerated on demand). The user chose (Oct 2026) to track the maps, tokens, sheet PDF and campaign data too, so a fresh clone works after `npm install` plus a `.env`. That includes copyrighted material (the Lost Mine text in `data/campaigns/`, the Phandelver and purchased dd2vtt maps in `public/uploads/`, the Drive token art in `public/tokens/`, the WotC sheet in `public/sheets/`), so check the licences before pushing to a public repository. Never commit `.env` or paste a key anywhere. Campaign saves (`data/campaigns/<id>/save.json`, the journal) are tracked too, so they show up as changes while you play.

## API (server.js)

- `GET/POST /api/characters`, `DELETE /api/characters/:id`: sheets as JSON files. A character may carry `sheet` (PDF field name to value); a POST without `sheet` keeps the stored one. The record's name/class/level/HP/AC/speed/abilities are what the tabletop uses.
- Map changes: `lib/campaign-maps.js` lists the places each campaign can use (installed map file, kind regional/town/battle, a description the AI reads, arrival spots as tabletop squares). The DM can return `changeMap` (mapId, arrive, reason); `/api/chat` resolves it to a map url and arrival square (unknown ids come back as a problem note) and the tabletop's `travelTo()` moves the table: it remembers the scene being left (creatures + party positions per map, kept in the saved board), shows the new map, places the party, and sets grid/fog for the map kind (regional and town maps are plain pictures: shown whole, no grid, no fog, no tokens drawn, fog/movement controls disabled; only battle maps have tokens and fog). `GET /api/maps/available` feeds the Map picker in the top bar. A map with a saved calibration (`squares` in data/maps/*.json, set on the Map Test page) is drawn so one printed square = one board square.
- Each campaign keeps its own saved board and chat in this browser (`vtt.board.<campaignId>`, `vtt.chat.<campaignId>`); the tabletop loads the ones for the active campaign and reloads when the active campaign changes elsewhere. A campaign with no saved board starts from its ready-made scene in `public/scenes.js` (Lost Mine: the Sword Coast regional map, shown whole with no grid, fog or tokens; the tavern scenario: the Rusty Flagon). The old single `vtt.board`/`vtt.chat` keys are no longer used. The Campaigns page can start a campaign over (clears its saved board and chat).
- Conditions: each token has `conditions` [{name, rounds}] (5e conditions, concentrating, or a free effect name; rounds 0 = until removed). Double-click a token to set them; badges show on the token and the turn bar; timed ones tick down each new round. blinded/unconscious shrink a PC's sight to 1 ft (house rule), an invisible NPC is not seen by the party. The DM sends addCondition/removeCondition.
- Board updates the DM can return (mapUpdates): moveToken, addToken, removeToken, setHp, addWall, revealToken, hideToken, addCondition, removeCondition. Tokens carry `hidden` and `kind` ("creature" or "trap"). The tabletop decides what the players see in `seenByParty()`: player tokens always; anything else only if it is not hidden and, while fog is on, inside a party member's current line of sight. Hidden/unseen tokens are not drawn, not in the turn bar, not in chat notes, not clickable, and are skipped by End Turn; the DM-view checkbox shows them as ghosts. The chat request sends each token's `hidden`, `kind` and `visibleToParty`, and the DM prompt forbids mentioning hidden things.
- The DM can edit player character sheets with the `updateCharacter` update (edits like classLevel/xpGain/maxHp/hp/str..cha or any official sheet field name, plus skills, saves, spells, slots). `lib/sheet-edit.js` applies it on the server inside `/api/chat`: it keeps modifiers, proficiency bonus, passive Perception and HP consistent, refuses name changes, saves the character, appends to `character.sheetLog` (shown with Undo on the Character Sheets page), and `/api/chat` returns `characterUpdates` for the tabletop to show. `lib/sheet-fields.json` is the field map (spell lines per level, slots) derived from the official PDF. The AI's reply schema is an `anyOf` of update types with all fields required, because the API rejects more than 24 optional schema fields. Level-up is a conversation driven by the DM prompt: it asks the player's choices first and only then calls updateCharacter.
- `GET /api/campaigns` (list + stats), `POST /api/campaigns/active {id}`, `GET/PUT/DELETE /api/campaigns/:id/files/:name` (PUT/DELETE and the active switch are local-only). The server loads the active campaign's text per request (cached until a file changes) and sends it to the DM as a cached system block.
- Journal / save file: `data/campaigns/<id>/save.json` (tracked with the campaign). The DM returns `journal` updates (category event/npc/quest/place/loot/promise, title, text, status, when; non-event titles are upserted); `/api/chat` stores them via `lib/journal.js` and the journal is sent to the DM as an uncached system block after the campaign text. `GET/PUT /api/campaigns/:id/journal` (PUT is local-only), `POST /api/recap` (one paid call; "Previously on..."; the tabletop's Recap button speaks it). Campaigns > Start over also clears the journal.
- Arrival spots: the Map Test page has a Pins tool (click empty ground to add a pin with the name in the box, drag to move); named spots (`start` = default) are saved in the map config as `starts` (image pixels). `withSavedStarts()` in server.js adds them to the map registry (they win over the by-eye guesses in lib/campaign-maps.js) and the tabletop turns pixels into squares in `travelTo()`.
- `node scripts/import-dd2vtt.mjs <file.dd2vtt> <name>` imports a .dd2vtt (picture to public/uploads, walls/doors/grid/lights/ambient to data/maps). The Lost Mine maps came from the user's "LMoP Pack.zip" (Map Adventurer, 70 PPI): Summer variants, Redbrand Main, Cragmaw Castle day+night, Wave Echo Cave Desert. Cragmaw Hideout, Goblin Ambush and Wyvern Tor have no walls in the pack. Their arrival squares in lib/campaign-maps.js are bottom-centre placeholders until set with Set start.
- `GET/PUT /api/map-config?map=<file>`, `GET /api/map-configs`: per-map walls/doors/grid in `data/maps/` (PUT is local-only).
- `POST /api/upload` (field `map`), `GET /api/maps`, `GET /api/tokens`.
- `POST /api/chat`: `{message, history, tokens, characters, walls, gridSize, mapName, inputMode}` returns `{narrative, voiceLines[{speaker,voice,text}], mapUpdates[]}`. Uses `claude-opus-5-5`, structured JSON output (`output_config.format`), the campaign text as a cached system block, and `fallbacks: 'default'`. `mapUpdates` types: moveToken, addToken, removeToken, setHp, addWall.
- `GET /api/tts/status`, `POST /api/tts`, `POST /api/tts/voices`: OpenAI text-to-speech (`gpt-4o-mini-tts`). Clips are cached on disk. Named NPCs use the active campaign's `voices.json`; others get a voice by style tag.
- `GET/POST /api/settings`, `POST /api/settings/test`: **local-only** (loopback + Host/Origin checks). Never returns full keys. The server listens on `127.0.0.1` by default (`HOST` env to change).

## Voices

Two engines, switchable any time (Settings page, chat-tab dropdown, voice-test checkbox; stored in `localStorage` key `vtt.voiceEngine`): **ChatGPT voices (OpenAI)** and **Microsoft/browser voices** (Web Speech API). Claude has no voice output. The DM labels each line with a voice tag (narrator, gruff, sly, noble, elderly, child, monstrous, ethereal, feminine, masculine). The mic is muted while the DM speaks (stream track disabled, recognizer stopped, 1.2 s grace) to stop it transcribing the narration. The speed parameter is ignored by `gpt-4o-mini-tts`, hence the browser-side effects in `voice-fx.js`.

## Conventions

- Complete code only: no placeholders, no truncation, no `...` elisions. The frontend stays a single `public/index.html` (plus the small shared scripts above).
- ES modules only. Match the surrounding style. Run `npm run check` after edits.
- Browser state is in `localStorage` (`vtt.board`, `vtt.chat`, `vtt.walls.<map>`, `vtt.fog.<map>`, `vtt.voiceEngine`, ...); always wrap in try/catch.

## Testing notes

- The embedded preview browser blocks the microphone and has only 3 Microsoft voices, so speech-to-text and voice quality can only be judged by the user in Chrome or Edge. Don't claim audio was heard.
- Don't send paid API calls (`/api/chat`, `/api/tts`) gratuitously; keep tests short.
- `node --watch` does not reload `.env`, but the Settings page applies key changes live.

## Open items

- **Grid calibration**: the purchased dd2vtt maps (`lmop-*`) carry their grid size and are calibrated. The older Phandelver images still use a guess except Redbrand; set `squares` for them on the Map Test page.
- **Walls**: Goblin Ambush, Cragmaw Hideout and Wyvern Tor (`lmop-*`) have no walls in any pack variant, and there is no wall editor now (Cragmaw Hideout is a cave, so sight is not blocked there). Phandalin and the Sword Coast are plain maps and need none.
- **Arrival squares**: every battle map has one saved `start` spot (data/maps/*.json `starts`, image pixels; `npm run check` fails if an installed battle map has none). The Lost Mine ones were placed (Oct 2026) from the module text and the map pictures, not play-tested: adjust by dragging on Map Test. The user wants no extra named pins on the Lost Mine maps; only the tavern scenario keeps named spots (front-door, back-door...) in lib/campaign-maps.js. Monster placements are not stored.
- **Map assignment UI**: the map-to-campaign registry is hand-written in `lib/campaign-maps.js`; a Campaigns-page screen to assign maps (kind, description) was offered, not built.
- **Tokens**: ~1,130 named tokens from the Drive collection are in public/tokens/ (manifest.json); the 73 original ones are unnamed. Two Humans tokens with extensionless Drive names were not imported.
- **Voice tuning**: Elderly and Child voices were still being tuned. Effects live in `public/voice-fx.js`; acting directions are in `TTS_PROFILES` in `server.js`. Planned new voice tags: beast (Speak with Animals) and undead/ghoulish.
- **Roadmap agreed Oct 2026** (see the order in the assistant's plan): journal/save file and recap are built; next camping (camp map kind, day/night, rests), condition chips on tokens, in-person d20 attack prompt, inventory/gold/attunement/stash on a Party page with effective stats, summon tokens (Mage Hand, Spiritual Weapon), lighting (light sources + darkvision, using the dd2vtt lights stored in data/maps/), audio/mood, safety tools. Multiplayer later: keep state server-side. AI-move validation against movement and walls is not implemented.
- Optional idea the user declined for now: a different voice engine per character.
