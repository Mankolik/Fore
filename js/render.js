// Drawing: pre-rendered terrain layers plus per-frame ball, golfer, flag, guides and particles.
(function () {
  const Golf = globalThis.Golf;
  const T = Golf.T;
  const { clamp, lerp, smoothstep } = Golf.util;
  const hash2 = Golf.hash2;

  const ZK = 0.55; // how far (in metres of screen-up) one metre of height is drawn
  const displayHeight = { k: 1 }; // set per world: gravity relative to Earth

  const COLORS = [];
  COLORS[T.OOB] = [58, 104, 50];
  COLORS[T.DEEP] = [66, 124, 54];
  COLORS[T.ROUGH] = [82, 148, 64];
  COLORS[T.FIRST] = [96, 166, 72];
  COLORS[T.FAIRWAY] = [110, 184, 80];
  COLORS[T.TEE] = [108, 182, 80];
  COLORS[T.FRINGE] = [112, 192, 86];
  COLORS[T.GREEN] = [122, 206, 96];
  COLORS[T.SAND] = [232, 214, 160];
  COLORS[T.WATER] = [54, 124, 190];

  // ---- Terrain layer ---------------------------------------------------------------------------
  function buildLayer(hole, x0, y0, w, h, ppm) {
    const cw = Math.max(1, Math.round(w * ppm)), ch = Math.max(1, Math.round(h * ppm));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(cw, ch);
    const data = img.data;
    const noise = new Golf.Noise2D(hole.seed ^ 0x51ed);
    const W = hole.W;
    const H = hole.fHeight;
    const inv = 1 / ppm;
    const biome = hole.biome || Golf.BIOMES.parkland;
    const pal = biome.colors, liq = biome.liquid, oobc = biome.oobLine;
    for (let py = 0; py < ch; py++) {
      const y = y0 + (py + 0.5) * inv;
      for (let px = 0; px < cw; px++) {
        const x = x0 + (px + 0.5) * inv;
        const t = hole.terrainAt(x, y);
        const c = pal[t] || COLORS[t];
        let r = c[0], g = c[1], b = c[2];
        let shade = 1;

        // Slope shading from the bilinear height cell.
        const xi = clamp(x, 0, W - 0.001), yi = clamp(y, 0, hole.L - 0.001);
        const i = xi | 0, j = yi | 0, fx = xi - i, fy = yi - j;
        const k = j * (W + 1) + i;
        const a = H[k], bb = H[k + 1], cc = H[k + W + 1], d = H[k + W + 2];
        // Central differences over bilinear samples: smooth across cell borders (no 1 m tiling).
        const gx = (hole.sampleIdx(H, x + 0.6, y) - hole.sampleIdx(H, x - 0.6, y)) / 1.2;
        const gy = (hole.sampleIdx(H, x, y + 0.6) - hole.sampleIdx(H, x, y - 0.6)) / 1.2;
        const elev = a + (bb - a) * fx + (cc - a) * fy + (a - bb - cc + d) * fx * fy;

        if (t === T.WATER) {
          const depth = -hole.sampleIdx(hole.fWater, x, y);
          const q = clamp(depth / 9, 0, 1);
          const sh = liq.shallow, dp = liq.deep;
          r = lerp(sh[0], dp[0], q); g = lerp(sh[1], dp[1], q); b = lerp(sh[2], dp[2], q);
          shade = 1 + noise.value(x / 3 + y / 7, y / 2.5) * 0.06;
          if (liq.style === 'lava') {
            // Glowing lava with drifting dark crust plates.
            const n = noise.fbm(x / 5, y / 5, 2);
            if (n > 0.18) { const k = clamp((n - 0.18) * 4, 0, 1); r = lerp(r, 60, k); g = lerp(g, 24, k); b = lerp(b, 16, k); }
            shade = 1 + noise.value(x / 1.5, y / 1.5) * 0.08;
          } else if (liq.style === 'acid') {
            if (hash2((x * 2) | 0, (y * 2) | 0, 3) > 0.985) { r = 240; g = 255; b = 200; } // bubbles
          } else if (liq.style === 'ice') {
            if (Math.abs(noise.value(x / 3.5 + 11, y / 3.5)) < 0.03 || Math.abs(noise.value(x / 9, y / 9 + 7)) < 0.015) { r = 250; g = 253; b = 255; }
            shade = 1 + noise.value(x / 12, y / 30) * 0.05;
          }
          if (depth < 0.35) { r = liq.edge[0]; g = liq.edge[1]; b = liq.edge[2]; }
        } else {
          shade = 1 + clamp((gx + gy) * 2.2, -0.28, 0.28) + clamp(elev * 0.008, -0.05, 0.05);
          const mott = noise.value(x / 7, y / 7) * 0.05 + noise.value(x / 1.7, y / 1.7) * 0.025;
          const speck = (hash2((x * 5) | 0, (y * 5) | 0, 7) - 0.5) * (t === T.SAND ? 0.09 : 0.05);
          shade += mott + speck;
          if (t === T.FAIRWAY) shade += (Math.floor((x * 0.35 + y) / 9) & 1) ? 0.045 : -0.02;
          else if (t === T.GREEN) shade += (Math.floor((x - y * 0.3) / 2.6) & 1) ? 0.03 : -0.01;
          else if (t === T.TEE) shade += (Math.floor(x / 1.8) & 1) ? 0.03 : -0.02;
          else if (t === T.SAND) {
            const s = hole.sampleIdx(hole.fSand, x, y);
            if (s > -0.5) shade -= 0.18 * (1 + s / 0.5);
            shade += noise.value(x * 1.3, y * 1.3) * 0.03;
          } else if (t === T.OOB) shade -= 0.06;
          if (t !== T.OOB) {
            const o = hole.sampleIdx(hole.fOob, x, y);
            if (o > -0.3 && x > 1 && y > 1 && x < W - 1 && y < hole.L - 1 && Math.floor((x + y) * 0.6) % 3 !== 0) {
              r = oobc[0]; g = oobc[1]; b = oobc[2]; shade = 1;
            }
          }
          if (t === T.GREEN || t === T.FRINGE) {
            const gs = hole.sampleIdx(hole.fGreen, x, y);
            if (Math.abs(gs) < 0.25) shade -= 0.06;
          }
        }
        const o = (py * cw + px) * 4;
        data[o] = clamp(r * shade, 0, 255);
        data[o + 1] = clamp(g * shade, 0, 255);
        data[o + 2] = clamp(b * shade, 0, 255);
        data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Trees: shadows first, then canopies.
    ctx.setTransform(ppm, 0, 0, ppm, -x0 * ppm, -y0 * ppm);
    const trees = hole.trees.filter((t) => t.x + t.r * 3 > x0 && t.x - t.r * 3 < x0 + w && t.y + t.r * 3 > y0 && t.y - t.r * 3 < y0 + h);
    ctx.fillStyle = 'rgba(10,40,10,0.28)';
    for (const t of trees) {
      ctx.beginPath();
      ctx.ellipse(t.x + t.h * 0.22, t.y + t.h * 0.18, t.r * 1.05, t.r * 0.9, 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    const bid = hole.biome ? hole.biome.id : 'parkland';
    for (const t of trees) drawTree(ctx, t, bid);
    return { canvas, x0, y0, w, h, ppm };
  }

  function drawTree(ctx, t, biome) {
    const tint = t.tint * 12;
    const special = TREE_DRAW[t.kind];
    if (special) return special(ctx, t, tint, biome);
    if (t.pine) {
      const layers = 3;
      for (let l = 0; l < layers; l++) {
        const rr = t.r * (1 - l * 0.28);
        const pts = 9;
        ctx.beginPath();
        for (let p = 0; p <= pts * 2; p++) {
          const a = (p / (pts * 2)) * Math.PI * 2 + l * 0.35 + t.tint;
          const rad = p % 2 === 0 ? rr : rr * 0.62;
          const px = t.x + Math.cos(a) * rad - l * 0.18 * t.r, py = t.y + Math.sin(a) * rad - l * 0.22 * t.r;
          p === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        const g = 70 + l * 22 + tint;
        ctx.fillStyle = `rgb(${24 + l * 10 + tint * 0.5},${g},${46 + l * 8})`;
        ctx.fill();
      }
    } else {
      ctx.fillStyle = `rgb(${38 + tint},${92 + tint},${40})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
      ctx.fill();
      const blobs = 5;
      for (let i = 0; i < blobs; i++) {
        const a = i * 2.4 + t.tint * 3;
        const d = t.r * 0.45;
        ctx.fillStyle = `rgba(${70 + tint},${140 + tint},${62},0.55)`;
        ctx.beginPath();
        ctx.arc(t.x + Math.cos(a) * d - t.r * 0.15, t.y + Math.sin(a) * d - t.r * 0.18, t.r * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = `rgba(160,210,110,0.25)`;
      ctx.beginPath();
      ctx.arc(t.x - t.r * 0.3, t.y - t.r * 0.35, t.r * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Special tree / obstacle drawings for the non-parkland biomes (top-down, world units = metres).
  function blobPath(ctx, x, y, r, n, jag, seed) {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (1 - jag + jag * 2 * hash2(i % n, (seed * 1000) | 0, 5));
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  }
  const TREE_DRAW = {
    cactus(ctx, t, tint) {
      const g = `rgb(${54 + tint},${128 + tint},${66})`;
      ctx.strokeStyle = g;
      ctx.lineCap = 'round';
      const arms = 2 + Math.floor((t.tint + 1) * 1.2);
      for (let i = 0; i < arms; i++) {
        const a = t.tint * 3 + i * 2.1;
        ctx.lineWidth = t.r * 0.55;
        ctx.beginPath();
        ctx.moveTo(t.x, t.y);
        ctx.lineTo(t.x + Math.cos(a) * t.r * 1.3, t.y + Math.sin(a) * t.r * 1.3);
        ctx.stroke();
      }
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(190,230,170,0.5)';
      ctx.lineWidth = 0.08;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(t.x, t.y);
        ctx.lineTo(t.x + Math.cos(a) * t.r * 0.6, t.y + Math.sin(a) * t.r * 0.6);
        ctx.stroke();
      }
    },
    palm(ctx, t, tint) {
      const n = 8;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + t.tint;
        const ex = t.x + Math.cos(a) * t.r, ey = t.y + Math.sin(a) * t.r;
        const nx = -Math.sin(a) * t.r * 0.22, ny = Math.cos(a) * t.r * 0.22;
        ctx.fillStyle = `rgb(${50 + tint},${122 + tint},${48})`;
        ctx.beginPath();
        ctx.moveTo(t.x, t.y);
        ctx.quadraticCurveTo((t.x + ex) / 2 + nx, (t.y + ey) / 2 + ny, ex, ey);
        ctx.quadraticCurveTo((t.x + ex) / 2 - nx, (t.y + ey) / 2 - ny, t.x, t.y);
        ctx.fill();
        ctx.strokeStyle = 'rgba(170,210,110,0.6)';
        ctx.lineWidth = 0.1;
        ctx.beginPath();
        ctx.moveTo(t.x, t.y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }
      ctx.fillStyle = '#6b4a2b';
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r * 0.14, 0, Math.PI * 2);
      ctx.fill();
    },
    rock(ctx, t, tint, biome) {
      const base = biome === 'volcanic' ? [58, 52, 60] : [176, 118, 82];
      ctx.fillStyle = `rgb(${base[0] + tint},${base[1] + tint},${base[2] + tint})`;
      blobPath(ctx, t.x, t.y, t.r, 7, 0.28, t.tint);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      blobPath(ctx, t.x - t.r * 0.25, t.y - t.r * 0.3, t.r * 0.5, 6, 0.3, t.tint + 1);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 0.08;
      blobPath(ctx, t.x, t.y, t.r, 7, 0.28, t.tint);
      ctx.stroke();
    },
    crystal(ctx, t) {
      const hue = t.tint > 0 ? [120, 250, 255] : [255, 120, 240];
      ctx.fillStyle = `rgba(${hue[0]},${hue[1]},${hue[2]},0.16)`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r * 1.9, 0, Math.PI * 2);
      ctx.fill();
      const shards = 5;
      for (let i = 0; i < shards; i++) {
        const a = t.tint * 4 + i * 1.26;
        const len = t.r * (0.7 + 0.5 * hash2(i, (t.x * 10) | 0, 9));
        const w = t.r * 0.28;
        const cx = t.x + Math.cos(a) * len * 0.35, cy = t.y + Math.sin(a) * len * 0.35;
        const tipx = t.x + Math.cos(a) * len, tipy = t.y + Math.sin(a) * len;
        const nx = -Math.sin(a) * w, ny = Math.cos(a) * w;
        ctx.fillStyle = `rgb(${hue[0] * 0.55},${hue[1] * 0.55},${hue[2] * 0.7})`;
        ctx.beginPath();
        ctx.moveTo(t.x + nx * 0.4, t.y + ny * 0.4);
        ctx.lineTo(cx + nx, cy + ny);
        ctx.lineTo(tipx, tipy);
        ctx.lineTo(cx - nx, cy - ny);
        ctx.lineTo(t.x - nx * 0.4, t.y - ny * 0.4);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = `rgba(${hue[0]},${hue[1]},${hue[2]},0.85)`;
        ctx.beginPath();
        ctx.moveTo(t.x, t.y);
        ctx.lineTo(cx + nx, cy + ny);
        ctx.lineTo(tipx, tipy);
        ctx.closePath();
        ctx.fill();
      }
    },
    mushroom(ctx, t, tint) {
      const g = ctx.createRadialGradient(t.x - t.r * 0.3, t.y - t.r * 0.3, t.r * 0.1, t.x, t.y, t.r);
      g.addColorStop(0, `rgb(${240},${150 + tint},${90})`);
      g.addColorStop(1, `rgb(${170 + tint},${50},${120})`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,245,230,0.85)';
      for (let i = 0; i < 6; i++) {
        const a = i * 1.9 + t.tint, d = t.r * (0.3 + 0.4 * hash2(i, (t.y * 10) | 0, 4));
        ctx.beginPath();
        ctx.arc(t.x + Math.cos(a) * d, t.y + Math.sin(a) * d, t.r * 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    gorse(ctx, t, tint) {
      ctx.fillStyle = `rgb(${52 + tint},${92 + tint},${40})`;
      blobPath(ctx, t.x, t.y, t.r, 10, 0.25, t.tint);
      ctx.fill();
      ctx.fillStyle = 'rgba(250,215,60,0.9)';
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4 + t.tint, d = t.r * 0.75 * hash2(i, (t.x * 7) | 0, 2);
        ctx.beginPath();
        ctx.arc(t.x + Math.cos(a) * d, t.y + Math.sin(a) * d, 0.18, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    snowpine(ctx, t, tint) {
      for (let l = 0; l < 3; l++) {
        const rr = t.r * (1 - l * 0.28);
        ctx.beginPath();
        for (let p = 0; p <= 18; p++) {
          const a = (p / 18) * Math.PI * 2 + l * 0.35 + t.tint;
          const rad = p % 2 === 0 ? rr : rr * 0.62;
          const px = t.x + Math.cos(a) * rad - l * 0.18 * t.r, py = t.y + Math.sin(a) * rad - l * 0.22 * t.r;
          p ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.fillStyle = l === 0 ? `rgb(${30 + tint * 0.5},${70 + tint},${56})` : `rgba(245,250,255,${0.55 + l * 0.2})`;
        ctx.fill();
      }
    },
    birch(ctx, t, tint, biome) {
      // Bare winter birch: pale branches.
      ctx.strokeStyle = 'rgba(235,235,230,0.95)';
      ctx.lineCap = 'round';
      for (let i = 0; i < 7; i++) {
        const a = i * 0.9 + t.tint;
        ctx.lineWidth = 0.22;
        ctx.beginPath();
        ctx.moveTo(t.x, t.y);
        const mx = t.x + Math.cos(a) * t.r * 0.6, my = t.y + Math.sin(a) * t.r * 0.6;
        ctx.lineTo(mx, my);
        ctx.lineTo(mx + Math.cos(a + 0.5) * t.r * 0.4, my + Math.sin(a + 0.5) * t.r * 0.4);
        ctx.moveTo(mx, my);
        ctx.lineTo(mx + Math.cos(a - 0.5) * t.r * 0.4, my + Math.sin(a - 0.5) * t.r * 0.4);
        ctx.stroke();
      }
    },
    dead(ctx, t, tint) {
      ctx.strokeStyle = `rgb(${70 + tint},${60 + tint},${56})`;
      ctx.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const a = i * 1.05 + t.tint * 2;
        ctx.lineWidth = 0.3;
        ctx.beginPath();
        ctx.moveTo(t.x, t.y);
        const mx = t.x + Math.cos(a) * t.r * 0.55, my = t.y + Math.sin(a) * t.r * 0.55;
        ctx.lineTo(mx, my);
        ctx.lineTo(mx + Math.cos(a + 0.6) * t.r * 0.45, my + Math.sin(a + 0.6) * t.r * 0.45);
        ctx.moveTo(mx, my);
        ctx.lineTo(mx + Math.cos(a - 0.4) * t.r * 0.5, my + Math.sin(a - 0.4) * t.r * 0.5);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,120,40,0.35)';
      ctx.beginPath();
      ctx.arc(t.x, t.y, 0.35, 0, Math.PI * 2);
      ctx.fill();
    },
  };

  function buildHoleLayers(hole) {
    const ppm = Math.min(3, Math.sqrt(2.4e6 / (hole.W * hole.L)));
    const main = buildLayer(hole, 0, 0, hole.W, hole.L, ppm);
    const surround = buildSurround(hole, main);
    featherEdges(main, 10);
    // The crisp near band (buildNearBand) and the detailed green are added once the hole is on screen.
    return { main, near: null, surround, green: null };
  }

  // A crisp band of countryside around the hole (same detail as the course: mottled ground, scrub and
  // the hole's own kinds of trees), which dissolves into the soft distant surround.
  const NEAR_M = 70;
  function buildNearBand(hole) {
    const M = NEAR_M;
    const w = hole.W + 2 * M, h = hole.L + 2 * M;
    const ppm = Math.min(1.6, Math.sqrt(9e5 / (w * h)));
    const cw = Math.round(w * ppm), ch = Math.round(h * ppm);
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(cw, ch);
    const data = img.data;
    const biome = hole.biome || Golf.BIOMES.parkland;
    const pal = biome.colors;
    const oob = pal[T.OOB] || COLORS[T.OOB], deep = pal[T.DEEP] || COLORS[T.DEEP];
    const noise = new Golf.Noise2D(hole.seed ^ 0x5a17); // same fields as the far surround, so they line up
    // The course's own elevation formula (same noise seed as course.js), so bumps and dunes carry on.
    const hn = new Golf.Noise2D(hole.seed ^ 0x2545f491);
    const gen = biome.gen || {};
    const amp = gen.heightAmp ?? 1, dunes = gen.dunes || 0;
    const elev = (x, y) => {
      let e = (hn.fbm(x / 160, y / 160, 3) * 5 + hn.fbm(x / 45 + 50, y / 45, 2)) * amp + hn.value(x / 9, y / 9 + 40) * 0.35;
      if (dunes) {
        const rid = 1 - Math.abs(hn.value(x / 22 + 300, y / 22));
        e += dunes * (rid * rid * 2.2 - 0.8);
      }
      return e;
    };
    // Elevation on a 1 m grid (only where the band is drawn), then slope from bilinear samples.
    const gw = Math.ceil(w) + 2, gh = Math.ceil(h) + 2;
    // The same grid carries the scrub mix and broad mottling, which vary slowly too.
    const grid = new Float32Array(gw * gh), mixG = new Float32Array(gw * gh), mottG = new Float32Array(gw * gh);
    for (let j = 0; j < gh; j++) {
      const y = j - M - 1;
      for (let i = 0; i < gw; i++) {
        const x = i - M - 1;
        if (Math.min(x, y, hole.W - x, hole.L - y) > 15) continue;
        const k = j * gw + i;
        grid[k] = elev(x, y);
        mixG[k] = clamp(0.5 + noise.fbm(x / 45, y / 45, 3) * 1.4, 0, 1);
        mottG[k] = noise.value(x / 7, y / 7) * 0.05;
      }
    }
    const sample = (G, x, y) => {
      const u = clamp(x + M + 1, 0, gw - 1.001), v = clamp(y + M + 1, 0, gh - 1.001);
      const i = u | 0, j = v | 0, fu = u - i, fv = v - j, k = j * gw + i;
      return lerp(lerp(G[k], G[k + 1], fu), lerp(G[k + gw], G[k + gw + 1], fu), fv);
    };
    const elevAt = (x, y) => sample(grid, x, y);
    const inv = 1 / ppm;
    for (let py = 0; py < ch; py++) {
      const y = (py + 0.5) * inv - M;
      for (let px = 0; px < cw; px++) {
        const x = (px + 0.5) * inv - M;
        // Only needed outside the hole and under its feathered edge.
        const inside = Math.min(x, y, hole.W - x, hole.L - y);
        if (inside > 12) continue;
        const k = sample(mixG, x, y);
        const r = lerp(oob[0], deep[0], k), g = lerp(oob[1], deep[1], k), b = lerp(oob[2], deep[2], k);
        const gx = (elevAt(x + 0.6, y) - elevAt(x - 0.6, y)) / 1.2;
        const gy = (elevAt(x, y + 0.6) - elevAt(x, y - 0.6)) / 1.2;
        let shade = 0.94 + clamp((gx + gy) * 2.2, -0.28, 0.28);
        shade += sample(mottG, x, y) + noise.value(x / 1.7, y / 1.7) * 0.025;
        shade += (hash2((x * 5) | 0, (y * 5) | 0, 7) - 0.5) * 0.05;
        const o = (py * cw + px) * 4;
        data[o] = clamp(r * shade, 0, 255);
        data[o + 1] = clamp(g * shade, 0, 255);
        data[o + 2] = clamp(b * shade, 0, 255);
        data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Trees: the hole's own kinds, in clumps where the far surround shows its dark tree patches.
    const pool = hole.trees.filter((t) => !t.lava);
    if (pool.length) {
      const rng = new Golf.RNG((hole.seed ^ 0x7ee5) >>> 0);
      const density = clamp(pool.length / (hole.W * hole.L), 0.0008, 0.02) * 1.6;
      const trees = [];
      const n = Math.round(w * h * density);
      for (let i = 0; i < n * 3 && trees.length < n; i++) {
        const x = rng.float(-M, hole.W + M), y = rng.float(-M, hole.L + M);
        if (x > 2 && y > 2 && x < hole.W - 2 && y < hole.L - 2) continue;
        const clump = smoothstep(0.0, 0.3, noise.fbm(x / 20 + 31, y / 20 - 17, 2));
        if (rng.next() > 0.15 + 0.85 * clump) continue;
        const src = rng.pick(pool);
        trees.push({ ...src, x, y, tint: rng.float(-1, 1), r: src.r * rng.float(0.85, 1.15) });
      }
      trees.sort((a, b) => a.y - b.y);
      ctx.setTransform(ppm, 0, 0, ppm, M * ppm, M * ppm);
      ctx.fillStyle = 'rgba(10,40,10,0.28)';
      for (const t of trees) {
        ctx.beginPath();
        ctx.ellipse(t.x + t.h * 0.22, t.y + t.h * 0.18, t.r * 1.05, t.r * 0.9, 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      const bid = hole.biome ? hole.biome.id : 'parkland';
      for (const t of trees) drawTree(ctx, t, bid);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    const layer = { canvas, x0: -M, y0: -M, w, h, ppm };
    // Dissolve the outer part of the band into the soft distance.
    featherEdges(layer, M * 0.75);
    return layer;
  }

  // Beyond the mapped hole: a low-detail, soft-focus landscape (2 m pixels, smoothed when scaled up).
  // Under the hole's feathered edge it is a coarse average of the hole; outside it continues those colours, then turns into rolling scrub with tree clumps, and
  // far out it fades into the world's base colour.
  const SURROUND_M = 240;
  function buildSurround(hole, main) {
    const ppm = 0.5, M = SURROUND_M;
    const w = hole.W + 2 * M, h = hole.L + 2 * M;
    const cw = Math.round(w * ppm), ch = Math.round(h * ppm);
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    const ix0 = Math.round(M * ppm), iy0 = Math.round(M * ppm);
    const iw = Math.round(hole.W * ppm), ih = Math.round(hole.L * ppm);
    const img = ctx.createImageData(cw, ch);
    const data = img.data;
    // A coarse average of the hole (16 m cells) gives smooth edge colours to continue outward.
    const cell = 16;
    const sw = Math.max(2, Math.ceil(hole.W / cell)), sh = Math.max(2, Math.ceil(hole.L / cell));
    const small = document.createElement('canvas');
    small.width = sw;
    small.height = sh;
    const sctx = small.getContext('2d');
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(main.canvas, 0, 0, sw, sh);
    const avg = sctx.getImageData(0, 0, sw, sh).data;
    const edgeAt = (x, y, out) => {
      const u = clamp(x / cell - 0.5, 0, sw - 1.001), v = clamp(y / cell - 0.5, 0, sh - 1.001);
      const i = u | 0, j = v | 0, fu = u - i, fv = v - j;
      for (let ch4 = 0; ch4 < 3; ch4++) {
        const a = avg[(j * sw + i) * 4 + ch4], b = avg[(j * sw + i + 1) * 4 + ch4];
        const c = avg[((j + 1) * sw + i) * 4 + ch4], d = avg[((j + 1) * sw + i + 1) * 4 + ch4];
        out[ch4] = lerp(lerp(a, b, fu), lerp(c, d, fu), fv);
      }
      return out;
    };
    const edge = [0, 0, 0];
    const biome = hole.biome || Golf.BIOMES.parkland;
    const pal = biome.colors;
    const oob = pal[T.OOB] || COLORS[T.OOB], deep = pal[T.DEEP] || COLORS[T.DEEP];
    const bg = hexRgb(biome.bg || '#35602e');
    const noise = new Golf.Noise2D(hole.seed ^ 0x5a17);
    for (let py = 0; py < ch; py++) {
      const y = py / ppm - M;
      const cy = clamp(py, iy0, iy0 + ih - 1);
      for (let px = 0; px < cw; px++) {
        const x = px / ppm - M;
        const cx = clamp(px, ix0, ix0 + iw - 1);
        const dist = Math.hypot(px - cx, py - cy) / ppm;
        edgeAt(x, y, edge);
        // Rolling scrub: patches of deep rough over the out-of-bounds ground, darker clumps of trees.
        const n = noise.fbm(x / 45, y / 45, 3);
        const k = clamp(0.5 + n * 1.4, 0, 1);
        let r = lerp(oob[0], deep[0], k), g = lerp(oob[1], deep[1], k), b = lerp(oob[2], deep[2], k);
        const trees = smoothstep(0.08, 0.3, noise.fbm(x / 20 + 31, y / 20 - 17, 2));
        const shade = (1 - 0.32 * trees) * (1 + noise.value(x / 70, y / 70) * 0.1);
        r *= shade; g *= shade; b *= shade;
        const near = smoothstep(0, 60, dist);
        r = lerp(edge[0], r, near); g = lerp(edge[1], g, near); b = lerp(edge[2], b, near);
        const far = smoothstep(50, 210, dist);
        const o = (py * cw + px) * 4;
        data[o] = lerp(r, bg[0], far);
        data[o + 1] = lerp(g, bg[1], far);
        data[o + 2] = lerp(b, bg[2], far);
        data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return { canvas, x0: -M, y0: -M, w, h, ppm };
  }
  function hexRgb(hex) {
    const v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  // Fade a layer's outer edge to transparent so it melts into the soft surround instead of ending in a line.
  function featherEdges(layer, metres) {
    const ctx = layer.canvas.getContext('2d');
    const cw = layer.canvas.width, ch = layer.canvas.height;
    const f = Math.min(metres * layer.ppm, cw / 4, ch / 4);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-out';
    const side = (x0, y0, x1, y1, rx, ry, rw, rh) => {
      const gr = ctx.createLinearGradient(x0, y0, x1, y1);
      gr.addColorStop(0, 'rgba(0,0,0,1)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(rx, ry, rw, rh);
    };
    side(0, 0, f, 0, 0, 0, f, ch);
    side(cw, 0, cw - f, 0, cw - f, 0, f, ch);
    side(0, 0, 0, f, 0, 0, cw, f);
    side(0, ch, 0, ch - f, 0, ch - f, cw, f);
    ctx.globalCompositeOperation = 'source-over';
  }
  function buildGreenLayer(hole) {
    // Detailed layer around the green: covers chips, bunker shots and putts.
    const ext = hole.green.R * Math.max(hole.green.sx, hole.green.sy) * 1.3 + 50;
    const ppm = Math.min(12, 1300 / (ext * 2));
    return buildLayer(hole, hole.green.cx - ext, hole.green.cy - ext, ext * 2, ext * 2, ppm);
  }
  function buildMinimap(hole, layer, maxW, maxH) {
    const s = Math.min(maxW / hole.W, maxH / hole.L);
    const c = document.createElement('canvas');
    c.width = Math.round(hole.W * s);
    c.height = Math.round(hole.L * s);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = (hole.biome && hole.biome.bg) || '#35602e';
    ctx.fillRect(0, 0, c.width, c.height);
    const S = layer.surround;
    if (S) ctx.drawImage(S.canvas, -S.x0 * S.ppm, -S.y0 * S.ppm, hole.W * S.ppm, hole.L * S.ppm, 0, 0, c.width, c.height);
    const N = layer.near;
    if (N) ctx.drawImage(N.canvas, -N.x0 * N.ppm, -N.y0 * N.ppm, hole.W * N.ppm, hole.L * N.ppm, 0, 0, c.width, c.height);
    ctx.drawImage(layer.main ? layer.main.canvas : layer.canvas, 0, 0, c.width, c.height);
    return { canvas: c, scale: s };
  }

  // ---- Golfer animation -----------------------------------------------------------------------------
  const ease = (t) => t * t * (3 - 2 * t);
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  // Club direction keyframes (relative to the hands, local frame + height) through a full swing:
  // u = 0 address/impact, 1 = top of backswing, -1 = finish.
  const CLUB_KEYS = [
    [-1, [-0.25, 0.75, -0.3]], // finish: wrapped behind the shoulders
    [-0.65, [-0.05, -0.2, 0.95]], // club pointing up through the follow-through
    [-0.3, [0.3, -0.9, -0.2]], // extension toward the target
    [0, [0.401, -0.02, -0.75]], // address: hands (0.4, -0.03, 0.75) down to the ball at (0.8, -0.05, 0)
    [0.25, [0.2, 0.9, -0.1]], // takeaway: parallel to the ground
    [0.6, [0.02, 0.35, 0.9]], // wrists hinged, club up
    [1, [-0.15, -0.9, 0.2]], // top: across the shoulders toward the target
  ];
  function clubDir(u) {
    for (let i = 1; i < CLUB_KEYS.length; i++) {
      if (u <= CLUB_KEYS[i][0]) {
        const [u0, v0] = CLUB_KEYS[i - 1], [u1, v1] = CLUB_KEYS[i];
        return lerp3(v0, v1, ease((u - u0) / (u1 - u0)));
      }
    }
    return CLUB_KEYS[CLUB_KEYS.length - 1][1];
  }
  function golferPose(game, putting, club, time) {
    const top = putting ? 1.1 : 3.7;
    let u = clamp(game.clubAngle / top, -1, 1);
    const b = game.ball, G = game.golfer;
    const celebrate = b && b.state === 'holed';
    const pose = { breath: 1, heel: 0 };
    // Projected club length: at address the head sits exactly on the ball (0.85 from the hands).
    const len = club.id === 'DR' ? 0.9 : club.id && club.id.endsWith('W') ? 0.88 : 0.85;
    if (celebrate) {
      const bounce = Math.abs(Math.sin(time * 7)) * 0.06;
      pose.shoulder = 0;
      pose.hip = 0;
      pose.hands = [0.12, -0.08, 2.15 + bounce];
      pose.head = [0.1, -0.15, 3.0 + bounce];
      pose.look = G.aim + Math.PI / 2;
      return pose;
    }
    if (putting) {
      // Pendulum: shoulders rock, arms and putter move as one piece, no wrist hinge.
      const a = u * 0.34;
      pose.shoulder = u * 0.2;
      pose.hip = 0;
      const rot = (x, y) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
      const [hx, hy] = rot(0.36, -0.02);
      const [cx, cy] = rot(0.78, 0);
      pose.hands = [hx, hy, 0.72];
      pose.head = [cx, cy, 0.02];
    } else {
      const e = u >= 0 ? ease(u) : -ease(-u);
      pose.shoulder = u >= 0 ? 1.5 * e : 1.7 * e;
      pose.hip = pose.shoulder * 0.5;
      pose.heel = u < 0 ? -e : 0;
      // Hands orbit the chest and rise.
      const a = (u >= 0 ? 1.75 : 1.95) * e - 0.075;
      const r = 0.4 - 0.05 * Math.abs(e);
      const hz = 0.75 + 0.9 * Math.pow(Math.abs(u), 1.2);
      pose.hands = [Math.cos(a) * r, Math.sin(a) * r, hz];
      // Club relative to the hands, turned with the body (the keyframes are body-relative).
      let d = clubDir(u);
      const ta = pose.shoulder * (u >= 0 ? 0.35 : 0.25);
      d = [d[0] * Math.cos(ta) - d[1] * Math.sin(ta), d[0] * Math.sin(ta) + d[1] * Math.cos(ta), d[2]];
      // Address waggle while lining up.
      if (game.phase === 'aim') {
        const w = Math.max(0, Math.sin(time * 1.8)) ** 8 * 0.1;
        d = [d[0], d[1] + w, d[2] + w * 0.5];
        pose.breath = 1 + Math.sin(time * 1.6) * 0.02;
      }
      const n = Math.hypot(d[0], d[1], d[2]) || 1;
      pose.head = [pose.hands[0] + (d[0] / n) * len, pose.hands[1] + (d[1] / n) * len, Math.max(0.02, pose.hands[2] + (d[2] / n) * len)];
    }
    // Eyes on the ball until it's gone, then follow it.
    const bx = b ? b.x : G.x, by = b ? b.y : G.y;
    const watching = b && (game.phase === 'flight' || game.phase === 'settle') && Math.hypot(bx - G.x, by - G.y) > 1;
    pose.look = watching ? Math.atan2(by - G.y, bx - G.x) : G.aim + Math.PI / 2;
    return pose;
  }
  function drawClubHead(ctx, p, club, gs, ang) {
    ctx.save();
    ctx.translate(p[0], p[1]);
    ctx.rotate(ang);
    if (club.putter) {
      ctx.fillStyle = '#9aa3ab';
      ctx.fillRect(-0.03 * gs, -0.08 * gs, 0.06 * gs, 0.16 * gs);
    } else if (club.id === 'DR' || (club.id && club.id.endsWith('W'))) {
      ctx.fillStyle = '#1d232b';
      ctx.beginPath();
      ctx.ellipse(0.02 * gs, 0, 0.08 * gs, 0.065 * gs, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#c8cdd2';
      ctx.lineWidth = 0.012 * gs;
      ctx.stroke();
    } else {
      ctx.fillStyle = '#c3c9cf';
      ctx.beginPath();
      ctx.ellipse(0.01 * gs, 0, 0.04 * gs, 0.075 * gs, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---- Frame drawing -----------------------------------------------------------------------------
  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.dpr = 1;
      this.vw = 0;
      this.vh = 0;
      this.viewCenterY = 0;
    }
    resize(vw, vh, dpr) {
      this.vw = vw;
      this.vh = vh;
      this.dpr = dpr;
      this.canvas.width = Math.round(vw * dpr);
      this.canvas.height = Math.round(vh * dpr);
      this.canvas.style.width = vw + 'px';
      this.canvas.style.height = vh + 'px';
    }
    worldToScreen(cam, x, y) {
      return { x: (x - cam.x) * cam.scale + this.vw / 2, y: (y - cam.y) * cam.scale + this.viewCenterY };
    }
    screenToWorld(cam, sx, sy) {
      return { x: (sx - this.vw / 2) / cam.scale + cam.x, y: (sy - this.viewCenterY) / cam.scale + cam.y };
    }
    setWorld(cam) {
      const s = cam.scale * this.dpr;
      this.ctx.setTransform(s, 0, 0, s, (this.vw / 2 - cam.x * cam.scale) * this.dpr, (this.viewCenterY - cam.y * cam.scale) * this.dpr);
    }
    setScreen() {
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    draw(game, time) {
      const { ctx } = this;
      const cam = game.cam;
      const hole = game.hole;
      this.setScreen();
      ctx.fillStyle = (hole && hole.biome && hole.biome.bg) || '#35602e';
      ctx.fillRect(0, 0, this.vw, this.vh);
      if (!hole || !game.layers) return;

      this.setWorld(cam);
      ctx.imageSmoothingEnabled = true;
      const S = game.layers.surround;
      if (S) ctx.drawImage(S.canvas, S.x0, S.y0, S.w, S.h);
      const N = game.layers.near;
      if (N) ctx.drawImage(N.canvas, N.x0, N.y0, N.w, N.h);
      const L = game.layers.main;
      ctx.drawImage(L.canvas, L.x0, L.y0, L.w, L.h);
      if (game.layers.green && cam.scale > 2.5) {
        const G = game.layers.green;
        ctx.drawImage(G.canvas, G.x0, G.y0, G.w, G.h);
      }

      if (game.showSlopes) this.drawSlopes(game);
      this.drawGuide(game);
      this.drawTrail(game);
      this.drawCup(game, time);
      this.drawParticles(game, false);
      if (game.showGolfer) this.drawGolfer(game, time);
      this.drawBall(game);
      this.drawParticles(game, true);
      this.drawFlag(game, time);
    }

    px(cam, n) {
      return n / cam.scale;
    }

    drawSlopes(game) {
      const { ctx } = this;
      const hole = game.hole, cam = game.cam;
      const g = hole.green;
      const ext = g.R * Math.max(g.sx, g.sy) * 1.3;
      const step = clamp(40 / cam.scale, 1.6, 5);
      ctx.lineWidth = this.px(cam, 1.4);
      ctx.strokeStyle = 'rgba(255,255,255,0.32)';
      ctx.fillStyle = 'rgba(255,255,255,0.32)';
      for (let y = g.cy - ext; y < g.cy + ext; y += step) {
        for (let x = g.cx - ext; x < g.cx + ext; x += step) {
          if (hole.sampleIdx(hole.fGreen, x, y) > -0.5) continue;
          const gr = hole.grad(x, y);
          const m = Math.hypot(gr.x, gr.y);
          if (m < 0.002) continue;
          const len = clamp(m * 30, 0.15, 0.9) * step * 0.6;
          const dx = (-gr.x / m) * len, dy = (-gr.y / m) * len;
          ctx.beginPath();
          ctx.moveTo(x - dx / 2, y - dy / 2);
          ctx.lineTo(x + dx / 2, y + dy / 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(x + dx / 2, y + dy / 2, this.px(cam, 1.6), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    drawGuide(game) {
      if (!game.guide) return;
      const { ctx } = this;
      const cam = game.cam;
      const b = game.ball;
      const gd = game.guide;
      const dx = Math.cos(game.aim), dy = Math.sin(game.aim);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.setLineDash([this.px(cam, 6), this.px(cam, 7)]);
      ctx.lineWidth = this.px(cam, 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x + dx * gd.length, b.y + dy * gd.length);
      ctx.stroke();
      ctx.setLineDash([]);
      if (gd.ring) {
        const rr = Math.max(gd.ringR, this.px(cam, 7));
        ctx.lineWidth = this.px(cam, 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.arc(b.x + dx * gd.length, b.y + dy * gd.length, rr, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (gd.power != null) {
        const pl = gd.power;
        ctx.lineWidth = this.px(cam, 3);
        ctx.strokeStyle = 'rgba(255,214,64,0.95)';
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x + dx * pl, b.y + dy * pl);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(b.x + dx * pl, b.y + dy * pl, Math.max(gd.ringR * 0.6, this.px(cam, 5)), 0, Math.PI * 2);
        ctx.stroke();
        if (gd.roll != null) {
          // Expected roll-out after landing (chips and punches).
          ctx.setLineDash([this.px(cam, 3), this.px(cam, 4)]);
          ctx.lineWidth = this.px(cam, 2);
          ctx.beginPath();
          ctx.moveTo(b.x + dx * pl, b.y + dy * pl);
          ctx.lineTo(b.x + dx * gd.roll, b.y + dy * gd.roll);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(255,214,64,0.95)';
          ctx.beginPath();
          ctx.arc(b.x + dx * gd.roll, b.y + dy * gd.roll, this.px(cam, 3.5), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    drawTrail(game) {
      const tr = game.trail;
      if (tr.length < 2) return;
      const { ctx } = this;
      const cam = game.cam;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = this.px(cam, 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath();
      tr.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath();
      const hk = ZK * displayHeight.k;
      tr.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y - p.agl * hk) : ctx.moveTo(p.x, p.y - p.agl * hk)));
      ctx.stroke();
    }

    drawCup(game) {
      const { ctx } = this;
      const cam = game.cam;
      const p = game.hole.pin;
      const r = Math.max(0.11, this.px(cam, 2.5));
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 1.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1b1b1b';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    drawFlag(game, time) {
      const { ctx } = this;
      const cam = game.cam;
      const p = game.hole.pin;
      const pole = clamp(2.4 * cam.scale * ZK, 30, 90) / cam.scale;
      const ball = game.ball;
      const near = ball && Math.hypot(ball.x - p.x, ball.y - p.y) < 3 && game.clubIdx === Golf.physics.PUTTER;
      ctx.save();
      ctx.globalAlpha = near ? 0.35 : 1;
      ctx.lineWidth = this.px(cam, 2);
      ctx.strokeStyle = '#f4f4f4';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x, p.y - pole);
      ctx.stroke();
      const w = game.hole.wind;
      const dir = w.x >= 0 ? 1 : -1;
      const fl = pole * 0.4 * (0.6 + 0.4 * Math.min(1, w.speed / 5));
      const wave = Math.sin(time * (3 + w.speed)) * pole * 0.03;
      ctx.fillStyle = '#e8322b';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - pole);
      ctx.quadraticCurveTo(p.x + dir * fl * 0.5, p.y - pole + pole * 0.08 + wave, p.x + dir * fl, p.y - pole + pole * 0.12 + wave * 2);
      ctx.lineTo(p.x, p.y - pole + pole * 0.26);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    drawBall(game) {
      const b = game.ball;
      if (!b || b.state === 'holed' || b.state === 'water') return;
      const { ctx } = this;
      const cam = game.cam;
      // Heights are drawn scaled by gravity so a low-gravity lob looks like an Earth shot on screen.
      const agl = Math.max(0, b.z - game.hole.height(b.x, b.y)) * displayHeight.k;
      const r = Math.max(0.021 * 2, this.px(cam, 3.2)) * (1 + agl * 0.012);
      // Shadow.
      ctx.fillStyle = `rgba(0,0,0,${clamp(0.35 - agl * 0.006, 0.1, 0.35)})`;
      ctx.beginPath();
      ctx.ellipse(b.x + this.px(cam, 1), b.y + this.px(cam, 1), r * 1.1, r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      const by = b.y - agl * ZK;  // agl is already display-scaled above
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = this.px(cam, 1);
      ctx.beginPath();
      ctx.arc(b.x, by, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Locator ring when zoomed out a lot.
      if (cam.scale < 2.5 && b.state === 'rest') {
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = this.px(cam, 1.5);
        ctx.beginPath();
        ctx.arc(b.x, by, this.px(cam, 10), 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Golfer: a small pseudo-3D skeleton.  Each joint has a height (z) that is drawn lifted up the screen
    // like the ball, so the swing has depth.  Local frame: +x faces the ball, +y points away from the
    // target (the target is toward -y) for a right-handed player.
    drawGolfer(game, time) {
      const { ctx } = this;
      const cam = game.cam;
      const G = game.golfer;
      if (!G) return;
      const gs = Math.max(1, 28 / cam.scale); // keep the golfer readable when zoomed out
      const A = G.aim + Math.PI / 2; // facing direction (toward the ball line)
      const dx = Math.cos(G.aim), dy = Math.sin(G.aim);
      const fx = Math.cos(A), fy = Math.sin(A);
      const ox = G.x - fx * 0.8 * gs - dx * 0.05 * gs, oy = G.y - fy * 0.8 * gs - dy * 0.05 * gs;
      const ca = Math.cos(A), sa = Math.sin(A), zk = ZK * 0.62;
      const P = (lx, ly, z = 0) => [ox + (lx * ca - ly * sa) * gs, oy + (lx * sa + ly * ca) * gs - z * zk * gs];
      const club = Golf.physics.CLUBS[game.clubIdx] || {};
      const putting = !!club.putter;
      const pose = golferPose(game, putting, club, time);

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // Shadow.
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath();
      const sh = P(0.12, 0.05);
      ctx.ellipse(sh[0] + 0.25 * gs, sh[1] + 0.2 * gs, 0.42 * gs, 0.3 * gs, A, 0, Math.PI * 2);
      ctx.fill();

      const line = (a, b, w, color) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = w * gs;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      };
      const dot = (p, r, color) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(p[0], p[1], r * gs, 0, Math.PI * 2);
        ctx.fill();
      };
      const rot = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];

      // Feet (the trail heel lifts and turns through the finish).
      const shoe = '#2b2522';
      for (const side of [-1, 1]) {
        const lift = side > 0 ? pose.heel : 0;
        const [fx2, fy2] = rot(0.07, 0.24 * side, side > 0 ? -lift * 0.6 : 0);
        const p = P(fx2, fy2, lift * 0.08);
        ctx.fillStyle = shoe;
        ctx.beginPath();
        ctx.ellipse(p[0], p[1], 0.14 * gs, 0.06 * gs, A + (side > 0 ? -lift * 0.9 : 0), 0, Math.PI * 2);
        ctx.fill();
      }
      // Legs and hips.
      const pants = '#3b4252';
      for (const side of [-1, 1]) {
        const [hx, hy] = rot(0, 0.11 * side, pose.hip);
        line(P(0.07, 0.24 * side, 0.1), P(hx + 0.03, hy, 0.9), 0.13, pants);
      }
      {
        const c = P(0, 0, 0.95);
        ctx.fillStyle = pants;
        ctx.beginPath();
        ctx.ellipse(c[0], c[1], 0.13 * gs, 0.19 * gs, A + pose.hip, 0, Math.PI * 2);
        ctx.fill();
      }
      // Torso: shoulders capsule turning on top of the hips.
      const shirt = game.shirtColor;
      const [lsx, lsy] = rot(0.02, -0.21, pose.shoulder);
      const [tsx, tsy] = rot(0.02, 0.21, pose.shoulder);
      const leadSh = [lsx, lsy, 1.42], trailSh = [tsx, tsy, 1.42];
      line(P(0, 0, 1.0), P(0.02, 0, 1.35), 0.3 * pose.breath, shirt);
      line(P(...leadSh), P(...trailSh), 0.24 * pose.breath, shirt);
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 0.02 * gs;
      ctx.beginPath();
      const ls = P(...leadSh), ts = P(...trailSh);
      ctx.moveTo(ls[0], ls[1]);
      ctx.lineTo(ts[0], ts[1]);
      ctx.stroke();

      // Arms: shoulder -> elbow -> hands (elbows bow outward a little).
      const H = pose.hands, C = pose.head;
      const elbow = (sh, out) => {
        const mx = (sh[0] + H[0]) / 2, my = (sh[1] + H[1]) / 2, mz = (sh[2] + H[2]) / 2;
        return [mx + out[0], my + out[1], mz - 0.05];
      };
      const skin = '#e7b98f';
      const trailEl = elbow(trailSh, rot(0.03, 0.05, pose.shoulder));
      line(P(...trailSh), P(...trailEl), 0.085, shirt);
      line(P(...trailEl), P(...H), 0.07, skin);
      // Club: grip at the hands, shaft to the head.
      const shaftEnd = P(...C);
      const grip = P(...H);
      line(grip, shaftEnd, 0.035, '#cfd3d6');
      line(grip, P(H[0] + (C[0] - H[0]) * 0.22, H[1] + (C[1] - H[1]) * 0.22, H[2] + (C[2] - H[2]) * 0.22), 0.05, '#1e1e1e');
      drawClubHead(ctx, shaftEnd, club, gs, Math.atan2(shaftEnd[1] - grip[1], shaftEnd[0] - grip[0]));
      const leadEl = elbow(leadSh, rot(0.03, -0.05, pose.shoulder));
      line(P(...leadSh), P(...leadEl), 0.085, shirt);
      line(P(...leadEl), P(...H), 0.07, skin);
      dot(grip, 0.055, '#f4f4f4'); // glove

      // Head and cap (the brim points where the golfer is looking).
      const head = P(0.04, 0, 1.68);
      dot(head, 0.11, skin);
      const look = pose.look;
      ctx.fillStyle = '#1f2833';
      ctx.beginPath();
      ctx.arc(head[0], head[1], 0.1 * gs, look + Math.PI * 0.5, look + Math.PI * 1.5);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(head[0] + Math.cos(look) * 0.09 * gs, head[1] + Math.sin(look) * 0.09 * gs, 0.075 * gs, 0.05 * gs, look, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    drawParticles(game, above) {
      const { ctx } = this;
      for (const p of game.particles) {
        if (!!p.above !== above) continue;
        const a = clamp(p.life / p.max, 0, 1);
        if (p.kind === 'ring') {
          ctx.strokeStyle = (p.color || 'rgba(230,245,255,A)').replace('A', (a * 0.8).toFixed(2));
          ctx.lineWidth = this.px(game.cam, 2);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * (1 - a) + 0.2, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.fillStyle = p.color.replace('A', a.toFixed(2));
          ctx.beginPath();
          ctx.arc(p.x, p.y - p.z * ZK, Math.max(p.size, this.px(game.cam, 1.5)), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // ---- Minimap ------------------------------------------------------------------------------------
  function drawMinimap(canvas, game) {
    const mm = game.minimap;
    if (!mm) return;
    const ctx = canvas.getContext('2d');
    const dpr = game.dpr;
    const cw = mm.canvas.width, ch = mm.canvas.height;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      canvas.style.width = cw + 'px';
      canvas.style.height = ch + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(mm.canvas, 0, 0);
    const s = mm.scale;
    const hole = game.hole, b = game.ball;
    // Camera viewport.
    const r = game.renderer;
    const tl = r.screenToWorld(game.cam, 0, 0), br = r.screenToWorld(game.cam, r.vw, r.vh);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(tl.x * s, tl.y * s, (br.x - tl.x) * s, (br.y - tl.y) * s);
    // Aim.
    if (game.guide && b) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.moveTo(b.x * s, b.y * s);
      ctx.lineTo((b.x + Math.cos(game.aim) * game.guide.length) * s, (b.y + Math.sin(game.aim) * game.guide.length) * s);
      ctx.stroke();
    }
    ctx.fillStyle = '#e8322b';
    ctx.beginPath();
    ctx.arc(hole.pin.x * s, hole.pin.y * s, 2.5, 0, Math.PI * 2);
    ctx.fill();
    if (b) {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#000';
      ctx.beginPath();
      ctx.arc(b.x * s, b.y * s, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  function drawWind(canvas, wind, dpr) {
    const size = 30;
    if (canvas.width !== size * dpr) {
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      canvas.style.width = size + 'px';
      canvas.style.height = size + 'px';
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
    if (wind.speed < 1.2) return; // matches the 'calm' label
    const a = Math.atan2(wind.y, wind.x);
    const len = 8 + Math.min(1, wind.speed / 8) * 8;
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(a);
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#fff';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-len, 0);
    ctx.lineTo(len - 4, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(len + 2, 0);
    ctx.lineTo(len - 6, -6);
    ctx.lineTo(len - 6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  Golf.render = { displayHeight, Renderer, buildHoleLayers, buildGreenLayer, buildNearBand, buildMinimap, drawMinimap, drawWind, ZK };
})();
