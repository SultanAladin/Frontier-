import React from 'react';
import {
  Copy,
  Focus,
  Layers,
  Plus,
  RotateCcw,
  Trash2,
  Route as RouteIcon,
  MousePointerClick,
} from 'lucide-react';
import {
  CENTER_LINES,
  EDGE_LINES,
  LANE_KINDS,
  LANE_KIND_LIST,
  PROFILES,
  SURFACE_CHOICES,
  carriagewayWidth,
  getProfile,
  laneWidth,
} from '../engine/profiles.js';
import { DETAIL_GROUPS, DETAIL_TYPES, DETAIL_TYPE_MAP } from '../engine/details.js';
import CrossSectionPreview, { laneColor } from './CrossSectionPreview.jsx';
import { Button, Field, NumberInput, Section, Select, Slider, ToggleField } from './widgets.jsx';

export default function Inspector({ network, world, selection, viewport, onNetworkChange }) {
  if (!selection) {
    return (
      <div className="inspector-empty">
        <MousePointerClick size={22} style={{ color: '#3d454c', marginBottom: 10 }} />
        <div>Nothing selected.</div>
        <div style={{ marginTop: 10 }}>
          Pick <strong>Road</strong> in the library, choose <em>Draw road</em> and click in the viewport to lay
          a centre-line. Press <kbd>Enter</kbd> to finish, <kbd>Esc</kbd> to cancel.
        </div>
      </div>
    );
  }

  if (selection.type === 'road') {
    const road = network.getRoad(selection.id);
    if (!road) return <div className="inspector-empty">That road no longer exists.</div>;
    return <RoadInspector road={road} network={network} world={world} viewport={viewport} onNetworkChange={onNetworkChange} />;
  }
  if (selection.type === 'node') {
    const node = network.getNode(selection.id);
    if (!node) return <div className="inspector-empty">That node no longer exists.</div>;
    return <NodeInspector node={node} network={network} onNetworkChange={onNetworkChange} />;
  }
  if (selection.type === 'subway') {
    const line = network.subways.get(selection.id);
    if (!line) return <div className="inspector-empty">That line no longer exists.</div>;
    return <SubwayInspector line={line} network={network} onNetworkChange={onNetworkChange} />;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* road                                                                */
/* ------------------------------------------------------------------ */

function RoadInspector({ road, network, world, viewport, onNetworkChange }) {
  const [, force] = React.useState(0);
  const refresh = React.useCallback(() => {
    network.emit('change');
    onNetworkChange?.('property');
  }, [network, onNetworkChange]);

  const profile = getProfile(road.profileId);
  const lanes = road.lanes || profile.lanes;
  const prepared = world?.prepared?.get(road.id);
  const [laneIndex, setLaneIndex] = React.useState(-1);

  const setProfile = (id) => {
    road.profileId = id;
    network.resetRoadToProfile(road);
    refresh();
  };

  const editLanes = (mutator) => {
    const copy = network.detachLanes(road);
    mutator(copy);
    refresh();
  };

  const lane = laneIndex >= 0 ? lanes[laneIndex] : null;

  return (
    <div>
      <div className="inspector-head">
        <div className="inspector-title">
          <RouteIcon size={14} style={{ color: 'var(--accent)' }} />
          <span>{road.name || profile.name}</span>
        </div>
        <div className="inspector-sub">
          {profile.origin} · {laneWidth(lanes).toFixed(1)} m wide · {carriagewayWidth(lanes).toFixed(1)} m carriageway
          {prepared ? ` · ${prepared.length.toFixed(0)} m long` : ''}
        </div>
        <div className="button-row" style={{ padding: '10px 0 0' }}>
          <Button onClick={() => viewport?.frameSelection()}>Frame</Button>
          <Button
            onClick={() => {
              const clone = network.addRoad(road.nodeIds.slice(), road.profileId, { name: `${road.name || profile.name} copy` });
              if (clone) {
                clone.lanes = road.lanes ? road.lanes.map((l) => ({ ...l })) : null;
                network.commit('duplicate');
                onNetworkChange?.('duplicate');
              }
            }}
          >
            <Copy size={12} /> Duplicate
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              network.removeRoad(road.id);
              network.commit('delete');
              onNetworkChange?.('delete');
            }}
          >
            <Trash2 size={12} /> Delete
          </Button>
        </div>
      </div>

      <Section title="Cross-section" count={`${lanes.length} lanes`}>
        <div style={{ padding: '2px 12px 10px' }}>
          <CrossSectionPreview
            lanes={lanes}
            width={300}
            height={54}
            showLabels
            highlightIndex={laneIndex}
            onLaneClick={(index) => setLaneIndex(index === laneIndex ? -1 : index)}
          />
          <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 6 }}>
            Click a lane to edit it. ‹ › show the direction of travel.
          </div>
        </div>

        <Field label="Type">
          <Select
            className="select select-sm"
            value={road.profileId}
            onChange={setProfile}
            options={PROFILES.map((p) => ({ id: p.id, label: p.name }))}
          />
        </Field>

        {lane ? (
          <div style={{ background: 'var(--panel-2)', padding: '8px 0', margin: '4px 0 6px' }}>
            <Field label="Lane use">
              <Select
                className="select select-sm"
                value={lane.kind}
                onChange={(kind) =>
                  editLanes((list) => {
                    list[laneIndex] = { ...lane, kind, dir: LANE_KINDS[kind]?.dir ?? lane.dir, surface: LANE_KINDS[kind]?.surface ?? lane.surface };
                  })
                }
                options={LANE_KIND_LIST.map((id) => ({ id, label: LANE_KINDS[id].label }))}
              />
            </Field>
            <Field label="Width">
              <NumberInput
                value={lane.width}
                step={0.05}
                min={0.2}
                max={30}
                suffix="m"
                onChange={(value) => editLanes((list) => { list[laneIndex] = { ...lane, width: value }; })}
              />
            </Field>
            <Field label="Direction">
              <Select
                className="select select-sm"
                value={String(lane.dir ?? 0)}
                onChange={(value) => editLanes((list) => { list[laneIndex] = { ...lane, dir: parseInt(value, 10) }; })}
                options={[
                  { id: '1', label: 'Forward' },
                  { id: '-1', label: 'Backward' },
                  { id: '0', label: 'Both / none' },
                ]}
              />
            </Field>
            <Field label="Surface">
              <Select
                className="select select-sm"
                value={lane.surface || 'asphalt'}
                onChange={(value) => editLanes((list) => { list[laneIndex] = { ...lane, surface: value }; })}
                options={SURFACE_CHOICES}
              />
            </Field>
            {(lane.kind === 'median' || lane.kind === 'sidewalk' || lane.kind === 'pathway' || lane.kind === 'cycle') ? (
              <Field label="Variant">
                <Select
                  className="select select-sm"
                  value={lane.variant || 'default'}
                  onChange={(value) =>
                    editLanes((list) => {
                      const variant = value === 'default' ? null : value;
                      list[laneIndex] = { ...lane, variant };
                    })
                  }
                  options={variantOptions(lane.kind)}
                />
              </Field>
            ) : null}
            <div className="button-row">
              <Button
                onClick={() =>
                  editLanes((list) => {
                    list.splice(laneIndex, 0, { ...lane });
                    setLaneIndex(-1);
                  })
                }
              >
                <Copy size={12} /> Duplicate lane
              </Button>
              <Button
                variant="danger"
                onClick={() => editLanes((list) => { list.splice(laneIndex, 1); setLaneIndex(-1); })}
              >
                <Trash2 size={12} /> Remove
              </Button>
            </div>
          </div>
        ) : null}

        <div style={{ maxHeight: 232, overflowY: 'auto' }}>
          {lanes.map((entry, index) => (
            <div className="lane-row" key={index}>
              <button
                type="button"
                className="select"
                style={{ fontSize: 10.5, padding: '3px 4px', border: index === laneIndex ? '1px solid #2b6b82' : undefined }}
                onClick={() => setLaneIndex(index === laneIndex ? -1 : index)}
              >
                {LANE_KINDS[entry.kind]?.label.split(' ')[0] || entry.kind}
              </button>
              <input
                className="input"
                style={{ textAlign: 'right', padding: '3px 4px' }}
                type="number"
                step={0.05}
                value={entry.width}
                onChange={(event) => {
                  const value = parseFloat(event.target.value);
                  if (Number.isFinite(value)) editLanes((list) => { list[index] = { ...entry, width: value }; });
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span className="lane-swatch" style={{ background: laneColor(entry.kind) }} />
                <Select
                  className="select"
                  value={String(entry.dir ?? 0)}
                  onChange={(value) => editLanes((list) => { list[index] = { ...entry, dir: parseInt(value, 10) }; })}
                  options={[
                    { id: '1', label: 'Forward' },
                    { id: '-1', label: 'Backward' },
                    { id: '0', label: 'Both / none' },
                  ]}
                />
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => editLanes((list) => list.splice(index, 1))}
                title="Remove lane"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>

        <div className="button-row">
          <Button
            onClick={() => editLanes((list) => list.splice(laneIndex >= 0 ? laneIndex + 1 : list.length, 0, { kind: 'driving', width: 3.2, dir: 1, surface: 'asphalt' }))}
          >
            <Plus size={12} /> Lane
          </Button>
          <Button onClick={() => editLanes((list) => list.unshift({ kind: 'sidewalk', width: 2.5, dir: 0, surface: 'slab' }))}>
            <Plus size={12} /> Footway left
          </Button>
          <Button onClick={() => editLanes((list) => list.push({ kind: 'sidewalk', width: 2.5, dir: 0, surface: 'slab' }))}>
            <Plus size={12} /> Footway right
          </Button>
          <Button
            onClick={() => {
              network.resetRoadToProfile(road);
              setLaneIndex(-1);
              refresh();
            }}
          >
            <RotateCcw size={12} /> Reset to type
          </Button>
        </div>
      </Section>

      <Section title="Markings" defaultOpen={false}>
        <Field label="Centre line">
          <Select
            className="select select-sm"
            value={road.centerLine ?? profile.centerLine ?? 'none'}
            onChange={(value) => { road.centerLine = value; refresh(); }}
            options={CENTER_LINES}
          />
        </Field>
        <Field label="Edge line">
          <Select
            className="select select-sm"
            value={road.edgeLine ?? profile.edgeLine ?? 'none'}
            onChange={(value) => { road.edgeLine = value; refresh(); }}
            options={EDGE_LINES}
          />
        </Field>
        <Field label="Kerb height">
          <NumberInput
            value={road.curbHeight ?? network.settings.curbHeight}
            step={0.01}
            min={0}
            max={0.4}
            suffix="m"
            onChange={(value) => { road.curbHeight = value; refresh(); }}
          />
        </Field>
      </Section>

      <Section title="Structure" defaultOpen={false}>
        <Field label="Form">
          <Select
            className="select select-sm"
            value={road.structure ?? profile.structure ?? 'none'}
            onChange={(value) => { road.structure = value === 'none' ? null : value; refresh(); }}
            options={[
              { id: 'none', label: 'At grade' },
              { id: 'bridge', label: 'Bridge / viaduct' },
              { id: 'tunnel', label: 'Tunnel / underpass' },
            ]}
          />
        </Field>
        <Field label="Deck height">
          <NumberInput
            value={road.deckHeight ?? 6.5}
            step={0.5}
            min={1}
            max={40}
            suffix="m"
            onChange={(value) => { road.deckHeight = value; refresh(); }}
          />
        </Field>
        <Field label="Tunnel depth">
          <NumberInput
            value={road.depth ?? 7.5}
            step={0.5}
            min={2}
            max={40}
            suffix="m"
            onChange={(value) => { road.depth = value; refresh(); }}
          />
        </Field>
      </Section>

      <DetailsSection road={road} network={network} viewport={viewport} onNetworkChange={onNetworkChange} />
    </div>
  );
}

function variantOptions(kind) {
  const base = [{ id: 'default', label: 'Standard' }];
  if (kind === 'median') {
    return [
      ...base,
      { id: 'raised', label: 'Raised reservation' },
      { id: 'hatched', label: 'Flush hatched' },
      { id: 'barrier', label: 'Concrete barrier' },
      { id: 'platform', label: 'Transit platform' },
      { id: 'wall', label: 'Retaining wall' },
      { id: 'parapet', label: 'Bridge parapet' },
    ];
  }
  if (kind === 'sidewalk') {
    return [...base, { id: 'flush', label: 'Flush (shared surface)' }, { id: 'platform', label: 'Platform' }];
  }
  if (kind === 'pathway') {
    return [...base, { id: 'deck', label: 'Timber deck' }];
  }
  if (kind === 'cycle') {
    return [...base, { id: 'tinted', label: 'Tinted surface' }, { id: 'contraflow', label: 'Contraflow' }];
  }
  return base;
}

/* ------------------------------------------------------------------ */
/* details                                                             */
/* ------------------------------------------------------------------ */

function DetailsSection({ road, network, viewport, onNetworkChange }) {
  const [group, setGroup] = React.useState('calming');
  const [pending, setPending] = React.useState('speed-bump');
  const [, force] = React.useState(0);
  const refresh = () => {
    force((n) => n + 1);
    onNetworkChange?.('detail');
  };

  const itemsInGroup = DETAIL_TYPES.filter((detail) => detail.group === group);

  return (
    <Section title="Furniture & details" count={road.details.length}>
      <Field label="Category">
        <Select
          className="select select-sm"
          value={group}
          onChange={(value) => {
            setGroup(value);
            const first = DETAIL_TYPES.find((detail) => detail.group === value);
            if (first) setPending(first.id);
          }}
          options={DETAIL_GROUPS.map((entry) => ({ id: entry.id, label: entry.label }))}
        />
      </Field>
      <Field label="Detail">
        <Select
          className="select select-sm"
          value={pending}
          onChange={setPending}
          options={itemsInGroup.map((detail) => ({ id: detail.id, label: detail.label }))}
        />
      </Field>
      <div className="button-row">
        <Button
          onClick={() => {
            const def = DETAIL_TYPE_MAP.get(pending);
            network.addDetail(road.id, { type: pending, s: 0.5, ...def.defaults });
            network.commit('add detail');
            refresh();
          }}
        >
          <Plus size={12} /> Add at start
        </Button>
        <Button
          onClick={() => {
            const def = DETAIL_TYPE_MAP.get(pending);
            const length = preparedLength(road, network);
            network.addDetail(road.id, { type: pending, s: length * 0.5, ...def.defaults });
            network.commit('add detail');
            refresh();
          }}
        >
          <Plus size={12} /> Add at centre
        </Button>
        <Button
          onClick={() => {
            viewport?.setPendingDetail(pending);
            viewport?.setTool('detail');
            network.emit('hint', { message: `Click the road to place: ${DETAIL_TYPE_MAP.get(pending)?.label || pending}.` });
          }}
        >
          <MousePointerClick size={12} /> Place by clicking
        </Button>
      </div>
      <div style={{ padding: '0 12px 6px', fontSize: 10, color: 'var(--text-faint)' }}>
        {DETAIL_TYPE_MAP.get(pending)?.blurb}
      </div>

      {road.details.map((detail) => {
        const def = DETAIL_TYPE_MAP.get(detail.type);
        return (
          <div key={detail.id} style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 6 }}>
            <div className="detail-row">
              <span className="name">{def?.label || detail.type}</span>
              <span className="at">{detail.s.toFixed(0)} m</span>
              <button
                type="button"
                className="icon-button"
                onClick={() => {
                  network.removeDetail(road.id, detail.id);
                  network.commit('remove detail');
                  refresh();
                }}
                title="Remove"
              >
                <Trash2 size={12} />
              </button>
            </div>
            <Slider
              label="Position"
              value={detail.s}
              min={0}
              max={Math.max(1, preparedLength(road, network))}
              step={0.5}
              onChange={(value) => {
                detail.s = value;
                refresh();
              }}
              format={(value) => `${value.toFixed(0)} m`}
            />
            {(def?.fields || []).map((field) => (
              <DetailField
                key={field.key}
                field={field}
                value={detail[field.key]}
                onChange={(value) => {
                  detail[field.key] = value;
                  refresh();
                }}
              />
            ))}
          </div>
        );
      })}
      {!road.details.length ? (
        <div className="empty-note" style={{ paddingTop: 4 }}>
          No details yet. Add bus stops, bollards, crossings, speed bumps or a level crossing.
        </div>
      ) : null}
    </Section>
  );
}

