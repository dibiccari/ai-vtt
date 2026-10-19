# To do (kept by the assistant; the user adds items in chat)

## In progress
- Goblin Ambush pilot DONE (Method A, vtt-goblin-ambush.png, in the Lost Mine campaign as triboar-ambush; pictures and prompts in public/scenarios/compare/goblin-ambush/); the user has not reviewed it yet.
- Lost Mine on our own maps: Method B (layout from the pack walls, ChatGPT repaint) drifts from the walls on most maps (Thundertree up to two squares, the castle badly, Redbrand and others 20 to 30 px), so only Cragmaw Hideout (vtt-cragmaw-hideout-b, within a few pixels) stays a Method B map. Every other battle map is the Method A version (picture painted first, walls traced onto it, always aligned): Goblin Ambush, Agatha's Lair, Cragmaw Castle day and night, Old Owl Well, Redbrand Hideout, Thundertree, Wave Echo Cave, Wyvern Tor. Idea to retry Method B when OpenAI credits are back: draw the layout with solid wall bands at the real wall thickness so the painter must keep them, measure drift against the walls automatically, keep only maps under about 10 px. The user does not want near-exact copies of the purchased art. The Method B tools stay: scripts/make-wall-layout.mjs, remake-from-pack.mjs, crop-region.mjs, copy-pack-setup.mjs.
- OpenAI image credits are used up (HTTP 429): add credits before generating more pictures.

## Tabletop and DM
- DONE (Nov 2026, later): live DM checks of the shop, place discovery and gear pass; table-side XP for defeated creatures; lighter clock duty; place pins for players with discovery and a Show places switch; Lights tool, light radius view, fence/door drawing, ring-top setting, white fog, panning with the left button.
- DONE (Nov 2026): per-map fog-off setting (Map Test, under Mood theme; Show Fog is only a viewing aid). Place pin discovery refinements still open: the DM revealing pins by area, a regional label layer for roads and trails.
- DONE (Nov 2026): Party accordions and per-character pop-out with the full sheet, level-up wizard (+ Level-up Test page), inventory wizard with shop and coins, journal as a quest log without a clear button, tabletop and Map Test light follow the 5e rule, characters use GUID ids, DM purchases (gear buy) and the shop token action, the Merchant agent, the Bookkeeper agent, reply forms for fight and scene.
- Orchestrator, next steps: decide when a service tool is worth its extra round trip (the DM once called buy_item with a fake item and, with a tool present, skipped a map change); next specialists: recurring NPCs, a rules and lookup service, combat bookkeeping last.
- Level-up wizard gaps: multiclass characters, subclasses and feats beyond the SRD (typed by hand), spells for prepared casters beyond the choice counts, racial features.
- DONE (Nov 2026): inventory wizard gaps: give an item to another character or the stash (a Give… drop down on each carried item, `POST /api/party/give`), +N armor, shields and weapons (a +N in the name adds N to the armor class, or to the attack and damage), and the Strength-minimum speed penalty (10 ft, shown in the working). Still open: a real weapon-proficiency source for races.
- DONE (Nov 2026): the merchant remembers the party between visits (visits, how the last visit ended, the price; data/campaigns/<id>/merchants.json, cleared by Start over). Still open: stock lists per campaign, selling magic items.

## Light and vision
- DONE (Nov 2026): light zones inside one map (Map Test > Zones tool; see CLAUDE.md). Still open: dragging a zone's corners (today delete and redraw), a Market/blueprint layer for zones, the tabletop swapping to the Night look by the clock,. The DM does not have to narrate zones (they are a visual aid), so no live check is planned.
- DONE (Nov 2026): light from gear, first version (public/light-data.json, lib/light-gear.js): torch, lantern, candle, Flame Tongue (40/80), Sun Blade (15/30), Lantern of Revealing and Mace of Disruption (held, shines by itself). The DM sees `lightItems` per character and lights or douses with the light action; the table refuses a magic kind the character does not wield. Still open: burn time of torches and lanterns, enforcing the bonus action cost, more SRD light items, a lit state on the item itself in the Party page, and a way for the player to light things without asking the DM.
- DONE: DM prompt rule for improvised fire hazards (oil flask, burning torch, thrown lantern; 2014 rules).

## Map sets
- Fog per level (one layer per set today).
- Campaigns, the tabletop and the DM's changeMap to use GUIDs (characters already do).
- DONE: the Group and This version is called fields are gone from Map Test.
- The .vttmap container and the Market.
- Import and trace scripts still write the old per-picture files in data/maps.


- DONE (Nov 2026): label layer for regional maps: a level's `labels` (region names, place names, trail names set along a path, in image pixels) are drawn by code (public/map-labels.js) on the tabletop and in Map Test's Player view with a shared Show labels switch; scripts/apply-coast-labels.mjs writes the Sword Coast's names and its two roads. Still open: Claude writing the labels for a new map from the module text and the painted picture (grid overlay) as part of the generation pipeline, a Labels tool in Map Test to place and edit them by hand, and labels for town maps.
- Better-looking generated maps: improve the map generation pipeline output (user request, 2026-10-14). Ideas on the table: regions and objects in the set so the layout drawing says what each area is, Gemini as the Method B painter, per-feature validation, a polished deterministic fallback renderer, an outdoor and a dungeon style guide, and a review gallery to compare outputs. See COLLABORATION.md.

