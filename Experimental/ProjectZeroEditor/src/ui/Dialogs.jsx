import React from 'react';
import { Dices, Keyboard, X } from 'lucide-react';
import { CITY_DEFAULTS } from '../engine/cityGenerator.js';
import { Button, Chips, Field, NumberInput, Select, Slider, ToggleField } from './widgets.jsx';

export function Dialog({ title, icon, onClose, children, footer, note }) {
  return (
    <div className="overlay" onPointerDown={(event) => (event.target === event.currentTarget ? onClose() : null)}>
      <div className="dialog">
        <div className="dialog-head">
          {icon}
          <h2>{title}</h2>
          <div style={{ flex: 1 }} />
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {note ? <div className="dialog-note">{note}</div> : null}
        {footer ? <div className="dialog-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function GenerateCityDialog({ onClose, onGenerate, initial = {} }) {
  const [settings, setSettings] = React.useState({ ...CITY_DEFAULTS, ...initial });
  const set = (key, value) => setSettings((current) => ({ ...current, [key]: value }));

  return (
    <Dialog
      title="Generate city"
      icon={<Dices size={15} style={{ color: 'var(--accent)' }} />}
      onClose={onClose}
      note="Generation replaces the current document. Undo (Ctrl+Z) restores it."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              onGenerate(settings);
              onClose();
            }}
          >
            Generate
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 8, padding: '4px 16px 8px' }}>
        <input
          className="input"
          style={{ flex: 1 }}
          type="number"
          value={settings.seed}
          onChange={(event) => set('seed', parseInt(event.target.value, 10) || 0)}
        />
        <Button onClick={() => set('seed', Math.floor(Math.random() * 1e6))}>
          <Dices size={13} /> Random seed
        </Button>
      </div>

      <Slider
        label="Extent"
        value={settings.extent}
        min={600}
        max={4200}
        step={100}
        onChange={(value) => set('extent', value)}
        format={(value) => `${(value / 1000).toFixed(1)} km`}
      />
      <Slider
        label="Arterial grid spacing"
        value={settings.arterialSpacing}
        min={200}
        max={900}
        step={20}
        onChange={(value) => set('arterialSpacing', value)}
        format={(value) => `${value} m`}
      />
      <Slider
        label="Minimum block frontage"
        value={settings.blockMin}
        min={40}
        max={160}
        step={2}
        onChange={(value) => set('blockMin', value)}
        format={(value) => `${value} m`}
      />
      <Slider
        label="Subdivision depth"
        value={settings.depth}
        min={1}
        max={6}
        step={1}
        onChange={(value) => set('depth', value)}
      />

      <div className="panel-heading" style={{ paddingTop: 10 }}>Network</div>
      <ToggleField label="River with bridges" value={settings.river} onChange={(value) => set('river', value)} />
      <ToggleField label="Railway with level crossings" value={settings.railway} onChange={(value) => set('railway', value)} />
      <ToggleField label="Subway lines" value={settings.subway} onChange={(value) => set('subway', value)} />
      <ToggleField label="Roundabouts on arterials" value={settings.roundabouts} onChange={(value) => set('roundabouts', value)} />

      <div className="panel-heading" style={{ paddingTop: 10 }}>Street allocation</div>
      <ToggleField label="Cycle lanes" value={settings.cycleLanes} onChange={(value) => set('cycleLanes', value)} />
      <ToggleField label="Bus lanes" value={settings.busLanes} onChange={(value) => set('busLanes', value)} />
      <ToggleField label="Kerbside parking" value={settings.parking} onChange={(value) => set('parking', value)} />
      <ToggleField label="Block massing" value={settings.buildings} onChange={(value) => set('buildings', value)} />
      <Field label="Street furniture">
        <Select
          className="select select-sm"
          value={settings.furniture}
          onChange={(value) => set('furniture', value)}
          options={[
            { id: 'full', label: 'Full' },
            { id: 'minimal', label: 'Minimal' },
            { id: 'none', label: 'None' },
          ]}
        />
      </Field>
      <Field label="Parks & superblocks">
        <NumberInput value={Math.round(settings.blockInfill * 100)} step={2} min={0} max={60} suffix="%" onChange={(value) => set('blockInfill', value / 100)} />
      </Field>
    </Dialog>
  );
}

