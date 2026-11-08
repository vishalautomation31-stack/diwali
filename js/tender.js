// A slow, tender piece made here rather than played from a file, so it adds nothing to the download
// and has no rights attached: an original melody on a bamboo flute in an evening raga (Yaman, with its
// raised fourth), a santoor answering it, a tanpura drone and a very quiet tabla. It loops without a
// seam: every sound's tail wraps round to the start of the buffer.
export const SR = 24000;
const SA = 277.18; // the home note, C sharp
const BEAT = 60 / 66; // seconds
const CYCLE = 8 * BEAT;
const CYCLES = 8;

const NOTE = { 'N,': -1, S: 0, R: 2, G: 4, M: 6, P: 7, D: 9, N: 11, "S'": 12, "R'": 14, "G'": 16 };
// One eight-beat cycle per line: a note, then its beats if not one.
const TUNE = [
  'N,:2 R G:3 R S',
  'G M P:3 M G R',
  "M D:2 N S':3 N",
  'D P M G:3 R S',
  "N:2 R' G':3 R' S'",
  'N D P:2 M P G:2',
  "G M D N S':2 N D",
  'P M G R S:4',
];
const BREATH_AFTER = new Set([3, 7]);

export function renderMusic() {
  const len = Math.round(CYCLE * CYCLES * SR);
  const left = new Float32Array(len), right = new Float32Array(len);
  let seed = 19;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const hz = (semi) => SA * Math.pow(2, semi / 12);
  const put = (at, sl, sr) => {
    const w = ((at % len) + len) % len;
    left[w] += sl;
    right[w] += sr;
  };

  // Karplus-Strong plucked string, tuned with an all-pass in the loop.
  function pluck(at, freq, dur, amp, { t60 = 2, bright = 0.45, pan = 0 } = {}) {
    const period = SR / freq + 0.5;
    const N = Math.floor(period), frac = period - N;
    const C = (1 - frac) / (1 + frac);
    const line = new Float32Array(N);
    let lp = 0;
    for (let i = 0; i < N; i++) {
      lp = lp * (1 - bright) + (rnd() * 2 - 1) * bright;
      line[i] = lp;
    }
    for (let pass = 0; pass < 2; pass++) {
      let prev = line[N - 1];
      for (let i = 0; i < N; i++) { const v = (prev + line[i]) * 0.5; prev = line[i]; line[i] = v; }
    }
    const g = Math.pow(10, -3 / (freq * t60));
    const samples = Math.min(Math.round(dur * SR), len);
    const start = Math.round(at * SR);
    const gl = amp * Math.cos(((pan + 1) * Math.PI) / 4), gr = amp * Math.sin(((pan + 1) * Math.PI) / 4);
    let idx = 0, apIn = 0, apOut = 0;
    const attack = SR * 0.005, release = SR * 0.1;
    for (let n = 0; n < samples; n++) {
      const y = line[idx];
      const avg = (y + line[(idx + 1) % N]) * 0.5 * g;
      const out = C * avg + apIn - C * apOut;
      apIn = avg;
      apOut = out;
      line[idx] = out;
      idx = (idx + 1) % N;
      let s = y;
      if (n < attack) s *= n / attack;
      if (n > samples - release) s *= (samples - n) / release;
      put(start + n, s * gl, s * gr);
    }
  }

  const notes = [];
  TUNE.forEach((text, c) => {
    let beat = 0;
    for (const w of text.split(' ')) {
      const [name, beats] = w.split(':');
      const b = Number(beats || 1);
      notes.push({ at: c * CYCLE + beat * BEAT, dur: b * BEAT, semi: NOTE[name], line: c });
      beat += b;
    }
  });

  // The flute: nearly pure, a little breath, and slow slides from note to note.
  function flute(amp, pan) {
    const gl = amp * Math.cos(((pan + 1) * Math.PI) / 4), gr = amp * Math.sin(((pan + 1) * Math.PI) / 4);
    let ph = 0, cur = notes[0].semi, air = 0;
    const slide = 1 - Math.exp(-1 / (SR * 0.075));
    notes.forEach((note, i) => {
      const next = notes[(i + 1) % notes.length];
      const prev = notes[(i - 1 + notes.length) % notes.length];
      const start = Math.round(note.at * SR), samples = Math.round(note.dur * SR);
      const breath = BREATH_AFTER.has(note.line) && next.line !== note.line;
      for (let n = 0; n < samples; n++) {
        const u = n / SR;
        cur += (note.semi - cur) * slide;
        const hold = Math.min(1, Math.max(0, (u - 0.4) / 0.5));
        const vib = hold * 0.1 * Math.sin(2 * Math.PI * 4.6 * u + i);
        ph += (SA * 2 * Math.pow(2, (cur + vib) / 12)) / SR;
        ph -= Math.floor(ph);
        const a = 2 * Math.PI * ph;
        let e = 0.8 + 0.2 * Math.min(1, u / 0.18);
        if (breath) e *= Math.min(1, (note.dur - u) / 0.7);
        if (BREATH_AFTER.has(prev.line) && prev.line !== note.line) e *= Math.min(1, u / 0.22);
        air += ((rnd() * 2 - 1) - air) * 0.22;
        const s = (Math.sin(a) + 0.26 * Math.sin(2 * a) + 0.09 * Math.sin(3 * a) + 0.03 * Math.sin(4 * a)) * e + air * 0.1 * e;
        put(start + n, s * gl, s * gr);
      }
    });
  }
  flute(0.32, -0.04);

  // The santoor answers on the long notes, softly, an octave below the flute.
  for (const n of notes) {
    if (n.dur < BEAT * 2) continue;
    const strokes = Math.floor(n.dur / (BEAT / 2));
    for (let s = 0; s < strokes; s++) pluck(n.at + BEAT * 0.5 + s * (BEAT / 2), hz(n.semi), 1.2, s ? 0.05 : 0.09, { t60: 1.4, pan: 0.34 });
  }

  // The tanpura: fifth, home, home, low home.
  const drone = [-5, 0, 0, -12];
  const plucks = CYCLES * 4;
  for (let i = 0; i < plucks; i++) {
    pluck((i * (CYCLE * CYCLES)) / plucks, hz(drone[i % 4]) / 2, 7, 0.2, { t60: 7, bright: 0.32, pan: i % 2 ? 0.35 : -0.35 });
  }

  // A very quiet tabla: only the low drum and the rim, far back.
  function drum(at, low, amp) {
    const dur = low ? 0.4 : 0.14;
    const samples = Math.round(dur * SR), start = Math.round(at * SR);
    let phase = 0;
    for (let n = 0; n < samples; n++) {
      const u = n / SR;
      const f = low ? 74 + 34 * Math.exp(-u * 22) : 410;
      phase += (2 * Math.PI * f) / SR;
      const s = low ? Math.sin(phase) * Math.exp(-u * 9) : (Math.sin(phase) + 0.45 * Math.sin(phase * 1.5)) * Math.exp(-u * 34);
      put(start + n, s * amp, s * amp);
    }
  }
  for (let c = 0; c < CYCLES; c++) {
    const t0 = c * CYCLE;
    [[0, true, 0.15], [3, false, 0.04], [4, true, 0.1], [6, false, 0.05], [7, false, 0.03]].forEach(([b, low, amp]) => drum(t0 + b * BEAT + (rnd() - 0.5) * 0.008, low, amp));
  }

  let rms = 0;
  for (let i = 0; i < len; i++) rms += left[i] * left[i];
  rms = Math.sqrt(rms / len) || 1;
  let peak = 0;
  for (let i = 0; i < len; i++) {
    left[i] = Math.tanh((left[i] / rms) * 0.26);
    right[i] = Math.tanh((right[i] / rms) * 0.26);
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  const k = 0.82 / (peak || 1);
  for (let i = 0; i < len; i++) { left[i] *= k; right[i] *= k; }
  return { sampleRate: SR, left, right, seconds: len / SR };
}
