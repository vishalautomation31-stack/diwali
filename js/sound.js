// A soft sparkler crackle, made in the browser (no audio file): random short bursts of filtered
// noise while the spark is drawing. Off until the tap; a button mutes it.
export class Crackle {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  start() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || this.ctx) return;
    const ctx = (this.ctx = new AC());
    const len = Math.round(ctx.sampleRate * 1.2);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // the fizz under the crackles
    const bed = ctx.createBufferSource();
    bed.buffer = this.noise;
    bed.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3200;
    this.bedGain = ctx.createGain();
    this.bedGain.gain.value = 0;
    bed.connect(hp).connect(this.bedGain).connect(this.master);
    bed.start();
    this.master.gain.value = 0.5;
    if (ctx.state === 'suspended') ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05);
  }

  // level 0..1, called every frame
  update(level, dt) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.bedGain.gain.setTargetAtTime(0.035 * level, now, 0.08);
    if (level < 0.05) return;
    const expected = 38 * level * dt;
    let n = Math.floor(expected) + (Math.random() < expected % 1 ? 1 : 0);
    while (n-- > 0) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1800 + Math.random() * 4200;
      bp.Q.value = 0.9 + Math.random() * 2;
      const g = ctx.createGain();
      const at = now + Math.random() * dt;
      const dur = 0.004 + Math.random() * 0.016;
      const peak = (0.12 + Math.random() * 0.5) * level;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(peak, at + 0.0015);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      src.connect(bp).connect(g).connect(this.master);
      src.start(at, Math.random() * 1.0, dur + 0.01);
    }
  }
}
