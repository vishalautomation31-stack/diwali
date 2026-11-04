// Opening a card: the key is the part of the address after '#'. It never leaves the phone
// (browsers do not send it), and it is the only thing that decrypts the card's words and art.

const enc = new TextEncoder();

export function b64uToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function readKey() {
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

async function fetchBytes(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw last;
}

export async function openCard(key) {
  const id = await cardId(key);
  const buf = await fetchBytes(`c/${id}.bin`);
  if (!buf) return null;
  const plain = await decrypt(b64uToBytes(key), buf);
  return JSON.parse(new TextDecoder().decode(plain));
}

const TYPES = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', json: 'application/json', mind: 'application/octet-stream' };

// Decrypts one private asset (poster, layers, handwriting, tracking target). Null if absent.
export async function loadAsset(card, name) {
  const a = card.assets && card.assets[name];
  if (!a) return null;
  const buf = await fetchBytes(a.url);
  if (!buf) return null;
  const plain = await decrypt(b64uToBytes(card.assetsKey), buf);
  const ext = name.split('.').pop();
  return new Blob([plain], { type: TYPES[ext] || 'application/octet-stream' });
}

export async function loadImage(card, name) {
  const blob = await loadAsset(card, name);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  const img = new Image();
  // onload, not img.decode(): decode() can stay pending in a background tab
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = () => rej(new Error('image ' + name));
    img.src = url;
  });
  return img;
}

export async function loadJSON(card, name) {
  const blob = await loadAsset(card, name);
  return blob ? JSON.parse(await blob.text()) : null;
}
