// What fills the room round a card placed on a real surface: a rangoli on the surface in front of it,
// diyas round that and away to both sides, a marigold arch, hanging lanterns, strings of lights,
// petals that fall and stay, and dust in the air. World units are card widths: x along the card, y up
// from the surface, +z towards whoever placed it. All of it is a function of t, so Replay is exact.
import * as THREE from '../lib/three.module.min.js';
import { radialTexture } from './fx.js?v=748e8ec2ef';
import { paintStrand, paintSwag } from './marigold.js?v=748e8ec2ef';
import { Sprites, FREE, STAND, FLAT, canvasTexture, flameTexture } from './sprites.js?v=748e8ec2ef';

const DEG = Math.PI / 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeBack = (x) => { const t = clamp(x, 0, 1) - 1; return 1 + 2.2 * t * t * t + 1.2 * t * t; };

const NIGHT = '#1f1650', CREAM = '#ffe9c0', GOLD = '#ffc94d', MARIGOLD = '#f6ad2b', ORANGE = '#f2862b', ROSE = '#e9467a';
const RANGOLI = { z: 0.62, size: 0.96 };
const ARCH = { top: 1.92, sag: 0.16, half: 1.1, flower: 0.03 };

function sheet(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

// a petal from radius r0 out to a point at r1, widest about two-fifths of the way along
function petal(g, a, r0, r1, w) {
  const c = Math.cos(a), s = Math.sin(a);
  const P = (r, o) => [r * c - o * s, r * s + o * c];
  const m = r0 + (r1 - r0) * 0.42;
  const near = m - (m - r0) * 0.4, far = m + (r1 - m) * 0.25;
  g.beginPath();
  g.moveTo(...P(r0, 0));
  g.bezierCurveTo(...P(near, w), ...P(far, w), ...P(r1, 0));
  g.bezierCurveTo(...P(far, -w), ...P(near, -w), ...P(r0, 0));
  g.closePath();
}

function paintRangoli() {
  const [c, g] = sheet(1024, 1024);
  g.translate(512, 512);
  const TAU = Math.PI * 2;
  const disc = (r, col) => { g.fillStyle = col; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill(); };
  const ring = (n, fn, turn = 0) => { for (let k = 0; k < n; k++) fn(turn + (k / n) * TAU, k); };
  const dot = (a, r, size, col) => { g.fillStyle = col; g.beginPath(); g.arc(Math.cos(a) * r, Math.sin(a) * r, size, 0, TAU); g.fill(); };
  const leaf = (a, r0, r1, w, col) => {
    petal(g, a, r0, r1, w);
    g.fillStyle = col;
    g.fill();
    g.strokeStyle = CREAM;
    g.lineWidth = 7;
    g.stroke();
  };
  ring(36, (a) => dot(a, 480, 30, MARIGOLD));
  disc(474, CREAM);
  disc(464, NIGHT);
  ring(36, (a) => dot(a, 436, 10, CREAM));
  ring(18, (a, k) => leaf(a, 296, 418, 42, k % 2 ? ORANGE : ROSE));
  disc(300, NIGHT);
  ring(8, (a, k) => leaf(a, 90, 380, 122, k % 2 ? ORANGE : ROSE));
  ring(8, (a) => leaf(a, 90, 296, 66, GOLD), Math.PI / 8);
  ring(8, (a) => { g.fillStyle = CREAM; petal(g, a, 150, 262, 15); g.fill(); });
  disc(102, CREAM);
  disc(92, NIGHT);
  ring(12, (a) => dot(a, 70, 11, GOLD));
  disc(44, ROSE);
  disc(20, CREAM);
  // the grain of coloured powder
  g.globalCompositeOperation = 'source-atop';
  let seed = 31;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(18,10,46,0.16)' : 'rgba(255,236,196,0.13)';
    g.fillRect(rnd() * 1024 - 512, rnd() * 1024 - 512, 2 + rnd() * 3, 2 + rnd() * 3);
  }
  return canvasTexture(c);
}

