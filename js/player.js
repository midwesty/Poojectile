// ============================================================
// POOJECTILE — player.js
//
// The player entity. State lives on gs.player. Input is read
// from gs.input, projectiles spawned via gs.projectiles.spawn(),
// weapon definitions from gs.data.weapons.
//
// Movement model:
//   - Both input modes (keyboard, touch) produce a TARGET
//     velocity. Current velocity accelerates toward target at
//     player.accelerationFrames pace. This unifies feel.
//   - Touch (drag-to-move): target = (pointer + offset),
//     velocity = (target - pos) * stiffness, capped at maxSpeed.
//   - Keyboard: target = inputVec * maxSpeed, diagonals normalized.
//
// Visual: asymmetric organic blob with two glowing eyes and a
// bioluminescent residue trail. Wobble + tilt based on velocity.
// ============================================================

import { PHASES } from './engine.js';
import { clamp, dampLerp, hexAlpha, resolveColor } from './utils.js';

// ------ Tuning constants (most read from config, some fixed) ------
const TOUCH_STIFFNESS    = 14;   // higher = snappier follow
const FRICTION_PER_SEC   = 0.0001; // when no input on keyboard (very fast decay)
const TILT_PER_VX        = 0.0008; // visual lean per px/s of horizontal velocity
const TRAIL_LENGTH       = 10;     // history frames in trail
const TRAIL_SPACING_FRAMES = 1;    // sample trail every N frames

// ============================================================
// SYSTEM
// ============================================================

