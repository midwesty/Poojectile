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
  BOOT:            'boot',
  INTRO:           'intro',
  MENU:            'menu',
  PREGAME:         'pregame',
  PLAYING:         'playing',
  PAUSED:          'paused',
  LEVEL_COMPLETE:  'level_complete',
  BOSS_WARNING:    'boss_warning',
  BOSS_FIGHT:      'boss_fight',
  GAME_OVER:       'game_over',
  CUTSCENE:        'cutscene',
  CREDITS:         'credits',
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

    for (const sys of engine.systems) {
      if (sys.render && systemActiveIn(sys, phase)) {
        safeCall(sys, 'render', gs, dt);
      }
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
  registerSystem(engine, gameOverSystem);
}

// ----- Background System -----
// Procedural parallax starfield + biological haze. Runs in
// phases that need a star background (boot, menu, pregame).
// Level rendering (when it exists) will run AFTER this with its
// own background overlay, so this gets covered up in 'playing'.
const STAR_LAYERS = [
  { count: 30, speed: 8,  size: 1,   color: 'rgba(240,232,216,0.35)' },
  { count: 24, speed: 18, size: 1.5, color: 'rgba(240,232,216,0.6)'  },
  { count: 16, speed: 36, size: 2.5, color: 'rgba(240,232,216,0.9)'  },
];

