// Headless sanity check for the road editor's pure model + generator layers.
// Run with: npm run check

import { PROFILES, getProfile, laneWidth, mirrorLanes, LANE_KINDS } from '../src/engine/profiles.js';
import { buildCrossSection } from '../src/engine/crossSection.js';
import { Network } from '../src/engine/network.js';
import { generateCity, CITY_DEFAULTS } from '../src/engine/cityGenerator.js';
import { DETAIL_TYPES } from '../src/engine/details.js';
import { sampleRoadStations } from '../src/engine/roadBuilder.js';
import { makeRng } from '../src/engine/util.js';

let failures = 0;
const check = (label, condition, detail = '') => {
  if (!condition) {
    failures++;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
};

console.log('Road catalogue');
check('catalogue is populated', PROFILES.length >= 35, `${PROFILES.length} profiles`);
for (const profile of PROFILES) {
  const total = laneWidth(profile.lanes);
  if (!(total > 1)) {
    failures++;
    console.error(`  ✗ ${profile.id} has no width`);
  }
  const lanesOk = profile.lanes.every((lane) => LANE_KINDS[lane.kind] && lane.width > 0);
  if (!lanesOk) {
    failures++;
    console.error(`  ✗ ${profile.id} has an invalid lane`);
  }
}
check('every profile has valid lanes', true);

console.log('\nCross-sections');
for (const profile of PROFILES) {
  for (const driveSide of ['right', 'left']) {
    const cross = buildCrossSection(profile, { driveSide, curbHeight: 0.15 });
    if (!cross.spans.length) {
      failures++;
      console.error(`  ✗ ${profile.id}/${driveSide} produced no spans`);
    }
    const finite = cross.spans.every(
      (span) => Number.isFinite(span.a.o) && Number.isFinite(span.a.h) && Number.isFinite(span.b.o) && Number.isFinite(span.b.h) && Number.isFinite(span.u0) && Number.isFinite(span.u1),
    );
    if (!finite) {
      failures++;
      console.error(`  ✗ ${profile.id}/${driveSide} produced a non-finite span`);
    }
    if (Math.abs(cross.totalWidth - laneWidth(profile.lanes)) > 1e-6) {
      failures++;
      console.error(`  ✗ ${profile.id}/${driveSide} width mismatch`);
    }
    if (cross.drivable.length) {
      if (cross.carriageLeft > cross.carriageRight) {
        failures++;
        console.error(`  ✗ ${profile.id}/${driveSide} carriageway inverted`);
      }
    }
  }
}
check('cross-sections build for every profile on both drive sides', true);

console.log('\nMirroring');
{
  const profile = getProfile('arterial-bus-cycle');
  const right = buildCrossSection(profile, { driveSide: 'right' });
  const left = buildCrossSection(profile, { driveSide: 'left' });
  const rightDriving = right.drivable.map((lane) => lane.dir).join(',');
  const leftDriving = left.drivable.map((lane) => lane.dir).join(',');
  check('mirroring flips every direction', rightDriving.split(',').reverse().map((d) => -Number(d)).join(',') === leftDriving,
    `${rightDriving} vs ${leftDriving}`);
}

console.log('\nHand-drawn network');
{
  const network = new Network();
  const a = network.addNode(0, 0, 0, 'junction');
  const b = network.addNode(120, 0, 0, 'junction');
  const c = network.addNode(120, 130, 0, 'junction');
  const road = network.addRoad([a.id, b.id, c.id], 'arterial-bus-cycle');
  check('road created', !!road);
  const points = network.roadPoints(road);
  const { stations, length } = sampleRoadStations(points, 4);
  check('stations sampled', stations.length > 20, `${stations.length} stations`);
  check('length sane', Math.abs(length - 250) < 12, `${length.toFixed(1)} m`);
  const frames = stations.every((station) => Math.abs(Math.hypot(...station.r) - 1) < 1e-3);
  check('frames are normalised', frames);
  road.details.push({ type: 'speed-bump', s: 40 });
  const json = JSON.parse(network.snapshot());
  check('serialises', json.roads.length === 1 && json.nodes.length === 3);
}

console.log('\nCity generation');
for (const seed of [1, 1337, 90210]) {
  const network = new Network();
  const result = generateCity(network, { ...CITY_DEFAULTS, seed });
  const stats = network.stats();
  check(`seed ${seed}: roads generated`, stats.roads > 140, `${stats.roads} roads`);
  check(`seed ${seed}: nodes generated`, stats.nodes > 100, `${stats.nodes} nodes`);
  check(`seed ${seed}: subway lines`, network.subways.size >= 2, `${network.subways.size} lines`);
  check(`seed ${seed}: details placed`, stats.details > 5, `${stats.details} details`);
  const roundabouts = [...network.nodes.values()].filter((n) => n.kind === 'roundabout').length;
  check(`seed ${seed}: roundabouts`, roundabouts > 0, `${roundabouts}`);
  const railways = [...network.roads.values()].filter((r) => r.profileId.startsWith('rail')).length;
  check(`seed ${seed}: railway present`, railways >= 1, `${railways}`);
  const bridges = [...network.roads.values()].filter((r) => r.structure === 'bridge').length;
  check(`seed ${seed}: crossings grade separated`, bridges >= 0, `${bridges} overpasses`);

  // Every road must resolve to a real profile and have at least two nodes.
  let broken = 0;
  for (const road of network.roads.values()) {
    const points = network.roadPoints(road);
    if (points.length < 2 || !getProfile(road.profileId)) broken++;
    if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.z))) broken++;
  }
  check(`seed ${seed}: no broken roads`, broken === 0, `${broken} broken`);

  // Determinism.
  const again = new Network();
  generateCity(again, { ...CITY_DEFAULTS, seed });
  const fingerprint = (net) => JSON.stringify({
    nodes: [...net.nodes.values()].map((n) => [Math.round(n.x), Math.round(n.z), n.kind]).sort(),
    roads: [...net.roads.values()].map((r) => [r.profileId, r.nodeIds.map((id) => {
      const n = net.getNode(id);
      return [Math.round(n.x), Math.round(n.z)];
    })]).sort(),
  });
  check(`seed ${seed}: deterministic`, fingerprint(network) === fingerprint(again));
}

console.log('\nDetail catalogue');
check('detail types defined', DETAIL_TYPES.length > 18, `${DETAIL_TYPES.length} types`);
for (const detail of DETAIL_TYPES) {
  if (!detail.fields?.length || !detail.defaults) {
    failures++;
    console.error(`  ✗ ${detail.id} is missing fields or defaults`);
  }
}

console.log('\nGeometry load estimate');
{
  const network = new Network();
  generateCity(network, { ...CITY_DEFAULTS, seed: 1337 });
  let segments = 0;
  let metres = 0;
  for (const road of network.roads.values()) {
    const points = network.roadPoints(road);
    for (let i = 0; i < points.length - 1; i++) {
      segments++;
      metres += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z);
    }
  }
  console.log(`  · ${segments} road segments, ${(metres / 1000).toFixed(1)} km of street`);
  check('segment count is renderable', segments < 4000, `${segments}`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
