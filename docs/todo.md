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
- Inventory wizard gaps: give an item to another character or the stash from inside the wizard, magic armor (+1) on the armor class, Strength-minimum speed penalty, a real weapon-proficiency source for races.
- Merchant agent: remember a merchant between visits (stock, mood, prices), merchant stock lists per campaign, selling magic items.

## Light and vision
- DONE (Nov 2026): light zones inside one map (Map Test > Zones tool; see CLAUDE.md). Still open: dragging a zone's corners (today delete and redraw), a Market/blueprint layer for zones, the tabletop swapping to the Night look by the clock, and a live DM check that the DM narrates a zone's light correctly.
- DONE (Nov 2026): light from gear, first version (public/light-data.json, lib/light-gear.js): torch, lantern, candle, Flame Tongue (40/80), Sun Blade (15/30), Lantern of Revealing and Mace of Disruption (held, shines by itself). The DM sees `lightItems` per character and lights or douses with the light action; the table refuses a magic kind the character does not wield. Still open: burn time of torches and lanterns, enforcing the bonus action cost, more SRD light items, a lit state on the item itself in the Party page, and a way for the player to light things without asking the DM.
- DM prompt rule for improvised fire hazards (a lantern thrown into a fire).

## Map sets
- Fog per level (one layer per set today).
- Campaigns, the tabletop and the DM's changeMap to use GUIDs (characters already do).
- DONE: the Group and This version is called fields are gone from Map Test.
- The .vttmap container and the Market.
- Import and trace scripts still write the old per-picture files in data/maps.


- AI-written trail and label layer for regional maps (generation pipeline): Claude writes place names, positions and trail paths as data from the module text and the painted picture (grid overlay), code draws names and curved trail names over it; image models never paint the words. Needs a trails layer in map sets.
- Better-looking generated maps: improve the map generation pipeline output (user request, 2026-10-14). Ideas on the table: regions and objects in the set so the layout drawing says what each area is, Gemini as the Method B painter, per-feature validation, a polished deterministic fallback renderer, an outdoor and a dungeon style guide, and a review gallery to compare outputs. See COLLABORATION.md.

## Map Test editing (user, Nov 2026)
- DONE (Nov 2026): door card (select a door in the Walls tool: State, DC, Starts open, Delete) and, with the Door kind picked, a click on a wall makes a one-square door in it. With a wall selected the Door button still turns the whole wall into a door.
- DONE (Nov 2026): the AI DM decides day or night (token action timeofday) and the picture darkens with a wash at night. Still open: showing the place's Night look picture instead of the wash when it has one (the pictures can differ in size and have their own lights), and a Day | Night control for you at the table.
- Window as its own kind (today a window is stored as a fence: both stop movement, not sight or light); the DM would then say "window" rather than "fence".
- Terrain and Eraser tools still paint on a drag, so the map pans there only with Space or the middle button.

## Characters
- The campaign wizard's quick characters do not use the searchable spell, weapon and armor lists.
- No way to give a saved character a new spell or weapon except through the DM.

## Known problems
- Flaky browser test: a campaign built from scratch opens on its first map (about one run in four).
- Voices and sounds need the user's ears.

## On hold
- Multiplayer (keep it in mind).
