// ============================================================
// POOJECTILE — utils.js
//
// Tiny shared helpers used across systems. Keep this file
// dependency-free and stateless. Anything that holds state or
// renders belongs in its own module.
// ============================================================

// ---------- Math ----------

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Frame-rate independent lerp. Use for smoothing toward a target.
 *  `rate` is the fraction of distance closed per second (e.g. 0.9 = closes 90% per second). */
export function dampLerp(a, b, rate, dt) {
  const t = 1 - Math.pow(1 - rate, dt);
  return a + (b - a) * t;
}

export function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

export function randomInt(min, max) {
  return Math.floor(randomRange(min, max + 1));
}

export function sign(v) {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

// ---------- Distance + collision ----------

export function distanceSq(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return dx * dx + dy * dy;
}

export function distance(x1, y1, x2, y2) {
  return Math.sqrt(distanceSq(x1, y1, x2, y2));
}

/** Circle-circle hit test. Cheap. */
export function circleHit(x1, y1, r1, x2, y2, r2) {
  const rs = r1 + r2;
  return distanceSq(x1, y1, x2, y2) <= rs * rs;
}

/** Returns true if (x, y) is inside the playfield (no margin). */
export function inField(gs, x, y, margin = 0) {
  return x >= -margin && x <= gs.fieldW + margin &&
         y >= -margin && y <= gs.fieldH + margin;
}

// ---------- Object pool ----------
// Generic, preallocated, zero-GC during gameplay.
//
//   const pool = createPool(200, () => ({ alive: false }));
//   const obj = pool.acquire();   // returns inactive slot or null if full
//   obj.x = ...; obj.alive = true;
//   pool.release(obj);            // simply sets alive = false
//   pool.forEachAlive(o => ...);
//
// The pool never grows. If acquire() returns null, the caller
// should drop the spawn (this is the right behavior in shmups —
// dropping a stray bullet is better than allocating).
//
export function createPool(size, factory) {
  const slots = new Array(size);
  for (let i = 0; i < size; i++) {
    slots[i] = factory();
    slots[i].alive = false;
  }
  let cursor = 0;

  return {
    size,
    slots,

    acquire() {
      // Walk from last cursor position to find a dead slot.
      // This amortizes to O(1) in normal operation.
      for (let i = 0; i < size; i++) {
        const idx = (cursor + i) % size;
        if (!slots[idx].alive) {
          cursor = (idx + 1) % size;
          return slots[idx];
        }
      }
      return null;
    },

    release(obj) {
      obj.alive = false;
    },

    forEachAlive(fn) {
      for (let i = 0; i < size; i++) {
        if (slots[i].alive) fn(slots[i], i);
      }
    },

    countAlive() {
      let c = 0;
      for (let i = 0; i < size; i++) if (slots[i].alive) c++;
      return c;
    },

    clear() {
      for (let i = 0; i < size; i++) slots[i].alive = false;
    },
  };
}

// ---------- Color helpers ----------

/** Resolve a color reference. If it's a palette key (e.g. "toxicGreen"),
 *  return the actual color from config.palette. If it's already a hex/rgba,
 *  return as-is. */
export function resolveColor(gs, color) {
  if (!color) return '#ffffff';
  if (color.startsWith('#') || color.startsWith('rgb')) return color;
  return gs.config.palette[color] || color;
}

/** Convert hex to rgba with alpha. Works on #rrggbb only. */
export function hexAlpha(hex, alpha) {
  if (!hex || !hex.startsWith('#') || hex.length !== 7) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