const backgroundSystem = {
  id: 'background',
  priority: 10,            // renders first (behind everything)
  phases: [
    PHASES.BOOT, PHASES.MENU, PHASES.PREGAME,
    PHASES.PLAYING, PHASES.PAUSED, PHASES.BOSS_WARNING,
    PHASES.BOSS_FIGHT, PHASES.LEVEL_COMPLETE,
    PHASES.GAME_OVER, PHASES.CREDITS,
  ],
  init(gs) {
    const w = gs.fieldW, h = gs.fieldH;
    gs._stars = STAR_LAYERS.map(layer => ({
      ...layer,
      points: Array.from({ length: layer.count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
      })),
    }));
  },
  update(gs, dt) {
    const h = gs.fieldH;
    for (const layer of gs._stars) {
      for (const star of layer.points) {
        star.y = (star.y + layer.speed * dt + h) % h;
      }
    }
  },
  render(gs, dt) {
    const { ctx, fieldW, fieldH } = gs;
    // Starfield
    for (const layer of gs._stars) {
      ctx.fillStyle = layer.color;
      for (const star of layer.points) {
        ctx.fillRect(star.x, star.y, layer.size, layer.size);
      }
    }
    // Faint biological haze (subtle green tint)
    const haze = ctx.createRadialGradient(
      fieldW * 0.5, fieldH * 0.45, 0,
      fieldW * 0.5, fieldH * 0.45, fieldH * 0.7
    );
    haze.addColorStop(0, 'rgba(127, 255, 92, 0.05)');
    haze.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, fieldW, fieldH);
  },
};

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
    gs.audio?.play('gameOver');
  },
  update(gs, dt) {
    if (gs.phaseElapsed < GAME_OVER_INPUT_DELAY) return;
    const skip =
      gs.input.actionJustPressed('pause') ||
      gs.input.justPressed('Space') ||
      gs.input.justPressed('Enter') ||
      gs.input.pointer.justDown;
    if (skip) transitionTo(gs.engine, PHASES.MENU);
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
// Game director for the playing/paused phases. Handles:
//   - ESC toggles pause
//   - Renders minimal in-game status (just enough until hud.js exists)
// When levels.js + hud.js arrive in later steps they'll layer on
// top of this; this system stays as the lightweight coordinator.
const playingSystem = {
  id: 'playing',
  priority: 200,        // renders LAST so status text sits on top
  phases: [PHASES.PLAYING, PHASES.PAUSED],

  onEnterPhase(gs, fromPhase, toPhase) {
    // Newly entering playing/paused from outside (typically from PREGAME).
    // PAUSED <-> PLAYING transitions don't fire this — both phases are
    // already in this system's phase list.
    if (gs.audio) {
      if (fromPhase === PHASES.PREGAME) gs.audio.play('levelStart');
      gs.audio.music.play('level1');
    }
  },

  onExitPhase(gs, fromPhase, toPhase) {
    // Leaving the playing/paused band (e.g. → GAME_OVER, → MENU)
    if (gs.audio) gs.audio.music.stop();
  },

  update(gs, dt) {
    if (gs.input.actionJustPressed('pause')) {
      gs.audio?.play('pauseToggle');
      transitionTo(
        gs.engine,
        gs.phase === PHASES.PLAYING ? PHASES.PAUSED : PHASES.PLAYING
      );
    }
  },
  render(gs, dt) {
    const { ctx, fieldW, fieldH } = gs;
    const palette = gs.config.palette;
    const p = gs.player;
    if (!p) return;

    // Minimal HUD strip: lives | weapon | score | bombs
    ctx.save();
    ctx.font = '18px VT323, monospace';
    ctx.textBaseline = 'top';

    // Top-left: lives
    ctx.textAlign = 'left';
    ctx.fillStyle = palette.bloodRed;
    ctx.shadowColor = palette.bloodRed;
    ctx.shadowBlur = 6;
    ctx.fillText(`LIVES ${p.lives}`, 12, 10);
    ctx.shadowBlur = 0;
    ctx.fillStyle = palette.bone;
    ctx.fillText(`HP ${'\u2588'.repeat(p.hp)}${'\u2591'.repeat(p.maxHp - p.hp)}`, 12, 30);

    // Top-right: score (positioned below the close-X button at ~48px high)
    ctx.textAlign = 'right';
    ctx.fillStyle = palette.bone;
    ctx.fillText(`SCORE  ${p.score.toString().padStart(6, '0')}`, fieldW - 12, 56);

    // Bottom-left: weapon
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = palette.toxicGreen;
    const weapon = gs.data?.weapons?.weapons?.[p.weaponId];
    ctx.fillText(`WPN ${weapon?.name ?? p.weaponId}`, 12, fieldH - 10);

    // Bottom-right: bombs
    ctx.textAlign = 'right';
    ctx.fillStyle = palette.authorityBlue;
    ctx.fillText(`BOMB \u00D7 ${p.bombs}`, fieldW - 12, fieldH - 10);

    // ---- Active modifier icons (bottom-left strip, above the weapon line) ----
    if (p.modifiers) {
      const mods = p.modifiers;
      const iconY = fieldH - 36;
      let iconX = 12;
      const drawMod = (icon, color, secondsLeft) => {
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.fillStyle = color;
        ctx.font = 'bold 20px VT323, monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(icon, iconX, iconY);
        if (secondsLeft !== null) {
          ctx.shadowBlur = 0;
          ctx.fillStyle = palette.bone;
          ctx.font = '14px VT323, monospace';
          ctx.fillText(`${secondsLeft.toFixed(1)}s`, iconX + 16, iconY);
        }
        ctx.shadowBlur = 0;
        iconX += 70;
      };
      if (mods.shield_bubble)         drawMod('O', '#4af2ff', null);
      if (mods.speed_boost > 0)       drawMod('>', '#ffe44a', mods.speed_boost);
      if (mods.damage_up > 0)         drawMod('X', '#ff3b3b', mods.damage_up);
      if (mods.score_multiplier > 0)  drawMod('2', '#ff6ad8', mods.score_multiplier);
    }

    ctx.restore();

    // Pause overlay
    if (gs.phase === PHASES.PAUSED) {
      ctx.save();
      ctx.fillStyle = 'rgba(2, 1, 3, 0.7)';
      ctx.fillRect(0, 0, fieldW, fieldH);
      ctx.fillStyle = palette.toxicGreen;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = palette.toxicGreen;
      ctx.shadowBlur = 24;
      ctx.font = 'bold 56px VT323, monospace';
      ctx.fillText('PAUSED', fieldW / 2, fieldH * 0.45);
      ctx.shadowBlur = 0;
      ctx.fillStyle = palette.boneDim;
      ctx.font = '20px VT323, monospace';
      ctx.fillText('ESC to resume', fieldW / 2, fieldH * 0.55);
      ctx.restore();
    }
  },
};
