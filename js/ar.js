// Camera version: MindAR 1.2.5 image tracking on the printed front of the card.
//
// MindAR's GPU code fails on some phones (reported for iOS 27, MindAR issue #581: "Failed to link
// vertex and fragment shaders"). So before asking for the camera, a probe runs MindAR once on a
// blank frame. If it fails, it is retried with TensorFlow.js's packed shaders off (the workaround
// in tfjs issue #8562); if that fails too, the page plays the no-camera version instead.
//
// The tracker is paced here rather than left to run flat out, so the 3D scene gets the frame time.
// Its estimates go through PoseStabilizer and the phone's motion sensor (stabilize.js), so the card
// moves smoothly with the hand and the wobble of single estimates never reaches the screen.
import * as THREE from '../lib/three.module.min.js';
import { PoseStabilizer, qMul, qConj, qRot } from './stabilize.js?v=f4fccf2e73';
import { Motion } from './motion.js?v=f4fccf2e73';

const TICK_TRACK = 40; // ms between tracker runs while it holds the card (25 a second)
const TICK_SEARCH = 70; // ms between searches: detection is heavier
const WARM = 3; // tracked frames before the card is shown
const HOLD = 900; // ms the card stays after the tracker loses it, held by the sensor
const LATENCY = 70; // ms: how old a camera frame is by the time it is on screen

let MINDAR = null;
async function mindar() {
  if (!MINDAR) MINDAR = await import('../lib/mindar/mindar-image.prod.js');
  return MINDAR;
}

function tfEnv() {
  return globalThis._tfengine && globalThis._tfengine.ENV;
}

function blankFrame(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#556';
  g.fillRect(0, 0, w, h);
  return c;
}

async function runProbe(mind) {
  const { Controller } = await mindar();
  const [w, h] = innerHeight > innerWidth ? [480, 640] : [640, 480];
  const ctl = new Controller({ inputWidth: w, inputHeight: h, maxTrack: 1 });
  try {
    ctl.addImageTargetsFromBuffer(mind.slice(0));
    ctl.dummyRun(blankFrame(w, h));
  } finally {
    try { ctl.dispose(); } catch {}
  }
}

