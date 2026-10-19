// The tabletop, part of public/index.html: constants, state, storage and DOM helpers.
// Classic script: it shares one global scope with the other files in public/js/tabletop/, loaded in this order by index.html.
'use strict';


/* =====================================================================
   CONSTANTS & STATE
   ===================================================================== */
const GRID = 50;              // world pixels per 5-ft square
const FT_PER_SQUARE = 5;
const VISION_FT = 60;
const DEFAULT_COLS = 30;
const DEFAULT_ROWS = 20;
const MIN_SCALE = 0.15;
const MAX_SCALE = 4;
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const DEFAULT_TOKENS = [
  { name: 'Hero 1', color: '#e5534b' },
  { name: 'Hero 2', color: '#4f9dff' },
  { name: 'Hero 3', color: '#57c47a' },
  { name: 'Hero 4', color: '#e3b341' }
];
const START_SQUARES = [[2, 2], [3, 2], [2, 3], [3, 3], [4, 2], [4, 3], [2, 4], [3, 4]];        // where a fresh board puts up to eight characters

const state = {
  map: { url: null, img: null, width: DEFAULT_COLS * GRID, height: DEFAULT_ROWS * GRID, drawW: 0, drawH: 0 },
  view: { scale: 1, ox: 0, oy: 0 },
  tokens: [],
  activeIndex: 0,
  walls: [],
  wallsVersion: 0,
  characters: [],
  chat: [],
  fogEnabled: true,
  gridOpacity: 0,                     // grid lines are off (the maps carry their own printed grid)
  drawWalls: false,
  wallType: 'wall',
  gmOverride: false,
  busy: false,
  moveRule: 'circle',                  // movement is round on every map: straight-line distance, so the range is a circle (no setting to change it)
  campaignId: null,
  zoomToParty: false,
  mapKind: 'battle',          // 'regional' and 'town' maps are plain pictures (no grid, no fog, no tokens); 'battle' maps have all three
  mapMemory: {},              // per map: the creatures and party positions left there, restored when the party returns
  fogBeforeOverland: null,
  combat: { active: false, round: 0, order: [] },
  difficult: [],                      // difficult-terrain rectangles of the current map, in board pixels
  difficultSquares: null,             // the squares inside them (built when first needed)
  permadeath: false,                  // the campaign's Death setting (Campaigns > Settings); off = no permanent character death
  cbOpen: new Set(),                  // combatants whose details are open in the combat panel (the active one always is)
  autoTurns: 0,                       // creature turns the table has started in a row without a player acting (capped)
  knownPlaces: {},                    // town and regional maps: the place pins the DM has had the players discover, by map picture (the pins marked known from the start need no entry)
  visitedMaps: [],                    // map pictures the party has been to (the Map picker lists only these, plus regional and camp maps)
  wallsInPicture: false,
  dmPad: '',                         // the DM's private scratchpad for this campaign (saved in the board, never shown to players; DM view only)
  pendingNotes: [],                  // things the table noticed for the DM to resolve (opportunity attacks, concentration), told with the next message
  templates: [],                     // spell areas drawn on the map
  pendingCorrections: [],            // moves the table adjusted; told to the DM with the next message
  ambience: '',                      // the map's ambient sound ('' = pick one from the kind of place)
  mood: '',                          // a mood the DM asked for ('' = none; combat sets its own)
  ambient: 'bright',                 // the map's light level: 'bright', 'dim' or 'dark' (from its config)
  ambientOverride: '',               // the table's own choice, '' = use the map's
  timeOfDay: 'day',                  // day, dawn, dusk or night: the AI DM decides it (token action timeofday); the picture darkens at night and light zones that follow the time of day change with it
  lights: [],                        // the map's own light sources
  lightZones: [],                    // parts of the map with their own light (bright, dim, dark or following the time of day), from its config
  effects: [],                       // animated regions over the picture (rivers, lava)
  lightsOff: {},                     // per map: ids of map lights that were put out
  availableMaps: [],          // the maps this campaign can move to
  places: [],                 // the named places (pins) of the map on the table, for the DM
  dmView: false,
  sight: []
};

const interaction = {
  mode: null,          // 'drag' | 'wall' | 'pan' | 'pinch' | null
  pointers: new Map(), // pointerId -> {x, y} (screen)
  token: null,
  offX: 0, offY: 0,
  wx: 0, wy: 0,
  wallStart: null,
  wallEnd: null,
  panStart: null,
  pinch: null,
  hoverSquare: null
};

/* =====================================================================
   SAFE STORAGE
   ===================================================================== */
/* SERVER SAVE: the board, the chat and the explored fog live in the browser for speed and are mirrored to the server
   (data/campaigns/<id>/game.json and fog.json), so the game survives clearing the browser and can be continued from another
   computer. Whichever copy was saved last wins when the table opens. */
