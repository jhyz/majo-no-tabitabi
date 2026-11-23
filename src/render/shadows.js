// Cascaded sun shadows (own implementation; three's CSM addon does not fit this renderer).
// The Sun light itself is cascade 0; cascades 1..n are extra DirectionalLights with intensity 0 that only own a shadow
// map (three renders their maps with every caster's customDepthMaterial, alpha test, sway…). The material hook
// (veilhook.js) lights with directionalLights[0] only and picks the shadow from the first cascade that covers the
// fragment, blending across the cascade borders. Each cascade is an orthographic box in the fixed light space, centred
// a little ahead of the camera and snapped to its own texel grid -> stable, no shimmering while moving.
// Outer cascades re-render every few frames, staggered (see TIERS); deep under the Veil no map updates at all.
import * as THREE from 'three';
import { SUN_DIR } from '../world/veil.js';

// Key-light direction. Look round 2 brought the key down to 32 deg (cast shadows 1.6x the caster's height) while the
// disc stayed at 42 deg; light r3 brought the Sun wheel itself down to 32 deg (world/veil.js), so the key IS the Sun
// direction again: disc, shafts, water glint, cloud shadows and cast shadows all agree. Kept as its own export so the
// key can be bent away from the disc again in one place if a framing ever needs it.
export const KEY_DIR = SUN_DIR;

// half-extent (m), map size, depth bias, normal bias (m), filter radius (texels), refresh every n frames
const TIERS = {
  // draw-call pass: high's outer cascades 2nd / 4th -> 3rd / 6th frame (they hold only far casters now; see below)
  high: [[15, 2048, -0.00012, 0.025, 1.6, 1], [52, 1536, -0.00022, 0.07, 1.3, 3], [180, 1024, -0.0006, 0.25, 1.0, 6]],
  med:  [[18, 1536, -0.00015, 0.035, 1.4, 1], [60, 1024, -0.0003, 0.1, 1.2, 3], [170, 1024, -0.0006, 0.25, 1.0, 6]],
  low:  [[24, 1024, -0.0002, 0.05, 1.2, 1], [110, 1024, -0.0005, 0.2, 1.0, 4]],
  // phones (core/boot.js QUALITY.mobile): one cascade around her (80 m box); beyond it a 6-inch screen shows no cast shadow
  mobile: [[40, 1024, -0.0003, 0.07, 1.1, 1]],
};

