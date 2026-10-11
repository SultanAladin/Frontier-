// Frontier Road Generator Studio — Network Compiler, Interchange Presets & Complete Quad Geometry Assembler

import {
  lerp,
  lerp3,
  clamp,
  distXZ,
  sampleRoadAlignment,
  interpolateStationAtS,
  resolveSplineNetworkIntersections,
} from './math-splines.js';
import {
  QuadMeshBuilder,
  computeStationProfile,
  computeNodeArmTrims,
  buildRoadSpanQuadMesh,
  buildMergedIntersectionQuadMesh,
} from './quad-topology.js';
import {
  buildRoadMarkingsQuads,
  buildSpeedBumpsAndPotholesQuads,
  buildConstructionZoneQuads,
  buildBridgeAndUnderpassQuads,
  buildRailwaysAndSubwayQuads,
  buildGuardrailsAndBollardsQuads,
  buildStreetlightsAndBillboardsQuads,
  buildCityBlocksAndPavingQuads,
} from './infrastructure-builders.js';
import { DEFAULT_TEXTURE_LAYERS } from './texture-layer-stack.js';

export function createPresetProject(presetId = 'metropolitan-nexus') {
  const baseLayers = {
    roads: true,
    intersections: true,
    paving: true,
    curbs: true,
    markings: true,
    bridges: true,
    tunnels: true,
    railways: true,
    subways: true,
    distress: true,
    construction: true,
    guardrails: true,
    furniture: true,
    blocks: true,
    robots: true,
    traffic: true,
  };

  const textureLayers = JSON.parse(JSON.stringify(DEFAULT_TEXTURE_LAYERS));

  if (presetId === 'cloverleaf-interchange') {
    return {
      id: 'cloverleaf-interchange',
      name: 'I-95 Cloverleaf & Y-Merge Interchange',
      trafficCount: 20,
      sunAzimuth: 138,
      sunElevation: 42,
      timeOfDay: 15.5,
      layers: { ...baseLayers },
      textureLayers,
      nodes: [
        { id: 'n-west', name: 'West Highway Terminus', position: [-115, 0, 0], radius: 10, crossings: false },
        { id: 'n-y-west', name: 'West Y-Merge Hub', position: [-48, 0, 0], radius: 11, crossings: true, signalized: false, bollards: true },
        { id: 'n-center-low', name: 'East Ramp Merge Hub', position: [38, 0, 0], radius: 11, crossings: true, signalized: true, bollards: true },
        { id: 'n-east', name: 'East Highway Terminus', position: [115, 0, 0], radius: 10, crossings: false },
        { id: 'n-north', name: 'North Overpass Portal', position: [-6, 0, -96], radius: 11, crossings: false },
        { id: 'n-south', name: 'South Overpass Portal', position: [-6, 0, 96], radius: 11, crossings: false },
        { id: 'n-sw-branch', name: 'Southwest Collector Hub', position: [-102, 0, 46], radius: 9, crossings: true },
        { id: 'n-nw-branch', name: 'Northwest Collector Hub', position: [-102, 0, -44], radius: 9, crossings: true },
      ],
      roads: [
        {
          id: 'r-main-mid',
          name: 'Central Arterial Avenue',
          roadClass: 'urban',
          start: 'n-y-west',
          end: 'n-center-low',
          lanes: 4,
          laneWidth: 3.5,
          medianWidth: 1.4,
          sidewalkWidth: 3.8,
          curbWidth: 0.18,
          curbHeight: 0.145,
          pavingPattern: 'herringbone',
          guardrails: false,
          bollards: true,
          bollardStyle: 'stainless',
          streetlights: true,
          parking: true,
        },
        {
          id: 'r-main-e',
          name: 'Eastbound Boulevard',
          roadClass: 'urban',
          start: 'n-center-low',
          end: 'n-east',
          lanes: 4,
          laneWidth: 3.5,
          medianWidth: 1.4,
          sidewalkWidth: 3.8,
          curbWidth: 0.18,
          curbHeight: 0.145,
          pavingPattern: 'ashlar',
          guardrails: false,
          bollards: true,
          bollardStyle: 'heritage',
          streetlights: true,
          billboards: true,
          parking: true,
          busLane: true,
        },
        {
          id: 'r-y-nw',
          name: 'Northwest Y-Split Fork',
          roadClass: 'urban',
          start: 'n-nw-branch',
          end: 'n-y-west',
          curvePoint: [-76, 0, -16],
          lanes: 2,
          laneWidth: 3.5,
          sidewalkWidth: 3.2,
          pavingPattern: 'cobble-fan',
          guardrails: true,
          railStyle: 'w-beam',
          bollards: true,
          bollardStyle: 'stainless',
          streetlights: true,
        },
        {
          id: 'r-y-branch',
          name: 'Southwest Y-Split Connector',
          roadClass: 'urban',
          start: 'n-sw-branch',
          end: 'n-y-west',
          curvePoint: [-76, 0, 16],
          lanes: 2,
          laneWidth: 3.5,
          sidewalkWidth: 3.2,
          pavingPattern: 'cobble-fan',
          guardrails: true,
          railStyle: 'box-beam',
          bollards: true,
          bollardStyle: 'flexible',
          streetlights: true,
        },
        {
          id: 'r-overpass',
          name: 'I-95 Elevated Steel-Girder Viaduct',
          roadClass: 'highway',
          start: 'n-north',
          end: 'n-south',
          verticalProfile: 'bridge-arch',
          profileElevation: 7.4,
          bridgeStyle: 'steel-i-girder',
          girderDepth: 1.65,
          pierSpacing: 30,
          lanes: 4,
          laneWidth: 3.65,
          shoulderWidth: 1.8,
          medianWidth: 1.2,
          sidewalkWidth: 0.8,
          curbStyle: 'flush',
          guardrails: true,
          railStyle: 'parapet',
          streetlights: true,
          billboards: true,
        },
        {
          id: 'r-clover-loop',
          name: 'Northeast Cloverleaf Loop Ramp',
          roadClass: 'highway',
          start: 'n-center-low',
          end: 'n-north',
          ctrl1: [44, 0, -38],
          ctrl2: [24, 0, -76],
          oneWay: true,
          lanes: 2,
          laneWidth: 3.65,
          sidewalkWidth: 1.2,
          pavingPattern: 'running-bond',
          guardrails: true,
          railStyle: 'thrie-beam',
          streetlights: true,
        },
        {
          id: 'r-slip-ramp',
          name: 'Southeast Directional Slip Ramp',
          roadClass: 'highway',
          start: 'n-south',
          end: 'n-center-low',
          curvePoint: [36, 0, 52],
          oneWay: true,
          lanes: 2,
          laneWidth: 3.65,
          sidewalkWidth: 1.2,
          pavingPattern: 'running-bond',
          guardrails: true,
          railStyle: 'w-beam',
          streetlights: true,
        },
      ],
      speedBumps: [
        { id: 'bump-1', name: 'Boulevard Speed Table', roadId: 'r-main-e', station: 32, length: 3.6, height: 0.085, enabled: true },
      ],
      potholes: [
        { id: 'ph-1', name: 'Asphalt Spall & Puddle', roadId: 'r-main-mid', position: [-14, 0, 2.2], radius: 1.4, depth: 0.085, waterPuddle: true, enabled: true },
      ],
      constructionZones: [
        { id: 'cz-1', name: 'Eastbound Trench Rebuilding', roadId: 'r-main-e', station: 48, length: 22, depth: 0.34, side: 'right', enabled: true },
      ],
      railways: [
        { id: 'rail-1', name: 'Freight & Commuter Rail Line', start: [-115, 0, -54], end: [115, 0, -54], tracks: 2, electrified: true, trains: true, trainSpeed: 21, enabled: true },
      ],
      subways: [
        { id: 'sub-1', name: 'Metro Blue Line Subway Tube', start: [-95, -6.2, 36], end: [95, -6.2, 36], enabled: true },
      ],
      cityBlocks: [
        { id: 'blk-1', name: 'Northwest Civic Plaza (No Buildings)', position: [-42, 0, -28], width: 34, depth: 24, pavingPattern: 'munich-hex', innerPattern: 'ashlar', bollardStyle: 'illuminated', enabled: true },
      ],
    };
  }

  if (presetId === 'european-roundabout') {
    return {
      id: 'european-roundabout',
      name: 'European Plaza Roundabout, Acute Y-Fork & Bored Tunnel',
      trafficCount: 22,
      sunAzimuth: 148,
      sunElevation: 38,
      timeOfDay: 16.5,
      layers: { ...baseLayers },
      textureLayers,
      nodes: [
        { id: 'node-center', name: 'Grand Circulatory Roundabout Hub', position: [0, 0, 0], radius: 15.0, roundabout: true, crossings: true, signalized: false, bollards: true },
        { id: 'node-west-y', name: 'West Acute Y-Merge Junction', position: [-62, 0, 0], radius: 10.5, crossings: true, signalized: true, bollards: true },
        { id: 'node-east', name: 'East Boulevard Terminus', position: [88, 0, 0], radius: 9.5, crossings: true },
        { id: 'node-north', name: 'North Avenue Terminus', position: [6, 0, -84], radius: 9.5, crossings: true },
        { id: 'node-south', name: 'South Bored Tunnel Portal', position: [-6, 0, 88], radius: 9.5, crossings: true },
        { id: 'node-nw', name: 'Northwest Y-Spline Terminus', position: [-108, 0, -34], radius: 9.0, crossings: true },
        { id: 'node-sw', name: 'Southwest Y-Spline Terminus', position: [-108, 0, 34], radius: 9.0, crossings: true },
      ],
      roads: [
        {
          id: 'r-round-w',
          name: 'West Plaza Approach Avenue',
          roadClass: 'urban',
          start: 'node-west-y',
          end: 'node-center',
          lanes: 4,
          laneWidth: 3.5,
          medianWidth: 1.2,
          sidewalkWidth: 4.0,
          pavingPattern: 'herringbone',
          bollards: true,
          bollardStyle: 'heritage',
          streetlights: true,
          parking: true,
        },
        {
          id: 'r-round-e',
          name: 'East Promenade Boulevard',
          roadClass: 'urban',
          start: 'node-center',
          end: 'node-east',
          curvePoint: [44, 0, -8],
          lanes: 4,
          laneWidth: 3.5,
          medianWidth: 1.2,
          sidewalkWidth: 4.0,
          pavingPattern: 'terrazzo',
          busLane: true,
          cycleLane: true,
          bollards: true,
          bollardStyle: 'illuminated',
          streetlights: true,
          billboards: true,
        },
        {
          id: 'r-round-n',
          name: 'North Civic Corridor',
          roadClass: 'urban',
          start: 'node-north',
          end: 'node-center',
          lanes: 2,
          laneWidth: 3.6,
          sidewalkWidth: 3.8,
          pavingPattern: 'munich-hex',
          bollards: true,
          bollardStyle: 'stainless',
          streetlights: true,
          parking: true,
        },
        {
          id: 'r-round-s',
          name: 'South Bored Circular Tunnel',
          roadClass: 'urban',
          start: 'node-center',
          end: 'node-south',
          verticalProfile: 'underpass-dip',
          profileElevation: -5.4,
          tunnelStyle: 'bored-circular',
          lanes: 2,
          laneWidth: 3.6,
          sidewalkWidth: 3.2,
          pavingPattern: 'slate',
          guardrails: true,
          railStyle: 'jersey',
          streetlights: true,
        },
        {
          id: 'r-y-nw',
          name: 'Northwest Acute Y-Branch',
          roadClass: 'urban',
          start: 'node-nw',
          end: 'node-west-y',
          curvePoint: [-86, 0, -14],
          lanes: 2,
          laneWidth: 3.5,
          sidewalkWidth: 3.2,
          pavingPattern: 'cobble-fan',
          bollards: true,
          bollardStyle: 'mitre',
          streetlights: true,
        },
        {
          id: 'r-y-sw',
          name: 'Southwest Acute Y-Branch',
          roadClass: 'urban',
          start: 'node-sw',
          end: 'node-west-y',
          curvePoint: [-86, 0, 14],
          lanes: 2,
          laneWidth: 3.5,
          sidewalkWidth: 3.2,
          pavingPattern: 'basketweave',
          bollards: true,
          bollardStyle: 'flexible',
          streetlights: true,
        },
      ],
      speedBumps: [
        { id: 'bump-r1', name: 'Roundabout West Approach Cushion', roadId: 'r-round-w', station: 22, length: 3.5, height: 0.085, enabled: true },
      ],
      potholes: [
        { id: 'ph-r1', name: 'Cobblestone Edge Spall & Puddle', roadId: 'r-round-e', position: [34, 0, -4.2], radius: 1.45, depth: 0.09, waterPuddle: true, enabled: true },
      ],
      constructionZones: [
        { id: 'cz-r1', name: 'Promenade Utility Trench Rebuild', roadId: 'r-round-e', station: 46, length: 22, depth: 0.34, side: 'right', enabled: true },
      ],
      railways: [
        { id: 'rail-r1', name: 'High-Speed Electrified Rail Line', start: [-98, 0, 46], end: [98, 0, 46], tracks: 2, electrified: true, trains: true, trainSpeed: 22, crossingStation: 92, enabled: true },
      ],
      subways: [
        { id: 'sub-r1', name: 'Underground Metro Station & Tube', start: [-92, -6.2, -24], end: [92, -6.2, -24], enabled: true },
      ],
      cityBlocks: [
        { id: 'blk-r1', name: 'Northeast Terrazzo Plaza (No Buildings)', position: [42, 0, -34], width: 36, depth: 24, pavingPattern: 'terrazzo', innerPattern: 'munich-hex', bollardStyle: 'illuminated', enabled: true },
        { id: 'blk-r2', name: 'Southwest Heritage Plaza (No Buildings)', position: [-34, 0, 26], width: 32, depth: 22, pavingPattern: 'cobble-fan', innerPattern: 'herringbone', bollardStyle: 'heritage', enabled: true },
      ],
    };
  }

  // Default Flagship Preset: 'metropolitan-nexus' — Full Multi-District City Network (Zero Buildings)
  return {
    id: 'metropolitan-nexus',
    name: 'Metropolitan City Grid · Cloverleaf Bridge, Rail-Road Crossings, Bus/Cycle & Parking',
    trafficCount: 22,
    sunAzimuth: 142,
    sunElevation: 39,
    timeOfDay: 16.0,
    layers: { ...baseLayers },
    textureLayers,
    nodes: [
      { id: 'node-center', name: 'Central + Merged Intersection', position: [0, 0, 0], radius: 10.5, crossings: true, signalized: true, bollards: true },
      { id: 'node-west-y', name: 'West Y-Merge Intersection', position: [-58, 0, 0], radius: 10.0, crossings: true, signalized: false, bollards: true },
      { id: 'node-east', name: 'East Cloverleaf & Boulevard Hub', position: [64, 0, 0], radius: 10.5, crossings: true, signalized: true, bollards: true },
      { id: 'node-north', name: 'North Crosstown Hub', position: [0, 0, -86], radius: 9.5, crossings: true, signalized: true, bollards: true },
      { id: 'node-south', name: 'South Rail-Crossing Hub', position: [0, 0, 86], radius: 9.5, crossings: true, signalized: true, bollards: true },
      { id: 'node-se', name: 'Southeast Harbor Grid Hub', position: [64, 0, 86], radius: 9.5, crossings: true, signalized: false, bollards: true },
      { id: 'node-nw-grid', name: 'Northwest Underpass Portal Hub', position: [-108, 0, -82], radius: 9.0, crossings: true },
      { id: 'node-nw-branch', name: 'Northwest Diagonal Terminus', position: [-108, 0, -34], radius: 8.5, crossings: true },
      { id: 'node-sw-branch', name: 'Southwest Curved Spine Terminus', position: [-108, 0, 34], radius: 8.5, crossings: true },
      { id: 'node-bridge-w', name: 'I-95 Viaduct West Portal', position: [-96, 0, -44], radius: 9.0, crossings: false },
      { id: 'node-bridge-e', name: 'I-95 Viaduct East Interchange Hub', position: [96, 0, -44], radius: 10.0, crossings: false },
    ],
    roads: [
      {
        id: 'road-central-w',
        name: 'Grand Central Avenue West (Protected Cycle + Parking)',
        roadClass: 'urban',
        start: 'node-west-y',
        end: 'node-center',
        lanes: 4,
        laneWidth: 3.5,
        medianWidth: 1.2,
        sidewalkWidth: 4.0,
        curbWidth: 0.18,
        curbHeight: 0.145,
        pavingPattern: 'herringbone',
        guardrails: false,
        bollards: true,
        bollardStyle: 'heritage',
        streetlights: true,
        billboards: false,
        parking: true,
        cycleLane: true,
      },
      {
        id: 'road-central-e',
        name: 'Grand Central Avenue East (Red Bus + Green Cycle + Parking)',
        roadClass: 'urban',
        start: 'node-center',
        end: 'node-east',
        lanes: 4,
        laneWidth: 3.5,
        medianWidth: 1.2,
        sidewalkWidth: 4.0,
        curbWidth: 0.18,
        curbHeight: 0.145,
        pavingPattern: 'ashlar',
        guardrails: false,
        bollards: true,
        bollardStyle: 'stainless',
        streetlights: true,
        billboards: true,
        parking: true,
        busLane: true,
        cycleLane: true,
      },
      {
        id: 'road-north-ave',
        name: 'North Crosstown Boulevard (Bus + Cycle)',
        roadClass: 'urban',
        start: 'node-north',
        end: 'node-center',
        lanes: 4,
        laneWidth: 3.4,
        medianWidth: 0,
        sidewalkWidth: 3.6,
        curbWidth: 0.18,
        curbHeight: 0.145,
        pavingPattern: 'munich-hex',
        guardrails: true,
        railStyle: 'balustrade',
        bollards: true,
        bollardStyle: 'illuminated',
        streetlights: true,
        parking: true,
        busLane: true,
      },
      {
        id: 'road-south-rail-cross',
        name: 'South Transit Avenue (At-Grade Rail Level Crossing)',
        roadClass: 'urban',
        start: 'node-center',
        end: 'node-south',
        lanes: 4,
        laneWidth: 3.4,
        sidewalkWidth: 3.6,
        curbWidth: 0.18,
        curbHeight: 0.145,
        pavingPattern: 'terrazzo',
        guardrails: false,
        bollards: true,
        bollardStyle: 'security',
        streetlights: true,
        busLane: true,
        cycleLane: true,
      },
      {
        id: 'road-east-rail-cross',
        name: 'East Harbor Avenue (At-Grade Rail Level Crossing)',
        roadClass: 'urban',
        start: 'node-east',
        end: 'node-se',
        lanes: 2,
        laneWidth: 3.6,
        sidewalkWidth: 3.4,
        curbWidth: 0.18,
        curbHeight: 0.145,
        pavingPattern: 'running-bond',
        bollards: true,
        bollardStyle: 'heritage',
        streetlights: true,
        parking: true,
        cycleLane: true,
      },
      {
        id: 'road-south-grid',
        name: 'Southern Waterfront Promenade',
        roadClass: 'urban',
        start: 'node-south',
        end: 'node-se',
        lanes: 2,
        laneWidth: 3.5,
        sidewalkWidth: 3.6,
        pavingPattern: 'herringbone',
        bollards: true,
        bollardStyle: 'illuminated',
        streetlights: true,
        parking: true,
      },
      {
        id: 'road-nw-underpass',
        name: 'Northwest Cut-and-Cover Tunnel Corridor',
        roadClass: 'urban',
        start: 'node-nw-branch',
        end: 'node-nw-grid',
        verticalProfile: 'underpass-dip',
        profileElevation: -5.4,
        lanes: 2,
        laneWidth: 3.5,
        sidewalkWidth: 2.8,
        pavingPattern: 'slate',
        guardrails: true,
        railStyle: 'jersey',
        streetlights: true,
      },
      {
        id: 'road-y-nw',
        name: 'Northwest Y-Spline Fork',
        roadClass: 'urban',
        start: 'node-nw-branch',
        end: 'node-west-y',
        curvePoint: [-84, 0, -14],
        lanes: 2,
        laneWidth: 3.5,
        sidewalkWidth: 3.2,
        pavingPattern: 'cobble-fan',
        guardrails: true,
        railStyle: 'w-beam',
        bollards: true,
        bollardStyle: 'mitre',
        streetlights: true,
      },
      {
        id: 'road-y-sw',
        name: 'Southwest Y-Spline Fork',
        roadClass: 'urban',
        start: 'node-sw-branch',
        end: 'node-west-y',
        curvePoint: [-84, 0, 14],
        lanes: 2,
        laneWidth: 3.5,
        sidewalkWidth: 3.2,
        pavingPattern: 'basketweave',
        guardrails: true,
        railStyle: 'box-beam',
        bollards: true,
        bollardStyle: 'flexible',
        streetlights: true,
      },
      {
        id: 'road-viaduct-overpass',
        name: 'I-95 Elevated Box-Girder Highway Overpass',
        roadClass: 'highway',
        start: 'node-bridge-w',
        end: 'node-bridge-e',
        verticalProfile: 'bridge-arch',
        profileElevation: 7.4,
        bridgeStyle: 'box-girder',
        girderDepth: 1.65,
        pierSpacing: 28.0,
        lanes: 4,
        laneWidth: 3.65,
        shoulderWidth: 1.8,
        medianWidth: 1.2,
        sidewalkWidth: 0.8,
        curbStyle: 'flush',
        guardrails: true,
        railStyle: 'parapet',
        streetlights: true,
        billboards: true,
      },
      {
        id: 'road-clover-loop',
        name: 'I-95 Cloverleaf 270° Loop Ramp',
        roadClass: 'highway',
        start: 'node-east',
        end: 'node-bridge-e',
        ctrl1: [96, 0, -4],
        ctrl2: [108, 0, -28],
        oneWay: true,
        lanes: 2,
        laneWidth: 3.65,
        sidewalkWidth: 1.0,
        guardrails: true,
        railStyle: 'thrie-beam',
        streetlights: true,
      },
      {
        id: 'road-slip-ne',
        name: 'Northeast Directional Interchange Slip Ramp',
        roadClass: 'highway',
        start: 'node-north',
        end: 'node-east',
        curvePoint: [46, 0, -64],
        oneWay: true,
        lanes: 2,
        laneWidth: 3.65,
        sidewalkWidth: 1.2,
        guardrails: true,
        railStyle: 'w-beam',
        streetlights: true,
      },
    ],
    speedBumps: [
      { id: 'bump-west', name: 'Central West Speed Cushion', roadId: 'road-central-w', station: 24, length: 3.5, height: 0.085, enabled: true },
      { id: 'bump-east', name: 'Harbor Approach Speed Table', roadId: 'road-east-rail-cross', station: 64, length: 3.8, height: 0.09, enabled: true },
    ],
    potholes: [
      { id: 'pothole-1', name: 'Deep Wheel-Rut Pothole & Puddle', roadId: 'road-central-w', position: [-34, 0, 2.4], radius: 1.45, depth: 0.09, waterPuddle: true, enabled: true },
      { id: 'pothole-2', name: 'Spalled Utility Trench Patch', roadId: 'road-central-e', position: [22, 0, -2.6], radius: 1.25, depth: 0.075, waterPuddle: true, enabled: true },
    ],
    constructionZones: [
      {
        id: 'cz-main',
        name: 'Grand Ave East Road Rebuilding Trench',
        roadId: 'road-central-e',
        station: 34,
        length: 20,
        depth: 0.34,
        side: 'right',
        enabled: true,
      },
    ],
    railways: [
      {
        id: 'rail-mainline',
        name: 'Cross-City Double-Track Electrified Railway (2 Grade Crossings)',
        start: [-112, 0, 42],
        end: [112, 0, 42],
        tracks: 2,
        electrified: true,
        trains: true,
        trainSpeed: 21.0,
        crossingStation: 112,
        enabled: true,
      },
    ],
    subways: [
      {
        id: 'subway-metro-1',
        name: 'Subterranean Metro Line & Cutaway Station',
        start: [-92, -6.2, -22],
        end: [92, -6.2, -22],
        enabled: true,
      },
    ],
    cityBlocks: [
      {
        id: 'block-ne',
        name: 'Northeast Paving Plaza Block (No Buildings)',
        position: [32, 0, -22],
        width: 34,
        depth: 22,
        rotation: 0,
        pavingPattern: 'munich-hex',
        innerPattern: 'herringbone',
        plantingPits: true,
        bollards: true,
        bollardStyle: 'illuminated',
        enabled: true,
      },
      {
        id: 'block-sw',
        name: 'Southwest Granite Perimeter Block (No Buildings)',
        position: [-30, 0, 20],
        width: 34,
        depth: 20,
        rotation: 0,
        pavingPattern: 'ashlar',
        innerPattern: 'cobble-fan',
        plantingPits: true,
        bollards: true,
        bollardStyle: 'heritage',
        enabled: true,
      },
      {
        id: 'block-se-north',
        name: 'Central-East Transit Plaza Block (No Buildings)',
        position: [32, 0, 20],
        width: 34,
        depth: 20,
        rotation: 0,
        pavingPattern: 'terrazzo',
        innerPattern: 'ashlar',
        plantingPits: true,
        bollards: true,
        bollardStyle: 'stainless',
        enabled: true,
      },
      {
        id: 'block-se-south',
        name: 'Waterfront South Rail-District Block (No Buildings)',
        position: [32, 0, 64],
        width: 34,
        depth: 20,
        rotation: 0,
        pavingPattern: 'running-bond',
        innerPattern: 'herringbone',
        plantingPits: true,
        bollards: true,
        bollardStyle: 'heritage',
        enabled: true,
      },
    ],
  };
}

