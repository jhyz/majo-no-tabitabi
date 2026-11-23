import { FIELD_LIMIT, JOURNEY_ANCHORS, JOURNEY_POI, ROAD_ACROSS } from './journey-map.js';
import { BELL, BELL_ROADS, POST_ROAD, toBellWorld } from './bellcrown.js';
// 曦月洲 — canonical world layout. Every module reads positions from here; nobody hard-codes coordinates.
// Axes: +x = 东 (east), +z = 南 (south), -z = 北 (north), +y = up. Units are metres. Sea level y = 0.
// y values are never stored here: use G.world.heightAt(x, z) / groundAt(x, z, y).

export const WORLD = {
  half: FIELD_LIMIT,         // the western bell coast and its strait fit the same terrain-texture square
  seaLevel: 0,
  ceiling: 300,       // brooms cannot climb above this
};

/** The Moon Veil (月帷): centre of the everlasting night and its radii. */
export const VEIL = { x: 100000, z: 100000, inner: 300, outer: 620 };

/** Named places. r = radius of the place, h = flattened ground height there (if the terrain is levelled). */
export const POI = {
  ...JOURNEY_POI,
  shrine:     { id: 'shrine',     x: -540, z: 40,   r: 40,  h: 30,  major: 'sun' },
  training:   { id: 'training',   x: -600, z: -22,  r: 24,  h: 19,  major: 'sun' },
  village:    { id: 'village',    x: -455, z: 150,  r: 75,  h: 9,   major: 'sun' },
  sunhill:    { id: 'sunhill',    x: -620, z: -140, r: 90,          major: 'sun' },
  southcape:  { id: 'southcape',  x: -380, z: 560,  r: 60,          major: 'sun' },
  windshrine: { id: 'windshrine', x: -20,  z: -540, r: 14,  h: 176, major: 'sun' },
  spring:     { id: 'spring',     x: -150, z: -250, r: 26,          major: 'dusk' },
  foxvillage: { id: 'foxvillage', x: -70,  z: 90,   r: 50,  h: 6,   major: 'dusk' },
  dusktree:   { id: 'dusktree',   x: -30,  z: -170, r: 36,  h: 20,  major: 'dusk' },
  lake:       { id: 'lake',       x: 120,  z: 400,  r: 150,         major: 'dusk' },
  lakeisle:   { id: 'lakeisle',   x: 120,  z: 400,  r: 26,  h: 5,   major: 'dusk' },
  town:       { id: 'town',       x: 205,  z: -125, r: 70,  h: 12,  major: 'night' },
  glowwood:   { id: 'glowwood',   x: 400,  z: 210,  r: 130,         major: 'night' },
  crystal:    { id: 'crystal',    x: 545,  z: -275, r: 70,  h: 18,  major: 'night' },
  eastshore:  { id: 'eastshore',  x: 690,  z: 60,   r: 70,          major: 'night' },
  palace:     { id: 'palace',     x: 380,  z: -40,  r: 52,  h: 140, major: 'night' },
};

/** 霜见岳 — the northern range. Summit (风祠) is POI.windshrine. */
export const MOUNTAIN = { x: -20, z: -540, rx: 250, rz: 165 };
/** 月池 — the ring-shaped pool around the palace rock. */
export const MOAT = { x: 380, z: -40, r0: 82, r1: 118 };

/** Rivers as polylines [[x,z],...]. 暮川 runs from 雾见泉 into 镜湖; 潮川 drains the lake into the southern sea. */
export const RIVERS = [
 {id:'eastbrook',pts:[[1420,530],[1210,410],[944,416],[684,319],[409,382],[120,401],[-80,549],[-215,735],[-332,1008]]},
 {id:'westbrook',pts:[[-879,-1177],[-812,-1035],[-759,-902],[-798,-738],[-708,-624],[-580,-565],[-455,-532]]}
];

/** Saya's practice field (episode two): the worn earth track ringing it, an oval round the practice anchor (radii in m,
 *  `tilt` = yaw of the long axis). Drawn as a footpath loop (ROADS 'practice_track'): pale dirt with ruts, no grass on it;
 *  the field's props stand outside it (world/builders/practice-field.js). The ring course flies over its north curve. */
export const PRACTICE_TRACK = { x: JOURNEY_ANCHORS.practice.x, z: JOURNEY_ANCHORS.practice.z, rx: 22, rz: 15.5, tilt: 0.12, n: 28 };
function trackLoop(t) {
  const pts = [], c = Math.cos(t.tilt), s = Math.sin(t.tilt);
  for (let i = 0; i <= t.n; i++) {
    const a = (i % t.n) / t.n * Math.PI * 2, x = Math.cos(a) * t.rx, z = Math.sin(a) * t.rz;
    pts.push([+(t.x + x * c + z * s).toFixed(2), +(t.z - x * s + z * c).toFixed(2)]);
  }
  return pts;
}

