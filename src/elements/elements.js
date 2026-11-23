// elements — 万物相生 (DESIGN §3.2, §6.2) → G.elements
// Reactors (anything that can burn / get wet / freeze / be shocked / be lit) in a spatial hash, the reaction table behind
// the single entry point apply(), ground fire on grassland, rain, wind, ice floes, light.
//
// Modules: consts (data) · reactor (Reactor + hash) · fire (ground automaton + heat grid) · weather (breeze, wind fields,
//          rain zones) · floes (ice on water) · flames (all visuals: flames, sparks, frost shells, fire lights).
import * as THREE from 'three';
import { G } from '../core/game.js';
import { clamp } from '../core/util.js';
import { ELEMENTS, MATERIALS, STATUSES, T, FIRE, MULT } from './consts.js';
import { Reactor, bindCore, createHash, distTo } from './reactor.js';
import { createFire } from './fire.js';
import { createWeather } from './weather.js';
import { createFloes } from './floes.js';
import { createFlames } from './flames.js';
import { createFields } from './fields.js';
import { COMBOS, COMBO_IDS } from './catalog.js';

const E = {
  hash: null, fire: null, weather: null, floes: null, flames: null, fields: null,
  all: [], active: new Set(), movers: [], lights: [],
  burningCount: 0, scan: 0, heatT: 0, moverT: 0,
  lastChain: null,
};

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Vector3();
const call = (r, name, a, b, c) => {
  const fn = r.on && r.on[name];
  if (typeof fn !== 'function') return undefined;
  try { return fn(r, a, b, c); } catch (e) { G.reportError('elements:on.' + name, e); return undefined; }
};
const fx = (name, pos, opts) => { try { G.fx?.burst?.(name, pos, opts); } catch (e) { G.reportError('elements:fx', e); } };
const sfx = (name, pos, vol = 1) => { try { G.audio?.sfx?.(name, { pos, vol }); } catch (e) { /* audio is optional */ } };
const reactorTop = (r, out) => out.set(r.pos.x, r.cy, r.pos.z);
const inWater = (r) => G.world.heightAt(r.pos.x, r.pos.z) < G.world.seaLevel - 0.6 && r.y0 < G.world.seaLevel + 0.4;
const conducts = (r) => r.conductive || r.wet > 0 || r.material === 'water' || inWater(r);

function activate(r) { if (!r._active && !r.dead) { r._active = true; E.active.add(r); } }
E.activate = activate;

// ---- status primitives (Reactor methods land here) ------------------------------------------------------------
E.ignite = (r, power = 1, info) => {
  if (r.dead || r.immune.has('burning') || r.immune.has('fire')) return false;
  if (r.burning) return true;
  if (r.charred || r.flammable <= 0 || r.frozen > 0) return false;
  if (r.wet > 0) { r.wet = 0; call(r, 'dry'); fx('steam', reactorTop(r, _v)); return false; }
  r.burning = r.living ? r.burnTime * (0.6 + 0.4 * Math.min(2, power)) : Math.max(0.5, r.fuel);
  r._burnAge = 0;
  r._spread = T.SPREAD_EVERY * (0.5 + Math.random());
  activate(r);
  E.burningCount++;
  if (!r._fx && G.fx?.emitter && r.radius * r.height > 1.5) {
    try { r._fx = G.fx.emitter('smoke', { pos: reactorTop(r, new THREE.Vector3()), rate: Math.min(1.4, 0.62 + r.radius * 0.25) }); } catch (e) { r._fx = null; }
  }
  call(r, 'ignite', info);
  G.events.emit('element:ignite', { reactor: r });
  fx('ignite', reactorTop(r, _v));
  sfx('ignite', _v, 0.8);
  return true;
};
function stopBurn(r) {
  r.burning = 0;
  E.burningCount = Math.max(0, E.burningCount - 1);
  if (r._fx) { try { r._fx.stop ? r._fx.stop() : r._fx.remove?.(); } catch (e) { /* */ } r._fx = null; }
}
E.extinguish = (r, info) => {
  if (!r.burning) return false;
  if (!r.living) r.fuel = r.burning;
  stopBurn(r);
  call(r, 'extinguish', info);
  fx('extinguish', reactorTop(r, _v));
  return true;
};
function burnout(r) {
  r.fuel = 0;
  r.charred = true;
  stopBurn(r);
  call(r, 'burnout');
  G.events.emit('element:burnout', { reactor: r });
  fx('extinguish', reactorTop(r, _v));
}
E.soak = (r, sec = T.WET) => {
  if (r.dead || r.immune.has('wet') || r.immune.has('water')) return false;
  if (r.burning) E.extinguish(r, { source: 'water' });
  const was = r.wet > 0;
  r.wet = Math.max(r.wet, sec);
  activate(r);
  if (!was) call(r, 'wet');
  return true;
};
E.freeze = (r, sec = T.FREEZE) => {
  if (r.dead || !r.freezable || r.immune.has('frozen') || r.immune.has('ice')) return false;
  if (r.burning) { E.extinguish(r, { source: 'ice' }); return false; }
  const was = r.frozen > 0;
  r.frozen = Math.max(r.frozen, sec);
  activate(r);
  if (!was) { call(r, 'freeze'); fx('hit_ice', reactorTop(r, _v)); sfx('freeze', _v); }
  return true;
};
E.thaw = (r) => {
  if (!r.frozen) return false;
  r.frozen = 0;
  r.wet = Math.max(r.wet, T.THAW_WET);
  activate(r);
  call(r, 'thaw');
  return true;
};
E.shock = (r, power = 1, info) => {
  if (r.dead || r.immune.has('shocked') || r.immune.has('thunder')) return false;
  r.shocked = Math.max(r.shocked, T.SHOCK);
  activate(r);
  call(r, 'shock', power, info);
  return true;
};

