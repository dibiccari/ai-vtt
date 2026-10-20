// The Map Maker's two AI helpers: designLayout() turns a description into a battle map grid (lib/map-layout.js checks it, and the model gets one chance to fix what is wrong),
// and surpriseMap() invents a map description for a kind of map. Both take the Anthropic client as an argument, so a test can point them at a pretend API.
import { compileLayout, LEGEND, LIMITS, sizeFor } from './map-layout.js';

export const DEFAULT_COLS = 30, DEFAULT_ROWS = 20;

const EXAMPLE = [
  '##########################',
  '#PP..#.....#.......#~~~..#',
  '#PP..D.....D...O...D~~~,.#',
  '#....#..L..#.......#,,...#',
  '######.....#########.....#',
  '#.....#####......#...L...#',
  '#.O...D...........D.....E#',
  '#.....#...O...O...#....EE#',
  '##########################'
];

const system = (cols, rows) => `You design battle maps for a Dungeons & Dragons 5th Edition virtual tabletop. You draw the map as a text grid, one character per 5-foot square, exactly ${cols} characters wide and ${rows} rows tall.

Legend:
${LEGEND.map(([g, text]) => `  ${g}  ${text}`).join('\n')}

Rules:
- Every row has exactly ${cols} characters. Use only the characters in the legend. The edge of the grid is a wall, so keep the outermost squares # unless the place really is open to the edge.
- Everything walkable must be connected to the party's start by floor, shallow water, rubble or doors. A room only reachable through a wall is a mistake. Put a D wherever a door should be: it must be a single square with # on both sides of the way through (never in open floor).
- Use # for straight walls (buildings, ruins, dungeon rooms) and % for natural rock whose edge is drawn as a smooth curve: cave walls, cliffs, mountain sides, canyon walls, riverbanks, the edge of a thick forest. Natural edges look best when they are irregular and bulging like real stone, not straight lines: make caves and mountain passes wind, narrow and widen, with alcoves and outcrops. A map can mix both (a stone gatehouse in a mountain pass). Keep the outermost squares # or %.
- Put P (three to five squares together) where the party arrives and E (two to five squares) where the enemies wait, in different places, with something between them worth fighting over.
- Make the place feel like what was asked for: rooms and corridors for a building or dungeon, winding irregular passages and chambers ringed by % for a cave, a wide open floor ringed by % (trees, cliffs, deep water, mountains) for the outdoors, a long thin floor for a ship. Rooms and clearings should be at least 4 by 4 squares so a fight fits.
- Give the fight some terrain: a few O (pillars, boulders, trees, crates) for cover, some ~ or , for difficult ground, L where there are torches, braziers or fires. Use them with taste, not everywhere.
- Floor should be roughly 40 to 65 percent of the grid.

Reply with JSON only: { "name": a short name for the map, "summary": one sentence saying what you drew and where things are, "setting": "indoor" for a dungeon, building, cave or ship interior, "outdoor" for open ground such as a forest, beach, road or camp, "rows": [the ${rows} strings] }.

A small example of the style (26 by 9, yours will be bigger):
${EXAMPLE.join('\n')}`;

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['name', 'summary', 'setting', 'rows'],
  properties: { name: { type: 'string' }, summary: { type: 'string' }, setting: { type: 'string', enum: ['indoor', 'outdoor'] }, rows: { type: 'array', items: { type: 'string' } } }
};

// These models think before they write, and the thinking counts against max_tokens: a first try with 6,000 was all used up thinking and no grid was written (Oct 2026, live). The grid itself is
// about 1.2 tokens a square; the rest is room to think. The SDK refuses a non-streamed request above about 21,000.
export const tokenRoom = (w, h) => Math.min(21000, 12000 + Math.round(w * h * 1.2));
const textOf = (response) => (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
const parseJson = (text) => { try { return JSON.parse(text); } catch { const m = /\{[\s\S]*\}/.exec(text); if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } } return null; } };

// description: what the person wants. Returns { layout (as compileLayout gives it), name, summary, attempts, usage: [the usage of each call] }; layout.ok says whether it is playable.
export async function designLayout({ client, model, description, size, orientation, cols = DEFAULT_COLS, rows = DEFAULT_ROWS, record = () => {} }) {
  if (size) { const s = sizeFor(size, orientation); cols = s.cols; rows = s.rows; }
  const w = Math.min(LIMITS.maxCols, Math.max(LIMITS.minCols, Math.round(cols))), h = Math.min(LIMITS.maxRows, Math.max(LIMITS.minRows, Math.round(rows)));
  return converse({ client, model, w, h, record, messages: [{ role: 'user', content: `Design this battle map: ${String(description || '').trim().slice(0, 2500) || 'a small dungeon with a few rooms'}` }] });
}