const serverSave = (() => {
  let timer = null, quiet = false;
  const on = () => state.campaignId && state.campaignId !== 'default' && !/[?&](nosave|watch)=1/.test(location.search);       // ?nosave=1: look around without touching the saved game (for testing)
  const atKey = () => `vtt.savedAt.${state.campaignId}`;
  const url = (suffix = '') => `/api/campaigns/${encodeURIComponent(state.campaignId)}/game${suffix}`;
  const put = (suffix, body) => fetch(url(suffix), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => { /* offline: the browser copy still has it */ });
  const push = () => {
    timer = null;
    try {
      const board = JSON.parse(localStorage.getItem(`vtt.board.${state.campaignId}`) || 'null');
      if (!board) return;
      const chat = JSON.parse(localStorage.getItem(`vtt.chat.${state.campaignId}`) || '[]');
      put('', { board, chat, savedAt: Number(localStorage.getItem(atKey())) || Date.now() });
    } catch { /* storage blocked */ }
  };
  return {
    // Called after every local save of a board or chat.
    touched(key) {
      if (quiet || !on() || (key !== `vtt.board.${state.campaignId}` && key !== `vtt.chat.${state.campaignId}`)) return;
      try { localStorage.setItem(atKey(), String(Date.now())); } catch { /* storage blocked */ }
      clearTimeout(timer);
      timer = setTimeout(push, 1500);
    },
    fog(mapUrl, data) { if (on() && mapUrl) put('/fog', { mapUrl, data }); },
    // At start-up: take the server copy if it is newer than this browser's, or send this browser's if it is newer.
    async pull() {
      const watching = window.WATCH === true;                          // ?watch=1: always show the server copy (public/js/watch.js)
      if (!on() && !watching) return;
      try {
        const g = await (await fetch(url())).json();
        const localAt = Number(localStorage.getItem(atKey())) || 0;
        const hasLocal = Boolean(localStorage.getItem(`vtt.board.${state.campaignId}`));
        if (g.board && (watching || Number(g.savedAt) > localAt)) {
          quiet = true;
          try {
            localStorage.setItem(`vtt.board.${state.campaignId}`, JSON.stringify(g.board));
            localStorage.setItem(`vtt.chat.${state.campaignId}`, JSON.stringify(g.chat || []));
            for (const [m, d] of Object.entries(g.fog || {})) localStorage.setItem(`vtt.fog.${m}`, d);
            localStorage.setItem(atKey(), String(g.savedAt));
          } finally { quiet = false; }
        } else if (hasLocal && localAt >= Number(g.savedAt || 0)) {
          if (!localAt) localStorage.setItem(atKey(), String(Date.now()));
          push();
          const maps = new Set(JSON.parse(localStorage.getItem(`vtt.board.${state.campaignId}`)).visitedMaps || []);
          for (const m of maps) { const d = localStorage.getItem(`vtt.fog.${m}`); if (d) this.fog(m, d); }
        }
      } catch { /* the server is not reachable: the browser copy is used */ }
    }
  };
})();

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { return false; }
    serverSave.touched(key);
    return true;
  },
  getRaw(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  setRaw(key, value) {
    try { localStorage.setItem(key, value); return true; } catch { return false; }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
  }
};
const mapKey = () => state.map.url || 'default';
// Each campaign keeps its own board and chat, so switching campaigns brings back where you were.
const boardKey = () => `vtt.board.${state.campaignId || 'default'}`;
const chatKey = () => `vtt.chat.${state.campaignId || 'default'}`;
const wallsKey = () => `vtt.walls.${mapKey()}`;
// One explored-fog layer per map set (every look of a place, day and night, shares it); a picture that belongs to no set keeps its own.
const fogId = () => (state.map.setId ? `set-${state.map.setId}` : mapKey());
const fogKey = () => `vtt.fog.${fogId()}`;

/* =====================================================================
   DOM HELPERS
   ===================================================================== */
const $ = (sel) => document.querySelector(sel);
const canvas = $('#board');
const ctx = canvas.getContext('2d');
const wrap = $('#canvasWrap');

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mod = (score) => Math.floor((Number(score) - 10) / 2);
const fmtMod = (m) => (m >= 0 ? `+${m}` : `${m}`);
const initials = (name) => String(name || '?').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

function toast(message, kind = 'info', ms = 2600) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

async function api(path, options = {}) {
  const res = await fetch(path, options);
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw new Error(data?.error || `${res.status} ${res.statusText}`);
  return data;
}
const jsonPost = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
// The DM's answer as it is written: the server sends one JSON line per event (roll, line, then done or error). handlers.onRoll(text) and handlers.onLine(line, index) are called as they arrive; resolves with the final reply.
async function chatStream(body, handlers) {
  // If nothing at all arrives for 90 seconds the connection is given up on, so the table never sits on 'thinking' for good.
  const ctl = new AbortController();
  let idle = null;
  const bump = () => { clearTimeout(idle); idle = setTimeout(() => ctl.abort(), 90000); };
  bump();
  try {
  const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, stream: true }), signal: ctl.signal });
  if (!(res.headers.get('content-type') || '').includes('ndjson')) { const data = await res.json().catch(() => ({})); throw new Error(data.error || `${res.status} ${res.statusText}`); }
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '', done = null;
  const handle = (raw) => {
    if (!raw.trim()) return;
    const ev = JSON.parse(raw);
    if (ev.event === 'roll') handlers.onRoll && handlers.onRoll(ev.text);
    else if (ev.event === 'line') handlers.onLine && handlers.onLine(ev.line, ev.index);
    else if (ev.event === 'error') throw new Error(ev.error || 'The AI DM could not answer');
    else if (ev.event === 'done') done = ev;
  };
  for (;;) {
    const { done: finished, value } = await reader.read();
    if (finished) break;
    bump();
    buf += dec.decode(value, { stream: true });
    for (let i; (i = buf.indexOf('\n')) >= 0;) { const raw = buf.slice(0, i); buf = buf.slice(i + 1); handle(raw); }
  }
  handle(buf);
  if (!done) throw new Error('The AI DM stopped answering before it finished');
  return done;
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error('The AI DM did not answer for 90 seconds. Nothing was applied: try again.');
    throw err;
  } finally { clearTimeout(idle); }
}

