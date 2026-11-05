// A short piece of light festive music, made here rather than played from a file, so it adds nothing
// to the download and has no rights attached. Plucked strings in a major pentatonic raga over a
// drone and a soft eight-beat pulse. It loops without a seam: every note's tail wraps round to the
// start of the buffer. Written to work outside a browser too, so its levels and tuning can be tested.
export const SR = 24000;
const SA = 293.66; // the home note, D4
const BEAT = 60 / 76; // seconds
const CYCLE = 8 * BEAT;
const CYCLES = 6;

// Semitones above the home note. A dot below or a quote above means an octave down or up.
const NOTE = { 'D.': -3, 'P.': -5, S: 0, R: 2, G: 4, P: 7, D: 9, "S'": 12, "R'": 14, "G'": 16 };
// One row per eight-beat cycle, one entry per half beat; '-' lets the last note ring.
const TUNE = [
  'G - R - S - D. - S - R - G - - -',
  'G - P - D - P - G - R - S - - -',
  "P - D - S' - D - P - G - R - - -",
  "S' - - D P - G - R - S - D. - S -",
  "G P D S' R' S' D P G - P - D - P -",
  'G - R - S - R - S - D. - S - - -',
].map((r) => r.split(' '));

export function renderMusic() {
  const len = Math.round(CYCLE * CYCLES * SR);
  const left = new Float32Array(len), right = new Float32Array(len);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // Karplus-Strong plucked string, tuned exactly with an all-pass in the loop.
  function pluck(at, freq, dur, amp, { t60 = 2, bright = 0.6, pan = 0 } = {}) {
    const period = SR / freq + 0.5; // the averaging filter below takes half a sample off the loop
    const N = Math.floor(period), frac = period - N;
    const C = (1 - frac) / (1 + frac);
    const line = new Float32Array(N);
    let lp = 0;
    for (let i = 0; i < N; i++) {
      lp = lp * (1 - bright) + (rnd() * 2 - 1) * bright; // a softer strike has fewer high partials
      line[i] = lp;
    }
    for (let pass = 0; pass < 2; pass++) { // and no click: the strike is rounded before it rings
      let prev = line[N - 1];
      for (let i = 0; i < N; i++) { const v = (prev + line[i]) * 0.5; prev = line[i]; line[i] = v; }
    }
    const g = Math.pow(10, -3 / (freq * t60));
    const samples = Math.min(Math.round(dur * SR), len);
    const start = Math.round(at * SR);
    const gl = amp * Math.cos(((pan + 1) * Math.PI) / 4), gr = amp * Math.sin(((pan + 1) * Math.PI) / 4);
    let idx = 0, apIn = 0, apOut = 0;
    const attack = SR * 0.005, release = SR * 0.08; // a soft hammer: the strike is felt, not heard as a click
    for (let n = 0; n < samples; n++) {
      const y = line[idx];
      const next = line[(idx + 1) % N];
      const avg = (y + next) * 0.5 * g;
      const out = C * avg + apIn - C * apOut;
      apIn = avg;
      apOut = out;
      line[idx] = out;
      idx = (idx + 1) % N;
      let s = y;
      if (n < attack) s *= n / attack;
      if (n > samples - release) s *= (samples - n) / release;
      const w = (start + n + len) % len;
      left[w] += s * gl;
      right[w] += s * gr;
    }
  }

  // Soft hand drum: a falling low tone for the left hand, a short ring for the right.
  function drum(at, kind, amp) {
    const dur = kind === 'low' ? 0.3 : kind === 'ring' ? 0.2 : 0.05;
    const samples = Math.round(dur * SR), start = Math.round(at * SR);
    let phase = 0;
    for (let n = 0; n < samples; n++) {
      const u = n / SR;
      let s;
      if (kind === 'low') {
        phase += (2 * Math.PI * (72 + 46 * Math.exp(-u * 18))) / SR;
        s = Math.sin(phase) * Math.exp(-u * 11);
      } else if (kind === 'ring') {
        phase += (2 * Math.PI * SA) / SR;
        s = (Math.sin(phase) + 0.4 * Math.sin(phase * 2.01)) * Math.exp(-u * 24) + (rnd() - 0.5) * 0.25 * Math.exp(-u * 120);
      } else {
        s = (rnd() - 0.5) * Math.exp(-u * 90);
      }
      const w = (start + n + len) % len;
      left[w] += s * amp;
      right[w] += s * amp;
    }
  }

  // a small bright chime now and then
  function chime(at, freq, amp) {
    const samples = Math.round(1.6 * SR), start = Math.round(at * SR);
    for (let n = 0; n < samples; n++) {
      const u = n / SR;
      const e = Math.min(1, u / 0.002);
      const s = e * (Math.sin(2 * Math.PI * freq * u) * Math.exp(-u * 2.6) + 0.45 * Math.sin(2 * Math.PI * freq * 2.76 * u) * Math.exp(-u * 5) + 0.2 * Math.sin(2 * Math.PI * freq * 5.4 * u) * Math.exp(-u * 9));
      const w = (start + n + len) % len;
      left[w] += s * amp * 0.8;
      right[w] += s * amp;
    }
  }

  const hz = (semi, base = SA) => base * Math.pow(2, semi / 12);

  // the drone, plucked in its usual order: fifth, home, home, low home
  const drone = [[-5, 0], [0, 0], [0, 0], [-12, 0]];
  const gap = 1.25;
  const plucks = Math.floor((CYCLE * CYCLES) / gap);
  const droneGap = (CYCLE * CYCLES) / plucks;
  for (let i = 0; i < plucks; i++) {
    const semi = drone[i % 4][0];
    pluck(i * droneGap, hz(semi) / 2, 5, 0.2, { t60: 5.5, bright: 0.35, pan: i % 2 ? 0.35 : -0.35 });
  }

  // the tune
  TUNE.forEach((row, c) => {
    row.forEach((name, k) => {
      if (name === '-' || !(name in NOTE)) return;
      const at = c * CYCLE + k * (BEAT / 2) + (rnd() - 0.5) * 0.012;
      // how long until the next note decides whether it gets a second, softer hammer stroke
      let hold = 1;
      while (row[k + hold] === '-') hold++;
      const v = (0.26 + rnd() * 0.05) * (k % 4 === 0 ? 1.12 : 1);
      const f = hz(NOTE[name]);
      pluck(at, f, 2.4, v, { t60: 2.1, bright: 0.5, pan: -0.12 });
      pluck(at, f * 2, 1.2, v * 0.22, { t60: 1.1, bright: 0.5, pan: 0.2 }); // the course an octave up
      if (hold >= 2) pluck(at + BEAT / 2, f, 1.6, v * 0.45, { t60: 1.6, bright: 0.6, pan: -0.05 });
      if (hold >= 4) pluck(at + BEAT * 1.25, f, 1.2, v * 0.3, { t60: 1.3, bright: 0.55, pan: 0.05 });
    });
  });

  // the pulse: eight beats, very soft
  const PULSE = [['low', 0.34], ['tick', 0.1], ['ring', 0.16], ['tick', 0.08], ['ring', 0.14], ['tick', 0.08], ['low', 0.26], ['ring', 0.15]];
  for (let c = 0; c < CYCLES; c++) {
    PULSE.forEach(([kind, amp], b) => {
      const at = c * CYCLE + b * BEAT + (rnd() - 0.5) * 0.01;
      drum(at, kind, amp * 0.45);
      if (kind === 'low') drum(at, 'ring', amp * 0.12);
    });
    if (c % 2 === 1) chime(c * CYCLE + 7.5 * BEAT, hz(24), 0.022);
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