## Map Test editing (user, Nov 2026)
- DONE (Nov 2026): door card (select a door in the Walls tool: State, DC, Starts open, Delete) and, with the Door kind picked, a click on a wall makes a one-square door in it. With a wall selected the Door button still turns the whole wall into a door.
- DONE (Nov 2026): the AI DM decides day or night (token action timeofday); the picture darkens with a wash at night, and a place with a Night look shows that picture (same size only; it brings its own light, lights and sound). Still open: a Day | Night control for you at the table (today you tell the DM).
- DONE (Nov 2026): a window is its own kind (type 'window', purple in Map Test, Window button) beside Fence; both stop movement but not sight or light. Zone corners can be dragged, added (Alt + click an edge) and removed (right-click).
- Terrain and Eraser tools still paint on a drag, so the map pans there only with Space or the middle button.

## Architecture and tokens (user, Nov 2026)
- Have agents review the ARCHITECTURE of the code (not bugs: the earlier reviews tested behaviour). The user sees a lot of files and cannot tell whether that is normal or bloat: ask for file and folder structure, size of server.js and public/index.html, duplicated code between pages, scripts that are no longer used, data that does not need to be tracked, and what to split, merge or delete.
- Image token upload on the character sheet: choose a picture from the computer, save it to the token library (public/tokens, with the manifest) and set it as the player's token. Works on a saved sheet (the token can be changed there).
- Token from a photo: upload a photo and an AI converts it to fit the style of the current D&D tokens (round, framed, same look), then saves it to the library and can set it as the token. Needs an image generator that edits pictures (see Settings > Map generators for the services); the style should match the existing token art.

- DONE (Nov 2026): stat cards for SRD creatures on the board and spell cards for the party's spells (lib/statcards.js). Still open: cards for magic items and class features, the table rolling creature attacks itself, a live check that the DM uses the cards.

## Characters
- The campaign wizard's quick characters do not use the searchable spell, weapon and armor lists.
- A saved character's new weapon: Party > Manage gear > Shop takes it for free from the SRD (works today). A new spell: only level-up or the DM (saved sheets stay read only by design).

## Known problems
- Flaky browser test 'a campaign built from scratch opens on its first map': cause found (a character sheet was written in place, so a read during a save skipped the character and the party came back one short); sheets are now written atomically. Three clean full runs since; watch it.
- Voices and sounds need the user's ears.

## On hold
- Multiplayer (keep it in mind).

## From the first live session (Nov 2026)
- Speed: the reply is no longer written twice (done). Still open if it is slow: let the DM stream its reply and speak the first lines while the rest is written, a shorter reply by default, a lighter model for plain scenes, and trimming the board state sent each turn. The play log (data/logs) now records the wait for the model and the delay to the first sound, so measure before changing more.
- The character sheet's printed HP box (HPCurrent) is not updated when hit points change in play (only the record is); decide whether the sheet page should show the record's HP.
- Transcript export: the play log is the answer (readable at /api/campaigns/<id>/log?format=text); a button on the Journal page to download it is not built.

## Architecture review (two agents, Nov 2026) and test hygiene
- Repo structure: public/ root has 43 loose files (21 pages, 20 shared scripts, 2 data files); plan: dev pages to public/dev/, shared scripts to public/js/ (a sed over ~45 script tags), data json to public/data/, scripts/ grouped into tools/{dev,maps,images,legacy} with READMEs (about 20 of 52 scripts are referenced by nothing), public/scenarios/compare (166 MB of image experiments) archived or out of git. Keep the URL paths /uploads /tokens /audio /scenarios (saved data points at them).
- Weight: .git is 638 MB of loose objects (never packed): `git gc` alone shrinks it. About 120 MB are byte-identical duplicate map pictures (the lmop- and vtt-pack- copies) and 61 duplicate token PNGs. `.claude/settings.local.json` is tracked and personal: should be ignored.
- Missing basics: README.md (CLAUDE.md is the only documentation and is 173 KB), LICENSE, .editorconfig, ESLint/Prettier, CI (GitHub Actions: npm run check + npm test), a pre-commit hook, the SDK is `latest` in package.json (pin it), test:browser lists 13 files by hand (use a glob), no architecture doc for humans.
- Code shape: server.js 2,773 lines with 116 routes and 20+ mutable globals, env read in 42 places (a config.js), no createApp factory (tests copy the whole app); public/index.html 5,073 lines (91 percent one inline script, 215 functions); the sight, light and movement code is duplicated between index.html and map-test.html (castRay, visibilityPolygon, litRegion...); server.js imports a browser file for its side effect (public/token-size.js). Proposed order: README + docs/ARCHITECTURE.md; tooling and CI; config.js; extract CSS and a shared sight module; routers one at a time; services/dm; client ES modules.
- Test hygiene: the browser and server tests copy the LIVE data folder, so uncommitted map edits (Map Test) make unrelated tests fail (Terrain Test lights, regional tiles, places). The sandbox should start from the committed data (git HEAD) or a frozen fixture folder.
