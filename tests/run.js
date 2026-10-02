// Headless sanity tests for course generation and physics.  Run with: node tests/run.js
const path = require('path');
for (const f of ['util', 'biomes', 'course', 'physics']) require(path.join(__dirname, '..', 'js', f + '.js'));
const Golf = globalThis.Golf;
const { T, physics: P } = Golf;

let failures = 0;
// A random source whose Gaussian draw is exactly zero and that never triggers a mishit on clean lies.
const NO_NOISE = () => 0.25;
function check(cond, msg) {
  if (!cond) {
    failures++;
    console.error('FAIL:', msg);
  }
}

// --- Courses -------------------------------------------------------------------------------------
const seeds = ['alpha', 'bravo', 'charlie', 'delta', 'echo', '12345'];
for (const seed of seeds) {
  const c = Golf.generateCourse(seed);
  check(c.pars.length === 9 && c.pars.reduce((a, b) => a + b, 0) === 36, `${seed}: par 36 layout`);
  check(Golf.generateCourse(seed).name === c.name, `${seed}: deterministic name`);
  for (let i = 0; i < 9; i++) {
    const h = c.getHole(i);
    const tag = `${seed} hole ${i + 1}`;
    check(h.terrainAt(h.tee.x, h.tee.y) === T.TEE, `${tag}: ball starts on the tee`);
    check(h.terrainAt(h.pin.x, h.pin.y) === T.GREEN, `${tag}: pin is on the green`);
    check(h.sampleIdx(h.fGreen, h.pin.x, h.pin.y) < -2, `${tag}: pin away from green edge`);
    check(h.sampleIdx(h.fWater, h.tee.x, h.tee.y) > 15, `${tag}: no water on the tee`);
    const lens = { 3: [85, 210], 4: [245, 420], 5: [440, 545] }[h.par].map((v) => v * c.biome.gen.lengthK);
    check(h.length >= lens[0] - 1 && h.length <= lens[1] + 1, `${tag}: par ${h.par} length ${h.length.toFixed(0)}`);
    for (const t of h.trees) {
      if (t.fairway) continue; // the occasional lone fairway tree is deliberate
      const terr = h.terrainAt(t.x, t.y);
      check(terr !== T.FAIRWAY && terr !== T.GREEN && terr !== T.WATER && terr !== T.TEE, `${tag}: tree on ${Golf.TERRAIN_NAMES[terr]}`);
    }
  }
}

// --- Biomes: every environment generates valid, playable holes -----------------------------------
{
  const found = {};
  for (let k = 0; k < 400 && Object.keys(found).length < Golf.BIOME_ORDER.length; k++) {
    const b = Golf.biomeForSeed('biome' + k);
    if (!found[b.id]) found[b.id] = 'biome' + k;
  }
  check(Object.keys(found).length === Golf.BIOME_ORDER.length, `all biomes reachable from seeds (${Object.keys(found).join(', ')})`);
  for (const [id, seed] of Object.entries(found)) {
    const c = Golf.generateCourse(seed);
    check(c.biome.id === id && Golf.generateCourse(seed).biome.id === id, `${id}: deterministic per seed`);
    for (let i = 0; i < 9; i += 2) {
      const h = c.getHole(i);
      check(h.terrainAt(h.tee.x, h.tee.y) === T.TEE && h.terrainAt(h.pin.x, h.pin.y) === T.GREEN, `${id} hole ${i + 1}: tee and pin valid`);
      check(h.trees.every((t) => t.kind && t.h > 0 && t.r > 0), `${id} hole ${i + 1}: trees styled`);
    }
    // Physics environment: meters stay linear and putts accurate in every biome.
    P.setEnvironment(c.biome.env, id);
    const full = P.shotDistance(8, 'full', T.FAIRWAY, 1).carry, half = P.shotDistance(8, 'full', T.FAIRWAY, 0.5).carry;
    check(Math.abs(half - full / 2) < 3, `${id}: half power carries half (${half.toFixed(0)} of ${full.toFixed(0)})`);
  }
  P.setEnvironment({}, 'earth');
}
// Winter ice: a ball rolling onto a frozen pond keeps going instead of being a hazard.
{
  P.setEnvironment(Golf.BIOMES.winter.env, 'winter');
  const ice = { W: 999, L: 999, height: () => 0, grad: () => ({ x: 0, y: 0 }), terrainAt: () => T.WATER, treesNear: () => [], wind: { x: 0, y: 0 }, pin: { x: -9, y: -9 } };
  const b = P.createBall(500, 900, ice);
  b.vx = 0; b.vy = -5; b.state = 'roll';
  while (b.state === 'roll') P.step(b, ice, 1 / 30);
  check(b.state === 'rest' && 900 - b.y > 30, `ice is playable and slippery (slid ${(900 - b.y).toFixed(0)} m)`);
  // ...and it never speeds the ball up: frozen ponds on real holes are level.
  const wc = (() => { for (let k = 0; k < 300; k++) if (Golf.biomeForSeed('w' + k).id === 'winter') return Golf.generateCourse('w' + k); })();
  for (let h = 0; h < 9; h++) {
    const hole = wc.getHole(h);
    for (const wb of hole.waters) {
      let maxSlope = 0;
      for (let a = 0; a < 6.28; a += 0.5) for (let r = 0; r < wb.R * 0.8; r += 1.5) {
        const x = wb.cx + Math.cos(a) * r, y = wb.cy + Math.sin(a) * r;
        if (hole.terrainAt(x, y) !== T.WATER) continue;
        const g = hole.grad(x, y);
        maxSlope = Math.max(maxSlope, Math.hypot(g.x, g.y));
      }
      check(maxSlope < 0.01, `winter hole ${h + 1}: frozen pond is level (max slope ${(maxSlope * 100).toFixed(1)}%)`);
    }
  }
  P.setEnvironment({}, 'earth');
}

