// Frontier Road Generator Studio — Main Application, Right LayerStack/Outliner & FrontierEditor Inspector

import { clamp, lerp3, distXZ, intersectRayPlaneY } from './math-splines.js';
import { PAVING_PATTERNS, DEFAULT_TEXTURE_LAYERS, generateMaterialTextureCanvas } from './texture-layer-stack.js';
import { MAX_AI_VEHICLES, TrafficSimulator } from './traffic-simulation.js';
import { createPresetProject, buildCompleteSceneQuadGeometry } from './presets-network.js';
import { RoadStudioRenderer, ROAD_STUDIO_WGSL } from './webgpu-renderer.js';

const GUARDRAIL_DESIGNS = [
  { id: 'w-beam', name: 'Corrugated W-Beam Highway Rail' },
  { id: 'thrie-beam', name: 'Triple-Wave Thrie-Beam Heavy Rail' },
  { id: 'jersey', name: 'Precast Concrete F-Shape Jersey Barrier' },
  { id: 'box-beam', name: 'Structural Box-Beam Median Rail' },
  { id: 'cable', name: '4-Cable Tension Safety Barrier' },
  { id: 'balustrade', name: 'Architectural Pedestrian Picket Railing' },
  { id: 'parapet', name: 'Bridge Concrete Plinth & Steel Parapet' },
];

const BOLLARD_DESIGNS = [
  { id: 'heritage', name: 'Cast-Iron Fluted Heritage Bollard' },
  { id: 'stainless', name: 'Brushed Stainless LED Halo Cylinder' },
  { id: 'mitre', name: 'Sloped Mitre-Top Architectural Bollard' },
  { id: 'security', name: 'Heavy Anti-Ram Security Bollard' },
  { id: 'flexible', name: 'Spring-Base Retroreflective Delineator' },
  { id: 'illuminated', name: 'Anodized Smart Plaza Light Bollard' },
];

const SVG_ICONS = {
  layers: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
  intersection: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="4"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/></svg>',
  road: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19L9 5M15 5l5 14M12 6v3M12 11v3M12 16v3"/></svg>',
  bridge: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 14h20M4 14v6M20 14v6M4 14c4-6 12-6 16 0"/></svg>',
  tunnel: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20V10a8 8 0 0 1 16 0v10"/><path d="M8 20v-7a4 4 0 0 1 8 0v7"/></svg>',
  train: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="3" width="14" height="15" rx="3"/><path d="M5 11h14M8 18l-2 3M16 18l2 3"/><circle cx="9" cy="15" r="1"/><circle cx="15" cy="15" r="1"/></svg>',
  construction: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 3l4 18M14 3l-4 18M4 9h16M3 15h18"/></svg>',
  texture: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18"/></svg>',
  car: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 17h14v-5l-2-5H7L5 12v5z"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/></svg>',
  eye: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
  plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
};

export class FrontierRoadStudioApp {
  constructor() {
    this.project = createPresetProject('metropolitan-nexus');
    this.stackTab = 'network'; // 'network' | 'texture'
    this.selectedId = 'node-center';
    this.searchQuery = '';
    this.activeTool = 'select'; // 'select' | 'draw-road'
    this.pendingDrawNodeId = null;
    this.simPlaying = true;
    this.saved = true;

    this.trafficSim = new TrafficSimulator();
    this.compiled = null;

    this.mountDOM();
    this.renderer = new RoadStudioRenderer(
      document.getElementById('viewport-3d'),
      document.getElementById('viewport-overlay'),
      {
        onBackendReady: (name) => {
          const el = document.getElementById('gpu-backend-label');
          if (el) el.textContent = name;
        },
        onSelect: (id) => {
          this.selectedId = id;
          this.renderRightPanels();
        },
        getActiveTool: () => this.activeTool,
        onDrawRoadPoint: (worldPt) => this.handleDrawSplineRoadClick(worldPt),
        onGizmoDrag: (handle, ray, dx, dy) => this.handleGizmoDrag(handle, ray, dx, dy),
      }
    );

    this.recompileNetwork();
    this.renderRightPanels();
    this.startLoop();
    this.exposePublicApi();
  }