export function setupSunShadow(G, sun, quality) {
  const r = G.renderer;
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFShadowMap; // hardware compare + bilinear; the hook does its own Poisson taps
  const tier = (quality.mobile && TIERS.mobile) || TIERS[quality.name] || TIERS.high;
  const lights = [sun];
  for (let i = 1; i < tier.length; i++) {
    const l = new THREE.DirectionalLight(0xffffff, 0); // shadow-only: contributes no light anywhere
    l.name = 'mvSunCascade' + i;
    G.scene.add(l, l.target);
    lights.push(l);
  }
  const fwd = KEY_DIR.clone().negate();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
  const casc = lights.map((l, i) => {
    const [half, size0, bias, nb, radius, every] = tier[i];
    const size = i === 0 ? Math.max(size0, quality.shadowSize || 0) : size0;
    l.castShadow = true;
    const sh = l.shadow;
    sh.mapSize.set(size, size);
    const cam = sh.camera;
    cam.layers.enable(5); // PROXY_LAYER: shadow-only proxies of far buildings and merged character casters (DESIGN §9.4)
    cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
    const back = i === tier.length - 1 && i > 0 ? 700 : 420; // a lone cascade (mobile) keeps the inner cascade's depth range
    cam.near = 5; cam.far = back * 2;
    cam.updateProjectionMatrix();
    sh.bias = bias; sh.normalBias = nb; sh.radius = radius; sh.blurSamples = 8;
    sh.intensity = 1;
    sh.autoUpdate = every === 1;
    // cull state (draw-call pass): ea/eb = light-space centre of the box this map was last rendered with; ra/rb = the
    // inner cascade's centre this map was culled against; ca/cb/lim/minR = this frame's caster test (see casterNeeded)
    return { l, half, texel: (half * 2) / size, back, every, nb, radius, ea: 1e9, eb: 1e9, ra: 1e9, rb: 1e9, ca: 0, cb: 0, lim: -1, minR: 0, renders: false };
  });
  // Draw-call pass (docs/api/perf.md "Draw-call pass"). Cascade i > 0 is only read where cascade i-1 is not
  // (veilhook mvCascadeShadow: cascade 0 alone while its UV edge distance > 0.07, cascade 1 alone while > 0.05), and all
  // cascades share one light orientation, so a caster whose light-space footprint lies inside the inner cascade's
  // exclusive box (minus filter / normal-bias pad and a movement margin) never reaches a pixel read from map i.
  // EDGE = that blend width per inner cascade; MARGIN (m) = how far the inner box may move before map i must re-render.
  const EDGE = [0.07, 0.05], MARGIN = [1.5, 4];
  const off = G.params?.perf === '0' || G.params?.dcull === '0';
  for (let i = 1; i < casc.length; i++) {
    const k = casc[i], p = casc[i - 1];
    k.pad = p.nb + k.nb + (k.radius + 1) * k.texel + 0.05;
    k.inner = p.half * (1 - 2 * EDGE[i - 1]);
    k.margin = MARGIN[i - 1] ?? 4;
    k.minR = off ? 0 : k.texel; // casters smaller than a texel of this cascade do not cast into it (PCF washes them out)
  }
  // View region: a shadow texel is only read by a receiver the camera sees. A caster shades along the light: its shadow
  // volume is a capsule from the caster's sphere down the light direction (to 60 m below focus / ground). If that capsule
  // misses the camera frustum (cut at the cascade's farthest reach), the caster shades nothing on screen. Maps re-used
  // for `every` frames are culled with a wider frustum (ANG) and a moved-camera allowance (margin), and re-render as
  // soon as the camera turns / moves past them.
  const ANG = [0.035, 0.12, 0.2]; // rad
  casc.forEach((k, i) => {
    if (i === 0) { k.pad = k.nb + (k.radius + 1) * k.texel + 0.05; k.margin = 0.3; }
    k.ang = ANG[i] ?? 0.2;
    k.vf = new THREE.Frustum(); k.vOn = false; k.yLow = -1e9;
    k.rp = new THREE.Vector3(1e9, 0, 0); k.rf = new THREE.Vector3();
  });
  const _cp = new THREE.Vector3(), _cf = new THREE.Vector3(), _pm = new THREE.Matrix4(), _vi = new THREE.Matrix4();
  const viewFrustum = (k, cm) => {
    // farthest receiver that can read this cascade: box centre distance + the box footprint on the ground (light 32 deg)
    const far = Math.min(cm.far, k.l.target.position.distanceTo(_cp) + k.half * 2.2 + 30), near = Math.max(0.01, cm.near);
    const ty = Math.tan(Math.min(1.5, THREE.MathUtils.degToRad(cm.fov) * 0.5 + k.ang)) / (cm.zoom || 1);
    const tx = Math.tan(Math.min(1.5, Math.atan(Math.tan(THREE.MathUtils.degToRad(cm.fov) * 0.5) * cm.aspect) + k.ang)) / (cm.zoom || 1);
    _pm.makePerspective(-near * tx, near * tx, near * ty, -near * ty, near, far);
    _vi.copy(cm.matrixWorld).invert();
    k.vf.setFromProjectionMatrix(_pm.multiply(_vi));
    k.vOn = !!cm.isPerspectiveCamera;
    // lowest receiver the capsules must reach: 60 m under the lower of the focus and the ground below the camera
    k.yLow = Math.min(focus.y, G.world?.heightAt ? G.world.heightAt(_cp.x, _cp.z) : focus.y) - 60;
  };
  const focus = new THREE.Vector3(), tmp = new THREE.Vector3(), c = new THREE.Vector3();
  const groundFocus = new THREE.Vector3();
  let frame = 0, wasOn = true, wasFrozen = false;
  if (!off) installCulling(casc, right, up);
  return {
    half: casc[0].half,
    focus,
    cascades: casc,
    /** Draw-call pass counters (reset by the caller): culled[i] = casters skipped in cascade i, inst = instanced
     *  groups skipped because no instance is in the view (any pass), zero = empty instanced groups skipped. */
    cullStats: CS,
    /** For owners that cull their own casters (BatchedMesh per object, custom batches): false = a caster with this
     *  world-space bounding sphere cannot reach a texel of this shadow camera's map that a visible receiver reads
     *  (same rules as the built-in test). Any other camera -> true. */
    casterNeeded(shadowCamera, sphere) {
      if (off) return true;
      for (let i = 0; i < casc.length; i++) {
        if (casc[i].l.shadow.camera !== shadowCamera) continue;
        const k = casc[i];
        if (i > 0 && sphere.radius < k.minR) return false;
        return !_installed?.inside(k, sphere.center.x, sphere.center.y, sphere.center.z, sphere.radius);
      }
      return true;
    },
    /** Call once per frame before rendering. daylight = sunlight at the focus (0..1). */
    /** true = stop re-rendering the shadow maps (profiling / photo mode); the last maps stay in use. */
    frozen: false,
    update(daylight) {
      fwd.copy(KEY_DIR).negate();
      right.set(-fwd.z,0,fwd.x).normalize();
      up.crossVectors(right,fwd).normalize();
      if (this.frozen) {
        // the maps were culled for the live view; the first frozen frame re-renders them uncut, so a free camera
        // (photo mode) still finds every caster in them
        if (!wasFrozen && !off) {
          wasFrozen = true;
          casc.forEach((k) => { k.vOn = false; k.lim = -1; k.minR0 = k.minR; k.minR = 0; k.l.shadow.needsUpdate = true; });
          r.shadowMap.needsUpdate = true;
          return;
        }
        r.shadowMap.autoUpdate = false; casc.forEach((k) => { k.l.shadow.needsUpdate = false; }); return;
      }
      if (wasFrozen) { wasFrozen = false; casc.forEach((k) => { k.minR = k.minR0; k.ra = 1e9; k.rp.set(1e9, 0, 0); }); }
      const cm = G.camera;
      cm.getWorldDirection(tmp);
      const downward = -tmp.y;
      tmp.y = 0;
      if (tmp.lengthSq() < 1e-4) tmp.set(0, 0, -1);
      tmp.normalize();
      if (G.player?.pos) focus.copy(G.player.pos);
      else {
        const ahead = Math.min(40, 20 + Math.max(0, cm.position.y - G.world.heightAt(cm.position.x, cm.position.z)) * 0.6);
        focus.set(cm.position.x + tmp.x * ahead, 0, cm.position.z + tmp.z * ahead);
        focus.y = G.world.heightAt(focus.x, focus.z);
      }
      // In an aerial view the close map still covers the rider. Aim the other
      // maps at the sunlit ground visible through the clouds, including when
      // the view is almost vertical and the city is directly below the camera.
      let aerial = 0;
      if (downward > .04 && G.world?.heightAt) {
        const altitude = cm.position.y - G.world.heightAt(cm.position.x,cm.position.z);
        aerial = THREE.MathUtils.smoothstep(altitude,24,90) * THREE.MathUtils.smoothstep(downward,.04,.32);
        if (aerial > 0) {
          const slope = Math.sqrt(Math.max(0,1-downward*downward))/downward;
          let height = cm.position.y-altitude;
          for (let j=0;j<2;j++) {
            groundFocus.copy(cm.position).addScaledVector(tmp,THREE.MathUtils.clamp((cm.position.y-height)*slope,0,340));
            height=G.world.heightAt(groundFocus.x,groundFocus.z);
          }
          groundFocus.y=height;
        }
      }
      const on = daylight > 0.035;
      r.shadowMap.autoUpdate = on;
      frame++;
      if (!off && frame % 30 === 1) adoptInstanced(G.scene);
      if (!off) { cm.updateWorldMatrix(true, false); _cp.setFromMatrixPosition(cm.matrixWorld); cm.getWorldDirection(_cf); }
      casc.forEach((k, i) => {
        // near cascade around the heroine (pushed a little toward the view), outer ones ahead of the camera
        if (i === 0) c.copy(focus).addScaledVector(tmp, k.half * 0.3);
        else {
          c.copy(cm.position).addScaledVector(tmp, k.half * 0.62).setY(focus.y);
          if (aerial > 0) c.lerp(groundFocus,aerial);
        }
        const a = c.dot(right), b = c.dot(up);
        const sa = Math.round(a / k.texel) * k.texel - a, sb = Math.round(b / k.texel) * k.texel - b;
        k.l.target.position.copy(c).addScaledVector(right, sa).addScaledVector(up, sb);
        k.l.position.copy(k.l.target.position).addScaledVector(KEY_DIR, k.back);
        k.l.target.updateMatrixWorld();
        k.l.updateMatrixWorld();
        if (k.every > 1) k.l.shadow.needsUpdate = on && (frame % k.every === (i === 1 ? 1 : 2) % k.every || !wasOn); // never the same frame
        if (i > 0 && !off) {
          // the inner cascade's box (as it will be read this frame) moved past the margin since this map was culled
          // against it: re-render now, or the band it uncovered would read a map without those casters
          const p = casc[i - 1];
          if (on && Math.max(Math.abs(p.ea - k.ra), Math.abs(p.eb - k.rb)) > k.margin) k.l.shadow.needsUpdate = true;
        }
        // the camera turned / moved past what this map was culled for
        if (k.every > 1 && !off && on && (_cp.distanceTo(k.rp) > k.margin || _cf.dot(k.rf) < Math.cos(k.ang * 0.8))) k.l.shadow.needsUpdate = true;
        k.renders = on && (k.every === 1 || k.l.shadow.needsUpdate);
        if (k.renders) {
          CS.renders[i]++;
          k.ea = k.l.target.position.dot(right); k.eb = k.l.target.position.dot(up);
          if (!off) { viewFrustum(k, cm); k.rp.copy(_cp); k.rf.copy(_cf); }
          if (i > 0) {
            const p = casc[i - 1];
            k.ra = p.ea; k.rb = p.eb; k.ca = p.ea; k.cb = p.eb;
            k.lim = off ? -1 : k.inner - k.pad - k.margin;
          }
        }
      });
      if (!on && wasOn) r.shadowMap.needsUpdate = true; // one last clean update
      wasOn = on;
    },
  };
}

