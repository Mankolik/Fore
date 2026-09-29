// Game controller: state machine, swing meter, input, camera, scoring and persistence.
(function () {
  const Golf = globalThis.Golf;
  const { T, physics: P, render: R, audio } = Golf;
  const { clamp, lerp } = Golf.util;

  const $ = (id) => document.getElementById(id);
  const els = {
    canvas: $('game'), minimap: $('minimap'), wind: $('wind-canvas'),
    holeTitle: $('hole-title'), holeSub: $('hole-sub'), stroke: $('stroke-label'), score: $('score-label'),
    windLabel: $('wind-label'), lie: $('lie-label'), dist: $('dist-label'), info: $('info-strip'),
    toast: $('toast'), hint: $('hint'), controls: $('controls'), swing: $('swing-btn'),
    clubTitle: $('club-title'), clubDist: $('club-dist'), clubPrev: $('club-prev'), clubNext: $('club-next'),
    aimLeft: $('aim-left'), aimRight: $('aim-right'),
    menu: $('menu'), seed: $('seed-input'), dice: $('btn-dice'), preview: $('course-preview'), play: $('btn-play'),
    continueWrap: $('continue-wrap'), continueBtn: $('btn-continue'), continueInfo: $('continue-info'),
    loading: $('loading'), scorecard: $('scorecard'), scTitle: $('sc-title'), scCourse: $('sc-course'),
    scResult: $('sc-result'), scTable: $('sc-table'), scButtons: $('sc-buttons'),
    btnMenu: $('btn-menu'), btnCard: $('btn-card'), btnSound: $('btn-sound'),
    hudTop: $('hud-top'),
  };

  const BACKSWING_TIME = 1.05; // seconds from address to full power
  const RETURN_SPEED = 1.4; // meter units per second on the way back
  const OVERSHOOT = -0.16; // how far past the line the marker travels before a forced mishit
  const SWEET = 0.02; // half-width of the perfect window
  const TOP_ANGLE = 3.7; // club angle at the top of a full backswing (radians)
  const MAX_STROKES = 10;
  const SAVE_KEY = 'golfy.save.v1';

  const game = {
    course: null, holeIdx: 0, hole: null, layers: null, minimap: null,
    ball: null, strokes: 0, scores: [], phase: 'menu', inRound: false,
    aim: 0, clubIdx: 0, putterRange: 10,
    power: 0, marker: 0, lockedPower: 0, topHold: 0, error: 0,
    clubAngle: 0, strikeT: 0, followT: 0, carryShown: false,
    cam: { x: 0, y: 0, scale: 3 }, flightScale: 3, userZoom: 1, overview: false,
    particles: [], trail: [], guide: null, showGolfer: true, showSlopes: false,
    pinPower: null, lieFull: 0, lie: T.TEE, lieFx: null,
    shotStart: null, settleT: 0, afterSettle: null, fastForward: false, shirtColor: '#2f6fd6',
    aimHold: 0, aimHoldT: 0, dpr: 1, renderer: null, topReserve: 100, bottomReserve: 600,
  };
  game.renderer = new R.Renderer(els.canvas);

  // ---------------------------------------------------------------------------------------------
  // Layout
  function resize() {
    const vw = window.innerWidth, vh = window.innerHeight;
    game.dpr = Math.min(window.devicePixelRatio || 1, 2);
    game.renderer.resize(vw, vh, game.dpr);
    const infoRect = els.info.getBoundingClientRect();
    const hudRect = els.hudTop.getBoundingClientRect();
    game.topReserve = Math.max(infoRect.bottom, hudRect.bottom) + 6;
    game.bottomReserve = els.controls.getBoundingClientRect().top - 50;
    game.renderer.viewCenterY = (game.topReserve + game.bottomReserve) / 2;
    els.hint.style.bottom = vh - game.bottomReserve + 8 + 'px';
    if (game.hole && game.layers) buildMinimap();
  }
  function buildMinimap() {
    const vw = window.innerWidth;
    const maxW = clamp(vw * 0.2, 60, 120);
    const maxH = clamp((game.bottomReserve - game.topReserve) * 0.42, 100, 260);
    game.minimap = R.buildMinimap(game.hole, game.layers.main, maxW, maxH);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));

  // ---------------------------------------------------------------------------------------------
  // Course / round flow
  function randomSeed() {
    const syll = ['ka', 'lo', 'mi', 'ra', 'ven', 'to', 'sa', 'bri', 'dun', 'el', 'mor', 'fi', 'gal', 'nor', 'pe', 'wyn'];
    let s = '';
    for (let i = 0; i < 3; i++) s += syll[Math.floor(Math.random() * syll.length)];
    return s + Math.floor(Math.random() * 90 + 10);
  }

  function startRound(seed, holeIdx = 0, scores = []) {
    game.course = Golf.generateCourse(seed);
    game.scores = scores.slice();
    game.inRound = true;
    hideMenu();
    startHole(holeIdx);
  }

  function startHole(i) {
    game.holeIdx = i;
    game.phase = 'loading';
    els.loading.classList.remove('hidden');
    els.scorecard.classList.add('hidden');
    setTimeout(() => {
      const hole = game.course.getHole(i);
      game.hole = hole;
      game.layers = R.buildHoleLayers(hole);
      buildMinimap();
      game.ball = P.createBall(hole.tee.x, hole.tee.y, hole);
      game.strokes = 0;
      game.trail = [];
      game.particles = [];
      game.overview = false;
      game.userZoom = 1;
      game.shotStart = { x: hole.tee.x, y: hole.tee.y };
      els.loading.classList.add('hidden');
      setupShot();
      snapCamera();
      R.drawWind(els.wind, hole.wind, game.dpr);
      updateHud(true);
      toast(`Hole ${i + 1}`, `Par ${hole.par} · ${Math.round(hole.length)} m`, 1800);
      const idle = window.requestIdleCallback || ((f) => setTimeout(f, 60));
      idle(() => {
        if (game.hole === hole) game.layers.green = R.buildGreenLayer(hole);
      });
    }, 40);
  }

  function setupShot() {
    const b = game.ball;
    const hole = game.hole;
    b.state = 'rest';
    b.vx = b.vy = b.vz = 0;
    b.z = hole.height(b.x, b.y);
    game.lie = hole.terrainAt(b.x, b.y);
    const dist = distToPin();
    game.aim = Math.atan2(hole.pin.y - b.y, hole.pin.x - b.x);
    game.clubIdx = pickClub(dist);
    game.phase = 'aim';
    game.power = 0;
    game.clubAngle = 0;
    game.followT = 0;
    game.showGolfer = true;
    game.carryShown = false;
    updateClub();
    updateHud();
  }

  function distToPin() {
    const b = game.ball, p = game.hole.pin;
    return Math.hypot(p.x - b.x, p.y - b.y);
  }

  const carryCache = new Map();
  function carryFor(clubIdx, lie, power) {
    const c = P.CLUBS[clubIdx];
    const le = P.lieEffect(lie, clubIdx);
    const launch = c.launch + (lie === T.SAND ? 4 : 0);
    return P.flatCarry(c.speed * P.speedFractionForPower(clubIdx, power) * le.speed, launch, c.lift * (0.6 + 0.4 * le.spin));
  }
  function lieFullCarry(clubIdx, lie) {
    const key = clubIdx * 100 + lie;
    if (!carryCache.has(key)) carryCache.set(key, carryFor(clubIdx, lie, 1));
    return carryCache.get(key);
  }

  function pickClub(dist) {
    const lie = game.lie;
    if (lie === T.GREEN) return P.PUTTER;
    if ((lie === T.FRINGE || lie === T.FIRST || lie === T.FAIRWAY) && dist < 12 && Math.abs(game.hole.height(game.ball.x, game.ball.y) - game.hole.height(game.hole.pin.x, game.hole.pin.y)) < 1.2) {
      const onGreenLine = sampleLine(game.ball, game.hole.pin, (t) => t === T.GREEN || t === T.FRINGE || t === T.FIRST || t === T.FAIRWAY);
      if (onGreenLine) return P.PUTTER;
    }
    // From deep rough, trees or sand the woods are a poor choice: suggest irons at most.
    const noWoods = lie === T.DEEP || lie === T.SAND || lie === T.OOB;
    const longest = lie === T.TEE ? 0 : noWoods ? 2 : 1;
    let best = P.PUTTER - 1;
    for (let i = P.PUTTER - 1; i >= longest; i--) {
      if (lieFullCarry(i, lie) >= dist * 0.98) return i;
      best = i;
    }
    return best;
  }
  function sampleLine(a, b, ok) {
    const n = 12;
    for (let i = 0; i <= n; i++) {
      const t = game.hole.terrainAt(lerp(a.x, b.x, i / n), lerp(a.y, b.y, i / n));
      if (!ok(t)) return false;
    }
    return true;
  }

  function updateClub() {
    const idx = game.clubIdx;
    const c = P.CLUBS[idx];
    const dist = distToPin();
    game.lieFx = P.lieEffect(game.lie, idx);
    if (c.putter) {
      game.putterRange = clamp(Math.ceil((dist * 1.3) / 5) * 5, 5, 40);
      game.lieFull = game.putterRange;
      game.pinPower = dist / game.putterRange;
      els.clubTitle.textContent = 'Putter';
      els.clubDist.textContent = `${game.putterRange} m range`;
      game.showSlopes = true;
    } else {
      game.lieFull = lieFullCarry(idx, game.lie);
      // Bisection for the power that carries the pin.
      if (dist >= game.lieFull) game.pinPower = dist / game.lieFull;
      else {
        let lo = 0, hi = 1;
        for (let k = 0; k < 18; k++) {
          const m = (lo + hi) / 2;
          if (carryFor(idx, game.lie, m) < dist) lo = m;
          else hi = m;
        }
        game.pinPower = (lo + hi) / 2;
      }
      els.clubTitle.textContent = c.name;
      els.clubDist.textContent = `${Math.round(game.lieFull)} m carry${game.lieFx.label ? ' (' + game.lieFx.label + ')' : ''}`;
      game.showSlopes = false;
    }
    updateGuide();
  }

  function changeClub(d) {
    if (game.phase !== 'aim') return;
    game.clubIdx = (game.clubIdx + d + P.CLUBS.length) % P.CLUBS.length;
    updateClub();
    audio.play('tick');
  }

  function updateGuide() {
    const c = P.CLUBS[game.clubIdx];
    const swinging = game.phase === 'backswing' || game.phase === 'downswing' || game.phase === 'strike';
    if (!['aim', 'backswing', 'downswing', 'strike'].includes(game.phase)) {
      game.guide = null;
      return;
    }
    const p = swinging ? (game.phase === 'backswing' ? game.power : game.lockedPower) : null;
    if (c.putter) {
      game.guide = { length: Math.min(distToPin() + 1.5, game.putterRange), ring: false, ringR: 0.3, power: p != null ? p * game.putterRange : null };
    } else {
      game.guide = { length: game.lieFull, ring: true, ringR: Math.max(2, game.lieFull * 0.035), power: p != null ? p * game.lieFull : null };
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Swing
  function pressSwing() {
    audio.unlock();
    if (game.overview) game.overview = false;
    if (game.phase === 'aim') {
      game.phase = 'backswing';
      game.power = 0;
      game.topHold = 0;
      setHint('Release to set power');
    } else if (game.phase === 'downswing') {
      strike(game.marker);
    } else if (game.phase === 'flight') {
      game.fastForward = true;
    }
  }
  function releaseSwing() {
    game.fastForward = false;
    if (game.phase === 'backswing') lockPower();
  }
  function lockPower() {
    game.lockedPower = Math.max(game.power, 0.02);
    game.marker = game.lockedPower;
    game.phase = 'downswing';
    setHint('Tap at the white line!');
  }
  function strike(m) {
    let e = 0;
    if (Math.abs(m) > SWEET) e = Math.sign(m) * Math.min(1, (Math.abs(m) - SWEET) / (Math.abs(OVERSHOOT) - SWEET));
    game.error = e;
    game.marker = m;
    game.phase = 'strike';
    game.strikeT = 0;
    game.strikeFrom = game.clubAngle;
    const isPutt = P.CLUBS[game.clubIdx].putter;
    if (e === 0) setHint(isPutt ? 'Pure stroke' : 'Perfect strike!');
    else if (Math.abs(e) < 0.35) setHint(e > 0 ? 'Slight push/fade' : 'Slight pull/draw');
    else setHint(e > 0 ? (isPutt ? 'Pushed it right' : 'Slice!') : isPutt ? 'Pulled it left' : 'Hook!');
  }
  function launchShot() {
    const b = game.ball;
    const c = P.CLUBS[game.clubIdx];
    game.shotStart = { x: b.x, y: b.y };
    const lie = game.lie;
    P.launch(b, game.hole, game.clubIdx, game.lockedPower, game.error, game.aim, game.putterRange);
    game.strokes++;
    game.phase = 'flight';
    game.followT = 0;
    game.trail = [{ x: b.x, y: b.y, agl: 0 }];
    game.flightScale = game.cam.scale;
    if (c.putter) audio.play('putt');
    else {
      audio.play('hit', game.lockedPower);
      if (lie === T.SAND) {
        audio.play('sand');
        spray(b.x, b.y, 'rgba(226,206,150,A)', 22, 4, 5);
      } else if (lie !== T.TEE && lie !== T.GREEN) spray(b.x, b.y, 'rgba(70,130,50,A)', 8, 3, 3);
      if (navigator.vibrate) try { navigator.vibrate(12); } catch (e) { /* ignore */ }
    }
    updateGuide();
    updateHud();
  }

  // ---------------------------------------------------------------------------------------------
  // Simulation update
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    update(dt);
    game.renderer.draw(game, now / 1000);
    drawMeter();
    if (game.hole && game.minimap) R.drawMinimap(els.minimap, game);
    requestAnimationFrame(frame);
  }

  function update(dt) {
    if (game.aimHold && game.phase === 'aim' && (game.aimHoldT += dt) > 0) {
      const putt = P.CLUBS[game.clubIdx].putter;
      const rate = (putt ? 0.012 : 0.02) * (1 + Math.min(game.aimHoldT, 2) * (putt ? 4 : 8));
      game.aim += game.aimHold * rate * dt * 10;
    }
    const isPutt = P.CLUBS[game.clubIdx] && P.CLUBS[game.clubIdx].putter;
    const top = isPutt ? 1.1 : TOP_ANGLE;
    switch (game.phase) {
      case 'backswing':
        game.power += dt / (BACKSWING_TIME * (isPutt ? 1.15 : 1));
        if (game.power >= 1) {
          game.power = 1;
          game.topHold += dt;
          if (game.topHold > 0.3) lockPower();
        }
        game.clubAngle = game.power * top;
        updateGuide();
        break;
      case 'downswing':
        game.marker -= dt * RETURN_SPEED;
        game.clubAngle = Math.max(0, (game.marker / game.lockedPower) * game.lockedPower * top);
        if (game.marker <= OVERSHOOT) strike(OVERSHOOT);
        break;
      case 'strike':
        game.strikeT += dt;
        game.clubAngle = lerp(game.strikeFrom, 0, Math.min(1, game.strikeT / 0.09));
        if (game.strikeT >= 0.09) launchShot();
        break;
      case 'flight': {
        game.followT += dt;
        game.clubAngle = -Math.min(1, game.followT / 0.35) * (isPutt ? 0.9 : 3.2) * Math.max(0.4, game.lockedPower);
        if (game.followT > 1.6) game.showGolfer = false;
        // Full shots roll out at double speed; putts always play in real time.
        const steps = game.fastForward ? 4 : game.ball.state === 'roll' && !isPutt ? 2 : 1;
        for (let s = 0; s < steps && game.phase === 'flight'; s++) {
          const events = P.step(game.ball, game.hole, dt);
          handleEvents(events);
          const b = game.ball;
          const last = game.trail[game.trail.length - 1];
          if (Math.hypot(b.x - last.x, b.y - last.y) > 0.4) {
            game.trail.push({ x: b.x, y: b.y, agl: Math.max(0, b.z - game.hole.height(b.x, b.y)) });
            if (game.trail.length > 800) game.trail.splice(0, 1);
          }
          checkBallDone();
        }
        break;
      }
      case 'settle':
        game.settleT -= dt;
        if (game.settleT <= 0 && game.afterSettle) {
          const f = game.afterSettle;
          game.afterSettle = null;
          f();
        }
        break;
      default:
        break;
    }
    updateParticles(dt);
    updateCamera(dt);
    updateHud();
    updateSwingButton();
  }

  function handleEvents(events) {
    const b = game.ball;
    for (const ev of events) {
      switch (ev.type) {
        case 'bounce':
          if (!game.carryShown && P.CLUBS[game.clubIdx] && !P.CLUBS[game.clubIdx].putter) {
            game.carryShown = true;
            game.carry = Math.hypot(ev.x - game.shotStart.x, ev.y - game.shotStart.y);
            setHint(`Carry ${Math.round(game.carry)} m`);
          }
          if (ev.terrain === T.SAND) {
            audio.play('sand');
            spray(ev.x, ev.y, 'rgba(226,206,150,A)', 14, 2.5, 3);
          } else audio.play('bounce', ev.strength);
          break;
        case 'tree':
          audio.play('tree');
          spray(ev.x, ev.y, 'rgba(60,125,45,A)', 14, 3, 1, ev.z - game.hole.height(ev.x, ev.y), true);
          setHint('Clipped a tree!');
          break;
        case 'trunk':
          audio.play('trunk');
          break;
        case 'water':
          audio.play('splash');
          game.particles.push({ kind: 'ring', x: ev.x, y: ev.y, r: 2.2, life: 1.2, max: 1.2 });
          game.particles.push({ kind: 'ring', x: ev.x, y: ev.y, r: 3.5, life: 1.6, max: 1.6 });
          spray(ev.x, ev.y, 'rgba(210,235,255,A)', 16, 2, 4);
          break;
        case 'lip':
          audio.play('lip');
          setHint('Lipped out!');
          break;
        case 'holed':
          audio.play('cup');
          spray(b.x, b.y, 'rgba(255,225,110,A)', 20, 2, 3, 0.2, true);
          break;
      }
    }
  }

  function checkBallDone() {
    const b = game.ball;
    const hole = game.hole;
    if (b.state === 'holed') {
      game.phase = 'settle';
      game.settleT = 0.7;
      game.afterSettle = finishHole;
      return;
    }
    if (b.state === 'water') {
      game.phase = 'settle';
      game.settleT = 1.3;
      game.strokes++;
      toast('Water hazard', '+1 penalty stroke', 1600);
      game.afterSettle = () => {
        const d = findDrop(b.lastDry);
        b.x = d.x;
        b.y = d.y;
        nextShotOrPickUp();
      };
      return;
    }
    if (b.state === 'rest') {
      const t = hole.terrainAt(b.x, b.y);
      const total = Math.hypot(b.x - game.shotStart.x, b.y - game.shotStart.y);
      if (!P.CLUBS[game.clubIdx].putter && game.carryShown) setHint(`Carry ${Math.round(game.carry)} m · Total ${Math.round(total)} m`);
      game.phase = 'settle';
      if (t === T.OOB) {
        game.strokes++;
        game.settleT = 1.4;
        toast('Out of bounds', 'Stroke & distance +1', 1600);
        game.afterSettle = () => {
          b.x = game.shotStart.x;
          b.y = game.shotStart.y;
          nextShotOrPickUp();
        };
      } else {
        game.settleT = 0.9;
        game.afterSettle = nextShotOrPickUp;
      }
    }
  }

  function nextShotOrPickUp() {
    if (game.strokes >= MAX_STROKES) {
      toast('Picked up', `${MAX_STROKES} stroke limit`, 1600);
      finishHole();
      return;
    }
    game.trail = [];
    setupShot();
  }

  // Drop near where the ball last crossed into the hazard, no nearer the hole.
  function findDrop(p) {
    const hole = game.hole;
    const pinD = Math.hypot(p.x - hole.pin.x, p.y - hole.pin.y);
    let best = null, bestD = Infinity;
    for (let r = 1; r <= 40; r += 1) {
      for (let a = 0; a < 24; a++) {
        const ang = (a / 24) * Math.PI * 2;
        const x = p.x + Math.cos(ang) * r, y = p.y + Math.sin(ang) * r;
        const t = hole.terrainAt(x, y);
        if (t === T.WATER || t === T.OOB || t === T.SAND) continue;
        if (hole.sampleIdx(hole.fWater, x, y) < 2) continue;
        const dPin = Math.hypot(x - hole.pin.x, y - hole.pin.y);
        const d = r + (dPin < pinD ? 50 : 0);
        if (d < bestD) { bestD = d; best = { x, y }; }
      }
      if (best && bestD < 50) break;
    }
    return best || { x: game.shotStart.x, y: game.shotStart.y };
  }

  function scoreName(strokes, par) {
    if (strokes === 1) return 'Hole in one!';
    const d = strokes - par;
    return { '-3': 'Albatross!', '-2': 'Eagle!', '-1': 'Birdie!', 0: 'Par', 1: 'Bogey', 2: 'Double bogey', 3: 'Triple bogey' }[d] || (d < -3 ? 'Incredible!' : `+${d}`);
  }

  function finishHole() {
    const hole = game.hole;
    game.strokes = Math.min(game.strokes, MAX_STROKES);
    game.scores[game.holeIdx] = game.strokes;
    game.phase = 'holeDone';
    const b = game.ball;
    const holed = b.state === 'holed';
    if (holed) {
      toast(scoreName(game.strokes, hole.par), `${game.strokes} stroke${game.strokes > 1 ? 's' : ''}`, 2200);
      if (game.strokes <= hole.par) audio.play('good');
    }
    save();
    setTimeout(() => {
      if (game.phase !== 'holeDone') return;
      showScorecard(true);
      // Warm up the next hole while the player reads the card.
      if (game.holeIdx + 1 < 9) setTimeout(() => game.course.getHole(game.holeIdx + 1), 250);
    }, holed ? 1900 : 1500);
  }

  // ---------------------------------------------------------------------------------------------
  // Particles
  function spray(x, y, color, n, speed, up, z0 = 0, above = false) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * speed;
      const life = 0.5 + Math.random() * 0.7;
      game.particles.push({ x, y, z: z0, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: Math.random() * up, life, max: life, color, size: 0.08 + Math.random() * 0.1, above });
    }
  }
  function updateParticles(dt) {
    const ps = game.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) { ps.splice(i, 1); continue; }
      if (p.kind === 'ring') continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z = Math.max(0, p.z + p.vz * dt);
      p.vz -= 9.8 * dt;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Camera
  function cameraTarget() {
    const hole = game.hole, b = game.ball;
    const vw = game.renderer.vw;
    const usableH = Math.max(120, game.bottomReserve - game.topReserve);
    if (game.overview) {
      const s = Math.min((vw * 0.92) / hole.W, (usableH * 0.96) / hole.L);
      return { x: hole.W / 2, y: hole.L / 2, scale: s };
    }
    if (game.phase === 'flight' || (game.phase === 'settle' && b.state !== 'holed')) {
      const agl = Math.max(0, b.z - hole.height(b.x, b.y));
      return { x: b.x, y: b.y - agl * R.ZK * 0.5, scale: game.flightScale };
    }
    const dist = distToPin();
    const c = P.CLUBS[game.clubIdx];
    let D;
    if (c.putter) D = Math.max(dist * 1.6, 8);
    else D = clamp(Math.min(game.lieFull * 1.12, dist + 30), 30, 400);
    const dx = (hole.pin.x - b.x) / (dist || 1), dy = (hole.pin.y - b.y) / (dist || 1);
    const scale = Math.min((usableH * 0.92) / D, (vw * 1.5) / D) * game.userZoom;
    return { x: b.x + dx * D * 0.42, y: b.y + dy * D * 0.42, scale: clamp(scale, 0.6, 70) };
  }
  function snapCamera() {
    const t = cameraTarget();
    game.cam.x = t.x;
    game.cam.y = t.y;
    game.cam.scale = t.scale;
  }
  function updateCamera(dt) {
    if (!game.hole || !game.ball) return;
    const t = cameraTarget();
    const k = 1 - Math.exp(-dt * (game.phase === 'flight' ? 6 : 3.5));
    game.cam.x += (t.x - game.cam.x) * k;
    game.cam.y += (t.y - game.cam.y) * k;
    game.cam.scale = Math.exp(lerp(Math.log(game.cam.scale), Math.log(t.scale), k));
  }

  // ---------------------------------------------------------------------------------------------
  // HUD
  const hudCache = {};
  function setText(el, key, text) {
    if (hudCache[key] !== text) {
      hudCache[key] = text;
      el.textContent = text;
    }
  }
  function totalVsPar() {
    let diff = 0;
    game.scores.forEach((s, i) => { if (s != null) diff += s - game.course.pars[i]; });
    return diff;
  }
  function fmtDiff(d) {
    return d === 0 ? 'E' : d > 0 ? `+${d}` : `${d}`;
  }
  function updateHud(force) {
    const hole = game.hole;
    if (!hole || !game.ball) return;
    if (force) Object.keys(hudCache).forEach((k) => delete hudCache[k]);
    setText(els.holeTitle, 'ht', `Hole ${game.holeIdx + 1}`);
    setText(els.holeSub, 'hs', `Par ${hole.par} · ${Math.round(hole.length)} m`);
    const shotNo = game.phase === 'flight' || game.phase === 'settle' || game.phase === 'holeDone' ? game.strokes : game.strokes + 1;
    setText(els.stroke, 'st', `Shot ${Math.max(1, shotNo)}`);
    const d = totalVsPar();
    setText(els.score, 'sc', `Total ${fmtDiff(d)}`);
    els.score.className = 'small ' + (d < 0 ? 'under' : d > 0 ? 'over' : '');
    setText(els.windLabel, 'wl', `${hole.wind.speed.toFixed(1)} m/s`);
    const b = game.ball;
    const terr = hole.terrainAt(b.x, b.y);
    setText(els.lie, 'lie', Golf.TERRAIN_NAMES[terr]);
    const dist = distToPin();
    setText(els.dist, 'dist', dist < 10 ? `${dist.toFixed(1)} m to pin` : `${Math.round(dist)} m to pin`);
  }

  function updateSwingButton() {
    const labels = { aim: 'HOLD TO SWING', backswing: 'RELEASE', downswing: 'TAP!', strike: '…', flight: 'HOLD TO FAST-FORWARD ⏩' };
    const label = labels[game.phase] || '…';
    if (hudCache.swing !== label) {
      hudCache.swing = label;
      els.swing.textContent = label;
    }
    const enabled = ['aim', 'backswing', 'downswing', 'flight'].includes(game.phase);
    if (els.swing.disabled === enabled) els.swing.disabled = !enabled;
    const clubOk = game.phase === 'aim';
    els.clubPrev.disabled = els.clubNext.disabled = !clubOk;
  }

  let toastTimer = null;
  function toast(title, sub, ms = 1500) {
    els.toast.innerHTML = '';
    els.toast.append(title);
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      els.toast.append(s);
    }
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), ms);
  }
  let hintTimer = null;
  function setHint(text, ms = 2200) {
    els.hint.textContent = text;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => (els.hint.textContent = ''), ms);
  }

  // Swing meter, drawn on the main canvas above the controls.
  function drawMeter() {
    if (!game.hole || !['aim', 'backswing', 'downswing', 'strike'].includes(game.phase)) return;
    const r = game.renderer;
    const ctx = r.ctx;
    r.setScreen();
    const vw = r.vw;
    const bw = Math.min(vw - 32, 440), bh = 20;
    const bx = (vw - bw) / 2, by = game.bottomReserve + 16;
    const u = (p) => bx + ((p - OVERSHOOT) / (1 - OVERSHOOT)) * bw;
    ctx.save();
    // Background.
    ctx.fillStyle = 'rgba(10,20,10,0.7)';
    roundRect(ctx, bx - 4, by - 4, bw + 8, bh + 8, 8);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(ctx, bx, by, bw, bh, 5);
    ctx.fill();
    // Accuracy zone.
    ctx.fillStyle = 'rgba(120,180,255,0.18)';
    ctx.fillRect(u(OVERSHOOT), by, u(0.06) - u(OVERSHOOT), bh);
    // Power fill.
    const p = game.phase === 'backswing' ? game.power : game.phase === 'aim' ? 0 : game.lockedPower;
    if (p > 0) {
      const grad = ctx.createLinearGradient(u(0), 0, u(1), 0);
      grad.addColorStop(0, '#ffe066');
      grad.addColorStop(0.75, '#ffb020');
      grad.addColorStop(1, '#ff5a2a');
      ctx.fillStyle = grad;
      ctx.fillRect(u(0), by + 3, u(p) - u(0), bh - 6);
    }
    // Ticks with distances.
    const full = game.lieFull;
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const q of [0.25, 0.5, 0.75, 1]) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(u(q) - 0.5, by, 1, bh);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillText(`${Math.round(full * q)}`, u(q), by - 6);
    }
    // Pin marker.
    if (game.pinPower != null) {
      const pp = Math.min(game.pinPower, 1.0);
      const x = u(pp);
      ctx.fillStyle = '#e8322b';
      ctx.fillRect(x - 1.5, by - 2, 3, bh + 4);
      ctx.beginPath();
      ctx.moveTo(x, by + bh + 2);
      ctx.lineTo(x - 5, by + bh + 9);
      ctx.lineTo(x + 5, by + bh + 9);
      ctx.fill();
      if (game.pinPower > 1.0) {
        ctx.textAlign = 'right';
        ctx.fillText('pin ›', x - 4, by + bh + 12);
      }
    }
    // Sweet spot line.
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(u(-SWEET), by, u(SWEET) - u(-SWEET), bh);
    ctx.fillStyle = '#fff';
    ctx.fillRect(u(0) - 1, by - 3, 2, bh + 6);
    // Moving marker.
    let m = null;
    if (game.phase === 'backswing') m = game.power;
    else if (game.phase === 'downswing' || game.phase === 'strike') m = game.marker;
    if (m != null) {
      const x = u(m);
      ctx.fillStyle = '#111';
      ctx.fillRect(x - 2.5, by - 5, 5, bh + 10);
      ctx.fillStyle = game.phase === 'strike' ? (game.error === 0 ? '#5dff7a' : '#ff7a5d') : '#fff';
      ctx.fillRect(x - 1.5, by - 4, 3, bh + 8);
    }
    ctx.restore();
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------------------------------------------------------------------------------------------
  // Scorecard
  function showScorecard(afterHole) {
    if (!game.course) return;
    const pars = game.course.pars;
    const complete = game.scores.filter((s) => s != null).length === 9;
    els.scTitle.textContent = complete ? 'Round complete' : 'Scorecard';
    els.scCourse.textContent = `${game.course.name} · seed “${game.course.seed}”`;
    const diff = totalVsPar();
    const total = game.scores.reduce((a, s) => a + (s || 0), 0);
    const played = game.scores.filter((s) => s != null).length;
    els.scResult.textContent = played ? `${total} strokes · ${fmtDiff(diff)}` : '';
    const row = (label, cells, cls = '') => `<tr class="${cls}"><th>${label}</th>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
    const holes = pars.map((_, i) => i + 1);
    const scoreCells = pars.map((p, i) => {
      const s = game.scores[i];
      if (s == null) return '·';
      const d = s - p;
      const cls = d <= -2 ? 'eagle' : d === -1 ? 'birdie' : d === 1 ? 'bogey' : d >= 2 ? 'double' : '';
      return `<span class="sc ${cls}">${s}</span>`;
    });
    const parTotal = pars.reduce((a, b) => a + b, 0);
    els.scTable.innerHTML =
      row('Hole', [...holes, 'Tot']) + row('Par', [...pars, parTotal]) + row('Score', [...scoreCells, played ? total : '·']);
    els.scButtons.innerHTML = '';
    const btn = (text, cls, fn) => {
      const b = document.createElement('button');
      b.className = cls;
      b.textContent = text;
      b.addEventListener('click', fn);
      els.scButtons.append(b);
    };
    if (afterHole && !complete) {
      btn(`Next: Hole ${game.holeIdx + 2} ›`, 'primary', () => startHole(game.holeIdx + 1));
    } else if (complete) {
      btn('New course', 'primary', () => {
        clearSave();
        startRound(randomSeed());
      });
      btn('Replay this course', 'secondary', () => {
        clearSave();
        startRound(game.course.seed);
      });
      btn('Main menu', 'secondary', () => {
        clearSave();
        game.inRound = false;
        showMenu();
      });
    } else {
      btn('Close', 'secondary', () => els.scorecard.classList.add('hidden'));
    }
    els.scorecard.classList.remove('hidden');
  }

  // ---------------------------------------------------------------------------------------------
  // Save / menu
  function save() {
    const complete = game.scores.filter((s) => s != null).length === 9;
    try {
      if (complete) localStorage.removeItem(SAVE_KEY);
      else localStorage.setItem(SAVE_KEY, JSON.stringify({ seed: game.course.seed, holeIdx: game.holeIdx + 1, scores: game.scores }));
    } catch (e) { /* storage unavailable */ }
  }
  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  }
  function loadSave() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s && typeof s.seed === 'string' && s.holeIdx >= 0 && s.holeIdx < 9 && Array.isArray(s.scores)) return s;
    } catch (e) { /* ignore */ }
    return null;
  }

  function showMenu() {
    els.scorecard.classList.add('hidden');
    const saved = loadSave();
    if (game.inRound && game.hole) {
      els.continueWrap.classList.remove('hidden');
      els.continueBtn.textContent = 'Resume';
      els.continueInfo.textContent = `${game.course.name} · Hole ${game.holeIdx + 1} · ${fmtDiff(totalVsPar())}`;
    } else if (saved) {
      const c = Golf.generateCourse(saved.seed);
      let d = 0;
      saved.scores.forEach((s, i) => { if (s != null) d += s - c.pars[i]; });
      els.continueWrap.classList.remove('hidden');
      els.continueBtn.textContent = 'Continue round';
      els.continueInfo.textContent = `${c.name} · Hole ${saved.holeIdx + 1} of 9 · ${fmtDiff(d)}`;
    } else els.continueWrap.classList.add('hidden');
    els.menu.classList.remove('hidden');
    updatePreview();
  }
  function hideMenu() {
    els.menu.classList.add('hidden');
  }
  function updatePreview() {
    const seed = els.seed.value.trim();
    if (!seed) {
      els.preview.textContent = '';
      return;
    }
    const c = Golf.generateCourse(seed);
    els.preview.textContent = `${c.name} · Par ${c.pars.reduce((a, b) => a + b, 0)}`;
  }

  // ---------------------------------------------------------------------------------------------
  // Input
  const pointers = new Map();
  let pinch = null;

  function aimAt(sx, sy) {
    if (game.phase !== 'aim' || !game.ball) return;
    const w = game.renderer.screenToWorld(game.cam, sx, sy);
    const b = game.ball;
    const ds = Math.hypot(w.x - b.x, w.y - b.y) * game.cam.scale;
    if (ds < 14) return;
    game.aim = Math.atan2(w.y - b.y, w.x - b.x);
  }

  els.canvas.addEventListener('pointerdown', (e) => {
    audio.unlock();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    els.canvas.setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: game.userZoom };
      return;
    }
    if (e.pointerType === 'mouse') {
      if (e.button !== 0) return;
      aimAt(e.clientX, e.clientY);
      pressSwing();
    } else aimAt(e.clientX, e.clientY);
  });
  els.canvas.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      game.userZoom = clamp((pinch.zoom * d) / pinch.d, 0.3, 5);
      return;
    }
    if (e.pointerType === 'mouse' || pointers.has(e.pointerId)) aimAt(e.clientX, e.clientY);
  });
  const endPointer = (e) => {
    const had = pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (e.pointerType === 'mouse' && had) releaseSwing();
  };
  els.canvas.addEventListener('pointerup', endPointer);
  els.canvas.addEventListener('pointercancel', endPointer);
  els.canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    game.userZoom = clamp(game.userZoom * Math.exp(-e.deltaY * 0.0015), 0.3, 5);
  }, { passive: false });

  els.swing.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { els.swing.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    els.swing.classList.add('pressed');
    pressSwing();
  });
  const swingUp = () => {
    els.swing.classList.remove('pressed');
    releaseSwing();
  };
  els.swing.addEventListener('pointerup', swingUp);
  els.swing.addEventListener('pointercancel', swingUp);
  els.swing.addEventListener('contextmenu', (e) => e.preventDefault());

  const holdAim = (btn, dir) => {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (game.phase !== 'aim') return;
      const putt = P.CLUBS[game.clubIdx].putter;
      game.aim += dir * (putt ? 0.0025 : 0.004);
      game.aimHold = dir;
      game.aimHoldT = -0.25; // negative = delay before auto-repeat starts
    });
    const stop = () => { game.aimHold = 0; };
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointercancel', stop);
    btn.addEventListener('pointerleave', stop);
  };
  holdAim(els.aimLeft, -1);
  holdAim(els.aimRight, 1);

  els.clubPrev.addEventListener('click', () => changeClub(-1));
  els.clubNext.addEventListener('click', () => changeClub(1));
  els.minimap.addEventListener('click', () => {
    game.overview = !game.overview;
    setHint(game.overview ? 'Overview — tap the map to return' : '');
  });
  els.btnMenu.addEventListener('click', showMenu);
  els.btnCard.addEventListener('click', () => showScorecard(false));
  const syncSound = () => els.btnSound.classList.toggle('off', audio.muted);
  els.btnSound.addEventListener('click', () => {
    audio.unlock();
    audio.toggle();
    syncSound();
  });
  syncSound();

  window.addEventListener('keydown', (e) => {
    if (e.target === els.seed) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) pressSwing();
    } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      if (game.phase === 'aim') {
        const putt = P.CLUBS[game.clubIdx].putter;
        game.aim += (e.code === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.03 : putt ? 0.003 : 0.006);
      }
      e.preventDefault();
    } else if (e.code === 'ArrowUp') {
      changeClub(-1);
      e.preventDefault();
    } else if (e.code === 'ArrowDown') {
      changeClub(1);
      e.preventDefault();
    } else if (e.code === 'KeyM') {
      audio.toggle();
      syncSound();
    } else if (e.code === 'KeyV') {
      game.overview = !game.overview;
    } else if (e.code === 'KeyC') {
      if (els.scorecard.classList.contains('hidden')) showScorecard(false);
      else if (game.phase !== 'holeDone') els.scorecard.classList.add('hidden');
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') releaseSwing();
  });

  // Block browser gestures that fight the game on mobile.
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
  document.addEventListener('contextmenu', (e) => {
    if (e.target !== els.seed) e.preventDefault();
  });

  // Menu wiring.
  els.seed.addEventListener('input', updatePreview);
  els.dice.addEventListener('click', () => {
    els.seed.value = randomSeed();
    updatePreview();
  });
  els.play.addEventListener('click', () => {
    audio.unlock();
    const seed = els.seed.value.trim() || randomSeed();
    clearSave();
    startRound(seed);
  });
  els.continueBtn.addEventListener('click', () => {
    audio.unlock();
    if (game.inRound && game.hole) {
      hideMenu();
      if (game.phase === 'holeDone') showScorecard(true);
      return;
    }
    const s = loadSave();
    if (s) startRound(s.seed, s.holeIdx, s.scores);
  });

  // ---------------------------------------------------------------------------------------------
  // Boot
  const params = new URLSearchParams(location.search);
  els.seed.value = params.get('seed') || randomSeed();
  resize();
  showMenu();
  requestAnimationFrame((t) => {
    lastT = t;
    requestAnimationFrame(frame);
  });

  Golf.game = game;
})();
