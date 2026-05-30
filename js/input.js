// ============================================================
// POOJECTILE — input.js
//
// Input abstraction layer. Tracks keyboard + pointer state and
// exposes a stable API for systems to query:
//
//   gs.input.isDown(code)         current frame held state
//   gs.input.justPressed(code)    true for ONE frame after press
//   gs.input.justReleased(code)   true for ONE frame after release
//   gs.input.action(name)         multi-binding key held check
//   gs.input.actionJustPressed(name)
//   gs.input.getKeyboardMoveVector()  -> {x, y} each in [-1, 1]
//
//   gs.input.pointer = {
//     x, y,           logical playfield coords (not screen px)
//     down,           currently pressed (mouse held or finger down)
//     justDown,       transitioned to down this frame
//     justUp,         transitioned to up this frame
//     type            'mouse' | 'touch' | 'pen' | null
//   }
//
// The player module reads pointer.type + pointer.down to decide
// whether to do drag-to-move (touch) or keyboard movement.
// ============================================================

export const inputSystem = {
  id: 'input',
  priority: 0,            // runs before everything else each frame
  phases: null,           // active in ALL phases
  init(gs) {
    const state = {
      // raw per-frame snapshots
      down: new Set(),
      pressedThisFrame: new Set(),
      releasedThisFrame: new Set(),
      // queues populated by listeners between frames
      _pressQueue: new Set(),
      _releaseQueue: new Set(),
      _downQueue: new Set(),

      pointer: {
        x: gs.fieldW / 2,
        y: gs.fieldH / 2,
        down: false,
        justDown: false,
        justUp: false,
        type: null,           // most-recent pointer event type
        _queuedDown: false,
        _queuedUp: false,
      },

      isDown(code)        { return this.down.has(code); },
      justPressed(code)   { return this.pressedThisFrame.has(code); },
      justReleased(code)  { return this.releasedThisFrame.has(code); },

      action(name) {
        const codes = gs.config.input.keyboard[name];
        if (!codes) return false;
        return codes.some(c => this.down.has(c));
      },
      actionJustPressed(name) {
        const codes = gs.config.input.keyboard[name];
        if (!codes) return false;
        return codes.some(c => this.pressedThisFrame.has(c));
      },

      /** Returns a {x, y} vector from keyboard movement actions, each in [-1, 1]. */
      getKeyboardMoveVector() {
        let x = 0, y = 0;
        if (this.action('moveLeft'))  x -= 1;
        if (this.action('moveRight')) x += 1;
        if (this.action('moveUp'))    y -= 1;
        if (this.action('moveDown'))  y += 1;
        // Normalize diagonal so it isn't 1.414x faster
        if (x !== 0 && y !== 0) {
          const inv = 1 / Math.SQRT2;
          x *= inv; y *= inv;
        }
        return { x, y };
      },
    };
    gs.input = state;

    // ---------- Event listeners ----------
    const canvas = gs.canvas;

    const onKeyDown = (e) => {
      if (state._downQueue.has(e.code)) return; // ignore key-repeat
      state._downQueue.add(e.code);
      state._pressQueue.add(e.code);
      const binds = gs.config.input.keyboard;
      const used = Object.values(binds).some(arr => arr.includes(e.code));
      if (used) e.preventDefault();
    };
    const onKeyUp = (e) => {
      state._downQueue.delete(e.code);
      state._releaseQueue.add(e.code);
    };
    const onBlur = () => {
      for (const c of state._downQueue) state._releaseQueue.add(c);
      state._downQueue.clear();
    };

    const onPointerDown = (e) => {
      state.pointer._queuedDown = true;
      state.pointer.type = e.pointerType || 'mouse';
      updatePointerPos(e);
      try { canvas.setPointerCapture(e.pointerId); } catch {}
      e.preventDefault();
    };
    const onPointerMove = (e) => {
      // Track type even on move (useful for hover-only mouse)
      if (e.pointerType) state.pointer.type = e.pointerType;
      updatePointerPos(e);
    };
    const onPointerUp = (e) => {
      state.pointer._queuedUp = true;
      updatePointerPos(e);
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
    };

    function updatePointerPos(e) {
      const rect = canvas.getBoundingClientRect();
      const sx = gs.fieldW / rect.width;
      const sy = gs.fieldH / rect.height;
      state.pointer.x = (e.clientX - rect.left) * sx;
      state.pointer.y = (e.clientY - rect.top) * sy;
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    gs._disposers.push(() => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
    });
  },

  update(gs, dt) {
    const s = gs.input;
    const p = s.pointer;

    s.pressedThisFrame = s._pressQueue;
    s.releasedThisFrame = s._releaseQueue;
    s._pressQueue = new Set();
    s._releaseQueue = new Set();
    s.down = new Set(s._downQueue);

    p.justDown = p._queuedDown;
    p.justUp = p._queuedUp;
    p._queuedDown = false;
    p._queuedUp = false;
    if (p.justDown) p.down = true;
    if (p.justUp) p.down = false;
  },
};
