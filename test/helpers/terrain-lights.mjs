// The Terrain Test Grounds map no longer ships with lights (the user had them removed from the maps we made). A few tests need a lantern, a campfire and an unlit brazier to work with, so they
// put them there first, in their own sandbox copy of the data.
export const TERRAIN_LIGHTS = [
  { x: 1510, y: 150, range: 5, intensity: 1, color: 'ffffc070', kind: 'lantern', name: 'lantern' },
  { x: 350, y: 625, range: 9, intensity: 1, color: 'ffff9a3c', flicker: true, kind: 'campfire', name: 'campfire' },
  { x: 1560, y: 420, range: 8, intensity: 1, color: 'ffff9a3c', flicker: true, on: false, kind: 'brazier', name: 'brazier' }
];
export async function installTerrainLights(server) {
  for (const file of ['vtt-terrain-test.png', 'vtt-terrain-test-night.png']) {
    const cur = (await server.get('/api/map-config?map=' + file)).json;
    if (!cur.config) continue;
    const r = await server.put('/api/map-config?map=' + file, { ...cur.config, lights: TERRAIN_LIGHTS, lightsEdited: true, baseVersion: cur.setVersion });
    if (r.status !== 200) throw new Error('could not install the Terrain Test lights: ' + r.text);
  }
}