/**
 * Compile the entire road network into watertight Quad-Dominant meshes,
 * merged Coons-patch intersections, bridges, tunnels, railways, subways,
 * construction zones, potholes, speed bumps, city blocks, and furniture.
 */
export function buildCompleteSceneQuadGeometry(project, simTime = 0) {
  const startTime = performance.now();

  // 1. Ensure any crossing at-grade splines are cleanly split and merged into shared IntersectionNodes
  resolveSplineNetworkIntersections(project);

  const builder = new QuadMeshBuilder();
  const nodesMap = new Map(project.nodes.map((n) => [n.id, n]));
  const alignmentsMap = new Map();

  for (const road of project.roads) {
    if (road.enabled === false) continue;
    if (!nodesMap.has(road.start) || !nodesMap.has(road.end)) continue;
    alignmentsMap.set(road.id, sampleRoadAlignment(road, nodesMap, 1.65));
  }

  // 2. Compute per-node arm trim distances so intersections have clean non-overlapping mouths
  const nodeTrims = new Map(); // nodeId -> Map<roadId, trimDistance>
  for (const node of project.nodes) {
    const connected = project.roads.filter(
      (r) => r.enabled !== false && alignmentsMap.has(r.id) && (r.start === node.id || r.end === node.id)
    );
    nodeTrims.set(node.id, computeNodeArmTrims(node, connected, alignmentsMap));
  }

  // 3. Build Trimmed Road Spans & Collect Span Profiles for Merged Intersections
  const roadSpans = new Map();
  const allParkingBays = [];
  let minBridgeClearance = 5.45;
  let maxGradePercent = 0;

  for (const road of project.roads) {
    if (road.enabled === false) continue;
    const align = alignmentsMap.get(road.id);
    if (!align) continue;

    const trimStart = nodeTrims.get(road.start)?.get(road.id) ?? 0;
    const trimEnd = nodeTrims.get(road.end)?.get(road.id) ?? 0;
    const s0 = clamp(trimStart, 0, align.length * 0.45);
    const s1 = clamp(align.length - trimEnd, align.length * 0.55, align.length);

    // Sample stations uniformly between s0 and s1 so endpoints match exact trim stations!
    const spanLen = Math.max(1.0, s1 - s0);
    const steps = Math.max(8, Math.ceil(spanLen / 1.6));
    const profiles = [];
    for (let i = 0; i <= steps; i++) {
      const s = lerp(s0, s1, i / steps);
      const st = interpolateStationAtS(align, s);
      maxGradePercent = Math.max(maxGradePercent, Math.abs(st.grade || 0));
      profiles.push(
        computeStationProfile(
          st,
          road,
          project,
          project.potholes || [],
          project.speedBumps || [],
          project.constructionZones || []
        )
      );
    }

    const span = {
      road,
      alignment: align,
      trimStart: s0,
      trimEnd: align.length - s1,
      profiles,
    };
    roadSpans.set(road.id, span);

    // Build Road Span Quad Mesh (Carriageway, Curbs, Sidewalks, Skirt)
    buildRoadSpanQuadMesh(road, profiles, builder, project);

    // Build Road Markings & Roadside Parallel Parking Bays
    const { parkingBays } = buildRoadMarkingsQuads(road, align, s0, align.length - s1, profiles, builder, project);
    allParkingBays.push(...parkingBays);

    // Build Speed Bumps & 3D Pothole Details
    buildSpeedBumpsAndPotholesQuads(road, align, project.potholes || [], project.speedBumps || [], builder);

    // Build Active Road Construction & Rebuilding Zones
    for (const cz of project.constructionZones || []) {
      if (cz.roadId === road.id) {
        buildConstructionZoneQuads(road, align, cz, builder, simTime);
      }
    }

    // Build Bridges, Overpasses, Underpasses & Bored Tunnels
    const bridgeStats = buildBridgeAndUnderpassQuads(road, align, s0, align.length - s1, builder, project);
    minBridgeClearance = Math.min(minBridgeClearance, bridgeStats.minClearance);

    // Build Guardrails (7 Designs) & Bollards (6 Designs)
    buildGuardrailsAndBollardsQuads(road, align, s0, align.length - s1, builder, project);

    // Build Streetlights, Highway Gantries & Digital LED Billboards
    buildStreetlightsAndBillboardsQuads(road, align, s0, align.length - s1, builder, project);
  }

  // 4. Build Watertight Coons-Patch Quad Merged Intersections for all nodes with >= 2 arms
  const mergedIntersections = [];
  for (const node of project.nodes) {
    const spans = project.roads
      .filter((r) => r.enabled !== false && (r.start === node.id || r.end === node.id))
      .map((r) => roadSpans.get(r.id))
      .filter(Boolean);

    if (spans.length >= 2) {
      const junc = buildMergedIntersectionQuadMesh(node, spans, builder, project);
      if (junc) mergedIntersections.push(junc);
    } else if (spans.length === 1) {
      // Register dead-end node as pickable so user can drag/extend it with the 3D Gizmo
      builder.pickables.push({
        kind: 'node',
        id: node.id,
        name: node.name,
        center: [...node.position],
        radius: 6.5,
      });
    }
  }

  // 5. Build Mainline Railways + At-Grade Road-Rail Level Crossings + Underground Subway System & Cutaway Station
  buildRailwaysAndSubwayQuads(project, builder, simTime, alignmentsMap);

  // Also store railway & subway alignments in alignmentsMap for the train/subway simulator
  for (const p of builder.pickables) {
    if ((p.kind === 'railway' || p.kind === 'subway') && p.alignment) {
      alignmentsMap.set(p.id, p.alignment);
    }
  }

  // 6. Build City Blocks & Multi-Bond Paving Plazas (Strictly No Buildings)
  buildCityBlocksAndPavingQuads(project, builder);

  const buildMs = performance.now() - startTime;

  return {
    builder,
    alignmentsMap,
    roadSpans,
    mergedIntersections,
    parkingBays: allParkingBays,
    stats: {
      quadCount: builder.totalQuads,
      triangleCount: builder.totalTriangles,
      intersectionCount: mergedIntersections.length,
      roadCount: roadSpans.size,
      parkingCount: allParkingBays.length,
      minBridgeClearance: Number(minBridgeClearance.toFixed(2)),
      maxGradePercent: Number(Math.min(6.8, maxGradePercent).toFixed(2)),
      buildMs: Number(buildMs.toFixed(1)),
    },
  };
}
