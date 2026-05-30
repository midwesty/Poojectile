// ============================================================
// POOJECTILE — hud.js
//
// The chunky-arcade heads-up display. Renders on top of the
// playfield during gameplay phases. Owns:
//
//   - Lives row (mini blobs)
//   - HP segments (discrete arcade-style bar)
//   - Score (with catch-up tick animation)
//   - Multiplier badge (when score_multiplier is active)
//   - Active modifier ring badges with countdown arcs
//   - Weapon icon + name
//   - Bomb count + icon
//   - Boss health bar (conditional on gs.boss being set; ready for Step 8)
//   - Wave / level indicator (conditional on gs.level; ready for Step 10)
//   - Pause overlay (moved here from playingSystem)
//
// This is purely rendering; gameplay logic stays in player.js / enemies.js.
// ============================================================

import { PHASES } from './engine.js';
import { hexAlpha, resolveColor } from './utils.js';

// ----- Layout constants -----
const SIDE_MARGIN = 12;

// Top-left lives row
const LIVES_X        = SIDE_MARGIN;
const LIVES_Y        = 18;
const LIVES_SPACING  = 18;
const LIVES_BLOB_R   = 7;

// HP segments below lives
const HP_X           = SIDE_MARGIN;
const HP_Y           = 38;
const HP_SEG_W       = 16;
const HP_SEG_H       = 20;
const HP_SEG_GAP     = 3;

// Score (top-right, well below the 48px close button)
const SCORE_RIGHT    = SIDE_MARGIN;
const SCORE_LABEL_Y  = 56;
const SCORE_VALUE_Y  = 70;

// Modifier strip — sits just above the bottom bar
const MOD_BADGE_R    = 18;
const MOD_BADGE_GAP  = 14;

// Bottom bar
const BOTTOM_STRIP_H = 70;       // tall enough to host modifiers + weapon/bombs line

// Boss bar (when active)
const BOSS_BAR_Y     = 100;
const BOSS_BAR_H     = 22;

// ============================================================
// SYSTEM
// ============================================================

export const hudSystem = {
  id: 'hud',
  priority: 200,
  phases: [
    PHASES.PLAYING, PHASES.PAUSED,
    PHASES.BOSS_WARNING, PHASES.BOSS_FIGHT,
  ],

  init(gs) {
    gs.hud = {
      displayedScore: 0,     // visually animated score for tick-up feel
      bossBarAlpha: 0,
    };
  },

  onEnterPhase(gs, fromPhase, toPhase) {
    // When a new run begins, snap the displayed score back to 0
    if (fromPhase === PHASES.PREGAME) {
      gs.hud.displayedScore = 0;
    }
  },

  update(gs, dt) {
    if (gs.phase === PHASES.PAUSED) return;
    const hud = gs.hud;
    const target = gs.player?.score ?? 0;

    if (hud.displayedScore !== target) {
      const diff = target - hud.displayedScore;
      if (Math.abs(diff) <= 1) {
        hud.displayedScore = target;
      } else {
        // Tick rate scales with the gap so big jumps don't crawl
        const rate = Math.max(40, Math.abs(diff) * 6);
        const step = Math.sign(diff) * rate * dt;
        if ((step > 0 && hud.displayedScore + step >= target) ||
            (step < 0 && hud.displayedScore + step <= target)) {
          hud.displayedScore = target;
        } else {
          hud.displayedScore += step;
        }
      }
    }

    // Boss bar fade
    const wantBoss = !!gs.boss && (gs.phase === PHASES.BOSS_FIGHT || gs.phase === PHASES.BOSS_WARNING);
    hud.bossBarAlpha += (wantBoss ? 1 : 0 - hud.bossBarAlpha) * Math.min(1, dt * 4);
    hud.bossBarAlpha = Math.max(0, Math.min(1, hud.bossBarAlpha));
  },

  render(gs, dt) {
    if (!gs.player) return;
    const ctx = gs.ctx;
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    renderTopLeft(ctx, gs);
    renderTopRight(ctx, gs);
    renderBottomBar(ctx, gs);

    if (gs.level) renderLevelIndicator(ctx, gs);
    if (gs.boss && gs.hud.bossBarAlpha > 0.01) renderBossBar(ctx, gs);

    if (gs.phase === PHASES.PAUSED) renderPauseOverlay(ctx, gs);

    ctx.restore();
  },
};

// ============================================================
// TOP-LEFT — lives + HP
// ============================================================

