// ============================================================
// POOJECTILE — levels.js
//
// Level director. Reads levels.json and runs the active level:
//   - Tracks elapsed time within the level (paused during boss
//     phases, paused while game is PAUSED)
//   - Fires waves on schedule (spawn formations + boss triggers)
//   - Detects level completion based on completion.type
//   - Handles next-level vs game-complete routing
//
// Public API (after init):
//   gs.levels.startFirst()         — begin run from level 1
//   gs.levels.startLevel(idx)      — start specific level by index
//   gs.levels.advanceOrFinish()    — at LEVEL_COMPLETE end, go to
//                                    next level or end the run
//   gs.levels.hasNext()            — bool
//   gs.levels.activeIndex          — current level index
//   gs.level                       — convenience pointer to active def
// ============================================================

import { PHASES, transitionTo } from './engine.js';

export const levelsSystem = {
  id: 'levels',
  priority: 60,   // between player(50) and enemies(70)

  // Active in gameplay phases so wave timing keeps running through
  // PAUSED (we'll skip the actual tick when paused) and is fully
  // inert outside gameplay.
  phases: [
    PHASES.PLAYING, PHASES.PAUSED,
    PHASES.BOSS_WARNING, PHASES.BOSS_FIGHT,
    PHASES.LEVEL_COMPLETE,
  ],

  init(gs) {
    gs.levels = {
      list: [],            // ordered list of level definitions
      order: [],           // their string ids in play order
      activeIndex: -1,     // -1 means no active level
      runtime: makeRuntime(),

      loadFromData(data) {
        const order = Array.isArray(data?.order) ? data.order : Object.keys(data?.levels || {});
        this.order = order;
        this.list = order
          .map((id) => data.levels[id])
          .filter((def) => def && def.id);
      },

      startFirst() {
        if (this.list.length === 0) return false;
        this.startLevel(0);
        return true;
      },

      startLevel(index) {
        if (index < 0 || index >= this.list.length) return null;
        this.activeIndex = index;
        const def = this.list[index];
        gs.level = {
          id: def.id,
          number: def.number ?? index + 1,
          displayName: def.displayName ?? def.id,
          subtitle: def.subtitle ?? '',
          def,
        };
        // Reset runtime tracking
        this.runtime = makeRuntime();
        return def;
      },

      hasNext() {
        return this.activeIndex >= 0 && this.activeIndex + 1 < this.list.length;
      },

      // Called by engine.js at end of LEVEL_COMPLETE — advance to next
      // level (transition PREGAME) or end the run (routeAfterRun).
      advanceOrFinish() {
        if (this.hasNext()) {
          this.startLevel(this.activeIndex + 1);
          transitionTo(gs.engine, PHASES.PREGAME);
        } else {
          // End of run = game complete
          if (typeof gs.routeAfterRun === 'function') {
            gs.routeAfterRun();
          } else {
            transitionTo(gs.engine, PHASES.MENU);
          }
        }
      },

      reset() {
        this.activeIndex = -1;
        this.runtime = makeRuntime();
        gs.level = null;
      },
    };

    // Auto-load from gs.data (set up by main.js before startEngine)
    if (gs.data?.levels) {
      gs.levels.loadFromData(gs.data.levels);
    }
  },

  onEnterPhase(gs, fromPhase, toPhase) {
    // Reset wave runtime each time we (re)enter PLAYING from PREGAME
    // (handles both initial start and inter-level transitions)
    if (toPhase === PHASES.PLAYING && fromPhase === PHASES.PREGAME) {
      gs.levels.runtime = makeRuntime();
    }
  },

  onExitPhase(gs, fromPhase, toPhase) {
    // Leaving the gameplay band entirely → clear level state.
    // GAME_OVER and MENU both qualify. HIGH_SCORE_ENTRY is fine to
    // keep level state through, since it returns to MENU after submit.
    if (toPhase === PHASES.MENU || toPhase === PHASES.GAME_OVER) {
      gs.levels.reset();
    }
  },

  update(gs, dt) {
    // Only tick wave time during PLAYING.
    if (gs.phase !== PHASES.PLAYING) return;

    const def = gs.level?.def;
    const rt = gs.levels.runtime;
    if (!def) return;

    rt.time += dt;

    // ----- Fire waves whose time has come -----
    const waves = def.waves || [];
    for (let i = 0; i < waves.length; i++) {
      if (rt.firedWaves[i]) continue;
      const w = waves[i];
      if (rt.time >= (w.at ?? 0)) {
        fireWave(gs, w);
        rt.firedWaves[i] = true;
        if (w.type === 'boss') rt.bossDispatched = true;
      }
    }

    // All non-boss waves accounted for?
    rt.allWavesFired = waves.every((_, i) => rt.firedWaves[i]);

    // ----- Completion detection (only for non-boss levels) -----
    // Boss levels complete via bosses.js finalBossExplosion → LEVEL_COMPLETE
    const compType = def.completion?.type;
    if (compType === 'wave_clear' && rt.allWavesFired) {
      // Wait until on-screen enemies clear, then a brief settle delay
      const enemiesLeft = gs.enemies?.countAlive ? gs.enemies.countAlive() : 0;
      if (enemiesLeft === 0) {
        rt.clearedTimer += dt;
        if (rt.clearedTimer >= 1.0 && !rt.completionTransitionFired) {
          rt.completionTransitionFired = true;
          gs._bossScoreGain = 0;   // no boss bonus for non-boss levels
          transitionTo(gs.engine, PHASES.LEVEL_COMPLETE);
        }
      } else {
        rt.clearedTimer = 0;
      }
    } else if (compType === 'timeout' && rt.time >= (def.completion?.value ?? 999)) {
      if (!rt.completionTransitionFired) {
        rt.completionTransitionFired = true;
        transitionTo(gs.engine, PHASES.LEVEL_COMPLETE);
      }
    }
  },
};

