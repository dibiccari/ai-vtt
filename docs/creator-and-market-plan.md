# Creator, Market and the optional AI DM (plan)

Written for the project owner, Nov 2026. Nothing here is built yet except where it says "exists today". It collects the direction you gave and says what is easy, what is hard and what I would do first.

## 1. The idea in one paragraph

A **Creator** area where anyone can build the two things a game needs, **characters** and **maps**, and save them as small portable files. A **Market** (a library of such files, later a shared one) from which a campaign, or a one-shot with no campaign at all, can import a character or a map in one click. Maps get a **mood theme** and, later, **animation**. Three kinds of map, each with its own tools: **battle** (square grid, walls, fog, lights), **town** (no grid, named places) and **regional** (hexagons of 5 miles). Pictures can be **generated from a prompt**. The **AI DM becomes optional**.

## 2. What exists today (so we build on it)

| Piece | Where | Note |
|---|---|---|
| Character sheets (official 5E PDF fields), token picker | characters.html | full editing |
| Starter characters (name, race, class, level 1-5) | lib/quick-character.js, new campaign wizard | spells and background are left empty |
| Map Test (pins, fog and line of sight test, grid calibration, difficult terrain brush, .dd2vtt import) | map-test.html | also the place where a map is set up |
| Map Maker (requests and feedback for maps the assistant draws) | map-maker.html | the assistant draws them offline with lib/mapkit.js |
| Generators (dungeon, camp, tavern, terrain test) | scripts/make-*-map.mjs, lib/mapkit.js | walls, doors and lights come out correct because they are drawn from the same data |
| Moods and ambience, flicker animation of lights | public/ambience.js, public/flicker.js | sound scenes, mood presets, flickering fires |
| Regional and town maps | campaign map kinds `regional`, `town` | plain pictures today: no tokens, no grid, no labels |
| DM-only picture of a map | data/dm-maps | labels and secrets the players never see |
| New campaign wizard | campaigns.html | own campaign from a premise, maps and a party |

## 3. The Creator

One new top-level area (nav group **Creator**) with two workshops. Everything a workshop makes is a file you can export, import and share.

### 3.1 Character Creator
- A guided builder (race, class, level, abilities by standard array, point buy or your own rolls, background, skills, equipment, spells chosen from the SRD list) that ends in the same record the sheet page edits. Today's quick character is its first step; the sheet page stays the place for full detail.
- Export and import as one JSON file (`.vttchar`): the record, the token picture embedded.
- **Size:** medium. The rules data (SRD classes, spells, equipment) is already in `data/srd`; the work is the guided flow and the checks.

### 3.2 Map Creator
One page with a map type chosen first. The types differ in tools but share the frame: picture, name, mood, notes for the DM, pins, a preview on the table.

**Battle map** (square grid, 5 ft)
- Everything Map Test already has: grid calibration, walls and doors, fog test, lights, pins and module areas, difficult terrain brush, fences, ambience, start pin.
- The hand wall and door drawing tools were removed earlier because the purchased maps carry their walls; a creator needs them back (draw, erase, door tool, secret door) as a proper editor.
- Pictures come from three sources: a generator (section 5), an upload (a picture or a .dd2vtt) or a prompt to an image model.

**Town map** (no grid)
- A picture plus **named places**: each is a pin with a name and a note (Shrine of Luck, the Rusty Flagon, the blacksmith). A checkbox **Show names** draws the labels on the picture for the players; the DM always sees them. Labels can be hidden one by one (a secret place) and the table keeps a DM-only copy as today.
- Optional: the assistant (a vision model) reads the picture and suggests label positions to drag into place.

**Regional map** (hexagons)
- A picture plus a **hex overlay** with a checkbox. The overlay is drawn by us, not by the image: controls for hex size, offset, flat or pointy orientation and the **distance per hex (5 miles by default, editable, because some modules use 6)**, so a generated picture never has to line up by itself.
- On the table the party becomes one marker that moves hex to hex; the table counts the miles and the days of travel at a chosen pace (the game clock already exists) and the DM is told. Terrain per hex (road, forest, hills, mountain, water) can be painted with the same brush as difficult terrain and sets the travel cost.
- Named places (towns, ruins) are pins, as on town maps.

