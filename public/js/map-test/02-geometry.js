'use strict';

/* ---------------- geometry (same algorithm as the tabletop in index.html) ---------------- */
// The shared pieces (public/js/sight.js): the same code as the tabletop, so a map is lit and seen here exactly as at the table.
const { cross, castRay, pointSegmentDistance, blockingWalls, sightWalls, visibilityPolygon } = Sight;
