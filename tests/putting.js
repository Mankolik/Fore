// Putting balance harness: putts on real generated greens with human-like noise.
// Reports make % by distance for three kinds of player read, as a baseline to keep putting feel stable
// (the pin mark for putts is deliberately flat: reading up/downhill is part of the challenge).
// Run: node tests/putting.js
const path = require('path');
for (const f of ['util', 'biomes', 'course', 'physics']) require(path.join(__dirname, '..', 'js', f + '.js'));
const Golf = globalThis.Golf;
const { T, physics: P } = Golf;

let rs = 99;
const rand = () => ((rs = (rs * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand());
const BACK_JITTER = 0.025, TAP_JITTER = 0.035;

function range(dist) { return Math.min(40, Math.max(5, Math.ceil((dist * 1.3) / 5) * 5)); }
function markPower(hole, x, y, aim, dist) {
  const R = range(dist);
  return { power: dist / R, R };
}
function roll(hole, x, y, aim, power, R, err = 0, r = rand) {
  const b = P.createBall(x, y, hole);
  P.launch(b, hole, P.PUTTER, power, err, aim, R, 'putt', r);
  let n = 0;
  while (b.state === 'roll' && n++ < 4000) P.step(b, hole, 1 / 30, r);
  return b;
}
const still = () => 0.25; // noiseless source
// Perfect read: the aim offset that holes it (or passes closest) with the pin-mark speed + 0.3 m.
function idealOffset(hole, x, y, dist) {
  const base = Math.atan2(hole.pin.y - y, hole.pin.x - x);
  let best = { off: 0, d: Infinity };
  for (let off = -0.3; off <= 0.3; off += 0.008) {
    const aim = base + off;
    const { power, R } = markPower(hole, x, y, aim, dist + 0.3);
    const b = roll(hole, x, y, aim, power, R, 0, still);
    const d = b.state === 'holed' ? -1 + Math.abs(off) * 0.01 : Math.hypot(b.x - hole.pin.x, b.y - hole.pin.y);
    if (d < best.d) best = { off, d };
  }
  return best.off;
}

const buckets = [[0.6, 1.5], [1.5, 3], [3, 5], [5, 8], [8, 14]];
const res = {};
for (const seed of ['pt1', 'pt2', 'pt3']) {
  const course = Golf.generateCourse(seed);
  for (let h = 0; h < 9; h++) {
    const hole = course.getHole(h);
    for (const [lo, hi] of buckets) {
      for (let k = 0, made = 0; made < 3 && k < 200; k++) {
        const a = rand() * Math.PI * 2, d = lo + rand() * (hi - lo);
        const x = hole.pin.x + Math.cos(a) * d, y = hole.pin.y + Math.sin(a) * d;
        if (hole.terrainAt(x, y) !== T.GREEN) continue;
        made++;
        const ideal = idealOffset(hole, x, y, d);
        const base = Math.atan2(hole.pin.y - y, hole.pin.x - x);
        for (const reader of ['perfect', 'good', 'straight']) {
          for (let rep = 0; rep < 4; rep++) {
            const off = reader === 'perfect' ? ideal : reader === 'good' ? ideal * (1 + gauss() * 0.35) + gauss() * 0.004 : 0;
            const aim = base + off;
            const { power, R } = markPower(hole, x, y, aim, d + 0.3);
            const pw = Math.max(0.01, power + (gauss() * BACK_JITTER) / (1.05 * 1.15));
            const sp = Math.max(0.12, pw / (0.5 + 0.22 * pw));
            const m = gauss() * TAP_JITTER * sp;
            const e = Math.abs(m) > 0.02 ? Math.sign(m) * Math.min(1, (Math.abs(m) - 0.02) / 0.14) : 0;
            const b = roll(hole, x, y, aim, pw, R, e);
            const key = `${reader} ${lo}-${hi}m`;
            const s = (res[key] = res[key] || { n: 0, made: 0, left: 0 });
            s.n++;
            if (b.state === 'holed') s.made++;
            else s.left += Math.hypot(b.x - hole.pin.x, b.y - hole.pin.y);
          }
        }
      }
    }
  }
}
console.log('read     distance   make%  avg leave(m)');
for (const reader of ['perfect', 'good', 'straight'])
  for (const [lo, hi] of buckets) {
    const s = res[`${reader} ${lo}-${hi}m`];
    if (s) console.log(reader.padEnd(9), `${lo}-${hi}m`.padEnd(9), `${((100 * s.made) / s.n).toFixed(0)}%`.padStart(5), (s.left / Math.max(1, s.n - s.made)).toFixed(2).padStart(8));
  }
