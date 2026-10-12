// DOM UI: top actions, tool rail, palette, inspector, status bar, city dialog and toasts.
// The UI reads editor state from onChange and calls editor methods. Inputs commit on
// `change` (blur or Enter), and the inspector is only re-rendered when the selection
// or the undo history changes, so typing is never interrupted.

import { TOOLS } from './editor.js';
import { ROAD_KINDS, ROAD_MODES, LANE_KINDS, lanesOf, laneOffsets } from '../core/lanes.js';
import { PROP_KINDS, PROP_KIND_IDS } from '../core/props.js';
import { CITY_DEFAULTS } from '../core/city.js';
import { findRoad, roadLength } from '../core/model.js';

const ROAD_HINTS = {
  alley: 'Narrow service lane, two-way',
  local: 'Residential street with parking',
  collector: 'Bike lanes and parking both sides',
  avenue: 'Bus lanes, bike lanes and a median',
  highway: 'Four lanes with a barrier median',
  cycleway: 'Protected two-way cycle path',
  footpath: 'Paved pedestrian path',
  railway: 'Surface track with ballast',
  subway: 'Underground rail line',
  roundabout: 'One-way ring (Roundabout tool)',
};

const TOOL_ICONS = { select: '↖', draw: '✎', prop: '▥', roundabout: '◎', delete: '✕' };

const CITY_FEATURES = [
  ['busLanes', 'Bus lanes on avenues'],
  ['bikeLanes', 'Cycle lanes'],
  ['parking', 'Parking lanes'],
  ['highway', 'Elevated highway (bridge)'],
  ['subway', 'Underground subway'],
  ['railway', 'Surface railway + level crossings'],
  ['speedBumps', 'Speed bumps'],
  ['crosswalks', 'Zebra crossings + stop lines'],
  ['lamps', 'Street lamps'],
  ['bollards', 'Bollard rows'],
  ['footpaths', 'Diagonal footpaths'],
];

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (v, d = 1) => (Number.isFinite(Number(v)) ? Number(v).toFixed(d) : '—');
const toNumber = (raw) => (raw === '' || raw === null || raw === undefined ? undefined : Number(raw));

