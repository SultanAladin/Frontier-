// Server-side render smoke test for the React shell.
//
// There is no WebGL in node, so `App` is rendered with its effects skipped (which
// is what `renderToStaticMarkup` does) and the panels are then rendered directly
// against a populated network + a stubbed viewport. This catches import cycles,
// bad props, missing guards and crashes inside the panels — everything except the
// actual GPU work.
//
// Run via: node scripts/check-ui.mjs

import React from 'react';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

import App from '../src/App.jsx';
import RoadLibrary from '../src/ui/RoadLibrary.jsx';
import Outliner from '../src/ui/Outliner.jsx';
import Inspector from '../src/ui/Inspector.jsx';
import Minimap from '../src/ui/Minimap.jsx';
import { GenerateCityDialog, SettingsDialog, ShortcutsDialog } from '../src/ui/Dialogs.jsx';

import { Network } from '../src/engine/network.js';
import { generateCity, CITY_DEFAULTS } from '../src/engine/cityGenerator.js';
import { RoadWorld } from '../src/engine/world.js';
import { installCanvasStub } from './canvas-stub.mjs';

const results = [];
const dumpDir = process.env.UI_DUMP_DIR || null;
if (dumpDir) mkdirSync(dumpDir, { recursive: true });

const render = (label, element, { minLength = 40, mustContain = [] } = {}) => {
  try {
    const html = renderToStaticMarkup(element);
    if (dumpDir) {
      writeFileSync(
        join(dumpDir, `${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.html`),
        `<!doctype html><meta charset="utf-8">${html}`,
      );
    }
    const haystack = html.toLowerCase();
    const missing = mustContain.filter((needle) => !haystack.includes(needle.toLowerCase()));
    if (html.length < minLength) throw new Error(`suspiciously short output (${html.length} chars)`);
    if (missing.length) throw new Error(`missing ${missing.join(', ')}`);
    results.push([true, label, `${(html.length / 1024).toFixed(1)} kB of markup`]);
  } catch (error) {
    results.push([false, label, error.message]);
  }
};

installCanvasStub();

const network = new Network();
generateCity(network, { ...CITY_DEFAULTS, seed: 1337 });
const world = new RoadWorld(network, { spacing: 6 });
world.rebuild();

const road = network.roads.values().next().value;
const node = network.nodes.values().next().value;
const subway = network.subways.values().next().value;

const viewport = {
  network,
  world,
  cameraController: {
    position: { x: 240, y: 120, z: 260, clone() { return { ...this }; } },
    yaw: 0.6,
    pitch: -0.7,
    applyToCamera() {},
    frame() {},
  },
  terrain: { heightAt: () => 0 },
  setPendingDetail() {},
  setTool() {},
  setSelection() {},
  frameSelection() {},
  deleteSelection() {},
  requestRebuild() {},
  setPendingProfile() {},
};

render('App shell', <App />, { mustContain: ['Project Zero', 'Library', 'Inspector', 'Roads'] });
render('Road library', <RoadLibrary selectedProfileId="residential-street" onSelect={() => {}} onApplyToSelection={() => {}} />, { mustContain: ['Arterial', 'Residential'] });
render('Outliner', <Outliner network={network} selection={{ type: 'road', id: road.id }} query="" onSelect={() => {}} onFocus={() => {}} onChange={() => {}} />, { mustContain: ['roads'] });

render('Inspector — nothing selected', <Inspector network={network} world={world} viewport={viewport} selection={null} onNetworkChange={() => {}} />);
render('Inspector — road', <Inspector network={network} world={world} viewport={viewport} selection={{ type: 'road', id: road.id }} onNetworkChange={() => {}} />, { mustContain: ['cross-section', 'lanes', 'markings'] });
render('Inspector — node', <Inspector network={network} world={world} viewport={viewport} selection={{ type: 'node', id: node.id }} onNetworkChange={() => {}} />, { mustContain: ['Junction'] });
render('Inspector — subway', <Inspector network={network} world={world} viewport={viewport} selection={{ type: 'subway', id: subway.id }} onNetworkChange={() => {}} />, { mustContain: ['stations', 'depth'] });

render('Minimap', <Minimap network={network} viewport={viewport} />);
render('Generate city dialog', <GenerateCityDialog onClose={() => {}} onGenerate={() => {}} />, { mustContain: ['Random seed', 'Extent'] });
render('Settings dialog', <SettingsDialog onClose={() => {}} settings={network.settings} onChange={() => {}} network={network} />, { mustContain: ['driving side'] });
render('Shortcuts dialog', <ShortcutsDialog onClose={() => {}} />, { mustContain: ['Right-drag'] });

let failures = 0;
for (const [ok, label, detail] of results) {
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label} — ${detail}`);
}
console.log(failures ? `\n${failures} UI check(s) failed` : '\nAll UI renders succeeded');
