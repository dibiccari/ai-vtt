# To do (kept by the assistant; the user adds items in chat)

## In progress
- Goblin Ambush pilot DONE (Method A, vtt-goblin-ambush.png, in the Lost Mine campaign as triboar-ambush; pictures and prompts in public/scenarios/compare/goblin-ambush/); the user has not reviewed it yet.
- Lost Mine on our own maps: Method B (layout from the pack walls, ChatGPT repaint) drifts from the walls on most maps (Thundertree up to two squares, the castle badly, Redbrand and others 20 to 30 px), so only Cragmaw Hideout (vtt-cragmaw-hideout-b, within a few pixels) stays a Method B map. Every other battle map is the Method A version (picture painted first, walls traced onto it, always aligned): Goblin Ambush, Agatha's Lair, Cragmaw Castle day and night, Old Owl Well, Redbrand Hideout, Thundertree, Wave Echo Cave, Wyvern Tor. Idea to retry Method B when OpenAI credits are back: draw the layout with solid wall bands at the real wall thickness so the painter must keep them, measure drift against the walls automatically, keep only maps under about 10 px. The user does not want near-exact copies of the purchased art. The Method B tools stay: scripts/make-wall-layout.mjs, remake-from-pack.mjs, crop-region.mjs, copy-pack-setup.mjs.
- OpenAI image credits are used up (HTTP 429): add credits before generating more pictures.

## Tabletop and DM
- DONE (Nov 2026): Party accordions and per-character pop-out with the full sheet, level-up wizard (+ Level-up Test page), inventory wizard with shop and coins, journal as a quest log without a clear button, tabletop and Map Test light follow the 5e rule, characters use GUID ids, DM purchases (gear buy) and the shop token action, the Merchant agent, the Bookkeeper agent, reply forms for fight and scene.
- Place discovery and the per-map fog-off setting: discovery is built (token action discover, Known to players flag) but not live-checked with the real DM; a battle map has fog on by default and no per-map switch to turn it off yet.
- Live-check the shop end to end with the real DM (the DM opening a shop with the token action, the Merchant agent talking, the dialog, the DM's note afterwards); only the free tests and two direct merchant calls have run.
- Orchestrator, next steps: decide when a service tool is worth its extra round trip (the DM once called buy_item with a fake item and, with a tool present, skipped a map change); make the clock advance and XP dependable (the time step fails now and then: the DM sends no time action); next specialists: recurring NPCs, a rules and lookup service, combat bookkeeping last.
- Level-up wizard gaps: multiclass characters, subclasses and feats beyond the SRD (typed by hand), spells for prepared casters beyond the choice counts, racial features.
- Inventory wizard gaps: give an item to another character or the stash from inside the wizard, magic armor (+1) on the armor class, Strength-minimum speed penalty, a real weapon-proficiency source for races.
- Merchant agent: remember a merchant between visits (stock, mood, prices), merchant stock lists per campaign, selling magic items.

## Light and vision
- Light zones inside one map (user request, 2026-10-15): today a whole map is bright, dim or dark. Cragmaw Hideout has an outdoor part that should be bright in the daytime while the cave stays dark. Draw areas (polygons) with their own ambient light: an "outside" zone follows the time of day (bright by day, dark at night, from the game clock and the Day or Night look) and an "inside" zone is always dark. Today the workaround is daylight map lights, but a lantern or torch still lights ground that should simply be daytime. A zone needs: a Map Test tool to draw it, the light level per zone (and whether it follows the time of day), `lightLevelAt()` and the fog and sight code reading the zone at each point, the DM seeing the zones in the board state, and the saved set format. (Light zones were built once and removed in Oct 2026 because the purchased maps had none; this is the reason to bring them back.)
- Lights tool in Map Test (place, move, light and snuff lights such as a brazier) and a "light the brazier" player action.
- Torch from gear: an equipped torch sets the token's light; swapping back to a weapon costs an action.
- DM prompt rule for improvised fire hazards (a lantern thrown into a fire).

## Map sets
- Fog per level (one layer per set today).
- Pin visibility (known and discoverable pins, revealPin, a Show discovered places toggle): docs/map-set-format.md section 6c.
- Campaigns, the tabletop and the DM's changeMap to use GUIDs (characters already do).
- Remove the Group and This version is called fields from Map Test.
- The .vttmap container and the Market.
- Import and trace scripts still write the old per-picture files in data/maps.

- Regional map: show the names of towns, cities and trails (roads) on it (our Sword Coast; public/coast.html already lays names over the picture, the tabletop and Map Test do not).

- AI-written trail and label layer for regional maps (generation pipeline): Claude writes place names, positions and trail paths as data from the module text and the painted picture (grid overlay), code draws names and curved trail names over it; image models never paint the words. Needs a trails layer in map sets.
- Better-looking generated maps: improve the map generation pipeline output (user request, 2026-10-14). Ideas on the table: regions and objects in the set so the layout drawing says what each area is, Gemini as the Method B painter, per-feature validation, a polished deterministic fallback renderer, an outdoor and a dungeon style guide, and a review gallery to compare outputs. See COLLABORATION.md.

## Characters
- The campaign wizard's quick characters do not use the searchable spell, weapon and armor lists.
- No way to give a saved character a new spell or weapon except through the DM.

## Known problems
- Flaky browser test: a campaign built from scratch opens on its first map (about one run in four).
- Voices and sounds need the user's ears. The DM time step fails now and then in the live check (no clock advance sent).

## On hold
- Multiplayer (keep it in mind).