  mountDOM() {
    const root = document.getElementById('app');
    root.innerHTML = `
      <main class="shell">
        <!-- LEFT / CENTER: Interactive 3D WebGPU Road Viewport -->
        <section class="viewport-stage">
          <header class="viewport-topbar">
            <div class="brand-cluster">
              <div class="brand">
                <span class="brand-symbol">${SVG_ICONS.layers}</span>
                <span>frontier<span class="brand-dot">.</span></span>
              </div>
              <span class="version-tag">ROAD STUDIO / WEBGPU</span>
              <div class="gpu-badge" title="Active GPU Shader Pipeline">
                <i></i><span id="gpu-backend-label">WebGPU · WGSL PBR</span>
              </div>
            </div>

            <div class="topbar-controls">
              <select id="preset-select" class="preset-select" aria-label="Road network preset">
                <option value="metropolitan-nexus">Preset: Metropolitan Nexus (+ & Y Merged, Viaduct, Rail & Subway)</option>
                <option value="cloverleaf-interchange">Preset: I-95 Cloverleaf & Acute Y-Merge Interchange</option>
                <option value="european-roundabout">Preset: European Roundabout, Acute Y-Splines & Bored Tunnel</option>
              </select>
              <button class="pill-btn active" id="btn-quad-wire" title="Toggle True 4-Sided Quad Topology Overlay">
                Quad Topology: ON
              </button>
              <button class="pill-btn" id="btn-display-mode" title="Cycle PBR / Quad Wireframe / Texture Layer / Clearance Audit">
                Mode: PBR Shaded
              </button>
              <button class="pill-btn" id="btn-export-obj" title="Export Watertight True-Quad OBJ Mesh">
                Export Quad OBJ
              </button>
            </div>
          </header>

          <div class="canvas-wrap">
            <canvas id="viewport-3d" aria-label="3D WebGPU Road Generator Viewport"></canvas>
            <canvas id="viewport-overlay"></canvas>

            <!-- Floating Authoring & Feature Insertion Dock -->
            <nav class="authoring-dock" aria-label="Road Authoring Tools">
              <div class="dock-label">Authoring & Gizmo</div>
              <button class="tool-btn active" data-tool="select" id="tool-select">
                ${SVG_ICONS.intersection} <span>Select & Intersection Gizmo</span> <small>V</small>
              </button>
              <button class="tool-btn" data-tool="draw-road" id="tool-draw-road">
                ${SVG_ICONS.road} <span>Draw Curved Road Spline</span> <small>R</small>
              </button>
              <div class="dock-label" style="margin-top:6px">Quick Generators & Focus</div>
              <button class="tool-btn" id="act-add-y-merge">
                ${SVG_ICONS.plus} <span>Add Merged Y / + Road Branch</span>
              </button>
              <button class="tool-btn" id="act-add-pothole-bump">
                ${SVG_ICONS.construction} <span>Add Pothole & Speed Bump</span>
              </button>
              <button class="tool-btn" id="act-focus-cloverleaf">
                ${SVG_ICONS.bridge} <span>Focus Cloverleaf & Bridge</span>
              </button>
              <button class="tool-btn" id="act-toggle-construction">
                ${SVG_ICONS.construction} <span>Focus Road Rebuilding Trench</span>
              </button>
              <button class="tool-btn" id="act-focus-rail-subway">
                ${SVG_ICONS.train} <span>Focus Road-Rail Grade Crossing</span>
              </button>
            </nav>
          </div>

          <footer class="telemetry-bar">
            <div class="telemetry-metrics">
              <div><strong id="stat-quads">0</strong><span>Quads (100% Quad Mesh)</span></div>
              <div><strong id="stat-tris">0</strong><span>GPU Tris</span></div>
              <div><strong id="stat-juncs">0</strong><span>Merged Intersections</span></div>
              <div><strong id="stat-clearance">5.45 m</strong><span>Min Bridge Clearance</span></div>
              <div><strong id="stat-traffic">18 / 25</strong><span>AI Vehicles + Trains</span></div>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <button class="pill-btn active" id="btn-sim-toggle">Simulation: Running</button>
              <button class="pill-btn" id="btn-frame-center">Frame Selected</button>
            </div>
          </footer>
        </section>

        <!-- RIGHT-INNER PANEL: Layer Stack & Outliner (Network Stack + Texture Layer Stack) -->
        <aside class="outliner" aria-label="Right Layer Stack and Outliner">
          <div class="stack-mode-tabs" role="tablist">
            <button class="stack-tab active" id="tab-network-stack" role="tab" aria-selected="true">
              ${SVG_ICONS.layers} <span>Network Stack</span>
            </button>
            <button class="stack-tab" id="tab-texture-stack" role="tab" aria-selected="false">
              ${SVG_ICONS.texture} <span>Texture Stack</span>
            </button>
          </div>

          <div class="outliner-heading">
            <h2 id="stack-heading-title">Layer Stack & Outliner <span id="stack-count-badge">00</span></h2>
          </div>

          <label class="search">
            <input id="stack-search" placeholder="Filter layers, roads, textures..." />
          </label>

          <div class="tree-scroll" id="stack-tree-container"></div>

          <div class="outliner-bottom">
            <div class="world-icon">${SVG_ICONS.layers}</div>
            <div>
              <strong id="project-bottom-name">Metropolitan Nexus</strong>
              <span>Watertight Coons-Quad Topology</span>
            </div>
          </div>
        </aside>

        <!-- RIGHT-OUTER PANEL: ProjectZero / FrontierEditor Inspector -->
        <section class="inspector" id="inspector-panel" aria-label="Right Property Inspector"></section>
      </main>
    `;

    // Bind Topbar & Authoring Dock Controls
    document.getElementById('preset-select').addEventListener('change', (e) => {
      this.project = createPresetProject(e.target.value);
      this.selectedId = this.project.nodes[0]?.id || this.project.roads[0]?.id;
      this.renderer.target = [-8, 0.5, 4];
      this.renderer.distance = 98;
      this.recompileNetwork();
      this.renderRightPanels();
    });

    const wireBtn = document.getElementById('btn-quad-wire');
    wireBtn.addEventListener('click', () => {
      this.renderer.showQuadOverlay = !this.renderer.showQuadOverlay;
      wireBtn.classList.toggle('active', this.renderer.showQuadOverlay);
      wireBtn.textContent = `Quad Topology: ${this.renderer.showQuadOverlay ? 'ON' : 'OFF'}`;
    });

    const modeBtn = document.getElementById('btn-display-mode');
    const modes = [
      { id: 'pbr', label: 'Mode: PBR Shaded' },
      { id: 'quad-wire', label: 'Mode: Pure Quad Wire' },
      { id: 'layer-audit', label: 'Mode: UV & Roughness' },
      { id: 'clearance-audit', label: 'Mode: Elevation Audit' },
    ];
    modeBtn.addEventListener('click', () => {
      const idx = (modes.findIndex((m) => m.id === this.renderer.displayMode) + 1) % modes.length;
      this.renderer.displayMode = modes[idx].id;
      modeBtn.textContent = modes[idx].label;
      modeBtn.classList.toggle('active', this.renderer.displayMode !== 'pbr');
    });

    document.getElementById('btn-export-obj').addEventListener('click', () => this.exportTrueQuadOBJ());

    document.getElementById('tool-select').addEventListener('click', () => this.setActiveTool('select'));
    document.getElementById('tool-draw-road').addEventListener('click', () => this.setActiveTool('draw-road'));

    document.getElementById('act-add-y-merge').addEventListener('click', () => this.addMergedBranchSpline());
    document.getElementById('act-add-pothole-bump').addEventListener('click', () => this.addPotholeAndSpeedBump());
    document.getElementById('act-focus-cloverleaf')?.addEventListener('click', () => {
      const loopOrBridge =
        this.project.roads.find((r) => r.id.includes('clover') || r.id.includes('viaduct') || r.id.includes('overpass')) ||
        this.project.nodes.find((n) => n.id === 'node-east');
      if (loopOrBridge) {
        this.selectedId = loopOrBridge.id;
        this.renderRightPanels();
        this.renderer.framePosition([64, 2.5, -24], 68);
      }
    });
    document.getElementById('act-toggle-construction').addEventListener('click', () => {
      const cz = this.project.constructionZones?.[0];
      if (cz) {
        cz.enabled = true;
        this.selectedId = cz.id;
        this.recompileNetwork();
        this.renderRightPanels();
        this.frameSelected();
      }
    });
    document.getElementById('act-focus-rail-subway').addEventListener('click', () => {
      const rail = this.project.railways?.[0];
      if (rail) {
        this.selectedId = rail.id;
        this.renderRightPanels();
        this.renderer.framePosition([0, 0.5, 42], 38);
      }
    });

    const simBtn = document.getElementById('btn-sim-toggle');
    simBtn.addEventListener('click', () => {
      this.simPlaying = !this.simPlaying;
      simBtn.classList.toggle('active', this.simPlaying);
      simBtn.textContent = `Simulation: ${this.simPlaying ? 'Running' : 'Paused'}`;
    });

    document.getElementById('btn-frame-center').addEventListener('click', () => this.frameSelected());

    // Stack Mode Tabs (Network Stack vs Texture Layer Stack)
    const tabNet = document.getElementById('tab-network-stack');
    const tabTex = document.getElementById('tab-texture-stack');
    tabNet.addEventListener('click', () => {
      this.stackTab = 'network';
      tabNet.classList.add('active');
      tabTex.classList.remove('active');
      if (this.selectedId.startsWith('layer-')) {
        this.selectedId = this.project.nodes[0]?.id || 'node-center';
      }
      this.renderRightPanels();
    });
    tabTex.addEventListener('click', () => {
      this.stackTab = 'texture';
      tabTex.classList.add('active');
      tabNet.classList.remove('active');
      if (!this.selectedId.startsWith('layer-')) {
        this.selectedId = this.project.textureLayers[0]?.id || 'layer-asphalt-base';
      }
      this.renderRightPanels();
    });

    document.getElementById('stack-search').addEventListener('input', (e) => {
      this.searchQuery = e.target.value.trim().toLowerCase();
      this.renderStackTree();
    });
  }

  setActiveTool(tool) {
    this.activeTool = tool;
    this.pendingDrawNodeId = null;
    document.getElementById('tool-select').classList.toggle('active', tool === 'select');
    document.getElementById('tool-draw-road').classList.toggle('active', tool === 'draw-road');
  }

  handleDrawSplineRoadClick(worldPt) {
    const pt = [Math.round(worldPt[0] * 2) / 2, 0, Math.round(worldPt[2] * 2) / 2];
    // Snap to existing node if within 11m
    let targetNode = this.project.nodes.find((n) => distXZ(n.position, pt) < 11.0);
    if (!targetNode) {
      targetNode = {
        id: `node-${Date.now().toString(36)}`,
        name: `Junction Node ${this.project.nodes.length + 1}`,
        position: pt,
        radius: 9.5,
        crossings: true,
        bollards: true,
      };
      this.project.nodes.push(targetNode);
    }

    if (!this.pendingDrawNodeId) {
      this.pendingDrawNodeId = targetNode.id;
      this.selectedId = targetNode.id;
      this.renderRightPanels();
    } else if (this.pendingDrawNodeId !== targetNode.id) {
      const startNode = this.project.nodes.find((n) => n.id === this.pendingDrawNodeId);
      const mid = lerp3(startNode.position, targetNode.position, 0.5);
      // Slight natural spline curve offset that user can sculpt with the curve gizmo
      const newRoad = {
        id: `road-${Date.now().toString(36)}`,
        name: `Curved Corridor ${this.project.roads.length + 1}`,
        roadClass: 'urban',
        start: startNode.id,
        end: targetNode.id,
        curvePoint: [mid[0] + 4, 0, mid[2] - 4],
        lanes: 2,
        laneWidth: 3.5,
        sidewalkWidth: 3.6,
        curbWidth: 0.18,
        curbHeight: 0.145,
        pavingPattern: 'herringbone',
        guardrails: false,
        bollards: true,
        bollardStyle: 'heritage',
        streetlights: true,
        parking: true,
      };
      this.project.roads.push(newRoad);
      this.pendingDrawNodeId = targetNode.id;
      this.selectedId = newRoad.id;
      // Recompiling automatically splits & merges any crossed road splines into clean + or Y quad intersections!
      this.recompileNetwork();
      this.renderRightPanels();
    }
  }

