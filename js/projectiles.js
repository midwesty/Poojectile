// ============================================================
// POOJECTILE — projectiles.js
//
// Pooled projectile manager. Allocates a fixed pool at init,
// recycles slots, never allocates during gameplay.
//
// Public API on gs.projectiles:
//   spawn({ typeId, x, y, vx, vy, damage?, owner? }) -> projectile | null
//   forEachAlive(fn)
//   countAlive()
//   clear()
//
// Projectile type definitions are loaded from data/weapons.json
// into gs.data.weapons.projectiles at boot.
// ============================================================

import { PHASES, transitionTo } from './engine.js';
import { createPool, resolveColor, hexAlpha } from './utils.js';

const POOL_SIZE = 300;

// Off-screen cull margin — projectiles get freed when they go
// this far past any playfield edge. Generous so long-trailed
// shots don't pop visibly.
const CULL_MARGIN = 40;

function makeProjectile() {
  return {
    alive: false,
    x: 0, y: 0,
    vx: 0, vy: 0,
    age: 0,             // seconds since spawn
    lifetime: 0,        // seconds before auto-cull
    damage: 1,
    owner: 'player',
    typeId: null,
    typeDef: null,      // cached reference to the projectile type definition
  };
}

export const projectilesSystem = {
  id: 'projectiles',
  priority: 60,         // renders above background and player, below particles/HUD
  phases: [PHASES.PLAYING, PHASES.PAUSED, PHASES.BOSS_FIGHT, PHASES.BOSS_WARNING],

  init(gs) {
    const pool = createPool(POOL_SIZE, makeProjectile);

    gs.projectiles = {
      pool,

      /** Spawn a projectile. Returns the projectile or null if pool is full. */
      spawn({ typeId, x, y, vx, vy, damage, owner }) {
        const defs = gs.data?.weapons?.projectiles;
        if (!defs || !defs[typeId]) {
          console.warn(`[Projectiles] Unknown type "${typeId}"`);
          return null;
        }
        const slot = pool.acquire();
        if (!slot) return null;

        const def = defs[typeId];
        slot.alive = true;
        slot.x = x;
        slot.y = y;
        slot.vx = vx;
        slot.vy = vy;
        slot.age = 0;
        slot.lifetime = (def.lifetimeMs ?? 3000) / 1000;
        slot.damage = damage ?? def.damage ?? 1;
        slot.owner = owner ?? def.owner ?? 'player';
        slot.typeId = typeId;
        slot.typeDef = def;
        return slot;
      },

      forEachAlive(fn) { pool.forEachAlive(fn); },
      countAlive()     { return pool.countAlive(); },
      clear()          { pool.clear(); },
    };
  },

  onExitPhase(gs, fromPhase, toPhase) {
    // Clear projectiles when leaving gameplay phases for menu/credits/etc.
    if (toPhase === PHASES.MENU || toPhase === PHASES.GAME_OVER) {
      gs.projectiles.clear();
    }
  },

  update(gs, dt) {
    if (gs.phase === PHASES.PAUSED) return;
    const w = gs.fieldW, h = gs.fieldH;
    const player = gs.player;
    gs.projectiles.forEachAlive((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.age += dt;

      // Lifetime cull
      if (p.age >= p.lifetime) {
        gs.projectiles.pool.release(p);
        return;
      }
      // Off-screen cull
      if (p.x < -CULL_MARGIN || p.x > w + CULL_MARGIN ||
          p.y < -CULL_MARGIN || p.y > h + CULL_MARGIN) {
        gs.projectiles.pool.release(p);
        return;
      }

      // ----- Enemy-owned projectile vs player -----
      if (p.owner === 'enemy' && player && player.iFrames <= 0) {
        const r = p.typeDef.size + player.hitRadius;
        const dx = p.x - player.x;
        const dy = p.y - player.y;
        if (dx * dx + dy * dy <= r * r) {
          applyEnemyProjectileHit(gs, p);
          gs.projectiles.pool.release(p);
        }
      }
    });
  },

  render(gs, dt) {
    const { ctx } = gs;
    ctx.save();

    gs.projectiles.forEachAlive((p) => {
      const def = p.typeDef;
      const color = resolveColor(gs, def.color);
      const glowColor = resolveColor(gs, def.glowColor || def.color);

      // ----- Trail (cheap stamping: ghost copies offset along -velocity) -----
      const trailLen = def.trailLength ?? 0;
      if (trailLen > 0) {
        for (let i = trailLen; i >= 1; i--) {
          const t = i / trailLen;
          const back = i * 0.025;       // 25ms-worth of travel per step
          const tx = p.x - p.vx * back;
          const ty = p.y - p.vy * back;
          const alpha = (1 - t) * 0.6;
          const size = def.size * (1 - t * 0.6);
          ctx.fillStyle = hexAlpha(resolveColor(gs, def.trailColor || def.color), alpha);
          drawProjectileShape(ctx, def.shape, tx, ty, size);
        }
      }

      // ----- Glow -----
      if (def.glowSize > 0) {
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = def.glowSize;
      } else {
        ctx.shadowBlur = 0;
      }

      // ----- Body -----
      ctx.fillStyle = color;
      drawProjectileShape(ctx, def.shape, p.x, p.y, def.size);

      // ----- Bright core (subtle hot-spot on top of glow) -----
      ctx.shadowBlur = 0;
      ctx.fillStyle = hexAlpha('#ffffff', 0.8);
      drawProjectileShape(ctx, def.shape, p.x, p.y, def.size * 0.4);
    });

    ctx.restore();
  },
};

