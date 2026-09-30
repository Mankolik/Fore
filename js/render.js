// Drawing: pre-rendered terrain layers plus per-frame ball, golfer, flag, guides and particles.
(function () {
  const Golf = globalThis.Golf;
  const T = Golf.T;
  const { clamp, lerp } = Golf.util;
  const hash2 = Golf.hash2;

  const ZK = 0.55; // how far (in metres of screen-up) one metre of height is drawn

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
    for (let py = 0; py < ch; py++) {
      const y = y0 + (py + 0.5) * inv;
      for (let px = 0; px < cw; px++) {
        const x = x0 + (px + 0.5) * inv;
        const t = hole.terrainAt(x, y);
        const c = COLORS[t];
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
          r = lerp(78, 30, q); g = lerp(160, 92, q); b = lerp(206, 160, q);
          const ripple = noise.value(x / 3 + y / 7, y / 2.5) * 0.06;
          shade = 1 + ripple;
          if (depth < 0.35) { r = 190; g = 225; b = 235; }
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
              r = 245; g = 245; b = 240; shade = 1;
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
    for (const t of trees) drawTree(ctx, t);
    return { canvas, x0, y0, w, h, ppm };
  }

  function drawTree(ctx, t) {
    const tint = t.tint * 12;
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

  function buildHoleLayers(hole) {
    const ppm = Math.min(3, Math.sqrt(2.4e6 / (hole.W * hole.L)));
    const main = buildLayer(hole, 0, 0, hole.W, hole.L, ppm);
    return { main, green: null };
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
    ctx.drawImage(layer.canvas, 0, 0, c.width, c.height);
    return { canvas: c, scale: s };
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
      ctx.fillStyle = '#35602e';
      ctx.fillRect(0, 0, this.vw, this.vh);
      if (!hole || !game.layers) return;

      this.setWorld(cam);
      ctx.imageSmoothingEnabled = true;
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
      this.drawBall(game);
      if (game.showGolfer) this.drawGolfer(game);
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
      tr.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y - p.agl * ZK) : ctx.moveTo(p.x, p.y - p.agl * ZK)));
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
      const agl = Math.max(0, b.z - game.hole.height(b.x, b.y));
      const r = Math.max(0.021 * 2, this.px(cam, 3.2)) * (1 + agl * 0.012);
      // Shadow.
      ctx.fillStyle = `rgba(0,0,0,${clamp(0.35 - agl * 0.006, 0.1, 0.35)})`;
      ctx.beginPath();
      ctx.ellipse(b.x + this.px(cam, 1), b.y + this.px(cam, 1), r * 1.1, r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      const by = b.y - agl * ZK;
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

    drawGolfer(game) {
      const { ctx } = this;
      const cam = game.cam;
      const b = game.ball;
      const gs = Math.max(1, 28 / cam.scale); // keep the golfer readable when zoomed out
      const dx = Math.cos(game.aim), dy = Math.sin(game.aim);
      const fx = -dy, fy = dx; // facing: toward the ball (golfer stands on the left of the line)
      const cx = b.x - fx * 0.8 * gs - dx * 0.05 * gs, cy = b.y - fy * 0.8 * gs - dy * 0.05 * gs;
      const phi = game.clubAngle;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.atan2(fy, fx));
      ctx.scale(gs, gs);
      // Feet.
      ctx.fillStyle = '#3a2c22';
      ctx.beginPath();
      ctx.ellipse(0.05, -0.22, 0.14, 0.06, 0, 0, Math.PI * 2);
      ctx.ellipse(0.05, 0.22, 0.14, 0.06, 0, 0, Math.PI * 2);
      ctx.fill();
      // Body rotates with the swing.
      const turn = clamp(phi, -2.2, 2.2) * 0.35;
      ctx.save();
      ctx.rotate(turn);
      ctx.fillStyle = game.shirtColor;
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.17, 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // Club: pivots around the hands.
      const hx = 0.36, hy = 0;
      const len = 0.44 + 0.4 * Math.sin(Math.min(Math.abs(phi), Math.PI) / 2);
      const ca = phi;
      const ex = hx + Math.cos(ca) * len, ey = hy + Math.sin(ca) * len;
      ctx.strokeStyle = '#d9d9d9';
      ctx.lineWidth = 0.05;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.fillStyle = '#555';
      ctx.beginPath();
      ctx.arc(ex, ey, 0.06, 0, Math.PI * 2);
      ctx.fill();
      // Arms.
      ctx.strokeStyle = '#e7b98f';
      ctx.lineWidth = 0.07;
      ctx.beginPath();
      ctx.moveTo(0.02, -0.18);
      ctx.lineTo(hx, hy);
      ctx.lineTo(0.02, 0.18);
      ctx.stroke();
      // Head & cap.
      ctx.fillStyle = '#e7b98f';
      ctx.beginPath();
      ctx.arc(0.02, 0, 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#20252b';
      ctx.beginPath();
      ctx.arc(0, 0, 0.1, Math.PI * 0.5, Math.PI * 1.5);
      ctx.fill();
      ctx.restore();
    }

    drawParticles(game, above) {
      const { ctx } = this;
      for (const p of game.particles) {
        if (!!p.above !== above) continue;
        const a = clamp(p.life / p.max, 0, 1);
        if (p.kind === 'ring') {
          ctx.strokeStyle = `rgba(230,245,255,${a * 0.8})`;
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
    const size = 40;
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

  Golf.render = { Renderer, buildHoleLayers, buildGreenLayer, buildMinimap, drawMinimap, drawWind, ZK };
})();