/** Footpaths (drawn on the terrain, kept clear of trees). Bridges sit where a road crosses a river (see BRIDGES). */
export const ROADS = [
  {id:'crossing',pts:ROAD_ACROSS},
  {id:'east_bank_path',pts:[[1260,-123],[1212,-7],[1170,104],[1050,237],[951,387],[804,248],[802,118],[755,-120]]},
  {id:'ridge_switchbacks',pts:[[-1060,-225],[-1090,-335],[-1175,-402],[-1140,-480],[-1265,-536],[-1195,-601],[-1234,-672],[-1325,-608],[-1438,-495],[-1510,-374]]},
  {id:'basin_south',pts:[[1975,-158],[1973,-93],[1970,-67],[1962,-24],[1935,25],[1890,72],[1847,103],[1768,136],[1674,122],[1593,93],[1537,47],[1498,-13],[1500,-55]]},
  {id:'mill_track',pts:[[1970,-67],[1949,-70],[1922,-71],[1897,-77],[1876,-77],[1846,-77],[1826,-77],[1818,-77]]},
  {id:'home_walk',pts:[[2220,56],[2220,61],[2197,57],[2196,36],[2200,33]]},
  {id:'forest_road',pts:[[2197,57],[2177,34],[2146,18],[2100,21],[2071,4],[2055,-18],[2055,-27]]},
  {id:'forest_trial',pts:[[2055,-22],[2075,-32],[2080,-65],[2100,-84],[2130,-96],[2165,-110]]},
  {id:'upper_city',pts:[[-2108,-506],[-2089,-506],[-2077,-505],[-2065,-513],[-2040,-541],[-2018,-574],[-2015,-599],[-2035,-624]]},
  {id:'grass_lesson',pts:[[-2105,-429],[-2141,-419],[-2179,-414],[-2202,-405]]},
  {id:'practice_track',pts:trackLoop(PRACTICE_TRACK)},
  ...BELL_ROADS.map((street,i)=>({id:'mage_lane_'+i,pts:street.map(toBellWorld)}))
];

/** Bridges: centre, heading (radians, 0 = spans along x) and length. */
export const BRIDGES = [];

/**
 * Anchors: exact spots reserved for an NPC or interactive object. Builders keep a 3.5 m clear circle around each;
 * story / gameplay code places things exactly here. `face` = yaw the thing should face (radians, 0 = +z/south).
 */
export const ANCHORS = {
  ...JOURNEY_ANCHORS,
  bell_save: { x:BELL.x+6,z:BELL.z+5,face:Math.PI/2 },
  // 向日神社 (hilltop, flat radius 40 around -540,40). Main hall on the north side facing south, torii + steps on the south.
  spawn:          { x: 2220, z: 50, face: Math.PI, floor: 'ground' },
  granny:         { x: -540, z: 30,  face: 0 },
  broom_chest:    { x: -560, z: 44,  face: -Math.PI / 2 },
  ema_shrine:     { x: -522, z: 60,  face: Math.PI },
  shrine_save:    { x: -532, z: 46,  face: 0 },          // 手水舍 checkpoint
  training:       { x: -600, z: -22, face: 0 },
  ring_start:     { x: -520, z: 104, face: 0 },          // 试飞环 course start (below the shrine steps)
  // 朝颜村
  village_elder:  { x: -452, z: 146, face: 0 },
  village_kid:    { x: -470, z: 162, face: 0 },
  village_farmer: { x: -430, z: 172, face: 0 },
  village_dango:  { x: -444, z: 132, face: 0 },
  village_save:   { x: -462, z: 140, face: 0 },
  sunhill_painter:{ x: -620, z: -140, face: 0 },
  // 狐火之里
  fox_elder:      { x: -70,  z: 84,  face: 0 },
  fox_mother:     { x: -84,  z: 100, face: 0 },
  fox_racer:      { x: -52,  z: 104, face: 0 },
  fox_save:       { x: -62,  z: 96,  face: 0 },
  // 千年枫 / 镜湖 / 风祠
  dusk_lantern:   { x: -30,  z: -170, face: 0 },
  lake_ferryman:  { x: 44,   z: 270,  face: 0 },
  lake_lantern:   { x: 120,  z: 400,  face: 0 },
  wind_altar:     { x: -20,  z: -540, face: 0 },
  // 万灯镇 (flat radius 70 around 205,-125). Lamp tower stands exactly at the centre.
  town_lamp:      { x: 205, z: -125, face: 0 },
  town_lampmaker: { x: 196, z: -134, face: 0 },
  town_elder:     { x: 214, z: -114, face: 0 },
  town_shop:      { x: 186, z: -110, face: 0 },
  town_cook:      { x: 226, z: -143, face: 0 },
  town_racer:     { x: 238, z: -104, face: 0 },
  town_save:      { x: 196, z: -118, face: 0 },
  // 星晶野 / 月读宫
  crystal_lantern:{ x: 545, z: -275, face: 0 },
  crystal_hermit: { x: 520, z: -250, face: 0 },
  palace_arena:   { x: 380, z: -34,  face: 0 },
  palace_lantern: { x: 380, z: -66,  face: 0 },
  palace_landing: { x: 380, z: 2,    face: Math.PI },
};

/** The four Great Lanterns (镇灯). */
export const GREAT_LANTERNS = [];

/** Twelve roadside stone lanterns (石灯笼) the player can relight. */
export const STONE_LANTERNS = [];

/** Floating islands (浮空岛): flat round tops you can land on. top = y of the walkable surface, r = walkable radius. */
export const SKY_ISLES = [];

/** Terrain levelling: ground is blended to height h inside r (full) .. r+blend (none). Applied in order. */
export const FLATTEN = [
 {x:2220,z:48,r:57,blend:29,h:19}, {x:2055,z:-34,r:18,blend:22,h:24},
 {x:2100,z:-84,r:26,blend:21,h:25}, {x:2165,z:-110,r:17,blend:20,h:20},
 {x:-2202,z:-405,r:28,blend:31,h:17}
];


// Elongated ridges along walking routes: centre, heading, longitudinal and transverse radius, crest height.
// Pairs of shoulders leave a saddle towards the landmark. Settlements, waterways and the lake still level the land.
export const ROUTE_RELIEF = [];
export const CAPE_STACKS = [];
