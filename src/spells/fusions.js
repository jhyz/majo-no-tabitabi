// 合咏 — fusions: an element meeting one of the heroine's own lingering spells becomes something new.
//   龙卷 tornado  + fire 炎旋 · + thunder 雷旋 · + ice 冰旋 · + water 水龙卷   (cast into it, or shoot a spell through it)
//   祈雨 rain     + thunder 雷暴雨 · + ice 冰雹 · + fire 暖雾 · + wind 骤雨 (the cloud drifts on the gust)
//   岩起 pillar   + thunder 引雷石柱 (it holds the charge and arcs to foes nearby, then crumbles)
//   冰镜 ice dais + fire 蒸爆 (a steam explosion)          陨星 meteor into a lake: 巨浪 (a tidal splash)
//   旋风 gust through her own flying fireballs: 风火 (they swell and speed up)
// Only casts of the same team fuse; effects a fusion makes itself carry info.fusion and never fuse again.
// Every fusion emits G.elements.combo(id, pos) (callout + 元素笔记) and dresses itself in existing G.fx / G.audio calls.
import * as THREE from 'three';
import { G } from '../core/game.js';
import { clamp, TAU } from '../core/util.js';
import { COLORS } from './book.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3();
const rnd = (a, b) => a + Math.random() * (b - a);
const WHIRL = { fire: 'firewhirl', thunder: 'thunderwhirl', ice: 'frostwhirl', water: 'waterspout' };
const RAIN = { thunder: 'thunderstorm', ice: 'hailstorm', fire: 'warmfog', wind: 'squall' };
/** tornado colours per fused element: [body, body rim, streaks, streak rim, dust, dust rim] (sRGB hex) */
const WHIRL_LOOK = {
  fire: [0x2e211c, 0x6e4c3c, 0xff8a3a, 0xffc890, 0x5a3424, 0xff9a50],   // a smoky air funnel: the flames are cards (whirl)
  thunder: [0x3e3278, 0xd8c8ff, 0xb98cff, 0xffffff, 0x4a4060, 0xb9a0ff],
  ice: [0x78b4d8, 0xffffff, 0xd2f2ff, 0xffffff, 0xa8c8dc, 0xf2fbff],
  water: [0x2a74b4, 0xd6f2ff, 0x84d0ff, 0xffffff, 0x4a6e88, 0xbfe6ff],
};

