// ============================================================
// POOJECTILE — powerups.js
//
// Pooled power-up entities. Enemies drop them on death (rolled
// from their dropTable). They drift downward with subtle sway,
// get pulled toward the player when nearby (always-on magnet
// field), and apply their effect when the player touches them.
//
// Public API on gs.powerups:
//   spawn({ typeId, x, y })  -> powerup or null
//   forEachAlive(fn)
//   clear()
//
// Effects are dispatched here for type='weapon' and type='passive'.
// type='modifier' effects activate a flag/timer on gs.player and
// the actual stat math lives in player.js (so modifiers can be
// queried from anywhere via gs.player.modifiers).
// ============================================================

import { PHASES } from './engine.js';
import { circleHit, createPool, resolveColor, hexAlpha } from './utils.js';

const POOL_SIZE = 30;

const SCROLL_SPEED      = 100;   // px/s downward drift
const SWAY_AMPLITUDE    = 25;    // px horizontal sway
const SWAY_FREQUENCY    = 1.2;   // Hz
const MAGNET_RADIUS     = 90;    // px — always-on attraction toward player
const MAGNET_STRENGTH   = 800;   // px/s² pull at center
const PICKUP_PADDING    = 4;     // grab radius beyond visual

function makePowerup() {
  return {
    alive: false,
    typeId: null,
    typeDef: null,
    x: 0, y: 0,
    vx: 0, vy: 0,
    age: 0,
    spawnX: 0,           // for sway anchor
  };
}

export const powerupsSystem = {
  id: 'powerups',
  priority: 65,         // renders above player/projectiles, below enemies/particles
  phases: [PHASES.PLAYING, PHASES.PAUSED, PHASES.BOSS_FIGHT, PHASES.BOSS_WARNING],

  init(gs) {
    const pool = createPool(POOL_SIZE, makePowerup);

    gs.powerups = {
      pool,

      spawn({ typeId, x, y }) {
        const def = gs.data?.powerups?.powerups?.[typeId];
        if (!def) {
          console.warn(`[Powerups] Unknown type "${typeId}"`);
          return null;
        }
        const pu = pool.acquire();
        if (!pu) return null;
        pu.alive = true;
        pu.typeId = typeId;
        pu.typeDef = def;
        pu.x = x; pu.y = y;
        pu.vx = 0;
        pu.vy = SCROLL_SPEED;
        pu.age = 0;
        pu.spawnX = x;
        return pu;
      },

      forEachAlive(fn) { pool.forEachAlive(fn); },
      countAlive()     { return pool.countAlive(); },
      clear()          { pool.clear(); },
    };
  },

  onExitPhase(gs, fromPhase, toPhase) {
    if (toPhase === PHASES.MENU || toPhase === PHASES.GAME_OVER) {
      gs.powerups.clear();
    }
  },

  update(gs, dt) {
    if (gs.phase === PHASES.PAUSED) return;
    const player = gs.player;
    const h = gs.fieldH;
    const w = gs.fieldW;

    gs.powerups.forEachAlive((pu) => {
      pu.age += dt;

      // ---- Movement: scroll + sway, with magnet pull if near player ----
      if (player) {
        const dx = player.x - pu.x;
        const dy = player.y - pu.y;
        const dist = Math.hypot(dx, dy);
        if (dist < MAGNET_RADIUS && dist > 0.5) {
          // Closer = stronger pull
          const strength = MAGNET_STRENGTH * (1 - dist / MAGNET_RADIUS);
          pu.vx += (dx / dist) * strength * dt;
          pu.vy += (dy / dist) * strength * dt;
        } else {
          // Drift downward with sway, gently push velocity back toward defaults
          const targetVx = Math.sin(pu.age * Math.PI * 2 * SWAY_FREQUENCY) * SWAY_AMPLITUDE;
          pu.vx += (targetVx - pu.vx) * 3 * dt;
          pu.vy += (SCROLL_SPEED - pu.vy) * 2 * dt;
        }
      }

      pu.x += pu.vx * dt;
      pu.y += pu.vy * dt;

      // ---- Cull when off-screen bottom ----
      if (pu.y - pu.typeDef.size > h + 30) {
        gs.powerups.pool.release(pu);
        return;
      }
      // Soft horizontal clamp so magnetized powerups don't escape sideways
      if (pu.x < -30 || pu.x > w + 30) {
        gs.powerups.pool.release(pu);
        return;
      }

      // ---- Collection ----
      if (player &&
          circleHit(pu.x, pu.y, pu.typeDef.size + PICKUP_PADDING,
                    player.x, player.y, player.radius)) {
        collectPowerup(gs, pu);
      }
    });
  },

  render(gs, dt) {
    const { ctx } = gs;
    gs.powerups.forEachAlive((pu) => {
      drawPowerup(ctx, gs, pu);
    });
  },
};

