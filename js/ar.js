// Camera version: MindAR 1.2.5 image tracking on the printed front of the card.
//
// MindAR's GPU code fails on some phones (reported for iOS 27, MindAR issue #581: "Failed to link
// vertex and fragment shaders"). So before asking for the camera, a probe runs MindAR once on a
// blank frame. If it fails, it is retried with TensorFlow.js's packed shaders off (the workaround
// in tfjs issue #8562); if that fails too, the page plays the no-camera version instead.
import * as THREE from '../lib/three.module.min.js';

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
  const ctl = new Controller({ inputWidth: 640, inputHeight: 480, maxTrack: 1 });
  try {
    ctl.addImageTargetsFromBuffer(mind.slice(0));
    ctl.dummyRun(blankFrame(640, 480));
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

export class CameraAR {
  constructor({ container, stage, mind, onFound, onLost }) {
    this.container = container;
    this.stage = stage;
    this.mind = mind;
    this.onFound = onFound;
    this.onLost = onLost;
    this.found = false;
  }

  async start() {
    const { Controller } = await mindar();
    const video = document.createElement('video');
    video.setAttribute('autoplay', '');
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.muted = true;
    this.container.appendChild(video);
    this.video = video;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment' } });
    this.stream = stream;
    video.srcObject = stream;
    await new Promise((res) => (video.readyState >= 1 ? res() : video.addEventListener('loadedmetadata', res, { once: true })));
    await video.play().catch(() => {});
    const vw = video.videoWidth, vh = video.videoHeight;

    this.controller = new Controller({
      inputWidth: vw,
      inputHeight: vh,
      maxTrack: 1,
      filterMinCF: 0.0005, // a little steadier than MindAR's default (0.001) when the phone is still
      filterBeta: 600,
      warmupTolerance: 4,
      missTolerance: 8, // tolerate a few missed frames before calling the card lost
      onUpdate: (d) => {
        if (d.type !== 'updateMatrix') return;
        this.stage.setAnchor(d.worldMatrix, this.post);
        const now = d.worldMatrix !== null;
        if (now && !this.found) { this.found = true; this.onFound && this.onFound(); }
        if (!now && this.found) { this.found = false; this.onLost && this.onLost(); }
      },
    });
    const { dimensions } = this.controller.addImageTargetsFromBuffer(this.mind.slice(0));
    const [w, h] = dimensions[0];
    this.post = new THREE.Matrix4().compose(new THREE.Vector3(w / 2, w / 2 + (h - w) / 2, 0), new THREE.Quaternion(), new THREE.Vector3(w, w, w));
    this.stage.useAR();
    this.stage.setARProjection(this.controller.getProjectionMatrix(), vw, vh, video);
    // The tracker reads a canvas copy of each camera frame, not the video element: reading video
    // straight into WebGL comes back black on some browsers (older iPhones; a hidden test tab).
    const frame = document.createElement('canvas');
    frame.width = vw;
    frame.height = vh;
    const g = frame.getContext('2d');
    const pump = () => {
      if (video.readyState >= 2) g.drawImage(video, 0, 0, vw, vh);
      this.raf = requestAnimationFrame(pump);
    };
    pump();
    this.controller.dummyRun(frame);
    this.controller.processVideo(frame);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    try { this.controller && this.controller.stopProcessVideo(); } catch {}
    try { this.controller && this.controller.dispose(); } catch {}
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.video) this.video.remove();
    this.stage.setAnchor(null);
  }
}
