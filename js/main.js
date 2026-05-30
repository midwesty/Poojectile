// ============================================================
// POOJECTILE — main.js
//
// Entry point and SPACED integration. Thin bootstrap layer:
// loads config, builds the overlay DOM, creates the engine,
// registers all systems, starts it. Teardown reverses all of
// that.
//
// All game logic lives in systems registered with the engine.
// Adding a new feature = adding a new system module and
// registering it here.
// ============================================================

import {
  createEngine,
  registerSystem,
  registerBuiltinSystems,
  startEngine,
  stopEngine,
  PHASES,
} from './engine.js';
import { inputSystem } from './input.js';
import { audioSystem } from './audio.js';
import { menuSystem } from './menu.js';
import { projectilesSystem } from './projectiles.js';
import { particlesSystem } from './particles.js';
import { playerSystem } from './player.js';
import { enemiesSystem } from './enemies.js';
import { powerupsSystem } from './powerups.js';
import { hudSystem } from './hud.js';

const CONFIG_PATH = new URL('../data/config.json', import.meta.url).href;

// Data files to load in parallel at boot. Add new entries here
// as schema files arrive (bosses.json, levels.json, etc.).
const DATA_FILES = {
  weapons:  new URL('../data/weapons.json',  import.meta.url).href,
  enemies:  new URL('../data/enemies.json',  import.meta.url).href,
  powerups: new URL('../data/powerups.json', import.meta.url).href,
};

const DEFAULT_OPTS = {
  startLevel: 1,
  difficulty: null,   // null = use saved or config default
  onClose: null,      // callback({ reason, elapsed, phase }) when overlay closes
  onComplete: null,   // callback({ score, level, time }) on game completion
  onHighScore: null,  // callback({ score, level }) on new high score
};

let activeInstance = null;

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Open Poojectile as a fullscreen overlay.
 * @param {object|null} spacedState  SPACED's live game state, or null when standalone.
 * @param {object|null} spacedData   SPACED's data registry, or null when standalone.
 * @param {object|null} spacedApi    SPACED's engine API, or null when standalone.
 * @param {object} opts              See DEFAULT_OPTS.
 * @returns {Promise<{close: function, state: object}>}
 */
export async function openPoojectile(spacedState = null, spacedData = null, spacedApi = null, opts = {}) {
  if (activeInstance) {
    console.warn('[Poojectile] Already open. Returning existing instance.');
    return activeInstance;
  }

  const options = { ...DEFAULT_OPTS, ...opts };
  const config = await loadConfig();
  const data = await loadAllData();
  const settings = loadSettings(config);
  const difficulty = options.difficulty || settings.difficulty || config.defaultDifficulty;

  // Build overlay DOM
  const overlay = createOverlayDOM(config);
  document.body.appendChild(overlay);

  // ----- Single source of truth -----
  const gameState = {
    config,
    data,                  // weapons, enemies (later), levels (later), etc.
    options,
    settings,
    difficulty,

    // SPACED handles
    spacedState,
    spacedData,
    spacedApi,
    isEmbedded: spacedState !== null,

    // DOM
    overlay,
    canvas: overlay.querySelector('.pj-canvas'),
    ctx: null,
    statusEl: overlay.querySelector('.pj-status'),

    // Phase machine — starts in BOOT, engine drives transitions
    phase: PHASES.BOOT,
    phaseElapsed: 0,

    // Logical playfield dimensions
    fieldW: config.playfield.width,
    fieldH: config.playfield.height,
    dpr: Math.min(window.devicePixelRatio || 1, 2),

    // Loop bookkeeping
    elapsed: 0,
    frameCount: 0,
    fps: 0,
    fpsAccum: 0,
    fpsSampleStart: 0,

    // Lifecycle
    closed: false,
    closeReason: null,
    _disposers: [],

    // Engine slot (set by createEngine)
    engine: null,

    // Close request method — systems call this to request shutdown
    close: null,  // installed below
  };

  gameState.ctx = gameState.canvas.getContext('2d');
  resizeCanvas(gameState);

  // ----- Lifecycle wiring -----

  const handleResize = () => resizeCanvas(gameState);
  window.addEventListener('resize', handleResize);
  gameState._disposers.push(() => window.removeEventListener('resize', handleResize));

  // Install close API onto gameState. Any system can call gs.close(reason).
  gameState.close = (reason = 'user') => closePoojectile(gameState, reason);

  const closeBtn = overlay.querySelector('.pj-close');
  const handleCloseClick = () => gameState.close('button');
  closeBtn.addEventListener('click', handleCloseClick);
  gameState._disposers.push(() => closeBtn.removeEventListener('click', handleCloseClick));

  // ----- Engine + systems -----

  const engine = createEngine(gameState);

  // Input first (lowest priority — runs before everything else)
  registerSystem(engine, inputSystem);

  // Audio next (priority 5) — must exist before other systems try to play
  registerSystem(engine, audioSystem);

  // Built-in phase systems (background, boot, pregame, playing-coordinator, game-over)
  registerBuiltinSystems(engine);

  // Gameplay systems
  registerSystem(engine, projectilesSystem);
  registerSystem(engine, particlesSystem);
  registerSystem(engine, powerupsSystem);
  registerSystem(engine, playerSystem);
  registerSystem(engine, enemiesSystem);

  // HUD (renders on top of everything during gameplay)
  registerSystem(engine, hudSystem);

  // Menu phase
  registerSystem(engine, menuSystem);

  // Status text & go
  setStatus(gameState, '');  // clear; bg system handles the visual now
  startEngine(engine);

  activeInstance = {
    close: gameState.close,
    state: gameState,
  };
  return activeInstance;
}

