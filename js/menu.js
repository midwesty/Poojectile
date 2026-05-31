// ============================================================
// POOJECTILE — menu.js
//
// Menu phase system. Renders the in-canvas main menu and
// handles navigation (keyboard + pointer). This is the first
// "content" system using the registration pattern — future
// modules (player, enemies, etc.) follow the same shape.
//
// Menu items are declared in MENU_ITEMS. Each item has an
// action() that runs on select. Adding a new option = adding
// a new entry here; the renderer auto-spaces them.
// ============================================================

import { PHASES, transitionTo } from './engine.js';

const MENU_ITEMS = [
  {
    id: 'start',
    label: () => 'START GAME',
    action: (gs) => transitionTo(gs.engine, PHASES.PREGAME),
  },
  {
    id: 'difficulty',
    label: (gs) => `DIFFICULTY: ${gs.difficulty.toUpperCase()}`,
    action: (gs) => {
      const order = ['easy', 'normal', 'hard'];
      const idx = order.indexOf(gs.difficulty);
      gs.difficulty = order[(idx + 1) % order.length];
      // Persist directly to localStorage. main.js owns the canonical
      // settings save on close, but we update the difficulty key
      // immediately so it survives a hard reload.
      try {
        const key = gs.config.storage.settingsKey;
        const raw = localStorage.getItem(key);
        const obj = raw ? JSON.parse(raw) : {};
        obj.difficulty = gs.difficulty;
        localStorage.setItem(key, JSON.stringify(obj));
      } catch (err) {
        console.warn('[Menu] Could not save difficulty:', err);
      }
    },
  },
  {
    id: 'exit',
    label: () => 'EXIT TO LOBBY',
    action: (gs) => gs.close('menu-exit'),
  },
];

// Layout constants — relative to playfield height (0..1)
const TITLE_Y           = 0.18;
const MENU_START_Y      = 0.50;
const MENU_ITEM_SPACING = 0.08;
const MENU_HIT_PADDING  = 12;

export const menuSystem = {
  id: 'menu',
  priority: 100,
  phases: [PHASES.MENU],

  onEnterPhase(gs, fromPhase) {
    // Catch-all: ensure no gameplay/boss music lingers on the menu
    gs.audio?.music.stop();

    gs._menu = {
      cursor: 0,
      hoverIndex: -1,
      // Track whether mouse moved this phase, so keyboard nav
      // doesn't fight pointer hover.
      lastInputWasPointer: false,
    };
  },

  update(gs, dt) {
    const m = gs._menu;
    const input = gs.input;

    // --- Keyboard nav ---
    if (input.actionJustPressed('moveUp')) {
      m.cursor = (m.cursor - 1 + MENU_ITEMS.length) % MENU_ITEMS.length;
      m.lastInputWasPointer = false;
      gs.audio?.play('menuNav');
    }
    if (input.actionJustPressed('moveDown')) {
      m.cursor = (m.cursor + 1) % MENU_ITEMS.length;
      m.lastInputWasPointer = false;
      gs.audio?.play('menuNav');
    }

    // Select with Space/Enter/'fire' action
    if (input.actionJustPressed('fire') || input.justPressed('Enter')) {
      gs.audio?.play('menuSelect');
      activate(gs, m.cursor);
    }

    // ESC closes overlay
    if (input.actionJustPressed('pause')) {
      gs.close('menu-escape');
    }

    // --- Pointer ---
    const rects = computeItemRects(gs);
    let newHover = -1;
    for (let i = 0; i < rects.length; i++) {
      if (pointInRect(input.pointer.x, input.pointer.y, rects[i])) {
        newHover = i;
        break;
      }
    }
    m.hoverIndex = newHover;

    if (newHover !== -1 && input.pointer.justDown) {
      m.cursor = newHover;
      gs.audio?.play('menuSelect');
      activate(gs, newHover);
      m.lastInputWasPointer = true;
    } else if (newHover !== -1 && newHover !== m.cursor) {
      // Hover moves cursor visually but doesn't activate
      m.cursor = newHover;
      m.lastInputWasPointer = true;
    }
  },

  render(gs, dt) {
    const { ctx, fieldW, fieldH, elapsed } = gs;
    const palette = gs.config.palette;
    const m = gs._menu;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // --- Title ---
    const titlePulse = 0.85 + 0.15 * Math.sin(elapsed * 1.5);
    ctx.shadowColor = palette.toxicGreen;
    ctx.shadowBlur = 25 * titlePulse;
    ctx.fillStyle = palette.toxicGreen;
    ctx.font = 'bold 56px VT323, monospace';
    ctx.fillText(gs.config.title, fieldW / 2, fieldH * TITLE_Y);

    ctx.shadowBlur = 0;
    ctx.fillStyle = palette.bone;
    ctx.fillText(gs.config.title, fieldW / 2, fieldH * TITLE_Y);

    ctx.fillStyle = palette.boneDim;
    ctx.font = '18px VT323, monospace';
    ctx.fillText(`~  ${gs.config.tagline}  ~`, fieldW / 2, fieldH * (TITLE_Y + 0.07));

    // --- Menu items ---
    const rects = computeItemRects(gs);
    ctx.font = '28px VT323, monospace';
    for (let i = 0; i < MENU_ITEMS.length; i++) {
      const item = MENU_ITEMS[i];
      const isCursor = i === m.cursor;
      const r = rects[i];
      const cy = r.y + r.h / 2;

      if (isCursor) {
        // Glow + bracket indicators
        ctx.shadowColor = palette.toxicGreen;
        ctx.shadowBlur = 16;
        ctx.fillStyle = palette.toxicGreen;
        // left bracket
        ctx.textAlign = 'right';
        ctx.fillText('>', r.x - 10, cy);
        // right bracket
        ctx.textAlign = 'left';
        ctx.fillText('<', r.x + r.w + 10, cy);
      } else {
        ctx.shadowBlur = 0;
      }

      ctx.textAlign = 'center';
      ctx.fillStyle = isCursor ? palette.toxicGreen : palette.bone;
      ctx.fillText(item.label(gs), fieldW / 2, cy);
    }
    ctx.shadowBlur = 0;

    // --- Footer hint ---
    ctx.fillStyle = palette.boneDim;
    ctx.globalAlpha = 0.5;
    ctx.font = '14px VT323, monospace';
    ctx.fillText('UP / DOWN \u2014 SELECT \u2014 ESC TO CLOSE', fieldW / 2, fieldH * 0.94);

    ctx.restore();
  },
};

// ============================================================
// Helpers
// ============================================================

function computeItemRects(gs) {
  const w = gs.fieldW;
  const h = gs.fieldH;
  const itemW = w * 0.7;
  const itemH = h * 0.06;
  const rects = [];
  for (let i = 0; i < MENU_ITEMS.length; i++) {
    const cy = h * (MENU_START_Y + i * MENU_ITEM_SPACING);
    rects.push({
      x: (w - itemW) / 2,
      y: cy - itemH / 2 - MENU_HIT_PADDING / 2,
      w: itemW,
      h: itemH + MENU_HIT_PADDING,
    });
  }
  return rects;
}

function pointInRect(x, y, r) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function activate(gs, index) {
  const item = MENU_ITEMS[index];
  if (item && item.action) item.action(gs);
}
