// The wish, set live in Eczar: one canvas per line, cut into one quad per word so the words can
// fly in one after another. Sizes are in card units (card width 1).
import * as THREE from '../lib/three.module.min.js';

const PX = 112; // canvas pixels per em: crisp at phone sizes

export function makeLine(text, { size = 0.07, maxWidth = 0.84, color = '#fff3dc', leading = 1.28, font = 'Eczar' } = {}) {
  const pxPerUnit = PX / size;
  const maxPx = maxWidth * pxPerUnit;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = `400 ${PX}px "${font}"`;
  const space = g.measureText(' ').width;

  // greedy wrap, then balance two rows so the break looks set, not spilled
  const words = text.split(/\s+/).filter(Boolean);
  const widths = words.map((w) => g.measureText(w).width);
  const total = widths.reduce((a, b) => a + b, 0) + space * (words.length - 1);
  let rows = [words.map((_, i) => i)];
  if (total > maxPx) {
    let best = null;
    for (let k = 1; k < words.length; k++) {
      const w1 = widths.slice(0, k).reduce((a, b) => a + b, 0) + space * (k - 1);
      const w2 = widths.slice(k).reduce((a, b) => a + b, 0) + space * (words.length - k - 1);
      if (w1 > maxPx || w2 > maxPx) continue;
      const score = Math.abs(w1 - w2) + (w1 < w2 ? 0 : 0.05 * PX); // prefer a slightly longer second row
      if (!best || score < best.score) best = { k, score };
    }
    const k = best ? best.k : Math.ceil(words.length / 2);
    rows = [words.slice(0, k).map((_, i) => i), words.slice(k).map((_, i) => i + k)];
  }

  const lineH = PX * leading;
  const pad = PX * 0.35;
  const rowW = rows.map((r) => r.reduce((a, i) => a + widths[i], 0) + space * (r.length - 1));
  c.width = Math.ceil(Math.max(...rowW) + pad * 2);
  c.height = Math.ceil(lineH * rows.length + pad * 2);
  g.font = `400 ${PX}px "${font}"`;
  g.textBaseline = 'alphabetic';
  g.fillStyle = color;
  g.shadowColor = 'rgba(10, 6, 30, 0.85)';
  g.shadowBlur = PX * 0.18;

  const rects = [];
  rows.forEach((r, ri) => {
    let x = (c.width - rowW[ri]) / 2;
    const base = pad + lineH * ri + PX * 0.98;
    for (const i of r) {
      g.fillText(words[i], x, base);
      rects.push({ i, x: x - PX * 0.12, y: base - PX * 1.02, w: widths[i] + PX * 0.24, h: lineH + PX * 0.12, row: ri });
      x += widths[i] + space;
    }
  });

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;

  const group = new THREE.Group();
  const parts = [];
  for (const r of rects) {
    const w = r.w / pxPerUnit, h = r.h / pxPerUnit;
    const geo = new THREE.PlaneGeometry(w, h);
    const uv = geo.attributes.uv;
    const u0 = r.x / c.width, u1 = (r.x + r.w) / c.width;
    const v0 = 1 - (r.y + r.h) / c.height, v1 = 1 - r.y / c.height;
    uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, toneMapped: false });
    const m = new THREE.Mesh(geo, mat);
    const cx = (r.x + r.w / 2 - c.width / 2) / pxPerUnit;
    const cy = -(r.y + r.h / 2 - c.height / 2) / pxPerUnit;
    m.position.set(cx, cy, 0);
    m.renderOrder = 80;
    group.add(m);
    parts.push({ mesh: m, x: cx, y: cy, order: r.i });
  }
  return { group, parts, height: c.height / pxPerUnit, width: c.width / pxPerUnit, rows: rows.length, texture: tex };
}

// A single word or phrase as one quad (the text stand-in for the handwriting).
export function makeLabel(text, { size = 0.06, color = '#ffd28a', font = 'Eczar' } = {}) {
  const L = makeLine(text, { size, maxWidth: 3, color, font });
  return L;
}