// ---- spreading ------------------------------------------------------------------------------------------------
function spreadFrom(r, bonus = 1) {
  const W = G.world;
  E.weather.breezeAt(reactorTop(r, _q), _w);
  const ws = Math.hypot(_w.x, _w.z);
  const ux = ws > 0.01 ? _w.x / ws : 0, uz = ws > 0.01 ? _w.z / ws : 0;
  const lean = Math.min(2.5, ws * 0.4) * bonus;
  // the ground under (and downwind of) it
  const gy = W.heightAt(r.pos.x, r.pos.z);
  if (r.y0 - gy < 1.6) E.fire.ignite(r.pos.x + ux * lean, r.pos.z + uz * lean, Math.min(r.radius + 0.6, 3), 0.55 * bonus);
  // neighbouring flammables
  const reach = 2.4 + lean;
  E.hash.each(r.pos.x + ux * lean * 0.5, r.pos.z + uz * lean * 0.5, r.radius + reach, (o) => {
    if (o === r || o.burning || o.charred || o.flammable <= 0 || o.frozen) return;
    const gap = Math.hypot(o.pos.x - r.pos.x, o.pos.z - r.pos.z) - o.radius - r.radius;
    if (gap > reach) return;
    if (o.y0 > r.y0 + r.height + 1.5 || r.y0 > o.y0 + o.height + 1.5) return;
    const dx = o.pos.x - r.pos.x, dz = o.pos.z - r.pos.z, dl = Math.hypot(dx, dz) || 1;
    const align = (dx * ux + dz * uz) / dl;
    const p = o.flammable * 0.42 * bonus * clamp(1 + align * ws * 0.25, 0.25, 2.5) * (1 - Math.max(0, gap) / (reach + 0.01) * 0.6);
    if (Math.random() < p) E.ignite(o, 0.6, { source: 'spread', from: r });
  });
}

/** Called by the fire automaton when a ground cell catches: things standing in it may catch too. */
E.onCellIgnite = (c) => {
  E.hash.each(c.x, c.z, 1.4, (o) => {
    if (o.burning || o.charred || o.flammable <= 0 || o.frozen || o.wet) return;
    if (o.y0 - c.y > 1.2) return;
    if (Math.hypot(o.pos.x - c.x, o.pos.z - c.z) - o.radius > 1.4) return;
    if (Math.random() < o.flammable * 0.5) E.ignite(o, 0.5, { source: 'ground' });
  });
};

/** A rain zone ticks (every 0.5 s): soak and extinguish everything under it. */
E.rainSoak = (zone) => {
  let out = 0;
  E.hash.each(zone.x, zone.z, zone.r, (o) => {
    if (Math.hypot(o.pos.x - zone.x, o.pos.z - zone.z) > zone.r) return;
    if (o.burning && E.extinguish(o, { source: 'rain' })) { out++; fx('steam', reactorTop(o, _v)); }
    if (o.kind === 'lantern') return;   // roofed / glassed: rain does not drown lanterns
    E.soak(o, 4);
  });
  // floes are unaffected; ground cells die out by themselves in the automaton (isRainingAt)
  if (out) G.events.emit('element:reaction', { type: 'extinguish', pos: new THREE.Vector3(zone.x, zone.gy, zone.z), power: 1, count: out, source: 'rain' });
};

// ---- the reaction table ---------------------------------------------------------------------------------------
function hitInfo(info, element, power, extra) {
  return Object.assign({}, info, { element, power, mult: 1 }, extra);
}

/**
 * ★ apply(element, pos, radius, power=1, info) -> Reactor[]  — the single entry point (DESIGN §3.2).
 * info: { source, team, dir?, damage?, noGround?, halfAngle?, impulse?, heavy? }
 * Every affected reactor gets on.hit(r, element, power, hinfo) with hinfo = info + { element, power, mult, reaction?,
 * shatter?, purify?, split?, melt?, chain?, empower? } — mult is the damage multiplier the owner should apply.
 */