export function mountUI(editor, { onOpen, onExportGLB, onExportJSON, onNewEmpty }) {
  const el = {
    top: document.getElementById('topactions'),
    projectName: document.getElementById('project-name'),
    toolbar: document.getElementById('toolbar'),
    palette: document.getElementById('palette'),
    inspector: document.getElementById('inspector'),
    hint: document.getElementById('hint'),
    readout: document.getElementById('readout'),
    toast: document.getElementById('toast'),
    dialog: document.getElementById('city-dialog'),
    file: document.getElementById('file-open'),
  };
  let lastSelKey = '';
  let lastHistory = -1;
  let lastToolKey = '';
  let toastTimer = null;

  // ------------------------------------------------------------------ top bar
  el.top.innerHTML = `
    <button data-act="undo" title="Undo (Ctrl+Z)">Undo</button>
    <button data-act="redo" title="Redo (Ctrl+Shift+Z)">Redo</button>
    <span class="sep-v"></span>
    <button data-act="city" class="primary" title="Generate a procedural city">Generate city…</button>
    <button data-act="new" title="Start an empty map">New empty</button>
    <button data-act="open" title="Open a .pzroad.json project">Open…</button>
    <button data-act="save" title="Download project JSON (Ctrl+S)">Save JSON</button>
    <button data-act="glb" title="Export all roads as binary glTF">Export .glb</button>`;
  el.top.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    switch (act) {
      case 'undo': return editor.undo();
      case 'redo': return editor.redo();
      case 'city': return openCityDialog();
      case 'new': return onNewEmpty();
      case 'open': return el.file.click();
      case 'save': return onExportJSON();
      case 'glb': return onExportGLB();
      default: return undefined;
    }
  });
  el.file.addEventListener('change', () => {
    const file = el.file.files?.[0];
    if (file) onOpen(file);
    el.file.value = '';
  });

  // ------------------------------------------------------------------ toolbar
  el.toolbar.innerHTML =
    Object.entries(TOOLS)
      .map(([id, t]) => `<button class="tool" data-tool="${id}" title="${esc(t.label)} (${t.key})"><span class="ico">${TOOL_ICONS[id]}</span><span class="lbl">${esc(t.label)}</span><kbd>${t.key}</kbd></button>`)
      .join('') + `
    <div class="rail-sep"></div>
    <button class="tool toggle" data-act="snap" title="Snap to grid, nodes and roads (G)"><span class="ico">#</span><span class="lbl">Snap</span><kbd>G</kbd></button>
    <label class="grid-pick" title="Grid size in metres">Grid
      <select data-act="grid"><option value="0.5">0.5 m</option><option value="2">2 m</option><option value="5">5 m</option><option value="10">10 m</option></select>
    </label>
    <button class="tool toggle" data-act="nodes" title="Show nodes (N)"><span class="ico">•</span><span class="lbl">Nodes</span><kbd>N</kbd></button>
    <button class="tool" data-act="focus" title="Focus selection (F)"><span class="ico">⌖</span><span class="lbl">Focus</span><kbd>F</kbd></button>`;
  el.toolbar.addEventListener('click', (e) => {
    const toolBtn = e.target.closest('[data-tool]');
    if (toolBtn) return editor.setTool(toolBtn.dataset.tool);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'snap') return editor.setSnap(!editor.snapOn);
    if (act === 'nodes') return editor.setShowNodes(!editor.showNodes);
    if (act === 'focus') return editor.focusSelection();
    return undefined;
  });
  el.toolbar.addEventListener('change', (e) => {
    if (e.target.dataset.act === 'grid') editor.setGrid(e.target.value);
  });

  // ------------------------------------------------------------------ palette
  el.palette.addEventListener('click', (e) => {
    const kind = e.target.closest('[data-kind]')?.dataset.kind;
    if (kind) {
      editor.setDrawKind(kind);
      if (editor.tool !== 'draw') editor.setTool('draw');
      return;
    }
    const prop = e.target.closest('[data-prop]')?.dataset.prop;
    if (prop) {
      editor.setPropKind(prop);
      if (editor.tool !== 'prop') editor.setTool('prop');
      return;
    }
    if (e.target.closest('[data-act="add-prop-here"]')) {
      const road = editor.selectedRoad();
      if (road) editor.addPropToRoad(road.id, editor.propKind);
      else message('Select a road first, or use the Place prop tool and click a road.');
    }
  });
  el.palette.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.opt) editor.setDrawOptions({ [t.dataset.opt]: t.checked });
    if (t.dataset.act === 'radius') {
      const r = Number(t.value);
      if (Number.isFinite(r) && r >= 6) editor.roundaboutRadius = r;
      editor.emit();
    }
  });

  // ------------------------------------------------------------------ inspector
  el.inspector.addEventListener('click', onInspectorClick);
  el.inspector.addEventListener('change', onInspectorChange);

  function onInspectorClick(e) {
    const t = e.target.closest('[data-act], [data-select-road], [data-select-prop]');
    if (!t) return;
    const d = t.dataset;
    if (d.selectRoad) return editor.select({ type: 'road', id: d.selectRoad });
    if (d.selectProp) return editor.select({ type: 'prop', id: d.roadId, propId: d.selectProp });
    const road = editor.selectedRoad();
    switch (d.act) {
      case 'road-focus': return editor.focusSelection();
      case 'road-delete': return road && editor.deleteRoadById(road.id);
      case 'lane-del': return road && editor.removeLane(road.id, Number(d.index));
      case 'lane-up': return road && editor.moveLane(road.id, Number(d.index), -1);
      case 'lane-down': return road && editor.moveLane(road.id, Number(d.index), 1);
      case 'lane-add': {
        if (!road) return undefined;
        const kind = el.inspector.querySelector('#lane-new')?.value || 'drive';
        const at = Number(el.inspector.querySelector('#lane-at')?.value);
        return editor.addLane(road.id, kind, Number.isFinite(at) ? at : undefined);
      }
      case 'prop-add': return road && editor.addPropToRoad(road.id, d.kind);
      case 'prop-del': return road && editor.removePropById(road.id, d.propId);
      case 'prop-back': return road && editor.select({ type: 'road', id: road.id });
      case 'node-delete': return editor.deleteSelection();
      default: return undefined;
    }
  }

  function onInspectorChange(e) {
    const t = e.target;
    const d = t.dataset;
    const road = editor.selectedRoad();
    const checked = t.type === 'checkbox' ? t.checked : undefined;
    switch (d.act) {
      case 'road-name':
        if (road) editor.updateRoad(road.id, { name: t.value.trim() || road.name }, 'Rename road');
        return undefined;
      case 'road-kind':
        if (road) editor.setRoadKind(road.id, t.value);
        return undefined;
      case 'road-mode':
        if (road) editor.setRoadMode(road.id, t.value);
        return undefined;
      case 'road-height': {
        const h = toNumber(t.value);
        if (road && Number.isFinite(h)) editor.setStructureHeight(road.id, h);
        return undefined;
      }
      case 'road-roof':
        if (road) editor.setRoof(road.id, checked);
        return undefined;
      case 'lane-kind':
        if (road) editor.updateLane(road.id, Number(d.index), { kind: t.value }, 'Change lane type');
        return undefined;
      case 'lane-width': {
        const w = toNumber(t.value);
        if (road && Number.isFinite(w) && w > 0) editor.updateLane(road.id, Number(d.index), { width: w }, 'Change lane width');
        return undefined;
      }
      case 'lane-barrier':
        if (road) editor.updateLane(road.id, Number(d.index), { barrier: checked }, 'Toggle barrier');
        return undefined;
      case 'node-x':
      case 'node-z': {
        const node = editor.selectedNode();
        const v = toNumber(t.value);
        if (!node || !Number.isFinite(v)) return undefined;
        const x = d.act === 'node-x' ? v : node.x;
        const z = d.act === 'node-z' ? v : node.z;
        return editor.setNodePosition(node.id, x, z);
      }
      case 'prop-field': {
        const field = d.field;
        let value;
        if (t.type === 'checkbox') value = checked;
        else if (field === 'ref') value = t.value === 'abs' ? undefined : t.value;
        else {
          value = toNumber(t.value);
          if (value !== undefined && !Number.isFinite(value)) return undefined;
        }
        return editor.updateProp(d.roadId, d.propId, { [field]: value });
      }
      default:
        return undefined;
    }
  }

  // ------------------------------------------------------------------ city dialog
  function openCityDialog() {
    const d = el.dialog;
    const o = CITY_DEFAULTS;
    d.innerHTML = `
      <form method="dialog" class="city-form">
        <h2>Generate a city</h2>
        <p class="muted">A seeded street grid with avenues (bus, bike and parking lanes, median), collectors and local streets, an elevated highway, an underground subway, a surface railway with level crossings, speed bumps, zebra crossings, lamps and bollards. Buildings are not generated.</p>
        <div class="grid2">
          <label>Seed <input name="seed" type="number" value="${o.seed}" min="1" step="1"></label>
          <label>Block size (m) <input name="block" type="number" value="${o.block}" min="60" max="400" step="10"></label>
          <label>Columns <input name="cols" type="number" value="${o.cols}" min="2" max="24" step="1"></label>
          <label>Rows <input name="rows" type="number" value="${o.rows}" min="2" max="24" step="1"></label>
        </div>
        <fieldset>
          <legend>Features</legend>
          ${CITY_FEATURES.map(([k, label]) => `<label class="check"><input type="checkbox" name="${k}" ${o[k] ? 'checked' : ''}> ${label}</label>`).join('')}
        </fieldset>
        <p class="muted small" id="city-size"></p>
        <menu>
          <button value="cancel" class="ghost" formnovalidate>Cancel</button>
          <button value="ok" class="primary">Generate</button>
        </menu>
      </form>`;
    const form = d.querySelector('form');
    const updateSize = () => {
      const f = new FormData(form);
      const cols = Number(f.get('cols')) || 0;
      const rows = Number(f.get('rows')) || 0;
      const block = Number(f.get('block')) || 0;
      d.querySelector('#city-size').textContent = `Footprint ${((cols * block) / 1000).toFixed(2)} × ${((rows * block) / 1000).toFixed(2)} km. Larger maps take longer to build.`;
    };
    form.addEventListener('input', updateSize);
    updateSize();
    d.addEventListener(
      'close',
      () => {
        if (d.returnValue !== 'ok') return;
        const f = new FormData(form);
        const opts = {
          seed: Math.max(1, Math.floor(Number(f.get('seed')) || 1)),
          block: Math.min(400, Math.max(60, Number(f.get('block')) || 140)),
          cols: Math.min(24, Math.max(2, Math.floor(Number(f.get('cols')) || 8))),
          rows: Math.min(24, Math.max(2, Math.floor(Number(f.get('rows')) || 8))),
        };
        for (const [k] of CITY_FEATURES) opts[k] = f.get(k) === 'on';
        if (editor.project.roads.length && !window.confirm('Replace the current map with a generated city? Ctrl+Z restores it.')) return;
        editor.generate(opts);
      },
      { once: true },
    );
    d.showModal();
  }

  // ------------------------------------------------------------------ render helpers
  function message(text) {
    el.toast.textContent = text;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 3800);
  }

  function toolHint(tool) {
    return {
      select: 'Click to select · drag handles to reshape · double-click a selected road to add a point',
      draw: 'Click to add points (snaps to nodes and roads) · Double-click or Enter to finish · Backspace removes last · Esc cancels',
      prop: 'Click a road to place the selected prop',
      roundabout: 'Click to place a roundabout ring',
      delete: 'Click a road or prop to delete it',
    }[tool] || '';
  }

  function renderToolState(state) {
    const key = [state.tool, state.snapOn, state.showNodes, state.gridSize, state.drawKind, state.propKind, JSON.stringify(state.drawOptions), state.roundaboutRadius].join('|');
    if (key === lastToolKey) return;
    lastToolKey = key;
    for (const b of el.toolbar.querySelectorAll('[data-tool]')) b.classList.toggle('active', b.dataset.tool === state.tool);
    el.toolbar.querySelector('[data-act="snap"]').classList.toggle('active', state.snapOn);
    el.toolbar.querySelector('[data-act="nodes"]').classList.toggle('active', state.showNodes);
    el.toolbar.querySelector('[data-act="grid"]').value = String(state.gridSize);
    el.palette.innerHTML = renderPalette(state);
  }

  function renderPalette(state) {
    if (state.tool === 'prop') {
      return `<h3>Props</h3>
        <p class="muted small">Click a road to place the selected prop at that point. Range props (bollards, lamps) are added to the whole road from the inspector.</p>
        <div class="list">${PROP_KIND_IDS.map((k) => `<button class="item ${state.propKind === k ? 'on' : ''}" data-prop="${k}"><b>${esc(PROP_KINDS[k].label)}</b><span>${esc(PROP_KINDS[k].hint)}</span></button>`).join('')}</div>`;
    }
    if (state.tool === 'roundabout') {
      return `<h3>Roundabout</h3>
        <p class="muted small">Click the map to place a one-way ring. Connect spokes by snapping roads to its nodes.</p>
        <label class="field">Radius (m) <input type="number" data-act="radius" value="${state.roundaboutRadius}" min="6" max="60" step="1"></label>`;
    }
    if (state.tool === 'delete') {
      return `<h3>Delete</h3><p class="muted small">Click a road to delete it, or a prop on the selected road. Undo restores it.</p>`;
    }
    const kinds = Object.keys(ROAD_KINDS)
      .map((k) => `<button class="item ${state.drawKind === k ? 'on' : ''}" data-kind="${k}"><b>${esc(ROAD_KINDS[k].label)}</b><span>${esc(ROAD_HINTS[k] || '')}</span></button>`)
      .join('');
    const o = state.drawOptions;
    return `<h3>Road types</h3>
      <p class="muted small">Pick a type and draw. Snap to existing nodes to connect roads, or onto a road to split it into a T-junction.</p>
      <div class="list">${kinds}</div>
      <div class="opts">
        <label class="check"><input type="checkbox" data-opt="busLanes" ${o.busLanes ? 'checked' : ''}> Bus lanes on avenues</label>
        <label class="check"><input type="checkbox" data-opt="bikeLanes" ${o.bikeLanes ? 'checked' : ''}> Cycle lanes</label>
        <label class="check"><input type="checkbox" data-opt="parking" ${o.parking ? 'checked' : ''}> Parking lanes</label>
      </div>
      <h4>Selected road</h4>
      <button class="ghost wide" data-act="add-prop-here">Add “${esc(PROP_KINDS[state.propKind]?.label || 'prop')}” at road centre</button>`;
  }

  function renderInspector(state) {
    const sel = state.selection;
    const selKey = sel ? `${sel.type}:${sel.id}:${sel.propId || ''}` : 'none';
    // Re-render only on selection or history change; live drags and typing stay untouched.
    const history = editor.undoStack.length;
    if (selKey === lastSelKey && history === lastHistory) return;
    lastSelKey = selKey;
    lastHistory = history;
    if (!sel) return (el.inspector.innerHTML = renderProject(state));
    if (sel.type === 'road') {
      const road = findRoad(editor.project, sel.id);
      return (el.inspector.innerHTML = road ? renderRoad(road) : renderProject(state));
    }
    if (sel.type === 'prop') {
      const road = findRoad(editor.project, sel.id);
      const prop = road?.props?.find((p) => p.id === sel.propId);
      return (el.inspector.innerHTML = prop ? renderProp(road, prop) : renderProject(state));
    }
    if (sel.type === 'node') {
      const node = editor.selectedNode();
      return (el.inspector.innerHTML = node ? renderNode(node) : renderProject(state));
    }
    return undefined;
  }

  function renderProject(state) {
    const s = state.stats;
    return `
      <h2>Project</h2>
      <div class="kpis">
        <div><b>${s.roads}</b><span>roads</span></div>
        <div><b>${num(s.lengthKm, 1)}</b><span>km of road</span></div>
        <div><b>${s.nodes}</b><span>nodes</span></div>
        <div><b>${s.props}</b><span>props</span></div>
        <div><b>${s.bridges}</b><span>bridges</span></div>
        <div><b>${s.tunnels}</b><span>underground</span></div>
      </div>
      <h3>Topology</h3>
      <p class="muted small">Roads that meet share a node, so each junction is solved once: arms are trimmed back and a single asphalt pad covers the crossing. Junction corners are filled as a convex hull, so sharp corner quadrants are not rounded.</p>
      <h3>Camera</h3>
      <ul class="keys">
        <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> fly, relative to the view</li>
        <li><kbd>Q</kbd> <kbd>E</kbd> down and up</li>
        <li>Hold <kbd>Right mouse</kbd> and drag to look (or Alt+drag)</li>
        <li><kbd>Shift</kbd> 3× speed · <kbd>Ctrl</kbd> ¼× speed</li>
        <li>Wheel dollies · wheel while looking changes speed</li>
        <li><kbd>F</kbd> focus selection</li>
      </ul>
      <h3>Editing</h3>
      <ul class="keys">
        <li><kbd>Ctrl+Z</kbd> undo · <kbd>Ctrl+Shift+Z</kbd> redo</li>
        <li><kbd>Del</kbd> delete selection · <kbd>Esc</kbd> clear</li>
        <li><kbd>1</kbd>–<kbd>5</kbd> tools · <kbd>G</kbd> snap · <kbd>N</kbd> nodes · <kbd>Ctrl+S</kbd> save JSON</li>
      </ul>`;
  }

  function renderRoad(road) {
    const diag = editor.diagnostics(road);
    const kind = ROAD_KINDS[road.kind] || ROAD_KINDS.local;
    const lanes = lanesOf(road);
    const offs = laneOffsets(lanes);
    const interior = road.points.slice(1, -1).map((p) => p.h || 0);
    const ref = interior.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0) || (road.mode === 'underground' ? -7 : 7);
    const structureValue = road.mode === 'underground' ? -Math.abs(ref) : Math.abs(ref);
    const endpoint = road.closed ? 'closed ring' : `${road.start ? 'node ' + esc(road.start) : 'open end'} → ${road.end ? 'node ' + esc(road.end) : 'open end'}`;
    return `
      <div class="head"><span class="chip">${esc(kind.group.toUpperCase())}</span><span class="muted small mono">${esc(road.id)}</span></div>
      <label class="field">Name <input data-act="road-name" value="${esc(road.name)}"></label>
      <label class="field">Road type
        <select data-act="road-kind">${Object.entries(ROAD_KINDS).map(([k, v]) => `<option value="${k}" ${k === road.kind ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select>
      </label>
      <label class="field">Structure
        <select data-act="road-mode">${Object.entries(ROAD_MODES).map(([k, v]) => `<option value="${k}" ${k === road.mode ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
      </label>
      ${road.mode !== 'surface' ? `<label class="field">${road.mode === 'underground' ? 'Depth below ground (m)' : 'Deck height (m)'} <input type="number" step="0.5" data-act="road-height" value="${structureValue}"></label>` : ''}
      ${road.mode === 'underground' ? `<label class="check"><input type="checkbox" data-act="road-roof" ${road.roof ? 'checked' : ''}> Ghost roof slab</label>` : ''}
      <dl class="facts">
        <dt>Length</dt><dd>${num(diag.length, 0)} m</dd>
        <dt>Width</dt><dd>${num(diag.width, 1)} m</dd>
        <dt>Tightest bend</dt><dd>${Number.isFinite(diag.radius) ? num(diag.radius, 1) + ' m radius' : 'straight'}</dd>
        <dt>Ends</dt><dd class="mono">${endpoint}</dd>
      </dl>
      ${diag.warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join('')}
      <h4>Lanes <span class="muted small">left → right, ${num(offs[0], 1)} to ${num(offs.at(-1), 1)} m</span></h4>
      <div class="lanes">
        ${lanes
          .map(
            (l, i) => `
          <div class="lane" style="--c:${LANE_KINDS[l.kind]?.color || '#444'}">
            <span class="swatch"></span>
            <select data-act="lane-kind" data-index="${i}" aria-label="Lane ${i + 1} type">${Object.entries(LANE_KINDS).map(([k, v]) => `<option value="${k}" ${k === l.kind ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select>
            <input type="number" step="0.1" min="0.2" data-act="lane-width" data-index="${i}" value="${Number(l.width).toFixed(2)}" title="Width (m)" aria-label="Lane ${i + 1} width">
            <label class="mini" title="Barrier on this lane's edge"><input type="checkbox" data-act="lane-barrier" data-index="${i}" ${l.barrier ? 'checked' : ''}> ▮</label>
            <button class="mini" data-act="lane-up" data-index="${i}" title="Move left">‹</button>
            <button class="mini" data-act="lane-down" data-index="${i}" title="Move right">›</button>
            <button class="mini danger" data-act="lane-del" data-index="${i}" title="Remove lane">×</button>
          </div>`,
          )
          .join('')}
      </div>
      <div class="add-lane">
        <select id="lane-new" aria-label="New lane type">${Object.entries(LANE_KINDS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select>
        <select id="lane-at" aria-label="Position"><option value="${lanes.length}">at right edge</option><option value="0">at left edge</option></select>
        <button data-act="lane-add">Add lane</button>
      </div>
      <h4>Props on this road</h4>
      ${
        (road.props || []).length
          ? `<div class="props">${road.props
              .map(
                (p) => `
              <div class="prop-row">
                <button class="link" data-select-prop="${esc(p.id)}" data-road-id="${esc(road.id)}">${esc(PROP_KINDS[p.kind]?.label || p.kind)}</button>
                <span class="muted small">${propSummary(road, p)}</span>
                <button class="mini danger" data-act="prop-del" data-prop-id="${esc(p.id)}" title="Remove prop">×</button>
              </div>`,
              )
              .join('')}</div>`
          : '<p class="muted small">No props yet.</p>'
      }
      <div class="add-props">${PROP_KIND_IDS.map((k) => `<button class="mini-wide" data-act="prop-add" data-kind="${k}">+ ${esc(PROP_KINDS[k].label)}</button>`).join('')}</div>
      <div class="row-btns">
        <button data-act="road-focus">Focus</button>
        <button class="danger" data-act="road-delete">Delete road</button>
      </div>`;
  }

  function propSummary(road, p) {
    if (PROP_KINDS[p.kind]?.range) {
      const from = p.s0 !== undefined ? `${num(p.s0, 0)} m` : 'start';
      const to = p.s1 !== undefined ? `${num(p.s1, 0)} m` : 'end';
      return `${from} → ${to}${p.spacing ? ` · every ${p.spacing} m` : ''}`;
    }
    if (p.ref === 'start') return `${num(p.s, 1)} m past start`;
    if (p.ref === 'end') return `${num(p.s, 1)} m before end`;
    return `${num(p.s, 0)} / ${num(roadLength(road), 0)} m`;
  }

  function renderProp(road, p) {
    const info = PROP_KINDS[p.kind];
    const L = roadLength(road);
    const attrs = `data-prop-id="${esc(p.id)}" data-road-id="${esc(road.id)}"`;
    const numberField = (field, label, value, step = '0.5', hint = '') =>
      `<label class="field">${label} <input type="number" step="${step}" data-act="prop-field" data-field="${field}" ${attrs} value="${value ?? ''}" placeholder="${esc(hint)}"></label>`;
    let fields = '';
    if (info.range) {
      fields += numberField('s0', 'From (m along road)', p.s0 ?? '', '1', 'start');
      fields += numberField('s1', 'To (m along road)', p.s1 ?? '', '1', 'end');
      fields += numberField('spacing', 'Spacing (m)', p.spacing ?? '', '0.5');
      if (p.kind === 'bollards') fields += numberField('offset', 'Lateral offset (m)', p.offset ?? '', '0.1', 'lane edge');
      if (p.kind === 'lamps') fields += numberField('offset', 'Lateral offset (m)', p.offset ?? '', '0.1', 'both sides');
    } else {
      fields += `<label class="field">Anchor
        <select data-act="prop-field" data-field="ref" ${attrs}>
          <option value="abs" ${!p.ref ? 'selected' : ''}>Road distance</option>
          <option value="start" ${p.ref === 'start' ? 'selected' : ''}>From trimmed start (junction edge)</option>
          <option value="end" ${p.ref === 'end' ? 'selected' : ''}>From trimmed end (junction edge)</option>
        </select></label>`;
      fields += numberField('s', p.ref ? 'Distance from anchor (m)' : `Position along road (m, max ${num(L, 0)})`, p.s ?? 0, '0.5');
      if (p.kind === 'speedBump') fields += numberField('height', 'Hump height (m)', p.height ?? 0.09, '0.01');
      if (p.kind === 'crosswalk') fields += numberField('length', 'Crossing length (m)', p.length ?? 4, '0.5');
      if (p.kind === 'railCrossing') fields += `<label class="check"><input type="checkbox" data-act="prop-field" data-field="closed" ${attrs} ${p.closed !== false ? 'checked' : ''}> Gates closed</label>`;
    }
    return `
      <div class="head"><span class="chip">PROP</span><span class="muted small mono">${esc(p.id)}</span></div>
      <h2>${esc(info.label)}</h2>
      <p class="muted small">${esc(info.hint)}</p>
      ${fields}
      <div class="row-btns">
        <button data-act="prop-back">Back to road</button>
        <button class="danger" data-act="prop-del" data-prop-id="${esc(p.id)}">Remove prop</button>
      </div>`;
  }

  function renderNode(node) {
    const roads = editor.nodeRoads(node.id);
    const pad = editor.world.junctions?.pads?.has(node.id);
    return `
      <div class="head"><span class="chip">NODE</span><span class="muted small mono">${esc(node.id)}</span></div>
      <h2>Junction node</h2>
      <p class="muted small">${pad ? 'Shared junction: one pad covers all arms.' : 'Moving a node moves every road end attached to it.'}</p>
      <div class="pair">
        <label class="field">X (m) <input type="number" step="0.5" data-act="node-x" value="${node.x}"></label>
        <label class="field">Z (m) <input type="number" step="0.5" data-act="node-z" value="${node.z}"></label>
      </div>
      <h4>Connected roads (${roads.length})</h4>
      <div class="list small">${
        roads
          .map((id) => {
            const r = findRoad(editor.project, id);
            return `<button class="item" data-select-road="${esc(id)}"><b>${esc(r?.name || id)}</b><span>${esc(ROAD_KINDS[r?.kind]?.label || '')}</span></button>`;
          })
          .join('') || '<span class="muted">None (orphan node)</span>'
      }</div>
      <div class="row-btns"><button class="danger" data-act="node-delete" ${roads.length ? 'disabled' : ''}>Delete node</button></div>
      ${roads.length ? '<p class="muted small">Delete the connected roads first to remove this node.</p>' : ''}`;
  }

  // ------------------------------------------------------------------ status bar
  function renderStatus(state) {
    const s = state.stats;
    el.projectName.textContent = editor.project.name;
    el.readout.innerHTML = `
      <span><b>${s.roads}</b> roads</span>
      <span><b>${num(s.lengthKm, 1)}</b> km</span>
      <span><b>${Math.round(s.triangles / 1000)}k</b> tris</span>
      <span>${s.tilesDirty ? `<b>${s.tilesDirty}</b> tiles updating` : `${s.tiles} tiles`}</span>
      <span class="mono">x ${num(s.camera.x, 0)} · z ${num(s.camera.z, 0)} · y ${num(s.camera.y, 0)}</span>
      <span>speed <b>${num(s.speed, 0)}</b> m/s</span>`;
    el.hint.textContent = toolHint(state.tool);
    for (const b of el.top.querySelectorAll('[data-act="undo"]')) b.disabled = !s.undo;
    for (const b of el.top.querySelectorAll('[data-act="redo"]')) b.disabled = !s.redo;
  }

  /** Called by the editor on every state change. */
  function update(state) {
    renderToolState(state);
    renderInspector(state);
    renderStatus(state);
  }

  return { update, message, openCityDialog };
}
