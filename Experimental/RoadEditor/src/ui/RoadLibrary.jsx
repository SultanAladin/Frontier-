import React, { useEffect, useMemo, useState } from 'react';
import { X, Search, Route, Milestone, Signpost, Waypoints, Map as MapIcon, Footprints, PenTool, Check, LayoutGrid, Shield, TramFront, TrainFront } from 'lucide-react';
import { useEditor, editor } from './useEditor.js';
import { PROFILES, CATEGORIES, LANE_TYPES, layout } from '../road/profiles.js';
import { DEFAULT_GUARDRAIL, GUARDRAIL_STYLES, ROAD_POST_LIBRARY_ITEM } from '../road/infrastructure.js';
import { CrossSection } from './CrossSection.jsx';

const CAT_ICON = { highway: Milestone, arterial: Route, urban: Signpost, residential: Waypoints, rural: MapIcon, active: Footprints };
const TRANSIT_ITEMS = [
  { id: 'tram', name: 'Dedicated tramway', description: 'Freeform streetcar alignment · flush road crossings · overhead power and optional viaduct supports', tags: ['Grooved rail', 'Catenary', 'Off-road'] },
  { id: 'mainline', name: 'Mainline railway', description: 'Independent railway with ballast, sleepers, crossings and rail topology', tags: ['Ballast', 'Rail crossing', 'Independent'] },
  { id: 'suspended', name: 'Suspended guideway', description: 'Elevated monorail guideway with clearance-checked columns', tags: ['Elevated', 'Supports', 'Monorail'] },
];

function tags(p) {
  const t = new Set();
  for (const l of p.lanes) {
    if (l.type === 'bus') t.add('Bus lane');
    if (l.type === 'bike' || l.type === 'cycletrack') t.add('Cycling');
    if (l.type === 'parking') t.add('Parking');
    if (l.type === 'tram') t.add('Tram');
    if (l.type === 'median' || l.type === 'barrier') t.add('Divided');
    if (l.type === 'planter' || p.trees) t.add('Trees');
  }
  if (p.oneWay) t.add('One-way');
  if (p.cyclePriority) t.add('Cycle priority');
  return [...t].slice(0, 3);
}

function InfrastructureArt({ style, post = false }) {
  if (post) return (
    <svg className="infra-preview" viewBox="0 0 180 62" aria-hidden="true">
      <path d="M18 51H162" stroke="#565656" strokeWidth="2" />
      <path d="M87 52V13" stroke="#aeb5ba" strokeWidth="8" strokeLinecap="square" />
      <path d="M87 25V19m0 17v-6" stroke="#f0cc4c" strokeWidth="6" />
      <path d="M87 49V12" stroke="#dedede" strokeWidth="1" opacity=".55" />
      <path d="M76 53h22" stroke="#8b9296" strokeWidth="4" />
    </svg>
  );
  const posts = Array.from({ length: 7 }, (_, i) => 9 + i * 27);
  const concrete = style === 'concrete';
  const cable = style === 'cable';
  const parapet = style === 'parapet';
  const railColor = concrete ? '#bcb8b0' : '#b0b8bd';
  return (
    <svg className="infra-preview" viewBox="0 0 180 62" aria-hidden="true">
      <path d="M3 52H177" stroke="#565656" strokeWidth="2" />
      {posts.map(x => <path key={x} d={`M${x} ${concrete ? 50 : 14}V51`} stroke={concrete ? '#817e79' : '#9da4a8'} strokeWidth={concrete ? 2 : 3} />)}
      {concrete ? <path d="M3 43l5-8 8-20h148l8 20 5 8v7H3z" fill="#aaa69f" /> : null}
      {parapet ? <path d="M3 45h174v7H3z" fill="#77746e" /> : null}
      {cable ? [18, 26, 34, 42].map(y => <path key={y} d={`M3 ${y}H177`} stroke={railColor} strokeWidth="1.4" />) : null}
      {concrete ? null : parapet ? [17, 29, 42].map(y => <path key={y} d={`M3 ${y}H177`} stroke={railColor} strokeWidth="2" />) : style === 'railing' ? [17, 30, 43].map(y => <path key={y} d={`M3 ${y}H177`} stroke={railColor} strokeWidth="2.2" />) : <path d="M3 22l11-4 10 4 10-4 10 4 10-4 10 4 10-4 10 4 10-4 10 4 10-4 10 4 10-4 10 4 10-4 10 4 10-4 10 4" fill="none" stroke={railColor} strokeWidth={style === 'thrie' ? 7 : 6} strokeLinejoin="round" />}
    </svg>
  );
}

