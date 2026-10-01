// Procedural soundtrack: a small Web Audio sequencer with synthesized instruments and three tracks per
// world.  Tracks are generated from a chord progression, a scale and a seeded melody, so there are no
// audio files to download.
(function () {
  const Golf = globalThis.Golf;

  const CHORDS = {
    maj: [0, 4, 7], min: [0, 3, 7], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10], dom7: [0, 4, 7, 10],
    sus2: [0, 2, 7], sus4: [0, 5, 7], dim: [0, 3, 6], pow: [0, 7, 12], add9: [0, 4, 7, 14], m9: [0, 3, 7, 10, 14],
  };
  const MAJ = [0, 2, 4, 5, 7, 9, 11], MIN = [0, 2, 3, 5, 7, 8, 10], PENTA = [0, 2, 4, 7, 9], DORIAN = [0, 2, 3, 5, 7, 9, 10];
  const MIXO = [0, 2, 4, 5, 7, 9, 10], LYDIAN = [0, 2, 4, 6, 7, 9, 11], HIJAZ = [0, 1, 4, 5, 7, 8, 10], PHRYG = [0, 1, 3, 5, 7, 8, 10];
  const HARM = [0, 2, 3, 5, 7, 8, 11];

  // Track definitions.  steps: steps per beat (4 = sixteenths, 3 = jig triplets, 2 = waltz eighths).
  // Patterns are one bar long; bass symbols: R root, O octave, 5 fifth, 3 third, 6 sixth, . rest.
  const TRACKS = {
    parkland: [
      { name: 'Morning Fairway', bpm: 92, beats: 4, steps: 4, root: 60, scale: PENTA, bpc: 1,
        chords: [[0, 'add9'], [7, 'maj'], [9, 'min7'], [5, 'maj7']],
        pad: 'soft', bass: { inst: 'pluckBass', pat: 'R.......5...O...' }, arp: { inst: 'pluck', every: 2 },
        lead: { inst: 'guitar', density: 0.42, oct: 12 }, drums: { shaker: '..x...x...x...x.', kick: 'x.......x.......' } },
      { name: 'Clubhouse Stroll', bpm: 104, beats: 4, steps: 4, root: 53, scale: MAJ, bpc: 1, swing: 0.28,
        chords: [[2, 'min7'], [7, 'dom7'], [0, 'maj7'], [9, 'min7']],
        pad: 'soft', bass: { inst: 'pluckBass', pat: 'R...3...5...6...' },
        lead: { inst: 'vibes', density: 0.5, oct: 24 }, drums: { hat: 'x..xx..xx..xx..x', kick: 'x.......x.......' } },
      { name: 'Back Nine', bpm: 84, beats: 4, steps: 4, root: 55, scale: MAJ, bpc: 2,
        chords: [[0, 'maj'], [5, 'add9'], [9, 'min'], [7, 'sus4']],
        pad: 'warm', bass: { inst: 'pluckBass', pat: 'R.......R...5...' }, arp: { inst: 'pluck', every: 1 },
        lead: { inst: 'whistle', density: 0.28, oct: 12 }, drums: { shaker: '..x...x...x...x.' } },
    ],
    desert: [
      { name: 'Mirage', bpm: 78, beats: 4, steps: 4, root: 52, scale: HIJAZ, bpc: 2,
        chords: [[0, 'maj'], [1, 'maj'], [0, 'maj'], [10, 'min']],
        drone: 'reed', lead: { inst: 'oud', density: 0.55, oct: 12 }, drums: { dum: 'x.....x...x.....', tek: '...x.x.....x.x.x' } },
      { name: 'Caravan', bpm: 96, beats: 4, steps: 4, root: 50, scale: HIJAZ, bpc: 1,
        chords: [[0, 'maj'], [5, 'min'], [1, 'maj'], [0, 'maj']],
        drone: 'reed', bass: { inst: 'oudBass', pat: 'R..R..R.R.R.R...' }, lead: { inst: 'oud', density: 0.62, oct: 12 },
        drums: { dum: 'x..x..x...x..x..', tek: '..x..x.xx..x.x.x', shaker: 'x.x.x.x.x.x.x.x.' } },
      { name: 'Sunbaked', bpm: 70, beats: 4, steps: 4, root: 57, scale: MIN, bpc: 2,
        chords: [[0, 'min'], [8, 'maj'], [10, 'maj'], [0, 'min']],
        pad: 'warm', drone: 'reed', lead: { inst: 'oud', density: 0.3, oct: 12 }, drums: { dum: 'x.........x.....', tek: '......x.......x.' } },
    ],
    alien: [
      { name: 'Orbit', bpm: 100, beats: 4, steps: 4, root: 57, scale: MIN, bpc: 2,
        chords: [[0, 'min7'], [8, 'maj7'], [3, 'maj7'], [10, 'sus2']],
        pad: 'lush', bass: { inst: 'sub', pat: 'R...R...R...R.R.' }, arp: { inst: 'sqArp', every: 1 },
        lead: { inst: 'bleep', density: 0.22, oct: 24 }, drums: { kick: 'x...x...x...x...', hat: '..x...x...x...x.' } },
      { name: 'Xeno Lounge', bpm: 88, beats: 4, steps: 4, root: 62, scale: LYDIAN, bpc: 2, swing: 0.15,
        chords: [[0, 'maj7'], [2, 'maj'], [0, 'maj7'], [7, 'maj7']],
        pad: 'lush', bass: { inst: 'sub', pat: 'R.....R...R.....' }, lead: { inst: 'vibes', density: 0.4, oct: 12 },
        drums: { kick: 'x.........x.....', hat: '....x.......x...' } },
      { name: 'Low Gravity', bpm: 72, beats: 4, steps: 4, root: 49, scale: DORIAN, bpc: 2,
        chords: [[0, 'm9'], [5, 'dom7']],
        pad: 'lush', drone: 'deep', arp: { inst: 'sqArp', every: 2 }, lead: { inst: 'bleep', density: 0.15, oct: 24 } },
    ],
    links: [
      { name: 'Sea Breeze', bpm: 100, beats: 4, steps: 3, root: 62, scale: MIXO, bpc: 1,
        chords: [[0, 'maj'], [10, 'maj'], [0, 'maj'], [7, 'min']],
        drone: 'pipes', lead: { inst: 'whistle', density: 0.72, oct: 12 }, drums: { bodhran: 'x..x.xx..x.x' } },
      { name: 'Gorse Jig', bpm: 108, beats: 4, steps: 3, root: 55, scale: MAJ, bpc: 1,
        chords: [[0, 'maj'], [5, 'maj'], [0, 'maj'], [7, 'maj']],
        bass: { inst: 'pluckBass', pat: 'R..5..R..5..' }, lead: { inst: 'whistle', density: 0.78, oct: 24 }, drums: { bodhran: 'x.xx.xx.xx.x' } },
      { name: 'Tidewater', bpm: 66, beats: 4, steps: 4, root: 52, scale: DORIAN, bpc: 2,
        chords: [[0, 'min'], [10, 'maj'], [3, 'maj'], [7, 'min']],
        pad: 'soft', drone: 'pipes', lead: { inst: 'whistle', density: 0.32, oct: 24 } },
    ],
    winter: [
      { name: 'First Snow', bpm: 76, beats: 4, steps: 4, root: 60, scale: MAJ, bpc: 2,
        chords: [[0, 'maj7'], [9, 'min7'], [5, 'maj7'], [7, 'sus4']],
        pad: 'soft', arp: { inst: 'bell', every: 4 }, lead: { inst: 'bell', density: 0.45, oct: 24 }, drums: { sleigh: '..x...x...x...x.' } },
      { name: 'Aurora', bpm: 64, beats: 4, steps: 4, root: 57, scale: MIN, bpc: 2,
        chords: [[0, 'm9'], [8, 'maj7'], [5, 'maj7'], [7, 'sus2']],
        pad: 'lush', lead: { inst: 'bell', density: 0.28, oct: 24 } },
      { name: 'Fireside', bpm: 132, beats: 3, steps: 2, root: 53, scale: MAJ, bpc: 1,
        chords: [[0, 'maj'], [9, 'min'], [5, 'maj'], [7, 'dom7']],
        bass: { inst: 'pluckBass', pat: 'R.5.5.' }, lead: { inst: 'bell', density: 0.55, oct: 24 }, drums: { sleigh: '..x.x.' } },
    ],
    volcanic: [
      { name: 'Magma Pulse', bpm: 112, beats: 4, steps: 4, root: 40, scale: PHRYG, bpc: 1,
        chords: [[0, 'pow'], [1, 'pow'], [0, 'pow'], [10, 'pow']],
        pad: 'dark', bass: { inst: 'sawBass', pat: 'RRRRRRRRRRRRRRRR' }, drums: { taiko: 'x.....x...x.....', kick: 'x.......x.......' },
        lead: { inst: 'sawLead', density: 0.18, oct: 24 } },
      { name: 'Obsidian', bpm: 70, beats: 4, steps: 4, root: 50, scale: PHRYG, bpc: 2,
        chords: [[0, 'min'], [1, 'maj'], [10, 'min'], [0, 'min']],
        pad: 'dark', drone: 'deep', drums: { taiko: 'x.......x..x....' }, lead: { inst: 'vibes', density: 0.18, oct: 12 } },
      { name: 'Eruption', bpm: 132, beats: 4, steps: 4, root: 49, scale: HARM, bpc: 1,
        chords: [[0, 'min'], [8, 'maj'], [11, 'dim'], [0, 'min']],
        bass: { inst: 'sawBass', pat: 'R.R.R.R.R.R.R.RO' }, drums: { kick: 'x...x.x.x...x.x.', snare: '....x.......x...', taiko: 'x...............' },
        lead: { inst: 'sawLead', density: 0.42, oct: 24 } },
    ],
  };

  let ctx = null, out = null, echo = null, noiseBuf = null;
  let enabled = true;
  try { enabled = localStorage.getItem('golfy.music') !== '0'; } catch (e) { /* storage unavailable */ }
  let world = null, trackIdx = 0, track = null, step = 0, nextT = 0, timer = null, onTrack = null, wanted = null;
  const VOLUME = 0.16;
  // Loudness trims so every track sits at roughly the same level (measured with renderOffline).
  const TRIM = {
    'Mirage': 2.2, 'Caravan': 1.6, 'Sunbaked': 1.75, 'Orbit': 0.5, 'Xeno Lounge': 0.65, 'Aurora': 1.75,
    'Fireside': 1.45, 'Magma Pulse': 0.75, 'Obsidian': 0.72, 'Eruption': 0.85, 'Sea Breeze': 1.2,
  };
  const level = () => VOLUME * (track ? TRIM[track.name] || 1 : 1);

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rngFrom(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- Instruments ------------------------------------------------------------------------------
  function env(g, t, a, peak, d, sustain = 0.0001) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + a + d);
  }
  function voice(t, freq, type, dur, peak, { attack = 0.005, cutoff = 4000, cutoffEnd = null, q = 0.7, send = 0, detune = 0, release = 0.05, hold = false } = {}) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.detune.value = detune;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(cutoff, t);
    if (cutoffEnd) f.frequency.exponentialRampToValueAtTime(cutoffEnd, t + Math.max(0.05, dur));
    const g = ctx.createGain();
    if (hold) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + attack);
      g.gain.setValueAtTime(peak, t + Math.max(attack, dur - release));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);
    } else env(g, t, attack, peak, dur);
    o.connect(f).connect(g).connect(out);
    if (send) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s).connect(echo);
    }
    o.start(t);
    o.stop(t + dur + release + 0.1);
    return o;
  }
  const INST = {
    pluck: (t, m, d, v) => voice(t, mtof(m), 'triangle', 0.7, 0.16 * v, { cutoff: 3200, cutoffEnd: 600 }),
    guitar: (t, m, d, v) => voice(t, mtof(m), 'sawtooth', 0.9, 0.09 * v, { cutoff: 2600, cutoffEnd: 500, send: 0.15 }),
    pluckBass: (t, m, d, v) => voice(t, mtof(m), 'triangle', Math.min(0.8, d), 0.32 * v, { cutoff: 900, cutoffEnd: 200 }),
    oud: (t, m, d, v) => voice(t, mtof(m), 'sawtooth', 0.55, 0.11 * v, { cutoff: 2200, cutoffEnd: 400, q: 2, send: 0.12 }),
    oudBass: (t, m, d, v) => voice(t, mtof(m), 'sawtooth', 0.4, 0.14 * v, { cutoff: 700, cutoffEnd: 150 }),
    vibes: (t, m, d, v) => {
      voice(t, mtof(m), 'sine', 1.4, 0.13 * v, { send: 0.25 });
      voice(t, mtof(m) * 4, 'sine', 0.3, 0.025 * v);
    },
    bell: (t, m, d, v) => {
      voice(t, mtof(m), 'sine', 1.8, 0.12 * v, { send: 0.3 });
      voice(t, mtof(m) * 2.76, 'sine', 0.6, 0.04 * v, { send: 0.2 });
    },
    whistle: (t, m, d, v) => {
      const o = voice(t, mtof(m), 'sine', Math.max(0.12, d * 0.95), 0.1 * v, { attack: 0.03, hold: true, release: 0.06, send: 0.12 });
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = 5.5;
      lg.gain.value = mtof(m) * 0.006;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(t + 0.12);
      lfo.stop(t + d + 0.2);
    },
    bleep: (t, m, d, v) => voice(t, mtof(m), 'square', 0.25, 0.05 * v, { cutoff: 2500, send: 0.45 }),
    sqArp: (t, m, d, v) => voice(t, mtof(m), 'square', 0.22, 0.045 * v, { cutoff: 1800, cutoffEnd: 600, send: 0.4 }),
    sub: (t, m, d, v) => voice(t, mtof(m), 'sine', Math.min(0.9, d), 0.34 * v, { attack: 0.01, hold: true, release: 0.08 }),
    sawBass: (t, m, d, v) => voice(t, mtof(m), 'sawtooth', Math.min(0.25, d), 0.16 * v, { cutoff: 600, cutoffEnd: 160, q: 3 }),
    sawLead: (t, m, d, v) => voice(t, mtof(m), 'sawtooth', Math.max(0.15, d), 0.06 * v, { attack: 0.02, cutoff: 2400, hold: true, release: 0.1, send: 0.2, detune: 6 }),
  };
  const PADS = {
    soft: { type: 'triangle', cutoff: 1400, peak: 0.05, detune: 6 },
    warm: { type: 'sawtooth', cutoff: 900, peak: 0.035, detune: 8 },
    lush: { type: 'sawtooth', cutoff: 1500, peak: 0.03, detune: 14 },
    dark: { type: 'sawtooth', cutoff: 480, peak: 0.05, detune: 10 },
  };
  function pad(t, notes, dur, kind) {
    const p = PADS[kind];
    for (const m of notes) for (const dt of [-p.detune, p.detune])
      voice(t, mtof(m), p.type, dur, p.peak, { attack: Math.min(0.8, dur * 0.3), hold: true, release: 0.9, cutoff: p.cutoff, detune: dt, send: 0.1 });
  }
  function drone(t, root, dur, kind) {
    if (kind === 'deep') voice(t, mtof(root - 12), 'sine', dur, 0.12, { attack: 1, hold: true, release: 1 });
    else {
      const cutoff = kind === 'pipes' ? 1100 : 650;
      for (const m of [root - 12, root - 5]) voice(t, mtof(m), 'sawtooth', dur, 0.03, { attack: 0.6, hold: true, release: 0.8, cutoff, detune: 4 });
    }
  }
  function noiseHit(t, dur, type, freq, peak, q = 1) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    env(g, t, 0.002, peak, dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }
  function thump(t, f0, f1, dur, peak) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    env(g, t, 0.003, peak, dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  const DRUMS = {
    kick: (t, v) => thump(t, 120, 45, 0.28, 0.5 * v),
    snare: (t, v) => { noiseHit(t, 0.16, 'bandpass', 1800, 0.25 * v, 0.8); thump(t, 220, 160, 0.08, 0.12 * v); },
    hat: (t, v) => noiseHit(t, 0.04, 'highpass', 7000, 0.07 * v),
    shaker: (t, v) => noiseHit(t, 0.07, 'bandpass', 6500, 0.06 * v, 1.5),
    sleigh: (t, v) => { noiseHit(t, 0.12, 'bandpass', 8000, 0.05 * v, 4); noiseHit(t + 0.03, 0.08, 'bandpass', 9500, 0.03 * v, 4); },
    dum: (t, v) => { thump(t, 140, 70, 0.3, 0.4 * v); noiseHit(t, 0.05, 'lowpass', 800, 0.08 * v); },
    tek: (t, v) => { noiseHit(t, 0.05, 'bandpass', 3200, 0.12 * v, 2); thump(t, 480, 380, 0.04, 0.06 * v); },
    bodhran: (t, v) => { thump(t, 110, 65, 0.22, 0.32 * v); noiseHit(t, 0.06, 'lowpass', 1200, 0.07 * v); },
    taiko: (t, v) => { thump(t, 95, 48, 0.7, 0.6 * v); noiseHit(t, 0.12, 'lowpass', 600, 0.15 * v); },
  };

  // ---- Arrangement ---------------------------------------------------------------------------------
  function scaleNotes(def, lo, hi) {
    const out = [];
    for (let m = lo; m <= hi; m++) if (def.scale.includes((((m - def.root) % 12) + 12) % 12)) out.push(m);
    return out;
  }
  // A seeded melody for one pass of the progression: chord tones on strong beats, scale steps between.
  function makeMelody(def, seed) {
    const rnd = rngFrom(seed);
    const per = def.beats * def.steps, bars = def.chords.length * def.bpc;
    const base = def.root + def.lead.oct;
    const notes = scaleNotes(def, base - 5, base + 14);
    const i0 = notes.findIndex((m) => m >= base + 4);
    let idx = i0 < 0 ? 0 : i0;
    const mel = [];
    for (let bar = 0; bar < bars; bar++) {
      const [deg, q] = def.chords[Math.floor(bar / def.bpc) % def.chords.length];
      const pcs = CHORDS[q].map((i) => (((def.root + deg + i - def.root) % 12) + 12) % 12);
      for (let s = 0; s < per; s++) {
        const strong = s % def.steps === 0;
        const p = def.lead.density * (s === 0 ? 1.5 : strong ? 1.2 : 0.55);
        if (rnd() >= p) { mel.push(null); continue; }
        if (strong) {
          // Nearest chord tone, with a little freedom.
          let best = idx, bestD = 99;
          notes.forEach((m, i) => {
            if (!pcs.includes((((m - def.root) % 12) + 12) % 12)) return;
            const d = Math.abs(i - idx) + rnd() * 2.5;
            if (d < bestD) { bestD = d; best = i; }
          });
          idx = best;
        } else {
          idx += [-2, -1, -1, 1, 1, 2][Math.floor(rnd() * 6)];
          idx = Math.max(0, Math.min(notes.length - 1, idx));
        }
        mel.push(notes[idx]);
      }
    }
    // Each note lasts until the next one (capped at two beats).
    return mel.map((m, i) => {
      if (m == null) return null;
      let len = 1;
      while (i + len < mel.length && mel[i + len] == null && len < def.steps * 2) len++;
      return { m, len };
    });
  }
  function prepare(def) {
    const seed = hashStr(def.name);
    const A = makeMelody(def, seed), B = makeMelody(def, seed ^ 0x9e3779b9);
    const per = def.beats * def.steps, bars = def.chords.length * def.bpc;
    const loopSec = (bars * def.beats * 60) / def.bpm;
    return { ...def, A, B, per, bars, loopSec, loops: Math.max(3, Math.round(105 / loopSec)) };
  }

  function scheduleStep(t0) {
    const d = track;
    const stepDur = 60 / d.bpm / d.steps;
    const s = step % d.per;
    const barIdx = Math.floor(step / d.per);
    const bar = barIdx % d.bars;
    const loop = Math.floor(barIdx / d.bars);
    if (loop >= d.loops) return 'next';
    const t = t0 + (d.swing && s % 2 === 1 ? d.swing * stepDur : 0);
    const [deg, q] = d.chords[Math.floor(bar / d.bpc) % d.chords.length];
    const root = d.root + deg;
    const tones = CHORDS[q].map((i) => root + i);
    const first = loop === 0, last = loop === d.loops - 1;
    // Pads and drones on chord changes.
    if (s === 0 && bar % d.bpc === 0) {
      const dur = (d.bpc * d.beats * 60) / d.bpm;
      if (d.pad) pad(t, tones.slice(0, 4).map((m) => (m >= d.root + 12 ? m - 12 : m)), dur, d.pad);
      if (d.drone && bar === 0) drone(t, d.root, (d.bars * d.beats * 60) / d.bpm, d.drone);
    }
    // Bass.
    if (d.bass) {
      const ch = d.bass.pat[s % d.bass.pat.length];
      const map = { R: 0, O: 12, 5: 7, 3: tones[1] - root, 6: 9 };
      if (ch in map) INST[d.bass.inst](t, root - 12 + map[ch], stepDur * 2, 1);
    }
    // Arpeggio through the chord, up and down.
    if (d.arp && s % d.arp.every === 0) {
      const seq = [...tones, ...tones.slice(1, -1).reverse()];
      INST[d.arp.inst](t, seq[(step / d.arp.every) % seq.length | 0] + 12, stepDur * d.arp.every, 0.8);
    }
    // Melody (enters after the intro pass; alternates two phrases A A B A).
    if (d.lead && !first) {
      const phrase = [d.A, d.A, d.B, d.A][loop % 4];
      const n = phrase[bar * d.per + s];
      if (n) INST[d.lead.inst](t, n.m, n.len * stepDur, s % d.steps === 0 ? 1 : 0.8);
    }
    // Drums (not in the intro or the outro pass).
    if (d.drums && !first && !last) {
      for (const k in d.drums) {
        const pat = d.drums[k];
        if (pat[s % pat.length] === 'x') DRUMS[k](t, s % d.steps === 0 ? 1 : 0.7);
      }
    }
    return null;
  }

  function scheduleUntil(horizon) {
    while (track && nextT < horizon) {
      if (scheduleStep(nextT) === 'next') {
        nextTrack(true);
        return;
      }
      nextT += 60 / track.bpm / track.steps;
      step++;
    }
  }
  function tick() {
    if (!ctx || !track || !enabled) return;
    if (nextT < ctx.currentTime) nextT = ctx.currentTime + 0.05; // resumed after a pause
    scheduleUntil(ctx.currentTime + 0.15);
  }

  function setup(audioCtx) {
    ctx = audioCtx;
    out = ctx.createGain();
    out.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    out.connect(comp).connect(ctx.destination);
    // Echo send.
    echo = ctx.createGain();
    const dl = ctx.createDelay(1.5), fb = ctx.createGain(), lp = ctx.createBiquadFilter();
    dl.delayTime.value = 0.33;
    fb.gain.value = 0.32;
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    echo.connect(dl).connect(lp).connect(fb).connect(dl);
    lp.connect(out);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  }

  function startTrack(idx, fadeIn = 1.5) {
    const list = TRACKS[world] || TRACKS.parkland;
    trackIdx = ((idx % list.length) + list.length) % list.length;
    track = prepare(list[trackIdx]);
    step = 0;
    nextT = ctx.currentTime + 0.1;
    const g = out.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setValueAtTime(g.value, ctx.currentTime);
    g.linearRampToValueAtTime(enabled ? level() : 0, ctx.currentTime + fadeIn);
    if (onTrack) onTrack(track.name);
  }
  function nextTrack(auto) {
    if (!ctx || !world) return;
    // Fade the old track out before the next one starts.
    const g = out.gain, now = ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + (auto ? 1.2 : 0.4));
    track = null;
    setTimeout(() => startTrack(trackIdx + 1), auto ? 1400 : 450);
  }

  function play(worldId) {
    wanted = worldId;
    if (!ctx) return; // starts once audio is unlocked by a tap
    if (world === worldId && track) return;
    world = worldId;
    if (!timer) timer = setInterval(tick, 25);
    startTrack(Math.floor(Math.random() * 3));
  }

  Golf.music = {
    TRACKS,
    attach(audioCtx) {
      if (ctx) return;
      setup(audioCtx);
      if (wanted) play(wanted);
    },
    play,
    next() { if (track || world) nextTrack(false); },
    get enabled() { return enabled; },
    get current() { return track ? track.name : null; },
    set onTrack(fn) { onTrack = fn; },
    toggle() {
      enabled = !enabled;
      try { localStorage.setItem('golfy.music', enabled ? '1' : '0'); } catch (e) { /* ignore */ }
      if (ctx && out) {
        const now = ctx.currentTime;
        out.gain.cancelScheduledValues(now);
        out.gain.setValueAtTime(out.gain.value, now);
        out.gain.linearRampToValueAtTime(enabled && track ? level() : 0, now + 0.4);
      }
      return enabled;
    },
    // Offline rendering for tests: render `seconds` of a track into an OfflineAudioContext.
    async renderOffline(OfflineCtx, worldId, idx, seconds) {
      const saved = { ctx, out, echo, noiseBuf, world, track, step, nextT, trackIdx };
      const oc = new OfflineCtx(1, 22050 * seconds, 22050);
      setup(oc);
      world = worldId;
      trackIdx = idx;
      track = prepare((TRACKS[worldId] || TRACKS.parkland)[idx]);
      track.loops = 99;
      step = track.per * track.bars; // skip the intro pass so every part plays
      nextT = 0;
      out.gain.value = level();
      scheduleUntil(seconds);
      const buf = await oc.startRendering();
      ({ ctx, out, echo, noiseBuf, world, track, step, nextT, trackIdx } = saved);
      return buf;
    },
  };
})();
