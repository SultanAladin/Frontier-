import React from 'react';
import {
  Boxes,
  Download,
  Eye,
  Footprints,
  Grid3x3,
  Keyboard,
  Layers,
  MapPin,
  MousePointer2,
  Redo2,
  Route as RouteIcon,
  Settings2,
  Sparkles,
  Trash2,
  TrainFront,
  TrainTrack,
  Undo2,
  Upload,
  Focus,
  FilePlus2,
} from 'lucide-react';
import { EditorViewport, TOOLS } from './engine/viewport.js';
import { Network } from './engine/network.js';
import { generateCity } from './engine/cityGenerator.js';
import { PROFILES } from './engine/profiles.js';
import RoadLibrary from './ui/RoadLibrary.jsx';
import Outliner from './ui/Outliner.jsx';
import Inspector from './ui/Inspector.jsx';
import Minimap from './ui/Minimap.jsx';
import { GenerateCityDialog, SettingsDialog, ShortcutsDialog } from './ui/Dialogs.jsx';
import { Button, Chips, Field, NumberInput, Section, Select, Slider, ToggleField } from './ui/widgets.jsx';

const TOOL_ICONS = {
  select: MousePointer2,
  road: RouteIcon,
  path: Footprints,
  rail: TrainTrack,
  subway: TrainFront,
  detail: MapPin,
};

