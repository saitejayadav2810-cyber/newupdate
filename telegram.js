/**
 * ═══════════════════════════════════════════════════════════════
 *  TELEGRAM.JS — Telegram Mini App Integration
 *  Handles: theme sync, back button, haptics, user data
 * ═══════════════════════════════════════════════════════════════
 */

const TG = (() => {

  // ── Telegram WebApp object (with safe fallback for desktop browser) ──
  const twa = window.Telegram?.WebApp || null;

  // ── Initialise ────────────────────────────────────────────────
  function init() {
    if (!twa) {
      console.info('[TG] Running outside Telegram — using fallback mode.');
      return;
    }

    // Tell Telegram the app is ready (hides native loading spinner)
    twa.ready();

    // Expand to full height — covers chat window
    twa.expand();

    // Request true fullscreen (covers status bar) — available in TG v8.0+
    // Falls back gracefully on older versions
    if (typeof twa.requestFullscreen === 'function') {
      twa.requestFullscreen();
    }

    // Re-request fullscreen if viewport changes (e.g. user minimises and reopens)
    twa.onEvent('viewportChanged', () => {
      if (typeof twa.requestFullscreen === 'function' && !twa.isFullscreen) {
        twa.requestFullscreen();
      }
    });

    // ── Apply safe-area insets from Telegram SDK (fixes header overlap with status bar) ──
    const _applySafeArea = () => {
      const root = document.documentElement;
      // twa.safeAreaInset available in TG WebApp v7.4+
      const top    = twa.safeAreaInset?.top;
      const bottom = twa.safeAreaInset?.bottom;
      if (typeof top === 'number' && top > 0) {
        root.style.setProperty('--tg-safe-top', top + 'px');
      } else {
        // Fallback: env() for devices that expose it natively
        root.style.setProperty('--tg-safe-top', 'env(safe-area-inset-top, 0px)');
      }
      if (typeof bottom === 'number' && bottom >= 0) {
        root.style.setProperty('--tg-safe-bottom', bottom + 'px');
      }
    };
    _applySafeArea();
    // Re-apply if user rotates or Telegram updates insets
    twa.onEvent('safeAreaChanged',        _applySafeArea);
    twa.onEvent('viewportChanged',        _applySafeArea);
    twa.onEvent('contentSafeAreaChanged', _applySafeArea);

    // Apply Telegram's colour theme to CSS variables
    _applyTheme();

    // Listen for theme changes (user switches Telegram dark/light)
    twa.onEvent('themeChanged', _applyTheme);

    // Disable vertical swipe close so card swipes work correctly
    if (typeof twa.disableVerticalSwipes === 'function') {
      twa.disableVerticalSwipes();
    }

    // Configure back button behaviour
    _setupBackButton();

    console.info('[TG] Telegram WebApp initialised.', {
      version: twa.version,
      platform: twa.platform,
      colorScheme: twa.colorScheme,
    });
  }

  // ── Apply Telegram theme colours to CSS vars ──────────────────
  function _applyTheme() {
    if (!twa) return;
    const p = twa.themeParams || {};
    const root = document.documentElement;

    // Map Telegram theme params → our CSS variables
    const map = {
      '--tg-bg':        p.bg_color,
      '--tg-text':      p.text_color,
      '--tg-hint':      p.hint_color,
      '--tg-link':      p.link_color,
      '--tg-btn':       p.button_color,
      '--tg-btn-text':  p.button_text_color,
      '--tg-secondary': p.secondary_bg_color,
    };

    Object.entries(map).forEach(([key, val]) => {
      if (val) root.style.setProperty(key, val);
    });
  }

  // ── Back button logic ─────────────────────────────────────────
  //
  // Strategy:
  //  • Inside Telegram: twa.BackButton.show() makes Android hardware/gesture
  //    back fire through twa.BackButton.onClick instead of closing the app.
  //  • Outside Telegram (browser): we push a dummy history entry so the browser
  //    back button fires window.onpopstate instead of leaving the page.
  //
  // Whenever app navigates "deeper", call TG.pushBack(fn).
  // Whenever app navigates "back up", call TG.popBack().
  // The topmost handler always runs on back press.
  // ─────────────────────────────────────────────────────────────

  let _backHandlers = [];

  function _setupBackButton() {
    // ── Telegram BackButton ────────────────────────────────────
    if (twa?.BackButton) {
      twa.BackButton.onClick(() => {
        _fireBack();
      });
    }

    // ── Browser / Android WebView popstate ────────────────────
    // Push a dummy state now so popstate fires on back press
    // instead of the browser navigating away.
    window.addEventListener('popstate', () => {
      if (_backHandlers.length > 0) {
        // Re-push so next back press also fires
        window.history.pushState({ appNav: true }, '');
        _fireBack();
      }
    });
    // Seed the history stack once
    window.history.pushState({ appNav: true }, '');
  }

  function _fireBack() {
    if (_backHandlers.length > 0) {
      _backHandlers[_backHandlers.length - 1]();
    } else {
      // Nothing to go back to — hide button
      twa?.BackButton?.hide();
    }
  }

  /** Push a back handler — call this whenever navigating deeper */
  function pushBack(handler) {
    _backHandlers.push(handler);
    twa?.BackButton?.show();
    // Ensure browser history has an entry to intercept
    if (!twa) window.history.pushState({ appNav: true }, '');
  }

  /** Pop a back handler — call this when navigating back */
  function popBack() {
    _backHandlers.pop();
    if (_backHandlers.length === 0) {
      twa?.BackButton?.hide();
    }
  }

  /** Replace the topmost handler (e.g. when re-using a screen) */
  function replaceBack(handler) {
    if (_backHandlers.length > 0) {
      _backHandlers[_backHandlers.length - 1] = handler;
    } else {
      pushBack(handler);
    }
  }

  /** Clear all back handlers (e.g. on home screen) */
  function clearBack() {
    _backHandlers = [];
    twa?.BackButton?.hide();
  }

  // ── Haptic Feedback ───────────────────────────────────────────
  const Haptic = {
    light()   { twa?.HapticFeedback?.impactOccurred('light'); },
    medium()  { twa?.HapticFeedback?.impactOccurred('medium'); },
    heavy()   { twa?.HapticFeedback?.impactOccurred('heavy'); },
    success() { twa?.HapticFeedback?.notificationOccurred('success'); },
    warning() { twa?.HapticFeedback?.notificationOccurred('warning'); },
    error()   { twa?.HapticFeedback?.notificationOccurred('error'); },
    select()  { twa?.HapticFeedback?.selectionChanged(); },
  };

  // ── User Info ─────────────────────────────────────────────────
  function getUser() {
    if (!twa?.initDataUnsafe?.user) return null;
    return twa.initDataUnsafe.user; // { id, first_name, last_name, username, ... }
  }

  function getUserId() {
    return getUser()?.id?.toString() || 'guest';
  }

  // ── Color scheme ──────────────────────────────────────────────
  function isDark() {
    return twa ? twa.colorScheme === 'dark' : true;
  }

  // ── Show Telegram confirm popup ───────────────────────────────
  function confirm(message, onConfirm, onCancel) {
    if (twa?.showConfirm) {
      twa.showConfirm(message, (confirmed) => {
        if (confirmed) onConfirm?.();
        else onCancel?.();
      });
    } else {
      // Browser fallback
      if (window.confirm(message)) onConfirm?.();
      else onCancel?.();
    }
  }

  // ── Show Telegram popup ───────────────────────────────────────
  function showPopup(title, message) {
    if (twa?.showPopup) {
      twa.showPopup({ title, message, buttons: [{ type: 'close' }] });
    } else {
      alert(`${title}\n\n${message}`);
    }
  }

  // ── Close the mini app ────────────────────────────────────────
  function close() {
    twa?.close();
  }

  // ── Is running inside Telegram? ───────────────────────────────
  function isTelegram() {
    return !!twa && twa.platform !== 'unknown';
  }

  // ── Public API ────────────────────────────────────────────────
  return {
    init,
    pushBack,
    popBack,
    replaceBack,
    clearBack,
    Haptic,
    getUser,
    getUserId,
    isDark,
    confirm,
    showPopup,
    close,
    isTelegram,
  };

})();
