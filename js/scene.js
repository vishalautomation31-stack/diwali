// The card, alive. Everything is in card units: width 1, height 1.4, origin at the card's
// centre, y up, +z off the card towards the viewer. The same group is drawn full screen
// (no camera) or pinned to the printed card (camera).
//
// The sequence is a pure function of t (seconds since it began), so Replay is exact.
// Times follow the brief, section 5; each card's choreography follows its own words.
import * as THREE from '../lib/three.module.min.js';
import { buildNamePath, pathPoint, ribbonGeometry, trailMaterial, printMaterial, Sparks, StarField, smokeDrift, glowQuad, radialTexture, starTexture } from './fx.js?v=717dd6026e';
import { makeLine, makeImageLine } from './text.js?v=717dd6026e';
import { SkyShow, planShow } from './sky.js?v=717dd6026e';
import { paintStrand, paintSwag } from './marigold.js?v=717dd6026e';

export const CARD_H = 1.4;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3);
const easeBack = (x) => { const t = clamp01(x) - 1; return 1 + 2.2 * t * t * t + 1.2 * t * t; };

export const TIMES = {
  lift: [0, 1.5],
  draw: [1.5, 4.5],
  forWrite: [4.5, 5.3],
  lines: { fade: [5.3, 9.0, 11.6, 14.9], stream: [5.3, 8.1, 11.0, 14.9] },
  fromWrite: [18.0, 19.6],
  logo: [19.0, 20.0],
  end: 20.6,
};
const ENTRY = 0.8; // seconds the spark takes to fly in from outside the frame (one choreography)

// Depth of each of Codex's layers, by layer number, in card widths (before this.depth):
// 1 sky, 2 far bursts, 3 skyline, 4 terrace and house, 5 family, 6 diyas unlit, 7 diyas lit,
// 8 strings of lights and lantern, 9 rangoli (brief section 4); optional near layers
// 10 big diya unlit, 11 big diya lit, 12 plants, 13 house, stairs and lantern (ar/README.md).
// DRAW_ORDER is Codex's stack (its manifest): drawn in this order at zero lift, the layers rebuild
// the flat poster exactly. Rangoli (9) sits on the landing painted into the complete house (13).
const LAYER_Z = { 1: 0, 2: 0.016, 3: 0.04, 4: 0.075, 5: 0.1, 6: 0.102, 7: 0.103, 8: 0.105, 9: 0.112, 10: 0.095, 11: 0.096, 12: 0.12, 13: 0.11 };
const DRAW_ORDER = [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 9];
const LIT = new Set([7, 11]);
const MAX_DIYAS = 24;

