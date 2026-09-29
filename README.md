# Golfy ⛳

A mobile-first golf mini game for the browser: real ball physics, a classic
three-click swing meter and endless procedurally generated 9-hole courses.
No build step and no dependencies, so it runs straight from GitHub Pages.

## Play

Open `index.html` through any static web server, or publish it with GitHub Pages
(**Settings → Pages → Deploy from a branch → `main` / root**). Share a course
by its seed: `https://<user>.github.io/Golfy/?seed=heron7`.

**Controls (touch)**
- **Aim:** drag anywhere on the course. Use ⟲ ⟳ for fine adjustment (hold to repeat).
- **Club:** ‹ › (a sensible club is picked automatically for each shot).
- **Swing:** hold **SWING** for the backswing and release to set power. Then tap
  again as the marker crosses the white line. Early = push/slice right, late = pull/hook left.
- The red **pin** mark on the meter is the power that carries the flag in calm air on flat ground.
- Pinch to zoom. Tap the minimap to see the whole hole. Hold the button during a shot to fast-forward.

**Desktop:** mouse to aim, click or Space to swing, ←/→ for fine aim, ↑/↓ for clubs,
wheel to zoom, `V` for overview, `C` for the scorecard, `M` to mute.

## What's simulated

- **Flight:** quadratic drag, Magnus lift from backspin, sidespin curve (slices and hooks),
  and wind that grows stronger with height. Clubs are tuned to realistic carries
  (driver ≈ 228 m down to sand wedge ≈ 88 m), and the power meter is linear in carry distance.
- **Landing:** bounces off the true terrain normal. Restitution and friction depend on the
  surface, and backspin bites, so wedges check up or spin back on greens. Balls plug in sand.
- **Rolling:** rolling resistance per surface plus gravity along the slope (5/7 g for a
  rolling sphere). Putts break, and slow balls get grabbed by longer grass.
- **Hazards:** trees (canopies knock the ball down, trunks deflect it), water (penalty drop
  where the ball last crossed the margin), bunkers, rough lies that cost distance and spin,
  out of bounds (stroke and distance), and lip-outs at the cup.

## Course generation

Each hole comes from a seed: a routed centreline with doglegs becomes a variable-width
fairway, then a blob-shaped green with a random pin, greenside and fairway bunkers,
ponds and creeks (kept clear of tees and greens), fractal-noise elevation with tilted
and undulating greens, clustered forests, deep rough and OOB stakes. A course is 9 holes
at par 36. Terrain is rasterised once per hole with hill shading, plus a high-resolution
layer around the green.

## Code layout

| File | Purpose |
| --- | --- |
| `js/util.js` | Seeded RNG, value noise, math helpers |
| `js/course.js` | Hole/course generation and terrain queries |
| `js/physics.js` | Clubs, ball flight, bounces, rolling, trees, cup |
| `js/render.js` | Terrain rasteriser and per-frame drawing |
| `js/audio.js` | Synthesised sound effects (WebAudio) |
| `js/game.js` | State machine, swing meter, input, camera, HUD, save/resume |

Run the headless checks with `node tests/run.js`.
