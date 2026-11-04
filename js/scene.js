// The card, alive. Everything is in card units: width 1, height 1.4, origin at the card's
// centre, y up, +z off the card towards the viewer. The same group is drawn full screen
// (no camera) or pinned to the printed card (camera).
//
// The sequence is a pure function of t (seconds since it began), so Replay is exact.
// Times follow the brief, section 5; each card's choreography follows its own words.
import * as THREE from '../lib/three.module.min.js';
import { buildNamePath, pathPoint, ribbonGeometry, trailMaterial, printMaterial, Sparks, glowQuad, radialTexture, starTexture } from './fx.js?v=fc7076ce77';
import { makeLine } from './text.js?v=fc7076ce77';

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

// Depth of each of Codex's layers, by layer number, in card widths (before this.depth):
// 1 sky, 2 far bursts, 3 skyline, 4 terrace and house, 5 family, 6 diyas unlit, 7 diyas lit,
// 8 strings of lights and lantern, 9 rangoli (brief section 4); optional near layers
// 10 big diya unlit, 11 big diya lit, 12 plants, 13 house, stairs and lantern (ar/README.md).
const LAYER_Z = { 1: 0, 2: 0.016, 3: 0.04, 4: 0.075, 5: 0.12, 6: 0.085, 7: 0.086, 8: 0.092, 9: 0.08, 10: 0.15, 11: 0.151, 12: 0.165, 13: 0.14 };
const DRAW_ORDER = [1, 2, 3, 4, 9, 6, 7, 8, 5, 13, 12, 10, 11];
const LIT = new Set([7, 11]);
const MAX_DIYAS = 24;