function makeRuntime() {
  return {
    time: 0,
    firedWaves: {},
    bossDispatched: false,
    allWavesFired: false,
    clearedTimer: 0,
    completionTransitionFired: false,
  };
}

// ============================================================
// Wave firing
// ============================================================

function fireWave(gs, wave) {
  if (wave.type === 'boss') {
    gs._pendingBossTypeId = wave.bossId || 'asteroid_giant';
    gs._pendingBossMusicTrack = wave.musicTrack || 'boss1';
    transitionTo(gs.engine, PHASES.BOSS_WARNING);
    return;
  }

  if (wave.type !== 'spawn') return;

  const positions = computeFormation(gs, wave.formation, wave.count);
  for (const pos of positions) {
    gs.enemies?.spawn({ typeId: wave.enemyType, x: pos.x, y: pos.y });
  }
}

// ============================================================
// Formations — return {x, y} positions to spawn enemies at
// All spawn y values are above the playfield top so enemies
// scroll/drift in naturally.
// ============================================================

function computeFormation(gs, formation, count) {
  const fieldW = gs.fieldW;
  const c = Math.max(1, count | 0);
  const out = [];

  switch (formation) {
    case 'single': {
      out.push({ x: fieldW * 0.5, y: -40 });
      break;
    }

    case 'line_h': {
      // Even horizontal spread
      const margin = 60;
      const span = fieldW - margin * 2;
      const step = c > 1 ? span / (c - 1) : 0;
      for (let i = 0; i < c; i++) {
        out.push({ x: margin + step * i, y: -40 });
      }
      break;
    }

    case 'v': {
      // V formation pointing down (leader lowest, wings behind)
      const cx = fieldW * 0.5;
      const leaderY = -40;
      const sideSpacing = 60;     // horizontal offset per row
      const rowSpacing = 50;      // vertical setback per row
      // Leader
      out.push({ x: cx, y: leaderY });
      // Wings — alternate left/right, increasing offset
      for (let i = 1; i < c; i++) {
        const tier = Math.ceil(i / 2);
        const side = (i % 2 === 1) ? -1 : 1;
        out.push({
          x: cx + side * sideSpacing * tier,
          y: leaderY - rowSpacing * tier,
        });
      }
      break;
    }

    case 'random': {
      const margin = 40;
      for (let i = 0; i < c; i++) {
        out.push({
          x: margin + Math.random() * (fieldW - margin * 2),
          y: -40 - Math.random() * 220,    // staggered entry depth
        });
      }
      break;
    }

    default: {
      out.push({ x: fieldW * 0.5, y: -40 });
    }
  }

  return out;
}
