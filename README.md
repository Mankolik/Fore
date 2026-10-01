# Golfy ⛳

A mobile-first golf mini game for the browser: real ball physics, a classic
three-click swing meter and endless procedurally generated 9-hole courses.
No build step and no dependencies, so it runs straight from GitHub Pages.

## Play

Live at **https://mankolik.github.io/Golfy/**. GitHub Pages serves the `gh-pages` branch,
so publish updates with `git push origin main:gh-pages`. Share a course by its seed:
`https://mankolik.github.io/Golfy/?seed=heron7`. To run it locally, serve the folder with any
static web server.

**Controls (touch)**
- **Aim:** drag anywhere on the course. Use ⟲ ⟳ for fine adjustment (hold to repeat).
- **Shot type:** choose from the row above the club: Full, ¾ (controlled), Chip (low bump & run, metered by total
  distance incl. roll), Flop (high & soft, 56°/60° only), Punch (low, under trees) or Putt.
- **Club:** ‹ › steps through the clubs that can play the selected shot, so the shot type never resets. The bag has 15:
  Driver, 3W, 5W, 3 & 4 hybrids (better out of the rough), 5–9 irons, PW, 52°, 56°, 60° and putter.
  A sensible shot and club are suggested each time.
- **Swing:** hold **SWING** for the backswing and release to set power. Then tap
  again as the marker crosses the white line. Early = push/slice right, late = pull/hook left.
- The red **pin** mark on the meter is the power that carries the flag in calm air on flat ground.
- Pinch to zoom. Tap the minimap to see the whole hole. Hold the button during a shot to fast-forward.

**Desktop:** mouse to aim, click or Space to swing, ←/→ for fine aim, ↑/↓ for clubs, `S` for the next shot type,
wheel to zoom, `V` for overview, `C` for the scorecard, `M` to mute.

## Worlds

Every seed plays in one of six environments (the menu preview shows which; roll the dice for another):

| World | Look | Twist |
| --- | --- | --- |
| 🌳 Parkland | Classic tree-lined course | — |
| 🌵 Desert | Irrigated fairways, waste areas, cacti, oases | Hot thin air (+3% carry), baked fairways, firm waste areas |
| 👽 Alien world | Glowgrass, blue moss, crystals, giant mushrooms, acid pools | Low gravity (~40% more carry, longer holes), meteor craters |
| 🌊 Coastal links | Dunes, golden fescue, gorse, pot bunkers | Strong sea wind, firm running ground |
| ❄️ Winter | Snow, snowy pines, bare birches | Snow grabs the ball; frozen ponds are playable and slippery |
| 🌋 Volcanic | Ash, black sand, dead trees, basalt | Lava lakes, craters, big elevation changes |

Each world also has its own soundtrack of three procedurally synthesized tracks (Web Audio, no audio files):
parkland acoustic plucks and swing, desert oud and frame drums, alien synth arpeggios, Celtic jigs on the links,
music-box bells in winter and taiko-driven tracks on the volcano. ♫ toggles music (long-press or `N` for the next
track); 🔊 toggles sound effects.

Biomes live in `js/biomes.js` (palette, trees, terrain shaping, physics environment, names). A seed's biome
comes from its own hash, so parkland seeds keep the same layouts they always had.

## What's simulated

- **Flight:** quadratic drag, Magnus lift from backspin, sidespin curve (slices and hooks),
  and wind that grows stronger with height. Clubs are tuned to realistic carries
  (driver ≈ 228 m down to 60° ≈ 74 m, roughly 8–14 m gaps), and the power meter is linear in carry distance.
- **Landing:** bounces off the true terrain normal. Restitution and friction depend on the
  surface, and backspin bites, so wedges check up or spin back on greens. Balls plug in sand.
- **Rolling:** rolling resistance per surface plus gravity along the slope (5/7 g for a
  rolling sphere). Putts break, and slow balls get grabbed by longer grass.
- **Strike quality:** every club has a mishit risk that depends on the lie (driver/woods from sand or deep rough
  are nearly hopeless, hybrids handle rough, 56°/60° wedges handle sand). A well-timed swing cuts the risk. Mishits
  come out fat, thin, topped or bladed. Each shot type also has its own distance spread: chips are the tightest,
  flops the loosest. The timing window depends on swing size, so a flop is as demanding as a full swing.
- **Long game:** full swings have natural dispersion by club (driver ±1.3° down to ±0.7° for wedges), longer clubs
  punish mistimed strikes more, and the perfect-timing window is tighter on full swings. Wind gusts ±20% per shot
  and bites harder on full shots; fairways pinch in around the driving zone. Lies vary: flyers and balls sitting down
  in the rough, divots on fairways, plugged bunker lies. `node tests/longgame.js` and `node tests/putting.js` are the
  matching balance harnesses (putting is deliberately left as-is).
- **Reading the shot:** the chip/punch pin marker accounts for the grass and the up/downhill along your line (not
  the side-slope break, which you read from the arrows). `node tests/shortgame.js` runs a balance harness that plays
  thousands of greenside shots with human-like timing noise.
- **Hazards:** trees (canopies knock the ball down, trunks deflect it), water (penalty drop
  where the ball last crossed the margin), bunkers, rough lies that cost distance and spin,
  out of bounds (stroke and distance), and lip-outs at the cup.

## Course generation

Each hole comes from a seed: a routed centreline with doglegs becomes a variable-width
fairway, then a blob-shaped green complex (raised greens with run-off banks, two-tier greens, grass hollows)
with a random pin, greenside, fairway and deep pot bunkers, water tight to some greens,
ponds and creeks (kept clear of tees and greens), fractal-noise elevation with tilted
and undulating greens, clustered forests, deep rough and OOB stakes. A course is 9 holes
at par 36, mixing short par 3s and drivable par 4s with long holes. Terrain is rasterised once per hole with hill shading, plus a high-resolution
layer around the green.

## Code layout

| File | Purpose |
| --- | --- |
| `js/util.js` | Seeded RNG, value noise, math helpers |
| `js/biomes.js` | World definitions: palettes, trees, terrain shaping, physics, names |
| `js/course.js` | Hole/course generation and terrain queries |
| `js/physics.js` | Clubs, ball flight, bounces, rolling, trees, cup |
| `js/render.js` | Terrain rasteriser and per-frame drawing |
| `js/audio.js` | Synthesised sound effects (WebAudio) |
| `js/music.js` | Procedural music sequencer, instruments and the 18 world tracks |
| `js/game.js` | State machine, swing meter, input, camera, HUD, save/resume |

Run the headless checks with `node tests/run.js`.
