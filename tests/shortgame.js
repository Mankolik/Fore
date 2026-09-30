// Short-game balance harness: plays greenside shots on real generated holes with human-like
// timing noise and reports how close each shot type finishes.  Run: node tests/shortgame.js
const path = require('path');
for (const f of ['util', 'biomes', 'course', 'physics']) require(path.join(__dirname, '..', 'js', f + '.js'));
const Golf = globalThis.Golf;
const { T, physics: P } = Golf;

const SEEDS = (process.argv[2] || 'sg1,sg2,sg3,sg4').split(',');
const PER_HOLE = +(process.argv[3] || 6);
let rngState = 12345;
const rand = () => ((rngState = (rngState * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand());

// Human model: ~25 ms jitter releasing the backswing, ~35 ms jitter on the accuracy tap.
const BACK_JITTER = 0.025, TAP_JITTER = 0.035;
const Golfy = { backswingTime: (shot) => 1.05 * (shot === 'full' || shot === 'punch' ? 1 : 1.3) };

function metricAt(i, shot, lie, p) {
  const r = P.shotDistance(i, shot, lie, p);
  return P.shotParams(i, shot).metric === 'total' ? r.total : r.carry;
}
function pinPower(i, shot, lie, dist) {
  const full = metricAt(i, shot, lie, 1);
  if (dist >= full) return null;
  let lo = 0, hi = 1;
  for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; if (metricAt(i, shot, lie, m) < dist) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
// Chips: the most lofted club that lands on the green and still reaches the pin (grass-aware power).
function chipPlan(hole, x, y, aim, lie, dist) {
  const clubs = P.clubsFor('chip').slice().reverse();
  for (const i of clubs) {
    const r = P.powerToReach(hole, x, y, aim, i, 'chip', lie, dist);
    if (r.power > 1) continue;
    if (hole.terrainAt(r.land.x, r.land.y) !== T.GREEN) continue;
    return { i, power: r.power };
  }
  return null;
}
function bestClub(shot, lie, dist) {
  let best = null;
  for (const i of P.clubsFor(shot)) {
    if (P.CLUBS[i].putter) continue;
    const m = metricAt(i, shot, lie, 1);
    if (m >= dist && (!best || m < best.m)) best = { i, m };
  }
  return best && best.i;
}

const stats = {};
const diag = {};
function record(key, prox, holed, bad) {
  const s = (stats[key] = stats[key] || { n: 0, sum: 0, within3: 0, holed: 0, bad: 0, list: [] });
  s.n++; s.sum += prox; s.list.push(prox); if (prox < 3) s.within3++; if (holed) s.holed++; if (bad) s.bad++;
}

for (const seed of SEEDS) {
  const course = Golf.generateCourse(seed);
  for (let h = 0; h < 9; h++) {
    const hole = course.getHole(h);
    let made = 0, tries = 0;
    while (made < PER_HOLE && tries++ < 400) {
      const a = rand() * Math.PI * 2, d = 6 + rand() * 24;
      const x = hole.pin.x + Math.cos(a) * d, y = hole.pin.y + Math.sin(a) * d;
      const lie = hole.terrainAt(x, y);
      if (![T.FIRST, T.FRINGE, T.FAIRWAY, T.ROUGH, T.SAND].includes(lie)) continue;
      made++;
      const dist = Math.hypot(hole.pin.x - x, hole.pin.y - y);
      // Is there sand/water between ball and pin?  Report "clear" vs "over trouble" separately.
      let trouble = false;
      for (let k = 1; k < 20; k++) { const t = hole.terrainAt(x + (hole.pin.x - x) * k / 20, y + (hole.pin.y - y) * k / 20); if (t === T.SAND || t === T.WATER) trouble = true; }
      const scen = lie === T.SAND ? 'bunker' : trouble ? 'over-trouble' : 'clear';
      const aim = Math.atan2(hole.pin.y - y, hole.pin.x - x);
      for (const shot of ['chip', 'three', 'flop']) {
        let i, pp;
        if (shot === 'chip') {
          const plan = chipPlan(hole, x, y, aim, lie, dist);
          if (!plan) { record(`${scen}/chip-n/a`, 0, false, false); continue; }
          ({ i, power: pp } = plan);
        } else {
          i = bestClub(shot, lie, dist);
          if (i == null) continue;
          pp = pinPower(i, shot, lie, dist);
        }
        if (pp == null) continue;
        for (let rep = 0; rep < 3; rep++) {
          const power = Math.max(0.02, pp + gauss() * BACK_JITTER / Golfy.backswingTime(shot));
          const sw = P.swingSize(shot, power);
          const retSpeed = Math.max(0.12, sw / (0.5 + 0.22 * sw));
          const m = gauss() * TAP_JITTER * retSpeed;
          const swt = P.sweetSpot(sw, shot);
          let e = 0; if (Math.abs(m) > swt) e = Math.sign(m) * Math.min(1, (Math.abs(m) - swt) / (0.16 - swt));
          const b = P.createBall(x, y, hole);
          P.launch(b, hole, i, power, e, aim, 20, shot, rand);
          let n = 0; while (!['rest', 'holed', 'water'].includes(b.state) && n++ < 3000) P.step(b, hole, 1 / 30, rand);
          const prox = b.state === 'holed' ? 0 : b.state === 'water' ? 30 : Math.hypot(b.x - hole.pin.x, b.y - hole.pin.y);
          const k2 = `${scen}/${shot}`;
          const dd = (diag[k2] = diag[k2] || { along: 0, side: 0, n: 0 });
          dd.along += Math.abs((b.x - hole.pin.x) * Math.cos(aim) + (b.y - hole.pin.y) * Math.sin(aim));
          dd.side += Math.abs(-(b.x - hole.pin.x) * Math.sin(aim) + (b.y - hole.pin.y) * Math.cos(aim));
          dd.n++;
          const endT = hole.terrainAt(b.x, b.y);
          record(`${scen}/${shot}`, prox, b.state === 'holed', b.state === 'water' || endT === T.SAND || endT === T.OOB);
        }
      }
    }
  }
}
const rows = Object.entries(stats).sort();
console.log('scenario/shot'.padEnd(20), 'n'.padStart(4), 'avg m'.padStart(7), 'median'.padStart(7), '<3m'.padStart(6), 'holed'.padStart(6), 'trouble'.padStart(8));
for (const [k, s] of rows) {
  s.list.sort((a, b) => a - b);
  console.log(k.padEnd(20), String(s.n).padStart(4), (s.sum / s.n).toFixed(1).padStart(7), s.list[s.n >> 1].toFixed(1).padStart(7),
    ((100 * s.within3) / s.n).toFixed(0).padStart(5) + '%', ((100 * s.holed) / s.n).toFixed(0).padStart(5) + '%', ((100 * s.bad) / s.n).toFixed(0).padStart(7) + '%');
}
if (process.env.DIAG) for (const [k, d] of Object.entries(diag).sort()) console.log(k.padEnd(20), 'mean |along|', (d.along / d.n).toFixed(1), ' mean |side|', (d.side / d.n).toFixed(1));
