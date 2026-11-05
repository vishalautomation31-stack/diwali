// A short piece of light festive music, made here rather than played from a file, so it adds nothing
// to the download and has no rights attached. A shehnai playing a seven-note raga with slides and
// grace notes, a santoor shadowing it, a drone, a dholak in an eight-beat keherwa and manjira. It
// loops without a seam: every sound's tail wraps round to the start of the buffer. Written to work
// outside a browser too, so its levels and tuning can be tested.
export const SR = 24000;
const SA = 293.66; // the home note, D4
const BEAT = 60 / 92; // seconds
export const CYCLE = 8 * BEAT;
export const CYCLES = 8;

// Semitones above the home note: the raga has a major third but a flat seventh (Khamaj's colour).
const NOTE = { S: 0, R: 2, G: 4, m: 5, P: 7, D: 9, n: 10, "S'": 12, "R'": 14, "G'": 16 };
const SCALE = [-5, -3, -2, 0, 2, 4, 5, 7, 9, 10, 12, 14, 16, 17];
// The tune, one eight-beat cycle per line: a note, then its beats if not one.
export const TUNE = [
  'P:2 D n D:2 P:2',
  'm G m P G:2 R S',
  "G m P:2 D n S':2",
  "S' n D P m G R S",
  "P S':3 R' S' n D",
  'n D P:2 m P D:2',
  "G' R' S' n D P m G",
  'm G R S:5',
];
const BREATH_AFTER = new Set([3, 7]); // the player breathes at the end of these lines

const parse = (line) => line.split(' ').map((w) => {
  const [name, beats] = w.split(':');
  return { semi: NOTE[name], beats: Number(beats || 1) };
});