function apply(element, pos, radius = 1, power = 1, info = {}) {
  const out = [];
  if (!ELEMENTS.includes(element) || !pos) return out;
  info = info || {};
  const team = info.team || 'neutral';
  G.events.emit('element:applied', { element, pos, radius, power, team, source: info.source, info });
  const rx = new Map();      // reaction type -> { n, pos }
  const react = (type, p, extra) => {
    let e = rx.get(type);
    if (!e) rx.set(type, (e = { n: 0, pos: p.clone(), extra: null }));
    e.n++;
    if (extra) e.extra = extra;
  };
  // 元素交织: reactions on living things become combos (callout, notes, multiplier)
  const cx = new Map();      // combo id -> { n, pos, mult }
  const combo = (id, r, mult) => {
    if (!r.living && r.kind !== 'creature') return;
    let e = cx.get(id);
    if (!e) cx.set(id, (e = { n: 0, pos: new THREE.Vector3(r.pos.x, r.y0 + r.height + 2.0, r.pos.z), mult: 1 }));   // above combat's foe plate (+1.05 .. ~+1.8)
    e.n++; e.mult = Math.max(e.mult, mult || 1);
  };
  // No friendly fire: a team's own fire / ice / thunder / earth / moon / wind never touches its members (water and sun
  // still do — you can douse or light your own side). Pass info.friendlyFire = true to override.
  const spare = team !== 'neutral' && !info.friendlyFire && element !== 'water' && element !== 'sun';
  E.hash.each(pos.x, pos.z, radius, (r) => {
    if (r.immune.has(element)) return;
    if (spare && r.team === team) return;
    if (distTo(r, pos.x, pos.y, pos.z) > radius) return;
    out.push(r);
  });

  if (element === 'thunder') thunder(pos, radius, power, info, out, react, combo);
  else for (const r of out) {
    const at = reactorTop(r, _v);
    const ex = {};
    switch (element) {
      case 'fire':
        if (r.kind === 'lantern') {
          const res = r.on.ignite ? call(r, 'ignite', info) : call(r, 'light', power, info);
          if (res !== false) react('ignite', at);
        } else if (r.frozen) { E.thaw(r); react('melt', at); ex.reaction = 'melt'; ex.mult = MULT.melt; combo('melt', r, MULT.melt); fx('steam', at); }
        else if (r.material === 'ice') { react('melt', at); ex.reaction = 'melt'; ex.melt = true; fx('splash', at); }
        else if (r.wet > 0 && (r.flammable > 0 || r.living)) {
          r.wet = 0; call(r, 'dry'); react('steam', at); ex.reaction = 'steam'; fx('steam', at); sfx('steam', at);
          if (r.living) { ex.mult = MULT.steam; combo('steam', r, MULT.steam); }
        }
        else if (r.wet > 0) { r.wet = Math.max(0, r.wet - 6 * power); if (!r.wet) call(r, 'dry'); fx('steam', at); }
        else if (!r.burning && r.flammable > 0 && !r.charred && Math.random() < Math.min(1, r.flammable * (0.6 + 0.6 * power))) {
          if (E.ignite(r, power, info)) { react('ignite', at); ex.reaction = 'ignite'; }
        }
        if (r.material === 'shade') ex.mult = (ex.mult || 1) * 1.5;
        break;
      case 'water':
        if (r.burning) {
          E.extinguish(r, info); react('steam', at); ex.reaction = 'steam'; fx('steam', at); sfx('steam', at);
          if (r.living) { ex.mult = MULT.steam; combo('steam', r, MULT.steam); }
        }
        if (r.kind === 'lantern') { if (call(r, 'extinguish', info) !== false && r.on.extinguish) react('extinguish', at); break; }
        E.soak(r, T.WET * Math.max(1, Math.min(2, power)));
        fx('hit_water', at);
        break;
      case 'ice':
        if (r.burning) { E.extinguish(r, info); react('extinguish', at); ex.reaction = 'extinguish'; fx('steam', at); }
        else if (r.wet > 0 || r.material === 'water' || r.chilled > 0) {
          if (!r.frozen && E.freeze(r, T.FREEZE * clamp(power, 0.6, 1.6))) { react('freeze', at); ex.reaction = 'freeze'; combo('freeze', r); }
        } else if (power >= 2 && E.freeze(r, T.FREEZE_DRY)) { react('freeze', at); ex.reaction = 'freeze'; }
        break;
      case 'wind':
        if (r.kind === 'lantern') { if (power >= 0.8 && r.on.extinguish && call(r, 'extinguish', info) !== false) react('extinguish', at); break; }
        if (r.burning) {
          if (r.radius * r.height < 1.2 && Math.random() < 0.6 * power) { E.extinguish(r, info); react('extinguish', at); }
          else { spreadFrom(r, 1 + power); react('fan', at); ex.reaction = 'fan'; combo('fan', r); }
        }
        break;
      case 'earth':
        if (r.frozen || r.material === 'ice') {
          if (r.frozen) { r.frozen = 0; r.wet = Math.max(r.wet, 2); }
          ex.mult = MULT.shatter; ex.shatter = true; ex.reaction = 'shatter';
          react('shatter', at);
          combo('shatter', r, MULT.shatter);
          call(r, 'shatter', info);
          fx('shatter_ice', at); sfx('shatter_ice', at);
        } else if (r.wet > 0 && r.living) {
          // wet things hit by earth are caked in mud: slowed
          const was = r.muddy > 0;
          r.muddy = Math.max(r.muddy, T.MUDDY); activate(r);
          ex.reaction = 'mire';
          if (!was) { react('mire', at); combo('mire', r); }
        }
        break;
      case 'sun':
        if (r.material === 'shade') { ex.mult = 2; ex.purify = true; ex.reaction = 'purify'; react('purify', at); fx('purify', at); }
        if (r.kind === 'lantern') { if (call(r, 'light', power, info) !== false) react('light', at); }
        else if (r.material === 'crystal') { call(r, 'light', power, info); react('resonate', at); ex.reaction = 'resonate'; }
        else call(r, 'light', power, info);
        if (r.frozen) { r.frozen = Math.max(0.01, r.frozen - 3 * power); if (r.frozen <= 0.01) { E.thaw(r); react('thaw', at); } }
        r.lit = Math.max(r.lit, T.LIT); activate(r);
        break;
      case 'moon':
        if (r.material === 'shade') ex.empower = true;
        break;
    }
    if (info.heavy && r.frozen && element !== 'earth') {
      r.frozen = 0; ex.mult = MULT.shatter; ex.shatter = true; react('shatter', at); combo('shatter', r, MULT.shatter); call(r, 'shatter', info); fx('shatter_ice', at);
    }
    call(r, 'hit', element, power, hitInfo(info, element, power, ex));
  }

  // ---- the ground under it --------------------------------------------------------------------------------------
  if (!info.noGround) ground(element, pos, radius, power, info, react);

  for (const [type, e] of rx) {
    G.events.emit('element:reaction', { type, pos: e.pos, power, count: e.n, element, team, fusion: !!(info.fusion || info.field), ...(e.extra || {}) });
  }
  for (const [id, e] of cx) combo_(id, e.pos, { team, count: e.n, mult: e.mult });
  return out;
}

