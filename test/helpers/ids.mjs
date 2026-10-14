// The seeded characters have GUID ids. ID.edric is the id of the character who used to be called "edric" (read from data/character-aliases.json, so tests and the sandbox copy agree).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const aliases = JSON.parse(readFileSync(path.join(dataDir, 'character-aliases.json'), 'utf8'));
export const ID = new Proxy(aliases, { get: (t, k) => { if (!(k in t)) throw new Error(`No seeded character called "${String(k)}"`); return t[k]; } });
export const TOKEN = (name) => 'tok-' + ID[name].slice(0, 8);