export function renderMusic() {
  const len = Math.round(CYCLE * CYCLES * SR);
  const left = new Float32Array(len), right = new Float32Array(len);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const hz = (semi) => SA * Math.pow(2, semi / 12);
  const put = (at, sl, sr) => {
    const w = ((at % len) + len) % len;
    left[w] += sl;
    right[w] += sr;
  };

  // Karplus-Strong plucked string, tuned exactly with an all-pass in the loop.
  function pluck(at, freq, dur, amp, { t60 = 2, bright = 0.5, pan = 0 } = {}) {
    const period = SR / freq + 0.5; // the averaging filter below takes half a sample off the loop
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
    const attack = SR * 0.004, release = SR * 0.08;
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

  // The shehnai's one cycle of sound: a double reed, strong in its upper partials.
  const TABLE = 2048;
  const table = new Float32Array(TABLE + 1);
  const PARTS = [1, 0.85, 0.95, 0.8, 0.62, 0.42, 0.3, 0.2, 0.13, 0.08, 0.05];
  let tableMax = 0;
  for (let i = 0; i <= TABLE; i++) {
    let s = 0;
    PARTS.forEach((a, k) => { s += a * Math.sin((2 * Math.PI * (k + 1) * i) / TABLE + k * 0.7); });
    table[i] = s;
    tableMax = Math.max(tableMax, Math.abs(s));
  }
  for (let i = 0; i <= TABLE; i++) table[i] /= tableMax;

  // Lay out the tune as notes in time, then play one continuous breath through them: the pitch
  // slides from note to note (meend), each new note starts from a grace note above it (kan), and a
  // held note gains a slow shake.
  const notes = [];
  TUNE.forEach((line, c) => {
    let beat = 0;
    for (const n of parse(line)) {
      notes.push({ at: c * CYCLE + beat * BEAT, dur: n.beats * BEAT, semi: n.semi, line: c });
      beat += n.beats;
    }
  });
  const stepAbove = (semi) => SCALE.find((s) => s > semi) ?? semi;

  function shehnai(detune, delay, amp, pan, vibPhase) {
    let ph = rnd();
    let cur = notes[0].semi;
    let lp = 0;
    const gl = amp * Math.cos(((pan + 1) * Math.PI) / 4), gr = amp * Math.sin(((pan + 1) * Math.PI) / 4);
    notes.forEach((note, i) => {
      const next = notes[(i + 1) % notes.length];
      const prev = notes[(i - 1 + notes.length) % notes.length];
      const start = Math.round((note.at + delay) * SR), samples = Math.round(note.dur * SR);
      const grace = note.dur >= BEAT * 0.9 && prev.semi !== note.semi ? stepAbove(note.semi) : note.semi;
      const breath = BREATH_AFTER.has(note.line) && next.line !== note.line;
      const held = note.dur > BEAT * 2.5;
      const slowIn = 1 - Math.exp(-1 / (SR * 0.045)), fastIn = 1 - Math.exp(-1 / (SR * 0.016));
      for (let n = 0; n < samples; n++) {
        const u = n / SR;
        const isGrace = u < 0.07;
        cur += ((isGrace ? grace : note.semi) - cur) * (isGrace ? fastIn : slowIn);
        // vibrato comes in on held notes; a long note gets the slow, wide shake (gamak)
        const hold = Math.min(1, Math.max(0, (u - 0.3) / 0.35));
        const vib = hold * (held ? 0.3 : 0.14) * Math.sin(2 * Math.PI * (held ? 4.2 : 5.4) * u + vibPhase);
        ph += (SA * Math.pow(2, (cur + vib + detune) / 12)) / SR;
        ph -= Math.floor(ph);
        const x = ph * TABLE, k = Math.floor(x);
        const raw = table[k] + (table[k + 1] - table[k]) * (x - k);
        lp += (raw - lp) * 0.62; // a soft top, so it is a voice and not a buzz
        // each note leans in a little, and the player breathes at the ends of phrases
        let e = 0.82 + 0.18 * Math.exp(-u / 0.12);
        if (breath) e *= Math.min(1, (note.dur - u) / (held ? 1.3 : 0.28));
        if (BREATH_AFTER.has(prev.line) && prev.line !== note.line) e *= Math.min(1, u / 0.09);
        put(start + n, lp * e * gl, lp * e * gr);
      }
    });
  }
  shehnai(0, 0, 0.3, -0.06, 0);
  shehnai(0.07, 0.014, 0.17, 0.2, 1.7); // the second player a hair behind, as they usually play in pairs

  // The santoor shadows the tune an octave up, with a tremolo on the long notes.
  for (const n of notes) {
    const at = n.at + (rnd() - 0.5) * 0.01;
    pluck(at, hz(n.semi) * 2, 1.2, 0.14, { t60: 1.2, bright: 0.55, pan: 0.32 });
    if (n.dur >= BEAT * 2) {
      const strokes = Math.floor(n.dur / (BEAT / 2));
      for (let s = 1; s < strokes; s++) pluck(at + s * (BEAT / 2), hz(n.semi) * 2, 0.8, 0.09, { t60: 0.9, bright: 0.5, pan: 0.32 });
    }
  }

  // The drone: fifth, home, home, low home.
  const drone = [-5, 0, 0, -12];
  const plucks = CYCLES * 4;
  for (let i = 0; i < plucks; i++) {
    pluck((i * (CYCLE * CYCLES)) / plucks, hz(drone[i % 4]) / 2, 5, 0.17, { t60: 5.5, bright: 0.35, pan: i % 2 ? 0.35 : -0.35 });
  }

  // The dholak. Its low head bends upward under the palm, which is much of its sound.
  function dholak(at, kind, amp, bend = false) {
    const dur = kind === 'low' ? 0.34 : kind === 'high' ? 0.17 : 0.05;
    const samples = Math.round(dur * SR), start = Math.round(at * SR);
    let phase = 0;
    for (let n = 0; n < samples; n++) {
      const u = n / SR;
      let s;
      if (kind === 'low') {
        const f = bend ? 78 + 62 * Math.min(1, u / 0.16) : 84 + 30 * Math.exp(-u * 26);
        phase += (2 * Math.PI * f) / SR;
        s = (Math.sin(phase) + 0.25 * Math.sin(2 * phase)) * Math.exp(-u * (bend ? 7 : 11));
      } else if (kind === 'high') {
        phase += (2 * Math.PI * 392) / SR;
        s = (Math.sin(phase) + 0.5 * Math.sin(phase * 1.51) + 0.3 * Math.sin(phase * 2.02)) * Math.exp(-u * 30) + (rnd() - 0.5) * 0.4 * Math.exp(-u * 150);
      } else {
        s = (rnd() - 0.5) * Math.exp(-u * 95);
      }
      put(start + n, s * amp, s * amp);
    }
  }

  // The manjira: two small cymbals, a bright ring of unrelated partials.
  function manjira(at, amp) {
    const samples = Math.round(0.42 * SR), start = Math.round(at * SR);
    for (let n = 0; n < samples; n++) {
      const u = n / SR;
      const s = (Math.sin(2 * Math.PI * 3180 * u) + 0.8 * Math.sin(2 * Math.PI * 4730 * u) + 0.6 * Math.sin(2 * Math.PI * 6120 * u) + 0.4 * Math.sin(2 * Math.PI * 7930 * u)) * Math.exp(-u * 12);
      put(start + n, s * amp * 0.8, s * amp);
    }
  }

  // Keherwa, in beats: dha . ge na ti . na ka | dhi . na . dhi . na ka
  const KEHERWA = [
    [0, 'low', 0.34], [0, 'high', 0.14], [1, 'low', 0.16], [1.5, 'high', 0.12], [2, 'tick', 0.1], [3, 'high', 0.13], [3.5, 'tick', 0.09],
    [4, 'low', 0.3], [4, 'high', 0.12], [5, 'high', 0.13], [6, 'low', 0.24], [7, 'high', 0.13], [7.5, 'tick', 0.1],
  ];
  for (let c = 0; c < CYCLES; c++) {
    const t0 = c * CYCLE;
    for (const [b, kind, amp] of KEHERWA) {
      const bend = kind === 'low' && b === 6 && c % 2 === 1; // every other cycle the last low stroke bends
      dholak(t0 + b * BEAT + (rnd() - 0.5) * 0.008, kind, amp, bend);
    }
    [0, 2, 4, 6].forEach((b, k) => manjira(t0 + b * BEAT, k % 2 ? 0.012 : 0.022));
  }

  // A gentle ceiling, so no single note jumps out, then a fixed peak.
  let rms = 0;
  for (let i = 0; i < len; i++) rms += left[i] * left[i];
  rms = Math.sqrt(rms / len) || 1;
  let peak = 0;
  for (let i = 0; i < len; i++) {
    left[i] = Math.tanh((left[i] / rms) * 0.28);
    right[i] = Math.tanh((right[i] / rms) * 0.28);
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  const k = 0.85 / (peak || 1);
  for (let i = 0; i < len; i++) { left[i] *= k; right[i] *= k; }
  return { sampleRate: SR, left, right, seconds: len / SR };
}