export function createFusions(S) {
  const tornadoes = [], rains = [];
  const hostile = (r, team) => !!r && !r.dead && r.team && r.team !== 'neutral' && r.team !== team && (r.living || r.kind === 'creature');
  const combo = (id, pos, team, o) => G.elements?.combo?.(id, pos, { team, ...(o || {}) });
  /** the moment a fusion takes: a starburst in the element's colour and a one-frame impact tint (vfx agent's calls) */
  const flourish = (pos, el, r = 3) => { try { G.fx?.starburst?.(pos, { radius: r, color: COLORS[el] ?? el, intensity: 1.6 }); G.fx?.duel?.impact?.(COLORS[el] ?? 0xffffff, 0.5); } catch (e) { /* visual only */ } };
  const kit = () => G.fx?.kit || null;
  const quality = () => clamp(G.quality?.particles ?? 1, 0.3, 1);

  /** The nearest hostile living reactor around pos within R (horizontal), or null. */
  function nearestFoe(pos, R, team, not) {
    let best = null, bd = Infinity;
    G.elements?.query?.(_u.set(pos.x, pos.y, pos.z), R, (r) => {
      if (!hostile(r, team) || r === not) return;
      const d = Math.hypot(r.pos.x - pos.x, r.pos.z - pos.z);
      if (d < bd) { bd = d; best = r; }
    });
    return best;
  }
  function foesUnder(x, z, R, team, out) {
    out.length = 0;
    G.elements?.query?.(_u.set(x, G.world.heightAt(x, z) + 2, z), R + 4, (r) => {
      if (hostile(r, team) && Math.hypot(r.pos.x - x, r.pos.z - z) < R) out.push(r);
    });
    return out;
  }
  const _foes = [];

  // ---- 龙卷 + element -------------------------------------------------------------------------------------------------
  /** Called by spawnTornado: { at, R, H, team, caster, shp (fx shape handles), ent }. */
  function addTornado(o) {
    const tw = { ...o, el: null, tick: 0, fxT: 0, extra: [], em: null };
    tornadoes.push(tw);
    return tw;
  }
  function removeTornado(tw) {
    const i = tornadoes.indexOf(tw); if (i >= 0) tornadoes.splice(i, 1);
    for (const h of tw.extra) h?.kill?.(0.3);
    tw.extra.length = 0;
    if (tw.em) { tw.em.remove?.(); tw.em = null; }
  }
  /**
   * What a whirl carrying `cur` becomes when `el` enters it — the same chemistry as everywhere else:
   * water puts fire out (steam at its foot), fire melts ice (a waterspout), ice puts fire out, the newcomer wins otherwise.
   */
  function whirlRule(cur, el) {
    if (!cur || cur === el) return { next: el };
    if (cur === 'fire' && el === 'water') return { next: 'water', steam: true };
    if (cur === 'water' && el === 'fire') return { next: 'water', steam: true };
    if (cur === 'fire' && el === 'ice') return { next: null, steam: true };
    if (cur === 'ice' && el === 'fire') return { next: 'water', steam: true };
    return { next: el };
  }
  function fuseTornado(tw, el, at) {
    if (!WHIRL[el]) return false;
    if (tw.el === el) { tw.ent?.extend?.(2); return true; }
    const rule = whirlRule(tw.el, el);
    if (rule.steam) {
      const f = G.elements?.addField?.('steam', tw.at.x, tw.at.z, tw.R + 1, { team: tw.team, source: tw.caster, life: 8 });
      G.fx?.burst?.('steam', _v.set(tw.at.x, tw.at.y + 3, tw.at.z), { scale: 3, power: 1.5 });
      G.audio?.sfx?.('steam_sizzle', { pos: tw.at, vol: 1 });
      if (f) combo('steamcloud', _w.set(tw.at.x, tw.at.y + 4, tw.at.z), tw.team);
    }
    if (rule.next === tw.el) { tw.ent?.extend?.(1); return true; }
    if (!rule.next) { unfuse(tw); return true; }
    el = rule.next;
    tw.el = el;
    tw.tick = 0.15;
    const L = WHIRL_LOOK[el];
    if (tw.shp?.length >= 3) { tw.shp[0].color(L[0], L[1]); tw.shp[1].color(L[2], L[3]); tw.shp[2].color(L[4], L[5]); }
    // fire: the air funnel thins to smoky wisps so the flame sheet (cards, drawn earlier) shows through it
    if (tw.shp?.length >= 2) { const f = el === 'fire'; tw.shp[0].erode?.(f ? 0.6 : 0.18, f ? 0.6 : 0.18); tw.shp[1].erode?.(f ? 0.9 : 0.3, f ? 0.9 : 0.3); }
    tw.recolor?.(L[0]);
    for (const h of tw.extra) h?.kill?.(0.3);
    tw.extra.length = 0;
    if (tw.em) { tw.em.remove?.(); tw.em = null; }
    const F = G.fx;
    const base = tw.at;
    if (el === 'fire') {   // a swirling sheet of flame tongues climbing the funnel (elements/flames.js whirl)
      const h = G.elements?.flames?.whirl?.({ pos: base, R: tw.R, H: tw.H });
      if (h) { tw.extra.push(h); tw.flame = h; }
    }
    const emName = { fire: 'embers', thunder: 'aura_thunder', ice: 'snow', water: 'waterfall_mist' }[el];
    try { tw.em = F?.emitter?.(emName, { radius: tw.R, height: tw.H * 0.5, color: COLORS[el], scale: 1.2 }) || null; if (tw.em) tw.em.pos.copy(base); } catch (e) { tw.em = null; }
    _v.copy(at || base); _v.y = Math.max(_v.y, base.y + 4);
    F?.burst?.(el === 'fire' ? 'explosion' : el === 'thunder' ? 'hit_thunder' : el === 'ice' ? 'shatter_ice' : 'splash', _v, { color: el, scale: 1.4, power: 1.5 });
    kit()?.shock?.(_w.set(base.x, base.y + 0.2, base.z), tw.R * 1.8, COLORS[el], { dur: 0.6, width: 0.12, I: 2 });
    F?.flash?.(_v, COLORS[el], 120, 0.35, 30);
    G.audio?.sfx?.('tornado', { pos: base, vol: 0.9 });
    G.audio?.sfx?.(el === 'fire' ? 'cast_fire_2' : el === 'thunder' ? 'thunder' : el === 'ice' ? 'freeze' : 'splash_big', { pos: base, vol: 0.9 });
    S.shake(0.3, base);
    if (el === 'ice') G.elements?.addField?.('frost', base.x, base.z, tw.R + 1.5, { team: tw.team, source: tw.caster, life: 10 });
    if (el === 'water') G.elements?.addField?.('puddle', base.x, base.z, tw.R, { team: tw.team, source: tw.caster });
    tw.ent?.extend?.(4);
    flourish(_w.set(base.x, base.y + 6, base.z), el, 4);
    combo(WHIRL[el], _w.set(base.x, base.y + 6, base.z), tw.team);
    return true;
  }
  /** back to plain air */
  function unfuse(tw) {
    tw.el = null;
    if (tw.shp?.length >= 3) { tw.shp[0].color(0x5fae8e, 0xe6fff2); tw.shp[1].color(0xbaf2d6, 0xffffff); tw.shp[2].color(0x9a8c72, 0xcabda2); tw.shp[0].erode?.(0.18, 0.18); tw.shp[1].erode?.(0.3, 0.3); }
    tw.recolor?.(0x9fe8c0);
    for (const h of tw.extra) h?.kill?.(0.3);
    tw.extra.length = 0;
    if (tw.em) { tw.em.remove?.(); tw.em = null; }
  }
  function tornadoTick(tw, dt, k) {
    const at = tw.at, R = tw.R, H = tw.H;
    // her own spells flying through the funnel are swallowed into it
    if (S.proj) S.proj.each((p) => {
      if (!p.alive || p.team !== tw.team || !WHIRL[p.el] || p.data?.fusion) return;
      const dx = p.pos.x - at.x, dz = p.pos.z - at.z;
      if (dx * dx + dz * dz > R * R * 0.85 || p.pos.y < at.y - 1 || p.pos.y > at.y + H * 0.7) return;
      fuseTornado(tw, p.el, p.pos);
      G.fx?.burst?.('hit_' + p.el, p.pos, { scale: 1.2 });
      S.proj.release(p, 'fused');
    });
    // rain falling on the funnel: it drinks the cloud
    if (!tw.el && k > 0.5 && G.elements?.isSpellRainAt?.(at.x, at.z)) fuseTornado(tw, 'water', null);
    if (tw.flame) { if (tw.flame.alive && tw.el === 'fire') tw.flame.k = k; else tw.flame = null; }
    if (!tw.el || k <= 0.2) return;
    const team = tw.team, src = tw.caster;
    if (tw.em) tw.em.pos.set(at.x, at.y + 1 + Math.sin(G.time.t * 1.3) * 0.5, at.z);
    const K = kit(), F = G.fx;
    // accents
    if ((tw.fxT -= dt) <= 0) {
      const q = quality();
      _v.set(at.x + rnd(-1, 1) * R * 0.6, at.y + 0.2, at.z + rnd(-1, 1) * R * 0.6);
      if (tw.el === 'fire') { tw.fxT = 0.28 / q; K?.tongues?.(_v, 2, R * 0.4, rnd(1.4, 2.4), { dur: 0.9, I: 1.4 }); if (!tw.flame && Math.random() < 0.3) K?.smoke?.(_w.set(at.x, at.y + H * 0.45, at.z), 2.2, { n: 1, dur: 3, rise: 3 }); }
      else if (tw.el === 'thunder') {
        tw.fxT = 0.18 / q;
        const a = Math.random() * TAU, y0 = rnd(2, H * 0.5), y1 = y0 + rnd(-3, 4), rr = R * (0.35 + 0.6 * y0 / (H * 0.6));
        _v.set(at.x + Math.cos(a) * rr, at.y + y0, at.z + Math.sin(a) * rr);
        _w.set(at.x + Math.cos(a + 1.6) * rr, at.y + y1, at.z + Math.sin(a + 1.6) * rr);
        F?.lightning?.(_v, _w, { color: 0xc9a0ff, impact: false, branches: 1, dur: 0.18, width: 0.12, intensity: 2.2 });
      } else if (tw.el === 'ice') { tw.fxT = 0.45 / q; K?.crystals?.(_v, 2, 0.8, rnd(0.6, 1.1), { dur: 1.1, outward: 0.6 }); if (Math.random() < 0.4) K?.coldMist?.(_v, R * 0.9, { dur: 1.4 }); }
      else { tw.fxT = 0.35 / q; K?.crown?.(_v, rnd(0.6, 1.1), { dur: 0.6 }); if (Math.random() < 0.4) F?.burst?.('splash', _v.setY(at.y + rnd(2, 8)), { scale: 0.9 }); }
    }
    if ((tw.tick -= dt) > 0) return;
    const C = _v.set(at.x, at.y + 2, at.z);
    const info = { source: src, team, fusion: true };
    switch (tw.el) {
      case 'fire':
        tw.tick = 0.5;
        G.elements?.apply('fire', C, R * 0.95, 1, { ...info, damage: 9, noGround: true });
        { const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * R; G.elements?.igniteGround?.(at.x + Math.cos(a) * d, at.z + Math.sin(a) * d, 1.2, 0.8); }
        break;
      case 'thunder': {
        tw.tick = 0.55;
        const r = nearestFoe(at, R + 8, team);
        if (r) {
          _w.set(at.x + rnd(-1, 1) * R * 0.4, at.y + rnd(6, 12), at.z + rnd(-1, 1) * R * 0.4);
          _u.set(r.pos.x, r.cy, r.pos.z);
          G.fx?.lightning?.(_w, _u, { color: 0xb98cff, branches: 2, dur: 0.3, width: 0.28, intensity: 2 });
          G.elements?.apply('thunder', _u.clone(), 1.5, 0.9, { ...info, damage: 15 });
          G.audio?.sfx?.('zap', { pos: _u, vol: 0.7 });
        }
        break;
      }
      case 'ice':
        tw.tick = 0.65;
        foesUnder(at.x, at.z, R + 2.5, team, _foes);
        for (const r of _foes) G.elements?.addStatus?.(r, 'chilled', 2);
        G.elements?.apply('ice', C, R + 2, 0.85, { ...info, damage: 7, noGround: true });
        break;
      case 'water':
        tw.tick = 0.6;
        G.elements?.apply('water', C, R + 3, 1, { ...info, damage: 5, noGround: true });
        G.elements?.extinguishGround?.(at.x, at.z, R + 4);
        break;
    }
  }

  // ---- 祈雨 + element -------------------------------------------------------------------------------------------------
  function addRain(zone, team, caster) {
    if (!zone) return null;
    const rn = { zone, team, caster, el: null, tick: 0, fxT: 0, squallT: -9 };
    rains.push(rn);
    return rn;
  }
  const rainAlive = (rn) => rn.zone && rn.zone.t < rn.zone.duration;
  const top = (z) => Math.max(z.gy, G.world.seaLevel ?? z.gy);
  const dropRain = (rn) => { if (rn.em) { rn.em.remove?.(); rn.em = null; } };
  function fuseRain(rn, el, e) {
    const z = rn.zone, team = rn.team;
    const mid = new THREE.Vector3(z.x, Math.max(z.gy, G.world.seaLevel ?? z.gy) + 3, z.z);
    if (el === 'wind') {   // the gust pushes the cloud along
      const now = G.time.t;
      let dx = e.info?.dir?.x ?? z.x - e.pos.x, dz = e.info?.dir?.z ?? z.z - e.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      z.vx = (z.vx || 0) + (dx / l) * 9 * (e.power || 1); z.vz = (z.vz || 0) + (dz / l) * 9 * (e.power || 1);
      if (now - rn.squallT > 1.5) { rn.squallT = now; combo('squall', mid, team); G.audio?.sfx?.('gust', { pos: mid, vol: 0.8 }); }
      return;
    }
    if (el === 'fire') {   // the rain warms into a drifting fog bank
      if (rn.el === 'fog') return;
      rn.el = 'fog';
      const f = G.elements?.addField?.('steam', z.x, z.z, 8, { team, source: rn.caster, life: 12 });
      for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU + rnd(-0.4, 0.4); G.elements?.addField?.('steam', z.x + Math.cos(a) * z.r * 0.55, z.z + Math.sin(a) * z.r * 0.55, 6, { team, source: rn.caster, life: 10 }); }
      z.remove?.();
      G.fx?.burst?.('steam', mid, { scale: 4, power: 2 });
      G.audio?.sfx?.('steam_sizzle', { pos: mid, vol: 1.2 });
      combo('warmfog', mid, team);
      void f;
      return;
    }
    if (rn.el === el || rn.el === 'fog') { z.duration = Math.min(z.duration + 2, z.t + 14); return; }
    rn.el = el;
    rn.tick = 0.4;
    z.duration = Math.min(Math.max(z.duration, z.t + 10), z.t + 14);
    if (el === 'thunder') {
      z.mood = 'storm';
      G.sky?.flash?.(0x8f6cff, 0.3);
      G.audio?.sfx?.('taiko_roll', { pos: mid, vol: 0.8 });
      G.audio?.sfx?.('thunder', { pos: mid, vol: 1 });
      flourish(mid.clone().setY(mid.y + 10), 'thunder', 5);
      combo('thunderstorm', mid, team);
    } else if (el === 'ice') {
      z.mood = 'hail';
      try { rn.em = G.fx?.emitter?.('snow', { radius: z.r * 0.85, height: 18, scale: 1.4, rate: 1.6 }) || null; if (rn.em) rn.em.pos.set(z.x, top(z) + 2, z.z); } catch (e) { rn.em = null; }
      G.elements?.addField?.('frost', z.x, z.z, Math.min(9, z.r * 0.5), { team, source: rn.caster, life: Math.max(6, z.duration - z.t) });
      G.audio?.sfx?.('freeze', { pos: mid, vol: 1 });
      kit()?.coldMist?.(_v.set(z.x, z.gy, z.z), z.r * 0.8, { dur: 2 });
      flourish(mid.clone().setY(mid.y + 10), 'ice', 5);
      combo('hailstorm', mid, team);
    }
  }
  function rainTick(rn, dt) {
    const z = rn.zone, team = rn.team;
    if (!rn.el || rn.el === 'fog') return;
    const top = Math.max(z.gy, G.world.seaLevel ?? z.gy);
    // hail accents every frame-ish
    if (rn.el === 'ice' && (rn.fxT -= dt) <= 0) {
      rn.fxT = 0.12 / quality();
      const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * z.r * 0.85;
      const x = z.x + Math.cos(a) * d, zz = z.z + Math.sin(a) * d;
      if (Math.hypot(x - G.camera.position.x, zz - G.camera.position.z) < 70) {
        _v.set(x, G.world.groundAt(x, zz) + 0.1, zz);
        kit()?.crystals?.(_v, 2, 0.35, rnd(0.3, 0.55), { dur: 0.9, outward: 0.9 });
        if (Math.random() < 0.45) G.fx?.burst?.('shatter_ice', _v, { scale: 0.45 });
      }
    }
    if ((rn.tick -= dt) > 0) return;
    foesUnder(z.x, z.z, z.r, team, _foes);
    if (rn.el === 'thunder') {
      rn.tick = _foes.length ? 0.95 : 1.7;
      let x, zz;
      if (_foes.length) { const r = _foes[(Math.random() * _foes.length) | 0]; x = r.pos.x; zz = r.pos.z; }
      else { const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * z.r * 0.8; x = z.x + Math.cos(a) * d; zz = z.z + Math.sin(a) * d; }
      _v.set(x, G.world.groundAt(x, zz, top + 30), zz);
      S.strike(_v.clone(), 2.2, 0.85, { source: rn.caster, team, damage: 16, fusion: true }, 0.8);
    } else if (rn.el === 'ice') {
      rn.tick = 0.45;
      for (let i = 0; i < Math.min(3, _foes.length); i++) {
        const r = _foes[(Math.random() * _foes.length) | 0];
        _v.set(r.pos.x, r.cy + 0.6, r.pos.z);
        G.elements?.apply('ice', _v, 1.2, 0.8, { source: rn.caster, team, damage: 6, fusion: true, noGround: true });
        G.fx?.burst?.('hit_ice', _v, { scale: 0.6 });
      }
      if (_foes.length && Math.random() < 0.5) G.audio?.sfx?.('hit_ice', { pos: _v, vol: 0.4 });
    }
  }

  // ---- 岩起 + thunder: 引雷石柱 ---------------------------------------------------------------------------------------
  function chargePillar(ent, info) {
    if (!ent || ent.dying || ent.rod > 0) { if (ent && ent.rod > 0) ent.rod = Math.max(ent.rod, 3); return; }
    ent.rod = 6.5; ent.rodTick = 0.1;
    const top = _v.set(ent.pos.x, ent.top, ent.pos.z);
    G.fx?.burst?.('hit_thunder', top, { scale: 1.6, power: 1.5 });
    G.fx?.flash?.(top, COLORS.thunder, 120, 0.4, 24);
    G.audio?.sfx?.('thunder_chain', { pos: top, vol: 1 });
    ent.rodTeam = info?.team || ent.team || 'player';
    ent.rodSrc = info?.source || ent.caster || null;
    flourish(top, 'thunder', 2.5);
    combo('lightningrod', top.clone(), ent.rodTeam);
  }
  function pillarTick(ent, dt) {
    if (!(ent.rod > 0)) return false;
    ent.rod -= dt;
    const top = _w.set(ent.pos.x, ent.top - 0.3, ent.pos.z);
    if (Math.random() < dt * 9) {   // crackle around the crown
      const a = Math.random() * TAU;
      _v.set(top.x + Math.cos(a) * 1.6, top.y - rnd(0, 3), top.z + Math.sin(a) * 1.6);
      G.fx?.lightning?.(top, _v, { color: 0xd2b8ff, impact: false, branches: 0, dur: 0.12, width: 0.08, intensity: 2.4 });
    }
    if ((ent.rodTick -= dt) <= 0) {
      ent.rodTick = 0.45;
      const r = nearestFoe(top, 12, ent.rodTeam);
      if (r) {
        _v.set(r.pos.x, r.cy, r.pos.z);
        G.fx?.lightning?.(top, _v, { color: 0xb98cff, branches: 2, dur: 0.3, width: 0.3, intensity: 2.2 });
        G.elements?.apply('thunder', _v.clone(), 1.3, 0.9, { source: ent.rodSrc, team: ent.rodTeam, damage: 14, fusion: true });
        G.audio?.sfx?.('zap', { pos: _v, vol: 0.8 });
      }
    }
    return ent.rod <= 0;
  }

  // ---- 冰镜 + fire: 蒸爆 ----------------------------------------------------------------------------------------------
  function steamblast(at, team, source) {
    const c = new THREE.Vector3(at.x, G.world.heightAt(at.x, at.z) + 1.2, at.z);
    const n = G.elements?.blast?.(c, 7, { element: 'fire', team, source, damage: 34, mult: 1.5, reaction: 'steamblast', impulse: 18, soak: true }) || 0;
    G.elements?.addField?.('steam', at.x, at.z, 6, { team, source, life: 8 });
    G.fx?.burst?.('steam', c, { scale: 3.6, power: 2 });
    G.fx?.burst?.('explosion', c, { color: 0xffffff, scale: 1.3, power: 1.5 });
    kit()?.dome?.(c, 7, 0xf2f8ff, { dur: 0.6, I: 1.4 });
    kit()?.shock?.(_v.set(at.x, c.y - 1.1, at.z), 8.5, 0xffffff, { dur: 0.5, width: 0.15 });
    G.fx?.flash?.(c, 0xffe2c0, 180, 0.35, 28);
    G.audio?.sfx?.('explosion_large', { pos: c, vol: 1 });
    G.audio?.sfx?.('steam_sizzle', { pos: c, vol: 1.3 });
    S.shake(0.5, c);
    G.hitstop?.(0.07);
    flourish(c, 0xffffff, 4);
    combo('steamblast', c, team, { count: Math.max(1, n) });
  }

  // ---- 陨星 into water: 巨浪 -------------------------------------------------------------------------------------------
  function tidal(at, team, source, power = 1) {
    const sea = G.world.seaLevel ?? 0;
    const c = new THREE.Vector3(at.x, sea + 0.5, at.z);
    G.elements?.apply('water', _v.set(at.x, sea + 1, at.z), 18, 2 * power, { source, team, damage: 22, fusion: true });
    try { G.physics?.explode?.(c, 20, 26 * power, { up: 0.7 }); } catch (e) { G.reportError('spells:tidal', e); }
    G.elements?.extinguishGround?.(at.x, at.z, 22);
    // the wave runs out to the shore: wherever it reaches dry land within 34 m it soaks what stands there and leaves a puddle
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + rnd(-0.1, 0.1), ca = Math.cos(a), sa = Math.sin(a);
      for (let d = 6; d <= 34; d += 2) {
        const x = at.x + ca * d, z = at.z + sa * d;
        if (G.world.isWater(x, z)) continue;
        const k = 1 - d / 40;
        G.elements?.addField?.('puddle', x + ca * 2, z + sa * 2, rnd(2.4, 3.6) * (0.6 + k), { team, source, life: 18 });
        G.elements?.apply('water', _w.set(x + ca * 2, G.world.heightAt(x, z) + 1, z + sa * 2), 4, power, { source, team, damage: 0, fusion: true, noGround: true });
        kit()?.crown?.(_w.set(x, G.world.heightAt(x, z) + 0.2, z), 1.6, { dur: 0.7, delay: d / 22 });
        break;
      }
    }
    const K = kit(), F = G.fx;
    // a column of water thrown up, two crowns, rings running out over the lake
    F?.shape?.({ kind: 'cyl', pos: _v.set(at.x, sea, at.z), r0: 3.2, r1: 1.4, h: 16, dur: 1.4, grow: [0.15, 1.1], erode: [0.02, 1], tex: 'billow', tile: [3, 1.5], scroll: [0, -1.4],
      color: 0x2d8ed8, color2: 0xf2fbff, core: 0.75, mode: 'sheet', body: 0.7, I: 1.2, soft: 0.04 });
    K?.crown?.(c, 9, { dur: 1.3, I: 1.3 });
    K?.crown?.(c, 15, { dur: 1.8, I: 1.1, delay: 0.2 });
    for (let i = 0; i < 4; i++) K?.shock?.(_v.set(at.x, sea + 0.1, at.z), 12 + i * 8, 0xd2f0ff, { dur: 1 + i * 0.35, width: 0.07, delay: i * 0.2, add: 0.55, I: 1.4 });
    F?.burst?.('splash', c, { scale: 6, power: 3 });
    F?.burst?.('splash', _v.set(at.x, sea + 5, at.z), { scale: 5, power: 2 });
    G.audio?.sfx?.('splash_big', { pos: c, vol: 1.4 });
    G.audio?.sfx?.('splash', { pos: c, vol: 1 });
    S.shake(0.6, c);
    flourish(_v.set(at.x, sea + 4, at.z), 'water', 6);
    combo('tidal', _v.set(at.x, sea + 6, at.z), team);
  }

  // ---- 旋风 through her own fireballs: 风火 ------------------------------------------------------------------------------
  function fanShots(origin, dir, team) {
    let n = 0;
    if (!S.proj) return 0;
    S.proj.each((p) => {
      if (!p.alive || p.team !== team || p.el !== 'fire' || p.data?.fanned) return;
      _v.subVectors(p.pos, origin);
      const d = _v.length();
      if (d > 16 || d < 0.01 || _v.dot(dir) / d < Math.cos(0.75)) return;
      p.data = p.data || {};
      p.data.fanned = true;
      p.power = Math.min(2.4, p.power + 0.7);
      p.size = Math.min(1.8, p.size * 1.4); p.radius = Math.min(1.6, p.radius * 1.25);
      const sp = p.vel.length();
      p.vel.normalize().addScaledVector(dir, 0.5).normalize().multiplyScalar(sp * 1.2);
      G.fx?.burst?.('ignite', p.pos, { scale: 1.3 });
      kit()?.whirl?.(p.pos, 0.9, 1.6, { dur: 0.6, flame: true });
      n++;
      if (n === 1) combo('fanfire', p.pos.clone(), team);
    });
    if (n) G.audio?.sfx?.('cast_fire_2', { pos: origin, vol: 0.6, pitch: 1.2 });
    return n;
  }

  // ---- what landed where -----------------------------------------------------------------------------------------------
  function onApplied(e) {
    if (!e || !e.pos || e.info?.fusion || e.info?.field) return;
    const el = e.element, team = e.team;
    if (team === 'neutral') return;
    const p = e.pos, rad = e.radius || 1;
    for (const tw of tornadoes) {
      if (tw.team !== team || !WHIRL[el]) continue;
      const d = Math.hypot(p.x - tw.at.x, p.z - tw.at.z);
      if (d < tw.R + Math.min(rad, 6) * 0.6 + 1 && p.y > tw.at.y - 3 && p.y < tw.at.y + tw.H * 0.7) fuseTornado(tw, el, p);
    }
    for (const rn of rains) {
      if (rn.team !== team || !RAIN[el] || !rainAlive(rn)) continue;
      if (el === 'wind' && !e.info?.dir) continue;   // a gust pushes the cloud; a whirl's own swirl does not
      const z = rn.zone;
      const d = Math.hypot(p.x - z.x, p.z - z.z);
      if (d < z.r + (el === 'wind' ? rad : 0)) fuseRain(rn, el, e);
    }
  }
  G.events.on('element:applied', (e) => { try { onApplied(e); } catch (err) { G.reportError('spells:fusion', err); } });

  return {
    tornadoes, rains,
    addTornado, removeTornado, tornadoTick, fuseTornado,
    addRain, fuseRain,
    chargePillar, pillarTick, steamblast, tidal, fanShots,
    update(dt) {
      for (let i = rains.length - 1; i >= 0; i--) {
        const rn = rains[i];
        if (!rn.zone || rn.zone.t > rn.zone.duration + 2 || rn.zone.dead) { dropRain(rn); rains.splice(i, 1); continue; }
        if (rn.em) { if (rn.zone.t > rn.zone.duration) dropRain(rn); else rn.em.pos.set(rn.zone.x, top(rn.zone) + 2, rn.zone.z); }
        if (rainAlive(rn)) { try { rainTick(rn, dt); } catch (e) { G.reportError('spells:rain', e); } }
      }
    },
    clear() {
      for (const tw of tornadoes.slice()) removeTornado(tw);
      for (const rn of rains) dropRain(rn);
      tornadoes.length = 0; rains.length = 0;
    },
  };
}
