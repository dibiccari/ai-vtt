'use strict';

/* ---------------- fog ---------------- */
// keep: an earlier copy of the explored layer (a canvas) to carry over, scaled if the picture is a different size: the day and night looks of a place share one fog layer.
function copyFog() { const c = document.createElement('canvas'); c.width = shroud.width; c.height = shroud.height; if (c.width && c.height) c.getContext('2d').drawImage(shroud, 0, 0); return c; }
function resetFog(keep) {
  for (const [c, cx] of [[shroud, sctx], [vision, vctx]]) {
    c.width = S.W;
    c.height = S.H;
    cx.globalCompositeOperation = 'source-over';
  }
  sctx.fillStyle = FogStyle.shroudFill(sctx, S.light === 'dark');            // cloudy white fog in a lit place, darkness in a dark one
  sctx.fillRect(0, 0, S.W, S.H);
  if (keep instanceof HTMLCanvasElement && keep.width && keep.height) { sctx.clearRect(0, 0, S.W, S.H); sctx.drawImage(keep, 0, 0, S.W, S.H); }
  revealFog();
}

// The test token's light: dimmest to brightest by the book (candle 5/10 ft, torch 20/40, lantern 30/60). In the dark it sees as far as the dim radius; otherwise the Vision slider decides.
const LIGHT_TEST = [['none', 0], ['candle', 10], ['torch', 40], ['lantern', 60]];       // by the book: no light, no sight in the dark (except darkvision)
S.testLight = [0, 1, 2, 3].includes(Number(store.get('vtt.maptest.light', 2))) ? Number(store.get('vtt.maptest.light', 2)) : 2;
// How FAR the token sees is the Vision slider, on every map. A light only changes how WELL it sees inside that range: in the dark the ground outside the light is dim, the light's bright circle is clear.
const visionNow = () => S.visionFt;
S.darkvisionFt = [0, 30, 60, 120].includes(Number(store.get('vtt.maptest.dv', 0))) ? Number(store.get('vtt.maptest.dv', 0)) : 0;
const lightReachFt = () => LIGHT_TEST[S.testLight][1];
function showTestLight() { $('#testLight').value = String(S.testLight); const nm = LIGHT_TEST[S.testLight][0]; $('#testLightText').textContent = nm.charAt(0).toUpperCase() + nm.slice(1); }
