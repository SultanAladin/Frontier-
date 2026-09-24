/**
 * decorations.js — intentionally empty.
 *
 * Earlier builds mounted non-anatomical "cybernetic study hardware" on the
 * skeleton (alien receiver antennae, external hydraulic jaw actuators and three
 * coloured Verlet cables). For the realistic build those are removed: the rig is
 * now a clean, anatomically-referenced fossil skeleton only.
 *
 * The factory is kept so the scene owner can still call it uniformly; it returns
 * an empty group and a no-op update.
 */

import { Group } from 'three';

export function buildDecorations(/* skel */) {
  const group = new Group();
  group.name = 'decorations.none';
  return {
    group,
    parts: [],
    update() {},
  };
}
