# Map sets: one file, many maps (design, Nov 2026)

Nothing here is built yet. It turns your description into a model, shows how today's files map onto it, and proposes an order that never breaks a working game.

## 1. The idea

Today one picture is one "map", and a place that needs a day and a night face, a DM and a player face, or an upstairs and a downstairs is several maps held together by a naming habit (`group` and `variant`, a DM picture in another folder, two entries in a campaign's list). Everything that does not change (walls, pins, fog) is entered twice.

A **map set** is one place, held in one container. Inside it:

- one or more **levels** (a ground floor, a cellar, a deck and the hold below it): each level is one drawing area with its own size;
- for each level, one or more **looks**: the player picture, an optional DM picture, and optional **times** (day, night, later maybe dusk or winter), each time with its own player and DM picture;
- **things shared by every look of a level**: the grid calibration, walls, doors, difficult terrain, pins and the fog of war that has been revealed;
- **things that belong to one look**: the picture, the light level, the lights (night has torches, day does not), the ambient sound and the mood;
- **links** between levels (and inside a level): a point that leads to another point.

## 2. Kinds, tiles and fog

| Kind | Tiles | Start point | Player token | Fog |
|---|---|---|---|---|
| battle | squares (5 ft) | yes (arrival circle) | yes | on |
| town | none | optional | yes (no grid, free movement) | revealed (a town is a picture) |
| regional | hexagons (5 miles) | no | no: the party is a pin the DM sets | **revealed by default** |

`isRevealed` is a per-level switch available to any map: on means the fog of war is gone for that level. It defaults to on for regional maps and off for battle maps. The tabletop and Map Test both honour it.

## 3. What is stored where

A set is a folder, `data/mapsets/<id>/`, and exports as one file (`<id>.vttmap`, a zip, or one JSON with the pictures inside):

```
set.json            name, kind, tiles, description, mood default, isRevealed default, levels[], links[]
levels/<n>/level.json   name, size, squares (grid calibration), walls[], doors[] (open, locked, secret, dc), difficult[], pins[], isRevealed
levels/<n>/<time>-player.png      time = day, night, ... or "main" when there is only one look
levels/<n>/<time>-dm.jpg          optional: the DM picture (or drawn by Make the DM version)
levels/<n>/<time>.json            light level, lights[], ambience, mood for that look
fog is not in the set: it lives with the game (per campaign, per set, per level), shared by every look
```

- All looks of one level must have the same pixel size and the same alignment (a repaint with the layout locked gives that). The editor checks the size when a look is added and shows the walls over each look so drift is visible.
- A **pin** is a point on a level: name, label, description, radius, and for the start pin the arrival circle. The same pin serves day and night.
- A **link** joins two points: `{ id, kind: stairs|ladder|hatch|door|portal|gate, from: {level, pin or x,y}, to: {level, pin or x,y}, twoWay, locked?, secret?, dc?, note }`. Dragging a token onto a link point offers "Take the stairs?"; the DM can also send it. Locked and secret work as they do for doors.
- Importing a `.dd2vtt` makes a set with one level and one look; exporting a level and look to `.dd2vtt` writes the standard parts only (picture, walls, doors, lights, grid) so other tools can use it.

## 4. How it meets what exists

| Today | In a set |
|---|---|
| `data/maps/<picture>.json` | the level's shared file plus the look's file |
| `group` + `variant` (camp day and night, Cragmaw Castle) | the times of one level |
| `data/dm-maps/<picture>.jpg` | the DM picture of a look |
| the campaign's `maps.json` listing pictures | lists sets (a set id, optional starting level and time) |
| `changeMap {mapId, arrive}` | `changeMap {mapId, arrive, level?, time?}`; the time follows the game clock unless the DM sets it |
| fog PNG per picture in `fog.json` | one fog per set and level |
| Market packs of one picture | a pack is a set |
| Maps page: 31 pictures | one card per set, with its levels, looks and links |

Day and night can follow the **game clock** that already exists: after dusk the table shows the night look of the level, the lights switch on, the ambience changes, and nothing else moves.

## 5. The tools

- **Map Creator / Editor** edits a set: a level picker, a time picker (add a look by uploading, generating or repainting), the DM | Player switch, and a Links tool. Walls, pins and terrain are drawn once per level.
- **Maps page** lists sets, not pictures; the list shrinks (the 31 pictures become about 20 sets today).
- **Regional** sets have no start pin and no token; the party's place is a pin (for example "Phandalin") and the table can show it.

## 6. Order of work (each step keeps the game working)

1. **Read model, no rewrite (small to medium).** Add a server module that *builds* sets from the current files (group and variant, DM pictures, configs) and an API (`GET /api/mapsets`). The Maps page switches to sets. Nothing is moved on disk. Tests lock the mapping.
2. **Store sets for real, with migration (medium).** `data/mapsets/` becomes the source; a migration script converts every current map; `data/maps` and `data/dm-maps` stay readable until the last step. Map Test learns the level and time pickers and saves shared and per-look data to the right place.
3. **Tabletop and the DM (medium to large).** The campaign registry lists sets; `changeMap` takes level and time; time of day from the clock; fog shared per level; `isRevealed`; links (stairs, portals) with the "take the stairs" step and the DM action; regional maps with no token and a party pin; the DM prompt and board state describe levels and links.
4. **The container file and the Market (small to medium).** `.vttmap` export and import, `.dd2vtt` import and export, Market packs become sets, the licence checks stay.
5. **Editor polish (medium).** The Links tool, add-a-look wizard (upload, paint, repaint with the layout locked), checks for size and alignment.

The first two steps are invisible to a player and are what makes the later ones cheap. Step 3 is where the game changes.

## 6b. Ids, and the game state in separate files (user, Nov 2026)
A set is **content**: it does not change while you play, it can be shared, and two campaigns can use the same set. The **game state** is what changes: fog revealed, where the tokens stand, which doors are open, which secret doors were found, which links were unlocked, which look (time) is showing. So:
- every set, level, look, pin, door and link gets a **stable id** (set `camp`, level `camp/1`, door `camp/1/d3`, link `camp/1/l1`). Ids never change after creation, even when a name or a picture does;
- the saved game keeps its own file per campaign and set (for example `data/campaigns/<id>/state/<set id>.json`): `{ set, version, levels: { "1": { fog: <png>, tokens: [{id, x, y}], doors: { d3: {open, locked, found} }, links: { l1: {locked} } } }, time: 'night' }`. The same set with another campaign has its own state; the set file itself is never written by play;
- the state refers to the set by id and to the set's **version** (a number the editor bumps on every change): if a level is redrawn or a wall moved, the table sees the version differ and can keep what still makes sense (fog) and flag what may not (door ids that vanished);
- Start over clears the state files and leaves the sets alone; sharing a set sends no one's game with it.

This also fixes a problem of today: a door a player opened is saved into the map's own file when Map Test is used, and fog is a picture file keyed by the picture's name.

## 7. Decisions I would like from you

1. **Folder inside, file for sharing**: a folder in the project (easy to edit and diff), one `.vttmap` file to share. OK?
2. **Times**: day and night to begin with, built so more can be added (dusk, winter, flooded). OK?
3. **Lights per look, walls per level**: a night look has torch lights the day look lacks; the walls are shared. Right?
4. **Fog per level**, shared by all looks, kept with the saved game: right?
5. **Regional maps**: no start pin, no token; the party is a pin. Right?
6. **Town maps**: free movement with a token, no tiles, revealed by default. Or no token either?
7. **Which step first?** Step 1 is built (see below). Next would be step 2, with ids and the separate state files from section 6b.

## 6c. Pins the players can see (user idea, Nov 2026, not built)

A pin gets a `visibility` in the set file: `dm` (default, today's behaviour: only the DM and Map Test see it), `known` (players see it from the start, e.g. the town square) or `discoverable` (hidden until found). The set file only says what a pin CAN be; which discoverable pins the party has found is game state, saved with the campaign keyed by set id, level and pin id (`discoveredPins`). A pin is discovered when the DM sends a reveal (a new `revealPin` token action) or when a party token walks into its radius (e.g. the Shrine of Luck). The player map gets a "Show discovered places" toggle that draws the known and discovered pins with their `label`; the DM picture always shows all of them. Regional and town maps benefit most (no fog there, so pins are how places unlock).