  handleGizmoDrag(handle, ray, dx, dy) {
    if (handle.axis === 'road-curve') {
      const road = this.project.roads.find((r) => r.id === handle.roadId);
      if (!road) return;
      const hit = intersectRayPlaneY(ray, 0);
      if (hit) {
        road.curvePoint = [Math.round(hit[0] * 10) / 10, 0, Math.round(hit[2] * 10) / 10];
        this.recompileNetwork();
        this.renderInspector();
      }
      return;
    }

    const node = this.project.nodes.find((n) => n.id === handle.nodeId);
    if (!node) return;

    if (handle.axis === 'y') {
      node.position[1] = clamp(Number((node.position[1] - dy * 0.12).toFixed(2)), -8.0, 14.0);
    } else if (handle.axis === 'radius') {
      const hit = intersectRayPlaneY(ray, node.position[1]);
      if (hit) {
        node.radius = clamp(Number(distXZ(node.position, hit).toFixed(1)), 3.0, 24.0);
      }
    } else {
      const hit = intersectRayPlaneY(ray, node.position[1]);
      if (hit) {
        if (handle.axis === 'x') node.position[0] = Math.round(hit[0] * 2) / 2;
        else if (handle.axis === 'z') node.position[2] = Math.round(hit[2] * 2) / 2;
        else {
          node.position[0] = Math.round(hit[0] * 2) / 2;
          node.position[2] = Math.round(hit[2] * 2) / 2;
        }
      }
    }
    this.recompileNetwork();
    this.renderInspector();
  }

  addMergedBranchSpline() {
    // Creates a new spline road that crosses or joins the network to demonstrate live + / Y quad intersection merging!
    const idx = this.project.roads.length + 1;
    const nA = {
      id: `node-branch-a-${idx}`,
      name: `Branch Origin ${idx}`,
      position: [-42, 0, -56],
      radius: 9.0,
      crossings: true,
    };
    const nB = {
      id: `node-branch-b-${idx}`,
      name: `Branch Terminus ${idx}`,
      position: [-18, 0, 52],
      radius: 9.0,
      crossings: true,
    };
    this.project.nodes.push(nA, nB);
    const branchRoad = {
      id: `road-branch-${idx}`,
      name: `Cross-Avenue Spline ${idx}`,
      roadClass: 'urban',
      start: nA.id,
      end: nB.id,
      curvePoint: [-32, 0, 2],
      lanes: 2,
      laneWidth: 3.5,
      sidewalkWidth: 3.5,
      pavingPattern: 'cobble-fan',
      bollards: true,
      bollardStyle: 'stainless',
      streetlights: true,
    };
    this.project.roads.push(branchRoad);
    this.recompileNetwork();
    // Select and frame the newly created merged intersection node!
    const newestMerged = this.project.nodes[this.project.nodes.length - 1];
    if (newestMerged) this.selectedId = newestMerged.id;
    this.renderRightPanels();
    this.frameSelected();
  }

  addPotholeAndSpeedBump() {
    const road = this.project.roads.find((r) => r.id === this.selectedId) || this.project.roads[0];
    if (!road) return;
    const align = this.compiled?.alignmentsMap.get(road.id);
    if (!align) return;
    const midSt = align.stations[Math.floor(align.stations.length * 0.45)];
    const newPh = {
      id: `pothole-${Date.now().toString(36)}`,
      name: `Spalled Asphalt Pothole ${this.project.potholes.length + 1}`,
      roadId: road.id,
      position: [midSt.p[0] + midSt.n[0] * 1.6, midSt.p[1], midSt.p[2] + midSt.n[2] * 1.6],
      radius: 1.5,
      depth: 0.095,
      waterPuddle: true,
      enabled: true,
    };
    this.project.potholes.push(newPh);
    this.selectedId = newPh.id;
    this.recompileNetwork();
    this.renderRightPanels();
    this.frameSelected();
  }

  frameSelected() {
    const pick = this.compiled?.builder.pickables.find((p) => p.id === this.selectedId);
    if (pick) {
      this.renderer.framePosition(pick.center, Math.max(28, (pick.radius || 10) * 3.6));
    }
  }

  recompileNetwork() {
    this.compiled = buildCompleteSceneQuadGeometry(this.project, this.trafficSim.time);
    this.renderer.uploadStaticScene(this.compiled, this.project.textureLayers);
    this.trafficSim.syncFleet(this.project, this.compiled.alignmentsMap);
    const fleetBuilder = this.trafficSim.buildDynamicFleetQuads(this.project, this.compiled.alignmentsMap);
    this.renderer.uploadDynamicFleet(fleetBuilder);

    // Update Bottom Telemetry Bar
    const s = this.compiled.stats;
    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    setTxt('stat-quads', s.quadCount.toLocaleString('en-US'));
    setTxt('stat-tris', s.triangleCount.toLocaleString('en-US'));
    setTxt('stat-juncs', `${s.intersectionCount} (${this.project.nodes.length} Nodes)`);
    setTxt('stat-clearance', `${s.minBridgeClearance.toFixed(2)} m`);
    setTxt('stat-traffic', `${this.trafficSim.vehicles.length} / ${MAX_AI_VEHICLES} Cars · 2 Trains`);
    setTxt('project-bottom-name', this.project.name.split('·')[0].trim());
  }

  renderRightPanels() {
    this.renderStackTree();
    this.renderInspector();
  }

