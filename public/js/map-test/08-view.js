'use strict';

/* ---------------- view ---------------- */
function fitView() {
  if (!S.W) return;
  const rect = stage.getBoundingClientRect();
  const scale = Math.min(rect.width / S.W, rect.height / S.H) * 0.96;
  S.view.scale = scale;
  S.view.ox = (rect.width - S.W * scale) / 2;
  S.view.oy = (rect.height - S.H * scale) / 2;
  requestRender();
}

// Fit to width: the map as wide as the view, starting at its top (scroll or drag to see the rest).
function fitWidth() {
  if (!S.W) return;
  const rect = stage.getBoundingClientRect();
  S.view.scale = (rect.width / S.W) * 0.98;
  S.view.ox = (rect.width - S.W * S.view.scale) / 2;
  S.view.oy = 12;
  requestRender();
}

function toWorld(e) {
  const rect = cv.getBoundingClientRect();
  return { x: (e.clientX - rect.left - S.view.ox) / S.view.scale, y: (e.clientY - rect.top - S.view.oy) / S.view.scale };
}
