// A card placed on a real surface, from a link, with no printed image: the world tracking comes from
// 8th Wall's XR engine (lib/xr/, Copyright 2026 Niantic Spatial, Inc., under its XR Engine License
// Agreement: lib/xr/LICENSE). The engine draws the camera on its own canvas under the page's; this
// file turns its camera pose into the card's pose, and leaves the rest of the page as it is.
import * as THREE from '../lib/three.module.min.js';
import { glowQuad, radialTexture } from './fx.js?v=65a035480c';
import { CARD_H } from './scene.js?v=65a035480c';
import { World } from './world.js?v=65a035480c';
import { flameTexture } from './sprites.js?v=65a035480c';

const CAMERA_Y = 1.3;    // how high the engine's world puts the camera; the surface is y = 0
const AIM_Y = -0.2;      // where on the screen the flame sits (-1 bottom, 1 top): the card stands up from there
const MIN_DOWN = 0.32;   // how steeply the aim must point down before it counts as the surface
const FILL = 0.54;       // how much of the view's width the card takes when it lands: the room gets the rest
export const OPENING = 1.1; // seconds it lies closed and swings open before the sequence's own clock starts
const SETTLE = 3500;     // ms to wait for the engine to say it is tracking before trusting it anyway
const HALF_H = CARD_H / 2;

const ONE = new THREE.Vector3(1, 1, 1);
const _a = new THREE.Matrix4(), _b = new THREE.Matrix4(), _c = new THREE.Matrix4();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _v = new THREE.Vector3();
const _q = new THREE.Quaternion(), _e = new THREE.Euler();
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const easeBack = (x) => { const t = clamp(x, 0, 1) - 1; return 1 + 2.2 * t * t * t + 1.2 * t * t; };
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

let engine = null;
export function loadEngine() {
  engine ||= new Promise((resolve, reject) => {
    if (window.XR8) return resolve(window.XR8);
    const s = document.createElement('script');
    s.src = 'lib/xr/xr.js';
    s.async = true;
    s.dataset.preloadChunks = 'slam';
    s.onerror = () => reject(new Error('the engine did not load'));
    window.addEventListener('xrloaded', () => resolve(window.XR8), { once: true });
    document.head.appendChild(s);
  });
  return engine;
}

export class SurfaceAR {
  constructor({ container, stage, clock, draw, onPlaced, onError, onHint, onStats }) {
    Object.assign(this, { container, stage, clock, draw, onPlaced, onError, onHint, onStats });
    this.camPos = new THREE.Vector3();
    this.camRot = new THREE.Quaternion();
    this.camInv = new THREE.Matrix4();
    this.hit = new THREE.Vector3();
    this.hasHit = false;
    this.placed = false;
    this.drives = false; // once the engine runs, the page draws from its loop, in step with the camera
    this.lastM = 0;
    this.lastHint = '';
  }

  async start() {
    const XR8 = await loadEngine();
    const devices = { allowedDevices: XR8.XrConfig.device().MOBILE_AND_HEADSETS };
    if (!XR8.XrDevice.isDeviceBrowserCompatible(devices)) throw new Error('not supported here: ' + XR8.XrDevice.incompatibleReasons(devices).join(', '));
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    this.container.appendChild(canvas);
    this.canvas = canvas;
    const cam = () => ({ pixelRectWidth: canvas.width, pixelRectHeight: canvas.height, nearClipPlane: 0.01, farClipPlane: 100 });
    const fit = () => {
      const r = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(innerWidth * r);
      canvas.height = Math.round(innerHeight * r);
    };
    fit();
    this.resize = () => {
      fit();
      if (this.started) XR8.XrController.updateCameraProjectionMatrix({ cam: cam() });
    };
    addEventListener('resize', this.resize);
    this._buildMarks();
    this.tap = (e) => this._place(e);
    window.addEventListener('pointerup', this.tap);
    this.t0 = performance.now();

    XR8.XrController.configure({ scale: 'responsive', enableLighting: false });
    XR8.addCameraPipelineModules([
      XR8.GlTextureRenderer.pipelineModule(),
      XR8.XrController.pipelineModule(),
      {
        name: 'greeting-card',
        onStart: () => {
          XR8.XrController.updateCameraProjectionMatrix({
            origin: { x: 0, y: CAMERA_Y, z: 0 },
            facing: { w: 1, x: 0, y: 0, z: 0 },
            cam: cam(),
          });
          this.started = true;
          this.t0 = performance.now();
        },
        onUpdate: ({ processCpuResult }) => {
          const r = processCpuResult.reality;
          if (!r) return;
          this.camPos.set(r.position.x, r.position.y, r.position.z);
          this.camRot.set(r.rotation.x, r.rotation.y, r.rotation.z, r.rotation.w);
          this.intrinsic = r.intrinsics;
          this.status = r.trackingStatus;
        },
        onRender: () => {
          this.drives = true;
          this.draw(performance.now());
        },
        onException: (e) => this._fail(e),
        onCameraStatusChange: ({ status, reason }) => {
          this.onStats?.('camera: ' + status);
          if (status === 'failed') this._fail(new Error('camera: ' + reason));
        },
      },
    ]);
    this.XR8 = XR8;
    XR8.run({ canvas, allowedDevices: devices.allowedDevices, cameraConfig: { direction: XR8.XrConfig.camera().BACK } });
  }