// --- Flight --------------------------------------------------------------------------------------
const flat = {
  W: 4000, L: 4000, height: () => 0, grad: () => ({ x: 0, y: 0 }), terrainAt: () => T.TEE,
  treesNear: () => [], wind: { x: 0, y: 0, speed: 0 }, pin: { x: -99, y: -99 }, // tee lie: no driver penalty
};
let prev = Infinity;
for (let i = 0; i < P.PUTTER; i++) {
  const carry = P.fullCarry(i);
  check(carry < prev - 5, `${P.CLUBS[i].name} carries less than the previous club (${carry.toFixed(0)})`);
  prev = carry;
  const b = P.createBall(2000, 3900, flat);
  P.launch(b, flat, i, 0.5, 0, -Math.PI / 2, 20, 'full', NO_NOISE);
  let landed = null;
  while (b.state === 'air' || b.state === 'roll') {
    for (const e of P.step(b, flat, 1 / 60)) if (e.type === 'bounce' && landed == null) landed = 3900 - e.y;
  }
  check(Math.abs(landed - carry / 2) < 3, `${P.CLUBS[i].name}: half power carries half distance (${landed.toFixed(1)} vs ${(carry / 2).toFixed(1)})`);
}
check(Math.abs(P.fullCarry(0) - 228) < 5, 'driver carries ~228 m');
check(P.CLUBS.length === 15 && P.CLUBS.some((c) => c.id === '52') && P.CLUBS.some((c) => c.id === '4H'), 'full bag incl. hybrids and 52/56/60 wedges');

// Every shot type is playable with at least one club, and chips/punches are metered by total distance.
for (const shot of P.SHOT_ORDER) check(P.clubsFor(shot).length > 0, `${shot} has clubs`);
check(P.clubsFor('putt').length === 1 && P.clubsFor('putt')[0] === P.PUTTER, 'only the putter putts');
check(P.clubsFor('flop').every((i) => P.CLUBS[i].flop), 'flop only with high-loft wedges');
{
  let prevTotal = Infinity;
  for (const i of P.clubsFor('chip')) {
    const d = P.shotDistance(i, 'chip', T.FAIRWAY, 1);
    check(d.total < prevTotal && d.carry < d.total * 0.7, `${P.CLUBS[i].name} chip carries ${d.carry.toFixed(0)} and runs to ${d.total.toFixed(0)} m`);
    prevTotal = d.total;
  }
  const hy = P.CLUBS.findIndex((c) => c.id === '4H'), ir = P.CLUBS.findIndex((c) => c.id === '5I');
  check(P.lieEffect(T.ROUGH, hy).speed > P.lieEffect(T.ROUGH, ir).speed, 'hybrids come out of the rough better than irons');
}