function DetailField({ field, value, onChange }) {
  if (field.type === 'toggle') return <ToggleField label={field.label} value={!!value} onChange={onChange} />;
  if (field.type === 'select') return (
    <Field label={field.label}>
      <Select className="select select-sm" value={value} onChange={onChange} options={field.options.map((o) => ({ id: o, label: o.replace(/-/g, ' ') }))} />
    </Field>
  );
  if (field.type === 'surface') return (
    <Field label={field.label}>
      <Select className="select select-sm" value={value} onChange={onChange} options={SURFACE_CHOICES} />
    </Field>
  );
  return (
    <Field label={field.label}>
      <NumberInput value={value} min={field.min} max={field.max} step={field.step} suffix={field.unit} onChange={onChange} />
    </Field>
  );
}

function preparedLength(road, network) {
  const points = network.roadPoints(road);
  let length = 0;
  for (let i = 0; i < points.length - 1; i++) {
    length += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z);
  }
  return length;
}

/* ------------------------------------------------------------------ */
/* node & subway                                                       */
/* ------------------------------------------------------------------ */

function NodeInspector({ node, network, onNetworkChange }) {
  const [, force] = React.useState(0);
  const refresh = () => {
    force((n) => n + 1);
    onNetworkChange?.('node');
  };
  const degree = [...network.roads.values()].filter((road) => road.nodeIds.includes(node.id)).length;

  return (
    <div>
      <div className="inspector-head">
        <div className="inspector-title">
          <Layers size={14} style={{ color: 'var(--accent)' }} />
          <span>Junction {node.id}</span>
        </div>
        <div className="inspector-sub">
          {degree} connected road{degree === 1 ? '' : 's'} · x {node.x.toFixed(1)} · z {node.z.toFixed(1)}
        </div>
      </div>

      <Section title="Node">
        <Field label="Kind">
          <Select
            className="select select-sm"
            value={node.kind}
            onChange={(value) => { node.kind = value; refresh(); }}
            options={[
              { id: 'plain', label: 'Plain' },
              { id: 'junction', label: 'Junction' },
              { id: 'roundabout', label: 'Roundabout' },
            ]}
          />
        </Field>
        <Field label="X">
          <NumberInput value={node.x} step={1} onChange={(value) => { node.x = value; refresh(); }} />
        </Field>
        <Field label="Z">
          <NumberInput value={node.z} step={1} onChange={(value) => { node.z = value; refresh(); }} />
        </Field>
        <Field label="Y">
          <NumberInput value={node.y ?? 0} step={0.5} onChange={(value) => { node.y = value; refresh(); }} />
        </Field>
      </Section>

      {node.kind === 'roundabout' ? (
        <Section title="Roundabout">
          <Field label="Island radius">
            <NumberInput value={node.radius ?? 12} step={0.5} min={3} max={60} suffix="m" onChange={(value) => { node.radius = value; refresh(); }} />
          </Field>
          <Field label="Circulatory lanes">
            <NumberInput value={node.lanes ?? 1} step={1} min={1} max={4} onChange={(value) => { node.lanes = value; refresh(); }} />
          </Field>
          <Field label="Lane width">
            <NumberInput value={node.laneWidth ?? 4.8} step={0.1} min={3} max={8} suffix="m" onChange={(value) => { node.laneWidth = value; refresh(); }} />
          </Field>
          <Field label="Footway ring">
            <NumberInput value={node.footway ?? 3} step={0.5} min={0} max={12} suffix="m" onChange={(value) => { node.footway = value; refresh(); }} />
          </Field>
          <Field label="Island surface">
            <Select className="select select-sm" value={node.islandSurface || 'grass'} onChange={(value) => { node.islandSurface = value; refresh(); }} options={SURFACE_CHOICES} />
          </Field>
        </Section>
      ) : null}

      <div className="button-row">
        <Button
          variant="danger"
          onClick={() => {
            network.removeNode(node.id);
            network.commit('delete node');
            onNetworkChange?.('delete');
          }}
        >
          <Trash2 size={12} /> Delete node
        </Button>
      </div>
    </div>
  );
}

