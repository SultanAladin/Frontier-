import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowDownToLine, ArrowUpRight, Box, Check, ChevronDown,
  ChevronRight, CircleDot, Construction, Crosshair, Eye, EyeOff, Focus, Footprints,
  Grid3X3, HardHat, Layers3, Lightbulb, Map, MapPin, Menu, Move3D, PanelRight,
  PencilRuler, Plus, Redo2, Route, Save, Search, Settings2, Shield, SlidersHorizontal,
  Sparkles, TrainFront, Trash2, Undo2, X, Zap,
} from 'lucide-react';
import Viewport from './Viewport.jsx';
import {
  CreateJunctionPreset, CreateRoadFromAnchors, CreateStarterProject, ReplaceNode, ReplaceRoad, ReplaceRailRoute,
  SceneLayerDefaults, TextureLayerDefaults, MoveNode,
} from './model.js';
import { BuildRoadNetwork } from './geometry.js';
import { ClampTrafficVehicleCount, MaxTrafficVehicles } from './traffic.js';

const Cls = (...Parts) => Parts.filter(Boolean).join(' ');
const RoadClassOptions = [
  { value: 'local', label: 'Local street' },
  { value: 'urban', label: 'Urban collector' },
  { value: 'arterial', label: 'Principal arterial' },
  { value: 'ramp', label: 'Interchange ramp' },
  { value: 'motorway', label: 'Motorway' },
];
const WorkspaceTabs = [
  { id: 'roads', label: 'Road network', icon: Route },
  { id: 'surface', label: 'Surface studio', icon: Layers3 },
  { id: 'infrastructure', label: 'Infrastructure', icon: Construction },
  { id: 'traffic', label: 'Traffic', icon: Activity },
];

function ReadSavedProject() {
  try {
    const Text = localStorage.getItem('roadforge-project-v1');
    if (!Text) return CreateStarterProject();
    const Saved = JSON.parse(Text);
    if (Saved?.nodes?.length && Saved?.roads?.length) return Saved;
  } catch (Error) {
    console.warn('RoadForge could not read the last local scene.', Error);
  }
  return CreateStarterProject();
}

function IconButton({ icon: Icon, label, active = false, onClick, disabled = false, className = '' }) {
  return (
    <button className={Cls('icon-button', active && 'is-active', className)} title={label} aria-label={label} disabled={disabled} onClick={onClick}>
      <Icon size={17} strokeWidth={1.75} />
    </button>
  );
}

function SectionTitle({ title, aside, className = '' }) {
  return <div className={Cls('section-title', className)}><span>{title}</span>{aside && <span className="section-aside">{aside}</span>}</div>;
}