export default function App() {
  const hostRef = React.useRef(null);
  const networkRef = React.useRef(null);
  const viewportRef = React.useRef(null);
  const fileRef = React.useRef(null);

  const [ready, setReady] = React.useState(false);
  const [busy, setBusy] = React.useState(true);
  const [bump, setBump] = React.useState(0);
  const [selection, setSelection] = React.useState(null);
  const [stats, setStats] = React.useState(null);
  const [fps, setFps] = React.useState(60);
  const [tool, setTool] = React.useState('select');
  const [pendingProfile, setPendingProfile] = React.useState('arterial-bus-cycle');
  const [tab, setTab] = React.useState('library');
  const [dialog, setDialog] = React.useState(null);
  const [drawCount, setDrawCount] = React.useState(0);
  const [hint, setHint] = React.useState('');
  const [outlinerQuery, setOutlinerQuery] = React.useState('');
  const [view, setView] = React.useState({
    grid: true,
    xray: 0,
    wireframe: false,
    shadows: true,
    nodes: false,
    furniture: true,
    buildings: true,
    spacing: 4,
    timeOfDay: 15,
    speed: 40,
  });

  if (!networkRef.current) networkRef.current = new Network();
  const network = networkRef.current;

  /* ---------------- boot ---------------- */
  React.useEffect(() => {
    const viewport = new EditorViewport(hostRef.current, network, { spacing: 4 });
    viewportRef.current = viewport;
    viewport.setTimeOfDay(15);
    viewport.setPendingProfile(pendingProfile);

    const unsubscribe = viewport.on((event) => {
      switch (event.type) {
        case 'selection':
          setSelection(event.selection);
          break;
        case 'stats':
          setStats(event.stats);
          setBusy(false);
          break;
        case 'fps':
          setFps(event.fps);
          break;
        case 'tool':
          setTool(event.tool);
          break;
        case 'pending':
          if (event.profileId) setPendingProfile(event.profileId);
          break;
        case 'draw':
          setDrawCount(event.points);
          break;
        case 'speed':
          setView((current) => ({ ...current, speed: event.speed }));
          break;
        case 'settings':
          setView((current) => ({ ...current, ...event }));
          break;
        default:
          break;
      }
    });

    const unsubscribeNetwork = network.subscribe((event) => {
      if (event.type === 'hint') setHint(event.message);
    });

    setReady(true);
    buildCity({ seed: 1337 });
    setBusy(false);

    return () => {
      unsubscribe();
      unsubscribeNetwork();
      viewport.dispose();
      viewportRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- helpers ---------------- */

  const rerender = React.useCallback(() => setBump((n) => n + 1), []);

  const applyNetworkChange = React.useCallback(
    (reason = 'edit') => {
      network.commit(reason);
      setBump((n) => n + 1);
      viewportRef.current?.requestRebuild();
    },
    [network],
  );

  const buildCity = React.useCallback(
    (settings) => {
      setBusy(true);
      // Let the busy state paint before the synchronous generation pass.
      requestAnimationFrame(() => {
        const started = performance.now();
        network.clear();
        network.settings.massing = [];
        network.settings.river = null;
        generateCity(network, settings);
        network.settings.terrain = network.settings.terrain || {};
        network.history = [];
        network.historyIndex = -1;
        network.commit('generate');
        const viewport = viewportRef.current;
        if (viewport) {
          viewport.setSelection(null);
          viewport.rebuild();
          const camera = viewport.cameraController;
          const extent = settings.extent || 2000;
          camera.position.set(extent * 0.4, extent * 0.26, extent * 0.5);
          camera.yaw = Math.PI * 0.78;
          camera.pitch = -0.66;
          camera.smoothYaw = camera.yaw;
          camera.smoothPitch = camera.pitch;
          camera.applyToCamera();
        }
        setStats((current) => ({ ...(current || {}), ms: Math.round(performance.now() - started) }));
        setBusy(false);
        setBump((n) => n + 1);
      });
    },
    [network],
  );

  const clearDocument = React.useCallback(() => {
    network.clear();
    network.settings.massing = [];
    network.settings.river = null;
    network.commit('clear');
    viewportRef.current?.setSelection(null);
    viewportRef.current?.requestRebuild();
    setBump((n) => n + 1);
  }, [network]);

  const saveDocument = React.useCallback(() => {
    const blob = new Blob([JSON.stringify(network.serialize(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'project-zero-roads.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }, [network]);

  const openDocument = React.useCallback(
    (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          network.restore(JSON.parse(String(reader.result)));
          viewportRef.current?.setSelection(null);
          viewportRef.current?.requestRebuild();
          setBump((n) => n + 1);
        } catch (error) {
          setHint(`Could not read that file: ${error.message}`);
        }
      };
      reader.readAsText(file);
      event.target.value = '';
    },
    [network],
  );

  React.useEffect(() => {
    if (!hint) return undefined;
    const timer = setTimeout(() => setHint(''), 4200);
    return () => clearTimeout(timer);
  }, [hint]);

  const setViewSetting = React.useCallback((key, value) => {
    setView((current) => ({ ...current, [key]: value }));
    const viewport = viewportRef.current;
    if (!viewport) return;
    switch (key) {
      case 'grid': viewport.setGrid(value); break;
      case 'xray': viewport.setXray(value); break;
      case 'wireframe': viewport.setWireframe(value); break;
      case 'shadows': viewport.setShadows(value); break;
      case 'nodes': viewport.setShowNodes(value); break;
      case 'furniture': viewport.setFurniture(value); break;
      case 'buildings': viewport.setBuildings(value); break;
      case 'spacing': viewport.setSpacing(value); break;
      case 'timeOfDay': viewport.setTimeOfDay(value); break;
      default: break;
    }
  }, []);

  const changeSettings = React.useCallback(
    (patch) => {
      Object.assign(network.settings, patch);
      applyNetworkChange('settings');
    },
    [network, applyNetworkChange],
  );

  const documentStats = network.stats();
  const toolHint = TOOLS.find((entry) => entry.id === tool)?.hint || '';

  /* ---------------- render ---------------- */

  return (
    <div className="shell">
      <div className="menu-bar">
        <div className="brand">
          <span className="brand-mark">P0</span>
          <span>Project Zero</span>
          <span className="brand-sub">road editor</span>
        </div>

        <Menu label="File">
          <MenuItem icon={FilePlus2} label="New empty document" onClick={clearDocument} />
          <MenuItem icon={Sparkles} label="Generate city…" onClick={() => setDialog('city')} />
          <MenuSeparator />
          <MenuItem icon={Download} label="Save road network…" onClick={saveDocument} />
          <MenuItem icon={Upload} label="Open road network…" onClick={() => fileRef.current?.click()} />
        </Menu>

        <Menu label="Edit">
          <MenuItem
            icon={Undo2}
            label="Undo"
            shortcut="Ctrl+Z"
            disabled={!network.canUndo}
            onClick={() => {
              if (network.undo()) {
                viewportRef.current?.setSelection(null);
                viewportRef.current?.requestRebuild();
                setBump((n) => n + 1);
              }
            }}
          />
          <MenuItem
            icon={Redo2}
            label="Redo"
            shortcut="Ctrl+Shift+Z"
            disabled={!network.canRedo}
            onClick={() => {
              if (network.redo()) {
                viewportRef.current?.setSelection(null);
                viewportRef.current?.requestRebuild();
                setBump((n) => n + 1);
              }
            }}
          />
          <MenuSeparator />
          <MenuItem icon={Layers} label="Document settings…" onClick={() => setDialog('settings')} />
        </Menu>

        <Menu label="View">
          <MenuItem icon={Grid3x3} label="Ground grid" shortcut="G" checked={view.grid} onClick={() => setViewSetting('grid', !view.grid)} />
          <MenuItem icon={Eye} label="X-ray (subways)" shortcut="X" checked={view.xray > 0.5} onClick={() => setViewSetting('xray', view.xray > 0.5 ? 0 : 1)} />
          <MenuItem icon={Boxes} label="Wireframe" checked={view.wireframe} onClick={() => setViewSetting('wireframe', !view.wireframe)} />
          <MenuItem icon={Sparkles} label="Shadows" checked={view.shadows} onClick={() => setViewSetting('shadows', !view.shadows)} />
          <MenuItem icon={MapPin} label="Show all junctions" checked={view.nodes} onClick={() => setViewSetting('nodes', !view.nodes)} />
        </Menu>

        <Menu label="Generate">
          <MenuItem icon={Sparkles} label="Generate city…" onClick={() => setDialog('city')} />
          <MenuItem
            icon={DicesIcon}
            label="New random city"
            onClick={() => buildCity({ seed: Math.floor(Math.random() * 1e6) })}
          />
        </Menu>

        <div className="menu-spacer" />
        <div className="menu-stat">
          <span className={`dot${busy ? ' warn' : ' ok'}`} />
          <span>{busy ? 'Building' : 'Ready'}</span>
        </div>
        <div className="menu-stat">
          <strong>{documentStats.roads}</strong> roads · <strong>{(documentStats.length / 1000).toFixed(1)}</strong> km
        </div>
        <button type="button" className="menu-button" onClick={() => setDialog('help')}>
          <Keyboard size={13} style={{ verticalAlign: -2 }} /> Controls
        </button>
      </div>

      <div className="middle">
        <div className="rail">
          {TOOLS.map((entry) => {
            const Icon = TOOL_ICONS[entry.id] || MousePointer2;
            return (
              <button
                type="button"
                key={entry.id}
                className={`rail-button${tool === entry.id ? ' active' : ''}`}
                onClick={() => viewportRef.current?.setTool(entry.id)}
                title={entry.label}
              >
                <Icon size={17} />
                <span className="rail-tip">{entry.label}</span>
              </button>
            );
          })}
          <div className="rail-sep" />
          <button type="button" className="rail-button" onClick={() => viewportRef.current?.frameSelection()} title="Frame selection (F)">
            <Focus size={17} />
            <span className="rail-tip">Frame selection · F</span>
          </button>
          <button
            type="button"
            className="rail-button"
            onClick={() => {
              viewportRef.current?.deleteSelection();
              setBump((n) => n + 1);
            }}
            title="Delete selection (Del)"
          >
            <Trash2 size={17} />
            <span className="rail-tip">Delete selection</span>
          </button>
          <div className="rail-sep" />
          <button type="button" className="rail-button" onClick={() => setDialog('city')} title="Generate city">
            <Sparkles size={17} />
            <span className="rail-tip">Generate city</span>
          </button>
          <button type="button" className="rail-button" onClick={() => setDialog('settings')} title="Document settings">
            <Settings2 size={17} />
            <span className="rail-tip">Document settings</span>
          </button>
        </div>

        <div className="panel left">
          <div className="panel-tabs">
            {[
              { id: 'library', label: 'Library' },
              { id: 'scene', label: 'Scene' },
              { id: 'view', label: 'View' },
            ].map((entry) => (
              <button
                type="button"
                key={entry.id}
                className={`panel-tab${tab === entry.id ? ' active' : ''}`}
                onClick={() => setTab(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <div className="panel-body">
            {tab === 'library' ? (
              <RoadLibrary
                selectedProfileId={pendingProfile}
                onSelect={(id) => {
                  setPendingProfile(id);
                  viewportRef.current?.setPendingProfile(id);
                  const road = network.getRoad(selection?.id);
                  if (selection?.type === 'road' && road) {
                    road.profileId = id;
                    network.resetRoadToProfile(road);
                    applyNetworkChange('profile');
                  }
                }}
                onApplyToSelection={(id) => {
                  const road = network.getRoad(selection?.id);
                  if (selection?.type === 'road' && road) {
                    road.profileId = id;
                    network.resetRoadToProfile(road);
                    applyNetworkChange('profile');
                  }
                }}
              />
            ) : null}

            {tab === 'scene' ? (
              <Outliner
                network={network}
                selection={selection}
                query={outlinerQuery}
                onSelect={(next) => {
                  setSelection(next);
                  viewportRef.current?.setSelection(next);
                }}
                onFocus={(next) => {
                  setSelection(next);
                  viewportRef.current?.setSelection(next);
                  viewportRef.current?.frameSelection();
                }}
                onChange={() => {
                  viewportRef.current?.requestRebuild();
                  setBump((n) => n + 1);
                }}
              />
            ) : null}

            {tab === 'view' ? (
              <div>
                <Section title="Display">
                  <ToggleField label="Ground grid" value={view.grid} onChange={(value) => setViewSetting('grid', value)} />
                  <ToggleField label="Shadows" value={view.shadows} onChange={(value) => setViewSetting('shadows', value)} />
                  <ToggleField label="Wireframe" value={view.wireframe} onChange={(value) => setViewSetting('wireframe', value)} />
                  <ToggleField label="All junctions" value={view.nodes} onChange={(value) => setViewSetting('nodes', value)} />
                </Section>
                <Section title="Underground">
                  <Slider
                    label="X-ray"
                    value={view.xray}
                    min={0}
                    max={1}
                    step={0.02}
                    onChange={(value) => setViewSetting('xray', value)}
                    format={(value) => `${Math.round(value * 100)}%`}
                  />
                  <div className="empty-note" style={{ paddingTop: 0 }}>
                    Fade the ground to inspect subway tunnels, platforms and underpasses.
                  </div>
                </Section>
                <Section title="Content">
                  <ToggleField label="Street furniture" value={view.furniture} onChange={(value) => setViewSetting('furniture', value)} />
                  <ToggleField label="Block massing" value={view.buildings} onChange={(value) => setViewSetting('buildings', value)} />
                  <Field label="Tessellation">
                    <Select
                      className="select select-sm"
                      value={String(view.spacing)}
                      onChange={(value) => setViewSetting('spacing', parseFloat(value))}
                      options={[
                        { id: '2', label: '2 m — fine' },
                        { id: '3', label: '3 m' },
                        { id: '4', label: '4 m — default' },
                        { id: '6', label: '6 m — fast' },
                        { id: '8', label: '8 m — coarse' },
                      ]}
                    />
                  </Field>
                </Section>
                <Section title="Lighting">
                  <Slider
                    label="Time of day"
                    value={view.timeOfDay}
                    min={0}
                    max={24}
                    step={0.25}
                    onChange={(value) => setViewSetting('timeOfDay', value)}
                    format={(value) => `${String(Math.floor(value)).padStart(2, '0')}:${String(Math.round((value % 1) * 60)).padStart(2, '0')}`}
                  />
                </Section>
                <Section title="Document">
                  <Field label="Drive on the">
                    <Select
                      className="select select-sm"
                      value={network.settings.driveSide}
                      onChange={(value) => changeSettings({ driveSide: value })}
                      options={[
                        { id: 'right', label: 'Right (RHT)' },
                        { id: 'left', label: 'Left (LHT)' },
                      ]}
                    />
                  </Field>
                  <Field label="Kerb height">
                    <NumberInput
                      value={network.settings.curbHeight}
                      step={0.01}
                      min={0}
                      max={0.35}
                      suffix="m"
                      onChange={(value) => changeSettings({ curbHeight: value })}
                    />
                  </Field>
                  <ToggleField
                    label="Terrain"
                    value={network.settings.terrain.enabled}
                    onChange={(value) => changeSettings({ terrain: { ...network.settings.terrain, enabled: value } })}
                  />
                  <Slider
                    label="Terrain relief"
                    value={network.settings.terrain.amplitude}
                    min={0}
                    max={40}
                    step={1}
                    onChange={(value) => changeSettings({ terrain: { ...network.settings.terrain, amplitude: value } })}
                    format={(value) => `${value} m`}
                  />
                </Section>
              </div>
            ) : null}
          </div>
        </div>

        <div className="viewport-wrap">
          <div className="viewport-host" ref={hostRef} />
          <div className="hud top-left">
            <div className="tool-banner">
              <strong style={{ color: 'var(--accent)' }}>{TOOLS.find((entry) => entry.id === tool)?.label}</strong>
              <span>{toolHint}</span>
            </div>
            {drawCount > 0 ? (
              <div className="hud-card">
                <div className="hud-title">Drawing</div>
                <div className="hud-row">
                  <span>Points</span>
                  <span>{drawCount}</span>
                </div>
                <div className="hud-row">
                  <span>Finish</span>
                  <span className="key" style={{ border: '1px solid #2f373d', borderRadius: 4, padding: '0 4px' }}>Enter</span>
                </div>
              </div>
            ) : null}
            {hint ? <div className="hud-card" style={{ maxWidth: 320 }}>{hint}</div> : null}
          </div>

          <div className="hud top-right">
            <div className="hud-card">
              <div className="hud-title">Camera</div>
              <div className="hud-row">
                <span>Speed</span>
                <span>{view.speed} m/s</span>
              </div>
              <div className="hud-row">
                <span>Altitude</span>
                <span>{Math.round(viewportRef.current?.cameraController.position.y ?? 0)} m</span>
              </div>
              <div className="hud-row">
                <span>FPS</span>
                <span>{fps}</span>
              </div>
            </div>
            {stats ? (
              <div className="hud-card">
                <div className="hud-title">Scene</div>
                <div className="hud-row">
                  <span>Triangles</span>
                  <span>{(stats.triangles / 1000).toFixed(0)}k</span>
                </div>
                <div className="hud-row">
                  <span>Chunks</span>
                  <span>{stats.chunks}</span>
                </div>
                <div className="hud-row">
                  <span>Props</span>
                  <span>{stats.props}</span>
                </div>
                <div className="hud-row">
                  <span>Build</span>
                  <span>{stats.ms} ms</span>
                </div>
              </div>
            ) : null}
          </div>

          <div className="hud bottom-left">
            <Minimap network={network} viewport={viewportRef.current} />
          </div>

          <div className="hud bottom-right">
            <div className="hud-card">
              <div className="hud-row">
                <span>Roads</span>
                <span>{documentStats.roads}</span>
              </div>
              <div className="hud-row">
                <span>Junctions</span>
                <span>{documentStats.nodes}</span>
              </div>
              <div className="hud-row">
                <span>Details</span>
                <span>{documentStats.details}</span>
              </div>
              <div className="hud-row">
                <span>Subway</span>
                <span>{documentStats.subways} lines</span>
              </div>
            </div>
          </div>

          {busy ? (
            <div className="hud" style={{ inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(8,10,12,0.55)' }}>
              <div className="hud-card" style={{ fontSize: 12, padding: '14px 22px' }}>
                Building road geometry…
              </div>
            </div>
          ) : null}
        </div>

        <div className="panel right">
          <div className="panel-tabs">
            <div className="panel-tab active">Inspector</div>
          </div>
          <div className="panel-body" style={{ padding: 0 }}>
            <Inspector
              network={network}
              world={viewportRef.current?.world}
              viewport={viewportRef.current}
              selection={selection}
              onNetworkChange={() => applyNetworkChange('inspector')}
            />
          </div>
        </div>
      </div>

      <div className="status-bar">
        <span>
          <strong>{documentStats.roads}</strong> roads
        </span>
        <span>
          <strong>{(documentStats.length / 1000).toFixed(2)}</strong> km
        </span>
        <span>
          <strong>{documentStats.details}</strong> details
        </span>
        <span>
          <strong>{stats ? `${(stats.triangles / 1000).toFixed(0)}k` : '—'}</strong> tris
        </span>
        <span className="status-spacer" />
        <span>
          Kerb <strong>{network.settings.curbHeight} m</strong>
        </span>
        <span>{network.settings.driveSide === 'left' ? 'Left-hand traffic' : 'Right-hand traffic'}</span>
        <span>Grid snap {viewportRef.current?.snapEnabled ? 'on' : 'off'}</span>
        <span>
          <strong>{fps}</strong> fps
        </span>
      </div>

      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={openDocument} />

      {dialog === 'city' ? (
        <GenerateCityDialog
          initial={network.settings.city || {}}
          onClose={() => setDialog(null)}
          onGenerate={(settings) => buildCity(settings)}
        />
      ) : null}
      {dialog === 'help' ? <ShortcutsDialog onClose={() => setDialog(null)} /> : null}
      {dialog === 'settings' ? (
        <SettingsDialog
          network={network}
          settings={network.settings}
          onClose={() => setDialog(null)}
          onChange={(patch) => changeSettings(patch)}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* menu widgets                                                        */
/* ------------------------------------------------------------------ */

function Menu({ label, children }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className={`menu-button${open ? '' : ''}`} onClick={() => setOpen(!open)}>
        {label}
      </button>
      {open ? (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            minWidth: 232,
            background: 'var(--panel-2)',
            border: '1px solid var(--line)',
            borderRadius: 8,
            padding: 5,
            marginTop: 4,
            zIndex: 60,
            boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({ icon: Icon, label, shortcut, onClick, disabled = false, checked = null }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
        // close the parent menu by simulating a pointerdown elsewhere
        window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        width: '100%',
        padding: '6px 9px',
        borderRadius: 6,
        fontSize: 12,
        color: disabled ? '#4d555c' : 'var(--text-dim)',
        textAlign: 'left',
      }}
      onMouseEnter={(event) => {
        if (!disabled) event.currentTarget.style.background = 'var(--panel-3)';
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = 'none';
      }}
    >
      {Icon ? <Icon size={13} /> : <span style={{ width: 13 }} />}
      <span style={{ flex: 1 }}>{label}</span>
      {checked !== null ? (
        <span style={{ color: checked ? 'var(--accent)' : '#3f474e', fontSize: 11 }}>{checked ? '●' : '○'}</span>
      ) : null}
      {shortcut ? <span style={{ color: '#4d555c', fontSize: 10 }}>{shortcut}</span> : null}
    </button>
  );
}

function MenuSeparator() {
  return <div style={{ height: 1, background: 'var(--line)', margin: '4px 2px' }} />;
}

function DicesIcon(props) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8.5" cy="8.5" r="1" fill="currentColor" />
      <circle cx="15.5" cy="15.5" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}