function ground(element, pos, radius, power, info, react) {
  const W = G.world;
  const gy = W.heightAt(pos.x, pos.z);
  const nearGround = pos.y - gy < radius + 1.5;
  const water = W.heightAt(pos.x, pos.z) < W.seaLevel - 0.3 && Math.abs(pos.y - W.seaLevel) < radius + 2;
  switch (element) {
    case 'fire': {
      if (E.floes.meltNear(pos.x, pos.z, radius, 6 * power)) react('melt', pos);
      if (nearGround && !water) {
        const n = E.fire.ignite(pos.x, pos.z, Math.min(radius, 9), power);
        if (n) react('ignite', pos);
      }
      break;
    }
    case 'water': {
      const n = E.fire.extinguish(pos.x, pos.z, radius + 0.5);
      if (nearGround || water) E.fire.wet(pos.x, pos.z, radius);
      if (n) { react('extinguish', pos); fx('steam', pos); sfx('steam', pos); }
      if (nearGround && !water) G.events.emit('terrain:scorch', { x: pos.x, z: pos.z, r: radius, kind: 'wet' });
      break;
    }
    case 'ice': {
      const n = E.fire.extinguish(pos.x, pos.z, radius);
      if (n) react('extinguish', pos);
      if (water) { const f = E.floes.freeze(pos.x, pos.z, clamp(radius, 2.5, 8), 30); if (f) react('floe', pos); }
      else if (nearGround) G.events.emit('terrain:scorch', { x: pos.x, z: pos.z, r: radius, kind: 'frost' });
      break;
    }
    case 'wind': {
      if (!nearGround) break;
      let dx = 0, dz = 0;
      if (info.dir) { dx = info.dir.x; dz = info.dir.z; } else { E.weather.breezeAt(pos, _w); dx = _w.x; dz = _w.z; }
      const r = E.fire.fan(pos.x, pos.z, radius, dx, dz, power);
      if (r.fanned) react('fan', pos);
      if (r.out) react('extinguish', pos);
      break;
    }
    case 'thunder':
      if (nearGround && !water && power >= 1 && Math.random() < 0.6) { if (E.fire.ignite(pos.x, pos.z, 1.2, 0.5)) react('ignite', pos); }
      break;
  }
  // 元素交织: puddles, mud, ice sheets, steam, lava … (fields.js)
  if (nearGround) { try { E.fields.onApply(element, pos, radius, power, info); } catch (e) { G.reportError('elements:fields', e); } }
  // physics side of wind
  if (element === 'wind' && G.physics) {
    try {
      if (info.dir) G.physics.pushCone(pos, info.dir, radius, info.halfAngle ?? 0.6, (info.impulse ?? 7) * power);
      else G.physics.explode(pos, radius, (info.impulse ?? 6) * power, { up: 0.5 });
    } catch (e) { G.reportError('elements:wind', e); }
  }
}

