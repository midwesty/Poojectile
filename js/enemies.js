// ============================================================
// POOJECTILE — enemies.js
//
// Enemy entity system. Pool of 100 slots, recycled. Movement
// AI dispatched on movePattern string from enemies.json so
// patterns can be added by data without engine changes.
//
// Collision is also handled here: we iterate alive enemies
// once per frame and check them against projectiles + player.
// This is O(enemies × projectiles) but with the pools capped
// at sane sizes (100 enemies × 300 projectiles = 30k cmps/frame)
// it's well within budget on any device. Spatial partitioning
// can come later if profiling demands it.
//
// Public API on gs.enemies:
//   spawn({ typeId, x, y })   -> enemy or null
//   forEachAlive(fn)
//   clear()
//
// Difficulty multipliers (config.difficulty[level]) are applied
// at spawn time to hp/speed.
// ============================================================

import { PHASES, transitionTo } from './engine.js';
import { circleHit, createPool, dampLerp, resolveColor } from './utils.js';

const POOL_SIZE = 100;
const VERTEX_COUNT = 9;   // fixed for the asteroid polygon

// Off-screen cull margin (mostly for the bottom — enemies that
// scroll off the bottom of the screen disappear without reward)
const CULL_MARGIN_BOTTOM = 80;
const CULL_MARGIN_SIDES  = 60;

function makeEnemy() {
  // Preallocate everything an enemy might need — zero alloc during gameplay.
  const vertices = new Array(VERTEX_COUNT);
  for (let i = 0; i < VERTEX_COUNT; i++) vertices[i] = { r: 1, theta: 0 };
  return {
    alive: false,
    typeId: null,
    typeDef: null,
    x: 0, y: 0,
    vx: 0, vy: 0,
    hp: 1,
    maxHp: 1,
    age: 0,
    size: 14,
    rotation: 0,
    rotationSpeed: 0,
    flashTime: 0,         // brief white flash on hit
    vertices,
    // Pattern-specific scratch state
    pattern: {
      baseX: 0, amp: 0, freq: 1, phase: 0,
      targetVx: 0, nextChange: 0,
      t: 0,
    },
  };
}

