// Headless geometry pass.
//
// Stubs just enough of a 2D canvas for the procedural texture painters, then runs a
// full city through the real build pipeline (cross-sections, extrusions, junctions,
// markings, details, bridges, subway, massing and terrain) and verifies that the
// output is finite, non-empty and reasonably sized.
//
// Run with: node scripts/check-geometry.mjs

import { installCanvasStub } from './canvas-stub.mjs';

installCanvasStub();

const { Network } = await import('../src/engine/network.js');
const { generateCity, CITY_DEFAULTS } = await import('../src/engine/cityGenerator.js');
const { RoadWorld } = await import('../src/engine/world.js');

let failures = 0;
const check = (label, condition, detail = '') => {
  if (!condition) {
    failures++;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

console.log('Full build (seed 1337, 2.1 km city)');
const network = new Network();
const result = generateCity(network, { ...CITY_DEFAULTS, seed: 1337 });
const world = new RoadWorld(network, { spacing: 4 });
const stats = world.rebuild();

check('roads prepared', stats.roads > 100, `${stats.roads} roads`);
check('chunks produced', stats.chunks > 20, `${stats.chunks} chunks`);
check('triangles produced', stats.triangles > 200000, `${(stats.triangles / 1000).toFixed(0)}k triangles`);
check('props instanced', stats.props > 100, `${stats.props} props`);
check('massing generated', stats.buildings > 100, `${stats.buildings} buildings`);
check('build time acceptable', stats.ms < 25000, `${stats.ms} ms`);

console.log('\nGeometry validation');
let meshes = 0;
let vertices = 0;
let badVertices = 0;
let degenerateTriangles = 0;
let triangles = 0;
for (const group of world.chunkGroup.children) {
  for (const mesh of group.children) {
    meshes++;
    const position = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();
    vertices += position.count;
    for (let i = 0; i < position.count * 3; i++) {
      if (!Number.isFinite(position.array[i])) badVertices++;
    }
    if (index) {
      triangles += index.count / 3;
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i);
        const b = index.getX(i + 1);
        const c = index.getX(i + 2);
        if (a === b || b === c || a === c) degenerateTriangles++;
      }
    }
    const owners = mesh.userData.owner;
    if (!owners || owners.length !== (index ? index.count / 3 : 0)) {
      failures++;
      console.error(`  ✗ owner table mismatch on ${mesh.name}: ${owners?.length} vs ${index ? index.count / 3 : 0}`);
    }
  }
}
check('no non-finite vertices', badVertices === 0, `${badVertices} bad of ${vertices}`);
check('degenerate triangles are rare', degenerateTriangles / Math.max(1, triangles) < 0.02, `${degenerateTriangles} of ${triangles}`);
check('draw calls are bounded', meshes < 2200, `${meshes} meshes`);

console.log('\nDriving side');
{
  const left = new Network();
  generateCity(left, { ...CITY_DEFAULTS, seed: 4242 });
  left.settings.driveSide = 'left';
  const leftWorld = new RoadWorld(left, { spacing: 6 });
  const leftStats = leftWorld.rebuild();
  check('left-hand traffic builds', leftStats.triangles > 100000, `${(leftStats.triangles / 1000).toFixed(0)}k triangles`);
}

console.log('\nMinimal document');
{
  const tiny = new Network();
  const a = tiny.addNode(0, 0, 0, 'junction');
  const b = tiny.addNode(140, 0, 0, 'junction');
  const c = tiny.addNode(140, 120, 0, 'junction');
  tiny.addRoad([a.id, b.id], 'arterial-bus-cycle');
  tiny.addRoad([b.id, c.id], 'residential-street');
  const tinyWorld = new RoadWorld(tiny, { spacing: 3 });
  const tinyStats = tinyWorld.rebuild();
  check('two-road document builds', tinyStats.triangles > 500, `${tinyStats.triangles} triangles`);
  check('a junction patch was made', tinyStats.junctions >= 1, `${tinyStats.junctions} junctions`);
}

console.log('\nEvery profile extrudes');
{
  const { PROFILES } = await import('../src/engine/profiles.js');
  const all = new Network();
  let index = 0;
  for (const profile of PROFILES) {
    const row = Math.floor(index / 6);
    const column = index % 6;
    const x = column * 220;
    const z = row * 220;
    const a = all.addNode(x, z, 0, 'junction');
    const b = all.addNode(x + 150, z + 40, 0, 'junction');
    all.addRoad([a.id, b.id], profile.id);
    index++;
  }
  const allWorld = new RoadWorld(all, { spacing: 4 });
  const allStats = allWorld.rebuild();
  check('all profiles build together', allStats.roads === PROFILES.length, `${allStats.roads}/${PROFILES.length}`);
  check('all profiles produce geometry', allStats.triangles > 50000, `${(allStats.triangles / 1000).toFixed(0)}k triangles`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll geometry checks passed');
process.exit(failures ? 1 : 0);

/* ------------------------------------------------------------------ */

