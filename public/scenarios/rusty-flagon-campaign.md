# The Rusty Flagon: a tavern brawl (test scenario)

This is a short, self-contained scenario for testing the virtual tabletop and the AI Dungeon Master. It is designed so that all three pillars of play can be tried in one evening: social interaction (talking, reading people, defusing a fight), exploration (searching, eavesdropping, finding a hidden message) and combat (a brawl with real stat blocks). Run it as a normal game, and keep it light.

## Secrets and hidden things

Some things on the board are hidden from the players on purpose: a hidden token has hidden: true, and a trap has kind "trap". Never mention, hint at or describe a hidden token, a hiding creature or an undiscovered trap until a character finds it with a check, triggers it, or it acts. Use revealToken when it becomes known, and hideToken if something slips back into hiding. Enemies the party cannot see (visibleToParty is false) are not described either.

## Running the test

- The party are four level 3 adventurers (see the character sheets in the table state) who have just walked in from the street. It is evening in the town of Brindlemere. No one expects trouble.
- Narrate in 1-3 short paragraphs. Use the NPC names below. Give every NPC line its own voice line.
- This is a rules test. When you apply a rule, name it briefly in parentheses so the players can check you, for example (opportunity attack), (grapple: Athletics contest), (half cover: +2 AC), (improvised weapon: 1d4). Show dice results, for example "Attack: d20+4 = 15 vs AC 11, hit".
- Respect the board. Each token has movementRemaining in feet and the grid is 5 ft squares. Refuse a move that is too far or blocked by walls, say why, and offer what is possible. Do not move player tokens yourself unless the player asked for it.
- Keep the board in step with the story. Use addToken, removeToken, moveToken and setHp. NPC hit points are tracked by you in the narration (the board does not store them): say each NPC's remaining HP when they are hurt.
- If a player attempts something odd (swing from the chandelier, flip a table, throw a stool), rule on it using 5e (an ability check, an attack with an improvised weapon, a Dexterity save) and say which rule you used. Say yes to creative ideas when the rules allow and give a fair DC when they do not.
- If a player asks for something the table cannot do (flying, teleporting, reading minds), say so plainly.

## The room (grid is 30 columns by 20 rows, origin top-left, one square = 5 ft)

- The common room fills columns 1-21, rows 1-18. The front door (double doors) is on the south wall at columns 14-15, row 19. It is closed but not locked.
- The bar counter runs along the north side: columns 4-15, row 3. Behind it is the back shelf (row 1-2) with bottles, and three barrels at columns 16-18, row 1-2. Bar stools are in row 5 (columns 5-15).
- Six round tables (each about 3 squares across) sit around the hall. Their centers are about (6,9), (11,9), (17,9), (7,14), (12,15) and (18,15). Chairs and stools surround each table.
- A fireplace is set into the west wall, columns 1-2, rows 8-11. It is lit. Hot coals: a creature shoved into the hearth makes a DC 12 Dexterity saving throw or takes 3 (1d4 + 1) fire damage.
- Three wooden ceiling posts stand at (8,6), (14,6) and (19,12). They fill their square, block line of sight, and give three-quarters cover.
- The kitchen is the stone-floored room at columns 23-28, rows 2-9. A doorway at column 22, row 5 is open. A back door at column 26, row 1 leads outside and is barred from inside.
- The back booth room is at columns 23-28, rows 11-18, behind a closed door at column 22, row 14.
- Tables and the bar counter give half cover (+2 AC and Dexterity saves) to a creature behind them. Crowded squares: a creature can move through an ally's square but cannot end its move in an occupied square, and cannot move through an enemy's square.
- Light: the room is warmly lit by the fire and four lanterns (bright light everywhere in the common room). The booth room is dim.

## People in the room

Marta Ironbrew, barkeep (position (9,2), behind the counter). A broad, sharp-eyed halfling widow in her fifties who owns the Flagon. Practical, funny, and fiercely protective of her furniture. She keeps a club under the bar. She wants the night to stay quiet, will happily serve the party, and knows the town's gossip: a stranger has been renting the back booth for three nights and pays in silver. Commoner (AC 10, 4 HP, club +2 to hit, 2 (1d4) bludgeoning). She will fetch the Watch if blood is drawn and the fight does not stop.

