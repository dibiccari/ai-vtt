// party API: routes registered by server.js. What it needs from server.js comes through `deps` (read when a route runs); what server.js needs from it is returned.
import { seedFromSheet, normalizeInventory, normalizeCoins, computeEffective, readStash, MAX_ATTUNED, syncSheet, itemFromSrd, processPartyUpdates, writeStash, restCharacter } from '../lib/party.js';
import { trackView, describeClock, readClock, restOnClock, normalizeTrack, writeClock, splitXp } from '../lib/rules-track.js';
import { readSettings } from '../lib/settings.js';
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { getEntry } from '../lib/compendium.js';
import { shopCatalog, payCoins, tidyCoins, sheetEditsForGear, armorClass, srdFor, costInCp, coinText, totalCp } from '../lib/loadout.js';
import { applyUpdate, processCharacterUpdates } from '../lib/sheet-edit.js';
import { MERCHANT_MODEL_DEFAULT, merchantKey, merchantSystem, merchantMessages, merchantSchema, cleanMerchantReply, remember } from '../lib/merchant.js';
import { diceTray } from '../lib/dice.js';
import Anthropic from '@anthropic-ai/sdk';
import { BOOKKEEPER_MODEL_DEFAULT, BOOKKEEPER_SYSTEM, bookkeeperMessage, bookkeeperSchema, cleanBookkeeperReply } from '../lib/bookkeeper.js';
import { journalForPrompt, readSave, addJournalUpdates } from '../lib/journal.js';
import { processTrackUpdates } from '../lib/rules-apply.js';
import { levelUpOptions, applyLevelUp } from '../lib/levelup.js';
import { quickChoices, buildQuickCharacter } from '../lib/quick-character.js';
import { newCharacterId } from '../lib/character-ids.js';

