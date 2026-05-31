// ============================================================
// POOJECTILE — highScores.js
//
// Top-10 high-score table with classic arcade 3-letter initials entry.
// Storage: localStorage under config.storage.highScoresKey.
//
// Public API (from gs after init):
//   gs.highScores.list           — current sorted list (top first)
//   gs.highScores.getTop(n)      — first n entries
//   gs.highScores.qualifies(s)   — would score s make the table?
//   gs.highScores.submit(entry)  — add and persist
//
// Helpers exported for engine.js / menu.js:
//   routeAfterRun(gs)            — call at end of GAME_OVER / LEVEL_COMPLETE
//   getTopFor(gs, n)             — read-only top-N (used by menu)
//
// System: highScoresSystem  — runs in HIGH_SCORE_ENTRY phase, owns
// the entry screen UI (slot-based with up/down arrows + keyboard).
// ============================================================

import { PHASES, transitionTo } from './engine.js';
import { hexAlpha } from './utils.js';

export const MAX_ENTRIES      = 10;
export const ALPHABET         = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const DEFAULT_INITIALS = ['A', 'A', 'A'];

// ============================================================
// STORAGE
// ============================================================

export function loadHighScores(gs) {
  try {
    const key = gs.config.storage.highScoresKey;
    const raw = localStorage.getItem(key);
    if (!raw) return seededDefault();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return seededDefault();
    return normalize(parsed);
  } catch (e) {
    return seededDefault();
  }
}

export function saveHighScores(gs, list) {
  try {
    const key = gs.config.storage.highScoresKey;
    localStorage.setItem(key, JSON.stringify(list));
  } catch (e) {
    console.warn('[highScores] save failed:', e);
  }
}

// Default seed so a fresh install has something to chase
function seededDefault() {
  return normalize([
    { initials: 'POO', score: 50000, level: 5, date: 0 },
    { initials: 'BOP', score: 35000, level: 4, date: 0 },
    { initials: 'MAT', score: 25000, level: 3, date: 0 },
    { initials: 'JET', score: 18000, level: 2, date: 0 },
    { initials: 'ZAP', score: 12000, level: 2, date: 0 },
    { initials: 'GLO', score: 8000,  level: 1, date: 0 },
    { initials: 'AAA', score: 5500,  level: 1, date: 0 },
    { initials: 'AAA', score: 3500,  level: 1, date: 0 },
    { initials: 'AAA', score: 1800,  level: 1, date: 0 },
    { initials: 'AAA', score: 800,   level: 1, date: 0 },
  ]);
}

function normalize(list) {
  return list
    .filter((e) => e && typeof e === 'object' && Number.isFinite(e.score))
    .map((e) => ({
      initials: typeof e.initials === 'string'
        ? e.initials.slice(0, 3).toUpperCase().padEnd(3, 'A')
        : 'AAA',
      score: Math.max(0, Math.floor(e.score)),
      level: Math.max(1, Math.floor(e.level || 1)),
      date: Number.isFinite(e.date) ? e.date : 0,
    }))
    // Sort by score desc; on tie, older entry ranks higher (was first)
    .sort((a, b) => b.score - a.score || a.date - b.date)
    .slice(0, MAX_ENTRIES);
}

// ============================================================
// PURE QUERIES
// ============================================================

export function qualifiesForHighScore(score, list) {
  if (!Number.isFinite(score) || score <= 0) return false;
  if (list.length < MAX_ENTRIES) return true;
  return score > list[list.length - 1].score;
}

export function insertHighScore(entry, list) {
  return normalize([...list, entry]);
}

export function getTopFor(gs, n) {
  if (!gs.highScores) return [];
  return gs.highScores.list.slice(0, n ?? MAX_ENTRIES);
}

// ============================================================
// ROUTING — called by engine.js at end of GAME_OVER / LEVEL_COMPLETE
// ============================================================

export function routeAfterRun(gs) {
  const score = gs.player?.score ?? 0;
  const list = gs.highScores?.list ?? [];

  if (qualifiesForHighScore(score, list)) {
    transitionTo(gs.engine, PHASES.HIGH_SCORE_ENTRY);
  } else {
    transitionTo(gs.engine, PHASES.MENU);
  }
}