function thunder(pos, radius, power, info, hits, react, combo) {
  const W = G.world;
  const hitSet = new Set(hits);
  const links = [];
  const chained = [];
  const seeds = [];
  const water = !info.noGround && W.heightAt(pos.x, pos.z) < W.seaLevel - 0.3 && pos.y < W.seaLevel + radius + 3;
  const strike = new THREE.Vector3().copy(pos);
  const over = [];
  for (const r of hits) {
    const at = reactorTop(r, _v);
    const ex = {};
    const burning = r.burning > 0 && r.living;
    if (conducts(r)) {
      seeds.push(r); E.shock(r, power, info); ex.reaction = 'conduct';
      if (r.wet > 0 || inWater(r)) { ex.mult = MULT.conduct; combo('conduct', r, MULT.conduct); }
    }
    else if (r.material === 'wood' && !r.wet) {
      E.shock(r, power, info);
      if (r.kind === 'tree' || r.kind === 'structure' || power >= 1) { ex.split = true; ex.reaction = 'split'; react('split', at); }
      if (E.ignite(r, power, info)) react('ignite', at);
    } else if (r.material === 'stone' || r.material === 'crystal') {
      ex.shatter = true; ex.reaction = 'shatter'; react('shatter', at); fx('shatter_rock', at);
      call(r, 'shatter', info);
    } else E.shock(r, power, info);
    if (r.frozen && r.material !== 'stone') { r.frozen = 0; ex.mult = MULT.shatter; ex.shatter = true; react('shatter', at); combo('shatter', r, MULT.shatter); call(r, 'shatter', info); }
    else if (burning) { ex.mult = Math.max(ex.mult || 1, MULT.overload); ex.reaction = 'overload'; combo('overload', r, MULT.overload); over.push(r); }
    call(r, 'hit', 'thunder', power, hitInfo(info, 'thunder', power, ex));
  }
  // 爆燃: lightning through something burning bursts it — the flames leap to whatever stands near
  for (const r of over) overload(r, power, info);
  // a strike on open water runs through everything standing in it nearby
  if (water) {
    E.hash.each(pos.x, pos.z, T.CHAIN_RANGE + 2, (o) => {
      if (hitSet.has(o) || o.immune.has('thunder') || !inWater(o)) return;
      if (Math.hypot(o.pos.x - pos.x, o.pos.z - pos.z) - o.radius > T.CHAIN_RANGE) return;
      hitSet.add(o); seeds.push(o); chained.push(o);
      links.push([strike.clone(), reactorTop(o, new THREE.Vector3())]);
      E.shock(o, power * 0.8, info);
      if (o.living) combo('conduct', o, MULT.conduct);
      call(o, 'hit', 'thunder', power * 0.8, hitInfo(info, 'thunder', power * 0.8, { reaction: 'conduct', chain: 1, mult: MULT.conduct }));
    });
  }
  // conduction: hop between conductors within CHAIN_RANGE
  const queue = seeds.map((r) => [r, 0]);
  let qi = 0;
  while (qi < queue.length && chained.length < T.CHAIN_MAX) {
    const [a, depth] = queue[qi++];
    E.hash.each(a.pos.x, a.pos.z, T.CHAIN_RANGE, (b) => {
      if (hitSet.has(b) || b.immune.has('thunder') || !conducts(b) || chained.length >= T.CHAIN_MAX) return;
      const d = Math.hypot(b.pos.x - a.pos.x, b.cy - a.cy, b.pos.z - a.pos.z) - a.radius - b.radius;
      if (d > T.CHAIN_RANGE) return;
      hitSet.add(b); chained.push(b);
      queue.push([b, depth + 1]);
      links.push([reactorTop(a, new THREE.Vector3()), reactorTop(b, new THREE.Vector3())]);
      const p = power * Math.max(0.4, 0.85 - depth * 0.08);
      const soaked = b.wet > 0 || inWater(b);
      E.shock(b, p, info);
      if (soaked) combo('conduct', b, MULT.conduct);
      call(b, 'hit', 'thunder', p, hitInfo(info, 'thunder', p, { reaction: 'conduct', chain: depth + 1, mult: soaked ? MULT.conduct : 1 }));
    });
  }
  for (const r of chained) hits.push(r);
  for (const [a, b] of links) {
    try { G.fx?.lightning?.(a, b, { color: 0xaee4ff, branches: 1, dur: 0.35 }); } catch (e) { G.reportError('elements:lightning', e); }
  }
  if (links.length) {
    react('conduct', pos, { links: links.map(([a, b]) => [a.x, a.y, a.z, b.x, b.y, b.z]), chain: chained.length });
    sfx('thunder_chain', pos);
  }
  E.lastChain = { links, reactors: chained, t: G.time.t };
}

// ---- 元素交织: combos, blasts, discovery ----------------------------------------------------------------------------
/** A burning thing struck by lightning bursts: fire leaps to the hostile things around it, a small blast pushes. */
function overload(r, power, info) {
  const at = reactorTop(r, new THREE.Vector3());
  const team = info.team || 'neutral';
  E.hash.each(r.pos.x, r.pos.z, 4, (o) => {
    if (o === r || o.dead || o.burning || !o.living || (team !== 'neutral' && o.team === team)) return;
    if (Math.hypot(o.pos.x - r.pos.x, o.pos.z - r.pos.z) - o.radius > 3.6) return;
    if (o.wet > 0) { o.wet = 0; call(o, 'dry'); fx('steam', reactorTop(o, _v)); return; }
    E.ignite(o, 0.9, { source: info.source, team, overload: true });
  });
  fx('explosion', at, { color: 'fire', scale: 0.55, power: 0.8 });
  try { G.fx?.lightning?.(at, _w.set(at.x + (Math.random() - 0.5) * 3, at.y + 1.5, at.z + (Math.random() - 0.5) * 3), { color: 0xffb070, impact: false, branches: 2, dur: 0.25, width: 0.12 }); } catch (e) { /* visual */ }
  try { G.physics?.explode?.(at, 3.6, 5 * power, { up: 0.5 }); } catch (e) { G.reportError('elements:overload', e); }
  sfx('explosion_small', at, 0.7);
}

/** on.hit for one reactor with a damage info (fields and fusions use it): hinfo = info + { element, power, mult, ... }. */
E.hitReactor = (r, element, power, info, extra) => call(r, 'hit', element, power, hitInfo(info || {}, element, power, extra || {}));

/**
 * A raw blast (steam explosion, tidal splash, …): every hostile living reactor within R gets on.hit with o.element and
 * o.damage × o.mult, physics are pushed. o: { element, team, source, damage, mult, reaction, impulse, soak, up }. -> count
 */
E.blast = (pos, R, o = {}) => {
  const team = o.team || 'neutral';
  let n = 0;
  E.hash.each(pos.x, pos.z, R, (r) => {
    if (r.dead || !(r.living || r.kind === 'creature') || (team !== 'neutral' && r.team === team)) return;
    if (distTo(r, pos.x, pos.y, pos.z) > R) return;
    if (o.soak) E.soak(r, 3);
    n++;
    call(r, 'hit', o.element || 'fire', o.power ?? 1, hitInfo({ source: o.source || null, team, damage: o.damage ?? 20, fusion: true }, o.element || 'fire', o.power ?? 1,
      { mult: o.mult ?? 1, reaction: o.reaction || null }));
  });
  if (o.impulse) { try { G.physics?.explode?.(pos, R + 1, o.impulse, { up: o.up ?? 0.6 }); } catch (e) { G.reportError('elements:blast', e); } }
  return n;
};