function drawProjectileShape(ctx, shape, x, y, size) {
  switch (shape) {
    case 'bullet': {
      // Vertical ellipse, taller than wide
      ctx.beginPath();
      ctx.ellipse(x, y, size * 0.6, size, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'laser': {
      // Thin tall rectangle
      ctx.fillRect(x - size * 0.3, y - size * 3, size * 0.6, size * 6);
      break;
    }
    case 'plasma':
    case 'orb':
    case 'pellet':
    default: {
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
}

// ============================================================
// Damage path — enemy projectile hits player
// Mirrors the contact-damage flow in enemies.js / bosses.js:
// shield absorbs first, otherwise HP drops, i-frames apply,
// lives decrement on 0 HP, game over when out of lives.
// ============================================================

function applyEnemyProjectileHit(gs, projectile) {
  const p = gs.player;
  const palette = gs.config.palette;
  const damage = projectile.damage ?? 1;

  // Shield absorb
  if (p.modifiers.shield_bubble) {
    p.modifiers.shield_bubble = false;
    p.iFrames = gs.config.player.invincibilityFramesOnRespawn / 60;
    gs.audio?.play('shieldBreak');
    gs.particles?.burst({
      x: p.x, y: p.y,
      count: 22, speedMin: 120, speedMax: 320,
      lifetime: 0.6, size: 2.5, color: '#4af2ff', glow: 16,
    });
    return;
  }

  p.hp -= damage;
  p.iFrames = gs.config.player.invincibilityFramesOnRespawn / 60;
  gs.audio?.play('damage');
  gs.particles?.burst({
    x: p.x, y: p.y,
    count: 12, speedMin: 80, speedMax: 240,
    lifetime: 0.5, size: 3, color: palette.bloodRed, glow: 10,
  });

  if (p.hp <= 0) {
    p.lives -= 1;
    if (p.lives > 0) {
      // Respawn in place with full HP
      p.hp = p.maxHp;
      const cfg = gs.config.player;
      p.x = gs.fieldW * cfg.startingX;
      p.y = gs.fieldH * cfg.startingY;
      p.vx = 0; p.vy = 0;
    } else {
      transitionTo(gs.engine, PHASES.GAME_OVER);
    }
  }
}
