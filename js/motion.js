// The phone's orientation sensor, as the back camera's rotation. A short history is kept, because
// what is on screen is a camera frame from a moment ago, and the card must match that moment.
import * as THREE from '../lib/three.module.min.js';

const euler = new THREE.Euler();
const quat = new THREE.Quaternion();
const q0 = new THREE.Quaternion();
const zee = new THREE.Vector3(0, 0, 1);
const backCamera = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2); // looks out of the back of the phone

export class Motion {
  constructor() {
    this.buf = [];
    this.on = this.on.bind(this);
  }

  start() {
    addEventListener('deviceorientation', this.on, true);
  }

  stop() {
    removeEventListener('deviceorientation', this.on, true);
  }

  on(e) {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    const r = Math.PI / 180;
    const screenAngle = ((screen.orientation && screen.orientation.angle) || window.orientation || 0) * r;
    euler.set(e.beta * r, e.alpha * r, -e.gamma * r, 'YXZ');
    quat.setFromEuler(euler).multiply(backCamera).multiply(q0.setFromAxisAngle(zee, -screenAngle));
    this.buf.push({ t: performance.now(), q: [quat.x, quat.y, quat.z, quat.w] });
    if (this.buf.length > 90) this.buf.shift();
  }

  // true while the sensor is actually reporting
  get live() {
    const n = this.buf.length;
    return n > 1 && performance.now() - this.buf[n - 1].t < 400;
  }

  // the camera's rotation at time t (ms), or null without a sensor
  at(t) {
    const b = this.buf;
    if (!this.live) return null;
    for (let i = b.length - 1; i >= 0; i--) {
      if (b[i].t <= t) {
        const a = b[i], c = b[i + 1];
        if (!c) return a.q;
        const f = (t - a.t) / (c.t - a.t);
        const s = a.q[0] * c.q[0] + a.q[1] * c.q[1] + a.q[2] * c.q[2] + a.q[3] * c.q[3] < 0 ? -1 : 1;
        const q = a.q.map((v, k) => v + (s * c.q[k] - v) * f);
        const n = Math.hypot(q[0], q[1], q[2], q[3]);
        return q.map((v) => v / n);
      }
    }
    return b[0].q;
  }
}
