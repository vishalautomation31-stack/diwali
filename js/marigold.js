// Marigold strings, like a toran: a line of flowers above the name, with strings dropping from it
// into the gaps between the letters. Painted here flower by flower, so there is no image to carry.
const PX = 1000; // canvas pixels to a card width

function flower(g, x, y, r, orange, rnd) {
  const rings = orange
    ? [[1, 12, '#b9500d'], [0.84, 11, '#e06f16'], [0.62, 9, '#f28f26'], [0.38, 7, '#fbb63f']]
    : [[1, 12, '#c98410'], [0.84, 11, '#eba41b'], [0.62, 9, '#f6bf34'], [0.38, 7, '#ffdb78']];
  const turn = rnd() * 6.283;
  for (const [R, n, colour] of rings) {
    g.fillStyle = colour;
    for (let k = 0; k < n; k++) {
      const a = turn + (k / n) * 6.283 + R * 2;
      g.beginPath();
      g.arc(x + Math.cos(a) * R * r * 0.62, y + Math.sin(a) * R * r * 0.62, R * r * 0.44, 0, 6.283);
      g.fill();
    }
  }
  g.fillStyle = orange ? '#8a3a0a' : '#a8660c';
  g.beginPath();
  g.arc(x, y, r * 0.15, 0, 6.283);
  g.fill();
}

function leaf(g, x, y, r) {
  g.fillStyle = '#2f7a45';
  g.beginPath();
  g.ellipse(x, y + r * 1.15, r * 0.48, r * 1.2, 0, 0, 6.283);
  g.fill();
  g.strokeStyle = '#1d5230';
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(x, y + r * 0.1);
  g.lineTo(x, y + r * 2.2);
  g.stroke();
}

// painted once on a spare sheet, then laid down with one soft shadow under the lot
function sheet(w, h, paint) {
  const a = document.createElement('canvas');
  a.width = w;
  a.height = h;
  paint(a.getContext('2d'));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.shadowColor = 'rgba(6,4,18,0.6)';
  g.shadowBlur = 7;
  g.shadowOffsetY = 4;
  g.drawImage(a, 0, 0);
  return c;
}

const generator = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// One string, hung from the middle of its top edge. Sizes in card units.
export function paintStrand(count, r, gap, seed) {
  const rnd = generator(seed);
  const pad = Math.ceil(r * PX * 0.7);
  const rp = r * PX, gp = gap * PX;
  const w = Math.ceil(2 * rp + 2 * pad);
  const tail = rp * 2.6;
  const h = Math.ceil((count - 1) * gp + rp + tail + pad + 4);
  const canvas = sheet(w, h, (g) => {
    g.strokeStyle = '#6b3f12';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(w / 2, 0);
    g.lineTo(w / 2, (count - 1) * gp + rp + 4);
    g.stroke();
    leaf(g, w / 2, (count - 1) * gp + rp + 2, rp);
    for (let k = 0; k < count; k++) flower(g, w / 2, rp + 2 + k * gp, rp, k % 2 === (seed & 1), rnd);
  });
  return { canvas, w: w / PX, h: h / PX };
}

// The line of flowers along a curve y(x) from x0 to x1; returns where its sheet sits in card units.
export function paintSwag(curve, x0, x1, r, gap, seed) {
  const rnd = generator(seed);
  const pts = [];
  let x = x0;
  while (x < x1) {
    pts.push([x, curve(x)]);
    const dy = (curve(x + 0.001) - curve(x)) / 0.001;
    x += gap / Math.sqrt(1 + dy * dy);
  }
  const ys = pts.map((p) => p[1]);
  const top = Math.max(...ys) + r * 1.7, bottom = Math.min(...ys) - r * 1.7;
  const left = x0 - r * 1.7, right = x1 + r * 1.7;
  const w = Math.ceil((right - left) * PX), h = Math.ceil((top - bottom) * PX);
  const X = (u) => (u - left) * PX, Y = (v) => (top - v) * PX;
  const canvas = sheet(w, h, (g) => {
    g.strokeStyle = '#6b3f12';
    g.lineWidth = 1.6;
    g.beginPath();
    pts.forEach(([a, b], k) => (k ? g.lineTo(X(a), Y(b)) : g.moveTo(X(a), Y(b))));
    g.stroke();
    pts.forEach(([a, b], k) => flower(g, X(a), Y(b), r * PX, k % 2 === 0, rnd));
  });
  return { canvas, cx: (left + right) / 2, cy: (top + bottom) / 2, w: w / PX, h: h / PX };
}
