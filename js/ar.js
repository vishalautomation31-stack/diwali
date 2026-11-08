// Camera version: MindAR 1.2.5 image tracking on the printed front of the card.
//
// MindAR's GPU code fails on some phones (reported for iOS 27, MindAR issue #581: "Failed to link
// vertex and fragment shaders"). So before asking for the camera, a probe runs MindAR once on a
// blank frame. If it fails, it is retried with TensorFlow.js's packed shaders off (the workaround
// in tfjs issue #8562); if that fails too, the page plays the no-camera version instead.
//
// The tracker is paced here rather than left to run flat out, so the 3D scene gets the frame time;
// the motion sensor guides it between runs. Its estimates go through PoseStabilizer (stabilize.js),
// so the card moves smoothly with the hand and the wobble of single estimates never shows.
import * as THREE from '../lib/three.module.min.js';
import { PoseStabilizer, qMul, qConj, qRot } from './stabilize.js?v=65a035480c';
import { Motion } from './motion.js?v=65a035480c';

const WARM = 3; // tracked frames before the card is shown
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

// Turns the tracker's last pose by the camera's rotation since then (q: in the camera's frame, y up,
// z towards the viewer; the tracker's frame has y down, z away), so it searches where the card now is.
function turnPose(mvt, q) {
  const [x, y, z, w] = q;
  const r = [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
  const s = [1, -1, -1];
  return [0, 1, 2].map((i) => [0, 1, 2, 3].map((j) => {
    let v = 0;
    for (let k = 0; k < 3; k++) v += s[i] * r[i][k] * s[k] * mvt[k][j];
    return v;
  }));
}

export class CameraAR {
  constructor({ container, stage, mind, onFound, onLost, onError, rawPose = false, stats = false }) {
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
    this.shear = [0, 0];
    this.omega = 0;
    this.sensorBad = false; // the sensor disagreed with the camera: stop trusting it
    this.agree = 0;
    this.agreeN = 0;
    this.prevSeen = null;
    this.qGuess = null;
    this.ticks = 0;
    this.losses = 0;
    this.cost = 0; // how long one tracker run takes here, in ms
    if (stats) {
      this.stats = { el: document.createElement('div'), frames: 0, ticks: 0, at: performance.now() };
      this.stats.el.className = 'stats';
      document.querySelector('#ui').appendChild(this.stats.el);
    }
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
        // the phone has moved since the tracker last ran: start it looking where the card now is
        if (tracking && qFrame && this.qGuess) mvt = turnPose(mvt, qConj(qMul(qConj(this.qGuess), qFrame)));
        this.qGuess = qFrame;
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
          if (next === null) { tracking = false; this.losses++; } else { mvt = next; count++; }
        }
        input.dispose();
        this.ticks++;
        const now = performance.now();
        this.cost += (now - t0 - this.cost) * 0.15;
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
        } else if (this.found && now - lastSeen > (this.stab.sensor ? 1500 : 800)) {
          // the sensor holds the card through a short loss; after that the sequence waits for it
          this.found = false;
          this.stab.reset();
          this.stage.hideCard();
          this.onLost && this.onLost();
        }
      }
      // With the sensor, the tracker only has to correct: give the 3D most of the phone's time.
      const cost = performance.now() - t0;
      const interval = this.stab.sensor ? clamp(this.cost * 2.5, 60, 170) : clamp(this.cost * 1.5, 40, 120);
      await new Promise((r) => setTimeout(r, Math.max(1, (tracking ? interval : Math.max(interval, 70)) - cost)));
    }
  }

  // Every drawn frame: the sensor turns the card at once, the tracker corrects it, the layers follow.
  frame(dt) {
    if (!this.running) return;
    const now = performance.now();
    const qNow = this._sensorAt(now - LATENCY);
    const stab = this.stab;
    stab.sensor = !!qNow;
    const T = this.tilt;
    let omega = 0;
    if (qNow) {
      if (this.qPrev) {
        let d = qMul(qConj(this.qPrev), qNow);
        if (d[3] < 0) d = d.map((v) => -v);
        stab.cameraRotated(d);
        T.pitch += 2 * d[0];
        T.yaw += 2 * d[1];
        omega = (2 * Math.hypot(d[0], d[1], d[2])) / Math.max(dt, 0.008);
      }
      this.qPrev = qNow;
    }
    this.omega += (omega - this.omega) * (omega > this.omega ? 0.5 : 0.08); // rises fast, settles slowly
    // the tilt the layers respond to fades back, so a new way of holding the phone becomes level
    const fade = Math.exp(-dt / 1.4);
    T.yaw = clamp(T.yaw * fade, -0.4, 0.4);
    T.pitch = clamp(T.pitch * fade, -0.4, 0.4);

    const pose = this.rawPose ? this.lastRaw : stab.step(dt, this.omega);
    if (this.rawPose) stab.step(dt, this.omega);
    this._showStats();
    if (!pose || !this.found) return;
    const { p, q } = pose;
    this.stage.setCardPose(p, q, this.scale);

    // Depth: the layers slide against each other as the viewpoint changes, more than the real
    // perspective alone would show, and at once as the phone tilts.
    const qi = qConj(q);
    const c = qRot(qi, [-p[0], -p[1], -p[2]]);
    const k = 1.1, g = 0.6;
    const fromTilt = qRot(qi, [-k * T.yaw, k * T.pitch, 0]);
    const sx = clamp((-g * c[0]) / c[2] + fromTilt[0], -0.8, 0.8);
    const sy = clamp((-g * c[1]) / c[2] + fromTilt[1], -0.8, 0.8);
    const a = 1 - Math.exp(-dt / 0.12);
    this.shear[0] += (sx - this.shear[0]) * a;
    this.shear[1] += (sy - this.shear[1]) * a;
    this.stage.card.setShear(this.shear[0], this.shear[1]);
  }

  _showStats() {
    const S = this.stats;
    if (!S) return;
    S.frames++;
    const now = performance.now();
    if (now - S.at < 500) return;
    const secs = (now - S.at) / 1000;
    const shown = this.stab.shown;
    const cardPx = shown ? Math.round((innerHeight / 2 / Math.tan((this.stage.camera.fov * Math.PI) / 360)) * this.scale / -shown.p[2]) : 0;
    S.el.textContent = `fps ${Math.round(S.frames / secs)} · tracker ${Math.round(this.cost)} ms, ${Math.round((this.ticks - S.ticks) / secs)}/s · sensor ${this.stab.sensor ? 'on' : this.sensorBad ? 'DROPPED' : 'off'} ${this.agree.toFixed(2)} · lost ${this.losses} · card ${cardPx} px · video ${this.video ? this.video.videoWidth + 'x' + this.video.videoHeight : '-'}`;
    S.frames = 0;
    S.ticks = this.ticks;
    S.at = now;
  }

  stop() {
    this.running = false;
    this.motion.stop();
    try { this.controller && this.controller.dispose(); } catch {}
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.video) this.video.remove();
    if (this.stats) this.stats.el.remove();
    this.stage.hideCard();
  }
}