// ============================================================
// HIGH_SCORE_ENTRY PHASE — initials entry UI
// ============================================================

const SLOT_W      = 64;
const SLOT_H      = 84;
const SLOT_GAP    = 18;
const ARROW_SIZE  = 36;
const ARROW_GAP   = 14;     // distance from slot edge to arrow
const DONE_W      = 200;
const DONE_H      = 54;

export const highScoresSystem = {
  id: 'highScores',
  priority: 100,
  phases: [PHASES.HIGH_SCORE_ENTRY],

  init(gs) {
    gs.highScores = {
      list: loadHighScores(gs),

      getTop(n) {
        return this.list.slice(0, n ?? MAX_ENTRIES);
      },

      qualifies(score) {
        return qualifiesForHighScore(score, this.list);
      },

      submit(entry) {
        this.list = insertHighScore(entry, this.list);
        saveHighScores(gs, this.list);
        return this.list;
      },

      // Entry-screen state (reset each time HIGH_SCORE_ENTRY is entered)
      entry: {
        initials: [...DEFAULT_INITIALS],
        cursor: 0,
        confirmed: false,
        score: 0,
        levelReached: 1,
      },
    };

    // Expose routeAfterRun on gs so engine.js can call it without
    // creating a circular import (engine.js -> highScores -> engine.js).
    gs.routeAfterRun = () => routeAfterRun(gs);
  },

  onEnterPhase(gs, fromPhase, toPhase) {
    if (toPhase !== PHASES.HIGH_SCORE_ENTRY) return;
    const e = gs.highScores.entry;
    e.initials = [...DEFAULT_INITIALS];
    e.cursor = 0;
    e.confirmed = false;
    e.score = gs.player?.score ?? 0;
    e.levelReached = gs.player?.levelReached ?? 1;
    gs.audio?.music.stop();
    gs.audio?.play('levelComplete');   // celebratory fanfare on entry
    gs._uiHoldsPointer = false;
  },

  update(gs, dt) {
    const e = gs.highScores.entry;
    if (e.confirmed) return;
    handleKeyboardEntry(gs, e);
    handlePointerEntry(gs, e);
  },

  render(gs, dt) {
    renderEntryScreen(gs);
  },
};

// ============================================================
// INPUT — KEYBOARD
// ============================================================

function handleKeyboardEntry(gs, e) {
  const input = gs.input;

  // Letter keys: set current slot to that letter and advance cursor
  for (let i = 0; i < ALPHABET.length; i++) {
    const ch = ALPHABET[i];
    const code = 'Key' + ch;
    if (input.justPressed(code)) {
      e.initials[e.cursor] = ch;
      if (e.cursor < 2) e.cursor++;
      gs.audio?.play('menuNav');
      return;
    }
  }

  // Arrow Up: cycle current letter forward
  if (input.actionJustPressed('moveUp')) {
    cycleLetter(e, +1);
    gs.audio?.play('menuNav');
    return;
  }
  // Arrow Down: cycle current letter backward
  if (input.actionJustPressed('moveDown')) {
    cycleLetter(e, -1);
    gs.audio?.play('menuNav');
    return;
  }
  // Arrow Left: cursor left
  if (input.actionJustPressed('moveLeft')) {
    e.cursor = Math.max(0, e.cursor - 1);
    gs.audio?.play('menuNav');
    return;
  }
  // Arrow Right: cursor right
  if (input.actionJustPressed('moveRight')) {
    e.cursor = Math.min(2, e.cursor + 1);
    gs.audio?.play('menuNav');
    return;
  }

  // Backspace: clear current letter, cursor left
  if (input.justPressed('Backspace')) {
    e.initials[e.cursor] = 'A';
    e.cursor = Math.max(0, e.cursor - 1);
    gs.audio?.play('menuNav');
    return;
  }

  // Enter or fire action: submit
  if (input.justPressed('Enter') || input.actionJustPressed('fire')) {
    submitEntry(gs);
  }
}

function cycleLetter(e, delta) {
  const cur = ALPHABET.indexOf(e.initials[e.cursor]);
  const next = ((cur + delta) % ALPHABET.length + ALPHABET.length) % ALPHABET.length;
  e.initials[e.cursor] = ALPHABET[next];
}