function renderTopLeft(ctx, gs) {
  const p = gs.player;
  const palette = gs.config.palette;

  // Lives row (mini player blobs)
  const drawCount = Math.min(p.lives, 5);
  for (let i = 0; i < drawCount; i++) {
    drawMiniBlob(ctx, LIVES_X + i * LIVES_SPACING + LIVES_BLOB_R, LIVES_Y, LIVES_BLOB_R);
  }
  // Overflow indicator if you have more than 5 lives
  if (p.lives > 5) {
    ctx.fillStyle = palette.bone;
    ctx.font = '14px VT323, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`+${p.lives - 5}`, LIVES_X + 5 * LIVES_SPACING + 4, LIVES_Y);
  }

  // HP segments
  for (let i = 0; i < p.maxHp; i++) {
    const sx = HP_X + i * (HP_SEG_W + HP_SEG_GAP);
    const filled = i < p.hp;
    if (filled) {
      ctx.fillStyle = palette.toxicGreen;
      ctx.shadowColor = palette.toxicGreen;
      ctx.shadowBlur = 8;
      ctx.fillRect(sx, HP_Y, HP_SEG_W, HP_SEG_H);
      // Inner dark divot for chunkiness
      ctx.shadowBlur = 0;
      ctx.fillStyle = palette.toxicGreenDark;
      ctx.fillRect(sx + 2, HP_Y + HP_SEG_H - 4, HP_SEG_W - 4, 2);
    } else {
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(sx, HP_Y, HP_SEG_W, HP_SEG_H);
    }
    ctx.shadowBlur = 0;
    ctx.strokeStyle = filled ? palette.toxicGreen : 'rgba(240,232,216,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx + 0.5, HP_Y + 0.5, HP_SEG_W - 1, HP_SEG_H - 1);
  }
}

function drawMiniBlob(ctx, cx, cy, r) {
  ctx.save();
  ctx.shadowBlur = 0;
  // Body
  const grad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r);
  grad.addColorStop(0, '#5c4a35');
  grad.addColorStop(1, '#1a0e08');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  // Eyes
  ctx.fillStyle = '#fff2c4';
  ctx.shadowColor = '#7fff5c';
  ctx.shadowBlur = 4;
  ctx.beginPath();
  ctx.arc(cx - r * 0.35, cy - r * 0.15, r * 0.22, 0, Math.PI * 2);
  ctx.arc(cx + r * 0.35, cy - r * 0.15, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ============================================================
// TOP-RIGHT — score + multiplier
// ============================================================

function renderTopRight(ctx, gs) {
  const palette = gs.config.palette;
  const fieldW = gs.fieldW;
  const p = gs.player;

  ctx.shadowBlur = 0;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';

  // Label
  ctx.fillStyle = palette.boneDim;
  ctx.font = '14px VT323, monospace';
  ctx.fillText('SCORE', fieldW - SCORE_RIGHT, SCORE_LABEL_Y);

  // Big monospace value
  const scoreText = Math.floor(gs.hud.displayedScore).toString().padStart(7, '0');
  const multActive = p.modifiers.score_multiplier > 0;
  ctx.fillStyle = multActive ? '#ff6ad8' : palette.bone;
  if (multActive) {
    ctx.shadowColor = '#ff6ad8';
    ctx.shadowBlur = 12;
  }
  ctx.font = 'bold 32px VT323, monospace';
  ctx.fillText(scoreText, fieldW - SCORE_RIGHT, SCORE_VALUE_Y);
  ctx.shadowBlur = 0;

  // Multiplier badge (below score, right-aligned)
  if (multActive) {
    const t = p.modifiers.score_multiplier;
    drawMultiplierBadge(ctx, fieldW - SCORE_RIGHT, SCORE_VALUE_Y + 38, '\u00D72', '#ff6ad8', t, 15);
  }
}

function drawMultiplierBadge(ctx, rightX, y, text, color, timeLeft, total) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.font = 'bold 22px VT323, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(text, rightX, y);

  // Time chip
  if (timeLeft !== null && total) {
    ctx.shadowBlur = 0;
    ctx.fillStyle = hexAlpha(color, 0.6);
    ctx.font = '12px VT323, monospace';
    ctx.fillText(`${timeLeft.toFixed(1)}s`, rightX, y + 24);
  }
  ctx.restore();
}

// ============================================================
// BOTTOM BAR — modifiers + weapon + bombs
// ============================================================

