// The page: open the card from the key in the address, show the start screen, then play the
// sequence on the printed card (camera) or full screen (no camera).
import { readKey, openCard, loadImage, loadJSON, loadAsset } from './js/card.js?v=717dd6026e';

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

function staticCard(card, lineImages) {
  // the card as text: used only when WebGL is unavailable
  show($('#loader'), false);
  $('#s-name').textContent = card.name;
  const w = $('#s-wish');
  for (const line of card.lines) {
    const p = document.createElement('p');
    p.textContent = line;
    w.appendChild(p);
  }
  (lineImages || []).forEach((img, k) => {
    img.className = 's-img';
    img.alt = card.imageLines[k].text;
    w.appendChild(img);
  });
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
  // local test only: a fake camera from tools/dev (never on the live site)
  if (DEBUG && params.has('fakecam') && ['localhost', '127.0.0.1'].includes(location.hostname))
    await (await import('/dev/fakecam.js')).installFakeCam(params.get('fakecam'));
  if (DEBUG && params.has('fakexr') && ['localhost', '127.0.0.1'].includes(location.hostname))
    (await import('/dev/fakexr.js')).installFakeXR();
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
  // a test link: ?show turns on the fireworks and music for a card that does not have them yet
  if (params.has('show')) card.show = { sky: true, music: true };

  // three.js and the scene modules load in parallel with the art
  const modsP = Promise.all([import('./js/stage.js?v=717dd6026e'), import('./js/scene.js?v=717dd6026e'), import('./js/sound.js?v=717dd6026e')]);
  const fontsP = Promise.all([document.fonts.load('400 112px "Eczar"'), document.fonts.load('600 100px "Teko"')]).catch(() => {});
  const names = Object.keys(card.assets || {});
  // Codex's layers 1 to 9, the optional near layers 10 to 13, a card's own parts 14 to 16, and their shadows
  const nums = Array.from({ length: 16 }, (_, i) => i + 1);
  const hasLayers = nums.slice(0, 9).every((n) => names.includes(`layer-${n}.webp`));
  const byNumber = async (prefix) => {
    const imgs = await Promise.all(nums.map((n) => (names.includes(`${prefix}-${n}.webp`) ? loadImage(card, `${prefix}-${n}.webp`) : null)));
    return Object.fromEntries(nums.map((n, i) => [n, imgs[i]]).filter(([, im]) => im));
  };
  let poster, sceneInfo, logo, layers = null, shadows = null, handFor = null, handFrom = null, mind = null, lineImages = null;
  try {
    [poster, sceneInfo, logo, layers, shadows, handFor, handFrom, mind, lineImages] = await Promise.all([
      hasLayers ? null : loadImage(card, 'poster.webp'), // the layers replace the flat poster
      loadJSON(card, 'scene.json'),
      // the MorningLabs AI mark, cut out and in pieces (tools/prepare_logo.py)
      (async () => {
        const img = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
        try {
          const [word, d1, d2, d3, layout] = await Promise.all([img('img/ml-word.png'), img('img/ml-dot-1.png'), img('img/ml-dot-2.png'), img('img/ml-dot-3.png'), fetch('img/ml-logo.json').then((r) => r.json())]);
          return { word, dots: [d1, d2, d3], layout };
        } catch { return null; }
      })(),
      hasLayers ? byNumber('layer') : null,
      hasLayers ? byNumber('shadow') : null,
      loadImage(card, 'hand-for.png'),
      loadImage(card, 'hand-from.png'),
      loadAsset(card, 'target.mind').then((b) => (b ? b.arrayBuffer() : null)),
      card.imageLines ? Promise.all(card.imageLines.map((l) => loadImage(card, l.asset))) : null,
    ]);
  } catch (e) {
    log('assets failed', e);
    return fail();
  }
  await fontsP;

  let Stage, CardScene, Crackle;
  try {
    const [m1, m2, m3] = await modsP;
    ({ Stage } = m1); ({ CardScene } = m2); ({ Crackle } = m3);
  } catch (e) {
    log('modules failed', e);
    return fail();
  }

  let stage, scene;
  try {
    stage = new Stage($('#gl'));
    scene = new CardScene({ card, poster, layers, shadows, sceneInfo, logo, hand: { for: handFor, from: handFrom }, lineImages });
  } catch (e) {
    log('webgl failed', e);
    return staticCard(card, lineImages);
  }
  stage.setCard(scene);
  stage.useFree();
  const sound = new Crackle();
  scene.onBurst = (power, x) => sound.boom(power, x);
  log('ready', { layers: !!layers, mind: !!mind, diyas: sceneInfo?.diyas?.length });

  // the camera test runs while the start screen waits
  const probeP = card.surface ? Promise.resolve({ ok: true, note: 'surface' }) : mind ? import('./js/ar.js?v=717dd6026e').then((m) => m.probe(mind)).catch((e) => ({ ok: false, note: String(e) })) : Promise.resolve({ ok: false, note: 'no tracking target' });
  probeP.then((p) => { state.probe = p; log('probe', p); });
  // the world-tracking engine is large: it comes down while the page is still loading
  const surfaceP = card.surface ? import('./js/surface.js?v=717dd6026e').then(async (m) => { await m.loadEngine(); return m; }) : null;
  surfaceP?.catch((e) => log('engine failed', e));

  // ---------- the loop ----------
  let last = performance.now();
  function step(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state.playing && !document.hidden) state.t += dt;
    scene.introFade = state.mode === 'ar' && !card.surface;
    if (state.ar) state.ar.frame(dt);
    scene.update(state.began ? state.t : 0, state.playing ? dt : 0, now / 1000);
    sound.update(state.playing ? scene.crackle : 0, dt);
    stage.render(state.began ? state.t : 0, now / 1000);
    if (state.began && state.t > scene.T.end && !state.replayShown) {
      state.replayShown = true;
      show($('#replay'));
    }
  }
  function frame(now) {
    if (!state.ar?.drives) step(now); // a card on a surface draws from the camera's own loop, in step with it
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  if (surfaceP) await Promise.race([surfaceP.catch(() => {}), new Promise((r) => setTimeout(r, 8000))]);
  show($('#loader'), false);
  document.body.classList.add('ready');
  show($('#start'));

  function begin() {
    state.t = -(state.lead || 0); // a card on a surface lies closed for a moment first
    state.began = true;
    state.playing = true;
    state.replayShown = false;
    scene.reset();
    show($('#replay'), false);
    if (card.show?.music) sound.playMusic();
  }

  async function playFree() {
    state.mode = 'free';
    state.lead = 0;
    if (state.ar) { state.ar.stop(); state.ar = null; }
    document.body.classList.remove('ar', 'lit', 'surface');
    show($('#hint'), false);
    show($('#nocam'), false);
    stage.useFree();
    stage.enableTilt();
    begin();
  }

  // No printed card: the greeting lands on whatever surface the phone is pointed at.
  async function startSurface() {
    state.mode = 'scanning';
    document.body.classList.add('ar', 'surface');
    const hint = $('#hint');
    show(hint);
    const offer = () => { if (!state.began) show($('#nocam')); };
    const offerTimer = setTimeout(offer, 15000);
    // a test link (?stats) says what is happening, so a real phone's trouble can be read off a screenshot
    let line = null;
    const note = (s) => {
      if (!params.has('stats')) return;
      if (!line) { line = document.createElement('div'); line.className = 'stats'; $('#ui').appendChild(line); }
      line.textContent = s;
    };
    const giveUp = (e) => {
      log('surface failed', e);
      note('fell back to full screen: ' + (e?.message || JSON.stringify(e)));
      clearTimeout(offerTimer);
      if (state.mode !== 'free') playFree();
    };
    try {
      note('loading the tracking engine');
      const { SurfaceAR, OPENING } = await Promise.race([surfaceP, new Promise((_, no) => setTimeout(() => no(new Error('the engine took too long')), 12000))]);
      stage.useAR(1);
      scene.setCameraMode(false); // no printed card under it: no dark edge, and the wish floats a little
      state.ar = new SurfaceAR({
        container: $('#cam'),
        stage,
        clock: () => state.t,
        draw: step,
        onStats: note,
        onHint: (h) => { hint.textContent = h === 'place' ? 'Tap to place' : 'Point at a table or the floor'; },
        onError: giveUp,
        onPlaced: () => {
          clearTimeout(offerTimer);
          document.body.classList.add('lit');
          show(hint, false);
          show($('#nocam'), false);
          state.mode = 'ar';
          state.lead = OPENING;
          begin();
        },
      });
      await state.ar.start();
    } catch (e) {
      giveUp(e);
    }
  }

  $('#start').onclick = async () => {
    // iPhones allow the motion sensor only from inside the tap itself, so this comes first
    const motionP = requestMotion();
    show($('#start'), false);
    document.body.classList.add('started');
    sound.start();
    if (card.show?.music) sound.prepareMusic();
    show($('#sound'));
    const p = state.probe || (await Promise.race([probeP, new Promise((r) => setTimeout(() => r({ ok: false, note: 'probe slow' }), 6000))]));
    await motionP;
    if (!p.ok || params.has('nocam')) return playFree();
    if (card.surface) return startSurface();
    // camera
    state.mode = 'scanning';
    document.body.classList.add('ar');
    show($('#hint'));
    const offer = () => { if (state.mode === 'scanning' || state.mode === 'ar') show($('#nocam')); };
    const offerTimer = setTimeout(() => { if (!state.began) offer(); }, 8000);
    try {
      const { CameraAR } = await import('./js/ar.js?v=717dd6026e');
      state.ar = new CameraAR({
        container: $('#cam'),
        stage,
        mind,
        rawPose: DEBUG && params.has('rawpose'),
        stats: params.has('stats'),
        onError: (e) => {
          log('tracking failed', e);
          state.mode = 'scanning';
          offer();
        },
        onFound: () => {
          document.body.classList.add('lit'); // the room dims as the card comes alive
          show($('#hint'), false);
          show($('#nocam'), false);
          clearTimeout(state.lostTimer);
          if (!state.began) { state.mode = 'ar'; begin(); }
          state.playing = true;
        },
        onLost: () => {
          document.body.classList.remove('lit');
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
    window.__card = { state, scene, stage, sound, card: { name: card.name, lines: card.lines, assets: names } };
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