Bruno "the Wall", bouncer (position (13,17), near the front door). A huge, calm man who hates paperwork and loves quiet. He tries to end brawls by shouting, then by grabbing and shoving people toward the door. He is not cruel and will not use lethal force on patrons, but he will defend Marta. Stat block: Thug.

Gruk Tannerson, mercenary (position (13,10), at the second table). A scarred sellsword in a patched leather coat who is loud, proud and three drinks in. He wants to be told he is the toughest person in the room, and he is looking for a reason to prove it. He has a short temper about insults, about being ignored, and about anyone touching his coin. Stat block: Thug. He fights with a mace he calls "Peacemaker".

Dagger Dan and Skinny Jo, Gruk's crew (positions (10,9) and (11,11), at the same table). Two grinning hangers-on who will follow Gruk into any fight, and run if he falls. Stat block: Bandit for each. Dan uses a scimitar and a light crossbow, Jo uses a scimitar.

Odo Pennywhistle and Pell Brightwater, regulars (positions (5,9) and (7,10), at the first table). Cheerful, slightly drunk townsfolk who love gossip and cannot resist a scrap. They join a brawl for the fun of it, throw mugs and stools, and are easily knocked out. Stat block: Commoner each. They know that Gruk has been bragging about "a job for the Black Lantern."

Nim, the stranger in the booth (position (26,12), in the back booth room). A thin, nervous man in a gray cloak who has been waiting three nights for a contact who has not come. He is a spy for the town's thieves' guild and carries a coded note. He avoids attention, will flee out the back door if a fight reaches his door, and will talk (for a price or a favor) if the party treats him well. Stat block: Spy. His note is hidden in his boot. It reads: "Black Lantern moves on the new moon. Warehouse nine. Bring the key, not the coin."

## The three pillars: what to offer

### Social interaction

- Marta can be charmed (Persuasion DC 10) into giving the party a free round and the gossip about Nim.
- Gruk can be calmed. Flattery (Persuasion DC 13), a clever deflection (Deception DC 14), or a show of strength without violence (Intimidation DC 15) all work. A direct insult reignites him. Reading his mood is Insight DC 10 ("he is looking for a fight, not a reason").
- Bruno will back the party if they are polite to Marta. A Persuasion DC 12 gets him to escort troublemakers out instead of fighting.
- Eavesdropping on the second table needs Perception DC 12 and reveals the Black Lantern boast.
- A failed social check should cost something: the room gets louder, Gruk stands up, Marta glares.

### Exploration

- Searching the back booth (Investigation DC 12) finds scratch marks on the table: a lantern symbol. A DC 15 Investigation, or a DC 12 Perception while Nim is not looking, finds a loose floorboard under the bench.
- Nim's note can be taken by Sleight of Hand against his passive Perception 12, or taken from his unconscious body.
- The kitchen has a pantry with barrels of ale and one of lamp oil. A thrown torch or a spark from the stove could ignite oil that spills: fire spreads to adjacent squares, 2 (1d4) fire damage per turn to creatures in it (DC 11 Dexterity save for half). Ask for creativity, and use it as a hazard test.
- A hidden tripwire alarm stretches across the kitchen doorway at column 22, row 5, tied to a string of tin bells in the pantry (the board has a hidden trap token for it, marked kind "trap"). Nobody mentions it. A creature within 10 ft of it who actively looks can notice it with Perception DC 13 (passive Perception does not catch it). It can be disarmed with a Dexterity check using thieves' tools (DC 12) or by simply stepping over it with a Dexterity (Acrobatics) check, DC 10. If a creature walks through it without noticing, the bells jangle: everyone in the kitchen and the booth room hears, and Nim startles and heads for the back door. When it is found or triggered, call revealToken for it and then describe it.
- The back door is barred (a DC 10 Strength check, or lifting the bar takes an action).
- The front door can be barred from inside as an action by a creature next to it.

### Combat (the brawl)

The brawl starts if any of these happens, or when the table wants it: someone insults Gruk, someone touches his coin or his mace, the party sides openly against his crew, the party refuses to leave the best table, a drink is spilled on him, or three rounds of arguing pass without the party doing anything to calm things down.

When it starts: roll initiative for every creature (d20 + Dexterity modifier; Gruk +0, Dan +1, Jo +1, Bruno +0, Odo +0, Pell +0). If someone was caught unaware, grant surprise. Track turn order openly.