function renderBottomBar(ctx, gs) {
  const palette = gs.config.palette;
  const fieldW = gs.fieldW;
  const fieldH = gs.fieldH;
  const p = gs.player;

  // Background strip
  const stripY = fieldH - BOTTOM_STRIP_H;
  const stripGrad = ctx.createLinearGradient(0, stripY, 0, fieldH);
  stripGrad.addColorStop(0, 'rgba(5, 3, 6, 0)');
  stripGrad.addColorStop(0.3, 'rgba(5, 3, 6, 0.55)');
  stripGrad.addColorStop(1, 'rgba(5, 3, 6, 0.85)');
  ctx.fillStyle = stripGrad;
  ctx.fillRect(0, stripY, fieldW, BOTTOM_STRIP_H);

  // Top edge accent line
  ctx.strokeStyle = 'rgba(127, 255, 92, 0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, stripY + 0.5);
  ctx.lineTo(fieldW, stripY + 0.5);
  ctx.stroke();

  // Active modifier badges (upper half of the strip)
  const modY = stripY + 24;
  renderModifierBadges(ctx, gs, modY);

  // Weapon + bomb line (lower half)
  const lineY = fieldH - 18;
  renderWeaponWidget(ctx, gs, SIDE_MARGIN, lineY);
  renderBombWidget(ctx, gs, fieldW - SIDE_MARGIN, lineY);
}

function renderModifierBadges(ctx, gs, cy) {
  const p = gs.player;
  const mods = p.modifiers;

  const active = [];
  if (mods.shield_bubble)
    active.push({ icon: 'O', color: '#4af2ff', timeLeft: null, total: null });
  if (mods.speed_boost > 0)
    active.push({ icon: '>', color: '#ffe44a', timeLeft: mods.speed_boost, total: 8 });
  if (mods.damage_up > 0)
    active.push({ icon: 'X', color: '#ff3b3b', timeLeft: mods.damage_up, total: 10 });
  if (mods.score_multiplier > 0)
    active.push({ icon: '2', color: '#ff6ad8', timeLeft: mods.score_multiplier, total: 15 });

  let x = SIDE_MARGIN + MOD_BADGE_R;
  for (const mod of active) {
    drawModBadge(ctx, x, cy, mod);
    x += MOD_BADGE_R * 2 + MOD_BADGE_GAP;
  }
}