// ---------------------------------------------------------------- draw-call pass: what each pass submits
// three tests every frustum-culled Mesh with object.intersectsFrustum(frustum) in the main pass, the water mirror and
// every shadow map (WebGLShadowMap passes the light's own shadow._frustum). This wraps that test (three's own test runs
// first, unchanged) and refuses, additionally:
//   - any pass: an InstancedMesh with count 0, or none of whose instances is inside the frustum (three only tests the
//     sphere around ALL instances, so a prop kit spread over the island was drawn in every pass);
//   - shadow cascade i > 0: casters (or, for instanced groups, every instance) whose light-space footprint is inside the
//     inner cascade's exclusive box, and casters smaller than one texel of that cascade.
// Objects with frustumCulled = false never come here (terrain chunks, flora batches, characters, the boot warm-up batch).
// Instanced meshes with their own onBeforeRender / onBeforeShadow (they may change count or matrices there) only get the
// exact whole-group test.
const CS = { culled: [0, 0, 0, 0], inst: 0, zero: 0, renders: [0, 0, 0, 0] };
const IC_MAX = 4096;
const _cs = new THREE.Sphere(), _is = new THREE.Sphere(), _im = new THREE.Matrix4();
const IC = new WeakMap();
let _installed = null;

function instSpheres(o) {
  const n = o.count, v = o.instanceMatrix.version, mw = o.matrixWorld.elements;
  let c = IC.get(o);
  if (c && c.v === v && c.n === n && c.attr === o.instanceMatrix) {
    let same = true;
    for (let j = 0; j < 16; j++) if (c.mw[j] !== mw[j]) { same = false; break; }
    if (same) return c;
  }
  if (!c) { c = { s: null, mw: new Float32Array(16) }; IC.set(o, c); }
  const g = o.geometry;
  if (!g.boundingSphere) g.computeBoundingSphere();
  if (!c.s || c.s.length < n * 4) c.s = new Float32Array(Math.max(4, n * 4));
  const s = c.s;
  for (let i = 0; i < n; i++) {
    o.getMatrixAt(i, _im);
    _im.premultiply(o.matrixWorld);
    _is.copy(g.boundingSphere).applyMatrix4(_im);
    s[i * 4] = _is.center.x; s[i * 4 + 1] = _is.center.y; s[i * 4 + 2] = _is.center.z;
    // a little slack for vertex-shader sway / bob (three's own instanced sphere has none)
    s[i * 4 + 3] = _is.radius > 0 ? _is.radius * 1.1 + 0.3 : 0; // 0 = hidden (zero-scale) instance
  }
  c.v = v; c.n = n; c.attr = o.instanceMatrix; c.mw.set(mw);
  return c;
}

