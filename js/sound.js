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

  // For cards with the sky show: light music underneath, and each firework heard as it bursts.
  async playMusic() {
    if (!this.ctx || this.music) return;
    this.music = true;
    const { renderMusic } = await import('./music.js?v=b50d742617');
    const ctx = this.ctx;
    const m = renderMusic();
    const buf = ctx.createBuffer(2, m.left.length, m.sampleRate);
    buf.copyToChannel(m.left, 0);
    buf.copyToChannel(m.right, 1);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.8, ctx.currentTime + 2.5);
    // a little room around it
    const rev = ctx.createConvolver();
    const irLen = Math.round(ctx.sampleRate * 1.5);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < irLen; i++) {
        lp += ((Math.random() * 2 - 1) - lp) * 0.35;
        d[i] = lp * Math.exp((-i / irLen) * 5.5);
      }
    }
    rev.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.2;
    src.connect(gain);
    gain.connect(this.master);
    gain.connect(rev).connect(wet).connect(this.master);
    src.start();
    // no music from a tab nobody is looking at
    document.addEventListener('visibilitychange', () => (document.hidden ? ctx.suspend() : ctx.resume()));
  }

  // A far firework: a soft thump a moment after the flash, then a scatter of crackles.
  boom(power, x) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const at = ctx.currentTime + 0.08 + Math.random() * 0.22;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) {
      pan.pan.value = Math.max(-0.7, Math.min(0.7, x * 0.7));
      pan.connect(this.master);
    }
    const out = pan || this.master;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(420, at);
    lp.frequency.exponentialRampToValueAtTime(70, at + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.5 * power, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.6);
    src.connect(lp).connect(g).connect(out);
    src.start(at, Math.random() * 0.5, 0.65);
    const n = 8 + Math.floor(Math.random() * 10);
    for (let i = 0; i < n; i++) {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2200 + Math.random() * 3800;
      bp.Q.value = 1.2;
      const e = ctx.createGain();
      const when = at + 0.25 + Math.random() * 0.9;
      const dur = 0.006 + Math.random() * 0.014;
      e.gain.setValueAtTime(0, when);
      e.gain.linearRampToValueAtTime(0.035 + Math.random() * 0.07, when + 0.0015);
      e.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      s.connect(bp).connect(e).connect(out);
      s.start(when, Math.random(), dur + 0.01);
    }
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
