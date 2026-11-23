// G.errands — roadside errands (errands round, 2026-11-23). Data: src/data/errands.js, words + dialogue scripts:
// src/locales/zh-CN/gameplay.errands.js, travellers: errands-npc.js, props: errands-props.js.
// Five small side stories given by travellers met at landmarks along the route (moor, wilds, high pass, near the city):
//   er_letter  carry a letter from the moor farm to the sister at the west farm, and her one-line reply back (broom)
//   er_hat     a painter's hat torn off by the wind rides across the moor: chase it on the broom; a wind spell that
//              passes near it catches it and carries it back toward her; uncaught, it settles in the tallest snag
//   er_stove   light the shepherd's rain-soaked stove with fire (a 'lantern' reactor, the element rules)
//   er_ford    freeze the ford below the broken bridge with ice; the carter pushes his pumpkin cart across the ice
//   er_stars   the stray stars' note (src/gameplay/wilds.js) read aloud to a witch who once waited at the city road
// They need the broom (G.state.abilities.broom), run only in G.mode 'play', and a traveller steps aside while the
// current main-quest step needs a spot within ERRAND_CLEAR m. Mid-states (a flying hat, the ice, the crossing) are
// physical and not saved; a reload puts the hat in its snag and the carter back on the near bank.
// State: G.state.errands = { list: { id: { s: 'active' | 'done', step, v } }, keep: { keepsake: 1 } } (core/save.js).
// Events: errand:accepted {id}, errand:step {id, step}, errand:done {id}.
import * as THREE from 'three';
import { G } from '../core/game.js';
import { t } from '../core/i18n.js';
import { ERRANDS, ERRAND_BY_ID, ERRAND_NPCS, ERRAND_CLEAR, TRACK_NEAR, HAT, FORD, STOVE } from '../data/errands.js';
import { RIVERS } from '../data/world.js';
import { resolveAt } from './wilds.js';
import { createTravellers } from './errands-npc.js';
import { makeHat, makeEasel, makeSeat, makeStove, makeCart, makeIceSheet } from './errands-props.js';
import { sfx, toast } from './common.js';

const tt = (k, p) => t('gameplay.errands.' + k, p);
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _d = new THREE.Vector3();

/** G.state.errands, filled with defaults (old saves). */
export function estate() {
  const st = G.state;
  if (!st) return null;
  if (!st.errands || typeof st.errands !== 'object') st.errands = {};
  const e = st.errands;
  for (const k of ['list', 'keep', 'seen']) if (!e[k] || typeof e[k] !== 'object' || Array.isArray(e[k])) e[k] = {};
  return e;
}

