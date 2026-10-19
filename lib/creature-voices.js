// Voices for the creatures the Dungeon Master plays: a ChatGPT voice and acting notes for each kind of creature.
// Order of choice: a hand-written entry for the creature (HAND), else a default for its type and size (TYPE_VOICES), and the user's own edits (data/creature-voices.json) win over both.
// Named characters in a campaign's voices.json (Klarg, Yeemik...) are checked before any of this, so they keep their own voice.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'];

// By the SRD creature type. Beasts are told apart by size below.
export const TYPE_VOICES = {
  aberration: { voice: 'echo', acting: 'An alien, unsettling creature. Wet, whispering and wrong, with odd pauses and a faint echo to every word.' },
  beast: { voice: 'onyx', acting: 'An animal given speech. Growling, breathy and primal, blunt short words with snarls between phrases.' },
  celestial: { voice: 'sage', acting: 'A radiant, serene being. Calm, resonant and gentle, with solemn authority.' },
  construct: { voice: 'echo', acting: 'A flat, mechanical voice. Slow, even and hollow, almost no emotion, like a machine speaking.' },
  dragon: { voice: 'onyx', acting: 'An ancient dragon. Enormous, deep, slow and unhurried, rumbling with vast arrogance and contempt.' },
  elemental: { voice: 'ash', acting: 'A being of raw element. Rumbling and crackling, with a hiss or a roar behind the words, impatient.' },
  fey: { voice: 'shimmer', acting: 'A capricious fey creature. Light, musical and playful, teasing, with a hint of cruelty underneath.' },
  fiend: { voice: 'ash', acting: 'A cruel fiend. Silky, low and smug, savouring each threat, with a sudden hiss of rage.' },
  giant: { voice: 'onyx', acting: 'A hulking giant. Very deep, slow and loud, booming and blunt, not clever and not ashamed of it.' },
  humanoid: { voice: 'alloy', acting: 'A hard-bitten fighter. Gruff, wary and plain-spoken, a little mocking, ready for a brawl.' },
  monstrosity: { voice: 'ash', acting: 'A savage monster. Rough, rasping and snarling, hungry and cruel, with a wet growl between words.' },
  ooze: { voice: 'echo', acting: 'A mindless ooze. Wet, gurgling and slow, simple halting words that bubble.' },
  plant: { voice: 'sage', acting: 'A creature of root and leaf. Creaking, slow and whispery, like wind in dry branches.' },
  undead: { voice: 'ballad', acting: 'A voice from beyond the grave. Hollow, whispery and rasping, with a cold echo and a dry rattle.' },
  swarm: { voice: 'shimmer', acting: 'A skittering swarm. Many tiny voices chittering at once, high, rapid and overlapping.' }
};
const SMALL_BEAST = { voice: 'shimmer', acting: 'A small animal given speech. High, quick and squeaky, nervous and twitchy, short chirps and gasps.' };
const LARGE_BEAST = { voice: 'onyx', acting: 'A huge animal given speech. Very deep, slow and rumbling, heavy breath between words, a low growl.' };

