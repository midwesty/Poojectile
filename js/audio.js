// ============================================================
// POOJECTILE — audio.js
//
// Web Audio API synthesis layer. Provides:
//   - SFX library (fire, hit, explosions, damage, UI cues, etc.)
//   - Music sequencer (16-step chiptune patterns per voice)
//   - Volume control (master + sfx + music, persisted to settings)
//   - Defensive: every call no-ops cleanly if audio fails to start
//
// Public API on gs.audio:
//   gs.audio.play(sfxId)               fire and forget SFX
//   gs.audio.music.play(trackId)       start a music track (loops)
//   gs.audio.music.stop()              stop music
//   gs.audio.setMasterVolume(0..1)
//   gs.audio.setMuted(bool)
//
// AudioContext is created lazily on first user gesture (which is
// always the lobby's "Start Game" click that triggers openPoojectile).
// Safari sometimes still needs an explicit resume() — we attempt
// that on every user input until it succeeds.
// ============================================================

import { PHASES } from './engine.js';

// ============================================================
// SFX LIBRARY
// Each entry is a function (ctx, master) that schedules notes.
// All sounds use exponentialRampToValueAtTime for natural decay.
// ============================================================

const SFX = {

  // ---------- Player firing ----------
  fire(ctx, dest) {
    const t = ctx.currentTime;
    // Square wave blip sweeping down
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(420, t + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + 0.07);

    // Tiny noise burst on top for the "ssht"
    const noise = makeNoiseSource(ctx, 0.05);
    const nf = ctx.createBiquadFilter();
    nf.type = 'highpass';
    nf.frequency.value = 2000;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.04, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    noise.connect(nf).connect(ng).connect(dest);
    noise.start(t);
    noise.stop(t + 0.05);
  },

  // ---------- Projectile hits enemy ----------
  hit(ctx, dest) {
    const t = ctx.currentTime;
    const noise = makeNoiseSource(ctx, 0.08);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    f.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    noise.connect(f).connect(g).connect(dest);
    noise.start(t);
    noise.stop(t + 0.08);
  },

  // ---------- Small enemy explosion ----------
  explosionSmall(ctx, dest) {
    const t = ctx.currentTime;
    const dur = 0.25;
    const noise = makeNoiseSource(ctx, dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1800, t);
    f.frequency.exponentialRampToValueAtTime(200, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.32, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    noise.connect(f).connect(g).connect(dest);
    noise.start(t);
    noise.stop(t + dur);
  },

  // ---------- Medium enemy explosion (longer, deeper) ----------
  explosionMedium(ctx, dest) {
    const t = ctx.currentTime;
    const dur = 0.45;
    // Noise body
    const noise = makeNoiseSource(ctx, dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1200, t);
    f.frequency.exponentialRampToValueAtTime(120, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    noise.connect(f).connect(g).connect(dest);
    noise.start(t);
    noise.stop(t + dur);

    // Low rumble sine
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(80, t);
    sub.frequency.exponentialRampToValueAtTime(35, t + dur);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.3, t);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    sub.connect(sg).connect(dest);
    sub.start(t);
    sub.stop(t + dur);
  },

  // ---------- Large explosion (boss / heavy enemies later) ----------
  explosionLarge(ctx, dest) {
    const t = ctx.currentTime;
    const dur = 0.8;
    const noise = makeNoiseSource(ctx, dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1500, t);
    f.frequency.exponentialRampToValueAtTime(80, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    noise.connect(f).connect(g).connect(dest);
    noise.start(t);
    noise.stop(t + dur);

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(60, t);
    sub.frequency.exponentialRampToValueAtTime(25, t + dur);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.45, t);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    sub.connect(sg).connect(dest);
    sub.start(t);
    sub.stop(t + dur);
  },

  // ---------- Player takes damage ----------
  damage(ctx, dest) {
    const t = ctx.currentTime;
    // Descending sawtooth + noise
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.setValueAtTime(400, t);
    saw.frequency.exponentialRampToValueAtTime(80, t + 0.3);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.3, t);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    saw.connect(sg).connect(dest);
    saw.start(t);
    saw.stop(t + 0.32);

    const noise = makeNoiseSource(ctx, 0.2);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.2, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    noise.connect(ng).connect(dest);
    noise.start(t);
    noise.stop(t + 0.2);
  },

  // ---------- Game over (descending doom) ----------
  gameOver(ctx, dest) {
    const t = ctx.currentTime;
    const notes = [220, 196, 174, 146];  // A3 → G3 → F3 → D3
    const stepDur = 0.32;
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      const start = t + i * stepDur;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.18, start + 0.02);
      g.gain.setValueAtTime(0.18, start + stepDur * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, start + stepDur);
      osc.connect(g).connect(dest);
      osc.start(start);
      osc.stop(start + stepDur + 0.05);
    });
  },

  // ---------- Power-up pickup (bright ascending chime) ----------
  pickup(ctx, dest) {
    const t = ctx.currentTime;
    // Ascending triad with sparkle
    const notes = [659, 988, 1319];  // E5, B5, E6
    notes.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const start = t + i * 0.04;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.18, start);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      osc.connect(g).connect(dest);
      osc.start(start);
      osc.stop(start + 0.2);
    });
  },

  // ---------- Shield absorbs a hit (crystalline shatter) ----------
  shieldBreak(ctx, dest) {
    const t = ctx.currentTime;
    // High noise burst
    const noise = makeNoiseSource(ctx, 0.22);
    const nf = ctx.createBiquadFilter();
    nf.type = 'highpass';
    nf.frequency.value = 3000;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.3, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    noise.connect(nf).connect(ng).connect(dest);
    noise.start(t);
    noise.stop(t + 0.22);

    // Descending sine "ringoff"
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, t);
    osc.frequency.exponentialRampToValueAtTime(380, t + 0.28);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + 0.3);
  },

  // ---------- Menu navigate (cursor moves) ----------
  menuNav(ctx, dest) {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(440, t);
    osc.frequency.exponentialRampToValueAtTime(660, t + 0.04);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + 0.06);
  },

  // ---------- Menu select (commit) ----------
  menuSelect(ctx, dest) {
    const t = ctx.currentTime;
    const freqs = [523, 784];  // C5 → G5
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = freq;
      const start = t + i * 0.06;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.12, start);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.1);
      osc.connect(g).connect(dest);
      osc.start(start);
      osc.stop(start + 0.12);
    });
  },

  // ---------- Pause / Unpause ----------
  pauseToggle(ctx, dest) {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(330, t);
    osc.frequency.linearRampToValueAtTime(220, t + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + 0.13);
  },

  // ---------- Level start ascending blip (used on PREGAME → PLAYING) ----------
  levelStart(ctx, dest) {
    const t = ctx.currentTime;
    const notes = [392, 523, 659, 784];  // G4 C5 E5 G5
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = freq;
      const start = t + i * 0.07;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.13, start);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
      osc.connect(g).connect(dest);
      osc.start(start);
      osc.stop(start + 0.14);
    });
  },
};

