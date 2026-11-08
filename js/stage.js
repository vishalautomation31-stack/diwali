// One renderer for both versions. No camera: the card floats full screen in the night and tilts
// with the phone. Camera: the card's group is pinned to the printed card by the tracker.
import * as THREE from '../lib/three.module.min.js';
import { CARD_H } from './scene.js?v=717dd6026e';

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.01, 50);
    this.anchor = new THREE.Group(); // camera version: the tracked card
    this.anchor.matrixAutoUpdate = false;
    this.free = new THREE.Group(); // no-camera version
    this.scene.add(this.anchor, this.free);
    this.arScale = 1;
    this.mode = 'idle';
    this.tilt = { yaw: 0, pitch: 0, ty: 0, tp: 0, base: null, sensor: false };
    this._stars();
    this.resize = this.resize.bind(this);
    addEventListener('resize', this.resize);
    this.resize();
  }

  _stars() {
    const n = 420, pos = new Float32Array(n * 3), size = new Float32Array(n);
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (rnd() - 0.5) * 7;
      pos[i * 3 + 1] = (rnd() - 0.5) * 9;
      pos[i * 3 + 2] = -1.2 - rnd() * 3.5;
      size[i] = 0.006 + rnd() * 0.014;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('psize', new THREE.BufferAttribute(size, 1));
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 800 }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float psize; uniform float uScale; uniform float uTime; varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          vA = 0.55 + 0.45 * sin(uTime * (0.6 + fract(position.x * 7.1)) + position.y * 13.0);
          gl_PointSize = max(1.0, psize * uScale / -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() { float r = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, r) * vA; gl_FragColor = vec4(vec3(1.0, 0.93, 0.8) * a, a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.stars = new THREE.Points(g, this.starMat);
    this.stars.frustumCulled = false;
    this.free.add(this.stars);
  }

  setCard(card) {
    this.card = card;
    (this.mode === 'ar' ? this.anchor : this.free).add(card.root);
  }

  // ---------- no camera ----------
  useFree() {
    this.mode = 'free';
    this.world = false;
    this.free.visible = true;
    this.anchor.visible = false;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    if (this.card) {
      this.free.add(this.card.root);
      this.card.setCameraMode(false);
      this.card.setShear(0, 0);
    }
    this.camera.matrixAutoUpdate = true;
    this.resize();
  }

  enableTilt() {
    const onOri = (e) => {
      if (e.beta == null || e.gamma == null) return;
      const T = this.tilt;
      T.sensor = true;
      if (!T.base) T.base = { b: e.beta, g: e.gamma };
      // drift the rest position slowly, so a new way of holding the phone becomes "level"
      T.base.b += (e.beta - T.base.b) * 0.004;
      T.base.g += (e.gamma - T.base.g) * 0.004;
      const db = Math.max(-25, Math.min(25, e.beta - T.base.b));
      const dg = Math.max(-25, Math.min(25, e.gamma - T.base.g));
      T.tp = (-db * Math.PI) / 180 * 0.55;
      T.ty = (dg * Math.PI) / 180 * 0.65;
    };
    addEventListener('deviceorientation', onOri);
    // touch or mouse: drag to tilt
    let drag = null;
    this.canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; });
    addEventListener('pointerup', () => { drag = null; });
    addEventListener('pointermove', (e) => {
      if (!drag || this.tilt.sensor) return;
      this.tilt.ty = Math.max(-0.3, Math.min(0.3, ((e.clientX - drag.x) / innerWidth) * 0.9));
      this.tilt.tp = Math.max(-0.25, Math.min(0.25, ((e.clientY - drag.y) / innerHeight) * 0.8));
    });
  }

  _freeCamera(t, time) {
    const T = this.tilt;
    const sway = T.sensor ? 0 : 1;
    const ty = T.ty + sway * Math.sin(time * 0.35) * 0.06;
    const tp = T.tp + sway * Math.sin(time * 0.27 + 1.3) * 0.035;
    T.yaw += (ty - T.yaw) * 0.08;
    T.pitch += (tp - T.pitch) * 0.08;
    // the card turns to face you and the view pushes in while the layers lift, so their depth shows
    const intro = 1 - Math.pow(1 - Math.min(1, Math.max(0, t / 2.8)), 3);
    const d = this.fitDist * (1.1 - 0.1 * intro);
    const yaw = T.yaw + (1 - intro) * 0.24;
    const pitch = T.pitch - 0.05 * intro - (1 - intro) * 0.1;
    this.camera.position.set(d * Math.sin(yaw) * Math.cos(pitch), d * Math.sin(pitch), d * Math.cos(yaw) * Math.cos(pitch));
    this.camera.lookAt(0, 0, 0.06);
  }

  // ---------- camera ----------
  useAR(scale) {
    this.mode = 'ar';
    this.arScale = scale;
    this.free.visible = false;
    // a little less detail than the no-camera version: the tracker shares the phone's GPU
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    if (this.card) {
      this.anchor.add(this.card.root);
      this.card.setCameraMode(true);
    }
    this.anchor.visible = false;
    this.camera.position.set(0, 0, 0);
    this.camera.quaternion.identity();
    this.camera.updateMatrixWorld(true);
  }

  // projection from the tracker (MindAR), as MindAR's own three.js wrapper does it
  setARProjection(proj, inputW, inputH, video) {
    this.ar = { proj, inputW, inputH, video };
    this.resize();
  }

  // the world-tracked page: the engine gives the projection directly
  setWorldProjection(m) {
    this.world = true;
    this.camera.projectionMatrix.fromArray(m);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    this.camera.position.set(0, 0, 0);
    this.camera.quaternion.identity();
    this.camera.matrixAutoUpdate = false;
    this.camera.matrix.identity();
    this.camera.updateMatrixWorld(true);
    this.pointScale = (innerHeight * this.renderer.getPixelRatio() * m[5]) / 2;
  }

  // where the card is now, in camera space
  setCardPose(p, q, s) {
    this.anchor.matrix.compose(_p.set(p[0], p[1], p[2]), _q.set(q[0], q[1], q[2], q[3]), _s.set(s, s, s));
    this.anchor.visible = true;
  }

  hideCard() {
    this.anchor.visible = false;
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    if (this.world) return;
    if (this.mode === 'ar' && this.ar) {
      const { proj: m, inputW, inputH, video } = this.ar;
      const vw = video.videoWidth, vh = video.videoHeight;
      const va = vw / vh, ca = w / h;
      let dw, dh;
      if (va > ca) { dh = h; dw = dh * va; } else { dw = w; dh = dw / va; }
      video.style.width = dw + 'px';
      video.style.height = dh + 'px';
      video.style.left = -(dw - w) / 2 + 'px';
      video.style.top = -(dh - h) / 2 + 'px';
      // the view that shows the tracker's frame the way the video is shown (same aspect, so cover)
      const ia = inputW / inputH;
      const fh = ia > ca ? h : (w / inputW) * inputH;
      const ratio = h / fh;
      this.camera.fov = (2 * Math.atan((1 / m[5]) * ratio) * 180) / Math.PI;
      this.camera.near = m[14] / (m[10] - 1);
      this.camera.far = m[14] / (m[10] + 1);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    } else {
      this.camera.fov = 32;
      this.camera.near = 0.01;
      this.camera.far = 50;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      const half = Math.tan((this.camera.fov * Math.PI) / 360);
      const margin = 0.07;
      const dH = (CARD_H / 2 + margin) / half;
      const dW = (0.5 + margin) / (half * this.camera.aspect);
      this.fitDist = Math.max(dH, dW) + 0.06;
    }
    const pxH = h * this.renderer.getPixelRatio();
    this.pointScale = pxH / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    this.starMat.uniforms.uScale.value = this.pointScale;
    if (this.card) this.card.pointScale = this.pointScale;
  }

  render(t, time) {
    if (this.mode === 'free') this._freeCamera(t, time);
    this.starMat.uniforms.uTime.value = time;
    // sparks are sized in card units; in camera mode a card unit is the tracker's image width
    if (this.card) this.card.pointScale = this.pointScale * (this.mode === 'ar' ? this.arScale : 1);
    if (this.card?.sky) this.renderer.getDrawingBufferSize(this.card.sky.mat.uniforms.uView.value);
    this.renderer.render(this.scene, this.camera);
  }
}