/** Emit 'element:combo' and note it in the heroine's 元素笔记 (G.state.elementNotes) when she caused it. */
function combo_(id, pos, o = {}) {
  const c = COMBOS[id];
  if (!c || !pos) return;
  const team = o.team || 'neutral';
  const p = pos.isVector3 ? pos : new THREE.Vector3(pos.x, pos.y, pos.z);
  G.events.emit('element:combo', { id, kind: c.kind, els: c.els, pos: p, team, mult: o.mult ?? c.mult ?? 1, count: o.count || 1, big: !!(o.big ?? c.big), quiet: !!o.quiet });
  if (team === 'player') discover(id, p);
}
E.combo = combo_;
function discover(id, pos) {
  const st = G.state;
  if (!st || !COMBOS[id]) return;
  const notes = st.elementNotes && typeof st.elementNotes === 'object' ? st.elementNotes : (st.elementNotes = {});
  const first = !notes[id];
  notes[id] = Math.min(99999, (notes[id] | 0) + 1);
  if (first) G.events.emit('element:discovered', { id, pos, total: COMBO_IDS.filter((k) => notes[k]).length, of: COMBO_IDS.length });
}

/** Active statuses of a reactor, strongest first: [{ id, t }] (t = seconds left). For HUD pips and foe bars. */
const STATUS_SHOWN = ['frozen', 'burning', 'shocked', 'wet', 'muddy', 'chilled'];
function statusesOf(r, out = []) {
  // entries are reused from out's own pool, so a caller passing the same array every frame allocates nothing
  const pool = out._pool || (out._pool = []);
  let n = 0;
  if (r && !r.dead) for (let i = 0; i < STATUS_SHOWN.length; i++) {
    const k = STATUS_SHOWN[i];
    if (!(r[k] > 0)) continue;
    const o = pool[n] || (pool[n] = { id: '', t: 0 });
    o.id = k; o.t = r[k]; out[n++] = o;
  }
  out.length = n;
  return out;
}

/** Creatures in mud / on frost walk slower. Owners that apply reactor.speedMul themselves set owner.handlesSlow = true
 *  (or G.elements.ownerHandlesSlow = true for everyone); for the rest their horizontal step is scaled here, after they moved. */
function slowMovers() {
  if (G.elements?.ownerHandlesSlow) return;
  const P = G.player;
  for (let i = 0; i < E.movers.length; i++) {
    const r = E.movers[i];
    if (r.kind !== 'creature') continue;
    const o = r.owner, p = o && o.pos;
    if (!p || !p.isVector3 || o === P) continue;
    const last = r._lastPos || (r._lastPos = new THREE.Vector3().copy(p));
    if ((r.muddy > 0 || r.chilled > 0) && !r.frozen && !o.handlesSlow && !o.held) {
      const k = r.speedMul, dx = p.x - last.x, dz = p.z - last.z;
      if (k < 1 && dx * dx + dz * dz < 9) { p.x = last.x + dx * k; p.z = last.z + dz * k; }
    }
    last.copy(p);
  }
}

// ---- light ------------------------------------------------------------------------------------------------------
function lightAt(pos) {
  if (!pos) return 0;
  let L = G.world.daylightAt(pos.x, pos.z);
  for (let i = 0; i < E.lights.length; i++) {
    const l = E.lights[i];
    const d = l.pos.distanceTo(pos);
    if (d >= l.radius) continue;
    let k = 1 - d / l.radius;
    k = k * k * (3 - 2 * k) * (l.intensity ?? 1) * (l._fade ?? 1);
    L = 1 - (1 - L) * (1 - Math.min(1, k));
  }
  // fire nearby (coarse heat grid: burning ground and burning things)
  const H = 6;
  const cx = Math.floor(pos.x / H), cz = Math.floor(pos.z / H);
  let heat = 0;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const h = E.fire.heatAt((cx + dx + 0.5) * H, (cz + dz + 0.5) * H);
    if (h) heat += h * (dx || dz ? 0.35 : 1);
  }
  if (heat > 0) L = 1 - (1 - L) * (1 - Math.min(0.85, heat * 0.22));
  return clamp(L, 0, 1);
}

function addLight(o = {}) {
  const l = {
    pos: o.pos && o.pos.isVector3 ? o.pos : new THREE.Vector3().copy(o.pos || _v.set(0, 0, 0)),
    radius: o.radius ?? 10, intensity: o.intensity ?? 1, duration: o.duration ?? Infinity, t: 0, dead: false, _fade: 1,
  };
  l.remove = () => { l.dead = true; const i = E.lights.indexOf(l); if (i >= 0) E.lights.splice(i, 1); };
  E.lights.push(l);
  return l;
}

// ---- registry ---------------------------------------------------------------------------------------------------
function register(o = {}) {
  const r = new Reactor(o);
  E.hash.add(r);
  r._idx = E.all.length; E.all.push(r);
  if (r.getPos) E.movers.push(r);
  return r;
}
function unregister(r) {
  if (!r || r.dead) return;
  if (r.burning) stopBurn(r);
  r.dead = true;
  E.hash.remove(r);
  E.active.delete(r); r._active = false;
  const i = r._idx, last = E.all.pop();
  if (last !== r && i !== undefined && i < E.all.length) { E.all[i] = last; last._idx = i; }
  const m = E.movers.indexOf(r);
  if (m >= 0) E.movers.splice(m, 1);
}

function query(pos, rad, cb) {
  E.hash.each(pos.x, pos.z, rad, (r) => { if (distTo(r, pos.x, pos.y, pos.z) <= rad) cb(r); });
}
function nearest(pos, rad, filter) {
  let best = null, bd = Infinity;
  E.hash.each(pos.x, pos.z, rad, (r) => {
    const d = distTo(r, pos.x, pos.y, pos.z);
    if (d <= rad && d < bd && (!filter || filter(r))) { bd = d; best = r; }
  });
  return best;
}

