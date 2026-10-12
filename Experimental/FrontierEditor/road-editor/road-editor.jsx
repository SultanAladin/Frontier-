// Frontier Road Editor: a browser prototype for large, clean road networks.
// Roads only (buildings are out of scope). Unreal-style fly camera: WASD, Q/E,
// RMB-drag to look, Shift to go fast, wheel to change speed.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  MousePointer2, PenLine, Signpost, ArrowUpFromLine, Trash2, Undo2, Redo2, Download, Upload,
  Grid3x3, Layers, Dices, ChevronDown, ChevronRight, X, ArrowUp, ArrowDown,
} from 'lucide-react';
import { RoadViewport } from './road-viewport.js';
import { buildNetworkMeshes } from './road-geometry.js';
import { generateCity, GENERATOR_DEFAULTS } from './city-generator.js';
import {
  addRoad, removeEdge, updateEdge, moveNode, setNodeHeight, setRoadHeight, addProp, removeProp,
  propsOn, serialize, deserialize, degrees, dense, edgeLength, frameAt,
} from './road-graph.js';
import {
  PRESETS, PRESET_GROUPS, LANE_KINDS, lanesOf, speedOf, centerOf, presetOf, layoutLanes, validLanes,
} from './road-catalog.js';
import './road-editor.css';

const STORE_KEY = 'frontier-road-editor';
const STORE_LIMIT = 4_500_000;
const UNDO_LIMIT = 60;

const TOOLS = [
  { id: 'select', key: '1', label: 'Select & move', icon: MousePointer2 },
  { id: 'draw', key: '2', label: 'Draw road', icon: PenLine },
  { id: 'props', key: '3', label: 'Street furniture', icon: Signpost },
  { id: 'elevate', key: '4', label: 'Deck height', icon: ArrowUpFromLine },
  { id: 'delete', key: '5', label: 'Delete road', icon: Trash2 },
];

const PROP_TYPES = [
  { id: 'bollard', label: 'Bollards', hint: 'Posts at the kerb; the lateral offset follows your click' },
  { id: 'speedbump', label: 'Speed bump', hint: 'Raised hump across the carriageway' },
  { id: 'crosswalk', label: 'Zebra crossing', hint: 'Painted crossing across the carriageway' },
  { id: 'railcrossing', label: 'Level crossing', hint: 'Barriers and warning lights over the track' },
  { id: 'station', label: 'Subway entrance', hint: 'Kiosk beside a subway line' },
];

const NEW_LANE_WIDTH = {
  sidewalk: 2, verge: 2, path: 2, gravel: 3, paver: 3, drive: 3.2, bus: 3.4, bike: 1.8, cycle: 2.2,
  parking: 2.2, shoulder: 2.5, median: 2, tram: 2.6, rail: 3,
};

const FEATURES = [
  ['bus', 'Bus lanes'], ['bike', 'Cycle lanes & tracks'], ['parking', 'Parking lanes'],
  ['tram', 'Tram street'], ['rail', 'Mainline railway'], ['subway', 'Subway lines'],
  ['motorway', 'Elevated motorway'], ['interchanges', 'Slip-road interchanges'],
  ['oneway', 'One-way streets'], ['deadEnds', 'Dead ends'], ['bumps', 'Speed bumps'],
  ['bollards', 'Cycle-track bollards'],
];

const fmt = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : '');

function isTyping(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function loadInitial() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { net: deserialize(JSON.parse(raw)), note: 'Restored autosaved network' };
  } catch (err) {
    console.warn('Autosave could not be restored; generating a new city.', err);
  }
  return { net: generateCity({ seed: GENERATOR_DEFAULTS.seed }), note: 'Generated city (seed 1)' };
}

// ----- small controls --------------------------------------------------------

function NumField({ value, onCommit, step = 0.5, min, max, width = 74, disabled = false }) {
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]);
  const apply = () => {
    let v = parseFloat(text);
    if (!Number.isFinite(v) || v === value) {
      setText(fmt(value));
      return;
    }
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    onCommit(v);
  };
  return (
    <input
      className="re-input" type="number" step={step} min={min} max={max} value={text} disabled={disabled}
      style={{ width }} onChange={(e) => setText(e.target.value)} onBlur={apply}
      onKeyDown={(e) => { if (e.key === 'Enter') { apply(); e.currentTarget.blur(); } }}
    />
  );
}

