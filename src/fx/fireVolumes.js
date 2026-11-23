// Closed, tapered flame lobes and ballistic impact trails. Both use the existing instanced FX grid.
// X/Y/Z form an object-space frame; the surface keeps its silhouette when the camera crosses the flight axis.
import * as THREE from 'three';
import { G } from '../core/game.js';

export const fireVertex = /* glsl */`
  else if (kind == 9) {
    float phase = i7.w + uTime * 8.2;
    float around = u * 6.2831853;
    float coil = i7.w + v * i9.x + 0.54 * sin(6.2 * v - phase) + 0.26 * v * sin(11.0 * v - phase * 0.78);
    float flank = i3.y * (0.49 + 0.56 * sin(v * 3.14159) + 0.28 * v * sin(phase + 5.0 * v));
    float bend = v * v * (0.27 * sin(7.1 * v - phase) + 0.33 * sin(3.6 * v + i7.w));
    float profile = pow(max(0.0, sin(3.14159 * pow(v, 0.68))), 0.7) * (1.0 - 0.58 * v);
    float fold = 1.0 + 0.15 * sin(around * 3.0 + 7.1 * v - phase) + 0.1 * sin(around * 2.0 - 9.5 * v + phase);
    vec3 radial = X * cos(around) + Z * sin(around);
    if (i9.z < 0.0) {
      profile = pow(max(0.0, sin(3.14159 * pow(v, 0.93))), 0.74) * (1.0 - 0.22 * v);
      bend = 0.95 * sin(4.9 * v + i7.w * 0.45) * v;
    }
    vec3 center = (X * cos(coil) + Z * sin(coil)) * flank + (X * sin(coil) - Z * cos(coil)) * (bend * i3.x);
    float stretch = 1.0 + 0.13 * v * sin(phase + v * 7.0);
    p = s * (center + radial * (i3.x * profile * fold) + Y * v * i3.z * stretch);
    if (i9.z > 9.0) {
      // Detached hot fragments peel out of the trailing shear layer and burn away.
      float cycle = fract(uTime * (1.34 + fract(i7.w)*0.65) + i7.w);
      float lift = sin(3.14159 * cycle);
      p *= 0.14 + 0.80 * lift;
      p += Y * i3.z * (0.9 + 3.2 * cycle);
      p += X * cos(coil) * i3.z * (0.18 + 0.75 * cycle) + Z * sin(coil) * i3.z * (0.12 + 0.55 * cycle);
    }
    if (i9.z < 0.0) p.y += i3.z * v * v * (0.26 + 0.19 * sin(phase + 3.0 * v));
    n = normalize(radial + Y * (v - 0.36) * 1.6);
  } else if (kind == 10) {
    // Every point along a streak was on the same ballistic arc slightly earlier than its head.
    float head = t, lag = 0.12 + 0.16 * i9.w;
    float moment = max(0.0, head - (1.0 - v) * lag);
    vec3 drift = Y * i3.z * moment * (1.0 - 0.27 * moment);
    drift.y -= i3.y * moment * moment;
    float thick = i3.x * sin(3.14159 * pow(v, 1.65)) * (1.0 - t * t);
    p = drift + rad * thick;
    n = rad;
  } else if (kind == 11) {
    float latitude = v * 3.14159 - 1.5708;
    vec3 unit = rad * cos(latitude) + Y * sin(latitude);
    float lobe = 1.0 + 0.13 * sin(4.0 * rad.x + 4.7 * unit.y + i7.w)
                     + 0.09 * sin(5.2 * unit.z - 2.4 * unit.x + t * 2.0);
    p = unit * i3.x * s * lobe + Y * (t * i3.z);
    p.x += t * t * i3.y * cos(i7.w);
    p.z += t * t * i3.y * sin(i7.w);
    n = unit;
  }`;