function TransitArt({ mode }) {
  return (
    <svg className="infra-preview" viewBox="0 0 180 62" aria-hidden="true">
      {mode === 'tram' ? <>
        <path d="M90 58V5" stroke="#737b80" strokeWidth="4" />
        <path d="M52 10H128M66 18H114" stroke="#aeb7bc" strokeWidth="1.6" />
        <path d="M67 20V46M113 20V46" stroke="#8f999f" strokeWidth="2" />
        <path d="M48 50H132" stroke="#77746e" strokeWidth="13" />
        <path d="M82 50H98" stroke="#d77966" strokeWidth="7" />
        <path d="M84 50V31L90 25L96 31V50" fill="none" stroke="#dedbd4" strokeWidth="2" />
      </> : mode === 'suspended' ? <>
        <path d="M22 22H158V42H22z" fill="#aeb0ae" />
        <path d="M89 42V54M92 42V54" stroke="#9ca4a9" strokeWidth="3" />
        <path d="M58 55H122" stroke="#85898a" strokeWidth="5" />
      </> : <>
        <path d="M14 48H166" stroke="#827d76" strokeWidth="18" />
        <path d="M14 48H166" stroke="#343433" strokeWidth="13" />
        <path d="M14 44H166M14 52H166" stroke="#bdc1c3" strokeWidth="2" />
        {Array.from({ length: 11 }, (_, i) => <path key={i} d={`M${18 + i * 14} 40v16`} stroke="#77716a" strokeWidth="3" />)}
      </>}
    </svg>
  );
}