function TextField({ value, onCommit, placeholder = '', width }) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  const apply = () => { if (text !== (value ?? '')) onCommit(text); };
  return (
    <input className="re-input wide" value={text} placeholder={placeholder} style={width ? { width } : undefined}
      onChange={(e) => setText(e.target.value)} onBlur={apply}
      onKeyDown={(e) => { if (e.key === 'Enter') { apply(); e.currentTarget.blur(); } }} />
  );
}

function Section({ title, children, defaultOpen = true, actions = null }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="re-section">
      <header onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span>{title}</span>
        <div className="re-section-actions" onClick={(e) => e.stopPropagation()}>{actions}</div>
      </header>
      {open && <div className="re-section-body">{children}</div>}
    </section>
  );
}

function Row({ label, children }) {
  return (
    <div className="re-row">
      <label>{label}</label>
      <div className="re-row-value">{children}</div>
    </div>
  );
}

// ----- inspectors -------------------------------------------------------------

function EdgeInspector({ net, edge, rev, commit, setSel, onFocus }) {
  const lanesNow = lanesOf(edge);
  const [draft, setDraft] = useState(() => lanesNow.map((l) => [...l]));
  useEffect(() => { setDraft(lanesOf(edge).map((l) => [...l])); }, [edge.id, rev]);
  const valid = validLanes(draft);
  const layout = valid ? layoutLanes(draft) : null;
  const preset = presetOf(edge);
  const nodeA = net.nodes[edge.a];
  const props = propsOn(net, edge.id);
  const len = edgeLength(net, edge);
  const custom = Boolean(edge.lanes);

  const setRow = (i, patch) => setDraft((d) => d.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const moveRow = (i, dir) => setDraft((d) => {
    const j = i + dir;
    if (j < 0 || j >= d.length) return d;
    const copy = d.map((r) => [...r]);
    [copy[i], copy[j]] = [copy[j], copy[i]];
    return copy;
  });
  const dropRow = (i) => setDraft((d) => d.filter((_, j) => j !== i));
  const addRow = (kind) => setDraft((d) => [...d, [kind, LANE_KINDS[kind].carriage ? 'both' : 'none', NEW_LANE_WIDTH[kind] ?? 2.5]]);

  return (
    <>
      <Section title="Road">
        <Row label="Name">
          <TextField value={edge.name ?? ''} placeholder={`Road ${edge.id}`}
            onCommit={(v) => commit('Rename road', () => updateEdge(net, edge.id, { name: v.trim() || undefined }), { quiet: true })} />
        </Row>
        <Row label="Preset">
          <select className="re-input wide" value={edge.preset} onChange={(e) => commit('Change preset', () => updateEdge(net, edge.id, { preset: e.target.value, lanes: undefined, speed: undefined, center: undefined }))}>
            {PRESET_GROUPS.map((g) => (
              <optgroup key={g} label={g}>
                {Object.entries(PRESETS).filter(([, p]) => p.group === g).map(([id, p]) => (
                  <option key={id} value={id}>{p.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </Row>
        <Row label="Speed (km/h)">
          <NumField value={speedOf(edge)} step={5} min={5} max={130} onCommit={(v) => commit('Speed', () => updateEdge(net, edge.id, { speed: v }))} />
        </Row>
        <Row label="Centre marking">
          <select className="re-input" value={centerOf(edge)} onChange={(e) => commit('Centre marking', () => updateEdge(net, edge.id, { center: e.target.value }))}>
            <option value="none">None</option>
            <option value="dashed">Dashed</option>
            <option value="solid">Solid</option>
            <option value="double">Double solid</option>
          </select>
        </Row>
        <Row label="Deck height (m)">
          <NumField value={nodeA?.y ?? 0} step={0.5} min={-12} max={60} onCommit={(v) => commit('Deck height', () => setRoadHeight(net, edge.id, v))} />
        </Row>
        <Row label="Length">{Number.isFinite(len) ? `${len.toFixed(1)} m` : '–'} · {preset.label}</Row>
        <div className="re-actions">
          <button type="button" onClick={() => onFocus(edge)}>Focus camera</button>
          <button type="button" className="danger" onClick={() => { commit('Delete road', () => removeEdge(net, edge.id)); setSel(null); }}>Delete</button>
        </div>
      </Section>

      <Section title={`Lanes · ${layout ? layout.total.toFixed(1) : '?'} m${custom ? ' · custom' : ''}`}>
        <div className="re-lanes">
          {draft.map((lane, i) => (
            <div key={i} className="re-lane" style={{ borderLeftColor: `rgb(${(LANE_KINDS[lane[0]]?.color ?? [0.5, 0.5, 0.5]).map((c) => Math.round(c * 255)).join(',')})` }}>
              <select className="re-input" value={lane[0]} onChange={(e) => setRow(i, { 0: e.target.value })}>
                {Object.entries(LANE_KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <select className="re-input narrow" value={lane[1]} onChange={(e) => setRow(i, { 1: e.target.value })}>
                <option value="fwd">→ fwd</option>
                <option value="back">← back</option>
                <option value="both">↔ both</option>
                <option value="none">· none</option>
              </select>
              <input className="re-input narrow" type="number" step={0.1} min={0.1} max={12} value={lane[2]}
                onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) setRow(i, { 2: v }); }} />
              <div className="re-lane-tools">
                <button type="button" title="Move left" onClick={() => moveRow(i, -1)}><ArrowUp size={11} /></button>
                <button type="button" title="Move right" onClick={() => moveRow(i, 1)}><ArrowDown size={11} /></button>
                <button type="button" title="Remove lane" onClick={() => dropRow(i)}><X size={11} /></button>
              </div>
            </div>
          ))}
        </div>
        <div className="re-actions">
          <select className="re-input" value="" onChange={(e) => { if (e.target.value) addRow(e.target.value); }}>
            <option value="">+ Add lane…</option>
            {Object.entries(LANE_KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div className="re-hint">Lanes run left to right looking from node {edge.a} to {edge.b}. {valid ? '' : 'Invalid: check widths (0.1–12 m).'}</div>
        <div className="re-actions">
          <button type="button" className="primary" disabled={!valid} onClick={() => commit('Lane layout', () => updateEdge(net, edge.id, { lanes: draft.map((l) => [...l]) }))}>Apply lanes</button>
          <button type="button" disabled={!custom} onClick={() => commit('Reset lanes', () => updateEdge(net, edge.id, { lanes: undefined }))}>Reset to preset</button>
        </div>
      </Section>

      <Section title={`Street furniture (${props.length})`} defaultOpen={props.length > 0}>
        <div className="re-chips">
          {PROP_TYPES.map((t) => (
            <button type="button" key={t.id} title={t.hint} onClick={() => {
              const L = len;
              commit(`Add ${t.label}`, () => {
                const id = addProp(net, { type: t.id, edge: edge.id, s: t.id === 'bollard' ? 0 : L / 2, ...(t.id === 'bollard' ? { len: L, spacing: 1.5 } : {}) });
                setSel({ kind: 'prop', id });
              });
            }}>{t.label}</button>
          ))}
        </div>
        {props.map((p) => (
          <div key={p.id} className="re-prop-row">
            <button type="button" onClick={() => setSel({ kind: 'prop', id: p.id })}>{p.type} @ {p.s.toFixed(0)} m{p.auto ? ' · auto' : ''}</button>
            <button type="button" title="Remove" onClick={() => commit('Remove prop', () => removeProp(net, p.id))}><X size={11} /></button>
          </div>
        ))}
      </Section>
    </>
  );
}

function PropInspector({ net, prop, commit, setSel }) {
  const edge = net.edges[prop.edge];
  const L = edge ? edgeLength(net, edge) : 0;
  const patch = (p) => commit(`Edit ${prop.type}`, () => { net.props[prop.id] = { ...net.props[prop.id], ...p }; });
  return (
    <Section title={`${PROP_TYPES.find((t) => t.id === prop.type)?.label ?? prop.type}`}>
      <Row label="Arc position (m)"><NumField value={prop.s} step={1} min={0} max={Math.max(0, L)} onCommit={(v) => patch({ s: v })} /></Row>
      {prop.type === 'bollard' && (
        <>
          <Row label="Lateral offset (m)"><NumField value={prop.lat ?? 0} step={0.1} onCommit={(v) => patch({ lat: v })} /></Row>
          <Row label="Run length (m)"><NumField value={prop.len ?? 0} step={5} min={0} onCommit={(v) => patch({ len: v })} /></Row>
          <Row label="Spacing (m)"><NumField value={prop.spacing ?? 1.5} step={0.5} min={0.5} onCommit={(v) => patch({ spacing: v })} /></Row>
        </>
      )}
      <div className="re-hint">{PROP_TYPES.find((t) => t.id === prop.type)?.hint}{prop.auto ? ' Automatic: regenerated when the junction changes.' : ''}</div>
      <div className="re-actions">
        <button type="button" onClick={() => setSel({ kind: 'edge', id: prop.edge })}>Show road</button>
        <button type="button" className="danger" onClick={() => { commit('Remove prop', () => removeProp(net, prop.id)); setSel(null); }}>Delete</button>
      </div>
    </Section>
  );
}

function NodeInspector({ net, node, commit, setSel }) {
  const deg = degrees(net).get(node.id) ?? 0;
  return (
    <Section title={`Node ${node.id}`}>
      <Row label="Position">x {node.x.toFixed(1)} · z {node.z.toFixed(1)}</Row>
      <Row label="Height (m)"><NumField value={node.y} step={0.5} min={-12} max={60} onCommit={(v) => commit('Node height', () => setNodeHeight(net, node.id, v))} /></Row>
      <Row label="Connections">{deg} {deg >= 3 ? '· junction' : deg === 1 ? '· dead end' : ''}</Row>
      <div className="re-hint">Drag this node on the ground to move it; connected roads follow.</div>
      <div className="re-actions">
        <button type="button" onClick={() => setSel(null)}>Clear</button>
      </div>
    </Section>
  );
}

function GeneratorPanel({ commit, setSel }) {
  const [opts, setOpts] = useState(() => ({ ...GENERATOR_DEFAULTS, features: { ...GENERATOR_DEFAULTS.features } }));
  const set = (patch) => setOpts((o) => ({ ...o, ...patch }));
  const generate = () => {
    commit('Generate city', () => generateCity(opts));
    setSel(null);
  };
  return (
    <Section title="City generator" defaultOpen={false}>
      <Row label="Seed"><NumField value={opts.seed} step={1} min={0} onCommit={(v) => set({ seed: Math.round(v) })} /></Row>
      <Row label={`Size ${opts.sizeKm} km`}>
        <input type="range" min={2} max={10} step={0.5} value={opts.sizeKm} onChange={(e) => set({ sizeKm: parseFloat(e.target.value) })} />
      </Row>
      <Row label="Block (m)">
        <select className="re-input" value={opts.blockSize} onChange={(e) => set({ blockSize: parseInt(e.target.value, 10) })}>
          {[360, 480, 600].map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </Row>
      <Row label="Local spacing (m)">
        <select className="re-input" value={opts.localSpacing} onChange={(e) => set({ localSpacing: parseInt(e.target.value, 10) })}>
          {[120, 240, 360].map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </Row>
      <Row label={`Warp ${opts.warp} m`}>
        <input type="range" min={0} max={90} step={5} value={opts.warp} onChange={(e) => set({ warp: parseInt(e.target.value, 10) })} />
      </Row>
      <div className="re-features">
        {FEATURES.map(([key, label]) => (
          <label key={key} className="re-check">
            <input type="checkbox" checked={opts.features[key] !== false}
              onChange={(e) => set({ features: { ...opts.features, [key]: e.target.checked } })} />
            {label}
          </label>
        ))}
      </div>
      <div className="re-hint">Buildings are not generated (optional, out of scope for roads).</div>
      <div className="re-actions">
        <button type="button" className="primary" onClick={generate}><Dices size={12} /> Generate (replaces network)</button>
      </div>
    </Section>
  );
}

// ----- app ----------------------------------------------------------------------

function App() {
  const canvasRef = useRef(null);
  const vpRef = useRef(null);
  const netRef = useRef(null);
  const meshStatsRef = useRef(null);
  const initialRef = useRef(null);
  if (initialRef.current === null) initialRef.current = loadInitial();
  if (netRef.current === null) netRef.current = initialRef.current.net;
  const undoRef = useRef([]);
  const redoRef = useRef([]);
  const draftRef = useRef([]);
  const dragRef = useRef(null);
  const handlers = useRef({});

  const [rev, setRev] = useState(0);
  const [tool, setTool] = useState('select');
  const [drawPreset, setDrawPreset] = useState('residential');
  const [drawHeight, setDrawHeight] = useState(0);
  const [elevHeight, setElevHeight] = useState(6);
  const [propType, setPropType] = useState('bollard');
  const [showUnder, setShowUnder] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [sel, setSel] = useState(null);
  const [draftCount, setDraftCount] = useState(0);
  const [meshStats, setMeshStats] = useState(null);
  const [status, setStatus] = useState(() => initialRef.current.note);
  const [warn, setWarn] = useState('');
  const [camSpeed, setCamSpeed] = useState(140);

  const stateRef = useRef({});
  stateRef.current = { tool, drawPreset, drawHeight, elevHeight, propType, sel };

  const bump = useCallback(() => setRev((r) => r + 1), []);

  // Every edit: snapshot for undo, mutate (in place, or return a replacement network), refresh.
  const commit = useCallback((label, fn, opts = {}) => {
    const net = netRef.current;
    undoRef.current.push({ label, json: JSON.stringify(serialize(net)) });
    if (undoRef.current.length > UNDO_LIMIT) undoRef.current.shift();
    redoRef.current = [];
    const replaced = fn(net);
    if (replaced) netRef.current = replaced;
    if (!opts.quiet) setStatus(label);
    bump();
  }, [bump]);

  const undo = useCallback(() => {
    const entry = undoRef.current.pop();
    if (!entry) return;
    redoRef.current.push({ label: entry.label, json: JSON.stringify(serialize(netRef.current)) });
    netRef.current = deserialize(JSON.parse(entry.json));
    setSel(null);
    setStatus(`Undo: ${entry.label}`);
    bump();
  }, [bump]);

  const redo = useCallback(() => {
    const entry = redoRef.current.pop();
    if (!entry) return;
    undoRef.current.push({ label: entry.label, json: JSON.stringify(serialize(netRef.current)) });
    netRef.current = deserialize(JSON.parse(entry.json));
    setSel(null);
    setStatus(`Redo: ${entry.label}`);
    bump();
  }, [bump]);

  const finishDraw = useCallback(() => {
    const pts = draftRef.current;
    draftRef.current = [];
    setDraftCount(0);
    vpRef.current?.clearOverlay();
    if (pts.length < 2) return;
    const preset = stateRef.current.drawPreset;
    commit(`Draw ${PRESETS[preset].label}`, (net) => {
      const ids = addRoad(net, pts, { preset });
      if (ids.length) setSel({ kind: 'edge', id: ids[ids.length - 1] });
    });
  }, [commit]);

  const cancelDraw = useCallback(() => {
    draftRef.current = [];
    setDraftCount(0);
    vpRef.current?.clearOverlay();
  }, []);

  const focusOn = useCallback((edge) => {
    const vp = vpRef.current;
    if (!vp || !edge) return;
    const D = dense(netRef.current, edge);
    const fr = frameAt(D, D.L / 2);
    vp.lookAt(fr.x, fr.y, fr.z, Math.max(120, Math.min(420, D.L * 1.1)));
  }, []);

  const deleteSelection = useCallback(() => {
    const s = stateRef.current.sel;
    if (!s) return;
    if (s.kind === 'edge') commit('Delete road', () => removeEdge(netRef.current, s.id));
    else if (s.kind === 'prop') commit('Remove prop', () => removeProp(netRef.current, s.id));
    else return;
    setSel(null);
  }, [commit]);

  // Keep latest handlers reachable from window listeners without re-binding them.
  handlers.current = {
    undo, redo, finishDraw, cancelDraw, deleteSelection, commit,
    setTool: (id) => { cancelDraw(); setTool(id); setStatus(TOOLS.find((t) => t.id === id)?.label ?? ''); },
    focus: () => {
      const s = stateRef.current.sel;
      const net = netRef.current;
      if (!s) return;
      if (s.kind === 'edge') focusOn(net.edges[s.id]);
      if (s.kind === 'node' && net.nodes[s.id]) vpRef.current?.lookAt(net.nodes[s.id].x, net.nodes[s.id].y, net.nodes[s.id].z, 200);
      if (s.kind === 'prop' && net.props[s.id]) focusOn(net.edges[net.props[s.id].edge]);
    },
  };

  // Viewport lifecycle.
  useEffect(() => {
    const vp = new RoadViewport(canvasRef.current);
    vpRef.current = vp;
    vp.start();
    const ro = new ResizeObserver(() => vp.resize());
    ro.observe(canvasRef.current);
    window.__roadEditor = {
      ready: true,
      generate: (opts) => { commit('Generate city', () => generateCity(opts)); setSel(null); },
      view: (position, yaw, pitch) => vp.setView(position, yaw, pitch),
      look: (x, y, z, d) => vp.lookAt(x, y, z, d),
      select: (kind, id) => setSel({ kind, id }),
      setTool: (id) => handlers.current.setTool(id),
      stats: () => ({ ...meshStatsRef.current }),
    };
    return () => {
      ro.disconnect();
      vp.dispose();
      vpRef.current = null;
      delete window.__roadEditor;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild the scene after every network change.
  useEffect(() => {
    const vp = vpRef.current;
    if (!vp) return;
    const t0 = performance.now();
    const net = netRef.current;
    const meshes = buildNetworkMeshes(net);
    vp.setNetwork(net, meshes);
    const ms = Math.round(performance.now() - t0);
    const s = { ...meshes.stats, rebuildMs: ms, nodes: Object.keys(net.nodes).length, edges: Object.keys(net.edges).length };
    meshStatsRef.current = s;
    setMeshStats(s);
  }, [rev]);

  useEffect(() => { vpRef.current?.setUndergroundVisible(showUnder); }, [showUnder]);
  useEffect(() => { vpRef.current?.setGridVisible(showGrid); }, [showGrid]);

  // Selection outline.
  useEffect(() => {
    const vp = vpRef.current;
    const net = netRef.current;
    if (!vp) return;
    if (!sel) vp.clearOverlay();
    else if (sel.kind === 'edge' && net.edges[sel.id]) vp.showSelection(net, sel.id);
    else if (sel.kind === 'prop' && net.props[sel.id]) vp.showSelection(net, net.props[sel.id].edge);
    else if (sel.kind === 'node' && net.nodes[sel.id]) vp.showNodeMarker(net, sel.id);
    else vp.clearOverlay();
  }, [sel, rev]);

  // Autosave (debounced, size-guarded).
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const json = JSON.stringify(serialize(netRef.current));
        if (json.length > STORE_LIMIT) {
          setWarn('Autosave skipped: network too large for local storage. Use Export.');
        } else {
          localStorage.setItem(STORE_KEY, json);
          setWarn('');
        }
      } catch (err) {
        setWarn(`Autosave failed: ${err.message}`);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [rev]);

  // Keyboard: WASD flight, tool hotkeys, undo/redo, draw/delete/focus.
  useEffect(() => {
    const FLY = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight'];
    const down = (e) => {
      if (isTyping(e.target)) return;
      const vp = vpRef.current;
      if (!vp) return;
      if (FLY.includes(e.code)) { vp.keys.add(e.code); e.preventDefault(); return; }
      const H = handlers.current;
      if (e.ctrlKey || e.metaKey) {
        if (e.code === 'KeyZ' && !e.shiftKey) { H.undo(); e.preventDefault(); }
        else if ((e.code === 'KeyZ' && e.shiftKey) || e.code === 'KeyY') { H.redo(); e.preventDefault(); }
        return;
      }
      if (/^Digit[1-5]$/.test(e.code)) { H.setTool(TOOLS[Number(e.code.slice(5)) - 1].id); return; }
      if (e.code === 'Enter') { H.finishDraw(); return; }
      if (e.code === 'Escape') { H.cancelDraw(); setSel(null); return; }
      if (e.code === 'Delete' || e.code === 'Backspace') { H.deleteSelection(); e.preventDefault(); return; }
      if (e.code === 'KeyF') H.focus();
    };
    const up = (e) => { vpRef.current?.keys.delete(e.code); };
    const blur = () => vpRef.current?.keys.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // Canvas pointer handling.
  const localXY = (ev) => {
    const r = canvasRef.current.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  };

  const snapPoint = (px, py, height) => {
    const vp = vpRef.current;
    const hit = vp.pickEdge(px, py, 9);
    if (hit) return { x: hit.x, y: hit.y, z: hit.z };
    return vp.groundAt(px, py, height);
  };

  const onPointerDown = (ev) => {
    const vp = vpRef.current;
    if (!vp) return;
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    if (ev.button === 2) {
      vp.drag = { button: 2, moved: 0 };
      canvasRef.current.setPointerCapture(ev.pointerId);
      return;
    }
    if (ev.button !== 0) return;
    const [px, py] = localXY(ev);
    const S = stateRef.current;
    const net = netRef.current;
    if (S.tool === 'select') {
      const nid = vp.pickNode(px, py);
      if (nid) {
        setSel({ kind: 'node', id: nid });
        dragRef.current = { nodeId: nid, start: net.nodes[nid], pos: null };
        canvasRef.current.setPointerCapture(ev.pointerId);
        return;
      }
      const hit = vp.pickEdge(px, py);
      setSel(hit ? { kind: 'edge', id: hit.edgeId } : null);
    } else if (S.tool === 'draw') {
      const pt = snapPoint(px, py, S.drawHeight);
      if (!pt) return;
      draftRef.current = [...draftRef.current, pt];
      setDraftCount(draftRef.current.length);
      vp.showDraft(draftRef.current, S.drawHeight);
    } else if (S.tool === 'props') {
      const hit = vp.pickEdge(px, py, 12);
      if (!hit) return;
      const place = vp.propPlacement(net, hit);
      const bollard = S.propType === 'bollard';
      commit(`Place ${S.propType}`, () => {
        const id = addProp(net, {
          type: S.propType,
          edge: hit.edgeId,
          s: place.s,
          ...(bollard ? { lat: place.lat, len: 0, spacing: 1.5 } : {}),
        });
        setSel({ kind: 'prop', id });
      });
    } else if (S.tool === 'elevate') {
      const hit = vp.pickEdge(px, py);
      if (!hit) return;
      commit('Deck height', () => setRoadHeight(net, hit.edgeId, S.elevHeight));
      setSel({ kind: 'edge', id: hit.edgeId });
    } else if (S.tool === 'delete') {
      const hit = vp.pickEdge(px, py);
      if (!hit) return;
      commit('Delete road', () => removeEdge(net, hit.edgeId));
      setSel(null);
    }
  };

  const onPointerMove = (ev) => {
    const vp = vpRef.current;
    if (!vp) return;
    if (vp.drag && vp.drag.button === 2) {
      vp.lookDelta(ev.movementX, ev.movementY);
      vp.drag.moved += Math.abs(ev.movementX) + Math.abs(ev.movementY);
      return;
    }
    const [px, py] = localXY(ev);
    const S = stateRef.current;
    if (dragRef.current) {
      const d = dragRef.current;
      const g = vp.groundAt(px, py, d.start.y);
      if (g) {
        d.pos = g;
        vp.setCursor({ x: g.x, y: d.start.y, z: g.z });
      }
      return;
    }
    if (S.tool === 'draw') {
      const pt = snapPoint(px, py, S.drawHeight);
      vp.setCursor(pt);
      if (pt) vp.showDraft([...draftRef.current, pt], S.drawHeight);
      return;
    }
    const hit = vp.pickEdge(px, py, 10);
    vp.setCursor(hit ? { x: hit.x, y: hit.y, z: hit.z } : null);
  };

  const onPointerUp = (ev) => {
    const vp = vpRef.current;
    if (!vp) return;
    if (vp.drag && vp.drag.button === 2) {
      const moved = vp.drag.moved;
      vp.drag = null;
      try { canvasRef.current.releasePointerCapture(ev.pointerId); } catch { /* not captured */ }
      if (moved < 4) {
        if (stateRef.current.tool === 'draw') finishDraw();
        else setSel(null);
      }
      return;
    }
    const d = dragRef.current;
    if (d) {
      dragRef.current = null;
      try { canvasRef.current.releasePointerCapture(ev.pointerId); } catch { /* not captured */ }
      if (d.pos && Math.hypot(d.pos.x - d.start.x, d.pos.z - d.start.z) > 0.5) {
        commit('Move node', () => moveNode(netRef.current, d.nodeId, d.pos.x, d.pos.z));
      }
    }
  };

  const onWheel = (ev) => {
    const vp = vpRef.current;
    if (!vp) return;
    vp.adjustSpeed(ev.deltaY < 0 ? 1 : -1);
    setCamSpeed(Math.round(vp.speed));
  };

  // Import / export.
  const fileRef = useRef(null);
  const exportNetwork = () => {
    const blob = new Blob([JSON.stringify(serialize(netRef.current))], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `road-network-seed${netRef.current.seed ?? 0}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const importNetwork = async (file) => {
    try {
      const obj = JSON.parse(await file.text());
      const next = deserialize(obj);
      commit('Import network', () => next);
      setSel(null);
    } catch (err) {
      setStatus(`Import failed: ${err.message}`);
    }
  };

  const net = netRef.current;
  const selEdge = sel?.kind === 'edge' ? net.edges[sel.id] : null;
  const selProp = sel?.kind === 'prop' ? net.props[sel.id] : null;
  const selNode = sel?.kind === 'node' ? net.nodes[sel.id] : null;
  const activeTool = TOOLS.find((t) => t.id === tool);
  const hint = {
    select: 'Click a road or node. Drag a node to move it (release to apply).',
    draw: 'Click to add points (snaps to roads). Enter or right-click to finish. Esc cancels.',
    props: `Click a road to place ${PROP_TYPES.find((t) => t.id === propType)?.label.toLowerCase()}.`,
    elevate: `Click a road to set its deck height to ${elevHeight} m.`,
    delete: 'Click a road to delete it. Ctrl+Z undoes.',
  }[tool];

  return (
    <div className="re-root">
      <canvas
        ref={canvasRef} className="re-canvas"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onContextMenu={(e) => e.preventDefault()} onWheel={onWheel}
      />

      <header className="re-topbar">
        <div className="re-brand"><Layers size={15} /> Frontier Road Editor <span className="re-badge">Experimental</span></div>
        <div className="re-top-actions">
          <button type="button" title="Undo (Ctrl+Z)" onClick={undo} disabled={undoRef.current.length === 0}><Undo2 size={14} /></button>
          <button type="button" title="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={redoRef.current.length === 0}><Redo2 size={14} /></button>
          <span className="re-sep" />
          <label className="re-toggle"><input type="checkbox" checked={showUnder} onChange={(e) => setShowUnder(e.target.checked)} /> Subways</label>
          <label className="re-toggle"><input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} /><Grid3x3 size={12} /> Grid</label>
          <span className="re-sep" />
          <button type="button" onClick={exportNetwork}><Download size={13} /> Export</button>
          <button type="button" onClick={() => fileRef.current?.click()}><Upload size={13} /> Import</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { if (e.target.files[0]) importNetwork(e.target.files[0]); e.target.value = ''; }} />
        </div>
      </header>

      <aside className="re-left">
        <div className="re-tools">
          {TOOLS.map((t) => {
            const Icon = t.icon;
            return (
              <button type="button" key={t.id} className={tool === t.id ? 'active' : ''} title={`${t.label} (${t.key})`}
                onClick={() => handlers.current.setTool(t.id)}>
                <Icon size={15} /><span>{t.label}</span><kbd>{t.key}</kbd>
              </button>
            );
          })}
        </div>

        {tool === 'draw' && (
          <Section title="Road type">
            <div className="re-presets">
              {PRESET_GROUPS.map((g) => (
                <div key={g}>
                  <div className="re-group">{g}</div>
                  {Object.entries(PRESETS).filter(([, p]) => p.group === g).map(([id, p]) => (
                    <button type="button" key={id} className={`re-preset ${drawPreset === id ? 'active' : ''}`} onClick={() => setDrawPreset(id)}>
                      {p.label}<span>{p.speed} km/h</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <Row label="Draw height (m)"><NumField value={drawHeight} step={0.5} min={-12} max={60} onCommit={setDrawHeight} /></Row>
            <div className="re-hint">{draftCount} point{draftCount === 1 ? '' : 's'} placed.</div>
          </Section>
        )}
        {tool === 'props' && (
          <Section title="Street furniture">
            <div className="re-chips vertical">
              {PROP_TYPES.map((t) => (
                <button type="button" key={t.id} className={propType === t.id ? 'active' : ''} onClick={() => setPropType(t.id)}>{t.label}</button>
              ))}
            </div>
          </Section>
        )}
        {tool === 'elevate' && (
          <Section title="Deck height">
            <Row label="Height (m)"><NumField value={elevHeight} step={0.5} min={-12} max={60} onCommit={setElevHeight} /></Row>
            <div className="re-hint">Set ground roads to 0 and overpasses to 6 m. Junction nodes at a road&apos;s ends move with it.</div>
          </Section>
        )}

        <GeneratorPanel commit={commit} setSel={setSel} />
      </aside>

      <aside className="re-right">
        {!sel && (
          <Section title="Network">
            {meshStats && (
              <div className="re-stats">
                <div><span>Roads</span><b>{meshStats.edges}</b></div>
                <div><span>Nodes</span><b>{meshStats.nodes}</b></div>
                <div><span>Junctions</span><b>{meshStats.junctions}</b></div>
                <div><span>Street furniture</span><b>{meshStats.props}</b></div>
                <div><span>Triangles</span><b>{(meshStats.triangles / 1000).toFixed(0)}k</b></div>
                <div><span>Rebuild</span><b>{meshStats.rebuildMs} ms</b></div>
              </div>
            )}
            <div className="re-hint">Select a road, node or piece of street furniture to edit it.</div>
          </Section>
        )}
        {selEdge && <EdgeInspector key={selEdge.id} net={net} edge={selEdge} rev={rev} commit={commit} setSel={setSel} onFocus={focusOn} />}
        {selProp && <PropInspector net={net} prop={selProp} commit={commit} setSel={setSel} />}
        {selNode && <NodeInspector net={net} node={selNode} commit={commit} setSel={setSel} />}
        {sel && !selEdge && !selProp && !selNode && (
          <Section title="Selection"><div className="re-hint">That item no longer exists.</div></Section>
        )}
      </aside>

      <footer className="re-status">
        <span className="re-tool-label">{activeTool?.label}</span>
        <span className="re-hint-inline">{hint}</span>
        <span className="re-spacer" />
        <span>{status}</span>
        {warn && <span className="re-warn">{warn}</span>}
        <span className="re-cam">Cam {camSpeed} m/s · WASD · Q/E · RMB look · Shift fast · F focus</span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
