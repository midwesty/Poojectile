// ============================================================
// POOJECTILE — particles.js
//
// Pooled particle system. 500 slots preallocated, recycled.
// Uses additive blending ('lighter') so overlapping particles
// glow brighter — looks great for explosions.
//
// Public API on gs.particles:
//   spawn(opts)            single raw particle
//   burst(opts)            ring of particles in all directions
//   cone(opts)             directional spray
//   clear()
//
// opts (single particle):
//   { x, y, vx, vy, lifetime, size, color, glow, drag, gravityY }
//
// opts (burst):
//   { x, y, count, speedMin, speedMax, lifetime, size, color, glow }
//
// opts (cone):
//   { x, y, angle, spread, count, speedMin, speedMax, lifetime, size, color, glow }
// ============================================================

import { PHASES } from './engine.js';
import { createPool, resolveColor, hexAlpha } from './utils.js';

const POOL_SIZE = 500;

function makeParticle() {
  return {
    alive: false,
    x: 0, y: 0,
    vx: 0, vy: 0,
    age: 0,
    lifetime: 1,
    startSize: 4,
    size: 4,
    color: '#ffffff',
    glow: 0,
    drag: 0.7,        // velocity multiplier per second (0..1, lower = faster slow)
    gravityY: 0,
  };
}

export const particlesSystem = {
  id: 'particles',
  priority: 80,         // renders above projectiles, below HUD
  phases: [
    PHASES.PLAYING, PHASES.PAUSED,
    PHASES.BOSS_WARNING, PHASES.BOSS_FIGHT,
    PHASES.LEVEL_COMPLETE, PHASES.GAME_OVER,
  ],

  init(gs) {
    const pool = createPool(POOL_SIZE, makeParticle);

    gs.particles = {
      pool,

      /** Spawn one raw particle. */
      spawn({ x, y, vx = 0, vy = 0, lifetime = 0.5, size = 4, color = '#ffffff', glow = 0, drag = 0.7, gravityY = 0 }) {
        const p = pool.acquire();
        if (!p) return null;
        p.alive = true;
        p.x = x; p.y = y;
        p.vx = vx; p.vy = vy;
        p.age = 0;
        p.lifetime = lifetime;
        p.startSize = size;
        p.size = size;
        p.color = color;
        p.glow = glow;
        p.drag = drag;
        p.gravityY = gravityY;
        return p;
      },

      /** Spawn a ring of particles in all directions. */
      burst({ x, y, count = 12, speedMin = 100, speedMax = 220, lifetime = 0.6, size = 4, color = '#ffffff', glow = 6 }) {
        const lifeJitter = lifetime * 0.3;
        for (let i = 0; i < count; i++) {
          const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
          const speed = speedMin + Math.random() * (speedMax - speedMin);
          const life = lifetime + (Math.random() - 0.5) * lifeJitter;
          this.spawn({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            lifetime: life,
            size: size + Math.random() * size * 0.5,
            color, glow,
          });
        }
      },

      /** Directional spray. angle in radians, spread in radians (half-angle). */
      cone({ x, y, angle = 0, spread = 0.6, count = 8, speedMin = 80, speedMax = 200, lifetime = 0.45, size = 3, color = '#ffffff', glow = 4 }) {
        for (let i = 0; i < count; i++) {
          const a = angle + (Math.random() - 0.5) * spread * 2;
          const speed = speedMin + Math.random() * (speedMax - speedMin);
          this.spawn({
            x, y,
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed,
            lifetime: lifetime * (0.6 + Math.random() * 0.8),
            size: size + Math.random() * size * 0.5,
            color, glow,
          });
        }
      },

      forEachAlive(fn) { pool.forEachAlive(fn); },
      countAlive()     { return pool.countAlive(); },
      clear()          { pool.clear(); },
    };
  },

  onExitPhase(gs, fromPhase, toPhase) {
    // Clear when leaving gameplay for the menu so we don't carry stale particles back
    if (toPhase === PHASES.MENU) gs.particles.clear();
  },

  update(gs, dt) {
    if (gs.phase === PHASES.PAUSED) return;
    gs.particles.forEachAlive((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravityY * dt;

      // Drag (velocity damping). Frame-rate independent.
      const dragFactor = Math.pow(p.drag, dt);
      p.vx *= dragFactor;
      p.vy *= dragFactor;

      p.age += dt;
      if (p.age >= p.lifetime) {
        gs.particles.pool.release(p);
        return;
      }

      // Size shrinks linearly with age
      const t = p.age / p.lifetime;
      p.size = p.startSize * (1 - t);
    });
  },

  render(gs, dt) {
    const { ctx } = gs;
    ctx.save();
    // Additive blending — overlapping particles bloom brighter
    ctx.globalCompositeOperation = 'lighter';

    gs.particles.forEachAlive((p) => {
      const t = p.age / p.lifetime;
      // Alpha falls off quadratically for a "hot core dies into smoke" feel
      const alpha = (1 - t) * (1 - t);
      const color = resolveColor(gs, p.color);

      if (p.glow > 0) {
        ctx.shadowColor = color;
        ctx.shadowBlur = p.glow;
      } else {
        ctx.shadowBlur = 0;
      }

      ctx.fillStyle = hexAlpha(color, alpha);
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.5, p.size), 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.restore();
  },
};