export function RoadLibrary() {
  const st = useEditor();
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [pick, setPick] = useState(st.drawProfile);
  const [infraPick, setInfraPick] = useState({ kind: 'guardrail', style: 'wbeam' });
  const [transitPick, setTransitPick] = useState(() => TRANSIT_ITEMS.some(item => item.id === st.railMode) ? st.railMode : 'tram');
  useEffect(() => { if (st.library) setCat(st.librarySection || 'all'); }, [st.library, st.librarySection]);
  useEffect(() => { if (TRANSIT_ITEMS.some(item => item.id === st.railMode)) setTransitPick(st.railMode); }, [st.railMode]);
  const sel = st.selection;
  const selIds = sel?.type === 'edge' ? [sel.id] : sel?.type === 'street' && sel.ids?.length ? sel.ids : null;
  const list = useMemo(() => Object.values(PROFILES).filter(p => (cat === 'all' || p.category === cat) && (!q || (p.name + ' ' + (p.desc || '')).toLowerCase().includes(q.toLowerCase()))), [cat, q]);
  if (!st.library) return null;
  const close = () => editor.set({ library: false });
  const draw = () => { editor.set({ drawProfile: pick, library: false }); editor.setTool('draw'); };
  const apply = () => { editor.setEdgeProfile(selIds, pick); close(); };
  const activateInfrastructure = () => {
    if (infraPick.kind === 'post') {
      editor.setTool('place', { placeType: 'roadPost' });
      close();
      return;
    }
    if (!selIds) return;
    editor.setEdgeGuardrail(selIds, { ...DEFAULT_GUARDRAIL, style: infraPick.style });
    close();
  };
  const activateTransit = (mode = transitPick) => {
    editor.setRailMode(mode);
    close();
    editor.setTool('rail');
  };
  const P = PROFILES[pick];
  const selectedInfra = GUARDRAIL_STYLES.find(style => style.id === infraPick.style) || GUARDRAIL_STYLES[0];
  const query = q.trim().toLowerCase();
  const showPost = !query || (ROAD_POST_LIBRARY_ITEM.name + ' ' + ROAD_POST_LIBRARY_ITEM.description).toLowerCase().includes(query);
  const railItems = GUARDRAIL_STYLES.filter(item => !query || (item.name + ' ' + item.description).toLowerCase().includes(query));
  const transitItems = TRANSIT_ITEMS.filter(item => !query || `${item.name} ${item.description} ${item.tags.join(' ')}`.toLowerCase().includes(query));
  const selectedTransit = TRANSIT_ITEMS.find(item => item.id === transitPick) || TRANSIT_ITEMS[0];
  const contextLabel = cat === 'all' ? 'All roads' : cat === 'infrastructure' ? 'Infrastructure' : cat === 'transit' ? 'Rail & tram' : CATEGORIES.find(c => c.id === cat)?.label;
  return (
    <div className="construct-backdrop" onMouseDown={e => e.target === e.currentTarget && close()}>
      <div className="construct-panel">
        <header>
          <div className="construct-emblem"><LayoutGrid size={18} /></div>
          <div><h2>Construct library</h2><p>{Object.keys(PROFILES).length} road presets · infrastructure · rail & tram routes</p></div>
          <span className="construct-engine">FRONTIER / ROADS</span>
          <button className="construct-close" onClick={close}><X size={16} /></button>
        </header>
        <div className="construct-context">
          <span>Construct</span><span>/</span><span className="current">{contextLabel}</span>
          <span className="construct-context-end"><span className="construct-dot" />{selIds ? `${selIds.length} segment${selIds.length > 1 ? 's' : ''} selected` : 'Nothing selected'}</span>
        </div>
        <div className="construct-layout">
          <nav>
            <button className={cat === 'all' ? 'active' : ''} onClick={() => { setCat('all'); editor.set({ librarySection: 'all' }); }}><LayoutGrid size={14} />All<small>{Object.keys(PROFILES).length}</small></button>
            <button className={cat === 'infrastructure' ? 'active' : ''} onClick={() => { setCat('infrastructure'); editor.set({ librarySection: 'infrastructure' }); }}><Shield size={14} />Infrastructure<small>{GUARDRAIL_STYLES.length + 1}</small></button>
            <div className="construct-nav-caption">TRANSIT</div>
            <button className={cat === 'transit' ? 'active' : ''} onClick={() => { setCat('transit'); editor.set({ librarySection: 'transit' }); }}><TramFront size={14} />Rail & Tram<small>{TRANSIT_ITEMS.length}</small></button>
            <div className="construct-nav-caption">ROAD CATEGORIES</div>
            {CATEGORIES.map(c => { const I = CAT_ICON[c.id]; return <button key={c.id} className={cat === c.id ? 'active' : ''} onClick={() => { setCat(c.id); editor.set({ librarySection: c.id }); }}><I size={14} />{c.label}<small>{Object.values(PROFILES).filter(p => p.category === c.id).length}</small></button>; })}
            <div className="construct-nav-note">Tip: <kbd>Shift</kbd>+<kbd>A</kbd> opens this panel. Double-click a road tile to start drawing.</div>
          </nav>
          <div className="construct-content">
            <label className="construct-search"><Search size={13} /><input autoFocus placeholder={cat === 'infrastructure' ? 'Search infrastructure…' : cat === 'transit' ? 'Search rail & tram…' : 'Search road types…'} value={q} onChange={e => setQ(e.target.value)} /><kbd>Esc</kbd></label>
            {cat === 'transit' ? <>
              {transitItems.length > 0 ? <>
                <div className="construct-section-title">Independent rail alignments<span>Choose a system to draw a freeform route</span></div>
                <div className="construct-grid construct-grid-infra">
                  {transitItems.map(item => {
                    const TransitIcon = item.id === 'tram' ? TramFront : TrainFront;
                    return (
                      <button key={item.id} className={'construct-tile' + (transitPick === item.id ? ' selected' : '')} onClick={() => setTransitPick(item.id)} onDoubleClick={() => activateTransit(item.id)}>
                        <div className="tile-art"><TransitArt mode={item.id} /></div>
                        <strong>{item.name}</strong>
                        <span>{item.description}</span>
                        <div className="tile-tags">{item.tags.map(tag => <i key={tag}>{tag}</i>)}</div>
                        <div className="tile-tags"><i><TransitIcon size={10} /> Double-click to draw</i></div>
                      </button>
                    );
                  })}
                </div>
              </> : <div className="construct-empty">No rail or tram systems match “{q}”.</div>}
            </> : cat === 'infrastructure' ? <>
              {showPost && <>
                <div className="construct-section-title">Posts & markers<span>Individual roadside furniture</span></div>
                <div className="construct-grid construct-grid-infra">
                  <button className={'construct-tile' + (infraPick.kind === 'post' ? ' selected' : '')} onClick={() => setInfraPick({ kind: 'post' })}>
                    <div className="tile-art"><InfrastructureArt post /></div>
                    <strong>{ROAD_POST_LIBRARY_ITEM.name}</strong>
                    <span>Reflective support · 1.0 m</span>
                    <div className="tile-tags"><i>Place individually</i><i>Infrastructure</i></div>
                  </button>
                </div>
              </>}
              {railItems.length > 0 && <>
                <div className="construct-section-title">Roadside protection<span>Continuous barrier overlays for selected road segments</span></div>
                <div className="construct-grid construct-grid-infra">
                  {railItems.map(item => (
                    <button key={item.id} className={'construct-tile' + (infraPick.kind === 'guardrail' && infraPick.style === item.id ? ' selected' : '')} onClick={() => setInfraPick({ kind: 'guardrail', style: item.id })}>
                      <div className="tile-art"><InfrastructureArt style={item.id} /></div>
                      <strong>{item.name}</strong>
                      <span>{item.description}</span>
                      <div className="tile-tags"><i>Guardrail</i><i>Road post supports</i></div>
                    </button>
                  ))}
                </div>
              </>}
              {!showPost && railItems.length === 0 && <div className="construct-empty">No infrastructure matches “{q}”.</div>}
            </> : (cat === 'all' ? CATEGORIES : CATEGORIES.filter(c => c.id === cat)).map(c => {
              const items = list.filter(p => p.category === c.id);
              if (!items.length) return null;
              return (
                <React.Fragment key={c.id}>
                  <div className="construct-section-title">{c.label}<span>{c.blurb}</span></div>
                  <div className="construct-grid">
                    {items.map(p => (
                      <button key={p.id} className={'construct-tile' + (pick === p.id ? ' selected' : '')} onClick={() => setPick(p.id)} onDoubleClick={() => { setPick(p.id); editor.set({ drawProfile: p.id, library: false }); editor.setTool('draw'); }}>
                        <div className="tile-art"><CrossSection lanes={p.lanes} compact /></div>
                        <strong>{p.name}</strong>
                        <span>{layout(p).total.toFixed(1)} m · {p.speed} km/h · {p.lanes.filter(l => LANE_TYPES[l.type].traffic && l.type !== 'bike').length} lanes</span>
                        <div className="tile-tags">{tags(p).map(t => <i key={t}>{t}</i>)}</div>
                      </button>
                    ))}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>
        <footer>
          {cat === 'infrastructure' ? <>
            <span>{infraPick.kind === 'post' ? ROAD_POST_LIBRARY_ITEM.description : selectedInfra.description + (selIds ? ` Applies to ${selIds.length} selected road segment${selIds.length === 1 ? '' : 's'}.` : ' Select a road segment to apply this overlay.')}</span>
            <button className="construct-submit" disabled={infraPick.kind === 'guardrail' && !selIds} onClick={activateInfrastructure}>
              {infraPick.kind === 'post' ? <><Signpost size={13} />Place road post</> : <><Check size={13} />Add {selectedInfra.name}</>}
            </button>
          </> : cat === 'transit' ? <>
            <span>{selectedTransit.description}. Click or double-click a tile to choose a system.</span>
            <button className="construct-submit" onClick={() => activateTransit()}>
              {selectedTransit.id === 'tram' ? <TramFront size={13} /> : <TrainFront size={13} />}
              Draw {selectedTransit.name}
            </button>
          </> : <>
            <span>{P?.desc}</span>
            {selIds && <button className="construct-secondary" onClick={apply}><Check size={13} />Apply to selection</button>}
            <button className="construct-submit" onClick={draw}><PenTool size={13} />Draw with {P?.name}</button>
          </>}
        </footer>
      </div>
    </div>
  );
}
