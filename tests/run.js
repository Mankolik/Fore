// Headless sanity tests for course generation and physics.  Run with: node tests/run.js
const path = require('path');
for (const f of ['util', 'course', 'physics']) require(path.join(__dirname, '..', 'js', f + '.js'));
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
    const lens = { 3: [85, 210], 4: [245, 420], 5: [440, 545] }[h.par];
    check(h.length >= lens[0] && h.length <= lens[1], `${tag}: par ${h.par} length ${h.length.toFixed(0)}`);
    for (const t of h.trees) {
      const terr = h.terrainAt(t.x, t.y);
      check(terr !== T.FAIRWAY && terr !== T.GREEN && terr !== T.WATER && terr !== T.TEE, `${tag}: tree on ${Golf.TERRAIN_NAMES[terr]}`);
    }
  }
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

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('All checks passed');
