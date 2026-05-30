# POOJECTILE

A browser-native arcade shoot-'em-up. You play as a sentient piece of expelled spaceship waste that has, after centuries adrift, achieved consciousness — and rage.

Part of the [BOPware](https://github.com/midwesty/Spaced) ecosystem. Designed to run standalone and as a droppable module inside [SPACED](https://github.com/midwesty/Spaced).

---

## Status

**Phase 1 — Step 3: Player + Projectiles.** The player is alive on the canvas. You can move (keyboard or touch drag) and auto-fire at nothing.

Running this right now will:
- Show the lobby (`index.html`) with title screen and difficulty selector
- "Start Game" opens the overlay → boot (1.5s) → menu
- Select START GAME from the in-canvas menu → "GET READY" countdown (1.8s, skip with space/tap)
- **Playing phase:** organic blob player appears, can move freely, auto-fires toxic-green projectiles upward
- **Desktop:** WASD or arrow keys to move. Auto-fire while moving (or hold Space/Z to fire while stationary)
- **Mobile:** drag anywhere on the playfield to move (player floats above your finger). Fire is automatic while touching.
- **ESC:** toggles pause (frozen overlay), press again to resume
- Minimal HUD shows lives, HP, score, current weapon, bomb count
- Boundary clamping keeps the player inside the playfield

---

## Running Locally

This project requires no build step and no dependencies. **It must be served over HTTP** because it loads `config.json` via fetch — opening `index.html` with `file://` will fail.

```bash
cd Poojectile
python -m http.server 8000
```

Then visit [http://localhost:8000](http://localhost:8000).

For direct launch (skip the lobby), visit `http://localhost:8000/game.html`.

---

## File Structure

```
Poojectile/
├── index.html              [DONE] Lobby / main menu
├── game.html               [DONE] Direct launch (skips lobby)
├── README.md               [DONE] This file
├── js/
│   ├── main.js             [DONE] Thin bootstrap + SPACED integration export
│   ├── engine.js           [DONE] Phase machine, system registry, game loop
│   ├── input.js            [DONE] Keyboard + pointer + drag-to-move abstraction
│   ├── menu.js             [DONE] In-canvas menu phase system
│   ├── utils.js            [DONE] Math, collision, object pool helpers
│   ├── projectiles.js      [DONE] Pooled projectile system (300 slots)
│   ├── player.js           [DONE] Player movement, weapons, organic blob rendering
│   ├── enemies.js          [TODO] Enemy types, AI patterns, spawning, bosses
│   ├── powerups.js         [TODO] Power-up types, collection, effects, timers
│   ├── levels.js           [TODO] Level loader, procedural generation, scrolling
│   ├── particles.js        [TODO] Particle system (explosions, trails, effects)
│   ├── renderer.js         [TODO] Level background renderer (parallax, debris)
│   ├── hud.js              [TODO] Full HUD (will replace the placeholder in engine.js)
│   ├── audio.js            [TODO] Web Audio synthesis (SFX + chiptune music)
│   └── cutscenes.js        [TODO] Cutscene player, dialogue, intro sequence
├── data/
│   ├── config.json         [DONE] Global config
│   ├── weapons.json        [DONE] Weapon + projectile type definitions
│   ├── levels.json         [TODO] All level definitions
│   ├── enemies.json        [TODO] Enemy type definitions
│   ├── powerups.json       [TODO] Power-up type definitions
│   ├── bosses.json         [TODO] Boss definitions
│   └── cutscenes.json      [TODO] Cutscene scripts and dialogue
└── css/
    └── styles.css          [DONE] UI styling
```

---

## SPACED Integration

When complete, Poojectile is invoked from SPACED's engine like this:

```js
import { openPoojectile } from './Poojectile/js/main.js';

// From an arcade-cabinet tile interaction:
await openPoojectile(state, data, api, {
  difficulty: 'normal',
  onClose: (info) => {
    // Game closed — return control to SPACED
  },
  onComplete: (result) => {
    // result = { score, level, time }
    // Optionally: award credits, set quest flags, etc.
  },
});
```

The four optional parameters:
- `spacedState` — SPACED's live game state (or `null` for standalone)
- `spacedData` — SPACED's data registry (or `null`)
- `spacedApi` — SPACED's engine API for cross-talk (or `null`)
- `opts` — `{ startLevel, difficulty, onClose, onComplete, onHighScore }`

When `spacedState` is non-null the overlay knows it's embedded and behaves accordingly (different close behavior, results can write back).

---

## Design Decisions

These are locked in for the project:

- **Orientation:** Portrait (9:16, 540×960 internal resolution). Mobile-first; desktop centers the playfield with optional side panels.
- **Controls:** Drag-to-move + auto-fire on mobile (no virtual joystick). WASD/arrows + space on desktop. Auto-fire toggleable.
- **Weapon system:** Replace-on-pickup primary weapon. Separate bomb slot (max 3). Modifiers (shield, damage-up, etc.) stack with timers.
- **Lives:** Three lives per level, respawn-in-place with i-frames. Out of lives = restart level.
- **Scroll:** Constant forced scroll. Boss arenas pause scroll and become fixed playfields.
- **Audio:** Web Audio synthesis only. Per-level chiptune tracks plus SFX.
- **Visuals:** Procedural canvas drawing only. No image assets. Weird/organic aesthetic — biological forms, viscous trails, toxic bioluminescent palette.
- **Data:** All content (levels, enemies, weapons, etc.) defined in JSON. Engine reads JSON; never touched for content changes.
- **Builder-ready:** Every JSON file carries `_meta` and `_ranges` annotations so the BOPware Builder can introspect and auto-render form fields without sidecar schema files.

---

## Roadmap

**Phase 1 — Vertical Slice (current).** Level 1 fully playable end-to-end with boss. All systems wired. All schemas finalized.

1. ✅ Skeleton + boot
2. ✅ Engine core (loop, state machine, phase routing, system registration)
3. ✅ Player + projectiles + drag-to-move + basic shot
4. Enemy framework + Level 1 enemy types + collision
5. Particle system (explosions, hit flash, trails)
6. Audio engine + Level 1 chiptune track
7. Power-ups (4–5 working types covering all categories)
8. Full HUD (replaces the engine.js placeholder)
9. Boss 1
10. Level loader + Level 1 waves + scrolling background
11. Cutscene player + intro + pre-Level 1
12. Menus expansion (settings, game-over, level-complete)
13. Mobile polish (screen shake, hit flash, i-frames juice)

**Phase 2 — Content Expansion.** Levels 2–6 with their bosses, enemies, cutscenes, and music. Almost no engine code, mostly data.

**Phase 3 — Polish.** Difficulty tuning, additional weapons/powerups, credits sequence, settings menu, accessibility pass.

**Phase 4 — BOPware Builder integration.** New tab in BOPware Builder exposing all Poojectile JSON files as visual editors.

---

## License

TBD. Likely MIT.
