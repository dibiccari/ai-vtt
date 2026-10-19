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
public/dev/voice-test.html Voice test page: mic/speaker check, every voice with Play/Stop, "Talk to the AI DM" panel.
public/settings.html   API keys, models, voice engine choice.
public/characters.html Character sheets (Nov 2026): our own HTML and CSS sheet (three pages: the character, about the character, spellcasting) built from the saved character and the same sheet field names the server already stores (GET /api/sheet-layout gives it the skill, save, spell-line and slot fields), live fields with autosave on Save, modifiers, saves, skills (proficiency and expertise boxes), initiative, passive Perception and spell numbers worked out from the scores, level and boxes, darkvision, token picker, rename, the DM change log with Undo, and Print / Save as PDF (a print stylesheet: black on white, three pages). A SAVED sheet is READ ONLY (the DM changes it in play through updateCharacter, and character creation sets it up; the page re-reads it when the tab comes back into view); only a new unsaved character (+ New character) is editable, with searchable pick lists of the real SRD spells (by level), weapons (attack bonus and damage worked out from the abilities and proficiency) and armor and shields (armor class worked out), fed by GET /api/sheet-options; a name that is not in the list is refused. The character record may carry `armor` (a name) and `shield` (true). It replaced the Wizards of the Coast fillable PDF drawn with pdf.js and pdf-lib; those and the PDF were removed. Test: test/browser/sheet.test.mjs.
public/map-test.html   Map Test (fog of war and DM view start on; untick to see the bare map): Pins (arrival spots: add, drag, remove, copy to another map), fog of war + line of sight check with test tokens, open/close doors, grid calibration, .dd2vtt/.uvtt import. The hand wall/door drawing tools were removed (Oct 2026) because the purchased dd2vtt maps carry their walls; settings autosave to data/maps/. Goblin Ambush, Cragmaw Hideout and Wyvern Tor have no walls in any variant of the pack.
public/map-maker.html Map Maker (Map Tools > Maker): the user asks for new maps (name, description, size, features) and writes feedback on the maps the assistant generated (stored in data/map-requests.json and data/map-feedback.json via GET /api/map-maker and PUT /api/map-maker/requests|feedback). WORKFLOW: when the user says to work through the map requests/feedback, read those two files, generate or improve the maps with scripts/make-*-map.mjs (mapkit), import them (scripts/maps/import-dd2vtt.mjs + scripts/maps/apply-map-sidecar.mjs), look at the preview picture, then mark the request status or tick the notes done in the same files. public/js/maptools-rail.js is the shared left rail (Test, Maker) of the Map Tools pages.
public/tokens.html     Token gallery (names, categories, search) driven by public/tokens/manifest.json.
public/vendor/         pdf.js and its worker (self-hosted, with license; the campaign PDF import uses them).
public/campaigns.html  Campaign selector with a left nav: Continue (your campaigns: name, party, a Continue button that activates it and opens the tabletop, and a Party button to change who is playing; settings are chosen at creation and are not editable here; nothing destructive) and New (the new-campaign form, then a "Finish setting up" card for the campaign just made with documents, Maps, Safety, PDF import and Start over): pick the active campaign (what the DM runs), read/delete its documents, import the adventure PDF (read in the browser by public/js/pdf-extract.js, split by PDF bookmarks).
public/dev/test-lab.html   Test Lab: one click sets up the Rusty Flagon tavern-brawl scenario (campaign + map + 4 PCs + 8 NPC tokens) and lists prompts to try with the AI.
lib/                   Server-side modules: compendium.js (reads data/srd), party.js (gear, coins, attunement, stash, effective stats), journal.js (journal/save file), sheet-edit.js (applies the DM's sheet edits), sheet-fields.json (official sheet field map), campaign-maps.js (places each campaign can move to).
public/bestiary.html   Bestiary: all 334 SRD 5.1 creatures, searchable/filterable, with the full stat block.
public/spells.html     Spells: all 319 SRD 5.1 spells, filter by level/school/class/concentration/ritual.
public/dev/sound-test.html Sound Test: play every ambient scene, mood and sound effect (public/js/ambience.js) with a volume, level meter and a DM-speaking duck test.
public/party.html      Party page: each character's inventory, coins, attunement (3 slots), effective AC/saves/speed/abilities with the working shown, conditions (from the saved board), encumbrance, and the shared party stash.
public/journal.html    Campaign journal + save file: entries by category, delete, "Previously on..." recap, Export/Import save (journal + board + chat as one JSON file).
public/js/scenes.js       Ready-made starting boards (map + party + NPCs) for the Lost Mine and tavern campaigns.
public/js/uvtt.js         Shared Universal VTT (.dd2vtt) reader/importer used by Map Test and Test Lab.
public/scenarios/      rusty-flagon.dd2vtt (generated tavern map with walls/doors/lights, 50 px squares) and rusty-flagon-campaign.md (scenario text the server seeds).
public/js/nav.js          Shared top navigation bar (add a page = add one line; a group with `items` is a drop-down: Library = Character Sheets, Bestiary, Spells, Tokens; Tools = Map Test, Test Lab, Voice Test, Sound Test).
public/js/voice-fx.js     Playback effects for ChatGPT voices (old = thin/slow/quaver, child = higher/faster).
scripts/dev/check.mjs      Syntax check used by `npm run check`.
data/characters/*.json Character sheets (4 seeded PCs).
data/maps/<image>.json Per-map walls, doors and grid calibration (image-pixel coordinates; "source":"dd2vtt" marks imported maps). Tracked in git.
data/srd/              SRD 5.1 JSON (monsters, spells, magic items, equipment, conditions) from the 5e-bits database, with NOTICE.md (CC-BY-4.0 attribution to Wizards of the Coast). Tracked.
data/campaigns/<id>/    One folder per campaign: *.md text the DM is given, voices.json (named NPC voices), campaign.json, plus save.json (the journal) and data/campaigns/active.json. (Old: data/campaign/, moved automatically.)
data/campaign/         (legacy) Campaign text (*.txt/*.md) given to the DM + voices.json.
public/uploads/        (Nov 2026: map pictures now live in their map set's packet folder, data/mapsets/<guid>/; this folder only holds a picture until a set adopts it) Map images (names say where a picture comes from: lmop- = the purchased Map Adventurer pack, vtt- = generated here (camp, dungeon, tavern, terrain test), dnd- = Wizards of the Coast originals (town and regional pictures, the Redbrand Hideout); renamed Oct 2026, the server redirects the old names, see OLD_MAP_NAMES in server.js)  Map images (the purchased lmop-* dd2vtt maps, the generated camp, dungeon, tavern and terrain maps, and the Phandalin, Sword Coast and Kings Road town and regional pictures; the older Phandelver battle-map images were removed Oct 2026).   public/tokens/  Token art (73 numbered PNGs + ~1,130 named ones, with manifest.json).
data/tts-cache/        Cached generated voice clips. GIT-IGNORED (the only data folder that is).
```

## What git tracks

Everything is tracked except five things: **`.env`** (the only file with secrets: API keys, set on the Settings page), `node_modules/`, `.DS_Store`, `data/tts-cache/` (voice clips, regenerated on demand) and `data/usage.json` (your own AI usage totals). The user chose (Oct 2026) to track the maps, tokens, sheet PDF and campaign data too, so a fresh clone works after `npm install` plus a `.env`. That includes copyrighted material (the Lost Mine text in `data/campaigns/`, the Phandelver and purchased dd2vtt maps in `public/uploads/`, the Drive token art in `public/tokens/`), so check the licences before pushing to a public repository. Never commit `.env` or paste a key anywhere. Campaign saves (`data/campaigns/<id>/save.json`, the journal) are tracked too, so they show up as changes while you play.

## Notes (read when you need them)

The long notes live outside this file so it stays quick to read. Search them (grep) before changing a feature or reopening a decision:

- **docs/notes/api-and-features.md**: how each part works (the API routes, the tabletop's combat, fog and light, conditions, party and rules tracking, the DM's reply schema, the stat cards, streaming and fast mode...).
- **docs/notes/history-and-open-items.md**: what was decided and built, in order, and the open items (maps and the painting pipeline, sounds, the Lost Mine maps, the server and page splits, live checks...).
- **docs/ARCHITECTURE.md**: the layout of the code for humans; **docs/todo.md**: the to-do list; **docs/map-set-format.md**, **docs/multiplayer-plan.md**, **docs/creator-and-market-plan.md**: plans.

## Standing rules

- Official 5e rules, no house rules (check remembered rules against the book).
- Never commit `.env` or paste a key anywhere. Never send a published or purchased map to the image tool; regional and town art comes from ChatGPT, battle maps follow the user's chosen method (see the notes).
- The gate before a commit: `npm run check`, `npm test` and `npm run test:browser` all pass (the browser suite takes about four minutes). Run `npm run dm-check -- --live` (it spends money) after changing the DM prompt, schema or board state.
- Do not make paid API calls gratuitously. Do not claim audio was heard: only the user can judge voices and sounds.
- Do not hand-edit data/mapsets files while the server runs: change them through the API.

## Voices

Two engines, switchable any time (Settings page, chat-tab dropdown, voice-test checkbox; stored in `localStorage` key `vtt.voiceEngine`): **ChatGPT voices (OpenAI)** and **Microsoft/browser voices** (Web Speech API). Claude has no voice output. The DM labels each line with a voice tag (narrator, gruff, sly, noble, elderly, child, monstrous, ethereal, feminine, masculine, beast for a medium animal, smallbeast for small ones (high-pitched: mice, birds), largebeast for large ones (low-pitched: bears, horses), undead for ghosts and the dead; these were added Oct 2026 and have not been listened to). The mic is muted while the DM speaks (stream track disabled, recognizer stopped, 1.2 s grace) to stop it transcribing the narration. The speed parameter is ignored by `gpt-4o-mini-tts`, hence the browser-side effects in `voice-fx.js`.

## Conventions

- Complete code only: no placeholders, no truncation, no `...` elisions. Match the surrounding style (comment density, naming, idiom).
- ES modules on the server (`import`, no `require`). The pages use classic scripts that share one global scope: the tabletop is `public/index.html` plus `public/js/tabletop/*.js`, Map Test is `public/map-test.html` plus `public/js/map-test/*.js`; shared pieces are `public/js/*.js` (`sight.js`, `token-size.js`, `map-shared.js`...).
- Server routes go in `routes/*.js` (`registerX(app, deps)`), pure logic in `lib/`.
- Run `npm run check` after edits. Browser state is in `localStorage` (`vtt.board.<campaign>`, `vtt.chat.<campaign>`, `vtt.fog.*`, ...); always wrap it in try/catch.

## Testing notes

- The embedded preview browser blocks the microphone and has only 3 Microsoft voices, so speech-to-text and voice quality can only be judged by the user in Chrome or Edge. Don't claim audio was heard.
- Don't send paid API calls (`/api/chat`, `/api/tts`) gratuitously; keep tests short.
- Automated tests (Oct 2026, `test/`, `scripts/dev/dm-schema.mjs`, `scripts/dev/dm-check.mjs`): `npm test` is the fast, free, offline suite (node:test, no new dependencies, about 12 s, 376 tests): dice (folds in scripts/dev/test-dice.mjs), party/gear/rests, sheet edits, journal/safety/settings, campaign maps and start pins, the wall builder, SRD/compendium/charbuild/saved character sheets, the DM's flat-update expanders and DM_SCHEMA, rules tracking through the API (hit dice, exhaustion, resources, XP, clock, rests and the 24-hour refusal), the live SSE stream (lib/live.js), the module's own creatures and token art overrides, an HTTP suite (campaigns new/start-over, characters, party, rolls, map config, game save, local-only guards) and `/api/chat` against a FAKE Anthropic API. The server tests run the real server.js on a random port inside a temp COPY of the app and data (test/helpers/sandbox.mjs), so the real data/ is never touched; the pure helpers in server.js (expandTokenUpdates, gearToPartyUpdates, expandSheetEdits, DM_SCHEMA) are read out of server.js as text by scripts/dev/dm-schema.mjs (if their code moves, that file says so). `npm run test:browser` drives headless Chrome over the DevTools protocol against the tabletop (`?nosave=1`, `window.vtt`: movement around walls/doors/fences, fog and seenByParty, travelTo on the start pin, combat order, hit points, DM board updates, light and darkvision, difficult terrain on Terrain Test Grounds, `?watch=1` refusing writes; 135 tests, about four minutes); needs Chrome and `node --experimental-websocket`, and skips itself when either is missing (CHROME_PATH overrides the location). `npm run dm-check -- --dry-run` prints the plan of the scripted DM check; `npm run dm-check -- --live` SPENDS MONEY (6 messages, at most 8 API calls, one run in Oct 2026 cost about $0.80 with Opus 5.5, 6 to 30 s per reply): it runs a throwaway server on a copy of the data through a local proxy and asserts schema validity, dice taken from the tray, no leaked hidden-token markers, real token ids, startCombat with hit points and AC, and journal categories, printing only pass/fail lines, token usage and a cost estimate (no story text). Its checker is itself tested for free (test/dm-check.test.mjs). **Gate: `npm test` (about 12 s, free) and `npm run test:browser` must both pass before a change is committed or merged;** `npm run check` stays the syntax gate. Run `npm test` after changes to lib/ or the API, and `npm run dm-check -- --live` after changing DM_SYSTEM, DM_SCHEMA or the board state.
- `node --watch` does not reload `.env`, but the Settings page applies key changes live.
