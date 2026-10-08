# To do (kept by the assistant; the user adds items in chat)

## In progress
- Goblin Ambush pilot DONE (Method A, vtt-goblin-ambush.png, in the Lost Mine campaign as triboar-ambush; pictures and prompts in public/scenarios/compare/goblin-ambush/); the user has not reviewed it yet.
- Lost Mine on Explorer Remakes (user review pending). Method B remakes (layout drawn from the pack's own walls, ChatGPT repaint, pack walls and pins copied on scaled; pins stay exactly where the module has them) are in the campaign for Cragmaw Hideout, Agatha's Lair, Old Owl Well, Redbrand Hideout, Thundertree and Wyvern Tor (pictures vtt-<map>-b.png, prompts and layouts in public/scenarios/compare/<map>/). Still on the Method A versions: Cragmaw Castle (day and night: the B day picture vtt-cragmaw-castle-day-b.png exists but the B night repaint failed, OpenAI credits ran out; make it with node scripts/openai-repaint.mjs on public/scenarios/compare/cragmaw-castle/b-day-padded.png with night-b-prompt.txt, crop with crop-region.mjs to vtt-cragmaw-castle-night-b.png, copy-pack-setup it from lmop-cragmaw-castle-night.png, then wire both) and Wave Echo Cave (the pack's wall data has only the rooms, not the cave outline, so Method B gives a flat field; keep Method A). Goblin Ambush has no pack walls: Method A. The map descriptions in maps.json still describe the Method A pictures for the B maps.
- OpenAI image credits are used up (HTTP 429): add credits before generating more pictures.

## Tabletop
- Party section (the Party tab): make each character's info accordions (collapsible sections), user request.
- Party in the tabletop: make it expandable / a modal pop-out.
- Level-up wizard: walks the player through a level-up and updates the character sheet (today level-up is a conversation with the DM).
- Inventory wizard: change gear step by step, and update the character sheet.
- Journal: remove the clear journal button.
- Bring the tabletop's light rule in line with Map Test (range is always the Vision setting, light only changes how well) and let map lights clear fog there.

## Light and vision
- Map Test: darkvision setting for the test token (60 or 120 ft), awaiting the user's answer.
- Lights tool in Map Test (place, move, light and snuff lights such as a brazier) and a "light the brazier" player action.
- Torch from gear: an equipped torch sets the token's light; swapping back to a weapon costs an action.
- DM prompt rule for improvised fire hazards (a lantern thrown into a fire).

## Map sets
- Fog per level (one layer per set today).
- Pin visibility (known and discoverable pins, revealPin, a Show discovered places toggle): docs/map-set-format.md section 6c.
- Campaigns, the tabletop and the DM's changeMap to use GUIDs.
- Remove the Group and This version is called fields from Map Test.
- The .vttmap container and the Market.
- Import and trace scripts still write the old per-picture files in data/maps.

- Regional map: show the names of towns, cities and trails (roads) on it (our Sword Coast; public/coast.html already lays names over the picture, the tabletop and Map Test do not).

## Characters
- The campaign wizard's quick characters do not use the searchable spell, weapon and armor lists.
- No way to give a saved character a new spell or weapon except through the DM.

## Known problems
- Flaky browser test: a campaign built from scratch opens on its first map (about one run in four).
- Voices and sounds need the user's ears. A live DM check is due after the next prompt change.

## On hold
- Multiplayer (keep it in mind).
