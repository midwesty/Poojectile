// ============================================================
// POOJECTILE — engine.js
//
// Core engine: phase machine, system registry, game loop.
//
// Architectural pattern:
//   Every game module (player.js, enemies.js, audio.js, etc.)
//   registers itself as a System. Each System declares which
//   phases it runs in, its priority, and lifecycle hooks.
//
//   The engine iterates all registered systems each frame,
//   filtering by current phase, and calls update() then render()
//   in priority order. This keeps modules cleanly decoupled.
//
// A System looks like:
//   {
//     id: 'unique-string',
//     phases: ['playing', 'boss_fight'],   // omit for all phases
//     priority: 100,                       // lower runs first
//     init: (gs) => {...},                 // once at engine start
//     destroy: (gs) => {...},              // once at engine stop
//     onEnterPhase: (gs, fromPhase, toPhase) => {...},
//     onExitPhase:  (gs, fromPhase, toPhase) => {...},
//     update: (gs, dt) => {...},
//     render: (gs, dt) => {...},
//   }
// ============================================================

// ----- Phase constants -----
// Match config.json phases.valid. Import these instead of typing
// strings so typos become reference errors.
export const PHASES = Object.freeze({
  BOOT:               'boot',
  INTRO:              'intro',
  MENU:               'menu',
  PREGAME:            'pregame',
  PLAYING:            'playing',
  PAUSED:             'paused',
  LEVEL_COMPLETE:     'level_complete',
  HIGH_SCORE_ENTRY:   'high_score_entry',
  BOSS_WARNING:       'boss_warning',
  BOSS_FIGHT:         'boss_fight',
  GAME_OVER:          'game_over',
  CUTSCENE:           'cutscene',
  CREDITS:            'credits',
});

// ============================================================
// ENGINE LIFECYCLE
// ============================================================

export function createEngine(gameState) {
  const engine = {
    gameState,
    systems: [],
    rafHandle: 0,
    running: false,
    lastFrameTime: 0,
    phaseStartTime: 0,
  };
  // Make engine reachable from gameState so systems can call back in
  gameState.engine = engine;
  return engine;
}

export function registerSystem(engine, system) {
  if (!system.id) throw new Error('[Engine] System requires an id');
  if (engine.systems.some(s => s.id === system.id)) {
    throw new Error(`[Engine] Duplicate system id: ${system.id}`);
  }
  const sys = {
    priority: 100,
    phases: null,           // null = all phases
    ...system,
  };
  engine.systems.push(sys);
  engine.systems.sort((a, b) => a.priority - b.priority);
  return sys;
}

export function unregisterSystem(engine, id) {
  engine.systems = engine.systems.filter(s => s.id !== id);
}

export function transitionTo(engine, newPhase) {
  const gs = engine.gameState;
  const oldPhase = gs.phase;
  if (oldPhase === newPhase) return;

  if (!gs.config.phases.valid.includes(newPhase)) {
    console.error(`[Engine] Invalid phase: "${newPhase}". Valid:`, gs.config.phases.valid);
    return;
  }

  // Exit hooks for systems leaving
  for (const sys of engine.systems) {
    const wasIn = systemActiveIn(sys, oldPhase);
    const willBeIn = systemActiveIn(sys, newPhase);
    if (wasIn && !willBeIn && sys.onExitPhase) {
      safeCall(sys, 'onExitPhase', gs, oldPhase, newPhase);
    }
  }

  gs.phase = newPhase;
  engine.phaseStartTime = performance.now();
  gs.phaseElapsed = 0;

  // Enter hooks for systems entering
  for (const sys of engine.systems) {
    const wasIn = systemActiveIn(sys, oldPhase);
    const willBeIn = systemActiveIn(sys, newPhase);
    if (willBeIn && !wasIn && sys.onEnterPhase) {
      safeCall(sys, 'onEnterPhase', gs, oldPhase, newPhase);
    }
  }

  if (gs.config.debug.logEvents) {
    console.log(`[Engine] phase: ${oldPhase} \u2192 ${newPhase}`);
  }
}

function systemActiveIn(sys, phase) {
  return sys.phases === null || sys.phases.includes(phase);
}

