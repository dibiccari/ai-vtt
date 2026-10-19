# AI-VTT

A self-hosted virtual tabletop for Dungeons & Dragons 5th Edition where **Claude is the Dungeon Master**. The browser draws the battle map, applies the rules it can check by itself (movement, walls, line of sight, light, conditions, initiative, hit points), and speaks the Dungeon Master's replies aloud. It currently ships with the *Lost Mine of Phandelver* campaign and a tavern-brawl test scenario.

Everything runs on your own computer. Your keys stay in a local `.env` file and are only ever used by the server.

## What it does

- **An AI Dungeon Master** that reads the module, runs the story, rolls from a tray of real random dice, plays the creatures and keeps a journal. The reply is streamed, so the first words are spoken a few seconds after you speak or type.
- **A battle map** with grid, fog of war, walls and doors, lighting by the 5e rules (darkvision, torches, time of day), difficult terrain, token sizes, flying and a combat tracker.
- **Characters, party and gear**: character sheets, inventory and shops, level-up, rests, XP, conditions and spell effects with their durations.
- **Voices**: ChatGPT voices or the browser's own, one for the Dungeon Master and one for the NPCs, with a voice and acting notes for every creature in the Bestiary.
- **Maps**: a Map Test page for walls, doors, pins, terrain, lights and zones; map sets (one folder per place with its pictures, day and night looks and its set-up); a map market for sharing.
- **Tools**: a Bestiary and Spells reference (the SRD 5.1), a token library, sound and voice test pages.

## Quick start

You need Node.js 20 or newer.

```bash
npm install
npm run dev          # http://localhost:3000
```

Open **Settings** (`/settings.html`) and paste your keys: an Anthropic key for the Dungeon Master (required), an OpenAI key for ChatGPT voices and map pictures (optional). Settings are written to `.env` and take effect at once. `.env.example` lists every variable.

Then open **Campaigns**, press Continue on a campaign, and press **Begin the adventure** on the tabletop.

## Folders

| Folder | What is in it |
|---|---|
| `server.js` | The Express server and its API (routes, the Dungeon Master's prompt and reply handling). |
| `lib/` | Server modules: rules, party and gear, journal, map sets, prompts, voices, usage. Mostly pure functions with tests. |
| `public/` | The pages: the tabletop (`index.html`, with `css/tabletop.css` and `js/tabletop/`), Map Test, campaigns, characters, party, journal, bestiary, spells, settings. |
| `public/js/` | Scripts shared by the pages (navigation, fog, effects, token sizes, wizards...). |
| `public/dev/` | Developer and test pages (voice, sound, image, level-up, conditions, Test Lab) and the Sword Coast prototype. |
| `public/data/` | Data the browser and the server both read (effect durations, light from gear). |
| `public/tokens`, `audio`, `scenarios`, `vendor` | Token art, sound recordings, sample scenarios, third-party scripts. |
| `data/` | Your data: campaigns, characters, map sets, SRD tables. Tracked in git so a clone works. |
| `scripts/` | Command-line tools in four folders (`dev`, `maps`, `images`, `characters`); see `scripts/README.md`. |
| `test/` | Offline tests (`test/*.test.mjs`) and browser tests (`test/browser`). |
| `docs/` | Architecture, plans and the to-do list. |

`CLAUDE.md` is the short working document for the AI assistant that builds this project (how to run it, the layout, the conventions and the standing rules); the long API and behaviour notes and the decision history are in `docs/notes/`.

## Tests

```bash
npm run check         # syntax check of the server and every page's script
npm test              # about 370 offline tests, free, about 12 seconds
npm run test:browser  # drives headless Chrome over the tabletop and Map Test (needs Chrome)
```

The tests never touch your real data: they run the server on a random port in a throwaway copy of the app, starting from the last committed data.

Two scripts spend real money and are never run by the tests: `npm run dm-check -- --live` (a scripted check of the Dungeon Master) and `node scripts/dev/replay-session.mjs --live` (replays a recorded session and times it).

## Data, licences and copyright

`data/srd` holds the SRD 5.1 (CC-BY-4.0, Wizards of the Coast), see `data/srd/NOTICE.md`. The repository also contains the *Lost Mine of Phandelver* text, purchased map packs and token art that you may not be allowed to redistribute: check the licences before making a copy public. Never commit `.env`.

## More

- `docs/ARCHITECTURE.md`: how a turn flows between the browser, the server and the AI, and where the code is going.
- `docs/todo.md`: what is planned and what is known to be missing.