// By SRD index: the creatures the Lost Mine of Phandelver uses, written with care.
export const HAND = {
  goblin: { voice: 'ash', acting: 'A small, wiry goblin. Raspy, high and fast, cackling and nervous, sneering at anyone bigger, eager to grab shiny things.' },
  hobgoblin: { voice: 'onyx', acting: 'A disciplined hobgoblin soldier. Hard, clipped and cold, a parade-ground bark, contemptuous of weakness.' },
  bugbear: { voice: 'onyx', acting: 'A brutish bugbear. Very deep and guttural, loud and bullying, speaking in broken short sentences.' },
  wolf: { voice: 'onyx', acting: 'A wolf given speech. Low, growling and breathy, savage short words, with a snarl at the end of each phrase.' },
  orc: { voice: 'onyx', acting: 'A snarling orc raider. Loud, gruff and savage, short brutal sentences, spitting the words.' },
  ogre: { voice: 'onyx', acting: 'A dim, hulking ogre. Slow, loud and simple, booming, as if each word takes effort.' },
  skeleton: { voice: 'echo', acting: 'A skeleton. Hollow and rattling, flat and dry, with a faint echo, as if from an empty chest.' },
  zombie: { voice: 'ballad', acting: 'A shambling zombie. Slow, wet and groaning, a few dragged words with long gaps.' },
  ghoul: { voice: 'ash', acting: 'A ghoul. Hungry, rasping and gloating, a wet cackle, savouring the word meat.' },
  specter: { voice: 'ballad', acting: 'A specter. Whispering and mournful, drifting in and out, cold and faint.' },
  'giant-spider': { voice: 'echo', acting: 'A giant spider. Clicking and hissing, thin and chilling, words dragged out like silk.' },
  bandit: { voice: 'alloy', acting: 'A cocky bandit. Rough, mocking and impatient, a street-thug swagger.' },
  'bandit-captain': { voice: 'alloy', acting: 'A bandit captain. Confident, rough and commanding, amused by threats, used to being obeyed.' },
  cultist: { voice: 'sage', acting: 'A fanatical cultist. Quiet, intense and devout, chanting rather than speaking, calm in the face of death.' },
  'dire-wolf': { voice: 'onyx', acting: 'A dire wolf given speech. Very deep, snarling and heavy, slow and menacing.' },
  stirge: { voice: 'shimmer', acting: 'A stirge. A thin, buzzing whine, high and hungry, short shrill words.' },
  'twig-blight': { voice: 'shimmer', acting: 'A twig blight. A dry, creaking whisper, tiny and spiteful, like snapping twigs.' },
  'redbrand-ruffian': { voice: 'ash', acting: 'A Redbrand thug. Rough, swaggering and sneering, a bully who enjoys being feared.' },
  'evil-mage': { voice: 'verse', acting: 'A cold, arrogant spellcaster. Silky and controlled, contemptuous, every sentence a small insult.' },
  'mormesk-the-wraith': { voice: 'ballad', acting: 'A wraith bound to a ruin. Hollow, whispering and aching, with a cold echo and long pauses.' },
  flameskull: { voice: 'ash', acting: 'A floating flameskull. Crackling and hissing, a mocking laugh with fire behind the words.' },
  nothic: { voice: 'echo', acting: 'A twisted one-eyed nothic. Whispering and gloating, a wet rasp, fascinated by secrets.' },
  spectator: { voice: 'sage', acting: 'A spectator, a floating many-eyed guardian. Slow, calm and dry, formal and watchful.' }
};

const sizeOf = (m) => String(m.size || 'Medium').toLowerCase();

// The voice a creature has without anyone's edits.
export function defaultVoice(m) {
  if (HAND[m.index]) return { ...HAND[m.index], source: 'chosen' };
  const type = String(m.type || '').toLowerCase();
  const t = type.startsWith('swarm') ? 'swarm' : type;
  if (t === 'beast') {
    const size = sizeOf(m);
    return { ...(size === 'tiny' || size === 'small' ? SMALL_BEAST : size === 'large' || size === 'huge' || size === 'gargantuan' ? LARGE_BEAST : TYPE_VOICES.beast), source: 'type' };
  }
  return { ...(TYPE_VOICES[t] || TYPE_VOICES.humanoid), source: 'type' };
}

const cleanVoice = (v) => (OPENAI_VOICES.includes(v) ? v : '');
const cleanActing = (a) => String(a ?? '').replace(/\s+/g, ' ').trim().slice(0, 400);

// The voice with the user's edits applied. overrides: { [index]: { voice, acting } }.
export function voiceFor(m, overrides) {
  const base = defaultVoice(m), o = overrides && typeof overrides === 'object' && Object.hasOwn(overrides, m.index) ? overrides[m.index] : null;
  if (!o) return base;
  return { voice: cleanVoice(o.voice) || base.voice, acting: cleanActing(o.acting) || base.acting, source: 'edited' };
}

// A speaker name as the DM writes it ("Goblin 2", "the Goblin", "Goblin #3") back to a creature. Exact names only, so "Goblin Boss" is not a goblin.
export function findCreature(speaker, lists) {
  const name = String(speaker ?? '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[#]/g, ' ').replace(/\s+\d+\s*$/, '').replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9' -]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name) return null;
  for (const list of lists) { const hit = (list || []).find((m) => String(m.name || '').toLowerCase() === name); if (hit) return hit; }
  return null;
}

export function createStore(dataDir) {
  const file = path.join(dataDir, 'creature-voices.json');
  return {
    async read() {
      try { const j = JSON.parse(await readFile(file, 'utf8')); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch { return {}; }
    },
    async set(index, voice, acting) {
      if (!/^[a-z0-9-]{1,80}$/.test(index)) throw new Error('Unknown creature');
      const all = await this.read();
      const entry = { voice: cleanVoice(voice), acting: cleanActing(acting) };
      if (!entry.voice && !entry.acting) delete all[index]; else all[index] = entry;
      await write(file, all);
      return all;
    },
    async reset(index) { const all = await this.read(); delete all[index]; await write(file, all); return all; }
  };
}
async function write(file, all) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(all, null, 2) + '\n');
  await rename(tmp, file);
}