function safeCall(sys, hook, ...args) {
  try {
    sys[hook](...args);
  } catch (err) {
    console.error(`[Engine] System "${sys.id}" ${hook}() threw:`, err);
  }
}

// ============================================================
// GAME LOOP
// ============================================================

export function startEngine(engine) {
  const gs = engine.gameState;

  // ----- Screen FX state + helpers -----
  gs.screenShake = { intensity: 0, duration: 0, initialDuration: 0 };
  gs.screenFlash = { color: '#ffffff', alpha: 0, duration: 0, initialDuration: 0 };

  gs.shake = (intensity, duration) => {
    // Take the strongest active shake (energy = intensity * duration)
    if (intensity * duration > gs.screenShake.intensity * gs.screenShake.duration) {
      gs.screenShake.intensity = intensity;
      gs.screenShake.duration = duration;
      gs.screenShake.initialDuration = duration;
    }
  };

  gs.flash = (color, alpha, duration) => {
    gs.screenFlash.color = color || '#ffffff';
    gs.screenFlash.alpha = alpha;
    gs.screenFlash.duration = duration;
    gs.screenFlash.initialDuration = duration;
  };

  // Init all systems
  for (const sys of engine.systems) {
    if (sys.init) safeCall(sys, 'init', gs);
  }

  // Run onEnterPhase for systems active in starting phase
  for (const sys of engine.systems) {
    if (systemActiveIn(sys, gs.phase) && sys.onEnterPhase) {
      safeCall(sys, 'onEnterPhase', gs, null, gs.phase);
    }
  }

  engine.running = true;
  engine.lastFrameTime = performance.now();
  engine.phaseStartTime = engine.lastFrameTime;
  gs.fpsSampleStart = engine.lastFrameTime;

  const loop = (now) => {
    if (!engine.running) return;

    let dt = (now - engine.lastFrameTime) / 1000;
    if (dt > 0.05) dt = 0.05;       // cap to avoid spiral of death
    engine.lastFrameTime = now;

    gs.elapsed += dt;
    gs.phaseElapsed = (now - engine.phaseStartTime) / 1000;
    gs.frameCount++;

    // FPS sampling (rolling 1-second window)
    gs.fpsAccum++;
    if (now - gs.fpsSampleStart >= 1000) {
      gs.fps = gs.fpsAccum;
      gs.fpsAccum = 0;
      gs.fpsSampleStart = now;
    }

    // ----- UPDATE pass -----
    const phase = gs.phase;
    for (const sys of engine.systems) {
      if (sys.update && systemActiveIn(sys, phase)) {
        safeCall(sys, 'update', gs, dt);
      }
    }

    // ----- CLEAR + RENDER pass -----
    gs.ctx.fillStyle = gs.config.palette.voidDeep;
    gs.ctx.fillRect(0, 0, gs.fieldW, gs.fieldH);

    // Tick shake / flash timers
    if (gs.screenShake.duration > 0) {
      gs.screenShake.duration = Math.max(0, gs.screenShake.duration - dt);
    }
    if (gs.screenFlash.duration > 0) {
      gs.screenFlash.duration = Math.max(0, gs.screenFlash.duration - dt);
    }

    // Compute current shake offset
    let shakeX = 0, shakeY = 0;
    if (gs.screenShake.duration > 0) {
      const sf = gs.screenShake.duration / gs.screenShake.initialDuration;
      const intensity = gs.screenShake.intensity * sf;
      shakeX = (Math.random() - 0.5) * 2 * intensity;
      shakeY = (Math.random() - 0.5) * 2 * intensity;
    }

    gs.ctx.save();
    if (shakeX !== 0 || shakeY !== 0) gs.ctx.translate(shakeX, shakeY);

    for (const sys of engine.systems) {
      if (sys.render && systemActiveIn(sys, phase)) {
        safeCall(sys, 'render', gs, dt);
      }
    }

    gs.ctx.restore();

    // Screen flash overlay (drawn AFTER restore so it's not shaken)
    if (gs.screenFlash.duration > 0) {
      const ff = gs.screenFlash.duration / gs.screenFlash.initialDuration;
      gs.ctx.save();
      gs.ctx.globalAlpha = gs.screenFlash.alpha * ff;
      gs.ctx.fillStyle = gs.screenFlash.color;
      gs.ctx.fillRect(0, 0, gs.fieldW, gs.fieldH);
      gs.ctx.restore();
    }

    // ----- DEBUG overlay (always last, always on top) -----
    if (gs.config.debug.showFPS) {
      gs.ctx.fillStyle = gs.config.palette.toxicGreen;
      gs.ctx.font = '16px VT323, monospace';
      gs.ctx.textAlign = 'left';
      gs.ctx.textBaseline = 'top';
      gs.ctx.fillText(`FPS ${gs.fps}`, 8, 8);
      gs.ctx.fillText(`PHASE ${gs.phase}`, 8, 28);
    }

    engine.rafHandle = requestAnimationFrame(loop);
  };

  engine.rafHandle = requestAnimationFrame(loop);
}