function paintKandil(main, side) {
  const [c, g] = sheet(220, 380);
  const cx = 110;
  const poly = (pts, fill) => {
    g.beginPath();
    pts.forEach((p, k) => (k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    g.strokeStyle = CREAM;
    g.lineWidth = 5;
    g.lineJoin = 'round';
    g.stroke();
  };
  [[72, side], [110, main], [148, side]].forEach(([x, col]) => {
    g.fillStyle = col;
    g.fillRect(x - 10, 240, 20, 124);
    g.strokeStyle = 'rgba(255,233,192,0.75)';
    g.lineWidth = 2;
    for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(x + i * 6, 250); g.lineTo(x + i * 6, 362); g.stroke(); }
    g.fillStyle = GOLD;
    g.fillRect(x - 12, 236, 24, 14);
  });
  const top = [cx, 16], ur = [198, 98], lr = [198, 176], bottom = [cx, 258], ll = [22, 176], ul = [22, 98];
  const midL = [cx - 54, 137], midR = [cx + 54, 137];
  poly([top, ur, midR], side);
  poly([ur, lr, midR], main);
  poly([lr, bottom, midR], side);
  poly([top, ul, midL], side);
  poly([ul, ll, midL], main);
  poly([ll, bottom, midL], side);
  poly([top, midR, bottom, midL], GOLD);
  g.fillStyle = CREAM;
  g.beginPath();
  g.arc(cx, 8, 7, 0, Math.PI * 2);
  g.fill();
  g.globalCompositeOperation = 'lighter';
  const glow = g.createRadialGradient(cx, 137, 4, cx, 137, 112);
  glow.addColorStop(0, 'rgba(255,236,180,0.26)');
  glow.addColorStop(1, 'rgba(255,190,90,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 220, 380);
  return canvasTexture(c);
}

function paintPetal() {
  const [c, g] = sheet(32, 48);
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(16, 2);
  g.bezierCurveTo(29, 12, 30, 34, 16, 46);
  g.bezierCurveTo(2, 34, 3, 12, 16, 2);
  g.fill();
  g.fillStyle = 'rgba(120,50,10,0.3)';
  g.fillRect(15, 10, 2, 30);
  return canvasTexture(c);
}

function paintThread() {
  const [c, g] = sheet(8, 256);
  const fade = g.createLinearGradient(0, 0, 0, 256);
  fade.addColorStop(0, 'rgba(255,233,192,0)');
  fade.addColorStop(0.5, 'rgba(255,233,192,0.5)');
  fade.addColorStop(1, 'rgba(255,233,192,0.7)');
  g.fillStyle = fade;
  g.fillRect(3, 0, 2, 256);
  return canvasTexture(c);
}

// a sagging line of points between two ends, about `gap` apart
function chain(a, b, sag, gap) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const n = Math.max(2, Math.round(L / gap));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    pts.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u - sag * 4 * u * (1 - u), a[2] + (b[2] - a[2]) * u]);
  }
  return pts;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    this.textures = [];
    let seed = 73;
    this.rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // a card can hold all this back: built quietly on its first line, lit only later
    const b = scene.bridge;
    this.plan = b ? { shift: scene.T.lines[0] + 1.6, glow: b.glow, show: b.show } : null;
    this._buildRangoli();
    this._buildArch();
    this._buildDiyas();
    this._buildLanterns();
    this._buildLights();
    this._buildAir();
  }

  _add(batch) {
    this.group.add(batch.mesh);
    this.textures.push(batch.mat.uniforms.map.value);
    return batch;
  }

  // so the first frame after placing does not stall on uploading all of this
  warm(renderer) {
    for (const t of this.textures) renderer.initTexture(t);
  }

  _buildRangoli() {
    const map = paintRangoli();
    this.textures.push(map);
    this.rangoliU = { map: { value: map }, uP: { value: 0 }, uLight: { value: 1 } };
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(RANGOLI.size, RANGOLI.size).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        uniforms: this.rangoliU,
        vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D map; uniform float uP; uniform float uLight; varying vec2 vUv;
          void main() {
            vec4 c = texture2D(map, vUv);
            vec2 p = vUv - 0.5;
            float r = length(p) * 2.0;
            float edge = uP * 1.14 + 0.02 * sin(atan(p.y, p.x) * 16.0);
            float show = 1.0 - smoothstep(edge - 0.05, edge, r);
            float rim = smoothstep(edge - 0.1, edge - 0.02, r) * show * (1.0 - smoothstep(0.98, 1.0, uP));
            float a = c.a * show;
            if (a < 0.004) discard;
            gl_FragColor = vec4(c.rgb * uLight + vec3(1.0, 0.72, 0.32) * rim * 1.3, a);
            #include <colorspace_fragment>
          }`,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      })
    );
    mesh.position.set(0, 0.004, RANGOLI.z);
    mesh.frustumCulled = false;
    mesh.renderOrder = 100;
    this.group.add(mesh);
  }

  _buildArch() {
    const { top, sag, half, flower: R } = ARCH;
    const GAP = R * 1.55;
    const y = (x) => top - sag * (1 - Math.pow(x / half, 2));
    this.strands = [];
    // each length of string is painted once and hung in several places
    const hang = (length, seed, spots) => {
      const s = paintStrand(Math.round(length / GAP), R, GAP, seed, 420);
      const batch = this._add(new Sprites(canvasTexture(s.canvas), spots.length, { anchor: 1, order: 103 }));
      spots.forEach(([x, z, delay], i) => this.strands.push({ batch, i, x, y: y(x), z, w: s.w, h: s.h, at: delay, phase: x * 7 + seed }));
    };
    hang(y(0.74) - 0.02, 3, [[-0.74, -0.03, 0.62], [0.74, -0.03, 0.62]]);
    hang(1.34, 7, [[-0.87, 0.07, 0.74], [0.87, 0.07, 0.74]]);
    hang(0.84, 11, [[-1.0, -0.1, 0.86], [1.0, -0.1, 0.86]]);
    hang(0.16, 13, [[-0.2, 0.02, 0.56], [0.2, 0.02, 0.56], [-0.58, 0.02, 0.6], [0.58, 0.02, 0.6]]);
    hang(0.22, 17, [[0, 0.02, 0.52]]);
    const swag = paintSwag(y, -half, half, R, GAP * 0.96, 29, 420);
    this.swag = new THREE.Mesh(
      new THREE.PlaneGeometry(swag.w, swag.h),
      new THREE.MeshBasicMaterial({ map: canvasTexture(swag.canvas), transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, opacity: 0 })
    );
    this.textures.push(this.swag.material.map);
    this.swagAt = swag.cy;
    this.swag.position.set(swag.cx, swag.cy, 0);
    this.swag.renderOrder = 107;
    this.group.add(this.swag);
  }

  _buildDiyas() {
    const spots = [];
    const R = 0.58;
    for (let k = 0; k < 13; k++) {
      const a = (-118 + (k * 236) / 12) * DEG;
      spots.push({ x: Math.sin(a) * R, z: RANGOLI.z + Math.cos(a) * R });
    }
    for (const side of [-1, 1]) for (let j = 0; j < 6; j++) spots.push({ x: side * (0.8 + 0.17 * j), z: 0.3 - 0.15 * j + (j % 2) * 0.07 });
    // they catch from the middle outwards
    [...spots].sort((a, b) => Math.abs(a.x) - Math.abs(b.x)).forEach((d, k) => {
      d.appear = 0.3 + k * 0.022;
      d.onAt = 0.95 + k * 0.075;
      d.phase = this.rnd() * 6.28;
      d.scale = 0.92 + this.rnd() * 0.2;
    });
    if (this.plan) {
      const plan = this.plan, L = this.scene.T.lines;
      [...spots].sort((a, b) => Math.abs(a.x) - Math.abs(b.x)).forEach((d, k) => { d.appear = plan.shift + 0.3 + k * 0.022; d.onAt = plan.glow + 0.15 + k * 0.045; });
      // a lamp at each end, far apart; then one more for each of the next three lines, from the outside in
      [[-0.72, L[0] + 0.5], [0.72, L[0] + 0.9], [-0.36, L[2] + 0.6], [0.36, L[3] + 0.6], [0, L[4] + 0.6]].forEach(([x, at]) => {
        spots.push({ x, z: 0.1, appear: Math.min(at, plan.shift + 0.2) - 0.35, onAt: at, phase: this.rnd() * 6.28, scale: 1.55, lead: true });
      });
    }
    this.spots = spots;
    const n = spots.length;
    // when one lamp carries the card these go out early and catch again from the middle
    const m = this.scene.lamp;
    if (m) {
      [...spots].sort((a, b) => Math.abs(b.x) - Math.abs(a.x)).forEach((d, k) => { d.outAt = m.cityOut[1] - 0.5 + k * 0.06; });
      [...spots].sort((a, b) => Math.abs(a.x) - Math.abs(b.x)).forEach((d, k) => { d.backAt = m.passEnd - 0.35 + k * 0.05; });
    }
    const bowl = new THREE.Texture(this.scene.layerImgs[10]);
    bowl.colorSpace = THREE.SRGBColorSpace;
    bowl.anisotropy = 4;
    bowl.needsUpdate = true;
    this.bowlAspect = this.scene.layerImgs[10].height / this.scene.layerImgs[10].width;
    this.pools = this._add(new Sprites(radialTexture([[0, 'rgba(255,186,96,0.9)'], [0.35, 'rgba(255,146,60,0.32)'], [1, 'rgba(255,120,40,0)']], 128), n, { additive: true, order: 101 }));
    this.bowls = this._add(new Sprites(bowl, n, { anchor: 0, order: 108 }));
    this.flames = this._add(new Sprites(flameTexture(), n, { anchor: 0, order: 109 }));
    this.halos = this._add(new Sprites(radialTexture([[0, 'rgba(255,214,140,0.85)'], [0.3, 'rgba(255,160,70,0.3)'], [1, 'rgba(255,120,40,0)']], 64), n, { additive: true, order: 110 }));
  }

  _buildLanterns() {
    const hung = [
      [-0.42, 1.72, 0.04, 0.2, 1.22, 0], [0.42, 1.74, 0.04, 0.2, 1.3, 1],
      [-1.2, 1.74, 0.3, 0.24, 1.42, 1], [1.24, 1.68, 0.28, 0.24, 1.5, 0],
      [-1.72, 1.86, -0.5, 0.26, 1.6, 0], [1.76, 1.82, -0.44, 0.26, 1.66, 1],
      [-0.86, 2.12, -0.5, 0.22, 1.72, 1], [0.9, 2.14, -0.56, 0.22, 1.78, 0],
    ].map(([x, y, z, w, at, kind], k) => ({ x, y, z, w, h: (w * 380) / 220, at, kind, phase: k * 1.9 }));
    this.hung = hung;
    const of = (kind) => hung.filter((l) => l.kind === kind);
    this.kandils = [of(0), of(1)].map((list, k) => {
      const batch = this._add(new Sprites(k ? paintKandil(ORANGE, ROSE) : paintKandil(ROSE, ORANGE), list.length, { anchor: 1, order: 111 }));
      list.forEach((l, i) => { l.batch = batch; l.i = i; });
      return batch;
    });
    this.threads = this._add(new Sprites(paintThread(), hung.length, { anchor: 0, order: 104 }));
    this.kandilGlow = this._add(new Sprites(radialTexture([[0, 'rgba(255,190,110,0.6)'], [0.4, 'rgba(255,150,70,0.2)'], [1, 'rgba(255,120,50,0)']], 128), hung.length, { additive: true, order: 112 }));
  }

  _buildLights() {
    const lines = [
      [[-2.7, 1.86, -0.72], [2.7, 1.86, -0.72], 0.34],
      [[-2.5, 2.32, -1.5], [2.5, 2.32, -1.5], 0.44],
      [[-1.1, 1.94, 0], [-2.9, 2.08, 0.75], 0.26], [[1.1, 1.94, 0], [2.9, 2.08, 0.75], 0.26],
      [[-1.1, 1.94, 0], [-2.8, 2.2, -1.2], 0.26], [[1.1, 1.94, 0], [2.8, 2.2, -1.2], 0.26],
      [[-2.7, 2.42, 0.2], [2.7, 2.42, 0.2], 0.4],
    ];
    this.bulbs = [];
    for (const [a, b, sag] of lines) {
      for (const [x, y, z] of chain(a, b, sag, 0.095)) {
        this.bulbs.push({ x, y, z, at: 1.5 + Math.hypot(x, z) * 0.42, phase: this.rnd() * 6.28, size: 0.075 + this.rnd() * 0.03, tint: this.rnd() });
      }
    }
    this.bulbBatch = this._add(new Sprites(radialTexture([[0, 'rgba(255,250,232,1)'], [0.16, 'rgba(255,214,140,0.85)'], [0.42, 'rgba(255,160,70,0.2)'], [1, 'rgba(255,120,40,0)']], 64), this.bulbs.length, { additive: true, order: 113 }));
  }

  _buildAir() {
    const rnd = this.rnd;
    const tones = (this.plan ? ['#e9467a', '#f6bf34', '#f28f26'] : ['#f28f26', '#f6bf34', '#e06f16']).map((c) => new THREE.Color(c));
    // none directly between the phone and the card, so nothing crosses the words
    const clearOfWords = () => {
      for (;;) {
        const x = (rnd() - 0.5) * 3.8, z = (rnd() - 0.5) * 3 + 0.3;
        if (Math.abs(x) > 0.62 || z < -0.95) return [x, z];
      }
    };
    this.petals = Array.from({ length: 180 }, () => clearOfWords()).map(([x, z]) => ({
      x, z, top: 2.3 + rnd() * 0.9,
      at: (this.plan ? this.plan.show : 1.8) + rnd() * 27, speed: 0.24 + rnd() * 0.14, sway: 0.07 + rnd() * 0.12, phase: rnd() * 6.28,
      spin: 1.2 + rnd() * 2.4, tone: tones[Math.floor(rnd() * 3)], size: 0.036 + rnd() * 0.02,
    }));
    this.petalBatch = this._add(new Sprites(paintPetal(), this.petals.length, { order: 102 }));
    this.motes = Array.from({ length: 140 }, () => ({
      x: (rnd() - 0.5) * 4.6, y: 0.1 + rnd() * 2.4, z: (rnd() - 0.5) * 3.2, phase: rnd() * 6.28, size: 0.012 + rnd() * 0.016,
    }));
    this.moteBatch = this._add(new Sprites(radialTexture([[0, 'rgba(255,236,190,1)'], [0.4, 'rgba(255,190,110,0.3)'], [1, 'rgba(255,150,70,0)']], 32), this.motes.length, { additive: true, order: 114 }));
  }

  update(t, time) {
    const c = this.scene, m = c.lamp;
    const city = m ? Math.pow(1 - 0.92 * c._cityGone(t), 2) : 1;
    const strings = m ? Math.pow(1 - 0.86 * c._stringsGone(t), 2) : 1;
    const terrace = m ? 1 - 0.82 * c._terraceDark(t) : 1;
    const plan = this.plan;
    const tw = plan ? t - plan.shift : t; // when this card builds its setting
    const glow = plan ? smooth(plan.glow, plan.glow + 1.4, t) : 1;
    const hush = plan ? 0.36 + 0.64 * glow : 1;
    this.rangoliU.uP.value = smooth(-0.3, 1.5, tw);
    this.rangoliU.uLight.value = terrace * terrace * hush;
    for (const s of this.strands) {
      const d = tw - s.at;
      const sway = 0.06 * Math.exp(-Math.max(0, d) * 1.1) * Math.sin(d * 6) + 0.012 * Math.sin(time * 1.1 + s.phase);
      s.batch.set(s.i, s.x, s.y + (1 - easeBack(d / 0.85)) * 1.6, s.z, s.w, s.h, sway, STAND, strings * hush, strings * hush, strings * hush, clamp(d / 0.2, 0, 1));
    }
    for (const b of new Set(this.strands.map((s) => s.batch))) b.flush();
    const d0 = tw - 0.45;
    this.swag.position.y = this.swagAt + (1 - easeBack(d0 / 0.85)) * 1.6;
    this.swag.material.opacity = clamp(d0 / 0.2, 0, 1);
    this.swag.material.color.setScalar(strings * hush);

    this.spots.forEach((d, i) => {
      const flick = 1 + 0.08 * Math.sin(time * 13 + d.phase) + 0.05 * Math.sin(time * 29 + d.phase * 2);
      const on = smooth(d.onAt, d.onAt + 0.25, t);
      const level = m ? Math.max(on * (1 - smooth(d.outAt, d.outAt + 0.25, t)), smooth(d.backAt, d.backAt + 0.2, t)) : on;
      const pop = easeBack((t - d.appear) / 0.4);
      const w = 0.17 * d.scale * Math.max(pop, 0.001), h = w * this.bowlAspect;
      const body = plan ? 0.34 + 0.66 * Math.max(level, glow) : 0.1 + 0.9 * Math.max(level, terrace * terrace);
      this.bowls.set(i, d.x, 0.004, d.z, w, h, 0, STAND, body, body, body, t > d.appear ? 1 : 0);
      this.flames.set(i, d.x, h * 0.72, d.z, 0.05 * d.scale, 0.125 * d.scale * flick, 0, STAND, 1, 1, 1, level);
      this.pools.set(i, d.x, 0.006, d.z, 0.56 * d.scale * (0.94 + 0.06 * flick), 0.56 * d.scale * (0.94 + 0.06 * flick), 0, FLAT, 1, 1, 1, 0.24 * level);
      const catches = d.lead ? 1 + 1.4 * Math.exp(-Math.max(0, t - d.onAt) * 2.5) * smooth(d.onAt, d.onAt + 0.05, t) : 1;
      this.halos.set(i, d.x, h + 0.05, d.z, 0.3 * d.scale * flick * catches, 0.3 * d.scale * flick * catches, 0, FREE, 1, 1, 1, 0.6 * level);
    });
    this.pools.flush(); this.bowls.flush(); this.flames.flush(); this.halos.flush();

    this.hung.forEach((l, i) => {
      const d = tw - l.at;
      const y = l.y + (1 - easeBack(d / 1.1)) * 1.7;
      const sway = 0.05 * Math.sin(time * 0.9 + l.phase) + 0.1 * Math.exp(-Math.max(0, d) * 0.9) * Math.sin(d * 4.5);
      const a = clamp(d / 0.25, 0, 1);
      l.batch.set(l.i, l.x, y, l.z, l.w, l.h, sway, STAND, city * hush, city * hush, city * hush, a);
      this.threads.set(i, l.x, y, l.z, 0.01, 2.2, 0, STAND, 1, 1, 1, a * (0.25 + 0.75 * city));
      const size = l.w * 3.2 * (0.95 + 0.05 * Math.sin(time * 2.1 + l.phase));
      this.kandilGlow.set(i, l.x + Math.sin(sway) * l.h * 0.42, y - l.h * 0.4, l.z, size, size, 0, FREE, 1, 1, 1, 0.42 * a * city * city * glow);
    });
    this.kandils.forEach((b) => b.flush());
    this.threads.flush();
    this.kandilGlow.flush();

    this.bulbs.forEach((b, i) => {
      const on = smooth(b.at, b.at + 0.35, tw) * glow;
      const twinkle = 0.68 + 0.32 * Math.sin(time * 2.7 + b.phase);
      const warm = 0.8 + 0.2 * b.tint;
      this.bulbBatch.set(i, b.x, b.y, b.z, b.size, b.size, 0, FREE, 1, warm, 0.62 + 0.3 * b.tint, on * twinkle * city);
    });
    this.bulbBatch.flush();

    this.petals.forEach((p, i) => {
      const age = t - p.at, fall = p.top / p.speed;
      if (age < 0) { this.petalBatch.set(i, 0, -9, 0, 0, 0, 0, FREE, 1, 1, 1, 0); return; }
      const a = Math.min(age, fall), still = 1 - smooth(fall - 0.3, fall, a);
      const x = p.x + Math.sin(a * 1.7 + p.phase) * p.sway * still, z = p.z + Math.cos(a * 1.3 + p.phase) * p.sway * still;
      const y = Math.max(0.006, p.top - a * p.speed);
      const k = terrace * terrace;
      if (age >= fall) this.petalBatch.set(i, x, 0.006, z, p.size, p.size * 1.5, p.phase, FLAT, p.tone.r * k, p.tone.g * k, p.tone.b * k, 1);
      else this.petalBatch.set(i, x, y, z, p.size * (0.4 + 0.6 * Math.abs(Math.cos(a * p.spin))), p.size * 1.5, a * p.spin + p.phase, FREE, p.tone.r * k, p.tone.g * k, p.tone.b * k, clamp(age / 0.4, 0, 1));
    });
    this.petalBatch.flush();

    const air = (plan ? smooth(plan.glow, plan.glow + 2, t) : smooth(1, 3, t)) * terrace;
    this.motes.forEach((p, i) => {
      const a = air * (0.32 + 0.34 * Math.sin(time * 0.8 + p.phase));
      this.moteBatch.set(i, p.x + Math.sin(time * 0.17 + p.phase) * 0.12, p.y + Math.sin(time * 0.23 + p.phase * 2) * 0.1, p.z + Math.cos(time * 0.13 + p.phase) * 0.12, p.size, p.size, 0, FREE, 1, 1, 1, Math.max(0, a));
    });
    this.moteBatch.flush();
  }
}
