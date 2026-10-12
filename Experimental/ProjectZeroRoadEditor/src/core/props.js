// Road props: details that sit on a road and are stored with it.
//
// Point props use `s` = arc length along the road. If `ref` is 'start' or 'end',
// `s` is measured from the *trimmed* end (where the junction pad stops), so a
// crossing at ref 'start', s 5 always sits 5 m past the intersection edge.
// Range props (bollards, lamps) use absolute s0..s1 (undefined = whole road).

export const PROP_KINDS = {
  speedBump: { label: 'Speed bump', range: false, hint: 'Raised hump across the carriageway.' },
  crosswalk: { label: 'Zebra crossing', range: false, hint: 'Pedestrian crossing stripes across the drive lanes.' },
  stopLine: { label: 'Stop line', range: false, hint: 'Solid bar across the drive lanes.' },
  railCrossing: { label: 'Railway level crossing', range: false, hint: 'Rails across the road with gate arms.' },
  bollards: { label: 'Bollard row', range: true, hint: 'Yellow bollards along the lane edge.' },
  lamps: { label: 'Street lamps', range: true, hint: 'Lamp posts on both sidewalks.' },
};

export const PROP_KIND_IDS = Object.keys(PROP_KINDS);

/** Default parameters when a prop is created by the editor. */
export function defaultProp(kind, s = 0) {
  switch (kind) {
    case 'speedBump':
      return { kind, s, height: 0.09 };
    case 'crosswalk':
      return { kind, s, length: 4 };
    case 'stopLine':
      return { kind, s };
    case 'railCrossing':
      return { kind, s, closed: true };
    case 'bollards':
      return { kind, spacing: 1.2 };
    case 'lamps':
      return { kind, spacing: 30 };
    default:
      return { kind, s };
  }
}

/** Absolute arc length for a point prop, given the road's full length and trims. */
export function resolveS(prop, fullLength, trim = { start: 0, end: 0 }) {
  const v = Number(prop.s) || 0;
  if (prop.ref === 'start') return (trim.start || 0) + v;
  if (prop.ref === 'end') return fullLength - (trim.end || 0) - v;
  return v;
}