// Instanced groups added straight to the scene with frustumCulled = false because their instances move / come and go
// are submitted to EVERY pass, wherever their instances are. An owner can opt in with userData.mvCellCull = true:
// the group is adopted (frustumCulled = true) and the wrapped test above decides per instance from the live instance
// matrices (re-read when instanceMatrix.version changes), so nothing that can be seen is dropped. (The prop kits were
// adopted by name while they were InstancedMeshes; props now batch into BatchedMesh and cull per object themselves.)
function adoptInstanced(scene) {
  for (const o of scene.children) {
    if (!o.isInstancedMesh || o.frustumCulled || o.userData.mvAdopted !== undefined || o.userData.mvCellCull !== true) continue;
    o.userData.mvAdopted = true; o.frustumCulled = true;
  }
}

function installCulling(casc, right, up) {
  // one install per renderer life; a re-setup (quality change) re-points it at the new cascades
  const st = { casc, right, up, frs: casc.map((k) => k.l.shadow.getFrustum()) };
  if (_installed) { Object.assign(_installed, st, { inside: _installed.inside }); return; }
  _installed = st;
  const base = THREE.Mesh.prototype.intersectsFrustum;
  const BR = THREE.Object3D.prototype.onBeforeRender, BS = THREE.Object3D.prototype.onBeforeShadow;
  // true = this caster cannot reach a texel of cascade k that a visible receiver reads
  const L=new THREE.Vector3();
  const inside = (k, x, y, z, r) => {
    if (k.vOn) {
      // shadow capsule (caster sphere swept down the light) against the camera frustum
      L.copy(KEY_DIR).negate();
      const sinE=Math.max(.2,KEY_DIR.y);
      const len = Math.min(400, Math.max(2, (y + r - k.yLow) / sinE));
      const rr = r + k.pad + k.margin;
      const pl = k.vf.planes;
      for (let j = 0; j < 6; j++) {
        const n = pl[j].normal, d0 = n.x * x + n.y * y + n.z * z + pl[j].constant;
        const d1 = d0 + len * (n.x * L.x + n.y * L.y + n.z * L.z);
        if (d0 < -rr && d1 < -rr) return true; // off screen
      }
    }
    const lim = k.lim - r;
    if (lim <= 0) return false;
    const a = x * st.right.x + y * st.right.y + z * st.right.z;
    const b = x * st.up.x + y * st.up.y + z * st.up.z;
    return Math.abs(a - k.ca) <= lim && Math.abs(b - k.cb) <= lim; // the inner cascade has it
  };
  st.inside = inside;
  THREE.Mesh.prototype.intersectsFrustum = function (f) {
    // adopted groups: their whole-group sphere is stale by design (never recomputed), the per-instance test below is the test
    if (this.userData.mvAdopted !== true && !base.call(this, f)) return false;
    const frs = st.frs;
    let ci = -1;
    for (let j = 0; j < frs.length; j++) if (frs[j] === f) { ci = j; break; }
    const k = ci >= 0 ? st.casc[ci] : null;
    if (this.isInstancedMesh) {
      if (this.onBeforeRender !== BR || this.onBeforeShadow !== BS) return true;
      const n = this.count;
      if (n === 0) { CS.zero++; return false; }
      if (n > IC_MAX || (n === 1 && !k)) return true;
      const s = instSpheres(this).s;
      for (let i = 0; i < n; i++) {
        const r = s[i * 4 + 3];
        if (r <= 0 || (k && r < k.minR)) continue;
        _is.center.set(s[i * 4], s[i * 4 + 1], s[i * 4 + 2]); _is.radius = r;
        if (!f.intersectsSphere(_is)) continue;
        if (k && inside(k, _is.center.x, _is.center.y, _is.center.z, r)) continue;
        return true;
      }
      if (k) CS.culled[ci]++; else CS.inst++;
      return false;
    }
    if (!k) return true;
    const o = this;
    if (o.boundingSphere !== undefined) { if (o.boundingSphere === null) o.computeBoundingSphere(); _cs.copy(o.boundingSphere); }
    else _cs.copy(o.geometry.boundingSphere);
    _cs.applyMatrix4(o.matrixWorld);
    if (_cs.radius < k.minR || inside(k, _cs.center.x, _cs.center.y, _cs.center.z, _cs.radius)) { CS.culled[ci]++; return false; }
    return true;
  };
}
