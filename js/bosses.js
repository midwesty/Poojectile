// ============================================================
// POOJECTILE — bosses.js
//
// Single-boss system (one boss active at a time, lives on gs.boss).
// Bosses have:
//   - Multi-phase state machine driven by hpThreshold in data
//   - Phase-specific movement, damage scaling, contact damage
//   - Optional weak point in later phases (rendering + double damage)
//   - Multi-second death sequence with cascading explosions
//
// Spawn: gs.bosses.spawn(typeId, x, y)
// Despawn: handled internally after death sequence -> LEVEL_COMPLETE
// ============================================================

import { PHASES, transitionTo } from './engine.js';
import { circleHit, dampLerp, resolveColor, hexAlpha } from './utils.js';

const VERTEX_COUNT = 16;       // bigger silhouette than regular asteroids
const CRACK_COUNT = 7;          // visible cracks in exposed phase
const CORE_PULSE_RATE = 4;      // Hz of weak-point pulse

function makeBoss() {
  const vertices = new Array(VERTEX_COUNT);
  for (let i = 0; i < VERTEX_COUNT; i++) vertices[i] = { r: 1, theta: 0 };
  const cracks = new Array(CRACK_COUNT);
  for (let i = 0; i < CRACK_COUNT; i++) {
    cracks[i] = { startA: 0, endA: 0, startR: 0, endR: 0 };
  }
  return {
    alive: false,
    typeId: null,
    typeDef: null,
    displayName: '',
    name: '',
    x: 0, y: 0,
    vx: 0, vy: 0,
    hp: 1,
    maxHp: 1,
    size: 60,
    age: 0,
    rotation: 0,
    flashTime: 0,
    phaseIndex: 0,
    phaseDef: null,
    phaseTime: 0,
    vertices,
    cracks,
    // Death sequence
    dying: false,
    deathTimer: 0,
    deathDuration: 4.5,
    nextDeathExplosionAt: 0,
  };
}

export const bossesSystem = {
  id: 'bosses',
  priority: 75,   // between enemies (70) and particles (80)
  phases: [PHASES.BOSS_FIGHT, PHASES.PAUSED],

  init(gs) {
    const boss = makeBoss();
    // gs.boss is the live boss object (still has alive=false until spawn)
    gs.boss = null;
    gs._bossSlot = boss;   // private singleton slot

    gs.bosses = {
      spawn(typeId, x, y) {
        const def = gs.data?.bosses?.bosses?.[typeId];
        if (!def) {
          console.warn(`[Bosses] Unknown boss type "${typeId}"`);
          return null;
        }
        if (!def.phases?.length) {
          console.warn(`[Bosses] Boss "${typeId}" has no phases`);
          return null;
        }
        const b = gs._bossSlot;

        // Apply difficulty multipliers
        const diff = gs.config.difficulty[gs.difficulty] || gs.config.difficulty.normal;
        const hp = Math.max(10, Math.round(def.maxHp * (diff.enemyHpMultiplier ?? 1)));

        b.alive = true;
        b.typeId = typeId;
        b.typeDef = def;
        b.displayName = def.displayName || typeId;
        b.name = def.internalName || typeId;
        b.x = x;
        b.y = y;
        b.vx = 0; b.vy = 0;
        b.hp = hp;
        b.maxHp = hp;
        b.size = def.size;
        b.age = 0;
        b.rotation = 0;
        b.flashTime = 0;
        b.phaseIndex = 0;
        b.phaseDef = def.phases[0];
        b.phaseTime = 0;
        b.dying = false;
        b.deathTimer = 0;
        b.deathDuration = def.deathDuration ?? 4.5;
        b.nextDeathExplosionAt = 0;

        // Randomize silhouette
        for (let i = 0; i < VERTEX_COUNT; i++) {
          b.vertices[i].r = 0.82 + Math.random() * 0.3;
          b.vertices[i].theta = (Math.PI * 2 * i) / VERTEX_COUNT
                              + (Math.random() - 0.5) * 0.18;
        }
        // Randomize crack positions
        for (let i = 0; i < CRACK_COUNT; i++) {
          const a = Math.random() * Math.PI * 2;
          b.cracks[i].startA = a;
          b.cracks[i].endA   = a + (Math.random() - 0.5) * 0.8;
          b.cracks[i].startR = 0.15 + Math.random() * 0.25;
          b.cracks[i].endR   = 0.7 + Math.random() * 0.25;
        }

        gs.boss = b;
        return b;
      },

      clear() {
        if (gs._bossSlot) gs._bossSlot.alive = false;
        gs.boss = null;
      },
    };
  },

  onExitPhase(gs, fromPhase, toPhase) {
    if (toPhase === PHASES.MENU || toPhase === PHASES.GAME_OVER) {
      gs.bosses.clear();
    }
  },

  update(gs, dt) {
    if (gs.phase === PHASES.PAUSED) return;
    const b = gs.boss;
    if (!b || !b.alive) return;

    b.age += dt;
    b.phaseTime += dt;
    b.rotation += (b.phaseDef.rotationSpeed ?? 0.5) * dt;
    if (b.flashTime > 0) b.flashTime = Math.max(0, b.flashTime - dt);

    if (b.dying) {
      updateDeathSequence(gs, b, dt);
      return;
    }

    // ---- Movement (phase-driven) ----
    updateBossMovement(b, gs, dt);

    // ---- Collisions ----
    runBossCollisions(gs, b);

    // ---- Phase transitions ----
    const phases = b.typeDef.phases;
    const next = phases[b.phaseIndex + 1];
    if (next && (b.hp / b.maxHp) <= next.hpThreshold) {
      advancePhase(gs, b);
    }
  },

  render(gs, dt) {
    const b = gs.boss;
    if (!b || !b.alive) return;
    renderBoss(gs, b);
  },
};

