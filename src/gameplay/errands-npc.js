// The roadside travellers of the errands (errands round, 2026-11-23): journey-cast bodies (the same five the City of
// Magic's crowds are drawn from) as full actors, recoloured per cel slot so the innkeeper's body becomes a farmer in a
// blue skirt and the father's a painter in a grey coat. They spawn near the heroine only (NPC_NEAR / NPC_FAR), face her
// when she comes close, and speak through G.dialogue (story/episode-cast.js asks G.errands.npc(id) for unknown ids).
import * as THREE from 'three';
import { G } from '../core/game.js';
import { hookMaterial } from '../core/mats.js';
import { createActor, makeActorShadowBlob } from '../actors/rig.js';
import { ERRAND_NPCS, NPC_NEAR, NPC_FAR } from '../data/errands.js';

const _v = new THREE.Vector3(), _c = new THREE.Color();

/** Multiply cel slot colours by name (rules: [[regex source, hex], …]); merged cel materials and plain ones alike. */
export function paintActor(actor, rules) {
  if (!actor?.model || !rules?.length) return [];
  const res = rules.map(([src, hex]) => [new RegExp(src), new THREE.Color(hex)]);
  const done = new Map();
  actor.model.traverse((m) => {
    if (!m.isMesh || m.userData.outline || m.userData.seeLines || m.userData.shadowProxy) return;
    const one = (src) => {
      if (!src) return src;
      if (done.has(src)) return done.get(src);
      let out = src;
      if (src.cel?.multi && src.celU?.uSlC) {
        const hits = src.cel.slots.map((s) => res.find(([re]) => re.test(s.name)));
        if (hits.some(Boolean)) {
          out = src.clone(); out.userData.shared = false;
          const U = out.celU.uSlC.value;
          hits.forEach((h, i) => { if (h) { const k = h[1]; U[i].x *= k.r; U[i].y *= k.g; U[i].z *= k.b; } });
          hookMaterial(out);
        }
      } else if (src.color) {
        const h = res.find(([re]) => re.test(src.name || ''));
        if (h) { out = src.clone(); out.userData.shared = false; out.color.multiply(_c.copy(h[1])); hookMaterial(out); }
      }
      done.set(src, out);
      return out;
    };
    m.material = Array.isArray(m.material) ? m.material.map(one) : one(m.material);
  });
  return [...done.entries()].filter(([a, b]) => a !== b).map(([, b]) => b);
}

/**
 * createTravellers({ resolveAt, placeOf }) — placeOf(id, out) gives a traveller's home position (or null);
 * present(id) decides whether she is out at all (errand availability).
 */
