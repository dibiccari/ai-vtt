// Real dice for the table: every roll uses the operating system's random source (crypto.randomInt), never a model's guess.
// Used by POST /api/roll (the tabletop's "Roll for me") and to pre-roll the dice tray the Dungeon Master reads from.
import { randomInt } from 'node:crypto';

export const DICE = [4, 6, 8, 10, 12, 20, 100];

export const rollDie = (sides) => {
  const n = Math.round(Number(sides));
  if (!DICE.includes(n) && !(n >= 2 && n <= 1000)) throw new Error(`There is no d${sides}`);
  return randomInt(1, n + 1);
};

// "d20", "2d6+3", "1d8-1", "4d6" ... mode "advantage" or "disadvantage" rolls a single d20 twice and keeps the higher or lower.
export function rollExpr(expr, mode = 'normal') {
  const m = String(expr ?? '').toLowerCase().replace(/\s+/g, '').match(/^(\d{0,2})d(\d{1,3})([+-]\d{1,3})?$/);
  if (!m) throw new Error(`Cannot read the roll "${expr}". Try something like d20, 2d6+3 or d100.`);
  const count = m[1] === '' ? 1 : Number(m[1]);
  const sides = Number(m[2]);
  const bonus = m[3] ? Number(m[3]) : 0;
  if (count < 1 || count > 20) throw new Error('Roll between 1 and 20 dice at a time.');
  if (sides < 2) throw new Error(`There is no d${sides}`);
  let rolls = Array.from({ length: count }, () => rollDie(sides));
  let kept = rolls;
  let used = 'normal';
  if ((mode === 'advantage' || mode === 'disadvantage') && count === 1 && sides === 20) {
    rolls = [rolls[0], rollDie(20)];
    kept = [mode === 'advantage' ? Math.max(...rolls) : Math.min(...rolls)];
    used = mode;
  }
  const total = kept.reduce((a, b) => a + b, 0) + bonus;
  return { expr: `${count}d${sides}${bonus ? (bonus > 0 ? '+' : '') + bonus : ''}`, mode: used, rolls, kept, bonus, total };
}

// A tray of pre-rolled dice for the Dungeon Master to take from in order: how many of each die is enough for one turn.
const TRAY = { d4: 6, d6: 16, d8: 10, d10: 8, d12: 6, d20: 16, d100: 3 };
export function diceTray() {
  const tray = {};
  for (const [name, n] of Object.entries(TRAY)) tray[name] = Array.from({ length: n }, () => rollDie(Number(name.slice(1))));
  return tray;
}
