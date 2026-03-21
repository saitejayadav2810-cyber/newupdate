/**
 * ═══════════════════════════════════════════════════════════════
 *  SWIPE.JS — Touch & Mouse Swipe Engine
 *
 *  Handles drag physics, directional detection,
 *  overlay opacity, and fires callbacks:
 *    onSwipeRight  → "Got it / Answer revealed"
 *    onSwipeLeft   → "Skip"
 *    onSwipeUp     → "Save"
 *    onTap         → "Flip card"
 * ═══════════════════════════════════════════════════════════════
 */

const SwipeEngine = (() => {

  // ── Config ───────────────────────────────────────────────────
  const CFG = {
    THRESHOLD_X:    80,   // px to trigger left/right swipe
    THRESHOLD_Y:    80,   // px to trigger up swipe
    TILT_MAX:       20,   // max rotation degrees during drag
    TAP_MAX_MOVE:   10,   // px — if moved less than this it's a tap
    TAP_MAX_TIME:   250,  // ms — max duration of a tap
    OVERLAY_START:  30,   // px drag before overlay starts showing
    OVERLAY_FULL:   100,  // px drag where overlay is at full opacity
  };

  // ── State ────────────────────────────────────────────────────
  let _card      = null;
  let _overlayR  = null;
  let _overlayL  = null;
  let _overlayU  = null;
  let _overlayD  = null;   // down = reveal
  let _callbacks = {};
  let _enabled   = false;

  // Drag state
  let _startX    = 0;
  let _startY    = 0;
  let _startTime = 0;
  let _currentX  = 0;
  let _currentY  = 0;
  let _dragging  = false;

  // ── Initialise ───────────────────────────────────────────────
  function init(cardEl, overlays, callbacks) {
    _card      = cardEl;
    _overlayR  = overlays.right;
    _overlayL  = overlays.left;
    _overlayU  = overlays.up;
    _overlayD  = overlays.down;   // down = reveal
    _callbacks = callbacks || {};
    _enabled   = true;

    // Touch events
    _card.addEventListener('touchstart',  _onStart,  { passive: true });
    _card.addEventListener('touchmove',   _onMove,   { passive: true });
    _card.addEventListener('touchend',    _onEnd,    { passive: true });
    _card.addEventListener('touchcancel', _onCancel, { passive: true });

    // Mouse events (desktop testing)
    _card.addEventListener('mousedown',  _onStart);
    window.addEventListener('mousemove', _onMove);
    window.addEventListener('mouseup',   _onEnd);
  }

  // ── Destroy (call before loading new card) ───────────────────
  function destroy() {
    if (!_card) return;
    _card.removeEventListener('touchstart',  _onStart);
    _card.removeEventListener('touchmove',   _onMove);
    _card.removeEventListener('touchend',    _onEnd);
    _card.removeEventListener('touchcancel', _onCancel);
    _card.removeEventListener('mousedown',   _onStart);
    window.removeEventListener('mousemove',  _onMove);
    window.removeEventListener('mouseup',    _onEnd);
    _card = null;
  }

  // ── Enable / Disable (e.g. while animating) ──────────────────
  function enable()  { _enabled = true; }
  function disable() { _enabled = false; }

  // ── Event helpers ────────────────────────────────────────────
  function _getXY(e) {
    if (e.touches && e.touches[0]) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
  }

  // ── START ─────────────────────────────────────────────────────
  function _onStart(e) {
    if (!_enabled || !_card) return;

    // Only start drag from card element (not buttons inside)
    if (e.target.closest('button, a')) return;

    const { x, y } = _getXY(e);
    _startX    = x;
    _startY    = y;
    _currentX  = x;
    _currentY  = y;
    _startTime = Date.now();
    _dragging  = true;

    // Remove any transition during drag
    _card.style.transition = 'none';
  }

  // ── MOVE ──────────────────────────────────────────────────────
  function _onMove(e) {
    if (!_dragging || !_enabled || !_card) return;

    const { x, y } = _getXY(e);
    _currentX = x;
    _currentY = y;

    const dx = _currentX - _startX;
    const dy = _currentY - _startY;

    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;

    // Allow both up and down drag; tilt only on horizontal
    const tilt  = (dx / window.innerWidth) * CFG.TILT_MAX;
    const moveY = dy * 0.5;   // allow drag in both vertical directions

    _card.style.transform = `translateX(${dx}px) translateY(${moveY}px) rotate(${tilt}deg)`;

    // Reset all overlays
    _setOverlay(_overlayR, 0);
    _setOverlay(_overlayL, 0);
    _setOverlay(_overlayU, 0);
    _setOverlay(_overlayD, 0);

    const absDX = Math.abs(dx);
    const absDY = Math.abs(dy);

    if (absDY > absDX) {
      // Vertical swipe — determine up vs down
      if (dy > CFG.OVERLAY_START) {
        // DOWN → reveal
        const progress = Math.min((dy - CFG.OVERLAY_START) / CFG.OVERLAY_FULL, 1);
        _setOverlay(_overlayD, progress);
      } else if (dy < -CFG.OVERLAY_START) {
        // UP → skip
        const progress = Math.min((absDY - CFG.OVERLAY_START) / CFG.OVERLAY_FULL, 1);
        _setOverlay(_overlayU, progress);
      }
    } else {
      // Horizontal swipe → skip
      if (dx > CFG.OVERLAY_START) {
        const progress = Math.min((dx - CFG.OVERLAY_START) / CFG.OVERLAY_FULL, 1);
        _setOverlay(_overlayR, progress);
      } else if (dx < -CFG.OVERLAY_START) {
        const progress = Math.min((absDX - CFG.OVERLAY_START) / CFG.OVERLAY_FULL, 1);
        _setOverlay(_overlayL, progress);
      }
    }
  }

  // ── END ───────────────────────────────────────────────────────
  function _onEnd(e) {
    if (!_dragging) return;
    _dragging = false;

    if (!_enabled || !_card) return;

    const dx      = _currentX - _startX;
    const dy      = _currentY - _startY;
    const absDX   = Math.abs(dx);
    const absDY   = Math.abs(dy);
    const elapsed = Date.now() - _startTime;
    const moved   = Math.sqrt(dx * dx + dy * dy);

    // ── TAP detection ─────────────────────────────────────
    if (moved < CFG.TAP_MAX_MOVE && elapsed < CFG.TAP_MAX_TIME) {
      _snapBack();
      _callbacks.onTap?.();
      return;
    }

    // ── Directional decision ──────────────────────────────
    const vertPriority = absDY > absDX;

    if (vertPriority && dy > 0 && absDY >= CFG.THRESHOLD_Y) {
      // DOWN → reveal answer
      _snapBack();                  // card stays, just reveals
      _callbacks.onSwipeDown?.();
    } else if (vertPriority && dy < 0 && absDY >= CFG.THRESHOLD_Y) {
      // UP → skip
      _flyCard('up');
      _callbacks.onSwipeUp?.();
    } else if (!vertPriority && dx >= CFG.THRESHOLD_X) {
      // RIGHT → skip
      _flyCard('right');
      _callbacks.onSwipeRight?.();
    } else if (!vertPriority && dx <= -CFG.THRESHOLD_X) {
      // LEFT → skip
      _flyCard('left');
      _callbacks.onSwipeLeft?.();
    } else {
      _snapBack();
    }
  }

  function _onCancel() {
    if (_dragging) {
      _dragging = false;
      _snapBack();
    }
  }

  // ── Fly card off screen ───────────────────────────────────────
  function _flyCard(direction) {
    if (!_card) return;
    _clearOverlays();
    disable();

    switch (direction) {
      case 'right':
        _card.classList.add('card-fly-right');
        break;
      case 'left':
        _card.classList.add('card-fly-left');
        break;
      case 'up':
        _card.classList.add('card-fly-up');
        break;
    }
  }

  // ── Snap back to centre ───────────────────────────────────────
  function _snapBack() {
    if (!_card) return;
    _clearOverlays();
    _card.classList.add('card-snap-back');
    _card.style.transform = 'translateX(0) translateY(0) rotate(0deg)';

    _card.addEventListener('transitionend', () => {
      _card?.classList.remove('card-snap-back');
    }, { once: true });
  }

  // ── Programmatic swipe (called from buttons) ──────────────────
  function triggerSwipe(direction) {
    if (!_enabled || !_card) return;
    if (direction === 'down') {
      _snapBack();
      _callbacks.onSwipeDown?.();
      return;
    }
    _flyCard(direction);
    switch (direction) {
      case 'right': _callbacks.onSwipeRight?.(); break;
      case 'left':  _callbacks.onSwipeLeft?.();  break;
      case 'up':    _callbacks.onSwipeUp?.();    break;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────
  function _setOverlay(el, opacity) {
    if (el) el.style.opacity = opacity;
  }

  function _clearOverlays() {
    _setOverlay(_overlayR, 0);
    _setOverlay(_overlayL, 0);
    _setOverlay(_overlayU, 0);
    _setOverlay(_overlayD, 0);
    if (_card) _card.style.transform = '';
  }

  // ── Public API ────────────────────────────────────────────────
  return {
    init,
    destroy,
    enable,
    disable,
    triggerSwipe,
  };

})();
