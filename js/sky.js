// Fireworks all around the card: rockets rise from behind it, burst in the space around it, and
// fountains burn below it. Everything sits behind the card in depth and is drawn before it, so the
// card covers what passes behind it, and it all moves with the card. Card units: width 1, y up, +z
// towards the viewer, the card at z = 0. Only cards that ask for it build this.
//
// Each spark is a short streak from where it is back along its path, the way a real one reads to
// the eye: long and thin while it is fast, a point of light when it has slowed and hangs.
import * as THREE from '../lib/three.module.min.js';
import { glowQuad, radialTexture } from './fx.js?v=8d6e5edd83';

const STAR = 1, EMBER = 2, POP = 3, FOUNTAIN = 4;
const MAX = 3000;
const c = (hex) => new THREE.Color(hex);
const PALETTES = [
  [c('#ffb020'), c('#ffe08a')], // gold
  [c('#ff2f74'), c('#ffb3c9')], // rose
  [c('#ff7a12'), c('#ffc76e')], // saffron
  [c('#ffe9c4'), c('#ffb84a')], // white gold
  [c('#8a5bff'), c('#e0ccff')], // violet
];
const EMBER_COLOUR = c('#ff7a1a');
const WHITE = c('#ffffff');
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// The running order: when each rocket goes up. Fixed for a card, so Replay is the same show.
export function planShow({ draw, fromWrite, quiet = [], volleys = [] }) {
  let seed = 41;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const inQuiet = (t) => quiet.some(([a, b]) => t > a && t < b);
  const rockets = [];
  const add = (burstAt, style, zone, power, palette) => {
    const flight = zone === 'low' ? 0.55 + rnd() * 0.1 : 1.05 + rnd() * 0.25;
    rockets.push({ t: burstAt - flight, flight, style, zone, power, palette: palette ?? Math.floor(rnd() * PALETTES.length), r: [rnd(), rnd(), rnd(), rnd()] });
  };
  const STYLES = ['peony', 'chrys', 'ring', 'crackle', 'willow'];
  const zoneAt = () => { const z = rnd(); return z < 0.45 ? 'top' : z < 0.8 ? 'side' : z < 0.95 ? 'low' : 'behind'; };
  for (let t = draw[0] + 1.0; t < fromWrite[0]; t += 1.3 + rnd() * 1.1) {
    if (!inQuiet(t)) add(t, STYLES[Math.floor(rnd() * STYLES.length)], zoneAt(), 0.75 + rnd() * 0.2);
  }
  // far off, small and often, so the sky has depth; these stop for the quiet too
  for (let t = draw[0] + 0.5; t < fromWrite[0] + 3; t += 0.7 + rnd() * 0.8) {
    if (!inQuiet(t)) add(t, 'far', 'far', 0.5 + rnd() * 0.3);
  }
  for (const v of volleys) {
    add(v, 'willow', 'behind', 1.15, 0);
    add(v + 0.3, 'peony', 'top', 1);
    add(v + 0.6, 'chrys', 'side', 0.95);
    add(v + 0.85, 'crackle', 'top', 0.9);
  }
  for (let i = 0; i < 8; i++) add(fromWrite[0] + i * 0.38, i % 3 === 0 ? 'willow' : i % 3 === 1 ? 'chrys' : 'peony', i % 2 ? 'top' : 'side', 1.05);
  return rockets.sort((a, b) => a.t - b.t);
}

function place(zone, r) {
  if (zone === 'top') return [(r[0] - 0.5) * 1.5, 0.95 + r[1] * 0.55, -(0.6 + r[2] * 0.9)];
  if (zone === 'side') return [(r[3] < 0.5 ? -1 : 1) * (0.62 + r[0] * 0.35), -0.35 + r[1] * 1.1, -(0.5 + r[2] * 0.7)];
  if (zone === 'low') return [(r[0] - 0.5) * 1.3, -(0.9 + r[1] * 0.35), -(0.6 + r[2] * 0.6)];
  if (zone === 'far') return [(r[0] - 0.5) * 2.8, -0.6 + r[1] * 2.5, -(2.2 + r[2])];
  return [(r[0] - 0.5) * 0.5, 0.1 + r[1] * 0.5, -0.9]; // right behind the card: only what gets past its edges shows
}

function streakMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 800 }, uView: { value: new THREE.Vector2(800, 1600) } },
    vertexShader: /* glsl */ `
      attribute vec2 corner; attribute vec3 iHead; attribute vec3 iTail; attribute vec3 iCol; attribute float iW; attribute float iA;
      uniform float uScale; uniform vec2 uView;
      varying vec2 vP; varying float vLen; varying float vW; varying vec3 vCol; varying float vA;
      void main() {
        vec4 mh = modelViewMatrix * vec4(iHead, 1.0);
        vec4 ch = projectionMatrix * mh;
        vec4 ct = projectionMatrix * modelViewMatrix * vec4(iTail, 1.0);
        vec2 sh = ch.xy / ch.w * uView * 0.5, st = ct.xy / ct.w * uView * 0.5; // in pixels
        vec2 along = sh - st;
        float len = length(along);
        vec2 d = len > 0.001 ? along / len : vec2(0.0, 1.0);
        vec2 n = vec2(-d.y, d.x);
        float w = max(1.2, iW * uScale / -mh.z);
        vec2 p = mix(st, sh, corner.x) + d * (corner.x * 2.0 - 1.0) * w + n * corner.y * w;
        vec4 cl = mix(ct, ch, corner.x);
        gl_Position = vec4(p / (uView * 0.5) * cl.w, cl.z, cl.w);
        vP = vec2(corner.x * len + (corner.x * 2.0 - 1.0) * w, corner.y * w);
        vLen = len; vW = w; vCol = iCol; vA = iA;
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vP; varying float vLen; varying float vW; varying vec3 vCol; varying float vA;
      void main() {
        float dx = max(max(-vP.x, vP.x - vLen), 0.0);
        float r = sqrt(dx * dx + vP.y * vP.y) / vW;
        float t = vLen > 0.001 ? clamp(vP.x / vLen, 0.0, 1.0) : 1.0; // 0 at the tail, 1 at the head
        float body = mix(0.12, 1.0, t * t);
        float core = exp(-r * r * 22.0);
        float halo = exp(-r * r * 3.5) * smoothstep(1.0, 0.75, r);
        float a = (core + 0.42 * halo) * body * vA;
        if (a < 0.003) discard;
        gl_FragColor = vec4(mix(vCol, vec3(1.0), core * t * t * 0.22), min(a * 1.15, 1.0));
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
}

export class SkyShow {
  constructor(rockets, { fountainsFrom = Infinity, finale = Infinity, end = Infinity } = {}) {
    this.plan = rockets;
    this.fountainsFrom = fountainsFrom;
    this.finale = finale;
    this.end = end;
    this.group = new THREE.Group();
    this.quality = 1;
    this.slow = 0;
    this.flash = 0;
    this.onBurst = null;

    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.ttl = new Float32Array(MAX);
    this.size = new Float32Array(MAX);
    this.drag = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    this.every = new Float32Array(MAX); // seconds between trail embers; 0 for none
    this.clock = new Float32Array(MAX);
    this.streak = new Float32Array(MAX); // how many seconds of its path a spark shows behind it
    this.kind = new Uint8Array(MAX);

    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), 2));
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3)); // unused, but three.js wants it
    g.setIndex([0, 1, 2, 2, 1, 3]);
    const inst = (name, n) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX * n), n).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
      return a;
    };
    this.aHead = inst('iHead', 3);
    this.aTail = inst('iTail', 3);
    this.aCol = inst('iCol', 3);
    this.aW = inst('iW', 1);
    this.aA = inst('iA', 1);
    g.instanceCount = 0;
    this.geo = g;
    this.mat = streakMaterial();
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3; // before the soft edge round the card (5) and the card itself (11 up)
    this.group.add(this.mesh);

    const tex = radialTexture([[0, 'rgba(255,240,215,0.75)'], [0.25, 'rgba(255,205,150,0.3)'], [0.6, 'rgba(255,170,110,0.07)'], [1, 'rgba(255,150,90,0)']], 128);
    this.flashes = Array.from({ length: 4 }, () => {
      const q = glowQuad(tex, 1, '#ffffff', 2);
      q.material.depthTest = false;
      this.group.add(q);
      return { q, level: 0 };
    });
    const baseTex = radialTexture([[0, 'rgba(255,235,190,1)'], [0.3, 'rgba(255,180,90,0.45)'], [1, 'rgba(255,140,60,0)']], 64);
    this.fountains = [[-0.62, -1.02, -0.35], [0.62, -1.02, -0.35]].map(([x, y, z]) => {
      const q = glowQuad(baseTex, 0.3, '#ffffff', 2);
      q.material.depthTest = false;
      q.position.set(x, y, z);
      this.group.add(q);
      return { x, y, z, q, acc: 0, seed: x * 40 };
    });
    this.reset();
  }

  reset() {
    this.n = 0;
    this.next = 0;
    this.rockets = [];
    this.idleAt = Infinity;
    this.flash = 0;
    for (const f of this.flashes) { f.level = 0; f.q.material.opacity = 0; }
    this.geo.instanceCount = 0;
  }

  _spawn(x, y, z, vx, vy, vz, ttl, size, col, kind, drag, grav, every, streak) {
    if (this.n >= MAX) return -1;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = col.r; this.col[i * 3 + 1] = col.g; this.col[i * 3 + 2] = col.b;
    this.life[i] = 0; this.ttl[i] = ttl; this.size[i] = size; this.kind[i] = kind;
    this.drag[i] = drag; this.grav[i] = grav; this.every[i] = every; this.clock[i] = every * Math.random();
    this.streak[i] = streak;
    return i;
  }

  _trailColour(r, g, b) {
    const t = (this._trail ||= { r: 0, g: 0, b: 0 });
    t.r = (r + EMBER_COLOUR.r) / 2;
    t.g = (g + EMBER_COLOUR.g) / 2;
    t.b = (b + EMBER_COLOUR.b) / 2;
    return t;
  }

  _launch(p) {
    const [x, y, z] = place(p.zone, p.r);
    const g = 0.55, x0 = x + (p.r[3] - 0.5) * 0.25, y0 = -1.5;
    const vy = (y - y0) / p.flight + 0.5 * g * p.flight;
    this.rockets.push({ x: x0, y: y0, z, vx: (x - x0) / p.flight, vy, age: 0, g, flight: p.flight, style: p.style, power: p.power, palette: p.palette, clock: 0 });
  }

  _burst(r) {
    const pal = PALETTES[r.palette % PALETTES.length];
    const s = 1.35 * r.power, q = this.quality;
    const rand = (a, b) => a + Math.random() * (b - a);
    const sphere = (speed) => {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, w = Math.sqrt(1 - u * u);
      return [Math.cos(a) * w * speed, u * speed, Math.sin(a) * w * speed];
    };
    const many = (count, fn) => { const n = Math.round(count * q); for (let i = 0; i < n; i++) fn(i, n); };
    if (r.style === 'far') {
      many(36, () => { const v = sphere(s * rand(0.7, 1)); this._spawn(r.x, r.y, r.z, v[0], v[1], v[2], rand(0.9, 1.3), 0.022, pal[0], STAR, 1.9, 0.2, 0, 0.12); });
      if (this.onBurst) this.onBurst(0.25, r.x);
      return; // too far off to light anything
    }
    if (r.style === 'peony') {
      many(110, (i) => { const v = sphere(s * rand(0.84, 1)); this._spawn(r.x, r.y, r.z, v[0], v[1], v[2], rand(1.2, 1.7), 0.015, i % 4 ? pal[0] : pal[1], STAR, 1.8, 0.22, 0, 0.16); });
    } else if (r.style === 'chrys') {
      many(84, () => { const v = sphere(s * rand(1, 1.2)); this._spawn(r.x, r.y, r.z, v[0], v[1], v[2], rand(1.5, 2), 0.013, pal[0], STAR, 1.5, 0.3, 0.07, 0.3); });
    } else if (r.style === 'willow') {
      many(70, () => { const v = sphere(s * rand(0.7, 0.9)); this._spawn(r.x, r.y, r.z, v[0], v[1], v[2], rand(2.4, 3.2), 0.012, PALETTES[0][0], STAR, 1.1, 0.5, 0.06, 0.42); });
    } else if (r.style === 'ring') {
      const t1 = rand(0, Math.PI), t2 = rand(0, Math.PI * 2);
      many(64, (i, n) => {
        const a = (i / n) * Math.PI * 2, x = Math.cos(a), y = Math.sin(a);
        const vx = x * Math.cos(t2) - y * Math.sin(t2) * Math.cos(t1), vy = x * Math.sin(t2) + y * Math.cos(t2) * Math.cos(t1), vz = y * Math.sin(t1);
        this._spawn(r.x, r.y, r.z, vx * s, vy * s, vz * s, rand(1.3, 1.6), 0.015, pal[0], STAR, 1.7, 0.2, 0, 0.14);
      });
      many(26, () => { const v = sphere(s * 0.4); this._spawn(r.x, r.y, r.z, v[0], v[1], v[2], rand(1, 1.3), 0.013, pal[1], STAR, 2, 0.2, 0, 0.12); });
    } else {
      many(80, () => { const v = sphere(s * rand(0.72, 0.98)); const k = this._spawn(r.x, r.y, r.z, v[0], v[1], v[2], rand(1.1, 1.5), 0.013, pal[1], STAR, 1.8, 0.25, 0, 0.14); if (k >= 0) this.kind[k] = POP; });
    }
    const f = this.flashes.reduce((a, b) => (a.level < b.level ? a : b));
    f.level = 0.85 * r.power;
    f.q.position.set(r.x, r.y, r.z - 0.02);
    f.q.scale.setScalar(3.4 * r.power);
    f.q.material.color.copy(pal[0]).lerp(WHITE, 0.45);
    if (this.onBurst) this.onBurst(r.power, r.x);
  }

  update(t, dt, time, scale) {
    this.mat.uniforms.uScale.value = scale;
    if (!dt) return;
    // a phone that is struggling gets a smaller show, never a slower card
    this.slow = this.slow * 0.97 + dt * 0.03;
    if (this.slow > 1 / 26 && this.quality > 0.35) { this.quality *= 0.7; this.slow = 1 / 40; }

    while (this.next < this.plan.length && this.plan[this.next].t <= t) {
      const p = this.plan[this.next++];
      if (t - p.t < 4) this._launch(p);
    }
    // after the sequence it keeps going, gently, with one going up every few seconds
    if (t > this.end) {
      if (this.idleAt === Infinity) this.idleAt = t + 1;
      if (t >= this.idleAt) {
        this.idleAt = t + 2 + Math.random() * 1.6;
        const r = [Math.random(), Math.random(), Math.random(), Math.random()];
        const styles = ['peony', 'chrys', 'ring', 'willow', 'crackle'];
        this._launch({ zone: r[0] < 0.55 ? 'top' : 'side', r, flight: 1.1, style: styles[Math.floor(r[1] * 5)], power: 0.85, palette: Math.floor(r[2] * PALETTES.length) });
      }
    }

    for (let k = this.rockets.length - 1; k >= 0; k--) {
      const r = this.rockets[k];
      r.age += dt;
      r.vy -= r.g * dt;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.clock -= dt;
      if (r.clock <= 0) {
        r.clock = 0.03;
        this._spawn(r.x, r.y, r.z, (Math.random() - 0.5) * 0.05, -0.08, 0, 0.42, 0.007, EMBER_COLOUR, EMBER, 1.5, 0.3, 0, 0.03);
      }
      this._spawn(r.x, r.y, r.z, r.vx, r.vy, 0, 0.03, 0.012, PALETTES[3][0], EMBER, 0, 0, 0, 0.06);
      if (r.age >= r.flight) {
        this._burst(r);
        this.rockets.splice(k, 1);
      }
    }

    // the fountains below the card: from the given time, and hardest at the end
    const level = smooth(this.fountainsFrom, this.fountainsFrom + 1.5, t) * (0.45 + 0.55 * smooth(this.finale - 0.5, this.finale + 1, t));
    for (const f of this.fountains) {
      f.q.material.opacity = level * (0.6 + 0.3 * Math.sin(time * 19 + f.seed));
      f.acc += dt * 110 * level * this.quality;
      while (f.acc >= 1) {
        f.acc -= 1;
        const a = (Math.random() - 0.5) * 0.5, sp = 1 + Math.random() * 0.75;
        const col = Math.random() < 0.3 ? PALETTES[3][0] : PALETTES[0][0];
        this._spawn(f.x, f.y, f.z, Math.sin(a) * sp, Math.cos(a) * sp, (Math.random() - 0.5) * 0.15, 0.7 + Math.random() * 0.55, 0.009, col, FOUNTAIN, 0.5, 1.15, 0, 0.07);
      }
    }

    // everything in the air
    const head = this.aHead.array, tail = this.aTail.array, tint = this.aCol.array, wide = this.aW.array, glow = this.aA.array;
    const n0 = this.n;
    let j = 0;
    for (let i = 0; i < n0; i++) {
      const L = this.life[i] + dt / this.ttl[i];
      const kind = this.kind[i];
      const a3 = i * 3;
      if (L >= 1) {
        if (kind === POP) {
          for (let m = 0; m < 3; m++) this._spawn(this.pos[a3], this.pos[a3 + 1], this.pos[a3 + 2], (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, 0, 0.13, 0.012, WHITE, EMBER, 1, 0, 0, 0.02);
        }
        continue;
      }
      const b3 = j * 3;
      const d = Math.exp(-this.drag[i] * dt);
      const vx = this.vel[a3] * d, vy = this.vel[a3 + 1] * d - this.grav[i] * dt, vz = this.vel[a3 + 2] * d;
      const x = this.pos[a3] + vx * dt, y = this.pos[a3 + 1] + vy * dt, z = this.pos[a3 + 2] + vz * dt;
      const r = this.col[a3], g = this.col[a3 + 1], b = this.col[a3 + 2];
      let clock = this.clock[i];
      const every = this.every[i];
      if (every > 0) {
        clock -= dt;
        if (clock <= 0) {
          clock = every;
          this._spawn(x, y, z, 0, -0.02, 0, 0.5 + Math.random() * 0.5, 0.007, this._trailColour(r, g, b), EMBER, 1, 0.2, 0, 0.02);
        }
      }
      this.pos[b3] = x; this.pos[b3 + 1] = y; this.pos[b3 + 2] = z;
      this.vel[b3] = vx; this.vel[b3 + 1] = vy; this.vel[b3 + 2] = vz;
      this.col[b3] = r; this.col[b3 + 1] = g; this.col[b3 + 2] = b;
      const streak = this.streak[i], size = this.size[i], ttl = this.ttl[i], drag = this.drag[i], grav = this.grav[i];
      this.life[j] = L; this.ttl[j] = ttl; this.size[j] = size; this.kind[j] = kind;
      this.drag[j] = drag; this.grav[j] = grav; this.every[j] = every; this.clock[j] = clock; this.streak[j] = streak;
      // how it looks now: white-hot at birth, cooling towards ember, and for stars a late twinkle
      const hot = Math.max(0, 1 - L / 0.06);
      const cool = kind === EMBER || kind === FOUNTAIN ? L * 0.7 : L * L * 0.6;
      tint[b3] = (r + (EMBER_COLOUR.r - r) * cool) * (1 - hot) + hot;
      tint[b3 + 1] = (g + (EMBER_COLOUR.g - g) * cool) * (1 - hot) + hot;
      tint[b3 + 2] = (b + (EMBER_COLOUR.b - b) * cool) * (1 - hot) + hot;
      let alpha;
      if (kind === EMBER) alpha = (1 - L) * (1 - L) * 0.9;
      else if (kind === FOUNTAIN) alpha = Math.pow(1 - L, 0.9);
      else alpha = L < 0.55 ? 1 : Math.pow(1 - (L - 0.55) / 0.45, 1.4) * (0.65 + 0.35 * Math.sin(time * 34 + i));
      glow[j] = alpha;
      wide[j] = size * (L < 0.6 ? 1 : 1 - 0.7 * (L - 0.6));
      head[b3] = x; head[b3 + 1] = y; head[b3 + 2] = z;
      tail[b3] = x - vx * streak; tail[b3 + 1] = y - vy * streak; tail[b3 + 2] = z - vz * streak;
      j++;
    }
    // what was spawned during this pass sits after n0: move it down
    for (let i = n0; i < this.n; i++, j++) {
      const a3 = i * 3, b3 = j * 3;
      for (let m = 0; m < 3; m++) {
        this.pos[b3 + m] = this.pos[a3 + m];
        this.vel[b3 + m] = this.vel[a3 + m];
        this.col[b3 + m] = this.col[a3 + m];
        tint[b3 + m] = this.col[a3 + m];
        head[b3 + m] = tail[b3 + m] = this.pos[a3 + m];
      }
      this.life[j] = 0; this.ttl[j] = this.ttl[i]; this.size[j] = this.size[i]; this.kind[j] = this.kind[i];
      this.drag[j] = this.drag[i]; this.grav[j] = this.grav[i]; this.every[j] = this.every[i]; this.clock[j] = this.clock[i]; this.streak[j] = this.streak[i];
      glow[j] = 1;
      wide[j] = this.size[j];
    }
    this.n = j;
    this.geo.instanceCount = j;
    this.aHead.needsUpdate = this.aTail.needsUpdate = this.aCol.needsUpdate = this.aW.needsUpdate = this.aA.needsUpdate = true;

    let top = 0;
    for (const f of this.flashes) {
      f.level *= Math.exp(-dt / 0.16);
      f.q.material.opacity = f.level;
      top = Math.max(top, f.level);
    }
    this.flash = top * 1.2;
  }
}
