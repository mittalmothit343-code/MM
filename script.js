/* ==========================================================================
   TWO SHIPS IN AN INFINITE OCEAN
   A single vanilla-JS module. Sections:
   0. Config & state
   1. Boot sequence (loader -> entry gate)
   2. Three.js ocean / sky / ships
   3. Radar HUD
   4. GSAP ScrollTrigger story (the "explore at your own pace" mode)
   5. Audio
   6. Photo gallery (auto-discovery, lightbox, island popups)
   7. Ship's log + keepsakes
   8. THE FILM — a 1:52 cut of the same scene, with transport controls
   ========================================================================== */

(() => {
  'use strict';

  /* ------------------------------------------------------------------------
     0. CONFIG & STATE

     EDIT HERE. Everything the story says about the two of you lives in this
     one object — the scroll scenes, the island labels, the popups, the log
     and the film all read from it, so changing a name or a date once updates
     the whole piece.
     ------------------------------------------------------------------------ */
  const CONFIG = {
    rokaDate: '17th May 2026',
    names: { first: 'Mohit', second: 'Sezal' },

    // Chapter Two. One entry per time you met after the Roka.
    // `short` is the label painted on the island in the 3D scene (keep it tiny).
    // Add a fifth entry and a fifth island appears — nothing else to change.
    harbors: [
      {
        date: '30th May 2026',
        short: '30 MAY',
        numeral: 'XI',
        name: 'The First Harbor',
        story: 'No radar needed now — just two ships anchored side-by-side.',
        gift: 'Something small came home with us that day.'
      },
      {
        date: '26th June 2026',
        short: '26 JUN',
        numeral: 'XII',
        name: 'The Harbor of Small Errands',
        story: 'Small everyday errands together, mostly an excuse just to hold hands.',
        gift: 'One more thing for the chest.'
      },
      {
        date: '10th July 2026',
        short: '10 JUL',
        numeral: 'XIII',
        name: 'The Same Harbor, Again',
        story: 'Returning to our favorite quiet spots, building sweet routines together.',
        gift: 'Another keepsake, quietly kept.'
      },
      {
        date: '25th July 2026',
        short: '25 JUL',
        numeral: 'XIV',
        name: 'The Harbor With No Reason',
        story: 'Meeting for no special reason at all — because being together is everything.',
        gift: 'The fourth thing in the chest.'
      }
    ],

    anonymousShipCount: 260,

    galleryProbe: {
      dir: 'assets/photos/',
      extensions: ['jpg', 'jpeg', 'png', 'webp'],
      maxIndex: 80,           // highest numeric filename we'll try
      maxConsecutiveMisses: 6 // stop scanning after this many straight whiffs
    },

    // Optional override for the island flags / popup photos. Leave null to use
    // files from assets/photos/harbors/ instead (see the README). You can also
    // paste an image URL or a base64 data URI straight in here.
    // Example: harborPhotos: { 1: 'https://example.com/ourphoto.jpg' }
    harborPhotos: { 1: null, 2: null, 3: null, 4: null }
  };

  // The dated log, assembled from the Roka plus every harbor above.
  CONFIG.milestones = [{ date: CONFIG.rokaDate, label: 'Our Roka' }]
    .concat(CONFIG.harbors.map((h) => ({ date: h.date, label: h.name })));

  /* ---- performance tier -------------------------------------------------
     The ocean is the single most expensive thing on the page. Rather than
     ship one setting and hope, measure the device once and pick a budget. */
  const PERF = (() => {
    const ua = navigator.userAgent || '';
    const smallScreen = Math.min(window.innerWidth, window.innerHeight) < 760;
    const fewCores = (navigator.hardwareConcurrency || 4) <= 4;
    const mobile = /Mobi|Android|iPhone|iPad/i.test(ua) || smallScreen;
    const low = mobile || fewCores;
    return {
      low,
      oceanSegments: low ? 56 : 96,
      starCount: low ? 480 : 900,
      shipCount: low ? 140 : CONFIG.anonymousShipCount,
      maxPixelRatio: low ? 1.5 : 2
    };
  })();
  CONFIG.anonymousShipCount = PERF.shipCount;

  const state = {
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    soundEnabled: true,
    started: false,
    mode: null,            // 'film' | 'scroll'
    filmMode: false,
    autoWatch: false,
    scrollProgress: 0,
    radarActive: false,
    audioTheme: 'ambient', // 'ambient' (searching) | 'romantic' (found)
    musicLevel: 0.05,
    volume: 0.7
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const lerpColor = (c1, c2, t) => {
    const r = Math.round(lerp((c1 >> 16) & 255, (c2 >> 16) & 255, t));
    const g = Math.round(lerp((c1 >> 8) & 255, (c2 >> 8) & 255, t));
    const b = Math.round(lerp(c1 & 255, c2 & 255, t));
    return (r << 16) | (g << 8) | b;
  };
  // Ships are built with the bow along local +X. Given a travel direction in
  // world X/Z, this returns the Y rotation that points that bow the right way.
  const headingAngle = (fromX, fromZ, toX, toZ) => Math.atan2(-(toZ - fromZ), toX - fromX);

  // Fires a callback only on a false -> true transition, so scrubbing a
  // timeline backwards and forwards doesn't re-trigger one-shot flourishes.
  function edge() {
    let prev = false;
    return (now, onRise) => {
      if (now && !prev && typeof onRise === 'function') onRise();
      prev = now;
      return now;
    };
  }

  /* ---- inject all the copy that comes from CONFIG ---- */
  $('#rokaDate').textContent = CONFIG.rokaDate;
  $('#footerYear').textContent = new Date().getFullYear();
  $('#nameMohit').textContent = CONFIG.names.first.toUpperCase();
  $('#nameSezal').textContent = CONFIG.names.second.toUpperCase();

  // Chapter Two scenes are templates; CONFIG.harbors fills them in.
  // Extra harbors beyond the four authored sections are cloned from the last one.
  function paintHarborScenes() {
    const sections = $$('.scene-harbor');
    const template = sections[sections.length - 1];
    const parent = template && template.parentNode;

    CONFIG.harbors.forEach((h, i) => {
      let el = sections[i];
      if (!el && template) {
        el = template.cloneNode(true);
        el.id = `scene-${11 + i}`;
        el.setAttribute('data-scene', String(11 + i));
        parent.insertBefore(el, template.nextSibling);
      }
      if (!el) return;
      el.setAttribute('data-island', String(i));
      el.setAttribute('aria-label', `${h.name}, ${h.date}`);
      el.querySelector('[data-harbor-eyebrow]').textContent = `${h.numeral || ''} · ${h.date}`.replace(/^ · /, '');
      el.querySelector('[data-harbor-name]').textContent = h.name;
      el.querySelector('[data-harbor-story]').textContent = h.story;
      el.querySelector('[data-harbor-gift]').textContent = h.gift;
    });

    // remove any leftover authored sections beyond the configured harbours
    sections.slice(CONFIG.harbors.length).forEach((el) => el.remove());
  }
  paintHarborScenes();

  /* ------------------------------------------------------------------------
     1. BOOT SEQUENCE
     ------------------------------------------------------------------------ */
  const loader = $('#loader');
  const loaderFill = $('#loaderFill');
  const entryGate = $('#entryGate');
  const reducedMotionToggle = $('#reducedMotionToggle');
  const soundToggle = $('#soundToggle');

  reducedMotionToggle.checked = state.reducedMotion;
  // apply the OS-level preference immediately, not only when the box is touched
  document.body.classList.toggle('motion-reduced', state.reducedMotion);

  const librariesReady = () =>
    typeof window.THREE !== 'undefined' &&
    typeof window.gsap !== 'undefined' &&
    typeof window.ScrollTrigger !== 'undefined';

  function simulateLoad() {
    let p = 0;
    const tick = () => {
      p += Math.random() * 18;
      loaderFill.style.width = `${Math.min(p, 100)}%`;
      if (p < 100) {
        requestAnimationFrame(() => setTimeout(tick, 90));
      } else {
        loader.classList.add('hidden');
        loader.setAttribute('aria-hidden', 'true');
        entryGate.classList.add('visible');
        entryGate.setAttribute('aria-hidden', 'false');
        if (!librariesReady()) {
          $('#entryFallback').hidden = false;
          $('#watchFilm').disabled = true;
          $('#exploreScroll').disabled = true;
        } else {
          $('#watchFilm').focus();
        }
      }
    };
    tick();
  }

  reducedMotionToggle.addEventListener('change', (e) => {
    state.reducedMotion = e.target.checked;
    document.body.classList.toggle('motion-reduced', state.reducedMotion);
  });
  soundToggle.addEventListener('change', (e) => {
    state.soundEnabled = e.target.checked;
  });

  $('#watchFilm').addEventListener('click', () => beginExperience('film'));
  $('#exploreScroll').addEventListener('click', () => beginExperience('scroll'));
  const autoWatchBtn = $('#autoWatchScroll');
  if (autoWatchBtn) {
    autoWatchBtn.addEventListener('click', () => {
      beginExperience('scroll');
      startAutoWatch();
    });
  }

  // Force scroll to top on reload & manual scroll restoration
  if ('scrollRestoration' in window.history) {
    window.history.scrollRestoration = 'manual';
  }
  window.scrollTo(0, 0);

  function beginExperience(mode) {
    if (!librariesReady()) { $('#entryFallback').hidden = false; return; }

    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    state.soundEnabled = soundToggle.checked;
    state.mode = mode;
    entryGate.classList.remove('visible');
    entryGate.classList.add('hidden');
    entryGate.setAttribute('aria-hidden', 'true');

    if (!state.started) {
      state.started = true;
      initThree();
      initStoryScrollTriggers();
      initShipsLog();
      initKeepsakes();
      initGallery();
      initLightbox();
      initIslandModal();
      initHarborPhotosInline();
      initAudio(state.soundEnabled);
      initAudioControls();
      initAutoWatchUI();
      buildFilm();

      const muteBtn = $('#muteToggle');
      if (muteBtn) {
        muteBtn.setAttribute('aria-pressed', String(state.soundEnabled));
        muteBtn.setAttribute('aria-label', state.soundEnabled ? 'Turn sound off' : 'Turn sound on');
        muteBtn.addEventListener('click', toggleMute);
      }

      const continueBtn = $('#continueStory');
      if (continueBtn) {
        continueBtn.addEventListener('click', () => scrollToEl('#chapter-two-intro'));
      }
      $('#jumpToGallery').addEventListener('click', () => scrollToEl('#gallery'));
      $('#watchFilmFromStory').addEventListener('click', () => enterFilm());
    } else {
      initAudio(state.soundEnabled);
    }

    if (mode === 'film') enterFilm();
    else exitFilm({ silent: true });
  }

  function scrollToEl(sel) {
    const el = $(sel);
    if (el) el.scrollIntoView({ behavior: state.reducedMotion ? 'auto' : 'smooth' });
  }

  simulateLoad();

  /* ------------------------------------------------------------------------
     2. THREE.JS — OCEAN, SKY, SHIPS
     ------------------------------------------------------------------------ */
  let renderer, scene, camera;
  let starField, ocean, oceanGeom;
  let anonymousShips;             // THREE.Points cloud of distant ship-lights
  let shipMohit, shipSezal;       // dedicated meshes
  let ringMohit, ringSezal;       // glow rings, revealed on lock
  let connectionLine;             // line drawn between the two once both locked
  let goldenGlow;                 // burst sprite at the meeting
  let wakeParticlesMohit, wakeParticlesSezal; // bioluminescent wake trails
  let shootingStarMesh;           // occasional meteor across night sky
  let islands = [];               // Chapter Two: one small island per harbor date
  let clock;
  let rafId = null;
  let cameraBase = { pos: [0, 10, 34], look: [0, 0, 0] }; // target; animate() adds a living sway on top

  // Where each ship starts, and where they meet. Referenced by both the
  // scroll story and the film so the two never drift out of agreement.
  const START_M = { x: -22, z: -14 };
  const START_S = { x: 24, z: 12 };
  const MEET_M = { x: -3.4, z: -1.7 };
  const MEET_S = { x: 3.4, z: 1.7 };

  // The path Chapter Two sails along: point 0 is just past the meeting,
  // points 1..n are the harbor islands, the last point is where it closes.
  // Kept well past z=-20 (Chapter One's final "horizon" camera looks toward
  // z=-20) so the first island never peeks into view before Chapter Two starts.
  const ISLAND_PATH = [{ x: 0, z: -3 }];
  CONFIG.harbors.forEach((_, i) => {
    ISLAND_PATH.push({ x: i % 2 === 0 ? -15 : 16, z: -52 - i * 24 });
  });
  ISLAND_PATH.push({ x: 0, z: ISLAND_PATH[ISLAND_PATH.length - 1].z - 22 });

  const shipDrift = []; // per-anonymous-ship random drift vectors

  // Wave constants, shared between the vertex displacement and the analytic
  // normals below — the two must describe the same surface.
  const WAVE = { aAmp: 0.50, aFreq: 0.08, aSpeed: 0.75, bAmp: 0.34, bFreq: 0.10, bSpeed: 0.50 };
  const OCEAN_Y = -2;          // the plane's rest height
  const SHIP_SCALE = 1.5;      // the two vessels are the subject — read them at a glance
  const SHIP_FREEBOARD = 0.34; // how high the deck rides above the waterline
  const ISLAND_Y = 1.1;        // island base, chosen to clear the highest crest

  // Height of the water at a point, and its slope — used to float and tilt the
  // ships, and it is the same surface the vertex shader-free ocean displaces.
  const waveHeight = (x, z, t) =>
    Math.sin(x * WAVE.aFreq + t * WAVE.aSpeed) * WAVE.aAmp +
    Math.cos(z * WAVE.bFreq + t * WAVE.bSpeed) * WAVE.bAmp;

  // Sits a ship on the swell: correct height, plus pitch along the bow and roll
  // across the beam so it leans into the water rather than sliding over it.
  function floatOnSwell(ship, ring, t) {
    const x = ship.position.x, z = ship.position.z;
    ship.position.y = OCEAN_Y + waveHeight(x, z, t) + SHIP_FREEBOARD;

    const dydx = WAVE.aAmp * WAVE.aFreq * Math.cos(x * WAVE.aFreq + t * WAVE.aSpeed);
    const dydz = -WAVE.bAmp * WAVE.bFreq * Math.sin(z * WAVE.bFreq + t * WAVE.bSpeed);
    const h = ship.rotation.y;
    const cos = Math.cos(h), sin = Math.sin(h);
    const alongBow = dydx * cos - dydz * sin;   // local +X is the bow
    const alongBeam = dydx * sin + dydz * cos;  // local +Z is the beam

    ship.rotation.order = 'YXZ';
    ship.rotation.z = clamp(alongBow * 3.2, -0.26, 0.26);   // pitch
    ship.rotation.x = clamp(-alongBeam * 3.2, -0.22, 0.22); // roll

    if (ring) conformRingToSwell(ring, x, z, t);
  }

  function initThree() {
    const canvas = $('#oceanCanvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !PERF.low, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PERF.maxPixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
    if ('outputEncoding' in renderer && THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060b14);
    scene.fog = new THREE.FogExp2(0x060b14, 0.035);

    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500);
    camera.position.set(0, 10, 34);
    camera.lookAt(0, 0, 0);
    applyFraming();

    // ---- lights ----
    scene.add(new THREE.AmbientLight(0x445d7a, 0.7));
    const moon = new THREE.DirectionalLight(0x9fc0e0, 0.6);
    moon.position.set(-20, 30, -10);
    scene.add(moon);

    // ---- starfield ----
    const starGeom = new THREE.BufferGeometry();
    const starPos = new Float32Array(PERF.starCount * 3);
    for (let i = 0; i < PERF.starCount; i++) {
      const radius = 150 + Math.random() * 120;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.5;
      starPos[i * 3] = radius * Math.cos(theta) * Math.cos(phi);
      starPos[i * 3 + 1] = 20 + radius * Math.sin(phi);
      starPos[i * 3 + 2] = radius * Math.sin(theta) * Math.cos(phi);
    }
    starGeom.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xdfe9f5, size: 0.7, transparent: true, opacity: 0.85, sizeAttenuation: true });
    starField = new THREE.Points(starGeom, starMat);
    scene.add(starField);

    // ---- ocean plane (vertex-animated, gives the wave feel without a custom shader) ----
    oceanGeom = new THREE.PlaneGeometry(400, 400, PERF.oceanSegments, PERF.oceanSegments);
    oceanGeom.rotateX(-Math.PI / 2);
    const oceanMat = new THREE.MeshStandardMaterial({
      color: 0x0b1f3a,
      metalness: 0.35,
      roughness: 0.35,
      emissive: 0x03070d,
      transparent: false
    });
    ocean = new THREE.Mesh(oceanGeom, oceanMat);
    ocean.position.y = -2;
    scene.add(ocean);
    ocean.userData.basePositions = Float32Array.from(oceanGeom.attributes.position.array);

    // ---- anonymous ships: a cloud of glowing points drifting across the water ----
    const shipGeom = new THREE.BufferGeometry();
    const shipPos = new Float32Array(CONFIG.anonymousShipCount * 3);
    for (let i = 0; i < CONFIG.anonymousShipCount; i++) {
      shipPos[i * 3] = (Math.random() - 0.5) * 160;
      shipPos[i * 3 + 1] = -1.05 + Math.random() * 0.25; // above the wave crests
      shipPos[i * 3 + 2] = (Math.random() - 0.5) * 160;
      shipDrift.push({ dir: Math.random() * Math.PI * 2, speed: 0.15 + Math.random() * 0.35 });
    }
    shipGeom.setAttribute('position', new THREE.BufferAttribute(shipPos, 3));
    const shipMat = new THREE.PointsMaterial({
      color: 0x8fb6d9,
      size: 0.9,
      transparent: true,
      opacity: 0.85,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    anonymousShips = new THREE.Points(shipGeom, shipMat);
    scene.add(anonymousShips);

    // ---- Mohit & Sezal: dedicated small vessels ----
    // Mohit sails in a quiet slate-blue, Sezal in a warm dusty rose —
    // distinct from the moment they first appear, both still lit gold once found.
    shipMohit = buildShip(0x5f8ac9);
    shipSezal = buildShip(0xd98fae);
    scene.add(shipMohit, shipSezal);

    ringMohit = buildGlowRing();
    ringSezal = buildGlowRing();
    scene.add(ringMohit, ringSezal);

    // ---- connection line ----
    const lineGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(), new THREE.Vector3()
    ]);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x59f2c4, transparent: true, opacity: 0 });
    connectionLine = new THREE.Line(lineGeom, lineMat);
    scene.add(connectionLine);

    // ---- golden glow burst at the meeting ----
    const glowGeom = new THREE.SphereGeometry(1, 24, 24);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xe9ce9a,
      transparent: true,
      opacity: 0,
      depthWrite: false,            // Never clips or occludes ship masts/sails
      blending: THREE.AdditiveBlending
    });
    goldenGlow = new THREE.Mesh(glowGeom, glowMat);
    goldenGlow.position.set(0, -1.2, -1);
    goldenGlow.renderOrder = 3;
    goldenGlow.visible = false;
    scene.add(goldenGlow);

    initWakeParticles();

    // ---- Chapter Two: small islands marking each harbor, with dates ----
    islands = CONFIG.harbors.map((h, i) => {
      const isl = buildIsland(h.short, i + 1);
      const p = ISLAND_PATH[i + 1]; // path[0] is the point just before the first island
      isl.position.set(p.x, ISLAND_Y, p.z);
      scene.add(isl);
      return isl;
    });

    resetSceneState();

    clock = new THREE.Clock();
    window.addEventListener('resize', onResize, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { cancelAnimationFrame(rafId); rafId = null; }
      else if (!rafId) { clock.getDelta(); animate(); }
    });

    // ---- click an island to see photos from that harbor ----
    const raycaster = new THREE.Raycaster();
    const mouseNDC = new THREE.Vector2();
    renderer.domElement.style.pointerEvents = 'auto';
    renderer.domElement.addEventListener('click', (e) => {
      if (state.filmMode) return;
      const rect = renderer.domElement.getBoundingClientRect();
      mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouseNDC, camera);
      const hits = raycaster.intersectObjects(islands, true);
      if (!hits.length) return;
      let obj = hits[0].object;
      while (obj && !islands.includes(obj)) obj = obj.parent;
      if (obj) openIslandPopup(obj.userData.harborIndex, obj.userData.dateLabel);
    });

    animate();
  }

  // Puts the 3D world back to its opening frame. Called on init, and again
  // whenever the film starts, so watching it after scrolling the story
  // doesn't begin with both ships already found.
  function resetSceneState() {
    if (!scene) return;
    shipMohit.position.set(START_M.x, OCEAN_Y + SHIP_FREEBOARD, START_M.z);
    shipSezal.position.set(START_S.x, OCEAN_Y + SHIP_FREEBOARD, START_S.z);
    shipMohit.rotation.set(0, headingAngle(START_M.x, START_M.z, MEET_M.x, MEET_M.z), 0);
    shipSezal.rotation.set(0, headingAngle(START_S.x, START_S.z, MEET_S.x, MEET_S.z), 0);
    shipMohit.scale.setScalar(SHIP_SCALE);
    shipSezal.scale.setScalar(SHIP_SCALE);
    setShipFound(shipMohit, ringMohit, false, true);
    setShipFound(shipSezal, ringSezal, false, true);
    connectionLine.material.opacity = 0;
    goldenGlow.visible = false;
    goldenGlow.material.opacity = 0;
    anonymousShips.material.opacity = 0.85;
    applySky(0);
    islands.forEach((isl) => {
      isl.scale.setScalar(1);
      if (isl.userData.sprite) isl.userData.sprite.material.opacity = 0.75;
    });
    setRadarActive(false);
    setRadarStatus('SEARCHING', false);
    clearLockedBlips();
    resetAudioTheme();
  }

  // A hard, instant reset rather than the usual 3.5s crossfade — used when the
  // whole scene snaps back to its opening frame (replay, switching modes),
  // where a lingering romantic swell over an unfound ocean would be a bug,
  // not a transition worth hearing.
  function resetAudioTheme() {
    state.audioTheme = 'ambient';
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    if (romanticNodes) { romanticNodes.gain.gain.cancelScheduledValues(now); romanticNodes.gain.gain.setValueAtTime(0, now); }
    if (searchNodes) {
      const level = state.soundEnabled ? state.musicLevel : 0;
      searchNodes.gain.gain.cancelScheduledValues(now);
      searchNodes.gain.gain.setValueAtTime(level, now);
    }
  }

  // Builds a small sailboat. Local +X is the bow — everything downstream
  // orients this group by rotating it around Y so the bow actually points the
  // way it's travelling, instead of the hull sliding along sideways.
  // `color` tints the sails, the gunwale rail, and the ship's own light.
  function buildShip(color) {
    const group = new THREE.Group();

    // ---- hull: a single closed, non-self-intersecting side profile ----
    const hullShape = new THREE.Shape();
    hullShape.moveTo(-1.0, 0.15);                           // stern, deck corner
    hullShape.quadraticCurveTo(-0.15, 0.27, 0.55, 0.2);      // sheer line rising toward bow
    hullShape.quadraticCurveTo(0.95, 0.15, 1.25, 0.0);       // bow tip
    hullShape.quadraticCurveTo(0.95, -0.17, 0.5, -0.21);     // keel curve back from bow
    hullShape.quadraticCurveTo(-0.15, -0.27, -1.0, -0.05);   // keel to stern
    hullShape.lineTo(-1.0, 0.15);                            // flat transom, closes the shape

    const hullGeom = new THREE.ExtrudeGeometry(hullShape, { depth: 0.6, bevelEnabled: false, curveSegments: 20 });
    hullGeom.translate(0, 0, -0.3); // center the width

    // Taper the width so the hull pinches toward bow and stern and bellies out
    // amidships — a rounded cross-section instead of a slab.
    const hp = hullGeom.attributes.position;
    for (let i = 0; i < hp.count; i++) {
      const x = hp.getX(i);
      const t = clamp01((x + 1.0) / 2.25); // 0 at stern, 1 at bow tip
      hp.setZ(i, hp.getZ(i) * (0.3 + 0.7 * Math.sin(Math.PI * t)));
    }
    hp.needsUpdate = true;
    hullGeom.computeVertexNormals();

    const hull = new THREE.Mesh(hullGeom, new THREE.MeshStandardMaterial({
      color: 0x16304d, emissive: color, emissiveIntensity: 0.3, metalness: 0.2, roughness: 0.55
    }));
    group.add(hull);

    // ---- gunwale rail: a slim tube traced around the tapered deck edge ----
    const railCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-1.0, 0.16, 0),
      new THREE.Vector3(-0.15, 0.28, 0.20),
      new THREE.Vector3(0.55, 0.21, 0.14),
      new THREE.Vector3(1.25, 0.01, 0),
      new THREE.Vector3(0.55, 0.21, -0.14),
      new THREE.Vector3(-0.15, 0.28, -0.20),
      new THREE.Vector3(-1.0, 0.16, 0)
    ], true, 'catmullrom', 0.35);
    group.add(new THREE.Mesh(
      new THREE.TubeGeometry(railCurve, 64, 0.03, 6, true),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.75, roughness: 0.4 })
    ));

    // ---- small deckhouse, just aft of the mast ----
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.2, 0.34),
      new THREE.MeshStandardMaterial({ color: 0x18293f, roughness: 0.7 })
    );
    cabin.position.set(-0.4, 0.31, 0);
    group.add(cabin);

    // ---- bowsprit, so the jib has somewhere to attach ----
    const bowsprit = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.03, 0.6, 6),
      new THREE.MeshStandardMaterial({ color: 0xc9b18c, roughness: 0.6 })
    );
    bowsprit.rotation.z = Math.PI / 2;
    bowsprit.position.set(1.5, 0.1, 0);
    group.add(bowsprit);

    // ---- rudder ----
    const rudder = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.24, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x0e1f33, roughness: 0.6 })
    );
    rudder.position.set(-1.05, -0.08, 0);
    group.add(rudder);

    // ---- mast ----
    const mastX = 0.25;
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.045, 1.7, 8),
      new THREE.MeshStandardMaterial({ color: 0xc9b18c, emissive: color, emissiveIntensity: 0.12, roughness: 0.6 })
    );
    mast.position.set(mastX, 1.05, 0);
    group.add(mast);

    const sailMat = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.85,
      side: THREE.DoubleSide, transparent: true, opacity: 0.97
    });

    // ---- mainsail: leech curved outward as if filled with wind ----
    const mainSailShape = new THREE.Shape();
    mainSailShape.moveTo(0, 0.85);
    mainSailShape.quadraticCurveTo(-0.48, 0.1, -0.62, -0.55);
    mainSailShape.lineTo(0, -0.65);
    mainSailShape.closePath();
    const mainSail = new THREE.Mesh(new THREE.ShapeGeometry(mainSailShape, 12), sailMat);
    mainSail.position.set(mastX, 1.05, 0.01);
    group.add(mainSail);

    // ---- jib: run out to the bowsprit tip, the cue that reads "sailboat" ----
    const jibShape = new THREE.Shape();
    jibShape.moveTo(0, 0.62);
    jibShape.quadraticCurveTo(0.55, 0.22, 1.2, -0.08);
    jibShape.lineTo(0, -0.42);
    jibShape.closePath();
    const jib = new THREE.Mesh(new THREE.ShapeGeometry(jibShape, 12), sailMat.clone());
    jib.material.opacity = 0.9;
    jib.position.set(mastX, 0.95, -0.01);
    group.add(jib);

    // ---- masthead pennant ----
    const pennantShape = new THREE.Shape();
    pennantShape.moveTo(0, 0);
    pennantShape.lineTo(0.26, -0.05);
    pennantShape.lineTo(0, -0.11);
    pennantShape.closePath();
    const pennant = new THREE.Mesh(
      new THREE.ShapeGeometry(pennantShape),
      new THREE.MeshStandardMaterial({ color: 0xe9ce9a, emissive: 0xe9ce9a, emissiveIntensity: 0.5, side: THREE.DoubleSide })
    );
    pennant.position.set(mastX, 1.91, 0);
    group.add(pennant);

    // ---- warm point light, dark until the moment this ship is found ----
    const light = new THREE.PointLight(0xe9ce9a, 0, 14);
    light.position.set(0, 1.2, 0);
    group.add(light);
    group.userData.light = light;

    group.scale.setScalar(SHIP_SCALE);
    return group;
  }

  function initWakeParticles() {
    const count = 40;
    const geomM = new THREE.BufferGeometry();
    const geomS = new THREE.BufferGeometry();
    const posM = new Float32Array(count * 3);
    const posS = new Float32Array(count * 3);

    geomM.setAttribute('position', new THREE.BufferAttribute(posM, 3));
    geomS.setAttribute('position', new THREE.BufferAttribute(posS, 3));

    const matM = new THREE.PointsMaterial({
      color: 0x59f2c4, size: 0.75, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false
    });
    const matS = new THREE.PointsMaterial({
      color: 0xe9ce9a, size: 0.75, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false
    });

    wakeParticlesMohit = new THREE.Points(geomM, matM);
    wakeParticlesSezal = new THREE.Points(geomS, matS);
    wakeParticlesMohit.userData = { positions: posM, count, pool: [] };
    wakeParticlesSezal.userData = { positions: posS, count, pool: [] };

    for (let i = 0; i < count; i++) {
      wakeParticlesMohit.userData.pool.push({ x: 0, y: -100, z: 0, life: 0, maxLife: 1.5 });
      wakeParticlesSezal.userData.pool.push({ x: 0, y: -100, z: 0, life: 0, maxLife: 1.5 });
    }

    scene.add(wakeParticlesMohit, wakeParticlesSezal);

    // Shooting Star Line
    const starGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(-6, -3, -3)
    ]);
    const starMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
    shootingStarMesh = new THREE.Line(starGeom, starMat);
    shootingStarMesh.userData = { active: false, t: 0, startPos: new THREE.Vector3() };
    scene.add(shootingStarMesh);
  }

  function updateWakeParticles(ship, wakeSystem, t) {
    if (!wakeSystem || !ship || state.reducedMotion) return;
    const { pool, positions, count } = wakeSystem.userData;
    const posAttr = wakeSystem.geometry.attributes.position;

    if (Math.random() < 0.4) {
      const inactive = pool.find((p) => p.life <= 0);
      if (inactive) {
        const angle = ship.rotation.y;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const sternX = ship.position.x - cos * 1.4 + (Math.random() - 0.5) * 0.5;
        const sternZ = ship.position.z + sin * 1.4 + (Math.random() - 0.5) * 0.5;
        inactive.x = sternX;
        inactive.z = sternZ;
        inactive.y = OCEAN_Y + waveHeight(sternX, sternZ, t) + 0.05;
        inactive.life = inactive.maxLife;
      }
    }

    for (let i = 0; i < count; i++) {
      const p = pool[i];
      if (p.life > 0) {
        p.life -= 0.02;
        p.y = OCEAN_Y + waveHeight(p.x, p.z, t) + 0.05;
        positions[i * 3] = p.x;
        positions[i * 3 + 1] = p.y;
        positions[i * 3 + 2] = p.z;
      } else {
        positions[i * 3 + 1] = -100;
      }
    }
    posAttr.needsUpdate = true;
  }

  function updateShootingStar() {
    if (!shootingStarMesh || state.reducedMotion) return;
    const data = shootingStarMesh.userData;
    if (!data.active) {
      if (Math.random() < 0.003) {
        data.active = true;
        data.t = 0;
        const radius = 130 + Math.random() * 40;
        const theta = Math.random() * Math.PI * 2;
        data.startPos.set(radius * Math.cos(theta), 35 + Math.random() * 25, radius * Math.sin(theta));
        shootingStarMesh.position.copy(data.startPos);
      }
    } else {
      data.t += 0.025;
      shootingStarMesh.position.x += -2.2;
      shootingStarMesh.position.y += -1.1;
      shootingStarMesh.position.z += -1.0;
      const opacity = data.t < 0.3 ? data.t / 0.3 : Math.max(0, 1 - (data.t - 0.3) / 0.7);
      shootingStarMesh.material.opacity = opacity * 0.85;
      if (data.t >= 1) {
        data.active = false;
        shootingStarMesh.material.opacity = 0;
      }
    }
  }

  function buildGlowRing() {
    // Baked flat into world XZ rather than rotated at runtime, so a vertex's
    // y component is world height and can be driven straight from the swell.
    const geom = new THREE.RingGeometry(2.4, 3.0, 96);
    geom.rotateX(-Math.PI / 2);

    const ring = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
      color: 0xe9ce9a,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,           // never punches a hole in the water
      blending: THREE.AdditiveBlending
    }));
    ring.renderOrder = 2;
    ring.userData.base = Float32Array.from(geom.attributes.position.array);
    return ring;
  }

  // Lays a smooth, buttery halo on the water surface underneath the ship.
  function conformRingToSwell(ring, cx, cz, t) {
    if (ring.material.opacity <= 0.001) return;
    ring.position.set(cx, OCEAN_Y + 0.08, cz);
    // Smooth, gentle floating breath pulse with zero vertex shaking
    const pulse = 1.0 + 0.03 * Math.sin(t * 1.8);
    ring.scale.set(pulse, pulse, pulse);
  }

  // Lighting a ship up (or putting it back to dark) in one reversible call.
  function setShipFound(ship, ring, found, instant) {
    if (ship.userData.found === found && !instant) return; // Prevent scale jumps every frame

    ship.userData.found = found;
    ring.userData.lit = found;

    const targetOpacity = found ? 0.95 : 0;
    const targetIntensity = found ? 2.4 : 0;

    if (instant || state.reducedMotion) {
      gsap.killTweensOf([ring.material, ship.userData.light]);
      ring.material.opacity = targetOpacity;
      ship.userData.light.intensity = targetIntensity;
      return;
    }

    gsap.to(ring.material, { opacity: targetOpacity, duration: 0.6, ease: 'power2.out', overwrite: true });
    gsap.to(ship.userData.light, { intensity: targetIntensity, duration: 0.6, ease: 'power2.out', overwrite: true });
  }


  // Builds one small harbor island: a low mound, a sandy cap and beach, a
  // pier with a lantern, a palm, a photo flag on a pole (falls back to a plain
  // pennant until a photo is added), and a floating date label.
  // Helper to create a 3D Extruded Heart mesh
  function createHeartMesh(color = 0xef4444, scale = 0.28) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.25);
    shape.bezierCurveTo(0, 0.25, -0.25, 0.48, -0.48, 0.48);
    shape.bezierCurveTo(-0.75, 0.48, -0.75, 0.18, -0.75, 0.18);
    shape.bezierCurveTo(-0.75, -0.12, -0.45, -0.42, 0, -0.72);
    shape.bezierCurveTo(0.45, -0.42, 0.75, -0.12, 0.75, 0.18);
    shape.bezierCurveTo(0.75, 0.18, 0.75, 0.48, 0.48, 0.48);
    shape.bezierCurveTo(0.25, 0.48, 0, 0.25, 0, 0.25);
    const extrudeSettings = { depth: 0.18, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: 0.05, bevelThickness: 0.05 };
    const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geom.center();
    const mat = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.3,
      metalness: 0.1,
      emissive: color,
      emissiveIntensity: 0.35
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.scale.set(scale, scale, scale);
    return mesh;
  }

  function buildIsland(dateLabel, harborIndex) {
    const group = new THREE.Group();

    // Mound & beach terrain
    const mound = new THREE.Mesh(
      new THREE.ConeGeometry(4.4, 5.6, 16),
      new THREE.MeshStandardMaterial({ color: 0x3d3226, roughness: 0.9 })
    );
    mound.position.y = -2.4;
    group.add(mound);

    const cap = new THREE.Mesh(
      new THREE.ConeGeometry(3.5, 0.95, 16),
      new THREE.MeshStandardMaterial({ color: 0xd2ba92, roughness: 0.8 })
    );
    cap.position.y = -0.15;
    group.add(cap);

    const beach = new THREE.Mesh(
      new THREE.CylinderGeometry(6.0, 7.0, 0.38, 24),
      new THREE.MeshStandardMaterial({ color: 0xe5d2aa, roughness: 0.85 })
    );
    beach.position.y = -1.88;
    group.add(beach);

    // Shoreline rocks
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x2e271f, roughness: 0.9 });
    for (let i = 0; i < 8; i++) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.25 + Math.random() * 0.22, 0), rockMat);
      const angle = (i / 8) * Math.PI * 2 + Math.random() * 0.4;
      const r = 5.0 + Math.random() * 1.4;
      rock.position.set(Math.cos(angle) * r, -1.72, Math.sin(angle) * r);
      rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      group.add(rock);
    }

    // ---- AUTHENTIC PORT HARBOUR QUAY & DOCK ----
    const portStoneMat = new THREE.MeshStandardMaterial({ color: 0x42382e, roughness: 0.85 });
    const portWoodMat = new THREE.MeshStandardMaterial({ color: 0x5a4332, roughness: 0.75 });
    const isRightSide = (harborIndex % 2 === 0);
    const sideSign = isRightSide ? -1 : 1;
    const quayLen = 4.2;
    const baseAngle = 0.45;
    const pierX = sideSign * Math.cos(baseAngle);
    const pierZ = Math.sin(baseAngle);

    // Stone Quay Wall Foundation
    const quayWall = new THREE.Mesh(new THREE.BoxGeometry(quayLen, 0.6, 1.2), portStoneMat);
    quayWall.position.set(pierX * (quayLen / 2 + 3.2), -1.85, pierZ * (quayLen / 2 + 3.2));
    quayWall.rotation.y = Math.atan2(pierZ, pierX);
    group.add(quayWall);

    // Wooden Port Deck Boardwalk
    const portDeck = new THREE.Mesh(new THREE.BoxGeometry(quayLen + 0.3, 0.16, 1.3), portWoodMat);
    portDeck.position.set(pierX * (quayLen / 2 + 3.2), -1.5, pierZ * (quayLen / 2 + 3.2));
    portDeck.rotation.y = Math.atan2(pierZ, pierX);
    group.add(portDeck);

    // Dock Mooring Bollards
    const bollardMat = new THREE.MeshStandardMaterial({ color: 0x1f1914, metalness: 0.6, roughness: 0.4 });
    [-1.6, 0, 1.6].forEach((offset) => {
      const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.45, 10), bollardMat);
      const bX = pierX * (3.2 + quayLen / 2 + offset * 0.4);
      const bZ = pierZ * (3.2 + quayLen / 2 + offset * 0.4);
      bollard.position.set(bX, -1.35, bZ);
      group.add(bollard);
    });

    // Warm Romantic Lantern at Port End
    const lanternX = pierX * (3.2 + quayLen);
    const lanternZ = pierZ * (3.2 + quayLen);
    const lanternPole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.0, 8), portWoodMat);
    lanternPole.position.set(lanternX, -1.0, lanternZ);
    group.add(lanternPole);

    const lanternBulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0xffaa66, emissive: 0xffaa66, emissiveIntensity: 1.5 })
    );
    lanternBulb.position.set(lanternX, -0.55, lanternZ);
    group.add(lanternBulb);

    const lanternLight = new THREE.PointLight(0xffaa66, 1.2, 8);
    lanternLight.position.copy(lanternBulb.position);
    group.add(lanternLight);

    // ---- 3D ROMANTIC HEARTS SCATTERED ON PORT DOCK ----
    const heartColors = [0xef4444, 0xf43f5e, 0xf472b6, 0xe11d48];
    for (let h = 0; h < 5; h++) {
      const heart = createHeartMesh(heartColors[h % heartColors.length], 0.22 + Math.random() * 0.1);
      const hOffset = -1.4 + h * 0.7;
      const hX = pierX * (3.2 + quayLen / 2 + hOffset * 0.4) + (Math.random() - 0.5) * 0.4;
      const hZ = pierZ * (3.2 + quayLen / 2 + hOffset * 0.4) + (Math.random() - 0.5) * 0.4;
      heart.position.set(hX, -1.38, hZ);
      heart.rotation.set(-Math.PI / 2 + (Math.random() - 0.5) * 0.4, 0, Math.random() * Math.PI);
      group.add(heart);
    }

    // ---- "M ❤️ S" INSCRIBED IN THE GOLDEN SAND ----
    const sandCanvas = document.createElement('canvas');
    sandCanvas.width = 512; sandCanvas.height = 256;
    const sCtx = sandCanvas.getContext('2d');
    sCtx.clearRect(0, 0, 512, 256);
    sCtx.font = '700 72px "Fraunces", Georgia, serif';
    sCtx.textAlign = 'center';
    sCtx.textBaseline = 'middle';
    sCtx.shadowColor = 'rgba(239, 68, 68, 0.85)';
    sCtx.shadowBlur = 18;
    sCtx.fillStyle = '#ef4444';
    sCtx.fillText('M  ❤️  S', 256, 128);

    const sandTexture = new THREE.CanvasTexture(sandCanvas);
    const sandDecalMat = new THREE.MeshStandardMaterial({
      map: sandTexture,
      transparent: true,
      depthWrite: false,
      roughness: 0.5
    });
    const sandDecal = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.8), sandDecalMat);
    sandDecal.position.set(0, 0.32, 0.6);
    sandDecal.rotation.x = -Math.PI / 2.6;
    group.add(sandDecal);

    // 3D Red Heart standing on the sand between M and S
    const sandHeart = createHeartMesh(0xef4444, 0.35);
    sandHeart.position.set(0, 0.48, 0.6);
    sandHeart.rotation.set(0.2, Math.PI / 6, 0);
    group.add(sandHeart);

    // Beautiful Curved Palm Tree
    const trunkCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.4, -0.2, 0.2),
      new THREE.Vector3(0.6, 0.9, 0.25),
      new THREE.Vector3(0.85, 2.0, 0.3),
      new THREE.Vector3(1.05, 2.8, 0.35)
    ]);
    const trunkGeom = new THREE.TubeGeometry(trunkCurve, 16, 0.14, 8, false);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3d2718, roughness: 0.85 });
    const trunkMesh = new THREE.Mesh(trunkGeom, trunkMat);
    group.add(trunkMesh);

    // Palm Crown & Fronds
    const crownPos = new THREE.Vector3(1.05, 2.8, 0.35);
    const frondMat = new THREE.MeshStandardMaterial({
      color: 0x346b3e, roughness: 0.6, side: THREE.DoubleSide
    });
    const frondGroup = new THREE.Group();
    const frondCount = 8;
    for (let i = 0; i < frondCount; i++) {
      const angle = (i / frondCount) * Math.PI * 2;
      const frondCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(Math.cos(angle) * 0.8, 0.3, Math.sin(angle) * 0.8),
        new THREE.Vector3(Math.cos(angle) * 1.5, -0.2, Math.sin(angle) * 1.5)
      ]);
      const frondTube = new THREE.Mesh(
        new THREE.TubeGeometry(frondCurve, 8, 0.16, 4, false),
        frondMat
      );
      frondGroup.add(frondTube);
    }
    frondGroup.position.copy(crownPos);
    group.add(frondGroup);

    // Coconut clusters beneath canopy
    const coconutMat = new THREE.MeshStandardMaterial({ color: 0x5a3f21, roughness: 0.8 });
    for (let c = 0; c < 4; c++) {
      const coconut = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), coconutMat);
      const cAngle = (c / 4) * Math.PI * 2;
      coconut.position.set(crownPos.x + Math.cos(cAngle) * 0.15, crownPos.y - 0.12, crownPos.z + Math.sin(cAngle) * 0.15);
      group.add(coconut);
    }

    // Flag pole carrying photo
    const poleHeight = 2.7;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.035, poleHeight, 6),
      new THREE.MeshStandardMaterial({ color: 0xc9b08a, roughness: 0.6 })
    );
    pole.position.set(-1.1, poleHeight / 2 - 0.2, -0.35);
    group.add(pole);

    const flagMat = new THREE.MeshStandardMaterial({
      color: 0xe9ce9a, roughness: 0.6, side: THREE.DoubleSide, transparent: true, opacity: 0.96
    });
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 0.95), flagMat);
    flag.position.set(-1.1 + 0.68, poleHeight - 0.55, -0.35);
    group.add(flag);

    if (Number.isInteger(harborIndex)) {
      loadHarborPhotoTexture(harborIndex).then((tex) => {
        if (!tex) return;
        flagMat.map = tex;
        flagMat.color.set(0xffffff);
        flagMat.needsUpdate = true;
      });
    }

    // Floating date label sprite
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 120;
    const ctx = canvas.getContext('2d');
    ctx.font = '600 46px "Space Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(233,206,154,0.65)';
    ctx.shadowBlur = 16;
    ctx.fillStyle = 'rgba(233,206,154,0.95)';
    ctx.fillText(dateLabel, 160, 60);
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    sprite.scale.set(4.4, 1.65, 1);
    sprite.position.set(0, 4.4, 0);
    group.add(sprite);

    Object.assign(group.userData, { mound, cap, sprite, flag, harborIndex, dateLabel });
    return group;
  }

  // Probes assets/photos/harbors/{index}-1.{ext} for the flag photo (or uses
  // CONFIG.harborPhotos[index] directly if you set one) — no hardcoded
  // filenames, just tries each extension in turn and resolves null if none exist.
  function loadHarborPhotoTexture(index) {
    const override = CONFIG.harborPhotos[index];
    const texLoader = new THREE.TextureLoader();
    if (override) {
      return new Promise((resolve) => texLoader.load(override, resolve, undefined, () => resolve(null)));
    }
    const exts = CONFIG.galleryProbe.extensions;
    return new Promise((resolve) => {
      let i = 0;
      (function tryNext() {
        if (i >= exts.length) { resolve(null); return; }
        texLoader.load(
          `assets/photos/harbors/${index}-1.${exts[i]}`,
          (tex) => resolve(tex),
          undefined,
          () => { i++; tryNext(); }
        );
      })();
    });
  }

  let framingPull = 1; // extra camera distance needed on narrow screens

  function applyFraming() {
    const a = camera.aspect;
    // Hold a roughly constant *horizontal* field of view rather than a vertical
    // one, capped so the wide end never fisheyes...
    const vFov = 2 * Math.atan(Math.tan((78 * Math.PI / 180) / 2) / a) * 180 / Math.PI;
    camera.fov = clamp(vFov, 42, 74);
    camera.updateProjectionMatrix();
    // ...and make up the rest of the shortfall by standing further back.
    framingPull = clamp(1.45 / Math.min(a, 1.45), 1, 2.6);
  }

  function onResize() {
    if (!camera) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    applyFraming();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (film.tl) layoutTransportPorts();
  }

  function animate() {
    rafId = requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    if (!state.reducedMotion) {
      // ---- ocean waves ----
      // Normals are derived analytically from the wave's own slope rather than
      // via computeVertexNormals(), which would rebuild every face normal from
      // cross products each frame. Same surface, a fraction of the work.
      const pos = oceanGeom.attributes.position;
      const nrm = oceanGeom.attributes.normal;
      const base = ocean.userData.basePositions;
      const { aAmp, aFreq, aSpeed, bAmp, bFreq, bSpeed } = WAVE;
      for (let i = 0; i < pos.count; i++) {
        const ix = i * 3;
        const x = base[ix], z = base[ix + 2];
        const pa = x * aFreq + t * aSpeed;
        const pb = z * bFreq + t * bSpeed;
        pos.array[ix + 1] = Math.sin(pa) * aAmp + Math.cos(pb) * bAmp;

        const dydx = aAmp * aFreq * Math.cos(pa);
        const dydz = -bAmp * bFreq * Math.sin(pb);
        const inv = 1 / Math.hypot(dydx, 1, dydz);
        nrm.array[ix] = -dydx * inv;
        nrm.array[ix + 1] = inv;
        nrm.array[ix + 2] = -dydz * inv;
      }
      pos.needsUpdate = true;
      nrm.needsUpdate = true;

      // ---- anonymous ships drift ----
      const sp = anonymousShips.geometry.attributes.position;
      for (let i = 0; i < CONFIG.anonymousShipCount; i++) {
        const d = shipDrift[i];
        const ix = i * 3;
        sp.array[ix] += Math.cos(d.dir) * d.speed * 0.02;
        sp.array[ix + 2] += Math.sin(d.dir) * d.speed * 0.02;
        if (sp.array[ix] > 90) sp.array[ix] = -90;
        if (sp.array[ix] < -90) sp.array[ix] = 90;
        if (sp.array[ix + 2] > 90) sp.array[ix + 2] = -90;
        if (sp.array[ix + 2] < -90) sp.array[ix + 2] = 90;
      }
      sp.needsUpdate = true;

      // ---- the two ships ride the swell they are actually sitting on ----
      floatOnSwell(shipMohit, ringMohit, t);
      floatOnSwell(shipSezal, ringSezal, t);

      // ---- bioluminescent wakes & celestial effects ----
      updateWakeParticles(shipMohit, wakeParticlesMohit, t);
      updateWakeParticles(shipSezal, wakeParticlesSezal, t);
      updateShootingStar();
      if (starField) starField.material.size = 0.7 + Math.sin(t * 1.8) * 0.12;

      // ---- islands stay completely stationary on water ----
      islands.forEach((isl, i) => {
        isl.position.y = ISLAND_Y;
        if (isl.userData.flag) isl.userData.flag.rotation.y = Math.sin(t * 1.6 + i) * 0.12;
      });
    }

    if (connectionLine.material.opacity > 0) {
      const posAttr = connectionLine.geometry.attributes.position;
      posAttr.setXYZ(0, shipMohit.position.x, shipMohit.position.y + 0.6, shipMohit.position.z);
      posAttr.setXYZ(1, shipSezal.position.x, shipSezal.position.y + 0.6, shipSezal.position.z);
      posAttr.needsUpdate = true;
    }

    if (state.reducedMotion) { // floatOnSwell is skipped, so seat them on calm water
      floatOnSwell(shipMohit, ringMohit, 0);
      floatOnSwell(shipSezal, ringSezal, 0);
    }
    // sonar pulse halo only while active and lit
    const halo = 0.82 + Math.sin(t * 1.15) * 0.18;
    if (ringMohit.userData.lit) {
      ringMohit.material.opacity = Math.min(ringMohit.material.opacity, halo);
    } else {
      ringMohit.material.opacity = 0;
    }
    if (ringSezal.userData.lit) {
      ringSezal.material.opacity = Math.min(ringSezal.material.opacity, halo * 0.98);
    } else {
      ringSezal.material.opacity = 0;
    }

    // A gentle, non-cumulative "standing on a boat deck" sway on top of
    // whatever position the story or the film last asked for — keeps the
    // camera alive even while the viewer pauses. The film sways less, so
    // shots read as locked-off rather than handheld.
    const swayAmount = state.reducedMotion ? 0 : (state.filmMode ? 0.5 : 1);
    const look = cameraBase.look;
    camera.position.set(
      look[0] + (cameraBase.pos[0] - look[0]) * framingPull + Math.cos(t * 0.32) * 0.1 * swayAmount,
      look[1] + (cameraBase.pos[1] - look[1]) * framingPull + Math.sin(t * 0.45) * 0.12 * swayAmount,
      look[2] + (cameraBase.pos[2] - look[2]) * framingPull
    );
    camera.lookAt(look[0], look[1], look[2]);

    renderer.render(scene, camera);
  }

  /* ---- shared world helpers, used by both the story and the film ---- */

  // Position along ISLAND_PATH. segF is in "segments": 0 is the first path
  // point, 1 is the second, and so on.
  function pathAt(segF) {
    const segments = ISLAND_PATH.length - 1;
    const f = clamp(segF, 0, segments);
    const segIdx = Math.min(Math.floor(f), segments - 1);
    const segT = f - segIdx;
    const a = ISLAND_PATH[segIdx], b = ISLAND_PATH[segIdx + 1];
    let dx = b.x - a.x, dz = b.z - a.z;
    const dlen = Math.hypot(dx, dz) || 1;
    dx /= dlen; dz /= dlen;
    return { x: lerp(a.x, b.x, segT), z: lerp(a.z, b.z, segT), dx, dz, perpX: -dz, perpZ: dx };
  }

  // Sails both ships (and optionally the camera) to a point on the harbor path.
  function sailPath(segF, opts = {}) {
    const { moveCamera = true, camDist = 16, camHeight = 8 } = opts;
    const p = pathAt(segF);

    // Both ships share a lane off to one side of the harbor path. The offset
    // is perpendicular to the *direction of travel*, not a fixed world axis,
    // or they'd cut through whichever island they were passing.
    const laneOffset = 11;    // clears the island beach radius (6.6) with margin
    const shipGap = 3.6;      // far enough apart to read as two hulls
    shipMohit.position.x = p.x + p.perpX * (laneOffset - shipGap / 2);
    shipMohit.position.z = p.z + p.perpZ * (laneOffset - shipGap / 2);
    shipSezal.position.x = p.x + p.perpX * (laneOffset + shipGap / 2);
    shipSezal.position.z = p.z + p.perpZ * (laneOffset + shipGap / 2);

    const headingY = Math.atan2(-p.dz, p.dx);
    shipMohit.rotation.y = headingY;
    shipSezal.rotation.y = headingY;

    // Ensure target rings stay smoothly & permanently lit throughout harbour navigation
    setShipFound(shipMohit, ringMohit, true);
    setShipFound(shipSezal, ringSezal, true);

    if (moveCamera) {
      cameraBase.pos = [p.x - p.dx * camDist, camHeight, p.z - p.dz * camDist];
      cameraBase.look = [p.x, -0.5, p.z];
    }

    // Island i sits AT path point i+1, so the ships draw level with it when
    // segF === i + 1 — that is where its arrival pulse should peak.
    islands.forEach((isl, i) => {
      const proximity = Math.max(0, 1 - Math.min(Math.abs(segF - (i + 1)), 1.5) / 1.5);
      isl.scale.setScalar(1); // lock scale to 1 so piers and islands stay 100% stationary
      if (isl.userData.sprite) isl.userData.sprite.material.opacity = 0.75 + proximity * 0.25;
    });
  }

  // Night -> dawn -> sunrise, as one 0..1 dial.
  function applySky(dawnT) {
    if (!scene) return;
    const nightSky = 0x060b14, dawnSky = 0x33253a, sunriseSky = 0xB4714A;
    const skyColor = dawnT < 0.6
      ? lerpColor(nightSky, dawnSky, dawnT / 0.6)
      : lerpColor(dawnSky, sunriseSky, (dawnT - 0.6) / 0.4);
    scene.background.setHex(skyColor);
    scene.fog.color.setHex(skyColor);
    ocean.material.color.setHex(lerpColor(0x0b1f3a, 0x5d4038, dawnT));
    starField.material.opacity = lerp(0.85, 0, dawnT);
  }

  // The golden burst at the meeting, as one 0..1 dial so it reverses cleanly.
  function applyMeetingBurst(t) {
    const on = t > 0 && t < 1;
    goldenGlow.visible = on;
    if (!on) { goldenGlow.material.opacity = 0; return; }
    const eased = 1 - Math.pow(1 - t, 2);
    goldenGlow.scale.setScalar(lerp(0.1, 15, eased));
    goldenGlow.material.opacity = (1 - eased) * 0.9;
  }

  /* ------------------------------------------------------------------------
     3. RADAR HUD
     ------------------------------------------------------------------------ */
  const radarHUD = $('#radarHUD');
  const radarBlipsGroup = $('#radarBlips');
  const radarStatus = $('#radarStatus');
  let radarPingInterval = null;
  const lockedBlips = {}; // keyed by ship, so locks can be cleared on rewind

  function setRadarActive(active) {
    if (active === state.radarActive) return;
    state.radarActive = active;
    radarHUD.classList.toggle('active', active);
    radarHUD.setAttribute('aria-hidden', String(!active));
    if (active) startRadarPings(); else stopRadarPings();
  }

  function startRadarPings() {
    if (radarPingInterval) return;
    radarPingInterval = setInterval(() => {
      if (state.reducedMotion) return;
      spawnBlip(false);
      playRadarPing();
    }, 900);
  }
  function stopRadarPings() {
    clearInterval(radarPingInterval);
    radarPingInterval = null;
  }

  function spawnBlip(locked, atAngle) {
    const ns = 'http://www.w3.org/2000/svg';
    const angle = atAngle !== undefined ? atAngle : Math.random() * Math.PI * 2;
    const radius = 14 + Math.random() * 78;
    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('cx', (100 + Math.cos(angle) * radius).toFixed(1));
    circle.setAttribute('cy', (100 + Math.sin(angle) * radius).toFixed(1));
    circle.setAttribute('r', locked ? '4.5' : '2.5');
    circle.setAttribute('class', locked ? 'radar-blip locked' : 'radar-blip pulse');
    radarBlipsGroup.appendChild(circle);
    if (!locked) setTimeout(() => circle.remove(), 1700);
    return circle;
  }

  // Locked blips are keyed so the story can take them back off the scope when
  // the viewer scrolls back before the moment of contact.
  function setLockedBlip(key, on, angle) {
    if (on && !lockedBlips[key]) {
      lockedBlips[key] = spawnBlip(true, angle);
      if (!film.seeking) playTargetLock(); // silent while someone drags the playhead
    } else if (!on && lockedBlips[key]) {
      lockedBlips[key].remove();
      delete lockedBlips[key];
    }
  }
  function clearLockedBlips() {
    Object.keys(lockedBlips).forEach((k) => { lockedBlips[k].remove(); delete lockedBlips[k]; });
  }

  function setRadarStatus(text, locked) {
    if (radarStatus.textContent !== text) radarStatus.textContent = text;
    radarStatus.classList.toggle('locked', !!locked);
  }

  /* ------------------------------------------------------------------------
     4. THE SCROLL STORY

     Everything the scroll drives is derived from one 0..1 progress value, so
     scrubbing backwards genuinely undoes what scrubbing forwards did — the
     radar goes back to SEARCHING, the rings go dark, the sky returns to night.
     ------------------------------------------------------------------------ */
  const SCENE_COUNT = 10;
  const SCENE_STOP = (n) => (n - 1) / (SCENE_COUNT - 1);

  const mohitEdge = edge();
  const sezalEdge = edge();
  const meetEdge = edge();

  function initStoryScrollTriggers() {
    gsap.registerPlugin(ScrollTrigger);

    // Per-scene text reveals
    $$('.scene').forEach((sceneEl) => {
      const title = sceneEl.querySelector('.scene-title');
      const copies = sceneEl.querySelectorAll('.scene-copy');
      const tl = gsap.timeline({
        scrollTrigger: { trigger: sceneEl, start: 'top 65%', end: 'top 20%', toggleActions: 'play none none reverse' }
      });
      if (title) tl.to(title, { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out' });
      if (copies.length) tl.to(copies, { opacity: 1, y: 0, duration: 0.8, stagger: 0.15, ease: 'power3.out' }, '-=0.5');
    });

    // Quote lines
    gsap.utils.toArray('.quote-line').forEach((line, i) => {
      gsap.to(line, {
        opacity: 1, duration: 1.1, ease: 'power2.out', delay: i * 0.25,
        scrollTrigger: { trigger: line, start: 'top 75%', toggleActions: 'play none none reverse' }
      });
    });

    // Our Roka reveal
    gsap.timeline({ scrollTrigger: { trigger: '#scene-9', start: 'top 60%', toggleActions: 'play none none reverse' } })
      .to('.roka-title', { opacity: 1, scale: 1, duration: 1.2, ease: 'back.out(1.4)' })
      .to('.roka-date', { opacity: 1, duration: 0.8, ease: 'power2.out' }, '-=0.5');

    // ---- Chapter One: the camera, ocean and radar choreography ----
    ScrollTrigger.create({
      trigger: '#chapterOne', start: 'top top', end: 'bottom bottom', scrub: 0.6,
      onUpdate: (self) => updateChapterOne(self.progress)
    });

    // ---- Chapter Two: ships and camera sail forward past each island ----
    ScrollTrigger.create({
      trigger: '#chapterTwo', start: 'top top', end: 'bottom bottom', scrub: 0.6,
      onUpdate: (self) => {
        if (state.filmMode) return;
        sailPath(clamp01(self.progress) * (ISLAND_PATH.length - 1));
        connectionLine.material.opacity = 0;
        if (goldenGlow.visible) { goldenGlow.visible = false; goldenGlow.material.opacity = 0; }
      }
    });
  }

  const CHAPTER_ONE_CAMERA = [
    { p: SCENE_STOP(1), pos: [0, 10, 34], look: [0, 0, 0] },
    { p: SCENE_STOP(2), pos: [0, 16, 26], look: [0, 0, -4] },
    { p: SCENE_STOP(3), pos: [-14, 6, -2], look: [START_M.x, -1, START_M.z] },
    { p: SCENE_STOP(4), pos: [16, 6, 20], look: [START_S.x, -1, START_S.z] },
    { p: SCENE_STOP(5), pos: [0, 14, 30], look: [1, -1, -1] },
    { p: SCENE_STOP(6), pos: [0, 9, 20], look: [0, -1, 0] },
    { p: SCENE_STOP(7), pos: [0, 5, 10], look: [0, -1, 0] },
    { p: SCENE_STOP(8), pos: [0, 4, 8], look: [0, -1, 0] },
    { p: SCENE_STOP(9), pos: [0, 3, 6], look: [0, -1, 0] },
    { p: SCENE_STOP(10), pos: [0, 6, 16], look: [0, 0, -20] }
  ];

  function updateChapterOne(progress) {
    if (!scene || state.filmMode) return;
    state.scrollProgress = progress;

    updateSceneAudioByProgress(progress);
    setRadarActive(progress >= SCENE_STOP(2) - 0.02 && progress < SCENE_STOP(8));

    const cam = interpolateKeyframes(CHAPTER_ONE_CAMERA, progress);
    cameraBase.pos = cam.pos;
    cameraBase.look = cam.look;

    // Ships sail toward each other across scenes 6 -> 7
    const meetT = clamp01((progress - SCENE_STOP(6)) / (SCENE_STOP(7) - SCENE_STOP(6)));
    shipMohit.position.x = lerp(START_M.x, MEET_M.x, meetT);
    shipMohit.position.z = lerp(START_M.z, MEET_M.z, meetT);
    shipSezal.position.x = lerp(START_S.x, MEET_S.x, meetT);
    shipSezal.position.z = lerp(START_S.z, MEET_S.z, meetT);
    shipMohit.rotation.y = headingAngle(START_M.x, START_M.z, MEET_M.x, MEET_M.z);
    shipSezal.rotation.y = headingAngle(START_S.x, START_S.z, MEET_S.x, MEET_S.z);

    // Isolation: the rest of the fleet fades once both are found
    anonymousShips.material.opacity = lerp(0.85, 0.08, clamp01((progress - SCENE_STOP(5)) / 0.06));

    // ---- discrete beats, all derived from progress so they reverse ----
    const mohitOn = progress >= SCENE_STOP(3);
    const sezalOn = progress >= SCENE_STOP(4);
    const bothOn = progress >= SCENE_STOP(5);
    const metOn = progress >= SCENE_STOP(7);

    // Beautiful target circles stay glowing around the ships once detected
    setShipFound(shipMohit, ringMohit, mohitOn);
    setShipFound(shipSezal, ringSezal, sezalOn);
    setLockedBlip('mohit', mohitOn, -Math.PI * 0.75);
    setLockedBlip('sezal', sezalOn, Math.PI * 0.2);

    setRadarStatus(
      metOn ? 'TARGET FOUND'
        : bothOn ? 'TARGETS LOCKED'
          : sezalOn ? `CONTACT — ${CONFIG.names.second.toUpperCase()}`
            : mohitOn ? `CONTACT — ${CONFIG.names.first.toUpperCase()}`
              : 'SEARCHING',
      bothOn
    );

    // Laser connection line disappears completely on meeting
    if (bothOn && !metOn) {
      const fadeIn = clamp01((progress - SCENE_STOP(5)) / 0.03);
      const fadeOut = 1 - clamp01((meetT - 0.5) / 0.5);
      connectionLine.material.opacity = fadeIn * fadeOut * 0.85;
    } else {
      connectionLine.material.opacity = 0;
    }

    applyMeetingBurst(clamp01((progress - SCENE_STOP(7)) / 0.07));

    // 1st ship = Jolly chime, 2nd ship = Cartoon Road Runner Beep-Beep
    mohitEdge(mohitOn, () => playJollyChime({ voice: 'mohit' }));
    sezalEdge(sezalOn, () => playBeepBeep({ voice: 'sezal' }));
    meetEdge(metOn, () => {
      playJollyChime({ delay: 0.1, voice: 'meet' });
      playBeepBeep({ delay: 0.55, voice: 'meet2' });
      playCelebration(0.9);
    });

    // Sky: night -> sunrise across the last two scenes
    applySky(clamp01((progress - SCENE_STOP(9)) / (1 - SCENE_STOP(9))));
  }

  function interpolateKeyframes(frames, p) {
    for (let i = 0; i < frames.length - 1; i++) {
      const a = frames[i], b = frames[i + 1];
      if (p >= a.p && p <= b.p) {
        const t = (p - a.p) / (b.p - a.p || 1);
        return {
          pos: [lerp(a.pos[0], b.pos[0], t), lerp(a.pos[1], b.pos[1], t), lerp(a.pos[2], b.pos[2], t)],
          look: [lerp(a.look[0], b.look[0], t), lerp(a.look[1], b.look[1], t), lerp(a.look[2], b.look[2], t)]
        };
      }
    }
    return p < frames[0].p ? frames[0] : frames[frames.length - 1];
  }

  /* ------------------------------------------------------------------------
     5. AUDIO — synthesized entirely in the browser via the Web Audio API.
     No external files, so there is never a "missing file" reason for silence.

     Two music layers share the same master bus and are crossfaded by
     setAudioTheme(): a sparse "searching" drone before either ship is found,
     and a warmer "romantic" theme — a string-like chord plus a slow harp
     arpeggio — once the first one is. setAudioTheme is called every frame
     from both the scroll story and the film with the current mohitOn/sezalOn
     state rather than as a one-shot, so scrubbing backwards past the moment
     of contact genuinely returns to the searching theme instead of leaving
     the romance playing over an empty ocean.
     ------------------------------------------------------------------------ */
  let audioCtx = null;
  let masterGain = null;
  let oceanNodes = null;
  let searchNodes = null;     // the sparse open-fifth drone, pre-contact
  let romanticNodes = null;   // the warmer theme, post-contact
  let reverbNode = null;      // shared algorithmic reverb, used by the romantic layer
  let arpeggioTimer = null;
  let progressionTimer = null;

  // A real chord progression rather than one static chord — I-V-vi-IV in D
  // major, the same shape underneath a great many romantic film themes. Each
  // entry is five voices, low to high, so the pad can glide smoothly from one
  // chord into the next instead of jumping.
  // Rich 6-chord progression (D - A - Bm - F#m - G - A7) for romantic movie score feel
  const ROMANTIC_PROGRESSION = [
    [146.83, 220.00, 293.66, 369.99, 440.00], // D   — D3 A3  D4  F#4 A4
    [110.00, 164.81, 220.00, 277.18, 329.63], // A   — A2 E3  A3  C#4 E4
    [123.47, 184.99, 246.94, 293.66, 369.99], // Bm  — B2 F#3 B3  D4  F#4
    [92.50, 146.83, 184.99, 220.00, 277.18], // F#m — F#2 C#3 F#3 A3 C#4
    [98.00, 146.83, 196.00, 246.94, 293.66], // G   — G2 D3  G3  B3  D4
    [110.00, 164.81, 207.65, 277.18, 329.63]  // A7  — A2 E3  G#3 C#4 E4
  ];

  function setupAudioContext() {
    if (audioCtx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { console.warn('[audio] Web Audio API not supported in this browser.'); return; }
    audioCtx = new Ctx();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = state.soundEnabled ? 1 : 0;
    masterGain.connect(audioCtx.destination);
  }

  // Gentle soothing ocean sea waves swell: low-pass filtered noise with slow 16-second breathing LFO
  function startOceanAmbience() {
    if (oceanNodes || !audioCtx) return;
    const bufferSize = audioCtx.sampleRate * 2;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 380; // Soft soothing sea waves

    const lfo = audioCtx.createOscillator();
    lfo.frequency.value = 0.06; // Slow ocean wave breath
    const lfoGain = audioCtx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    const gain = audioCtx.createGain();
    gain.gain.value = 0;

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    noise.start();
    lfo.start();
    gain.gain.linearRampToValueAtTime(0.12, audioCtx.currentTime + 3);

    oceanNodes = { noise, filter, lfo, gain };
  }

  // Search theme: Silent so there is ZERO continuous ship engine drone/hum
  function startSearchTheme() {
    if (searchNodes || !audioCtx) return;
    const gain = audioCtx.createGain();
    gain.gain.value = 0;
    gain.connect(masterGain);
    searchNodes = { oscs: [], gain };
  }

  // A short, generated impulse response — exponentially decaying filtered
  // noise — used as a cheap algorithmic reverb. This one change does more for
  // "does this sound like a produced piece of music" than almost anything
  // else available without loading a sample: it gives the pad and the pluck
  // somewhere to live, instead of sounding dry and stuck to the speaker.
  function buildReverb() {
    if (reverbNode) return reverbNode;
    const len = audioCtx.sampleRate * 2.6;
    const impulse = audioCtx.createBuffer(2, len, audioCtx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
      }
    }
    reverbNode = audioCtx.createConvolver();
    reverbNode.buffer = impulse;
    return reverbNode;
  }

  // The "romantic" theme: a slow chord pad that actually moves through a
  // progression (D–A–Bm–G) rather than holding one chord throughout, each
  // change a gentle multi-second glide; a soft, unhurried pluck picked out
  // over the top, following whichever chord is currently sounding; and a
  // shared reverb send so both have some air around them.
  function startRomanticTheme() {
    if (romanticNodes || !audioCtx) return;

    const dryGain = audioCtx.createGain(); dryGain.gain.value = 1;
    const wetGain = audioCtx.createGain(); wetGain.gain.value = 0.32;
    const reverb = buildReverb();
    const out = audioCtx.createGain(); out.gain.value = 0; // this is the layer's overall level
    dryGain.connect(out);
    wetGain.connect(reverb);
    reverb.connect(out);
    out.connect(masterGain);

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1500;
    filter.Q.value = 0.4;
    filter.connect(dryGain);
    filter.connect(wetGain);

    // slow filter sweep, so the pad has some inner motion even held still
    const filterLfo = audioCtx.createOscillator();
    filterLfo.frequency.value = 0.045;
    const filterLfoGain = audioCtx.createGain();
    filterLfoGain.gain.value = 260;
    filterLfo.connect(filterLfoGain);
    filterLfoGain.connect(filter.frequency);
    filterLfo.start();

    // a slow tremolo across the whole pad — real string pads breathe in
    // volume as much as in tone, a static level is what read as "an organ"
    const tremolo = audioCtx.createOscillator();
    tremolo.frequency.value = 0.12;
    const tremoloDepth = audioCtx.createGain();
    tremoloDepth.gain.value = 0.12;
    const tremoloCenter = audioCtx.createConstantSource();
    tremoloCenter.offset.value = 0.88;
    tremolo.connect(tremoloDepth);
    const padGain = audioCtx.createGain();
    padGain.gain.value = 0; // the AudioParam's own value adds to whatever is connected in,
    // so it must start at 0 — the two modulators below are the only source
    tremoloDepth.connect(padGain.gain);
    tremoloCenter.connect(padGain.gain);
    padGain.connect(filter);
    tremolo.start();
    tremoloCenter.start();

    // one shared vibrato LFO, applied to every pad voice at a tiny offset each
    // so the chord has a touch of natural chorus rather than sounding tuned
    const vibrato = audioCtx.createOscillator();
    vibrato.frequency.value = 4.4;
    const vibratoGain = audioCtx.createGain();
    vibratoGain.gain.value = 2.2;
    vibrato.connect(vibratoGain);
    vibrato.start();

    romanticNodes = { gain: out, filter, filterLfo, tremolo, tremoloCenter, vibrato, oscs: [], reverbSend: wetGain };
    return romanticNodes;
  }

  // Single Master Soundtrack Engine (Chand Mera Dil)
  let mainAudioTrack = null;

  function initMainSoundtrack() {
    if (mainAudioTrack) return;
    mainAudioTrack = new Audio('chand_mera_dil.mp3');
    mainAudioTrack.loop = true;
    mainAudioTrack.preload = 'auto';
    mainAudioTrack.volume = state.soundEnabled ? state.volume : 0;
  }

  function playMainSoundtrack() {
    if (!mainAudioTrack) initMainSoundtrack();
    if (!state.soundEnabled) {
      pauseMainSoundtrack();
      return;
    }
    mainAudioTrack.volume = state.volume;
    if (mainAudioTrack.paused) {
      mainAudioTrack.play().catch(() => {});
    }
  }

  function pauseMainSoundtrack() {
    if (mainAudioTrack) {
      mainAudioTrack.pause();
    }
  }

  function updateSceneAudioByProgress(progress) {
    if (!state.soundEnabled) {
      pauseMainSoundtrack();
      return;
    }
    playMainSoundtrack();
  }

  // Swells whichever theme is currently active to a new level — the film's
  // act-by-act scoring tool. `state.musicLevel` is remembered so a theme
  // change (above) knows what level to fade the incoming layer up to.
  function setMusicLevel(level, secs = 3) {
    state.musicLevel = level;
    if (!audioCtx || !state.soundEnabled) return;
    const active = state.audioTheme === 'romantic' ? romanticNodes : searchNodes;
    if (!active) return;
    active.gain.gain.cancelScheduledValues(audioCtx.currentTime);
    active.gain.gain.setValueAtTime(active.gain.gain.value, audioCtx.currentTime);
    active.gain.gain.linearRampToValueAtTime(level, audioCtx.currentTime + secs);
  }

  const hornCooldown = { mohit: 0, sezal: 0, meet: 0, meet2: 0 };

  function playTone(freq, { duration = 0.3, type = 'sine', peak = 0.18, delay = 0 } = {}) {
    if (!state.soundEnabled || !audioCtx) return;
    const t0 = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  function playRadarPing() { playTone(1200, { duration: 0.12, peak: 0.08 }); }
  function playTargetLock() {
    playTone(660, { duration: 0.18, peak: 0.15 });
    playTone(880, { duration: 0.24, peak: 0.13, delay: 0.12 });
  }

  // 1st Ship Found: Jolly 4-note fanfare chime (C5 -> E5 -> G5 -> C6)
  function playJollyChime({ delay = 0, voice = 'mohit' } = {}) {
    if (!state.soundEnabled || !audioCtx) return;
    const now = audioCtx.currentTime;
    if (now + delay < hornCooldown[voice]) return;
    const t0 = now + delay;
    hornCooldown[voice] = t0 + 0.8;

    const notes = [523.25, 659.25, 784.00, 1046.50];
    notes.forEach((freq, idx) => {
      const noteT = t0 + idx * 0.12;
      const osc = audioCtx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, noteT);

      const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 2400;

      const g = audioCtx.createGain();
      g.gain.setValueAtTime(0, noteT);
      g.gain.linearRampToValueAtTime(0.18, noteT + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, noteT + 0.35);

      osc.connect(filter);
      filter.connect(g);
      g.connect(masterGain);

      osc.start(noteT);
      osc.stop(noteT + 0.4);
    });
  }

  function playShipHorn({ freq = 104, long = false, delay = 0, voice = 'mohit' } = {}) {
    playJollyChime({ delay, voice });
  }

  // 2nd Ship Found: Road Runner cartoon double-chirp beep-beep
  function playBeepBeep({ delay = 0, voice = 'sezal' } = {}) {
    if (!state.soundEnabled || !audioCtx) return;
    const now = audioCtx.currentTime;
    if (now + delay < hornCooldown[voice]) return;
    const t0 = now + delay;
    hornCooldown[voice] = t0 + 0.45;

    [0, 0.16].forEach((offset) => {
      const beepT = t0 + offset;
      const osc = audioCtx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(1050, beepT);
      osc.frequency.exponentialRampToValueAtTime(1350, beepT + 0.08);

      const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 3400;

      const g = audioCtx.createGain();
      g.gain.setValueAtTime(0, beepT);
      g.gain.linearRampToValueAtTime(0.16, beepT + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0005, beepT + 0.11);

      osc.connect(filter);
      filter.connect(g);
      g.connect(masterGain);

      osc.start(beepT);
      osc.stop(beepT + 0.13);
    });
  }

  function playCelebration(delay = 0) {
    [523.25, 659.25, 784.0, 1046.5].forEach((f, i) => // C5 E5 G5 C6
      playTone(f, { duration: 0.55, peak: 0.13, delay: delay + i * 0.12 })
    );
  }

  function initAudio(withSound) {
    state.soundEnabled = withSound;
    if (!withSound) return;
    setupAudioContext();
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    startOceanAmbience();
    startSearchTheme();
    startRomanticTheme();
    // both themes start silent; put the active one at its resting level
    (state.audioTheme === 'romantic' ? romanticNodes : searchNodes).gain.gain
      .linearRampToValueAtTime(state.musicLevel, audioCtx.currentTime + 4);
  }

  function toggleMute() {
    state.soundEnabled = !state.soundEnabled;
    const btn = $('#muteToggle');
    if (btn) {
      btn.setAttribute('aria-pressed', String(state.soundEnabled));
      btn.setAttribute('aria-label', state.soundEnabled ? 'Turn sound off' : 'Turn sound on');
      btn.classList.toggle('is-muted', !state.soundEnabled);
    }
    setupAudioContext();
    if (masterGain && audioCtx) {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      masterGain.gain.setValueAtTime(state.soundEnabled ? state.volume : 0, audioCtx.currentTime);
    }

    if (!state.soundEnabled) {
      pauseMainSoundtrack();
    } else {
      playMainSoundtrack();
    }
  }

  /* ------------------------------------------------------------------------
     6. PHOTOS — gallery auto-discovery, lightbox, island popups
     ------------------------------------------------------------------------ */
  const galleryGrid = $('#galleryGrid');
  const galleryEmptyNote = $('#galleryEmptyNote');
  let galleryPhotos = [];
  const harborPhotoCache = new Map(); // probing 404s once is enough

  function probeImage(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
  }

  async function discoverPhotos() {
    const { extensions, maxIndex, maxConsecutiveMisses } = CONFIG.galleryProbe;
    const found = [];
    let consecutiveMisses = 0;
    const dirsToProbe = ['./', 'photos/', 'assets/photos/', 'assets/'];

    for (let i = 1; i <= maxIndex; i++) {
      let hitUrl = null;
      for (const dir of dirsToProbe) {
        // eslint-disable-next-line no-await-in-loop
        const results = await Promise.all(extensions.map((ext) => probeImage(`${dir}${i}.${ext}`)));
        const hitIdx = results.indexOf(true);
        if (hitIdx > -1) {
          hitUrl = `${dir}${i}.${extensions[hitIdx]}`;
          break;
        }
      }
      if (hitUrl) {
        found.push(hitUrl);
        consecutiveMisses = 0;
      } else {
        consecutiveMisses++;
      }

      if (consecutiveMisses >= maxConsecutiveMisses && (found.length > 0 || i >= 8)) break;
    }
    return found;
  }

  async function discoverHarborPhotos(index) {
    if (harborPhotoCache.has(index)) return harborPhotoCache.get(index);
    const exts = CONFIG.galleryProbe.extensions;
    const found = [];
    const basePaths = [
      './',
      'harbors/',
      'assets/harbors/',
      'assets/photos/harbors/',
      'assets/photos/',
      'assets/'
    ];

    for (let n = 1; n <= 6; n++) {
      let foundPath = null;
      for (const basePath of basePaths) {
        // eslint-disable-next-line no-await-in-loop
        const results = await Promise.all(exts.map((ext) => probeImage(`${basePath}${index}-${n}.${ext}`)));
        const hitIdx = results.indexOf(true);
        if (hitIdx > -1) {
          foundPath = `${basePath}${index}-${n}.${exts[hitIdx]}`;
          break;
        }
      }
      if (!foundPath) break;
      found.push(foundPath);
    }
    harborPhotoCache.set(index, found);
    return found;
  }

  async function initGallery() {
    const photos = await discoverPhotos();
    galleryPhotos = photos.map((url, i) => ({ url, alt: `${CONFIG.names.first} and ${CONFIG.names.second} — photo ${i + 1}` }));

    if (!photos.length) { galleryEmptyNote.hidden = false; return; }
    galleryEmptyNote.hidden = true;

    photos.forEach((url, i) => {
      const card = document.createElement('div');
      card.className = 'gallery-card';
      card.setAttribute('role', 'listitem');
      card.tabIndex = 0;
      card.setAttribute('aria-label', `Open photo ${i + 1} of ${photos.length}`);

      const img = document.createElement('img');
      img.src = url;
      img.loading = 'lazy';
      img.alt = galleryPhotos[i].alt;
      img.addEventListener('load', () => img.classList.add('loaded'));

      const glow = document.createElement('div');
      glow.className = 'gallery-card-glow';

      card.append(img, glow);
      card.addEventListener('click', () => openLightboxFrom(galleryPhotos, i));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightboxFrom(galleryPhotos, i); }
      });
      galleryGrid.appendChild(card);

      gsap.to(card, {
        opacity: 1, y: 0, duration: 0.8, delay: (i % 6) * 0.06, ease: 'power3.out',
        scrollTrigger: { trigger: card, start: 'top 90%', toggleActions: 'play none none reverse' }
      });
    });

    // subtle mouse parallax across the whole grid (quickTo avoids building a
    // fresh tween on every single mousemove event)
    const parX = gsap.quickTo(galleryGrid, 'x', { duration: 1.2, ease: 'power2.out' });
    const parY = gsap.quickTo(galleryGrid, 'y', { duration: 1.2, ease: 'power2.out' });
    window.addEventListener('mousemove', (e) => {
      if (state.reducedMotion || state.filmMode) return;
      parX((e.clientX / window.innerWidth - 0.5) * 6);
      parY((e.clientY / window.innerHeight - 0.5) * 6);
    }, { passive: true });
  }

  /* ---- lightbox ---- */
  const lightbox = $('#lightbox');
  const lightboxImg = $('#lightboxImg');
  const lightboxCounter = $('#lightboxCounter');
  let lightboxIndex = 0;
  let activePhotos = [];
  let touchStartX = null;
  let lastFocused = null;

  function initLightbox() {
    $('#lightboxClose').addEventListener('click', closeLightbox);
    $('#lightboxPrev').addEventListener('click', () => showLightbox(lightboxIndex - 1));
    $('#lightboxNext').addEventListener('click', () => showLightbox(lightboxIndex + 1));
    lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });

    document.addEventListener('keydown', (e) => {
      if (lightbox.hidden) return;
      if (e.key === 'Escape') { e.stopPropagation(); closeLightbox(); }
      if (e.key === 'ArrowLeft') showLightbox(lightboxIndex - 1);
      if (e.key === 'ArrowRight') showLightbox(lightboxIndex + 1);
    }, true);

    lightbox.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
    lightbox.addEventListener('touchend', (e) => {
      if (touchStartX === null) return;
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dx) > 50) showLightbox(lightboxIndex + (dx < 0 ? 1 : -1));
      touchStartX = null;
    }, { passive: true });
  }

  function openLightboxFrom(photosArray, index) {
    lastFocused = document.activeElement;
    activePhotos = photosArray;
    lightbox.hidden = false;
    requestAnimationFrame(() => lightbox.classList.add('open'));
    showLightbox(index);
    $('#lightboxClose').focus();
  }

  function showLightbox(index) {
    if (!activePhotos.length) return;
    lightboxIndex = (index + activePhotos.length) % activePhotos.length;
    lightboxImg.src = activePhotos[lightboxIndex].url;
    lightboxImg.alt = activePhotos[lightboxIndex].alt || `Photo ${lightboxIndex + 1}`;
    lightboxCounter.textContent = `${lightboxIndex + 1} / ${activePhotos.length}`;
  }

  function closeLightbox() {
    lightbox.classList.remove('open');
    setTimeout(() => {
      lightbox.hidden = true;
      lightboxImg.removeAttribute('src');
      if (lastFocused && lastFocused.isConnected) lastFocused.focus();
    }, 400);
  }

  /* ---- island popup ---- */
  const islandModal = $('#islandModal');
  let islandLastFocused = null;

  function initIslandModal() {
    $('#islandModalClose').addEventListener('click', closeIslandPopup);
    islandModal.addEventListener('click', (e) => { if (e.target === islandModal) closeIslandPopup(); });
    document.addEventListener('keydown', (e) => {
      if (!islandModal.hidden && lightbox.hidden && e.key === 'Escape') closeIslandPopup();
    });
  }

  // Each harbor scene grows its own small photo set the moment it scrolls into
  // view — no button, no click. Real photos are used if assets/photos/harbors/
  // has them; otherwise the same on-brand placeholders used in the island
  // popup, so the layout never looks unfinished while photos are pending.
  async function initHarborPhotosInline() {
    const sections = $$('.scene-harbor');
    await Promise.all(sections.map(async (sceneEl) => {
      const idx = Number(sceneEl.getAttribute('data-island')) + 1;
      const container = sceneEl.querySelector('[data-harbor-photos-inline]');
      if (!container) return;

      const harbor = CONFIG.harbors[idx - 1];
      const realPhotos = await discoverHarborPhotos(idx);
      const usingPlaceholders = realPhotos.length === 0;
      const urls = (usingPlaceholders
        ? [0, 1, 2].map((v) => generatePlaceholderPhoto(idx, v))
        : realPhotos
      ).slice(0, 3);

      const photosForLightbox = urls.map((url, i) => ({
        url, alt: `${harbor ? harbor.name : 'A small harbor'} — photo ${i + 1}`
      }));

      urls.forEach((url, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'harbor-photo-wrap';
        const fig = document.createElement('div');
        fig.className = 'harbor-photo';
        fig.tabIndex = 0;
        fig.setAttribute('role', 'button');
        fig.setAttribute('aria-label', `View photo ${i + 1} from ${harbor ? harbor.name : 'this harbor'}`);
        const img = document.createElement('img');
        img.src = url;
        img.loading = 'lazy';
        img.alt = photosForLightbox[i].alt;
        fig.appendChild(img);
        fig.addEventListener('click', () => openLightboxFrom(photosForLightbox, i));
        fig.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightboxFrom(photosForLightbox, i); }
        });
        wrap.appendChild(fig);
        container.appendChild(wrap);
      });

      // One scrubbed timeline covers the whole arc: float into view, hold
      // while the scene is on screen, drift away as the reader scrolls on.
      // Because it's scrubbed rather than triggered, scrolling back up
      // reverses it exactly — the photos never "pop" in either direction.
      const wraps = container.querySelectorAll('.harbor-photo-wrap');
      if (!wraps.length) return;
      gsap.timeline({
        scrollTrigger: { trigger: sceneEl, start: 'top 78%', end: 'bottom 20%', scrub: 0.5 }
      })
        .fromTo(wraps, { opacity: 0, y: 36, scale: 0.92 },
          { opacity: 1, y: 0, scale: 1, duration: 0.32, stagger: 0.06, ease: 'power2.out' })
        .to(wraps, { opacity: 1, duration: 0.4 })
        .to(wraps, { opacity: 0, y: -30, duration: 0.28, stagger: 0.04, ease: 'power2.in' });
    }));
  }

  // Generates a soft, on-brand placeholder card entirely in code — used only
  // until real photos are added, and never presented as anything else.
  function generatePlaceholderPhoto(harborIndex, variant) {
    const canvas = document.createElement('canvas');
    canvas.width = 480; canvas.height = 360;
    const ctx = canvas.getContext('2d');
    const hue = [32, 350, 18, 45][(harborIndex - 1) % 4] + variant * 10;

    const grad = ctx.createLinearGradient(0, 0, 480, 360);
    grad.addColorStop(0, `hsl(${hue}, 28%, 16%)`);
    grad.addColorStop(1, `hsl(${hue + 18}, 40%, 30%)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 480, 360);

    ctx.strokeStyle = 'rgba(233,206,154,0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = 0; x <= 480; x += 6) {
      const y = 250 + Math.sin((x / 480) * Math.PI * 4 + variant) * 14;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.fillStyle = 'rgba(233,206,154,0.8)';
    ctx.beginPath();
    ctx.moveTo(200, 235); ctx.lineTo(280, 235); ctx.lineTo(268, 255); ctx.lineTo(212, 255);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(240, 235); ctx.lineTo(240, 195); ctx.lineTo(264, 225);
    ctx.closePath(); ctx.fill();

    ctx.font = '600 18px "Space Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('placeholder photo', 240, 40);

    return canvas.toDataURL('image/png');
  }

  async function openIslandPopup(harborIndex, dateLabel) {
    if (!harborIndex) return;
    const harbor = CONFIG.harbors[harborIndex - 1];
    const harborName = harbor ? harbor.name : 'A small harbor';

    islandLastFocused = document.activeElement;
    $('#islandModalDate').textContent = dateLabel || (harbor && harbor.date) || '';
    $('#islandModalTitle').textContent = harborName;
    const grid = $('#islandModalGrid');
    const note = $('#islandModalNote');
    grid.innerHTML = '';
    note.textContent = '';

    islandModal.hidden = false;
    requestAnimationFrame(() => islandModal.classList.add('open'));
    $('#islandModalClose').focus();

    const realPhotos = await discoverHarborPhotos(harborIndex);
    const usingPlaceholders = realPhotos.length === 0;
    const urls = usingPlaceholders
      ? [0, 1, 2].map((v) => generatePlaceholderPhoto(harborIndex, v))
      : realPhotos;

    const photosForLightbox = urls.map((url, i) => ({ url, alt: `${harborName} — photo ${i + 1}` }));

    urls.forEach((url, i) => {
      const thumb = document.createElement('div');
      thumb.className = 'island-modal-thumb';
      thumb.tabIndex = 0;
      thumb.setAttribute('role', 'button');
      thumb.setAttribute('aria-label', `View photo ${i + 1}`);
      const img = document.createElement('img');
      img.src = url;
      img.loading = 'lazy';
      img.alt = photosForLightbox[i].alt;
      thumb.appendChild(img);
      thumb.addEventListener('click', () => openLightboxFrom(photosForLightbox, i));
      thumb.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightboxFrom(photosForLightbox, i); }
      });
      grid.appendChild(thumb);
    });

    if (usingPlaceholders) {
      note.textContent = `These are placeholders. Drop real photos into assets/photos/harbors/ named ${harborIndex}-1.jpg, ${harborIndex}-2.jpg and so on to replace them.`;
    }
  }

  function closeIslandPopup() {
    islandModal.classList.remove('open');
    setTimeout(() => {
      islandModal.hidden = true;
      if (islandLastFocused && islandLastFocused.isConnected) islandLastFocused.focus();
    }, 400);
  }

  /* ------------------------------------------------------------------------
     7. SHIP'S LOG + KEEPSAKES
     ------------------------------------------------------------------------ */
  function initShipsLog() {
    const timelineEl = $('#timeline');
    if (!timelineEl || !CONFIG.milestones.length) return;
    CONFIG.milestones.forEach((m) => {
      const li = document.createElement('li');
      li.className = 'timeline-item' + (/roka/i.test(m.label) ? ' is-roka' : '');

      const date = document.createElement('span');
      date.className = 'timeline-date';
      date.textContent = m.date;

      const label = document.createElement('span');
      label.className = 'timeline-label';
      label.textContent = m.label;

      li.append(date, label);
      timelineEl.appendChild(li);

      gsap.to(li, {
        opacity: 1, y: 0, duration: 0.8, ease: 'power3.out',
        scrollTrigger: { trigger: li, start: 'top 88%', toggleActions: 'play none none reverse' }
      });
    });
  }

  // For each harbor scene, drift the little gem between the two ship glyphs
  // into the chest, and fill the chest once it arrives.
  function initKeepsakes() {
    gsap.utils.toArray('.keepsake-row').forEach((row) => {
      const track = row.querySelector('.keepsake-track');
      const gem = row.querySelector('.keepsake-gem');
      const chest = row.querySelector('.keepsake-chest');
      if (!track || !gem || !chest) return;

      gsap.timeline({ scrollTrigger: { trigger: row, start: 'top 80%', toggleActions: 'play none none reverse' } })
        .to(row, { opacity: 1, duration: 0.6, ease: 'power2.out' })
        .to(gem, { x: () => track.offsetWidth - 14, duration: 1.1, ease: 'power2.inOut' }, '+=0.2')
        .to(gem, { opacity: 0, duration: 0.3 }, '-=0.1')
        .to(chest, { duration: 0.3, onStart: () => chest.classList.add('is-filled'), onReverseComplete: () => chest.classList.remove('is-filled') }, '-=0.2')
        .fromTo(chest, { scale: 1 }, { scale: 1.12, duration: 0.2, yoyo: true, repeat: 1, ease: 'power1.inOut' }, '-=0.2');
    });

    const finalGems = gsap.utils.toArray('.gem-dot');
    if (finalGems.length) {
      gsap.to(finalGems, {
        opacity: 1, scale: 1, duration: 0.5, stagger: 0.15, ease: 'back.out(2)',
        scrollTrigger: { trigger: '.chest-final', start: 'top 80%', toggleActions: 'play none none reverse' }
      });
    }
  }

  /* ========================================================================
     8. THE FILM

     The same 3D world, cut into thirteen shots over 1:52. A single paused
     GSAP timeline is the projector: it tweens a camera proxy, the ships, the
     sky dial and the caption opacities, and everything discrete (radar state,
     ship lights, the burst) is derived from tl.time() on each frame. That is
     what makes the whole film scrub cleanly in both directions instead of
     falling apart the moment someone drags the playhead backwards.
     ======================================================================== */
  const FILM_DURATION = 112; // 1:52

  const film = {
    tl: null,
    cam: { px: 0, py: 14, pz: 60, lx: 0, ly: 0, lz: 0 },
    sky: { dawn: 0 },
    path: { seg: 0 },
    seeking: false,
    idleTimer: null,
    musicLevel: null,
    built: false
  };

  // Ports along the chart rule — the film's chapter marks.
  const FILM_CHAPTERS = [
    { t: 0, label: 'Overture' },
    { t: 14, label: 'The fleet' },
    { t: 21, label: 'The search' },
    { t: 28, label: CONFIG.names.first },
    { t: 36, label: CONFIG.names.second },
    { t: 44, label: 'The lock' },
    { t: 51, label: 'The approach' },
    { t: 61, label: 'The meeting' },
    { t: 68, label: 'The line' },
    { t: 77, label: 'Our Roka' },
    { t: 86, label: 'Small harbors' },
    { t: 96, label: 'The horizon' },
    { t: 106, label: 'Fin' }
  ];

  const cinema = $('#cinema');
  const captionsEl = $('#cinemaCaptions');
  const chartEl = $('#transportChart');
  const chartShip = $('#chartShip');
  const chartSailed = $('#chartSailed');
  const chartPorts = $('#chartPorts');
  const playIcon = $('#filmPlayIcon');
  const timeEl = $('#filmTime');

  const fmtTime = (s) => {
    const m = Math.floor(Math.max(0, s) / 60);
    const r = Math.floor(Math.max(0, s) % 60);
    return `${m}:${String(r).padStart(2, '0')}`;
  };

  function buildFilm() {
    if (film.built) return;
    film.built = true;

    $('#filmDur').textContent = fmtTime(FILM_DURATION);

    const tl = gsap.timeline({
      paused: true,
      onUpdate: renderFilmFrame,
      onComplete: onFilmComplete
    });
    film.tl = tl;

    /* ---- shot helpers ---- */
    // A cut: the camera is somewhere new on the very next frame.
    const cut = (at, pos, look) => tl.set(film.cam, {
      px: pos[0], py: pos[1], pz: pos[2], lx: look[0], ly: look[1], lz: look[2]
    }, at);
    // A move: the camera drifts within the shot.
    const move = (at, dur, pos, look, ease = 'power1.inOut') => tl.to(film.cam, {
      px: pos[0], py: pos[1], pz: pos[2], lx: look[0], ly: look[1], lz: look[2],
      duration: dur, ease
    }, at);

    /* ---- captions ----
       Pre-rendered, then faded by the timeline itself, so dragging the
       playhead backwards puts the words back exactly where they were. */
    const cue = (at, dur, kind, html) => {
      const el = document.createElement('div');
      el.className = `cue cue-${kind}`;
      el.innerHTML = html;
      captionsEl.appendChild(el);
      const rise = kind === 'sub' ? 14 : 22;
      tl.fromTo(el,
        { opacity: 0, y: rise },
        { opacity: 1, y: 0, duration: 1.2, ease: 'power2.out' }, at);
      tl.to(el, { opacity: 0, y: -rise * 0.6, duration: 0.9, ease: 'power2.in' }, at + dur);
      return el;
    };

    const NAME_1 = CONFIG.names.first.toUpperCase();
    const NAME_2 = CONFIG.names.second.toUpperCase();

    /* ================= ACT I — THE OCEAN ================= */

    // 1. Overture — stars, a horizon, nothing yet
    cut(0, [0, 14, 62], [0, 0, 0]);
    move(0, 14, [0, 12, 46], [0, 0, -2], 'sine.inOut');
    cue(1, 4.6, 'title',
      '<p class="cue-eyebrow">A story for two</p><p class="cue-main">Two Ships in an<br/>Infinite Ocean</p>');
    cue(7.5, 5, 'sub', 'An ocean, at night.');

    // 2. The fleet — down at the waterline, lights streaming past
    cut(14, [0, 7, 26], [0, -1, -6]);
    move(14, 7, [0, 5.5, 16], [0, -1, -8]);
    cue(15.2, 4.6, 'sub', 'Hundreds of quiet lights.<br/>Each one a soul in motion, searching for somewhere to belong.');

    // 3. The search — rise, and the instrument wakes up
    cut(21, [0, 17, 27], [0, 0, -4]);
    move(21, 7, [0, 20, 21], [0, 0, -6]);
    cue(22.2, 4.6, 'sub', 'Sweep after sweep, a pulse reaches through the dark.');

    /* ================= ACT II — THE FINDING ================= */

    // 4. Mohit
    cut(28, [-31, 7, -5], [START_M.x, -1, START_M.z]);
    move(28, 8, [-17, 4.5, -8], [START_M.x, -0.8, START_M.z]);
    cue(29.2, 5.2, 'name', `<p class="cue-eyebrow">Contact</p><p class="cue-main">${NAME_1}</p>`);

    // 5. Sezal
    cut(36, [35, 7, 17], [START_S.x, -1, START_S.z]);
    move(36, 8, [19, 4.5, 14], [START_S.x, -0.8, START_S.z]);
    cue(37.2, 5.2, 'name', `<p class="cue-eyebrow">Contact</p><p class="cue-main">${NAME_2}</p>`);

    // 6. The lock — pull wide, the rest of the ocean goes quiet
    cut(44, [0, 22, 38], [1, -1, -1]);
    move(44, 7, [0, 17, 31], [0, -1, -1]);
    cue(45.2, 4.6, 'sub', 'The rest of the world fades into quiet silence.<br/>Only Mohit &amp; Sezal remain.');

    // 7. The approach — the only long, unbroken shot in the film
    cut(51, [0, 11, 24], [0, -1, 0]);
    move(51, 10, [0, 6.5, 13], [0, -1, 0], 'sine.inOut');
    cue(52.4, 6, 'sub', 'Two ships turn toward each other across the sea,<br/>neither one ever looking back.');

    /* ================= ACT III — WHAT CAME AFTER ================= */

    // 8. The meeting
    cut(61, [0, 4, 9.5], [0, -0.6, 0]);
    move(61, 7, [0, 3.2, 7], [0, -0.6, 0], 'sine.out');
    cue(62.4, 4.2, 'sub', 'Destination reached.');

    // 9. The line
    move(68, 9, [0, 4.4, 10.5], [0, -0.5, -3], 'sine.inOut');
    cue(69, 7, 'quote',
      '<p class="cue-main">In an ocean of millions of journeys,<br/><em>two hearts discovered their forever home.</em></p>');

    // 10. Our Roka — and the night finally turns
    move(77, 9, [0, 3.4, 6], [0, -0.4, -1], 'sine.inOut');
    tl.to(film.sky, { dawn: 1, duration: 19, ease: 'sine.inOut' }, 74);
    cue(78, 7, 'roka',
      `<p class="cue-eyebrow">Bound by love, united forever</p><p class="cue-main">Our Roka</p><p class="cue-foot">${CONFIG.rokaDate}</p>`);

    // 11. Small harbors — the ships stop searching and start visiting
    // From here the harbour walker owns the camera, so the shot is expressed
    // as a distance along the path rather than as a camera keyframe.
    tl.fromTo(film.path, { seg: 0 }, { seg: 4.2, duration: 26, ease: 'none' }, 86);
    cue(87.4, 6, 'sub', 'Then: small harbors, one after another.');

    // 12. The horizon
    cue(97.4, 6, 'sub', 'This is only the beginning.');

    // 13. Fin — the camera lifts away; handled in renderFilmFrame's camera rise
    cue(106.5, 4.5, 'title',
      `<p class="cue-eyebrow">Fin</p><p class="cue-main">${CONFIG.names.first} &amp; ${CONFIG.names.second}</p>`);

    // Hold the timeline open to the full runtime even if the last tween ends early
    tl.to({}, { duration: 0.01 }, FILM_DURATION);

    buildTransport();
  }

  // Everything that is a state rather than a tween is derived from the
  // playhead, once per frame. Scrubbing therefore always lands on a coherent
  // frame instead of a half-applied one.
  function renderFilmFrame() {
    if (!state.filmMode) return;
    const T = film.tl.time();

    // camera
    cameraBase.pos = [film.cam.px, film.cam.py, film.cam.pz];
    cameraBase.look = [film.cam.lx, film.cam.ly, film.cam.lz];

    // sky
    applySky(film.sky.dawn);

    // ---- where the two ships are, derived from the playhead ----
    if (T >= 86) {
      // The harbour walker owns the camera here. The last twelve seconds lift
      // it up and back, so the film ends on a wide instead of a follow shot.
      const lift = clamp01((T - 100) / 12);
      sailPath(film.path.seg, { camDist: 17 + lift * 15, camHeight: 8.5 + lift * 13 });
      connectionLine.material.opacity = 0;
      if (goldenGlow.visible) { goldenGlow.visible = false; goldenGlow.material.opacity = 0; }
    } else if (T >= 51) {
      // the approach: a single eased run from open water to the meeting point
      const k = clamp01((T - 51) / 10);
      const e = 0.5 - Math.cos(Math.PI * k) / 2; // sine.inOut
      shipMohit.position.x = lerp(START_M.x, MEET_M.x, e);
      shipMohit.position.z = lerp(START_M.z, MEET_M.z, e);
      shipSezal.position.x = lerp(START_S.x, MEET_S.x, e);
      shipSezal.position.z = lerp(START_S.z, MEET_S.z, e);
      shipMohit.rotation.y = headingAngle(START_M.x, START_M.z, MEET_M.x, MEET_M.z);
      shipSezal.rotation.y = headingAngle(START_S.x, START_S.z, MEET_S.x, MEET_S.z);
    } else {
      shipMohit.position.x = START_M.x; shipMohit.position.z = START_M.z;
      shipSezal.position.x = START_S.x; shipSezal.position.z = START_S.z;
      shipMohit.rotation.y = headingAngle(START_M.x, START_M.z, MEET_M.x, MEET_M.z);
      shipSezal.rotation.y = headingAngle(START_S.x, START_S.z, MEET_S.x, MEET_S.z);
    }

    // the rest of the fleet dims once both are found
    anonymousShips.material.opacity = lerp(0.85, 0.06, clamp01((T - 44.5) / 5));

    // the instrument
    setRadarActive(T >= 20.5 && T < 67);
    const mohitOn = T >= 29.2;
    const sezalOn = T >= 37.2;
    const bothOn = T >= 44.5;
    const metOn = T >= 62.2;

    // Beautiful target circles stay glowing around the ships once detected
    setShipFound(shipMohit, ringMohit, mohitOn);
    setShipFound(shipSezal, ringSezal, sezalOn);
    setLockedBlip('mohit', mohitOn, -Math.PI * 0.75);
    setLockedBlip('sezal', sezalOn, Math.PI * 0.2);

    setRadarStatus(
      metOn ? 'TARGET FOUND'
        : bothOn ? 'TARGETS LOCKED'
          : sezalOn ? `CONTACT — ${CONFIG.names.second.toUpperCase()}`
            : mohitOn ? `CONTACT — ${CONFIG.names.first.toUpperCase()}`
              : 'SEARCHING',
      bothOn
    );

    if (bothOn && !metOn) {
      const meetTFilm = clamp01((T - 51) / 10);
      const fadeIn = clamp01((T - 44.5) / 1.5);
      const fadeOut = 1 - clamp01((meetTFilm - 0.5) / 0.5);
      connectionLine.material.opacity = fadeIn * fadeOut * 0.85;
    } else {
      connectionLine.material.opacity = 0;
    }

    applyMeetingBurst(clamp01((T - 62) / 3));

    // Scene audio transitions synchronized to film timeline
    updateSceneAudioByProgress(T / FILM_DURATION);

    // Score: the active theme lifts through the finding, peaks at the meeting,
    // settles after. Only re-ramped when the level actually changes — asking
    // for a new ramp every frame means no ramp ever finishes.
    const musicLevel = T < 20 ? 0.05 : T < 44 ? 0.07 : T < 62 ? 0.09 : T < 96 ? 0.11 : 0.06;
    if (musicLevel !== film.musicLevel && film.tl.isActive() && !film.seeking) {
      film.musicLevel = musicLevel;
      setMusicLevel(musicLevel, 4);
    }

    // 1st ship = Jolly chime, 2nd ship = Cartoon Road Runner Beep-Beep
    const playingForward = film.tl.isActive() && !film.seeking;
    filmMohitEdge(mohitOn, () => { if (playingForward) playJollyChime({ voice: 'mohit' }); });
    filmSezalEdge(sezalOn, () => { if (playingForward) playBeepBeep({ voice: 'sezal' }); });
    filmMeetEdge(metOn, () => {
      if (!playingForward) return;
      playJollyChime({ delay: 0.1, voice: 'meet' });
      playBeepBeep({ delay: 0.55, voice: 'meet2' });
      playCelebration(0.9);
    });

    updateTransport(T);
  }
  const filmMohitEdge = edge();
  const filmSezalEdge = edge();
  const filmMeetEdge = edge();

  /* ---- transport ---- */
  function buildTransport() {
    FILM_CHAPTERS.forEach((c) => {
      const port = document.createElement('div');
      port.className = 'port';
      port.dataset.t = String(c.t);
      const label = document.createElement('span');
      label.className = 'port-label';
      label.textContent = c.label;
      port.appendChild(label);
      chartPorts.appendChild(port);
    });
    layoutTransportPorts();

    $('#filmPlayPause').addEventListener('click', togglePlay);
    $('#cinemaExit').addEventListener('click', () => exitFilm());
    $('#filmReplay').addEventListener('click', () => { hideEndPlate(); startFilm(); });
    $('#filmToStory').addEventListener('click', () => exitFilm());

    // scrubbing
    let dragging = false;
    const seekFromEvent = (e) => {
      const rect = chartEl.getBoundingClientRect();
      const ratio = clamp01((e.clientX - rect.left) / rect.width);
      film.seeking = true;
      film.tl.time(ratio * FILM_DURATION);
      film.seeking = false;
    };
    chartEl.addEventListener('pointerdown', (e) => {
      dragging = true;
      chartEl.setPointerCapture(e.pointerId);
      seekFromEvent(e);
    });
    chartEl.addEventListener('pointermove', (e) => { if (dragging) seekFromEvent(e); });
    chartEl.addEventListener('pointerup', (e) => { dragging = false; chartEl.releasePointerCapture(e.pointerId); });
    chartEl.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 15 : 5;
      if (e.key === 'ArrowRight') { e.preventDefault(); seekBy(step); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); seekBy(-step); }
      if (e.key === 'Home') { e.preventDefault(); film.tl.time(0); }
      if (e.key === 'End') { e.preventDefault(); film.tl.time(FILM_DURATION - 0.1); }
    });

    // keyboard, whole-film
    document.addEventListener('keydown', (e) => {
      if (!state.filmMode || !lightbox.hidden) return;
      if (e.key === ' ' && e.target === document.body) { e.preventDefault(); togglePlay(); }
      if (e.key === 'Escape') exitFilm();
      if (e.target === chartEl) return; // the chart handles its own arrows
      if (e.key === 'ArrowRight') { e.preventDefault(); seekBy(5); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); seekBy(-5); }
    });

    // the transport fades out while the film is playing and nobody is pointing at it
    ['pointermove', 'pointerdown'].forEach((evt) => {
      window.addEventListener(evt, () => {
        if (!state.filmMode) return;
        cinema.classList.remove('idle');
        clearTimeout(film.idleTimer);
        film.idleTimer = setTimeout(() => {
          if (state.filmMode && film.tl && !film.tl.paused()) cinema.classList.add('idle');
        }, 2600);
      }, { passive: true });
    });
  }

  function layoutTransportPorts() {
    Array.from(chartPorts.children).forEach((port) => {
      port.style.left = `${(Number(port.dataset.t) / FILM_DURATION) * 100}%`;
    });
  }

  function seekBy(delta) {
    film.seeking = true;
    film.tl.time(clamp(film.tl.time() + delta, 0, FILM_DURATION - 0.05));
    film.seeking = false;
  }

  function updateTransport(T) {
    const ratio = clamp01(T / FILM_DURATION);
    chartSailed.style.width = `${ratio * 100}%`;
    chartShip.style.left = `${ratio * 100}%`;
    timeEl.textContent = fmtTime(T);
    chartEl.setAttribute('aria-valuenow', String(Math.round(T)));
    chartEl.setAttribute('aria-valuetext', `${fmtTime(T)} of ${fmtTime(FILM_DURATION)}`);
    Array.from(chartPorts.children).forEach((port) => {
      port.classList.toggle('passed', T >= Number(port.dataset.t));
    });
  }

  function togglePlay() {
    if (!film.tl) return;
    if (film.tl.paused()) {
      if (film.tl.time() >= FILM_DURATION - 0.06) film.tl.time(0);
      hideEndPlate();
      film.tl.play();
      playIcon.textContent = '❚❚';
      $('#filmPlayPause').setAttribute('aria-label', 'Pause film');
    } else {
      film.tl.pause();
      cinema.classList.remove('idle');
      playIcon.textContent = '▶';
      $('#filmPlayPause').setAttribute('aria-label', 'Play film');
    }
  }

  function enterFilm() {
    if (!film.tl) buildFilm();
    state.filmMode = true;
    document.body.classList.add('cinema-open');
    $('#story').hidden = true;
    cinema.hidden = false;
    hideEndPlate();

    // the scroll story must not fight the projector for the camera
    if (window.ScrollTrigger) ScrollTrigger.getAll().forEach((t) => t.disable());

    requestAnimationFrame(() => cinema.classList.add('rolling'));
    startFilm();
  }

  function startFilm() {
    resetSceneState();
    film.cam = Object.assign(film.cam, { px: 0, py: 14, pz: 62, lx: 0, ly: 0, lz: 0 });
    film.sky.dawn = 0;
    film.path.seg = 0;
    anonymousShips.material.opacity = 0.85;
    film.musicLevel = null;
    film.tl.pause(0);
    renderFilmFrame();
    film.tl.play();
    playIcon.textContent = '❚❚';
    setMusicLevel(0.05, 2);
  }

  function onFilmComplete() {
    cinema.classList.remove('idle');
    playIcon.textContent = '▶';
    const end = $('#cinemaEnd');
    end.hidden = false;
    requestAnimationFrame(() => end.classList.add('visible'));
    $('#filmReplay').focus();
    setMusicLevel(0.04, 5);
  }

  function hideEndPlate() {
    const end = $('#cinemaEnd');
    end.classList.remove('visible');
    end.hidden = true;
  }

  function exitFilm({ silent = false } = {}) {
    if (film.tl) film.tl.pause();
    state.filmMode = false;
    cinema.classList.remove('rolling', 'idle');
    hideEndPlate();
    document.body.classList.remove('cinema-open');
    $('#story').hidden = false;

    setTimeout(() => { if (!state.filmMode) cinema.hidden = true; }, silent ? 0 : 700);

    if (window.ScrollTrigger) {
      ScrollTrigger.getAll().forEach((t) => t.enable());
      ScrollTrigger.refresh();
    }

    if (!silent) {
      resetSceneState();
      window.scrollTo({ top: 0, behavior: 'auto' });
      if (window.ScrollTrigger) ScrollTrigger.refresh();
    }
    setMusicLevel(0.05, 3);
  }

  /* ------------------------------------------------------------------------
     9. AUTO-WATCH ENGINE & AUDIO CONTROLS
     ------------------------------------------------------------------------ */
  const autoWatchState = {
    active: false,
    paused: false,
    speed: 1.0,
    speeds: [0.75, 1.0, 1.5, 2.0],
    speedIndex: 1,
    raf: null,
    lastTime: 0
  };

  function initAutoWatchUI() {
    const playPauseBtn = $('#awPlayPauseBtn');
    const speedBtn = $('#awSpeedBtn');
    const closeBtn = $('#awCloseBtn');

    if (playPauseBtn) playPauseBtn.addEventListener('click', toggleAutoWatchPause);
    if (speedBtn) speedBtn.addEventListener('click', cycleAutoWatchSpeed);
    if (closeBtn) closeBtn.addEventListener('click', stopAutoWatch);

    const pauseOnInteraction = () => {
      if (autoWatchState.active && !autoWatchState.paused) {
        pauseAutoWatch();
      }
    };
    window.addEventListener('wheel', pauseOnInteraction, { passive: true });
    window.addEventListener('touchmove', pauseOnInteraction, { passive: true });
  }

  function startAutoWatch() {
    autoWatchState.active = true;
    autoWatchState.paused = false;
    autoWatchState.lastTime = performance.now();
    const widget = $('#autoWatchWidget');
    if (widget) widget.hidden = false;
    updateAutoWatchUI();
    if (autoWatchState.raf) cancelAnimationFrame(autoWatchState.raf);
    autoWatchTick();
  }

  function pauseAutoWatch() {
    autoWatchState.paused = true;
    updateAutoWatchUI();
  }

  function resumeAutoWatch() {
    autoWatchState.paused = false;
    autoWatchState.lastTime = performance.now();
    updateAutoWatchUI();
    autoWatchTick();
  }

  function toggleAutoWatchPause() {
    if (autoWatchState.paused) resumeAutoWatch();
    else pauseAutoWatch();
  }

  function cycleAutoWatchSpeed() {
    autoWatchState.speedIndex = (autoWatchState.speedIndex + 1) % autoWatchState.speeds.length;
    autoWatchState.speed = autoWatchState.speeds[autoWatchState.speedIndex];
    const btn = $('#awSpeedBtn');
    if (btn) btn.textContent = `${autoWatchState.speed.toFixed(1)}x`;
  }

  function stopAutoWatch() {
    autoWatchState.active = false;
    autoWatchState.paused = false;
    if (autoWatchState.raf) cancelAnimationFrame(autoWatchState.raf);
    const widget = $('#autoWatchWidget');
    if (widget) widget.hidden = true;
  }

  function updateAutoWatchUI() {
    const icon = $('#awIcon');
    if (icon) icon.textContent = autoWatchState.paused ? '▶' : '❚❚';
    const btn = $('#awPlayPauseBtn');
    if (btn) btn.setAttribute('aria-label', autoWatchState.paused ? 'Resume Auto-Watch' : 'Pause Auto-Watch');
  }

  function autoWatchTick() {
    if (!autoWatchState.active) return;
    const now = performance.now();
    const dt = (now - autoWatchState.lastTime) / 1000;
    autoWatchState.lastTime = now;

    if (!autoWatchState.paused && !state.filmMode) {
      const pixelsPerSec = 85 * autoWatchState.speed;
      window.scrollBy(0, pixelsPerSec * dt);

      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const progress = Math.min(100, Math.max(0, (window.scrollY / (maxScroll || 1)) * 100));
      const fill = $('#awProgressFill');
      if (fill) fill.style.width = `${progress}%`;

      if (window.scrollY >= maxScroll - 5) {
        stopAutoWatch();
        return;
      }
    }

    autoWatchState.raf = requestAnimationFrame(autoWatchTick);
  }

  let audioPanelHoverTimer = null;

  function initAudioControls() {
    const muteBtn = $('#muteToggle');
    const panel = $('#audioPanel');
    const slider = $('#volumeSlider');
    const valText = $('#volumeVal');
    const widget = $('#audioControlWidget');
    const trackSelect = $('#musicTrackSelect');
    const mp3Input = $('#mp3FileInput');

    if (widget) widget.hidden = false;

    // Mute Button: Clicking toggles mute/unmute for all audio
    if (muteBtn) {
      muteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMute();
      });
    }

    // Hover mouseenter/mouseleave to show/hide volume slider & track selection panel
    if (widget && panel) {
      widget.addEventListener('mouseenter', () => {
        if (audioPanelHoverTimer) clearTimeout(audioPanelHoverTimer);
        panel.hidden = false;
      });
      widget.addEventListener('mouseleave', () => {
        audioPanelHoverTimer = setTimeout(() => {
          panel.hidden = true;
        }, 650);
      });
    }

    initMainSoundtrack();

    const changeBtn = $('#changeSongBtn');
    const sceneFileInput = $('#sceneAudioFileInput');

    if (changeBtn && sceneFileInput) {
      changeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sceneFileInput.click();
      });

      sceneFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          if (mainAudioTrack) mainAudioTrack.pause();
          mainAudioTrack = new Audio(URL.createObjectURL(file));
          mainAudioTrack.loop = true;
          mainAudioTrack.volume = state.soundEnabled ? state.volume : 0;
          changeBtn.textContent = file.name;
          if (state.soundEnabled) {
            mainAudioTrack.play().catch(() => {});
          }
        }
      });
    }

    // Click outside to close panel
    document.addEventListener('click', (e) => {
      if (widget && !widget.contains(e.target) && panel) {
        panel.hidden = true;
      }
    });

    // Volume Slider: Adjusts volume across Web Audio & main soundtrack
    if (slider) {
      slider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        state.volume = val;
        if (valText) valText.textContent = `${Math.round(val * 100)}%`;
        if (masterGain && audioCtx) {
          masterGain.gain.setValueAtTime(state.soundEnabled ? state.volume : 0, audioCtx.currentTime);
        }
        if (mainAudioTrack) {
          mainAudioTrack.volume = state.soundEnabled ? state.volume : 0;
        }
      });
    }

    if (trackSelect) {
      trackSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === 'custom') {
          if (mp3Input) mp3Input.click();
        } else {
          playRealStudioMusic(val);
        }
      });
    }

    if (mp3Input) {
      mp3Input.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          if (!studioAudioEl) {
            studioAudioEl = new Audio();
            studioAudioEl.loop = true;
          }
          studioAudioEl.src = URL.createObjectURL(file);
          studioAudioEl.volume = state.soundEnabled ? state.volume : 0;
          currentTrackKey = 'custom';
          if (state.soundEnabled) studioAudioEl.play().catch(() => {});
        }
      });
    }
  }

})();