export function ShortcutsDialog({ onClose }) {
  return (
    <Dialog
      title="Viewport controls"
      icon={<Keyboard size={15} style={{ color: 'var(--accent)' }} />}
      onClose={onClose}
      footer={<Button variant="primary" onClick={onClose}>Got it</Button>}
    >
      <div className="shortcut-grid">
        <kbd>W A S D</kbd>
        <span>Move forwards / left / back / right</span>
        <kbd>Q / E</kbd>
        <span>Move down / up</span>
        <kbd>Right-drag</kbd>
        <span>Free look</span>
        <kbd>Middle-drag</kbd>
        <span>Pan</span>
        <kbd>Alt + Right-drag</kbd>
        <span>Dolly in and out</span>
        <kbd>Alt + Left-drag</kbd>
        <span>Orbit around the focus point</span>
        <kbd>Wheel</kbd>
        <span>Camera speed (shown in the status bar)</span>
        <kbd>Shift / Ctrl</kbd>
        <span>4× faster / 4× slower</span>
        <kbd>F</kbd>
        <span>Frame the selection</span>
        <kbd>G</kbd>
        <span>Toggle the ground grid</span>
        <kbd>X</kbd>
        <span>Toggle X-ray (see subway tunnels)</span>
        <kbd>Enter</kbd>
        <span>Finish the road you are drawing</span>
        <kbd>Esc</kbd>
        <span>Cancel drawing / clear the selection</span>
        <kbd>Del</kbd>
        <span>Delete the selection</span>
      </div>
      <div className="dialog-note">
        With <strong>Draw road</strong> active, click to drop control points; click near an existing junction to
        snap to it. Double-click or press Enter to finish.
      </div>
    </Dialog>
  );
}

export function SettingsDialog({ onClose, settings, onChange, network }) {
  return (
    <Dialog
      title="Document settings"
      onClose={onClose}
      footer={<Button variant="primary" onClick={onClose}>Done</Button>}
    >
      <Field label="Drive on the">
        <Select
          className="select select-sm"
          value={settings.driveSide}
          onChange={(value) => onChange({ driveSide: value })}
          options={[
            { id: 'right', label: 'Right (RHT)' },
            { id: 'left', label: 'Left (LHT)' },
          ]}
        />
      </Field>
      <Field label="Default kerb height">
        <NumberInput
          value={settings.curbHeight}
          step={0.01}
          min={0}
          max={0.35}
          suffix="m"
          onChange={(value) => onChange({ curbHeight: value })}
        />
      </Field>
      <ToggleField
        label="Terrain"
        value={settings.terrain.enabled}
        onChange={(value) => onChange({ terrain: { ...settings.terrain, enabled: value } })}
      />
      <Slider
        label="Terrain relief"
        value={settings.terrain.amplitude}
        min={0}
        max={40}
        step={1}
        onChange={(value) => onChange({ terrain: { ...settings.terrain, amplitude: value } })}
        format={(value) => `${value} m`}
      />
      <Slider
        label="Terrain scale"
        value={settings.terrain.scale}
        min={200}
        max={2000}
        step={20}
        onChange={(value) => onChange({ terrain: { ...settings.terrain, scale: value } })}
        format={(value) => `${value} m`}
      />
      <Field label="Terrain seed">
        <NumberInput
          value={settings.terrain.seed}
          step={1}
          onChange={(value) => onChange({ terrain: { ...settings.terrain, seed: Math.round(value) } })}
        />
      </Field>
      <div className="dialog-note">
        Switching the driving side mirrors every lane layout in the document, so the same catalogue works for
        right- and left-hand traffic.
      </div>
    </Dialog>
  );
}