function SubwayInspector({ line, network, onNetworkChange }) {
  const [, force] = React.useState(0);
  const refresh = () => {
    force((n) => n + 1);
    onNetworkChange?.('subway');
  };
  return (
    <div>
      <div className="inspector-head">
        <div className="inspector-title">
          <span
            className="dot"
            style={{ background: `#${(line.color ?? 0x4f9ee8).toString(16).padStart(6, '0')}` }}
          />
          <span>{line.name}</span>
        </div>
        <div className="inspector-sub">
          {(line.stations || []).length} stations · depth {line.depth} m
        </div>
      </div>
      <Section title="Line">
        <Field label="Name">
          <input className="input" value={line.name} onChange={(event) => { line.name = event.target.value; refresh(); }} />
        </Field>
        <Field label="Depth">
          <NumberInput value={line.depth ?? -13} step={0.5} min={-60} max={-3} suffix="m" onChange={(value) => { line.depth = value; refresh(); }} />
        </Field>
        <Field label="Colour">
          <input
            type="color"
            value={`#${(line.color ?? 0x4f9ee8).toString(16).padStart(6, '0')}`}
            onChange={(event) => { line.color = parseInt(event.target.value.slice(1), 16); refresh(); }}
            style={{ width: 44, height: 24, background: 'none', border: '1px solid var(--line)', borderRadius: 6 }}
          />
        </Field>
      </Section>
      <Section title="Stations" count={(line.stations || []).length}>
        {(line.stations || []).map((station, index) => (
          <div className="detail-row" key={index}>
            <span className="name">{station.name}</span>
            <span className="at">{(station.s ?? 0).toFixed(0)} m</span>
          </div>
        ))}
        <div className="button-row">
          <Button
            onClick={() => {
              line.stations = line.stations || [];
              line.stations.push({ s: (line.stations.at(-1)?.s ?? 300) + 500, name: `Station ${line.stations.length + 1}` });
              refresh();
            }}
          >
            <Plus size={12} /> Add station
          </Button>
        </div>
      </Section>
      <div className="button-row">
        <Button
          variant="danger"
          onClick={() => {
            network.removeSubway(line.id);
            network.commit('delete line');
            onNetworkChange?.('delete');
          }}
        >
          <Trash2 size={12} /> Delete line
        </Button>
      </div>
    </div>
  );
}