// ============================================================
// MUSIC TRACKS
// Each track is a set of voices. A voice has an oscillator type
// (or 'noise'), volume, and one or more 16-step patterns. The
// sequencer cycles through patterns.
//
// Note format: midi-style name like 'A2', 'E3'. 0 = rest.
// 'noise' voices use 1 = hit, 0 = rest.
// ============================================================

const TRACKS = {

  // ---------- Level 1: The Debris Field ----------
  // Cold, slightly menacing, minor key (A minor). Slow bass walk,
  // sparse lead, light hi-hat. Two patterns alternate.
  level1: {
    bpm: 108,
    stepsPerBeat: 4,    // 16 steps = 1 bar
    voices: {

      bass: {
        osc: 'triangle',
        volume: 0.32,
        noteDuration: 0.22,
        filter: { type: 'lowpass', freq: 700 },
        patterns: [
          ['A2', 0, 0, 0, 'A2', 0, 'E2', 0, 'A2', 0, 0, 0, 'C3', 0, 'E3', 0],
          ['A2', 0, 0, 0, 'A2', 0, 'E2', 0, 'F2', 0, 0, 0, 'G2', 0, 'A2', 0],
        ],
      },

      lead: {
        osc: 'square',
        volume: 0.10,
        noteDuration: 0.18,
        filter: { type: 'lowpass', freq: 2200 },
        patterns: [
          [0, 0, 'E4', 0, 0, 0, 'C4', 0, 0, 0, 'A3', 0, 0, 'E4', 0, 0],
          [0, 0, 'E4', 0, 0, 0, 'G4', 0, 0, 0, 'F4', 0, 0, 'E4', 'D4', 0],
        ],
      },

      hat: {
        osc: 'noise',
        volume: 0.06,
        noteDuration: 0.04,
        filter: { type: 'highpass', freq: 6000 },
        patterns: [
          [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1],
          [0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1],
        ],
      },

      kick: {
        osc: 'kick',     // special — synthesized kick drum
        volume: 0.35,
        noteDuration: 0.12,
        patterns: [
          [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
          [1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0],
        ],
      },

    },
  },

};

// ============================================================
// SYSTEM
// ============================================================

const SCHEDULE_AHEAD = 0.15;     // seconds to schedule notes in advance
const MUSIC_FADE_TIME = 0.4;     // seconds to fade music on stop

export const audioSystem = {
  id: 'audio',
  priority: 5,
  phases: null,

  init(gs) {
    const state = {
      ctx: null,
      master: null,
      sfxBus: null,
      musicBus: null,
      enabled: true,
      muted: gs.config.audio.muted || false,
      masterVolume: gs.config.audio.masterVolume ?? 0.7,
      sfxVolume: gs.config.audio.sfxVolume ?? 0.8,
      musicVolume: gs.config.audio.musicVolume ?? 0.5,
      music: null,    // active music engine state
    };

    // Try to create the AudioContext immediately. Browsers in
    // certain states may suspend it — we resume on first input.
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) {
        console.warn('[Audio] AudioContext unavailable; running silent.');
        state.enabled = false;
      } else {
        state.ctx = new AC();
        // Master compressor for headroom
        const compressor = state.ctx.createDynamicsCompressor();
        compressor.threshold.value = -10;
        compressor.knee.value = 8;
        compressor.ratio.value = 4;
        compressor.attack.value = 0.005;
        compressor.release.value = 0.08;

        state.master = state.ctx.createGain();
        state.sfxBus = state.ctx.createGain();
        state.musicBus = state.ctx.createGain();
        state.sfxBus.connect(state.master);
        state.musicBus.connect(state.master);
        state.master.connect(compressor).connect(state.ctx.destination);
        applyVolumes(state);
      }
    } catch (err) {
      console.warn('[Audio] init failed:', err);
      state.enabled = false;
    }

    // ----- Public API -----
    gs.audio = {
      play(sfxId) {
        if (!state.enabled || state.muted) return;
        if (state.ctx.state === 'suspended') tryResume(state);
        const fn = SFX[sfxId];
        if (!fn) {
          console.warn(`[Audio] Unknown SFX "${sfxId}"`);
          return;
        }
        try {
          fn(state.ctx, state.sfxBus);
        } catch (err) {
          console.warn(`[Audio] SFX ${sfxId} failed:`, err);
        }
      },

      music: {
        play(trackId) {
          if (!state.enabled) return;
          if (state.ctx.state === 'suspended') tryResume(state);
          const track = TRACKS[trackId];
          if (!track) {
            console.warn(`[Audio] Unknown track "${trackId}"`);
            return;
          }
          startMusic(state, trackId, track);
        },
        stop() {
          if (!state.enabled || !state.music) return;
          stopMusic(state);
        },
        get playing() {
          return !!state.music;
        },
      },

      setMasterVolume(v) {
        state.masterVolume = Math.max(0, Math.min(1, v));
        applyVolumes(state);
      },
      setSfxVolume(v) {
        state.sfxVolume = Math.max(0, Math.min(1, v));
        applyVolumes(state);
      },
      setMusicVolume(v) {
        state.musicVolume = Math.max(0, Math.min(1, v));
        applyVolumes(state);
      },
      setMuted(m) {
        state.muted = !!m;
        applyVolumes(state);
      },
      get muted() { return state.muted; },
      get state() { return state; },   // for debug
    };
  },

  update(gs, dt) {
    const audio = gs.audio?.state;
    if (!audio || !audio.enabled) return;

    // Defensive resume — some browsers re-suspend after tab switch
    if (audio.ctx.state === 'suspended' &&
        (gs.input.justPressed('Space') || gs.input.pointer.justDown)) {
      tryResume(audio);
    }

    // Advance music sequencer
    if (audio.music) advanceMusic(audio);
  },

  destroy(gs) {
    const audio = gs.audio?.state;
    if (!audio) return;
    try {
      if (audio.music) stopMusic(audio);
      if (audio.ctx && audio.ctx.state !== 'closed') {
        audio.ctx.close();
      }
    } catch (err) {
      console.warn('[Audio] destroy threw:', err);
    }
  },
};