// ============================================================
// Movement
// ============================================================

function updateBossMovement(b, gs, dt) {
  const p = b.phaseDef;
  const anchorY = p.anchorY ?? 180;
  const amp = p.moveAmplitude ?? 120;
  const freq = p.moveFrequency ?? 0.5;

  switch (p.movePattern) {
    case 'sine_slow': {
      const cx = gs.fieldW / 2;
      b.x = cx + Math.sin(b.age * freq * Math.PI * 2) * amp;
      // Approach anchorY
      b.y = dampLerp(b.y, anchorY, 0.92, dt);
      break;
    }

    case 'erratic_drift': {
      // Two layered sines + slow drift toward player.x
      const cx = gs.fieldW / 2;
      const player = gs.player;
      const targetCx = player ? cx * 0.5 + player.x * 0.5 : cx;
      b._anchorCx = b._anchorCx === undefined ? cx : dampLerp(b._anchorCx, targetCx, 0.3, dt);
      const wob = Math.sin(b.age * freq * Math.PI * 2) * amp
                + Math.sin(b.age * freq * Math.PI * 5.3) * amp * 0.3;
      b.x = b._anchorCx + wob;
      // Vertical bob
      b.y = anchorY + Math.sin(b.age * 0.8) * 30;
      break;
    }

    default: {
      // stationary
      b.y = dampLerp(b.y, anchorY, 0.9, dt);
      break;
    }
  }

  // Soft clamp inside playfield
  const margin = b.size * 0.7;
  if (b.x < margin) b.x = margin;
  if (b.x > gs.fieldW - margin) b.x = gs.fieldW - margin;
}

// ============================================================
// Collisions
// ============================================================

function runBossCollisions(gs, b) {
  const dmgMulti = b.phaseDef.damageTakenMultiplier ?? 1.0;
  const exposed = b.phaseIndex > 0;
  const coreR = b.size * 0.25;   // weak point radius (in exposed phase)
  const coreBonusMulti = 1.8;    // weak-point hits do extra damage

  // ----- Player projectiles -----
  gs.projectiles.forEachAlive((p) => {
    if (p.owner !== 'player') return;
    if (!circleHit(p.x, p.y, p.typeDef.size, b.x, b.y, b.size)) return;

    // Weak point check (exposed phase only)
    const onCore = exposed && circleHit(p.x, p.y, p.typeDef.size, b.x, b.y, coreR);

    const damage = p.damage * dmgMulti * (onCore ? coreBonusMulti : 1);
    b.hp -= damage;
    b.flashTime = onCore ? 0.18 : 0.10;

    // Sparks at hit
    gs.particles.burst({
      x: p.x, y: p.y,
      count: onCore ? 8 : 4,
      speedMin: 80, speedMax: 240,
      lifetime: 0.3,
      size: 2,
      color: onCore ? '#ff3b3b' : resolveColor(gs, p.typeDef.color),
      glow: onCore ? 14 : 8,
    });
    gs.audio?.play('hit');

    gs.projectiles.pool.release(p);

    if (b.hp <= 0) startBossDeath(gs, b);
  });

  // ----- Player contact damage -----
  if (gs.player && gs.player.iFrames <= 0) {
    if (circleHit(b.x, b.y, b.size * 0.85, gs.player.x, gs.player.y, gs.player.hitRadius)) {
      // Damage player (bosses.js can't import enemies.js's damagePlayer cleanly,
      // so we use the same path: trigger a fake-enemy contact via gs.applyContactDamage)
      // Simpler: inline the same logic since damagePlayer is small.
      damagePlayerFromBoss(gs, b.phaseDef.contactDamage ?? 2);
    }
  }
}