// ============================================================
// INPUT — POINTER (tap on arrows, slots, DONE button)
// ============================================================

function handlePointerEntry(gs, e) {
  const ptr = gs.input.pointer;
  if (!ptr.justDown) return;

  const layout = computeEntryLayout(gs);

  // Tap a slot to focus that cursor
  for (let i = 0; i < 3; i++) {
    if (pointInRect(ptr.x, ptr.y, layout.slots[i])) {
      e.cursor = i;
      gs.audio?.play('menuNav');
      return;
    }
  }

  // Tap an UP arrow
  for (let i = 0; i < 3; i++) {
    if (pointInRect(ptr.x, ptr.y, layout.upArrows[i])) {
      e.cursor = i;
      cycleLetter(e, +1);
      gs.audio?.play('menuNav');
      return;
    }
  }

  // Tap a DOWN arrow
  for (let i = 0; i < 3; i++) {
    if (pointInRect(ptr.x, ptr.y, layout.downArrows[i])) {
      e.cursor = i;
      cycleLetter(e, -1);
      gs.audio?.play('menuNav');
      return;
    }
  }

  // DONE button
  if (pointInRect(ptr.x, ptr.y, layout.doneBtn)) {
    submitEntry(gs);
  }
}

function submitEntry(gs) {
  const e = gs.highScores.entry;
  if (e.confirmed) return;
  e.confirmed = true;

  const entry = {
    initials: e.initials.join(''),
    score: e.score,
    level: e.levelReached,
    date: Date.now(),
  };
  gs.highScores.submit(entry);
  gs.audio?.play('menuSelect');

  // Brief celebration delay before menu — schedule via phaseElapsed in render,
  // but simplest is to just transition immediately. The fanfare from onEnterPhase
  // is already audible.
  transitionTo(gs.engine, PHASES.MENU);
}

// ============================================================
// LAYOUT — shared by render + pointer hit-tests
// ============================================================

function computeEntryLayout(gs) {
  const fieldW = gs.fieldW;
  const fieldH = gs.fieldH;
  const slotsY = fieldH * 0.48;
  const centerX = fieldW / 2;
  const totalW = SLOT_W * 3 + SLOT_GAP * 2;
  const startX = centerX - totalW / 2;

  const slots = [];
  const upArrows = [];
  const downArrows = [];
  for (let i = 0; i < 3; i++) {
    const x = startX + i * (SLOT_W + SLOT_GAP);
    const slotRect = { x, y: slotsY - SLOT_H / 2, w: SLOT_W, h: SLOT_H };
    slots.push(slotRect);
    upArrows.push({
      x: x + (SLOT_W - ARROW_SIZE) / 2,
      y: slotRect.y - ARROW_GAP - ARROW_SIZE,
      w: ARROW_SIZE, h: ARROW_SIZE,
    });
    downArrows.push({
      x: x + (SLOT_W - ARROW_SIZE) / 2,
      y: slotRect.y + slotRect.h + ARROW_GAP,
      w: ARROW_SIZE, h: ARROW_SIZE,
    });
  }

  const doneBtn = {
    x: centerX - DONE_W / 2,
    y: fieldH * 0.72,
    w: DONE_W,
    h: DONE_H,
  };

  return { slots, upArrows, downArrows, doneBtn };
}

function pointInRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

// ============================================================
// RENDER
// ============================================================

