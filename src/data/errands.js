// Roadside errands (errands round, 2026-11-23): small side stories given by travellers met at landmarks along the
// route. Ids, places, looks and rewards only — every word lives in src/locales/zh-CN/gameplay.errands.js.
// Read by src/gameplay/errands*.js. Placement records are the same as src/data/wilds.js: { lm, x, z, y } local to the
// landmark's built site (rotation included), y mode ['h', dy] etc. (resolveAt in src/gameplay/wilds.js).
// None of these places is a story anchor; a giver steps aside while the current main-quest step needs a spot within
// ERRAND_CLEAR of them (checked at runtime), and nothing runs outside G.mode 'play'.

/** A traveller stays out of the way of the main story within this many metres of the current step's target. */
export const ERRAND_CLEAR = 220;
/** Spawn / despawn distances of the travellers (m). */
export const NPC_NEAR = 140, NPC_FAR = 165;
/** The HUD tracker shows an accepted errand within this distance of its next target (always once both episodes end). */
export const TRACK_NEAR = 700;

/**
 * Traveller looks: a journey-cast body recoloured per cel slot (slot names of the merged cel material, regex source →
 * colour multiplier). pose: 'idle' | 'sit' | 'paint'. face: yaw when nobody is near (radians, 0 = +z).
 */
export const ERRAND_NPCS = {
  marta: { asset: 'char_innkeeper', at: { lm: 'farm_north', x: 3.5, z: 6.2, y: ['h', 0] }, face: 0.3,
    tint: [['skirt|sash', 0x8fa6c8], ['blouse|collar', 0xf2ece0], ['Hair', 0xd8c0a0]] },
  greta: { asset: 'char_elaina_mother', at: { lm: 'farm_west', x: 3.5, z: 6.2, y: ['h', 0] }, face: 1.4,
    tint: [['skirt|sash', 0xb48a6a], ['blouse|collar', 0xe8e0cc], ['Hair', 0xa89888]] },
  otto: { asset: 'char_elaina_father', at: { lm: 'swing_oak', x: 3.6, z: 4.2, y: ['h', 0] }, face: 2.6, pose: 'paint',
    tint: [['coat', 0x8b98a8], ['blouse|collar', 0xe6dcc6], ['skirt', 0x7c6a58]] },
  hanna: { asset: 'char_innkeeper', at: { lm: 'shepherd_hut', x: -0.6, z: 4.6, y: ['h', 0] }, face: 0.2,
    tint: [['skirt|sash', 0x9a8466], ['blouse|collar', 0xd8d0be], ['Hair', 0x8a8078], ['leather', 0x7a6a5a]] },
  tomas: { asset: 'char_elaina_father', face: 0, pose: 'idle',   // no `at`: he waits on the ford's near bank (FORD)
    tint: [['coat', 0x9c7a56], ['blouse|collar', 0xd6cfba], ['skirt', 0x5e5a50], ['Hair', 0x9a8a7a]] },
  ilse: { asset: 'char_exam_witch', at: { lm: 'shrine_cityroad', x: 2.2, z: 1.4, y: ['h', 0] }, face: 3.6, pose: 'sit',
    tint: [['coat|hat$|hatUnder|hatEdge|skirt|lining', 0x8f86a8], ['Hair', 0xe8e4f0], ['hatRibbon|accent', 0xc8b4e0]] },
};

/**
 * The errands. giver: ERRAND_NPCS id. needs: spells she must know before she can say yes (else the traveller only
 * tells the trouble). flag: story flag before the traveller is out (er_stars: she has to be Fran's pupil already). steps: ids in order; the objective of each lives in gameplay.errands.<id>.steps.<step>.
 * reward: { dust, items: { id: n } } paid when the last step is done; keep: a keepsake noted in the journal.
 */
export const ERRANDS = [
  { id: 'er_letter', giver: 'marta', region: 'moor', steps: ['deliver', 'reply'], reward: { dust: 90, items: { dango: 2 } }, keep: 'recipe' },
  { id: 'er_hat', giver: 'otto', region: 'moor', steps: ['chase', 'return'], reward: { dust: 70, items: { dango: 1 } }, keep: 'sketch' },
  { id: 'er_stove', giver: 'hanna', region: 'crags', needs: ['fire'], steps: ['light', 'warm'], reward: { dust: 60, items: { dango: 3 } } },
  { id: 'er_ford', giver: 'tomas', region: 'heart', needs: ['ice'], steps: ['freeze', 'across'], reward: { dust: 70, items: { pumpkin: 1, apple: 3 } } },
  { id: 'er_stars', giver: 'ilse', region: 'west', flag: 'majo_named', steps: ['stars', 'tell'], need: 6, reward: { dust: 80, items: { sun_tea: 1 } }, keep: 'jar' },
];
export const ERRAND_BY_ID = Object.fromEntries(ERRANDS.map((e) => [e.id, e]));

/** The letter goes to Greta (farm_west); her reply comes back to Marta (farm_north). */
export const LETTER = { to: 'greta' };

/**
 * The lost hat: torn off the painter's head, it rides the wind across the moor (waypoints from the oak toward the
 * dead trees, heights above the ground) and, if nobody catches it, settles in the tallest snag (landing). A gust of
 * wind magic that passes near it catches it and carries it back toward the caster for a moment.
 */
export const HAT = {
  landing: { lm: 'moor_snags', x: 0.6, z: 0.3, y: ['h0', 7.4] },
  path: [[930, -86, 14], [985, -150, 28], [1040, -140, 34], [1085, -215, 26], [1150, -250, 30], [1190, -300, 16]],
  speed: 7.2, dodge: 11, catchR: 2.6, catchBroom: 3.3, gustR: 3.2, gustReach: 48, gustT: 1.6, gustSpeed: 10, maxT: 80,
};

/**
 * The broken-bridge ford: a point on the brook (world x, z) a little downstream of the fallen arch. The crossing line
 * runs square to the brook; its water edges are found from the terrain at runtime. The cart waits on the near bank.
 */
export const FORD = { x: 513, z: 358, river: 'eastbrook', iceT: 45 };

/** The shepherd's stove, beside the hut door (placement record). */
export const STOVE = { lm: 'shepherd_hut', x: -2.4, z: 3.7, y: ['h', 0] };
