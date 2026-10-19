# Scripts

Command-line tools, run from the project root (for example `node scripts/dev/check.mjs`). They are grouped by what they work on. Tools that call a paid service say so in their first line and never run by themselves.

## Development and checks  (`scripts/dev/`)

Run by `npm run check`, `npm run dm-check` and the tests, or by hand to measure the Dungeon Master.

| Script | What it does |
|---|---|
| `check.mjs` | Syntax-checks server.js and the inline <script> of public/index.html, map-test.html, tokens.html, characters.html, campaigns.html and test-lab.html. |
| `dm-check.mjs` | Scripted DM check: a short, fixed conversation with the REAL Dungeon Master (paid API calls), with invariants asserted on every reply. |
| `dm-schema.mjs` | Test helpers that read server.js as TEXT (so server.js does not need to change and nothing is started): the DM reply schema (DM_SCHEMA), |
| `playtest-driver.mjs` | A playtest bench: the real tabletop in headless Chrome, a throwaway copy of the app and its data, the real AI Dungeon Master (it SPENDS MONEY: about 20 to 40 cents a turn |
| `replay-session.mjs` | Replays the player messages of the first live session (test/fixtures/session-1.json) against the real DM, on a throwaway copy of the app, and times each reply. |
| `schema-probe.mjs` | Checks that the DM's reply schema (DM_SCHEMA in server.js) is still accepted by the API. The API refuses schemas whose compiled |
| `test-dice.mjs` | Rolls every kind of die many times and checks the results: node scripts/dev/test-dice.mjs |

## Maps  (`scripts/maps/`)

Generate, import, trace and set up maps: walls and doors from pictures, dd2vtt imports, procedural maps, grid and legend tools. Many are one-off tools kept because the work they did can be repeated (marked in the table by what they say they do).

| Script | What it does |
|---|---|
| `apply-coast-labels.mjs` | Writes the region and road names of our Sword Coast onto its map set as the `labels` layer (public/js/map-labels.js draws them in code over the picture). |
| `apply-legend.mjs` | Turns what legend-match.mjs found into layout features: each secret-door S glyph becomes a `secrets` entry on the nearest wall line. |
| `apply-map-sidecar.mjs` | Adds a generated map's settings (squares, light, ambience, start pins, difficult terrain) to its saved map config in data/maps/. |
| `build-walls-from-layout.mjs` | Builds a map config (walls, doors, fences) from a layout read off a picture: rooms and cave outlines in grid-cell units, openings, doors, fences. |
| `compare-walls.mjs` | Checks traced walls against a reference: the purchased (dd2vtt) version of the same dungeon, which has exact walls. Both are on a 5 ft grid, so the two pictures differ by |
| `copy-pack-setup.mjs` | Copies a pack map's set-up (walls, doors, pins, lights, difficult terrain, light level, sound) onto a remake of it, scaled by the ratio of the two pictures' widths, throu |
| `enhance.mjs` | Image tricks for reading a map picture: grayscale, contrast stretch, shadow lift (gamma), the dark "ink" mask (what the wall builder treats as outline), edges, the rednes |
| `find-doors.mjs` | Finds the doors drawn on a WotC-style picture: white rectangles about 0.65 x 0.27 of a square (or turned a quarter), lying in a wall. |
| `find-grid.mjs` | Finds the printed grid of a map picture: the cell size and the origin (where the first grid line sits), and writes them to the layout. |
| `grid-evidence.mjs` | Shows where grid line pieces are really printed on a map picture (walkable ground has them, rock and chasms do not), and what the wall builder takes as floor. |
| `grid-overlay.mjs` | Draws a crop of a map picture with its grid cells numbered, so the assistant can read rooms in grid-cell units (column,row). |
| `import-dd2vtt.mjs` | Import a Universal VTT file (.dd2vtt) without the browser: writes its picture to public/uploads/<name>.<ext> |
| `import-foundry-walls.mjs` | Copy the walls (and doors) of a Foundry VTT scene onto one of our maps. Some map packs ship a Foundry adventure bundle with walls |
| `legend-match.mjs` | Learns a map's legend: cuts the picture of each legend entry out of the legend panel and finds where the same symbol is drawn on the map. |
| `make-camp-map.mjs` | Draws a forest campsite battle map (day and night) and writes it as Universal VTT files: picture, walls (line of sight) and lights. |
| `make-coast-map.mjs` | Draws OUR OWN Sword Coast regional map in code, in a bold-ink atlas style, with the same geography as the published map in public/uploads/dnd-northswordcoast-playerversio |
| `make-coast-sketch.mjs` | Draws our own rough layout sketch of the Sword Coast region (the geography of the published map, positions only: sea on the west, the High Road, the Neverwinter Wood, the |
| `make-crypt-map.mjs` | Draws "The Sunken Crypt", a torch-lit crypt of four rooms under a ruined chapel, 30 x 20 squares on a 1536 x 1024 picture (about 51.2 px a square), and writes it as a Uni |
| `make-dungeon-map.mjs` | Draws "The Old Cellars", a torch-lit stone dungeon of five rooms, and writes it as a Universal VTT file with its walls, doors and lights. |
| `make-frontier-map.mjs` | Draws a rugged frontier-coast regional map in code (no image model): a sea along the west edge with a ragged shoreline and islets, windswept moorland and hills, pine fore |
| `make-night-from-day.mjs` | Makes the night picture of a place from its day picture by code, so every tree, building and rock stays exactly where it is (nothing is repainted): the day picture goes c |
| `make-regional-map.mjs` | Draws a pastoral regional map in code (no image model): rolling hills with hill-shading, a patchwork of farm fields with hedgerows, a winding river with a mill and a ston |
| `make-terrain-test-map.mjs` | Draws "Terrain Test Grounds", a small outdoor map for trying out fog of war, line of sight and difficult terrain, and writes it as a |
| `make-wall-layout.mjs` | Draws a plain line-drawing LAYOUT of a map from its saved walls, doors and pins (data/mapsets): the floor reachable from the pins is light, everything else is rock, walls |
| `map-shot.mjs` | Opens Map Test on a map in headless Chrome (DevTools protocol), sets walls / fog / sight outline, can place one test token, and saves a screenshot. |
| `pixel-grid.mjs` | A crop of a map picture with a pixel ruler (a line every 50 px, numbered every 100) so positions can be read off it, optionally with a map config's walls (red), doors (gr |
| `place-area-pins.mjs` | Puts the module's numbered areas on a map as pins (area-N), from positions given in the 1400-px-wide preview of the picture. |
| `read-coast-regions.mjs` | Reads the LAYOUT of a regional map picture (which blocks are sea, forest, hills, mountains, marsh, meadow) by colour and texture, in 8 x 8 pixel blocks, and writes the re |
| `remake-from-pack.mjs` | Method B for the Map Adventurer maps: draws each pack map's own walls as a layout (scripts/maps/make-wall-layout.mjs) and has ChatGPT repaint it, keeping the layout; the  |
| `terrain-overlay.mjs` | Draws a map picture with its difficult terrain (data/maps/<picture>.json "difficult") tinted orange and the grid lines, so a guess can be reviewed without opening Map Tes |
| `trace-crypt-both-v2.mjs` | The "both" half of the crypt comparison, second round (strictly overhead brief): ChatGPT painted public/scenarios/compare/crypt-chatgpt-v2.png; Claude read it with the pi |
| `trace-floor.mjs` | Traces the walls of a painted map by finding where the floor ends: every pixel brighter than --lum (luminance 0-255) counts as floor, the rest as rock, and the outline of |
| `update-terrain-test.mjs` | Gives the Terrain Test Grounds a running stream (an animated river effect from the painted stream), a brazier that starts unlit and can be lit (painted into the picture,  |

## Pictures  (`scripts/images/`)

Make and repaint map pictures with the image services (these spend money on the service you have chosen in Settings) and the Image Test comparisons.

| Script | What it does |
|---|---|
| `crop-region.mjs` | Cuts the map's rectangle out of a repainted result (the layout's sidecar <layout>.json says where it is) and writes it as a PNG of --width pixels (default: the rectangle' |
| `fit-picture.mjs` | Helpers for sending a map picture through the image editor, which only returns 1536x1024, 1024x1536 or 1024x1024: `pad` puts a 4:3 picture on a 3:2 canvas (the side strip |
| `generate-image.mjs` | Makes one picture with OpenAI's image model from a prompt file and saves it as a PNG. The key is read from .env (never printed). One image costs money: roughly $0.02 (low |
| `image-bakeoff.mjs` | Image bake-off: the same wall layout (public/scenarios/compare/image-test/layout.png, an inn drawn as thick stone bands) and the same prompt go to several image services, |
| `image-test-gemini.mjs` | Gemini paints the Phandalin town and the regional map from the same text descriptions given to ChatGPT and FLUX (public/scenarios/compare/town/phandalin-player-full-promp |
| `image-test-layout.mjs` | Locked-layout image test: draws one simple wall layout of an inn (walls as thick stone bands, a door gap, furniture), writes its walls and doors as JSON for the page's ov |
| `image-test-town.mjs` | FLUX Kontext on fal.ai paints a map from a text description only (no input picture): the Phandalin town ('town') or the Sword Coast-style regional map ('region'). The tex |
| `image-test.mjs` | One-time image quality test: paints the same prompt (public/scenarios/compare/image-test/prompt.txt) at low, medium and high with the image model chosen on the Settings p |
| `openai-repaint.mjs` | Repaints a picture with OpenAI's image model while asking it to keep every shape where it is (image edit with high input fidelity), so a map whose walls, doors and lights |
| `openai-trace-walls.mjs` | Asks an OpenAI vision model to read a battle map picture and return its walls, doors and lights as JSON in image pixels, then writes the map set-up (data/maps/<picture>.j |

## Characters  (`scripts/characters/`)

Build the seeded parties from the SRD tables.

| Script | What it does |
|---|---|
| `make-lmop-party.mjs` | Writes the Lost Mine of Phandelver party (level 1, 2014 rules) into data/characters/ and tags the older test characters |
| `make-tavern-party.mjs` | Gives the four Rusty Flagon test characters (Thorin, Lyra, Vex, Seraphine; level 3, 2014 rules) the weapons, spells, gear and sheet fields their |