function renderEntryScreen(gs) {
  const { ctx, fieldW, fieldH, elapsed } = gs;
  const palette = gs.config.palette;
  const e = gs.highScores.entry;
  const layout = computeEntryLayout(gs);

  ctx.save();

  // Dim backdrop
  ctx.fillStyle = 'rgba(2, 1, 3, 0.86)';
  ctx.fillRect(0, 0, fieldW, fieldH);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // ----- Pulsing "NEW HIGH SCORE!" header -----
  const pulse = 1 + 0.07 * Math.sin(elapsed * 5);
  ctx.shadowColor = palette.toxicGreen;
  ctx.shadowBlur = 28 * pulse;
  ctx.fillStyle = palette.toxicGreen;
  ctx.font = `bold ${Math.round(40 * pulse)}px VT323, monospace`;
  ctx.fillText('NEW HIGH SCORE!', fieldW / 2, fieldH * 0.16);

  // ----- Score readout -----
  ctx.shadowBlur = 0;
  ctx.fillStyle = palette.bone;
  ctx.font = 'bold 40px VT323, monospace';
  ctx.fillText(e.score.toString().padStart(7, '0'), fieldW / 2, fieldH * 0.26);

  // ----- "Enter your initials" prompt -----
  ctx.fillStyle = palette.boneDim;
  ctx.font = '18px VT323, monospace';
  ctx.fillText('ENTER YOUR INITIALS', fieldW / 2, fieldH * 0.36);

  // ----- Slots + arrows -----
  for (let i = 0; i < 3; i++) {
    const slot = layout.slots[i];
    const isActive = i === e.cursor;
    drawSlot(ctx, slot, e.initials[i], isActive, palette, elapsed);

    // Up arrow
    drawArrow(ctx, layout.upArrows[i], 'up', isActive, palette);
    // Down arrow
    drawArrow(ctx, layout.downArrows[i], 'down', isActive, palette);
  }

  // ----- DONE button -----
  drawDoneButton(ctx, layout.doneBtn, palette, elapsed);

  // ----- Hint lines -----
  ctx.fillStyle = palette.boneDim;
  ctx.font = '14px VT323, monospace';
  ctx.globalAlpha = 0.7;
  ctx.fillText('TAP ARROWS  \u2014  OR TYPE LETTERS  \u2014  ENTER WHEN DONE', fieldW / 2, fieldH * 0.86);

  ctx.restore();
}

function drawSlot(ctx, rect, letter, active, palette, elapsed) {
  ctx.save();
  const color = active ? palette.toxicGreen : palette.bone;

  // Background
  ctx.fillStyle = active
    ? hexAlpha(palette.toxicGreen, 0.18)
    : 'rgba(0, 0, 0, 0.5)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  if (active) {
    ctx.shadowColor = palette.toxicGreen;
    ctx.shadowBlur = 14;
  }
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 8);
  ctx.fill();
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.fillStyle = color;
  ctx.font = 'bold 56px VT323, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, rect.x + rect.w / 2, rect.y + rect.h / 2 + 2);

  // Active-slot blinking underline cursor
  if (active && Math.sin(elapsed * 7) > 0) {
    ctx.fillStyle = palette.toxicGreen;
    ctx.fillRect(rect.x + 10, rect.y + rect.h - 6, rect.w - 20, 2);
  }
  ctx.restore();
}

function drawArrow(ctx, rect, dir, active, palette) {
  ctx.save();
  const color = active ? palette.toxicGreen : palette.boneDim;
  ctx.fillStyle = color;
  if (active) {
    ctx.shadowColor = palette.toxicGreen;
    ctx.shadowBlur = 8;
  }
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const h = rect.h * 0.5;
  const w = rect.w * 0.5;
  ctx.beginPath();
  if (dir === 'up') {
    ctx.moveTo(cx, cy - h / 2);
    ctx.lineTo(cx - w / 2, cy + h / 2);
    ctx.lineTo(cx + w / 2, cy + h / 2);
  } else {
    ctx.moveTo(cx, cy + h / 2);
    ctx.lineTo(cx - w / 2, cy - h / 2);
    ctx.lineTo(cx + w / 2, cy - h / 2);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawDoneButton(ctx, rect, palette, elapsed) {
  ctx.save();
  const pulse = 0.85 + 0.15 * Math.sin(elapsed * 3);
  ctx.shadowColor = palette.toxicGreen;
  ctx.shadowBlur = 18 * pulse;
  ctx.fillStyle = hexAlpha(palette.toxicGreen, 0.25);
  ctx.strokeStyle = palette.toxicGreen;
  ctx.lineWidth = 2;
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 10);
  ctx.fill();
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.fillStyle = palette.toxicGreen;
  ctx.font = 'bold 28px VT323, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('DONE', rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y,     x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x,     y + h, rr);
  ctx.arcTo(x,     y + h, x,     y,     rr);
  ctx.arcTo(x,     y,     x + w, y,     rr);
  ctx.closePath();
}
