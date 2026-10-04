# AI-VTT

Self-hosted D&D 5e virtual tabletop. **Claude (Anthropic API) is the Dungeon Master**; the browser draws the battlemap and speaks the DM's replies. Currently loaded with the *Lost Mine of Phandelver* campaign.

## Run it

```
npm install
npm run dev      # node --watch server.js  -> http://localhost:3000
npm run check    # syntax-checks server.js and the inline <script> of public/index.html
```

Shortcut: double-click `start.command` (Mac) or `start.bat` (Windows). It checks for Node 20+, runs `npm install` on first use, starts the server and opens the browser.

Keys live in `.env` (git-ignored). Easiest way to set them: open **Settings** (`/settings.html`) and paste them in. It writes `.env` and applies instantly, no restart. `.env.example` lists every variable.

## Layout

```
server.js              Express + Multer, ES modules only (no require). All API routes.
public/index.html      The tabletop: ONE file, vanilla JS + canvas. Grid, tokens, walls, fog, chat, sheets, map tools, voice.
public/voice-test.html Voice test page: mic/speaker check, every voice with Play/Stop, "Talk to the AI DM" panel.
public/settings.html   API keys, models, voice engine choice.
public/nav.js          Shared top navigation bar (add a page = add one line).
public/voice-fx.js     Playback effects for ChatGPT voices (old = thin/slow/quaver, child = higher/faster).
scripts/check.mjs      Syntax check used by `npm run check`.
data/characters/*.json Character sheets (4 seeded PCs).
data/campaign/         Campaign text (*.txt/*.md) given to the DM + voices.json. GIT-IGNORED.
public/uploads/        Map images. GIT-IGNORED.   public/tokens/  Token art (73 PNGs). GIT-IGNORED.
data/tts-cache/        Cached generated voice clips. GIT-IGNORED.
```

## Not in git (copy from the original machine, or re-create)

`.env` (keys: use the Settings page), `data/campaign/` (campaign text extracted from the user's PDF + `voices.json`), `public/uploads/` (19 Phandelver maps), `public/tokens/` (73 portraits named `token-01.png`...). They are copyrighted or secret, so never commit them or add them to the repo.

## API (server.js)

- `GET/POST /api/characters`, `DELETE /api/characters/:id`: sheets as JSON files.
- `POST /api/upload` (field `map`), `GET /api/maps`, `GET /api/tokens`.
- `POST /api/chat`: `{message, history, tokens, characters, walls, gridSize, mapName, inputMode}` returns `{narrative, voiceLines[{speaker,voice,text}], mapUpdates[]}`. Uses `claude-opus-5-5`, structured JSON output (`output_config.format`), the campaign text as a cached system block, and `fallbacks: 'default'`. `mapUpdates` types: moveToken, addToken, removeToken, setHp, addWall.
- `GET /api/tts/status`, `POST /api/tts`, `POST /api/tts/voices`: OpenAI text-to-speech (`gpt-4o-mini-tts`). Clips are cached on disk. Named NPCs use `data/campaign/voices.json`; others get a voice by style tag.
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
- **Walls**: the user draws walls per map by hand (Map Tools to Draw Walls); only the city map needs none.
- **Token collection**: the user shared a Google Drive folder "1st D&D Token Collection" (many category folders) to add. Not downloaded yet: needs the user's OK on which categories/size.
- **Token names**: the 73 tokens are unnamed; the user names each when placing it.
- **Voice tuning**: Elderly and Child voices were still being tuned (user said they sounded too young / not childlike). Effects live in `public/voice-fx.js`; acting directions are in `TTS_PROFILES` in `server.js`.
- Optional idea the user declined for now: a different voice engine per character.
