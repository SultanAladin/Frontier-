import React from 'react';
import { LANE_KINDS } from '../engine/profiles.js';

export const LANE_COLORS = {
  driving: '#4c5158',
  bus: '#7a503a',
  cycle: '#2f6f4a',
  parking: '#5a6067',
  shoulder: '#3f444a',
  hov: '#4c5158',
  buffer: '#383d42',
  median: '#6d6a63',
  sidewalk: '#918d85',
  planting: '#4f7038',
  verge: '#3d5a2c',
  shared: '#7a5a3a',
  pathway: '#5b6167',
  rail: '#6b665c',
  tram: '#7a5a3a',
  channel: '#2f5265',
};

export function laneColor(kind) {
  return LANE_COLORS[kind] || '#4c5158';
}

function laneHeight(lane) {
  const kind = LANE_KINDS[lane.kind] || {};
  if (lane.variant === 'flush') return 0.02;
  if (lane.kind === 'median' || lane.kind === 'sidewalk') {
    if (lane.variant === 'hatched' || lane.variant === 'barrier') return 0;
    if (lane.variant === 'platform') return 0.76;
    if (lane.variant === 'wall' || lane.variant === 'parapet') return lane.h ?? 1;
    return 0.15;
  }
  if (lane.kind === 'pathway') return lane.variant === 'deck' ? 0.42 : 0.02;
  if (lane.kind === 'planting') return 0.15;
  return lane.h ?? kind.h ?? 0;
}

/**
 * Compact SVG elevation of a lane stack: kerb heights, lane widths and surface
 * colours, drawn to scale so profiles can be compared at a glance.
 */
export default function CrossSectionPreview({
  lanes,
  width = 132,
  height = 46,
  showLabels = false,
  highlightIndex = -1,
  onLaneClick = null,
}) {
  const safeLanes = lanes || [];
  const total = safeLanes.reduce((sum, lane) => sum + (lane.width || 0), 0) || 1;
  const scale = width / total;
  const maxHeight = Math.max(0.16, ...safeLanes.map(laneHeight));
  const heightScale = (height - 12) / maxHeight;
  const baseline = height - 8;

  let cursor = 0;
  const placed = safeLanes.map((lane) => {
    const entry = { lane, x: cursor, w: (lane.width || 0) * scale, h: laneHeight(lane) * heightScale };
    cursor += entry.w;
    return entry;
  });

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', flexShrink: 0 }}>
      <line x1="0" y1={baseline + 0.5} x2={width} y2={baseline + 0.5} stroke="#2a3036" strokeWidth="1" />
      {placed.map(({ lane, x, w, h }, index) => {
        const y = baseline - h;
        const raised = h > 1.5;
        const direction = lane.dir || 0;
        return (
          <g
            key={index}
            onClick={onLaneClick ? () => onLaneClick(index) : undefined}
            style={onLaneClick ? { cursor: 'pointer' } : undefined}
          >
            <rect
              x={x}
              y={y}
              width={Math.max(w - 0.6, 0.8)}
              height={Math.max(h, 2)}
              fill={laneColor(lane.kind)}
              stroke={index === highlightIndex ? '#63d6ff' : raised ? '#0e0f10' : 'none'}
              strokeWidth={index === highlightIndex ? 1.2 : 0.6}
              rx={0.8}
            />
            {direction !== 0 && w > 7 ? (
              <text
                x={x + w / 2}
                y={baseline - 3}
                textAnchor="middle"
                fontSize="7"
                fill="#c8ced4"
                opacity="0.8"
                style={{ pointerEvents: 'none' }}
              >
                {direction > 0 ? '›' : '‹'}
              </text>
            ) : null}
            {showLabels && w > 16 ? (
              <text
                x={x + w / 2}
                y={baseline + 7}
                textAnchor="middle"
                fontSize="5.5"
                fill="#6d767e"
                style={{ pointerEvents: 'none' }}
              >
                {(lane.width || 0).toFixed(1)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
