const CopyPoint = (Point) => [...Point];

const RoadRecord = (Id, Name, Start, End, ControlStart, ControlEnd, Options = {}) => ({
  id: Id,
  name: Name,
  start: Start,
  end: End,
  controlStart: CopyPoint(ControlStart),
  controlEnd: CopyPoint(ControlEnd),
  laneCount: 4,
  laneWidth: 3.5,
  median: 1.2,
  shoulder: 0.45,
  sidewalk: 2.2,
  curbHeight: 0.16,
  speedLimit: 50,
  roadClass: 'urban',
  markings: true,
  crosswalks: true,
  guardrail: false,
  parking: false,
  billboard: false,
  potholes: false,
  speedBumps: false,
  construction: false,
  trafficSide: 'left',
  structure: 'surface',
  deckHeight: 8.8,
  tunnelDepth: 6,
  ...Options,
});

export function CreateStarterProject() {
  const Nodes = [
    { id: 'node-west', name: 'West Approach', position: [-128, 0, 0], radius: 9, kind: 'terminal', signalized: false, crossings: false },
    { id: 'node-core', name: 'Meridian Square', position: [0, 0, 0], radius: 11, kind: 'four-way', signalized: true, crossings: true },
    { id: 'node-east', name: 'East Arterial', position: [122, 0, 0], radius: 8, kind: 'bend', signalized: false, crossings: false },
    { id: 'node-north', name: 'North Approach', position: [0, 0, -105], radius: 8, kind: 'terminal', signalized: false, crossings: false },
    { id: 'node-south', name: 'South Approach', position: [0, 0, 112], radius: 8, kind: 'terminal', signalized: false, crossings: false },
    { id: 'node-merge', name: 'Harbor Merge', position: [211, 0, 0], radius: 10, kind: 'merge', signalized: false, crossings: false },
    { id: 'node-merge-n', name: 'North Ramp Terminal', position: [170, 0, -69], radius: 6, kind: 'terminal', signalized: false, crossings: false },
    { id: 'node-merge-s', name: 'South Ramp Terminal', position: [170, 0, 69], radius: 6, kind: 'terminal', signalized: false, crossings: false },
    { id: 'node-freeway-a', name: 'Flyover Entry', position: [-94, 0, -86], radius: 6, kind: 'terminal', signalized: false, crossings: false },
    { id: 'node-freeway-b', name: 'Flyover Exit', position: [94, 0, 86], radius: 6, kind: 'terminal', signalized: false, crossings: false },
  ];
  const Roads = [
    RoadRecord('road-west', 'Meridian Ave · west', 'node-west', 'node-core', [-82, 0, 0], [-35, 0, 0], { laneCount: 4, roadClass: 'arterial', sidewalk: 2.4, parking: true }),
    RoadRecord('road-east', 'Meridian Ave · east', 'node-core', 'node-east', [37, 0, 0], [82, 0, 0], { laneCount: 4, roadClass: 'arterial', sidewalk: 2.4, parking: true }),
    RoadRecord('road-north', 'Civic Blvd · north', 'node-north', 'node-core', [0, 0, -69], [0, 0, -27], { laneCount: 4, roadClass: 'arterial', sidewalk: 2.2 }),
    RoadRecord('road-south', 'Civic Blvd · south', 'node-core', 'node-south', [0, 0, 34], [0, 0, 74], { laneCount: 4, roadClass: 'arterial', sidewalk: 2.2, speedBumps: true }),
    RoadRecord('road-harbor', 'Harbor Link', 'node-east', 'node-merge', [150, 0, 0], [183, 0, 0], { laneCount: 3, laneWidth: 3.55, median: 0.8, shoulder: 0.8, roadClass: 'arterial', speedLimit: 60, sidewalk: 1.8 }),
    RoadRecord('road-ramp-n', 'North slip ramp', 'node-merge-n', 'node-merge', [184, 0, -55], [190, 0, -17], { laneCount: 1, laneWidth: 4.0, median: 0, shoulder: 0.9, roadClass: 'ramp', speedLimit: 35, sidewalk: 0, guardrail: true, trafficSide: 'left' }),
    RoadRecord('road-ramp-s', 'South slip ramp', 'node-merge-s', 'node-merge', [185, 0, 58], [191, 0, 20], { laneCount: 1, laneWidth: 4.0, median: 0, shoulder: 0.9, roadClass: 'ramp', speedLimit: 35, sidewalk: 0, guardrail: true, trafficSide: 'left' }),
    RoadRecord('road-flyover', 'North–South flyover', 'node-freeway-a', 'node-freeway-b', [-42, 0, -38], [42, 0, 38], { laneCount: 4, laneWidth: 3.65, median: 1.4, shoulder: 1.2, roadClass: 'motorway', speedLimit: 90, sidewalk: 0, deckHeight: 8.8, guardrail: true, structure: 'bridge', trafficSide: 'left' }),
  ];
  return {
    id: 'meridian-district',
    name: 'Meridian District · Phase 02',
    units: 'metres',
    trafficSide: 'left',
    nodes: Nodes,
    roads: Roads,
    railRoutes: [{
      id: 'rail-civic',
      name: 'Civic commuter line',
      start: [-150, 0, -53],
      controlStart: [-55, 0, -53],
      controlEnd: [55, 0, -53],
      end: [150, 0, -53],
      gauge: 1.435,
      trackCount: 1,
      speedLimit: 65,
      electrified: true,
      crossings: true,
    }],
    revision: 1,
  };
}

