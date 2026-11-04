// Light effects in card units (card width 1, height 1.4, y up, +z towards the viewer):
// the name ribbons (printed outline and sparkler trail), sparks, diya glows, the light stream.
import * as THREE from '../lib/three.module.min.js';

export const COLORS = {
  hot: new THREE.Color('#fff6e0'),
  warm: new THREE.Color('#ffb547'),
  ember: new THREE.Color('#ff7a2a'),
};

// ---------- small canvas textures ----------
export function radialTexture(stops, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function starTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const m = size / 2;
  const gr = g.createRadialGradient(m, m, 0, m, m, m);
  gr.addColorStop(0, 'rgba(255,255,250,1)');
  gr.addColorStop(0.12, 'rgba(255,240,200,0.9)');
  gr.addColorStop(0.35, 'rgba(255,170,60,0.25)');
  gr.addColorStop(1, 'rgba(255,120,30,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 4; i++) {
    g.save();
    g.translate(m, m);
    g.rotate((i * Math.PI) / 4);
    const lg = g.createLinearGradient(-m, 0, m, 0);
    lg.addColorStop(0, 'rgba(255,220,150,0)');
    lg.addColorStop(0.5, i % 2 ? 'rgba(255,230,170,0.35)' : 'rgba(255,245,220,0.7)');
    lg.addColorStop(1, 'rgba(255,220,150,0)');
    g.fillStyle = lg;
    g.fillRect(-m, i % 2 ? -1 : -1.5, size, i % 2 ? 2 : 3);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- the name as ribbons ----------
// Builds one triangle strip per contour. Attributes: side (-1..1 across the stroke),
// arc (0..1 along the whole name, in drawing order), seed (per-contour random).
export function buildNamePath(geom) {
  const contours = [];
  let total = 0;
  const JUMP = 0.035; // time the spark spends hopping between contours, as path length
  for (const L of geom.letters) {
    for (const c of L.contours) {
      let len = 0;
      for (let i = 0; i < c.length; i++) {
        const a = c[i], b = c[(i + 1) % c.length];
        len += Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
      contours.push({ pts: c, start: total + (contours.length ? JUMP : 0), len });
      total = contours[contours.length - 1].start + len;
    }
  }
  return { contours, total };
}

// Point on the drawing path at fraction f (0..1). Returns [x, y, drawing?].
export function pathPoint(path, f) {
  const s = f * path.total;
  for (const c of path.contours) {
    if (s < c.start) return [c.pts[0][0], c.pts[0][1], false];
    if (s <= c.start + c.len) {
      let d = s - c.start;
      const p = c.pts;
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (d <= l) {
          const t = l ? d / l : 0;
          return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, true];
        }
        d -= l;
      }
      return [p[0][0], p[0][1], true];
    }
  }
  const last = path.contours[path.contours.length - 1].pts[0];
  return [last[0], last[1], false];
}

export function ribbonGeometry(path, width) {
  const pos = [], side = [], arc = [], seed = [], idx = [];
  let base = 0;
  for (const c of path.contours) {
    const p = c.pts;
    const n = p.length;
    const s0 = Math.random();
    let run = 0;
    for (let i = 0; i <= n; i++) {
      const cur = p[i % n], prev = p[(i - 1 + n) % n], next = p[(i + 1) % n];
      let dx0 = cur[0] - prev[0], dy0 = cur[1] - prev[1];
      let dx1 = next[0] - cur[0], dy1 = next[1] - cur[1];
      const l0 = Math.hypot(dx0, dy0) || 1, l1 = Math.hypot(dx1, dy1) || 1;
      dx0 /= l0; dy0 /= l0; dx1 /= l1; dy1 /= l1;
      let nx = -(dy0 + dy1), ny = dx0 + dx1;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl; ny /= nl;
      const miter = Math.min(2.2, 1 / Math.max(0.2, nx * -dy1 + ny * dx1));
      const w = (width / 2) * miter;
      if (i > 0) run += Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
      const a = (c.start + run) / path.total;
      pos.push(cur[0] + nx * w, cur[1] + ny * w, 0, cur[0] - nx * w, cur[1] - ny * w, 0);
      side.push(1, -1);
      arc.push(a, a);
      seed.push(s0, s0);
      if (i < n) {
        const v = base + i * 2;
        idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    }
    base += (n + 1) * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('side', new THREE.Float32BufferAttribute(side, 1));
  g.setAttribute('arc', new THREE.Float32BufferAttribute(arc, 1));
  g.setAttribute('seed', new THREE.Float32BufferAttribute(seed, 1));
  g.setIndex(idx);
  return g;
}

const RIBBON_VS = /* glsl */ `
  attribute float side; attribute float arc; attribute float seed;
  varying float vSide; varying float vArc; varying float vSeed;
  void main() {
    vSide = side; vArc = arc; vSeed = seed;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

// The sparkler trail: each point lights when the spark passes (age 0), burns white-hot for a
// moment, then holds at uGlow (the choreography's level), fading unevenly like a real trail.
const TRAIL_FS = /* glsl */ `
  uniform float uT;        // seconds since the drawing began
  uniform float uDrawDur;  // seconds the drawing takes
  uniform float uGlow;     // sustained level after the hot moment (0..1)
  uniform float uRelight;  // relight sweep position along the name (0..1; <0 off)
  uniform float uSoft;     // 0 core, 1 halo
  uniform float uOpacity;
  uniform float uTime;
  uniform vec3 uHot; uniform vec3 uWarm; uniform vec3 uEmber;
  varying float vSide; varying float vArc; varying float vSeed;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  float noise(float x) { float i = floor(x); float f = fract(x); return mix(hash(i), hash(i + 1.0), f * f * (3.0 - 2.0 * f)); }
  void main() {
    float age = uT - vArc * uDrawDur;
    if (age < 0.0) discard;
    float hot = exp(-age / 0.28);
    float n = noise(vArc * 61.0 + vSeed * 13.0);
    float sustained = clamp(uGlow * 1.35 - n * 0.35, 0.0, 1.0);
    float relit = 0.0;
    if (uRelight >= 0.0) {
      float d = uRelight - vArc;
      relit = step(0.0, d) * 0.95 + exp(-abs(d) * 90.0) * 1.2;
    }
    float level = max(max(hot, sustained), relit);
    level *= 0.88 + 0.12 * noise(uTime * 7.0 + vArc * 40.0);
    float heat = max(hot, exp(-abs(uRelight - vArc) * 70.0) * step(0.0, uRelight));
    vec3 col = mix(mix(uEmber, uWarm, smoothstep(0.0, 0.6, level)), uHot, heat);
    float prof = uSoft > 0.5 ? exp(-vSide * vSide * 3.2) : smoothstep(1.0, 0.45, abs(vSide));
    float a = prof * level * uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(col * a, a);
    #include <colorspace_fragment>
  }`;

export function trailMaterial(soft) {
  return new THREE.ShaderMaterial({
    vertexShader: RIBBON_VS,
    fragmentShader: TRAIL_FS,
    uniforms: {
      uT: { value: -1 }, uDrawDur: { value: 3 }, uGlow: { value: 1 }, uRelight: { value: -1 },
      uSoft: { value: soft ? 1 : 0 }, uOpacity: { value: 1 }, uTime: { value: 0 },
      uHot: { value: COLORS.hot.clone() }, uWarm: { value: COLORS.warm.clone() }, uEmber: { value: COLORS.ember.clone() },
    },
    transparent: true,
    depthWrite: false,
    // the core is premultiplied over the art; the halo adds light
    blending: soft ? THREE.AdditiveBlending : THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
}

// The printed outline: the name as it is on the card, a thin even stroke.
export function printMaterial(color) {
  return new THREE.ShaderMaterial({
    vertexShader: RIBBON_VS,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity;
      varying float vSide;
      void main() {
        float a = smoothstep(1.0, 0.6, abs(vSide)) * uOpacity;
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor, a);
        #include <colorspace_fragment>
      }`,
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 1 } },
    transparent: true,
    depthWrite: false,
  });
}