function damagePlayerFromBoss(gs, amount) {
  const p = gs.player;
  // Shield absorb
  if (p.modifiers.shield_bubble) {
    p.modifiers.shield_bubble = false;
    p.iFrames = gs.config.player.invincibilityFramesOnRespawn / 60;
    gs.audio?.play('shieldBreak');
    gs.particles.burst({
      x: p.x, y: p.y,
      count: 22, speedMin: 120, speedMax: 320,
      lifetime: 0.6, size: 2.5, color: '#4af2ff', glow: 16,
    });
    return;
  }
  p.hp -= amount;
  p.iFrames = gs.config.player.invincibilityFramesOnRespawn / 60;
  gs.audio?.play('damage');
  gs.particles.burst({
    x: p.x, y: p.y,
    count: 14, speedMin: 80, speedMax: 240,
    lifetime: 0.55, size: 3, color: gs.config.palette.bloodRed, glow: 12,
  });
  if (p.hp <= 0) {
    p.lives -= 1;
    if (p.lives > 0) {
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

// ============================================================
// Phase transitions
// ============================================================

function advancePhase(gs, b) {
  b.phaseIndex++;
  b.phaseDef = b.typeDef.phases[b.phaseIndex];
  b.phaseTime = 0;

  // "Crack open" effect
  gs.particles.burst({
    x: b.x, y: b.y,
    count: 28, speedMin: 80, speedMax: 320,
    lifetime: 0.8, size: 4,
    color: '#ff3b3b', glow: 14,
  });
  gs.particles.burst({
    x: b.x, y: b.y,
    count: 22, speedMin: 40, speedMax: 200,
    lifetime: 0.9, size: 5,
    color: b.typeDef.color, glow: 6,
  });
  gs.audio?.play('explosionMedium');
  triggerShake(gs, 14, 0.45);
}

// ============================================================
// Death sequence
// ============================================================

function startBossDeath(gs, b) {
  b.dying = true;
  b.deathTimer = 0;
  b.nextDeathExplosionAt = 0;
  b.hp = 0;
  triggerShake(gs, 8, 0.3);
}

function updateDeathSequence(gs, b, dt) {
  b.deathTimer += dt;

  // Cascading small/medium explosions across the body
  if (b.deathTimer >= b.nextDeathExplosionAt) {
    b.nextDeathExplosionAt = b.deathTimer + (0.07 + Math.random() * 0.12);
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * b.size * 0.8;
    const ex = b.x + Math.cos(angle) * dist;
    const ey = b.y + Math.sin(angle) * dist;
    const big = Math.random() < 0.35;
    gs.particles.burst({
      x: ex, y: ey,
      count: big ? 22 : 12,
      speedMin: 60, speedMax: big ? 320 : 220,
      lifetime: big ? 0.7 : 0.5,
      size: big ? 4 : 3,
      color: big ? '#ffaa55' : b.typeDef.accentColor,
      glow: big ? 14 : 8,
    });
    if (big) {
      gs.audio?.play('explosionSmall');
      triggerShake(gs, 4, 0.12);
    }
  }

  // Final huge blast at the end
  if (b.deathTimer >= b.deathDuration) {
    finalBossExplosion(gs, b);
  }
}

function finalBossExplosion(gs, b) {
  // Big bang
  gs.particles.burst({
    x: b.x, y: b.y,
    count: 60, speedMin: 200, speedMax: 600,
    lifetime: 1.2, size: 6,
    color: '#ffaa55', glow: 24,
  });
  gs.particles.burst({
    x: b.x, y: b.y,
    count: 40, speedMin: 100, speedMax: 400,
    lifetime: 1.4, size: 5,
    color: gs.config.palette.bloodRed, glow: 18,
  });
  gs.audio?.play('explosionLarge');
  triggerShake(gs, 22, 0.7);

  // Award score
  const diff = gs.config.difficulty[gs.difficulty] || gs.config.difficulty.normal;
  const scoreMulti = gs.player.modifiers.score_multiplier > 0 ? 2 : 1;
  const scoreGain = Math.round((b.typeDef.scoreValue ?? 0) * (diff.scoreMultiplier ?? 1) * scoreMulti);
  gs.player.score += scoreGain;
  gs._bossScoreGain = scoreGain;     // for level complete display

  // Clear the boss
  gs.bosses.clear();

  // Transition to level complete
  transitionTo(gs.engine, PHASES.LEVEL_COMPLETE);
}

// ============================================================
// Rendering
// ============================================================

function renderBoss(gs, b) {
  const ctx = gs.ctx;
  const palette = gs.config.palette;
  const exposed = b.phaseIndex > 0;

  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.rotation);

  // Outer silhouette path
  ctx.beginPath();
  for (let i = 0; i < VERTEX_COUNT; i++) {
    const v = b.vertices[i];
    const r = b.size * v.r;
    const x = Math.cos(v.theta) * r;
    const y = Math.sin(v.theta) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();

  // Body fill
  const grad = ctx.createRadialGradient(-b.size * 0.3, -b.size * 0.3, 0, 0, 0, b.size);
  grad.addColorStop(0, lighten(b.typeDef.color, 0.2));
  grad.addColorStop(1, b.typeDef.accentColor);
  ctx.fillStyle = grad;
  ctx.fill();

  // Edge stroke
  ctx.strokeStyle = b.typeDef.accentColor;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Surface texture craters
  ctx.fillStyle = b.typeDef.accentColor;
  for (let i = 0; i < 5; i++) {
    const ang = i * (Math.PI * 2 / 5) + 0.4;
    const cx = Math.cos(ang) * b.size * 0.4;
    const cy = Math.sin(ang) * b.size * 0.4;
    const cr = b.size * (0.10 + (i % 3) * 0.04);
    ctx.beginPath();
    ctx.arc(cx, cy, cr, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- Exposed phase: cracks + glowing core ----
  if (exposed) {
    // Red cracks emanating from center
    ctx.strokeStyle = b.typeDef.coreColor || '#ff3b3b';
    ctx.shadowColor = b.typeDef.coreColor || '#ff3b3b';
    ctx.shadowBlur = 8;
    ctx.lineWidth = 3;
    for (const cr of b.cracks) {
      const x1 = Math.cos(cr.startA) * b.size * cr.startR;
      const y1 = Math.sin(cr.startA) * b.size * cr.startR;
      const x2 = Math.cos(cr.endA)   * b.size * cr.endR;
      const y2 = Math.sin(cr.endA)   * b.size * cr.endR;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Pulsing core
    const corePulse = 0.85 + 0.15 * Math.sin(b.age * CORE_PULSE_RATE * Math.PI * 2);
    const coreR = b.size * 0.25 * corePulse;
    ctx.shadowBlur = 28 * corePulse;
    const coreColor = b.typeDef.coreColor || '#ff3b3b';
    ctx.fillStyle = coreColor;
    ctx.beginPath();
    ctx.arc(0, 0, coreR, 0, Math.PI * 2);
    ctx.fill();
    // White hot spot
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, coreR * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';
  }

  // Hit flash overlay
  if (b.flashTime > 0) {
    const a = Math.min(1, b.flashTime * 6);
    ctx.fillStyle = `rgba(255, 255, 255, ${a * 0.55})`;
    ctx.beginPath();
    for (let i = 0; i < VERTEX_COUNT; i++) {
      const v = b.vertices[i];
      const r = b.size * v.r;
      const x = Math.cos(v.theta) * r;
      const y = Math.sin(v.theta) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();

  // Hitbox debug
  if (gs.config.debug.showHitboxes) {
    ctx.save();
    ctx.strokeStyle = '#ff3b3b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.size * 0.85, 0, Math.PI * 2);
    ctx.stroke();
    if (exposed) {
      ctx.strokeStyle = '#ffff00';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.size * 0.25, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ============================================================
// Helpers
// ============================================================

function lighten(hex, amount) {
  if (!hex || !hex.startsWith('#') || hex.length !== 7) return hex;
  const r = Math.min(255, Math.round(parseInt(hex.slice(1, 3), 16) + 255 * amount));
  const g = Math.min(255, Math.round(parseInt(hex.slice(3, 5), 16) + 255 * amount));
  const b = Math.min(255, Math.round(parseInt(hex.slice(5, 7), 16) + 255 * amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function triggerShake(gs, intensity, duration) {
  if (gs.shake) gs.shake(intensity, duration);
}