function Disclosure({ title, children, defaultOpen = true, aside }) {
  const [Open, setOpen] = useState(defaultOpen);
  return (
    <section className="inspector-section">
      <button className="disclosure-title" onClick={() => setOpen((Value) => !Value)}>
        {Open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>{title}</span>
        {aside && <small>{aside}</small>}
      </button>
      {Open && <div className="disclosure-content">{children}</div>}
    </section>
  );
}

function Toggle({ value, onChange, label, compact = false }) {
  return (
    <button className={Cls('toggle-row', compact && 'toggle-compact')} onClick={() => onChange(!value)} aria-pressed={value}>
      <span className={Cls('toggle-switch', value && 'on')}><i /></span>
      {label && <span>{label}</span>}
    </button>
  );
}

function SliderControl({ label, value, min, max, step = 1, unit = '', onChange, digits = 0 }) {
  const SafeValue = Math.min(max, Math.max(min, Number(value) || min));
  return (
    <label className="slider-control">
      <span className="slider-label"><span>{label}</span><span className="slider-value">{SafeValue.toFixed(digits)}{unit}</span></span>
      <input type="range" min={min} max={max} step={step} value={SafeValue} onChange={(Event) => onChange(Number(Event.target.value))} />
    </label>
  );
}

function NumericField({ label, value, unit = 'm', min = 0, max = 80, step = 0.1, onChange }) {
  return (
    <label className="numeric-field">
      <span>{label}</span>
      <span className="numeric-input-wrap">
        <input type="number" value={Number(value ?? 0)} min={min} max={max} step={step} onChange={(Event) => onChange(Number(Event.target.value))} />
        <i>{unit}</i>
      </span>
    </label>
  );
}

function SelectField({ label, value, options, onChange, className = '' }) {
  return (
    <label className={Cls('select-field', className)}>
      {label && <span>{label}</span>}
      <span className="select-wrap">
        <select value={value} onChange={(Event) => onChange(Event.target.value)}>
          {options.map((Option) => <option value={Option.value} key={Option.value}>{Option.label}</option>)}
        </select>
        <ChevronDown size={13} />
      </span>
    </label>
  );
}

function SceneLayerRow({ layer, onToggle }) {
  const Icon = layer.id === 'road' ? Route : layer.id === 'pavement' ? Footprints : layer.id === 'markings' ? PencilRuler : layer.id === 'infrastructure' ? Lightbulb : layer.id === 'rail' ? TrainFront : layer.id === 'traffic' ? Activity : Map;
  return (
    <div className={Cls('scene-layer-row', !layer.enabled && 'muted')}>
      <span className="tree-branch" />
      <Icon size={14} className="layer-type-icon" style={{ color: layer.color }} />
      <span className="layer-name">{layer.name}</span>
      {layer.id === 'traffic' && <span className="layer-count">14</span>}
      <button className="visibility-button" aria-label={`${layer.enabled ? 'Hide' : 'Show'} ${layer.name}`} onClick={onToggle}>
        {layer.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
      </button>
    </div>
  );
}

function OutlinerRoad({ road, selected, onClick }) {
  const StructureIcon = road.structure === 'bridge' ? ArrowUpRight : road.structure === 'tunnel' ? Box : Route;
  return (
    <button className={Cls('outliner-object', selected && 'selected')} onClick={onClick}>
      <span className="tree-guide" />
      <StructureIcon size={14} className={Cls('outliner-kind', road.structure === 'bridge' && 'bridge-kind')} />
      <span className="outliner-object-name">{road.name}</span>
      {road.structure === 'bridge' && <span className="outliner-tag">BRG</span>}
      {road.construction && <Construction size={13} className="warning-mark" />}
    </button>
  );
}

function OutlinerRail({ rail, selected, onClick }) {
  return (
    <button className={Cls('outliner-object', selected && 'selected')} onClick={onClick}>
      <span className="tree-guide" />
      <TrainFront size={14} className="outliner-kind rail-kind" />
      <span className="outliner-object-name">{rail.name}</span>
      {rail.electrified && <span className="outliner-tag rail-tag">OHLE</span>}
    </button>
  );
}

function TextureLayerRow({ layer, selected, onSelect, onToggle, onMove, canMoveUp, canMoveDown }) {
  return (
    <div className={Cls('texture-layer-row', selected && 'selected', !layer.enabled && 'muted')}>
      <button className="texture-layer-main" onClick={onSelect}>
        <span className="texture-swatch" style={{ background: layer.color }}><span /></span>
        <span className="texture-layer-info"><b>{layer.name}</b><small>{layer.type}</small></span>
      </button>
      <div className="texture-layer-actions">
        <button className="visibility-button" onClick={onToggle} title={layer.enabled ? 'Disable texture layer' : 'Enable texture layer'}>{layer.enabled ? <Eye size={14} /> : <EyeOff size={14} />}</button>
        <div className="layer-order-buttons">
          <button onClick={() => onMove(-1)} disabled={!canMoveUp} title="Move layer up"><ChevronDown size={11} className="order-up" /></button>
          <button onClick={() => onMove(1)} disabled={!canMoveDown} title="Move layer down"><ChevronDown size={11} /></button>
        </div>
      </div>
    </div>
  );
}

function getNodeApproachCount(Project, NodeId) {
  return Project.roads.filter((Road) => Road.start === NodeId || Road.end === NodeId).length;
}

function getNodeTypeLabel(Node, ApproachCount) {
  if (ApproachCount >= 4) return 'Four-way junction';
  if (ApproachCount === 3) return 'Three-way merge';
  if (ApproachCount === 2) return 'Spline transition';
  return 'Road terminal';
}

function App() {
  const [Project, setProject] = useState(ReadSavedProject);
  const [Selected, setSelected] = useState({ type: 'node', id: 'node-core' });
  const [Tool, setTool] = useState('select');
  const [DraftPoints, setDraftPoints] = useState([]);
  const [ActiveWorkspace, setActiveWorkspace] = useState('roads');
  const [DockTab, setDockTab] = useState('scene');
  const [SceneLayers, setSceneLayers] = useState(() => Object.fromEntries(SceneLayerDefaults.map((Layer) => [Layer.id, Layer.enabled])));
  const [TextureLayers, setTextureLayers] = useState(() => TextureLayerDefaults.map((Layer) => ({ ...Layer })));
  const [SelectedTextureId, setSelectedTextureId] = useState('wearing');
  const [TrafficEnabled, setTrafficEnabled] = useState(false);
  const [TrafficCount, setTrafficCount] = useState(14);
  const [TrainsEnabled, setTrainsEnabled] = useState(false);
  const [GridEnabled, setGridEnabled] = useState(true);
  const [Wireframe, setWireframe] = useState(false);
  const [RendererStatus, setRendererStatus] = useState('Starting WebGPU…');
  const [Saved, setSaved] = useState(false);
  const [ShowSettings, setShowSettings] = useState(false);
  const [SearchOpen, setSearchOpen] = useState(false);
  const [RightDockOpen, setRightDockOpen] = useState(true);
  const [Notice, setNotice] = useState('');
  const ViewportRef = useRef(null);
  const UndoStack = useRef([]);
  const RedoStack = useRef([]);
  const NoticeTimer = useRef(null);
  const SelectedRoad = useMemo(() => Project.roads.find((Road) => Selected?.type === 'road' && Road.id === Selected.id), [Project, Selected]);
  const SelectedNode = useMemo(() => Project.nodes.find((Node) => Selected?.type === 'node' && Node.id === Selected.id), [Project, Selected]);
  const SelectedRail = useMemo(() => (Project.railRoutes || []).find((Rail) => Selected?.type === 'rail' && Rail.id === Selected.id), [Project, Selected]);
  const SelectedTexture = TextureLayers.find((Layer) => Layer.id === SelectedTextureId) || TextureLayers[0];
  const GeometryPreview = useMemo(() => BuildRoadNetwork(Project), [Project]);
  const Settings = useMemo(() => ({
    traffic: TrafficEnabled,
    trafficCount: ClampTrafficVehicleCount(TrafficCount),
    trains: TrainsEnabled,
    grid: GridEnabled,
    wireframe: Wireframe,
    textureLayers: TextureLayers,
  }), [TrafficEnabled, TrafficCount, TrainsEnabled, GridEnabled, Wireframe, TextureLayers]);

  const Notify = useCallback((Message) => {
    setNotice(Message);
    window.clearTimeout(NoticeTimer.current);
    NoticeTimer.current = window.setTimeout(() => setNotice(''), 2800);
  }, []);

  const ChangeProject = useCallback((Updater, SaveHistory = true) => {
    setProject((Current) => {
      const Next = typeof Updater === 'function' ? Updater(Current) : Updater;
      if (Next === Current) return Current;
      if (SaveHistory) {
        UndoStack.current.push(Current);
        if (UndoStack.current.length > 40) UndoStack.current.shift();
        RedoStack.current = [];
      }
      return Next;
    });
  }, []);

  const Undo = useCallback(() => {
    if (!UndoStack.current.length) return Notify('Nothing to undo');
    const Previous = UndoStack.current.pop();
    RedoStack.current.push(Project);
    setProject(Previous);
    Notify('Undo · restored previous network');
  }, [Project, Notify]);

  const Redo = useCallback(() => {
    if (!RedoStack.current.length) return Notify('Nothing to redo');
    const Next = RedoStack.current.pop();
    UndoStack.current.push(Project);
    setProject(Next);
    Notify('Redo · reapplied network change');
  }, [Project, Notify]);

  const SaveScene = useCallback(() => {
    try {
      localStorage.setItem('roadforge-project-v1', JSON.stringify(Project));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
      Notify('Scene saved locally');
    } catch (Error) {
      Notify(`Save failed · ${Error.message}`);
    }
  }, [Project, Notify]);

  const DownloadFile = useCallback((Name, Content, Type) => {
    const Blob = new window.Blob([Content], { type: Type });
    const Url = URL.createObjectURL(Blob);
    const Anchor = document.createElement('a');
    Anchor.href = Url;
    Anchor.download = Name;
    Anchor.click();
    URL.revokeObjectURL(Url);
  }, []);

  const ExportProject = useCallback(() => {
    const SafeName = Project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'roadforge-scene';
    DownloadFile(`${SafeName}.json`, JSON.stringify(Project, null, 2), 'application/json');
    Notify('Road network exported as JSON');
  }, [Project, DownloadFile, Notify]);

  const ExportOBJ = useCallback(() => {
    const Result = BuildRoadNetwork(Project);
    const Lines = ['# Frontier RoadForge · triangulated road network export', `# ${Project.name}`, 'o RoadForge_Road_Network'];
    let VertexBase = 1;
    for (const [Name, Data] of Object.entries(Result.geometry)) {
      if (!Data) continue;
      Lines.push(`g ${Name}`);
      for (let Index = 0; Index < Data.positions.length; Index += 3) Lines.push(`v ${Data.positions[Index].toFixed(5)} ${Data.positions[Index + 1].toFixed(5)} ${Data.positions[Index + 2].toFixed(5)}`);
      for (let Index = 0; Index < Data.indices.length; Index += 3) Lines.push(`f ${Data.indices[Index] + VertexBase} ${Data.indices[Index + 1] + VertexBase} ${Data.indices[Index + 2] + VertexBase}`);
      VertexBase += Data.positions.length / 3;
    }
    DownloadFile(`${Project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.obj`, Lines.join('\n'), 'text/plain');
    Notify(`OBJ export · ${Result.stats.triangles.toLocaleString()} triangles`);
  }, [Project, DownloadFile, Notify]);

  const FinishRoad = useCallback(() => {
    if (DraftPoints.length < 2) {
      Notify('Place at least two spline anchors');
      return;
    }
    const PreviousRoadIds = new Set(Project.roads.map((Road) => Road.id));
    const Next = CreateRoadFromAnchors(Project, DraftPoints);
    if (Next === Project) {
      Notify('A road needs two distinct anchor points');
      setDraftPoints([]);
      setTool('select');
      return;
    }
    ChangeProject(Next);
    const NewRoad = Next.roads.find((Road) => !PreviousRoadIds.has(Road.id));
    if (NewRoad) setSelected({ type: 'road', id: NewRoad.id });
    setDraftPoints([]);
    setTool('select');
    Notify('Spline road generated · quad spans and merged end caps');
  }, [DraftPoints, Project, ChangeProject, Notify]);

  const CancelRoad = useCallback(() => {
    setDraftPoints([]);
    setTool('select');
    Notify('Spline draft cleared');
  }, [Notify]);

  const AddPointToDraft = useCallback((Point) => {
    let Snapped = Point;
    const Closest = Project.nodes
      .map((Node) => ({ Node, Distance: Math.hypot(Node.position[0] - Point[0], Node.position[2] - Point[2]) }))
      .filter((Entry) => Entry.Distance < 7.5)
      .sort((A, B) => A.Distance - B.Distance)[0];
    if (Closest) Snapped = [...Closest.Node.position];
    setDraftPoints((Current) => [...Current, Snapped]);
  }, [Project.nodes]);

  const MoveNodeAtRelease = useCallback((NodeId, Position) => {
    ChangeProject((Current) => MoveNode(Current, NodeId, Position));
  }, [ChangeProject]);

  const LayerOptions = useMemo(() => ({ ...SceneLayers, traffic: TrafficEnabled }), [SceneLayers, TrafficEnabled]);

  useEffect(() => {
    const OnKeyDown = (Event) => {
      const Target = Event.target;
      const IsEditing = Target instanceof HTMLElement && (Target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(Target.tagName));
      if (Event.key === 'Escape') {
        if (DraftPoints.length) CancelRoad();
        else if (SearchOpen) setSearchOpen(false);
        else setTool('select');
        return;
      }
      if ((Event.ctrlKey || Event.metaKey) && Event.key.toLowerCase() === 's') {
        Event.preventDefault();
        SaveScene();
        return;
      }
      if (!IsEditing && (Event.ctrlKey || Event.metaKey) && Event.key.toLowerCase() === 'z') {
        Event.preventDefault();
        Event.shiftKey ? Redo() : Undo();
        return;
      }
      if (!IsEditing && Event.key === 'Enter' && DraftPoints.length >= 2) {
        Event.preventDefault();
        FinishRoad();
        return;
      }
      if (IsEditing) return;
      if (Event.key.toLowerCase() === 'v') setTool('select');
      if (Event.key.toLowerCase() === 'r') setTool('road');
      if (Event.key.toLowerCase() === 'm') setTool('measure');
      if (Event.key === '/') setSearchOpen(true);
    };
    window.addEventListener('keydown', OnKeyDown);
    return () => window.removeEventListener('keydown', OnKeyDown);
  }, [DraftPoints.length, CancelRoad, SaveScene, Redo, Undo, FinishRoad, SearchOpen]);

  useEffect(() => {
    if (Selected && Selected.type === 'road' && !Project.roads.some((Road) => Road.id === Selected.id)) setSelected({ type: 'node', id: Project.nodes[0]?.id });
    if (Selected && Selected.type === 'node' && !Project.nodes.some((Node) => Node.id === Selected.id)) setSelected({ type: 'node', id: Project.nodes[0]?.id });
    if (Selected && Selected.type === 'rail' && !(Project.railRoutes || []).some((Rail) => Rail.id === Selected.id)) setSelected({ type: 'node', id: Project.nodes[0]?.id });
  }, [Project, Selected]);

  const ToggleSceneLayer = (Id) => setSceneLayers((Current) => ({ ...Current, [Id]: !Current[Id] }));
  const PatchRoad = (Patch) => SelectedRoad && ChangeProject((Current) => ReplaceRoad(Current, SelectedRoad.id, Patch));
  const PatchNode = (Patch) => SelectedNode && ChangeProject((Current) => ReplaceNode(Current, SelectedNode.id, Patch));
  const PatchRail = (Patch) => SelectedRail && ChangeProject((Current) => ReplaceRailRoute(Current, SelectedRail.id, Patch));
  const PatchTextureLayer = (Id, Patch) => setTextureLayers((Current) => Current.map((Layer) => Layer.id === Id ? { ...Layer, ...Patch } : Layer));
  const AddTextureLayer = () => {
    const Id = `custom-${crypto.randomUUID()}`;
    const Number = TextureLayers.filter((Layer) => Layer.id.startsWith('custom-')).length + 1;
    setTextureLayers((Current) => [...Current, { id: Id, name: `Surface tint ${String(Number).padStart(2, '0')}`, type: 'Color overlay', enabled: true, opacity: 0.22, roughness: 0.82, color: '#69716b' }]);
    setSelectedTextureId(Id);
    Notify('Procedural tint layer added to the surface stack');
  };
  const DeleteTextureLayer = (Id) => {
    if (!Id.startsWith('custom-')) return;
    setTextureLayers((Current) => Current.filter((Layer) => Layer.id !== Id));
    setSelectedTextureId('wearing');
    Notify('Custom material layer removed');
  };

  const MoveTextureLayer = (Id, Direction) => {
    setTextureLayers((Current) => {
      const Index = Current.findIndex((Layer) => Layer.id === Id);
      const NextIndex = Index + Direction;
      if (Index < 0 || NextIndex < 0 || NextIndex >= Current.length) return Current;
      const Next = [...Current];
      [Next[Index], Next[NextIndex]] = [Next[NextIndex], Next[Index]];
      return Next;
    });
  };

  const AddIntersection = () => {
    const X = Math.max(...Project.nodes.map((Node) => Node.position[0])) + 70;
    const Z = Math.max(...Project.nodes.map((Node) => Node.position[2])) + 30;
    const Next = CreateJunctionPreset(Project, [X, 0, Z]);
    const NewNode = Next.nodes.at(-5);
    ChangeProject(Next);
    setSelected({ type: 'node', id: NewNode.id });
    setDockTab('scene');
    setActiveWorkspace('roads');
    window.setTimeout(() => ViewportRef.current?.fitView(), 40);
    Notify('Four-arm intersection added · merged apron and crosswalks generated');
  };

  const SetWorkspace = (Id) => {
    setActiveWorkspace(Id);
    if (Id === 'surface') setDockTab('materials');
    else setDockTab('scene');
    if (Id === 'traffic') setTrafficEnabled(true);
  };

  const SelectedRoadLength = SelectedRoad && GeometryPreview.roadData.get(SelectedRoad.id)?.length;
  const SelectedNodeApproaches = SelectedNode ? getNodeApproachCount(Project, SelectedNode.id) : 0;
  const SelectedNodeDiagnostic = SelectedNode && GeometryPreview.diagnostics.find((Issue) => Issue.featureId === SelectedNode.id);

  return (
    <div className="roadforge-app">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark"><Route size={17} strokeWidth={2.1} /></div>
          <div className="brand-wordmark"><b>ROADFORGE</b><span>INFRASTRUCTURE STUDIO</span></div>
          <div className="topbar-divider" />
          <button className="project-title" onClick={() => Notify('Project settings are in the scene inspector')}>
            <span>{Project.name}</span><ChevronDown size={13} />
          </button>
          <span className="saved-pill"><i />{Saved ? 'SAVED' : 'LOCAL SCENE'}</span>
        </div>
        <div className="top-workspace-tabs">
          {WorkspaceTabs.map(({ id, label, icon: Icon }) => (
            <button key={id} className={Cls('workspace-tab', ActiveWorkspace === id && 'active')} onClick={() => SetWorkspace(id)}>
              <Icon size={14} /><span>{label}</span>
            </button>
          ))}
        </div>
        <div className="top-actions">
          <button className="top-action quiet" onClick={() => { setSearchOpen(true); }}><Search size={15} /><span>Search</span><kbd>/</kbd></button>
          <span className={Cls('renderer-chip', RendererStatus.startsWith('WebGPU') && 'good', RendererStatus.includes('fallback') && 'fallback')} title="WebGPU is preferred; WebGL is only used when the browser cannot initialize WebGPU">
            <span className="status-pulse" />{RendererStatus.startsWith('WebGPU') ? 'WEBGPU' : RendererStatus.toUpperCase().slice(0, 16)}
          </span>
          <div className="topbar-divider short" />
          <IconButton icon={Undo2} label="Undo · Ctrl+Z" onClick={Undo} disabled={!UndoStack.current.length} />
          <IconButton icon={Redo2} label="Redo · Ctrl+Shift+Z" onClick={Redo} disabled={!RedoStack.current.length} />
          <button className={Cls('save-button', Saved && 'saved')} onClick={SaveScene}><Save size={14} />{Saved ? 'Saved' : 'Save'}</button>
          <button className="export-button" onClick={ExportOBJ}><ArrowDownToLine size={15} /><span>Export mesh</span></button>
          <IconButton icon={PanelRight} label={RightDockOpen ? 'Hide right dock' : 'Show right dock'} active={RightDockOpen} onClick={() => setRightDockOpen((Value) => !Value)} />
        </div>
      </header>

      <div className="workspace-frame">
        <aside className="tool-rail">
          <div className="tool-rail-group">
            <span className="tool-rail-label">EDIT</span>
            <button className={Cls('rail-tool', Tool === 'select' && 'selected')} title="Select & transform · V" onClick={() => setTool('select')}><Crosshair size={17} /><span>SELECT</span><kbd>V</kbd></button>
            <button className={Cls('rail-tool', Tool === 'road' && 'selected')} title="Draw a spline road · R" onClick={() => { setTool('road'); setDraftPoints([]); }}><Route size={17} /><span>ROAD</span><kbd>R</kbd></button>
            <button className={Cls('rail-tool', Tool === 'measure' && 'selected')} title="Measure · M" onClick={() => setTool('measure')}><PencilRuler size={17} /><span>MEASURE</span><kbd>M</kbd></button>
          </div>
          <div className="rail-divider" />
          <div className="tool-rail-group">
            <span className="tool-rail-label">BUILD</span>
            <button className={Cls('rail-tool', ActiveWorkspace === 'infrastructure' && 'selected')} title="Infrastructure presets" onClick={() => SetWorkspace('infrastructure')}><Construction size={17} /><span>STRUCTURE</span></button>
            <button className={Cls('rail-tool', ActiveWorkspace === 'surface' && 'selected')} title="Surface layers" onClick={() => SetWorkspace('surface')}><Layers3 size={17} /><span>SURFACE</span></button>
            <button className={Cls('rail-tool', ActiveWorkspace === 'traffic' && 'selected')} title="Traffic simulation" onClick={() => SetWorkspace('traffic')}><Activity size={17} /><span>TRAFFIC</span></button>
          </div>
          <div className="rail-spacer" />
          <div className="rail-status"><span className="status-dot" /><span>METRIC</span><i>m</i></div>
        </aside>

        <main className="viewport-workspace">
          <div className="viewport-heading">
            <div className="viewport-heading-left">
              <span className="viewport-mode-dot" />
              <span className="viewport-heading-title">{ActiveWorkspace === 'surface' ? 'SURFACE / MATERIAL PREVIEW' : ActiveWorkspace === 'infrastructure' ? 'INFRASTRUCTURE / NETWORK' : ActiveWorkspace === 'traffic' ? 'TRAFFIC / LIVE FLOW' : 'NETWORK / PLAN VIEW'}</span>
              <span className="viewport-separator">/</span>
              <span className="viewport-coordinate">{Project.units.toUpperCase()} · WORLD SPACE</span>
            </div>
            <div className="viewport-heading-right">
              <div className="viewport-tool-actions">
                <IconButton icon={Focus} label="Frame all" onClick={() => ViewportRef.current?.fitView()} />
                <IconButton icon={Grid3X3} label="Toggle construction grid" active={GridEnabled} onClick={() => setGridEnabled((Value) => !Value)} />
                <IconButton icon={Box} label="Toggle triangulation / wireframe" active={Wireframe} onClick={() => setWireframe((Value) => !Value)} />
                <span className="mini-divider" />
                <button className="view-selector" onClick={() => ViewportRef.current?.setPerspective()}><span className="view-cube">P</span>PERSPECTIVE<ChevronDown size={12} /></button>
              </div>
            </div>
          </div>
          <div className="viewport-stage">
            <Viewport
              project={Project}
              selected={Selected}
              tool={Tool}
              draftPoints={DraftPoints}
              layers={LayerOptions}
              settings={Settings}
              onSelect={setSelected}
              onRoadPoint={AddPointToDraft}
              onNodeMove={MoveNodeAtRelease}
              onRendererState={setRendererStatus}
              onViewportReady={(Engine) => { ViewportRef.current = Engine; }}
            />
            <div className="viewport-hud top-left-hud">
              <div className="hud-location"><MapPin size={13} /><span>MERIDIAN DISTRICT</span><i>02</i></div>
              <div className="hud-coordinates">{SelectedNode ? `NODE · ${SelectedNode.position[0].toFixed(1)} / ${SelectedNode.position[2].toFixed(1)}` : SelectedRoad ? `ROAD · ${SelectedRoad.roadClass.toUpperCase()}` : 'NO SELECTION'}</div>
            </div>
            <div className="viewport-hud top-right-hud">
              <span className="scale-badge"><span /> 1 : 250</span>
              <span className="height-badge">Z 0.00 m</span>
            </div>
            <div className="viewport-compass" onClick={() => ViewportRef.current?.setTopView()} title="Click for top view">
              <span className="compass-north">N</span><span className="compass-needle" /><span className="compass-ring" />
            </div>
            {Tool === 'road' && (
              <div className="draft-card">
                <div className="draft-card-icon"><Route size={16} /></div>
                <div className="draft-card-copy"><b>Road spline</b><span>{DraftPoints.length ? `${DraftPoints.length} anchor${DraftPoints.length === 1 ? '' : 's'} · click to continue` : 'Click the ground plane to place anchors'}</span></div>
                <span className="draft-shortcut"><kbd>ENTER</kbd> to build</span>
                {DraftPoints.length >= 2 && <button className="draft-finish" onClick={FinishRoad}><Check size={14} />Generate</button>}
                <button className="draft-cancel" onClick={CancelRoad} aria-label="Cancel spline"><X size={14} /></button>
              </div>
            )}
            {Tool === 'measure' && <div className="measure-prompt"><PencilRuler size={14} /> Click two points to measure in metres <button onClick={() => setTool('select')}>Done</button></div>}
            <div className="viewport-statusline">
              <span><i className="tiny-live" /> LIVE</span><span className="statusline-divider" /><span>{Project.roads.length} ROAD SEGMENTS</span><span className="statusline-divider" /><span>{Project.nodes.filter((Node) => getNodeApproachCount(Project, Node.id) > 1).length} JUNCTIONS</span><span className="statusline-divider" /><span>{GeometryPreview.stats.railCrossings} RAIL {GeometryPreview.stats.railCrossings === 1 ? 'CROSSING' : 'CROSSINGS'}</span><span className="statusline-divider" /><span>LEFT-HAND TRAFFIC</span>
              <button onClick={() => ViewportRef.current?.setTopView()}>TOP</button><button onClick={() => ViewportRef.current?.fitView()}>FIT</button>
            </div>
            {Notice && <div className="toast-notice"><Check size={14} />{Notice}</div>}
          </div>
        </main>

        {RightDockOpen && (
          <aside className="right-dock">
            <div className="dock-tabs">
              <button className={Cls(DockTab === 'scene' && 'active')} onClick={() => setDockTab('scene')}><Layers3 size={14} />SCENE</button>
              <button className={Cls(DockTab === 'materials' && 'active')} onClick={() => setDockTab('materials')}><SlidersHorizontal size={14} />MATERIALS</button>
              <button className="dock-more" title="Panel options"><Menu size={15} /></button>
            </div>
            {DockTab === 'scene' ? (
              <>
                <div className="outliner-panel">
                  <div className="panel-header outliner-header">
                    <div><span className="panel-overline">WORLD / 01</span><b>Scene graph</b></div>
                    <div className="panel-header-actions"><IconButton icon={Search} label="Search scene" onClick={() => setSearchOpen(true)} /><IconButton icon={Plus} label="Add junction preset" onClick={AddIntersection} /></div>
                  </div>
                  <div className="outliner-scroll">
                    <div className="tree-root-row"><ChevronDown size={13} /><Map size={14} /><span>{Project.name}</span><small>{Project.nodes.length + Project.roads.length + (Project.railRoutes || []).length}</small></div>
                    <div className="tree-section-label"><ChevronDown size={12} /><span>ROAD NETWORK</span><i>{Project.roads.length}</i></div>
                    <div className="outliner-list">
                      {Project.roads.map((Road) => <OutlinerRoad key={Road.id} road={Road} selected={Selected?.type === 'road' && Selected.id === Road.id} onClick={() => setSelected({ type: 'road', id: Road.id })} />)}
                    </div>
                    {(Project.railRoutes || []).length > 0 && <>
                      <div className="tree-section-label rail-tree-label"><ChevronDown size={12} /><span>RAIL CORRIDORS</span><i>{Project.railRoutes.length}</i></div>
                      <div className="outliner-list">{Project.railRoutes.map((Rail) => <OutlinerRail key={Rail.id} rail={Rail} selected={Selected?.type === 'rail' && Selected.id === Rail.id} onClick={() => setSelected({ type: 'rail', id: Rail.id })} />)}</div>
                    </>}
                    <div className="tree-section-label junction-tree-label"><ChevronDown size={12} /><span>JUNCTIONS / CONTROL NODES</span><i>{Project.nodes.filter((Node) => getNodeApproachCount(Project, Node.id) > 1).length}</i></div>
                    <div className="junction-list">
                      {Project.nodes.filter((Node) => getNodeApproachCount(Project, Node.id) > 1).map((Node) => {
                        const Count = getNodeApproachCount(Project, Node.id);
                        return <button key={Node.id} className={Cls('junction-row', Selected?.type === 'node' && Selected.id === Node.id && 'selected')} onClick={() => setSelected({ type: 'node', id: Node.id })}><CircleDot size={14} /><span><b>{Node.name}</b><small>{Count}-approach · {Node.signalized ? 'signalised' : 'unsignalised'}</small></span><ChevronRight size={13} /></button>;
                      })}
                    </div>
                    <div className="tree-section-label layers-tree-label"><ChevronDown size={12} /><span>DISPLAY LAYERS</span><i>{SceneLayerDefaults.filter((Layer) => SceneLayers[Layer.id]).length}/{SceneLayerDefaults.length}</i></div>
                    <div className="scene-layer-list">
                      {SceneLayerDefaults.map((Layer) => <SceneLayerRow key={Layer.id} layer={{ ...Layer, enabled: Layer.id === 'traffic' ? TrafficEnabled : SceneLayers[Layer.id], name: Layer.id === 'traffic' ? `AI traffic · ${TrafficEnabled ? TrafficCount : 0} / ${MaxTrafficVehicles}` : Layer.name }} onToggle={() => Layer.id === 'traffic' ? setTrafficEnabled((Value) => !Value) : ToggleSceneLayer(Layer.id)} />)}
                    </div>
                  </div>
                  <div className="outliner-footer"><span><i className="status-dot" />SCENE READY</span><span>{Project.units.toUpperCase()}</span></div>
                </div>

                <div className="inspector-panel">
                  <div className="panel-header inspector-header">
                    <div><span className="panel-overline">PROPERTIES / 02</span><b>Inspector</b></div>
                    <button className="panel-options" onClick={() => setShowSettings((Value) => !Value)}><Settings2 size={15} /></button>
                  </div>
                  {showSettings && <div className="popover-settings"><b>Viewport preferences</b><Toggle compact label="Construction grid" value={GridEnabled} onChange={setGridEnabled} /><Toggle compact label="Triangulation overlay" value={Wireframe} onChange={setWireframe} /><Toggle compact label="AI traffic" value={TrafficEnabled} onChange={setTrafficEnabled} /></div>}
                  <div className="inspector-scroll">
                    {ActiveWorkspace === 'traffic' && (
                      <section className="traffic-controls-card">
                        <div className="traffic-card-heading"><div className="object-icon traffic-icon"><Activity size={16} /></div><div><span>SIMULATION / LIVE</span><b>AI traffic stream</b></div><span className={Cls('traffic-live-badge', TrafficEnabled && 'active')}>{TrafficEnabled ? 'RUNNING' : 'PAUSED'}</span></div>
                        <Toggle value={TrafficEnabled} onChange={setTrafficEnabled} label="Enable vehicle flow" />
                        <SliderControl label="Active vehicles · hard cap 25" value={TrafficCount} min={0} max={MaxTrafficVehicles} step={1} unit="" onChange={(Value) => setTrafficCount(ClampTrafficVehicleCount(Value))} />
                        <Toggle value={TrainsEnabled} onChange={setTrainsEnabled} label="Optional commuter train" />
                        <div className="traffic-footnote"><Shield size={12} /><span>Vehicle instances are clamped to {MaxTrafficVehicles}; the four-car train uses the separate rail layer.</span></div>
                      </section>
                    )}
                    {SelectedNode ? (
                      <>
                        <div className="selected-object-card">
                          <div className="object-icon junction-icon"><CircleDot size={18} /></div>
                          <div className="selected-object-title"><span>INTERSECTION / NODE</span><b>{SelectedNode.name}</b><small>{getNodeTypeLabel(SelectedNode, SelectedNodeApproaches)} · {SelectedNodeApproaches} connected arms</small></div>
                          <button className="object-menu" title="More node options"><Menu size={15} /></button>
                        </div>
                        <Disclosure title="Junction geometry" aside="PLANAR / UNIONED">
                          <div className="inspector-grid two">
                            <label className="readout-field"><span>Patch solver</span><b>Boolean union · earcut</b></label>
                            <NumericField label="Corner radius" value={SelectedNode.radius} min={3} max={24} step={0.5} onChange={(Value) => PatchNode({ radius: Value })} />
                          </div>
                          <div className="geometry-facts"><span><b>{SelectedNodeApproaches}</b><small>ARMS</small></span><span><b>{Math.round(SelectedNode.radius * 1.45)} m</b><small>PATCH Ø</small></span><span><b>{SelectedNode.crossings ? 'ON' : 'OFF'}</b><small>CROSSINGS</small></span></div>
                          {SelectedNodeDiagnostic && <div className="diagnostic-note"><AlertTriangle size={13} /><span>{SelectedNodeDiagnostic.message}</span></div>}
                        </Disclosure>
                        <Disclosure title="Road control" aside="AT-GRADE">
                          <Toggle value={SelectedNode.signalized} onChange={(Value) => PatchNode({ signalized: Value })} label="Signalised control" />
                          <Toggle value={SelectedNode.crossings} onChange={(Value) => PatchNode({ crossings: Value })} label="Marked pedestrian crossings" />
                        </Disclosure>
                        <Disclosure title="Position & transform" aside="WORLD / METRES" defaultOpen={false}>
                          <div className="inspector-grid two">
                            <NumericField label="X position" value={SelectedNode.position[0]} unit="m" min={-800} max={800} step={0.1} onChange={(Value) => ChangeProject((Current) => MoveNode(Current, SelectedNode.id, [Value, SelectedNode.position[1], SelectedNode.position[2]]))} />
                            <NumericField label="Z position" value={SelectedNode.position[2]} unit="m" min={-800} max={800} step={0.1} onChange={(Value) => ChangeProject((Current) => MoveNode(Current, SelectedNode.id, [SelectedNode.position[0], SelectedNode.position[1], Value]))} />
                          </div>
                          <div className="gizmo-hint"><Move3D size={13} /><span>Move with the viewport gizmo. Connected spline handles preserve tangent direction.</span></div>
                        </Disclosure>
                      </>
                    ) : SelectedRoad ? (
                      <>
                        <div className="selected-object-card">
                          <div className={Cls('object-icon', SelectedRoad.structure === 'bridge' && 'bridge-object-icon')}><Route size={18} /></div>
                          <div className="selected-object-title"><span>ROAD SEGMENT / SPLINE</span><b>{SelectedRoad.name}</b><small>{SelectedRoad.roadClass.toUpperCase()} · {SelectedRoad.structure.toUpperCase()} · {SelectedRoadLength ? `${SelectedRoadLength.toFixed(0)} m` : '—'}</small></div>
                          <button className="object-menu" title="More road options"><Menu size={15} /></button>
                        </div>
                        <Disclosure title="Classification" aside="DESIGN SPEED">
                          <SelectField label="Road class" value={SelectedRoad.roadClass} options={RoadClassOptions} onChange={(Value) => PatchRoad({ roadClass: Value })} />
                          <div className="inspector-grid two">
                            <NumericField label="Speed limit" value={SelectedRoad.speedLimit} unit="km/h" min={10} max={130} step={5} onChange={(Value) => PatchRoad({ speedLimit: Value })} />
                            <SelectField label="Traffic flow" value={SelectedRoad.trafficSide || 'left'} options={[{ value: 'left', label: 'Left-hand' }, { value: 'right', label: 'Right-hand' }]} onChange={(Value) => PatchRoad({ trafficSide: Value })} />
                          </div>
                        </Disclosure>
                        <Disclosure title="Cross-section" aside={`${(SelectedRoad.laneCount * SelectedRoad.laneWidth + SelectedRoad.median + 2 * (SelectedRoad.shoulder + (SelectedRoad.parking ? 2.25 : 0))).toFixed(1)} m TOTAL`}>
                          <div className="inspector-grid two">
                            <NumericField label="Travel lanes" value={SelectedRoad.laneCount} unit="lanes" min={1} max={8} step={1} onChange={(Value) => PatchRoad({ laneCount: Math.max(1, Math.round(Value)) })} />
                            <NumericField label="Lane width" value={SelectedRoad.laneWidth} min={2.8} max={4.5} step={0.05} onChange={(Value) => PatchRoad({ laneWidth: Value })} />
                            <NumericField label="Median" value={SelectedRoad.median} min={0} max={6} step={0.1} onChange={(Value) => PatchRoad({ median: Value })} />
                            <NumericField label="Shoulder" value={SelectedRoad.shoulder} min={0} max={4} step={0.1} onChange={(Value) => PatchRoad({ shoulder: Value })} />
                            <NumericField label="Footway" value={SelectedRoad.sidewalk} min={0} max={6} step={0.1} onChange={(Value) => PatchRoad({ sidewalk: Value })} />
                            <NumericField label="Curb upstand" value={SelectedRoad.curbHeight} min={0.05} max={0.3} step={0.01} onChange={(Value) => PatchRoad({ curbHeight: Value })} />
                          </div>
                          <div className="cross-section-preview"><div className="cross-section-road"><span /><i /><span /></div><div className="cross-section-labels"><span>FOOTWAY</span><span>RUNNING LANES</span><span>FOOTWAY</span></div></div>
                        </Disclosure>
                        <Disclosure title="Surface & markings" aside="PROCEDURAL">
                          <Toggle value={SelectedRoad.markings} onChange={(Value) => PatchRoad({ markings: Value })} label="Lane & edge markings" />
                          <Toggle value={SelectedRoad.crosswalks} onChange={(Value) => PatchRoad({ crosswalks: Value })} label="Pedestrian crossing bars" />
                          <Toggle value={SelectedRoad.parking} onChange={(Value) => PatchRoad({ parking: Value })} label="Roadside parking bays" />
                          <Toggle value={SelectedRoad.potholes} onChange={(Value) => PatchRoad({ potholes: Value })} label="Pothole / repair decals" />
                          <Toggle value={SelectedRoad.speedBumps} onChange={(Value) => PatchRoad({ speedBumps: Value })} label="Raised speed table" />
                        </Disclosure>
                        <Disclosure title="Structures & works" aside="ELEVATION / 3D">
                          <SelectField label="Vertical treatment" value={SelectedRoad.structure} options={[{ value: 'surface', label: 'At-grade road' }, { value: 'bridge', label: 'Bridge / flyover deck' }, { value: 'tunnel', label: 'Tunnel / underpass' }]} onChange={(Value) => PatchRoad({ structure: Value, sidewalk: Value === 'bridge' ? 0 : SelectedRoad.sidewalk, guardrail: Value !== 'surface' })} />
                          {SelectedRoad.structure === 'bridge' && <NumericField label="Deck rise · control handles" value={SelectedRoad.deckHeight ?? 8.8} min={4} max={22} step={0.2} onChange={(Value) => PatchRoad({ deckHeight: Value })} />}
                          {SelectedRoad.structure === 'tunnel' && <NumericField label="Tunnel depth · under grade" value={SelectedRoad.tunnelDepth ?? 6} min={4} max={18} step={0.2} onChange={(Value) => PatchRoad({ tunnelDepth: Value })} />}
                          <Toggle value={SelectedRoad.guardrail} onChange={(Value) => PatchRoad({ guardrail: Value })} label="Guardrail / bridge parapet" />
                          <Toggle value={SelectedRoad.billboard} onChange={(Value) => PatchRoad({ billboard: Value })} label="Roadside billboard" />
                          <Toggle value={SelectedRoad.construction} onChange={(Value) => PatchRoad({ construction: Value })} label="Active reconstruction zone" />
                          <div className="construction-note"><HardHat size={14} /><span>Work-zone props are procedural. Bridge rise and underpass depth set the spline’s vertical profile.</span></div>
                        </Disclosure>
                        <button className="inspector-action" onClick={() => setDockTab('materials')}><Layers3 size={14} />Edit procedural material layers<ArrowUpRight size={13} /></button>
                      </>
                    ) : SelectedRail ? (
                      <>
                        <div className="selected-object-card">
                          <div className="object-icon rail-object-icon"><TrainFront size={18} /></div>
                          <div className="selected-object-title"><span>RAIL CORRIDOR / SPLINE</span><b>{SelectedRail.name}</b><small>{SelectedRail.trackCount} TRACK · {SelectedRail.gauge.toFixed(3)} m GAUGE</small></div>
                          <button className="object-menu" title="More rail options"><Menu size={15} /></button>
                        </div>
                        <Disclosure title="Track formation" aside="STANDARD GAUGE">
                          <div className="inspector-grid two">
                            <NumericField label="Track gauge" value={SelectedRail.gauge} min={1.0} max={2.0} step={0.001} onChange={(Value) => PatchRail({ gauge: Value })} />
                            <NumericField label="Parallel tracks" value={SelectedRail.trackCount} unit="tracks" min={1} max={2} step={1} onChange={(Value) => PatchRail({ trackCount: Math.max(1, Math.min(2, Math.round(Value))) })} />
                            <NumericField label="Line speed" value={SelectedRail.speedLimit} unit="km/h" min={20} max={160} step={5} onChange={(Value) => PatchRail({ speedLimit: Value })} />
                            <label className="readout-field"><span>Crossings</span><b>{GeometryPreview.railCrossings.filter((Crossing) => Crossing.railId === SelectedRail.id).length} at-grade</b></label>
                          </div>
                        </Disclosure>
                        <Disclosure title="Rail operations" aside="COMMUTER">
                          <Toggle value={SelectedRail.electrified} onChange={(Value) => PatchRail({ electrified: Value })} label="Electrified corridor" />
                          <Toggle value={SelectedRail.crossings} onChange={(Value) => PatchRail({ crossings: Value })} label="Crossing deck markings" />
                          <Toggle value={TrainsEnabled} onChange={setTrainsEnabled} label="Run optional train consist" />
                          <div className="gizmo-hint"><TrainFront size={13} /><span>Four-car animated commuter set runs this spline when trains are enabled.</span></div>
                        </Disclosure>
                      </>
                    ) : (
                      <div className="empty-inspector"><div className="empty-icon"><Crosshair size={18} /></div><b>Nothing selected</b><span>Select a road or junction in the viewport or scene graph.</span></div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="material-stack-panel">
                  <div className="panel-header material-stack-header"><div><span className="panel-overline">SURFACE STACK / 01</span><b>Texture layers</b></div><div className="panel-header-actions"><IconButton icon={Plus} label="Add material layer" onClick={AddTextureLayer} /></div></div>
                  <div className="material-stack-caption"><span>ROAD SURFACE / PBR</span><span>{TextureLayers.filter((Layer) => Layer.enabled).length} ACTIVE</span></div>
                  <div className="texture-layer-list">
                    {TextureLayers.map((Layer, Index) => <TextureLayerRow key={Layer.id} layer={Layer} selected={SelectedTextureId === Layer.id} onSelect={() => setSelectedTextureId(Layer.id)} onToggle={() => PatchTextureLayer(Layer.id, { enabled: !Layer.enabled })} onMove={(Direction) => MoveTextureLayer(Layer.id, Direction)} canMoveUp={Index > 0} canMoveDown={Index < TextureLayers.length - 1} />)}
                  </div>
                  <button className="add-layer-button" onClick={AddTextureLayer}><Plus size={14} /><span>Add procedural tint layer</span><kbd>⌘L</kbd></button>
                  <div className="material-blend"><span>BLEND MODE</span><span className="blend-mode-readout">NORMAL · OVER</span></div>
                </div>
                <div className="inspector-panel material-inspector">
                  <div className="panel-header inspector-header"><div><span className="panel-overline">LAYER PROPERTIES / 02</span><b>Material inspector</b></div><div className="panel-header-actions"><IconButton icon={Trash2} label="Remove custom material layer" disabled={!SelectedTexture?.id.startsWith('custom-')} onClick={() => DeleteTextureLayer(SelectedTexture.id)} /><button className="panel-options" onClick={() => setShowSettings((Value) => !Value)}><Settings2 size={15} /></button></div></div>
                  <div className="inspector-scroll">
                    {SelectedTexture ? (
                      <>
                        <div className="selected-object-card material-object-card">
                          <div className="object-icon material-icon"><span className="texture-swatch large" style={{ background: SelectedTexture.color }}><span /></span></div>
                          <div className="selected-object-title"><span>{SelectedTexture.type.toUpperCase()} / PBR LAYER</span><b>{SelectedTexture.name}</b><small>{SelectedTexture.enabled ? 'VISIBLE IN STACK' : 'DISABLED'}</small></div>
                          <Toggle compact value={SelectedTexture.enabled} onChange={(Value) => PatchTextureLayer(SelectedTexture.id, { enabled: Value })} />
                        </div>
                        <Disclosure title="Surface response" aside="PHYSICALLY BASED">
                          <SliderControl label="Layer opacity" value={SelectedTexture.opacity} min={0} max={1} step={0.01} digits={2} onChange={(Value) => PatchTextureLayer(SelectedTexture.id, { opacity: Value })} />
                          <SliderControl label="Roughness" value={SelectedTexture.roughness} min={0.05} max={1} step={0.01} digits={2} onChange={(Value) => PatchTextureLayer(SelectedTexture.id, { roughness: Value })} />
                          <div className="color-property"><span>Albedo tint</span><label className="color-input"><input type="color" value={SelectedTexture.color} onChange={(Event) => PatchTextureLayer(SelectedTexture.id, { color: Event.target.value })} /><span>{SelectedTexture.color.toUpperCase()}</span></label></div>
                          <div className="material-preview-strip"><i style={{ backgroundColor: SelectedTexture.color, opacity: SelectedTexture.opacity }} /><div><span>{SelectedTexture.type}</span><small>Procedural · tiled in world space</small></div><ChevronRight size={14} /></div>
                        </Disclosure>
                        <Disclosure title="Mapping" aside="METRIC UV">
                          {SelectedTexture.id === 'wearing' ? <>
                            <label className="readout-field"><span>Projection</span><b>Road-aligned / spline UV</b></label>
                            <div className="inspector-grid two"><NumericField label="Repeat X" value={SelectedTexture.repeatX ?? 1} unit="×" min={0.1} max={8} step={0.1} onChange={(Value) => PatchTextureLayer(SelectedTexture.id, { repeatX: Value })} /><NumericField label="Repeat Y" value={SelectedTexture.repeatY ?? 1} unit="×" min={0.1} max={8} step={0.1} onChange={(Value) => PatchTextureLayer(SelectedTexture.id, { repeatY: Value })} /></div>
                          </> : <div className="gizmo-hint"><Layers3 size={13} /><span>This layer follows the selected material's feature-space projection.</span></div>}
                        </Disclosure>
                        <div className="material-info"><Sparkles size={14} /><span>Layer order, visibility, roughness and tint update the live PBR viewport.</span></div>
                      </>
                    ) : <div className="empty-inspector"><span>Select a material layer to edit it.</span></div>}
                  </div>
                </div>
              </>
            )}
          </aside>
        )}
      </div>

      <footer className="bottom-bar">
        <div className="bottom-left"><span className="branch-mark"><Zap size={11} fill="currentColor" /></span><b>{Project.name}</b><span className="bottom-divider" /><span>REV {String(Project.revision).padStart(3, '0')}</span><span className="bottom-divider" /><span>WORLD UNITS · M</span></div>
        <div className="bottom-center"><span>{GeometryPreview.stats.triangles.toLocaleString()} TRIANGLES</span><span className="bottom-divider" /><span>{GeometryPreview.stats.vertices.toLocaleString()} VERTICES</span><span className="bottom-divider" /><span>NETWORK SOLVER READY</span></div>
        <div className="bottom-right"><span className={Cls('bottom-render-status', RendererStatus.includes('WebGPU') && 'online')}><i />{RendererStatus}</span><button onClick={() => setShowSettings((Value) => !Value)}><Settings2 size={13} />PREFERENCES</button></div>
      </footer>

      {SearchOpen && (
        <div className="command-backdrop" onClick={() => setSearchOpen(false)}>
          <div className="command-palette" onClick={(Event) => Event.stopPropagation()}>
            <div className="command-search"><Search size={17} /><input autoFocus placeholder="Search roads, layers, commands…" /><kbd>ESC</kbd><button onClick={() => setSearchOpen(false)}><X size={15} /></button></div>
            <div className="command-caption">QUICK ACTIONS</div>
            <button onClick={() => { setTool('road'); setDraftPoints([]); setSearchOpen(false); }}><Route size={15} /><span>Draw spline road</span><kbd>R</kbd></button>
            <button onClick={() => { setDockTab('materials'); setActiveWorkspace('surface'); setSearchOpen(false); }}><Layers3 size={15} /><span>Open material layers</span><kbd>⌘L</kbd></button>
            <button onClick={() => { setTrafficEnabled(true); setActiveWorkspace('traffic'); setSearchOpen(false); }}><Activity size={15} /><span>Run AI traffic</span><kbd>T</kbd></button>
            <button onClick={() => { ViewportRef.current?.fitView(); setSearchOpen(false); }}><Focus size={15} /><span>Frame all geometry</span><kbd>F</kbd></button>
            <div className="command-footer">ROADFORGE · COMMAND SEARCH</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
