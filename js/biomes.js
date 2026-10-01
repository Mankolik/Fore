// Course environments ("biomes"): each seed plays in one of them.  A biome sets the palette, tree types,
// terrain shaping, physics environment (gravity, air, wind, surfaces) and the names used in the HUD.
(function () {
  const Golf = globalThis.Golf;
  // Terrain ids (mirrors Golf.T, which is defined in course.js loaded after this file).
  const OOB = 0, DEEP = 1, ROUGH = 2, FIRST = 3, FAIRWAY = 4, TEE = 5, FRINGE = 6, GREEN = 7, SAND = 8, WATER = 9;

  const BIOMES = {
    parkland: {
      id: 'parkland', name: 'Parkland', icon: '🌳', weight: 3,
      colors: {
        [OOB]: [58, 104, 50], [DEEP]: [66, 124, 54], [ROUGH]: [82, 148, 64], [FIRST]: [96, 166, 72], [FAIRWAY]: [110, 184, 80],
        [TEE]: [108, 182, 80], [FRINGE]: [112, 192, 86], [GREEN]: [122, 206, 96], [SAND]: [232, 214, 160],
      },
      liquid: { style: 'water', shallow: [78, 160, 206], deep: [30, 92, 160], edge: [190, 225, 235] },
      bg: '#35602e', oobLine: [245, 245, 240],
      trees: [['oak', 1], ['pine', 1]], treeDensity: 1,
      gen: { lengthK: 1, heightAmp: 1, waterChance: 1, dunes: 0, craters: 0, windMul: 1 },
      env: { gravity: 1, air: 1, wind: 1, surf: {} },
      names: {},
      hazard: { title: 'Water hazard', sub: '+1 penalty stroke' },
      words: null, // uses the default course-name words
    },

    desert: {
      id: 'desert', name: 'Desert', icon: '🌵', weight: 2,
      colors: {
        [OOB]: [186, 150, 104], [DEEP]: [204, 168, 118], [ROUGH]: [222, 192, 142], [FIRST]: [178, 168, 104], [FAIRWAY]: [150, 166, 88],
        [TEE]: [146, 164, 88], [FRINGE]: [126, 172, 86], [GREEN]: [102, 178, 94], [SAND]: [244, 226, 176],
      },
      liquid: { style: 'water', shallow: [70, 196, 204], deep: [18, 112, 152], edge: [214, 240, 230] },
      bg: '#c49e68', oobLine: [120, 70, 40],
      trees: [['cactus', 5], ['palm', 1], ['rock', 1]], treeDensity: 0.55,
      // Hot, thin air carries the ball further; oases are rare but welcome.
      gen: { lengthK: 1.03, heightAmp: 1.3, waterChance: 0.45, dunes: 1.2, craters: 0, windMul: 1.1 },
      env: {
        gravity: 1, air: 0.9, wind: 1,
        surf: {
          [ROUGH]: { e: 0.14, mu: 0.75, roll: 0.8, grab: 0.15 }, // hard-pan waste area
          [DEEP]: { e: 0.1, mu: 0.85, roll: 1.1, grab: 0.1 },
          [FAIRWAY]: { e: 0.42, mu: 0.3, roll: 0.09, grab: 0.65 }, // baked fairways run
        },
      },
      lies: {
        flyer: ['Hardpan lie', 'ball sits up on baked ground — jumps ~6% further, little spin'],
        down: ['Soft sand pocket', 'ball has settled in loose sand — about 10% shorter'],
        buried: ['Tangled in scrub', 'about 12% shorter, easy to mishit'],
        divot: ['In a divot', 'about 7% shorter, harder to strike cleanly'],
        plugged: ['Fried egg', 'plugged in the sand — no spin, ~30% short'],
      },
      names: { [ROUGH]: 'Waste area', [DEEP]: 'Desert scrub', [OOB]: 'Out of bounds', [WATER]: 'Oasis' },
      hazard: { title: 'In the oasis', sub: '+1 penalty stroke' },
      words: [['Mesa', 'Saguaro', 'Canyon', 'Mirage', 'Coyote', 'Sandstone', 'Scorpion', 'Sunburst'], ['Springs', 'Flats', 'Wells', 'Ridge', 'Wash'], ['Desert Club', 'Golf Resort', 'Dunes']],
    },

    alien: {
      id: 'alien', name: 'Alien world', icon: '👽', weight: 2,
      colors: {
        [OOB]: [42, 22, 72], [DEEP]: [74, 42, 124], [ROUGH]: [62, 92, 164], [FIRST]: [44, 150, 164], [FAIRWAY]: [42, 190, 162],
        [TEE]: [44, 186, 160], [FRINGE]: [62, 206, 172], [GREEN]: [96, 232, 194], [SAND]: [206, 150, 222],
      },
      liquid: { style: 'acid', shallow: [176, 255, 84], deep: [58, 170, 22], edge: [236, 255, 170] },
      bg: '#24123f', oobLine: [255, 120, 255],
      trees: [['crystal', 3], ['mushroom', 2]], treeDensity: 0.55,
      // Low gravity and thin air: huge carries, so the holes are longer.  Meteor craters everywhere.
      gen: { lengthK: 1.41, heightAmp: 1.2, waterChance: 0.8, dunes: 0, craters: 7, windMul: 0.6 },
      env: { gravity: 0.62, air: 0.8, wind: 1, surf: {} },
      lies: {
        flyer: ['Floating on moss', 'springy moss — jumps ~6% further, little spin'],
        down: ['Sunk in moss', 'about 10% shorter and harder to strike'],
        buried: ['Snared by spores', 'about 12% shorter, easy to mishit'],
        divot: ['In a scorch mark', 'about 7% shorter, harder to strike cleanly'],
        plugged: ['Plugged in crater dust', 'no spin, comes out ~30% short'],
      },
      names: { [FAIRWAY]: 'Glowgrass', [FIRST]: 'Short moss', [ROUGH]: 'Blue moss', [DEEP]: 'Spore thicket', [SAND]: 'Crater dust', [WATER]: 'Acid pool', [GREEN]: 'Lumen green', [FRINGE]: 'Green fringe' },
      hazard: { title: 'Dissolved in acid!', sub: '+1 penalty stroke' },
      words: [['Xeno', 'Nebula', 'Zorbex', 'Kepler', 'Quasar', 'Lumen', 'Vega', 'Proxima'], ['Crater', 'Rift', 'Nexus', 'Prime', 'Expanse', 'Station'], ['Galactic Links', 'Orbital Club', 'Star Course']],
    },

    links: {
      id: 'links', name: 'Coastal links', icon: '🌊', weight: 2,
      colors: {
        [OOB]: [146, 138, 88], [DEEP]: [196, 176, 104], [ROUGH]: [116, 132, 76], [FIRST]: [140, 152, 86], [FAIRWAY]: [158, 170, 96],
        [TEE]: [154, 168, 96], [FRINGE]: [132, 172, 92], [GREEN]: [112, 172, 94], [SAND]: [226, 206, 150],
      },
      liquid: { style: 'water', shallow: [70, 132, 164], deep: [22, 62, 104], edge: [222, 236, 240] },
      bg: '#8a8455', oobLine: [245, 245, 240],
      trees: [['gorse', 6], ['pine', 1]], treeDensity: 0.45,
      // Firm, rumpled ground, dunes and wind off the sea.
      gen: { lengthK: 1, heightAmp: 0.8, waterChance: 0.6, dunes: 1.6, craters: 0, windMul: 1.6, potBunkers: true },
      env: {
        gravity: 1, air: 1, wind: 1,
        surf: {
          [FAIRWAY]: { e: 0.42, mu: 0.3, roll: 0.085, grab: 0.6 },
          [FIRST]: { e: 0.36, mu: 0.4, roll: 0.15, grab: 0.5 },
          [DEEP]: { e: 0.14, mu: 0.8, roll: 0.9, grab: 0.1 }, // wispy fescue swallows the ball
        },
      },
      lies: {
        flyer: ['Flyer lie', 'wiry grass — jumps ~6% further with little spin'],
        down: ['Nestled down', 'about 10% shorter and harder to strike'],
        buried: ['Buried in the fescue', 'about 12% shorter, easy to mishit'],
        divot: ['In a divot', 'about 7% shorter, harder to strike cleanly'],
        plugged: ['Plugged in the pot bunker', 'no spin, comes out ~30% short'],
      },
      names: { [DEEP]: 'Fescue', [ROUGH]: 'Links rough', [OOB]: 'Out of bounds', [WATER]: 'Sea inlet' },
      hazard: { title: 'Into the inlet', sub: '+1 penalty stroke' },
      words: [['Gorse', 'Seaside', 'Kittiwake', 'Saltire', 'Machair', 'Gannet', 'Driftwood', 'Tidewater'], ['Bay', 'Point', 'Head', 'Strand', 'Sound'], ['Links', 'Old Course', 'Golf Links']],
    },

    winter: {
      id: 'winter', name: 'Winter', icon: '❄️', weight: 2,
      colors: {
        [OOB]: [206, 216, 228], [DEEP]: [228, 234, 242], [ROUGH]: [240, 244, 250], [FIRST]: [184, 204, 202], [FAIRWAY]: [128, 156, 144],
        [TEE]: [132, 158, 148], [FRINGE]: [112, 158, 142], [GREEN]: [94, 156, 140], [SAND]: [226, 216, 192],
      },
      liquid: { style: 'ice', shallow: [206, 234, 248], deep: [150, 202, 232], edge: [255, 255, 255] },
      bg: '#d9e2ea', oobLine: [200, 40, 40],
      trees: [['snowpine', 5], ['birch', 1]], treeDensity: 0.9,
      // Cold, dense air: a touch shorter.  Snow grabs the ball; frozen ponds are playable (and slippery).
      gen: { lengthK: 0.97, heightAmp: 1.1, waterChance: 1.3, dunes: 0, craters: 0, windMul: 0.9 },
      env: {
        gravity: 1, air: 1.08, wind: 1, ice: true,
        surf: {
          [ROUGH]: { e: 0.06, mu: 0.9, roll: 1.2, grab: 0.1 },
          [DEEP]: { e: 0.03, mu: 0.95, roll: 1.8, grab: 0.05 },
          [OOB]: { e: 0.05, mu: 0.9, roll: 1.4, grab: 0.1 },
          [WATER]: { e: 0.45, mu: 0.08, roll: 0.04, grab: 0.05 }, // ice: glides further than a green, steadily slowing
        },
      },
      lies: {
        flyer: ['On packed snow', 'firm crust — jumps ~6% further, little spin'],
        down: ['Sunk in the snow', 'about 10% shorter and harder to strike'],
        buried: ['Plugged in deep snow', 'about 12% shorter, easy to mishit'],
        divot: ['On a frozen divot', 'about 7% shorter, harder to strike cleanly'],
        plugged: ['Frozen in the bunker', 'no spin, comes out ~30% short'],
      },
      names: { [ROUGH]: 'Snow', [DEEP]: 'Deep snow', [WATER]: 'Frozen pond', [FAIRWAY]: 'Frosty fairway', [SAND]: 'Frozen bunker' },
      hazard: null, // frozen: no penalty
      words: [['Frost', 'Glacier', 'Aurora', 'Birch', 'Tundra', 'Icicle', 'Snowdrift', 'Polar'], ['Peak', 'Fjord', 'Hollow', 'Pass', 'Valley'], ['Winter Club', 'Ice Links', 'Alpine Course']],
    },

    volcanic: {
      id: 'volcanic', name: 'Volcanic', icon: '🌋', weight: 2,
      colors: {
        [OOB]: [40, 32, 32], [DEEP]: [70, 60, 56], [ROUGH]: [96, 88, 82], [FIRST]: [84, 104, 66], [FAIRWAY]: [66, 130, 66],
        [TEE]: [68, 128, 66], [FRINGE]: [72, 142, 74], [GREEN]: [80, 156, 84], [SAND]: [48, 44, 52],
      },
      liquid: { style: 'lava', shallow: [120, 36, 18], deep: [255, 150, 40], edge: [44, 22, 16] },
      bg: '#2a2121', oobLine: [255, 196, 80],
      trees: [['dead', 3], ['rock', 2]], treeDensity: 0.6,
      gen: { lengthK: 1, heightAmp: 1.6, waterChance: 1.2, dunes: 0.5, craters: 2, windMul: 0.9 },
      env: { gravity: 1, air: 1, wind: 1, surf: { [ROUGH]: { e: 0.2, mu: 0.6, roll: 0.42, grab: 0.2 } } },
      lies: {
        flyer: ['Perched on ash', 'light ash — jumps ~6% further, little spin'],
        down: ['Sunk in ash', 'about 10% shorter and harder to strike'],
        buried: ['Caught in scorched scrub', 'about 12% shorter, easy to mishit'],
        divot: ['In a cinder divot', 'about 7% shorter, harder to strike cleanly'],
        plugged: ['Plugged in black sand', 'no spin, comes out ~30% short'],
      },
      names: { [ROUGH]: 'Ash', [DEEP]: 'Scorched scrub', [SAND]: 'Black sand', [WATER]: 'Lava', [OOB]: 'Out of bounds' },
      hazard: { title: 'Lava!', sub: 'Ball melted · +1 penalty stroke' },
      words: [['Ember', 'Obsidian', 'Cinder', 'Magma', 'Basalt', 'Pyro', 'Sulfur', 'Brimstone'], ['Caldera', 'Crater', 'Rift', 'Summit', 'Vent'], ['Volcano Club', 'Lava Links', 'Fire Course']],
    },
  };

  const ORDER = ['parkland', 'desert', 'alien', 'links', 'winter', 'volcanic'];

  // The biome is derived from its own hash of the seed so a seed's hole layouts don't depend on it.
  function biomeForSeed(seedStr) {
    const h = Golf.hashString(String(seedStr) + '#biome');
    const total = ORDER.reduce((a, k) => a + BIOMES[k].weight, 0);
    let r = (h / 4294967296) * total;
    for (const k of ORDER) {
      r -= BIOMES[k].weight;
      if (r < 0) return BIOMES[k];
    }
    return BIOMES.parkland;
  }

  Golf.BIOMES = BIOMES;
  Golf.BIOME_ORDER = ORDER;
  Golf.biomeForSeed = biomeForSeed;
})();