export const fireFragment = /* glsl */`
  if (kind > 8.5 && kind < 9.5) {
    if (!gl_FrontFacing) discard;
    float theta = vG.x * 6.2831853, v = vG.y;
    // The rolled flame sheet has a hot interior and a cooler thin skin. The angular pattern wraps
    // seamlessly and advects along the cast direction independently of the camera and world position.
    float flow = 5.3 * v + vTex.y;
    float fine = sin(3.0*theta + flow*1.7 + 1.5*sin(2.0*theta-7.6*v+vTex.y));
    float fold = 0.5 + 0.5 * sin(2.0 * theta - flow + 1.7 * sin(theta + 4.8 * v + 0.45 * vTex.y) + 0.45 * fine);
    float secondFold = 0.5 + 0.5 * cos(3.0 * theta + 4.1 * v - flow * 0.55);
    float heat = clamp(0.20 + 0.34 * fold + 0.10 * secondFold + 0.085 * fine + (vE.w - 0.47) * 0.50
                       + 0.24 * (1.0 - v) - 0.24 * vK.w + 0.12 * (t1.r - 0.5), 0.0, 1.0);
    vec3 bodyColor = mix(vec3(0.37, 0.004, 0.001), vec3(1.15, 0.070, 0.002), smoothstep(0.17, 0.48, heat));
    bodyColor = mix(bodyColor, vec3(1.72, 0.55, 0.028), smoothstep(0.42, 0.66, heat));
    bodyColor = mix(bodyColor, vec3(2.05, 1.40, 0.32), smoothstep(0.62, 0.85, heat));
    float breakup = smoothstep(0.0, 0.32, 0.24 + fold * 0.49 + secondFold * 0.24 + 0.10 * fine - smoothstep(0.29, 0.98, v) * 0.57);
    float cover = (0.96 - 0.21 * vK.w) * breakup * (1.0 - vE.x);
    gl_FragColor = fxOut(bodyColor * 0.06 * cover, bodyColor * vE.z, cover);
    return;
  }
  if (kind > 10.5 && kind < 11.5) {
    if (!gl_FrontFacing) discard;
    float age = vE.x, face = 1.0 - vK.w;
    float grain = abs(t1.r * 0.68 + t1.g * 0.32 - 0.48);
    float opacity = smoothstep(-0.12, 0.54, face - grain * 0.94 - age * 0.23);
    opacity *= smoothstep(0.0, 0.10, age) * (1.0 - smoothstep(0.23, 1.0, age)) * 0.62;
    vec3 ash = mix(vA.rgb, vB.rgb, clamp(0.35 + vG.y * 0.47 + t1.r * 0.29, 0.0, 1.0));
    ash += vec3(0.27,0.057,0.008) * (1.0 - age) * (1.0 - vG.y) * (0.35 + 0.65 * t1.r);
    gl_FragColor = fxOut(vec3(0.0), ash, opacity);
    return;
  }
  if (kind > 9.5 && kind < 10.5) {
    float heat = smoothstep(0.32, 0.94, vG.y);
    vec3 bodyColor = mix(vA.rgb, vB.rgb, heat);
    float cover = pow(vG.y, 0.62) * (1.0 - vE.x);
    gl_FragColor = fxOut(bodyColor * 0.5 * cover, bodyColor * 1.25, cover);
    return;
  }`;

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);
const axis = new THREE.Vector3(), across = new THREE.Vector3(), tangent = new THREE.Vector3(), launch = new THREE.Vector3();