function drawModBadge(ctx, cx, cy, mod) {
  const r = MOD_BADGE_R;
  ctx.save();

  // Outer track (always full, dim)
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // Countdown arc (depleting clockwise from top)
  if (mod.total !== null && mod.timeLeft !== null) {
    const frac = Math.max(0, Math.min(1, mod.timeLeft / mod.total));
    if (frac > 0) {
      ctx.strokeStyle = mod.color;
      ctx.shadowColor = mod.color;
      ctx.shadowBlur = 6;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
  } else {
    // Permanent (shield) — full ring in color
    ctx.strokeStyle = mod.color;
    ctx.shadowColor = mod.color;
    ctx.shadowBlur = 6;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Inner disc
  ctx.shadowBlur = 8;
  ctx.shadowColor = mod.color;
  ctx.fillStyle = mod.color;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 6, 0, Math.PI * 2);
  ctx.fill();

  // Icon character
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#0a0a0a';
  ctx.font = 'bold 18px VT323, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(mod.icon, cx, cy + 1);

  ctx.restore();
}

function renderWeaponWidget(ctx, gs, x, cy) {
  const palette = gs.config.palette;
  const p = gs.player;
  const weapon = gs.data?.weapons?.weapons?.[p.weaponId];
  if (!weapon) return;

  // Icon
  drawWeaponIcon(ctx, x + 12, cy, p.weaponId, palette);

  // Name
  ctx.fillStyle = palette.toxicGreen;
  ctx.shadowColor = palette.toxicGreen;
  ctx.shadowBlur = 6;
  ctx.font = '15px VT323, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText((weapon.name || p.weaponId).toUpperCase(), x + 30, cy);
  ctx.shadowBlur = 0;
}

function drawWeaponIcon(ctx, cx, cy, weaponId, palette) {
  ctx.save();
  ctx.fillStyle = palette.toxicGreen;
  ctx.shadowColor = palette.toxicGreen;
  ctx.shadowBlur = 6;

  switch (weaponId) {
    case 'scatter':
      // Three diverging pellets
      ctx.fillStyle = '#ffaa55';
      ctx.shadowColor = '#ffaa55';
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.arc(cx + i * 5, cy - Math.abs(i) * 2, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'rapid':
      // Two vertical streaks
      ctx.fillStyle = '#4a9eff';
      ctx.shadowColor = '#4a9eff';
      ctx.fillRect(cx - 4, cy - 6, 2, 10);
      ctx.fillRect(cx + 2, cy - 6, 2, 10);
      break;
    case 'basic':
    default:
      // Single pellet with halo
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
      break;
  }
  ctx.restore();
}

function renderBombWidget(ctx, gs, rightX, cy) {
  const palette = gs.config.palette;
  const p = gs.player;

  // Count text right-aligned
  ctx.fillStyle = palette.authorityBlue;
  ctx.shadowColor = palette.authorityBlue;
  ctx.shadowBlur = 6;
  ctx.font = 'bold 17px VT323, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(`\u00D7 ${p.bombs}`, rightX, cy);
  ctx.shadowBlur = 0;

  // Bomb icon to the left of the count
  drawBombIcon(ctx, rightX - 38, cy, palette);
}

function drawBombIcon(ctx, cx, cy, palette) {
  ctx.save();
  // Body
  ctx.fillStyle = palette.authorityBlue;
  ctx.shadowColor = palette.authorityBlue;
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.arc(cx, cy + 1, 7, 0, Math.PI * 2);
  ctx.fill();
  // Stem
  ctx.shadowBlur = 0;
  ctx.fillRect(cx - 1, cy - 7, 2, 4);
  // Fuse spark
  ctx.fillStyle = '#ffe44a';
  ctx.shadowColor = '#ffe44a';
  ctx.shadowBlur = 4;
  ctx.beginPath();
  ctx.arc(cx, cy - 8, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ============================================================
// LEVEL / WAVE INDICATOR (top-center, ready for Step 10)
// ============================================================

function renderLevelIndicator(ctx, gs) {
  const palette = gs.config.palette;
  const fieldW = gs.fieldW;
  const level = gs.level;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = palette.boneDim;
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 3;
  ctx.font = '12px VT323, monospace';
  ctx.fillText(`LEVEL ${level.number ?? '?'}`, fieldW / 2, 16);
  ctx.font = '16px VT323, monospace';
  ctx.fillStyle = palette.bone;
  ctx.fillText((level.displayName || '').toUpperCase(), fieldW / 2, 30);
  ctx.restore();
}

// ============================================================
// BOSS HEALTH BAR (conditional on gs.boss)
// ============================================================

function renderBossBar(ctx, gs) {
  const boss = gs.boss;
  const palette = gs.config.palette;
  const fieldW = gs.fieldW;
  const alpha = gs.hud.bossBarAlpha;

  const barX = SIDE_MARGIN + 60;
  const barY = BOSS_BAR_Y;
  const barW = fieldW - SIDE_MARGIN * 2 - 120;
  const barH = BOSS_BAR_H;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Background
  ctx.fillStyle = 'rgba(20, 5, 5, 0.85)';
  ctx.fillRect(barX, barY, barW, barH);

  // HP fill
  const frac = Math.max(0, Math.min(1, boss.hp / boss.maxHp));
  ctx.fillStyle = palette.bloodRed;
  ctx.shadowColor = palette.bloodRed;
  ctx.shadowBlur = 14;
  ctx.fillRect(barX, barY, barW * frac, barH);

  // Border
  ctx.shadowBlur = 0;
  ctx.strokeStyle = palette.bloodRed;
  ctx.lineWidth = 1;
  ctx.strokeRect(barX + 0.5, barY + 0.5, barW - 1, barH - 1);

  // Name centered
  ctx.fillStyle = palette.bone;
  ctx.shadowColor = '#000';
  ctx.shadowBlur = 3;
  ctx.font = 'bold 14px VT323, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText((boss.displayName || boss.name || 'BOSS').toUpperCase(), barX + barW / 2, barY + barH / 2);
  ctx.restore();
}

// ============================================================
// PAUSE OVERLAY (moved from playingSystem)
// ============================================================

function renderPauseOverlay(ctx, gs) {
  const palette = gs.config.palette;
  const fieldW = gs.fieldW;
  const fieldH = gs.fieldH;
  ctx.save();
  ctx.fillStyle = 'rgba(2, 1, 3, 0.72)';
  ctx.fillRect(0, 0, fieldW, fieldH);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Pulsing PAUSED
  const pulse = 1 + 0.04 * Math.sin(gs.elapsed * 4);
  ctx.shadowColor = palette.toxicGreen;
  ctx.shadowBlur = 28 * pulse;
  ctx.fillStyle = palette.toxicGreen;
  ctx.font = `bold ${Math.round(56 * pulse)}px VT323, monospace`;
  ctx.fillText('PAUSED', fieldW / 2, fieldH * 0.45);

  ctx.shadowBlur = 0;
  ctx.fillStyle = palette.boneDim;
  ctx.font = '20px VT323, monospace';
  ctx.fillText('ESC to resume', fieldW / 2, fieldH * 0.53);
  ctx.restore();
}