const LIT_VS = /* glsl */ `varying vec2 vUv; varying vec2 vP; void main() { vUv = uv; vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const LIT_FS = /* glsl */ `
  uniform sampler2D map; uniform vec4 uDiya[${MAX_DIYAS}]; uniform int uCount; uniform float uOpacity;
  varying vec2 vUv; varying vec2 vP;
  void main() {
    vec4 c = texture2D(map, vUv);
    vec2 p = vP; // card units
    float m = 0.0;
    for (int i = 0; i < ${MAX_DIYAS}; i++) {
      if (i >= uCount) break;
      vec4 d = uDiya[i];
      float r = max(d.z, 0.004);
      m = max(m, d.w * (1.0 - smoothstep(r * 3.0, r * 6.5, distance(p, d.xy))));
    }
    float a = c.a * m * uOpacity;
    gl_FragColor = vec4(c.rgb, a);
    #include <colorspace_fragment>
  }`;

export class CardScene {
  constructor({ card, poster, layers, shadows, sceneInfo, logo, hand, lineImages }) {
    this.card = card;
    this.choreo = ['stream', 'stars', 'lamp'].includes(card.choreo) ? card.choreo : 'fade';
    // a card can carry its own timing (a longer wish); otherwise the sequence in the brief
    this.T = { ...TIMES, ...(card.times || {}), lines: card.times?.lines || TIMES.lines[this.choreo] };
    this.root = new THREE.Group();
    this.root.name = 'card';
    this.content = new THREE.Group(); // everything that lifts and lights
    this.content.matrixAutoUpdate = false; // setShear()
    this.root.add(this.content);
    this.pointScale = 800;
    this.crackle = 0;
    this.lastT = -1;
    this.depth = 1.8; // how far the layers lift, as a multiple of LAYER_Z
    this.introFade = false;
    this.boxes = sceneInfo?.boxes || {};
    // a card with its own art can reorder the stack and move its layers in depth
    this.order = sceneInfo?.order || DRAW_ORDER;
    this.Z = { ...LAYER_Z, ...(sceneInfo?.z || {}) };
    this.swingInfo = sceneInfo?.swing || null;
    this.risingStars = sceneInfo?.risingStars || 0;
    this._buildLayers(poster, layers, shadows);
    this._buildDiyas(sceneInfo?.diyas || []);
    this._buildName();
    this._buildAmbient(sceneInfo?.sparklers || []);
    this._buildWords(hand, lineImages);
    this._buildLogo(logo);
    if (card.show?.sky) this._buildSky();
    this.reset();
  }

  // Slides everything by its height above the card: the depth cue in camera mode.
  setShear(sx, sy) {
    this.content.matrix.set(1, 0, sx, 0, 0, 1, sy, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  }

  // Camera mode: the wish lies on the art, in the sky under the name, tilting with the card, and a
  // soft dark edge covers the real card's paper edge. No camera: the wish floats a little more.
  setCameraMode(on) {
    this.words.position.set(this.textX, this.textY, on ? 0.03 : 0.12);
    this.plate.visible = on;
  }

  // ---------- build ----------
  _tex(img) {
    const t = new THREE.Texture(img);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  }

  _buildLayers(poster, layers, shadows) {
    this.layers = [];
    this.layerImgs = layers || {};
    const geo = new THREE.PlaneGeometry(1, CARD_H);
    // Each image holds only its layer's own area (prepare_art.py), so the phone blends far fewer
    // pixels and holds far less in memory. The geometry is in card units, placed where the art is.
    const geoFor = (key) => {
      const b = this.boxes[key];
      if (!b) return geo;
      const w = b[2] - b[0], h = (b[3] - b[1]) * CARD_H;
      return new THREE.PlaneGeometry(w, h).translate(b[0] + w / 2 - 0.5, (0.5 - (b[1] + b[3]) / 2) * CARD_H, 0);
    };
    const have = layers ? this.order.filter((n) => layers[n]) : [];
    if (have.length >= 9) {
      this.layered = true;
      this.has = new Set(have);
      have.forEach((n, order) => {
        const tex = this._tex(layers[n]);
        let mat;
        if (LIT.has(n)) {
          mat = new THREE.ShaderMaterial({
            uniforms: { map: { value: tex }, uDiya: { value: Array.from({ length: MAX_DIYAS }, () => new THREE.Vector4()) }, uCount: { value: 0 }, uOpacity: { value: 1 } },
            vertexShader: LIT_VS, fragmentShader: LIT_FS, transparent: true, depthWrite: false,
          });
          mat.userData.layer = n;
          (this.litMats ||= []).push(mat);
        } else {
          mat = new THREE.MeshBasicMaterial({ map: tex, transparent: n !== 1 || !!this.card.show?.sky, depthWrite: false, toneMapped: false });
        }
        // the part that swings hangs from a group at its pivot
        const swinging = this.swingInfo?.layer === n;
        const [px, py] = swinging ? this.swingInfo.pivot : [0, 0];
        if (swinging) {
          this.swing = new THREE.Group();
          this.swing.position.set(px, py, 0);
          this.content.add(this.swing);
        }
        const parent = swinging ? this.swing : this.content;
        const m = new THREE.Mesh(swinging ? geoFor(`layer-${n}`).translate(-px, -py, 0) : geoFor(`layer-${n}`), mat);
        m.renderOrder = 10 + order * 2 + 1;
        parent.add(m);
        const L = { n, mesh: m, z: this.Z[n], order, lit: LIT.has(n), swinging };
        // a soft shadow of the layer, on whatever is behind it: the paper-cut depth
        if (n >= 2 && shadows && shadows[n] && !LIT.has(n)) {
          const sg = geoFor(`shadow-${n}`);
          const sm = new THREE.Mesh(swinging ? sg.translate(-px, -py, 0) : sg, new THREE.MeshBasicMaterial({ map: this._tex(shadows[n]), transparent: true, depthWrite: false, opacity: 0, toneMapped: false }));
          sm.renderOrder = 10 + order * 2;
          parent.add(sm);
          L.shadow = sm;
        }
        this.layers.push(L);
      });
    } else {
      this.layered = false;
      this.has = new Set();
      const mat = new THREE.MeshBasicMaterial({ map: this._tex(poster), toneMapped: false, transparent: true });
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 10;
      this.content.add(m);
      this.layers.push({ n: 0, mesh: m, z: 0, order: 0, lit: false });
    }
  }

  // how far layer n has lifted at time t (0..1, with a little overshoot)
  _lift(n, t) {
    const L = this.layers.find((l) => l.n === n);
    const order = L ? L.order : 0;
    return easeBack((t - 0.12 - order * 0.05) / 0.85);
  }

  _layerZ(n, t) {
    return this.layered && this.Z[n] !== undefined ? this.Z[n] * this.depth * this._lift(n, t) : 0;
  }

  _buildDiyas(diyas) {
    const parapet = diyas.filter((d) => !d.big).sort((a, b) => a.x - b.x);
    const big = diyas.find((d) => d.big);
    this.diyas = [...parapet, ...(big ? [big] : [])].slice(0, MAX_DIYAS).map((d) => ({ ...d, level: 0, boost: 1, layer: d.big && this.has.has(11) ? 11 : 7 }));
    const glowTex = radialTexture([[0, 'rgba(255,196,110,0.95)'], [0.2, 'rgba(255,150,55,0.6)'], [0.5, 'rgba(255,105,35,0.18)'], [1, 'rgba(255,80,20,0)']]);
    const coreTex = radialTexture([[0, 'rgba(255,252,235,1)'], [0.35, 'rgba(255,225,150,0.8)'], [1, 'rgba(255,170,60,0)']], 64);
    this.diyaFx = new THREE.Group();
    this.content.add(this.diyaFx);
    for (const d of this.diyas) {
      // the halo never reaches past the card's edge
      const room = Math.min(0.5 - Math.abs(d.x), 0.7 - Math.abs(d.y)) * 2;
      const s = Math.min(d.big ? 6.5 : 7.0, Math.max(2.5, room / d.r));
      d.glow = glowQuad(glowTex, d.r * s, '#ffffff', 45);
      d.glow.position.set(d.x, d.y, 0.002);
      d.core = glowQuad(coreTex, d.r * 1.6, '#ffffff', 46);
      d.core.position.set(d.x, d.y + d.r * 0.55, 0.003);
      d.seed = Math.random() * 100;
      this.diyaFx.add(d.glow, d.core);
    }
    if (this.choreo === 'lamp') this._planLamp();
  }

  // One lamp carries it. The fireworks stop, the city and the strings go out, then the lamps one at
  // a time, farthest first, until only the big one burns; its flame goes up to the parapet and along
  // it both ways, the strings and the city come back, and the name is the last thing it reaches.
  _planLamp() {
    const L = this.T.lines;
    const big = this.diyas.find((d) => d.big);
    const row = this.diyas.filter((d) => !d.big);
    const first = row.reduce((a, b) => (Math.abs(a.x - big.x) < Math.abs(b.x - big.x) ? a : b));
    const SPEED = 0.36; // card widths a second along the parapet
    const m = (this.lamp = { big, first, row, speed: SPEED });
    m.cityOut = [L[2] + 0.1, L[2] + 1.1];
    m.stringsOut = [L[2] + 0.6, L[2] + 1.4];
    [...row].sort((a, b) => Math.abs(b.x - big.x) - Math.abs(a.x - big.x)).forEach((d, k) => { d.outAt = L[2] + 1.3 + k * 0.3; });
    m.lastOut = L[2] + 1.3 + (row.length - 1) * 0.3 + 0.28;
    m.passFrom = L[3] + 0.15;
    m.t0 = m.passFrom + 0.5; // when it reaches the parapet
    row.forEach((d) => { d.backAt = m.t0 + Math.abs(d.x - first.x) / SPEED; });
    m.passEnd = Math.max(...row.map((d) => d.backAt));
    m.ends = [Math.min(...row.map((d) => d.x)), Math.max(...row.map((d) => d.x))];
    m.stringsBack = [m.passEnd - 0.1, m.passEnd + 0.7];
    m.cityBack = [m.passEnd + 0.2, m.passEnd + 1.1];
    m.name = m.passEnd + 0.95;
    this.flames = [0, 1].map(() => {
      const q = glowQuad(starTexture(64), 0.13, '#ffc46e', 62);
      this.content.add(q);
      return q;
    });
    // the one lamp's light on the dark terrace; it stops at the card's edge
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 230;
    const g = c.getContext('2d');
    const cx = (big.x + 0.5) * 256, cy = ((0.2 - big.y) / 0.9) * 230;
    const fill = g.createRadialGradient(cx, cy, 0, cx, cy, 135);
    fill.addColorStop(0, 'rgba(255,176,90,0.7)');
    fill.addColorStop(0.4, 'rgba(255,132,52,0.22)');
    fill.addColorStop(1, 'rgba(255,110,40,0)');
    g.fillStyle = fill;
    g.fillRect(0, 0, 256, 230);
    this.pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.9), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, opacity: 0, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.pool.position.set(0, -0.25, 0.12);
    this.pool.renderOrder = 44;
    this.content.add(this.pool);
  }

  _span(out, back, t) {
    return smooth(out[0], out[1], t) * (1 - smooth(back[0], back[1], t));
  }

  _cityGone(t) { return this._span(this.lamp.cityOut, this.lamp.cityBack, t); }
  _stringsGone(t) { return this._span(this.lamp.stringsOut, this.lamp.stringsBack, t); }
  _terraceDark(t) { const m = this.lamp; return this._span([m.cityOut[0], m.lastOut], [m.t0, m.passEnd + 0.9], t); }
  _nameOut(t) { const m = this.lamp; return this._span(m.cityOut, [m.name, m.name + 0.5], t); }

  // only this choreography darkens layers one by one
  _layerLight(n, t) {
    if (this.choreo !== 'lamp') return 1;
    if (n === 2 || n === 3) return 1 - 0.8 * this._cityGone(t);
    if (n === 8) return 1 - 0.8 * this._stringsGone(t);
    return 1;
  }

  _passFlame(t, dt) {
    const m = this.lamp;
    for (const q of this.flames) q.material.opacity = 0;
    if (t < m.passFrom || t > m.passEnd + 0.12) return;
    const z = this._layerZ(7, t) + 0.016;
    const place = (q, x, y) => {
      q.position.set(x, y, z);
      const s = 0.85 + 0.35 * Math.random();
      q.scale.set(s, s, 1);
      q.material.opacity = 0.95;
      if (dt > 0) this.sparks.emit(x, y, z - 0.004, Math.round(dt * 210 + Math.random()), { speed: 0.26, ttl: 0.45, size: 0.009 });
    };
    const { big, first } = m;
    const onRow = first.y + first.r * 0.6;
    if (t < m.t0) {
      const e = smooth(m.passFrom, m.t0, t), from = big.y + big.r * 0.6;
      place(this.flames[0], big.x + (first.x - big.x) * e, from + (onRow - from) * e);
      return;
    }
    m.ends.forEach((end, k) => {
      const dir = k ? 1 : -1;
      const x = first.x + dir * m.speed * (t - m.t0);
      if ((dir < 0 && x >= end) || (dir > 0 && x <= end)) place(this.flames[k], x, onRow + 0.012 * Math.abs(Math.sin(x * 22)));
    });
  }

  _buildToran() {
    const L = this.T.lines;
    const box = this.card.geom.box;
    const R = 0.0165, GAP = R * 1.55;
    const curve = (x) => box[3] + 0.058 - 0.026 * (1 - Math.pow(x / 0.5, 2));
    // each letter's span: contours that overlap across are one letter
    const spans = this.path.contours.map((c) => { const xs = c.pts.map((p) => p[0]); return [Math.min(...xs), Math.max(...xs)]; }).sort((a, b) => a[0] - b[0]);
    const letters = [];
    for (const s of spans) {
      const last = letters[letters.length - 1];
      if (last && s[0] < last[1]) last[1] = Math.max(last[1], s[1]);
      else letters.push([...s]);
    }
    const drops = [letters[0][0] - 0.026];
    for (let i = 0; i + 1 < letters.length; i++) drops.push((letters[i][1] + letters[i + 1][0]) / 2);
    drops.push(letters[letters.length - 1][1] + 0.026);
    const mid = (drops.length - 1) / 2;
    const material = (canvas) => new THREE.MeshBasicMaterial({ map: this._tex(canvas), transparent: true, depthWrite: false, toneMapped: false, opacity: 0 });
    const swag = paintSwag(curve, -0.49, 0.49, R, GAP * 0.96, 17);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(swag.w, swag.h), material(swag.canvas));
    line.renderOrder = 51;
    line.position.set(swag.cx, swag.cy, 0.024);
    this.content.add(line);
    this.toran = [{ mesh: line, y: swag.cy, at: L[0], phase: 0 }];
    drops.forEach((x, k) => {
      const off = Math.abs(k - mid) / mid; // 0 in the middle, 1 at the ends
      const y = curve(x);
      const bottom = box[1] + 0.02 + 0.075 * off + (k % 2 ? 0.05 : 0);
      const count = Math.max(2, Math.round((y - bottom) / GAP));
      const s = paintStrand(count, R, GAP, 5 + k * 3);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h).translate(0, -s.h / 2, 0), material(s.canvas));
      mesh.renderOrder = 50;
      mesh.position.set(x, y, 0.024);
      this.content.add(mesh);
      this.toran.push({ mesh, y, at: L[0] + 0.14 + Math.abs(k - mid) * 0.08, phase: k * 1.7, strand: true });
    });
  }

  _swayToran(t, time) {
    const light = 1 - 0.86 * this._stringsGone(t);
    for (const s of this.toran) {
      const d = t - s.at;
      s.mesh.visible = d > 0;
      if (d <= 0) continue;
      s.mesh.position.y = s.y + (1 - easeBack(d / 0.8)) * 0.75;
      s.mesh.material.opacity = clamp01(d / 0.15);
      s.mesh.material.color.setScalar(light);
      if (s.strand) s.mesh.rotation.z = 0.1 * Math.exp(-d * 1.2) * Math.sin(d * 6.5) + 0.016 * Math.sin(time * 1.25 + s.phase);
    }
  }

  _buildName() {
    const geom = this.card.geom;
    const style = this.card.style;
    this.path = buildNamePath(geom);
    this.nameGroup = new THREE.Group();
    this.content.add(this.nameGroup);
    this.print = new THREE.Mesh(ribbonGeometry(this.path, style.nameStroke), printMaterial(style.nameColor));
    this.print.position.z = 0.003;
    this.print.renderOrder = 30;
    const k = Math.min(1, geom.em / 0.43333); // a longer name has smaller letters: a finer line and glow
    this.trail = new THREE.Mesh(ribbonGeometry(this.path, 0.0085 * k), trailMaterial(false));
    this.trail.position.z = 0.006;
    this.trail.renderOrder = 31;
    this.halo = new THREE.Mesh(ribbonGeometry(this.path, 0.055 * k), trailMaterial(true));
    this.halo.position.z = 0.007;
    this.halo.renderOrder = 32;
    this.halo.material.uniforms.uOpacity.value = 0.55;
    this.nameGroup.add(this.print, this.trail, this.halo);
    this.trail.material.uniforms.uDrawDur.value = this.halo.material.uniforms.uDrawDur.value = this.T.draw[1] - this.T.draw[0];

    this.head = glowQuad(starTexture(), 0.085, '#ffffff', 61);
    this.content.add(this.head);
    this.sparks = new Sparks(2400);
    this.content.add(this.sparks.points);

    // sample points on the outline (stream targets and idle embers)
    this.outlinePts = [];
    for (let i = 0; i < 160; i++) {
      const [x, y, on] = pathPoint(this.path, (i + 0.5) / 160);
      if (on) this.outlinePts.push([x, y]);
    }
  }

  _buildAmbient(sparklers) {
    this.kids = sparklers.slice(0, 3).map((k) => {
      const q = glowQuad(starTexture(64), 0.05, '#ffffff', 62);
      this.content.add(q);
      return { ...k, q, acc: 0 };
    });
    this.fireClock = 1.6;
    this.fireSpots = [[-0.42, 0.14], [-0.3, 0.075], [-0.12, 0.09], [0.04, 0.08], [0.2, 0.1]]; // low sky, under the words
    this.fireColors = ['#f6ad2b', '#fff3dc', '#e9467a', '#f2862b', '#ffd27a'].map((c) => new THREE.Color(c));
    if (this.choreo === 'stars') this._buildStars();
    if (this.choreo === 'lamp') this._buildToran();
  }

  // Small stars across the open sky, coming up outwards from the name. Never inside the name's
  // box, so its letters stay clean. Fixed positions: Replay is exact. They sit just over the sky
  // layer, so everything in front of the sky (the city, the house) covers them.
  _buildStars() {
    const box = this.card.geom.box;
    const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const stars = [];
    const edge = 0.014;
    for (let tries = 0; stars.length < 150 && tries < 3000; tries++) {
      const x = (rnd() - 0.5) * 0.98, y = 0.13 + rnd() * 0.56;
      if (x > box[0] - edge && x < box[2] + edge && y > box[1] - edge && y < box[3] + edge) continue;
      const big = rnd() > 0.92;
      stars.push({
        x, y,
        size: big ? 0.024 + rnd() * 0.014 : 0.006 + rnd() * 0.009,
        delay: Math.hypot(x - cx, y - cy) * 1.5 + rnd() * 0.35,
        phase: rnd() * 6.283,
      });
    }
    this.starField = new StarField(stars);
    this.starField.points.renderOrder = 11.5; // the sky is 11; the next layer starts at 12
    this.starField.points.position.z = 0.002;
    this.content.add(this.starField.points);
    this.smoke = smokeDrift(-0.5, 0.1, 0.5, 0.7);
    this.smoke.renderOrder = 33; // over the name, under the words
    this.content.add(this.smoke);
  }

  // Line 2: smoke drifts across as its first sentence arrives and clears with its second.
  _cloud(t) {
    const s = this.T.lines[1];
    return smooth(s - 0.1, s + 1.0, t) * (1 - smooth(this.clearAt, this.clearAt + 1.3, t));
  }

  _cleared(t) {
    return smooth(this.clearAt, this.clearAt + 0.9, t);
  }

  // A line of two sentences gives the second its own moment; returns when it arrives.
  _stagger(L) {
    const parts = [...L.parts].sort((a, b) => a.order - b.order);
    let wait = 0, words = 0;
    let second = 0;
    parts.forEach((p, i) => {
      p.delay = wait;
      words++;
      if (/[.!?]$/.test(p.word) && i < parts.length - 1) {
        wait += 0.6 + 0.24 * words;
        words = 0;
        second = second || wait;
      }
    });
    return second;
  }

  // 0 normally, 1 while the words carry it alone (lines 3 and 4 of that choreography)
  _quiet(t) {
    const L = this.T.lines;
    return smooth(L[2] - 0.2, L[2] + 0.7, t) * (1 - smooth(L[4] - 0.2, L[4] + 1.0, t));
  }

  // Fireworks round the whole screen, in step with the choreography: a pause where the words need
  // the quiet, and a volley where the card celebrates.
  _buildSky() {
    const T = this.T, L = T.lines;
    let quiet = [], volleys = [T.draw[1] + 0.2], fountainsFrom = L[L.length - 1];
    if (this.choreo === 'stars') {
      quiet = [[L[1] - 0.3, this.clearAt], [L[2] - 0.3, L[4]]];
      volleys.push(this.clearAt + 0.3, L[4] + 0.3);
      fountainsFrom = L[4] + 0.2;
    } else if (this.choreo === 'fade') {
      quiet = [[L[1] - 0.3, L[2] + 0.3]];
      volleys.push(L[2] + 0.7, L[3] + 0.3);
      fountainsFrom = L[3];
    } else if (this.choreo === 'lamp') {
      quiet = [[L[2] - 1.2, L[4]]]; // nothing bursts while it is dark, and the last sparks have fallen by then
      volleys.push(L[1] + 0.4, L[4] + 0.1);
      fountainsFrom = L[4];
    } else {
      volleys.push(L[2] + 1.2);
      fountainsFrom = L[3] ?? L[L.length - 1];
    }
    this.sky = new SkyShow(planShow({ draw: T.draw, fromWrite: T.fromWrite, quiet, volleys }), { fountainsFrom, finale: T.fromWrite[0], end: T.end });
    this.sky.onBurst = (power, x) => this.onBurst?.(power, x);
    this.root.add(this.sky.group);
  }

  // the children's sparklers: how hard they burn at time t (0 out .. 1.6 flaring)
  _kidRate(t) {
    if (t < 1.0) return 0;
    if (this.choreo === 'lamp') return 0.65 * (1 - smooth(this.T.lines[2] - 0.1, this.T.lines[2] + 0.8, t) + smooth(this.T.lines[4], this.T.lines[4] + 0.8, t));
    if (this.choreo === 'stars') return 0.65 * (1 - 0.8 * this._quiet(t));
    if (this.choreo === 'fade') {
      const L = this.T.lines;
      // they flare with line 1 and burn out with line 2
      return 0.6 + 1.0 * smooth(L[0] - 0.2, L[0] + 0.4, t) - 1.6 * smooth(L[1] + 0.15, L[1] + 1.1, t);
    }
    return 0.65;
  }

  _fireworksOn(t) {
    if (t < 1.8) return false;
    if (this.choreo === 'lamp') return t < this.T.lines[2] - 0.3 || t > this.T.lines[4];
    // none under the words
    if (this.choreo === 'stars') return t < this.T.lines[0] || t > this.T.fromWrite[0];
    if (this.choreo === 'fade') {
      const L = this.T.lines;
      return t < L[1] || t > L[2] + 1.0; // none "in the dark"
    }
    return true;
  }

  _ambient(t, dt) {
    if (!dt) return;
    const zk = this._layerZ(5, t) + 0.004;
    const rate = Math.max(0, this._kidRate(t));
    for (const k of this.kids) {
      k.q.position.set(k.x, k.y, zk + 0.002);
      const sc = (0.6 + 0.5 * Math.random()) * Math.min(1, rate);
      k.q.scale.set(sc, sc, 1);
      k.q.material.opacity = Math.min(1, rate) * 0.9;
      k.acc += dt * 70 * rate;
      while (k.acc >= 1) {
        k.acc -= 1;
        this.sparks.emit(k.x + (Math.random() - 0.5) * 0.006, k.y + (Math.random() - 0.5) * 0.006, zk, 1, { speed: 0.13 + 0.07 * rate, ttl: 0.28, size: 0.0055 * (0.8 + 0.4 * rate), lift: 0.02 });
      }
    }
    if (this._fireworksOn(t)) {
      this.fireClock -= dt;
      if (this.fireClock <= 0) {
        this.fireClock = 1.3 + Math.random() * 1.9;
        const [x, y] = this.fireSpots[(Math.random() * this.fireSpots.length) | 0];
        const c = this.fireColors[(Math.random() * this.fireColors.length) | 0];
        this.sparks.burst(x + (Math.random() - 0.5) * 0.06, y + (Math.random() - 0.5) * 0.04, this._layerZ(2, t) + 0.003, c, 34);
      }
    }
  }

  _writeMaterial(tex) {
    return new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, uP: { value: 0 }, uOpacity: { value: 1 } },
      vertexShader: LIT_VS,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform float uP; uniform float uOpacity; varying vec2 vUv;
        void main() {
          vec4 c = texture2D(map, vUv);
          float edge = uP * 1.12 - 0.06;
          float reveal = 1.0 - smoothstep(edge - 0.04, edge + 0.02, vUv.x + (vUv.y - 0.5) * 0.08);
          float a = c.a * reveal * uOpacity;
          if (a < 0.003) discard;
          gl_FragColor = vec4(c.rgb, a);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
    });
  }

  // "for" and "from Vishal": Vishal's handwriting when its photo is in, else Eczar as a stand-in.
  _handOrLabel(img, text, h) {
    let tex, w;
    if (img) {
      tex = this._tex(img);
      w = (h * img.width) / img.height;
    } else {
      const L = makeLine(text, { size: h * 0.62, maxWidth: 3, color: '#ffcf7a' });
      tex = L.texture;
      w = L.width;
      h = L.height;
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this._writeMaterial(tex));
    m.renderOrder = 85;
    m.userData.w = w;
    return m;
  }

  _buildWords(hand, lineImages) {
    const st = this.card.style;
    // "for", above the name: only in Vishal's hand, never a typed stand-in (the print leaves it out too)
    if (hand?.for) {
      this.forMesh = this._handOrLabel(hand.for, 'for', st.forAt.h);
      this.forMesh.position.set(st.forAt.x + this.forMesh.userData.w / 2, st.forAt.y, 0.012);
      this.content.add(this.forMesh);
    }
    this.nib = glowQuad(starTexture(64), 0.03, '#ffffff', 86);
    this.content.add(this.nib);

    // the wish
    this.veil = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 0.5),
      new THREE.MeshBasicMaterial({ map: radialTexture([[0, 'rgba(9,6,28,0.92)'], [0.55, 'rgba(9,6,28,0.6)'], [1, 'rgba(9,6,28,0)']], 256), transparent: true, depthWrite: false, opacity: 0 })
    );
    this.veil.scale.set(1, 1, 1);
    // the open sky between the name and the skyline, clear of the house roof on the right
    this.textX = st.textAt?.x ?? -0.05;
    this.textY = st.textAt?.y ?? 0.225;
    this.words = new THREE.Group();
    this.veil.position.set(0, -0.04, -0.012);
    this.veil.renderOrder = 75;
    this.words.add(this.veil);
    this.lineObjs = this.card.lines.map((text) => {
      const L = makeLine(text, this.choreo === 'stars' ? { size: 0.072, maxWidth: 0.86, phrases: true } : this.choreo === 'lamp' ? { size: 0.072, maxWidth: 0.7, phrases: /,\s/.test(text) } : { size: 0.072, maxWidth: 0.78 });
      this.words.add(L.group);
      return L;
    });
    if (this.choreo === 'stars') {
      this.lineObjs.forEach((L) => this._stagger(L));
      this.clearAt = this.T.lines[1] + (this.lineObjs[1].parts.find((p) => p.delay > 0)?.delay ?? 2);
    }
    // lines set ahead of time as images play after the live ones, just like them
    (lineImages || []).forEach((img, k) => {
      const L = makeImageLine(img, this.card.imageLines[k].width);
      L.group.position.y = this.card.geom.box[1] - 0.026 - L.height / 2 - this.textY;
      this.words.add(L.group);
      this.lineObjs.push(L);
    });

    // "from Vishal", under the wish
    this.fromMesh = this._handOrLabel(hand?.from, this.card.from || 'from Vishal', st.fromAt.h);
    this.fromMesh.position.set(st.fromAt.x - this.textX, st.fromAt.y - this.textY, 0);
    this.words.add(this.fromMesh);
    this.content.add(this.words);
    this._buildPlate();
    this.setCameraMode(false);
  }

  // The MorningLabs AI mark, cut out of its near-black ground (tools/prepare_logo.py: every pixel
  // keeps its colour), in pieces so its three dots can light one after another and breathe.
  _buildPlate() {
    const c = document.createElement('canvas');
    c.width = 260;
    c.height = 340; // the plate is 1.3 x 1.7 card widths: 200 pixels to a card width
    const g = c.getContext('2d');
    g.shadowColor = '#0a0824';
    g.shadowBlur = 26;
    g.fillStyle = '#0a0824';
    g.fillRect(27, 27, 206, 286);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.plate = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.7), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
    this.plate.position.z = -0.002;
    this.plate.renderOrder = 5;
    this.root.add(this.plate);
  }

  _buildLogo(logo) {
    const at = this.card.style.logoAt;
    if (!logo || !logo.layout) return;
    const [W, H] = logo.layout.size; // the original file, 262 x 58
    const s = at.w / W; // card units per pixel of the original
    const g = new THREE.Group();
    g.position.set(at.x, at.y, 0.004);
    const tex = (img) => {
      const t = this._tex(img);
      t.generateMipmaps = false;
      t.minFilter = THREE.LinearFilter;
      return t;
    };
    const place = (mesh, box, order) => {
      const [x0, y0, x1, y1] = box;
      mesh.position.set(((x0 + x1) / 2 - W / 2) * s, -((y0 + y1) / 2 - H / 2) * s, 0);
      mesh.renderOrder = order;
      g.add(mesh);
      return mesh;
    };
    const wb = logo.layout.word.box;
    this.logoWord = place(new THREE.Mesh(new THREE.PlaneGeometry((wb[2] - wb[0]) * s, (wb[3] - wb[1]) * s), this._writeMaterial(tex(logo.word))), wb, 92);
    this.logoWord.visible = false;
    const glowTex = radialTexture([[0, 'rgba(54,211,153,0.9)'], [0.25, 'rgba(54,211,153,0.35)'], [1, 'rgba(54,211,153,0)']], 64);
    this.logoDots = logo.dots.map((img, k) => {
      const b = logo.layout.dots[k].box;
      const mesh = place(new THREE.Mesh(new THREE.PlaneGeometry((b[2] - b[0]) * s, (b[3] - b[1]) * s), new THREE.MeshBasicMaterial({ map: tex(img), transparent: true, opacity: 0, depthWrite: false, toneMapped: false })), b, 93);
      const glow = glowQuad(glowTex, Math.max(b[2] - b[0], b[3] - b[1]) * s * 7, '#ffffff', 91);
      glow.position.copy(mesh.position);
      g.add(glow);
      return { mesh, glow, k };
    });
    this.content.add(g);
    this.logoGroup = g;
    // the mark rides on the front-most layer that covers the band under it, so the lifted
    // layers never slide over it (which layer holds the band depends on Codex's cut)
    this.logoLayer = this._coveringLayer([[at.x - at.w * 0.35, at.y], [at.x, at.y], [at.x + at.w * 0.35, at.y]]);
  }

  _coveringLayer(points) {
    if (!this.layered) return 0;
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const g = c.getContext('2d', { willReadFrequently: true });
    let front = 1;
    for (const L of this.layers) {
      const img = this.layerImgs[L.n];
      if (!img || L.lit) continue;
      const b = this.boxes[`layer-${L.n}`] || [0, 0, 1, 1];
      for (const [x, y] of points) {
        const u = x + 0.5, v = 0.5 - y / CARD_H;
        if (u < b[0] || u > b[2] || v < b[1] || v > b[3]) continue;
        g.clearRect(0, 0, 1, 1);
        g.drawImage(img, ((u - b[0]) / (b[2] - b[0])) * img.width, ((v - b[1]) / (b[3] - b[1])) * img.height, 1, 1, 0, 0, 1, 1);
        if (g.getImageData(0, 0, 1, 1).data[3] > 160 && this.Z[L.n] >= this.Z[front]) front = L.n;
      }
    }
    return front;
  }

  _logo(t, time) {
    if (!this.logoGroup) return;
    const t0 = this.T.logo[0];
    const live = t > t0 + 1.4;
    this.logoGroup.position.z = this._layerZ(this.logoLayer, t) + 0.006;
    for (const d of this.logoDots) {
      const s0 = t0 + d.k * 0.18; // left to right, smallest first
      const on = clamp01((t - s0) / 0.15);
      const pop = Math.max(0.001, easeBack((t - s0) / 0.4));
      const flash = on * Math.exp(-Math.max(0, t - s0) * 3.0);
      const breathe = live ? 0.5 + 0.5 * Math.sin(time * 2.4 - d.k * 0.95) : 0;
      const sc = pop * (1 + 0.1 * breathe);
      d.mesh.scale.set(sc, sc, 1);
      d.mesh.material.opacity = on;
      d.glow.material.opacity = on * (0.16 + 0.55 * flash + 0.22 * breathe) * (0.55 + 0.25 * d.k);
      const gs = 0.7 + 0.5 * flash + 0.25 * breathe;
      d.glow.scale.set(gs, gs, 1);
    }
    const wp = clamp01((t - (t0 + 0.55)) / 0.8);
    this.logoWord.visible = wp > 0;
    this.logoWord.material.uniforms.uP.value = wp;
  }

  // ---------- run ----------
  reset() {
    this.sparks.clear();
    this.lastT = -1;
    this.emberClock = 0;
    this.streamDone = false;
    this.relightSparked = false;
    this.sky?.reset();
  }

  // State at time t. dt drives the particles only.
  update(t, dt, now) {
    const ch = this.choreo;
    const T = this.T;
    const L = T.lines;
    const time = now ?? performance.now() / 1000;

    // 1. layers lift, back to front (the reference's layer build), each casting a soft shadow
    for (const l of this.layers) {
      const p = this.layered ? this._lift(l.n, t) : 0;
      const z = l.z * this.depth * p;
      if (l.swinging) this.swing.position.z = z;
      else l.mesh.position.z = z;
      if (l.shadow) {
        l.shadow.position.set(z * 0.1, -z * 0.16, l.swinging ? -0.004 : Math.max(0, z - 0.004));
        l.shadow.material.opacity = 0.75 * clamp01(p);
      }
    }
    // the swing starts with line 1 and never stops: mostly towards and away, a hair side to side
    if (this.swing) {
      const a = smooth(L[0], L[0] + 2.5, t), w = (2 * Math.PI) / 3.6;
      this.swing.rotation.x = a * 0.085 * Math.sin(w * t);
      this.swing.rotation.z = a * 0.012 * Math.sin(w * t + 0.6);
    }
    // the sky show lights the card a little as each one bursts
    const night = this._night(t) + (this.sky ? 0.09 * this.sky.flash : 0);
    for (const l of this.layers) if (!l.lit && l.mesh.material.color) l.mesh.material.color.setScalar(night * this._layerLight(l.n, t));
    const enter = this.introFade ? smooth(0, 0.35, t) : 1; // camera: fade the render in over the print
    this.plate.material.opacity = enter;
    for (const l of this.layers) {
      if (l.lit) l.mesh.material.uniforms.uOpacity.value = enter;
      else if (l.n === this.risingStars) l.mesh.material.opacity = enter * smooth(L[0] + 0.1, L[0] + 1.6, t);
      else l.mesh.material.opacity = enter;
    }
    for (const d of this.diyas) {
      const z = this._layerZ(d.layer, t);
      d.glow.position.z = z + 0.002;
      d.core.position.z = z + 0.003;
    }

    // 2. the name: printed outline, the spark drawing it, its glow per the choreography
    const d0 = T.draw[0], d1 = T.draw[1];
    const drawP = clamp01((t - d0) / (d1 - d0));
    const tu = this.trail.material.uniforms, hu = this.halo.material.uniforms;
    const glow = this._nameGlow(t);
    const relight = this._relight(t);
    for (const u of [tu, hu]) {
      u.uT.value = t - d0;
      u.uGlow.value = glow;
      u.uRelight.value = relight;
      u.uTime.value = time;
    }
    // with no printed card under it, the outline only exists once the spark has written it
    const inked = (this.card.surface ? smooth(d1 - 0.3, d1 + 0.9, t) : 1) * (ch === 'lamp' ? 1 - 0.8 * this._nameOut(t) : 1);
    this.print.material.uniforms.uOpacity.value = inked * enter * (0.9 - 0.25 * smooth(d0, d0 + 0.6, t) + 0.25 * smooth(d1, d1 + 1.5, t));
    const drawing = t >= d0 && t < d1;
    const flyingIn = ch === 'stars' && t >= d0 - ENTRY && t < d0;
    if (drawing) {
      const [x, y, on] = pathPoint(this.path, drawP);
      this.head.position.set(x, y, 0.014);
      this.head.material.opacity = on ? 0.95 : 0.35;
      const s = 0.8 + 0.4 * Math.random();
      this.head.scale.set(s, s, 1);
      if (on && dt > 0) this.sparks.emit(x, y, 0.012, Math.round(dt * 300 + Math.random()), { speed: 0.5, ttl: 0.55, size: 0.011 });
    } else if (flyingIn) {
      // from beyond the card's corner, in a curve, to where the first letter starts
      const e = smooth(d0 - ENTRY, d0, t), u = 1 - e;
      const [x1, y1] = pathPoint(this.path, 0);
      const x = u * u * -0.86 + 2 * u * e * -0.72 + e * e * x1;
      const y = u * u * 1.0 + 2 * u * e * (y1 + 0.05) + e * e * y1;
      this.head.position.set(x, y, 0.014);
      this.head.material.opacity = 0.95;
      const s = 0.8 + 0.4 * Math.random();
      this.head.scale.set(s, s, 1);
      if (dt > 0) this.sparks.emit(x, y, 0.012, Math.round(dt * 240 + Math.random()), { speed: 0.4, ttl: 0.5, size: 0.01 });
    } else if (relight >= 0 && relight <= 1) {
      const [x, y] = pathPoint(this.path, relight);
      this.head.position.set(x, y, 0.014);
      this.head.material.opacity = 0.8;
      if (dt > 0) this.sparks.emit(x, y, 0.012, Math.round(dt * 160 + Math.random()), { speed: 0.35, ttl: 0.4, size: 0.009 });
    } else {
      this.head.material.opacity = 0;
    }
    this.crackle = drawing || flyingIn ? 1 : relight >= 0 && relight <= 1 ? 0.7 : this._streamActive(t) ? 0.25 : 0;

    // 3. "for" writes itself
    const fp = clamp01((t - T.forWrite[0]) / (T.forWrite[1] - T.forWrite[0]));
    if (this.forMesh) this._write(this.forMesh, fp, t > T.forWrite[0] - 0.01);

    // 4. diyas
    this._diyas(t, time);

    // 5. the wish, one line at a time
    const firstImage = this.card.lines.length;
    const deeper = firstImage < L.length ? smooth(L[firstImage] - 0.4, L[firstImage] + 0.4, t) : 0;
    this.veil.material.opacity = (0.42 + 0.26 * deeper) * smooth(L[0] - 0.3, L[0] + 0.5, t);
    this.veil.position.y = -0.04 - 0.06 * deeper;
    if (ch === 'stars') this.veil.material.opacity *= 1 - 0.8 * smooth(T.fromWrite[0], T.fromWrite[0] + 1, t);
    const afterLast = ch === 'stars' ? T.fromWrite[0] : Infinity;
    this.lineObjs.forEach((obj, k) => this._line(obj, t, L[k], k + 1 < L.length ? L[k + 1] : afterLast));

    // 6. "from Vishal", then the mark
    const wp = clamp01((t - T.fromWrite[0]) / (T.fromWrite[1] - T.fromWrite[0]));
    this._write(this.fromMesh, wp, t > T.fromWrite[0] - 0.01, true);
    this._logo(t, time);

    // 7. the light stream (one choreography), the children's sparklers, far fireworks, idle embers
    if (ch === 'stream' || ch === 'lamp') this._stream(t);
    if (ch === 'lamp') {
      this._swayToran(t, time);
      this._passFlame(t, dt);
      this.pool.material.opacity = 0.8 * this._terraceDark(t) * (0.9 + 0.1 * Math.sin(time * 11 + this.lamp.big.seed));
    }
    if (ch === 'stars') {
      const u = this.starField.mat.uniforms;
      u.uAge.value = t - L[0];
      u.uTime.value = time;
      u.uScale.value = this.pointScale;
      u.uLevel.value = enter * (1 - 0.45 * this._quiet(t)) * (1 - 0.75 * this._cloud(t));
      const cloud = this._cloud(t);
      hu.uOpacity.value = (0.55 + 0.35 * this._cleared(t) * (1 - this._quiet(t))) * (1 - 0.7 * cloud);
      this.smoke.material.uniforms.uOpacity.value = 0.85 * cloud * enter;
      this.smoke.material.uniforms.uScroll.value = t * 0.09;
    }
    this._ambient(t, dt);
    if (t > T.end - 1.5 && dt > 0) {
      this.emberClock -= dt;
      if (this.emberClock <= 0 && this.outlinePts.length) {
        this.emberClock = 0.12 + Math.random() * 0.3;
        const [x, y] = this.outlinePts[(Math.random() * this.outlinePts.length) | 0];
        this.sparks.emit(x, y, 0.01, 2 + ((Math.random() * 3) | 0), { speed: 0.18, ttl: 0.9, size: 0.008, kind: Math.random() < 0.5 ? 1 : 0, lift: 0.08 });
      }
    }
    this.sparks.mat.uniforms.uScale.value = this.pointScale;
    if (this.sky) this.sky.update(t, dt, time, this.pointScale);
    if (dt > 0) this.sparks.update(Math.min(dt, 0.05));
    this.lastT = t;
  }

  _night(t) {
    if (this.choreo === 'lamp') {
      const L = this.T.lines;
      return (0.8 + 0.2 * smooth(L[0], L[0] + 2.6, t)) * (1 - 0.82 * this._terraceDark(t));
    }
    if (this.choreo === 'stars') {
      const L = this.T.lines;
      return 0.84 - 0.22 * this._quiet(t) + 0.16 * smooth(L[4], L[4] + 1.4, t);
    }
    if (this.choreo === 'fade') {
      const L = this.T.lines;
      // dims "in the dark" (line 2), comes back up with the diyas (line 4)
      return 0.84 - 0.24 * smooth(L[1], L[1] + 0.9, t) + 0.4 * smooth(L[3], L[3] + 1.4, t);
    }
    const L = this.T.lines;
    return 0.8 + 0.2 * smooth(L[0], L[0] + 2.6, t);
  }

  _nameGlow(t) {
    const d1 = this.T.draw[1];
    if (this.choreo === 'lamp') {
      const m = this.lamp;
      const low = 1 - 0.8 * smooth(d1 + 0.1, this.T.lines[0] + 2.2, t); // dims after it is written
      return Math.max(low * (1 - smooth(m.cityOut[0], m.cityOut[1], t)), smooth(m.name + 0.5, m.name + 0.9, t));
    }
    if (this.choreo === 'stars') {
      // warm while it is written, dim under the smoke, full once it clears, low while the words
      // carry it, full again after
      const L = this.T.lines;
      const under = this.card.lines.length < L.length ? 0.22 * smooth(L[this.card.lines.length] - 0.3, L[this.card.lines.length] + 0.6, t) : 0;
      return (0.72 + 0.28 * this._cleared(t)) * (1 - 0.72 * this._cloud(t)) - 0.5 * this._quiet(t) - under;
    }
    if (this.choreo === 'fade') {
      const L = this.T.lines;
      // fades as line 1 arrives, like a real sparkler trail; dark for line 2; lit again at line 3
      if (t < L[2]) return 1 - smooth(L[0] - 0.1, L[1] - 0.4, t);
      return smooth(L[2] + 0.5, L[2] + 0.9, t);
    }
    const L = this.T.lines;
    // dims after drawing; the stream from the diyas lights it at line 3, and it remains lit
    const low = 1 - 0.8 * smooth(d1 + 0.1, L[0] + 2.2, t);
    return Math.max(low, smooth(L[2] + 1.0, L[2] + 2.0, t));
  }

  _relight(t) {
    if (this.choreo === 'lamp') return t < this.lamp.name ? -1 : Math.min(1.5, (t - this.lamp.name) / 0.75);
    if (this.choreo !== 'fade') return -1;
    const s = this.T.lines[2];
    if (t < s) return -1;
    return Math.min(1.5, (t - s) / 0.75);
  }

  _streamActive(t) {
    if (this.choreo === 'lamp') {
      const m = this.lamp;
      return (t > m.passFrom && t < m.passEnd + 0.1) || (t > m.name - 1.1 && t < m.name);
    }
    if (this.choreo !== 'stream') return false;
    const s = this.T.lines[2];
    return t > s && t < s + 1.8;
  }

  _stream(t) {
    const s = this.choreo === 'lamp' ? this.lamp.name - 1.1 : this.T.lines[2];
    if (t < s || this.streamDone || !this.diyas.length || !this.outlinePts.length) return;
    this.streamDone = true;
    for (const d of this.diyas) {
      const z0 = this._layerZ(d.layer, t) + 0.006;
      const n = d.big ? 64 : 30;
      for (let i = 0; i < n; i++) {
        const [tx, ty] = this.outlinePts[(Math.random() * this.outlinePts.length) | 0];
        // stagger by giving each mote a negative start life
        this.sparks.stream(d.x + (Math.random() - 0.5) * d.r, d.y + d.r * 0.6, z0, tx, ty, 0.008, 1.1 + Math.random() * 0.9, d.big ? 0.03 : 0.024);
        this.sparks.life[this.sparks.n - 1] = -Math.random() * 0.9;
      }
    }
  }

  _diyas(t, time) {
    const n = this.diyas.length;
    const ch = this.choreo;
    this.diyas.forEach((d, i) => {
      let level = 0, boost = 1;
      if (ch === 'lamp') {
        const L = this.T.lines;
        const lit = smooth(L[0] + 0.2 + i * 0.26, L[0] + 0.5 + i * 0.26, t);
        if (d.big) {
          level = lit;
          boost = 1 + 0.6 * this._terraceDark(t);
        } else {
          level = Math.max(lit * (1 - smooth(d.outAt, d.outAt + 0.28, t)), smooth(d.backAt, d.backAt + 0.2, t));
        }
      } else if (ch === 'fade' || ch === 'stars') {
        const s = this.T.lines[ch === 'fade' ? 3 : 4];
        level = smooth(s + i * 0.12, s + i * 0.12 + 0.35, t);
      } else {
        const L = this.T.lines;
        if (!d.big) level = smooth(L[0] + 0.2 + i * 0.26, L[0] + 0.2 + i * 0.26 + 0.3, t);
        else {
          level = 0.5 * smooth(L[0] + 2.4, L[0] + 2.8, t) + 0.5 * smooth(L[1] + 0.1, L[1] + 1.1, t);
          boost = 1 + 0.7 * smooth(L[1] + 0.1, L[1] + 1.1, t);
        }
      }
      const flick = 0.86 + 0.1 * Math.sin(time * 11.0 + d.seed) + 0.06 * Math.sin(time * 23.0 + d.seed * 2.1);
      d.level = level;
      d.glow.material.opacity = level * flick * (d.big ? 0.9 : 0.6);
      d.glow.scale.setScalar(boost * (0.95 + 0.05 * flick));
      d.core.material.opacity = level * (0.55 + 0.35 * flick);
      d.core.position.x = d.x + Math.sin(time * 3.1 + d.seed) * d.r * 0.08;
    });
    const bigD = this.diyas.find((d) => d.big);
    for (const mat of this.litMats || []) {
      const u = mat.uniforms;
      if (mat.userData.layer === 11 && bigD) {
        u.uCount.value = 1;
        u.uDiya.value[0].set(bigD.x, bigD.y, 1, bigD.level); // the whole layer
      } else {
        // the parapet diyas stand close together: a tight mask lets them light one at a time
        u.uCount.value = n;
        this.diyas.forEach((d, i) => u.uDiya.value[i].set(d.x, d.y, d.big ? d.r * 1.3 : d.r * 0.5, d.level));
      }
    }
  }

  _write(mesh, p, visible, centred) {
    mesh.visible = visible;
    mesh.material.uniforms.uP.value = p;
    const writing = visible && p > 0 && p < 1;
    if (writing) {
      if (this.nib.parent !== mesh.parent) mesh.parent.add(this.nib);
      const w = mesh.userData.w;
      const x0 = mesh.position.x - w / 2;
      this.nib.position.set(x0 + w * Math.min(1, p * 1.05), mesh.position.y + Math.sin(p * 40) * 0.008, mesh.position.z + 0.002);
      this.nib.material.opacity = 0.9;
    } else if (!this._anyWriting) {
      this.nib.material.opacity = 0;
    }
    this._anyWriting = writing;
  }

  _line(obj, t, start, next) {
    const last = !isFinite(next);
    const end = last ? Infinity : next - (this.choreo === 'stars' ? 0.7 : 0.2);
    obj.group.visible = t > start - 0.05 && (last || t < end + 0.7);
    if (!obj.group.visible) return;
    const parts = obj.parts;
    for (const p of parts) {
      const s = start + (p.delay || 0) + p.order * 0.075;
      const a = easeOut((t - s) / 0.7);
      const out = last ? 0 : smooth(end, end + 0.6, t);
      const m = p.mesh;
      // each word flies in from further out towards the viewer, settles, then drifts up and away
      m.position.set(p.x, p.y + 0.03 * (1 - a) + out * 0.05, 0.22 * (1 - a) - out * 0.08);
      m.rotation.x = (1 - a) * -0.5;
      m.material.opacity = a * (1 - out);
    }
  }
}