### 3.3 Mood themes
A **mood** is a named bundle chosen when building a map: ambience scene, ambient light level (bright, dim, dark), a colour grade (warm, cold, sickly green), optional particles (rain, snow, drifting leaves, embers, fog) and the music mood. Presets (Tavern night, Haunted crypt, Sunny forest road, Storm at sea...) and a custom one. Stored as one `mood` entry in the map config; the tabletop applies it on arrival. The sound part exists today (`ambience`, moods in ambience.js); the rest is new.

### 3.4 Animated maps
Built as **layers over the still picture**, so a generated or purchased picture stays as it is:
1. **Light flicker** (exists).
2. **Water**: a painted mask (the brush we have) over water squares; a gentle moving shimmer and ripples.
3. **Weather and particles**: rain, snow, leaves, embers, mist drifting; a mood chooses them.
4. **Foliage sway** and **drifting fog**: masks plus a small distortion.
5. **Token and spell effects** (later): a fireball burst, a door opening, a footstep dust cloud.
All drawn on the canvas at a low frame rate and only while visible; an **animations off** switch and an automatic off on slow machines are part of the design (this is where big-map performance dies in other VTTs). Size: medium for layers 1-4, open-ended after that.

## 4. The Market

Start small and honest about what it is:
1. **Stage 1: a local library** (small). A **Library** page lists every map and character on this server as cards with a picture, type, mood and tags; one click adds a map to a campaign or a character to a party. A **one-shot is just a short campaign** (the tavern brawl is one): it is made with the same wizard, from a small template of one map, a few documents and a party, so there is no separate "quick game" concept. Library cards say "Add to a campaign"; a short ready-made campaign is a template like any other.
2. **Stage 2: packs** (small to medium). A pack is one file (`.vttpack`, a zip): a manifest, the picture, the config (walls, doors, lights, pins, terrain, mood), optional DM picture and notes, plus a licence line. Import by file or by URL. This is how you share with a friend.
3. **Stage 3: a hosted market** (large, and a different kind of project): accounts, uploads, search, ratings, moderation, takedowns, payments if paid. It needs a server that is not your computer. I would not start here. The pack format from stage 2 is what makes it possible later.

**Licensing is the real risk.** The purchased maps (the Lost Mine pack), WotC pictures and the token art are copyrighted: they must never be offered through any sharing path, and the pack tool should refuse to export a map whose source is a purchased one. Maps made here (generated, drawn, or uploaded by the person who owns them) carry the creator's licence line. User uploads need a takedown path before anything is hosted.

## 5. Making pictures from a prompt

Who can do what, plainly:
- **Claude cannot produce a painted picture.** It can write code that draws one (what the generators in scripts/ do: dungeons, camps, taverns, with perfectly correct walls and lights) and it can read a picture (vision) to suggest labels, walls or terrain.
- **ChatGPT's image model can paint a picture** from a prompt. You already have an OpenAI key in Settings for the voices; the same key would work. It costs per image, so it needs the usage card and a confirm.

So, by map type:

| Type | Picture from | Overlay we add | Confidence |
|---|---|---|---|
| Regional | image model, prompt "hand drawn fantasy region map, rivers, mountains..." | our hex grid (size, offset, 5 miles) | good: no walls needed; the hex overlay hides any misalignment |
| Town | image model, prompt "top-down fantasy village map, no text" | our name labels (pins) | good: ask for no text, then add ours |
| Battle, drawn | the generators in lib/mapkit.js with parameters (rooms, size, style) | walls, doors and lights come with the drawing | very good and exact; the art is simpler than a painted map |
| Battle, painted | image model | walls, doors and lights traced by Claude from the picture (the experiment in scripts/build-walls-from-layout.mjs) and fixed by hand in the editor | **weak today**: painted maps rarely sit on a grid and the traced walls need correcting; I would offer it only with the editor's fix-up tools |

Grid and scale for any generated picture are set in the editor (the calibration tool exists). Generated pictures are saved with their prompt, model and date.

## 6. An optional AI DM