export function stopEngine(engine) {
  if (!engine.running) return;
  engine.running = false;
  cancelAnimationFrame(engine.rafHandle);

  const gs = engine.gameState;

  // Final onExitPhase
  for (const sys of engine.systems) {
    if (systemActiveIn(sys, gs.phase) && sys.onExitPhase) {
      safeCall(sys, 'onExitPhase', gs, gs.phase, null);
    }
  }

  // Destroy all systems
  for (const sys of engine.systems) {
    if (sys.destroy) safeCall(sys, 'destroy', gs);
  }

  engine.systems = [];
}

// ============================================================
// BUILT-IN SYSTEMS
// These are foundational to every phase and are registered
// automatically by registerBuiltinSystems(). Game-specific
// systems (player, enemies, etc.) register in main.js.
// ============================================================

export function registerBuiltinSystems(engine) {
  registerSystem(engine, backgroundSystem);
  registerSystem(engine, bootSystem);
  registerSystem(engine, pregameSystem);
  registerSystem(engine, playingSystem);
  registerSystem(engine, bossWarningSystem);
  registerSystem(engine, levelCompleteSystem);
  registerSystem(engine, gameOverSystem);
}

// ----- Background System -----
// Procedural parallax starfield + biological haze. Runs in
// phases that need a star background (boot, menu, pregame).
// Level rendering (when it exists) will run AFTER this with its
// own background overlay, so this gets covered up in 'playing'.
// ----- Parallax layer specs (counts, sizes, scroll multipliers).
// Per-level COLORS come from gs.level.def.theme — these specs only
// govern density and motion. scrollSpeed (in px/s for layer 3) also
// comes from the theme; layers 1 and 2 are computed as fractions
// of layer 3 so all layers stay coherent regardless of speed.
// -----
const PARALLAX_LAYERS = {
  stars:   { count: 70, sizeMin: 0.5,  sizeMax: 1.8,  speedMul: 0.25 },
  nebula:  { count: 6,  sizeMin: 110,  sizeMax: 240,  speedMul: 0.55 },
  debris:  { count: 10, sizeMin: 4,    sizeMax: 10,   speedMul: 1.00 },
};

// Default theme used before any level is active (BOOT, MENU, etc.)
const FALLBACK_THEME = {
  starColor:   '#f0e8d8',
  nebulaColor: '#1a1f2c',
  debrisColor: '#2c2c34',
  scrollSpeed: 35,
};