// ---- per-frame --------------------------------------------------------------------------------------------------
function updateReactors(dt) {
  // moving reactors: follow their owner
  for (let i = 0; i < E.movers.length; i++) {
    const r = E.movers[i];
    let p = null;
    try { p = r.getPos(); } catch (e) { G.reportError('elements:getPos', e); }
    if (p) { r.pos.copy(p); E.hash.update(r); }
  }
  // fixed ones whose pos vector is live: re-check a slice each frame
  const all = E.all;
  for (let k = 0, n = Math.min(all.length, 256); k < n; k++) {
    if (E.scan >= all.length) E.scan = 0;
    const r = all[E.scan++];
    if (r._src) { r.pos.copy(r._src); E.hash.update(r); }
  }
  // creatures standing in burning grass
  E.moverT -= dt;
  if (E.moverT <= 0) {
    E.moverT = 0.5;
    if (E.fire.count) for (const r of E.movers) {
      if (r.burning || r.flammable <= 0 || r.wet || r.frozen) continue;
      if (!E.fire.isBurningAt(r.pos.x, r.pos.z)) continue;
      if (r.y0 - G.world.heightAt(r.pos.x, r.pos.z) > 1) continue;
      if (Math.random() < r.flammable * 0.6) E.ignite(r, 0.5, { source: 'ground' });
    }
  }
  if (dt <= 0) return;
  const W = G.world;
  for (const r of E.active) {
    if (r.dead) { E.active.delete(r); r._active = false; continue; }
    if (r.burning) {
      r._burnAge += dt;
      if (r.wet > 0 || E.weather.isRainingAt(r.pos.x, r.pos.z) || (inWater(r) && r.y0 + r.height * 0.5 < W.seaLevel)) {
        E.extinguish(r, { source: 'water' });
        fx('steam', reactorTop(r, _v));
      } else {
        call(r, 'burnTick', dt);
        r.burning -= dt;
        if (!r.living) r.fuel = r.burning;
        if (r._fx && r._fx.pos) { reactorTop(r, r._fx.pos); r._fx.pos.y += r.height * 0.3; }
        if (r.burning <= 0) {
          if (r.living) { stopBurn(r); call(r, 'extinguish', { natural: true }); }
          else burnout(r);
        } else if ((r._spread -= dt) <= 0) {
          r._spread = T.SPREAD_EVERY;
          spreadFrom(r);
        }
      }
    }
    if (r.wet > 0) {
      if (E.weather.isRainingAt(r.pos.x, r.pos.z)) r.wet = Math.max(r.wet, 3);
      else if ((r.wet -= dt) <= 0) { r.wet = 0; call(r, 'dry'); }
    }
    if (r.frozen > 0) {
      const hot = r.burning || E.fire.heatAt(r.pos.x, r.pos.z) > 0;
      r.frozen -= dt * (hot ? 3 : 1);
      if (r.frozen <= 0) { r.frozen = 0.001; E.thaw(r); }
    }
    if (r.shocked > 0 && (r.shocked -= dt) <= 0) r.shocked = 0;
    if (r.lit > 0 && (r.lit -= dt) <= 0) r.lit = 0;
    if (r.muddy > 0 && (r.muddy -= dt) <= 0) r.muddy = 0;
    if (r.chilled > 0) { if (r.burning) r.chilled = 0; else if ((r.chilled -= dt) <= 0) r.chilled = 0; }
    if (!r.burning && !r.wet && !r.frozen && !r.shocked && !r.lit && !r.muddy && !r.chilled) { E.active.delete(r); r._active = false; }
  }
}

function rebuildHeat() {
  E.fire.rebuildHeat();
  for (const r of E.active) {
    if (!r.burning || r.dead) continue;
    E.fire.addHeat(r.pos.x, r.y0 + r.height * 0.4, r.pos.z, Math.min(5, 0.6 + r.radius * r.height * 0.35));
  }
}

function updateLights(dt) {
  for (let i = E.lights.length - 1; i >= 0; i--) {
    const l = E.lights[i];
    l.t += dt;
    if (l.duration !== Infinity) {
      const left = l.duration - l.t;
      l._fade = Math.min(1, left / 1.2);
      if (left <= 0) { l.dead = true; E.lights.splice(i, 1); }
    }
  }
}

// ---- system -----------------------------------------------------------------------------------------------------
function clearAll() {
  for (const r of E.active) { if (r.burning) stopBurn(r); r.burning = r.wet = r.frozen = r.shocked = r.lit = r.muddy = r.chilled = 0; r._active = false; }
  E.active.clear();
  E.burningCount = 0;
  E.fire.clear(); E.weather.clear(); E.floes.clear(); E.flames.clear(); E.fields?.clear();
}