// ============================================================
// CONFIG LOADING
// ============================================================

async function loadConfig() {
  try {
    const res = await fetch(CONFIG_PATH, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cfg = await res.json();
    validateConfig(cfg);
    return cfg;
  } catch (err) {
    console.error('[Poojectile] Failed to load config.json:', err);
    throw new Error('Poojectile cannot start: config.json missing or invalid.');
  }
}

async function loadAllData() {
  const entries = await Promise.all(
    Object.entries(DATA_FILES).map(async ([key, url]) => {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        return [key, json];
      } catch (err) {
        console.error(`[Poojectile] Failed to load data/${key}.json:`, err);
        throw new Error(`Poojectile cannot start: ${key}.json missing or invalid.`);
      }
    })
  );
  return Object.fromEntries(entries);
}

function validateConfig(cfg) {
  const required = ['title', 'version', 'playfield', 'difficulty', 'player', 'palette', 'phases', 'storage', 'input'];
  for (const key of required) {
    if (!(key in cfg)) throw new Error(`config.json missing required field: ${key}`);
  }
  if (!cfg.playfield.width || !cfg.playfield.height) {
    throw new Error('config.json playfield.width/height required');
  }
}

// ============================================================
// SETTINGS PERSISTENCE
// ============================================================

function loadSettings(config) {
  try {
    const raw = localStorage.getItem(config.storage.settingsKey);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[Poojectile] Could not read saved settings:', err);
    return {};
  }
}

function saveSettings(config, settings) {
  try {
    localStorage.setItem(config.storage.settingsKey, JSON.stringify(settings));
  } catch (err) {
    console.warn('[Poojectile] Could not save settings:', err);
  }
}

// Lobby helpers — exported so index.html can read/write the
// difficulty preference BEFORE the game opens. Uses the
// default storage key matching config.storage.settingsKey.
const LOBBY_SETTINGS_KEY = 'poojectile.settings';

export function readSetting(key, fallback = null) {
  try {
    const raw = localStorage.getItem(LOBBY_SETTINGS_KEY);
    if (!raw) return fallback;
    const obj = JSON.parse(raw);
    return key in obj ? obj[key] : fallback;
  } catch {
    return fallback;
  }
}

export function writeSetting(key, value) {
  try {
    const raw = localStorage.getItem(LOBBY_SETTINGS_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    obj[key] = value;
    localStorage.setItem(LOBBY_SETTINGS_KEY, JSON.stringify(obj));
  } catch (err) {
    console.warn('[Poojectile] Could not write setting:', err);
  }
}

// ============================================================
// OVERLAY DOM
// ============================================================

function createOverlayDOM(config) {
  const overlay = document.createElement('div');
  overlay.className = 'pj-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', config.title);

  overlay.innerHTML = `
    <aside class="pj-side-panel pj-side-panel--left" aria-hidden="true"></aside>
    <div class="pj-stage">
      <canvas class="pj-canvas" tabindex="0"></canvas>
      <button class="pj-close" type="button" aria-label="Close ${config.title}">\u2715</button>
      <div class="pj-status" role="status" aria-live="polite"></div>
    </div>
    <aside class="pj-side-panel pj-side-panel--right" aria-hidden="true"></aside>
  `;
  return overlay;
}

function setStatus(gameState, text) {
  if (gameState.statusEl) gameState.statusEl.textContent = text;
}

// ============================================================
// CANVAS SIZING
// Logical resolution stays at config.playfield. The canvas
// pixel buffer is scaled by DPR for crispness. All draw calls
// use logical coordinates.
// ============================================================

function resizeCanvas(gameState) {
  const { canvas, fieldW, fieldH, dpr } = gameState;
  canvas.width = fieldW * dpr;
  canvas.height = fieldH * dpr;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  gameState.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ============================================================
// CLOSE / TEARDOWN
// ============================================================

function closePoojectile(gameState, reason) {
  if (gameState.closed) return;
  gameState.closed = true;
  gameState.closeReason = reason;

  // Stop the engine (cancels rAF, calls onExitPhase + destroy on systems)
  if (gameState.engine) stopEngine(gameState.engine);

  // Run our own disposers (resize listener, close button listener, input listeners)
  for (const dispose of gameState._disposers) {
    try { dispose(); } catch (err) { console.warn('[Poojectile] Disposer threw:', err); }
  }

  // Persist any settings changes from this session
  saveSettings(gameState.config, {
    ...gameState.settings,
    difficulty: gameState.difficulty,
  });

  // Animate-out then remove from DOM
  gameState.overlay.classList.add('pj-closing');
  setTimeout(() => {
    if (gameState.overlay.parentNode) {
      gameState.overlay.parentNode.removeChild(gameState.overlay);
    }
  }, 250);

  // Notify SPACED (or whoever opened us) via callback
  if (typeof gameState.options.onClose === 'function') {
    try {
      gameState.options.onClose({
        reason,
        elapsed: gameState.elapsed,
        phase: gameState.phase,
      });
    } catch (err) {
      console.warn('[Poojectile] onClose callback threw:', err);
    }
  }

  activeInstance = null;
}