// Resolves to { ok, note }. Never throws.
export async function probe(mind) {
  if (!mind) return { ok: false, note: 'no tracking target yet' };
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return { ok: false, note: 'no camera API' };
  try {
    await runProbe(mind);
    return { ok: true, note: 'default' };
  } catch (e1) {
    const env = tfEnv();
    if (!env) return { ok: false, note: 'probe failed: ' + (e1 && e1.message) };
    try {
      env.set('WEBGL_PACK', false);
      await runProbe(mind);
      return { ok: true, note: 'WEBGL_PACK off' };
    } catch (e2) {
      return { ok: false, note: 'probe failed twice: ' + (e2 && e2.message) };
    }
  }
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class CameraAR {
  constructor({ container, stage, mind, onFound, onLost, onError, rawPose = false }) {
    this.container = container;
    this.stage = stage;
    this.mind = mind;
    this.onFound = onFound;
    this.onLost = onLost;
    this.onError = onError;
    this.rawPose = rawPose; // local test only: draw the tracker's estimates as they come
    this.found = false;
    this.running = false;
    this.stab = new PoseStabilizer();
    this.motion = new Motion();
    this.qPrev = null;
    this.tilt = { yaw: 0, pitch: 0 };
    this.words = null;
    this.ticks = 0;
    this.sensorBad = false; // the sensor disagreed with the camera: stop trusting it
    this.agree = 0;
    this.agreeN = 0;
    this.prevSeen = null;
  }

  // the sensor's view of the camera, unless it has proved wrong on this phone
  _sensorAt(t) {
    return this.sensorBad ? null : this.motion.at(t);
  }

  // Does the sensor agree with what the camera sees? When the phone turns, the card should move the
  // way the sensor predicts. If it keeps moving the other way (a phone that reports differently, or
  // a screen orientation we did not expect), the sensor is dropped and smoothing uses the camera alone.
  _checkSensor(P, qFrame) {
    const prev = this.prevSeen;
    this.prevSeen = qFrame ? { p: P, q: qFrame } : null;
    if (!prev || !qFrame) return;
    const pred = qRot(qMul(qConj(qFrame), prev.q), prev.p);
    const mv = [pred[0] - prev.p[0], pred[1] - prev.p[1]];
    const ob = [P[0] - prev.p[0], P[1] - prev.p[1]];
    const dist = Math.hypot(prev.p[0], prev.p[1], prev.p[2]);
    const a = Math.hypot(mv[0], mv[1]), b = Math.hypot(ob[0], ob[1]);
    if (a / dist < 0.004 || b / dist < 0.002) return; // too little movement to judge
    this.agree = this.agree * 0.93 + ((mv[0] * ob[0] + mv[1] * ob[1]) / (a * b)) * 0.07;
    this.agreeN++;
    if (this.agreeN > 25 && this.agree < -0.15) this.sensorBad = true;
  }

  async start() {
    const { Controller } = await mindar();
    this.motion.start();
    const video = document.createElement('video');
    video.setAttribute('autoplay', '');
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.muted = true;
    this.container.appendChild(video);
    this.video = video;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    });
    this.stream = stream;
    video.srcObject = stream;
    await new Promise((res) => (video.readyState >= 1 ? res() : video.addEventListener('loadedmetadata', res, { once: true })));
    await video.play().catch(() => {});
    const vw = video.videoWidth, vh = video.videoHeight;

    // A sharp picture on screen, but the tracker always works on the same small copy, so it costs
    // the same on every phone. The copy also avoids reading video straight into WebGL, which comes
    // back black on some browsers (older iPhones; a hidden test tab).
    const scale = Math.min(1, 480 / Math.min(vw, vh));
    const fw = Math.round(vw * scale), fh = Math.round(vh * scale);
    this.copy = document.createElement('canvas');
    this.copy.width = fw;
    this.copy.height = fh;
    this.g = this.copy.getContext('2d');
    this.g.drawImage(video, 0, 0, fw, fh);

    this.controller = new Controller({ inputWidth: fw, inputHeight: fh, maxTrack: 1 });
    const { dimensions } = this.controller.addImageTargetsFromBuffer(this.mind.slice(0));
    const [w, h] = dimensions[0];
    this.post = new THREE.Matrix4().compose(new THREE.Vector3(w / 2, w / 2 + (h - w) / 2, 0), new THREE.Quaternion(), new THREE.Vector3(w, w, w));
    this.scale = w;
    this.stage.useAR(w);
    this.stage.setARProjection(this.controller.getProjectionMatrix(), fw, fh, video);
    this.controller.dummyRun(this.copy);
    this.running = true;
    this._loop().catch((e) => {
      this.running = false;
      this.onError && this.onError(e);
    });
  }

  async _loop() {
    const ctl = this.controller, video = this.video;
    let tracking = false, mvt = null, count = 0, lastSeen = 0;
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    while (this.running) {
      const t0 = performance.now();
      if (video.readyState >= 2 && !document.hidden) {
        this.g.drawImage(video, 0, 0, this.copy.width, this.copy.height);
        const qFrame = this._sensorAt(t0 - LATENCY); // where the camera was when this frame was taken
        const input = ctl.inputLoader.loadInput(this.copy);
        if (!tracking) {
          const r = await ctl._detectAndMatch(input, [0]);
          if (r.targetIndex !== -1) {
            tracking = true;
            mvt = r.modelViewTransform;
            count = 0;
          }
        }
        if (tracking) {
          const next = await ctl._trackAndUpdate(input, mvt, 0);
          if (next === null) tracking = false;
          else { mvt = next; count++; }
        }
        input.dispose();
        this.ticks++;
        const now = performance.now();
        if (tracking && count >= WARM) {
          lastSeen = now;
          m.elements = [...ctl.getWorldMatrix(mvt, 0)];
          m.multiply(this.post);
          m.decompose(p, q, s);
          let P = [p.x, p.y, p.z], Q = [q.x, q.y, q.z, q.w];
          this._checkSensor(P, qFrame);
          // the tracker has been busy with this frame: bring it up to the moment now on screen
          const qNow = this._sensorAt(now - LATENCY);
          if (qFrame && qNow) {
            const back = qConj(qMul(qConj(qFrame), qNow));
            P = qRot(back, P);
            Q = qMul(back, Q);
          }
          this.lastRaw = { p: P, q: Q };
          this.stab.measure(P, Q);
          if (!this.found) {
            this.found = true;
            this.onFound && this.onFound();
          }
        } else if (this.found && now - lastSeen > HOLD) {
          this.found = false;
          this.stab.reset();
          this.words = null;
          this.stage.hideCard();
          this.onLost && this.onLost();
        }
      }
      const wait = (tracking ? TICK_TRACK : TICK_SEARCH) - (performance.now() - t0);
      await new Promise((r) => setTimeout(r, Math.max(1, wait)));
    }
  }

  // Every drawn frame: the sensor turns the card at once, the tracker corrects it, and the layers
  // and the words follow.
  frame(dt) {
    if (!this.running) return;
    const now = performance.now();
    const qNow = this._sensorAt(now - LATENCY);
    const stab = this.stab;
    stab.sensor = !!qNow;
    const T = this.tilt;
    if (qNow) {
      if (this.qPrev) {
        let d = qMul(qConj(this.qPrev), qNow);
        if (d[3] < 0) d = d.map((v) => -v);
        stab.cameraRotated(d);
        T.pitch += 2 * d[0];
        T.yaw += 2 * d[1];
      }
      this.qPrev = qNow;
    }
    // the tilt the layers respond to fades back, so a new way of holding the phone becomes level
    const fade = Math.exp(-dt / 1.4);
    T.yaw = clamp(T.yaw * fade, -0.4, 0.4);
    T.pitch = clamp(T.pitch * fade, -0.4, 0.4);

    const pose = this.rawPose ? this.lastRaw : stab.step(dt);
    if (this.rawPose) stab.step(dt);
    if (!pose || !this.found) return;
    const { p, q } = pose;
    this.stage.setCardPose(p, q, this.scale);

    // Depth: the layers slide against each other as the viewpoint changes, more than the real
    // perspective alone would show, and at once as the phone tilts.
    const qi = qConj(q);
    const c = qRot(qi, [-p[0], -p[1], -p[2]]);
    const k = 1.1, g = 0.7;
    const fromTilt = qRot(qi, [-k * T.yaw, k * T.pitch, 0]);
    const sx = clamp((-g * c[0]) / c[2] + fromTilt[0], -0.8, 0.8);
    const sy = clamp((-g * c[1]) / c[2] + fromTilt[1], -0.8, 0.8);
    const card = this.stage.card;
    card.setShear(sx, sy);

    // The wish stays steady and readable: level on screen, a calm size, following the card's sky
    // slowly, and leaning a little with the phone so it still feels part of the scene.
    const H = innerHeight, W = innerWidth;
    const fc = H / 2 / Math.tan((this.stage.camera.fov * Math.PI) / 360);
    const v = qRot(q, [card.textX * this.scale, card.textY * this.scale, 0.12 * this.scale]);
    const X = v[0] + p[0], Y = v[1] + p[1], Z = v[2] + p[2];
    const cardPx = (fc * this.scale) / -p[2];
    const uMax = Math.min(480, (W - 16) / 0.8);
    const u = clamp(cardPx, Math.min(300, uMax), uMax);
    const xMax = Math.max(0, W / 2 - 0.4 * u - 8), yMax = H / 2 - 0.22 * u - 48;
    const tx = clamp(((fc * X) / -Z) * 0.5, -xMax, xMax);
    // under the name, even when the card is small on screen and the words are not
    const nb = qRot(q, [0, card.card.geom.box[1] * this.scale, 0.12 * this.scale]);
    const underName = (fc * (nb[1] + p[1])) / -(nb[2] + p[2]) - 0.125 * u;
    const ty = clamp(Math.min((fc * Y) / -Z, underName), -yMax, yMax);
    if (!this.words) this.words = { x: tx, y: ty, u };
    const a = 1 - Math.exp(-dt / 0.5);
    const w = this.words;
    w.x += (tx - w.x) * a;
    w.y += (ty - w.y) * a;
    w.u += (u - w.u) * a;
    this.stage.placeWords(w.x, w.y, w.u, clamp(-T.pitch * 0.3, -0.12, 0.12), clamp(-T.yaw * 0.3, -0.12, 0.12));
  }

  stop() {
    this.running = false;
    this.motion.stop();
    try { this.controller && this.controller.dispose(); } catch {}
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.video) this.video.remove();
    this.stage.hideCard();
  }
}