export const playerSystem = {
  id: 'player',
  priority: 50,         // renders below projectiles so bullets appear "in front"
  phases: [PHASES.PLAYING, PHASES.BOSS_FIGHT, PHASES.BOSS_WARNING, PHASES.PAUSED],

  init(gs) {
    const pcfg = gs.config.player;
    gs.player = {
      // position & motion
      x: gs.fieldW * pcfg.startingX,
      y: gs.fieldH * pcfg.startingY,
      vx: 0, vy: 0,
      tx: 0, ty: 0,     // last touch target (for visual debug)

      // visual
      radius: pcfg.visualRadius,
      hitRadius: pcfg.hitboxRadius,
      tilt: 0,
      breathPhase: Math.random() * Math.PI * 2,
      trail: new Array(TRAIL_LENGTH).fill(null),
      trailHead: 0,
      _sampleCounter: 0,
      // Deterministic bumps for the body — generated once so the
      // blob doesn't crawl every frame
      bumps: makeBumps(),

      // gameplay
      hp: 3,
      maxHp: 3,
      lives: getDifficultyStartingLives(gs),
      score: 0,
      bombs: 2,
      iFrames: 0,        // seconds of invincibility remaining
      fireCooldown: 0,   // seconds until next shot

      // weapon
      weaponId: gs.data?.weapons?.defaultWeapon || 'basic',
    };
  },

  onEnterPhase(gs, fromPhase, toPhase) {
    const p = gs.player;
    const pcfg = gs.config.player;

    // PREGAME entry = full reset. This is the canonical "new run starts" hook.
    if (toPhase === PHASES.PREGAME) {
      p.hp = p.maxHp;
      p.lives = getDifficultyStartingLives(gs);
      p.score = 0;
      p.bombs = 2;
      p.x = gs.fieldW * pcfg.startingX;
      p.y = gs.fieldH * pcfg.startingY;
      p.vx = 0; p.vy = 0;
      p.iFrames = 0;
      p.fireCooldown = 0;
      for (let i = 0; i < p.trail.length; i++) p.trail[i] = null;
      return;
    }

    // Entering PLAYING from PREGAME = grant brief i-frames as a grace period
    if (toPhase === PHASES.PLAYING && fromPhase === PHASES.PREGAME) {
      p.iFrames = pcfg.invincibilityFramesOnRespawn / 60;
    }
  },

  update(gs, dt) {
    if (gs.phase === PHASES.PAUSED) return;
    const p = gs.player;
    const cfg = gs.config.player;
    const input = gs.input;

    // ---------- Movement intent ----------
    let targetVx = 0, targetVy = 0;

    const usingTouch = input.pointer.type === 'touch' && input.pointer.down;
    if (usingTouch) {
      // Drag-to-move: float ABOVE the finger so it doesn't occlude
      const targetX = clamp(input.pointer.x, cfg.visualRadius, gs.fieldW - cfg.visualRadius);
      const targetY = clamp(
        input.pointer.y + gs.config.input.mobileDragOffsetY,
        cfg.visualRadius, gs.fieldH - cfg.visualRadius
      );
      p.tx = targetX; p.ty = targetY;
      targetVx = clamp((targetX - p.x) * TOUCH_STIFFNESS, -cfg.maxSpeed, cfg.maxSpeed);
      targetVy = clamp((targetY - p.y) * TOUCH_STIFFNESS, -cfg.maxSpeed, cfg.maxSpeed);
    } else {
      // Keyboard
      const v = input.getKeyboardMoveVector();
      targetVx = v.x * cfg.maxSpeed;
      targetVy = v.y * cfg.maxSpeed;
    }

    // ---------- Velocity smoothing (constant acceleration) ----------
    // Reach maxSpeed in exactly accelerationFrames @ 60fps
    const accel = cfg.maxSpeed / (cfg.accelerationFrames / 60);
    p.vx = approach(p.vx, targetVx, accel * dt);
    p.vy = approach(p.vy, targetVy, accel * dt);

    // No-input friction (only for keyboard mode when no keys held)
    if (!usingTouch && targetVx === 0 && targetVy === 0) {
      p.vx = dampLerp(p.vx, 0, 1 - FRICTION_PER_SEC, dt);
      p.vy = dampLerp(p.vy, 0, 1 - FRICTION_PER_SEC, dt);
    }

    // ---------- Position update + hard clamp to field ----------
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    const minX = cfg.visualRadius;
    const maxX = gs.fieldW - cfg.visualRadius;
    const minY = cfg.visualRadius;
    const maxY = gs.fieldH - cfg.visualRadius;
    if (p.x < minX) { p.x = minX; p.vx = Math.max(0, p.vx); }
    if (p.x > maxX) { p.x = maxX; p.vx = Math.min(0, p.vx); }
    if (p.y < minY) { p.y = minY; p.vy = Math.max(0, p.vy); }
    if (p.y > maxY) { p.y = maxY; p.vy = Math.min(0, p.vy); }

    // ---------- Visual state ----------
    p.tilt = dampLerp(p.tilt, p.vx * TILT_PER_VX, 0.85, dt);
    p.breathPhase += dt * 2.5;

    // Trail sampling
    p._sampleCounter++;
    if (p._sampleCounter >= TRAIL_SPACING_FRAMES) {
      p._sampleCounter = 0;
      p.trail[p.trailHead] = { x: p.x, y: p.y };
      p.trailHead = (p.trailHead + 1) % p.trail.length;
    }

    // i-frames
    if (p.iFrames > 0) p.iFrames = Math.max(0, p.iFrames - dt);

    // ---------- Firing ----------
    p.fireCooldown -= dt;
    const firing = shouldFire(gs);
    if (firing && p.fireCooldown <= 0) {
      fireWeapon(gs);
    }
  },

  render(gs, dt) {
    const p = gs.player;
    const palette = gs.config.palette;
    const ctx = gs.ctx;

    // ---------- Trail ----------
    // Iterate from oldest to newest. Older = smaller, more transparent, more green.
    const len = p.trail.length;
    for (let i = 1; i <= len; i++) {
      const idx = (p.trailHead + i) % len;
      const point = p.trail[idx];
      if (!point) continue;
      const age = (len - i) / len; // 0 = newest, 1 = oldest
      const alpha = (1 - age) * 0.35;
      const r = p.radius * (1 - age * 0.5);

      ctx.save();
      ctx.fillStyle = hexAlpha(resolveColor(gs, palette.toxicGreen), alpha);
      ctx.shadowColor = resolveColor(gs, palette.toxicGreen);
      ctx.shadowBlur = 6 * (1 - age);
      ctx.beginPath();
      ctx.ellipse(point.x, point.y + r * 0.3, r * 0.7, r * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ---------- Flicker during i-frames ----------
    if (p.iFrames > 0) {
      // Flicker every ~80ms
      const blink = Math.floor(p.iFrames * 12) % 2;
      if (blink === 0) return; // skip this frame's player draw
    }

    // ---------- Body ----------
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.tilt);

    const breath = 1 + 0.05 * Math.sin(p.breathPhase);
    const r = p.radius * breath;

    // Outer halo (subtle glow, organic damp)
    const halo = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 1.8);
    halo.addColorStop(0, hexAlpha('#3a2a1a', 0.0));
    halo.addColorStop(0.7, hexAlpha('#3a2a1a', 0.4));
    halo.addColorStop(1, hexAlpha('#3a2a1a', 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.8, 0, Math.PI * 2);
    ctx.fill();

    // Main body — gradient fill
    const bodyGrad = ctx.createRadialGradient(-r * 0.3, -r * 0.4, 0, 0, 0, r);
    bodyGrad.addColorStop(0, '#5c4a35');
    bodyGrad.addColorStop(0.6, '#3a2818');
    bodyGrad.addColorStop(1, '#1a0e08');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.05, r * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();

    // Asymmetric bumps
    for (const b of p.bumps) {
      const wobble = 1 + 0.08 * Math.sin(p.breathPhase * 1.4 + b.phase);
      const bx = b.x * r;
      const by = b.y * r;
      const br = b.r * r * wobble;
      const bumpGrad = ctx.createRadialGradient(bx - br * 0.3, by - br * 0.4, 0, bx, by, br);
      bumpGrad.addColorStop(0, '#6b5640');
      bumpGrad.addColorStop(1, '#2a1c10');
      ctx.fillStyle = bumpGrad;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fill();
    }

    // Wet shine highlight (subtle)
    ctx.fillStyle = hexAlpha('#a0c98c', 0.18);
    ctx.beginPath();
    ctx.ellipse(-r * 0.35, -r * 0.45, r * 0.35, r * 0.15, -0.4, 0, Math.PI * 2);
    ctx.fill();

    // ---------- Eyes ----------
    // Eyes look slightly in direction of velocity
    const vmag = Math.hypot(p.vx, p.vy);
    const lookX = vmag > 5 ? (p.vx / vmag) * 1.5 : 0;
    const lookY = vmag > 5 ? (p.vy / vmag) * 1.5 : -0.5; // default look slightly forward (up)
    const eyeOffsetX = r * 0.32;
    const eyeOffsetY = -r * 0.2;
    const eyeR = r * 0.16;

    for (const sign of [-1, 1]) {
      const ex = sign * eyeOffsetX;
      const ey = eyeOffsetY;
      // Glow
      ctx.save();
      ctx.shadowColor = resolveColor(gs, palette.toxicGreen);
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#fff2c4';
      ctx.beginPath();
      ctx.arc(ex, ey, eyeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // Pupil (looks in direction of motion)
      ctx.fillStyle = '#1a1208';
      ctx.beginPath();
      ctx.arc(ex + lookX, ey + lookY, eyeR * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // ---------- Debug hitbox ----------
    if (gs.config.debug.showHitboxes) {
      ctx.save();
      ctx.strokeStyle = palette.bloodRed;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.hitRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  },
};

// ============================================================
// Firing
// ============================================================

function shouldFire(gs) {
  const input = gs.input;
  // Touch fires while finger is down (auto-fire on mobile by design)
  if (input.pointer.type === 'touch' && input.pointer.down) return true;
  // Auto-fire from config: any directional movement OR fire-key fires
  if (gs.config.input.autoFire && (input.action('fire') || hasAnyKeyboardMovement(input))) {
    return input.action('fire');
  }
  // Manual mode (autoFire off): only fire key
  return input.action('fire');
}

function hasAnyKeyboardMovement(input) {
  const v = input.getKeyboardMoveVector();
  return v.x !== 0 || v.y !== 0;
}

function fireWeapon(gs) {
  const p = gs.player;
  const weapon = gs.data.weapons.weapons[p.weaponId];
  if (!weapon) return;

  const proj = gs.data.weapons.projectiles[weapon.projectileType];
  if (!proj) return;

  const count = weapon.spawnCount ?? 1;
  const spread = weapon.spread ?? 0;
  const baseAngle = -Math.PI / 2; // upward

  for (let i = 0; i < count; i++) {
    // Even spread across (-spread/2 .. +spread/2)
    const t = count === 1 ? 0 : (i / (count - 1)) - 0.5;
    const angle = baseAngle + t * spread;
    const vx = Math.cos(angle) * proj.speed;
    const vy = Math.sin(angle) * proj.speed;
    // Spawn just above the player so the muzzle flash reads
    const spawnY = p.y - p.radius * 0.6;
    gs.projectiles.spawn({
      typeId: weapon.projectileType,
      x: p.x,
      y: spawnY,
      vx, vy,
      damage: weapon.damage ?? 1,
      owner: 'player',
    });
  }

  p.fireCooldown = (weapon.fireRateMs ?? 140) / 1000;
  gs.audio?.play('fire');
}

// ============================================================
// Helpers
// ============================================================

function approach(current, target, maxDelta) {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}

function makeBumps() {
  // Deterministic-looking asymmetric bump positions, in body-radius units.
  return [
    { x: -0.45, y: -0.15, r: 0.35, phase: 0.0 },
    { x:  0.50, y:  0.10, r: 0.30, phase: 1.2 },
    { x:  0.10, y:  0.55, r: 0.40, phase: 2.4 },
    { x: -0.30, y:  0.50, r: 0.28, phase: 3.6 },
  ];
}

function getDifficultyStartingLives(gs) {
  return gs.config.difficulty[gs.difficulty]?.startingLives
    ?? gs.config.difficulty.normal.startingLives;
}
