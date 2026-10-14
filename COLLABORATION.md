# Shared work and review log

This file is the handoff point for Codex and Claude working in this repository. Keep entries short, specific, and useful to the next person.

## How to use this file

- Add a dated entry when you make a meaningful change or complete a review.
- Record the files changed, the intent, and checks actually run. Say when checks were not run.
- For a review, list actionable findings first with severity and file/line references. If there are no findings, say so and note the scope reviewed.
- When reviewing another person's work, add your review under that work's entry; do not silently rewrite their summary.
- Mark follow-ups resolved with a link or reference to the fix. Leave unresolved items visible.
- This log supplements the code and project guidance; it does not replace `CLAUDE.md` or local instructions.

## Open review notes

### Codex review — 2026-10-11

Scope: server persistence and map-set routes. No tests were run.

- **High — map look creation can move/delete a picture before returning a conflict.** In `server.js`, `POST /api/mapsets/:guid/looks` moves the picture and may remove its former packet before checking whether the requested look already exists. A duplicate-time request can return `409` after changing files and leave map references broken. Check for the duplicate before moving the picture. Reference: `server.js` around lines 571–579.
- **Medium — overlapping game/fog writes share one temporary filename.** `writeJsonAtomic` uses `<file>.<pid>.tmp` for every concurrent write. Overlapping requests can interfere during write/rename and cause a failed or lost save. Use a per-write unique temporary filename; consider revision checks for stale board writes. Reference: `server.js` around lines 1103–1106.

Status: open; no fixes made as part of that review.

## Recent work

<!-- Add newest entries at the top. -->

### Codex review — 2026-10-12 — Whole-repository review

Scope: complete `CLAUDE.md` and `COLLABORATION.md`, server routes and persistence, map-set storage, library modules, test harnesses, documentation, and parse validation for every tracked JavaScript and JSON source. No paid API calls were made.

- **High — the documented syntax gate crashes on Windows before checking the browser scripts.** `scripts/check.mjs` passes native Windows paths directly to dynamic `import()` (`await import(path.join(...))`). Node interprets `C:\\...` as an unsupported URL scheme and exits with `ERR_UNSUPPORTED_ESM_URL_SCHEME`. Convert the paths with `pathToFileURL(...).href` (or use a file URL based on `import.meta.url`) before importing. Reference: `scripts/check.mjs:25-26`.
- **High when listening beyond loopback — unauthenticated clients can spend API credits and overwrite game data.** `HOST` can bind the server outside localhost, but the paid `/api/chat` and `/api/tts` routes and mutable `/api/campaigns/:id/game`, `/fog`, `/api/characters`, and `/api/upload` routes have no authentication or `localOnly` protection. A LAN peer can therefore make billable requests or alter game state. The multiplayer plan documents this as a future `seatOnly` requirement; either keep non-loopback binding disabled until that exists or guard these routes now. References: `server.js:37, 230-278, 1122-1156, 1457-1469, 1960`; `docs/multiplayer-plan.md`, “The local-only guards”.
- **High — `npm test` remains red** due to the LF-only schema boundary reported in the preceding 2026-10-12 validation entry (`scripts/dm-schema.mjs:25`): 189 pass, 9 fail.
- **High — map-look conflict mutation and medium — colliding game/fog temporary files** remain open from the 2026-10-11 review. Reconfirmed in `server.js:575-578` and `server.js:1103-1106`; they were not fixed during this review.

Validation: all tracked `.js`/`.mjs` sources pass `node --check`; all tracked JSON files parse. `npm run check` fails with the Windows import error. `npm test` fails as above. `npm run test:browser` reports 64 skipped because Chrome is not installed, so browser behavior was not executed. No code changes made.

### Codex review — 2026-10-12 — Validation and handoff check

Scope: `COLLABORATION.md`, test harness, and the current unit-test gate.

- **High — the required unit-test gate is red.** `npm test` reports 189 passing and 9 failing tests. All failures share the same cause: `scripts/dm-schema.mjs` locates the end of `DM_SCHEMA.properties.voiceLines` using the LF-only string `\n};\n`, while `server.js` is CRLF-encoded. The search returns `-1`, so the loader incorrectly says it cannot find `DM_SCHEMA`; this breaks `chat-fake`, `dm-expand`, `monsters-art`, `token-size`, and the fake-DM checks. Use a line-ending-independent boundary (or normalize input before parsing) and add a regression assertion. Reference: `scripts/dm-schema.mjs` around line 24.

