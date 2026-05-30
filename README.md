# POOJECTILE

A browser-native arcade shoot-'em-up. You play as a sentient piece of expelled spaceship waste that has, after centuries adrift, achieved consciousness — and rage.

Part of the [BOPware](https://github.com/midwesty/Spaced) ecosystem. Designed to run standalone and as a droppable module inside [SPACED](https://github.com/midwesty/Spaced).

---

## Status

**Phase 1 — Step 4: Enemies + Particles + Collision.** It's a game now. Enemies spawn from the top of the screen, you shoot them, they explode in satisfying particle bursts. You take damage from contact, lose lives, and hit game over when you're out.

Running this right now will:
- Same lobby → boot → menu → GET READY flow as before
- **In the playing phase:** three enemy types spawn from above every ~1.1 seconds (small asteroids drifting straight down, medium asteroids weaving in sine waves, hull debris with random drift)
- Your projectiles damage and destroy enemies on hit (white hit flash + spark particles)
- Killed enemies explode with type-specific particle bursts (small_pop / medium_explosion) and award score
- Contact with an enemy damages you (`contactDamage` from enemies.json), grants i-frames, blinks your sprite, and destroys the asteroid that hit you
- Losing all HP costs a life; running out of lives → GAME OVER screen with final score
- GAME OVER screen waits 1.2s for input then returns to menu on space/tap/ESC
- Difficulty scales enemy HP, speed, and score multiplier per `config.json`

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
│   ├── particles.js        [DONE] Pooled particle system (500 slots, additive blend)
│   ├── player.js           [DONE] Player movement, weapons, organic blob rendering
│   ├── enemies.js          [DONE] Enemy pool, AI patterns, collision, test spawner
│   ├── powerups.js         [TODO] Power-up types, collection, effects, timers
│   ├── levels.js           [TODO] Level loader, procedural generation, scrolling
│   ├── renderer.js         [TODO] Level background renderer (parallax, debris)
│   ├── hud.js              [TODO] Full HUD (will replace the placeholder in engine.js)
│   ├── audio.js            [TODO] Web Audio synthesis (SFX + chiptune music)
│   └── cutscenes.js        [TODO] Cutscene player, dialogue, intro sequence
├── data/
│   ├── config.json         [DONE] Global config
│   ├── weapons.json        [DONE] Weapon + projectile type definitions
│   ├── enemies.json        [DONE] Enemy type definitions (Level 1 asteroids/debris)
│   ├── levels.json         [TODO] All level definitions
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
4. ✅ Enemies + particles + collision + game over
5. Audio engine + Level 1 chiptune track + SFX wiring
6. Power-ups (4–5 working types covering all categories)
7. Full HUD (replaces the engine.js placeholder)
8. Boss 1
9. Level loader + Level 1 waves + scrolling background
10. Cutscene player + intro + pre-Level 1
11. Menus expansion (settings, game-over polish, level-complete)
12. Mobile polish (screen shake, hit flash refinement, juice)

**Phase 2 — Content Expansion.** Levels 2–6 with their bosses, enemies, cutscenes, and music. Almost no engine code, mostly data.

**Phase 3 — Polish.** Difficulty tuning, additional weapons/powerups, credits sequence, settings menu, accessibility pass.

**Phase 4 — BOPware Builder integration.** New tab in BOPware Builder exposing all Poojectile JSON files as visual editors.

---

## License

TBD. Likely MIT.
