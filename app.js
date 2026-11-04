// The page: open the card from the key in the address, show the start screen, then play the
// sequence on the printed card (camera) or full screen (no camera).
import { readKey, openCard, loadImage, loadJSON, loadAsset } from './js/card.js';

const $ = (s) => document.querySelector(s);
const show = (el, on = true) => { el.hidden = !on; };
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const log = (...a) => { if (DEBUG) console.log('[card]', ...a); };

const state = {
  t: 0,
  playing: false,
  began: false,
  mode: 'start', // start | scanning | ar | free
  replayShown: false,
  probe: null,
};

function fail() {
  show($('#loader'), false);
  const b = $('#retry');
  show(b);
  b.onclick = () => location.reload();
}

function staticCard(card) {
  // the card as text: used only when WebGL is unavailable
  show($('#loader'), false);
  $('#s-name').textContent = card.name;
  const w = $('#s-wish');
  for (const line of card.lines) {
    const p = document.createElement('p');
    p.textContent = line;
    w.appendChild(p);
  }
  $('#s-from').textContent = card.from || '';
  show($('#static'));
}

async function requestMotion() {
  try {
    const D = window.DeviceOrientationEvent;
    if (D && typeof D.requestPermission === 'function') await D.requestPermission();
  } catch {}
}

async function main() {
  const key = readKey();
  if (!key) { show($('#loader'), false); return; }

  let card;
  try {
    card = await openCard(key);
  } catch (e) {
    log('open failed', e);
    return fail();
  }
  if (!card) { show($('#loader'), false); return; }

  // three.js and the scene modules load in parallel with the art
  const modsP = Promise.all([import('./js/stage.js'), import('./js/scene.js'), import('./js/sound.js')]);
  const fontsP = Promise.all([document.fonts.load('400 112px "Eczar"'), document.fonts.load('600 100px "Teko"')]).catch(() => {});
  const names = Object.keys(card.assets || {});
  // Codex's layers 1 to 9, plus the optional near layers 10 to 13, and their shadows
  const nums = Array.from({ length: 13 }, (_, i) => i + 1);
  const hasLayers = nums.slice(0, 9).every((n) => names.includes(`layer-${n}.webp`));
  const byNumber = async (prefix) => {
    const imgs = await Promise.all(nums.map((n) => (names.includes(`${prefix}-${n}.webp`) ? loadImage(card, `${prefix}-${n}.webp`) : null)));
    return Object.fromEntries(nums.map((n, i) => [n, imgs[i]]).filter(([, im]) => im));
  };
  let poster, sceneInfo, logo, layers = null, shadows = null, handFor = null, handFrom = null, mind = null;
  try {
    [poster, sceneInfo, logo, layers, shadows, handFor, handFrom, mind] = await Promise.all([
      loadImage(card, 'poster.webp'),
      loadJSON(card, 'scene.json'),
      new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = 'img/morninglabs-ai.png'; }),
      hasLayers ? byNumber('layer') : null,
      hasLayers ? byNumber('shadow') : null,
      loadImage(card, 'hand-for.png'),
      loadImage(card, 'hand-from.png'),
      loadAsset(card, 'target.mind').then((b) => (b ? b.arrayBuffer() : null)),
    ]);
  } catch (e) {
    log('assets failed', e);
    return fail();
  }
  await fontsP;

  let Stage, CardScene, TIMES, Crackle;
  try {
    const [m1, m2, m3] = await modsP;
    ({ Stage } = m1); ({ CardScene, TIMES } = m2); ({ Crackle } = m3);
  } catch (e) {
    log('modules failed', e);
    return fail();
  }

  let stage, scene;
  try {
    stage = new Stage($('#gl'));
    scene = new CardScene({ card, poster, layers, shadows, sceneInfo, logo, hand: { for: handFor, from: handFrom } });
  } catch (e) {
    log('webgl failed', e);
    return staticCard(card);
  }
  stage.setCard(scene);
  stage.useFree();
  const sound = new Crackle();
  log('ready', { layers: !!layers, mind: !!mind, diyas: sceneInfo?.diyas?.length });

  // the camera test runs while the start screen waits
  const probeP = mind ? import('./js/ar.js').then((m) => m.probe(mind)).catch((e) => ({ ok: false, note: String(e) })) : Promise.resolve({ ok: false, note: 'no tracking target' });
  probeP.then((p) => { state.probe = p; log('probe', p); });

  // ---------- the loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state.playing && !document.hidden) state.t += dt;
    scene.introFade = state.mode === 'ar';
    scene.update(state.began ? state.t : 0, state.playing ? dt : 0, now / 1000);
    sound.update(state.playing ? scene.crackle : 0, dt);
    stage.render(state.began ? state.t : 0, now / 1000);
    if (state.began && state.t > TIMES.end && !state.replayShown) {
      state.replayShown = true;
      show($('#replay'));
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  show($('#loader'), false);
  document.body.classList.add('ready');
  show($('#start'));

  function begin() {
    state.t = 0;
    state.began = true;
    state.playing = true;
    state.replayShown = false;
    scene.reset();
    show($('#replay'), false);
  }

  async function playFree() {
    state.mode = 'free';
    if (state.ar) { state.ar.stop(); state.ar = null; }
    document.body.classList.remove('ar');
    show($('#hint'), false);
    show($('#nocam'), false);
    stage.useFree();
    stage.enableTilt();
    begin();
  }

  $('#start').onclick = async () => {
    show($('#start'), false);
    document.body.classList.add('started');
    sound.start();
    show($('#sound'));
    const p = state.probe || (await Promise.race([probeP, new Promise((r) => setTimeout(() => r({ ok: false, note: 'probe slow' }), 6000))]));
    if (!p.ok || params.has('nocam')) {
      await requestMotion();
      return playFree();
    }
    // camera
    state.mode = 'scanning';
    document.body.classList.add('ar');
    show($('#hint'));
    const offer = () => { if (state.mode === 'scanning' || state.mode === 'ar') show($('#nocam')); };
    const offerTimer = setTimeout(() => { if (!state.began) offer(); }, 8000);
    try {
      const { CameraAR } = await import('./js/ar.js');
      state.ar = new CameraAR({
        container: $('#cam'),
        stage,
        mind,
        onFound: () => {
          show($('#hint'), false);
          show($('#nocam'), false);
          clearTimeout(state.lostTimer);
          if (!state.began) { state.mode = 'ar'; begin(); }
          state.playing = true;
        },
        onLost: () => {
          state.playing = false; // the sequence waits for the card
          state.lostTimer = setTimeout(() => { if (state.mode === 'ar' || state.mode === 'scanning') show($('#hint')); }, 1200);
        },
      });
      await state.ar.start();
    } catch (e) {
      log('camera failed', e);
      clearTimeout(offerTimer);
      document.body.classList.remove('ar');
      show($('#hint'), false);
      stage.useFree();
      offer();
    }
  };

  $('#nocam').onclick = async () => {
    await requestMotion();
    playFree();
  };

  $('#replay').onclick = () => begin();

  $('#sound').onclick = () => {
    const on = $('#sound').getAttribute('aria-pressed') !== 'true';
    $('#sound').setAttribute('aria-pressed', String(on));
    sound.setMuted(!on);
  };

  if (DEBUG) {
    window.__card = { state, scene, stage, card: { name: card.name, lines: card.lines, assets: names } };
    // Freeze at time t (seconds), optionally running the particles up to it, and save the canvas
    // to the local dev server (tools/serve.mjs writes it to private/out/). Local checks only.
    window.__snap = async (t, name, warm = 1.2) => {
      state.playing = false;
      state.began = true;
      scene.reset();
      const step = 1 / 60;
      for (let s = Math.max(0, t - warm); s < t; s += step) scene.update(s, step, s);
      state.t = t;
      scene.update(t, 0, t);
      stage.render(t, t);
      const blob = await new Promise((r) => $('#gl').toBlob(r, 'image/png'));
      const res = await fetch('/__save?name=' + encodeURIComponent(name), { method: 'POST', body: blob });
      return res.text();
    };
  }
}

main();
