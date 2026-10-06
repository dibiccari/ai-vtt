---
name: learn-walls
description: Learn the doors, walls and floor of a battle-map picture (WotC style, 5 ft grid printed on walkable ground) and trace them into a map config for Map Test and the tabletop. Use when asked to add walls/doors/fog to a map that only has a picture.
---

# Learn walls from a map picture

Result: `data/map-layouts/<picture>.json` (what you read) and `data/maps/<picture>.json` (walls, doors, rooms, start pin). Everything runs offline, no API calls.

Facts that make it work: WotC maps are drawn on a 5 ft grid; **walkable ground is drawn with grid lines, rock/ledges/chasms are not**; doors are white rectangles about 0.65 x 0.27 square lying in a wall; walls have a thick dark outline on the inner face. You read a picture best with a labelled grid overlay and rooms written as rectangles in grid-cell units (column,row).

## Steps

1. **Pictures.** Table picture `public/uploads/dnd-<name>.jpg` (player version, no labels), DM version `dnd-dm-<name>.jpg` (same size and layout, so one set of walls serves both: `copies` in the layout). `sips --resampleWidth 2475 -s formatOptions 88 in.jpg --out out.jpg` (max 2700 px). Put a 1568 px copy of each in `data/dm-maps/` (the DM is shown it). Read ink from the picture without labels when you can (`inkPicture`): labels cover outlines.
2. **Layout stub:** `{"picture":"dnd-x.jpg","inkPicture":"public/uploads/dnd-x.jpg","rooms":{},"copies":["dnd-dm-x.jpg"]}` then `node scripts/find-grid.mjs data/map-layouts/x.json` (sets cell, origin, width, height; strength under 2 means not found; an existing layout keeps its numbering).
3. **Doors:** `node scripts/find-doors.mjs <layout>` fills `detectedDoors`. Add hand doors (locked symbol etc.) in `doors`, fences/bars in `fences`, secret doors in `secrets` (all in cell units: `{h|v, from, to}`).
4. **Read rooms.** Overlay crops of about 16 x 11 cells: `node scripts/grid-overlay.mjs <ink picture> c0,r0,c1,r1 0.9 out.png --layout <layout> [--rooms] [--walls data/maps/x.json]` then view the png with the Read tool. Write each room as `[x0,y0,x1,y1]` in `rooms`, gaps in walls as `openings`, and set `"snap": true` so edges snap to the dark outline. Caves: no rooms, use `caveMasks` instead (step 5).
5. **Cave floor** (`caveMasks.<name>` = `{region:[c0,r0,c1,r1], ...}`): `node scripts/grid-evidence.mjs <layout> c0,r0,c1,r1 0.9 out.png --mask [--ink]` shows printed grid pieces (green) and the floor the builder takes (orange; `--ink` marks outline cells red). Builder = grid seeds, then a fill that stops at the dark outline (`lib/cavemask.js`). Tune: `inkDark` (default 80; 100 for soft outlines), `reach` (squares the fill may go, 0.75), `neck`, `res` (8), `bars:false` when the cave outline itself is dark (otherwise edges become chasm bars), `minFence`. Hand fixes in cell units: `remove` rectangles (legend, frame: never floor), `add` rectangles (forced floor: dark rubble, bridges), `seeds` rectangles (water or faint ground, must lie inside the cave). Dark rubble and water read as outline or gaps: expect to add rectangles. Iterate until the orange matches the cave.
6. **Build:** `node scripts/build-walls-from-layout.mjs <layout>`. It also writes `rooms` (picture pixels; so Map Test and the tabletop do not treat a small room as an "object whose top shows") and a `start` pin from `layout.starts` (`{"start":[col,row]}`, only when the config has none; keep it inside the map, not on a legend).
7. **Verify with screenshots** (needs a server: `PORT=3101 node server.js &`, kill only your own pid; Chrome on macOS): `node --experimental-websocket scripts/map-shot.mjs --layout <layout> --walls --fog --token c,r [--clip c0,r0,c1,r1] [--poly] --out shot.png`, then Read the png. Check: walls hug the outline, a token in one room sees only that room (no leaks into neighbours), doors sit in gaps. Writes are blocked so shots never change data/maps.
8. **Iterate** on the layout (never hand-edit the config), rebuild, shoot again. Record the map, counts and known flaws in CLAUDE.md "Walls read from a picture".

Gotchas: `pkill -f "node server.js"` kills everybody's servers, never use it. Map Test autosave keeps `rooms` and `secrets` (server.js PUT). Tokens parked on the start pin explore fog first: map-shot resets explored after placing its token.
