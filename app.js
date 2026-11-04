// Holding page: opens the card named by the key in the address (after '#'),
// decrypts its words in the browser and shows them. Nothing personal is stored in plain text
// on the server, and the key never leaves the phone (browsers do not send the part after '#').

const $ = (s) => document.querySelector(s);
const enc = new TextEncoder();

function b64uToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function readKey() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  const m = h.match(/^(?:k=)?([A-Za-z0-9_-]{22})\b/);
  if (m) return m[1];
  const q = new URLSearchParams(location.search).get('k');
  return q && /^[A-Za-z0-9_-]{22}$/.test(q) ? q : null;
}

async function cardId(key) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode('diwali-card:' + key)));
  return [...h.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function decrypt(rawKey, buf) {
  const k = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, k, buf.slice(12)));
}

async function openCard(key) {
  const id = await cardId(key);
  const res = await fetch(`c/${id}.bin`, { cache: 'no-cache' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('fetch ' + res.status);
  const plain = await decrypt(b64uToBytes(key), new Uint8Array(await res.arrayBuffer()));
  return JSON.parse(new TextDecoder().decode(plain));
}

function stars() {
  const c = $('#stars');
  const ctx = c.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let pts = [];
  function size() {
    c.width = innerWidth * dpr;
    c.height = innerHeight * dpr;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    pts = Array.from({ length: Math.round((innerWidth * innerHeight) / 2600) }, () => ({
      x: rnd() * c.width,
      y: rnd() * c.height * 0.78,
      r: (0.4 + rnd() * 1.1) * dpr,
      p: rnd() * Math.PI * 2,
      s: 0.6 + rnd() * 1.6,
    }));
  }
  size();
  addEventListener('resize', size);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function frame(t) {
    ctx.clearRect(0, 0, c.width, c.height);
    for (const s of pts) {
      const a = still ? 0.7 : 0.45 + 0.4 * Math.sin(s.p + (t / 1000) * s.s);
      ctx.fillStyle = `rgba(255, 238, 205, ${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!still) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function show(card) {
  $('#name').textContent = card.name;
  $('#from').textContent = card.from || '';
  const wish = $('#wish');
  wish.textContent = '';
  card.lines.forEach((line, i) => {
    const p = document.createElement('p');
    p.textContent = line;
    p.style.animationDelay = `${1.2 + i * 0.9}s`;
    wish.appendChild(p);
  });
  $('#from').style.animationDelay = `${1.2 + card.lines.length * 0.9 + 0.4}s`;
  $('#mark').style.animationDelay = `${1.2 + card.lines.length * 0.9 + 1.0}s`;
  $('#card').hidden = false;
  $('#mark').hidden = false;
}

async function main() {
  stars();
  const key = readKey();
  if (!key) return; // no card in the address: the night sky only
  try {
    const card = await openCard(key);
    if (card) show(card);
  } catch (e) {
    const b = $('#retry');
    b.hidden = false;
    b.onclick = () => location.reload();
  }
}

main();