export function createErrands() {
  const api = {};
  let NPC = null, ready = false, time = 0, blockT = 0, markT = 0, lastMk = '';
  const blocked = {};          // errand id -> true while the main story needs the spot
  const R = {};                // per-errand runtime (props)

  // ---- state ---------------------------------------------------------------------------------------------------------
  const rec = (id) => estate()?.list[id] || null;
  const stepOf = (id) => { const r = rec(id), e = ERRAND_BY_ID[id]; return r && r.s === 'active' ? e.steps[r.step] || null : null; };
  const isDone = (id) => rec(id)?.s === 'done';
  const hasBroom = () => !!G.state?.abilities?.broom;
  const knows = (e) => (e.needs || []).every((s) => (G.state?.spells?.[s] || 0) > 0);
  /** Is the errand's traveller out (broom, flag, not in the way of the story)? */
  function open(e) {
    if (!G.state || !hasBroom()) return false;
    if (e.flag && !G.state.flags?.[e.flag] && !rec(e.id)) return false;
    return !blocked[e.id];
  }
  function save() { if (G.started && !G.save?.disabled) { try { G.save.write(true); } catch (err) { /* ignore */ } } }
  function dirty() { api.markersDirty = true; G.quests?.refresh?.(); }

  function accept(id) {
    const es = estate(); if (!es || es.list[id]) return false;
    es.list[id] = { s: 'active', step: 0, v: {} };
    toast(tt('toast.accepted', { title: tt('title.' + id) }), { icon: 'side', dur: 3.2 });
    sfx('ui_page', { vol: 0.6 });
    G.events.emit('errand:accepted', { id });
    R[id]?.onStep?.();
    dirty(); save();
    // a step that is already met (the stars already found, the stove already burning) moves on by itself
    checkNow(id);
    return true;
  }
  function advance(id) {
    const r = rec(id), e = ERRAND_BY_ID[id];
    if (!r || r.s !== 'active') return false;
    r.step++;
    if (r.step >= e.steps.length) return complete(id);
    G.events.emit('errand:step', { id, step: e.steps[r.step] });
    R[id]?.onStep?.();
    dirty(); save();
    return true;
  }
  function complete(id, o = {}) {
    const es = estate(), e = ERRAND_BY_ID[id]; if (!es || !e) return false;
    const r = es.list[id] || (es.list[id] = { s: 'active', step: 0, v: {} });
    if (r.s === 'done') return false;
    r.s = 'done'; r.step = e.steps.length;
    const at = NPC?.posOf(e.giver, _v) || G.player?.pos || _v.set(0, 0, 0);
    pay(e.reward, at.clone ? at.clone() : at);
    if (e.keep) es.keep[e.keep] = 1;
    if (!o.silent) {
      toast(tt('toast.done', { title: tt('title.' + id) }), { icon: 'side', dur: 3.5 });
      sfx('ui_chime', { vol: 0.6 });
      if (e.keep) setTimeout(() => toast(tt('toast.keep', { name: tt('keep.' + e.keep + '.name') }), { icon: 'journal', dur: 4 }), 1400);
    }
    G.events.emit('errand:done', { id });
    R[id]?.onStep?.();
    dirty(); save();
    return true;
  }
  function pay(loot, pos) {
    if (!loot) return;
    if (G.wilds?.grant) { G.wilds.grant(loot, pos); return; }
    const at = pos.clone().setY(pos.y + 0.6);
    if (loot.dust) G.gameplay?.spawnPickup?.('stardust', at, loot.dust);
    for (const k in loot.items || {}) G.gameplay?.spawnPickup?.(k, at, loot.items[k]);
  }
  function checkNow(id) {
    const s = stepOf(id);
    if (id === 'er_stars' && s === 'stars' && starsRead()) { advance(id); toast(tt('toast.starsReady'), { icon: 'star', dur: 4 }); }
    if (id === 'er_stove' && s === 'light' && R.er_stove?.stove.lit) advance(id);
  }
  const starsRead = () => (G.wilds?.starCount?.() || 0) >= (ERRAND_BY_ID.er_stars.need || 6);

  // ---- who is out where ------------------------------------------------------------------------------------------------
  const giverOf = {};
  for (const e of ERRANDS) giverOf[e.giver] = e;
  function present(npc) {
    if (npc === 'greta') return open(ERRAND_BY_ID.er_letter) && !!rec('er_letter');
    const e = giverOf[npc];
    return !!e && open(e);
  }
  /** The main story's current target (null when free roaming / no story). */
  function storyTarget(out) {
    const S = G.story, step = S?.current?.();
    if (!step || !G.quests?.isActive?.(G.quests.trackedId?.())) return null;
    try { const p = S.target(step); return p ? out.copy(p) : null; } catch (e) { return null; }
  }
  function refreshBlocked() {
    const tg = storyTarget(_w);
    for (const e of ERRANDS) {
      let b = false;
      if (tg) for (const id of [e.giver, ...(e.id === 'er_letter' ? ['greta'] : [])]) {
        const n = NPC?.get(id); if (!n || !NPC.home(id)) continue;
        if (Math.hypot(n.home.x - tg.x, n.home.z - tg.z) < ERRAND_CLEAR) b = true;
      }
      // an errand under way keeps its traveller (the story never asks for these places; this only guards new offers)
      if (b && rec(e.id)?.s === 'active') b = false;
      blocked[e.id] = b;
    }
  }

  // ---- talking ----------------------------------------------------------------------------------------------------------
  let talking = false;
  const canTalk = () => G.mode === 'play' && !talking && !G.dialogue?.active && !G.story?.busy && !G.story?.spar?.active && !G.story?.finale?.active && !G.gameplay?.raceRunning;
  async function say(script, npc, vars) {
    if (!G.dialogue?.play) return { result: 'yes' };
    return G.dialogue.play('gameplay.errands.dlg.' + script, { npc, vars });
  }
  async function talk(npc) {
    if (!canTalk()) return;
    talking = true;
    try {
      const e = npc === 'greta' ? ERRAND_BY_ID.er_letter : giverOf[npc];
      const id = e.id, r = rec(id), s = stepOf(id);
      if (npc === 'greta') {
        if (s === 'deliver') { await say('er_letter_deliver', npc); if (stepOf(id) === 'deliver') advance(id); }
        else await say('er_letter_greta', npc);
        return;
      }
      if (!r) {
        const res = await say(id + '_offer', npc);
        if (id === 'er_hat') { accept(id); hat.launch(); }        // the hat is already gone: she just goes
        else if (res?.result === 'yes' && knows(e)) accept(id);
        return;
      }
      if (r.s === 'done') { await say(id + '_after', npc); return; }
      const last = e.steps[e.steps.length - 1];
      if (s === last && (id !== 'er_ford' || ford.across)) {
        const vars = id === 'er_stars' ? { note: t('gameplay.wilds.note.1') } : undefined;
        await say(id + '_' + s, npc, vars);
        if (stepOf(id) === s) { R[id]?.onFinish?.(); complete(id); }
        return;
      }
      await say(id + '_wait', npc);
    } catch (err) { G.reportError('errands:talk', err); }
    finally { talking = false; }
  }

  // ---- the lost hat ----------------------------------------------------------------------------------------------------
  const hat = {
    mesh: null, state: 'head', pos: new THREE.Vector3(), vel: new THREE.Vector3(), t: 0, i: 0, gustT: 0, dodgeCd: 0,
    from: new THREE.Vector3(), landing: new THREE.Vector3(), path: [], spun: 0, worn: null, trailT: 0,
    init() {
      this.mesh = makeHat(); this.mesh.visible = false; G.scene.add(this.mesh);
      resolveAt(HAT.landing.lm, HAT.landing, this.landing);
      this.path = HAT.path.map(([x, z, dy]) => new THREE.Vector3(x, (G.world.heightAt(x, z) || 0) + dy, z));
    },
    /** put it where the saved state says: on his head, in the snag, in her hands, back on his head */
    restore() {
      const s = stepOf('er_hat');
      this.state = isDone('er_hat') ? 'home' : !rec('er_hat') ? 'head' : s === 'chase' ? 'stuck' : 'held';
      this.place();
    },
    place() {
      const m = this.mesh; if (!m) return;
      const otto = NPC?.get('otto');
      if (this.state === 'head' || this.state === 'home') {
        if (otto?.actor) this.wear(otto.actor); else { m.removeFromParent(); m.visible = false; this.worn = null; }
        return;
      }
      if (m.parent !== G.scene) { if (this.worn) this.worn.detach?.(m); this.worn = null; m.removeFromParent(); G.scene.add(m); }
      m.scale.setScalar(0.84);
      if (this.state === 'stuck') { this.pos.copy(this.landing); m.visible = true; m.position.copy(this.pos); m.rotation.set(0.35, 0.6, -0.25); }
      else if (this.state === 'held') m.visible = false;
    },
    wear(rig) {
      const m = this.mesh; if (!m || !(this.state === 'head' || this.state === 'home')) return;
      m.visible = true; m.rotation.set(0, 0, 0); m.position.set(0, 0, 0);
      rig.attach(m, 'head', { pos: [0, 0.15, -0.01], rot: [-0.1, 0, 0], scale: 0.84 });
      this.worn = rig;
    },
    launch() {
      if (this.state !== 'head') return;
      const otto = NPC?.get('otto');
      const m = this.mesh;
      m.updateWorldMatrix(true, false);
      m.getWorldPosition(this.pos);
      if (!otto?.actor || this.pos.y < -100) this.pos.copy(otto?.pos || this.landing).setY((otto?.pos.y || 0) + 1.8);
      if (this.worn) this.worn.detach?.(m);
      this.worn = null;
      m.removeFromParent(); G.scene.add(m); m.visible = true; m.position.copy(this.pos); m.scale.setScalar(0.84);
      this.state = 'fly'; this.t = 0; this.i = 0; this.gustT = 0; this.dodgeCd = 1.5;
      this.vel.set(2.5, 4.5, -2.0);
      G.fx?.burst?.('leaves', this.pos); sfx('gust', { vol: 0.7 });
      setTimeout(() => { if (this.state === 'fly') toast(tt('toast.hatOff'), { icon: 'broom', dur: 5.5 }); }, 600);
    },
    /** a wind spell cast by her: when its line passes close to the hat, the gust catches it and brings it back */
    gust(pos, dir) {
      if (this.state !== 'fly' && this.state !== 'stuck') return false;
      _d.copy(this.pos).sub(pos);
      const along = _d.dot(dir);
      if (along < 0 || along > HAT.gustReach) return false;
      const off = _d.addScaledVector(dir, -along).length();
      if (off > HAT.gustR + along * 0.06) return false;
      if (this.state === 'stuck') { this.state = 'fly'; this.i = this.path.length; this.t = Math.min(this.t, HAT.maxT - 20); }
      this.gustT = HAT.gustT; this.from.copy(pos); this.dodgeCd = HAT.gustT + 1.2;
      G.fx?.burst?.('hit_wind', this.pos); G.fx?.burst?.('leaves', this.pos);
      toast(tt('toast.hatGust'), { icon: 'broom', dur: 2 });
      return true;
    },
    catch() {
      this.state = 'held'; this.mesh.visible = false;
      G.fx?.burst?.('pickup', this.pos); sfx('sparkle'); sfx('ui_chime', { vol: 0.5 });
      toast(tt('toast.hatCaught'), { icon: 'item', dur: 3 });
      if (stepOf('er_hat') === 'chase') advance('er_hat');
    },
    update(dt, playing) {
      const m = this.mesh; if (!m) return;
      if (this.state === 'head' || this.state === 'home') { const a = NPC?.get('otto')?.actor; if (a && this.worn !== a) this.wear(a); return; }
      if (this.state === 'held') return;
      const P = G.player;
      if (this.state === 'stuck') {
        m.rotation.z = -0.25 + Math.sin(time * 2.3) * 0.08;
        if (playing && P && P.pos.distanceTo(_v.copy(this.pos).setY(this.pos.y - 0.9)) < (P.onBroom ? HAT.catchBroom : HAT.catchR)) this.catch();
        return;
      }
      // flying: riding the wind from waypoint to waypoint toward the snags, tumbling, shying from her hand
      this.t += dt;
      const end = this.i >= this.path.length;
      const tgt = end ? this.landing : this.path[this.i];
      _d.copy(tgt).sub(this.pos);
      const dist = _d.length();
      if (!end && dist < 7) this.i++;
      if (this.t > HAT.maxT && !end) this.i = this.path.length;
      if (end && dist < 0.8 && this.gustT <= 0) {
        this.state = 'stuck'; this.pos.copy(this.landing); m.position.copy(this.pos); m.rotation.set(0.35, 0.6, -0.25);
        toast(tt('toast.hatStuck'), { icon: 'eye', dur: 3.5 }); dirty();
        return;
      }
      const sp = end ? Math.min(HAT.speed, 1.2 + dist * 0.8) : HAT.speed;
      _w.copy(_d).multiplyScalar(1 / Math.max(dist, 0.001) * sp);
      _w.x += Math.sin(this.t * 1.3) * 2.2; _w.y += Math.sin(this.t * 2.1) * 1.4; _w.z += Math.cos(this.t * 1.1) * 2.2;
      const wind = G.elements?.windAt?.(this.pos, _v); if (wind) { _w.x += wind.x * 0.3; _w.z += wind.z * 0.3; }
      if (this.gustT > 0) {
        this.gustT -= dt;
        _w.copy(P ? P.pos : this.from).setY((P ? P.pos.y : this.from.y) + 1.2).sub(this.pos);
        const l = _w.length(); _w.multiplyScalar(HAT.gustSpeed / Math.max(l, 0.001));
      } else if (P && playing) {
        this.dodgeCd -= dt;
        const dp = P.pos.distanceTo(this.pos);
        if (dp < 7 && this.dodgeCd <= 0) {   // it shies away from the reaching hand: a sideways skip and a hop up
          _v.set(this.pos.x - P.pos.x, 0, this.pos.z - P.pos.z).normalize();
          const sgn = Math.sin(this.t * 7.7) > 0 ? 1 : -1;
          this.vel.x += (-_v.z * sgn * 0.8 + _v.x * 0.6) * HAT.dodge; this.vel.z += (_v.x * sgn * 0.8 + _v.z * 0.6) * HAT.dodge; this.vel.y += 3.5;
          this.dodgeCd = 2.4;
        }
      }
      const k = 1 - Math.exp(-dt * (this.gustT > 0 ? 4 : 1.4));
      this.vel.lerp(_w, k);
      this.pos.addScaledVector(this.vel, dt);
      const g = G.world.heightAt(this.pos.x, this.pos.z);
      if (this.pos.y < g + 1.2) { this.pos.y = g + 1.2; this.vel.y = Math.max(this.vel.y, 1); }
      m.position.copy(this.pos);
      // a trail of torn leaves on the wind, so the eye can follow it against the sky (only while she is near)
      this.trailT -= dt;
      if (this.trailT <= 0) { this.trailT = 0.45; if (P && P.pos.distanceTo(this.pos) < 160) G.fx?.burst?.('leaves', this.pos, { scale: 0.6 }); }
      this.spun += dt * (3 + this.vel.length() * 0.3);
      m.rotation.set(Math.sin(this.spun) * 0.9, this.spun * 0.7, Math.cos(this.spun * 0.8) * 0.6);
      if (playing && P && this.t > 1.2 && P.pos.distanceTo(_v.copy(this.pos).setY(this.pos.y - 0.9)) < (P.onBroom ? HAT.catchBroom : HAT.catchR)) this.catch();
    },
  };

  // returned: back on his head
  R.er_hat = { onStep() { if (isDone('er_hat')) { hat.state = 'home'; hat.place(); } } };

  // ---- the ford below the broken bridge ---------------------------------------------------------------------------------
  const ford = {
    c: new THREE.Vector3(), n: new THREE.Vector3(), u: new THREE.Vector3(), a: 6, b: 6, ok: false, frozen: 0, crossing: false, across: false,
    ice: null, plat: null, cart: null, reactor: null, start: new THREE.Vector3(), end: new THREE.Vector3(),
    init() {
      const river = RIVERS.find((r) => r.id === FORD.river);
      if (!river) return;
      // the closest river segment: its direction, the square crossing line, the water's two edges
      let best = null, bd = Infinity;
      for (let i = 0; i < river.pts.length - 1; i++) {
        const [x0, z0] = river.pts[i], [x1, z1] = river.pts[i + 1];
        const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz;
        const k = Math.max(0, Math.min(1, ((FORD.x - x0) * dx + (FORD.z - z0) * dz) / l2));
        const px = x0 + dx * k, pz = z0 + dz * k, d = Math.hypot(FORD.x - px, FORD.z - pz);
        if (d < bd) { bd = d; best = { px, pz, dx, dz, l: Math.sqrt(l2) }; }
      }
      const W = G.world;
      this.u.set(best.dx / best.l, 0, best.dz / best.l);
      this.n.set(-this.u.z, 0, this.u.x);
      // the deepest point near the centreline is the ford's middle
      let cx = best.px, cz = best.pz, lo = Infinity;
      for (let s = -12; s <= 12; s += 1) { const x = best.px + this.n.x * s, z = best.pz + this.n.z * s, h = W.heightAt(x, z); if (h < lo) { lo = h; cx = x; cz = z; } }
      const sea = W.seaLevel ?? 0;
      const edge = (sgn) => { for (let s = 0; s < 40; s += 0.5) { if (W.heightAt(cx + this.n.x * s * sgn, cz + this.n.z * s * sgn) > sea + 0.25) return s; } return 12; };
      this.a = edge(-1); this.b = edge(1);
      this.c.set(cx, sea, cz);
      this.ok = lo < sea;
      const len = this.a + this.b + 3;
      const mid = (this.b - this.a) / 2;
      this.mid = new THREE.Vector3(cx + this.n.x * mid, sea, cz + this.n.z * mid);
      this.yaw = Math.atan2(this.n.x, this.n.z);
      this.ice = makeIceSheet(len, 4.6); this.ice.position.copy(this.mid).setY(sea + 0.02); this.ice.rotation.y = this.yaw; this.ice.visible = false; G.scene.add(this.ice);
      // the near bank (where he waits) and the far bank (where he ends)
      const on = (s, out) => { out.set(cx + this.n.x * s, 0, cz + this.n.z * s); out.y = W.groundAt(out.x, out.z, W.heightAt(out.x, out.z) + 0.6); return out; };
      on(-this.a - 4.5, this.start); on(this.b + 4.5, this.end);
      this.cart = makeCart(); G.scene.add(this.cart);
      this.reactor = G.elements?.register?.({ owner: this, kind: 'prop', material: 'water', pos: this.mid.clone().setY(sea - 1.4), center: false,
        radius: Math.max(this.a, this.b) + 1.5, height: 2.2, flammable: 0,
        on: { freeze: () => this.freeze(), hit: (rr, el) => { if (el === 'ice') this.freeze(); } } }) || null;
    },
    restore() {
      const s = stepOf('er_ford');
      this.across = isDone('er_ford') || s === 'across';
      this.crossing = false;
      const at = this.across ? this.end : this.start;
      NPC?.place('tomas', at, this.yaw);
      NPC?.setFace('tomas', this.across ? this.yaw + Math.PI : this.yaw);
      this.placeCart(at);
    },
    /** the cart stands ahead of him on the crossing line, handles toward him */
    placeCart(at) {
      if (!this.cart) return;
      const x = at.x + this.n.x * 1.6, z = at.z + this.n.z * 1.6;
      this.cart.position.set(x, Math.max(G.world.heightAt(x, z), this.mid.y + 0.34), z);
      this.cart.rotation.y = this.yaw + Math.PI;
    },
    freeze() {
      const was = this.frozen > 0;
      this.frozen = Math.max(this.frozen, FORD.iceT);
      if (was) return true;
      this.ice.visible = true;
      if (!this.plat) this.plat = G.world.addPlatform?.({ box: true, x: this.mid.x, z: this.mid.z, hw: 2.3, hd: (this.a + this.b + 3) / 2, rot: this.yaw, top: this.mid.y + 0.34, thick: 0.6 }) || null;
      G.fx?.burst?.('shatter_ice', this.mid); sfx('freeze', { vol: 0.7 });
      if (stepOf('er_ford') === 'freeze' && !this.crossing) this.cross();
      return true;
    },
    thaw() {
      this.frozen = 0; this.ice.visible = false;
      if (this.plat) { this.plat.dead = true; this.plat = null; }
      G.fx?.burst?.('splash', this.mid);
    },
    cross() {
      const n = NPC?.get('tomas'); if (!n) return;
      this.crossing = true;
      toast(tt('toast.fordFrozen'), { icon: 'ice', dur: 3.5 });
      const pts = [];
      for (let s = -this.a - 4.5; s <= this.b + 4.5; s += 2) { const p = new THREE.Vector3(this.c.x + this.n.x * s, 0, this.c.z + this.n.z * s); p.y = Math.max(G.world.heightAt(p.x, p.z), this.mid.y + 0.34); pts.push(p); }
      pts.push(this.end.clone());
      NPC.walkTo('tomas', pts, 1.4, () => {
        this.crossing = false; this.across = true;
        toast(tt('toast.fordAcross'), { icon: 'side', dur: 3 });
        if (stepOf('er_ford') === 'freeze') advance('er_ford');
        NPC.setFace('tomas', this.yaw + Math.PI);
        this.placeCart(this.end);
      }, 'push');
    },
    update(dt) {
      if (!this.ok) return;
      if (this.frozen > 0) {
        this.frozen -= dt;
        if (this.crossing) this.frozen = Math.max(this.frozen, 3);
        if (this.frozen <= 0) { this.thaw(); if (stepOf('er_ford') === 'freeze') toast(tt('toast.fordMelt'), { icon: 'ice', dur: 3 }); }
      }
      if (this.crossing) {
        const n = NPC?.get('tomas');
        if (n) this.placeCart(n.pos);   // the cart rolls ahead of him on the crossing line
      }
    },
    /** the traveller's home before the first restore */
    placeAt(out) { return out.copy(this.start); },
  };

  // ---- the shepherd's stove ---------------------------------------------------------------------------------------------
  function initStove() {
    const st = makeStove();
    const pos = resolveAt(STOVE.lm, STOVE, new THREE.Vector3());
    st.group.position.copy(pos); st.group.rotation.y = (ERRAND_NPCS.hanna.face || 0) + 0.4;
    G.scene.add(st.group);
    const col = G.world.addCollider?.({ x: pos.x, z: pos.z, r: 0.42, y0: pos.y - 0.5, y1: pos.y + 0.95, tag: 'errand_stove' });
    const lit = () => {
      if (st.lit) return true;
      st.light(true); G.fx?.burst?.('lantern_ignite', pos.clone().setY(pos.y + 0.5)); sfx('ignite');
      toast(tt('toast.stoveLit'), { icon: 'fire', dur: 3 });
      if (stepOf('er_stove') === 'light') advance('er_stove');
      return true;
    };
    const reactor = G.elements?.register?.({ owner: st, kind: 'lantern', material: 'metal', pos: pos.clone(), radius: 0.9, height: 1.2,
      on: { ignite: lit, light: lit, extinguish: () => false } }) || null;
    R.er_stove = {
      stove: st, pos, col, reactor, puffT: 0,
      restore() { const s = stepOf('er_stove'); st.light(isDone('er_stove') || s === 'warm'); },
      tick(dt, near) {
        if (!near || !st.lit) return;
        st.tick(time);
        this.puffT -= dt;
        if (this.puffT <= 0) { this.puffT = 1.1; _v.copy(st.pipe).applyEuler(st.group.rotation).add(pos); G.fx?.burst?.('steam', _v); }
      },
    };
  }

  // ---- set dressing at the travellers' spots ---------------------------------------------------------------------------
  function dress() {
    // the painter's easel beside him, a sitting stone for the witch at the road shrine
    const otto = NPC.get('otto'), ilse = NPC.get('ilse');
    if (NPC.home('otto')) {
      const e = makeEasel(); const f = (ERRAND_NPCS.otto.face || 0);
      // beside him, a little ahead, turned so he looks across the canvas toward the moor
      e.position.set(otto.home.x + Math.sin(f) * 0.8 + Math.cos(f) * 1.0, 0, otto.home.z + Math.cos(f) * 0.8 - Math.sin(f) * 1.0);
      e.position.y = G.world.heightAt(e.position.x, e.position.z); e.rotation.y = f + Math.PI - 0.6; G.scene.add(e);
    }
    if (NPC.home('ilse')) {
      const s = makeSeat(); s.position.copy(ilse.home); s.position.y = G.world.heightAt(ilse.home.x, ilse.home.z) - 0.02; s.rotation.y = ERRAND_NPCS.ilse.face || 0; G.scene.add(s);
      ilse.home.y = s.position.y + 0.02; ilse.pos.copy(ilse.home);
    }
  }

  // ---- providers ------------------------------------------------------------------------------------------------------
  /** Where the errand wants her next: [{x,y,z}] (the traveller to talk to, the hat, the stove, the ford). */
  function targetOf(id, out) {
    const e = ERRAND_BY_ID[id], s = stepOf(id);
    if (!s) return null;
    if (id === 'er_hat' && s === 'chase') return out.copy(hat.pos);
    if (id === 'er_stove' && s === 'light') return R.er_stove ? out.copy(R.er_stove.pos) : null;
    if (id === 'er_ford' && s === 'freeze') return out.copy(ford.mid);
    if (id === 'er_stars' && s === 'stars') return null;
    const who = id === 'er_letter' && s === 'deliver' ? 'greta' : e.giver;
    NPC.home(who);
    return out.copy(NPC.get(who).pos);
  }
  function markers() {
    const es = estate(); if (!es || !NPC) return [];
    const out = [];
    for (const e of ERRANDS) {
      const r = rec(e.id);
      if (!r && open(e) && NPC.home(e.giver) && api.seen(e.giver)) { const p = NPC.get(e.giver).home; out.push({ x: p.x, z: p.z, icon: 'side', label: tt('name.' + e.giver), kind: 'quest', color: '#e8c890' }); }
      if (r?.s === 'active') { const p = targetOf(e.id, _v); if (p) out.push({ x: p.x, z: p.z, icon: 'side', label: tt('title.' + e.id), kind: 'quest', color: '#ffe2a0' }); }
    }
    return out;
  }
  /** The tracked errand (nearest active target): { id, title, objective, progress?, dist } or null. */
  function trackedErrand() {
    const P = G.player; if (!P || !estate()) return null;
    let best = null, bd = Infinity;
    for (const e of ERRANDS) {
      if (rec(e.id)?.s !== 'active') continue;
      const p = targetOf(e.id, _v);
      const d = p ? Math.hypot(p.x - P.pos.x, p.z - P.pos.z) : 0;
      if (d < bd) { bd = d; best = e; }
    }
    return best ? { e: best, d: bd } : null;
  }
  function objective(id) {
    const s = stepOf(id); if (!s) return '';
    return tt('steps.' + id + '.' + s, { n: Math.min(G.wilds?.starCount?.() || 0, ERRAND_BY_ID.er_stars.need), need: ERRAND_BY_ID.er_stars.need });
  }
  /** HUD tracker data for quests.js syncUi: an accepted errand near its target (or any once both episodes are done). */
  function tracker() {
    const tr = trackedErrand(); if (!tr) return null;
    const free = !G.quests || !G.quests.active?.().length;
    if (!free && tr.d > TRACK_NEAR && !(tr.e.id === 'er_hat' && hat.state === 'fly')) return null;
    return { title: tt('title.' + tr.e.id), objective: objective(tr.e.id) };
  }
  function pushCompass() {
    const tr = trackedErrand();
    const list = [];
    if (tr) { const p = targetOf(tr.e.id, _v); if (p) list.push({ id: 'errand_' + tr.e.id, pos: { x: p.x, y: p.y + (tr.e.id === 'er_hat' ? 0.3 : 2), z: p.z }, icon: 'side', kind: 'quest', label: tt('title.' + tr.e.id), color: '#ffe2a0' }); }
    // a traveller with something to ask, close by
    const P = G.player;
    if (P) for (const e of ERRANDS) {
      if (rec(e.id) || !open(e) || !NPC.home(e.giver)) continue;
      const h = NPC.get(e.giver).home;
      if (Math.hypot(h.x - P.pos.x, h.z - P.pos.z) < 120) list.push({ id: 'errand_giver_' + e.giver, pos: { x: h.x, y: h.y + 2.2, z: h.z }, icon: 'side', kind: 'quest', label: tt('name.' + e.giver), color: '#e8c890' });
    }
    const key = list.map((m) => m.id + Math.round(m.pos.x) + ',' + Math.round(m.pos.y) + ',' + Math.round(m.pos.z)).join(';');
    if (key !== lastMk) { lastMk = key; G.ui?.setMarkers?.(list, 'errand'); }
  }
  /** Journal page entries (ui/wilds-page.js). */
  function journal() {
    const es = estate(); if (!es) return null;
    const list = ERRANDS.map((e) => {
      const r = rec(e.id), known = !!r || api.seen(e.giver);
      return { id: e.id, known, state: r ? r.s : 'open', title: known ? tt('title.' + e.id) : tt('page.unknown'), desc: known ? tt('desc.' + e.id) : '',
        objective: r?.s === 'active' ? objective(e.id) : r?.s === 'done' ? tt('done.' + e.id) : '', place: tt('name.' + e.giver), region: e.region };
    });
    const keeps = ERRANDS.filter((e) => e.keep && es.keep[e.keep]).map((e) => ({ id: e.keep, name: tt('keep.' + e.keep + '.name'), text: tt('keep.' + e.keep + '.text') }));
    return { list, keeps, done: list.filter((x) => x.state === 'done').length, active: list.filter((x) => x.state === 'active').length, of: list.length };
  }

  // ---- system ---------------------------------------------------------------------------------------------------------
  Object.defineProperties(api, Object.getOwnPropertyDescriptors({
    markersDirty: true,
    get ready() { return ready; },
    init() {
      NPC = createTravellers({ resolveAt, present, placeOf: (id, out) => (id === 'tomas' && ford.ok ? ford.placeAt(out) : null) });
      try { ford.init(); } catch (e) { G.reportError('errands:ford', e); }
      try { hat.init(); } catch (e) { G.reportError('errands:hat', e); }
      try { initStove(); } catch (e) { G.reportError('errands:stove', e); }
      try { dress(); } catch (e) { G.reportError('errands:dress', e); }
      // the hat sits on the painter's head whenever his actor is built
      const otto = NPC.get('otto');
      otto.props.push({ onSpawn: (rig) => hat.wear(rig), onErase: (rig) => { if (hat.worn === rig) { rig.detach?.(hat.mesh); hat.mesh.visible = false; hat.worn = null; } } });
      for (const id of Object.keys(ERRAND_NPCS)) {
        G.interact?.add({
          getPos: (out) => (NPC.isPresent(id) ? out.copy(NPC.get(id).pos).setY(NPC.get(id).pos.y + 0.9) : null),
          radius: 2.8, priority: 3, broom: true,
          enabled: () => NPC.isPresent(id) && canTalk() && !NPC.get(id).walk,
          prompt: () => tt('prompt.talk', { name: tt('name.' + id) }),
          onInteract: () => talk(id),
        });
      }
      G.events.on('spell:cast', (c) => { if (c?.spell === 'wind' && c.caster === G.player && c.pos && c.dir) hat.gust(c.pos, c.dir); });
      G.events.on('wilds:star', () => { if (stepOf('er_stars') === 'stars') checkNow('er_stars'); dirty(); });
      ready = true;
    },
    start() {
      estate();
      // dialogue hook: the gust that takes the painter's hat (gameplay.errands.dlg.er_hat_offer)
      G.dialogue?.hook?.('errand', (arg) => { if (arg === 'hatOff') hat.launch(); });
      refreshBlocked();
      try { hat.restore(); } catch (e) { G.reportError('errands:hat', e); }
      try { ford.restore(); if (ford.frozen > 0) ford.thaw(); } catch (e) { G.reportError('errands:ford', e); }
      try { R.er_stove?.restore(); } catch (e) { G.reportError('errands:stove', e); }
      talking = false; lastMk = ''; api.markersDirty = true;
    },
    update(dt) {
      if (!ready || !G.state) return;
      time += dt;
      const mode = G.mode, playing = G.started && mode === 'play' && G.player && !G.player.dead;
      blockT -= dt;
      if (blockT <= 0) { blockT = 1; refreshBlocked(); }
      try { NPC.update(dt); } catch (e) { G.reportError('errands:npc', e); }
      if (mode === 'play' || mode === 'talk') { try { hat.update(dt, playing); } catch (e) { G.reportError('errands:hat', e); } }
      if (mode === 'play') {
        try { ford.update(dt); } catch (e) { G.reportError('errands:ford', e); }
        const cam = G.camera?.position, st = R.er_stove;
        if (st) st.tick(dt, !!cam && Math.abs(cam.x - st.pos.x) < 200 && Math.abs(cam.z - st.pos.z) < 200);
      }
      // seen travellers (map pins), compass
      const P = G.player;
      if (P && playing) {
        const es = estate();
        for (const n of NPC.list) if (n.on && !es.seen[n.id] && Math.abs(n.pos.x - P.pos.x) < 90 && Math.hypot(n.pos.x - P.pos.x, n.pos.z - P.pos.z) < 90) { es.seen[n.id] = 1; api.markersDirty = true; G.gameplay?.markersDirty?.(); }
      }
      markT -= dt;
      if (markT <= 0 && mode === 'play') { markT = 0.5; pushCompass(); }
    },
    markers,
    journal,
    tracker,
    // ---- public helpers (tests, the cast, other systems) ----
    /** a traveller for G.dialogue / story/episode-cast.js: { actor, pos } or null */
    npc(id) { const n = NPC?.get(id); return n ? { actor: n.actor, pos: n.pos, present: !!n.actor, posOf: (out) => NPC.posOf(id, out) } : null; },
    nameOf: (id) => (ERRAND_NPCS[id] ? tt('name.' + id) : undefined),
    seen: (id) => !!estate()?.seen?.[id],
    state: (id) => rec(id),
    step: stepOf,
    isOpen: (id) => !!ERRAND_BY_ID[id] && open(ERRAND_BY_ID[id]),
    target: (id) => { const p = targetOf(id, new THREE.Vector3()); return p; },
    accept, advance, complete,
    talk,
    get hat() { return hat; },
    get ford() { return ford; },
    get stove() { return R.er_stove || null; },
    get travellers() { return NPC; },
  }));
  return api;
}
