// Roadside protection assets inspired by the reference editor. These are optional overlays;
// they do not affect the road cross-section or the junction/curb solver.
export const GUARDRAIL_STYLES = [
  { id: 'wbeam', name: 'Corrugated W-beam', description: 'Galvanized beam with reflective steel posts.' },
  { id: 'thrie', name: 'Thrie-beam safety rail', description: 'Three-wave highway barrier for higher containment.' },
  { id: 'boxbeam', name: 'Hollow box-beam', description: 'Compact closed-section steel barrier.' },
  { id: 'cable', name: 'Four-cable tension barrier', description: 'Four continuous steel cables on roadside posts.' },
  { id: 'railing', name: 'Pedestrian railing', description: 'Three-rail steel edge protection.' },
  { id: 'concrete', name: 'Concrete safety barrier', description: 'Continuous F-profile concrete barrier.' },
  { id: 'parapet', name: 'Bridge parapet', description: 'Concrete plinth with steel infill rails.' },
];

export const DEFAULT_GUARDRAIL = Object.freeze({
  style: 'wbeam',
  height: 0.8,
  postSpacing: 3.4,
  side: 'both',
});

export const ROAD_POST_LIBRARY_ITEM = Object.freeze({
  id: 'roadPost',
  name: 'Reflective roadside post',
  description: 'Galvanized support post with high-visibility reflectors; place individually or use with a guardrail.',
});

export function normalizeGuardrail(value = {}) {
  const style = GUARDRAIL_STYLES.some(item => item.id === value.style) ? value.style : DEFAULT_GUARDRAIL.style;
  const height = Number.isFinite(+value.height) ? Math.max(0.5, Math.min(1.4, +value.height)) : DEFAULT_GUARDRAIL.height;
  const postSpacing = Number.isFinite(+value.postSpacing) ? Math.max(1.5, Math.min(6, +value.postSpacing)) : DEFAULT_GUARDRAIL.postSpacing;
  const side = ['left', 'both', 'right'].includes(value.side) ? value.side : DEFAULT_GUARDRAIL.side;
  return { style, height, postSpacing, side };
}
