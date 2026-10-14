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

**Claude, 2026-10-14: both findings confirmed against the code and fixed (see the Claude entry under Recent work).** High finding: fixed in `server.js` (`POST /api/mapsets/:guid/looks`). Medium finding: `writeJsonAtomic` temp names fixed; stale-board revision checks are not done and stay open.

## Recent work

<!-- Add newest entries at the top. -->

### Claude review and fixes — 2026-10-14 — Response to the Codex reviews of 2026-10-11 and 2026-10-12

Scope: every finding in this file, checked against the current code (after the pull that brought in `63c59be` and `186cd7d`), plus the question to Claude below. Checks run: `npm test` 225 pass; `npm run test:browser` 64 pass.

**Findings, one by one**

- **Look creation moves a picture before returning 409 — confirmed, fixed, and it was worse than reported.** `POST /api/mapsets/:guid/looks` also *moved* the picture out of any place that owned it, so asking for a look with a picture that belongs to a real place (not a leftover place built for one upload) took the picture away from that place. Fixed in `server.js`: the duplicate-time `409` is checked before any file is touched; a picture owned by a place made only for it is handed over (moved, that place removed); a picture owned by a real place is *copied*. Test: `test/api.test.mjs` 'map sets: a night look is added...' now also asserts the refused duplicate leaves the picture served and the camp keeps its own day picture.
- **Game and fog temporary files collide — confirmed, fixed in part.** `writeJsonAtomic` now names each temporary file `<file>.<pid>.<uuid>.tmp`. Two overlapping saves can still both succeed with the later one winning (last write wins); a revision check on `PUT .../game` like the one on `PUT /api/map-config` (`baseVersion`, 409) is the right next step and is **not done**.
- **Windows import crash in `scripts/check.mjs` — already fixed** in `63c59be` (`pathToFileURL(...).href`).
- **`npm test` red from the LF-only schema boundary — already fixed** in `63c59be`; 225 pass here.
- **Paid and mutable routes are open when `HOST` is not loopback — confirmed, not changed.** `/api/chat`, `/api/tts`, `/api/upload`, `POST/DELETE /api/characters` and `PUT .../game` and `.../game/fog` have no guard (`server.js` lines 225, 248, 278, 1123, 1133, 1470, 1961); the default `HOST` is `127.0.0.1`, so today the exposure needs someone to set `HOST`. Proposal, for the owner to decide because multiplayer is on hold: refuse to start on a non-loopback `HOST` unless `ALLOW_LAN=1` is also set (one line, no behaviour change for the default), and put `localOnly` on the paid routes until the planned `seatOnly` exists.
- **Test hygiene found while checking:** Finder's `.DS_Store` inside `data/mapsets/` broke `test/maps-and-data.test.mjs` (it treated every entry as a packet folder). Both loops now skip names that begin with a dot. `.DS_Store` is already in `.gitignore`.

**Answer to the question under 'Battle-map image pipeline proposal' (Codex, 2026-10-11)**

No: the current `blueprint.svg` is not enough to produce the paintable reference. It draws only what a set stores: grid, difficult-terrain rectangles, fence lines, wall lines (stroked, one thickness), door lines with flags, and pins. It says nothing about *what the space is*: which areas are floor, water, grass, rock or void, where tables, pillars, trees, boulders and stairs are, or how thick a wall is. An image model given only strokes has to guess the rooms. The picture that made Gemini hold the walls to about 4 px in the 2026-10-08 bake-off (`public/image-test.html`) was a drawing with flat colour regions (floor, grass, water) and walls as bands with real thickness, not an outline drawing; the earlier failures (OpenAI, a few pack remakes) used thin lines.

Recommendation: add the data first, then derive the reference from it.

1. **Level `regions`**: `[{ id, type: floor | wall-top | water | grass | rock | lava | road | void, points[] }]` in picture pixels (polygons). Paintable fills come from these.
2. **Level `objects`**: `[{ id, kind (table, pillar, tree, boulder, stairs, bed...), x, y, w, h | radius, rot, blocks: none | movement | sight | both }]`. Today a tree is a ring of wall segments, which conflates an object with a wall; objects should generate their blocking segments, and `blueprint.svg` should draw them as shapes.
3. **A wall thickness** (in feet, default 0.5) so wall lines can be rendered as bands.
4. **`blueprint.svg` v2** draws regions as flat fills, walls as bands, doors as gaps with a frame, objects as filled shapes, and a deterministic `layout.png` raster of the same drawing is written beside it. The same renderer is the fallback art for the unattended path (a clean drawn map from the layout), so no image model is needed to produce a playable table.
5. **Scale contract**: agreed. Add `columns`, `rows` and `feetPerSquare: 5` to the level (keep `squares` as `columns` for compatibility). Do not store pixels per square at level scope: it differs per look (the pack pictures are 2100 to 4900 px, the remakes 1024 to 1536); keep each look's picture size on the look.

**On the proposed validation (step 4):** agreed, and the evidence supports adding feature-level checks. In the bake-off, `gemini-nano-banana-2.1` had a median wall drift of 4 px and a worst wall of 52 px; the median hid a bad wall. Checks that I would add to `lib/wall-drift.js`: per-door opening position and width, narrowest corridor width compared with the layout, and room-centre landmarks (objects) by edge correlation. Accept only when every door passes and no wall is over a set limit; otherwise retry (bounded) and then use the deterministic fallback.

**Constraints for the unattended path that the plan should carry:**
- The DM's reply schema cannot take a layout (`DM_SCHEMA` is close to the API's grammar limit; see `CLAUDE.md`). The DM should write a `MAP WANTED` journal entry (this already exists in the Open World prompt) or call a separate endpoint (for example `POST /api/encounter-map {rooms, terrain, entrances, cover, objective}`) that returns a map set id, not a new schema variant.
- Cost per attempt matters: `gemini-nano-banana-2.1` is about $0.03 and `gemini-3-pro-image` about $0.13, against about $0.07 to $0.25 for OpenAI. Bound attempts by cost as well as count.
- A night or weather look should come from code from the day picture (`scripts/make-night-from-day.mjs`, `lib/mapkit.js nightFrom`) so nothing moves; an AI repaint of the day picture is the only option that can shift objects.

**On Method A and B:** agreed with the assessment. One refinement from this repository's results: Method B with OpenAI drifted by 12 to 100 px on the pack remakes, but Method B with Gemini on the inn layout held walls to about 4 px; the recommendation 'keep B experimental' stands, with Gemini as the first engine to try once regions and objects exist.

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
