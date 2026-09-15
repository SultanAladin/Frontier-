//============================================================================================================================================
// 📦 Frontier/Scratchpad/IconForge/FrontierGlyphs.mjs — Clean-Room Frontier Draughting Glyph Geometry Declarations
//============================================================================================================================================
//
//  DESIGN LANGUAGE — "Frontier Draughting"
//  ---------------------------------------
//  * Canvas            : 24 x 24 viewBox, live area 2.5 .. 21.5 (19px optical square)
//  * Stroke            : 1.75px nominal, miter joins (limit 4), butt caps  → technical/CAD register
//                        (Lucide uses 2px, round joins, round caps — deliberately NOT matched)
//  * Signature 1       : CHAMFER. Enclosures cut their top-right corner at 45°, echoing a drafting
//                        sheet dog-ear. Never a uniform border radius.
//  * Signature 2       : CLOSED TRIANGULAR ARROWHEADS. Lucide/Feather terminate arrows with an open
//                        chevron; Frontier closes the head into a hollow triangle.
//  * Signature 3       : Z-UP AXONOMETRIC. All volumetric glyphs project on the engine's own
//                        right-handed +Z-up basis (CLAUDE.md §7), never a generic 2D box.
//  * Signature 4       : ALTERNATING RAY CADENCE. Radiant glyphs alternate long/short rays instead
//                        of the usual 8 equal spokes.
//
//  COLOUR ROLES (drive both 'accent' and 'multi' render variants)
//  --------------------------------------------------------------
//    (none) : base contour, inherits currentColor
//    'x'    : +X axis / Right / East          → Rose    #F43F5E   (CLAUDE.md §7 red)
//    'y'    : +Y axis / Forward / North       → Emerald #10B981   (CLAUDE.md §7 green)
//    'z'    : +Z axis / Up / Zenith           → Blue    #3B82F6   (CLAUDE.md §7 blue)
//    'hot'  : energy, emission, illuminance, active selection      → Amber   #F59E0B
//    'cool' : fluid, gas, level-set, volumetric media              → Cyan    #06B6D4
//    'vio'  : material, BRDF, shader graph authoring               → Violet  #8B5CF6
//
//  LAYER KEYS
//  ----------
//    d     : SVG path data
//    role  : colour role above
//    f     : 1 → filled with role colour (fill-rule nonzero), otherwise stroked
//    o     : opacity multiplier for de-emphasised construction lines
//    w     : stroke width override
//    cap   : stroke-linecap override ('round' for true free terminals)
//    dash  : stroke-dasharray for construction / seam / marquee lines
//
//============================================================================================================================================

//--------------------------------------------------------------------------------------------------------------------------
//                                              SHARED GEOMETRY CONSTANTS
//--------------------------------------------------------------------------------------------------------------------------

// Z-up axonometric unit cube, centred (12,12): top rhombus apexes + three falling verticals.
const CUBE_TOP    = 'M12 4.2 18.5 8 12 11.8 5.5 8Z';
const CUBE_SKIRT  = 'M5.5 8v6l6.5 3.8 6.5-3.8V8';
const CUBE_SPINE  = 'M12 11.8v6';

export const COLOUR_ROLES = {
    x:    { hex: '#F43F5E', title: '+X axis · Right/East'          },
    y:    { hex: '#10B981', title: '+Y axis · Forward/North'       },
    z:    { hex: '#3B82F6', title: '+Z axis · Up/Zenith'           },
    hot:  { hex: '#F59E0B', title: 'Energy · emission · selection' },
    cool: { hex: '#06B6D4', title: 'Fluid · gas · level-set'       },
    vio:  { hex: '#8B5CF6', title: 'Material · BRDF · shader'      }
};

export const CATEGORIES = [
    { id: 'Navigation',      title: 'Navigation',       blurb: 'Directional arrows, chevrons, rotations and expands.',           enumName: 'NavigationIconCategory'      },
    { id: 'ControlCentre',   title: 'Control Centre',   blurb: 'Settings, appearance, display, input, bell, wifi, power.',       enumName: 'ControlCentreIconCategory'   },
    { id: 'EditorTools',     title: 'Editor Tools',     blurb: 'Select, translate, rotate, scale, snap and viewport.',           enumName: 'EditorToolsIconCategory'     },
    { id: 'TexturePainting', title: 'Texture Painting', blurb: 'Brush, eraser, eyedropper, bucket, stamp, gradient.',            enumName: 'TexturePaintingIconCategory' },
    { id: 'Outliner',        title: 'Outliner',         blurb: 'Folder, hierarchy, light, camera, material, visibility.',        enumName: 'OutlinerIconCategory'        }
];

//--------------------------------------------------------------------------------------------------------------------------
//                                                   GLYPH DECLARATIONS
//--------------------------------------------------------------------------------------------------------------------------

