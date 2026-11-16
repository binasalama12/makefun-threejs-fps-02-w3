// Frostline Depot — all sound is synthesised live with WebAudio.
// No audio files ship with the game: shots are filtered noise bursts,
// confirmations are short oscillator chirps, the detonation is a low boom.

export function createAudio() {
  let ctx = null;
  let noiseBuffer = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    const len = Math.floor(ctx.sampleRate * 0.5);
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData();
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function noiseBurst({ duration = 0.09, freq = 1800, gain = 0.22, type = 'bandpass' } = {}) {
    const ac = ensure();
    if (!ac) return;
    const t = ac.currentTime;
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const filter = ac.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const g = ac.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(g).connect(ac.destination);
    src.start(t);
    src.stop(t + duration + 0.02);
  }

  function tone({ freq = 660, end = null, duration = 0.08, gain = 0.08, type = 'square' } = {}) {
    const ac = ensure();
    if (!ac) return;
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (end) osc.frequency.exponentialRampToValueAtTime(end, t + duration);
    const g = ac.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g).connect(ac.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  return {
    unlock() { ensure(); },
    shot(volume = 1) {
      noiseBurst({ duration: 0.1, freq: 1500, gain: 0.2 * volume });
      tone({ freq: 160, end: 55, duration: 0.09, gain: 0.1 * volume, type: 'triangle' });
    },
    enemyShot(distance) {
      const v = Math.max(0.04, 0.5 - distance * 0.012);
      noiseBurst({ duration: 0.08, freq: 1100, gain: v * 0.35 });
    },
    dryFire() { tone({ freq: 1200, duration: 0.03, gain: 0.05 }); },
    reloadStart() { tone({ freq: 340, duration: 0.05, gain: 0.06 }); noiseBurst({ duration: 0.05, freq: 900, gain: 0.06 }); },
    reloadEnd() { tone({ freq: 520, duration: 0.05, gain: 0.07 }); },
    hit(killed, headshot = false) {
      // A headshot gets its own bright two-note ding so a clean dome
      // shot is audible without ever looking at the hitmarker.
      if (headshot) {
        tone({ freq: 1568, duration: 0.07, gain: 0.11, type: 'sine' });
        setTimeout(() => tone({ freq: killed ? 2637 : 2093, duration: 0.09, gain: 0.1, type: 'sine' }), 45);
        return;
      }
      tone({ freq: killed ? 980 : 740, duration: 0.06, gain: 0.09, type: 'sine' });
    },
    smoke() { noiseBurst({ duration: 0.6, freq: 640, gain: 0.07, type: 'lowpass' }); },
    hurt() { tone({ freq: 130, end: 70, duration: 0.16, gain: 0.14, type: 'sawtooth' }); },
    buy() { tone({ freq: 880, duration: 0.06, gain: 0.07, type: 'sine' }); setTimeout(() => tone({ freq: 1320, duration: 0.07, gain: 0.07, type: 'sine' }), 60); },
    denied() { tone({ freq: 220, end: 160, duration: 0.12, gain: 0.08 }); },
    plantBeep(final = false) { tone({ freq: final ? 1560 : 1040, duration: final ? 0.22 : 0.07, gain: 0.09, type: 'sine' }); },
    grenade() {
      noiseBurst({ duration: 0.35, freq: 3200, gain: 0.16, type: 'highpass' });
      tone({ freq: 1800, end: 300, duration: 0.3, gain: 0.06, type: 'sine' });
    },
    detonate() {
      noiseBurst({ duration: 0.9, freq: 220, gain: 0.5, type: 'lowpass' });
      tone({ freq: 90, end: 32, duration: 0.9, gain: 0.4, type: 'sine' });
    },
    roundWin() { tone({ freq: 660, duration: 0.1, gain: 0.08, type: 'sine' }); setTimeout(() => tone({ freq: 990, duration: 0.16, gain: 0.08, type: 'sine' }), 110); },
    roundLose() { tone({ freq: 330, end: 196, duration: 0.3, gain: 0.09, type: 'sine' }); },
  };
}