export function registerParty(app, deps) {
  let rulesVersion = '2014';
  const partyView = (c, variant = false) => {
    const seeded = seedFromSheet(c);
    return { id: seeded.id, name: seeded.name, class: seeded.class, level: seeded.level, hp: seeded.hp, maxHp: seeded.maxHp, color: seeded.color, image: seeded.image, abilities: seeded.abilities, darkvision: seeded.darkvision || 0, ac: seeded.ac, speed: seeded.speed, inventory: normalizeInventory(seeded.inventory), coins: normalizeCoins(seeded.coins), effective: computeEffective(seeded, variant, rulesVersion), rules: trackView(c, rulesVersion) };
  };

  app.get('/api/party', deps.asyncRoute(async (_req, res) => {
    const campaign = await deps.getActiveCampaignId();
    const settings = await readSettings(path.join(deps.CAMPAIGNS_DIR, campaign));
    const variant = settings.variantEncumbrance;
    rulesVersion = settings.rules === '2024' ? '2024' : '2014';
    const characters = (await deps.listCharacters(campaign)).map((c) => partyView(c, variant));
    res.json({ campaign, clock: describeClock(await readClock(path.join(deps.CAMPAIGNS_DIR, campaign))), rules: rulesVersion, characters, stash: await readStash(path.join(deps.CAMPAIGNS_DIR, campaign)), maxAttuned: MAX_ATTUNED });
  }));

  // Replace one character's gear (the party page saves the whole list). Extra attunements beyond three are dropped and reported.
  app.put('/api/party/characters/:id', deps.asyncRoute(async (req, res) => {
    const id = deps.canonId(deps.safeId(req.params.id));
    let old;
    try { old = JSON.parse(await readFile(path.join(deps.CHAR_DIR, `${id}.json`), 'utf8')); } catch { return res.status(404).json({ error: 'Character not found' }); }
    const problems = [];
    const next = { ...old, inventory: normalizeInventory(req.body?.inventory, problems), coins: normalizeCoins(req.body?.coins), ...(req.body?.darkvision !== undefined ? { darkvision: deps.int(req.body.darkvision, 0, 0, 120) } : {}) };
    const saved = deps.normalizeCharacter(syncSheet(next));
    await deps.saveCharacter(saved);
    res.json({ character: partyView(saved, (await readSettings(path.join(deps.CAMPAIGNS_DIR, await deps.getActiveCampaignId()))).variantEncumbrance), problems });
  }));

  // A party item built from an SRD magic item or piece of equipment (with its weight, attunement and, for the common ones, effects).
  app.get('/api/party/srd-item', deps.asyncRoute(async (req, res) => {
    const kind = req.query.kind === 'equipment' ? 'equipment' : 'magic-items';
    const entry = await getEntry(kind, String(req.query.index ?? '').toLowerCase().replace(/[^a-z0-9-]/g, ''));
    const item = itemFromSrd(kind === 'equipment' ? 'equipment' : 'magic', entry);
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json({ item });
  }));

  // The gear wizard (public/js/inventory-wizard.js): the shop list, paying in coins, and a preview or commit of a whole new inventory and purse.
  // The commit also brings the sheet in step (armor class, attack lines, Equipment and coin boxes) through the sheet editor, so it is logged and can be undone.
  let shopCache = null;
  app.get('/api/party/shop', deps.asyncRoute(async (_req, res) => {
    if (!shopCache) shopCache = shopCatalog(JSON.parse(await readFile(path.join(deps.__dirname, 'data', 'srd', 'magic-items.json'), 'utf8')));
    res.json({ items: shopCache });
  }));
  app.post('/api/party/pay', (req, res) => {
    const out = payCoins(normalizeCoins(req.body?.coins), Math.round(Number(req.body?.cost)));
    res.status(out.ok ? 200 : 400).json(out.ok ? out : { error: out.error });
  });
  app.post('/api/party/tidy', (req, res) => res.json({ coins: tidyCoins(normalizeCoins(req.body?.coins)) }));
  // The new state of a character after a change of inventory and purse: the sheet follows (armor class, attack lines, Equipment, coin boxes) through the sheet editor, so it is logged.
  function gearOutcome(old, inventory, coinsIn, reason, variant, rules) {
    const before = seedFromSheet(old);
    const problems = [];
    const next = { ...before, inventory: normalizeInventory(inventory, problems), coins: normalizeCoins(coinsIn) };
    const synced = syncSheet(next);
    const plan = sheetEditsForGear(before, synced);
    const sheetEdits = [...plan.edits, ...['Equipment', 'CP', 'SP', 'EP', 'GP', 'PP'].map((f) => ({ field: f, value: String(synced.sheet[f] ?? '') }))];
    const out = applyUpdate(old, { reason: String(reason || 'Gear change').slice(0, 200), edits: sheetEdits });
    const character = { ...out.character, inventory: next.inventory, coins: next.coins };
    return { old, character, problems, plan, notes: out.notes, effective: computeEffective(seedFromSheet(character), variant, rules), armor: armorClass(synced) };
  }
  async function planGear(id, body) {
    const campaign = await deps.getActiveCampaignId();
    const old = (await deps.listCharacters(campaign)).find((x) => x.id === deps.canonId(id));
    if (!old) return null;
    const settings = await readSettings(path.join(deps.CAMPAIGNS_DIR, campaign));
    return gearOutcome(old, body?.inventory, body?.coins, body?.reason, Boolean(settings.variantEncumbrance), settings.rules === '2024' ? '2024' : '2014');
  }
  // The DM sells things to the party: gear action buy (target = character, name = an SRD item, qty, cp = the whole price in copper when it is not the SRD price). The table prices it, pays in coin
  // with change, adds the item and brings the sheet in step (armor class, attack lines). A purchase the buyer cannot afford is refused and the DM is told.
  // A party member from whatever the DM calls them: id, name, first name, or the token id of their token (pc-thorin, tok-9ccde74f).
  function findPartyMember(list, ref) {
    const key = String(ref ?? '').trim().toLowerCase();
    const bare = key.replace(/^(pc|tok)-/, '');
    return list.find((c) => c.id === deps.canonId(ref)) || list.find((c) => c.name.toLowerCase() === key) || list.find((c) => c.name.toLowerCase().split(/\s+/)[0] === bare) || list.find((c) => bare.length >= 4 && c.id.startsWith(bare)) || null;
  }
  let magicByName = null;
  async function dmBuys(updates, campaign) {
    const notes = [], problems = [], changed = [];
    const buys = updates.filter((u) => u && u.type === 'gear' && u.action === 'buy');
    if (!buys.length) return { notes, problems, changed };
    if (!magicByName) magicByName = JSON.parse(await readFile(path.join(deps.__dirname, 'data', 'srd', 'magic-items.json'), 'utf8'));
    const settings = await readSettings(path.join(deps.CAMPAIGNS_DIR, campaign));
    for (const u of buys) {
      const list = await deps.listCharacters(campaign);
    const who = findPartyMember(list, u.target);
      if (!who) { problems.push(`A purchase named a buyer who is not in the party ("${u.target}").`); continue; }
      const qty = Math.max(1, Math.round(Number(u.qty)) || 1);
      const entry = srdFor({ name: u.name });
      const total = Number(u.cp) > 0 ? Math.round(Number(u.cp)) : entry ? costInCp(entry.cost) * qty : 0;
    if (!total) { problems.push(`${who.name} cannot buy "${u.name}": the table has no price for it. Send the whole price in copper as cp.`); continue; }
    const seeded = seedFromSheet(who);
    const paid = payCoins(seeded.coins, total);
      if (!paid.ok) { problems.push(`${who.name} cannot buy ${qty} × ${u.name}: ${paid.error}`); continue; }
      const magic = !entry ? magicByName.find((m) => m.name.toLowerCase() === String(u.name).trim().toLowerCase()) : null;
      const base = entry ? itemFromSrd('equipment', entry) : magic ? itemFromSrd('magic-items', magic) : normalizeInventory([{ name: u.name, qty, weight: Number(u.weight) || 0 }])[0];
      if (!base) { problems.push(`${who.name} cannot buy "${u.name}".`); continue; }
      base.qty = qty;
      const worn = (e) => e && e.equipment_category.index === 'armor' && seeded.inventory.some((i) => i.equipped !== false && srdFor(i) && srdFor(i).equipment_category.index === 'armor' && (srdFor(i).armor_category === 'Shield') === (e.armor_category === 'Shield'));
      if (worn(entry)) base.equipped = false;                                      // already wearing armor (or a shield): the new one goes in the pack
      const inventory = seeded.inventory.map((i) => ({ ...i }));
      const have = inventory.find((i) => i.name.toLowerCase() === base.name.toLowerCase() && (i.srd || '') === (base.srd || ''));
    if (have) have.qty += qty; else inventory.push(base);
      const out = gearOutcome(who, inventory, paid.coins, `Bought ${qty} × ${base.name}`, Boolean(settings.variantEncumbrance), settings.rules === '2024' ? '2024' : '2014');
    await deps.saveCharacter(deps.normalizeCharacter(out.character));
    changed.push(who.id);
    notes.push(`${who.name} bought ${qty} × ${base.name} for ${coinText(total)} (purse now ${coinText(totalCp(paid.coins))})${out.plan.notes.length ? '. ' + out.plan.notes.join('; ') : ''}${base.equipped === false && worn(entry) ? '. It is in the pack, not worn' : ''}`);
      for (const w of out.plan.warnings) notes.push(w);
    }
    return { notes, problems, changed };
  }
  const gearView = (p) => ({ problems: p.problems, notes: p.plan.notes, warnings: p.plan.warnings, armor: p.armor, effective: p.effective, coins: p.character.coins, ac: p.effective.ac });
  // Give an item (or a stack) to another character or the party stash: POST {from, to ('stash' or a character), name, qty}. The sheets of both are brought in step (armor class, attack lines, Equipment).
  app.post('/api/party/give', deps.localOnly, deps.asyncRoute(async (req, res) => {
    const b = req.body ?? {};
    const campaign = await deps.getActiveCampaignId();
    const dir = path.join(deps.CAMPAIGNS_DIR, campaign);
    const party = await deps.listCharacters(campaign);
    const ref = (v) => (String(v) === 'stash' ? 'stash' : (findPartyMember(party, v) || {}).id || '');
    const from = ref(b.from), to = ref(b.to);
    if (!from || !to || from === to) return res.status(400).json({ error: 'Pick someone else to give it to.' });
    const out = await processPartyUpdates([{ type: 'moveItem', from, to, name: String(b.name ?? ''), qty: Number(b.qty) || 1 }], {
      list: () => deps.listCharacters(campaign),
      save: async (c) => { const clean = deps.normalizeCharacter(c); await deps.saveCharacter(clean); return clean; },
      stash: () => readStash(dir),
      saveStash: (st) => writeStash(dir, st)
    });
    if (out.problems.length && !out.notes.length) return res.status(400).json({ error: out.problems.join(' ') });
    const settings = await readSettings(dir);
    for (const id of out.changed) {
      if (id === 'stash') continue;
      const now = (await deps.listCharacters(campaign)).find((x) => x.id === id), was = party.find((x) => x.id === id); if (!now || !was) continue;
      await deps.saveCharacter(deps.normalizeCharacter(gearOutcome(was, now.inventory, now.coins, 'Gear moved', Boolean(settings.variantEncumbrance), settings.rules === '2024' ? '2024' : '2014').character));       // the sheet as it was against the new inventory, so the armor class and attack lines change
    }
    res.json({ notes: out.notes, problems: out.problems, changed: out.changed });
  }));

  app.post('/api/party/gear/:id/preview', deps.asyncRoute(async (req, res) => {
    const p = await planGear(req.params.id, req.body);
    if (!p) return res.status(404).json({ error: 'No such character' });
    res.json(gearView(p));
  }));
  app.post('/api/party/gear/:id/commit', deps.localOnly, deps.asyncRoute(async (req, res) => {
    const p = await planGear(req.params.id, req.body);
    if (!p) return res.status(404).json({ error: 'No such character' });
    const saved = deps.normalizeCharacter(p.character);
    await deps.saveCharacter(saved);
    res.json({ ...gearView(p), character: partyView(saved) });
  }));

  // The Merchant agent (lib/merchant.js): one small call per thing the player says to a shopkeeper whose shop the DM opened. Cheaper model, tiny schema, no campaign text.
  app.post('/api/merchant', deps.asyncRoute(async (req, res) => {
    if (!deps.anthropic) return res.status(503).json({ error: 'The merchant is offline: no ANTHROPIC_API_KEY is configured.' });
    const b = req.body || {};
    const campaign = await deps.getActiveCampaignId();
    const who = (await deps.listCharacters(campaign)).find((c) => c.id === deps.canonId(b.buyerId));
    if (!who) return res.status(404).json({ error: 'No such character' });
    const shop = { merchant: String(b.merchant || 'A merchant').slice(0, 60), groups: (Array.isArray(b.groups) ? b.groups : []).map((g) => String(g).slice(0, 40)).slice(0, 8), markup: Math.min(300, Math.max(25, Math.round(Number(b.markup)) || 100)), base: Math.min(300, Math.max(25, Math.round(Number(b.base ?? b.markup)) || 100)) };
    const bonus = (f) => Number(String(who.sheet?.[f] ?? '0').replace('+', '')) || 0;
    const meta = await deps.readCampaignMeta(campaign).catch(() => ({}));
    const model = process.env.MERCHANT_MODEL || MERCHANT_MODEL_DEFAULT;
    const tray = diceTray().d20.slice(0, 4);
    const memFile = path.join(deps.CAMPAIGNS_DIR, campaign, 'merchants.json'), memKey = merchantKey(shop.merchant);
    let memories = {}; try { memories = JSON.parse(await readFile(memFile, 'utf8')); } catch { /* nobody remembered yet */ }
    if (!memories || typeof memories !== 'object' || Array.isArray(memories)) memories = {};       // a file that holds null, a list or a number is not a memory
    const memory = memories[memKey] || null;
    const system = merchantSystem({ shop, buyer: { name: who.name, persuasion: bonus('Persuasion'), insight: bonus('Insight') }, place: String(b.place || '').slice(0, 80), campaign: meta.name || campaign, tray, memory });
    try {
      const response = await deps.anthropic.beta.messages.create({ model, max_tokens: 600, system, messages: merchantMessages(b.history, b.message, b.opening === true), output_config: { format: { type: 'json_schema', schema: merchantSchema(deps.VOICES) } } });
      deps.usageTracker.record(response.model || model, response.usage, campaign, 'merchant');
      const block = response.content.find((x) => x.type === 'text');
      let raw; try { raw = JSON.parse(block?.text ?? ''); } catch { throw new Error('The merchant answered in a way the table could not read.'); }
      const reply = cleanMerchantReply(raw, shop, deps.VOICES);
      memories[memKey] = remember(memory, { opening: b.opening === true, summary: reply.summary, markup: reply.markup || undefined, buyer: who.name });
    await deps.writeJsonAtomic(memFile, memories).catch(() => {});             // a shopkeeper that cannot be remembered is still a shopkeeper
      res.json(reply);
    } catch (err) {
      if (err instanceof Anthropic.APIError) return res.status(502).json({ error: `The merchant could not answer: ${err.message}` });
      throw err;
    }
  }));

  // The bookkeeper runs after a reply has been sent: it reads the turn and the journal and writes what is worth keeping (cheap model, tiny schema, nothing for the player to wait for).
  async function keepJournal(campaign, { message, narrative, rolls }) {
    if (!deps.anthropic) return [];
    const dir = path.join(deps.CAMPAIGNS_DIR, campaign);
    const model = process.env.BOOKKEEPER_MODEL || BOOKKEEPER_MODEL_DEFAULT;
    const journal = journalForPrompt((await readSave(dir)).entries);
    const when = describeClock(await readClock(dir)).text;
    const response = await deps.anthropic.beta.messages.create({ model, max_tokens: 800, system: BOOKKEEPER_SYSTEM, messages: [{ role: 'user', content: bookkeeperMessage({ message, narrative, rolls, journal, when }) }], output_config: { format: { type: 'json_schema', schema: bookkeeperSchema() } } });
    deps.usageTracker.record(response.model || model, response.usage, campaign, 'bookkeeper');
    const block = response.content.find((x) => x.type === 'text');
    let raw; try { raw = JSON.parse(block?.text ?? ''); } catch { return []; }
    const entries = cleanBookkeeperReply(raw);
    return entries.length ? addJournalUpdates(dir, entries) : [];
  }

  // Rest the whole party: a long rest restores hit points and spell slots (the tabletop clears conditions on its own board).
  async function restParty(kind, { noFood = false } = {}) {
    const campaign = await deps.getActiveCampaignId();
    const dir = path.join(deps.CAMPAIGNS_DIR, campaign);
    const timing = restOnClock(await readClock(dir), kind);          // time passes; a second long rest within 24 hours gives nothing
    if (!timing.ok) return { kind, rested: [], blocked: true, notes: [timing.note] };
    const rested = [];
    for (const c of await deps.listCharacters(campaign)) {
      const { character, note } = restCharacter(c, kind);
      if (noFood && kind === 'long' && c.track) character.track = { ...character.track, exhaustion: normalizeTrack(c.track).exhaustion };   // no food and water: no exhaustion recovery
      if (note) { await deps.saveCharacter(deps.normalizeCharacter(character)); rested.push(c.id); }
    }
    await writeClock(dir, timing.clock);
    return { kind, rested, blocked: false, notes: [timing.note, kind === 'long' ? 'Long rest: hit points, spell slots and class features restored, half the Hit Dice regained, exhaustion down one level' : 'Short rest: short-rest features restored (spend Hit Dice to heal)'], clock: describeClock(timing.clock) };
  }

  // Rules tracking (lib/rules-track.js): game clock, Hit Dice, exhaustion, class resources, XP. The DM uses the same code through token actions.
  async function trackStore(campaign) {
    const dir = path.join(deps.CAMPAIGNS_DIR, campaign);
    return {
      list: () => deps.listCharacters(campaign),
      save: async (c) => { const clean = deps.normalizeCharacter(c); await deps.saveCharacter(clean); return clean; },
      readClock: () => readClock(dir), writeClock: (c) => writeClock(dir, c),
      sheetEdit: (updates) => processCharacterUpdates(updates, { list: () => deps.listCharacters(campaign), save: async (c) => { const clean = deps.normalizeCharacter(c); await deps.saveCharacter(clean); return clean; } })
    };
  }
  async function runTrack(update) {
    const campaign = await deps.getActiveCampaignId();
    const settings = await readSettings(path.join(deps.CAMPAIGNS_DIR, campaign));
    return processTrackUpdates([{ type: 'track', ...update }], await trackStore(campaign), settings.rules === '2024' ? '2024' : '2014');
  }
  const trackRoute = (build) => deps.asyncRoute(async (req, res) => {
    const update = build(req.body || {});
    if (update.target && update.target !== 'party') update.target = deps.canonId(update.target);
    const out = await runTrack(update);
    if (out.problems.length && !out.notes.length) return res.status(400).json({ error: out.problems.join(' ') });
    res.json(out);
  });
  app.post('/api/party/hit-dice', trackRoute((b) => ({ op: 'hitdice', target: b.characterId, count: b.count, die: b.die })));
  app.post('/api/party/exhaustion', trackRoute((b) => ({ op: 'exhaustion', target: b.characterId, delta: b.delta })));
  app.post('/api/party/resource', trackRoute((b) => ({ op: 'resource', target: b.characterId, name: b.name, delta: b.delta, max: b.max, recharge: b.recharge })));
  app.post('/api/party/supplies', trackRoute((b) => ({ op: 'supplies', target: b.characterId, kind: b.kind, days: b.days })));
  app.post('/api/party/xp', trackRoute((b) => ({ op: 'xp', target: b.characterId || 'party', amount: b.amount, split: b.split })));
  // Level up (lib/levelup.js): what the next level gives and which choices there are, then apply the player's choices through the sheet editor (logged, with Undo).
  app.get('/api/party/levelup/:id', deps.asyncRoute(async (req, res) => {
    const c = (await deps.listCharacters(await deps.getActiveCampaignId())).find((x) => x.id === deps.canonId(req.params.id));
    if (!c) return res.status(404).json({ error: 'No such character' });
    res.json(levelUpOptions(c));
  }));
  app.post('/api/party/levelup/:id', deps.localOnly, deps.asyncRoute(async (req, res) => {
    const c = (await deps.listCharacters(await deps.getActiveCampaignId())).find((x) => x.id === deps.canonId(req.params.id));
    if (!c) return res.status(404).json({ error: 'No such character' });
    const out = applyLevelUp(c, req.body || {});
    if (!out.ok) return res.status(400).json({ error: out.error });
    const saved = deps.normalizeCharacter(out.character);
    await deps.saveCharacter(saved);
    res.json({ character: saved, notes: out.notes, level: out.level });
  }));
  // A throwaway character for the Level-up test page: nothing is saved. Without choices it returns the options; with choices it returns the levelled character.
  app.post('/api/levelup/dry', deps.asyncRoute(async (req, res) => {
    const b = req.body || {};
    let character;
    if (b.character) character = deps.normalizeCharacter(b.character);
    else {
      const { classes, races } = quickChoices();
      if (!classes.includes(b.cls) || !races.includes(b.race)) return res.status(400).json({ error: 'Pick a class and a race.' });
      character = deps.normalizeCharacter(buildQuickCharacter({ id: newCharacterId(), name: String(b.name || 'Test Hero').slice(0, 40), cls: b.cls, race: b.race, level: b.level }));
    }
    if (b.choices === undefined) return res.json({ character, options: levelUpOptions(character) });
    const out = applyLevelUp(character, b.choices);
    if (!out.ok) return res.status(400).json({ error: out.error });
    res.json({ character: deps.normalizeCharacter(out.character), notes: out.notes, level: out.level });
  }));
  app.post('/api/party/clock', trackRoute((b) => (b.set ? { op: 'setTime', ...b.set } : { op: 'time', minutes: b.minutes })));
  // XP for defeated monsters: { monsters: ['1/4', {cr:'1', count:2}], partySize? } -> { total, each }
  app.post('/api/party/xp-split', deps.asyncRoute(async (req, res) => {
    const size = Number(req.body?.partySize) || (await deps.listCharacters(await deps.getActiveCampaignId())).length;
    res.json(splitXp(req.body?.monsters, size));
  }));

  app.post('/api/party/rest', deps.asyncRoute(async (req, res) => {
    const kind = req.body?.kind === 'long' ? 'long' : 'short';
    res.json(await restParty(kind));
  }));

  app.put('/api/party/stash', deps.asyncRoute(async (req, res) => {
    const campaign = await deps.getActiveCampaignId();
    res.json({ stash: await writeStash(path.join(deps.CAMPAIGNS_DIR, campaign), req.body) });
  }));
  // The user's own recordings (public/audio/scene-*, mood-*, sfx-*) replace the synthesised sounds.
  app.get('/api/audio-files', deps.asyncRoute(async (_req, res) => {
    try { res.json({ files: (await readdir(path.join(deps.PUBLIC_DIR, 'audio'))).filter((f) => /\.(mp3|ogg|wav|m4a|webm|flac)$/i.test(f)).sort() }); } catch { res.json({ files: [] }); }
  }));

  return { dmBuys, trackStore, restParty, keepJournal };
}