export function CloneProject(Project) {
  return structuredClone(Project);
}

export function ReplaceRoad(Project, RoadId, Patch) {
  return {
    ...Project,
    revision: Project.revision + 1,
    roads: Project.roads.map((Road) => Road.id === RoadId ? { ...Road, ...Patch } : Road),
  };
}

export function ReplaceNode(Project, NodeId, Patch) {
  return {
    ...Project,
    revision: Project.revision + 1,
    nodes: Project.nodes.map((Node) => Node.id === NodeId ? { ...Node, ...Patch } : Node),
  };
}

export function ReplaceRailRoute(Project, RailId, Patch) {
  return {
    ...Project,
    revision: Project.revision + 1,
    railRoutes: (Project.railRoutes || []).map((Rail) => Rail.id === RailId ? { ...Rail, ...Patch } : Rail),
  };
}

export function MoveNode(Project, NodeId, Position) {
  const Target = Project.nodes.find((Node) => Node.id === NodeId);
  if (!Target) return Project;
  const Delta = [Position[0] - Target.position[0], Position[1] - Target.position[1], Position[2] - Target.position[2]];
  return {
    ...Project,
    revision: Project.revision + 1,
    nodes: Project.nodes.map((Node) => Node.id === NodeId ? { ...Node, position: CopyPoint(Position) } : Node),
    roads: Project.roads.map((Road) => {
      const MovedStart = Road.start === NodeId;
      const MovedEnd = Road.end === NodeId;
      if (!MovedStart && !MovedEnd) return Road;
      return {
        ...Road,
        controlStart: MovedStart ? Road.controlStart.map((Value, Index) => Value + Delta[Index]) : Road.controlStart,
        controlEnd: MovedEnd ? Road.controlEnd.map((Value, Index) => Value + Delta[Index]) : Road.controlEnd,
      };
    }),
  };
}

export function CreateRoadFromAnchors(Project, Anchors) {
  if (Anchors.length < 2) return Project;
  const Next = CloneProject(Project);
  const AddedNodes = [];
  const AnchorNodes = Anchors.map((Position, Index) => {
    const Existing = Next.nodes
      .map((Node) => ({ Node, Distance: Math.hypot(Node.position[0] - Position[0], Node.position[2] - Position[2]) }))
      .filter((Entry) => Entry.Distance < 7.5)
      .sort((A, B) => A.Distance - B.Distance)[0]?.Node;
    if (Existing) return Existing;
    const Created = {
      id: `node-${crypto.randomUUID()}`,
      name: `Anchor ${String(Index + 1).padStart(2, '0')}`,
      position: CopyPoint(Position),
      radius: 8,
      kind: 'four-way',
      signalized: false,
      crossings: false,
    };
    AddedNodes.push(Created);
    return Created;
  });
  const NewRoads = [];
  for (let Index = 0; Index < AnchorNodes.length - 1; Index++) {
    const Start = AnchorNodes[Index];
    const End = AnchorNodes[Index + 1];
    if (Start.id === End.id) continue;
    const Previous = AnchorNodes[Math.max(0, Index - 1)];
    const Following = AnchorNodes[Math.min(AnchorNodes.length - 1, Index + 2)];
    const Delta = [End.position[0] - Start.position[0], End.position[1] - Start.position[1], End.position[2] - Start.position[2]];
    const Chord = Math.hypot(Delta[0], Delta[2]);
    const PreviousVector = [End.position[0] - Previous.position[0], 0, End.position[2] - Previous.position[2]];
    const FollowingVector = [Following.position[0] - Start.position[0], 0, Following.position[2] - Start.position[2]];
    const PreviousLength = Math.hypot(PreviousVector[0], PreviousVector[2]) || 1;
    const FollowingLength = Math.hypot(FollowingVector[0], FollowingVector[2]) || 1;
    const Handle = Math.min(Chord * 0.34, 24);
    const ControlStart = Start.position.map((Value, Axis) => Value + (Axis === 1 ? Delta[Axis] * 0.22 : PreviousVector[Axis] / PreviousLength * Handle));
    const ControlEnd = End.position.map((Value, Axis) => Value - (Axis === 1 ? Delta[Axis] * 0.22 : FollowingVector[Axis] / FollowingLength * Handle));
    NewRoads.push(RoadRecord(`road-${crypto.randomUUID()}`, `New spline ${String(Index + 1).padStart(2, '0')}`, Start.id, End.id, ControlStart, ControlEnd, { laneCount: 2, roadClass: 'urban' }));
  }
  if (NewRoads.length === 0) return Project;
  Next.nodes.push(...AddedNodes);
  Next.roads.push(...NewRoads);
  Next.revision += 1;
  return Next;
}