// Changes a layout the person has already seen, from a sentence ("make the east room bigger", "add a second door to the vault"). The grid keeps its size. Same answer as designLayout.
export async function reviseLayout({ client, model, grid, instruction, description, record = () => {} }) {
  const rows = (Array.isArray(grid) ? grid : String(grid || '').split(/\r?\n/)).map((r) => String(r).replace(/\s+$/, '')).filter(Boolean);
  const w = Math.max(...rows.map((r) => r.length), 0), h = rows.length;
  if (w < LIMITS.minCols || h < LIMITS.minRows) { const error = new Error('There is no layout to change yet.'); error.code = 'designer'; throw error; }
  const change = String(instruction || '').trim().slice(0, 800);
  if (!change) { const error = new Error('Say what to change first.'); error.code = 'designer'; throw error; }
  const context = String(description || '').trim().slice(0, 2500);
  return converse({ client, model, w, h, record, messages: [{ role: 'user', content: `Here is the battle map as it is now${context ? ` (it was described as: ${context})` : ''}, ${w} characters wide and ${h} rows tall:\n${rows.map((r) => r.padEnd(w, '#')).join('\n')}\n\nChange it like this: ${change}\n\nKeep everything I did not mention exactly as it is, and keep the same size. Return the whole map.` }] });
}

async function converse({ client, model, w, h, record, messages }) {
  const usage = [];
  let best = null, reply = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const response = await client.beta.messages.create({ model, max_tokens: tokenRoom(w, h), system: system(w, h), messages, output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } } });
    usage.push(response.usage || {}); record(response.model || model, response.usage);
    if (response.stop_reason === 'max_tokens' && !textOf(response)) { const error = new Error('The map designer ran out of room while thinking and wrote no grid. Try again, or choose a smaller size.'); error.code = 'designer'; throw error; }
    reply = parseJson(textOf(response));
    if (!reply || !Array.isArray(reply.rows)) { messages.push({ role: 'assistant', content: textOf(response) || '(no answer)' }, { role: 'user', content: 'That was not the JSON I asked for. Reply with { "name", "summary", "rows" } only.' }); best = best || null; continue; }
    const layout = compileLayout(reply.rows);
    best = { layout, name: String(reply.name || '').slice(0, 80), setting: reply.setting === 'outdoor' ? 'outdoor' : 'indoor', summary: String(reply.summary || '').slice(0, 400), attempts: attempt, usage };
    const errors = layout.problems.filter((p) => p.level === 'error');
    if (!errors.length) break;
    messages.push({ role: 'assistant', content: JSON.stringify(reply) }, { role: 'user', content: `The grid has problems:\n${errors.map((p) => '- ' + p.text).join('\n')}\nReturn the whole corrected JSON.` });
  }
  if (!best) { const error = new Error('The map designer did not return a grid I could read.'); error.code = 'designer'; throw error; }
  best.usage = usage;
  return best;
}

// A few themes per kind, picked at random and handed to the model so that two clicks do not give the same idea.
const SEEDS = {
  battle: ['vampire castle undercroft', 'shipwreck on a beach', 'collapsed mine shaft', 'flooded temple', 'goblin warren', 'ruined watchtower', 'frozen lake crossing', 'bandit camp in a forest clearing', 'crypt with a sealed vault', 'wizard\'s laboratory', 'swamp island shrine', 'burning mill', 'canyon ambush', 'sewer junction', 'dragon\'s hoard cave', 'haunted chapel', 'mountain pass bridge', 'smugglers\' cove', 'arena pit', 'giant\'s kitchen'],
  town: ['a river port', 'a mining village', 'a walled market town', 'a fishing hamlet on stilts', 'a crossroads inn town', 'a hillside monastery village', 'a ruined town rebuilt', 'a lakeside festival town', 'a frontier fort town', 'a caravan stop in the desert'],
  regional: ['a river delta with marsh', 'a mountain range with a hidden valley', 'a coast of cliffs and islands', 'a haunted forest with one road', 'a desert crossed by an old canal', 'a volcanic island chain', 'a frozen northern shore', 'rolling hills with ruined forts', 'a great lake with a drowned city', 'a badland of canyons']
};
const KIND_HELP = {
  battle: 'a place for one combat encounter. Say what it is, what it looks like, and two or three features that matter in a fight (cover, water, doors, hazards, height) and the mood.',
  town: 'a small settlement seen from above. Say how it is laid out, the buildings or places that matter and what is around it.',
  regional: 'an overland region seen from above. Say the geography, the main settlements or landmarks, the roads or rivers and the mood.'
};

export async function surpriseMap({ client, model, kind, record = () => {} }) {
  const k = SEEDS[kind] ? kind : 'battle';
  const seed = SEEDS[k][Math.floor(Math.random() * SEEDS[k].length)];
  const response = await client.beta.messages.create({
    model, max_tokens: 4000, output_config: { effort: 'low' },
    system: `You invent map ideas for a Dungeons & Dragons game. Describe ${KIND_HELP[k]} Two or three sentences, concrete and evocative, no title, no list. Do not mention grids, squares or game rules.`,
    messages: [{ role: 'user', content: `Give me one ${k} map idea. Take this as a starting point but make it your own: ${seed}.` }]
  });
  record(response.model || model, response.usage);
  if (!textOf(response).trim()) { const error = new Error('The idea helper wrote nothing. Try again.'); error.code = 'designer'; throw error; }
  return { description: textOf(response).trim().replace(/^["']|["']$/g, ''), seed };
}