// Sidespin: a positive error curves the ball right of the target line.
{
  const b = P.createBall(2000, 3900, flat);
  P.launch(b, flat, 3, 1, 1, -Math.PI / 2, 20, 'full', NO_NOISE);
  while (b.state !== 'rest') P.step(b, flat, 1 / 60);
  check(b.x - 2000 > 10, 'slice curves right');
}
// Headwind shortens, tailwind lengthens.
{
  const run = (wy) => {
    const h = { ...flat, wind: { x: 0, y: wy, speed: Math.abs(wy) } };
    const b = P.createBall(2000, 3900, h);
    P.launch(b, h, 4, 1, 0, -Math.PI / 2, 20, 'full', NO_NOISE);
    let land = null;
    while (b.state !== 'rest') for (const e of P.step(b, h, 1 / 60)) if (e.type === 'bounce' && land == null) land = 3900 - e.y;
    return land;
  };
  const calm = run(0), head = run(6), tail = run(-6);
  check(head < calm - 5 && tail > calm + 5, `wind effect (head ${head.toFixed(0)}, calm ${calm.toFixed(0)}, tail ${tail.toFixed(0)})`);
}

// --- Putting -------------------------------------------------------------------------------------
const green = { ...flat, terrainAt: () => T.GREEN };
for (const d of [1, 3, 8, 15]) {
  const b = P.createBall(2000, 3900, green);
  P.launch(b, green, P.PUTTER, d / 20, 0, -Math.PI / 2, 20, 'putt', NO_NOISE);
  while (b.state === 'roll') P.step(b, green, 1 / 60);
  check(Math.abs(3900 - b.y - d) < 0.05, `putt of ${d} m rolls ${(3900 - b.y).toFixed(2)} m`);
}
{
  const g = { ...green, pin: { x: 2000, y: 3895 } };
  const b = P.createBall(2000, 3900, g);
  P.launch(b, g, P.PUTTER, 5.4 / 20, 0, -Math.PI / 2, 20, 'putt', NO_NOISE);
  while (b.state === 'roll') P.step(b, g, 1 / 60);
  check(b.state === 'holed', 'a firm straight putt drops');
  const b2 = P.createBall(2000, 3900, g);
  P.launch(b2, g, P.PUTTER, 1, 0, -Math.PI / 2, 20, 'putt', NO_NOISE);
  while (b2.state === 'roll') P.step(b2, g, 1 / 60);
  check(b2.state !== 'holed', 'a putt that is far too fast does not drop');
}

// --- Every shot on real holes terminates ---------------------------------------------------------
{
  const c = Golf.generateCourse('termination');
  let worst = 0;
  for (let i = 0; i < 9; i++) {
    const h = c.getHole(i);
    for (let k = 0; k < 25; k++) {
      const b = P.createBall(h.tee.x, h.tee.y, h);
      P.launch(b, h, k % P.PUTTER, 0.3 + (k % 7) / 8, ((k % 5) - 2) / 2, -Math.PI / 2 + ((k % 9) - 4) * 0.08, 20);
      let n = 0;
      while (!['rest', 'water', 'holed'].includes(b.state) && n++ < 60 * 60) P.step(b, h, 1 / 60);
      worst = Math.max(worst, b.t);
    }
  }
  check(worst < 30, `shots settle in reasonable time (worst ${worst.toFixed(1)} s)`);
}

// --- Offline: every file the page loads is in the service worker's cache list ------------------------
{
  const fs = require('fs');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => m[1]);
  for (const r of refs) check(sw.includes(`'${r}'`), `offline cache includes ${r}`);
  for (const m of sw.matchAll(/'((?:js|css|icons)\/[^']+|[a-z.]+\.(?:html|svg|webmanifest))'/g))
    check(fs.existsSync(path.join(__dirname, '..', m[1])), `cached file exists: ${m[1]}`);
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('All checks passed');