export function CreateJunctionPreset(Project, CenterPosition) {
  const Id = crypto.randomUUID();
  const Center = {
    id: `node-junction-${Id}`,
    name: `New junction ${Project.nodes.filter((Node) => Node.name.startsWith('New junction')).length + 1}`,
    position: CopyPoint(CenterPosition),
    radius: 8,
    kind: 'four-way',
    signalized: false,
    crossings: true,
  };
  const Directions = [
    { name: 'west', vector: [-1, 0] },
    { name: 'east', vector: [1, 0] },
    { name: 'north', vector: [0, -1] },
    { name: 'south', vector: [0, 1] },
  ];
  const Arms = [];
  const Roads = [];
  for (const Direction of Directions) {
    const Length = 34;
    const Position = [CenterPosition[0] + Direction.vector[0] * Length, CenterPosition[1], CenterPosition[2] + Direction.vector[1] * Length];
    const Node = { id: `node-arm-${crypto.randomUUID()}`, name: `${Direction.name} arm`, position: Position, radius: 5, kind: 'terminal', signalized: false, crossings: false };
    Arms.push(Node);
    const Handle = 12;
    const ControlStart = [Position[0] - Direction.vector[0] * Handle, Position[1], Position[2] - Direction.vector[1] * Handle];
    const ControlEnd = [CenterPosition[0] + Direction.vector[0] * Handle, CenterPosition[1], CenterPosition[2] + Direction.vector[1] * Handle];
    Roads.push(RoadRecord(`road-junction-${crypto.randomUUID()}`, `${Center.name} · ${Direction.name}`, Node.id, Center.id, ControlStart, ControlEnd, {
      laneCount: 2,
      laneWidth: 3.35,
      median: 0.4,
      shoulder: 0.4,
      sidewalk: 1.7,
      roadClass: 'urban',
      speedLimit: 40,
    }));
  }
  return {
    ...Project,
    revision: Project.revision + 1,
    nodes: [...Project.nodes, Center, ...Arms],
    roads: [...Project.roads, ...Roads],
  };
}

export const SceneLayerDefaults = [
  { id: 'road', name: 'Road surfaces', enabled: true, color: '#5d6265' },
  { id: 'pavement', name: 'Footways & curbs', enabled: true, color: '#9a9b96' },
  { id: 'markings', name: 'Road markings', enabled: true, color: '#e7e1d4' },
  { id: 'infrastructure', name: 'Roadside infrastructure', enabled: true, color: '#cb9963' },
  { id: 'rail', name: 'Rail & underpass', enabled: true, color: '#647e8a' },
  { id: 'traffic', name: 'AI traffic · 0 / 25', enabled: false, color: '#cc735a' },
  { id: 'blocks', name: 'Open city blocks', enabled: true, color: '#647666' },
];

export const TextureLayerDefaults = [
  { id: 'wearing', name: 'Wearing course · AC 14', type: 'Asphalt', enabled: true, opacity: 1, roughness: 0.88, color: '#ffffff', repeatX: 1, repeatY: 1, selected: true },
  { id: 'aggregate', name: 'Fine aggregate', type: 'Micro normal', enabled: true, opacity: 0.72, roughness: 0.96, color: '#70716c' },
  { id: 'repaired', name: 'Repair patches', type: 'Decal atlas', enabled: true, opacity: 0.38, roughness: 0.92, color: '#25292c' },
  { id: 'marking', name: 'Thermoplastic markings', type: 'Lane paint', enabled: true, opacity: 1, roughness: 0.58, color: '#ece7d5' },
  { id: 'damp', name: 'Dampness variation', type: 'Wetness', enabled: false, opacity: 0.24, roughness: 0.32, color: '#7e8a8e' },
  { id: 'paving', name: 'Granite footway', type: 'Paving', enabled: true, opacity: 1, roughness: 0.84, color: '#ffffff' },
];
