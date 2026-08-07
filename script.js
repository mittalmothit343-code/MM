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
        story: 'The first time we met after the Roka. No searching, no radar — just somewhere to be, together.',
        gift: 'Something small came home with us that day.'
      },
      {
        date: '26th June 2026',
        short: '26 JUN',
        numeral: 'XII',
        name: 'The Harbor of Small Errands',
        story: 'Shopping, which is mostly an excuse. Lists get written. Very little gets bought.',
        gift: 'One more thing for the chest.'
      },
      {
        date: '10th July 2026',
        short: '10 JUL',
        numeral: 'XIII',
        name: 'The Same Harbor, Again',
        story: 'Shopping again. We are getting better at pretending this is about the shopping.',
        gift: 'Another keepsake, quietly kept.'
      },
      {
        date: '25th July 2026',
        short: '25 JUL',
        numeral: 'XIV',
        name: 'The Harbor With No Reason',
        story: 'No errand this time, no list. Just to meet — which turned out to be reason enough.',
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
    scrollProgress: 0,
    radarActive: false,
    audioTheme: 'ambient', // 'ambient' (searching) | 'romantic' (found)
    musicLevel: 0.05
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

  function beginExperience(mode) {
    if (!librariesReady()) { $('#entryFallback').hidden = false; return; }

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
      buildFilm();

      const muteBtn = $('#muteToggle');
      muteBtn.hidden = false;
      muteBtn.setAttribute('aria-pressed', String(state.soundEnabled));
      muteBtn.setAttribute('aria-label', state.soundEnabled ? 'Turn sound off' : 'Turn sound on');
      muteBtn.addEventListener('click', toggleMute);

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
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xe9ce9a, transparent: true, opacity: 0 });
    goldenGlow = new THREE.Mesh(glowGeom, glowMat);
    goldenGlow.position.set(0, -0.5, -1);
    goldenGlow.visible = false;
    scene.add(goldenGlow);

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

  // Lays a halo onto the water surface, following every wave under it.
  function conformRingToSwell(ring, cx, cz, t) {
    if (ring.material.opacity <= 0.001) return;
    ring.position.set(cx, OCEAN_Y, cz);
    const p = ring.geometry.attributes.position;
    const base = ring.userData.base;
    const sx = ring.scale.x, sz = ring.scale.z;
    for (let i = 0; i < p.count; i++) {
      const ix = i * 3;
      p.array[ix + 1] = waveHeight(cx + base[ix] * sx, cz + base[ix + 2] * sz, t) + 0.07;
    }
    p.needsUpdate = true;
  }

  // Lighting a ship up (or putting it back to dark) in one reversible call.
  function setShipFound(ship, ring, found, instant) {
    const targetOpacity = found ? 1 : 0;
    const targetIntensity = found ? 2.4 : 0;

    if (instant || state.reducedMotion) {
      gsap.killTweensOf([ring.material, ship.userData.light, ring.scale]);
      ring.material.opacity = targetOpacity;
      ship.userData.light.intensity = targetIntensity;
      ring.scale.setScalar(found ? 1 : 0.3);
      ship.userData.found = found;
      ring.userData.lit = found;
      return;
    }

    // This runs every frame from the story and the film, so the equality guard
    // has to come before anything with a side effect.
    if (ship.userData.found === found) return;
    ship.userData.found = found;
    ring.userData.lit = false; // hold the halo's breath until the fade lands

    gsap.to(ring.material, {
      opacity: targetOpacity, duration: 0.6, overwrite: true,
      onComplete: () => { ring.userData.lit = found; }
    });
    gsap.to(ship.userData.light, { intensity: targetIntensity, duration: 0.6, overwrite: true });
    if (found) gsap.fromTo(ring.scale, { x: 0.3, y: 0.3, z: 0.3 }, { x: 1, y: 1, z: 1, duration: 1.1, ease: 'power3.out', overwrite: true });
  }


  // Builds one small harbor island: a low mound, a sandy cap and beach, a
  // pier with a lantern, a palm, a photo flag on a pole (falls back to a plain
  // pennant until a photo is added), and a floating date label.
  function buildIsland(dateLabel, harborIndex) {
    const group = new THREE.Group();

    // Tall enough that its base stays below the deepest wave trough, so the
    // island never shows daylight underneath itself.
    const mound = new THREE.Mesh(
      new THREE.ConeGeometry(4.0, 5.2, 11),
      new THREE.MeshStandardMaterial({ color: 0x3a3025, roughness: 0.95 })
    );
    mound.position.y = -2.4;
    mound.rotation.y = Math.random() * Math.PI;
    group.add(mound);

    const cap = new THREE.Mesh(
      new THREE.ConeGeometry(3.1, 0.85, 11),
      new THREE.MeshStandardMaterial({ color: 0xc9b08a, roughness: 0.85 })
    );
    cap.position.y = -0.15;
    group.add(cap);

    // ---- sandy beach shelf, so the island has a shoreline ----
    const beach = new THREE.Mesh(
      new THREE.CylinderGeometry(5.6, 6.6, 0.3, 20),
      new THREE.MeshStandardMaterial({ color: 0xd8c39a, roughness: 0.9 })
    );
    beach.position.y = -1.88;
    group.add(beach);

    // ---- shoreline rocks ----
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x2b241c, roughness: 0.95 });
    for (let i = 0; i < 7; i++) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22 + Math.random() * 0.22, 0), rockMat);
      const angle = (i / 7) * Math.PI * 2 + Math.random() * 0.4;
      const r = 4.7 + Math.random() * 1.3;
      rock.position.set(Math.cos(angle) * r, -1.72, Math.sin(angle) * r);
      rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      group.add(rock);
    }

    // ---- wooden pier with a lantern at its end ----
    const pierMat = new THREE.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.85 });
    const pierAngle = 0.45;
    const pierLen = 3.6;
    const pier = new THREE.Mesh(new THREE.BoxGeometry(pierLen, 0.12, 0.55), pierMat);
    pier.position.set(Math.cos(pierAngle) * (pierLen / 2 + 3.4), -1.55, Math.sin(pierAngle) * (pierLen / 2 + 3.4));
    pier.rotation.y = -pierAngle;
    group.add(pier);
    [-1, 0, 1].forEach((i) => {
      const t = 0.5 + i * 0.42;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.6, 6), pierMat);
      post.position.set(Math.cos(pierAngle) * (3.4 + t * pierLen), -1.9, Math.sin(pierAngle) * (3.4 + t * pierLen));
      group.add(post);
    });
    const lanternX = Math.cos(pierAngle) * (3.4 + pierLen);
    const lanternZ = Math.sin(pierAngle) * (3.4 + pierLen);
    const lanternPole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.85, 6), pierMat);
    lanternPole.position.set(lanternX, -1.12, lanternZ);
    group.add(lanternPole);
    const lanternBulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xe9ce9a, emissive: 0xe9ce9a, emissiveIntensity: 1 })
    );
    lanternBulb.position.set(lanternX, -0.72, lanternZ);
    group.add(lanternBulb);
    const lanternLight = new THREE.PointLight(0xe9ce9a, 0.8, 6);
    lanternLight.position.copy(lanternBulb.position);
    group.add(lanternLight);

    // ---- palm tree ----
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.2, 2.9, 7),
      new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.8 })
    );
    trunk.position.set(0.5, 1.1, 0.2);
    trunk.rotation.z = 0.22;
    group.add(trunk);

    const frondMat = new THREE.MeshStandardMaterial({ color: 0x3d6a45, roughness: 0.7, side: THREE.DoubleSide });
    const frondGroup = new THREE.Group();
    const frondCount = 5;
    for (let i = 0; i < frondCount; i++) {
      const frond = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.9, 4), frondMat);
      const angle = (i / frondCount) * Math.PI * 2;
      frond.rotation.z = Math.PI / 2.1; // lay the cone over sideways, like a blade
      frond.rotation.y = angle;
      frond.position.set(Math.cos(angle) * 0.22, 0, Math.sin(angle) * 0.22);
      frondGroup.add(frond);
    }
    frondGroup.position.set(0.7, 2.6, 0.28);
    frondGroup.rotation.z = -0.15;
    group.add(frondGroup);

    // ---- flag on a pole, carrying a photo from that meeting once added ----
    const poleHeight = 2.6;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.035, poleHeight, 6),
      new THREE.MeshStandardMaterial({ color: 0xc9b08a, roughness: 0.6 })
    );
    pole.position.set(-1.05, poleHeight / 2 - 0.2, -0.35);
    group.add(pole);

    const flagMat = new THREE.MeshStandardMaterial({
      color: 0xe9ce9a, roughness: 0.6, side: THREE.DoubleSide, transparent: true, opacity: 0.96
    });
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.92), flagMat);
    flag.position.set(-1.05 + 0.68, poleHeight - 0.55, -0.35);
    group.add(flag);

    if (Number.isInteger(harborIndex)) {
      loadHarborPhotoTexture(harborIndex).then((tex) => {
        if (!tex) return; // no photo added yet — keep the plain pennant
        flagMat.map = tex;
        flagMat.color.set(0xffffff);
        flagMat.needsUpdate = true;
      });
    }

    // ---- floating date label (canvas texture on a camera-facing sprite) ----
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
    sprite.position.set(0, 4.3, 0);
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

      // ---- islands sit in the same moving water ----
      islands.forEach((isl, i) => {
        isl.position.y = ISLAND_Y + Math.sin(t * 0.5 + i * 1.3) * 0.06;
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
    // a slow sonar breath, instead of a spin a circle could never show anyway
    const halo = 0.82 + Math.sin(t * 1.15) * 0.18;
    if (ringMohit.userData.lit) ringMohit.material.opacity = halo;
    if (ringSezal.userData.lit) ringSezal.material.opacity = halo * 0.98;

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

    if (moveCamera) {
      cameraBase.pos = [p.x - p.dx * camDist, camHeight, p.z - p.dz * camDist];
      cameraBase.look = [p.x, -0.5, p.z];
    }

    // Island i sits AT path point i+1, so the ships draw level with it when
    // segF === i + 1 — that is where its arrival pulse should peak.
    islands.forEach((isl, i) => {
      const proximity = Math.max(0, 1 - Math.min(Math.abs(segF - (i + 1)), 1.5) / 1.5);
      isl.scale.setScalar(1 + proximity * 0.12);
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
    { p: SCENE_STOP(1),  pos: [0, 10, 34],  look: [0, 0, 0] },
    { p: SCENE_STOP(2),  pos: [0, 16, 26],  look: [0, 0, -4] },
    { p: SCENE_STOP(3),  pos: [-14, 6, -2], look: [START_M.x, -1, START_M.z] },
    { p: SCENE_STOP(4),  pos: [16, 6, 20],  look: [START_S.x, -1, START_S.z] },
    { p: SCENE_STOP(5),  pos: [0, 14, 30],  look: [1, -1, -1] },
    { p: SCENE_STOP(6),  pos: [0, 9, 20],   look: [0, -1, 0] },
    { p: SCENE_STOP(7),  pos: [0, 5, 10],   look: [0, -1, 0] },
    { p: SCENE_STOP(8),  pos: [0, 4, 8],    look: [0, -1, 0] },
    { p: SCENE_STOP(9),  pos: [0, 3, 6],    look: [0, -1, 0] },
    { p: SCENE_STOP(10), pos: [0, 6, 16],   look: [0, 0, -20] }
  ];

  function updateChapterOne(progress) {
    if (!scene || state.filmMode) return;
    state.scrollProgress = progress;

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

    connectionLine.material.opacity = bothOn && !metOn
      ? clamp01((progress - SCENE_STOP(5)) / 0.03) * 0.8
      : metOn ? Math.max(0, 0.8 - clamp01((progress - SCENE_STOP(7)) / 0.05) * 0.8) : 0;
    // Hard clear well past the meeting — the line has no business existing
    // once the reader is reading the quote or "Our Roka", however this frame
    // was reached (a fast flick, a resize, scrubbing).
    if (progress > SCENE_STOP(7) + 0.05) connectionLine.material.opacity = 0;

    applyMeetingBurst(clamp01((progress - SCENE_STOP(7)) / 0.07));

    // The theme follows the state every frame, so scrolling back up before
    // either ship is found genuinely returns to the searching theme.
    setAudioTheme(mohitOn || sezalOn ? 'romantic' : 'ambient');

    // one-shot sounds only on the way in
    mohitEdge(mohitOn, () => playShipHorn({ freq: 98, voice: 'mohit' }));
    sezalEdge(sezalOn, () => playBeepBeep({ voice: 'sezal' }));
    meetEdge(metOn, () => {
      playShipHorn({ freq: 108, long: true, voice: 'meet' });
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
  const ROMANTIC_PROGRESSION = [
    [146.83, 220.00, 293.66, 369.99, 440.00], // D   — D3 A3  D4  F#4 A4
    [110.00, 164.81, 220.00, 277.18, 329.63], // A   — A2 E3  A3  C#4 E4
    [123.47, 184.99, 246.94, 293.66, 369.99], // Bm  — B2 F#3 B3  D4  F#4
    [98.00,  146.83, 196.00, 246.94, 293.66]  // G   — G2 D3  G3  B3  D4
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

  // Soft, endless ocean swell: filtered noise with a slow-breathing low-pass cutoff.
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
    filter.frequency.value = 450;

    const lfo = audioCtx.createOscillator();
    lfo.frequency.value = 0.06; // one slow "breath" roughly every 16 seconds
    const lfoGain = audioCtx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    const gain = audioCtx.createGain();
    gain.gain.value = 0;

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    noise.start();
    lfo.start();
    gain.gain.linearRampToValueAtTime(0.16, audioCtx.currentTime + 3);

    oceanNodes = { noise, filter, lfo, gain };
  }

  // The "searching" theme: a quiet, open-fifth drone. Deliberately spare —
  // this plays while the radar is still hunting and should feel unresolved.
  function startSearchTheme() {
    if (searchNodes || !audioCtx) return;
    const freqs = [110.0, 164.81, 220.0]; // A2, E3, A3
    const gain = audioCtx.createGain();
    gain.gain.value = 0;
    gain.connect(masterGain);
    const oscs = freqs.map((f, i) => {
      const osc = audioCtx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      osc.detune.value = (i - 1) * 3;
      osc.connect(gain);
      osc.start();
      return osc;
    });
    searchNodes = { oscs, gain };
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

    const oscs = ROMANTIC_PROGRESSION[0].map((f, i) => {
      const osc = audioCtx.createOscillator();
      osc.type = i === 0 ? 'triangle' : 'sine'; // a slightly rounder root, clean overtones above it
      osc.frequency.value = f;
      osc.detune.value = (i - 2) * 2.4;
      vibratoGain.connect(osc.detune);
      osc.connect(padGain);
      osc.start();
      return osc;
    });

    romanticNodes = { gain: out, filter, filterLfo, tremolo, tremoloCenter, vibrato, oscs, reverbSend: wetGain };
    startChordProgression();
    startArpeggio();
    return romanticNodes;
  }

  // Steps the pad through ROMANTIC_PROGRESSION, gliding each voice from its
  // current pitch to the next chord's over a few seconds rather than jumping —
  // this single change is most of the difference between "a chord" and "music".
  function startChordProgression() {
    if (progressionTimer) return;
    let chordIdx = 0;
    const holdMs = 7000, glideSecs = 2.6;
    const advance = () => {
      chordIdx = (chordIdx + 1) % ROMANTIC_PROGRESSION.length;
      if (romanticNodes && audioCtx) {
        const target = ROMANTIC_PROGRESSION[chordIdx];
        romanticNodes.oscs.forEach((osc, i) => {
          osc.frequency.cancelScheduledValues(audioCtx.currentTime);
          osc.frequency.setValueAtTime(osc.frequency.value, audioCtx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(target[i], audioCtx.currentTime + glideSecs);
        });
      }
      progressionTimer = setTimeout(advance, holdMs);
    };
    progressionTimer = setTimeout(advance, holdMs);
    // exposed so the arpeggio can always find the chord actually sounding right now
    startChordProgression.currentChord = () => ROMANTIC_PROGRESSION[chordIdx];
  }

  // A quiet, unhurried pluck, cycling through whichever chord is currently
  // sounding. Scheduling keeps running once audio starts, but a note is only
  // actually voiced while the romantic theme is the active one — cheap to
  // leave ticking, and it means the very first pluck after contact lands on a
  // clean beat rather than firing the instant the theme is switched on.
  function startArpeggio() {
    if (arpeggioTimer) return;
    const pattern = [0, 2, 1, 3, 4, 2]; // a gentle rise and fall through the chord
    let step = 0;
    const tick = () => {
      if (state.audioTheme === 'romantic' && state.soundEnabled) {
        const chord = startChordProgression.currentChord ? startChordProgression.currentChord() : ROMANTIC_PROGRESSION[0];
        playPluck(chord[pattern[step % pattern.length]] * 2); // an octave up from the pad
      }
      step++;
      arpeggioTimer = setTimeout(tick, 2200 + Math.random() * 700);
    };
    arpeggioTimer = setTimeout(tick, 1800);
  }

  // A rounder, more harp-like pluck than a single bare sine: a second voice an
  // octave up, quieter, and a brief filter sweep gives it an attack transient
  // instead of the note simply fading in.
  function playPluck(freq) {
    if (!state.soundEnabled || !audioCtx || !romanticNodes) return;
    const t0 = audioCtx.currentTime;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3200, t0);
    filter.frequency.exponentialRampToValueAtTime(900, t0 + 1.1);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.09, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0006, t0 + 1.7);
    filter.connect(g);
    g.connect(masterGain);
    g.connect(romanticNodes.reverbSend); // the pluck gets the same room as the pad

    [1, 2].forEach((mult, i) => {
      const osc = audioCtx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * mult;
      const voiceGain = audioCtx.createGain();
      voiceGain.gain.value = i === 0 ? 1 : 0.35;
      osc.connect(voiceGain);
      voiceGain.connect(filter);
      osc.start(t0);
      osc.stop(t0 + 1.8);
    });
  }

  // Crossfades between the two themes. Idempotent — called every frame with
  // the current state, it only actually ramps anything the moment the theme
  // genuinely changes, so it is safe to call this constantly rather than
  // trying to catch the one right instant.
  function setAudioTheme(theme) {
    if (!audioCtx || theme === state.audioTheme) return;
    state.audioTheme = theme;
    const incoming = theme === 'romantic' ? romanticNodes : searchNodes;
    const outgoing = theme === 'romantic' ? searchNodes : romanticNodes;
    const target = state.soundEnabled ? state.musicLevel : 0;
    if (incoming) {
      incoming.gain.gain.cancelScheduledValues(audioCtx.currentTime);
      incoming.gain.gain.setValueAtTime(incoming.gain.gain.value, audioCtx.currentTime);
      incoming.gain.gain.linearRampToValueAtTime(target, audioCtx.currentTime + 3.5);
    }
    if (outgoing) {
      outgoing.gain.gain.cancelScheduledValues(audioCtx.currentTime);
      outgoing.gain.gain.setValueAtTime(outgoing.gain.gain.value, audioCtx.currentTime);
      outgoing.gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 3.5);
    }
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

  // A single ship-horn blast: two sawtooth voices a fifth apart through a
  // low-pass, a slow air-building attack, and a slight downward pitch bend
  // on release — the shape reads as a horn rather than a synth note.
  // A shared cooldown per horn "voice" (who is honking) — if the same voice
  // is asked to sound again before the last blast has finished, the earlier
  // call is ignored outright rather than the two overlapping and smearing
  // into a continuous buzz. This is the actual fix for the "continuously
  // buzzing" report: a raw sawtooth through a single gentle low-pass still
  // carries a lot of harsh high harmonics, and if a horn were ever retriggered
  // while the previous one was still ringing out, the tails would stack.
  const hornCooldown = { mohit: 0, sezal: 0, meet: 0, meet2: 0 };

  // Mohit's horn: two sawtooth voices a fifth apart, but now run through a
  // steeper *cascaded* low-pass (two filters in series roll off twice as
  // fast) and given a slow, gentle vibrato — a held, static sawtooth reads as
  // a buzzer, whereas a horn's reed always wavers slightly. Shorter, softer
  // sustain than before, so it reads as a "blast" rather than a drone.
  function playShipHorn({ freq = 104, long = false, delay = 0, voice = 'mohit' } = {}) {
    if (!state.soundEnabled || !audioCtx) return;
    const now = audioCtx.currentTime;
    if (now + delay < hornCooldown[voice]) return; // still ringing — ignore, don't stack
    const t0 = now + delay;
    const dur = long ? 1.5 : 0.68;
    hornCooldown[voice] = t0 + dur + 0.25;

    const filterA = audioCtx.createBiquadFilter();
    filterA.type = 'lowpass'; filterA.frequency.value = 540; filterA.Q.value = 0.3;
    const filterB = audioCtx.createBiquadFilter();
    filterB.type = 'lowpass'; filterB.frequency.value = 480; filterB.Q.value = 0.3;
    filterA.connect(filterB);

    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.15, t0 + 0.14);        // air building
    g.gain.setValueAtTime(0.15, t0 + dur - 0.22);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);  // release
    filterB.connect(g);
    g.connect(masterGain);

    // a slow waver on pitch, so the sustained tone doesn't sit dead-static
    const vibrato = audioCtx.createOscillator();
    vibrato.frequency.value = 5.2;
    const vibratoGain = audioCtx.createGain();
    vibratoGain.gain.value = freq * 0.012;
    vibrato.connect(vibratoGain);
    vibrato.start(t0);
    vibrato.stop(t0 + dur + 0.1);

    [1, 1.5].forEach((mult) => { // the fifth above gives it a horn's timbre
      const osc = audioCtx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq * mult, t0);
      osc.frequency.exponentialRampToValueAtTime(freq * mult * 0.94, t0 + dur); // pitch sags as breath runs out
      vibratoGain.connect(osc.detune);
      osc.connect(filterA);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    });
  }

  // Sezal's cue: a Road Runner "beep beep" — two short, bright, cheerful
  // blips rather than a horn. A deliberately different, playful voice so the
  // two ships are told apart by ear, not just by name.
  function playBeepBeep({ delay = 0, voice = 'sezal' } = {}) {
    if (!state.soundEnabled || !audioCtx) return;
    const now = audioCtx.currentTime;
    if (now + delay < hornCooldown[voice]) return;
    const t0 = now + delay;
    hornCooldown[voice] = t0 + 0.42;

    [0, 0.19].forEach((offset) => {
      const beepT = t0 + offset;
      const osc = audioCtx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(980, beepT);
      osc.frequency.exponentialRampToValueAtTime(1180, beepT + 0.1); // a little upward chirp, cartoon-bright
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 3200; // takes the edge off the square wave's harshness
      const g = audioCtx.createGain();
      g.gain.setValueAtTime(0, beepT);
      g.gain.linearRampToValueAtTime(0.11, beepT + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0008, beepT + 0.13);
      osc.connect(filter); filter.connect(g); g.connect(masterGain);
      osc.start(beepT);
      osc.stop(beepT + 0.16);
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
    btn.setAttribute('aria-pressed', String(state.soundEnabled));
    btn.setAttribute('aria-label', state.soundEnabled ? 'Turn sound off' : 'Turn sound on');
    setupAudioContext();
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if (state.soundEnabled) {
      if (!oceanNodes) startOceanAmbience();
      if (!searchNodes) startSearchTheme();
      if (!romanticNodes) startRomanticTheme();
      masterGain.gain.linearRampToValueAtTime(1, audioCtx.currentTime + 0.6);
      const active = state.audioTheme === 'romantic' ? romanticNodes : searchNodes;
      active.gain.gain.linearRampToValueAtTime(state.musicLevel, audioCtx.currentTime + 0.6);
    } else {
      masterGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.4);
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
    const { dir, extensions, maxIndex, maxConsecutiveMisses } = CONFIG.galleryProbe;
    const found = [];
    let consecutiveMisses = 0;

    for (let i = 1; i <= maxIndex; i++) {
      // try every extension for this index at once rather than one at a time
      // eslint-disable-next-line no-await-in-loop
      const results = await Promise.all(extensions.map((ext) => probeImage(`${dir}${i}.${ext}`)));
      const hitIdx = results.indexOf(true);
      if (hitIdx > -1) { found.push(`${dir}${i}.${extensions[hitIdx]}`); consecutiveMisses = 0; }
      else consecutiveMisses++;

      if (consecutiveMisses >= maxConsecutiveMisses && (found.length > 0 || i >= 8)) break;
    }
    return found;
  }

  async function discoverHarborPhotos(index) {
    if (harborPhotoCache.has(index)) return harborPhotoCache.get(index);
    const exts = CONFIG.galleryProbe.extensions;
    const found = [];
    for (let n = 1; n <= 6; n++) {
      // eslint-disable-next-line no-await-in-loop
      const results = await Promise.all(exts.map((ext) => probeImage(`assets/photos/harbors/${index}-${n}.${ext}`)));
      const hitIdx = results.indexOf(true);
      if (hitIdx === -1) break;
      found.push(`assets/photos/harbors/${index}-${n}.${exts[hitIdx]}`);
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
    { t: 0,   label: 'Overture' },
    { t: 14,  label: 'The fleet' },
    { t: 21,  label: 'The search' },
    { t: 28,  label: CONFIG.names.first },
    { t: 36,  label: CONFIG.names.second },
    { t: 44,  label: 'The lock' },
    { t: 51,  label: 'The approach' },
    { t: 61,  label: 'The meeting' },
    { t: 68,  label: 'The line' },
    { t: 77,  label: 'Our Roka' },
    { t: 86,  label: 'Small harbors' },
    { t: 96,  label: 'The horizon' },
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
    cue(15.2, 4.6, 'sub', 'Hundreds of small lights.<br/>Each one is someone, going somewhere.');

    // 3. The search — rise, and the instrument wakes up
    cut(21, [0, 17, 27], [0, 0, -4]);
    move(21, 7, [0, 20, 21], [0, 0, -6]);
    cue(22.2, 4.6, 'sub', 'Something begins to search.');

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
    cue(45.2, 4.6, 'sub', 'Every other light fades.<br/>Only these two remain.');

    // 7. The approach — the only long, unbroken shot in the film
    cut(51, [0, 11, 24], [0, -1, 0]);
    move(51, 10, [0, 6.5, 13], [0, -1, 0], 'sine.inOut');
    cue(52.4, 6, 'sub', 'Two courses, quietly changing.<br/>Neither one turns back.');

    /* ================= ACT III — WHAT CAME AFTER ================= */

    // 8. The meeting
    cut(61, [0, 4, 9.5], [0, -0.6, 0]);
    move(61, 7, [0, 3.2, 7], [0, -0.6, 0], 'sine.out');
    cue(62.4, 4.2, 'sub', 'Target found.');

    // 9. The line
    move(68, 9, [0, 4.4, 10.5], [0, -0.5, -3], 'sine.inOut');
    cue(69, 7, 'quote',
      '<p class="cue-main">In a sea filled with countless journeys,<br/><em>two hearts discovered the same destination.</em></p>');

    // 10. Our Roka — and the night finally turns
    move(77, 9, [0, 3.4, 6], [0, -0.4, -1], 'sine.inOut');
    tl.to(film.sky, { dawn: 1, duration: 19, ease: 'sine.inOut' }, 74);
    cue(78, 7, 'roka',
      `<p class="cue-eyebrow">Together, henceforth</p><p class="cue-main">Our Roka</p><p class="cue-foot">${CONFIG.rokaDate}</p>`);

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

    connectionLine.material.opacity = bothOn && !metOn ? clamp01((T - 44.5) / 1.5) * 0.8
      : metOn ? Math.max(0, 0.8 - clamp01((T - 62.2) / 1.8) * 0.8) : 0;
    // Same hard clear as the scroll story: once the film has clearly moved
    // past the meeting, the line is gone, full stop — no formula to drift.
    if (T > 64.5) connectionLine.material.opacity = 0;

    applyMeetingBurst(clamp01((T - 62) / 3));

    // The theme follows the state every frame, exactly as in the scroll story —
    // scrubbing the playhead back before either ship is found returns to the
    // searching theme, and scrubbing forward brings the romance back in.
    setAudioTheme(mohitOn || sezalOn ? 'romantic' : 'ambient');

    // Score: the active theme lifts through the finding, peaks at the meeting,
    // settles after. Only re-ramped when the level actually changes — asking
    // for a new ramp every frame means no ramp ever finishes.
    const musicLevel = T < 20 ? 0.05 : T < 44 ? 0.07 : T < 62 ? 0.09 : T < 96 ? 0.11 : 0.06;
    if (musicLevel !== film.musicLevel && film.tl.isActive() && !film.seeking) {
      film.musicLevel = musicLevel;
      setMusicLevel(musicLevel, 4);
    }

    // one-shot flourishes — silenced while the playhead is being dragged,
    // so scrubbing never machine-guns horn blasts
    const playingForward = film.tl.isActive() && !film.seeking;
    filmMohitEdge(mohitOn, () => { if (playingForward) playShipHorn({ freq: 98, voice: 'mohit' }); });
    filmSezalEdge(sezalOn, () => { if (playingForward) playBeepBeep({ voice: 'sezal' }); });
    filmMeetEdge(metOn, () => {
      if (!playingForward) return;
      playShipHorn({ freq: 108, long: true, voice: 'meet' });
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

})();