Three modes, a setting of the campaign (and of a one-shot):
- **AI DM** (today): everything runs through the DM chat.
- **Human DM**: the host (or a seat the host promotes) plays the DM using a **DM toolbar** that sends the same updates the AI sends today (add or remove a creature, damage, heal, conditions, reveal, move the table to a map, light, sound, start combat, journal note). The table's rules automation keeps working underneath. The chat is just chat; no AI call is made, so no cost.
- **No DM** (solo or co-op): a tabletop with rules help and no story engine.

Why this is feasible: the AI already drives the table through a small set of flat updates (`token` actions, `gear`, `changeMap`, `journal`). A human DM needs buttons and a creature picker for the same set. Why it is not trivial: those buttons are a whole DM screen, and the human DM sees things players do not (hidden tokens, DM notes), which wants the multiplayer roles to exist first. Size: medium to large; best after multiplayer phases 1 and 2.

## 7. Suggested order

| Step | What | Size | Why this order |
|---|---|---|---|
| A | **Creator shell and Library** (stage 1): nav group, a Library page of maps and characters, add to campaign | small to medium | makes the vision visible quickly and needs no new engine |
| B | **Pack format** (`.vttpack`, `.vttchar`): export and import with licence checks | small to medium | sharing and one-shots; the base of any market |
| C | **Regional maps**: hex overlay with a checkbox, 5 miles per hex, party marker and travel days, terrain painting | medium | most of the value for little drawing work; picture from the image model |
| D | **Town maps**: named places layer with Show names, DM-only places | small | quick win after C |
| E | **Image generation** from a prompt (regional and town first), with cost shown | small to medium | uses the key you have; needs the usage card extended |
| F | **Battle map editor**: wall, door and light drawing back, plus "generate a drawn dungeon, cave or camp from a prompt" | medium to large | the drawn generators are the reliable path |
| G | **Mood themes**, then **animation layers** (water, weather, fog, foliage) | medium | needs the map config format settled by A-F |
| H | **Character Creator** (guided builder, export and import) | medium | independent; can run in parallel with C-G |
| I | **Optional AI DM** (human DM toolbar) | medium to large | after multiplayer phases 1-2 |
| J | **Hosted market** | large | only if you want to publish to other people |

Multiplayer (docs/multiplayer-plan.md) is a separate track. It does not block A-H; it does block I and J.

## 8. Risks and honest limits
- **Quality of generated art** varies; people will want to regenerate. Keep prompts, allow upload instead, and never promise a perfect map.
- **Painted battle maps** will not be exact (grids, walls); the drawn generators will. Say so in the tool.
- **Cost:** each image has a price and a prompt that goes wrong costs money. Confirm before spending, show the running total.
- **Copyright and moderation** once anything is shared (section 4). Decide before stage 3.
- **Performance** of animation on big maps and slow machines: animations default off on low-end, one switch to turn all off.
- **Scope:** this document is larger than everything built so far. A, B, C and D alone already change what the app is; stop there and play before building the rest.

## 8b. What the comparisons decided (Nov 2026)
- Regional and town pictures: ChatGPT's image model wins (the user's verdict on the Shire); our code adds the hex overlay or the place names.
- Battle maps: the user prefers **option 3, ChatGPT's painted picture with walls, doors, objects and lights traced onto it by Claude** (public/scenarios/compare/crypt.html). So the editor's centre is a **trace-over-the-picture workflow**: paint (or upload) a picture, then lay exact walls, doors, solid objects and lights over it with a ruler-like overlay, nudge them until they sit on the picture, and test the line of sight at once. Claude's help is a "trace this picture" step that looks at ruler-marked crops of the picture and proposes the walls, which the person then corrects; ChatGPT's own wall reading is not good enough to use.
- The repaint route (draw a layout exactly, have the image editor paint it with the layout locked) stays as a second way in for people who start from a plan; the editor needs a nudge tool for the objects that drift.

## 9. Questions for you
1. For painted pictures, is the OpenAI key already in Settings the one to use, and is a per-image cost acceptable (I would show it before each generation)?
2. Hex size: 5 miles per hex as you said, with 6 as an option. Should travel use the 2014 pace (slow 18 / normal 24 / fast 30 miles a day)?
3. Is the Market, at first, a local Library plus files you can send to a friend? Or do you want it hosted for strangers from the start?
4. Should the human-DM mode be in the first multiplayer release or after?