// ============================================================
// Rendering
// ============================================================

function drawPowerup(ctx, gs, pu) {
  const def = pu.typeDef;
  const color = resolveColor(gs, def.color);
  const glow = resolveColor(gs, def.glowColor || def.color);
  const r = def.size;

  // Pulsing scale
  const pulse = 1 + 0.08 * Math.sin(pu.age * 4);
  const ringR = r * pulse;

  ctx.save();
  ctx.translate(pu.x, pu.y);
  ctx.rotate(pu.age * 0.6);

  // Outer halo (additive feel via large blur)
  ctx.shadowColor = glow;
  ctx.shadowBlur = 22;
  ctx.fillStyle = hexAlpha(glow, 0.18);
  ctx.beginPath();
  ctx.arc(0, 0, ringR * 1.4, 0, Math.PI * 2);
  ctx.fill();

  // Solid disc
  ctx.shadowBlur = 14;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();

  // Dark inner ring
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();

  // Icon character (NOT rotated, sits upright)
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.round(r * 1.3)}px VT323, monospace`;
  ctx.shadowColor = '#000';
  ctx.shadowBlur = 4;
  ctx.fillText(def.icon || '?', pu.x, pu.y + 1);
  ctx.restore();
}

// ============================================================
// Collection / effect dispatch
// ============================================================

function collectPowerup(gs, pu) {
  const def = pu.typeDef;
  const p = gs.player;

  // Visual + audio
  gs.particles.burst({
    x: pu.x, y: pu.y,
    count: 14,
    speedMin: 80, speedMax: 240,
    lifetime: 0.55,
    size: 3,
    color: resolveColor(gs, def.color),
    glow: 14,
  });
  gs.audio?.play('pickup');

  // Dispatch by type
  switch (def.type) {

    case 'weapon': {
      if (def.weaponId && gs.data.weapons.weapons[def.weaponId]) {
        p.weaponId = def.weaponId;
      }
      break;
    }

    case 'modifier': {
      applyModifier(gs, def);
      break;
    }

    case 'passive': {
      applyPassive(gs, def);
      break;
    }

    default:
      console.warn(`[Powerups] Unknown type "${def.type}" on "${pu.typeId}"`);
  }

  // Bonus score for grabbing
  p.score += 25;

  gs.powerups.pool.release(pu);
}

function applyModifier(gs, def) {
  const p = gs.player;
  const id = def.modifier;
  if (!id) return;

  switch (id) {
    case 'shield_bubble':
      // One-shot absorb, no timer
      p.modifiers.shield_bubble = true;
      break;
    case 'speed_boost':
    case 'damage_up':
    case 'score_multiplier':
      // Set timer (stacks by taking the larger remaining time)
      p.modifiers[id] = Math.max(p.modifiers[id], def.duration ?? 5);
      break;
    default:
      console.warn(`[Powerups] Unknown modifier "${id}"`);
  }
}

function applyPassive(gs, def) {
  const p = gs.player;
  switch (def.effect) {
    case 'heal':
      p.hp = Math.min(p.maxHp, p.hp + (def.amount ?? 1));
      break;
    case 'extra_life':
      p.lives += (def.amount ?? 1);
      break;
    case 'shield_recharge':
      p.modifiers.shield_bubble = true;
      break;
    default:
      console.warn(`[Powerups] Unknown passive effect "${def.effect}"`);
  }
}