const backgroundSystem = {
  id: 'background',
  priority: 10,            // renders first (behind everything)
  phases: [
    PHASES.BOOT, PHASES.MENU, PHASES.PREGAME,
    PHASES.PLAYING, PHASES.PAUSED, PHASES.BOSS_WARNING,
    PHASES.BOSS_FIGHT, PHASES.LEVEL_COMPLETE, PHASES.HIGH_SCORE_ENTRY,
    PHASES.GAME_OVER, PHASES.CREDITS,
  ],

  init(gs) {
    const w = gs.fieldW, h = gs.fieldH;

    // Stars: uniform tiny points
    const stars = [];
    for (let i = 0; i < PARALLAX_LAYERS.stars.count; i++) {
      stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        size: rand(PARALLAX_LAYERS.stars.sizeMin, PARALLAX_LAYERS.stars.sizeMax),
        alpha: 0.35 + Math.random() * 0.65,
      });
    }
    // Nebula: soft large radial gradients
    const nebula = [];
    for (let i = 0; i < PARALLAX_LAYERS.nebula.count; i++) {
      nebula.push({
        x: Math.random() * w,
        y: Math.random() * h * 1.4 - h * 0.2,
        radius: rand(PARALLAX_LAYERS.nebula.sizeMin, PARALLAX_LAYERS.nebula.sizeMax),
        intensity: 0.10 + Math.random() * 0.08,
      });
    }
    // Debris: small polygon silhouettes
    const debris = [];
    for (let i = 0; i < PARALLAX_LAYERS.debris.count; i++) {
      debris.push({
        x: Math.random() * w,
        y: Math.random() * h,
        size: rand(PARALLAX_LAYERS.debris.sizeMin, PARALLAX_LAYERS.debris.sizeMax),
        rotation: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.6,
        alpha: 0.55 + Math.random() * 0.30,
      });
    }
    gs._bg = { stars, nebula, debris };
  },

  update(gs, dt) {
    const w = gs.fieldW, h = gs.fieldH;
    const theme = getTheme(gs);
    const baseSpeed = theme.scrollSpeed;

    // Pause scroll during boss fight (held-breath feel)
    const scrollMul = (gs.phase === PHASES.BOSS_FIGHT) ? 0 : 1;

    // Stars
    const ssp = baseSpeed * PARALLAX_LAYERS.stars.speedMul * scrollMul;
    for (const s of gs._bg.stars) {
      s.y += ssp * dt;
      if (s.y > h + 4) {
        s.y = -4;
        s.x = Math.random() * w;
      }
    }
    // Nebula
    const nsp = baseSpeed * PARALLAX_LAYERS.nebula.speedMul * scrollMul;
    for (const n of gs._bg.nebula) {
      n.y += nsp * dt;
      if (n.y - n.radius > h) {
        n.y = -n.radius;
        n.x = Math.random() * w;
      }
    }
    // Debris
    const dsp = baseSpeed * PARALLAX_LAYERS.debris.speedMul * scrollMul;
    for (const d of gs._bg.debris) {
      d.y += dsp * dt;
      d.rotation += d.spin * dt;
      if (d.y - d.size > h) {
        d.y = -d.size;
        d.x = Math.random() * w;
      }
    }
  },

  render(gs, dt) {
    const { ctx, fieldW, fieldH } = gs;
    const theme = getTheme(gs);

    // Layer 1 — distant stars (most fragments)
    ctx.save();
    for (const s of gs._bg.stars) {
      ctx.globalAlpha = s.alpha;
      ctx.fillStyle = theme.starColor;
      ctx.fillRect(s.x, s.y, s.size, s.size);
    }
    ctx.restore();

    // Layer 2 — soft nebula clouds (additive feel via low alpha)
    ctx.save();
    for (const n of gs._bg.nebula) {
      const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.radius);
      g.addColorStop(0, hexToRgba(theme.nebulaColor, n.intensity * 2.4));
      g.addColorStop(1, hexToRgba(theme.nebulaColor, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Layer 3 — foreground debris silhouettes
    ctx.save();
    ctx.fillStyle = theme.debrisColor;
    for (const d of gs._bg.debris) {
      ctx.globalAlpha = d.alpha;
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.rotation);
      // Simple irregular hex
      const s = d.size;
      ctx.beginPath();
      ctx.moveTo( s * 0.9,  0);
      ctx.lineTo( s * 0.4,  s * 0.85);
      ctx.lineTo(-s * 0.5,  s * 0.8);
      ctx.lineTo(-s * 0.9,  0);
      ctx.lineTo(-s * 0.3, -s * 0.75);
      ctx.lineTo( s * 0.5, -s * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  },
};

function getTheme(gs) {
  return gs.level?.def?.theme || FALLBACK_THEME;
}

function rand(a, b) { return a + Math.random() * (b - a); }

function hexToRgba(hex, alpha) {
  if (!hex || !hex.startsWith('#') || hex.length !== 7) {
    return `rgba(255, 255, 255, ${alpha})`;
  }
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ----- Boot System -----
// Shows briefly on startup, then auto-transitions to menu.
// Acts as a "splash screen" so the menu doesn't pop up cold.
const BOOT_DURATION = 1.5; // seconds

const bootSystem = {
  id: 'boot',
  priority: 100,
  phases: [PHASES.BOOT],
  update(gs, dt) {
    // Auto-advance to menu after BOOT_DURATION, or skip on any input.
    const userSkipped =
      gs.input &&
      (gs.input.justPressed('Space') ||
       gs.input.justPressed('Enter') ||
       gs.input.pointer.justDown);
    if (gs.phaseElapsed >= BOOT_DURATION || userSkipped) {
      transitionTo(gs.engine, PHASES.MENU);
    }
  },
  render(gs, dt) {
    const { ctx, fieldW, fieldH, elapsed } = gs;
    const palette = gs.config.palette;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Massive title, centered, with toxic glow
    const titlePulse = 0.85 + 0.15 * Math.sin(elapsed * 1.8);
    ctx.shadowColor = palette.toxicGreen;
    ctx.shadowBlur = 30 * titlePulse;
    ctx.fillStyle = palette.toxicGreen;
    ctx.font = 'bold 64px VT323, monospace';
    ctx.fillText(gs.config.title, fieldW / 2, fieldH * 0.42);

    ctx.shadowBlur = 0;
    ctx.fillStyle = palette.bone;
    ctx.fillText(gs.config.title, fieldW / 2, fieldH * 0.42);

    // Tagline
    ctx.fillStyle = palette.boneDim;
    ctx.font = '20px VT323, monospace';
    ctx.fillText(`~  ${gs.config.tagline}  ~`, fieldW / 2, fieldH * 0.50);

    // "Initializing..." with a trailing-dot animation
    const dots = '.'.repeat(1 + Math.floor(elapsed * 2) % 3);
    ctx.fillStyle = palette.toxicGreenDark;
    ctx.font = '18px VT323, monospace';
    ctx.fillText(`INITIALIZING${dots}`, fieldW / 2, fieldH * 0.60);

    // Version + phase status (small, at bottom)
    ctx.fillStyle = palette.boneDim;
    ctx.globalAlpha = 0.5;
    ctx.font = '14px VT323, monospace';
    ctx.fillText(
      `v${gs.config.version} \u2014 ${gs.config._meta.phase_status}`,
      fieldW / 2, fieldH * 0.93
    );

    ctx.restore();
  },
};

// ----- Pregame System -----
// Shows a brief "GET READY" countdown then transitions to PLAYING.
// User can skip with space/tap. ESC returns to menu.
const PREGAME_DURATION = 1.8; // seconds

const pregameSystem = {
  id: 'pregame',
  priority: 100,
  phases: [PHASES.PREGAME],
  update(gs, dt) {
    // ESC returns to menu
    if (gs.input.actionJustPressed('pause')) {
      transitionTo(gs.engine, PHASES.MENU);
      return;
    }

    // Skip on input
    const skipped =
      gs.input.justPressed('Space') ||
      gs.input.justPressed('Enter') ||
      gs.input.pointer.justDown;

    if (gs.phaseElapsed >= PREGAME_DURATION || skipped) {
      transitionTo(gs.engine, PHASES.PLAYING);
    }
  },
  render(gs, dt) {
    const { ctx, fieldW, fieldH } = gs;
    const palette = gs.config.palette;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Level banner (when a level is active)
    if (gs.level) {
      ctx.fillStyle = palette.toxicGreen;
      ctx.shadowColor = palette.toxicGreen;
      ctx.shadowBlur = 12;
      ctx.font = '22px VT323, monospace';
      ctx.fillText(`LEVEL ${gs.level.number}`, fieldW / 2, fieldH * 0.30);

      ctx.shadowBlur = 0;
      ctx.fillStyle = palette.bone;
      ctx.font = 'bold 28px VT323, monospace';
      ctx.fillText((gs.level.displayName || '').toUpperCase(), fieldW / 2, fieldH * 0.34);
    }

    // Big GET READY with toxic glow + pulse
    const pulse = 1 + 0.06 * Math.sin(gs.elapsed * 8);
    ctx.shadowColor = palette.toxicGreen;
    ctx.shadowBlur = 28;
    ctx.fillStyle = palette.toxicGreen;
    ctx.font = `bold ${Math.round(54 * pulse)}px VT323, monospace`;
    ctx.fillText('GET READY', fieldW / 2, fieldH * 0.40);

    ctx.shadowBlur = 0;
    ctx.fillStyle = palette.bone;
    ctx.font = `bold ${Math.round(54 * pulse)}px VT323, monospace`;
    ctx.fillText('GET READY', fieldW / 2, fieldH * 0.40);

    // Sub-message — switches when we're past 1s
    ctx.fillStyle = palette.boneDim;
    ctx.font = '18px VT323, monospace';
    const sub = gs.phaseElapsed < 1.0
      ? 'The void will not be kind.'
      : 'Move with WASD / drag. Fire is automatic.';
    ctx.fillText(sub, fieldW / 2, fieldH * 0.48);

    // Countdown remaining (visual flair)
    const remaining = Math.max(0, PREGAME_DURATION - gs.phaseElapsed);
    ctx.fillStyle = palette.toxicGreenDark;
    ctx.font = '16px VT323, monospace';
    ctx.fillText(`[ launching in ${remaining.toFixed(1)}s ]`, fieldW / 2, fieldH * 0.58);

    // Bottom hint
    const alpha = 0.5 + 0.5 * Math.sin(gs.elapsed * 3);
    ctx.fillStyle = palette.boneDim;
    ctx.globalAlpha = alpha;
    ctx.font = '14px VT323, monospace';
    ctx.fillText('[ SPACE / TAP TO SKIP \u2014 ESC TO MENU ]', fieldW / 2, fieldH * 0.90);

    ctx.restore();
  },
};

// ----- Game Over System -----
// Shows final score and a "press anything to continue" prompt
// after a brief delay so players can't accidentally skip it.
const GAME_OVER_INPUT_DELAY = 1.2;

const gameOverSystem = {
  id: 'gameOver',
  priority: 200,
  phases: [PHASES.GAME_OVER],
  onEnterPhase(gs) {
    gs.audio?.music.stop();
    gs.audio?.play('gameOver');
  },
  update(gs, dt) {
    if (gs.phaseElapsed < GAME_OVER_INPUT_DELAY) return;
    const skip =
      gs.input.actionJustPressed('pause') ||
      gs.input.justPressed('Space') ||
      gs.input.justPressed('Enter') ||
      gs.input.pointer.justDown;
    if (skip) gs.routeAfterRun ? gs.routeAfterRun() : transitionTo(gs.engine, PHASES.MENU);
  },
  render(gs, dt) {
    const { ctx, fieldW, fieldH } = gs;
    const palette = gs.config.palette;
    const p = gs.player;

    // Heavy vignette over the still-visible background
    ctx.save();
    ctx.fillStyle = 'rgba(2, 1, 3, 0.78)';
    ctx.fillRect(0, 0, fieldW, fieldH);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // GAME OVER — pulsing red
    const pulse = 1 + 0.05 * Math.sin(gs.elapsed * 4);
    ctx.shadowColor = palette.bloodRed;
    ctx.shadowBlur = 30 * pulse;
    ctx.fillStyle = palette.bloodRed;
    ctx.font = `bold ${Math.round(72 * pulse)}px VT323, monospace`;
    ctx.fillText('GAME OVER', fieldW / 2, fieldH * 0.36);

    ctx.shadowBlur = 0;
    ctx.fillStyle = palette.bone;
    ctx.font = '20px VT323, monospace';
    ctx.fillText('You were recycled.', fieldW / 2, fieldH * 0.44);

    // Final score
    if (p) {
      ctx.fillStyle = palette.toxicGreen;
      ctx.font = '28px VT323, monospace';
      ctx.fillText(`FINAL SCORE  ${p.score.toString().padStart(6, '0')}`, fieldW / 2, fieldH * 0.55);
    }

    // Press-to-continue hint, gated by input delay
    if (gs.phaseElapsed >= GAME_OVER_INPUT_DELAY) {
      const alpha = 0.5 + 0.5 * Math.sin(gs.elapsed * 3);
      ctx.fillStyle = palette.boneDim;
      ctx.globalAlpha = alpha;
      ctx.font = '18px VT323, monospace';
      ctx.fillText('[ PRESS ANYTHING TO CONTINUE ]', fieldW / 2, fieldH * 0.72);
    }

    ctx.restore();
  },
};

// ----- Playing System -----
// Game director for active gameplay. Handles ESC-to-pause from
// ANY gameplay phase (playing, boss warning, boss fight), tracks
// _pausedFromPhase so resuming returns to the right phase, and
// starts the level music on the first PLAYING entry from PREGAME.
const playingSystem = {
  id: 'playing',
  priority: 199,
  phases: [PHASES.PLAYING, PHASES.PAUSED, PHASES.BOSS_FIGHT, PHASES.BOSS_WARNING],

  onEnterPhase(gs, fromPhase, toPhase) {
    // Start level music only on the canonical "enter playing from pregame"
    // transition. Other entries (e.g. PAUSED <- BOSS_FIGHT) shouldn't restart it.
    if (toPhase === PHASES.PLAYING && fromPhase === PHASES.PREGAME) {
      if (gs.audio) {
        gs.audio.play('levelStart');
        const track = gs.level?.def?.musicTrack || 'level1';
        gs.audio.music.play(track);
      }
    }
  },

  update(gs, dt) {
    if (gs.input.actionJustPressed('pause')) {
      gs.audio?.play('pauseToggle');
      if (gs.phase === PHASES.PAUSED) {
        const back = gs._pausedFromPhase || PHASES.PLAYING;
        gs._pausedFromPhase = null;
        transitionTo(gs.engine, back);
      } else {
        gs._pausedFromPhase = gs.phase;
        transitionTo(gs.engine, PHASES.PAUSED);
      }
    }
  },
};

// ----- Boss Warning System -----
// Brief flashing warning before the boss spawns. Triggers boss music
// (which auto-stops level music via music.play's cross-fade), plays an
// alarm SFX, and after BOSS_WARNING_DURATION transitions to BOSS_FIGHT
// and spawns the queued boss.
//
// Trigger from gameplay: set gs._pendingBossTypeId (and optionally
// gs._pendingBossMusicTrack) then transitionTo(BOSS_WARNING).
const BOSS_WARNING_DURATION = 2.6;

const bossWarningSystem = {
  id: 'bossWarning',
  priority: 195,
  phases: [PHASES.BOSS_WARNING],

  onEnterPhase(gs, fromPhase) {
    if (gs.audio) {
      gs.audio.music.play(gs._pendingBossMusicTrack || 'boss1');
      gs.audio.play('bossWarning');
    }
  },

  update(gs, dt) {
    if (gs.phaseElapsed >= BOSS_WARNING_DURATION) {
      const typeId = gs._pendingBossTypeId || 'asteroid_giant';
      gs._pendingBossTypeId = null;
      gs._pendingBossMusicTrack = null;
      if (gs.bosses) {
        gs.bosses.spawn(typeId, gs.fieldW / 2, -120);
      }
      transitionTo(gs.engine, PHASES.BOSS_FIGHT);
    }
  },

  render(gs, dt) {
    const { ctx, fieldW, fieldH, phaseElapsed } = gs;
    const palette = gs.config.palette;

    // Strobing red tint across entire screen on the alarm beat
    const beat = Math.sin(phaseElapsed * 12);
    if (beat > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(255, 59, 59, ${0.10 + beat * 0.10})`;
      ctx.fillRect(0, 0, fieldW, fieldH);
      ctx.restore();
    }

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const pulse = 1 + 0.08 * Math.sin(phaseElapsed * 10);
    ctx.shadowColor = palette.bloodRed;
    ctx.shadowBlur = 26 * pulse;
    ctx.fillStyle = palette.bloodRed;
    ctx.font = `bold ${Math.round(44 * pulse)}px VT323, monospace`;
    ctx.fillText('WARNING', fieldW / 2, fieldH * 0.43);

    ctx.shadowBlur = 8;
    ctx.fillStyle = palette.bone;
    ctx.font = '22px VT323, monospace';
    ctx.fillText('MASS APPROACHING', fieldW / 2, fieldH * 0.51);
    ctx.restore();
  },
};

// ----- Level Complete System -----
// Shown after the boss death sequence finishes. Plays the level
// complete fanfare, stops music, displays final score, and returns
// to MENU after a delay or any input.
const LEVEL_COMPLETE_DURATION = 4.5;
const LEVEL_COMPLETE_INPUT_DELAY = 1.6;

const levelCompleteSystem = {
  id: 'levelComplete',
  priority: 200,
  phases: [PHASES.LEVEL_COMPLETE],

  onEnterPhase(gs) {
    if (gs.audio) {
      gs.audio.music.stop();
      gs.audio.play('levelComplete');
    }
  },

  update(gs, dt) {
    if (gs.phaseElapsed >= LEVEL_COMPLETE_DURATION) {
      endLevelComplete(gs);
      return;
    }
    if (gs.phaseElapsed >= LEVEL_COMPLETE_INPUT_DELAY) {
      const skip = gs.input.justPressed('Space') ||
                   gs.input.justPressed('Enter') ||
                   gs.input.actionJustPressed('pause') ||
                   gs.input.pointer.justDown;
      if (skip) endLevelComplete(gs);
    }
  },

  render(gs, dt) {
    const { ctx, fieldW, fieldH } = gs;
    const palette = gs.config.palette;

    ctx.save();
    ctx.fillStyle = 'rgba(2, 1, 3, 0.72)';
    ctx.fillRect(0, 0, fieldW, fieldH);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const pulse = 1 + 0.05 * Math.sin(gs.elapsed * 4);
    ctx.shadowColor = palette.toxicGreen;
    ctx.shadowBlur = 30 * pulse;
    ctx.fillStyle = palette.toxicGreen;
    ctx.font = `bold ${Math.round(54 * pulse)}px VT323, monospace`;
    ctx.fillText('LEVEL', fieldW / 2, fieldH * 0.34);
    ctx.fillText('CLEARED', fieldW / 2, fieldH * 0.44);

    ctx.shadowBlur = 0;
    if (gs._bossScoreGain) {
      ctx.fillStyle = palette.bone;
      ctx.font = '20px VT323, monospace';
      ctx.fillText(`BOSS BONUS  +${gs._bossScoreGain}`, fieldW / 2, fieldH * 0.56);
    }
    ctx.fillStyle = palette.bone;
    ctx.font = 'bold 28px VT323, monospace';
    ctx.fillText(`SCORE  ${(gs.player?.score ?? 0).toString().padStart(7, '0')}`, fieldW / 2, fieldH * 0.64);

    if (gs.phaseElapsed >= LEVEL_COMPLETE_INPUT_DELAY) {
      const a = 0.5 + 0.5 * Math.sin(gs.elapsed * 3);
      ctx.globalAlpha = a;
      ctx.fillStyle = palette.boneDim;
      ctx.font = '16px VT323, monospace';
      ctx.fillText('[ PRESS ANYTHING TO CONTINUE ]', fieldW / 2, fieldH * 0.82);
    }
    ctx.restore();
  },
};

// Routes the end of LEVEL_COMPLETE: next level via gs.levels.advanceOrFinish()
// (which itself calls routeAfterRun on game completion). Fallback path
// preserved if levels.js isn't registered.
function endLevelComplete(gs) {
  if (gs.levels && typeof gs.levels.advanceOrFinish === 'function') {
    gs.levels.advanceOrFinish();
  } else if (typeof gs.routeAfterRun === 'function') {
    gs.routeAfterRun();
  } else {
    transitionTo(gs.engine, PHASES.MENU);
  }
}
