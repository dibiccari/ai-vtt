'use strict';

/* ---------------- self-test ---------------- */
function inside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

function runSelfTest() {
  const W = 1000, H = 1000;
  const results = [];
  const check = (name, ok) => results.push({ name, ok });
  const room = [
    { x1: 300, y1: 300, x2: 600, y2: 300 }, { x1: 300, y1: 600, x2: 600, y2: 600 },
    { x1: 300, y1: 300, x2: 300, y2: 600 },
    { x1: 600, y1: 300, x2: 600, y2: 400 }, { x1: 600, y1: 450, x2: 600, y2: 600 }
  ];
  const door = { x1: 600, y1: 400, x2: 600, y2: 450, type: 'door', open: false };
  const poly = (ox, oy, walls) => visibilityPolygon(ox, oy, sightWalls(walls), W, H);

  let p = poly(450, 450, [...room, door]);
  check('Sees the whole room it stands in', inside(p, 350, 350) && inside(p, 550, 550));
  check('Cannot see through the west and north walls', !inside(p, 200, 450) && !inside(p, 450, 200));
  check('Closed door blocks sight', !inside(p, 800, 425));
  door.open = true;
  p = poly(450, 450, [...room, door]);
  check('Open door lets sight through', inside(p, 800, 425));
  check('Walls beside the open door still block', !inside(p, 800, 700) && !inside(p, 800, 250));
  door.open = false;
  p = poly(800, 800, [...room, door]);
  check('Outside the room: cannot see in', !inside(p, 450, 450));
  check('Outside the room: sees open ground', inside(p, 800, 500));
  const pillar = [
    { x1: 480, y1: 400, x2: 520, y2: 400 }, { x1: 480, y1: 400, x2: 480, y2: 440 },
    { x1: 520, y1: 400, x2: 520, y2: 440 }, { x1: 480, y1: 440, x2: 520, y2: 440 }
  ];
  p = poly(500, 700, pillar);
  check('A pillar casts a shadow behind it', !inside(p, 500, 300));
  check('Open sides of the pillar are visible', inside(p, 300, 300) && inside(p, 700, 300));
  p = poly(500, 500, []);
  check('No walls: the whole map is visible', inside(p, 20, 20) && inside(p, 980, 980));
  p = poly(300, 300, room);
  check('Standing on a wall corner still gives a sight polygon', p.length >= 3);

  const box = $('#tests');
  box.innerHTML = '';
  for (const r of results) {
    const div = document.createElement('div');
    div.className = r.ok ? 'pass' : 'fail';
    div.textContent = `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`;
    box.appendChild(div);
  }
  const failed = results.filter((r) => !r.ok).length;
  const sum = document.createElement('div');
  sum.className = failed ? 'fail' : 'pass';
  sum.textContent = failed ? `${failed} of ${results.length} failed` : `All ${results.length} passed`;
  box.appendChild(sum);
}
$('#selfTestBtn').addEventListener('click', runSelfTest);
