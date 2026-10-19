'use strict';

/* ---------------- start ---------------- */
new ResizeObserver(() => { resizeCanvas(); }).observe(stage);
resizeCanvas();
setTool('start');
loadTestTokenImages();
loadMapList(true);

window.mapTest = { state: S, selectPin, syncPinTypeBox, renderDoorList, visibilityPolygon, fogStateAt, loadMap, revealFog, fogAlphaAt: (x, y) => sctx.getImageData(Math.round(x), Math.round(y), 1, 1).data[3] };
