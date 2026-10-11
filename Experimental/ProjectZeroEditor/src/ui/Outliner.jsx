import React from 'react';
import { Eye, EyeOff, Trash2, Focus } from 'lucide-react';
import { getProfile } from '../engine/profiles.js';

/** Flat, searchable list of everything in the document, with quick visibility. */
export default function Outliner({ network, selection, onSelect, onFocus, onChange, query }) {
  const roads = [...network.roads.values()];
  const subways = [...network.subways.values()];
  const needle = (query || '').trim().toLowerCase();

  const roadRows = roads.filter((road) => {
    if (!needle) return true;
    const profile = getProfile(road.profileId);
    return (
      (road.name || '').toLowerCase().includes(needle) ||
      profile.name.toLowerCase().includes(needle) ||
      profile.id.includes(needle) ||
      (profile.category || '').includes(needle)
    );
  });

  const visibleRoads = roadRows.slice(0, 400);

  const toggleVisibility = (road) => {
    road.visible = road.visible === false;
    network.emit('change');
    onChange?.();
  };

  const remove = (road) => {
    network.removeRoad(road.id);
    network.commit('delete');
    onChange?.();
    if (selection?.id === road.id) onSelect(null);
  };

  return (
    <div>
      <div className="panel-heading">
        <span>Subway lines · {subways.length}</span>
      </div>
      {subways.map((line) => (
        <div className="detail-row" key={line.id}>
          <span
            className="dot"
            style={{ background: `#${(line.color ?? 0x4f9ee8).toString(16).padStart(6, '0')}` }}
          />
          <button
            type="button"
            className="name"
            style={{ textAlign: 'left', flex: 1 }}
            onClick={() => onSelect({ type: 'subway', id: line.id })}
          >
            {line.name}
          </button>
          <span className="at">{(line.stations || []).length} stops</span>
          <button
            type="button"
            className="icon-button"
            title="Frame"
            onClick={() => onFocus({ type: 'subway', id: line.id })}
          >
            <Focus size={12} />
          </button>
        </div>
      ))}

      <div className="panel-heading">
        <span>Roads · {roads.length}</span>
        <span>{needle ? `${visibleRoads.length} shown` : ''}</span>
      </div>

      {visibleRows(visibleRoads, selection, onSelect, onFocus, toggleVisibility, remove)}
      {roadRows.length > visibleRoads.length ? (
        <div className="empty-note">Showing the first 400 roads — search to narrow the list.</div>
      ) : null}
      {!roadRows.length ? <div className="empty-note">No roads match “{query}”.</div> : null}
    </div>
  );
}

function visibleRows(roads, selection, onSelect, onFocus, toggleVisibility, remove) {
  return roads.map((road) => {
    const profile = getProfile(road.profileId);
    const active = selection?.type === 'road' && selection.id === road.id;
    const hidden = road.visible === false;
    return (
      <div
        className="detail-row"
        key={road.id}
        style={active ? { background: 'var(--panel-2)', color: 'var(--text)' } : undefined}
      >
        <button
          type="button"
          className="name"
          style={{ textAlign: 'left', flex: 1, color: active ? 'var(--text)' : undefined }}
          onClick={() => onSelect({ type: 'road', id: road.id })}
        >
          {road.name || profile.name}
        </button>
        <span className="at">{profile.name}</span>
        <button
          type="button"
          className="icon-button"
          title={hidden ? 'Show' : 'Hide'}
          onClick={() => toggleVisibility(road)}
          style={{ color: hidden ? '#4d555c' : undefined }}
        >
          {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
        </button>
        <button type="button" className="icon-button" title="Frame" onClick={() => onFocus({ type: 'road', id: road.id })}>
          <Focus size={12} />
        </button>
        <button type="button" className="icon-button" title="Delete" onClick={() => remove(road)}>
          <Trash2 size={12} />
        </button>
      </div>
    );
  });
}