export const GLYPHS = [

// ─────────────────────────────────────────── NAVIGATION ───────────────────────────────────────────

{ id:'ArrowUp', name:'Arrow Up', cat:'Navigation', kw:'arrow up north translate',
  note:'Hollow triangular head + full-length shaft. Feather/Lucide use an open chevron head.',
  l:[ {d:'M12 21.2V10.6'}, {d:'M12 2.6 17.6 10.6H6.4Z', role:'hot'} ] },

{ id:'ArrowDown', name:'Arrow Down', cat:'Navigation', kw:'arrow down south',
  note:'Vertical mirror of ArrowUp; identical head mass for optical parity.',
  l:[ {d:'M12 2.6V13.4'}, {d:'M12 21.4 6.4 13.4H17.6Z', role:'hot'} ] },

{ id:'ArrowLeft', name:'Arrow Left', cat:'Navigation', kw:'arrow left west back',
  note:'Head rotated on the same triangle template, never re-proportioned.',
  l:[ {d:'M21.4 12H10.6'}, {d:'M2.6 12 10.6 6.4V17.6Z', role:'hot'} ] },

{ id:'ArrowRight', name:'Arrow Right', cat:'Navigation', kw:'arrow right east forward next',
  note:'Head rotated on the same triangle template, never re-proportioned.',
  l:[ {d:'M2.6 12H13.4'}, {d:'M21.4 12 13.4 17.6V6.4Z', role:'hot'} ] },

{ id:'ChevronUp', name:'Chevron Up', cat:'Navigation', kw:'chevron up collapse caret',
  note:'CONVERGENT PRIMITIVE. Shallower 40° legs and a wider 13px span than the 45°/12px Lucide chevron.',
  l:[ {d:'M5.4 15.4 12 8.6l6.6 6.8'} ] },

{ id:'ChevronDown', name:'Chevron Down', cat:'Navigation', kw:'chevron down expand caret dropdown',
  note:'CONVERGENT PRIMITIVE. Shallower 40° legs and a wider 13px span than the 45°/12px Lucide chevron.',
  l:[ {d:'M5.4 8.6 12 15.4l6.6-6.8'} ] },

{ id:'ChevronLeft', name:'Chevron Left', cat:'Navigation', kw:'chevron left previous caret',
  note:'CONVERGENT PRIMITIVE — geometry is dictated by the symbol itself.',
  l:[ {d:'M15.4 5.4 8.6 12l6.8 6.6'} ] },

{ id:'ChevronRight', name:'Chevron Right', cat:'Navigation', kw:'chevron right next caret disclosure',
  note:'CONVERGENT PRIMITIVE — geometry is dictated by the symbol itself.',
  l:[ {d:'M8.6 5.4 15.4 12l-6.8 6.6'} ] },

{ id:'ChevronsUp', name:'Chevrons Up', cat:'Navigation', kw:'double chevron up first top',
  note:'Pair spacing 7.4px — tighter stack than Lucide, keeps the pair reading as one mark at 16px.',
  l:[ {d:'M5.6 11.2 12 4.6l6.4 6.6'}, {d:'M5.6 19.4 12 12.8l6.4 6.6'} ] },

{ id:'ChevronsDown', name:'Chevrons Down', cat:'Navigation', kw:'double chevron down last bottom',
  note:'Pair spacing 7.4px — tighter stack than Lucide.',
  l:[ {d:'M5.6 4.6 12 11.2l6.4-6.6'}, {d:'M5.6 12.8 12 19.4l6.4-6.6'} ] },

{ id:'ChevronsLeft', name:'Chevrons Left', cat:'Navigation', kw:'double chevron left rewind start',
  note:'Pair spacing 7.4px — tighter stack than Lucide.',
  l:[ {d:'M11.2 5.6 4.6 12l6.6 6.4'}, {d:'M19.4 5.6 12.8 12l6.6 6.4'} ] },

{ id:'ChevronsRight', name:'Chevrons Right', cat:'Navigation', kw:'double chevron right fast forward end',
  note:'Pair spacing 7.4px — tighter stack than Lucide.',
  l:[ {d:'M12.8 5.6 19.4 12l-6.6 6.4'}, {d:'M4.6 5.6 11.2 12l-6.6 6.4'} ] },

{ id:'CornerDownRight', name:'Corner Down Right', cat:'Navigation', kw:'branch child indent reparent tree',
  note:'Hard mitred elbow (no 4px fillet) + closed head — reads as a hierarchy rail, not a rounded arrow.',
  l:[ {d:'M3.4 3.6v9.6a2.6 2.6 0 0 0 2.6 2.6h9.6'}, {d:'M21.4 15.8 15.4 20.2v-8.8Z', role:'hot'} ] },

{ id:'CornerDownLeft', name:'Corner Down Left', cat:'Navigation', kw:'return enter unparent branch',
  note:'Hard mitred elbow + closed head, mirrored from CornerDownRight.',
  l:[ {d:'M20.6 3.6v9.6a2.6 2.6 0 0 1-2.6 2.6H8.4'}, {d:'M2.6 15.8 8.6 11.4v8.8Z', role:'hot'} ] },

{ id:'RotateClockwise', name:'Rotate Clockwise', cat:'Navigation', kw:'redo reload refresh rotate cw',
  note:'True 270° circular arc (r=8, centre 12,12) with a closed head — not Lucide\'s arc-plus-corner-bracket.',
  l:[ {d:'M20 12A8 8 0 1 1 12 4'}, {d:'M12 1.6v4.8L15.9 4Z', role:'hot'} ] },

{ id:'RotateCounterClockwise', name:'Rotate Counter Clockwise', cat:'Navigation', kw:'undo revert rotate ccw',
  note:'Exact mirror of RotateClockwise about x=12.',
  l:[ {d:'M4 12A8 8 0 1 0 12 4'}, {d:'M12 1.6v4.8L8.1 4Z', role:'hot'} ] },

{ id:'ExpandDiagonal', name:'Expand Diagonal', cat:'Navigation', kw:'maximise fullscreen expand viewport',
  note:'Redrawn away from the Lucide maximize idiom: a real viewport frame that is being pushed outward '
     + 'by two closed heads, rather than four free-floating corner ticks.',
  l:[ {d:'M7.8 7.8h8.4v8.4H7.8Z', o:0.5},
      {d:'M8.6 8.6 4.4 4.4M15.4 15.4l4.2 4.2', role:'hot'},
      {d:'M2.6 2.6h5.2L2.6 7.8Z', role:'hot', f:1},
      {d:'M21.4 21.4h-5.2l5.2-5.2Z', role:'hot', f:1} ] },

{ id:'CollapseDiagonal', name:'Collapse Diagonal', cat:'Navigation', kw:'minimise restore collapse viewport',
  note:'Exact inverse of ExpandDiagonal: the same frame, the same two heads, driven inward.',
  l:[ {d:'M7.8 7.8h8.4v8.4H7.8Z', o:0.5},
      {d:'M2.6 2.6 6.6 6.6M21.4 21.4l-4-4', role:'hot'},
      {d:'M9.8 4.6v5.2H4.6Z', role:'hot', f:1},
      {d:'M14.2 19.4v-5.2h5.2Z', role:'hot', f:1} ] },

// ───────────────────────────────────────── CONTROL CENTRE ─────────────────────────────────────────

{ id:'SettingsGear', name:'Settings Gear', cat:'ControlCentre', kw:'settings preferences gear cog nut config',
  note:'REPLACES a verbatim Feather "settings" copy. Hex-nut machining metaphor: flat-top hexagon, ' +
       'bore circle, six seating ticks. Zero curve DNA shared with the Feather 8-lobe blob.',
  l:[ {d:'M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4Z'},
      {d:'M12 15.6a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2Z', role:'hot'},
      {d:'M12 2.8v2.6M20 7.4l-2.25 1.3M20 16.6l-2.25-1.3M12 21.2v-2.6M4 16.6l2.25-1.3M4 7.4l2.25 1.3', o:0.55} ] },

{ id:'AppearancePalette', name:'Appearance Palette', cat:'ControlCentre', kw:'theme appearance palette colour swatch skin',
  note:'REPLACES a Feather-derived palette blob. Three chamfered swatch cards fanned in Z order — ' +
       'directly mirrors ThemeStructure\'s palette/accent token pairing.',
  l:[ {d:'M2.8 2.8h18.4v14.2l-4.2 4.2H2.8Z'},
      {d:'M2.8 2.8h8.6v7.4H2.8Z',  role:'x',   f:1, o:0.92},
      {d:'M11.4 2.8h9.8v7.4h-9.8Z', role:'hot', f:1, o:0.92},
      {d:'M2.8 10.2h8.6v11H2.8Z',   role:'cool',f:1, o:0.92},
      {d:'M11.4 10.2h9.8v6.8l-4.2 4.2h-5.6Z', role:'vio', f:1, o:0.92},
      {d:'M2.8 2.8h18.4v14.2l-4.2 4.2H2.8Z'},
      {d:'M11.4 2.8v18.4M2.8 10.2h18.4', o:0.75} ] },

{ id:'DisplayMonitor', name:'Display Monitor', cat:'ControlCentre', kw:'display monitor screen resolution viewport hz',
  note:'Chamfered bezel (top-right dog-ear) + splayed stand. Feather\'s monitor is a plain rounded rect.',
  l:[ {d:'M2.6 4.4h15.2l3.6 3.6v8.4H2.6Z'},
      {d:'M8.4 20.8h7.2M12 16.4v4.4'},
      {d:'M5.6 7.4h6.2', role:'hot', o:0.9} ] },

{ id:'InputDevices', name:'Input Devices', cat:'ControlCentre', kw:'keyboard input keys typing hid bindings',
  note:'FIXES A BUG: the shipped VectorCodec entry is a verbatim Feather "shield" path — wrong metaphor ' +
       'entirely. This is an actual key deck: chamfered chassis, three key rows, spacebar.',
  l:[ {d:'M2.6 5.8h15.6l3.2 3.2v9H2.6Z'},
      {d:'M5.8 9.4h1.4M9.4 9.4h1.4M13 9.4h1.4M16.6 9.4h1.4', cap:'round', w:1.9},
      {d:'M5.8 12.6h1.4M9.4 12.6h1.4M13 12.6h1.4M16.6 12.6h1.4', cap:'round', w:1.9},
      {d:'M8 15.6h8', role:'hot', cap:'round', w:1.9} ] },

{ id:'NotificationsBell', name:'Notifications Bell', cat:'ControlCentre', kw:'bell notification alert toast ping',
  note:'REPLACES a 1.00-similarity verbatim Feather "bell". Faceted campanile: straight chamfered ' +
       'shoulders and a flat rim instead of Feather\'s continuous 6-unit curve.',
  l:[ {d:'M4.4 16.8 6.6 13.6V9.6a5.4 5.4 0 0 1 10.8 0v4l2.2 3.2Z'},
      {d:'M12 4.2V2.4'},
      {d:'M9.6 19.4a2.45 2.45 0 0 0 4.8 0', role:'hot'} ] },

{ id:'WirelessSignal', name:'Wireless Signal', cat:'ControlCentre', kw:'wifi wireless signal network rssi',
  note:'CONVERGENT PRIMITIVE (nested arcs are inherent). Differentiated by a 3-arc cadence on a 4.6px ' +
       'radial step with a square node, versus Feather\'s 4-arc set with a round dot.',
  l:[ {d:'M2.4 9.4a14.6 14.6 0 0 1 19.2 0', o:0.5},
      {d:'M5.8 13a9.6 9.6 0 0 1 12.4 0', o:0.78},
      {d:'M9.1 16.6a4.7 4.7 0 0 1 5.8 0'},
      {d:'M10.7 19.2h2.6v2.6h-2.6Z', role:'hot', f:1} ] },

{ id:'BluetoothSymbol', name:'Bluetooth Symbol', cat:'ControlCentre', kw:'bluetooth pair wireless peripheral gamepad',
  note:'CONVERGENT PRIMITIVE — the Hagall bind-rune is a fixed glyph; only weight and extents are ours.',
  l:[ {d:'M7.4 7.8 16.6 16.2 12 20.6V3.4l4.6 4.4-9.2 8.4'} ] },

{ id:'MoonDisturbance', name:'Moon Disturbance', cat:'ControlCentre', kw:'do not disturb dnd night moon quiet focus',
  note:'REPLACES a 1.00-similarity verbatim Feather "moon". Built as a true two-arc boolean crescent ' +
       'with an explicit terminator line, not a single sweeping path.',
  l:[ {d:'M13.6 2.8A9.2 9.2 0 1 0 21.2 14 7.4 7.4 0 0 1 13.6 2.8Z'},
      {d:'M16.8 5.4h4.6', role:'hot', w:2.2} ] },

{ id:'VolumeSpeaker', name:'Volume Speaker', cat:'ControlCentre', kw:'volume audio speaker master bus gain',
  note:'Chamfered driver cone with an explicit baffle plate; radiation arcs on the same cadence as ' +
       'WirelessSignal so the two read as one family.',
  l:[ {d:'M3.2 9.2h3.6L12 4.6v14.8L6.8 14.8H3.2Z'},
      {d:'M15.4 9.6a3.6 3.6 0 0 1 0 4.8', role:'hot'},
      {d:'M18.3 7.1a7.6 7.6 0 0 1 0 9.8', role:'hot', o:0.6} ] },

{ id:'SunIllumination', name:'Sun Illumination', cat:'ControlCentre', kw:'brightness sun illuminance lux exposure',
  note:'Signature alternating ray cadence — 4 long cardinal rays, 4 short diagonal rays. Feather\'s sun ' +
       'uses 8 equal spokes.',
  l:[ {d:'M12 16.6a4.6 4.6 0 1 0 0-9.2 4.6 4.6 0 0 0 0 9.2Z', role:'hot'},
      {d:'M12 1.8v3.2M12 19v3.2M1.8 12h3.2M19 12h3.2'},
      {d:'M5.5 5.5 7.4 7.4M18.5 5.5 16.6 7.4M18.5 18.5 16.6 16.6M5.5 18.5 7.4 16.6', o:0.6} ] },

// ────────────────────────────────────────── EDITOR TOOLS ──────────────────────────────────────────

{ id:'SelectCursor', name:'Select Cursor', cat:'EditorTools', kw:'select pick cursor pointer arrow tool',
  note:'Asymmetric draughting pointer with a mitred tail notch; not the Feather mouse-pointer silhouette.',
  l:[ {d:'M4.6 2.8 19 11.4l-6.3 1.3 3.4 6.6-2.9 1.5-3.4-6.6-4.4 4.6Z'} ] },

{ id:'SelectBox', name:'Select Box', cat:'EditorTools', kw:'marquee rubber band box select region rect',
  note:'Dashed marquee plus four solid corner handles — the handles are the Frontier tell.',
  l:[ {d:'M4 4h16v16H4Z', dash:'3.2 2.4', o:0.85},
      {d:'M2.6 2.6h2.8v2.8H2.6ZM18.6 2.6h2.8v2.8h-2.8ZM18.6 18.6h2.8v2.8h-2.8ZM2.6 18.6h2.8v2.8H2.6Z', role:'hot', f:1} ] },

{ id:'TranslateGizmo', name:'Translate Gizmo', cat:'EditorTools', kw:'move translate gizmo axis xyz handle',
  note:'SIGNATURE GLYPH. True Z-up right-handed axonometric triad from CLAUDE.md §7 with X/Y/Z bound to ' +
       'red/green/blue. No icon library ships this.',
  l:[ {d:'M12 13.6 3.8 18.4', role:'x'}, {d:'M2.2 19.3 6 17.1v4.4Z', role:'x', f:1 },
      {d:'M12 13.6 20.2 18.4', role:'y'}, {d:'M21.8 19.3 18 17.1v4.4Z', role:'y', f:1 },
      {d:'M12 13.6V4.6', role:'z'},       {d:'M12 2.6 15.4 6.4H8.6Z',  role:'z', f:1 },
      {d:'M12 15.2a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2Z'} ] },

{ id:'RotateGizmo', name:'Rotate Gizmo', cat:'EditorTools', kw:'rotate gizmo orbit euler quaternion trackball',
  note:'Two orthogonal axonometric orbit ellipses with a sweep head — ellipses are foreshortened on the ' +
       'same 30° projection as every other 3D glyph here.',
  l:[ {d:'M12 12m-9.2 0a9.2 4.6 0 1 0 18.4 0 9.2 4.6 0 1 0-18.4 0', role:'z', o:0.9},
      {d:'M12 12m-4.6 0a4.6 9.2 0 1 0 9.2 0 4.6 9.2 0 1 0-9.2 0', role:'x', o:0.55},
      {d:'M18.6 8.6 21.9 7.3l-.9 3.5Z', role:'hot', f:1},
      {d:'M12 13.4a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8Z', role:'hot'} ] },

{ id:'ScaleGizmo', name:'Scale Gizmo', cat:'EditorTools', kw:'scale resize gizmo handle uniform axis',
  note:'Axonometric triad again, but terminated with square grip cubes instead of arrowheads — the ' +
       'translate/scale pair stays visually systematic.',
  l:[ {d:'M12 13 5.2 17', role:'x'}, {d:'M2.6 15.9h3.4v3.4H2.6Z', role:'x', f:1},
      {d:'M12 13l6.8 4',  role:'y'}, {d:'M18 15.9h3.4v3.4H18Z',   role:'y', f:1},
      {d:'M12 13V6',      role:'z'}, {d:'M10.3 2.8h3.4v3.4h-3.4Z', role:'z', f:1},
      {d:'M12 14.4a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8Z'} ] },

{ id:'TransformUniversal', name:'Transform Universal', cat:'EditorTools', kw:'universal transform combined gizmo trs',
  note:'Combined TRS affordance read as three distinct terminals on one hub: an arrowhead (translate), an '
     + 'orbit arc (rotate) and a grip square (scale).',
  l:[ {d:'M12 13.2V6', role:'z'},
      {d:'M12 2.8 15.1 6.6H8.9Z', role:'z', f:1},
      {d:'M12 17.6a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z'},
      {d:'M10 16.6 5.6 19.2', role:'x'},
      {d:'M2.8 20.6 6.4 17.4l.8 2.8Z', role:'x', f:1},
      {d:'M14 16.6l3.2 1.8', role:'y'},
      {d:'M17.6 17h3.6v3.6h-3.6Z', role:'y', f:1} ] },

{ id:'SnapMagnet', name:'Snap Magnet', cat:'EditorTools', kw:'snap magnet magnetic grid attract increment',
  note:'Square-shouldered horseshoe (mitred, not a rounded U) with polarised amber pole faces.',
  l:[ {d:'M5 20.4V10a7 7 0 0 1 14 0v10.4h-4.4V10a2.6 2.6 0 0 0-5.2 0v10.4Z'},
      {d:'M5 16.6h4.4M14.6 16.6H19', role:'hot', w:2.1} ] },

{ id:'SnapGrid', name:'Snap Grid', cat:'EditorTools', kw:'grid snap increment lattice quantise spacing',
  note:'3×3 lattice with one live intersection node — the node is what separates this from a plain grid.',
  l:[ {d:'M3.4 9h17.2M3.4 15h17.2M9 3.4v17.2M15 3.4v17.2', o:0.7},
      {d:'M3.4 3.4h17.2v17.2H3.4Z'},
      {d:'M15 12.9a2.1 2.1 0 1 0 0-4.2 2.1 2.1 0 0 0 0 4.2Z', role:'hot', f:1} ] },

{ id:'PivotCentre', name:'Pivot Centre', cat:'EditorTools', kw:'pivot origin centre transform anchor median',
  note:'Draughting datum mark: broken crosshair, bore circle, and an offset satellite showing the ' +
       'pivot is detachable from the centroid.',
  l:[ {d:'M12 2.6v5M12 16.4v5M2.6 12h5M16.4 12h5'},
      {d:'M12 16.2a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4Z'},
      {d:'M17.8 6.2a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4Z', role:'hot', f:1} ] },

{ id:'VertexMode', name:'Vertex Mode', cat:'EditorTools', kw:'vertex point mode component sub-object corner',
  note:'Z-up axonometric cube, de-emphasised, with its four visible corners promoted to solid nodes.',
  l:[ {d:CUBE_TOP, o:0.42}, {d:CUBE_SKIRT, o:0.42}, {d:CUBE_SPINE, o:0.42},
      {d:'M12 2.7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM18.5 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM5.5 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM12 16.3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z',
       role:'hot', f:1} ] },

{ id:'EdgeMode', name:'Edge Mode', cat:'EditorTools', kw:'edge loop mode component crease boundary',
  note:'Same cube host, one silhouette edge lit and thickened — the three component modes share one base.',
  l:[ {d:CUBE_TOP, o:0.42}, {d:CUBE_SKIRT, o:0.42}, {d:CUBE_SPINE, o:0.42},
      {d:'M5.5 8 12 11.8', role:'hot', w:2.4} ] },

{ id:'FaceMode', name:'Face Mode', cat:'EditorTools', kw:'face polygon mode component quad ngon',
  note:'Same cube host, top rhombus flooded — completes the vertex/edge/face triad.',
  l:[ {d:CUBE_TOP, o:0.42}, {d:CUBE_SKIRT, o:0.42}, {d:CUBE_SPINE, o:0.42},
      {d:'M12 5.1 17.6 8.4 12 11.7 6.4 8.4Z', role:'hot', f:1} ] },

{ id:'ObjectMode', name:'Object Mode', cat:'EditorTools', kw:'object mode instance whole prim actor',
  note:'The unmodified host cube at full weight — the "no component selected" state.',
  l:[ {d:CUBE_TOP}, {d:CUBE_SKIRT}, {d:CUBE_SPINE} ] },

{ id:'ViewportPerspective', name:'Viewport Perspective', cat:'EditorTools', kw:'perspective projection viewport fov camera frustum',
  note:'Literal view frustum with the eye point marked and the far plane lit — a projection diagram, ' +
       'not a camera body.',
  l:[ {d:'M3.6 12 20.4 4.4v15.2Z'},
      {d:'M20.4 4.4v15.2', role:'hot', w:2.2},
      {d:'M2.1 12a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0Z', f:1} ] },

{ id:'ViewportOrthographic', name:'Viewport Orthographic', cat:'EditorTools', kw:'orthographic ortho parallel projection viewport plan',
  note:'A box projected by PARALLEL sight lines onto a picture plane. The rays never converge, which is ' +
       'the exact geometric contrast with the frustum in ViewportPerspective.',
  l:[ {d:'M2.6 7.4h6.2v9.2H2.6Z'},
      {d:'M10.2 8.4h8.2M10.2 12h8.2M10.2 15.6h8.2', role:'hot'},
      {d:'M17.2 6.9 18.8 8.4l-1.6 1.5M17.2 10.5 18.8 12l-1.6 1.5M17.2 14.1l1.6 1.5-1.6 1.5', role:'hot', o:0.6},
      {d:'M20.6 3.6v16.8', w:2.3} ] },

{ id:'CameraLens', name:'Camera Lens', cat:'EditorTools', kw:'camera lens aperture focal exposure photo',
  note:'Chamfered camera chassis with an iris ring and a hot shutter pip.',
  l:[ {d:'M2.6 7h4l1.8-2.6h7.2L17.4 7h1.4l2.6 2.6v9.4H2.6Z'},
      {d:'M12 17.4a4.1 4.1 0 1 0 0-8.2 4.1 4.1 0 0 0 0 8.2Z', role:'hot'},
      {d:'M5.2 10.2h1.8', o:0.7} ] },

{ id:'GridFloor', name:'Grid Floor', cat:'EditorTools', kw:'floor grid ground plane infinite horizon world',
  note:'Receding ground plane in one-point perspective with a lit horizon — matches the engine\'s GPU ' +
       'infinite grid rather than a flat checker.',
  l:[ {d:'M1.8 20.4 9 8.6h6l7.2 11.8Z'},
      {d:'M5.4 14.4h13.2M3.4 17.6h17.2', o:0.65},
      {d:'M12 8.6v11.8M8.2 20.4 10.6 8.6M15.8 20.4 13.4 8.6', o:0.65},
      {d:'M3.4 5.6h17.2', role:'hot', o:0.9} ] },

{ id:'MeasureRuler', name:'Measure Ruler', cat:'EditorTools', kw:'measure ruler dimension distance metres units',
  note:'Dimension line with witness bars and closed end heads — reads as metric annotation, per the ' +
       'engine\'s strict [m] unit rule.',
  l:[ {d:'M4 4.4v6M20 4.4v6', o:0.8},
      {d:'M6.6 7.4h10.8'},
      {d:'M3.2 7.4 7 5.3v4.2ZM20.8 7.4 17 5.3v4.2Z', role:'hot', f:1},
      {d:'M3.6 13.4h16.8v6.2H3.6Z'},
      {d:'M7.8 13.4v2.6M12 13.4v3.6M16.2 13.4v2.6', o:0.7} ] },

{ id:'Wireframe', name:'Wireframe', cat:'EditorTools', kw:'wireframe shading mode lattice topology xray',
  note:'Latitude/longitude cage on the same foreshortened ellipse family as RotateGizmo.',
  l:[ {d:'M12 21.2a9.2 9.2 0 1 0 0-18.4 9.2 9.2 0 0 0 0 18.4Z'},
      {d:'M12 12m-9.2 0a9.2 4 0 1 0 18.4 0 9.2 4 0 1 0-18.4 0', o:0.75},
      {d:'M12 12m-4 0a4 9.2 0 1 0 8 0 4 9.2 0 1 0-8 0', o:0.75},
      {d:'M2.8 12h18.4M12 2.8v18.4', o:0.45} ] },

{ id:'ShadedSolid', name:'Shaded Solid', cat:'EditorTools', kw:'shaded solid shading mode lit material preview',
  note:'Sphere on a ground plane with a banded terminator and a cast shadow — the plane and shadow are '
     + 'what stop it reading as a crescent moon.',
  l:[ {d:'M12 3.2a7.4 7.4 0 0 1 0 14.8 4.6 7.4 0 0 0 0-14.8Z', role:'hot', f:1, o:0.9},
      {d:'M12 17.8a7.4 7.4 0 1 0 0-14.8 7.4 7.4 0 0 0 0 14.8Z'},
      {d:'M12 3.2a4.6 7.4 0 0 1 0 14.8', o:0.4},
      {d:'M2.8 21.4h18.4'},
      {d:'M7 21.4a5 1.5 0 0 1 10 0', o:0.4} ] },

{ id:'ClipPlane', name:'Clip Plane', cat:'EditorTools', kw:'clip plane section cutaway slice near far',
  note:'A cutting plane passing through the host cube, with the severed half dropped to 35% — a real ' +
       'section diagram.',
  l:[ {d:'M12 4.2 18.5 8v6l-6.5 3.8', o:0.35},
      {d:'M12 4.2 5.5 8v6l6.5 3.8Z'},
      {d:'M2.8 9.4 21.2 14.6', role:'hot', dash:'3 2.2'} ] },

{ id:'FocusTarget', name:'Focus Target', cat:'EditorTools', kw:'focus frame selected target reticle zoom extents',
  note:'Reticle built from four corner brackets plus a centre bore — the brackets are open, so it never ' +
       'collides with SelectBox.',
  l:[ {d:'M2.8 8.2V2.8h5.4M15.8 2.8h5.4v5.4M21.2 15.8v5.4h-5.4M8.2 21.2H2.8v-5.4'},
      {d:'M12 15.4a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8Z', role:'hot'} ] },

// ──────────────────────────────────────── TEXTURE PAINTING ────────────────────────────────────────

{ id:'BrushRound', name:'Brush Round', cat:'TexturePainting', kw:'brush paint stroke bristle round tip',
  note:'Three-part brush read: handle, mitred ferrule, loaded tip — the ferrule band is the family tell.',
  l:[ {d:'M20.6 3.4 11 13'},
      {d:'M13.4 6.8 17.2 10.6', o:0.75},
      {d:'M10.8 12.8 7.2 9.2 4.4 15a5.6 5.6 0 0 0 7.4 7.4l5.8-2.8Z', role:'hot'} ] },

{ id:'EraserBlock', name:'Eraser Block', cat:'TexturePainting', kw:'eraser rubber remove undo paint clear',
  note:'Angled block on an explicit work surface line, so it reads as erasing rather than as a rotated box.',
  l:[ {d:'M9.4 19.6 3.6 13.8a1.8 1.8 0 0 1 0-2.6l8-8a1.8 1.8 0 0 1 2.6 0l6 6a1.8 1.8 0 0 1 0 2.6l-7.8 7.8Z'},
      {d:'M7.6 7.6 15.8 15.8', o:0.7},
      {d:'M9.4 19.6h11.4', role:'hot', w:2.1} ] },

{ id:'EyedropperPick', name:'Eyedropper Pick', cat:'TexturePainting', kw:'eyedropper picker sample colour pipette texel',
  note:'Barrel plus a discrete sampled texel square at the nib — states what was picked, not just the tool.',
  l:[ {d:'M18.4 2.6a3 3 0 0 1 3 3l-2.4 2.4 1 1-6.4 6.4-4-4L16 5l1 1Z'},
      {d:'M12.6 11.4 5 19v3h3l7.6-7.6', o:0.85},
      {d:'M2.6 19.4h2.6v2.6H2.6Z', role:'hot', f:1} ] },

{ id:'BucketFill', name:'Bucket Fill', cat:'TexturePainting', kw:'bucket fill flood paint region contiguous',
  note:'Tipped pail with a flood pool beneath — the pool disambiguates fill from a plain container.',
  l:[ {d:'M2.8 10.6 9.6 3.8l7 7-6.8 6.8a1.8 1.8 0 0 1-2.6 0l-4.4-4.4a1.8 1.8 0 0 1 0-2.6Z'},
      {d:'M7.4 6 5.2 3.8', o:0.85},
      {d:'M2.8 10.6h14', o:0.5},
      {d:'M21.2 15.4a1.9 1.9 0 1 1-3.8 0c0-1.1 1.9-3.6 1.9-3.6s1.9 2.5 1.9 3.6Z', role:'cool', f:1} ] },

{ id:'StampClone', name:'Stamp Clone', cat:'TexturePainting', kw:'stamp clone copy source duplicate patch',
  note:'Press body plus a dashed source anchor — clone stamping is a two-point operation and the icon says so.',
  l:[ {d:'M7.4 10.6V8a4.6 4.6 0 0 1 9.2 0v2.6h2.4v3.6H5v-3.6Z'},
      {d:'M6.6 14.2v4.4h10.8v-4.4'},
      {d:'M3 21.4h18', o:0.55},
      {d:'M12 21.4a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8Z', role:'hot', dash:'2.4 1.8'} ] },

{ id:'GradientRamp', name:'Gradient Ramp', cat:'TexturePainting', kw:'gradient ramp linear blend falloff interpolate',
  note:'Quantised five-step ramp inside a chamfered frame — steps, not a smooth wash, so it survives 16px.',
  l:[ {d:'M3.4 3.4h14.4l2.8 2.8v14.4H3.4Z'},
      {d:'M3.4 17.2h17.2', role:'hot', f:0, w:3.2, o:1},
      {d:'M3.4 13.8h17.2', role:'hot', w:3.2, o:0.66},
      {d:'M3.4 10.4h17.2', role:'hot', w:3.2, o:0.4},
      {d:'M3.4 7h17.2',    role:'hot', w:3.2, o:0.2} ] },

{ id:'SmudgeBlur', name:'Smudge Blur', cat:'TexturePainting', kw:'smudge blur soften gaussian smear feather',
  note:'A hard leading edge whose trailing bands wash out to nothing — the falloff is literal, and the '
     + 'bands are solid so it never reads as a loading spinner.',
  l:[ {d:'M7.6 16.6a4.8 4.8 0 1 0 0-9.6 4.8 4.8 0 0 0 0 9.6Z', role:'hot', f:1},
      {d:'M13.2 8.4a4.6 3.6 0 0 1 0 7.2', role:'hot', f:1, o:0.5},
      {d:'M17.2 9.8a3.4 2.4 0 0 1 0 4.4', role:'hot', f:1, o:0.26},
      {d:'M20.4 11a2.2 1.2 0 0 1 0 2', role:'hot', f:1, o:0.13},
      {d:'M2.8 21.4h18.4', o:0.5} ] },

{ id:'LayerStack', name:'Layer Stack', cat:'TexturePainting', kw:'layers stack blend pbr channel order',
  note:'Three axonometric plates on the Z-up projection with the active plate lit — not the usual ' +
       'flat rhombus sandwich.',
  l:[ {d:'M12 3.2 20.4 7.4 12 11.6 3.6 7.4Z', role:'hot'},
      {d:'M3.6 11.6 12 15.8l8.4-4.2', o:0.7},
      {d:'M3.6 15.8 12 20l8.4-4.2', o:0.42} ] },

{ id:'OpacitySlider', name:'Opacity Slider', cat:'TexturePainting', kw:'opacity alpha transparency checker blend',
  note:'Alpha checkerboard half-occluded by a solid plate — the standard transparency idiom, drawn on ' +
       'the chamfered frame.',
  l:[ {d:'M3.4 3.4h14.4l2.8 2.8v14.4H3.4Z'},
      {d:'M3.4 3.4h4.3v4.3H3.4ZM12 3.4h4.3v4.3H12ZM7.7 7.7H12V12H7.7ZM16.3 7.7h4.3V12h-4.3ZM3.4 12h4.3v4.3H3.4ZM12 12h4.3v4.3H12ZM7.7 16.3H12v4.3H7.7ZM16.3 16.3h4.3v4.3h-4.3Z',
       o:0.3, f:1},
      {d:'M3.4 3.4h8.6v17.2H3.4Z', role:'hot', f:1, o:0.9} ] },

{ id:'MaskAlpha', name:'Mask Alpha', cat:'TexturePainting', kw:'mask alpha stencil clip isolate matte',
  note:'Boolean intersection of plate and disc, with the masked-out remainder dashed.',
  l:[ {d:'M2.8 2.8h11v11h-11Z', dash:'2.8 2'},
      {d:'M14.6 21.2a6.6 6.6 0 1 0 0-13.2 6.6 6.6 0 0 0 0 13.2Z'},
      {d:'M13.8 8.05V13.8H8.06a6.6 6.6 0 0 1 5.74-5.75Z', role:'hot', f:1} ] },

{ id:'SymmetryMirror', name:'Symmetry Mirror', cat:'TexturePainting', kw:'symmetry mirror axis reflect topology bilateral',
  note:'Solid original against a dashed reflection across a live mirror axis — the dashed half is the ' +
       'unambiguous signal.',
  l:[ {d:'M12 2.2v19.6', role:'hot', dash:'3 2.2'},
      {d:'M9.6 5.6 3.2 12l6.4 6.4Z'},
      {d:'M14.4 5.6 20.8 12l-6.4 6.4Z', o:0.5, dash:'2.6 2'} ] },

{ id:'NormalBake', name:'Normal Bake', cat:'TexturePainting', kw:'normal map bake tangent surface high low poly',
  note:'Surface with explicit outbound normal vectors — directly depicts the high-to-low transfer the ' +
       'Tools suite performs.',
  l:[ {d:'M2.8 16.6c3.6 0 4.8-6.4 9-6.4s5.6 6.4 9.4 6.4'},
      {d:'M6.4 13.8V8.2M11.8 10.2V4.2M17.4 13.2V7.4', role:'z'},
      {d:'M6.4 6.4 8 9H4.8ZM11.8 2.4 13.4 5h-3.2ZM17.4 5.6 19 8.2h-3.2Z', role:'z', f:1},
      {d:'M2.8 20.4h18.4', o:0.5} ] },

{ id:'RoughnessSurface', name:'Roughness Surface', cat:'TexturePainting', kw:'roughness microfacet gloss scatter pbr matte',
  note:'Microfacet section: a jagged interface scattering an incident ray into a diffuse lobe.',
  l:[ {d:'M2.8 17.4h18.4'},
      {d:'M2.8 17.4 5.4 14l2.6 3.4L10.6 14l2.6 3.4L15.8 14l2.6 3.4L21 14', o:0.8},
      {d:'M12 13.4 7.4 4.6', role:'hot'},
      {d:'M12 13.4 9.8 3.8M12 13.4l4 -9M12 13.4l6.2-7.4', role:'hot', o:0.42} ] },

{ id:'MetallicSurface', name:'Metallic Surface', cat:'TexturePainting', kw:'metallic metal conductor specular reflect pbr',
  note:'Mirror-lobe counterpart to RoughnessSurface: one incident ray, one specular ray, equal angles.',
  l:[ {d:'M2.8 17.4h18.4'},
      {d:'M12 17.4 5.2 5.6', role:'hot'},
      {d:'M12 17.4 18.8 5.6', role:'hot'},
      {d:'M12 17.4V12', dash:'2.2 1.8', o:0.6},
      {d:'M8.2 11a4.6 4.6 0 0 0 7.6 0', o:0.5} ] },

{ id:'UvUnwrap', name:'UV Unwrap', cat:'TexturePainting', kw:'uv unwrap flatten lscm abf island atlas',
  note:'Cube net laid flat with one island lit — depicts the conformal flattening step, not a plain cross.',
  l:[
      {d:'M8.6 2.8h6.8v6.8h6.2v6.8H8.6v4.8H2.4V9.6h6.2Z'},
      {d:'M8.6 9.6h6.8v6.8H8.6Z', role:'hot', f:1, o:0.85},
      {d:'M8.6 9.6h6.8v6.8H8.6Z', role:'hot'} ] },

{ id:'SeamTag', name:'Seam Tag', cat:'TexturePainting', kw:'seam edge tag cut split uv boundary',
  note:'A tagged cut running across a surface patch, terminated with node grips at both ends.',
  l:[ {d:'M3.4 5.2h17.2v13.6H3.4Z', o:0.5},
      {d:'M6.6 17.6 10.6 9.8l3 4.6 3.8-8', role:'hot', dash:'2.6 2', w:1.9},
      {d:'M5.2 16.2h2.8v2.8H5.2ZM16 4.8h2.8v2.8H16Z', role:'hot', f:1} ] },

{ id:'TexelDensity', name:'Texel Density', cat:'TexturePainting', kw:'texel density resolution checker mip sampling',
  note:'Checker that doubles in frequency across the plate — the density gradient is the whole point.',
  l:[ {d:'M3.4 3.4h17.2v17.2H3.4Z'},
      {d:'M3.4 3.4h5.8v5.8H3.4ZM9.2 9.2H3.4V15h5.8Z', f:1, o:0.9},
      {d:'M12.1 3.4h2.9v2.9h-2.9ZM15 6.3h2.9v2.9H15ZM12.1 9.2h2.9v2.9h-2.9ZM15 12.1h2.9V15H15Z', f:1, o:0.6},
      {d:'M3.4 15h17.2v5.6H3.4Z', role:'hot', f:1, o:0.22},
      {d:'M3.4 15h17.2', role:'hot'} ] },

{ id:'ColourSwatch', name:'Colour Swatch', cat:'TexturePainting', kw:'colour swatch albedo basecolour tint picker',
  note:'Chamfered chip with a corner fold and a droplet — pairs with AppearancePalette by construction.',
  l:[ {d:'M3.6 3.6h11.6l5.2 5.2v11.6H3.6Z'},
      {d:'M15.2 3.6v5.2h5.2', o:0.7},
      {d:'M9.4 18a3.4 3.4 0 0 0 3.4-3.4c0-1.9-3.4-6-3.4-6s-3.4 4.1-3.4 6A3.4 3.4 0 0 0 9.4 18Z', role:'hot', f:1} ] },

// ─────────────────────────────────────────────  OUTLINER  ─────────────────────────────────────────

{ id:'FolderGroup', name:'Folder Group', cat:'Outliner', kw:'folder group collection organise outliner',
  note:'Chamfered tab folder with a spine rule; no rounded corners anywhere.',
  l:[ {d:'M2.8 19.8V4.8h6.4l2.4 3h10.8l-.8 12Z'},
      {d:'M2.8 9.4h18.8', o:0.6} ] },

{ id:'HierarchyBranch', name:'Hierarchy Branch', cat:'Outliner', kw:'hierarchy tree parent child scene graph nesting',
  note:'Explicit parent node with mitred rails to two children — matches CornerDownRight\'s rail language.',
  l:[ {d:'M8.6 2.8h6.8v4.4H8.6Z', role:'hot'},
      {d:'M12 7.2v4.2M5.6 16.8v-2.2a3.2 3.2 0 0 1 3.2-3.2h6.4a3.2 3.2 0 0 1 3.2 3.2v2.2'},
      {d:'M2.8 16.8h5.6v4.4H2.8ZM15.6 16.8h5.6v4.4h-5.6Z'} ] },

{ id:'VisibilityEye', name:'Visibility Eye', cat:'Outliner', kw:'visible eye show reveal render toggle',
  note:'REPLACES the usual almond eye: a lens vesica built from two mitred arcs with an aperture iris — ' +
       'reads as an optical element, matching CameraLens.',
  l:[ {d:'M2.4 12S6.6 5.4 12 5.4 21.6 12 21.6 12 17.4 18.6 12 18.6 2.4 12 2.4 12Z'},
      {d:'M12 15.4a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8Z', role:'hot'},
      {d:'M12 10.6a1.3 1.3 0 1 0 0 2.6', o:0.55} ] },

{ id:'VisibilityHidden', name:'Visibility Hidden', cat:'Outliner', kw:'hidden invisible hide disable eye off',
  note:'Same lens, occluded by a full-bleed strike — the strike runs corner to corner, not inset.',
  l:[ {d:'M4.4 7.6A13.4 13.4 0 0 0 2.4 12s4.2 6.6 9.6 6.6a9.2 9.2 0 0 0 4.4-1.2', o:0.85},
      {d:'M9.2 6a9.6 9.6 0 0 1 2.8-.4c5.4 0 9.6 6.4 9.6 6.4a17.6 17.6 0 0 1-3 3.8', o:0.85},
      {d:'M9.6 9.6a3.4 3.4 0 0 0 4.8 4.8', o:0.85},
      {d:'M2.8 2.8 21.2 21.2', role:'hot', w:2.1} ] },

{ id:'LockClosed', name:'Lock Closed', cat:'Outliner', kw:'lock locked frozen protect immutable pin',
  note:'Chamfered lock body with a square-shouldered shackle — no capsule, no fillets.',
  l:[ {d:'M4 10.6h13l3 3v8.2H4Z'},
      {d:'M7.4 10.6V7a4.6 4.6 0 0 1 9.2 0v3.6'},
      {d:'M12 14.6v3.6', role:'hot', w:2.2} ] },

{ id:'LockOpen', name:'Lock Open', cat:'Outliner', kw:'unlock unlocked editable thaw open',
  note:'Identical body, shackle sprung to the right so the pair animates cleanly between states.',
  l:[ {d:'M4 10.6h13l3 3v8.2H4Z'},
      {d:'M7.4 10.6V7a4.6 4.6 0 0 1 9.2 0', o:0.85},
      {d:'M12 14.6v3.6', role:'hot', w:2.2} ] },

{ id:'LightPoint', name:'Light Point', cat:'Outliner', kw:'point light omni lamp emissive lux photometric',
  note:'Small core with the signature alternating ray cadence — deliberately a quarter of SunIllumination\'s core.',
  l:[ {d:'M12 14.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z', role:'hot', f:1},
      {d:'M12 2.6v3.4M12 18v3.4M2.6 12H6M18 12h3.4'},
      {d:'M5.6 5.6 8 8M18.4 5.6 16 8M18.4 18.4 16 16M5.6 18.4 8 16', o:0.55} ] },

{ id:'LightDirectional', name:'Light Directional', cat:'Outliner', kw:'directional light sun csm shadow parallel rays',
  note:'Parallel rays striking a receiver plane — the parallelism is what distinguishes it from a point lamp.',
  l:[ {d:'M4.6 2.8 8.2 9.4M11.2 2.8l3.6 6.6M17.8 2.8l3.6 6.6', role:'hot'},
      {d:'M2.4 12.6h19.2'},
      {d:'M5.4 16.2 3 20.4M12 16.2 9.6 20.4M18.6 16.2l-2.4 4.2', o:0.45} ] },

{ id:'LightSpot', name:'Light Spot', cat:'Outliner', kw:'spot light cone penumbra falloff stage',
  note:'Emitter, cone and elliptical pool on the same axonometric projection as the gizmos.',
  l:[ {d:'M8.4 2.8h7.2v3.4H8.4Z'},
      {d:'M9.6 6.2 3.8 17.4M14.4 6.2l5.8 11.2', role:'hot'},
      {d:'M12 21a8.2 3.6 0 1 0 0-7.2 8.2 3.6 0 0 0 0 7.2Z', role:'hot', o:0.55} ] },

{ id:'CameraObject', name:'Camera Object', cat:'Outliner', kw:'scene camera view frustum render viewpoint',
  note:'Scene-graph camera as a pyramid frustum with an up-vector tick — not the photo camera of ' +
       'EditorTools/CameraLens.',
  l:[ {d:'M2.8 7.4h9.4v9.2H2.8Z'},
      {d:'M12.2 10.6 21.2 5.8v12.4l-9-4.8Z', role:'hot'},
      {d:'M7.5 7.4V4.6', o:0.7} ] },

{ id:'MeshObject', name:'Mesh Object', cat:'Outliner', kw:'mesh geometry triangle poly meshlet cluster',
  note:'An actual triangulated shell with interior edges — the meshlet read the visibility-buffer ' +
       'renderer cares about.',
  l:[ {d:'M12 2.8 21.2 8.6v6.8L12 21.2 2.8 15.4V8.6Z'},
      {d:'M2.8 8.6 12 14.2l9.2-5.6M12 14.2v7M12 2.8 7.4 11.4M12 2.8l4.6 8.6', o:0.65} ] },

{ id:'VolumeFluid', name:'Volume Fluid', cat:'Outliner', kw:'fluid volume liquid levelset sdf navier stokes',
  note:'Vessel holding a free surface with a dashed zero level-set contour φ(x)=0 — the SDF subsystem\'s ' +
       'actual signature.',
  l:[ {d:'M4.4 3.2h15.2v14.4a4 4 0 0 1-4 4H8.4a4 4 0 0 1-4-4Z'},
      {d:'M4.4 13.4c2.6 0 2.6-2.4 5.2-2.4s2.6 2.4 5.2 2.4 2.6-2.4 4.8-2.4', role:'cool'},
      {d:'M4.4 17.4c2.6 0 2.6-2.4 5.2-2.4s2.6 2.4 5.2 2.4 2.6-2.4 4.8-2.4', role:'cool', o:0.45, dash:'2.6 2'} ] },

{ id:'ParticleEmitter', name:'Particle Emitter', cat:'Outliner', kw:'particles emitter gpu spray curl noise burst',
  note:'Nozzle throwing a graded particle field — sizes fall off with distance, matching ballistic spread.',
  l:[ {d:'M2.8 15.6V8.4l5.6 3.6Z', role:'hot', f:1},
      {d:'M11 8.4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM15.4 5.2a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6ZM15.8 13.4a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4ZM20 9.2a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2ZM19.6 17.6a1 1 0 1 0 0 2 1 1 0 0 0 0-2ZM11.6 17.8a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z', f:1},
      {d:'M20.4 3.6a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8Z', f:1, o:0.55} ] },

{ id:'RigidBody', name:'Rigid Body', cat:'Outliner', kw:'rigid body jolt physics collider dynamics mass',
  note:'Host cube with a velocity vector and contact marks — Jolt rigid dynamics at a glance.',
  l:[ {d:'M12 3.6 19.4 7.9v8.2L12 20.4 4.6 16.1V7.9Z'},
      {d:'M4.6 7.9 12 12.2l7.4-4.3M12 12.2v8.2', o:0.5},
      {d:'M14.6 20.6h4.2', role:'x'},
      {d:'M21.4 20.6 18.2 22.4v-3.6Z', role:'x', f:1} ] },

{ id:'SoftBody', name:'Soft Body', cat:'Outliner', kw:'softbody xpbd deformable tetrahedral elastic squash',
  note:'Deformed shell over a visible constraint lattice — XPBD particles are the whole idea.',
  l:[ {d:'M3.6 13.4c0-5 3.8-8.6 8.4-8.6s8.4 3 8.4 7.4-3 7.6-8 7.6-8.8-1.6-8.8-6.4Z'},
      {d:'M6.4 9.8h11.4M5.2 14.4h14M12 5V19.6M8 5.8l2 13.6M16 5.8l-2 13.6', o:0.4},
      {d:'M12 6.2a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6ZM19.8 13.7a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6ZM4.2 14.9a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6ZM12 21.4a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6Z', role:'hot', f:1} ] },

{ id:'ClothSheet', name:'Cloth Sheet', cat:'Outliner', kw:'cloth sheet drape fabric pin xpbd wind',
  note:'Draped sheet hung from two pinned corners — the pins are the constraint anchors.',
  l:[ {d:'M3.6 5.2h16.8v10.2c0 3-2.2 4.4-4.2 4.4s-3.4-1.4-4.2-1.4-2 1.4-4.2 1.4-4.2-1.4-4.2-4.4Z'},
      {d:'M3.6 10.4c2.6 0 2.6-2 5.6-2s2.8 2 5.6 2 2.8-2 5.6-2', o:0.5},
      {d:'M5.6 5.2V2.8M18.4 5.2V2.8', role:'hot', w:2.1} ] },

{ id:'MaterialSphere', name:'Material Sphere', cat:'Outliner', kw:'material brdf shader sphere preview pbr graph',
  note:'Shader-ball on a plinth with a specular pip — violet role marks every material-domain glyph.',
  l:[ {d:'M12 18.4a7.2 7.2 0 1 0 0-14.4 7.2 7.2 0 0 0 0 14.4Z', role:'vio'},
      {d:'M8.2 8.6a4.4 4.4 0 0 1 2.6-1.8', o:0.75, cap:'round'},
      {d:'M6 18.4h12l2.4 3.2H3.6Z'} ] },

{ id:'AudioEmitter', name:'Audio Emitter', cat:'Outliner', kw:'audio sound emitter spatial hrtf reverb bus',
  note:'Bilateral wavefronts from a central source — deliberately symmetric so it never reads as WiFi.',
  l:[ {d:'M12 8.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4Z', role:'hot', f:1},
      {d:'M7.4 7.4a6.5 6.5 0 0 0 0 9.2M16.6 7.4a6.5 6.5 0 0 1 0 9.2'},
      {d:'M4.2 4.2a11 11 0 0 0 0 15.6M19.8 4.2a11 11 0 0 1 0 15.6', o:0.45} ] },

{ id:'SceneWorld', name:'Scene World', cat:'Outliner', kw:'scene world level global root environment origin',
  note:'Globe carrying an explicit +Z zenith axis — the engine\'s world basis is Z-up and the icon says so.',
  l:[ {d:'M12 20.6a8.6 8.6 0 1 0 0-17.2 8.6 8.6 0 0 0 0 17.2Z'},
      {d:'M3.4 12h17.2', o:0.7},
      {d:'M12 3.4a13 8.6 0 0 1 0 17.2 13 8.6 0 0 1 0-17.2', o:0.7},
      {d:'M12 12v-9.4', role:'z', dash:'2.4 1.8'},
      {d:'M12 1.4 14.2 4.6H9.8Z', role:'z', f:1} ] },

{ id:'SearchFind', name:'Search Find', cat:'Outliner', kw:'search find filter query locate outliner lookup',
  note:'CONVERGENT PRIMITIVE (lens + handle). Differentiated with a hexagonal lens on the SettingsGear ' +
       'hex module and a mitred handle.',
  l:[ {d:'M10.4 2.8 16.6 6.4v7.2L10.4 17.2 4.2 13.6V6.4Z'},
      {d:'M15.2 14.6 21 20.4', role:'hot', w:2.3} ] }

];

export default GLYPHS;
