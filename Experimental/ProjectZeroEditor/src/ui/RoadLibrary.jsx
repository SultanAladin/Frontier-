import React from 'react';
import { Search, X } from 'lucide-react';
import { CATEGORIES, PROFILES, laneWidth } from '../engine/profiles.js';
import CrossSectionPreview from './CrossSectionPreview.jsx';

/**
 * The road catalogue: every profile in the library, grouped by family, each with a
 * to-scale cross-section thumbnail.  Clicking one arms the drawing tools.
 */
export default function RoadLibrary({ selectedProfileId, onSelect, onApplyToSelection }) {
  const [query, setQuery] = React.useState('');
  const [category, setCategory] = React.useState('all');

  const filtered = PROFILES.filter((profile) => {
    if (category !== 'all' && profile.category !== category) return false;
    if (!query.trim()) return true;
    const needle = query.toLowerCase();
    return (
      profile.name.toLowerCase().includes(needle) ||
      (profile.origin || '').toLowerCase().includes(needle) ||
      (profile.blurb || '').toLowerCase().includes(needle) ||
      (profile.tags || []).some((tag) => tag.includes(needle))
    );
  });

  const grouped = CATEGORIES.map((cat) => ({
    category: cat,
    items: filtered.filter((profile) => profile.category === cat.id),
  })).filter((group) => group.items.length);

  return (
    <div>
      <div className="search">
        <Search size={13} />
        <input
          value={query}
          placeholder="Search 40+ road types…"
          onChange={(event) => setQuery(event.target.value)}
        />
        {query ? (
          <button type="button" onClick={() => setQuery('')} aria-label="Clear search">
            <X size={13} />
          </button>
        ) : null}
      </div>

      <div className="chip-row">
        <button type="button" className={`chip${category === 'all' ? ' on' : ''}`} onClick={() => setCategory('all')}>
          All
        </button>
        {CATEGORIES.map((cat) => (
          <button
            type="button"
            key={cat.id}
            className={`chip${category === cat.id ? ' on' : ''}`}
            onClick={() => setCategory(cat.id)}
          >
            {cat.label.split(' ')[0]}
          </button>
        ))}
      </div>

      {grouped.map(({ category: cat, items }) => (
        <div className="lib-group" key={cat.id}>
          <div className="lib-group-head">
            <span className="bar" style={{ background: cat.accent }} />
            <span>{cat.label}</span>
            <span className="count">{items.length}</span>
          </div>
          {items.map((profile) => {
            const active = profile.id === selectedProfileId;
            return (
              <button
                type="button"
                key={profile.id}
                className={`lib-card${active ? ' active' : ''}`}
                onClick={() => onSelect(profile.id)}
                onDoubleClick={() => onApplyToSelection?.(profile.id)}
                title={profile.blurb}
              >
                <CrossSectionPreview lanes={profile.lanes} width={72} height={34} />
                <span className="lib-card-body">
                  <span className="lib-card-title">{profile.name}</span>
                  <span className="lib-card-sub">{profile.origin}</span>
                  <span className="lib-card-meta">
                    <span>{laneWidth(profile.lanes).toFixed(1)} m</span>
                    <span>{profile.speed} km/h</span>
                    {profile.structure && profile.structure !== 'none' ? <span>{profile.structure}</span> : null}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ))}

      {!grouped.length ? (
        <div className="empty-note">
          Nothing matches “{query}”. Try “tram”, “cobble”, “motorway”, “cycle” or “bridge”.
        </div>
      ) : null}
    </div>
  );
}
