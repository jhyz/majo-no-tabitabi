// Elements, materials and tunables of 万物相生 (DESIGN §3.2). Pure data.

export const ELEMENTS = ['fire', 'water', 'ice', 'wind', 'thunder', 'earth', 'sun', 'moon'];
export const STATUSES = ['burning', 'wet', 'frozen', 'shocked', 'lit', 'muddy', 'chilled'];

/**
 * Per-material defaults.
 *   flammable 0..1   how readily it catches (0 = never burns)
 *   burnTime         seconds of fuel (things that are not alive burn out and char; living things just stop burning)
 *   conductive       carries thunder chains even when dry
 *   freezable        can be frozen solid (wet things freeze; dry ones only by a strong blast)
 *   living           burning is a status that ends by itself (no charring / burnout)
 */
export const MATERIALS = {
  grass:   { flammable: 1.0,  burnTime: 4,  conductive: false, freezable: true },
  wood:    { flammable: 0.8,  burnTime: 16, conductive: false, freezable: true },
  paper:   { flammable: 1.0,  burnTime: 4,  conductive: false, freezable: true },
  cloth:   { flammable: 0.9,  burnTime: 7,  conductive: false, freezable: true },
  stone:   { flammable: 0,    burnTime: 0,  conductive: false, freezable: true },
  metal:   { flammable: 0,    burnTime: 0,  conductive: true,  freezable: true },
  ice:     { flammable: 0,    burnTime: 0,  conductive: false, freezable: false },
  crystal: { flammable: 0,    burnTime: 0,  conductive: false, freezable: false },
  water:   { flammable: 0,    burnTime: 0,  conductive: true,  freezable: true },
  flesh:   { flammable: 0.45, burnTime: 4,  conductive: false, freezable: true,  living: true },
  spirit:  { flammable: 0.25, burnTime: 3,  conductive: false, freezable: false, living: true },
  shade:   { flammable: 0.7,  burnTime: 4,  conductive: false, freezable: true,  living: true },
};

export const T = {
  WET: 12,            // water soaks for 12 s
  FREEZE: 6,          // ice on wet creature: 6 s
  FREEZE_DRY: 2.5,    // ice blast (power >= 2) on something dry
  SHOCK: 1.4,
  LIT: 6,
  THAW_WET: 5,        // after thawing / melting a thing stays wet this long
  CHAIN_RANGE: 8,     // thunder hops this far between conductors
  CHAIN_MAX: 24,
  SPREAD_EVERY: 0.4,  // a burning reactor tries to spread this often
  MUDDY: 5,           // earth on something wet / standing in mud: slowed (speed × MUD_SLOW)
  CHILL: 4,           // frost ground / ice sheet / hail: slowed (× CHILL_SLOW); ice freezes it even when dry
  MUD_SLOW: 0.45,
  CHILL_SLOW: 0.7,
};

/** Damage multipliers of the reactions (hinfo.mult): combining elements is worth it. */
export const MULT = { steam: 1.3, melt: 2, shatter: 3, conduct: 1.6, overload: 1.5 };

/** Ground fire. */
export const FIRE = {
  CELL: 2,            // metres
  CAP: 420,           // burning cells at once
  TICK: 0.2,          // automaton step (s)
  LIFE: [4.2, 6.4],   // seconds a cell burns
  CATCH: 0.55,        // seconds before a fresh cell can spread
  RATE: 0.75,         // ignition attempts per second per neighbour (before wind)
  DECAY: 0.055,       // strength lost per generation (fires die out on their own)
  REGROW: 150,        // seconds before burnt grass can burn again
  WET_GROUND: 25,     // seconds watered ground resists fire
};

/** Fire / light bookkeeping on a coarse grid. */
export const HEAT_CELL = 6;

export const MAX_FLAMES = 3080;   // flame-card instances (flames.js layers: smoke 360 · back 480 · main 1600 · embers 640)
export const MAX_FIRE_LIGHTS = 4;
