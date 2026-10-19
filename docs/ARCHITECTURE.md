# Architecture

AI-VTT is one Node process that serves static pages and a JSON API, and a set of browser pages that do the drawing and most of the rule checking. The AI is called only from the server.

```
 Browser (public/)                Server (server.js + lib/)              Outside
 ┌──────────────────────┐         ┌───────────────────────────┐         ┌──────────────┐
 │ tabletop, Map Test,  │  HTTP   │ routes, prompt building,  │  HTTPS  │ Anthropic    │
 │ characters, party... │◄───────►│ saves, dice, SRD lookups  │◄───────►│ OpenAI, ...  │
 │ canvas, fog, combat, │  NDJSON │ keys live here only       │         └──────────────┘
 │ voice playback       │ (stream)│ data/ on disk             │
 └──────────────────────┘         └───────────────────────────┘
```

## One turn

1. The player types or speaks. The tabletop packs the board: tokens, party sheets, walls and doors, light, the combat order and the notes the table wants the Dungeon Master to see.
2. `POST /api/chat` (with `stream: true`). The server builds the prompt: the Dungeon Master's rules, the module chapters for the current map (only the areas near the fight during combat), the journal, stat cards for the creatures on the board and the party's spells, and a tray of pre-rolled dice.
3. Claude answers in a fixed JSON shape: `rolls`, `voiceLines`, `mapUpdates`. The server reads the stream and sends each roll and voice line to the browser as soon as it is complete, so the table prints it and speaks it while the rest is still being written.
4. The server applies what it can check (creature stats, character edits, gear, XP, rests, map changes) and returns the finished reply. The browser applies the board updates under its own rules: movement, walls and doors, conditions, fog and light.
5. A cheaper model (the Bookkeeper) writes the journal afterwards in the background.

**Rule of thumb.** The browser and the server enforce whatever can be calculated: positions, hit points, timers, light, dice. Claude decides what things mean: the story, the difficulty, who does what. Nothing random comes from the model: the dice come from `crypto.randomInt`.

## Where things live

| Concern | Code | Data |
|---|---|---|
| Campaigns (a module plus the save slot of a group) | `server.js` campaigns routes, `lib/campaign-maps.js`, `lib/journal.js`, `lib/settings.js` | `data/campaigns/<id>/` |
| Characters and gear | `lib/party.js`, `lib/sheet-edit.js`, `lib/loadout.js`, `lib/levelup.js`, `lib/rules-track.js` | `data/characters/*.json` |
| Map sets (one folder per place) | `lib/mapsetstore.js`, `lib/pictures.js`, `lib/blueprint.js`, set routes in `server.js` | `data/mapsets/<guid>/` |
| The Dungeon Master | `server.js` (prompt, schema, `/api/chat`), `lib/dm-schema-modes.js`, `lib/statcards.js`, `lib/module-select.js`, `lib/partial-reply.js`, `lib/bookkeeper.js`, `lib/merchant.js` | the campaign's documents |
| Voices | `server.js` (`/api/tts`), `lib/creature-voices.js`, `lib/pronounce.js`, `public/js/voice-fx.js` | `data/creature-voices.json` |
| SRD reference | `lib/compendium.js` | `data/srd/` |
| Play log | `lib/playlog.js` | `data/logs/` (not tracked) |
| The tabletop | `public/index.html` (one large page) plus `public/js/` | the saved game in `data/campaigns/<id>/game.json` and the browser |

## Conventions

- ES modules only on the server; plain scripts (small globals) in the browser, no build step.
- `lib/` modules never import `server.js`. Pure logic goes in `lib/` and gets a test.
- Anything that writes data writes a temporary file and renames it.
- Calls that change state or spend money are local-only (`localOnly` in `server.js`).
- Tests start the real server in a throwaway copy of the app, from the last committed data (`test/helpers/sandbox.mjs`), and use a fake Anthropic API.

## Where the code is heading

The two big files are the main thing a newcomer meets: `server.js` (about 2,800 lines, 18 areas) and `public/index.html` (about 5,000 lines, one inline script). The plan, in order of value and safety, is in `docs/todo.md`: a `config.js` for the settings, shared geometry, sight and light modules that the tabletop and Map Test both use, `server.js` split into routers with a `createApp` factory, and the tabletop's script split into ES modules.
