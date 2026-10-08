// Particle system presets and default scene content.
// All lengths are metres, speeds m/s, times seconds. Colours are linear RGBA 0..1.
(function () {
  "use strict";
  const PE = (window.PE = window.PE || {});

  // Every parameter a system can carry. Presets override a subset.
  PE.baseParams = function baseParams() {
    return {
      kind: 0,              // 0 spark, 1 leaf/debris, 3 atoms (LJ), 4 chemicals, 5 VFX
      shape: 0,             // 0 streak, 1 sphere, 2 leaf / paper, 3 soft glow
      leafMode: 0,          // 0 leaf, 1 paper
      blend: "add",         // "add" | "alpha"
      capacity: 2048,
      rate: 0,              // particles per second
      emitShape: 0,         // 0 point, 1 sphere, 2 disc, 3 box
      origin: [0, 0.5, 0],
      radius: 0.1,
      boxHalf: [0, 0, 0],
      dir: [0, 1, 0],
      spread: 0.5,          // radians
      speedMin: 1,
      speedMax: 3,
      drag: 0.2,
      gravity: 1,
      lifeMin: 1,
      lifeMax: 2,
      sizeStart: 0.05,
      sizeEnd: 0.05,
      sizeScale: 1,
      colA: [1, 1, 1, 1],
      colB: [1, 1, 1, 0],
      colC: [1, 1, 0.3, 1],
      windCoupling: 0,      // 1/s, how quickly the particle follows the wind
      bounce: 0,
      buoyancy: 0,          // m/s^2 upward
      flutter: 0,           // lateral sway amplitude (leaves)
      temperature: 0.6,     // molecular: kT in reduced units (m = 1)
      epsilon: 0.15,        // molecular: Lennard-Jones well depth
      sigma: 0.08,          // molecular: particle diameter
      damping: 2.0,         // molecular: Langevin friction 1/s
      reactRate: 4,         // chemicals: A + B -> C per second per contact
      dissociation: 0.3,    // chemicals: C -> A or B per second
      reactRadius: 0.12,    // chemicals: contact radius
      fracA: 0.5,           // chemicals: initial fraction of A
      simDt: 0.004,         // molecular: integration step (s) at time scale 1
      visible: true,
    };
  };

  const P = (overrides) => Object.assign(PE.baseParams(), overrides);

  PE.Presets = [
    {
      id: "sparks", name: "Sparks", group: "Effects",
      blurb: "Hot metal sparks: gravity, drag, ground bounce and wind coupling.",
      p: P({
        kind: 0, shape: 0, blend: "add", capacity: 3000, rate: 160,
        emitShape: 0, origin: [-3, 0.4, 0], dir: [0, 1, 0], spread: 0.6,
        speedMin: 2, speedMax: 6, drag: 0.5, gravity: 1, lifeMin: 0.6, lifeMax: 1.6,
        sizeStart: 0.035, sizeEnd: 0.01,
        colA: [1, 0.92, 0.55, 1], colB: [1, 0.35, 0.05, 0],
        windCoupling: 0.25, bounce: 0.35,
      }),
    },
    {
      id: "strikeSparks", name: "Strike sparks", group: "Effects",
      blurb: "Burst of sparks at each lightning strike point (fires on every strike).",
      p: P({
        kind: 0, shape: 0, blend: "add", capacity: 2000, rate: 0,
        emitShape: 0, origin: [0, 0, 0], dir: [0, 1, 0], spread: 1.5,
        speedMin: 1.5, speedMax: 7, drag: 0.3, gravity: 1.2, lifeMin: 0.4, lifeMax: 1.1,
        sizeStart: 0.03, sizeEnd: 0.008,
        colA: [0.85, 0.92, 1, 1], colB: [0.4, 0.6, 1, 0],
        windCoupling: 0.2, bounce: 0.4,
      }),
    },
    {
      id: "rain", name: "Rain streaks", group: "Weather",
      blurb: "Rain falling through the wind field. Drops bounce off the floor with a small splash rebound, then fade.",
      p: P({
        kind: 0, shape: 0, blend: "alpha", capacity: 5000, rate: 500,
        emitShape: 3, boxHalf: [5, 0, 5], origin: [0, 7.2, 0], dir: [0, -1, 0], spread: 0.03,
        speedMin: 7, speedMax: 9, drag: 0, gravity: 0.6, lifeMin: 1.2, lifeMax: 1.8,
        sizeStart: 0.06, sizeEnd: 0.05,
        colA: [0.75, 0.85, 1, 0.85], colB: [0.75, 0.85, 1, 0.25],
        windCoupling: 0.7, bounce: 0.25,
      }),
    },
    {
      id: "hail", name: "Hail", group: "Weather",
      blurb: "Hard ice pellets that drop fast and bounce high off the floor before settling.",
      p: P({
        kind: 0, shape: 1, blend: "alpha", capacity: 1500, rate: 70,
        emitShape: 3, boxHalf: [5, 0, 5], origin: [0, 7.2, 0], dir: [0, -1, 0], spread: 0.05,
        speedMin: 6, speedMax: 8, drag: 0.05, gravity: 1.0, lifeMin: 3, lifeMax: 4.5,
        sizeStart: 0.09, sizeEnd: 0.09,
        colA: [0.9, 0.95, 1, 1], colB: [0.8, 0.86, 0.95, 0.2],
        windCoupling: 0.8, bounce: 0.5,
      }),
    },
    {
      id: "leaves", name: "Leaves", group: "Wind-blown",
      blurb: "Leaves released from a canopy; they flutter, tumble and follow the wind field.",
      p: P({
        kind: 1, shape: 2, leafMode: 0, blend: "alpha", capacity: 1200, rate: 20,
        emitShape: 2, origin: [0, 4.6, 0], radius: 4.5, dir: [0, -1, 0], spread: 0.5,
        speedMin: 0.2, speedMax: 0.9, drag: 1.4, gravity: 0.35, lifeMin: 7, lifeMax: 12,
        sizeStart: 0.14, sizeEnd: 0.12,
        colA: [0.42, 0.72, 0.22, 1], colB: [0.8, 0.52, 0.16, 1],
        windCoupling: 2.2, flutter: 1.2, bounce: 0,
      }),
    },
    {
      id: "paper", name: "Paper & debris", group: "Wind-blown",
      blurb: "Light paper sheets: high wind coupling and strong sway.",
      p: P({
        kind: 1, shape: 2, leafMode: 1, blend: "alpha", capacity: 600, rate: 8,
        emitShape: 1, origin: [-2, 3, 2], radius: 2.5, dir: [0, -1, 0], spread: 0.4,
        speedMin: 0.1, speedMax: 0.5, drag: 0.6, gravity: 0.25, lifeMin: 6, lifeMax: 10,
        sizeStart: 0.12, sizeEnd: 0.1,
        colA: [0.95, 0.95, 0.9, 1], colB: [0.8, 0.82, 0.85, 1],
        windCoupling: 3.0, flutter: 2.0,
      }),
    },
    {
      id: "atoms", name: "Atoms (LJ gas)", group: "Physics",
      blurb: "Lennard-Jones gas on a spatial hash grid with a Langevin thermostat. Colour = speed.",
      p: P({
        kind: 3, shape: 1, blend: "alpha", capacity: 1024, emitShape: 3,
        origin: [3.2, 1.0, -2.6], boxHalf: [0.9, 0.9, 0.9],
        sigma: 0.08, epsilon: 0.15, temperature: 0.6, damping: 2.0, simDt: 0.004,
        colA: [0.35, 0.65, 1, 1], colB: [1, 0.35, 0.25, 1],
      }),
    },
    {
      id: "chemicals", name: "Chemicals A+B→C", group: "Physics",
      blurb: "Reactive particles: A + B react on contact into C, which dissociates back. Read counts back to the CPU.",
      p: P({
        kind: 4, shape: 1, blend: "alpha", capacity: 1024, emitShape: 3,
        origin: [3.2, 1.0, 2.6], boxHalf: [0.9, 0.9, 0.9],
        sigma: 0.08, temperature: 0.6, damping: 2.0, simDt: 0.004,
        reactRate: 6, dissociation: 0.3, reactRadius: 0.12, fracA: 0.5,
        colA: [1, 0.38, 0.3, 1], colB: [0.3, 0.62, 1, 1], colC: [1, 0.86, 0.3, 1],
      }),
    },
    {
      id: "fire", name: "Fire", group: "VFX",
      blurb: "Buoyant additive flame with wind-bent tongues.",
      p: P({
        kind: 5, shape: 3, blend: "add", capacity: 2500, rate: 280,
        emitShape: 1, radius: 0.12, origin: [-4.2, 0.05, -4], dir: [0, 1, 0], spread: 0.35,
        speedMin: 0.6, speedMax: 1.7, drag: 0.8, buoyancy: 2.2, gravity: 0,
        lifeMin: 0.7, lifeMax: 1.5, sizeStart: 0.35, sizeEnd: 0.12,
        colA: [1, 0.85, 0.35, 1], colB: [0.95, 0.2, 0.05, 0], windCoupling: 1.2,
      }),
    },
    {
      id: "smoke", name: "Smoke", group: "VFX",
      blurb: "Alpha-blended soft smoke that expands and drifts with the wind.",
      p: P({
        kind: 5, shape: 3, blend: "alpha", capacity: 1500, rate: 70,
        emitShape: 1, radius: 0.2, origin: [-2.6, 0.2, -4], dir: [0, 1, 0], spread: 0.3,
        speedMin: 0.3, speedMax: 0.8, drag: 0.5, buoyancy: 1.0, gravity: 0,
        lifeMin: 3, lifeMax: 6, sizeStart: 0.2, sizeEnd: 1.3,
        colA: [0.6, 0.6, 0.64, 0.5], colB: [0.25, 0.25, 0.28, 0], windCoupling: 1.5,
      }),
    },
    {
      id: "explosion", name: "Explosion", group: "VFX",
      blurb: "Spherical additive burst. Use the Burst button to fire it.",
      p: P({
        kind: 5, shape: 3, blend: "add", capacity: 2000, rate: 0,
        emitShape: 1, radius: 0.1, origin: [0, 1.2, -4], dir: [0, 1, 0], spread: 3.14159,
        speedMin: 3, speedMax: 9, drag: 2.6, buoyancy: 0.3, gravity: 0.4,
        lifeMin: 0.5, lifeMax: 1.2, sizeStart: 0.15, sizeEnd: 0.6,
        colA: [1, 0.95, 0.7, 1], colB: [1, 0.35, 0.08, 0], windCoupling: 0.6,
      }),
    },
    {
      id: "tornado", name: "Tornado debris", group: "Storms",
      blurb: "Debris lifted by a tornado. Adding it enables the Tornado wind vortex at this spot; the swirl is the grid itself.",
      windLink: { type: 2, name: "Tornado", local: true, set: { radius: 2.4, strength: 9 } },
      p: P({
        kind: 1, shape: 2, leafMode: 1, blend: "alpha", capacity: 1500, rate: 90,
        emitShape: 2, origin: [0, 0.05, -2], radius: 1.6, dir: [0, 1, 0], spread: 0.6,
        speedMin: 1, speedMax: 3, drag: 0.4, gravity: 0.3, lifeMin: 4, lifeMax: 7,
        sizeStart: 0.14, sizeEnd: 0.1, colA: [0.36, 0.31, 0.26, 1], colB: [0.52, 0.46, 0.38, 0],
        windCoupling: 3.5, flutter: 1.2, bounce: 0,
      }),
    },
    {
      id: "sandstorm", name: "Sandstorm", group: "Storms",
      blurb: "Dust driven across the scene. Adding it sets Prevailing wind to 8 m/s at bearing 70°.",
      windLink: { type: 0, name: "Prevailing wind", set: { strength: 8, bearing: 70 } },
      p: P({
        kind: 1, shape: 3, blend: "alpha", capacity: 6000, rate: 900,
        emitShape: 3, origin: [-5.6, 1.1, 0], boxHalf: [0.3, 0.9, 5.2], dir: [0.94, 0, 0.342], spread: 0.25,
        speedMin: 5, speedMax: 8, drag: 1.0, gravity: 0.2, lifeMin: 4, lifeMax: 7,
        sizeStart: 0.07, sizeEnd: 0.05, colA: [0.82, 0.66, 0.42, 0.55], colB: [0.7, 0.55, 0.34, 0],
        windCoupling: 4, flutter: 0.6, bounce: 0,
      }),
    },
    {
      id: "snow", name: "Snow", group: "Weather",
      blurb: "Slow snowfall that drifts and flutters through the wind field, with a soft rebound at the floor.",
      p: P({
        kind: 0, shape: 3, blend: "alpha", capacity: 3000, rate: 160,
        emitShape: 3, boxHalf: [5, 0, 5], origin: [0, 7.2, 0], dir: [0, -1, 0], spread: 0.2,
        speedMin: 0.4, speedMax: 0.9, drag: 1.0, gravity: 0.3, lifeMin: 9, lifeMax: 13,
        sizeStart: 0.07, sizeEnd: 0.06, colA: [0.95, 0.97, 1, 0.85], colB: [0.95, 0.97, 1, 0],
        windCoupling: 1.2, flutter: 0.9, bounce: 0.12,
      }),
    },
    {
      id: "embers", name: "Embers", group: "VFX",
      blurb: "Glowing embers lifted on hot air; additive, short-lived, bent by the wind.",
      p: P({
        kind: 5, shape: 3, blend: "add", capacity: 900, rate: 45,
        emitShape: 1, radius: 0.5, origin: [-4.0, 0.3, -4.0], dir: [0, 1, 0], spread: 0.5,
        speedMin: 0.8, speedMax: 2.2, drag: 0.7, buoyancy: 1.8, gravity: 0, lifeMin: 2, lifeMax: 4.2,
        sizeStart: 0.035, sizeEnd: 0.012, colA: [1, 0.72, 0.3, 1], colB: [0.9, 0.25, 0.05, 0],
        windCoupling: 1.5,
      }),
    },
    {
      id: "petals", name: "Cherry petals", group: "Wind-blown",
      blurb: "Petals drifting off a canopy; they tumble and follow the wind closely.",
      p: P({
        kind: 1, shape: 2, leafMode: 0, blend: "alpha", capacity: 700, rate: 14,
        emitShape: 2, origin: [2.5, 4.4, 2.5], radius: 2.2, dir: [0, -1, 0], spread: 0.5,
        speedMin: 0.2, speedMax: 0.7, drag: 1.3, gravity: 0.3, lifeMin: 7, lifeMax: 11,
        sizeStart: 0.1, sizeEnd: 0.09, colA: [1, 0.74, 0.82, 1], colB: [0.96, 0.58, 0.72, 1],
        windCoupling: 2.4, flutter: 1.6,
      }),
    },
  ];

  PE.presetById = (id) => PE.Presets.find((preset) => preset.id === id);

  // Wind field components. Type codes match the WGSL wind kernel:
  // 0 directional, 1 gust bands, 2 tornado, 3 radial (negative strength = suction).
  PE.WindTypes = ["Directional", "Gust bands", "Tornado", "Radial"];
  PE.defaultWind = function defaultWind() {
    return {
      windScale: 1,
      turbulence: 0.35,
      arrowRef: 6,
      showArrows: true,
      showFloor: true,
      showDomain: true,
      components: [
        { name: "Prevailing wind", type: 0, enabled: true, x: 0, z: 0, radius: 6, strength: 3, bearing: 70, freq: 0.3 },
        { name: "Passing gust", type: 1, enabled: true, x: -4, z: 0, radius: 4, strength: 5, bearing: 70, freq: 0.3 },
        { name: "Tornado", type: 2, enabled: false, x: -2, z: -4, radius: 1.6, strength: 6, bearing: 0, freq: 0 },
        { name: "Radial suction", type: 3, enabled: false, x: 0, z: -2, radius: 3, strength: -2, bearing: 0, freq: 0 },
      ],
      swirl: 1.2,
    };
  };

  // Default scene: a few systems visible at once; the rest are one click away in "Add".
  PE.defaultScene = ["sparks", "leaves", "atoms", "chemicals"];
})();
