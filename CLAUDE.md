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
public/map-test.html   Map Test: draw walls/doors, fog of war + line of sight check, grid calibration, .dd2vtt/.uvtt import. Walls autosave to data/maps/.
public/tokens.html     Token gallery (names, categories, search) driven by public/tokens/manifest.json.
public/vendor/         pdf.js, its worker and pdf-lib (self-hosted, with licenses).
public/campaigns.html  Campaign selector: pick the active campaign (what the DM runs), read/delete its documents, import the adventure PDF (read in the browser by public/pdf-extract.js, split by PDF bookmarks).
public/test-lab.html   Test Lab: one click sets up the Rusty Flagon tavern-brawl scenario (campaign + map + 4 PCs + 8 NPC tokens) and lists prompts to try with the AI.
lib/                   Server-side modules: sheet-edit.js (applies the DM's sheet edits) and sheet-fields.json (official sheet field map).
public/uvtt.js         Shared Universal VTT (.dd2vtt) reader/importer used by Map Test and Test Lab.
public/scenarios/      rusty-flagon.dd2vtt (generated tavern map with walls/doors/lights, 50 px squares) and rusty-flagon-campaign.md (scenario text the server seeds).
public/nav.js          Shared top navigation bar (add a page = add one line).
public/voice-fx.js     Playback effects for ChatGPT voices (old = thin/slow/quaver, child = higher/faster).
scripts/check.mjs      Syntax check used by `npm run check`.
data/characters/*.json Character sheets (4 seeded PCs).
data/maps/<image>.json Per-map walls, doors and grid calibration (image-pixel coordinates; "source":"dd2vtt" marks imported maps). Tracked in git.
data/campaigns/<id>/    One folder per campaign: *.md text the DM is given, voices.json (named NPC voices), campaign.json, plus data/campaigns/active.json. GIT-IGNORED. (Old: data/campaign/, moved automatically.)
data/campaign/         (legacy) Campaign text (*.txt/*.md) given to the DM + voices.json. GIT-IGNORED.
public/uploads/        Map images. GIT-IGNORED.   public/tokens/  Token art (73 PNGs). GIT-IGNORED.
data/tts-cache/        Cached generated voice clips. GIT-IGNORED.
```

## Not in git (copy from the original machine, or re-create)

`.env` (keys: use the Settings page), `data/campaigns/lost-mine-of-phandelver/` (campaign text extracted from the user's PDF with the Campaigns page, + `voices.json`), `public/uploads/` (19 Phandelver maps), `public/tokens/` (73 numbered portraits `token-01.png`... plus ~1,130 named ones from the Drive collection, with `manifest.json`), `public/sheets/5E_CharacterSheet_Fillable.pdf` (WotC's free fillable sheet; download it from media.wizards.com/2016/dnd/downloads/5E_CharacterSheet_Fillable.pdf). They are copyrighted or secret, so never commit them or add them to the repo.

## API (server.js)

- `GET/POST /api/characters`, `DELETE /api/characters/:id`: sheets as JSON files. A character may carry `sheet` (PDF field name to value); a POST without `sheet` keeps the stored one. The record's name/class/level/HP/AC/speed/abilities are what the tabletop uses.
- Board updates the DM can return (mapUpdates): moveToken, addToken, removeToken, setHp, addWall, revealToken, hideToken. Tokens carry `hidden` and `kind` ("creature" or "trap"). The tabletop decides what the players see in `seenByParty()`: player tokens always; anything else only if it is not hidden and, while fog is on, inside a party member's current line of sight. Hidden/unseen tokens are not drawn, not in the turn bar, not in chat notes, not clickable, and are skipped by End Turn; the DM-view checkbox shows them as ghosts. The chat request sends each token's `hidden`, `kind` and `visibleToParty`, and the DM prompt forbids mentioning hidden things.
- The DM can edit player character sheets with the `updateCharacter` update (edits like classLevel/xpGain/maxHp/hp/str..cha or any official sheet field name, plus skills, saves, spells, slots). `lib/sheet-edit.js` applies it on the server inside `/api/chat`: it keeps modifiers, proficiency bonus, passive Perception and HP consistent, refuses name changes, saves the character, appends to `character.sheetLog` (shown with Undo on the Character Sheets page), and `/api/chat` returns `characterUpdates` for the tabletop to show. `lib/sheet-fields.json` is the field map (spell lines per level, slots) derived from the official PDF. The AI's reply schema is an `anyOf` of update types with all fields required, because the API rejects more than 24 optional schema fields. Level-up is a conversation driven by the DM prompt: it asks the player's choices first and only then calls updateCharacter.
- `GET /api/campaigns` (list + stats), `POST /api/campaigns/active {id}`, `GET/PUT/DELETE /api/campaigns/:id/files/:name` (PUT/DELETE and the active switch are local-only). The server loads the active campaign's text per request (cached until a file changes) and sends it to the DM as a cached system block.
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

- **Per-map grid calibration**: maps are big images (Cragmaw Hideout player map is 4500 px wide) and the app uses a fixed 50 px per 5 ft square, so a map's printed grid doesn't line up. Needs a per-map "squares across" setting.
- **Walls**: the user draws walls per map by hand (Map Test page, or import a .dd2vtt); only the city map needs none.
- **Token collection**: the user shared a Google Drive folder "1st D&D Token Collection" (many category folders) to add. Not downloaded yet: needs the user's OK on which categories/size.
- **Token names**: the 73 tokens are unnamed; the user names each when placing it.
- **Voice tuning**: Elderly and Child voices were still being tuned (user said they sounded too young / not childlike). Effects live in `public/voice-fx.js`; acting directions are in `TTS_PROFILES` in `server.js`.
- Optional idea the user declined for now: a different voice engine per character.
