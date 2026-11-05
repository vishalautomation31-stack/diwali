// Holds the card steady on screen. The image tracker gives an absolute pose about 25 times a second,
// but each estimate wobbles a little. The phone's motion sensor gives smooth rotation 60 times a
// second but drifts. So: the sensor moves the card at once (the card stays glued to the world as the
// phone turns), and the tracker only corrects it, gently, unless it is clearly far off.
// Poses are in camera space: p [x, y, z], q [x, y, z, w]. No dependencies, so it can be tested alone.

export const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export const qConj = (a) => [-a[0], -a[1], -a[2], a[3]];
export const qRot = (q, v) => {
  const u = [q[0], q[1], q[2]], w = q[3];
  const t = [2 * (u[1] * v[2] - u[2] * v[1]), 2 * (u[2] * v[0] - u[0] * v[2]), 2 * (u[0] * v[1] - u[1] * v[0])];
  return [
    v[0] + w * t[0] + u[1] * t[2] - u[2] * t[1],
    v[1] + w * t[1] + u[2] * t[0] - u[0] * t[2],
    v[2] + w * t[2] + u[0] * t[1] - u[1] * t[0],
  ];
};
const qDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
export const qAngle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(qDot(a, b))));
export function qSlerp(a, b, t) {
  let d = qDot(a, b);
  const s = d < 0 ? -1 : 1;
  d *= s;
  if (d > 0.9995) {
    const r = [0, 1, 2, 3].map((i) => a[i] + (s * b[i] - a[i]) * t);
    const n = Math.hypot(r[0], r[1], r[2], r[3]);
    return r.map((v) => v / n);
  }
  const th = Math.acos(d), sn = Math.sin(th);
  const w0 = Math.sin((1 - t) * th) / sn, w1 = (s * Math.sin(t * th)) / sn;
  return [0, 1, 2, 3].map((i) => a[i] * w0 + b[i] * w1);
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// how far apart two positions are, relative to the card's distance; depth counts for less, because
// the tracker's depth is its noisiest number and matters least on screen
function relDist(a, b) {
  const d = Math.hypot(a[0], a[1], a[2]) || 1;
  return Math.hypot(a[0] - b[0], a[1] - b[1], (a[2] - b[2]) * 0.35) / d;
}

export const SETTINGS = {
  // time constants in seconds: slow when the difference looks like tracker noise, fast when it is
  // clearly real movement. With the sensor doing the fast work, the tracker's pull can be gentler.
  sensor: { slowP: 0.2, fastP: 0.08, slowR: 0.8, fastR: 0.16 },
  vision: { slowP: 0.13, fastP: 0.04, slowR: 0.16, fastR: 0.05 },
  e0P: 0.004, e1P: 0.016, // relative position error: noise below e0, real movement above e1
  e0R: 0.025, e1R: 0.09, // rotation error in radians (about 1.4 and 5 degrees)
  tail: 0.05, // a short second stage: takes the corners out of the motion
  jumpP: 0.09, jumpR: 0.3, // a single estimate this far off must be confirmed by the next one
  // While the phone turns, the tracker is at its least reliable (blur, a moving picture) and the
  // sensor at its best: the tracker's pull eases off, half strength at this speed (radians a second).
  turning: 0.7,
  // However wrong the pose, it is corrected at a rate, never in one step (per second; the allowed
  // rate grows with the error so a big miss still closes quickly).
  rateP: 0.25, rateR: 0.5,
};

export class PoseStabilizer {
  constructor(settings = SETTINGS) {
    this.s = settings;
    this.reset();
  }

  reset() {
    this.target = null; // latest trusted estimate
    this.mid = null; // first smoothing stage
    this.shown = null; // what is drawn
    this.pending = null; // an estimate far from the last one, waiting to be confirmed
    this.sensor = false;
  }

  // The camera turned by dq (its rotation since the last call, in its own frame). The card stays
  // where it is in the world, so in camera space everything turns the other way, at once.
  cameraRotated(dq) {
    const inv = qConj(dq);
    for (const pose of [this.target, this.mid, this.shown, this.pending]) {
      if (!pose) continue;
      pose.p = qRot(inv, pose.p);
      pose.q = qMul(inv, pose.q);
    }
  }

  // A new estimate from the tracker.
  measure(p, q) {
    if (!this.target) {
      this.target = { p: [...p], q: [...q] };
      this.mid = { p: [...p], q: [...q] };
      this.shown = { p: [...p], q: [...q] };
      return;
    }
    const s = this.s;
    const far = relDist(p, this.target.p) > s.jumpP || qAngle(q, this.target.q) > s.jumpR;
    if (far) {
      const P = this.pending;
      const confirmed = P && relDist(p, P.p) < s.jumpP * 0.6 && qAngle(q, P.q) < s.jumpR * 0.6;
      this.pending = confirmed ? null : { p: [...p], q: [...q] };
      if (!confirmed) return; // one wild estimate never reaches the screen
    } else {
      this.pending = null;
    }
    this.target = { p: [...p], q: [...q] };
  }

  // Every drawn frame.
  // omega: how fast the phone is turning, radians a second (from the sensor)
  step(dt, omega = 0) {
    if (!this.target) return null;
    const s = this.s, set = this.sensor ? s.sensor : s.vision;
    const { target: T, mid: M, shown: S } = this;
    const eP = relDist(T.p, M.p), eR = qAngle(T.q, M.q);
    const tauP = set.slowP + (set.fastP - set.slowP) * smooth(s.e0P, s.e1P, eP);
    const tauR = set.slowR + (set.fastR - set.slowR) * smooth(s.e0R, s.e1R, eR);
    const trust = this.sensor ? 1 / (1 + (omega / s.turning) ** 2) : 1;
    let aP = (1 - Math.exp(-dt / tauP)) * trust, aR = (1 - Math.exp(-dt / tauR)) * trust;
    const aT = 1 - Math.exp(-dt / s.tail);
    if (eP > 0) aP = Math.min(aP, ((s.rateP + 3 * eP) * dt) / eP);
    if (eR > 0) aR = Math.min(aR, ((s.rateR + 3 * eR) * dt) / eR);
    for (let i = 0; i < 3; i++) {
      M.p[i] += (T.p[i] - M.p[i]) * aP;
      S.p[i] += (M.p[i] - S.p[i]) * aT;
    }
    M.q = qSlerp(M.q, T.q, aR);
    S.q = qSlerp(S.q, M.q, aT);
    return S;
  }
}