export const elementsSystem = {
  name: 'elements',
  pausable: true,
  async init(G) {
    bindCore(E);
    E.hash = createHash(8);
    E.fire = createFire(E);
    E.weather = createWeather(E);
    E.floes = createFloes(E);
    E.flames = createFlames(E);
    E.addLight = addLight;
    E.fields = createFields(E);
    G.elements = {
      ELEMENTS, MATERIALS, STATUSES, FIRE, Reactor,
      register, unregister, apply,
      igniteGround: (x, z, r = 1, power = 1) => E.fire.ignite(x, z, r, power),
      extinguishGround: (x, z, r = 1) => E.fire.extinguish(x, z, r),
      isBurningAt: (x, z) => E.fire.isBurningAt(x, z),
      /** Can grass burn at (x, z) at all (grassland, not warded / road / water / rock)? */
      canBurnAt: (x, z) => E.fire.eligible(x, z),
      wetGround: (x, z, r, sec) => E.fire.wet(x, z, r, sec),
      get fireCount() { return E.fire.count; },
      get burningCount() { return E.burningCount; },
      rain: (x, z, r = 18, duration = 20) => E.weather.rain(x, z, r, duration),
      isSpellRainAt: (x,z) => E.weather.isSpellRainAt(x,z),
      isRainingAt: (x, z) => E.weather.isRainingAt(x, z),
      addWind: (o) => E.weather.addWind(o),
      windAt: (pos, out = new THREE.Vector3()) => E.weather.windAt(pos, out),
      get breeze() { return E.weather.breeze; },
      freezeWater: (x, z, r = 4, duration = 30) => E.floes.freeze(x, z, r, duration),
      get floes() { return E.floes.floes; },
      lightAt, addLight,
      /** Fire look (flames.js, docs/api/elements.md "Fire look"): lick(pos, o) · burst(pos, normal, r, big) · whirl(o) -> handle · patch(o) -> handle */
      flames: {
        lick: (pos, o) => E.flames.lick(pos, o),
        burst: (pos, normal, r, big) => E.flames.burst(pos, normal, r, big),
        whirl: (o) => E.flames.whirl(o),
        patch: (o) => E.flames.patch(o),
      },
      query, nearest,
      /** The last thunder chain: { links:[[Vector3, Vector3]], reactors, t }. */
      get lastChain() { return E.lastChain; },
      get reactors() { return E.all; },
      // ---- 元素交织 (docs/api/elements.md "Element weaving") ----
      COMBOS,
      /** Reactors that currently carry a status (burning / wet / frozen / shocked / lit / muddy / chilled). Read-only Set. */
      get active() { return E.active; },
      statusesOf,
      /** ★ The ground field at pos (pos.y optional) or null: { kind, x, z, y, r, t, life, power, team }. kind filters. */
      fieldAt: (pos, kind) => E.fields.at(pos, kind),
      /** cb(field) for every field touching the disc (pos, r). */
      fieldsNear: (pos, r, cb) => E.fields.each(pos, r, cb),
      get fields() { return E.fields.list; },
      /** Lay a field directly: kind puddle | charged | icesheet | steam | mud | frost | lava. o: { life, power, team, source } */
      addField: (kind, x, z, r, o) => E.fields.add(kind, x, z, r, o),
      /** Let an element touch the ground at pos without the rest of apply() (e.g. a rising rock pillar). */
      touchGround: (element, pos, radius = 2, power = 1, info = {}) => { try { return E.fields.onApply(element, pos, radius, power, info || {}); } catch (e) { G.reportError('elements:touchGround', e); return 0; } },
      /** ★ Is pos hidden inside a steam cloud? (foes should lose sight of a heroine standing in one) */
      concealedAt: (pos) => !!pos && E.fields.concealedAt(pos),
      /** Emit a combo by id (COMBOS) at pos: callout + notes. o: { team, mult, count, big, quiet } */
      combo: (id, pos, o) => combo_(id, pos, o),
      blast: (pos, R, o) => E.blast(pos, R, o),
      /** Give a reactor a timed status: 'muddy' | 'chilled' | 'wet' | 'shocked' (seconds; keeps the longer). */
      addStatus(r, status, sec) {
        if (!r || r.dead || !(sec > 0)) return false;
        if (status === 'wet') return E.soak(r, sec);
        if (status !== 'muddy' && status !== 'chilled' && status !== 'shocked') return false;
        if (status === 'chilled' && r.burning) return false;
        r[status] = Math.max(r[status] || 0, sec); activate(r);
        return true;
      },
      /** Set true when every owner applies reactor.speedMul itself (turns off the generic slow in lateUpdate). */
      ownerHandlesSlow: false,
      clear: clearAll,
      stats: () => ({ reactors: E.all.length, active: E.active.size, burning: E.burningCount, cells: E.fire.count, flames: E.flames.count,
        rain: E.weather.zones.length, wind: E.weather.fields.length, floes: E.floes.floes.length, lights: E.lights.length, fields: E.fields.list.length }),
    };
    G.events.on('terrain:deformed', (d) => {
      try {
        E.fire.invalidate(d.x0 ?? d.x - d.r, d.x1 ?? d.x + d.r, d.z0 ?? d.z - d.r, d.z1 ?? d.z + d.r);
        if (d.amount < 0) E.fire.extinguish(d.x, d.z, d.r);
      } catch (e) { G.reportError('elements:deformed', e); }
    });
  },
  start() { clearAll(); },
  update(dt, rdt) {
    try {
      E.weather.update(dt);
      E.fire.update(dt);
      updateReactors(dt);
      updateLights(dt);
      E.floes.update(dt);
      E.fields.update(dt);
      if (dt > 0 && (E.heatT -= dt) <= 0) { E.heatT = 0.2; rebuildHeat(); }
    } catch (e) { G.reportError('elements:update', e); }
  },
  lateUpdate(dt, rdt) {
    try { E.flames.update(dt, rdt); } catch (e) { G.reportError('elements:flames', e); }
    if (dt > 0) { try { slowMovers(); } catch (e) { G.reportError('elements:slow', e); } }
  },
};