  renderStackTree() {
    const container = document.getElementById('stack-tree-container');
    const headingTitle = document.getElementById('stack-heading-title');
    if (!container) return;

    if (this.stackTab === 'texture') {
      const layers = this.project.textureLayers.filter(
        (l) => !this.searchQuery || l.name.toLowerCase().includes(this.searchQuery) || l.category.toLowerCase().includes(this.searchQuery)
      );
      headingTitle.innerHTML = `PBR Texture Stack <span>${layers.length.toString().padStart(2, '0')}</span>`;

      container.innerHTML = `
        <div class="group">
          <div class="group-header-row">
            <span class="group-label">${SVG_ICONS.texture} Surface & Decal Layers <span class="group-count">${layers.length}</span></span>
          </div>
          ${layers
            .map((layer, idx) => {
              const isSel = this.selectedId === layer.id;
              return `
                <div class="tree-row ${isSel ? 'selected' : ''} ${layer.enabled === false ? 'hidden-object' : ''}" style="--entity-color:${layer.color}" data-select-id="${layer.id}">
                  <button class="object-button" data-select-btn="${layer.id}">
                    <span style="width:10px;height:10px;border-radius:3px;background:${layer.baseColor};border:1px solid #666;flex-shrink:0"></span>
                    <span>${idx + 1}. ${layer.name}</span>
                    <small>${layer.blendMode}</small>
                  </button>
                  <div class="layer-order-btns">
                    <button title="Move layer up" data-move-layer="${layer.id}" data-dir="-1">▲</button>
                    <button title="Move layer down" data-move-layer="${layer.id}" data-dir="1">▼</button>
                  </div>
                  <button class="visibility" title="Toggle texture layer" data-toggle-tex="${layer.id}">
                    ${layer.enabled === false ? SVG_ICONS.eyeOff : SVG_ICONS.eye}
                  </button>
                </div>
              `;
            })
            .join('')}
        </div>
      `;

      container.querySelectorAll('[data-select-btn]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.selectedId = btn.dataset.selectBtn;
          this.renderRightPanels();
        });
      });

      container.querySelectorAll('[data-toggle-tex]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = this.project.textureLayers.find((l) => l.id === btn.dataset.toggleTex);
          if (layer) {
            layer.enabled = layer.enabled === false;
            this.renderer.rebuildTextures(this.project.textureLayers);
            this.renderRightPanels();
          }
        });
      });

      container.querySelectorAll('[data-move-layer]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.dataset.moveLayer;
          const dir = Number(btn.dataset.dir);
          const idx = this.project.textureLayers.findIndex((l) => l.id === id);
          const targetIdx = idx + dir;
          if (idx >= 0 && targetIdx >= 0 && targetIdx < this.project.textureLayers.length) {
            const arr = this.project.textureLayers;
            [arr[idx], arr[targetIdx]] = [arr[targetIdx], arr[idx]];
            this.renderer.rebuildTextures(this.project.textureLayers);
            this.renderRightPanels();
          }
        });
      });
      return;
    }

    // Mode 1: Network & Scene Layer Stack (Outliner)
    const groups = [
      {
        title: 'Merged Quad Intersections',
        layerKey: 'intersections',
        color: '#82e3c3',
        icon: SVG_ICONS.intersection,
        items: this.project.nodes.map((n) => ({
          id: n.id,
          name: n.name,
          badge: `R${n.radius}m`,
          enabled: true,
          kind: 'node',
        })),
      },
      {
        title: 'Road Splines & Bridges',
        layerKey: 'roads',
        color: '#95a5c6',
        icon: SVG_ICONS.road,
        items: this.project.roads.map((r) => ({
          id: r.id,
          name: r.name,
          badge: r.verticalProfile === 'bridge-arch' ? 'Bridge' : r.verticalProfile === 'underpass-dip' ? 'Tunnel' : `${r.lanes}L`,
          enabled: r.enabled !== false,
          kind: 'road',
        })),
      },
      {
        title: 'Railways, Trains & Subway',
        layerKey: 'railways',
        color: '#e8b65f',
        icon: SVG_ICONS.train,
        items: [
          ...(this.project.railways || []).map((r) => ({
            id: r.id,
            name: r.name,
            badge: '2-Track + Train',
            enabled: r.enabled !== false,
            kind: 'railway',
          })),
          ...(this.project.subways || []).map((s) => ({
            id: s.id,
            name: s.name,
            badge: 'Underground',
            enabled: s.enabled !== false,
            kind: 'subway',
          })),
        ],
      },
      {
        title: 'Construction, Potholes & Bumps',
        layerKey: 'construction',
        color: '#e69c79',
        icon: SVG_ICONS.construction,
        items: [
          ...(this.project.constructionZones || []).map((c) => ({
            id: c.id,
            name: c.name,
            badge: 'Trench + Bot',
            enabled: c.enabled !== false,
            kind: 'construction',
          })),
          ...(this.project.potholes || []).map((p) => ({
            id: p.id,
            name: p.name,
            badge: '3D Pothole',
            enabled: p.enabled !== false,
            kind: 'pothole',
          })),
          ...(this.project.speedBumps || []).map((b) => ({
            id: b.id,
            name: b.name,
            badge: 'Speed Bump',
            enabled: b.enabled !== false,
            kind: 'speed-bump',
          })),
        ],
      },
      {
        title: 'City Blocks (No Buildings) & Traffic',
        layerKey: 'blocks',
        color: '#bea4e1',
        icon: SVG_ICONS.car,
        items: [
          ...(this.project.cityBlocks || []).map((b) => ({
            id: b.id,
            name: b.name,
            badge: b.pavingPattern,
            enabled: b.enabled !== false,
            kind: 'block',
          })),
          {
            id: 'ai-traffic-controller',
            name: `AI Traffic Fleet (${this.project.trafficCount} / 25 Cars)`,
            badge: '≤25 AI',
            enabled: this.project.layers.traffic !== false,
            kind: 'traffic',
          },
        ],
      },
    ];

    const totalItems = groups.reduce((acc, g) => acc + g.items.length, 0);
    headingTitle.innerHTML = `Network Layer Stack <span>${totalItems.toString().padStart(2, '0')}</span>`;

    container.innerHTML = groups
      .map((group) => {
        const filtered = group.items.filter(
          (it) => !this.searchQuery || it.name.toLowerCase().includes(this.searchQuery) || it.badge.toLowerCase().includes(this.searchQuery)
        );
        if (!filtered.length) return '';
        const groupVisible = this.project.layers[group.layerKey] !== false;
        return `
          <div class="group">
            <div class="group-header-row">
              <span class="group-label">${group.icon} ${group.title} <span class="group-count">${filtered.length}</span></span>
              <button class="visibility" title="Toggle group layer visibility" data-toggle-group="${group.layerKey}">
                ${groupVisible ? SVG_ICONS.eye : SVG_ICONS.eyeOff}
              </button>
            </div>
            ${filtered
              .map((item) => {
                const isSel = this.selectedId === item.id;
                return `
                  <div class="tree-row ${isSel ? 'selected' : ''} ${!item.enabled ? 'hidden-object' : ''}" style="--entity-color:${group.color}">
                    <button class="object-button" data-select-item="${item.id}">
                      ${group.icon}
                      <span>${item.name}</span>
                      <small>${item.badge}</small>
                    </button>
                    <button class="visibility" title="Toggle item" data-toggle-item="${item.id}" data-item-kind="${item.kind}">
                      ${item.enabled ? SVG_ICONS.eye : SVG_ICONS.eyeOff}
                    </button>
                  </div>
                `;
              })
              .join('')}
          </div>
        `;
      })
      .join('');

    container.querySelectorAll('[data-select-item]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedId = btn.dataset.selectItem;
        this.renderRightPanels();
      });
      btn.addEventListener('dblclick', () => {
        this.selectedId = btn.dataset.selectItem;
        this.renderRightPanels();
        this.frameSelected();
      });
    });

    container.querySelectorAll('[data-toggle-group]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const k = btn.dataset.toggleGroup;
        this.project.layers[k] = this.project.layers[k] === false;
        this.renderRightPanels();
      });
    });

    container.querySelectorAll('[data-toggle-item]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.toggleItem;
        const allLists = [
          this.project.roads,
          this.project.railways || [],
          this.project.subways || [],
          this.project.constructionZones || [],
          this.project.potholes || [],
          this.project.speedBumps || [],
          this.project.cityBlocks || [],
        ];
        if (id === 'ai-traffic-controller') {
          this.project.layers.traffic = this.project.layers.traffic === false;
        } else {
          for (const list of allLists) {
            const found = list.find((x) => x.id === id);
            if (found) {
              found.enabled = found.enabled === false;
              break;
            }
          }
        }
        this.recompileNetwork();
        this.renderRightPanels();
      });
    });
  }

  renderInspector() {
    const panel = document.getElementById('inspector-panel');
    if (!panel) return;

    // 1. Check if a Texture Layer is selected
    const texLayer = this.project.textureLayers.find((l) => l.id === this.selectedId);
    if (texLayer) {
      this.renderTextureLayerInspector(panel, texLayer);
      return;
    }

    // 2. Check if an Intersection Node is selected
    const node = this.project.nodes.find((n) => n.id === this.selectedId);
    if (node) {
      this.renderIntersectionNodeInspector(panel, node);
      return;
    }

    // 3. Check if a Road Spline / Bridge / Tunnel is selected
    const road = this.project.roads.find((r) => r.id === this.selectedId);
    if (road) {
      this.renderRoadInspector(panel, road);
      return;
    }

    // 4. Check if Construction Zone / Pothole / Speed Bump / Railway / Subway / Block / Traffic is selected
    this.renderFeatureOrTrafficInspector(panel);
  }

  renderIntersectionNodeInspector(panel, node) {
    const junc = this.compiled?.mergedIntersections.find((j) => j.node.id === node.id);
    const armCount = junc ? junc.arms.length : 1;
    const quadCount = armCount * 32;

    panel.innerHTML = `
      <header class="inspector-top">
        <div>Inspector <span>/</span> <span>Merged Quad Intersection</span></div>
        <button class="save-status saved">✓ Watertight Coons Mesh</button>
      </header>
      <div class="inspector-content" style="--accent:#82e3c3">
        <div class="object-header">
          <div class="object-title">
            <div class="object-icon">${SVG_ICONS.intersection}</div>
            <div>
              <div class="eyebrow">${junc ? junc.type : 'ROAD ENDPOINT NODE'} · 3D GIZMO ACTIVE</div>
              <h1>${node.name}</h1>
            </div>
          </div>
          <div class="object-actions">
            <button class="enabled-pill" id="insp-frame-node"><span></span>Frame Gizmo</button>
          </div>
        </div>

        <div class="section-label">
          <span>INTERSECTION SWITCHES</span>
          <span>1 Merged Mesh · Zero Overlapping Geometry</span>
        </div>

        <div class="property-switches">
          <button class="property-switch ${node.crossings !== false ? 'is-on' : 'is-off'}" id="sw-node-crossings">
            <span class="switch-name">Zebra & ADA Ramps</span>
            <span class="switch-state">${node.crossings !== false ? 'ON' : 'OFF'}</span>
          </button>
          <button class="property-switch ${node.signalized ? 'is-on' : 'is-off'}" id="sw-node-signals">
            <span class="switch-name">Traffic Signals</span>
            <span class="switch-state">${node.signalized ? 'ON' : 'OFF'}</span>
          </button>
          <button class="property-switch ${node.bollards !== false ? 'is-on' : 'is-off'}" id="sw-node-bollards">
            <span class="switch-name">Corner Bollards</span>
            <span class="switch-state">${node.bollards !== false ? 'ON' : 'OFF'}</span>
          </button>
          <button class="property-switch ${node.roundabout ? 'is-on' : 'is-off'}" id="sw-node-roundabout">
            <span class="switch-name">Roundabout Island</span>
            <span class="switch-state">${node.roundabout ? 'ON' : 'OFF'}</span>
          </button>
          <button class="property-switch ${node.turningGuides !== false ? 'is-on' : 'is-off'}" id="sw-node-guides">
            <span class="switch-name">Turning Guide Arcs</span>
            <span class="switch-state">${node.turningGuides !== false ? 'ON' : 'OFF'}</span>
          </button>
          <button class="property-switch ${this.renderer.gizmoMode === 'radius' ? 'is-on' : 'is-off'}" id="sw-node-gizmo-mode">
            <span class="switch-name">Gizmo: ${this.renderer.gizmoMode === 'radius' ? 'Radius Ring' : 'XYZ Move'}</span>
            <span class="switch-state">ACTIVE</span>
          </button>
        </div>

        <div class="cards">
          <section class="card wide-card">
            <div class="card-heading">
              <span>${SVG_ICONS.intersection} 3D Intersection Gizmo & Coons Quad Topology</span>
              <span class="small-pill">${armCount} Arms · ${quadCount} Hub Quads</span>
            </div>
            <div class="metric">${node.radius.toFixed(1)}<small>m corner fillet radius</small></div>
            <p class="muted">Drag the 3D X/Y/Z/Radius Gizmo directly in the viewport or adjust below to move the entire merged intersection at once.</p>

            <!-- Interactive SVG Coons-Quad Topology Diagram -->
            <svg class="inspector-diagram" viewBox="0 0 380 120">
              <rect width="380" height="120" rx="8" fill="#16171a"/>
              <g stroke="#82e3c3" stroke-opacity="0.45" stroke-width="1">
                <line x1="50" y1="60" x2="330" y2="60"/>
                <line x1="190" y1="12" x2="190" y2="108"/>
                <line x1="50" y1="42" x2="330" y2="42"/>
                <line x1="50" y1="78" x2="330" y2="78"/>
                <line x1="172" y1="12" x2="172" y2="108"/>
                <line x1="208" y1="12" x2="208" y2="108"/>
                <path d="M150 42 Q172 42 172 20" fill="none" stroke="#e8c76a" stroke-width="1.8"/>
                <path d="M230 42 Q208 42 208 20" fill="none" stroke="#e8c76a" stroke-width="1.8"/>
                <path d="M150 78 Q172 78 172 100" fill="none" stroke="#e8c76a" stroke-width="1.8"/>
                <path d="M230 78 Q208 78 208 100" fill="none" stroke="#e8c76a" stroke-width="1.8"/>
              </g>
              <circle cx="190" cy="60" r="5" fill="#82e3c3"/>
              <text x="16" y="24" fill="#9a9a9a" font-size="9">COONS PATCH QUAD SECTORS (NO EARCUT SLIVERS)</text>
              <text x="16" y="108" fill="#82e3c3" font-size="9">HUB: [${node.position[0].toFixed(1)}, ${node.position[1].toFixed(1)}, ${node.position[2].toFixed(1)}]</text>
            </svg>

            <div class="control-line"><span>Corner Fillet Radius</span><span>${node.radius.toFixed(1)} m</span></div>
            <input type="range" id="inp-node-radius" min="3" max="22" step="0.5" value="${node.radius}" style="--progress:${((node.radius - 3) / 19) * 100}%"/>

            <div class="control-line"><span>Position X (West / East)</span><span>${node.position[0].toFixed(1)} m</span></div>
            <input type="range" id="inp-node-x" min="-130" max="130" step="1" value="${node.position[0]}" style="--progress:${((node.position[0] + 130) / 260) * 100}%"/>

            <div class="control-line"><span>Elevation Y (Underpass / Overpass)</span><span>${node.position[1].toFixed(2)} m</span></div>
            <input type="range" id="inp-node-y" min="-7" max="12" step="0.25" value="${node.position[1]}" style="--progress:${((node.position[1] + 7) / 19) * 100}%"/>

            <div class="control-line"><span>Position Z (North / South)</span><span>${node.position[2].toFixed(1)} m</span></div>
            <input type="range" id="inp-node-z" min="-130" max="130" step="1" value="${node.position[2]}" style="--progress:${((node.position[2] + 130) / 260) * 100}%"/>
          </section>
        </div>

        <footer class="inspector-footer">
          <span>● Real-time Coons-Quad re-solve</span>
          <span>${node.id} / Merged Intersection</span>
        </footer>
      </div>
    `;

    document.getElementById('insp-frame-node')?.addEventListener('click', () => this.frameSelected());
    document.getElementById('sw-node-crossings')?.addEventListener('click', () => {
      node.crossings = node.crossings === false;
      this.recompileNetwork();
      this.renderInspector();
    });
    document.getElementById('sw-node-signals')?.addEventListener('click', () => {
      node.signalized = !node.signalized;
      this.recompileNetwork();
      this.renderInspector();
    });
    document.getElementById('sw-node-bollards')?.addEventListener('click', () => {
      node.bollards = node.bollards === false;
      this.recompileNetwork();
      this.renderInspector();
    });
    document.getElementById('sw-node-roundabout')?.addEventListener('click', () => {
      node.roundabout = !node.roundabout;
      if (node.roundabout && node.radius < 12) node.radius = 13.5;
      this.recompileNetwork();
      this.renderInspector();
    });
    document.getElementById('sw-node-guides')?.addEventListener('click', () => {
      node.turningGuides = node.turningGuides === false;
      this.recompileNetwork();
      this.renderInspector();
    });
    document.getElementById('sw-node-gizmo-mode')?.addEventListener('click', () => {
      this.renderer.gizmoMode = this.renderer.gizmoMode === 'radius' ? 'translate' : 'radius';
      this.renderInspector();
    });

    const bindSlider = (id, fn) => {
      document.getElementById(id)?.addEventListener('input', (e) => {
        fn(Number(e.target.value));
        this.recompileNetwork();
        this.renderInspector();
      });
    };
    bindSlider('inp-node-radius', (v) => (node.radius = v));
    bindSlider('inp-node-x', (v) => (node.position[0] = v));
    bindSlider('inp-node-y', (v) => (node.position[1] = v));
    bindSlider('inp-node-z', (v) => (node.position[2] = v));
  }

  renderRoadInspector(panel, road) {
    panel.innerHTML = `
      <header class="inspector-top">
        <div>Inspector <span>/</span> <span>Road Corridor & Infrastructure</span></div>
        <button class="save-status saved">✓ 8-Strip Quad Profile</button>
      </header>
      <div class="inspector-content" style="--accent:#95a5c6">
        <div class="object-header">
          <div class="object-title">
            <div class="object-icon">${SVG_ICONS.road}</div>
            <div>
              <div class="eyebrow">${road.roadClass?.toUpperCase() || 'URBAN'} CORRIDOR · SPLINE MESH</div>
              <h1>${road.name}</h1>
            </div>
          </div>
          <div class="object-actions">
            <button class="enabled-pill" id="insp-frame-road"><span></span>Frame Road</button>
          </div>
        </div>

        <div class="section-label">
          <span>CORRIDOR FEATURE SWITCHES</span>
          <span>Toggle Real-Life Infrastructure</span>
        </div>

        <div class="property-switches">
          <button class="property-switch ${road.markings !== false ? 'is-on' : 'is-off'}" id="sw-road-markings">
            <span class="switch-name">Road Markings</span>
            <span class="switch-state">${road.markings !== false ? 'ON' : 'OFF'}</span>
          </button>
          <button class="property-switch ${road.parking ? 'is-on' : 'is-off'}" id="sw-road-parking">
            <span class="switch-name">Street Parking</span>
            <span class="switch-state">${road.parking ? 'ON' : 'OFF'}</span>
          </button>
          <button class="property-switch ${road.guardrails ? 'is-on' : 'is-off'}" id="sw-road-guardrails">
            <span class="switch-name">Guardrails</span>
            <span class="switch-state">${road.guardrails ? 'ON' : 'OFF'}</span>
          </button>
          <button class="property-switch ${road.bollards !== false ? 'is-on' : 'is-off'}" id="sw-road-bollards">
            <span class="switch-name">Bollards</span>
            <span class="switch-state">${road.bollards !== false ? 'ON' : 'OFF'}</span>
          </button>
          <button class="property-switch ${road.streetlights !== false ? 'is-on' : 'is-off'}" id="sw-road-lights">
            <span class="switch-name">Streetlights</span>
            <span class="switch-state">${road.streetlights !== false ? 'ON' : 'OFF'}</span>
          </button>
          <button class="property-switch ${road.billboards ? 'is-on' : 'is-off'}" id="sw-road-billboards">
            <span class="switch-name">Billboards & Gantry</span>
            <span class="switch-state">${road.billboards ? 'ON' : 'OFF'}</span>
          </button>
        </div>

        <div class="cards">
          <section class="card">
            <div class="card-heading"><span>${SVG_ICONS.road} Lanes & Width</span><span class="small-pill">${road.lanes} Lanes</span></div>
            <div class="metric">${(road.lanes * road.laneWidth).toFixed(1)}<small>m carriageway</small></div>
            <div class="control-line"><span>Motor Lanes</span><span>${road.lanes}</span></div>
            <input type="range" id="inp-road-lanes" min="2" max="6" step="2" value="${road.lanes}" style="--progress:${((road.lanes - 2) / 4) * 100}%"/>
            <div class="control-line"><span>Lane Width (AASHTO 3.5-3.65m)</span><span>${road.laneWidth.toFixed(2)} m</span></div>
            <input type="range" id="inp-road-lanew" min="3.0" max="4.0" step="0.05" value="${road.laneWidth}" style="--progress:${((road.laneWidth - 3.0) / 1.0) * 100}%"/>
          </section>

          <section class="card">
            <div class="card-heading"><span>${SVG_ICONS.bridge} Vertical Profile</span><span class="small-pill">${road.verticalProfile || 'At-Grade'}</span></div>
            <div class="metric">${(road.sidewalkWidth ?? 3.6).toFixed(1)}<small>m sidewalk</small></div>
            <div class="control-line"><span>Sidewalk Width</span><span>${(road.sidewalkWidth ?? 3.6).toFixed(1)} m</span></div>
            <input type="range" id="inp-road-sw" min="0.5" max="8.0" step="0.2" value="${road.sidewalkWidth ?? 3.6}" style="--progress:${(((road.sidewalkWidth ?? 3.6) - 0.5) / 7.5) * 100}%"/>
            <div class="chip-grid">
              <button class="chip-btn ${!road.verticalProfile ? 'active' : ''}" data-vprof="">At-Grade</button>
              <button class="chip-btn ${road.verticalProfile === 'bridge-arch' ? 'active' : ''}" data-vprof="bridge-arch">Bridge Overpass</button>
              <button class="chip-btn ${road.verticalProfile === 'underpass-dip' ? 'active' : ''}" data-vprof="underpass-dip">Tunnel Underpass</button>
            </div>
          </section>

          <section class="card wide-card">
            <div class="card-heading"><span>Sidewalk Paving Bond Pattern (9 Designs)</span><span class="small-pill">${road.pavingPattern || 'herringbone'}</span></div>
            <div class="chip-grid">
              ${PAVING_PATTERNS.map(
                (p) => `<button class="chip-btn ${(road.pavingPattern || 'herringbone') === p.id ? 'active' : ''}" data-paving="${p.id}"><span>${p.name}</span></button>`
              ).join('')}
            </div>
          </section>

          <section class="card">
            <div class="card-heading"><span>Guardrail & Barrier (7 Designs)</span></div>
            <div class="chip-grid" style="grid-template-columns:1fr">
              ${GUARDRAIL_DESIGNS.map(
                (g) => `<button class="chip-btn ${(road.railStyle || 'w-beam') === g.id ? 'active' : ''}" data-rail="${g.id}"><span>${g.name}</span></button>`
              ).join('')}
            </div>
          </section>

          <section class="card">
            <div class="card-heading"><span>Bollard Architecture (6 Designs)</span></div>
            <div class="chip-grid" style="grid-template-columns:1fr">
              ${BOLLARD_DESIGNS.map(
                (b) => `<button class="chip-btn ${(road.bollardStyle || 'heritage') === b.id ? 'active' : ''}" data-bollard="${b.id}"><span>${b.name}</span></button>`
              ).join('')}
            </div>
          </section>
        </div>

        <footer class="inspector-footer">
          <span>● 15mm chamfered granite curbs + continuous quad sweep</span>
          <span>${road.id}</span>
        </footer>
      </div>
    `;

    document.getElementById('insp-frame-road')?.addEventListener('click', () => this.frameSelected());
    const toggleProp = (id, key, defVal = false) => {
      document.getElementById(id)?.addEventListener('click', () => {
        road[key] = road[key] === undefined ? !defVal : !road[key];
        this.recompileNetwork();
        this.renderRightPanels();
      });
    };
    toggleProp('sw-road-markings', 'markings', true);
    toggleProp('sw-road-parking', 'parking', false);
    toggleProp('sw-road-guardrails', 'guardrails', false);
    toggleProp('sw-road-bollards', 'bollards', true);
    toggleProp('sw-road-lights', 'streetlights', true);
    toggleProp('sw-road-billboards', 'billboards', false);

    document.getElementById('inp-road-lanes')?.addEventListener('input', (e) => {
      road.lanes = Number(e.target.value);
      this.recompileNetwork();
      this.renderRightPanels();
    });
    document.getElementById('inp-road-lanew')?.addEventListener('input', (e) => {
      road.laneWidth = Number(e.target.value);
      this.recompileNetwork();
      this.renderInspector();
    });
    document.getElementById('inp-road-sw')?.addEventListener('input', (e) => {
      road.sidewalkWidth = Number(e.target.value);
      this.recompileNetwork();
      this.renderInspector();
    });

    panel.querySelectorAll('[data-vprof]').forEach((btn) => {
      btn.addEventListener('click', () => {
        road.verticalProfile = btn.dataset.vprof || null;
        this.recompileNetwork();
        this.renderRightPanels();
      });
    });
    panel.querySelectorAll('[data-paving]').forEach((btn) => {
      btn.addEventListener('click', () => {
        road.pavingPattern = btn.dataset.paving;
        this.recompileNetwork();
        this.renderRightPanels();
      });
    });
    panel.querySelectorAll('[data-rail]').forEach((btn) => {
      btn.addEventListener('click', () => {
        road.guardrails = true;
        road.railStyle = btn.dataset.rail;
        this.recompileNetwork();
        this.renderRightPanels();
      });
    });
    panel.querySelectorAll('[data-bollard]').forEach((btn) => {
      btn.addEventListener('click', () => {
        road.bollards = true;
        road.bollardStyle = btn.dataset.bollard;
        this.recompileNetwork();
        this.renderRightPanels();
      });
    });
  }

  renderTextureLayerInspector(panel, layer) {
    panel.innerHTML = `
      <header class="inspector-top">
        <div>Inspector <span>/</span> <span>PBR Texture Layer Stack</span></div>
        <button class="save-status saved">✓ Live GPU Shader Sync</button>
      </header>
      <div class="inspector-content" style="--accent:${layer.color || '#82e3c3'}">
        <div class="object-header">
          <div class="object-title">
            <div class="object-icon">${SVG_ICONS.texture}</div>
            <div>
              <div class="eyebrow">${layer.category.toUpperCase()} · ${layer.blendMode.toUpperCase()} BLEND</div>
              <h1>${layer.name}</h1>
            </div>
          </div>
          <div class="object-actions">
            <button class="enabled-pill ${layer.enabled === false ? 'disabled' : ''}" id="insp-toggle-tex">
              <span></span>${layer.enabled === false ? 'Disabled' : 'Enabled'}
            </button>
          </div>
        </div>

        <p class="muted" style="margin-bottom:16px">${layer.desc}</p>

        <div class="cards">
          <section class="card">
            <div class="card-heading"><span>PBR Material Sphere</span><span class="small-pill">Studio Preview</span></div>
            <canvas id="tex-sphere-preview" width="180" height="180" style="width:140px;height:140px;display:block;margin:0 auto;border-radius:12px"></canvas>
          </section>

          <section class="card">
            <div class="card-heading"><span>Layer Opacity & Tint</span><span class="small-pill">${layer.blendMode}</span></div>
            <div class="metric">${Math.round(layer.opacity * 100)}<small>%</small></div>
            <div class="control-line"><span>Layer Opacity</span><span>${Math.round(layer.opacity * 100)}%</span></div>
            <input type="range" id="inp-tex-opacity" min="0" max="1" step="0.02" value="${layer.opacity}" style="--progress:${layer.opacity * 100}%"/>
            <div class="control-line"><span>Base Albedo Tint</span><span>${layer.baseColor.toUpperCase()}</span></div>
            <input type="color" id="inp-tex-color" value="${layer.baseColor}" style="width:100%;height:32px;border-radius:7px;background:#181818;border:1px solid #333"/>
          </section>

          <section class="card wide-card">
            <div class="card-heading"><span>Micro-Roughness, Normal Relief & World Tiling</span></div>
            <div class="control-line"><span>Surface Roughness</span><span>${layer.roughness.toFixed(2)}</span></div>
            <input type="range" id="inp-tex-rough" min="0.04" max="0.98" step="0.02" value="${layer.roughness}" style="--progress:${layer.roughness * 100}%"/>

            <div class="control-line"><span>Normal Bump Relief</span><span>${layer.normalStrength.toFixed(2)}</span></div>
            <input type="range" id="inp-tex-normal" min="0.05" max="1.0" step="0.02" value="${layer.normalStrength}" style="--progress:${layer.normalStrength * 100}%"/>

            <div class="control-line"><span>Procedural Tiling Scale</span><span>${layer.scale.toFixed(2)}×</span></div>
            <input type="range" id="inp-tex-scale" min="0.5" max="3.0" step="0.1" value="${layer.scale}" style="--progress:${((layer.scale - 0.5) / 2.5) * 100}%"/>
          </section>
        </div>

        <footer class="inspector-footer">
          <span>● Procedural PBR Layer Stack compositor</span>
          <span>${layer.id}</span>
        </footer>
      </div>
    `;

    this.drawMaterialPreviewSphere(document.getElementById('tex-sphere-preview'), layer);

    document.getElementById('insp-toggle-tex')?.addEventListener('click', () => {
      layer.enabled = layer.enabled === false;
      this.renderer.rebuildTextures(this.project.textureLayers);
      this.renderRightPanels();
    });

    const bindTex = (id, key, isNum = true) => {
      document.getElementById(id)?.addEventListener('input', (e) => {
        layer[key] = isNum ? Number(e.target.value) : e.target.value;
        this.renderer.rebuildTextures(this.project.textureLayers);
        this.renderRightPanels();
      });
    };
    bindTex('inp-tex-opacity', 'opacity');
    bindTex('inp-tex-color', 'baseColor', false);
    bindTex('inp-tex-rough', 'roughness');
    bindTex('inp-tex-normal', 'normalStrength');
    bindTex('inp-tex-scale', 'scale');
  }

  drawMaterialPreviewSphere(canvas, layer) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const n = canvas.width;
    const img = ctx.createImageData(n, n);
    const d = img.data;
    const clean = (layer.baseColor || '#444444').replace('#', '');
    const base = [
      (parseInt(clean.slice(0, 2), 16) || 80) / 255,
      (parseInt(clean.slice(2, 4), 16) || 80) / 255,
      (parseInt(clean.slice(4, 6), 16) || 80) / 255,
    ];
    const rough = Math.max(0.06, layer.roughness);
    const normAmt = layer.normalStrength;

    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = (y * n + x) * 4;
        const nx = ((x / n - 0.5) * 2.3);
        const ny = ((0.48 - y / n) * 2.3);
        const r2 = nx * nx + ny * ny;
        if (r2 <= 1.0) {
          let z = Math.sqrt(1.0 - r2);
          const grain = Math.sin(nx * 36 * layer.scale) * Math.cos(ny * 36 * layer.scale) * normAmt * 0.12;
          const ndl = Math.max(0, -(nx + grain) * 0.45 + (ny + grain) * 0.62 + z * 0.64);
          const ndh = Math.max(0, -(nx + grain) * 0.25 + (ny + grain) * 0.35 + z * 0.9);
          const spec = Math.pow(ndh, Math.max(2, 2 / (rough * rough))) * (1 - rough * 0.75);
          for (let k = 0; k < 3; k++) {
            const v = base[k] * (0.22 + ndl * 0.78) + spec * 0.85;
            d[i + k] = Math.round(clamp(v, 0, 1) * 255);
          }
          d[i + 3] = 255;
        } else {
          d[i] = 24; d[i + 1] = 25; d[i + 2] = 28; d[i + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  renderFeatureOrTrafficInspector(panel) {
    const cz = (this.project.constructionZones || []).find((c) => c.id === this.selectedId);
    const ph = (this.project.potholes || []).find((p) => p.id === this.selectedId);
    const bump = (this.project.speedBumps || []).find((b) => b.id === this.selectedId);
    const blk = (this.project.cityBlocks || []).find((b) => b.id === this.selectedId);

    panel.innerHTML = `
      <header class="inspector-top">
        <div>Inspector <span>/</span> <span>Simulation, Distress & Transit</span></div>
        <button class="save-status saved">✓ Real-Time Active</button>
      </header>
      <div class="inspector-content" style="--accent:#e8b65f">
        <div class="object-header">
          <div class="object-title">
            <div class="object-icon">${SVG_ICONS.car}</div>
            <div>
              <div class="eyebrow">SIMULATION, DISTRESS & INFRASTRUCTURE</div>
              <h1>${cz?.name || ph?.name || bump?.name || blk?.name || 'AI Traffic, Trains & World Settings'}</h1>
            </div>
          </div>
          <div class="object-actions">
            <button class="enabled-pill" id="insp-frame-feat"><span></span>Frame in 3D</button>
          </div>
        </div>

        <div class="cards">
          <section class="card">
            <div class="card-heading"><span>${SVG_ICONS.car} AI Traffic Fleet (Max 25)</span><span class="small-pill">≤25 Vehicles</span></div>
            <div class="metric">${this.project.trafficCount}<small>/ 25 vehicles</small></div>
            <p class="muted">Multi-part 3D sedans, SUVs, buses & trucks following lanes and intersections.</p>
            <div class="control-line"><span>Active AI Vehicles</span><span>${this.project.trafficCount}</span></div>
            <input type="range" id="inp-traffic-count" min="0" max="25" step="1" value="${this.project.trafficCount}" style="--progress:${(this.project.trafficCount / 25) * 100}%"/>
          </section>

          <section class="card">
            <div class="card-heading"><span>Sun & Atmospheric Lighting</span><span class="small-pill">${this.project.sunElevation}° Elev</span></div>
            <div class="metric">${this.project.sunAzimuth}<small>° azimuth</small></div>
            <div class="control-line"><span>Sun Azimuth</span><span>${this.project.sunAzimuth}°</span></div>
            <input type="range" id="inp-sun-az" min="0" max="360" step="2" value="${this.project.sunAzimuth}" style="--progress:${(this.project.sunAzimuth / 360) * 100}%"/>
            <div class="control-line"><span>Sun Elevation</span><span>${this.project.sunElevation}°</span></div>
            <input type="range" id="inp-sun-el" min="8" max="85" step="1" value="${this.project.sunElevation}" style="--progress:${((this.project.sunElevation - 8) / 77) * 100}%"/>
          </section>

          ${
            cz
              ? `
          <section class="card wide-card">
            <div class="card-heading"><span>${SVG_ICONS.construction} Road Rebuilding Trench Controls</span><span class="small-pill">Rebar + Culvert + Bot</span></div>
            <div class="control-line"><span>Work Zone Station along Road</span><span>${cz.station.toFixed(1)} m</span></div>
            <input type="range" id="inp-cz-station" min="15" max="75" step="1" value="${cz.station}" style="--progress:${((cz.station - 15) / 60) * 100}%"/>
            <div class="control-line"><span>Excavation Trench Length</span><span>${cz.length.toFixed(1)} m</span></div>
            <input type="range" id="inp-cz-len" min="12" max="40" step="1" value="${cz.length}" style="--progress:${((cz.length - 12) / 28) * 100}%"/>
            <div class="control-line"><span>Milled Trench Depth</span><span>${(cz.depth * 100).toFixed(0)} cm</span></div>
            <input type="range" id="inp-cz-depth" min="0.15" max="0.55" step="0.02" value="${cz.depth}" style="--progress:${((cz.depth - 0.15) / 0.4) * 100}%"/>
          </section>
          `
              : ''
          }

          ${
            blk
              ? `
          <section class="card wide-card">
            <div class="card-heading"><span>Urban Block Perimeter & Plaza Paving (No Buildings)</span></div>
            <div class="chip-grid">
              ${PAVING_PATTERNS.map(
                (p) => `<button class="chip-btn ${blk.pavingPattern === p.id ? 'active' : ''}" data-blk-paving="${p.id}"><span>${p.name}</span></button>`
              ).join('')}
            </div>
          </section>
          `
              : ''
          }
        </div>

        <footer class="inspector-footer">
          <span>● Strictly ≤25 AI vehicles · Real 3D potholes, trenches, trains & subways</span>
          <span>${this.selectedId}</span>
        </footer>
      </div>
    `;

    document.getElementById('insp-frame-feat')?.addEventListener('click', () => this.frameSelected());
    document.getElementById('inp-traffic-count')?.addEventListener('input', (e) => {
      this.project.trafficCount = clamp(Number(e.target.value), 0, MAX_AI_VEHICLES);
      this.recompileNetwork();
      this.renderRightPanels();
    });
    document.getElementById('inp-sun-az')?.addEventListener('input', (e) => {
      this.project.sunAzimuth = Number(e.target.value);
      this.renderInspector();
    });
    document.getElementById('inp-sun-el')?.addEventListener('input', (e) => {
      this.project.sunElevation = Number(e.target.value);
      this.renderInspector();
    });
    if (cz) {
      document.getElementById('inp-cz-station')?.addEventListener('input', (e) => {
        cz.station = Number(e.target.value);
        this.recompileNetwork();
        this.renderInspector();
      });
      document.getElementById('inp-cz-len')?.addEventListener('input', (e) => {
        cz.length = Number(e.target.value);
        this.recompileNetwork();
        this.renderInspector();
      });
      document.getElementById('inp-cz-depth')?.addEventListener('input', (e) => {
        cz.depth = Number(e.target.value);
        this.recompileNetwork();
        this.renderInspector();
      });
    }
    if (blk) {
      panel.querySelectorAll('[data-blk-paving]').forEach((btn) => {
        btn.addEventListener('click', () => {
          blk.pavingPattern = btn.dataset.blkPaving;
          this.recompileNetwork();
          this.renderRightPanels();
        });
      });
    }
  }

  exportTrueQuadOBJ() {
    if (!this.compiled) return;
    const lines = ['# Frontier Road Generator Studio — True 4-Vertex Quad Topology OBJ Export'];
    let vOffset = 1;
    for (const batch of this.compiled.builder.batches.values()) {
      lines.push(`o ${batch.layerId}_${batch.materialId}`);
      for (let i = 0; i < batch.positions.length; i += 3) {
        lines.push(`v ${batch.positions[i].toFixed(4)} ${batch.positions[i + 1].toFixed(4)} ${batch.positions[i + 2].toFixed(4)}`);
      }
      for (const [q0, q1, q2, q3] of batch.quads) {
        lines.push(`f ${q0 + vOffset} ${q1 + vOffset} ${q2 + vOffset} ${q3 + vOffset}`);
      }
      vOffset += batch.positions.length / 3;
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.project.id}-quad-roads.obj`;
    a.click();
    URL.revokeObjectURL(url);
  }

  startLoop() {
    let last = performance.now();
    const tick = (now) => {
      const dt = (now - last) * 0.001;
      last = now;
      if (this.simPlaying && this.compiled) {
        this.trafficSim.step(dt, this.project, this.compiled.alignmentsMap);
        const fleetBuilder = this.trafficSim.buildDynamicFleetQuads(this.project, this.compiled.alignmentsMap);
        this.renderer.uploadDynamicFleet(fleetBuilder);
      }
      this.renderer.render(this.project, this.selectedId);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  exposePublicApi() {
    window.frontierRoadStudio = {
      app: this,
      getProject: () => this.project,
      getStats: () => this.compiled?.stats,
      getMergedIntersections: () => this.compiled?.mergedIntersections || [],
      getTextureLayers: () => this.project.textureLayers,
      getVehicleCount: () => this.trafficSim.vehicles.length,
      getMaxVehicles: () => MAX_AI_VEHICLES,
      getWgslShader: () => ROAD_STUDIO_WGSL,
      select: (id) => {
        this.selectedId = id;
        this.renderRightPanels();
      },
      moveIntersection: (nodeId, newPos) => {
        const n = this.project.nodes.find((x) => x.id === nodeId);
        if (n) {
          n.position = [...newPos];
          this.recompileNetwork();
          this.renderRightPanels();
        }
      },
    };
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new FrontierRoadStudioApp();
});