export function createTravellers({ resolveAt, present, placeOf }) {
  const list = Object.entries(ERRAND_NPCS).map(([id, def]) => ({
    id, def, pos: new THREE.Vector3(), home: new THREE.Vector3(), yaw: def.face || 0, actor: null, shadow: null, loading: false,
    homed: false, on: false, props: [], walk: null, pose: def.pose || 'idle', hat: null, talking: false,
  }));
  const byId = Object.fromEntries(list.map((n) => [n.id, n]));

  function home(n) {
    if (n.homed) return true;
    if (n.def.at) resolveAt(n.def.at.lm, n.def.at, n.home);
    else if (!placeOf?.(n.id, n.home)) return false;
    n.pos.copy(n.home); n.homed = true;
    return true;
  }
  function spawn(n) {
    if (n.actor || n.loading || !G.assets?.info?.(n.def.asset)) return;
    if (!G.assets.ready(n.def.asset)) {
      n.loading = true;
      G.assets.load(n.def.asset).catch(() => {}).finally(() => { n.loading = false; });
      return;
    }
    const rig = createActor(n.def.asset, { castShadow: true, animLod: true, fidgets: n.pose === 'idle' });
    try { n.painted = paintActor(rig, n.def.tint); } catch (e) { G.reportError('errands:paint:' + n.id, e); }
    rig.group.name = 'errand:' + n.id;
    rig.group.position.copy(n.pos); rig.group.rotation.y = n.yaw;
    G.scene.add(rig.group);
    rig.play(n.pose === 'sit' ? 'sit' : 'idle', { fade: 0.001 });
    n.shadow = makeActorShadowBlob(0.39, 0.3);
    G.scene.add(n.shadow);
    n.actor = rig;
    if (n.hat) n.hat.wear(rig);
    for (const p of n.props) p.onSpawn?.(rig);
  }
  function erase(n) {
    if (!n.actor) return;
    for (const p of n.props) p.onErase?.(n.actor);
    n.actor.group.removeFromParent();
    n.actor.dispose?.();
    for (const m of n.painted || []) m.dispose?.();
    n.actor = null; n.painted = null;
    n.shadow?.removeFromParent(); n.shadow?.geometry.dispose(); n.shadow?.material.dispose(); n.shadow = null;
  }

  /** Walk a traveller along points [{x,y,z}] at speed v (m/s); done() when there. Only while spawned near her. */
  function walkTo(id, pts, v = 1.3, done = null, clip = 'walk') {
    const n = byId[id]; if (!n) return;
    n.walk = { pts: pts.map((p) => p.clone()), i: 0, v, done, clip };
  }

  function update(dt) {
    const P = G.player; if (!P) return;
    const p = P.pos;
    for (const n of list) {
      const want = !!present(n.id) && home(n);
      if (!want) { if (n.on) { n.on = false; erase(n); } continue; }
      n.on = true;
      const d = Math.hypot(n.pos.x - p.x, n.pos.z - p.z);
      if (d > NPC_FAR) { erase(n); continue; }
      if (d < NPC_NEAR && !n.actor) spawn(n);
      const rig = n.actor;
      // walking (the carter crossing the ice): goes on while she is away too
      if (n.walk) {
        const w = n.walk, t = w.pts[w.i];
        const dx = t.x - n.pos.x, dz = t.z - n.pos.z, dl = Math.hypot(dx, dz);
        if (dl < 0.15) { w.i++; if (w.i >= w.pts.length) { const cb = w.done; n.walk = null; rig?.play(n.pose === 'sit' ? 'sit' : 'idle'); n.home.copy(n.pos); cb?.(); } }
        else {
          const s = Math.min(dl, w.v * dt);
          n.pos.x += dx / dl * s; n.pos.z += dz / dl * s;
          n.pos.y = G.world.groundAt(n.pos.x, n.pos.z, n.pos.y + 0.6);
          n.yaw = Math.atan2(dx, dz);
          if (rig) { if (w.clip === 'push') rig.play('push'); else rig.move(w.v); }
        }
      }
      if (!rig) continue;
      rig.group.position.copy(n.pos);
      const near = d < 7 && !n.walk && n.pose !== 'sit';
      const yaw = n.walk ? n.yaw : near ? Math.atan2(p.x - n.pos.x, p.z - n.pos.z) : n.def.face ?? n.yaw;
      rig.group.rotation.y += Math.atan2(Math.sin(yaw - rig.group.rotation.y), Math.cos(yaw - rig.group.rotation.y)) * Math.min(1, dt * 6);
      rig.lookAt?.(d < 8 ? _v.copy(p).setY(p.y + 1.45) : null);
      n.shadow.position.copy(n.pos); n.shadow.position.y += 0.018;
      rig.update(dt);
    }
  }

  return {
    list, byId, update, walkTo,
    /** resolve (once) and report whether a traveller has a home spot */
    home: (id) => (byId[id] ? home(byId[id]) : false),
    get: (id) => byId[id] || null,
    actor: (id) => byId[id]?.actor || null,
    posOf: (id, out) => { const n = byId[id]; return n && n.on && n.homed ? out.copy(n.pos) : null; },
    isPresent: (id) => !!byId[id]?.actor,
    /** Teleport a traveller (state restore): new home + position. */
    place(id, pos, yaw) { const n = byId[id]; if (!n) return; n.home.copy(pos); n.pos.copy(pos); n.homed = true; if (yaw !== undefined) n.yaw = yaw; n.walk = null; if (n.actor) n.actor.group.position.copy(pos); },
    setFace(id, yaw) { const n = byId[id]; if (n) n.def = { ...n.def, face: yaw }; },
    dispose() { for (const n of list) erase(n); },
  };
}