// ---------- sparks ----------
export class Sparks {
  constructor(max = 900) {
    this.max = max;
    this.n = 0;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.ttl = new Float32Array(max);
    this.size = new Float32Array(max);
    this.kind = new Float32Array(max); // 0 spark, 1 ember (slow, glowing), 2 stream mote, 3 firework
    this.tint = new Float32Array(max * 3);
    this.target = new Float32Array(max * 3);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage);
    this.aLife = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aKind = new THREE.BufferAttribute(this.kind, 1).setUsage(THREE.DynamicDrawUsage);
    this.aTint = new THREE.BufferAttribute(this.tint, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('life', this.aLife);
    g.setAttribute('psize', this.aSize);
    g.setAttribute('kind', this.aKind);
    g.setAttribute('tint', this.aTint);
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 800 }, uHot: { value: COLORS.hot }, uWarm: { value: COLORS.warm }, uEmber: { value: COLORS.ember } },
      vertexShader: /* glsl */ `
        attribute float life; attribute float psize; attribute float kind; attribute vec3 tint;
        uniform float uScale;
        varying float vLife; varying float vKind; varying vec3 vTint;
        void main() {
          vLife = life; vKind = kind; vTint = tint;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = max(1.0, psize * uScale / -mv.z * (kind > 0.5 ? 1.0 : (0.55 + 0.45 * (1.0 - life))));
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uHot; uniform vec3 uWarm; uniform vec3 uEmber;
        varying float vLife; varying float vKind; varying vec3 vTint;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d) * 2.0;
          float core = smoothstep(1.0, 0.0, r);
          core *= core;
          vec3 col = vKind > 1.5 ? mix(uHot, uWarm, vLife) : mix(mix(uHot, uWarm, smoothstep(0.0, 0.45, vLife)), uEmber, smoothstep(0.45, 1.0, vLife));
          float a = core * (vKind > 1.5 ? sin(3.14159 * clamp(vLife, 0.0, 1.0)) : (1.0 - vLife * vLife));
          if (vKind > 2.5) { col = vTint * (1.25 - 0.55 * vLife); a = core * pow(1.0 - clamp(vLife, 0.0, 1.0), 1.6); }
          gl_FragColor = vec4(col * a, a);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 78; // over the text's backing, under the words
    this.geo = g;
  }

  clear() { this.n = 0; this.geo.setDrawRange(0, 0); }

  emit(x, y, z, count, opts = {}) {
    for (let k = 0; k < count; k++) {
      if (this.n >= this.max) return;
      const i = this.n++;
      const a = Math.random() * Math.PI * 2;
      const up = opts.spread ?? 1;
      const sp = (opts.speed ?? 0.45) * (0.35 + Math.random() * 0.9);
      this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
      this.v[i * 3] = Math.cos(a) * sp;
      this.v[i * 3 + 1] = Math.sin(a) * sp * up + (opts.lift ?? 0.05);
      this.v[i * 3 + 2] = (Math.random() * 0.8 + 0.1) * sp * (opts.depth ?? 0.7);
      this.life[i] = 0;
      this.ttl[i] = (opts.ttl ?? 0.6) * (0.5 + Math.random() * 0.9);
      this.size[i] = (opts.size ?? 0.012) * (0.5 + Math.random());
      this.kind[i] = opts.kind ?? 0;
      this.tint[i * 3] = this.tint[i * 3 + 1] = this.tint[i * 3 + 2] = 0;
    }
  }

  // a far firework: a ring of coloured sparks that drifts and fades
  burst(x, y, z, color, count) {
    const n0 = this.n;
    this.emit(x, y, z, count, { speed: 0.12, ttl: 1.15, size: 0.0065, kind: 3, lift: 0, depth: 0.15, spread: 1 });
    for (let i = n0; i < this.n; i++) {
      const a = ((i - n0) / count) * Math.PI * 2;
      const sp = 0.07 + Math.random() * 0.06;
      this.v[i * 3] = Math.cos(a) * sp;
      this.v[i * 3 + 1] = Math.sin(a) * sp;
      this.v[i * 3 + 2] = 0.01;
      this.tint[i * 3] = color.r; this.tint[i * 3 + 1] = color.g; this.tint[i * 3 + 2] = color.b;
    }
  }

  // A mote that flies from (x,y,z) to (tx,ty,tz) along a rising curve, over ttl seconds.
  stream(x, y, z, tx, ty, tz, ttl, size) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = x; this.v[i * 3 + 1] = y; this.v[i * 3 + 2] = z; // start, kept in v
    this.target[i * 3] = tx; this.target[i * 3 + 1] = ty; this.target[i * 3 + 2] = tz;
    this.life[i] = 0;
    this.ttl[i] = ttl;
    this.size[i] = size;
    this.kind[i] = 2;
  }

  update(dt) {
    const g = -0.95, drag = Math.exp(-1.6 * dt);
    const life = this.aLife.array;
    let j = 0;
    for (let i = 0; i < this.n; i++) {
      const L = this.life[i] + dt / this.ttl[i];
      if (L >= 1) {
        // a sparkler's sparks fork as they die
        if (this.kind[i] === 0 && Math.random() < 0.18 && this.n + 3 < this.max)
          this.emit(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2], 2, { speed: 0.22, ttl: 0.18, size: 0.006, lift: 0 });
        continue;
      }
      // compact into slot j
      const k3 = i * 3, j3 = j * 3;
      if (this.kind[i] === 2) {
        const t = Math.max(0, L), e = t * t * (3 - 2 * t);
        const sx = this.v[k3], sy = this.v[k3 + 1], sz = this.v[k3 + 2];
        const tx = this.target[k3], ty = this.target[k3 + 1], tz = this.target[k3 + 2];
        const lift = Math.sin(Math.PI * t) * 0.12;
        this.p[j3] = sx + (tx - sx) * e + Math.sin(t * 9 + i) * 0.004;
        this.p[j3 + 1] = sy + (ty - sy) * e;
        this.p[j3 + 2] = sz + (tz - sz) * e + lift;
        this.v[j3] = sx; this.v[j3 + 1] = sy; this.v[j3 + 2] = sz;
        this.target[j3] = tx; this.target[j3 + 1] = ty; this.target[j3 + 2] = tz;
        if (L > 0 && L < 0.97 && Math.random() < 0.18 && this.n < this.max - 1)
          this.emit(this.p[j3], this.p[j3 + 1], this.p[j3 + 2], 1, { speed: 0.015, ttl: 0.4, size: this.size[i] * 0.55, kind: 1, lift: 0 });
      } else {
        const fall = this.kind[i] === 1 ? 0.25 : this.kind[i] === 3 ? 0.12 : 1;
        this.v[j3] = this.v[k3] * drag;
        this.v[j3 + 1] = this.v[k3 + 1] * drag + g * fall * dt;
        this.v[j3 + 2] = this.v[k3 + 2] * drag;
        this.p[j3] = this.p[k3] + this.v[j3] * dt;
        this.p[j3 + 1] = this.p[k3 + 1] + this.v[j3 + 1] * dt;
        this.p[j3 + 2] = this.p[k3 + 2] + this.v[j3 + 2] * dt;
      }
      this.life[j] = L;
      this.ttl[j] = this.ttl[i];
      this.size[j] = this.size[i];
      this.kind[j] = this.kind[i];
      this.tint[j3] = this.tint[k3]; this.tint[j3 + 1] = this.tint[k3 + 1]; this.tint[j3 + 2] = this.tint[k3 + 2];
      life[j] = L;
      j++;
    }
    this.n = j;
    this.geo.setDrawRange(0, j);
    this.aPos.needsUpdate = this.aLife.needsUpdate = this.aSize.needsUpdate = this.aKind.needsUpdate = this.aTint.needsUpdate = true;
  }
}

// ---------- additive sprites in the card plane ----------
export function glowQuad(tex, size, color, renderOrder = 40) {
  const m = new THREE.MeshBasicMaterial({
    map: tex, color: new THREE.Color(color), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, opacity: 0, toneMapped: false,
  });
  const q = new THREE.Mesh(new THREE.PlaneGeometry(size, size), m);
  q.renderOrder = renderOrder;
  return q;
}
