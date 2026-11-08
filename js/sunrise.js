// A sun for a card that ends in daylight: a disc of cut paper, in the poster's own colours and grain,
// and the long soft rays round it.
import { canvasTexture } from './sprites.js?v=72b5265625';

export function paintSun() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const TAU = Math.PI * 2, R = 248;
  const fill = g.createLinearGradient(0, 8, 0, 504);
  fill.addColorStop(0, '#ffc94d');
  fill.addColorStop(0.5, '#f6a22a');
  fill.addColorStop(1, '#e8651a');
  g.fillStyle = fill;
  g.beginPath();
  g.arc(256, 256, R, 0, TAU);
  g.fill();
  g.globalCompositeOperation = 'source-atop';
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 5200; i++) {
    g.fillStyle = rnd() < 0.55 ? 'rgba(170,60,10,0.16)' : 'rgba(255,240,205,0.2)';
    g.fillRect(rnd() * 512, rnd() * 512, 1.5 + rnd() * 2.5, 1.5 + rnd() * 2.5);
  }
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = 'rgba(255,240,201,0.95)';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(256, 256, R - 3, 0, TAU);
  g.stroke();
  return canvasTexture(c);
}

// narrow at its foot, wider and fainter going out
export function paintRay() {
  const W = 64, H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const im = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const v = 1 - y / (H - 1); // 0 at the foot, 1 at the far end
    const spread = 0.12 + 0.88 * v;
    const a = Math.pow(1 - v, 1.3) * Math.min(1, v / 0.1);
    for (let x = 0; x < W; x++) {
      const u = (((x / (W - 1)) - 0.5) * 2) / spread;
      const i = (y * W + x) * 4;
      im.data[i] = im.data[i + 1] = im.data[i + 2] = 255;
      im.data[i + 3] = 255 * a * Math.exp(-u * u * 3.2);
    }
  }
  g.putImageData(im, 0, 0);
  return canvasTexture(c);
}