Escalation:
1. Round 1-2: Gruk's crew attacks whoever started it. Odo and Pell throw mugs and stools (improvised weapon, 1d4 bludgeoning, range 20/60 if thrown) at whoever they like least. Marta shouts for order.
2. Round 3: Bruno wades in to grab people. He prefers grapples and shoves (Athletics) to damage, and drags troublemakers toward the front door.
3. Round 4: if people are still bleeding, Marta sends a patron for the Watch. At the end of round 6 the Watch arrives (two guards plus Captain Hale). Everyone still fighting is arrested.
4. Gruk's crew flees if Gruk falls or if two of them are down.

Brawl conventions:
- Fighting to knock out: when a melee attack reduces a creature to 0 hit points, the attacker may choose to knock it out instead of killing it. Commoners and Bandits in this room are knocked out, not killed, unless the party clearly means to kill. Killing in front of the room turns Marta and Bruno against the party.
- Unarmed strike: +to hit as normal, 1 + Strength modifier bludgeoning damage.
- Improvised weapon (stool, mug, bottle, plate): 1d4 damage of an appropriate type, proficiency only if it resembles a weapon. A bottle or stool breaks after one hit.
- Grapple: Athletics contest against Athletics or Acrobatics (target's choice). A grappled creature has speed 0. Shove: Athletics contest, the target is knocked prone or pushed 5 feet. A target shoved into the hearth makes the Dexterity save described above.
- Opportunity attacks: leaving an enemy's reach without Disengage provokes one (using the enemy's reaction).
- Prone: melee attacks against it have advantage, ranged attacks have disadvantage, standing up costs half of the creature's movement.
- Cover: half cover (+2) behind a table or the bar, three-quarters cover (+5) behind a ceiling post.
- Dash, Disengage, Dodge and Help are all available. The Ready action works for a triggered response.
- Dropping to 0 hit points: a player character falls unconscious and begins death saving throws. Use setHp to show current HP on the board.

### Stat blocks (5e SRD)

Commoner: Medium humanoid. AC 10. HP 4 (1d8). Speed 30 ft. STR 10 DEX 10 CON 10 INT 10 WIS 10 CHA 10. Club: +2 to hit, reach 5 ft., 2 (1d4) bludgeoning.

Bandit: Medium humanoid. AC 12 (leather armor). HP 11 (2d8 + 2). Speed 30 ft. STR 11 DEX 12 CON 12 INT 10 WIS 10 CHA 10. Scimitar: +3 to hit, reach 5 ft., 4 (1d6 + 1) slashing. Light crossbow: +3 to hit, range 80/320 ft., 5 (1d8 + 1) piercing.

Thug: Medium humanoid. AC 11 (leather armor). HP 32 (5d8 + 10). Speed 30 ft. STR 15 DEX 11 CON 14 INT 10 WIS 10 CHA 11. Skills: Intimidation +2. Pack Tactics: advantage on an attack roll against a creature if at least one of the thug's allies is within 5 ft. of the target and not incapacitated. Multiattack: two melee attacks. Mace: +4 to hit, reach 5 ft., 5 (1d6 + 2) bludgeoning. Heavy crossbow: +2 to hit, range 100/400 ft., 5 (1d10) piercing.

Spy: Medium humanoid. AC 12. HP 27 (6d8). Speed 30 ft. STR 10 DEX 15 CON 10 INT 12 WIS 14 CHA 16. Skills: Deception +5, Insight +4, Investigation +5, Perception +6, Persuasion +5, Sleight of Hand +4, Stealth +4. Cunning Action: on each of its turns, Dash, Disengage or Hide as a bonus action. Sneak Attack (1/turn): extra 7 (2d6) damage with advantage or an ally adjacent to the target. Multiattack: two melee attacks. Shortsword: +4 to hit, reach 5 ft., 5 (1d6 + 2) piercing. Hand crossbow: +4 to hit, range 30/120 ft., 5 (1d6 + 2) piercing.

## Ending the scenario

The test is over when the brawl is resolved (defused, won, or interrupted by the Watch) and the party has had the chance to deal with Nim and his note. Give a short wrap-up: what the town thinks of them, what Marta says, and what the Black Lantern note might lead to. Offer a one-line summary of the rules that came up, so the table can check how they were handled.
