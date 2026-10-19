'use strict';
const FT_PER_SQUARE = 5;
const SNAP_PX = 10; // screen pixels

const $ = (sel) => document.querySelector(sel);
const store = {
  get(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw == null ? fallback : JSON.parse(raw); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  }
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const S = {
  url: null, img: null, W: 0, H: 0,
  squares: 50, walls: [], starts: [], difficult: [], group: '', variant: '', light: '', ambience: '', mood: '', lights: [], configs: [], tokens: [], visionFt: 60, source: null, needsStart: new Set(), missingStart: new Set(),
  brush: 2, kind: 'battle', tiles: 'square', hexSize: 95, viewAs: 'dm', dmImg: null, moveTest: false, moveFt: 30, selected: null, tool: 'start', timeOfDay: 'day', drawKind: 'wall', lightZones: [], labels: [], zoneSel: null, zonePen: null, showZones: false, fog: true, mapFog: true, dm: true, showPins: true, showPoly: false, showWalls: false, showGrid: false, showTerrain: false,
  tokenImage: store.get('vtt.maptest.tokenImage', '/tokens/human-warrior-stern-a8268.png'),
  view: { scale: 1, ox: 0, oy: 0 },
  hover: null, drag: null, rooms: [], polys: [], spaceDown: false
};
window.mapTest = { state: S };                       // a handle for the automated browser tests

const cell = () => S.W / S.squares;
S.wallUndo = []; S.wallSel = null; S.problems = []; S.problemIx = -1; S.setVersion = 0; S.stale = false;
S.onlyUvtt = store.get('vtt.maptest.onlyUvtt', true) !== false;
const testKey = () => `vtt.maptest.${S.url}`;

const cv = $('#cv');
const ctx = cv.getContext('2d');
const stage = $('#stage');
const shroud = document.createElement('canvas');
const sctx = shroud.getContext('2d', { willReadFrequently: true });
const vision = document.createElement('canvas');
const vctx = vision.getContext('2d', { willReadFrequently: true });
