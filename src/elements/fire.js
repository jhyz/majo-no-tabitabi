// Ground fire: a 2 m cellular automaton over grassland. Only burning cells are stored (Map). Each cell burns a few
// seconds, spreads to its 8 neighbours (faster downwind, slower uphill-wind), loses a little "strength" every generation
// so every blaze dies out on its own, and leaves scorched ground that regrows after a while.
// Also keeps the coarse heat grid (fire updraft, light, flame lights) that the rest of the system reads.
import { G } from '../core/game.js';
import { FIRE, HEAT_CELL } from './consts.js';
import { hash2 } from '../core/util.js';

const C = FIRE.CELL;
const key = (ix, iz) => (ix + 2048) * 4096 + (iz + 2048);

export function createFire(E) {
  const cells = new Map();          // key -> cell (burning)
  const burnt = new Map();          // key -> time it burnt out
  const wetCells = new Map();       // key -> time the ground dries
  const ok = new Map();             // key -> 1 eligible grassland / 0 not (cache)
  const heat = new Map();           // coarse key -> { n, sx, sy, sz }
  const heatPool = [];
  const pool = [];
  const born = [];
  const dead = [];
  const scorch = new Map();
  let acc = 0, pruneT = 0;
  const _w = new G.THREE.Vector3(), _p = new G.THREE.Vector3();

  /** Can grass burn at cell (ix, iz)? Cached; cleared where the ground is reshaped. */
  function eligible(ix, iz) {
    const k = key(ix, iz);
    let v = ok.get(k);
    if (v !== undefined) return v === 1;
    v = 0;
    const W = G.world;
    const x = (ix + 0.5) * C, z = (iz + 0.5) * C;
    try {
      const h = W.heightAt(x, z);
      if (h > W.seaLevel + 0.6 && h < 62 && W.protectionAt(x, z) < 0.35 && W.slopeAt(x, z) < 0.8
        && W.deformOffsetAt(x, z) > -0.8 && W.roadDist(x, z) > 2.4 && W.riverDist(x, z) > 4.5) {
        const reg = W.regionAt(x, z);
        if (reg !== 'sea' && reg !== 'palace' && reg !== 'moonmoat' && !(reg === 'frostpeak' && h > 40)) v = 1;
      }
    } catch (e) { v = 0; }
    if (ok.size > 250000) ok.clear();
    ok.set(k, v);
    return v === 1;
  }

  function canBurn(ix, iz, now) {
    const k = key(ix, iz);
    if (cells.has(k)) return false;
    const b = burnt.get(k);
    if (b !== undefined && now - b < FIRE.REGROW) return false;
    const w = wetCells.get(k);
    if (w !== undefined && w > now) return false;
    if (!eligible(ix, iz)) return false;
    return true;
  }

  function light(ix, iz, str, now) {
    if (cells.size + born.length >= FIRE.CAP) return null;
    const k = key(ix, iz);
    for (let i = 0; i < born.length; i++) if (born[i].k === k) return null;
    const x = (ix + 0.5) * C, z = (iz + 0.5) * C;
    if (E.weather.isRainingAt(x, z)) return null;
    const c = pool.pop() || {};
    c.k = k; c.ix = ix; c.iz = iz; c.x = x; c.z = z;
    c.age = 0; c.str = str; c.t0 = now;
    c.life = FIRE.LIFE[0] + (FIRE.LIFE[1] - FIRE.LIFE[0]) * hash2(ix * 3.1, iz * 7.7);
    // two flame tongues at jittered spots inside the cell
    const W = G.world;
    c.ax = x + (hash2(ix, iz * 1.3) - 0.5) * 1.3; c.az = z + (hash2(ix * 1.7, iz) - 0.5) * 1.3;
    c.bx = x + (hash2(ix * 2.3, iz + 5) - 0.5) * 1.5; c.bz = z + (hash2(ix + 9, iz * 2.9) - 0.5) * 1.5;
    c.ay = W.heightAt(c.ax, c.az); c.by = W.heightAt(c.bx, c.bz); c.y = (c.ay + c.by) * 0.5;
    c.sa = hash2(ix * 5.1, iz * 3.3); c.sb = hash2(ix * 1.9, iz * 8.1);
    c.size = 0.8 + 0.4 * hash2(ix + 3, iz + 7);
    born.push(c);
    return c;
  }

  function commitBorn() {
    for (let i = 0; i < born.length; i++) { const c = born[i]; cells.set(c.k, c); E.onCellIgnite(c); }
    born.length = 0;
  }

  function kill(c, now, scorched) {
    cells.delete(c.k);
    if (scorched) {
      burnt.set(c.k, now);
      const sk = key(Math.floor(c.x / 8), Math.floor(c.z / 8));
      let s = scorch.get(sk);
      if (!s) scorch.set(sk, (s = { n: 0, sx: 0, sz: 0, x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity }));
      s.n++; s.sx += c.x; s.sz += c.z;
      if (c.x < s.x0) s.x0 = c.x; if (c.x > s.x1) s.x1 = c.x; if (c.z < s.z0) s.z0 = c.z; if (c.z > s.z1) s.z1 = c.z;
    }
    pool.push(c);
  }

  function flushScorch() {
    if (!scorch.size) return;
    for (const s of scorch.values()) {
      const x = s.sx / s.n, z = s.sz / s.n;
      const r = Math.max(1.4, Math.hypot(s.x1 - s.x0, s.z1 - s.z0) * 0.5 + 1.4);
      G.events.emit('terrain:scorch', { x, z, r, kind: 'burn' });
    }
    scorch.clear();
  }

  function rebuildHeat() {
    for (const h of heat.values()) heatPool.push(h);
    heat.clear();
    for (const c of cells.values()) addHeat(c.x, c.y, c.z, c.age < 0.4 ? 0.5 : c.age > c.life * 0.8 ? 0.5 : 1);
  }
  function addHeat(x, y, z, w) {
    const k = key(Math.floor(x / HEAT_CELL), Math.floor(z / HEAT_CELL));
    let h = heat.get(k);
    if (!h) { h = heatPool.pop() || {}; h.n = 0; h.sx = 0; h.sy = 0; h.sz = 0; heat.set(k, h); }
    h.n += w; h.sx += x * w; h.sy += y * w; h.sz += z * w;
  }

  function tick(now) {
    const W = G.world;
    const capK = Math.sqrt(Math.max(0, 1 - cells.size / FIRE.CAP));
    for (const c of cells.values()) {
      c.age += FIRE.TICK;
      const w = wetCells.get(c.k);
      if ((w !== undefined && w > now) || E.weather.isRainingAt(c.x, c.z)) {
        if (c.str > -1) { c.str = -1; c.life = Math.min(c.life, c.age + 0.7); }
      }
      if (c.age >= c.life) { dead.push(c); continue; }
      if (c.str <= 0 || c.age < FIRE.CATCH || c.age > c.life * 0.86 || capK <= 0) continue;
      _p.set(c.x, c.y + 1, c.z);
      E.weather.breezeAt(_p, _w);
      const ws = Math.hypot(_w.x, _w.z);
      const ux = ws > 1e-3 ? _w.x / ws : 0, uz = ws > 1e-3 ? _w.z / ws : 0;
      const wk = Math.min(ws, 9) * 0.3;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const diag = dx && dz;
        const align = (dx * ux + dz * uz) / (diag ? 1.4142 : 1);
        let k = 1 + align * wk;
        if (k < 0.12) k = 0.12;
        const p = FIRE.RATE * FIRE.TICK * k * (diag ? 0.7 : 1) * capK * (0.55 + 0.45 * Math.min(1, c.str));
        if (Math.random() >= p) continue;
        if (!canBurn(c.ix + dx, c.iz + dz, now)) continue;
        const s = c.str - FIRE.DECAY * (1 - 0.75 * Math.max(0, align) * Math.min(1, ws / 6)) - Math.random() * 0.025;
        if (s <= 0) continue;
        light(c.ix + dx, c.iz + dz, s, now);
      }
    }
    for (let i = 0; i < dead.length; i++) kill(dead[i], now, true);
    dead.length = 0;
    commitBorn();
    flushScorch();
    rebuildHeat();
    if ((pruneT += FIRE.TICK) > 10) {
      pruneT = 0;
      if (burnt.size > 30000) for (const [k, t] of burnt) if (now - t > FIRE.REGROW) burnt.delete(k);
      if (wetCells.size > 30000) for (const [k, t] of wetCells) if (t < now) wetCells.delete(k);
    }
  }

  /** Visit the cell keys inside the disc. cb(ix, iz) */
  function disc(x, z, r, cb) {
    const ix0 = Math.floor((x - r) / C), ix1 = Math.floor((x + r) / C);
    const iz0 = Math.floor((z - r) / C), iz1 = Math.floor((z + r) / C);
    const r2 = (r + C * 0.5) * (r + C * 0.5);
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
      const dx = (ix + 0.5) * C - x, dz = (iz + 0.5) * C - z;
      if (dx * dx + dz * dz <= r2) cb(ix, iz);
    }
  }

  const api = {
    cells, heat,
    get count() { return cells.size; },
    eligible: (x, z) => eligible(Math.floor(x / C), Math.floor(z / C)),
    /** Set grass alight in the disc. Returns how many cells caught. */
    ignite(x, z, r = 1, power = 1) {
      const now = G.time.t;
      const str = Math.min(1.5, 0.55 + 0.35 * power);
      let n = 0;
      disc(x, z, Math.max(r, 0.6), (ix, iz) => { if (canBurn(ix, iz, now) && light(ix, iz, str, now)) n++; });
      commitBorn();
      return n;
    },
    /** Put out burning cells in the disc. Returns how many. */
    extinguish(x, z, r = 1) {
      const now = G.time.t;
      let n = 0;
      const r2 = (r + 1) * (r + 1);
      for (const c of cells.values()) {
        const dx = c.x - x, dz = c.z - z;
        if (dx * dx + dz * dz <= r2) { dead.push(c); n++; }
      }
      for (let i = 0; i < dead.length; i++) kill(dead[i], now, dead[i].age > 1);
      dead.length = 0;
      flushScorch();
      if (n) rebuildHeat();
      return n;
    },
    /** Soak the ground so fire cannot take hold there for `sec`. */
    wet(x, z, r, sec = FIRE.WET_GROUND) {
      const until = G.time.t + sec;
      disc(x, z, r, (ix, iz) => { const k = key(ix, iz); if ((wetCells.get(k) || 0) < until) wetCells.set(k, until); });
    },
    isWetAt(x, z) { const w = wetCells.get(key(Math.floor(x / C), Math.floor(z / C))); return w !== undefined && w > G.time.t; },
    isBurningAt(x, z) { return cells.has(key(Math.floor(x / C), Math.floor(z / C))); },
    /** Wind over a fire: small, young flames blow out; the rest flare up and leap downwind. Returns {out, fanned}. */
    fan(x, z, r, dx, dz, power = 1) {
      const now = G.time.t;
      let out = 0, fanned = 0;
      const r2 = r * r;
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      for (const c of cells.values()) {
        const ex = c.x - x, ez = c.z - z;
        if (ex * ex + ez * ez > r2) continue;
        if (c.str < 0.22 * power || c.age > c.life * 0.8) { dead.push(c); out++; continue; }
        c.str = Math.min(1.6, c.str + 0.12 * power);
        fanned++;
        const hops = 1 + Math.floor(Math.random() * (1 + 2 * power));
        for (let h = 1; h <= hops; h++) {
          const ix = Math.floor((c.x + dx * C * h) / C), iz = Math.floor((c.z + dz * C * h) / C);
          if (canBurn(ix, iz, now)) light(ix, iz, c.str - FIRE.DECAY * h * 0.5, now);
        }
      }
      for (let i = 0; i < dead.length; i++) kill(dead[i], now, dead[i].age > 1);
      dead.length = 0;
      commitBorn(); flushScorch();
      return { out, fanned };
    },
    /** Heat (≈ burning cells, weighted) on the coarse grid around (x, z). */
    heatAt(x, z) { const h = heat.get(key(Math.floor(x / HEAT_CELL), Math.floor(z / HEAT_CELL))); return h ? h.n : 0; },
    /** The coarse heat cell holding (x, z) ({ n, sx, sy, sz, … }; flames.js stores the wind there) or undefined. */
    heatCell(x, z) { return heat.get(key(Math.floor(x / HEAT_CELL), Math.floor(z / HEAT_CELL))); },
    addHeat,
    update(dt) {
      if (dt <= 0) return false;
      acc += dt;
      let ticked = false;
      let n = 0;
      while (acc >= FIRE.TICK && n < 3) { acc -= FIRE.TICK; tick(G.time.t); ticked = true; n++; }
      if (acc > FIRE.TICK) acc = 0;
      return ticked;
    },
    rebuildHeat,
    clear() {
      for (const c of cells.values()) pool.push(c);
      cells.clear(); burnt.clear(); wetCells.clear(); heat.clear();
    },
    /** Ground was reshaped: forget the cached eligibility there. */
    invalidate(x0, x1, z0, z1) {
      for (let ix = Math.floor(x0 / C); ix <= Math.floor(x1 / C); ix++)
        for (let iz = Math.floor(z0 / C); iz <= Math.floor(z1 / C); iz++) ok.delete(key(ix, iz));
    },
  };
  return api;
}