// ============================================================
// Music engine internals
// ============================================================

function startMusic(state, trackId, track) {
  // If switching tracks, stop the current one first
  if (state.music) stopMusic(state);

  const stepDuration = 60 / track.bpm / (track.stepsPerBeat || 4);
  state.music = {
    trackId,
    track,
    stepDuration,
    startTime: state.ctx.currentTime + 0.1,
    nextScheduleStep: 0,
    voiceGain: state.ctx.createGain(),
  };
  // Patch through music bus so global music volume applies
  state.music.voiceGain.gain.value = 1;
  state.music.voiceGain.connect(state.musicBus);
  // Fade in
  state.music.voiceGain.gain.setValueAtTime(0, state.ctx.currentTime);
  state.music.voiceGain.gain.linearRampToValueAtTime(1, state.ctx.currentTime + 0.3);
}

function stopMusic(state) {
  if (!state.music) return;
  const ctx = state.ctx;
  const t = ctx.currentTime;
  const g = state.music.voiceGain.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.exponentialRampToValueAtTime(0.0001, t + MUSIC_FADE_TIME);
  // Schedule disconnect after fade
  const oldVoiceGain = state.music.voiceGain;
  setTimeout(() => {
    try { oldVoiceGain.disconnect(); } catch {}
  }, MUSIC_FADE_TIME * 1000 + 50);
  state.music = null;
}