export const enemiesSystem = {
  id: 'enemies',
  priority: 70,         // renders above projectiles
  phases: [PHASES.PLAYING, PHASES.PAUSED, PHASES.BOSS_FIGHT, PHASES.BOSS_WARNING],

  init(gs) {
    const pool = createPool(POOL_SIZE, makeEnemy);

    gs.enemies = {
      pool,

      spawn({ typeId, x, y }) {
        const def = gs.data?.enemies?.enemies?.[typeId];
        if (!def) {
          console.warn(`[Enemies] Unknown type "${typeId}"`);
          return null;
        }
        const e = pool.acquire();
        if (!e) return null;

        // Apply difficulty multipliers
        const diff = gs.config.difficulty[gs.difficulty] || gs.config.difficulty.normal;
        const hp = Math.max(1, Math.round(def.hp * (diff.enemyHpMultiplier ?? 1)));
        const speed = def.speed * (diff.enemySpeedMultiplier ?? 1);

        e.alive = true;
        e.typeId = typeId;
        e.typeDef = def;
        e.x = x;
        e.y = y;
        e.vx = 0;
        e.vy = speed;
        e.hp = hp;
        e.maxHp = hp;
        e.age = 0;
        e.size = def.size;
        e.rotation = Math.random() * Math.PI * 2;
        e.rotationSpeed = (Math.random() - 0.5) * 1.2;
        e.flashTime = 0;

        // Random asteroid silhouette
        for (let i = 0; i < VERTEX_COUNT; i++) {
          e.vertices[i].r = 0.78 + Math.random() * 0.35;
          e.vertices[i].theta = (Math.PI * 2 * i) / VERTEX_COUNT
                              + (Math.random() - 0.5) * 0.25;
        }

        // Pattern init
        switch (def.movePattern) {
          case 'sine_wave':
            e.pattern.baseX = x;
            e.pattern.amp  = 40 + Math.random() * 40;
            e.pattern.freq = 1.0 + Math.random() * 1.2;
            e.pattern.phase = Math.random() * Math.PI * 2;
            e.pattern.t = 0;
            break;
          case 'random_drift':
            e.pattern.targetVx = (Math.random() - 0.5) * speed * 0.6;
            e.pattern.nextChange = 0.5 + Math.random() * 1.5;
            e.pattern.t = 0;
            break;
          default:
            e.pattern.t = 0;
        }

        return e;
      },

      forEachAlive(fn) { pool.forEachAlive(fn); },
      countAlive()     { return pool.countAlive(); },
      clear()          { pool.clear(); },
    };
  },

  onExitPhase(gs, fromPhase, toPhase) {
    if (toPhase === PHASES.MENU || toPhase === PHASES.GAME_OVER) {
      gs.enemies.clear();
    }
  },

  onEnterPhase(gs, fromPhase, toPhase) {
    // (Wave timing + boss triggering now lives in levels.js)
  },

  update(gs, dt) {
    if (gs.phase === PHASES.PAUSED) return;

    // ---- Move + cull enemies ----
    const w = gs.fieldW, h = gs.fieldH;
    gs.enemies.forEachAlive((e) => {
      updateMovement(e, dt);
      e.rotation += e.rotationSpeed * dt;
      e.age += dt;
      if (e.flashTime > 0) e.flashTime = Math.max(0, e.flashTime - dt);

      // Cull when fully off-screen on bottom or sides
      if (e.y - e.size > h + CULL_MARGIN_BOTTOM ||
          e.x + e.size < -CULL_MARGIN_SIDES ||
          e.x - e.size > w + CULL_MARGIN_SIDES) {
        gs.enemies.pool.release(e);
      }
    });

    // ---- Collisions ----
    runCollisions(gs);

    // (Spawning is now driven by levels.js based on wave timeline data)
  },

  render(gs, dt) {
    const { ctx } = gs;
    const palette = gs.config.palette;
    const showHB = gs.config.debug.showHitboxes;

    gs.enemies.forEachAlive((e) => {
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.rotation);

      const color = resolveColor(gs, e.typeDef.color);
      const accent = resolveColor(gs, e.typeDef.accentColor);

      // Outer silhouette path
      ctx.beginPath();
      for (let i = 0; i < VERTEX_COUNT; i++) {
        const v = e.vertices[i];
        const r = e.size * v.r;
        const x = Math.cos(v.theta) * r;
        const y = Math.sin(v.theta) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();

      // Body fill (radial gradient for depth)
      const grad = ctx.createRadialGradient(-e.size * 0.3, -e.size * 0.3, 0, 0, 0, e.size);
      grad.addColorStop(0, lighten(color, 0.25));
      grad.addColorStop(1, accent);
      ctx.fillStyle = grad;
      ctx.fill();

      // Dark edge stroke
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Inner crater (a few smaller dark dimples)
      for (let i = 0; i < 3; i++) {
        const ang = (e.rotation * 0 + i * 2.094 + e.vertices[i].theta) % (Math.PI * 2);
        const cr = e.size * 0.18 * (0.7 + e.vertices[i].r * 0.3);
        const cx = Math.cos(ang) * e.size * 0.35;
        const cy = Math.sin(ang) * e.size * 0.35;
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(cx, cy, cr, 0, Math.PI * 2);
        ctx.fill();
      }

      // Hit flash (white overlay on top)
      if (e.flashTime > 0) {
        const a = Math.min(1, e.flashTime * 8);
        ctx.fillStyle = `rgba(255, 255, 255, ${a * 0.6})`;
        ctx.beginPath();
        for (let i = 0; i < VERTEX_COUNT; i++) {
          const v = e.vertices[i];
          const r = e.size * v.r;
          const x = Math.cos(v.theta) * r;
          const y = Math.sin(v.theta) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
      }

      ctx.restore();

      // Hitbox debug
      if (showHB) {
        ctx.save();
        ctx.strokeStyle = palette.bloodRed;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.size, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    });
  },
};

// ============================================================
// Movement patterns
// ============================================================

function updateMovement(e, dt) {
  const def = e.typeDef;
  switch (def.movePattern) {

    case 'straight': {
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      break;
    }

    case 'sine_wave': {
      e.pattern.t += dt;
      e.x = e.pattern.baseX + Math.sin(e.pattern.t * e.pattern.freq + e.pattern.phase) * e.pattern.amp;
      e.y += e.vy * dt;
      break;
    }

    case 'random_drift': {
      e.pattern.t += dt;
      if (e.pattern.t >= e.pattern.nextChange) {
        e.pattern.targetVx = (Math.random() - 0.5) * def.speed * 0.6;
        e.pattern.nextChange = e.pattern.t + 0.4 + Math.random() * 1.2;
      }
      e.vx = dampLerp(e.vx, e.pattern.targetVx, 0.92, dt);
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      break;
    }

    default: {
      // Fallback: straight drift
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      break;
    }
  }
}

// ============================================================
// Collisions
// ============================================================

function runCollisions(gs) {
  const player = gs.player;
  if (!player) return;

  gs.enemies.forEachAlive((e) => {
    // ----- Projectile vs enemy -----
    gs.projectiles.forEachAlive((p) => {
      if (p.owner !== 'player') return;
      if (!circleHit(p.x, p.y, p.typeDef.size, e.x, e.y, e.size)) return;

      // Hit!
      e.hp -= p.damage;
      e.flashTime = 0.12;

      // Hit sparks at impact point
      gs.particles.burst({
        x: p.x, y: p.y,
        count: 4,
        speedMin: 60, speedMax: 180,
        lifetime: 0.25,
        size: 2,
        color: resolveColor(gs, p.typeDef.color),
        glow: 8,
      });

      gs.projectiles.pool.release(p);

      if (e.hp <= 0) {
        killEnemy(gs, e);
      } else {
        gs.audio?.play('hit');
      }
    });

    // ----- Enemy vs player (contact damage) -----
    if (!e.alive) return;       // killed by projectile loop above
    if (player.iFrames > 0) return;

    if (circleHit(e.x, e.y, e.size, player.x, player.y, player.hitRadius)) {
      damagePlayer(gs, e.typeDef.contactDamage ?? 1, e.x, e.y);
      // Asteroid breaks on contact too
      killEnemy(gs, e);
    }
  });
}

function killEnemy(gs, e) {
  const def = e.typeDef;

  // Score (with difficulty + score_multiplier modifier)
  const diff = gs.config.difficulty[gs.difficulty] || gs.config.difficulty.normal;
  const scoreMulti = gs.player.modifiers.score_multiplier > 0 ? 2 : 1;
  const scoreGain = Math.round((def.scoreValue ?? 0) * (diff.scoreMultiplier ?? 1) * scoreMulti);
  gs.player.score += scoreGain;

  // Audio — matches the deathEffect "weight"
  const sfxByEffect = {
    small_pop: 'explosionSmall',
    medium_explosion: 'explosionMedium',
    large_explosion: 'explosionLarge',
  };
  gs.audio?.play(sfxByEffect[def.deathEffect] || 'explosionSmall');

  // Death effect
  spawnDeathEffect(gs, e);

  // Drop table — roll each entry independently, take first success
  const drops = def.dropTable || [];
  for (const drop of drops) {
    if (Math.random() < drop.chance) {
      gs.powerups?.spawn({
        typeId: drop.powerupId,
        x: e.x,
        y: e.y,
      });
      break;
    }
  }

  // Free the slot
  gs.enemies.pool.release(e);
}

function spawnDeathEffect(gs, e) {
  const palette = gs.config.palette;
  const c = resolveColor(gs, e.typeDef.color);
  const accent = resolveColor(gs, e.typeDef.accentColor);

  switch (e.typeDef.deathEffect) {

    case 'medium_explosion': {
      gs.particles.burst({
        x: e.x, y: e.y,
        count: 18,
        speedMin: 80, speedMax: 280,
        lifetime: 0.7,
        size: e.size * 0.32,
        color: palette.rustOrange,
        glow: 14,
      });
      gs.particles.burst({
        x: e.x, y: e.y,
        count: 12,
        speedMin: 40, speedMax: 160,
        lifetime: 0.55,
        size: e.size * 0.22,
        color: c,
        glow: 6,
      });
      break;
    }

    case 'large_explosion': {
      gs.particles.burst({
        x: e.x, y: e.y,
        count: 28,
        speedMin: 120, speedMax: 380,
        lifetime: 0.9,
        size: e.size * 0.34,
        color: palette.rustOrange,
        glow: 18,
      });
      gs.particles.burst({
        x: e.x, y: e.y,
        count: 18,
        speedMin: 60, speedMax: 220,
        lifetime: 0.75,
        size: e.size * 0.26,
        color: palette.bloodRed,
        glow: 10,
      });
      break;
    }

    case 'small_pop':
    default: {
      gs.particles.burst({
        x: e.x, y: e.y,
        count: 10,
        speedMin: 80, speedMax: 220,
        lifetime: 0.45,
        size: Math.max(2, e.size * 0.3),
        color: c,
        glow: 6,
      });
      gs.particles.burst({
        x: e.x, y: e.y,
        count: 5,
        speedMin: 30, speedMax: 120,
        lifetime: 0.55,
        size: Math.max(2, e.size * 0.22),
        color: accent,
        glow: 3,
      });
      break;
    }
  }
}

function damagePlayer(gs, amount, fromX, fromY) {
  const p = gs.player;
  const palette = gs.config.palette;

  // Shield bubble absorbs one hit, no HP loss
  if (p.modifiers.shield_bubble) {
    p.modifiers.shield_bubble = false;
    p.iFrames = gs.config.player.invincibilityFramesOnRespawn / 60;
    gs.audio?.play('shieldBreak');
    gs.particles.burst({
      x: p.x, y: p.y,
      count: 22,
      speedMin: 120, speedMax: 320,
      lifetime: 0.6,
      size: 2.5,
      color: '#4af2ff',
      glow: 16,
    });
    return;
  }

  p.hp -= amount;
  p.iFrames = gs.config.player.invincibilityFramesOnRespawn / 60;
  gs.audio?.play('damage');

  // Red burst from player + directional spray away from the hit source
  gs.particles.burst({
    x: p.x, y: p.y,
    count: 14,
    speedMin: 80, speedMax: 240,
    lifetime: 0.55,
    size: 3,
    color: palette.bloodRed,
    glow: 12,
  });

  if (p.hp <= 0) {
    p.lives -= 1;
    if (p.lives > 0) {
      // Respawn at start
      p.hp = p.maxHp;
      const cfg = gs.config.player;
      p.x = gs.fieldW * cfg.startingX;
      p.y = gs.fieldH * cfg.startingY;
      p.vx = 0; p.vy = 0;
    } else {
      // Out of lives — game over
      transitionTo(gs.engine, PHASES.GAME_OVER);
    }
  }
}

// ============================================================
// Color helpers
// ============================================================

function lighten(hex, amount) {
  if (!hex || !hex.startsWith('#') || hex.length !== 7) return hex;
  const r = Math.min(255, Math.round(parseInt(hex.slice(1, 3), 16) + 255 * amount));
  const g = Math.min(255, Math.round(parseInt(hex.slice(3, 5), 16) + 255 * amount));
  const b = Math.min(255, Math.round(parseInt(hex.slice(5, 7), 16) + 255 * amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
