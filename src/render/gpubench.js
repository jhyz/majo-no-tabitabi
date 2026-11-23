// First-start quality auto-pick (docs/api/perf.md). A ~0.1 s fill-rate probe on a throw-away WebGL2 canvas: a
// shader shaped like the game's (procedural noise, texture taps, half-float target) drawn over 1024x1024 a few times.
// The score is GPU ms per full-screen-megapixel draw; tier thresholds are relative to the reference machine
// (Apple M5 laptop, ~REF ms): that machine gets 'highfast' (all of 'high' at pixel ratio 1.25, 60 fps there);
// 'high' (pixel ratio 1.5) only a GPU about 1.4x faster.
// Software renderers (SwiftShader / llvmpipe) always get 'low'.
// Phones and tablets (mobileDevice()) get the 'mobile' tier without the probe: a 0.1 s burst says little about a handheld
// GPU that throttles after minutes in the hand. 'mobile' (core/boot.js QUALITY) = every 'low' cut plus the handheld cuts,
// a sharper pixel ratio (~0.75 MP) and a 30 fps cap unless the device clearly holds 60. The settings menu still changes it.

const REF = 0.42; // ms per megapixel draw on the reference machine (Apple M5 laptop, measured 0.41–0.43; perf.md "auto-pick")

const VS = `#version 300 es
in vec2 p; out vec2 uv; void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o; uniform sampler2D t; uniform float k;
float h(vec2 q) { return fract(sin(dot(q, vec2(12.9898, 78.233))) * 43758.5453); }
float n(vec2 q) { vec2 i = floor(q), f = fract(q); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec3 c = vec3(0.0); vec2 q = uv * 8.0 + k;
  for (int i = 0; i < 24; i++) { c += vec3(n(q), n(q + 3.1), n(q - 1.7)) * 0.04; q = q * 1.27 + 0.37; }
  for (int i = 0; i < 4; i++) c += texture(t, uv + float(i) * 0.013 + c.xy * 0.01).rgb * 0.1;
  o = vec4(c, 1.0);
}`;

/** A phone or tablet: a finger is the main pointer and the browser names a handheld (iPadOS says "Mac" with touch points). */
export function mobileDevice() {
  try {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const ua = navigator.userAgent || '';
    const handheld = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|HarmonyOS/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return coarse && handheld;
  } catch (e) { return false; }
}

/** Returns { tier: 'high'|'highfast'|'med'|'low'|'mobile', score, renderer, mobile? } (score: ms per megapixel draw; lower is faster). */
export function pickQuality({ mobile = false } = {}) {
  const out = { tier: 'high', score: null, renderer: '' };
  if (mobile) { out.tier = 'mobile'; out.mobile = true; return out; }
  let gl = null;
  try {
    const cv = document.createElement('canvas');
    cv.width = 16; cv.height = 16;
    gl = cv.getContext('webgl2', { antialias: false, powerPreference: 'high-performance' });
    if (!gl) { out.tier = 'low'; return out; }
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    out.renderer = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    if (/swiftshader|llvmpipe|software|basic render/i.test(out.renderer)) { out.tier = 'low'; return out; }
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(pr, 0, 'p'); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return out;
    gl.useProgram(pr);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const px = new Uint8Array(256 * 256 * 4); for (let i = 0; i < px.length; i++) px[i] = (i * 37) & 255;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    const S = 1024;
    gl.getExtension('EXT_color_buffer_float');
    const rt = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, rt);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, S, S, 0, gl.RGBA, gl.HALF_FLOAT, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rt, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return out;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.viewport(0, 0, S, S);
    const kLoc = gl.getUniformLocation(pr, 'k');
    const rb = new Float32Array(4);
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, rb);
    const run = (n) => { for (let i = 0; i < n; i++) { gl.uniform1f(kLoc, i * 0.1); gl.drawArrays(gl.TRIANGLES, 0, 3); } sync(); };
    run(2); // warm-up: compile + first allocation
    const N = 8;
    let best = Infinity;
    for (let r = 0; r < 3; r++) { const t0 = performance.now(); run(N); best = Math.min(best, performance.now() - t0); }
    out.score = best / (N * (S * S) / 1e6);
    // GPU pass (docs/api/perf.md "GPU pass"): this M5 laptop (score = REF) holds 60 fps on 'highfast' (high at pixel
    // ratio 1.25), not on 'high' (1.5: ~48 fps); 'high' needs a GPU ~1.4x faster (score <= 0.7 REF)
    out.tier = out.score <= REF * 0.7 ? 'high' : out.score <= REF * 1.8 ? 'highfast' : out.score <= REF * 4 ? 'med' : 'low';
  } catch (e) { /* keep the default */ }
  finally { try { gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch (e) { /* ignore */ } }
  return out;
}
