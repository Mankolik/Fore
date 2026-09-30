// Long-game balance harness: tee shots and approaches on real generated holes with human-like timing
// noise.  Reports fairways hit, trouble rate, greens in regulation and proximity.
// Run: node tests/longgame.js [seeds]
const path = require('path');
for (const f of ['util', 'biomes', 'course', 'physics']) require(path.join(__dirname, '..', 'js', f + '.js'));
const Golf = globalThis.Golf;
const { T, physics: P } = Golf;

let rs = 4242;
const rand = () => ((rs = (rs * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand());
const BACK_JITTER = +(process.env.BACK || 0.025), TAP_JITTER = +(process.env.TAP || 0.035);
const SEEDS = (process.argv[2] || 'lg1,lg2,lg3,lg4,lg5').split(',');

function tapError(power, shot) {
  const sw = P.swingSize(shot, power);
  const sp = Math.max(0.12, sw / (0.5 + 0.22 * sw));
  const m = gauss() * TAP_JITTER * sp;
  const sw2 = P.sweetSpot(sw, shot);
  return Math.abs(m) > sw2 ? Math.sign(m) * Math.min(1, (Math.abs(m) - sw2) / (0.16 - sw2)) : 0;
}
function play(hole, x, y, club, power, aim, shot = 'full') {
  const b = P.createBall(x, y, hole);
  const res = P.launch(b, hole, club, power, tapError(power, shot), aim, 20, shot, rand);
  let n = 0;
  while (!['rest', 'holed', 'water'].includes(b.state) && n++ < 4000) P.step(b, hole, 1 / 30, rand);
  return { b, mishit: res && res.mishit, end: b.state === 'water' ? T.WATER : hole.terrainAt(b.x, b.y) };
}
const tee = { n: 0, fw: 0, trouble: 0, off: 0 };
const teeCalm = { n: 0, fw: 0 }, teeWind = { n: 0, fw: 0 };
const app = {};
function A(key) { return (app[key] = app[key] || { n: 0, gir: 0, prox: 0, in5: 0, trouble: 0 }); }

for (const seed of SEEDS) {
  const course = Golf.generateCourse(seed);
  for (let h = 0; h < 9; h++) {
    const hole = course.getHole(h);
    // Tee shots on par 4/5: driver aimed at the centreline where the drive should finish.
    if (hole.par >= 4) {
      const pts = hole.path;
      const target = pts.find((p) => p.s >= Math.min(245, hole.length - 90)) || pts[pts.length - 1];
      for (let k = 0; k < 12; k++) {
        const aim = Math.atan2(target.y - hole.tee.y, target.x - hole.tee.x);
        const w = hole.wind;
        if (k % 2 === 0) hole.wind = { x: 0, y: 0, speed: 0 }; // half the drives in calm air
        const { b, end } = play(hole, hole.tee.x, hole.tee.y, 0, 1, aim);
        hole.wind = w;
        const tk = k % 2 === 0 ? teeCalm : teeWind;
        tk.n++; if (end === T.FAIRWAY || end === T.FIRST) tk.fw++;
        tee.n++;
        if (end === T.FAIRWAY || end === T.FIRST) tee.fw++;
        if ([T.SAND, T.WATER, T.OOB, T.DEEP].includes(end) || b.hitTrees.size) tee.trouble++;
        const dx = b.x - hole.tee.x, dy = b.y - hole.tee.y;
        tee.off += Math.abs(-dx * Math.sin(aim) + dy * Math.cos(aim));
      }
    }
    // Approaches from the fairway, 100-180 m out, aimed at the pin with the pin-mark power.
    for (let k = 0, made = 0; made < 6 && k < 3000; k++) {
      const x = rand() * hole.W, y = rand() * hole.L;
      const d = Math.hypot(hole.pin.x - x, hole.pin.y - y);
      if (d < 100 || d > 180 || hole.terrainAt(x, y) !== T.FAIRWAY) continue;
      made++;
      let club = null;
      for (let i = P.PUTTER - 1; i >= 1; i--) if (P.shotDistance(i, 'full', T.FAIRWAY, 1).carry >= d) { club = i; break; }
      if (club == null) continue;
      let lo = 0, hi = 1;
      for (let q = 0; q < 14; q++) { const m = (lo + hi) / 2; if (P.shotDistance(club, 'full', T.FAIRWAY, m).carry < d) lo = m; else hi = m; }
      const aim = Math.atan2(hole.pin.y - y, hole.pin.x - x);
      for (const windy of [false, true]) {
        const w = hole.wind;
        if (!windy) hole.wind = { x: 0, y: 0, speed: 0 };
        for (let rep = 0; rep < 2; rep++) {
          const power = Math.min(1, Math.max(0.05, (lo + hi) / 2 + (gauss() * BACK_JITTER) / 1.05));
          const { b, end } = play(hole, x, y, club, power, aim);
          const s = A(windy ? 'windy (no compensation)' : 'calm');
          s.n++;
          const prox = end === T.WATER ? 60 : Math.hypot(b.x - hole.pin.x, b.y - hole.pin.y);
          if (end === T.GREEN || b.state === 'holed') s.gir++;
          if (prox < 5) s.in5++;
          if ([T.SAND, T.WATER, T.OOB, T.DEEP].includes(end)) s.trouble++;
          s.prox += prox;
        }
        hole.wind = w;
      }
    }
  }
}
console.log(`Tee (driver): fairway ${((100 * tee.fw) / tee.n).toFixed(0)}%  trouble ${((100 * tee.trouble) / tee.n).toFixed(0)}%  avg offline ${(tee.off / tee.n).toFixed(1)} m  (n=${tee.n})`);
console.log(`  fairways: calm ${((100 * teeCalm.fw) / teeCalm.n).toFixed(0)}%, windy (no aim-off) ${((100 * teeWind.fw) / teeWind.n).toFixed(0)}%`);
for (const [k, s] of Object.entries(app))
  console.log(`Approach 100-180 m, ${k}: GIR ${((100 * s.gir) / s.n).toFixed(0)}%  within 5 m ${((100 * s.in5) / s.n).toFixed(0)}%  avg proximity ${(s.prox / s.n).toFixed(1)} m  trouble ${((100 * s.trouble) / s.n).toFixed(0)}%  (n=${s.n})`);