export function createCombustion(add, quality) {
  function mantle(pos, up, width, flank, length, start, twist, heat, options) {
    return add({ kind: 'fireVolume', pos, up, fwd: UP, r0: width, r1: flank, h: length, start, twist,
      tile: [2, 1.1], scroll: [0, -6.4], I: 1, core: heat, ...options });
  }
  function flight(p) {
    const size = p.size, phase = p.id * 2.39996;
    axis.copy(p.vel).normalize().negate();
    const held = { handle: true, dur: p.life + 0.8, erode: [0, 0] };
    const handles = [mantle(p.pos, axis, 1.17 * size, 0, 3.0 * size, phase, 0, 1, held)];
    const layers = quality() < 0.6 ? 2 : 4;
    for (let i = 0; i < layers; i++) {
      const angle = phase + i * TAU / layers;
      handles.push(mantle(p.pos, axis, size * (i % 2 ? 0.35 : 0.46), size * (i % 2 ? 0.63 : 0.78),
        size * [4.35, 3.55, 5.1, 2.95][i], angle, i % 2 ? 2.55 : 1.82, i % 2 ? 0.85 : 0.47, held));
    }
    if (quality() >= 0.6) {
      for (let i = 0; i < 3; i++) {
        handles.push(mantle(p.pos, axis, size * (0.14 + 0.045 * i), size * 0.48,
          size * (1.12 + 0.22 * i), phase + 1.8 + i * 2.17, 1.7, 0.63, { ...held, wobble: 11 }));
      }
    }
    return handles;
  }
  // With the elements system present, blooms and their soot are drawn as flame cards (elements/flames.js burst():
  // a rising puff of flame, tongues licking out, smoke). The lobes below are the fallback.
  const cards = () => G.elements?.flames;
  function bloom(pos, normal, radius, big) {
    const F = cards();
    if (F) { F.burst(pos, normal, radius, big); return; }
    const count = quality() < 0.6 ? 3 : (big ? 7 : 5);
    const phase = Math.random() * TAU;
    tangent.crossVectors(normal, Math.abs(normal.y) < 0.95 ? UP : RIGHT).normalize();
    across.crossVectors(tangent, normal).normalize();
    mantle(pos, normal, radius * 0.83, radius * 0.06, radius * 1.45, phase, 2.7, 1,
      { dur: big ? 0.51 : 0.37, wobble: -1, grow: [0.16, 1.1], erode: [0, 1] });
    for (let i = 0; i < count; i++) {
      const a = phase + 2.39996 * i;
      const lift = (i % 3 === 0 ? 1.28 : 0.44) + 0.40 * Math.sin(i * 3.68);
      launch.copy(tangent).multiplyScalar(Math.cos(a)).addScaledVector(across, Math.sin(a)).addScaledVector(normal, lift).normalize();
      mantle(pos, launch, radius * (0.39 + 0.16 * (i % 3)), radius * (0.09 + 0.06 * (i % 3)),
        radius * (0.87 + 0.30 * ((i + 1) % 3)), a, 3.4, i % 3 ? 0.72 : 1,
        { wobble: -1, dur: (big ? 0.58 : 0.43) * (0.83 + (i % 4) * 0.11), grow: [0.12, 1.12], erode: [0, 1] });
    }
  }
  function soot(pos, normal, radius, big) {
    if (cards()) return;   // burst() brings its own smoke
    const count = quality() < 0.6 ? 2 : big ? 6 : 4;
    const phase = Math.random() * TAU;
    for (let i = 0; i < count; i++) {
      const angle = phase + 2.39996 * i;
      axis.copy(pos).addScaledVector(normal, 0.09 * radius);
      axis.x += Math.cos(angle) * radius * (i ? 0.37 : 0.05);
      axis.z += Math.sin(angle) * radius * (i ? 0.37 : 0.05);
      add({ kind: 'fireSoot', pos: axis, up: UP, r0: radius * (0.31 + (i % 3) * 0.06), r1: radius * 0.52,
        h: radius * (0.63 + (i % 3) * 0.17), dur: big ? 1.62 : 1.24, delay: 0.11 + (i % 3) * 0.09,
        grow: [0.42, 1.9], erode: [0, 1], scroll: [0.06, -0.28], tile: [2, 1], start: angle,
        color: 0x4a4142, color2: 0x8e8381 });
    }
  }
  function impactTrails(pos, normal, radius, color, density) {
    const count = Math.min(13, Math.round(density * quality()));
    const phase = Math.random() * TAU;
    tangent.crossVectors(normal, Math.abs(normal.y) < .95 ? UP : RIGHT).normalize();
    across.crossVectors(tangent, normal).normalize();
    for (let i = 0; i < count; i++) {
      const a = phase + 2.39996 * i, level = 0.18 + (i * 0.373 % 1) * 1.48;
      launch.copy(tangent).multiplyScalar(Math.cos(a)).addScaledVector(across, Math.sin(a)).addScaledVector(normal, level).normalize();
      const spread = 1.5 + (i * 0.571 % 1) * 1.8;
      add({ kind: 'impactTrail', pos, up: launch, r0: radius * (0.015 + (i % 3) * 0.006),
        r1: radius * 0.86, h: radius * spread, start: a, dur: 0.28 + 0.21 * (i * 0.37 % 1),
        erode: [0, 1], body: i * 0.583 % 1, color, color2: 0xffefd1 });
    }
  }
  return { flight, bloom, soot, impactTrails };
}