  _fail(e) {
    if (this.failed) return;
    this.failed = true;
    this.onError?.(e);
  }

  _buildMarks() {
    const scene = this.stage.scene;
    this.flame = glowQuad(flameTexture(), 1, '#ffffff', 60);
    this.flame.material.blending = THREE.NormalBlending;
    this.ring = glowQuad(radialTexture([[0, 'rgba(255,190,110,0)'], [0.6, 'rgba(255,190,110,0)'], [0.76, 'rgba(255,205,140,0.8)'], [0.9, 'rgba(255,190,110,0)'], [1, 'rgba(255,190,110,0)']], 128), 1, '#ffffff', 59);
    // a soft shadow on the surface where the card stands
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: radialTexture([[0, 'rgba(5,3,14,0.66)'], [0.55, 'rgba(5,3,14,0.42)'], [1, 'rgba(5,3,14,0)']], 128), transparent: true, depthWrite: false, opacity: 0 })
    );
    this.shadow.renderOrder = 1;
    // the card's cover: plain paper, closed over the art, hinged along the same edge
    this.cover = new THREE.Mesh(
      new THREE.PlaneGeometry(1, CARD_H).translate(0, HALF_H, 0),
      new THREE.MeshBasicMaterial({ color: '#1a1445', side: THREE.DoubleSide, transparent: true, depthWrite: false, opacity: 0, toneMapped: false })
    );
    this.cover.renderOrder = 96;
    for (const o of [this.flame, this.ring, this.shadow, this.cover]) {
      o.frustumCulled = false;
      o.matrixAutoUpdate = false;
      o.material.depthTest = false;
      o.visible = false;
      scene.add(o);
    }
    // walk behind it and it is still a card
    this.back = new THREE.Mesh(new THREE.PlaneGeometry(1, CARD_H), new THREE.MeshBasicMaterial({ color: '#1a1445', side: THREE.BackSide, toneMapped: false }));
    this.back.position.z = -0.001;
    this.stage.card.root.add(this.back);
    // everything in the room is drawn after the card; this keeps what is behind the card behind it
    this.proxy = new THREE.Mesh(new THREE.PlaneGeometry(1, CARD_H), new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide }));
    this.proxy.position.z = -0.004;
    this.proxy.renderOrder = -1;
    this.stage.card.root.add(this.proxy);
    this.world = new World(this.stage.card);
    this.world.group.visible = false;
    this.stage.scene.add(this.world.group);
    this.world.warm(this.stage.renderer);
  }

  // where the aim meets the surface
  _aim() {
    const m = this.intrinsic;
    const ray = _v.set((0 + m[8]) / m[0], (AIM_Y + m[9]) / m[5], -1).normalize();
    this.along = -ray.z;
    ray.applyQuaternion(this.camRot);
    if (ray.y > -MIN_DOWN) return false;
    const k = -this.camPos.y / ray.y;
    if (k <= 0) return false;
    this.hit.copy(this.camPos).addScaledVector(ray, k);
    this.depth = k * this.along;
    return true;
  }

  _hint(h) {
    if (h !== this.lastHint) this.onHint?.((this.lastHint = h));
  }

  _place(e) {
    if (this.placed || !this.hasHit) return;
    if (e.target?.closest?.('button')) return;
    this.placed = true;
    this.flame.visible = this.ring.visible = false;
    this.width = (2 * this.depth * FILL) / this.intrinsic[0];
    this.base = this.hit.clone();
    // it faces whoever is holding the phone, and leans back for someone looking down at it
    const to = this.camPos.clone().sub(this.base);
    this.yaw = Math.atan2(to.x, to.z);
    const elevation = Math.atan2(to.y, Math.hypot(to.x, to.z));
    this.lean = clamp(elevation * 0.75, 0.2, 0.85);
    this.stage.arScale = this.width;
    this.shadow.visible = this.cover.visible = true;
    this.world.group.visible = true;
    this.stage.card.sky?.setFloor(-HALF_H, { spread: 1.75, lean: this.lean, fountains: [[-1.3, 0.55], [1.3, 0.55], [-0.62, 1.55], [0.62, 1.55]] });
    this.onPlaced?.();
  }

  // every frame, from the page's own step
  frame() {
    const m = this.intrinsic;
    if (!m) return;
    if (this.lastM !== m[0] * m[5]) {
      this.stage.setWorldProjection(m);
      this.lastM = m[0] * m[5];
    }
    this.camInv.compose(this.camPos, this.camRot, ONE).invert();
    if (this.placed) this._stand();
    else this._look();
    if (this.onStats) {
      this.frames = (this.frames || 0) + 1;
      const now = performance.now();
      if (now - (this.statAt || 0) > 500) {
        const fps = this.statAt ? Math.round((this.frames * 1000) / (now - this.statAt)) : 0;
        this.onStats(`tracking ${this.status} | ${fps} fps | ${this.placed ? 'placed' : this.hasHit ? 'aim on surface' : 'aim too high'} | height ${this.camPos.y.toFixed(2)}`);
        this.statAt = now;
        this.frames = 0;
      }
    }
  }

  _look() {
    const settled = this.status === 'NORMAL' || performance.now() - this.t0 > SETTLE;
    this.hasHit = settled && this._aim();
    this.flame.visible = this.ring.visible = this.hasHit;
    this._hint(this.hasHit ? 'place' : 'point');
    if (!this.hasHit) return;
    const size = this.depth * 0.17, time = performance.now() / 1000;
    // the ring lies on the surface
    _a.compose(_v.copy(this.hit), _q.setFromEuler(_e.set(-Math.PI / 2, 0, 0, 'YXZ')), _s.set(size * 1.6, size * 1.6, 1));
    this.ring.matrix.multiplyMatrices(this.camInv, _a);
    this.ring.material.opacity = 0.75 + 0.2 * Math.sin(time * 3.2);
    // the flame stands on it, turned to the phone, and flickers
    const flick = 1 + 0.07 * Math.sin(time * 13) + 0.04 * Math.sin(time * 29);
    _a.compose(_v.copy(this.hit).setY(size * 0.42 * flick), this.camRot, _s.set(size * 0.46, size * 0.92 * flick, 1));
    this.flame.matrix.multiplyMatrices(this.camInv, _a);
    this.flame.material.opacity = 1;
  }

  _stand() {
    const t = this.clock(), w = this.width;
    const there = smooth(-OPENING, -OPENING + 0.25, t);
    // the cover swings up off the art towards the viewer and is gone...
    const coverAngle = -Math.PI / 2 + (Math.PI / 2 + 0.6) * smooth(-0.55, 0.35, t);
    this.cover.visible = t < 0.35;
    this.cover.material.opacity = there * (1 - smooth(-0.05, 0.35, t));
    _a.makeTranslation(this.base.x, 0, this.base.z);
    _a.multiply(_b.makeRotationY(this.yaw));
    _a.multiply(_b.makeRotationX(coverAngle));
    _a.multiply(_b.makeScale(w, w, w));
    this.cover.matrix.multiplyMatrices(this.camInv, _a);
    // ...as the card stands up, on its bottom edge
    const angle = -Math.PI / 2 + (Math.PI / 2 - this.lean) * easeBack((t + 0.3) / 1.3);
    if (there < 1) this.stage.hideCard();
    else {
      _a.makeTranslation(this.base.x, 0, this.base.z);
      _a.multiply(_b.makeRotationY(this.yaw));
      _a.multiply(_b.makeRotationX(angle));
      _a.multiply(_b.makeTranslation(0, w * HALF_H, 0));
      _a.multiply(_b.makeScale(w, w, w));
      _c.multiplyMatrices(this.camInv, _a).decompose(_p, _q, _s);
      this.stage.setCardPose([_p.x, _p.y, _p.z], [_q.x, _q.y, _q.z, _q.w], _s.x);
    }
    // the sky stays upright as the card leans, with its floor on the real surface
    const sky = this.stage.card.sky;
    if (sky) {
      sky.group.rotation.x = -angle;
      sky.group.position.set(0, HALF_H * Math.cos(angle) - HALF_H, -HALF_H * Math.sin(angle));
    }
    _a.compose(_v.set(this.base.x, 0, this.base.z), _q.setFromEuler(_e.set(-Math.PI / 2, this.yaw, 0, 'YXZ')), _s.set(w * 1.5, w * 0.8, 1));
    this.shadow.matrix.multiplyMatrices(this.camInv, _a);
    this.shadow.material.opacity = there;
    // the room round it
    _a.compose(_v.set(this.base.x, 0, this.base.z), _q.setFromEuler(_e.set(0, this.yaw, 0, 'YXZ')), _s.set(w, w, w));
    this.world.group.matrix.multiplyMatrices(this.camInv, _a);
    this.world.update(t, performance.now() / 1000);
    const card = this.stage.card;
    document.body.classList.toggle('blackout', !!card.lamp && card._terraceDark(t) > 0.4);
  }

  stop() {
    this.drives = false;
    if (this.tap) window.removeEventListener('pointerup', this.tap);
    if (this.resize) removeEventListener('resize', this.resize);
    try { this.XR8?.stop(); this.XR8?.clearCameraPipelineModules(); } catch {}
    this.canvas?.remove();
    for (const o of [this.flame, this.ring, this.shadow, this.cover]) if (o) this.stage.scene.remove(o);
    this.back?.removeFromParent();
    this.proxy?.removeFromParent();
    if (this.world) this.stage.scene.remove(this.world.group);
    document.body.classList.remove('blackout');
    const sky = this.stage.card.sky;
    if (sky) {
      sky.group.rotation.x = 0;
      sky.group.position.set(0, 0, 0);
      sky.setFloor(null);
    }
  }
}
