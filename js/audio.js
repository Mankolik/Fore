// Tiny synthesized sound effects (no audio files needed).
(function () {
  const Golf = globalThis.Golf;
  let ctx = null;
  let muted = false;
  try { muted = localStorage.getItem('golfy.muted') === '1'; } catch (e) { /* storage unavailable */ }

  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function noiseBuffer(dur) {
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function noise(dur, freq, q, gain, type = 'bandpass') {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(dur);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(ctx.destination);
    src.start();
  }

  function tone(freq, dur, gain, type = 'sine', delay = 0, slide = 0) {
    const o = ctx.createOscillator();
    o.type = type;
    const t = ctx.currentTime + delay;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  const sfx = {
    hit(power) { tone(1800, 0.06, 0.25 * power + 0.05, 'triangle'); noise(0.08, 3000, 0.8, 0.35 * power + 0.05); },
    putt() { tone(1300, 0.05, 0.15, 'triangle'); },
    sand() { noise(0.25, 1800, 0.5, 0.4); },
    bounce(s) { noise(0.05, 500, 1, Math.min(0.2, s * 0.02)); },
    tree() { noise(0.35, 2500, 0.4, 0.25); },
    trunk() { tone(220, 0.08, 0.2, 'square', 0, 0.6); },
    splash() { noise(0.5, 900, 0.4, 0.45, 'lowpass'); },
    cup() { tone(900, 0.06, 0.2, 'triangle'); tone(700, 0.06, 0.15, 'triangle', 0.08); tone(520, 0.1, 0.12, 'triangle', 0.16); },
    lip() { tone(650, 0.08, 0.15, 'triangle', 0, 1.4); },
    good() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, 0.12, 'sine', i * 0.09)); },
    tick() { tone(1500, 0.02, 0.05, 'square'); },
  };

  function play(name, ...args) {
    if (muted || !ctx || ctx.state !== 'running') return;
    try { sfx[name](...args); } catch (e) { /* ignore audio errors */ }
  }

  Golf.audio = {
    unlock,
    play,
    get muted() { return muted; },
    toggle() {
      muted = !muted;
      try { localStorage.setItem('golfy.muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
      return muted;
    },
  };
})();
