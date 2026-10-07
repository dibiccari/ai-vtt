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

## 7. Decisions I would like from you

1. **Folder inside, file for sharing**: a folder in the project (easy to edit and diff), one `.vttmap` file to share. OK?
2. **Times**: day and night to begin with, built so more can be added (dusk, winter, flooded). OK?
3. **Lights per look, walls per level**: a night look has torch lights the day look lacks; the walls are shared. Right?
4. **Fog per level**, shared by all looks, kept with the saved game: right?
5. **Regional maps**: no start pin, no token; the party is a pin. Right?
6. **Town maps**: free movement with a token, no tiles, revealed by default. Or no token either?
7. **Which step first?** I would start with step 1.
