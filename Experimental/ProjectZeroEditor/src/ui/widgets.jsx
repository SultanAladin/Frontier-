import React from 'react';
import { ChevronDown } from 'lucide-react';

export function Section({ title, count, children, defaultOpen = true, actions = null }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="section">
      <button className={`section-head${open ? '' : ' collapsed'}`} onClick={() => setOpen(!open)} type="button">
        <ChevronDown size={12} className="chevron" />
        <span>{title}</span>
        {count !== undefined ? <span className="count">{count}</span> : null}
        {actions ? <span onClick={(event) => event.stopPropagation()}>{actions}</span> : null}
      </button>
      {open ? children : null}
    </div>
  );
}

export function Field({ label, children, stack = false }) {
  if (stack) {
    return (
      <div className="field-stack">
        <label>{label}</label>
        {children}
      </div>
    );
  }
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

export function NumberInput({ value, onChange, min, max, step = 1, suffix }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <input
        className="input number"
        type="number"
        value={Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const next = parseFloat(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
      {suffix ? <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{suffix}</span> : null}
    </div>
  );
}

export function Slider({ label, value, onChange, min, max, step = 1, format }) {
  return (
    <div>
      <div className="field" style={{ paddingBottom: 0 }}>
        <label>{label}</label>
        <span style={{ fontSize: 11, color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>
          {format ? format(value) : value}
        </span>
      </div>
      <div className="range-row">
        <input
          type="range"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(parseFloat(event.target.value))}
        />
      </div>
    </div>
  );
}

export function Select({ value, onChange, options, className = 'select' }) {
  return (
    <select className={className} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => {
        const id = typeof option === 'string' ? option : option.id;
        const label = typeof option === 'string' ? option : option.label;
        return (
          <option key={id} value={id}>
            {label}
          </option>
        );
      })}
    </select>
  );
}

export function Toggle({ value, onChange }) {
  return (
    <button
      type="button"
      className={`toggle${value ? ' on' : ''}`}
      onClick={() => onChange(!value)}
      aria-pressed={value}
    />
  );
}

export function ToggleField({ label, value, onChange }) {
  return (
    <div className="field">
      <label>{label}</label>
      <Toggle value={value} onChange={onChange} />
    </div>
  );
}

export function Button({ children, onClick, variant = '', wide = false, disabled = false, title }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      className={`button ${variant}${wide ? ' wide' : ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function Chips({ options, value, onChange }) {
  return (
    <div className="chip-row">
      {options.map((option) => {
        const id = typeof option === 'string' ? option : option.id;
        const label = typeof option === 'string' ? option : option.label;
        return (
          <button
            type="button"
            key={id}
            className={`chip${value === id ? ' on' : ''}`}
            onClick={() => onChange(id)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