function advanceMusic(state) {
  const m = state.music;
  if (!m) return;
  const ctx = state.ctx;
  const horizon = ctx.currentTime + SCHEDULE_AHEAD;

  while (true) {
    const stepTime = m.startTime + m.nextScheduleStep * m.stepDuration;
    if (stepTime > horizon) break;
    scheduleStep(state, m, m.nextScheduleStep, stepTime);
    m.nextScheduleStep++;
  }
}

function scheduleStep(state, m, stepIdx, time) {
  const track = m.track;
  for (const voiceName in track.voices) {
    const voice = track.voices[voiceName];
    const patterns = voice.patterns;
    const patternIdx = Math.floor(stepIdx / 16) % patterns.length;
    const stepInPattern = stepIdx % 16;
    const note = patterns[patternIdx][stepInPattern];
    if (note && note !== 0) {
      playVoiceNote(state, voice, note, time, m.voiceGain);
    }
  }
}

function playVoiceNote(state, voice, note, time, dest) {
  const ctx = state.ctx;
  const duration = voice.noteDuration ?? 0.15;

  if (voice.osc === 'noise') {
    // Percussive noise burst
    const src = makeNoiseSource(ctx, duration);
    const filter = voice.filter ? makeFilter(ctx, voice.filter) : null;
    const g = ctx.createGain();
    g.gain.setValueAtTime(voice.volume, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    const chain = filter ? src.connect(filter).connect(g) : src.connect(g);
    g.connect(dest);
    src.start(time);
    src.stop(time + duration);
    return;
  }

  if (voice.osc === 'kick') {
    // Synthesized kick: sine pitch envelope from 120 → 40 Hz
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, time);
    osc.frequency.exponentialRampToValueAtTime(40, time + duration * 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(voice.volume, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    osc.connect(g).connect(dest);
    osc.start(time);
    osc.stop(time + duration + 0.02);
    return;
  }

  // Pitched oscillator note
  const freq = noteToFreq(note);
  if (!freq) return;
  const osc = ctx.createOscillator();
  osc.type = voice.osc;
  osc.frequency.value = freq;
  const filter = voice.filter ? makeFilter(ctx, voice.filter) : null;
  const g = ctx.createGain();
  // Pluck-style ADSR: fast attack, short sustain, exponential decay
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(voice.volume, time + 0.01);
  g.gain.setValueAtTime(voice.volume, time + duration * 0.4);
  g.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  if (filter) osc.connect(filter).connect(g).connect(dest);
  else osc.connect(g).connect(dest);
  osc.start(time);
  osc.stop(time + duration + 0.02);
}

// ============================================================
// Helpers
// ============================================================

function tryResume(state) {
  try { state.ctx.resume(); } catch {}
}

function applyVolumes(state) {
  if (!state.master) return;
  const m = state.muted ? 0 : state.masterVolume;
  state.master.gain.value = m;
  state.sfxBus.gain.value = state.sfxVolume;
  state.musicBus.gain.value = state.musicVolume;
}

function makeFilter(ctx, def) {
  const f = ctx.createBiquadFilter();
  f.type = def.type || 'lowpass';
  f.frequency.value = def.freq || 1000;
  if (def.Q !== undefined) f.Q.value = def.Q;
  return f;
}

// Pre-bake a single second of white noise; new buffer sources can
// reuse it cheaply. (Each call creates a new source node but the
// underlying AudioBuffer is shared.)
let _noiseBuffer = null;
function makeNoiseSource(ctx, durSeconds) {
  if (!_noiseBuffer || _noiseBuffer.sampleRate !== ctx.sampleRate) {
    const sampleRate = ctx.sampleRate;
    _noiseBuffer = ctx.createBuffer(1, sampleRate, sampleRate);
    const data = _noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  }
  const src = ctx.createBufferSource();
  src.buffer = _noiseBuffer;
  src.loop = true;
  return src;
}

// MIDI: A4 (note 69) = 440 Hz. Each semitone = factor 2^(1/12).
const NOTE_OFFSETS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function noteToFreq(name) {
  if (typeof name !== 'string') return null;
  const m = /^([A-G])([#b]?)(\d)$/.exec(name);
  if (!m) return null;
  let semitone = NOTE_OFFSETS[m[1]];
  if (m[2] === '#') semitone += 1;
  else if (m[2] === 'b') semitone -= 1;
  const octave = parseInt(m[3], 10);
  const midi = 12 + octave * 12 + semitone;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Re-export PHASES for any consumers
export { PHASES };
