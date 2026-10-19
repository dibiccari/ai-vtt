'use strict';

/* ---------------- doors: normal, locked or secret, with a DC ---------------- */
function renderDoorList() {
  const box = $('#doorList'); box.innerHTML = '';
  const dcard = document.getElementById('doorCard'); if (dcard) dcard.dataset.for = '';       // the door card reads the door again
  const doors = S.walls.filter((w) => w.type === 'door');
  if (!doors.length) { box.textContent = 'This map has no doors.'; return; }
  const g = S.W / S.squares;
  doors.forEach((d, i) => {
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:6px;align-items:center;margin:4px 0;';
    const label = document.createElement('span'); label.style.cssText = 'flex:1;font-size:12px;'; label.textContent = 'Door ' + (i + 1) + ' (' + Math.floor((d.x1 + d.x2) / 2 / g) + ',' + Math.floor((d.y1 + d.y2) / 2 / g) + ')';
    const sel = document.createElement('select'); sel.setAttribute('aria-label', 'State of door ' + (i + 1)); sel.style.width = '96px';
    [['', 'Normal'], ['locked', 'Locked'], ['secret', 'Secret']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); });
    sel.value = d.secret ? 'secret' : d.locked ? 'locked' : '';
    const dc = document.createElement('input'); dc.type = 'number'; dc.min = '5'; dc.max = '30'; dc.placeholder = 'DC'; dc.title = 'The DC to pick the lock or to spot the door'; dc.style.width = '56px'; dc.value = d.dc || '';
    dc.setAttribute('aria-label', 'DC of door ' + (i + 1)); dc.style.visibility = sel.value ? 'visible' : 'hidden';       // the slot stays so the drop downs line up
    const apply = () => {
      delete d.locked; delete d.secret;
      if (sel.value === 'locked') { d.locked = true; d.open = false; } else if (sel.value === 'secret') { d.secret = true; d.open = false; }
      if (sel.value && !(Number(dc.value) >= 5)) dc.value = '15';                    // a locked or secret door starts at DC 15
      const n = Math.round(Number(dc.value)); if (sel.value && n >= 5 && n <= 30) d.dc = n; else delete d.dc;
      dc.style.visibility = sel.value ? 'visible' : 'hidden'; wallsChanged(); requestRender();
    };
    sel.addEventListener('change', apply); dc.addEventListener('change', apply);
    const del = document.createElement('button'); del.type = 'button'; del.className = 'small danger'; del.textContent = '✕'; del.title = 'Delete this door'; del.setAttribute('aria-label', 'Delete door ' + (i + 1));
    del.addEventListener('click', (ev) => { ev.preventDefault(); wallSnapshot(); const k = S.walls.indexOf(d); if (k >= 0) S.walls.splice(k, 1); if (S.wallSel === d) S.wallSel = null; afterWallEdit(); });       // Undo in the Walls tool brings it back
    row.append(label, sel, dc, del); box.appendChild(row);
  });
}
