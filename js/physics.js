// Ball flight (drag, Magnus lift, sidespin, wind), bounces, rolling on slopes, trees and the cup.
(function () {
  const Golf = globalThis.Golf;
  const T = Golf.T;
  const { clamp } = Golf.util;

  const G = 9.81;
  const KD = 0.0043; // 0.5 * rho * Cd * A / m  (Cd ~ 0.23)
  const KL = 0.0187; // 0.5 * rho * A / m, multiplied by a lift coefficient
  const CUP_R = 0.09; // generous capture radius for the ball centre
  const DT = 1 / 240;

  // speed (m/s), launch angle (deg), lift coefficient from backspin, bite on landing, chip speed (m/s).
  // Speeds are solved for typical carries; chip speeds for bump-and-run totals (see tests/run.js).
  const CLUBS = [
    { id: 'DR', name: 'Driver', short: 'Dr', speed: 70.52, launch: 11.5, lift: 0.21, bite: 0.1 },
    { id: '3W', name: '3 Wood', short: '3W', speed: 64.29, launch: 13, lift: 0.22, bite: 0.15 },
    { id: '5W', name: '5 Wood', short: '5W', speed: 60.85, launch: 14.5, lift: 0.22, bite: 0.2 },
    { id: '3H', name: '3 Hybrid', short: '3H', speed: 58.84, launch: 15, lift: 0.22, bite: 0.22, rescue: true, chip: 13.5 },
    { id: '4H', name: '4 Hybrid', short: '4H', speed: 56.41, launch: 16, lift: 0.225, bite: 0.25, rescue: true, chip: 13.16 },
    { id: '5I', name: '5 Iron', short: '5i', speed: 54.04, launch: 16.5, lift: 0.225, bite: 0.3, chip: 12.95 },
    { id: '6I', name: '6 Iron', short: '6i', speed: 51.14, launch: 18, lift: 0.23, bite: 0.35, chip: 12.63 },
    { id: '7I', name: '7 Iron', short: '7i', speed: 48.06, launch: 20, lift: 0.24, bite: 0.42, chip: 12.34 },
    { id: '8I', name: '8 Iron', short: '8i', speed: 45.2, launch: 22, lift: 0.25, bite: 0.5, chip: 11.9 },
    { id: '9I', name: '9 Iron', short: '9i', speed: 42, launch: 24.5, lift: 0.26, bite: 0.6, chip: 11.5 },
    { id: 'PW', name: 'Pitching Wedge', short: 'PW', speed: 38.98, launch: 27, lift: 0.27, bite: 0.7, chip: 11.07 },
    { id: '52', name: '52° Wedge', short: '52°', speed: 35.63, launch: 31, lift: 0.275, bite: 0.8, chip: 14.07 },
    { id: '56', name: '56° Wedge', short: '56°', speed: 32.41, launch: 34, lift: 0.28, bite: 0.9, chip: 13.11, flop: true, sand: true },
    { id: '60', name: '60° Wedge', short: '60°', speed: 29.27, launch: 39, lift: 0.29, bite: 1.0, chip: 11.44, flop: true, sand: true },
    { id: 'PT', name: 'Putter', short: 'Pt', putter: true },
  ];
  const PUTTER = CLUBS.length - 1;

  // Shot types reshape a club's trajectory.  Chips and punches are metered by total distance (carry + roll).
  const SHOTS = {
    full: { name: 'Full', desc: 'Full swing' },
    three: { name: '¾', desc: 'Controlled ¾ swing', speed: 0.7, launch: 1.08, lift: 1, bite: 1.1 },
    chip: { name: 'Chip', desc: 'Low bump & run', launch: 0.75, lift: 0.6, bite: 0.35, metric: 'total', surface: 'green' },
    flop: { name: 'Flop', desc: 'High & soft', speed: 0.62, launchAbs: 54, lift: 1.1, bite: 1.5 },
    punch: { name: 'Punch', desc: 'Low under trees', speed: 0.8, launch: 0.45, lift: 0.4, bite: 0.4, metric: 'total', surface: 'fairway' },
    putt: { name: 'Putt', desc: 'Roll it', metric: 'total' },
  };
  const SHOT_ORDER = ['full', 'three', 'chip', 'flop', 'punch', 'putt'];
  function shotAllowed(clubIdx, shot) {
    const c = CLUBS[clubIdx];
    if (c.putter) return shot === 'putt';
    switch (shot) {
      case 'full': return true;
      case 'three':
      case 'punch': return c.id !== 'DR';
      case 'chip': return c.chip != null;
      case 'flop': return !!c.flop;
      default: return false;
    }
  }
  function shotsFor(clubIdx) {
    return SHOT_ORDER.filter((s) => shotAllowed(clubIdx, s));
  }
  function clubsFor(shot) {
    return CLUBS.map((_, i) => i).filter((i) => shotAllowed(i, shot));
  }
  function shotParams(clubIdx, shot) {
    const c = CLUBS[clubIdx];
    const m = SHOTS[shot] || SHOTS.full;
    return {
      speed: shot === 'chip' ? c.chip : c.speed * (m.speed ?? 1),
      surface: m.surface || 'green',
      launch: m.launchAbs ?? c.launch * (m.launch ?? 1),
      lift: c.lift * (m.lift ?? 1),
      bite: c.bite * (m.bite ?? 1),
      metric: m.metric || 'carry',
    };
  }

  // How each surface treats the ball.  e: bounce restitution, mu: share of tangential speed lost per impact,
  // roll: rolling resistance coefficient, grab: how much backspin bites.
  const SURF = [];
  SURF[T.OOB] = { e: 0.22, mu: 0.6, roll: 0.45, grab: 0.2 };
  SURF[T.DEEP] = { e: 0.15, mu: 0.75, roll: 0.75, grab: 0.1 };
  SURF[T.ROUGH] = { e: 0.24, mu: 0.58, roll: 0.36, grab: 0.25 };
  SURF[T.FIRST] = { e: 0.32, mu: 0.45, roll: 0.2, grab: 0.5 };
  SURF[T.FAIRWAY] = { e: 0.38, mu: 0.35, roll: 0.12, grab: 0.7 };
  SURF[T.TEE] = { e: 0.36, mu: 0.4, roll: 0.14, grab: 0.6 };
  SURF[T.FRINGE] = { e: 0.34, mu: 0.38, roll: 0.1, grab: 0.8 };
  SURF[T.GREEN] = { e: 0.3, mu: 0.38, roll: 0.065, grab: 1.0 };
  SURF[T.SAND] = { e: 0.04, mu: 0.95, roll: 1.6, grab: 0.1 };
  SURF[T.WATER] = { e: 0, mu: 1, roll: 5, grab: 0 };

  // Lie effects on the next shot.
  function lieEffect(terrain, club) {
    const c = CLUBS[club];
    if (c.putter) return { speed: 1, spin: 0, error: terrain === T.GREEN || terrain === T.FRINGE ? 1 : 1.4, label: '' };
    switch (terrain) {
      // Hybrids glide through long grass better than irons.
      case T.ROUGH: return c.rescue ? { speed: 0.94, spin: 0.7, error: 1.15, label: '-6%' } : { speed: 0.88, spin: 0.6, error: 1.3, label: '-12%' };
      case T.DEEP:
      case T.OOB: return c.rescue ? { speed: 0.82, spin: 0.5, error: 1.4, label: '-18%' } : { speed: 0.72, spin: 0.4, error: 1.7, label: '-28%' };
      case T.SAND:
        return c.sand ? { speed: 0.85, spin: 0.5, error: 1.3, label: '-15%' } : { speed: 0.62, spin: 0.4, error: 1.6, label: '-38%' };
      case T.FIRST: return { speed: 0.96, spin: 0.85, error: 1.1, label: '-4%' };
      case T.TEE: return { speed: 1, spin: 1, error: 1, label: '' };
      default:
        if (c.id === 'DR') return { speed: 0.93, spin: 1, error: 1.25, label: '-7%' };
        return { speed: 1, spin: 1, error: 1, label: '' };
    }
  }

  // ---- Flight on a flat plane with no wind, used to build power -> carry tables.
  function flatCarry(speed, launchDeg, lift) {
    const a = (launchDeg * Math.PI) / 180;
    let x = 0, z = 0, vx = speed * Math.cos(a), vz = speed * Math.sin(a), spin = lift;
    for (let i = 0; i < 240 * 20; i++) {
      const sp = Math.hypot(vx, vz);
      const ax = -KD * sp * vx - KL * spin * sp * vz;
      const az = -KD * sp * vz + KL * spin * sp * vx - G;
      vx += ax * DT; vz += az * DT;
      x += vx * DT; z += vz * DT;
      spin *= Math.exp(-DT / 7);
      if (z < 0 && vz < 0) return x;
    }
    return x;
  }

  // Calm, flat simulation of a shot including bounces and roll on a green-speed surface.
  const FLAT_GREEN = {
    height: () => 0, grad: () => ({ x: 0, y: 0 }), terrainAt: () => T.GREEN, treesNear: () => [],
    wind: { x: 0, y: 0, speed: 0 }, pin: { x: 1e9, y: 1e9 },
  };
  const FLAT_FAIRWAY = { ...FLAT_GREEN, terrainAt: () => T.FAIRWAY };
  function simulateFlat(p, speed, lieSpin = 1) {
    const surf = p.surface === 'fairway' ? FLAT_FAIRWAY : FLAT_GREEN;
    const a = (p.launch * Math.PI) / 180;
    const b = createBall(0, 0, FLAT_GREEN);
    b.vx = speed * Math.cos(a);
    b.vz = speed * Math.sin(a);
    b.spin = p.lift * (0.6 + 0.4 * lieSpin);
    b.bite = p.bite * lieSpin;
    b.z = 0.001;
    b.state = 'air';
    b.lastDry = { x: 0, y: 0 };
    let carry = null;
    for (let i = 0; i < 2000 && b.state !== 'rest'; i++) {
      for (const e of step(b, surf, 1 / 30)) if (e.type === 'bounce' && carry == null) carry = e.x;
    }
    return { carry: carry ?? b.x, total: b.x };
  }

  const tables = new Map();
  // Distance (carry, or total for chips) for speed fractions 0..1, flat, calm, clean lie.
  function shotTable(clubIdx, shot = 'full') {
    const key = clubIdx + ':' + shot;
    if (tables.has(key)) return tables.get(key);
    const p = shotParams(clubIdx, shot);
    const tbl = [];
    for (let i = 0; i <= 40; i++) {
      const v = p.speed * (i / 40);
      tbl.push(p.metric === 'total' ? simulateFlat(p, v).total : flatCarry(v, p.launch, p.lift));
    }
    tables.set(key, tbl);
    return tbl;
  }
  function carryTable(clubIdx) {
    return shotTable(clubIdx, 'full');
  }
  function fullCarry(clubIdx, shot = 'full') {
    const t = shotTable(clubIdx, shot);
    return t[t.length - 1];
  }
  // Power in the meter is linear in the shot's distance metric; invert the table to find the speed fraction.
  function speedFractionForPower(clubIdx, power, shot = 'full') {
    const t = shotTable(clubIdx, shot);
    if (power === 1) return 1;
    const target = clamp(power, 0, 1.1) * t[t.length - 1];
    for (let i = 1; i < t.length; i++) {
      if (t[i] >= target) return (i - 1 + (target - t[i - 1]) / (t[i] - t[i - 1])) / 40;
    }
    return 1 + (target - t[t.length - 1]) / (t[t.length - 1] - t[t.length - 2]) / 40;
  }
  // Expected {carry, total} for a shot from a given lie (flat, calm), used for meters and guides.
  function shotDistance(clubIdx, shot, lie, power) {
    const p = shotParams(clubIdx, shot);
    const le = lieEffect(lie, clubIdx);
    const launch = p.launch + (lie === T.SAND ? 4 : 0);
    const v = p.speed * speedFractionForPower(clubIdx, power, shot) * le.speed;
    const r = simulateFlat({ ...p, launch }, v, le.spin);
    return r;
  }

  // ---- Ball ------------------------------------------------------------------------------------
  function createBall(x, y, hole) {
    return { x, y, z: hole.height(x, y), vx: 0, vy: 0, vz: 0, spin: 0, side: 0, bite: 0, state: 'rest', t: 0, hitTrees: new Set(), bounces: 0 };
  }

  // power 0..1(+), accuracy error -1..1 (+ = slice to the right), aim angle in radians (screen space).
  function launch(ball, hole, clubIdx, power, error, aim, putterRange, shot = 'full') {
    const c = CLUBS[clubIdx];
    const lie = hole.terrainAt(ball.x, ball.y);
    const le = lieEffect(lie, clubIdx);
    ball.hitTrees = new Set();
    ball.t = 0;
    ball.bounces = 0;
    ball.maxHeight = 0;
    ball.start = { x: ball.x, y: ball.y };
    ball.lastDry = { x: ball.x, y: ball.y };
    if (c.putter) {
      const surf = SURF[T.GREEN];
      const dist = putterRange * clamp(power, 0, 1.1);
      const speed = Math.sqrt(2 * surf.roll * G * dist);
      const dir = aim + error * le.error * 0.035;
      ball.vx = Math.cos(dir) * speed;
      ball.vy = Math.sin(dir) * speed;
      ball.vz = 0;
      ball.spin = 0;
      ball.side = 0;
      ball.state = 'roll';
      return;
    }
    const e = error * le.error;
    const p = shotParams(clubIdx, shot);
    const speed = p.speed * speedFractionForPower(clubIdx, power, shot) * le.speed;
    const launchA = ((p.launch + (lie === T.SAND ? 4 : 0)) * Math.PI) / 180;
    const dir = aim + e * 0.03;
    const vh = speed * Math.cos(launchA);
    ball.vx = Math.cos(dir) * vh;
    ball.vy = Math.sin(dir) * vh;
    ball.vz = speed * Math.sin(launchA);
    ball.spin = p.lift * (0.6 + 0.4 * le.spin);
    ball.side = e * 0.05;
    ball.bite = p.bite * le.spin;
    ball.z = hole.height(ball.x, ball.y) + 0.02;
    ball.state = 'air';
  }

  // Advance the simulation by `dt` seconds. Returns an array of events.
  function step(ball, hole, dt, rand = Math.random) {
    const events = [];
    let remaining = dt;
    while (remaining > 1e-9 && ball.state !== 'rest' && ball.state !== 'holed' && ball.state !== 'water') {
      const h = Math.min(DT, remaining);
      remaining -= h;
      ball.t += h;
      if (ball.state === 'air') airStep(ball, hole, h, events, rand);
      else if (ball.state === 'roll') rollStep(ball, hole, h, events, rand);
      if (ball.t > 40 && ball.state === 'roll') { ball.state = 'rest'; events.push({ type: 'rest' }); }
    }
    return events;
  }

  function airStep(ball, hole, dt, events, rand) {
    const ground = hole.height(ball.x, ball.y);
    const agl = ball.z - ground;
    const windScale = clamp(0.45 + agl / 25, 0.45, 1);
    const rx = ball.vx - hole.wind.x * windScale, ry = ball.vy - hole.wind.y * windScale, rz = ball.vz;
    const sp = Math.hypot(rx, ry, rz) || 1e-6;
    const hsp = Math.hypot(rx, ry) || 1e-6;
    // Drag.
    let ax = -KD * sp * rx, ay = -KD * sp * ry, az = -KD * sp * rz - G;
    // Backspin lift, perpendicular to the relative velocity in its vertical plane.
    const lx = -rx * rz, ly = -ry * rz, lz = hsp * hsp;
    const ln = Math.hypot(lx, ly, lz) || 1e-6;
    const L = (KL * ball.spin * sp * sp) / ln;
    ax += lx * L; ay += ly * L; az += lz * L;
    // Sidespin: push to the right of travel (screen coords, y down => right = (-vy, vx)).
    const S = KL * ball.side * sp * sp;
    ax += (-ry / hsp) * S; ay += (rx / hsp) * S;

    ball.vx += ax * dt; ball.vy += ay * dt; ball.vz += az * dt;
    ball.x += ball.vx * dt; ball.y += ball.vy * dt; ball.z += ball.vz * dt;
    ball.spin *= Math.exp(-dt / 7);
    ball.side *= Math.exp(-dt / 7);
    ball.maxHeight = Math.max(ball.maxHeight, agl);

    treeCollideAir(ball, hole, events, rand);
    trackDry(ball, hole);

    const gh = hole.height(ball.x, ball.y);
    if (ball.z <= gh && ball.vz < 0) impact(ball, hole, gh, events, rand);
  }

  function impact(ball, hole, gh, events, rand) {
    const terr = hole.terrainAt(ball.x, ball.y);
    ball.z = gh;
    if (terr === T.WATER) {
      ball.state = 'water';
      events.push({ type: 'water', x: ball.x, y: ball.y });
      return;
    }
    // Dunk straight into the cup.
    const dPin = Math.hypot(ball.x - hole.pin.x, ball.y - hole.pin.y);
    if (dPin < CUP_R * 1.2 && Math.hypot(ball.vx, ball.vy) < 6) {
      ball.state = 'holed';
      events.push({ type: 'holed', dunk: true });
      return;
    }
    const surf = SURF[terr];
    const g = hole.grad(ball.x, ball.y);
    let nx = -g.x, ny = -g.y, nz = 1;
    const nl = Math.hypot(nx, ny, nz);
    nx /= nl; ny /= nl; nz /= nl;
    const vn = ball.vx * nx + ball.vy * ny + ball.vz * nz;
    let tx = ball.vx - vn * nx, ty = ball.vy - vn * ny, tz = ball.vz - vn * nz;
    const tl = Math.hypot(tx, ty, tz) || 1e-6;
    // Coulomb friction plus spin "bite" which can even pull the ball back on firm greens.
    const grip = ball.bite * surf.grab * Math.abs(vn) * 0.75;
    const newT = Math.max(tl * (1 - surf.mu) - grip, -Math.min(2.5, 0.3 * tl * ball.bite * surf.grab));
    const k = newT / tl;
    tx *= k; ty *= k; tz *= k;
    const out = -vn * surf.e;
    ball.vx = tx + nx * out; ball.vy = ty + ny * out; ball.vz = tz + nz * out;
    ball.spin *= 0.4;
    ball.side *= 0.3;
    ball.bite *= 0.35;
    ball.bounces++;
    events.push({ type: 'bounce', terrain: terr, strength: Math.abs(vn), x: ball.x, y: ball.y });
    if (out < 1.3) {
      ball.state = 'roll';
      ball.vz = 0;
      ball.z = gh;
    } else {
      ball.z = gh + 0.001;
    }
  }

  function rollStep(ball, hole, dt, events, rand) {
    const terr = hole.terrainAt(ball.x, ball.y);
    if (terr === T.WATER) {
      ball.state = 'water';
      events.push({ type: 'water', x: ball.x, y: ball.y });
      return;
    }
    const surf = SURF[terr];
    const g = hole.grad(ball.x, ball.y);
    let sp = Math.hypot(ball.vx, ball.vy);
    // Gravity along the slope (5/7 for a rolling sphere) and rolling resistance.
    const gx = -G * g.x * (5 / 7), gy = -G * g.y * (5 / 7);
    // Longer grass grabs a slow ball harder; greens stay pure so putts behave predictably.
    const slowGrip = terr === T.GREEN || terr === T.FRINGE ? 0 : Math.max(0, 1 - sp / 2.5);
    const fr = surf.roll * G * (1 + slowGrip);
    if (sp < 0.04) {
      const slopeA = Math.hypot(gx, gy);
      if (slopeA < fr * 1.3) {
        ball.vx = 0; ball.vy = 0;
        ball.state = 'rest';
        events.push({ type: 'rest' });
        return;
      }
    }
    let ax = gx, ay = gy;
    if (sp > 1e-6) { ax -= (fr * ball.vx) / sp; ay -= (fr * ball.vy) / sp; }
    const nvx = ball.vx + ax * dt, nvy = ball.vy + ay * dt;
    // Friction shouldn't reverse direction on its own.
    if (sp > 1e-6 && nvx * ball.vx + nvy * ball.vy < 0 && Math.hypot(gx, gy) < fr) {
      ball.vx = 0; ball.vy = 0;
    } else {
      ball.vx = nvx; ball.vy = nvy;
    }
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    ball.z = hole.height(ball.x, ball.y);
    sp = Math.hypot(ball.vx, ball.vy);

    // Cup.
    const dx = ball.x - hole.pin.x, dy = ball.y - hole.pin.y;
    const d = Math.hypot(dx, dy);
    if (d < CUP_R) {
      if (sp < 1.45) {
        ball.state = 'holed';
        ball.x = hole.pin.x; ball.y = hole.pin.y;
        events.push({ type: 'holed' });
        return;
      }
      if (!ball.lipped && sp < 2.2) {
        ball.lipped = true;
        const ang = Math.atan2(ball.vy, ball.vx) + (rand() - 0.5) * 1.6;
        ball.vx = Math.cos(ang) * sp * 0.55;
        ball.vy = Math.sin(ang) * sp * 0.55;
        events.push({ type: 'lip' });
      }
    } else if (d > CUP_R * 2) {
      ball.lipped = false;
    }
    treeCollideGround(ball, hole, events);
    trackDry(ball, hole);
  }

  function trackDry(ball, hole) {
    const t = hole.terrainAt(ball.x, ball.y);
    if (t !== T.WATER && t !== T.OOB) {
      ball.lastDry.x = ball.x;
      ball.lastDry.y = ball.y;
    }
  }

  function treeCollideAir(ball, hole, events, rand) {
    for (const t of hole.treesNear(ball.x, ball.y)) {
      const dx = ball.x - t.x, dy = ball.y - t.y;
      const d = Math.hypot(dx, dy);
      const zt = ball.z - t.base;
      if (zt > t.h) continue;
      // Pines taper toward the top.
      const canopyBottom = t.h * (t.pine ? 0.2 : 0.35);
      const rAt = t.pine ? t.r * clamp(1.1 - (zt - canopyBottom) / (t.h - canopyBottom), 0.15, 1) : t.r;
      if (zt > canopyBottom && d < rAt) {
        if (!ball.hitTrees.has(t)) {
          ball.hitTrees.add(t);
          const k = 0.2 + rand() * 0.25;
          const ang = Math.atan2(ball.vy, ball.vx) + (rand() - 0.5) * 2.4;
          const hs = Math.hypot(ball.vx, ball.vy) * k;
          ball.vx = Math.cos(ang) * hs;
          ball.vy = Math.sin(ang) * hs;
          ball.vz = Math.min(ball.vz, 0) * 0.3;
          ball.spin = 0;
          ball.side = 0;
          events.push({ type: 'tree', x: ball.x, y: ball.y, z: ball.z });
        }
      } else if (d < t.trunk + 0.03 && zt < canopyBottom + 0.5) {
        reflectTrunk(ball, t, dx, dy, d, 0.5);
        events.push({ type: 'trunk', x: ball.x, y: ball.y });
      }
    }
  }

  function treeCollideGround(ball, hole, events) {
    for (const t of hole.treesNear(ball.x, ball.y)) {
      const dx = ball.x - t.x, dy = ball.y - t.y;
      const d = Math.hypot(dx, dy);
      if (d < t.trunk + 0.03) {
        reflectTrunk(ball, t, dx, dy, d, 0.4);
        events.push({ type: 'trunk', x: ball.x, y: ball.y });
      }
    }
  }

  function reflectTrunk(ball, t, dx, dy, d, e) {
    const nx = dx / (d || 1), ny = dy / (d || 1);
    const vn = ball.vx * nx + ball.vy * ny;
    if (vn < 0) {
      ball.vx -= (1 + e) * vn * nx;
      ball.vy -= (1 + e) * vn * ny;
    }
    ball.x = t.x + nx * (t.trunk + 0.04);
    ball.y = t.y + ny * (t.trunk + 0.04);
  }

  Golf.physics = {
    G, CUP_R, CLUBS, PUTTER, SURF, SHOTS, SHOT_ORDER,
    lieEffect, carryTable, shotTable, fullCarry, speedFractionForPower, flatCarry, shotsFor, clubsFor, shotAllowed, shotParams, shotDistance,
    createBall, launch, step,
  };
})();