- The pre-existing map-set and atomic-write findings in **Open review notes** remain open; not re-reviewed in depth.

Checks run: `npm test` (failed as above). No code changes made.

### Codex — 2026-10-11 — Existing grid-scale contract

Current code already defines one tactical square as **5 × 5 ft**. `public/map-test.html` sets `FT_PER_SQUARE = 5`, derives a grid cell from image width ÷ `squares`, and reports the resulting physical dimensions. `public/index.html` also defines `FT_PER_SQUARE = 5` and scales calibrated art onto its fixed logical board grid.

The persisted map-level setting is currently `squares`: the number of grid cells across. The number of rows is inferred from the art's aspect ratio, and walls, pins, and terrain are stored in source-image pixel coordinates. This permits arbitrary map dimensions while preserving the scale: a 30 × 20-cell map represents 150 × 100 ft.

For reliable autonomous map generation, consider making the scale contract explicit in the map-set schema: `columns`, `rows`, `feetPerSquare: 5`, and optionally `pixelsPerSquare` for rendering. That would let the layout generator select an exact playable size before art generation, instead of deriving rows from the image selected afterward. No code changes made.

References: `public/map-test.html` around lines 249, 273, and 1367; `public/index.html` around line 452; `lib/mapsetstore.js` map-level `squares` mapping.

This shared Markdown file is the working reference for Codex and Claude on the battle-map pipeline, including this scale contract and the calculations that turn grid dimensions into feet and output-image dimensions. Keep any agreed formula or schema revision here so both agents use the same contract.

### Codex — 2026-10-11 — Battle-map image pipeline proposal

The map set must remain the playable source of truth: its level geometry, walls, doors, pins, terrain, and `blueprint.svg` define the map. An AI-generated image is the visual layer, never the authority for movement, line of sight, or fog.

Proposed production pipeline:

1. Create the map set and authoritative layout first.
2. Derive a raster **paintable layout reference** from it. The existing SVG blueprint is a useful contract, but image models need more visual structure: wall bands with real thickness, explicit door gaps, floor regions, water/cliffs, movement-relevant objects, scale, and intended top-down framing.
3. Generate art from that reference and a semantic prompt.
4. Measure alignment before accepting it. Keep the existing wall-drift score, and add separate checks for door endpoints/openings, narrow corridors, and major landmarks; a low median wall drift can still hide one unusable doorway.
5. Repair or reject a result with local failures. If small residual drift remains, render a restrained authoritative wall/door treatment over the art so the picture and rules communicate the same space.
6. Save the accepted player art, any DM art, the unchanged set data, and regenerated blueprint together in the packet.

Autonomous-campaign requirement: this pipeline must work when no person reviews the result. For an improvised encounter, the AI DM should first request or generate a structured encounter layout (rooms, terrain, entrances, cover, objective, scale), from which the server creates a valid map set and blueprint. That gives the game exact geometry before image generation begins. The art stage should then run an automatic generate → validate → retry loop with bounded attempts. If every art result fails the alignment checks, the table must still receive a playable fallback: the generated layout rendered in a clean drawn style, with the authoritative walls, doors, terrain, and labels visible. A bad image may reduce visual quality; it must never delay or corrupt the encounter.

This makes the paths distinct:

- **Runtime improvised maps:** structured layout first, automatic validation, and a deterministic rendered fallback. No human action required.
- **Curated maps:** the same pipeline may offer human review and manual polish, but must not depend on it.

Assessment of current approaches:

- **Method A** (image first, then trace walls) is the dependable production route today because the final geometry is exact, though it needs careful tracing/review.
- **Method B** (layout first, then AI paints it) is the strategic target because it makes art serve gameplay. Keep it experimental until the richer reference and feature-level validation consistently prevent structural drift.

Question for Claude: Does the current `blueprint.svg` have enough information to produce the proposed paintable reference, or should the map-set schema add floor/water/object regions first? Please respond beneath this entry.

### Codex — 2026-10-11 — Map Test token art

- Added a **Test token image** selector to `public/map-test.html`, populated from the token gallery. The selected image is clipped into the preview token and remembered in browser storage; **Numbered marker** keeps the old appearance. Default image: `human-warrior-stern-a8268.png`.
- Checks: not run.
