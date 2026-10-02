// Procedural hole generation: routing, fairway, green, hazards, trees and elevation.
(function () {
  const Golf = globalThis.Golf;
  const { RNG, Noise2D } = Golf;
  const { clamp, lerp, smoothstep } = Golf.util;

  const T = { OOB: 0, DEEP: 1, ROUGH: 2, FIRST: 3, FAIRWAY: 4, TEE: 5, FRINGE: 6, GREEN: 7, SAND: 8, WATER: 9 };
  const TERRAIN_NAMES = ['Out of bounds', 'Deep rough', 'Rough', 'First cut', 'Fairway', 'Tee box', 'Fringe', 'Green', 'Bunker', 'Water'];

  // ---- Blob shapes (greens, bunkers, ponds) -------------------------------------------------
  function makeBlob(rng, cx, cy, R, opts = {}) {
    const w = opts.wobble ?? 0.18;
    return {
      cx, cy, R,
      sx: opts.sx ?? 1, sy: opts.sy ?? 1,
      rot: opts.rot ?? rng.float(0, Math.PI * 2),
      a2: rng.float(0, w), p2: rng.float(0, 6.283),
      a3: rng.float(0, w * 0.7), p3: rng.float(0, 6.283),
      a5: rng.float(0, w * 0.35), p5: rng.float(0, 6.283),
    };
  }
  function blobSdf(b, x, y) {
    const dx = x - b.cx, dy = y - b.cy;
    const c = Math.cos(b.rot), s = Math.sin(b.rot);
    const lx = (dx * c + dy * s) / b.sx, ly = (-dx * s + dy * c) / b.sy;
    const d = Math.hypot(lx, ly);
    const a = Math.atan2(ly, lx);
    const r = b.R * (1 + b.a2 * Math.sin(2 * a + b.p2) + b.a3 * Math.sin(3 * a + b.p3) + b.a5 * Math.sin(5 * a + b.p5));
    return (d - r) * Math.min(b.sx, b.sy);
  }
  function blobExtent(b) {
    return b.R * Math.max(b.sx, b.sy) * 1.7;
  }

  // ---- Polyline helpers ------------------------------------------------------------------------
  function catmullRom(points, samplesPerSeg) {
    const out = [];
    const P = [points[0], ...points, points[points.length - 1]];
    for (let i = 1; i < P.length - 2; i++) {
      const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
      for (let k = 0; k < samplesPerSeg; k++) {
        const t = k / samplesPerSeg, t2 = t * t, t3 = t2 * t;
        out.push({
          x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        });
      }
    }
    out.push(points[points.length - 1]);
    return out;
  }
  function resample(pts, spacing) {
    const out = [{ x: pts[0].x, y: pts[0].y, s: 0 }];
    let acc = 0, s = 0;
    for (let i = 1; i < pts.length; i++) {
      let ax = pts[i - 1].x, ay = pts[i - 1].y;
      const bx = pts[i].x, by = pts[i].y;
      let seg = Math.hypot(bx - ax, by - ay);
      while (acc + seg >= spacing) {
        const t = (spacing - acc) / seg;
        ax = ax + (bx - ax) * t;
        ay = ay + (by - ay) * t;
        s += spacing;
        out.push({ x: ax, y: ay, s });
        seg = Math.hypot(bx - ax, by - ay);
        acc = 0;
      }
      acc += seg;
    }
    const last = pts[pts.length - 1];
    const tail = out[out.length - 1];
    const rem = Math.hypot(last.x - tail.x, last.y - tail.y);
    if (rem > 0.5) out.push({ x: last.x, y: last.y, s: s + rem });
    return out;
  }
  function pointAt(path, s) {
    s = clamp(s, 0, path[path.length - 1].s);
    let lo = 0, hi = path.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (path[m].s <= s) lo = m;
      else hi = m;
    }
    const a = path[lo], b = path[hi];
    const t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    return { x: a.x + dx * t, y: a.y + dy * t, dx: dx / len, dy: dy / len };
  }

  // ---- Hole ------------------------------------------------------------------------------------
  class Hole {
    sampleIdx(field, x, y) {
      const W = this.W;
      x = clamp(x, 0, W - 0.0001);
      y = clamp(y, 0, this.L - 0.0001);
      const i = x | 0, j = y | 0, fx = x - i, fy = y - j;
      const k = j * (W + 1) + i;
      const a = field[k], b = field[k + 1], c = field[k + W + 1], d = field[k + W + 2];
      return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    }
    height(x, y) {
      return this.sampleIdx(this.fHeight, x, y);
    }
    grad(x, y) {
      const e = 0.5;
      return {
        x: (this.height(x + e, y) - this.height(x - e, y)) / (2 * e),
        y: (this.height(x, y + e) - this.height(x, y - e)) / (2 * e),
      };
    }
    terrainAt(x, y) {
      if (x < 0 || y < 0 || x > this.W || y > this.L) return T.OOB;
      const W = this.W;
      const i = x | 0, j = y | 0, fx = x - i, fy = y - j;
      const ii = Math.min(i, W - 1), jj = Math.min(j, this.L - 1);
      const k = jj * (W + 1) + ii;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      const k1 = k + 1, k2 = k + W + 1, k3 = k + W + 2;
      const bl = (f) => f[k] * w00 + f[k1] * w10 + f[k2] * w01 + f[k3] * w11;
      if (bl(this.fWater) < 0) return T.WATER;
      if (bl(this.fSand) < 0) return T.SAND;
      const g = bl(this.fGreen);
      if (g < 0) return T.GREEN;
      if (g < 1.8) return T.FRINGE;
      if (bl(this.fTee) < 0) return T.TEE;
      if (bl(this.fOob) > 0) return T.OOB;
      const f = bl(this.fFair);
      if (f < 0) return T.FAIRWAY;
      if (f < 2.5 || g < 5) return T.FIRST;
      if (bl(this.fDeep) > 0) return T.DEEP;
      return T.ROUGH;
    }
    // Height of the bunker face above its rim (m) for the bunker at (x, y): steep, lipped greenside and pot
    // bunkers; shallow fairway bunkers.
    bunkerLip(x, y) {
      for (const b of this.bunkers) if (blobSdf(b, x, y) < 0.5) return b.lip ?? 0.2;
      return 0;
    }
    treesNear(x, y) {
      const cs = this.treeCell;
      const ci = Math.floor(x / cs), cj = Math.floor(y / cs);
      const out = [];
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const arr = this.treeGrid.get((cj + dj) * 10007 + (ci + di));
          if (arr) for (const t of arr) out.push(t);
        }
      return out;
    }
  }

  function generateHole(seed, par, number, biome = Golf.BIOMES.parkland) {
    const rng = new RNG(seed);
    const noise = new Noise2D(seed ^ 0x2545f491);
    const hole = new Hole();
    hole.seed = seed;
    hole.par = par;
    hole.number = number;

    // --- Routing: control points heading "up" the screen (negative y).
    // Short par 3s and drivable par 4s give plenty of wedge play.
    let lenRange;
    if (par === 3) lenRange = rng.chance(0.4) ? [90, 130] : [130, 195];
    else if (par === 4) lenRange = rng.chance(0.3) ? [255, 300] : [300, 410];
    else lenRange = [450, 530];
    const bg = biome.gen;
    // Separate stream for biome-only extras, so the main layout of a seed is unaffected by them.
    const brng = new RNG((seed ^ 0x5eed1e55) >>> 0);
    hole.biome = biome;
    const total = rng.float(lenRange[0], lenRange[1]) * bg.lengthK;
    let heading = rng.float(-0.3, 0.3); // radians clockwise from north
    const ctrl = [{ x: 0, y: 0 }];
    let bends;
    if (par === 3) bends = [];
    else if (par === 4) bends = rng.chance(0.7) ? [rng.float(0.55, 0.68)] : [0.5];
    else bends = [rng.float(0.38, 0.48), rng.float(0.68, 0.78)];
    const legs = [...bends, 1];
    let prevFrac = 0, cx = 0, cy = 0;
    legs.forEach((frac, idx) => {
      const legLen = (frac - prevFrac) * total;
      cx += Math.sin(heading) * legLen;
      cy -= Math.cos(heading) * legLen;
      ctrl.push({ x: cx, y: cy });
      prevFrac = frac;
      if (idx < legs.length - 1) {
        const turn = par === 4 && bends[0] === 0.5 ? rng.float(0.05, 0.15) : rng.float(0.2, 0.6);
        heading = clamp(heading + rng.sign() * turn, -0.9, 0.9);
      }
    });
    let path = resample(catmullRom(ctrl, 20), 4);

    // Normalise into positive coordinates with generous margins.
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (const p of path) {
      minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x);
      miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y);
    }
    const mx = 95, mTop = 60, mBot = 45;
    const W = Math.ceil(maxx - minx + mx * 2);
    const L = Math.ceil(maxy - miny + mTop + mBot);
    for (const p of path) {
      p.x += mx - minx;
      p.y += mTop - miny;
    }
    hole.W = W;
    hole.L = L;
    hole.path = path;
    const S = path[path.length - 1].s;
    hole.length = S;

    // --- Fairway width profile.
    // Fairways pinch in around the driving zone, so driver vs. a shorter club off the tee is a real choice.
    const baseHW = par === 3 ? rng.float(11, 14) : rng.float(14, 18);
    const pinchS = rng.float(215, 255), pinchK = par === 3 ? 1 : rng.float(0.78, 0.95);
    const hwAt = (s) => {
      let hw = baseHW + noise.value(s / 55, 7.7) * 3.5;
      hw *= 1 - (1 - pinchK) * Math.exp(-(((s - pinchS) / 28) ** 2));
      hw *= lerp(1, 0.75, smoothstep(S - 80, S - 20, s));
      return hw;
    };
    const fwStart = par === 3 ? S - rng.float(25, 40) : rng.float(40, 75);
    const deepOff = rng.float(14, 22);
    const oobOff = rng.float(46, 62);

    // --- Tee & green.
    const teeP = pointAt(path, 0);
    hole.tee = { x: teeP.x, y: teeP.y, dx: teeP.dx, dy: teeP.dy };
    const endP = pointAt(path, S);
    const greenR = par === 3 ? rng.float(9, 14) : rng.float(10, 18);
    const green = makeBlob(rng, endP.x, endP.y, greenR, { wobble: 0.14, sx: rng.float(1, 1.3) });
    hole.green = green;
    hole.approachDir = { x: endP.dx, y: endP.dy };
    const greenExtR = greenR * green.sx * 1.15;

    // Green complex: raised greens with run-off banks, the odd gentle two-tier green, grass hollows around the edge.
    const style = { raise: 0, bank: rng.float(4, 7), tier: null, hollows: [] };
    if (rng.chance(0.4)) style.raise = rng.float(0.8, 2.0);
    if (rng.chance(0.18)) {
      const a = rng.float(0, Math.PI * 2);
      style.tier = { nx: Math.cos(a), ny: Math.sin(a), off: rng.float(-0.3, 0.3) * greenR, h: rng.float(0.25, 0.45) * rng.sign() };
    }
    for (let i = 0, n = rng.int(0, 2); i < n; i++) {
      const a = rng.float(0, Math.PI * 2), d = greenExtR + rng.float(3, 7);
      style.hollows.push({ x: green.cx + Math.cos(a) * d, y: green.cy + Math.sin(a) * d, r: rng.float(4, 6.5), depth: rng.float(0.5, 1.0) });
    }
    hole.greenStyle = style;
    const onTierSlope = (x, y) => style.tier && Math.abs((x - green.cx) * style.tier.nx + (y - green.cy) * style.tier.ny - style.tier.off) < 3.6;

    // Pin somewhere comfortably inside the green.
    let pin = null;
    for (let tries = 0; tries < 40 && !pin; tries++) {
      const a = rng.float(0, Math.PI * 2), r = rng.float(0, greenR * 0.65);
      const px = green.cx + Math.cos(a) * r, py = green.cy + Math.sin(a) * r;
      if (blobSdf(green, px, py) < -3.5 && !onTierSlope(px, py)) pin = { x: px, y: py };
    }
    hole.pin = pin || { x: green.cx, y: green.cy };

    // --- Hazards.
    const bunkers = [];
    const nGreenside = rng.int(par === 3 ? 1 : 0, 3);
    for (let i = 0; i < nGreenside; i++) {
      const base = Math.atan2(-endP.dy, -endP.dx); // toward the tee
      const ang = base + rng.float(-2.3, 2.3);
      const R = rng.float(3.5, 6);
      const gr = greenR * 1.05;
      const d = gr + R * 0.9 + 2.5;
      const gb = makeBlob(rng, green.cx + Math.cos(ang) * d, green.cy + Math.sin(ang) * d, R, { sx: rng.float(1.4, 2.0), rot: ang + Math.PI / 2, wobble: 0.2 });
      gb.lip = 0.45;
      bunkers.push(gb);
    }
    // Small, deep pot bunkers hugging the green.
    for (let i = 0, n = rng.chance(bg.potBunkers ? 0.85 : 0.45) ? rng.int(1, 3) : 0; i < n; i++) {
      const ang = rng.float(0, Math.PI * 2);
      const R = rng.float(1.8, 2.8);
      const d = greenExtR + R + rng.float(0.8, 2);
      const pot = makeBlob(rng, green.cx + Math.cos(ang) * d, green.cy + Math.sin(ang) * d, R, { sx: rng.float(1, 1.25), wobble: 0.1 });
      pot.depth = rng.float(1.0, 1.4);
      pot.lip = 0.4;
      bunkers.push(pot);
    }
    if (par >= 4) {
      const nFw = rng.int(1, 3);
      for (let i = 0; i < nFw; i++) {
        const s = rng.float(195, Math.min(265, S - 90));
        const p = pointAt(path, s);
        const side = rng.sign();
        const R = rng.float(4.5, 7.5);
        const off = hwAt(s) + R * rng.float(-0.1, 0.6);
        bunkers.push(makeBlob(rng, p.x - p.dy * off * side, p.y + p.dx * off * side, R, { sx: rng.float(1.5, 2.3), rot: Math.atan2(p.dy, p.dx), wobble: 0.22 }));
      }
      if (par === 5 && rng.chance(0.5)) {
        const s = rng.float(S - 130, S - 80);
        const p = pointAt(path, s);
        const off = rng.float(-6, 6);
        bunkers.push(makeBlob(rng, p.x - p.dy * off, p.y + p.dx * off, rng.float(4, 6), { sx: 2.2, rot: Math.atan2(p.dy, p.dx) + Math.PI / 2, wobble: 0.25 }));
      }
    }
    hole.bunkers = bunkers;

    const waters = [];
    const creeks = [];
    const safeWater = (sdfFn) => sdfFn(hole.tee.x, hole.tee.y) > 22 && sdfFn(hole.pin.x, hole.pin.y) > greenR + 7 && sdfFn(green.cx, green.cy) > greenR + 6;
    if (par === 3 && rng.chance(0.55 * bg.waterChance)) {
      for (let t = 0; t < 8; t++) {
        const p = pointAt(path, S * rng.float(0.4, 0.62));
        const b = makeBlob(rng, p.x + rng.float(-12, 12), p.y, rng.float(14, 22), { sx: rng.float(1.4, 2.0), rot: Math.atan2(p.dy, p.dx) + Math.PI / 2, wobble: 0.2 });
        if (safeWater((x, y) => blobSdf(b, x, y))) { waters.push(b); break; }
      }
    } else if (par >= 4) {
      if (rng.chance(0.45 * bg.waterChance)) {
        for (let t = 0; t < 8; t++) {
          const s = S * rng.float(0.3, 0.8);
          const p = pointAt(path, s);
          const side = rng.sign();
          const R = rng.float(14, 24);
          const off = hwAt(s) + R * rng.float(0.5, 0.95);
          const b = makeBlob(rng, p.x - p.dy * off * side, p.y + p.dx * off * side, R, { sx: rng.float(1.3, 2.2), rot: Math.atan2(p.dy, p.dx), wobble: 0.22 });
          if (safeWater((x, y) => blobSdf(b, x, y))) { waters.push(b); break; }
        }
      }
      if (rng.chance(0.35 * bg.waterChance)) {
        const s = S - rng.float(60, 95);
        const p = pointAt(path, s);
        const pts = [];
        const phase = rng.float(0, 6.28);
        for (let u = -140; u <= 140; u += 5) {
          const wob = Math.sin(u / 23 + phase) * 6 + noise.value(u / 30, 91) * 5;
          pts.push({ x: p.x - p.dy * u + p.dx * wob, y: p.y + p.dx * u + p.dy * wob });
        }
        const creek = { pts, hw: rng.float(2.6, 3.8) };
        const sdf = (x, y) => polylineDist(creek.pts, x, y) - creek.hw;
        // Frozen worlds keep only ponds: a sheet of ice has to be level, which a creek down a slope can't be.
        if (safeWater(sdf) && !biome.env.ice) creeks.push(creek);
      }
    }
    // Water tight to the side or back of the green.
    if (waters.length === 0 && rng.chance((par === 3 ? 0.35 : 0.3) * bg.waterChance)) {
      const base = Math.atan2(-endP.dy, -endP.dx);
      for (let t = 0; t < 10; t++) {
        const ang = base + rng.sign() * rng.float(1.2, 2.9);
        const R = rng.float(9, 16), sx = rng.float(1.3, 1.8);
        const d = greenExtR + R * rng.float(0.9, 1.3) + rng.float(3, 6);
        const b = makeBlob(rng, green.cx + Math.cos(ang) * d, green.cy + Math.sin(ang) * d, R, { sx, rot: ang + Math.PI / 2, wobble: 0.18 });
        const sdf = (x, y) => blobSdf(b, x, y);
        if (sdf(green.cx, green.cy) > greenExtR + 3 && sdf(hole.pin.x, hole.pin.y) > 7 && sdf(hole.tee.x, hole.tee.y) > 22) {
          waters.push(b);
          break;
        }
      }
    }
    hole.waters = waters;
    hole.creeks = creeks;

    // --- Fields on a 1 m grid.
    const N = (W + 1) * (L + 1);
    const fFair = new Float32Array(N), fDeep = new Float32Array(N), fOob = new Float32Array(N);
    const fGreen = new Float32Array(N), fTee = new Float32Array(N), fSand = new Float32Array(N);
    const fWater = new Float32Array(N), fHeight = new Float32Array(N);

    const px = new Float32Array(path.length), py = new Float32Array(path.length), ps = new Float32Array(path.length);
    path.forEach((p, i) => { px[i] = p.x; py[i] = p.y; ps[i] = p.s; });
    const nP = path.length;
    const oobNoiseAmp = 10;
    const teeC = Math.cos(Math.atan2(hole.tee.dy, hole.tee.dx)), teeS = Math.sin(Math.atan2(hole.tee.dy, hole.tee.dx));

    const bunkerExt = bunkers.map(blobExtent), waterExt = waters.map(blobExtent);
    const creekBox = creeks.map((c) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of c.pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
      return { x0: x0 - 10, y0: y0 - 10, x1: x1 + 10, y1: y1 + 10 };
    });

    const greenTilt = { x: 0, y: 0 };
    {
      const a = rng.float(0, Math.PI * 2), m = rng.float(0.008, 0.02);
      greenTilt.x = Math.cos(a) * m;
      greenTilt.y = Math.sin(a) * m;
    }
    const baseH = (x, y) => (noise.fbm(x / 160, y / 160, 3) * 5 + noise.fbm(x / 45 + 50, y / 45, 2) * 1.0) * bg.heightAmp;
    // Meteor craters (alien, volcanic): bowls with raised rims, kept clear of tees and greens.
    const craters = [];
    for (let i = 0; i < bg.craters; i++) {
      for (let t = 0; t < 20; t++) {
        const cx = brng.float(10, W - 10), cy = brng.float(10, L - 10), r = brng.float(7, 18);
        if (Math.hypot(cx - green.cx, cy - green.cy) < greenR * 1.4 + r + 12) continue;
        if (Math.hypot(cx - hole.tee.x, cy - hole.tee.y) < r + 25) continue;
        craters.push({ x: cx, y: cy, r, depth: brng.float(1.2, 3) });
        break;
      }
    }
    hole.craters = craters;
    const hGreenC = baseH(green.cx, green.cy);
    const greenExt = blobExtent(green);
    const hTee = baseH(hole.tee.x, hole.tee.y) + 0.4;

    // Coarse pass: nearest centreline index every CS metres, used to bound the fine search.
    const CS = 8, cw = Math.ceil(W / CS) + 1, ch = Math.ceil(L / CS) + 1;
    const coarse = new Int32Array(cw * ch);
    for (let cj = 0; cj < ch; cj++)
      for (let ci = 0; ci < cw; ci++) {
        let best = Infinity, bi = 0;
        for (let q = 0; q < nP; q++) {
          const d = (ci * CS - px[q]) ** 2 + (cj * CS - py[q]) ** 2;
          if (d < best) { best = d; bi = q; }
        }
        coarse[cj * cw + ci] = bi;
      }
    const SLACK = 6;

    for (let j = 0; j <= L; j++) {
      for (let i = 0; i <= W; i++) {
        const k = j * (W + 1) + i;
        const x = i, y = j;
        // Nearest point on the centreline (search bounded by the surrounding coarse cells).
        const ci = Math.min((i / CS) | 0, cw - 2), cj = Math.min((j / CS) | 0, ch - 2);
        const c0 = coarse[cj * cw + ci], c1 = coarse[cj * cw + ci + 1], c2 = coarse[(cj + 1) * cw + ci], c3 = coarse[(cj + 1) * cw + ci + 1];
        const qlo = Math.max(0, Math.min(c0, c1, c2, c3) - SLACK), qhi = Math.min(nP, Math.max(c0, c1, c2, c3) + SLACK + 1);
        let best = Infinity, bi = 0;
        for (let q = qlo; q < qhi; q++) {
          const dx = x - px[q], dy = y - py[q];
          const d = dx * dx + dy * dy;
          if (d < best) { best = d; bi = q; }
        }
        let dist = Math.sqrt(best), s = ps[bi];
        for (let q = Math.max(0, bi - 1); q < Math.min(nP - 1, bi + 1); q++) {
          const ax = px[q], ay = py[q], bx = px[q + 1] - ax, by = py[q + 1] - ay;
          const len2 = bx * bx + by * by;
          const t = clamp(((x - ax) * bx + (y - ay) * by) / len2, 0, 1);
          const d = Math.hypot(x - ax - bx * t, y - ay - by * t);
          if (d < dist) { dist = d; s = ps[q] + t * (ps[q + 1] - ps[q]); }
        }
        const hw = hwAt(s);
        const before = Math.max(0, fwStart - s);
        const pastEnd = Math.max(0, s - S) + (bi === nP - 1 ? Math.max(0, dist - hw) : 0);
        fFair[k] = Math.hypot(dist, before * 1.5) - hw + pastEnd * 0.3;
        fDeep[k] = dist - (hw + deepOff + noise.value(x / 25, y / 25) * 5);
        const edge = Math.min(x, y, W - x, L - y);
        fOob[k] = Math.max(dist - (hw + oobOff + noise.value(x / 40 + 3, y / 40) * oobNoiseAmp), 6 - edge);

        const gd = Math.hypot(x - green.cx, y - green.cy);
        fGreen[k] = gd < greenExt + 30 ? blobSdf(green, x, y) : gd - greenExt;
        // Tee box: rounded rectangle aligned with the first leg.
        const lx = (x - hole.tee.x) * teeC + (y - hole.tee.y) * teeS;
        const ly = -(x - hole.tee.x) * teeS + (y - hole.tee.y) * teeC;
        const qx = Math.abs(lx + 2) - 8, qy = Math.abs(ly) - 4.5;
        fTee[k] = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 1;

        let sand = 99, sandDepth = 0.55;
        for (let b = 0; b < bunkers.length; b++) {
          const bb = bunkers[b];
          if (Math.abs(x - bb.cx) < bunkerExt[b] + 6 && Math.abs(y - bb.cy) < bunkerExt[b] + 6) {
            const v = blobSdf(bb, x, y);
            if (v < sand) { sand = v; sandDepth = bb.depth || 0.55; }
          }
        }
        fSand[k] = sand;
        let water = 99;
        for (let b = 0; b < waters.length; b++) {
          const bb = waters[b];
          if (Math.abs(x - bb.cx) < waterExt[b] + 8 && Math.abs(y - bb.cy) < waterExt[b] + 8) water = Math.min(water, blobSdf(bb, x, y));
        }
        for (let c = 0; c < creeks.length; c++) {
          const bx = creekBox[c];
          if (x > bx.x0 && x < bx.x1 && y > bx.y0 && y < bx.y1) water = Math.min(water, polylineDist(creeks[c].pts, x, y) - creeks[c].hw);
        }
        fWater[k] = water;

        // Elevation.
        let h = baseH(x, y);
        const bumpW = smoothstep(0, 10, fFair[k]) * smoothstep(0, 10, fGreen[k]);
        if (bumpW > 0) h += noise.value(x / 9, y / 9 + 40) * 0.35 * bumpW;
        if (bg.dunes && bumpW > 0) {
          // Rumpled dunes and mounds off the short grass.
          const rid = 1 - Math.abs(noise.value(x / 22 + 300, y / 22));
          h += bg.dunes * (rid * rid * 2.2 - 0.8) * bumpW;
        }
        for (const c of craters) {
          const d = Math.hypot(x - c.x, y - c.y);
          if (d < c.r * 1.8) {
            const u = d / c.r;
            h += u < 1 ? -c.depth * (1 - u * u) : 0;
            h += c.depth * 0.35 * Math.exp(-(((u - 1) / 0.25) ** 2));
          }
        }
        if (fGreen[k] < 14) {
          const gh = hGreenC + greenTilt.x * (x - green.cx) + greenTilt.y * (y - green.cy) + noise.fbm(x / 16 + 7, y / 16, 2) * 0.16;
          h = lerp(h, gh, 1 - smoothstep(-1, 14, fGreen[k]));
        }
        if (fTee[k] < 7) h = lerp(h, hTee, 1 - smoothstep(0, 7, fTee[k]));
        if (fGreen[k] < 16) {
          if (style.raise) h += style.raise * (1 - smoothstep(-0.5, style.bank, fGreen[k]));
          if (style.tier) {
            const tt = (x - green.cx) * style.tier.nx + (y - green.cy) * style.tier.ny - style.tier.off;
            h += style.tier.h * (smoothstep(-3, 3, tt) - 0.5) * (1 - smoothstep(-1, 10, fGreen[k]));
          }
        }
        for (const hw of style.hollows) {
          const d2 = (x - hw.x) ** 2 + (y - hw.y) ** 2;
          if (d2 < hw.r * hw.r * 4) h -= hw.depth * Math.exp(-d2 / (hw.r * hw.r));
        }
        h -= sandDepth * smoothstep(0.6, sandDepth > 0.8 ? -1.2 : -2.5, sand);
        h -= 1.2 * smoothstep(1, -4, water);
        fHeight[k] = h;
      }
    }
    // Frozen ponds: a perfectly level sheet at shoreline height with a gentle bank, so the ball slides
    // instead of accelerating down into a bowl.
    if (biome.env.ice) {
      for (const wb of waters) {
        const ext = blobExtent(wb) + 4;
        const i0 = Math.max(0, Math.floor(wb.cx - ext)), i1 = Math.min(W, Math.ceil(wb.cx + ext));
        const j0 = Math.max(0, Math.floor(wb.cy - ext)), j1 = Math.min(L, Math.ceil(wb.cy + ext));
        let sum = 0, n = 0;
        for (let j = j0; j <= j1; j++)
          for (let i = i0; i <= i1; i++) {
            const d = blobSdf(wb, i, j);
            if (d > 1.5 && d < 3) { sum += fHeight[j * (W + 1) + i]; n++; }
          }
        if (!n) continue;
        const level = sum / n;
        for (let j = j0; j <= j1; j++)
          for (let i = i0; i <= i1; i++) {
            const k = j * (W + 1) + i, d = blobSdf(wb, i, j);
            if (d < 4) fHeight[k] = lerp(level - 0.05, fHeight[k], smoothstep(1, 4, d)); // level to 1 m past the shore
          }
      }
    }
    Object.assign(hole, { fFair, fDeep, fOob, fGreen, fTee, fSand, fWater, fHeight });
    hole.greenTilt = greenTilt;

    // --- Trees.
    const trees = [];
    const sp = 7;
    for (let y = sp / 2; y < L; y += sp) {
      for (let x = sp / 2; x < W; x += sp) {
        const tx = x + rng.float(-sp * 0.45, sp * 0.45), ty = y + rng.float(-sp * 0.45, sp * 0.45);
        const pine = noise.value(tx / 70 + 20, ty / 70) > 0.15 ? rng.chance(0.75) : rng.chance(0.15);
        const r = pine ? rng.float(2.2, 3.4) : rng.float(3, 5.5);
        const S_ = (f) => hole.sampleIdx(f, tx, ty);
        if (S_(fFair) < r + 4 || S_(fGreen) < 13 || S_(fTee) < 9 || S_(fSand) < r * 0.6 + 2 || S_(fWater) < r * 0.5 + 2) continue;
        const deep = S_(fDeep);
        if (deep < -3) {
          // Occasional lone tree in the rough to shape shots.
          if (deep > -14 && rng.chance(0.03 * biome.treeDensity)) trees.push(makeTree(rng, tx, ty, r, pine));
          continue;
        }
        const n = noise.fbm(tx / 55 + 99, ty / 55, 3);
        let p = 0.05 + 0.7 * smoothstep(0, 0.4, n) + 0.25 * smoothstep(0, 25, deep);
        if (S_(fOob) > 0) p = Math.max(p, 0.6);
        if (rng.chance(p * biome.treeDensity)) trees.push(makeTree(rng, tx, ty, r, pine));
      }
    }
    // Biome tree types: re-style each tree (its position and the main layout stay the same).
    if (biome.id !== 'parkland') {
      const total = biome.trees.reduce((a, [, w]) => a + w, 0);
      for (const t of trees) {
        let r = brng.next() * total, kind = biome.trees[0][0];
        for (const [k, w] of biome.trees) {
          r -= w;
          if (r < 0) { kind = k; break; }
        }
        styleTree(t, kind, brng);
      }
    }
    // Now and then a lone tree stands in the fairway where drives land: play around it, over it, or
    // punch under it.  Own random stream, so the rest of a seed's layout is unchanged.
    const frng = new RNG((seed ^ 0xfa17e3) >>> 0);
    if (par >= 4 && frng.chance(par === 5 ? 0.45 : 0.3)) {
      const S = hole.length;
      for (let tries = 0; tries < 30; tries++) {
        const p = pointAt(path, S * frng.float(0.45, 0.75));
        const off = frng.float(-6, 6);
        const tx = p.x - p.dy * off, ty = p.y + p.dx * off;
        const S_ = (f) => hole.sampleIdx(f, tx, ty);
        if (S_(fFair) > -2 || S_(fGreen) < 45 || S_(fSand) < 8 || S_(fWater) < 10 || S_(fTee) < 60) continue;
        const kind = FAIRWAY_TREE[biome.id] || 'oak';
        const t = makeTree(frng, tx, ty, kind === 'pine' ? frng.float(3, 3.8) : frng.float(4, 5.5), kind === 'pine');
        if (kind !== 'oak' && kind !== 'pine') styleTree(t, kind, frng);
        else t.h = Math.max(t.h, 10);
        t.fairway = true;
        trees.push(t);
        break;
      }
    }
    hole.trees = trees;
    hole.treeCell = 12;
    hole.treeGrid = new Map();
    for (const t of trees) {
      t.base = hole.height(t.x, t.y);
      const key = Math.floor(t.y / 12) * 10007 + Math.floor(t.x / 12);
      if (!hole.treeGrid.has(key)) hole.treeGrid.set(key, []);
      hole.treeGrid.get(key).push(t);
    }

    // --- Wind.
    const wSpeed = Math.pow(rng.next(), 1.15) * 9 * bg.windMul;
    const wAng = rng.float(0, Math.PI * 2);
    hole.wind = { x: Math.cos(wAng) * wSpeed, y: Math.sin(wAng) * wSpeed, speed: wSpeed };
    return hole;
  }

  // cb: height (fraction) where the canopy starts; taper: canopy narrows toward the top.
  function makeTree(rng, x, y, r, pine) {
    return { x, y, r, pine, kind: pine ? 'pine' : 'oak', cb: pine ? 0.2 : 0.35, taper: pine, h: pine ? rng.float(11, 18) : rng.float(8, 14), trunk: 0.35, tint: rng.float(-1, 1) };
  }
  // Lone fairway trees: a kind with a raised canopy, so a low punch can get under it.
  const FAIRWAY_TREE = { parkland: 'oak', desert: 'palm', alien: 'mushroom', links: 'pine', winter: 'birch', volcanic: 'dead' };
  const TREE_KINDS = {
    cactus: { r: [0.9, 1.6], h: [4, 8], trunk: 0.45, cb: 0.05, taper: false },
    palm: { r: [2.6, 4], h: [9, 14], trunk: 0.3, cb: 0.75, taper: false },
    rock: { r: [1.4, 3], h: [3, 9], trunk: 1.0, cb: 0, taper: true },
    crystal: { r: [1.4, 3.2], h: [5, 13], trunk: 0.6, cb: 0.05, taper: true },
    mushroom: { r: [3, 6], h: [5, 9], trunk: 0.5, cb: 0.6, taper: false },
    gorse: { r: [1.5, 3], h: [1.5, 2.6], trunk: 0.3, cb: 0, taper: false },
    snowpine: { r: [2.2, 3.4], h: [11, 18], trunk: 0.35, cb: 0.2, taper: true },
    birch: { r: [2.5, 4.2], h: [9, 15], trunk: 0.3, cb: 0.35, taper: false },
    dead: { r: [2, 3.6], h: [6, 11], trunk: 0.35, cb: 0.3, taper: false },
  };
  function styleTree(t, kind, rng) {
    const k = TREE_KINDS[kind];
    if (!k) return;
    t.kind = kind;
    t.r = rng.float(k.r[0], k.r[1]);
    t.h = rng.float(k.h[0], k.h[1]);
    t.trunk = k.trunk;
    t.cb = k.cb;
    t.taper = k.taper;
    t.pine = k.taper;
  }

  function polylineDist(pts, x, y) {
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i].x, ay = pts[i].y, bx = pts[i + 1].x - ax, by = pts[i + 1].y - ay;
      const t = clamp(((x - ax) * bx + (y - ay) * by) / (bx * bx + by * by), 0, 1);
      const d = (x - ax - bx * t) ** 2 + (y - ay - by * t) ** 2;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  // ---- Course (9 holes) -----------------------------------------------------------------------
  const NAME_A = ['Pine', 'Oak', 'Willow', 'Heather', 'Maple', 'Cedar', 'Birch', 'Fox', 'Eagle', 'Heron', 'Stone', 'Silver', 'Mossy', 'Juniper', 'Aspen', 'Thistle'];
  const NAME_B = ['Hollow', 'Ridge', 'Creek', 'Valley', 'Dunes', 'Meadow', 'Brook', 'Hills', 'Glen', 'Point', 'Crossing', 'Downs', 'Lake', 'Heath'];
  const NAME_C = ['Links', 'Golf Club', 'Country Club', 'Golf Course', 'National'];

  function generateCourse(seedStr) {
    const seed = Golf.hashString(String(seedStr));
    const biome = Golf.biomeForSeed(seedStr);
    const rng = new RNG(seed);
    const pars = rng.shuffle([3, 3, 4, 4, 4, 4, 4, 5, 5]);
    // Keep the opener a par 4 when possible: friendlier start.
    if (pars[0] !== 4) {
      const i = pars.indexOf(4);
      [pars[0], pars[i]] = [pars[i], pars[0]];
    }
    const words = biome.words || [NAME_A, NAME_B, NAME_C];
    const name = `${rng.pick(words[0])} ${rng.pick(words[1])} ${rng.pick(words[2])}`;
    const holeSeeds = pars.map(() => (rng.next() * 4294967296) >>> 0);
    const cache = new Map();
    return {
      seed: String(seedStr),
      name,
      biome,
      pars,
      getHole(i) {
        if (!cache.has(i)) cache.set(i, generateHole(holeSeeds[i], pars[i], i + 1, biome));
        return cache.get(i);
      },
    };
  }

  Golf.T = T;
  Golf.TERRAIN_NAMES = TERRAIN_NAMES;
  Golf.generateHole = generateHole;
  Golf.generateCourse = generateCourse;
  Golf.blobSdf = blobSdf;
})();