const LIT_VS = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const LIT_FS = /* glsl */ `
  uniform sampler2D map; uniform vec4 uDiya[${MAX_DIYAS}]; uniform int uCount; uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(map, vUv);
    vec2 p = vec2(vUv.x - 0.5, (vUv.y - 0.5) * ${CARD_H.toFixed(2)});
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
  constructor({ card, poster, layers, shadows, sceneInfo, logo, hand }) {
    this.card = card;
    this.choreo = card.choreo === 'stream' ? 'stream' : 'fade';
    this.root = new THREE.Group();
    this.root.name = 'card';
    this.content = new THREE.Group(); // everything that lifts and lights
    this.root.add(this.content);
    this.pointScale = 800;
    this.crackle = 0;
    this.lastT = -1;
    this.depth = 1.8; // how far the layers lift, as a multiple of LAYER_Z
    this.introFade = false;
    this._buildLayers(poster, layers, shadows);
    this._buildDiyas(sceneInfo?.diyas || []);
    this._buildName();
    this._buildAmbient(sceneInfo?.sparklers || []);
    this._buildWords(hand);
    this._buildLogo(logo);
    this.reset();
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
    const have = layers ? DRAW_ORDER.filter((n) => layers[n]) : [];
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
          (this.litMats ||= []).push(mat);
        } else {
          mat = new THREE.MeshBasicMaterial({ map: tex, transparent: n !== 1, depthWrite: false, toneMapped: false });
        }
        const m = new THREE.Mesh(geo, mat);
        m.renderOrder = 10 + order * 2 + 1;
        this.content.add(m);
        const L = { n, mesh: m, z: LAYER_Z[n], order, lit: LIT.has(n) };
        // a soft shadow of the layer, on whatever is behind it: the paper-cut depth
        if (n >= 2 && shadows && shadows[n] && !LIT.has(n)) {
          const sm = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this._tex(shadows[n]), transparent: true, depthWrite: false, opacity: 0, toneMapped: false }));
          sm.renderOrder = 10 + order * 2;
          this.content.add(sm);
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
    return easeBack((t - 0.12 - order * 0.075) / 0.85);
  }

  _layerZ(n, t) {
    return this.layered && LAYER_Z[n] !== undefined ? LAYER_Z[n] * this.depth * this._lift(n, t) : 0;
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
    this.trail = new THREE.Mesh(ribbonGeometry(this.path, 0.0085), trailMaterial(false));
    this.trail.position.z = 0.006;
    this.trail.renderOrder = 31;
    this.halo = new THREE.Mesh(ribbonGeometry(this.path, 0.055), trailMaterial(true));
    this.halo.position.z = 0.007;
    this.halo.renderOrder = 32;
    this.halo.material.uniforms.uOpacity.value = 0.55;
    this.nameGroup.add(this.print, this.trail, this.halo);
    this.trail.material.uniforms.uDrawDur.value = this.halo.material.uniforms.uDrawDur.value = TIMES.draw[1] - TIMES.draw[0];

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
    this.fireSpots = [[-0.4, 0.13], [0.36, 0.11], [-0.27, 0.05], [0.42, 0.2], [-0.12, 0.17], [0.18, 0.06]];
    this.fireColors = ['#f6ad2b', '#fff3dc', '#e9467a', '#f2862b', '#ffd27a'].map((c) => new THREE.Color(c));
  }

  // the children's sparklers: how hard they burn at time t (0 out .. 1.6 flaring)
  _kidRate(t) {
    if (t < 1.0) return 0;
    if (this.choreo === 'fade') {
      const L = TIMES.lines.fade;
      // they flare with line 1 and burn out with line 2
      return 0.6 + 1.0 * smooth(L[0] - 0.2, L[0] + 0.4, t) - 1.6 * smooth(L[1] + 0.15, L[1] + 1.1, t);
    }
    return 0.65;
  }

  _fireworksOn(t) {
    if (t < 1.8) return false;
    if (this.choreo === 'fade') {
      const L = TIMES.lines.fade;
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

  _buildWords(hand) {
    const st = this.card.style;
    this.textZ = 0.34; // in front of the nearest layer (0.165 x depth)
    // "for", above the name
    this.forMesh = this._handOrLabel(hand?.for, 'for', st.forAt.h);
    this.forMesh.position.set(st.forAt.x + this.forMesh.userData.w / 2, st.forAt.y, 0.012);
    this.content.add(this.forMesh);
    this.nib = glowQuad(starTexture(64), 0.03, '#ffffff', 86);
    this.content.add(this.nib);

    // the wish
    this.veil = new THREE.Mesh(
      new THREE.PlaneGeometry(1.08, 0.56),
      new THREE.MeshBasicMaterial({ map: radialTexture([[0, 'rgba(9,6,28,0.92)'], [0.55, 'rgba(9,6,28,0.6)'], [1, 'rgba(9,6,28,0)']], 256), transparent: true, depthWrite: false, opacity: 0 })
    );
    this.veil.scale.set(1, 1, 1);
    this.textY = 0.1;
    this.veil.position.set(0, this.textY - 0.06, this.textZ - 0.012);
    this.veil.renderOrder = 75;
    this.content.add(this.veil);
    this.lineObjs = this.card.lines.map((text) => {
      const L = makeLine(text, { size: 0.072, maxWidth: 0.86 });
      L.group.position.set(0, this.textY, this.textZ);
      this.content.add(L.group);
      return L;
    });

    // "from Vishal", under the wish
    this.fromMesh = this._handOrLabel(hand?.from, this.card.from || 'from Vishal', st.fromAt.h);
    this.fromMesh.position.set(st.fromAt.x, st.fromAt.y, this.textZ);
    this.content.add(this.fromMesh);
  }

  // The MorningLabs AI mark, cut out of its near-black ground (tools/prepare_logo.py: every pixel
  // keeps its colour), in pieces so its three dots can light one after another and breathe.
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
    this.root.add(g);
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
      for (const [x, y] of points) {
        g.clearRect(0, 0, 1, 1);
        g.drawImage(img, (x + 0.5) * img.width, (0.5 - y / CARD_H) * img.height, 1, 1, 0, 0, 1, 1);
        if (g.getImageData(0, 0, 1, 1).data[3] > 160 && LAYER_Z[L.n] >= LAYER_Z[front]) front = L.n;
      }
    }
    return front;
  }

  _logo(t, time) {
    if (!this.logoGroup) return;
    const t0 = TIMES.logo[0];
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
  }

  // State at time t. dt drives the particles only.
  update(t, dt, now) {
    const ch = this.choreo;
    const L = TIMES.lines[ch];
    const time = now ?? performance.now() / 1000;

    // 1. layers lift, back to front (the reference's layer build), each casting a soft shadow
    for (const l of this.layers) {
      const p = this.layered ? this._lift(l.n, t) : 0;
      const z = l.z * this.depth * p;
      l.mesh.position.z = z;
      if (l.shadow) {
        l.shadow.position.set(z * 0.1, -z * 0.16, Math.max(0, z - 0.004));
        l.shadow.material.opacity = 0.75 * clamp01(p);
      }
    }
    const night = this._night(t);
    for (const l of this.layers) if (!l.lit && l.mesh.material.color) l.mesh.material.color.setScalar(night);
    const enter = this.introFade ? smooth(0, 0.35, t) : 1; // camera: fade the render in over the print
    for (const l of this.layers) {
      if (l.lit) l.mesh.material.uniforms.uOpacity.value = enter;
      else l.mesh.material.opacity = enter;
    }
    for (const d of this.diyas) {
      const z = this._layerZ(d.layer, t);
      d.glow.position.z = z + 0.002;
      d.core.position.z = z + 0.003;
    }

    // 2. the name: printed outline, the spark drawing it, its glow per the choreography
    const d0 = TIMES.draw[0], d1 = TIMES.draw[1];
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
    this.print.material.uniforms.uOpacity.value = enter * (0.9 - 0.25 * smooth(d0, d0 + 0.6, t) + 0.25 * smooth(d1, d1 + 1.5, t));
    const drawing = t >= d0 && t < d1;
    if (drawing) {
      const [x, y, on] = pathPoint(this.path, drawP);
      this.head.position.set(x, y, 0.014);
      this.head.material.opacity = on ? 0.95 : 0.35;
      const s = 0.8 + 0.4 * Math.random();
      this.head.scale.set(s, s, 1);
      if (on && dt > 0) this.sparks.emit(x, y, 0.012, Math.round(dt * 300 + Math.random()), { speed: 0.5, ttl: 0.55, size: 0.011 });
    } else if (relight >= 0 && relight <= 1) {
      const [x, y] = pathPoint(this.path, relight);
      this.head.position.set(x, y, 0.014);
      this.head.material.opacity = 0.8;
      if (dt > 0) this.sparks.emit(x, y, 0.012, Math.round(dt * 160 + Math.random()), { speed: 0.35, ttl: 0.4, size: 0.009 });
    } else {
      this.head.material.opacity = 0;
    }
    this.crackle = drawing ? 1 : relight >= 0 && relight <= 1 ? 0.7 : this._streamActive(t) ? 0.25 : 0;

    // 3. "for" writes itself
    const fp = clamp01((t - TIMES.forWrite[0]) / (TIMES.forWrite[1] - TIMES.forWrite[0]));
    this._write(this.forMesh, fp, t > TIMES.forWrite[0] - 0.01);

    // 4. diyas
    this._diyas(t, time);

    // 5. the wish, one line at a time
    this.veil.material.opacity = 0.62 * smooth(L[0] - 0.3, L[0] + 0.5, t);
    this.lineObjs.forEach((obj, k) => this._line(obj, t, L[k], k + 1 < L.length ? L[k + 1] : Infinity));

    // 6. "from Vishal", then the mark
    const wp = clamp01((t - TIMES.fromWrite[0]) / (TIMES.fromWrite[1] - TIMES.fromWrite[0]));
    this._write(this.fromMesh, wp, t > TIMES.fromWrite[0] - 0.01, true);
    this._logo(t, time);

    // 7. the light stream (one choreography), the children's sparklers, far fireworks, idle embers
    if (ch === 'stream') this._stream(t);
    this._ambient(t, dt);
    if (t > TIMES.end - 1.5 && dt > 0) {
      this.emberClock -= dt;
      if (this.emberClock <= 0 && this.outlinePts.length) {
        this.emberClock = 0.12 + Math.random() * 0.3;
        const [x, y] = this.outlinePts[(Math.random() * this.outlinePts.length) | 0];
        this.sparks.emit(x, y, 0.01, 2 + ((Math.random() * 3) | 0), { speed: 0.18, ttl: 0.9, size: 0.008, kind: Math.random() < 0.5 ? 1 : 0, lift: 0.08 });
      }
    }
    this.sparks.mat.uniforms.uScale.value = this.pointScale;
    if (dt > 0) this.sparks.update(Math.min(dt, 0.05));
    this.lastT = t;
  }

  _night(t) {
    if (this.choreo === 'fade') {
      const L = TIMES.lines.fade;
      // dims "in the dark" (line 2), comes back up with the diyas (line 4)
      return 0.84 - 0.24 * smooth(L[1], L[1] + 0.9, t) + 0.4 * smooth(L[3], L[3] + 1.4, t);
    }
    const L = TIMES.lines.stream;
    return 0.8 + 0.2 * smooth(L[0], L[0] + 2.6, t);
  }

  _nameGlow(t) {
    const d1 = TIMES.draw[1];
    if (this.choreo === 'fade') {
      const L = TIMES.lines.fade;
      // fades as line 1 arrives, like a real sparkler trail; dark for line 2; lit again at line 3
      if (t < L[2]) return 1 - smooth(L[0] - 0.1, L[1] - 0.4, t);
      return smooth(L[2] + 0.5, L[2] + 0.9, t);
    }
    const L = TIMES.lines.stream;
    // dims after drawing; the stream from the diyas lights it at line 3, and it remains lit
    const low = 1 - 0.8 * smooth(d1 + 0.1, L[0] + 2.2, t);
    return Math.max(low, smooth(L[2] + 1.0, L[2] + 2.0, t));
  }

  _relight(t) {
    if (this.choreo !== 'fade') return -1;
    const s = TIMES.lines.fade[2];
    if (t < s) return -1;
    return Math.min(1.5, (t - s) / 0.75);
  }

  _streamActive(t) {
    if (this.choreo !== 'stream') return false;
    const s = TIMES.lines.stream[2];
    return t > s && t < s + 1.8;
  }

  _stream(t) {
    const s = TIMES.lines.stream[2];
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
      if (ch === 'fade') {
        const s = TIMES.lines.fade[3];
        level = smooth(s + i * 0.12, s + i * 0.12 + 0.35, t);
      } else {
        const L = TIMES.lines.stream;
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
    for (const mat of this.litMats || []) {
      const u = mat.uniforms;
      u.uCount.value = n;
      this.diyas.forEach((d, i) => u.uDiya.value[i].set(d.x, d.y, d.r * (d.big ? 1.3 : 1), d.level));
    }
  }

  _write(mesh, p, visible, centred) {
    mesh.visible = visible;
    mesh.material.uniforms.uP.value = p;
    const writing = visible && p > 0 && p < 1;
    if (writing) {
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
    const end = last ? Infinity : next - 0.2;
    obj.group.visible = t > start - 0.05 && (last || t < end + 0.7);
    if (!obj.group.visible) return;
    const parts = obj.parts;
    for (const p of parts) {
      const s = start + p.order * 0.075;
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
