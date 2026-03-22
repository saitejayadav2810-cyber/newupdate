/**
 * ═══════════════════════════════════════════════════════════════
 *  APP.JS — Daily Current Affairs Core Logic
 *
 *  Handles:
 *   • fetchQuestions()     — Google Sheets → localStorage cache
 *   • selectDailyCards()   — 10 random cards/day, no repeats
 *   • skipCard()           — delay reappearance 3 days
 *   • saveCard()           — bookmark to saved list
 *   • loadNextCard()       — advance card state
 *   • Progress tracking    — streak, totals, per-category
 *   • All UI rendering
 * ═══════════════════════════════════════════════════════════════
 */

// ════════════════════════════════════════════════════════════════
//  CONFIG — ▶ UPDATE SPREADSHEET_ID BEFORE DEPLOYING
// ════════════════════════════════════════════════════════════════
const CONFIG = {
  // ↓ Replace with your actual Google Spreadsheet ID
  SPREADSHEET_ID: '1x_SEEuZDey4XfoyYRDnrAN1eZcJ_d65PPDeLUWHRyGo',
  SHEET_NAME:     'sheet1',

  // Public API proxy (no auth required)
  // Alternative: https://docs.google.com/spreadsheets/d/{ID}/gviz/tq?tqx=out:csv&sheet={NAME}
  API_BASE: 'https://opensheet.elk.sh',

  CARDS_PER_DAY:    99999,  // Unlimited — all questions shown continuously
  CACHE_TTL_HOURS:  0,     // Always fetch fresh from Google Sheet on every load
  SKIP_DELAY_DAYS:  3,     // Skipped cards return after N days

  // ── Firebase Realtime Database ──────────────────────────────
  // ▶ SETUP (free, 5 min):
  //   1. Go to https://console.firebase.google.com
  //   2. Create project → Build → Realtime Database → Create database
  //   3. Choose "Start in TEST MODE" (open rules, 30 days)
  //   4. For permanent access set Rules to:
  //      { "rules": { ".read": true, ".write": true } }
  //   5. Copy the URL shown (e.g. https://agrimets-default-rtdb.firebaseio.com)
  //   6. Paste it below — NO trailing slash
  FB_URL: 'https://agrimets-a3c9c-default-rtdb.firebaseio.com',   // Firebase Realtime Database
};

// ════════════════════════════════════════════════════════════════
//  LOCAL STORAGE KEYS
// ════════════════════════════════════════════════════════════════
const LS = {
  QUESTIONS:     'dca_questions',       // Cached question array
  CACHE_TIME:    'dca_cache_time',      // When cache was last written
  SEEN_IDS:      'dca_seen_ids',        // Set of all question ids ever seen
  SKIPPED:       'dca_skipped',         // { id: timestamp } skipped cards
  SAVED:         'dca_saved',           // Array of saved question objects
  DAILY_DATE:    'dca_daily_date',      // "YYYY-MM-DD" of today's session
  DAILY_CARDS:   'dca_daily_cards',     // Today's 10 selected question ids
  DAILY_INDEX:   'dca_daily_index',     // How many cards shown today
  STATS:         'dca_stats',           // { streak, lastActive, totalSeen, daysActive }
  GUIDE_SHOWN:   'dca_guide_shown',     // Whether swipe guide has been dismissed
  HISTORY:       'dca_history',         // [{id, question, answer, category, action, ts}]
  DAILY_TARGET:  'dca_daily_target',    // User's daily card goal (number)
  DAILY_DONE:    'dca_daily_done',      // { date, count } — cards done today
  THEME:         'dca_theme',           // 'dark' | 'light'
  ANN_SEEN:      'dca_ann_seen',        // Set of seen announcement IDs
};

// ════════════════════════════════════════════════════════════════
//  STATE
// ════════════════════════════════════════════════════════════════
let State = {
  allQuestions:    [],      // Full fetched dataset
  dailyCards:      [],      // Questions filtered by active subject
  currentIndex:    0,       // Current card index
  isFlipped:       false,   // Is card showing answer?
  sessionSaved:    0,       // Saved this session
  sessionSkipped:  0,       // Skipped this session
  activeSubject:   null,    // null = show subject picker
  activeSubcategory: null,  // null = no subcategory filter active
  sessionStack:    [],      // Cards seen this session in order [{card, index}]
  stackPos:        -1,      // Current position in sessionStack (-1 = tip)
  cramMode:        false,   // true = Cram Mode (scrollable list), false = Swipe Mode

  // ── Sprint Mode ──────────────────────────────────────────────
  sprintMode:         false, // True while 50-card sprint is active
  sprintKnown:        0,     // Cards marked "know it"
  sprintUnknown:      0,     // Cards marked "don't know"
  sprintKnownCards:   [],    // Actual question objects marked known
  sprintUnknownCards: [],    // Actual question objects marked unknown
  sprintSecondsLeft:  600,   // 10 minutes countdown
  sprintTimerInterval: null, // setInterval handle
  sprintTarget:       50,    // How many cards to show (capped to available)
};

// ════════════════════════════════════════════════════════════════
//  DOM REFS
// ════════════════════════════════════════════════════════════════
let DOM = {};

function _cacheDom() {
  DOM = {
    splash:            document.getElementById('splash-screen'),
    loaderFill:        document.getElementById('loader-fill'),
    loaderText:        document.getElementById('loader-text'),
    app:               document.getElementById('app'),

    // Header
    headerStreak:      document.getElementById('header-streak'),

    // Daily progress (in card area topbar)
    dailyCount:        document.getElementById('daily-count'),
    dailyProgressFill: document.getElementById('daily-progress-fill'),
    activeSubjectName: document.getElementById('active-subject-name'),

    // Subject picker
    subjectPicker:     document.getElementById('subject-picker'),
    subjectGrid:       document.getElementById('subject-grid'),
    subcategoryPicker: document.getElementById('subcategory-picker'),
    subcategoryGrid:   document.getElementById('subcategory-grid'),
    subcatTitle:       document.getElementById('subcat-title'),
    subcatParentLabel: document.getElementById('subcat-parent-label'),
    btnSubcatBack:     document.getElementById('btn-subcat-back'),
    cardArea:          document.getElementById('card-area'),
    cramView:          document.getElementById('cram-view'),
    btnBackSubjects:   document.getElementById('btn-back-subjects'),

    // Card elements
    cardArena:         document.getElementById('card-arena'),
    activeCard:        document.getElementById('active-card'),
    cardInner:         document.getElementById('card-inner'),
    cardFront:         document.getElementById('card-front'),
    cardBack:          document.getElementById('card-back'),
    cardNumber:        document.getElementById('card-number'),
    cardQuestion:      document.getElementById('card-question'),
    cardAnswer:        document.getElementById('card-answer'),
    cardQuestionRepeat:document.getElementById('card-question-repeat'),
    overlayRight:      document.getElementById('overlay-right'),
    overlayLeft:       document.getElementById('overlay-left'),
    overlayUp:         document.getElementById('overlay-up'),
    overlayDown:       document.getElementById('overlay-down'),

    // Arena nav arrows
    btnCardBack:       document.getElementById('btn-card-back'),
    btnCardFwd:        document.getElementById('btn-card-fwd'),

    // Action buttons
    btnSkip:           document.getElementById('btn-skip'),
    btnFlip:           document.getElementById('btn-flip'),
    btnSave:           document.getElementById('btn-save'),
    btnNext:           document.getElementById('btn-next'),

    // Swipe guide
    swipeGuide:        document.getElementById('swipe-guide'),

    // Completion
    completionScreen:  document.getElementById('completion-screen'),
    compSaved:         document.getElementById('comp-saved'),
    compSkipped:       document.getElementById('comp-skipped'),
    compStreak:        document.getElementById('comp-streak'),
    btnReviewSaved:    document.getElementById('btn-review-saved'),

    // Tabs
    tabHome:           document.getElementById('tab-home'),
    tabSaved:          document.getElementById('tab-saved'),
    tabProgress:       document.getElementById('tab-progress'),
    tabHistory:        document.getElementById('tab-history'),
    tabUpdate:         document.getElementById('tab-update'),
    viewHome:          document.getElementById('view-home'),
    viewSaved:         document.getElementById('view-saved'),
    viewProgress:      document.getElementById('view-progress'),
    viewHistory:       document.getElementById('view-history'),
    // Saved tab
    savedBadge:        document.getElementById('saved-badge'),
    savedCountLabel:   document.getElementById('saved-count-label'),
    savedList:         document.getElementById('saved-list'),
    savedEmpty:        document.getElementById('saved-empty'),
    savedSearch:       document.getElementById('saved-search'),
    savedSearchClear:  document.getElementById('saved-search-clear'),
    btnQuizSaved:      document.getElementById('btn-quiz-saved'),

    // History tab
    historyList:       document.getElementById('history-list'),
    historyEmpty:      document.getElementById('history-empty'),
    historyCountLabel: document.getElementById('history-count-label'),
    historySearch:     document.getElementById('history-search'),
    historySearchClear:document.getElementById('history-search-clear'),

    // Action rows
    actionRow:         document.getElementById('action-row'),
    sprintActionRow:   document.getElementById('sprint-action-row'),
    btnSprintKnown:    document.getElementById('btn-sprint-known'),
    btnSprintUnknown:  document.getElementById('btn-sprint-unknown'),

    // Sprint HUD
    sprintHud:         document.getElementById('sprint-hud'),
    sprintHudTimer:    document.getElementById('sprint-hud-timer'),
    sprintHudCount:    document.getElementById('sprint-hud-count'),
    sprintHudKnown:    document.getElementById('sprint-hud-known'),
    sprintHudUnknown:  document.getElementById('sprint-hud-unknown'),

    // Sprint result screen
    sprintResult:      document.getElementById('sprint-result'),
    sprintResultPct:   document.getElementById('sprint-result-pct'),
    sprintRsKnown:     document.getElementById('sprint-rs-known'),
    sprintRsUnknown:   document.getElementById('sprint-rs-unknown'),
    sprintRsTotal:     document.getElementById('sprint-rs-total'),
    btnSprintAgain:    document.getElementById('btn-sprint-again'),
    btnSprintHome:     document.getElementById('btn-sprint-home'),
    btnSprintCta:      document.getElementById('btn-sprint'),

    // Progress
    todayDateLabel:    document.getElementById('today-date-label'),
    statStreak:        document.getElementById('stat-streak'),
    statTotal:         document.getElementById('stat-total'),
    statSaved:         document.getElementById('stat-saved'),
    statDays:          document.getElementById('stat-days'),
    heatmap:           document.getElementById('heatmap'),
    categoryBars:      document.getElementById('category-bars'),
    btnReset:          document.getElementById('btn-reset'),

    // Toast
    toast:             document.getElementById('toast'),

    // Ads
    adBanner:          document.getElementById('ad-banner'),
    adClose:           document.getElementById('ad-close'),

    // Daily target setter
    dtrFillCircle:     document.getElementById('dtr-fill-circle'),
    dtrPct:            document.getElementById('dtr-pct'),
    dtrBarFill:        document.getElementById('dtr-bar-fill'),
    dtrStatus:         document.getElementById('dtr-status'),
    dtrGoalVal:        document.getElementById('dtr-goal-val'),
    dtrTodayCount:     document.getElementById('daily-target-today-count'),
    dtrCustomRow:      document.getElementById('dtr-custom-row'),
    dtrCustomInput:    document.getElementById('dtr-custom-input'),
    dtrSetBtn:         document.getElementById('dtr-set-btn'),
    dtrCustomBtn:      document.getElementById('dtr-custom-btn'),
  };
}

// ════════════════════════════════════════════════════════════════
//  UTILITIES
// ════════════════════════════════════════════════════════════════

function today() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function ls_get(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch { return fallback; }
}

function ls_set(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (e) { console.warn('[LS] Write failed:', e); }
}

function ls_remove(key) {
  localStorage.removeItem(key);
}

/** Fisher-Yates shuffle */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let _toastTimer = null;
function showToast(msg, duration = 2200) {
  const t = DOM.toast;
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), duration);
}

function setLoaderProgress(pct, text) {
  if (DOM.loaderFill) DOM.loaderFill.style.width = `${pct}%`;
  if (text && DOM.loaderText) DOM.loaderText.textContent = text;
}

// ════════════════════════════════════════════════════════════════
//  1. FETCH QUESTIONS  fetchQuestions()
// ════════════════════════════════════════════════════════════════

async function fetchQuestions() {
  setLoaderProgress(10, 'Checking cache…');

  const cacheTime = ls_get(LS.CACHE_TIME, 0);
  const cached    = ls_get(LS.QUESTIONS, null);
  const ageHours  = (Date.now() - cacheTime) / 3_600_000;

  // ── Serve fresh cache if available ──────────────────────────
  if (cached && Array.isArray(cached) && cached.length > 0 && ageHours < CONFIG.CACHE_TTL_HOURS) {
    setLoaderProgress(100, `✓ Loaded ${cached.length} questions`);
    await _delay(150);
    return cached;
  }

  // ── Guard: catch un-configured Spreadsheet ID ────────────────
  if (!CONFIG.SPREADSHEET_ID || CONFIG.SPREADSHEET_ID === 'YOUR_SPREADSHEET_ID_HERE') {
    _showFetchError(
      'SPREADSHEET_ID not set!',
      'Open app.js and replace YOUR_SPREADSHEET_ID_HERE with your actual Google Spreadsheet ID.'
    );
    return _getDemoData();
  }

  // ── API 1: opensheet.elk.sh (primary) ────────────────────────
  setLoaderProgress(30, 'Connecting to Google Sheets…');
  const url1 = `https://opensheet.elk.sh/${CONFIG.SPREADSHEET_ID}/${CONFIG.SHEET_NAME}`;

  let raw = null;
  let lastError = '';

  try {
    const res = await fetch(url1, { cache: 'no-store' });
    if (!res.ok) throw new Error(`opensheet returned HTTP ${res.status}`);
    raw = await res.json();
    if (!Array.isArray(raw) || raw.length === 0) throw new Error('opensheet returned empty array');
    setLoaderProgress(70, `Got ${raw.length} rows from API…`);
  } catch (err) {
    lastError = err.message;
    console.warn('[Fetch] API-1 failed:', err.message, '— trying backup API…');
    setLoaderProgress(50, 'Primary API failed, trying backup…');

    // ── API 2: Google's own CSV/JSON endpoint (backup) ─────────
    const url2 = `https://docs.google.com/spreadsheets/d/${CONFIG.SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${CONFIG.SHEET_NAME}`;
    try {
      const res2 = await fetch(url2, { cache: 'no-store' });
      if (!res2.ok) throw new Error(`Google gviz returned HTTP ${res2.status}`);
      const text = await res2.text();

      // Google wraps JSON in: /*O_o*/google.visualization.Query.setResponse({...});
      const jsonStr = text.replace(/^[^(]+\(/, '').replace(/\);?\s*$/, '');
      const gviz    = JSON.parse(jsonStr);
      const cols    = gviz.table.cols.map(c => c.label.toLowerCase().trim());
      raw = gviz.table.rows
        .filter(r => r && r.c)
        .map(r => {
          const obj = {};
          cols.forEach((col, i) => { obj[col] = r.c[i]?.v ?? ''; });
          return obj;
        });

      if (!Array.isArray(raw) || raw.length === 0) throw new Error('gviz returned empty data');
      setLoaderProgress(70, `Got ${raw.length} rows via backup API…`);
      lastError = '';
    } catch (err2) {
      lastError = `API-1: ${err.message} | API-2: ${err2.message}`;
      console.error('[Fetch] Both APIs failed:', lastError);
      raw = null;
    }
  }

  // ── Handle complete failure ────────────────────────────────────
  if (!raw) {
    if (cached && cached.length > 0) {
      setLoaderProgress(100, `⚠ Offline — using ${cached.length} cached questions`);
      showToast('⚠ Could not reach Google Sheets — showing cached data');
      return cached;
    }
    _showFetchError(
      'Could not load your Google Sheet',
      `Both APIs failed.\n\nError: ${lastError}\n\nCheck:\n` +
      `1. Spreadsheet ID is correct in app.js\n` +
      `2. Sheet is shared as "Anyone with the link"\n` +
      `3. Tab is named exactly "${CONFIG.SHEET_NAME}"`
    );
    setLoaderProgress(100, '⚠ Using demo data (sheet unreachable)');
    return _getDemoData();
  }

  // ── Normalise rows (case-insensitive column matching) ──────────
  // Build a lowercase key map for each row so "Question"/"QUESTION"/"question" all work
  function normaliseRow(row) {
    const out = {};
    Object.keys(row).forEach(k => { out[k.toLowerCase().trim()] = row[k]; });
    return out;
  }

  const normRaw = raw.map(normaliseRow);

  // Debug: log the first row's keys so you can see what column names came through
  if (normRaw.length > 0) {
    console.info('[Fetch] Column keys found in sheet:', Object.keys(normRaw[0]));
  }

  const questions = normRaw
    .filter(row => {
      const q = row.question ?? row.questions ?? row.q ?? '';
      return String(q).trim() !== '';
    })
    .map((row, idx) => {
      // Accept common column name variants
      const q    = row.question    ?? row.questions ?? row.q        ?? '';
      const a    = row.answer      ?? row.answers   ?? row.a        ?? '';
      const cat  = row.category    ?? row.cat       ?? row.topic    ?? row.subject ?? 'General';
      const sub  = row.subcategory ?? row.sub_category ?? row.subcategories ?? row.sub ?? '';
      const id   = row.id          ?? row.sl        ?? row.sr       ?? row.no      ?? (idx + 1);
      return {
        id:          String(id).trim(),
        question:    String(q).trim(),
        answer:      String(a).trim(),
        category:    String(cat).trim() || 'General',
        subcategory: String(sub).trim(),
      };
    })
    .filter(q => q.question !== '' && q.answer !== '');

  if (questions.length === 0) {
    // Show the actual column names found to help debug
    const foundCols = normRaw.length > 0 ? Object.keys(normRaw[0]).join(', ') : 'none';
    _showFetchError(
      'Sheet loaded but 0 questions found',
      `Sheet connected ✓  but no valid rows were read.\n\n` +
      `Columns found in your sheet:\n"${foundCols}"\n\n` +
      `App needs columns named (any capitalisation):\n` +
      `"id"  "question"  "answer"  "category"\n\n` +
      `Fix: rename your sheet column headers to match, then refresh.`
    );
    if (cached && cached.length > 0) return cached;
    return _getDemoData();
  }

  setLoaderProgress(90, `Processing ${questions.length} questions…`);

  // Cache the fresh data
  ls_set(LS.QUESTIONS, questions);
  ls_set(LS.CACHE_TIME, Date.now());

  await _delay(100);
  setLoaderProgress(100, `✓ ${questions.length} questions loaded!`);
  return questions;
}

/** Show a visible error panel on the splash screen */
function _showFetchError(title, detail) {
  const loaderEl = document.querySelector('.splash-loader');
  if (!loaderEl) { alert(`${title}\n\n${detail}`); return; }
  loaderEl.innerHTML = `
    <div style="
      background:#1a0a0a;border:1px solid #ff5252;border-radius:12px;
      padding:16px;text-align:left;margin-top:8px;">
      <div style="color:#ff5252;font-weight:700;font-size:13px;margin-bottom:8px;">
        ⚠ ${title}
      </div>
      <div style="color:#9fa8da;font-size:11px;white-space:pre-wrap;line-height:1.6;">
${detail}
      </div>
      <div style="color:#5c6bc0;font-size:10px;margin-top:12px;">
        App will load with demo questions. Fix the issue and refresh.
      </div>
    </div>`;
}

// ════════════════════════════════════════════════════════════════
//  2. SELECT DAILY CARDS  selectDailyCards()
// ════════════════════════════════════════════════════════════════

function selectDailyCards(allQuestions) {
  // ── UNLIMITED MODE: return ALL shuffled questions, no daily cap ──
  // Shows unseen questions first; when all seen, reshuffles everything.

  const seenIds    = new Set(ls_get(LS.SEEN_IDS, []));
  const skipped    = ls_get(LS.SKIPPED, {});
  const nowMs      = Date.now();
  const skipMs     = CONFIG.SKIP_DELAY_DAYS * 86_400_000;

  // IDs still in skip-delay window
  const inDelayIds = new Set(
    Object.entries(skipped)
      .filter(([, ts]) => nowMs - ts < skipMs)
      .map(([id]) => id)
  );

  // Prefer unseen questions first
  let pool = allQuestions.filter(
    q => !seenIds.has(q.id) && !inDelayIds.has(q.id)
  );

  // All seen → reset cycle, start fresh
  if (pool.length === 0) {
    console.info('[Cards] All questions seen — reshuffling');
    ls_set(LS.SEEN_IDS, []);
    pool = allQuestions.filter(q => !inDelayIds.has(q.id));
  }

  // Edge case: everything is skipped
  if (pool.length === 0) pool = allQuestions;

  // Return ALL available questions (shuffled) — NO slice limit
  const selected = shuffle(pool);

  ls_set(LS.DAILY_DATE,  today());
  ls_set(LS.DAILY_CARDS, selected.map(q => q.id));

  return selected;
}

// ════════════════════════════════════════════════════════════════
//  3. SAVE CARD  saveCard()
// ════════════════════════════════════════════════════════════════

function saveCard(question) {
  const saved = ls_get(LS.SAVED, []);

  // Avoid duplicates
  if (saved.find(q => q.id === question.id)) {
    showToast('Already saved!');
    return;
  }

  saved.unshift(question); // newest first
  ls_set(LS.SAVED, saved);
  State.sessionSaved++;

  // Update badge
  _updateSavedBadge(saved.length);

  TG.Haptic.success();
  showToast('🔖 Saved!');
}

function unsaveCard(id) {
  let saved = ls_get(LS.SAVED, []);
  saved = saved.filter(q => q.id !== id);
  ls_set(LS.SAVED, saved);
  _updateSavedBadge(saved.length);
  renderSavedTab();
  showToast('Removed from saved');
}

function _updateSavedBadge(count) {
  const badge = DOM.savedBadge;
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// ════════════════════════════════════════════════════════════════
//  4. SKIP CARD  skipCard()
// ════════════════════════════════════════════════════════════════

function skipCard(questionId) {
  const skipped = ls_get(LS.SKIPPED, {});
  skipped[questionId] = Date.now();
  ls_set(LS.SKIPPED, skipped);
  State.sessionSkipped++;
  TG.Haptic.light();
}

// ════════════════════════════════════════════════════════════════
//  5. MARK SEEN  (called after any action)
// ════════════════════════════════════════════════════════════════

function markSeen(questionId) {
  const seen = ls_get(LS.SEEN_IDS, []);
  const isNew = !seen.includes(questionId);

  if (isNew) {
    seen.push(questionId);
    ls_set(LS.SEEN_IDS, seen);

    // ── Cumulative mastered counter — never resets even when SEEN_IDS resets ──
    // This is the true "Total Mastered ever" used for share milestones.
    const cumulative = (ls_get('dca_cumulative_mastered', 0) || 0) + 1;
    ls_set('dca_cumulative_mastered', cumulative);

    // Fire popup at every 200th genuinely new card (200, 400, 600…)
    try { _checkShareMilestone(cumulative); } catch(e) {}
  }

  _updateStats();
}

// ════════════════════════════════════════════════════════════════
//  6. LOAD NEXT CARD  loadNextCard()
// ════════════════════════════════════════════════════════════════

function loadNextCard() {
  State.currentIndex++;
  ls_set(LS.DAILY_INDEX, State.currentIndex);

  // When subject deck is exhausted — reshuffle and keep going
  if (State.currentIndex >= State.dailyCards.length) {
    showToast('🔄 All done! Reshuffling…');
    State.dailyCards  = shuffle([...State.dailyCards]);
    State.currentIndex = 0;
    ls_set(LS.DAILY_INDEX, 0);
  }

  _updateDailyProgress();
  _renderCard(State.dailyCards[State.currentIndex]);
}

// ════════════════════════════════════════════════════════════════
//  STATS & STREAK
// ════════════════════════════════════════════════════════════════

function _updateStats() {
  const todayStr = today();
  const stats    = ls_get(LS.STATS, {
    streak: 0, lastActive: '', totalSeen: 0, daysActive: 0,
  });

  // Update total seen
  stats.totalSeen = ls_get(LS.SEEN_IDS, []).length;

  // Streak logic
  if (stats.lastActive === todayStr) {
    // Same day — no streak change
  } else {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    if (stats.lastActive === yesterday) {
      stats.streak++;
    } else if (stats.lastActive !== todayStr) {
      stats.streak = 1; // reset
    }
    stats.lastActive = todayStr;
    stats.daysActive++;
  }

  ls_set(LS.STATS, stats);
  _renderStreakUI(stats.streak);
}

function _renderStreakUI(streak) {
  if (DOM.headerStreak) DOM.headerStreak.textContent = streak;
  if (DOM.statStreak)   DOM.statStreak.textContent   = streak;
}

// ════════════════════════════════════════════════════════════════
//  CARD RENDERING
// ════════════════════════════════════════════════════════════════

function _renderCard(question, skipStack) {
  if (!question) return;

  // ── Push to session stack (unless navigating within stack) ──
  if (!skipStack) {
    // Truncate any forward history if we navigated back then moved forward normally
    if (State.stackPos >= 0 && State.stackPos < State.sessionStack.length - 1) {
      State.sessionStack = State.sessionStack.slice(0, State.stackPos + 1);
    }
    State.sessionStack.push({ question, index: State.currentIndex });
    State.stackPos = State.sessionStack.length - 1;
  }
  _updateArrows();

  // Reset flip state
  State.isFlipped = false;
  DOM.cardInner?.classList.remove('flipped');

  // Reset card position/classes
  const card = DOM.activeCard;
  if (card) {
    card.classList.remove('card-fly-right', 'card-fly-left', 'card-fly-up', 'card-snap-back');
    card.style.transform  = '';
    card.style.opacity    = '';
    card.style.transition = '';
  }

  // Fill content — use inner spans so flex layout of parent is never disturbed
  const cardNum = State.currentIndex + 1;
  if (DOM.cardNumber) DOM.cardNumber.textContent = `Q${cardNum}`;

  const qInner = document.getElementById('card-question-inner');
  const aInner = document.getElementById('card-answer-inner');
  const rInner = document.getElementById('card-question-repeat-inner');

  // ── ★ Bullet-point question: render all points at once ──────
  if (question.question && question.question.includes('★')) {
    const pts = question.question.split('★').map(s => s.trim()).filter(Boolean);
    if (qInner) qInner.innerHTML = _buildBulletHTML(pts);
  } else {
    if (qInner) qInner.innerHTML = _linkGlossary(question.question);
  }

  if (aInner) aInner.innerHTML = _linkGlossary(question.answer);
  if (rInner) rInner.innerHTML = _linkGlossary(question.question);

  // Show swipe guide on very first card ever
  if (!ls_get(LS.GUIDE_SHOWN)) {
    DOM.swipeGuide?.classList.remove('hidden');
    setTimeout(() => {
      ls_set(LS.GUIDE_SHOWN, true);
      DOM.swipeGuide?.classList.add('hidden');
    }, 4000);
  } else {
    DOM.swipeGuide?.classList.add('hidden');
  }

  // Animate card entrance
  if (card) {
    // Hard-reset ALL transforms from the fly-out so position is clean
    card.classList.remove('card-fly-right', 'card-fly-left', 'card-fly-up', 'card-fly-down', 'card-snap-back');
    card.style.transition = 'none';
    card.style.opacity    = '0';
    card.style.transform  = 'translateY(52px) scale(0.93)'; // always start from below

    // Double rAF: first commits the reset, second starts the transition
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Spring float — overshoots slightly then settles (the "floating" feel)
        card.style.transition = 'opacity 0.18s ease, transform 0.38s cubic-bezier(0.34, 1.4, 0.64, 1)';
        card.style.opacity    = '1';
        card.style.transform  = 'translateY(0) scale(1)';

        // Sync ghost heights
        const h  = card.offsetHeight;
        const g1 = document.getElementById('ghost-card-1');
        const g2 = document.getElementById('ghost-card-2');
        if (g1) g1.style.height = h + 'px';
        if (g2) g2.style.height = h + 'px';
      });
    });

    // Re-init swipe engine after entrance begins
    SwipeEngine.destroy();
    setTimeout(() => {
      // In sprint mode, swap overlay text and callbacks
      const overlayRightEl = DOM.overlayRight;
      const overlayLeftEl  = DOM.overlayLeft;

      if (State.sprintMode) {
        if (overlayRightEl) overlayRightEl.innerHTML = '';
        if (overlayLeftEl)  overlayLeftEl.innerHTML  = '';
      } else {
        if (overlayRightEl) overlayRightEl.innerHTML = '';
        if (overlayLeftEl)  overlayLeftEl.innerHTML  = '';
      }

      SwipeEngine.init(DOM.activeCard, {
        right: DOM.overlayRight,
        left:  DOM.overlayLeft,
        up:    DOM.overlayUp,
        down:  DOM.overlayDown,
      }, State.sprintMode ? {
        // Sprint swipe callbacks — tap does nothing (no reveal)
        onSwipeRight: () => _sprintCardAction(true),
        onSwipeLeft:  () => _sprintCardAction(false),
        onTap:        () => {},   // intentionally disabled
      } : {
        onSwipeDown:  () => _flipCard(),
        onSwipeUp:    () => _handleSave(question),
        onSwipeRight: () => _handleSkip(question),
        onSwipeLeft:  () => _handleSkip(question),
        onTap:        () => _flipCard(),
      });
    }, 80);
  }

  _updateDailyProgress();
}

// ── Show/hide back & forward arrows based on stack position ──
function _updateArrows() {
  const canBack = State.stackPos > 0;
  const canFwd  = State.stackPos >= 0 && State.stackPos < State.sessionStack.length - 1;
  DOM.btnCardBack?.classList.toggle('hidden', !canBack);
  DOM.btnCardFwd?.classList.toggle('hidden',  !canFwd);
}

// ── Navigate back one card in session stack ──
function _goCardBack() {
  if (State.stackPos <= 0) return;
  State.stackPos--;
  const entry = State.sessionStack[State.stackPos];
  State.currentIndex = entry.index;
  TG.Haptic.light();
  _renderCard(entry.question, true);
}

// ── Navigate forward one card in session stack ──
function _goCardFwd() {
  if (State.stackPos >= State.sessionStack.length - 1) return;
  State.stackPos++;
  const entry = State.sessionStack[State.stackPos];
  State.currentIndex = entry.index;
  TG.Haptic.light();
  _renderCard(entry.question, true);
}

function _flipCard() {
  // Block flipping during sprint — answers are hidden intentionally
  if (State.sprintMode) return;

  State.isFlipped = !State.isFlipped;
  DOM.cardInner?.classList.toggle('flipped', State.isFlipped);
  TG.Haptic.light();

  // Hide swipe guide permanently after first interaction
  if (!ls_get(LS.GUIDE_SHOWN)) {
    ls_set(LS.GUIDE_SHOWN, true);
    DOM.swipeGuide?.classList.add('hidden');
  }
}

// ════════════════════════════════════════════════════════════════
//  SWIPE HANDLERS
// ════════════════════════════════════════════════════════════════

// ── Build HTML for ★ bullet-point questions ───────────────────
// All points rendered immediately — each on its own line
function _buildBulletHTML(points) {
  return points.map(pt =>
    `<div class="bullet-line bullet-visible">` +
      `<span class="bullet-star">★</span>` +
      `<span class="bullet-text">${_escHtml(pt)}</span>` +
    `</div>`
  ).join('');
}

// ── Record card action to history ────────────────────────────
function _recordHistory(question, action) {
  // action: 'done' | 'skipped' | 'saved'
  try {
    const history = ls_get(LS.HISTORY, []);
    const filtered = history.filter(h => h.id !== question.id); // replace if seen before
    filtered.unshift({
      id:       question.id,
      question: question.question,
      answer:   question.answer,
      category: question.category || '',
      action,
      ts: Date.now(),
    });
    ls_set(LS.HISTORY, filtered.slice(0, 500)); // keep max 500
  } catch(e) {}
}

function _handleNext(question) {
  // "Got it" — mark seen, load next
  _recordHistory(question, 'done');
  markSeen(question.id);
  const targetHit = _incrementDailyDone();
  TG.Haptic.success();
  if (targetHit) { setTimeout(_showDailyTargetCelebration, 200); return; }
  setTimeout(loadNextCard, 110);
}

function _handleSkip(question) {
  _recordHistory(question, 'skipped');
  skipCard(question.id);
  markSeen(question.id);
  const targetHit = _incrementDailyDone();
  if (targetHit) { setTimeout(_showDailyTargetCelebration, 200); return; }
  setTimeout(loadNextCard, 110);
}

function _handleSave(question) {
  _recordHistory(question, 'saved');
  saveCard(question);
  markSeen(question.id);
  const targetHit = _incrementDailyDone();
  if (targetHit) { setTimeout(_showDailyTargetCelebration, 200); return; }
  setTimeout(loadNextCard, 110);
}

// ════════════════════════════════════════════════════════════════
//  DAILY PROGRESS UI
// ════════════════════════════════════════════════════════════════

function _updateDailyProgress() {
  const total   = State.dailyCards.length;
  const current = State.currentIndex + 1;
  const pct     = Math.round((State.currentIndex / Math.max(total, 1)) * 100);

  if (DOM.dailyCount)
    DOM.dailyCount.textContent = `${current} / ${total}`;
  if (DOM.dailyProgressFill)
    DOM.dailyProgressFill.style.width = `${pct}%`;
}

// ════════════════════════════════════════════════════════════════
//  COMPLETION SCREEN
// ════════════════════════════════════════════════════════════════

function _showCompletion() {
  TG.Haptic.success();
  _updateStats();

  const stats = ls_get(LS.STATS, { streak: 0 });

  if (DOM.compSaved)    DOM.compSaved.textContent    = State.sessionSaved;
  if (DOM.compSkipped)  DOM.compSkipped.textContent  = State.sessionSkipped;
  if (DOM.compStreak)   DOM.compStreak.textContent   = stats.streak;

  DOM.completionScreen?.classList.remove('hidden');
  DOM.cardArena?.classList.add('hidden');

  // Update progress tab too
  renderProgressTab();
}

// ════════════════════════════════════════════════════════════════
//  TAB NAVIGATION
// ════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════
//  SUBJECT PICKER
// ════════════════════════════════════════════════════════════════

// Emoji icons per subject keyword (fallback = 📚)
const SUBJECT_ICONS = {
  'soil':        '🌱', 'agronomy':    '🌾', 'horticulture':'🍎',
  'crop':        '🌿', 'plant':       '🪴', 'seed':        '🌰',
  'irrigation':  '💧', 'water':       '💧', 'weather':     '🌤',
  'climate':     '🌍', 'environment': '🌿', 'ecology':     '🐾',
  'animal':      '🐄', 'livestock':   '🐄', 'veterinary':  '🩺',
  'dairy':       '🥛', 'poultry':     '🐓', 'fishery':     '🐟',
  'fish':        '🐟', 'aqua':        '🐠', 'economic':    '📈',
  'economy':     '📈', 'finance':     '💰', 'market':      '🏪',
  'policy':      '📋', 'scheme':      '📋', 'government':  '🏛',
  'polity':      '🏛', 'science':     '🔬', 'technology':  '💻',
  'defence':     '🛡', 'military':    '🛡', 'geography':   '🗺',
  'history':     '📜', 'education':   '🎓', 'transport':   '🚆',
  'health':      '🏥', 'disease':     '🦠', 'nutrition':   '🥗',
  'food':        '🍱', 'survey':      '📊', 'statistics':  '📊',
  'extension':   '📡', 'research':    '🔭', 'general':     '📚',
  'all':         '⚡',
};

function _subjectIcon(name) {
  const lower = name.toLowerCase();
  for (const [key, icon] of Object.entries(SUBJECT_ICONS)) {
    if (lower.includes(key)) return icon;
  }
  return '📚';
}

// Cycle of accent colours for variety
const SUBJECT_COLORS = [
  '#00E5FF','#00E676','#FFAB00','#FF5252',
  '#7C4DFF','#FF6D00','#00BCD4','#69F0AE',
  '#FF4081','#40C4FF','#B2FF59','#FFD740',
];

function renderSubjectPicker() {
  const grid = DOM.subjectGrid;
  if (!grid) return;
  grid.innerHTML = '';

  // Get unique categories and count questions per category
  const counts = {};
  State.allQuestions.forEach(q => {
    const cat = q.category || 'General';
    counts[cat] = (counts[cat] || 0) + 1;
  });

  const subjects = Object.keys(counts).sort();

  // "All Subjects" card first
  const allCard = _makeSubjectCard(
    'All Subjects', State.allQuestions.length,
    '⚡', '#00E5FF', true, false
  );
  allCard.addEventListener('click', () => selectSubject('__ALL__'));
  grid.appendChild(allCard);

  // One card per subject — detect if it has subcategories to show Topics badge
  subjects.forEach((subject, i) => {
    const color  = SUBJECT_COLORS[i % SUBJECT_COLORS.length];
    const icon   = _subjectIcon(subject);
    const hasSub = State.allQuestions.some(
      q => q.category === subject && q.subcategory && q.subcategory.trim() !== ''
    );
    const card = _makeSubjectCard(subject, counts[subject], icon, color, false, hasSub);
    card.addEventListener('click', () => selectSubject(subject));
    grid.appendChild(card);
  });
}

function _makeSubjectCard(name, count, icon, color, isAll, hasSub) {
  const el = document.createElement('div');
  el.className = 'subject-card' + (isAll ? ' all-card' : '') + (hasSub ? ' has-sub' : '');
  el.style.setProperty('--card-accent', color);
  el.innerHTML = `
    <div class="subject-card-top-row">
      <div class="subject-card-icon">${icon}</div>
      ${hasSub ? '<span class="subcat-badge">Topics ›</span>' : ''}
    </div>
    <div class="subject-card-name">${_escHtml(name)}</div>
    <div class="subject-card-count">${count} question${count !== 1 ? 's' : ''}</div>
  `;
  return el;
}

function selectSubject(subject) {
  TG.Haptic.medium();

  // ── Check if this category has any subcategories ─────────────
  if (subject !== '__ALL__') {
    const catQuestions = State.allQuestions.filter(q => q.category === subject);
    const subNames = [...new Set(
      catQuestions.map(q => q.subcategory).filter(s => s && s.trim() !== '')
    )];

    if (subNames.length > 0) {
      // Has subcategories → show subcategory picker instead of going to questions
      showSubcategoryPicker(subject, catQuestions, subNames);
      return;
    }
  }

  // ── No subcategories → go directly to questions ───────────────
  _launchQuestions(subject, null);
}

// ── Show the subcategory grid for a given parent category ─────
function showSubcategoryPicker(parentCategory, catQuestions, subNames) {
  TG.Haptic.select();

  // Hide subject picker, show subcategory picker
  DOM.subjectPicker?.classList.add('hidden');
  DOM.subcategoryPicker?.classList.remove('hidden');

  // Set header text
  if (DOM.subcatTitle) DOM.subcatTitle.textContent = parentCategory;
  if (DOM.subcatParentLabel) DOM.subcatParentLabel.textContent = `${catQuestions.length} question${catQuestions.length !== 1 ? 's' : ''}`;

  const grid = DOM.subcategoryGrid;
  if (!grid) return;
  grid.innerHTML = '';

  // Count questions per subcategory
  const counts = {};
  catQuestions.forEach(q => {
    const sub = q.subcategory && q.subcategory.trim() ? q.subcategory : '__NONE__';
    counts[sub] = (counts[sub] || 0) + 1;
  });

  // "All in [Category]" card first
  const allCard = _makeSubjectCard(
    `All in ${parentCategory}`, catQuestions.length, '⚡', '#00E5FF', true
  );
  allCard.addEventListener('click', () => _launchQuestions(parentCategory, '__ALL_SUBS__'));
  grid.appendChild(allCard);

  // One card per subcategory
  subNames.sort().forEach((sub, i) => {
    const color = SUBJECT_COLORS[i % SUBJECT_COLORS.length];
    const icon  = _subjectIcon(sub);
    const count = counts[sub] || 0;
    const card  = _makeSubjectCard(sub, count, icon, color, false);
    card.addEventListener('click', () => _launchQuestions(parentCategory, sub));
    grid.appendChild(card);
  });

  // Back → subject picker
  TG.pushBack(() => {
    DOM.subcategoryPicker?.classList.add('hidden');
    DOM.subjectPicker?.classList.remove('hidden');
    TG.popBack();
  });
}

// ── Core launcher: filters pool and starts swipe/cram ─────────
function _launchQuestions(category, subcategory) {
  TG.Haptic.medium();
  State.activeSubject    = category;
  State.activeSubcategory = subcategory;
  State.currentIndex     = 0;
  State.sessionSaved     = 0;
  State.sessionSkipped   = 0;
  State.sessionStack     = [];
  State.stackPos         = -1;

  // Build pool based on category + subcategory filter
  let pool;
  if (category === '__ALL__') {
    pool = shuffle([...State.allQuestions]);
  } else if (subcategory === '__ALL_SUBS__' || subcategory === null) {
    pool = shuffle(State.allQuestions.filter(q => q.category === category));
  } else {
    pool = shuffle(State.allQuestions.filter(
      q => q.category === category && q.subcategory === subcategory
    ));
  }

  if (pool.length === 0) {
    showToast('No questions found for this selection');
    return;
  }

  State.dailyCards = pool;

  // Label in card topbar
  if (DOM.activeSubjectName) {
    if (category === '__ALL__') {
      DOM.activeSubjectName.textContent = 'All Subjects';
    } else if (subcategory && subcategory !== '__ALL_SUBS__') {
      DOM.activeSubjectName.textContent = subcategory;
    } else {
      DOM.activeSubjectName.textContent = category;
    }
  }

  // Show card area, hide pickers
  DOM.subjectPicker?.classList.add('hidden');
  DOM.subcategoryPicker?.classList.add('hidden');
  DOM.cardArea?.classList.remove('hidden');

  // Back button behaviour:
  // If came from subcategory picker → back to subcategory picker
  // If came directly from subject picker (no subcategory) → back to subject picker
  if (subcategory !== null) {
    // Came via subcategory picker
    TG.pushBack(() => {
      SwipeEngine.destroy();
      State.activeSubject    = null;
      State.activeSubcategory = null;
      State.currentIndex     = 0;
      DOM.cardArena?.classList.remove('hidden');
      DOM.actionRow?.classList.remove('hidden');
      if (DOM.cramView) { DOM.cramView.classList.add('hidden'); DOM.cramView.innerHTML = ''; }
      DOM.cardArea?.classList.add('hidden');
      ['mock-category-view', 'mock-list-view', 'mock-arena', 'mock-results'].forEach(id => {
        document.getElementById(id)?.classList.add('hidden');
      });
      // Re-open subcategory picker for the parent category
      const catQuestions = State.allQuestions.filter(q => q.category === category);
      const subNames = [...new Set(
        catQuestions.map(q => q.subcategory).filter(s => s && s.trim() !== '')
      )];
      DOM.subjectPicker?.classList.add('hidden');
      showSubcategoryPicker(category, catQuestions, subNames);
    });
  } else {
    // Came directly (no subcategories) → back to subject picker
    TG.pushBack(() => showSubjectPicker());
  }

  if (State.cramMode) {
    DOM.cardArena?.classList.add('hidden');
    DOM.actionRow?.classList.add('hidden');
    DOM.sprintHud?.classList.add('hidden');
    DOM.swipeGuide?.classList.add('hidden');
    _renderCramView();
  } else {
    if (DOM.cramView) { DOM.cramView.classList.add('hidden'); DOM.cramView.innerHTML = ''; }
    DOM.cardArena?.classList.remove('hidden');
    DOM.actionRow?.classList.remove('hidden');
    _updateDailyProgress();
    _renderCard(State.dailyCards[0]);
  }
}

function showSubjectPicker() {
  // Stop any active swipe session
  SwipeEngine.destroy();
  State.activeSubject    = null;
  State.activeSubcategory = null;
  State.currentIndex     = 0;

  // ── Always restore tab bar (hidden during mock test) ─────────
  _showTabBar();

  // Always restore card arena visibility so swipe mode works next time
  DOM.cardArena?.classList.remove('hidden');
  DOM.actionRow?.classList.remove('hidden');

  // Clear cram view
  if (DOM.cramView) {
    DOM.cramView.classList.add('hidden');
    DOM.cramView.innerHTML = '';
  }

  DOM.cardArea?.classList.add('hidden');
  DOM.subcategoryPicker?.classList.add('hidden');

  // ── Hide all mock views so they never bleed through ──────────
  ['mock-category-view', 'mock-list-view', 'mock-arena', 'mock-results'].forEach(id => {
    document.getElementById(id)?.classList.add('hidden');
  });

  DOM.subjectPicker?.classList.remove('hidden');

  // Home screen = base level, clear all back handlers
  TG.clearBack();

  // Re-render so counts are fresh
  renderSubjectPicker();
  // Refresh Sunday Mega banner state
  _renderSundayMegaBanner();
  TG.Haptic.select();
}

// ════════════════════════════════════════════════════════════════
//  HISTORY TAB RENDERING
// ════════════════════════════════════════════════════════════════

let _historyFilter = 'all';
let _historySearchQuery = '';
let _savedSearchQuery   = '';

function renderSavedTab() {
  const raw   = ls_get(LS.SAVED, []);
  const query = _savedSearchQuery.trim().toLowerCase();

  const saved = query
    ? raw.filter(q =>
        q.question.toLowerCase().includes(query) ||
        q.answer.toLowerCase().includes(query)   ||
        (q.category || '').toLowerCase().includes(query)
      )
    : raw;

  if (DOM.savedCountLabel)
    DOM.savedCountLabel.textContent = query
      ? `${saved.length} of ${raw.length} card${raw.length !== 1 ? 's' : ''}`
      : `${raw.length} card${raw.length !== 1 ? 's' : ''}`;

  if (!DOM.savedList) return;
  DOM.savedList.innerHTML = '';

  // Hide quiz button when empty
  if (DOM.btnQuizSaved)
    DOM.btnQuizSaved.classList.toggle('hidden', raw.length === 0);

  // Hide/show WhatsApp dump button
  const dumpBtn = document.getElementById('btn-whatsapp-dump');
  if (dumpBtn) dumpBtn.classList.toggle('hidden', raw.length === 0);

  if (raw.length === 0) {
    DOM.savedEmpty?.classList.remove('hidden');
    DOM.savedList.classList.add('hidden');
    return;
  }

  DOM.savedEmpty?.classList.add('hidden');
  DOM.savedList.classList.remove('hidden');

  if (saved.length === 0 && query) {
    DOM.savedList.innerHTML = `<div class="search-no-results">
      <strong>No matches found</strong>
      Try a different search term
    </div>`;
    return;
  }

  saved.forEach((q, i) => {
    const item = document.createElement('div');
    item.className = 'saved-item';
    item.style.setProperty('--i', i);
    item.innerHTML = `
      <div class="saved-item-category">${_escHtml(q.category)}</div>
      <div class="saved-item-question">${_escHtml(q.question)}</div>
      <div class="saved-item-answer">${_escHtml(q.answer)}</div>
      <button class="saved-remove-btn" data-id="${q.id}" aria-label="Remove">✕</button>
    `;
    item.querySelector('.saved-remove-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      unsaveCard(q.id);
      TG.Haptic.light();
    });
    DOM.savedList.appendChild(item);
  });

  _updateSavedBadge(raw.length);
}

function renderHistoryTab() {
  const history = ls_get(LS.HISTORY, []);
  const query   = _historySearchQuery.trim().toLowerCase();

  // First apply action filter, then search filter
  let filtered = _historyFilter === 'all'
    ? history
    : history.filter(h => h.action === _historyFilter);

  if (query) {
    filtered = filtered.filter(h =>
      h.question.toLowerCase().includes(query) ||
      h.answer.toLowerCase().includes(query)   ||
      (h.category || '').toLowerCase().includes(query)
    );
  }

  if (DOM.historyCountLabel)
    DOM.historyCountLabel.textContent = query
      ? `${filtered.length} of ${history.length} card${history.length !== 1 ? 's' : ''}`
      : `${history.length} card${history.length !== 1 ? 's' : ''}`;

  document.querySelectorAll('.hist-filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === _historyFilter);
  });

  if (!DOM.historyList) return;
  DOM.historyList.innerHTML = '';

  const isEmpty = filtered.length === 0 && !query;
  DOM.historyEmpty?.classList.toggle('hidden', !isEmpty);
  DOM.historyList.classList.toggle('hidden', isEmpty);

  if (filtered.length === 0 && query) {
    DOM.historyList.innerHTML = `<div class="search-no-results">
      <strong>No matches found</strong>
      Try a different search term
    </div>`;
    return;
  }

  if (filtered.length === 0) return;

  filtered.forEach((h, i) => {
    const actionMeta = {
      done:    { label: '✓ Done',    cls: 'badge-done' },
      skipped: { label: '⏭ Skipped', cls: 'badge-skipped' },
      saved:   { label: '🔖 Saved',  cls: 'badge-saved' },
    }[h.action] || { label: h.action, cls: '' };

    const item = document.createElement('div');
    item.className = 'hist-item';
    item.style.setProperty('--i', i);
    item.innerHTML = `
      <div class="hist-item-top">
        <span class="hist-item-category">${_escHtml(h.category)}</span>
        <span class="hist-action-badge ${actionMeta.cls}">${actionMeta.label}</span>
      </div>
      <div class="hist-item-question">${_escHtml(h.question)}</div>
      <div class="hist-item-answer hidden" id="hist-ans-${i}">${_escHtml(h.answer)}</div>
      <button class="hist-toggle-btn" data-idx="${i}">Show Answer ▾</button>
    `;

    const toggleBtn = item.querySelector('.hist-toggle-btn');
    const ansEl     = item.querySelector(`#hist-ans-${i}`);
    toggleBtn.addEventListener('click', () => {
      const isHidden = ansEl.classList.toggle('hidden');
      toggleBtn.textContent = isHidden ? 'Show Answer ▾' : 'Hide Answer ▴';
      TG.Haptic.light();
    });

    DOM.historyList.appendChild(item);
  });
}

function _initHistoryFilters() {
  document.querySelectorAll('.hist-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _historyFilter = btn.dataset.filter;
      TG.Haptic.select();
      renderHistoryTab();
    });
  });
}

function _initTabs() {
  const tabs = [
    { btn: DOM.tabHome,     view: DOM.viewHome,     id: 'home' },
    { btn: DOM.tabSaved,    view: DOM.viewSaved,    id: 'saved' },
    { btn: DOM.tabHistory,  view: DOM.viewHistory,  id: 'history' },
    { btn: DOM.tabProgress, view: DOM.viewProgress, id: 'progress' },
  ];

  // ── Helper: actually perform the tab switch ──────────────────
  function _switchTab(btn, view, id) {
    tabs.forEach(t => {
      t.btn?.classList.remove('active');
      t.view?.classList.remove('active');
    });
    btn.classList.add('active');
    view?.classList.add('active');
    TG.Haptic.select();

    if (id === 'home') {
      showSubjectPicker(); // clearBack is inside showSubjectPicker
    } else {
      // Non-home tab: push back → go back to Cards tab
      TG.replaceBack(() => {
        DOM.tabHome?.click();
      });
      if (id === 'saved')    renderSavedTab();
      if (id === 'history')  renderHistoryTab();
      if (id === 'progress') renderProgressTab();
    }
  }

  tabs.forEach(({ btn, view, id }) => {
    if (!btn) return;
    btn.addEventListener('click', () => {
      // ── If mock test is actively running, ask first ───────────
      const arenaVisible = !document.getElementById('mock-arena')?.classList.contains('hidden');
      if (arenaVisible) {
        TG.confirm(
          'Leave the mock test? Your current progress will be lost.',
          () => {
            // Confirmed — stop test and switch tab
            clearInterval(MockData.timerInterval);
            MockData.history      = [];
            MockData.currentIndex = 0;
            _switchTab(btn, view, id);
          }
          // Cancelled — do nothing, stay in test
        );
        return; // block the switch until confirmed
      }

      _switchTab(btn, view, id);
    });
  });

  _initHistoryFilters();
  _initSearchBars();
}

// ── Search bar wiring ────────────────────────────────────────
function _initSearchBars() {
  // ── Saved search ──────────────────────────────────────────
  const savedInput = DOM.savedSearch;
  const savedClear = DOM.savedSearchClear;
  if (savedInput) {
    savedInput.addEventListener('input', () => {
      _savedSearchQuery = savedInput.value;
      savedClear?.classList.toggle('hidden', !savedInput.value);
      renderSavedTab();
    });
    savedInput.addEventListener('keydown', e => {
      if (e.key === 'Escape') { savedInput.value = ''; savedInput.dispatchEvent(new Event('input')); }
    });
  }
  if (savedClear) {
    savedClear.addEventListener('click', () => {
      savedInput.value = '';
      _savedSearchQuery = '';
      savedClear.classList.add('hidden');
      savedInput.focus();
      renderSavedTab();
      TG.Haptic.light();
    });
  }

  // ── History search ────────────────────────────────────────
  const histInput = DOM.historySearch;
  const histClear = DOM.historySearchClear;
  if (histInput) {
    histInput.addEventListener('input', () => {
      _historySearchQuery = histInput.value;
      histClear?.classList.toggle('hidden', !histInput.value);
      renderHistoryTab();
    });
    histInput.addEventListener('keydown', e => {
      if (e.key === 'Escape') { histInput.value = ''; histInput.dispatchEvent(new Event('input')); }
    });
  }
  if (histClear) {
    histClear.addEventListener('click', () => {
      histInput.value = '';
      _historySearchQuery = '';
      histClear.classList.add('hidden');
      histInput.focus();
      renderHistoryTab();
      TG.Haptic.light();
    });
  }
}

// ════════════════════════════════════════════════════════════════
//  FEATURE: 50-CARD SPRINT MODE
// ════════════════════════════════════════════════════════════════

const SPRINT_CARDS    = 50;
const SPRINT_SECONDS  = 600; // 10 minutes

// ── 50-CARD SPRINT ──────────────────────────────────────────

function startSprint() {
  const pool = shuffle([...State.allQuestions]);
  if (pool.length === 0) {
    showToast('No cards available!');
    return;
  }

  TG.Haptic.heavy();

  // ── Initialise sprint state ──────────────────────────────
  State.sprintMode         = true;
  State.sprintKnown        = 0;
  State.sprintUnknown      = 0;
  State.sprintKnownCards   = [];
  State.sprintUnknownCards = [];
  State.sprintSecondsLeft  = SPRINT_SECONDS;
  State.sprintTarget       = Math.min(SPRINT_CARDS, pool.length);
  State.currentIndex       = 0;
  State.sessionStack       = [];
  State.stackPos           = -1;
  State.dailyCards         = pool.slice(0, State.sprintTarget);

  // ── Switch UI to card area ────────────────────────────────
  if (DOM.activeSubjectName)
    DOM.activeSubjectName.textContent = '⚡ 50-Card Sprint';

  DOM.subjectPicker?.classList.add('hidden');
  DOM.sprintResult?.classList.add('hidden');
  DOM.cardArea?.classList.remove('hidden');

  // Back → subject picker
  TG.pushBack(() => showSubjectPicker());

  // ── Swap action rows ──────────────────────────────────────
  DOM.actionRow?.classList.add('hidden');
  DOM.sprintActionRow?.classList.remove('hidden');

  // ── Show HUD, hide normal progress ───────────────────────
  DOM.sprintHud?.classList.remove('hidden');

  // ── Start countdown timer ─────────────────────────────────
  _sprintHudUpdate();
  clearInterval(State.sprintTimerInterval);
  State.sprintTimerInterval = setInterval(_sprintTick, 1000);

  // ── Render first card ─────────────────────────────────────
  _renderCard(State.dailyCards[0]);
  showToast('⚡ Sprint started! Right = Know It, Left = Don\'t Know', 3000);
}

function _sprintTick() {
  State.sprintSecondsLeft--;
  _sprintHudUpdate();

  if (State.sprintSecondsLeft <= 0) {
    clearInterval(State.sprintTimerInterval);
    showToast("⏱ Time's up!", 2000);
    TG.Haptic.warning();
    setTimeout(_endSprint, 600);
  } else if (State.sprintSecondsLeft === 60) {
    showToast('⚡ 1 minute left!', 2000);
    TG.Haptic.medium();
  } else if (State.sprintSecondsLeft === 30) {
    TG.Haptic.heavy();
  }
}

function _sprintHudUpdate() {
  const s   = State.sprintSecondsLeft;
  const min = Math.floor(s / 60).toString().padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  const timeStr = `${min}:${sec}`;

  if (DOM.sprintHudTimer) {
    DOM.sprintHudTimer.textContent = timeStr;
    DOM.sprintHudTimer.classList.toggle('urgent', s <= 30);
  }

  const done = State.sprintKnown + State.sprintUnknown;
  if (DOM.sprintHudCount)
    DOM.sprintHudCount.textContent = `${done} / ${State.sprintTarget}`;
  if (DOM.sprintHudKnown)
    DOM.sprintHudKnown.textContent = `${State.sprintKnown} ✓`;
  if (DOM.sprintHudUnknown)
    DOM.sprintHudUnknown.textContent = `${State.sprintUnknown} ✗`;
}

// Called by swipe engine callbacks — score is already committed, just update + advance
function _sprintCardAction(knew) {
  if (!State.sprintMode) return;

  const card = State.dailyCards[State.currentIndex];

  if (knew) {
    State.sprintKnown++;
    State.sprintKnownCards.push(card);
    TG.Haptic.success();
  } else {
    State.sprintUnknown++;
    State.sprintUnknownCards.push(card);
    TG.Haptic.light();
  }

  _sprintHudUpdate();

  const done = State.sprintKnown + State.sprintUnknown;
  if (done >= State.sprintTarget) {
    clearInterval(State.sprintTimerInterval);
    setTimeout(_endSprint, 300);
  } else {
    setTimeout(() => {
      State.currentIndex++;
      _updateDailyProgress();
      _renderCard(State.dailyCards[State.currentIndex]);
    }, 110);
  }
}

function _endSprint() {
  clearInterval(State.sprintTimerInterval);
  State.sprintMode = false;

  const total = State.sprintKnown + State.sprintUnknown;
  const pct   = total > 0
    ? Math.round((State.sprintKnown / total) * 100)
    : 0;

  // ── Populate summary stats ─────────────────────────────────
  if (DOM.sprintResultPct)  DOM.sprintResultPct.textContent  = `${pct}%`;
  if (DOM.sprintRsKnown)    DOM.sprintRsKnown.textContent    = State.sprintKnown;
  if (DOM.sprintRsUnknown)  DOM.sprintRsUnknown.textContent  = State.sprintUnknown;
  if (DOM.sprintRsTotal)    DOM.sprintRsTotal.textContent    = total;

  // ── Render Known card list ─────────────────────────────────
  const knownList   = document.getElementById('sprint-known-list');
  const unknownList = document.getElementById('sprint-unknown-list');
  const knownHeader = document.getElementById('sprint-known-header');
  const unknownHeader = document.getElementById('sprint-unknown-header');

  if (knownHeader)
    knownHeader.textContent = `✓ Known — ${State.sprintKnown} card${State.sprintKnown !== 1 ? 's' : ''}`;
  if (unknownHeader)
    unknownHeader.textContent = `✗ Don't Know — ${State.sprintUnknown} card${State.sprintUnknown !== 1 ? 's' : ''}`;

  _renderSprintCardList(knownList,   State.sprintKnownCards,   'known');
  _renderSprintCardList(unknownList, State.sprintUnknownCards, 'unknown');

  // ── Show result, hide card area ───────────────────────────
  DOM.cardArea?.classList.add('hidden');
  DOM.sprintResult?.classList.remove('hidden');

  // ── Restore UI to normal state ────────────────────────────
  DOM.sprintHud?.classList.add('hidden');
  DOM.actionRow?.classList.remove('hidden');
  DOM.sprintActionRow?.classList.add('hidden');

  SwipeEngine.destroy();
  TG.Haptic.success();
}

function _renderSprintCardList(containerEl, cards, type) {
  if (!containerEl) return;
  containerEl.innerHTML = '';

  if (cards.length === 0) {
    containerEl.innerHTML = `<div class="sprint-review-empty">
      ${type === 'known' ? '🎉 None to review here!' : '✨ You knew them all!'}
    </div>`;
    return;
  }

  cards.forEach((q, i) => {
    const item = document.createElement('div');
    item.className = `sprint-review-card sprint-review-${type}`;
    item.style.setProperty('--i', i);
    item.innerHTML = `
      <div class="sprint-review-category">${_escHtml(q.category || 'General')}</div>
      <div class="sprint-review-question">${_escHtml(q.question)}</div>
      <div class="sprint-review-answer">${_escHtml(q.answer)}</div>
    `;
    containerEl.appendChild(item);
  });
}

function _exitSprint() {
  clearInterval(State.sprintTimerInterval);
  State.sprintMode = false;

  // Hide result screen + card area
  DOM.sprintResult?.classList.add('hidden');
  DOM.cardArea?.classList.add('hidden');

  // Restore normal UI bits
  DOM.sprintHud?.classList.add('hidden');
  DOM.actionRow?.classList.remove('hidden');
  DOM.sprintActionRow?.classList.add('hidden');

  SwipeEngine.destroy();
  showSubjectPicker();
}

function startSavedQuiz() {
  const saved = ls_get(LS.SAVED, []);
  if (saved.length === 0) {
    showToast('No saved cards to quiz!');
    return;
  }

  TG.Haptic.medium();

  // Reset search so user sees the full deck they're quizzing
  _savedSearchQuery = '';
  if (DOM.savedSearch)       DOM.savedSearch.value = '';
  if (DOM.savedSearchClear)  DOM.savedSearchClear.classList.add('hidden');

  // Switch to the Home/Cards tab
  DOM.tabHome?.click();

  // Brief delay so the tab transition completes, then launch the subject
  setTimeout(() => {
    State.activeSubject  = '__SAVED_QUIZ__';
    State.currentIndex   = 0;
    State.sessionSaved   = 0;
    State.sessionSkipped = 0;
    State.sessionStack   = [];
    State.stackPos       = -1;

    const pool = shuffle([...saved]);
    State.dailyCards = pool;

    if (DOM.activeSubjectName)
      DOM.activeSubjectName.textContent = '🔖 Saved Quiz';

    DOM.subjectPicker?.classList.add('hidden');
    DOM.cardArea?.classList.remove('hidden');

    // Back → subject picker
    TG.pushBack(() => showSubjectPicker());
    _renderCard(State.dailyCards[0]);
    showToast(`🎯 Quizzing ${pool.length} saved card${pool.length !== 1 ? 's' : ''}!`, 2200);
  }, 120);
}

// ════════════════════════════════════════════════════════════════
//  DAILY TARGET SETTER
// ════════════════════════════════════════════════════════════════

const DTR_CIRCUMFERENCE = 2 * Math.PI * 34; // 213.6px  (r=34 in SVG)

/** How many cards has the user actioned today? */
function _getDailyDoneCount() {
  const rec = ls_get(LS.DAILY_DONE, { date: '', count: 0 });
  if (rec.date !== today()) return 0;
  return rec.count || 0;
}

/** Increment today's done count by 1.
 *  Returns true if this increment caused the daily target to be hit
 *  for the first time (i.e. crossed from below to at/above). */
function _incrementDailyDone() {
  const target  = ls_get(LS.DAILY_TARGET, 25);
  const rec     = ls_get(LS.DAILY_DONE, { date: '', count: 0 });
  const prev    = rec.date === today() ? (rec.count || 0) : 0;
  const count   = prev + 1;
  ls_set(LS.DAILY_DONE, { date: today(), count });
  // Fire celebration only at the exact crossing point
  return prev < target && count >= target;
}

/** Render the ring, bar, status text and preset highlights */
function _updateDailyTarget() {
  const target = ls_get(LS.DAILY_TARGET, 25);
  const done   = _getDailyDoneCount();
  const pct    = Math.min(Math.round((done / Math.max(target, 1)) * 100), 100);
  const complete = done >= target;

  // ── Ring ──────────────────────────────────────────────────
  const circle = DOM.dtrFillCircle;
  if (circle) {
    const offset = DTR_CIRCUMFERENCE - (pct / 100) * DTR_CIRCUMFERENCE;
    circle.style.strokeDashoffset = offset;
    circle.classList.toggle('complete', complete);
  }
  if (DOM.dtrPct) DOM.dtrPct.textContent = pct + '%';

  // ── Progress bar ──────────────────────────────────────────
  if (DOM.dtrBarFill) {
    DOM.dtrBarFill.style.width = pct + '%';
    DOM.dtrBarFill.classList.toggle('complete', complete);
  }

  // ── Labels ────────────────────────────────────────────────
  if (DOM.dtrGoalVal)    DOM.dtrGoalVal.textContent    = target + ' cards';
  if (DOM.dtrTodayCount) DOM.dtrTodayCount.textContent = done + ' done today';

  if (DOM.dtrStatus) {
    if (complete) {
      DOM.dtrStatus.textContent = '🎉 Target reached! Amazing!';
      DOM.dtrStatus.style.color = 'var(--green)';
    } else {
      const left = target - done;
      DOM.dtrStatus.textContent = left + ' more to go 💪';
      DOM.dtrStatus.style.color = '';
    }
  }

  // ── Highlight active preset button ────────────────────────
  document.querySelectorAll('.dtr-preset-btn[data-target]').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.target) === target);
  });
}

/** Wire up preset buttons, custom input, and set button */
function _initDailyTarget() {
  // Preset quick-pick buttons
  document.querySelectorAll('.dtr-preset-btn[data-target]').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = parseInt(btn.dataset.target);
      ls_set(LS.DAILY_TARGET, t);
      // Hide custom row if open
      DOM.dtrCustomRow?.classList.add('hidden');
      TG.Haptic.select();
      _updateDailyTarget();
    });
  });

  // "Custom" button toggles the input row
  DOM.dtrCustomBtn?.addEventListener('click', () => {
    const hidden = DOM.dtrCustomRow?.classList.toggle('hidden');
    if (!hidden) {
      DOM.dtrCustomInput?.focus();
    }
    TG.Haptic.light();
  });

  // Set button — reads the custom input
  DOM.dtrSetBtn?.addEventListener('click', () => {
    const val = parseInt(DOM.dtrCustomInput?.value || '0');
    if (val >= 1 && val <= 9999) {
      ls_set(LS.DAILY_TARGET, val);
      DOM.dtrCustomRow?.classList.add('hidden');
      TG.Haptic.success();
      _updateDailyTarget();
      showToast('🎯 Daily target set to ' + val + ' cards!');
    } else {
      showToast('Enter a number between 1 and 9999');
      TG.Haptic.error();
    }
  });

  // Allow pressing Enter on the input
  DOM.dtrCustomInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') DOM.dtrSetBtn?.click();
  });

  // Initial render
  _updateDailyTarget();
}

// ════════════════════════════════════════════════════════════════
//  DAILY TARGET CELEBRATION  🎉
// ════════════════════════════════════════════════════════════════

function _showDailyTargetCelebration() {
  const target = ls_get(LS.DAILY_TARGET, 25);
  TG.Haptic.heavy();

  // ── Build overlay ────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.className = 'dtc-overlay';
  overlay.innerHTML = `
    <canvas class="dtc-canvas" id="dtc-canvas"></canvas>
    <div class="dtc-card">
      <div class="dtc-icon">🏆</div>
      <h2 class="dtc-title">Daily Target Complete!</h2>
      <p class="dtc-sub">You studied <strong>${target} cards</strong> today.<br>That's a huge step towards your goal! 🌾</p>
      <div class="dtc-streak-row">
        <span class="dtc-streak-icon">🔥</span>
        <span class="dtc-streak-val">${ls_get(LS.STATS, {streak:0}).streak || 1} Day Streak</span>
      </div>
      <button class="dtc-continue-btn" id="dtc-continue-btn">Continue Studying →</button>
      <button class="dtc-done-btn"     id="dtc-done-btn">I'm done for today ✓</button>
    </div>
  `;
  document.body.appendChild(overlay);

  // Animate in
  requestAnimationFrame(() => overlay.classList.add('dtc-open'));

  // ── Canvas confetti ───────────────────────────────────────────
  const canvas = document.getElementById('dtc-canvas');
  const ctx    = canvas.getContext('2d');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  const COLORS = ['#00E5FF','#00E676','#FFAB00','#FF5252','#7C4DFF','#FF6D00','#69F0AE','#40C4FF'];
  const pieces = Array.from({ length: 120 }, () => ({
    x:     Math.random() * canvas.width,
    y:     Math.random() * canvas.height * -1,   // start above screen
    w:     6  + Math.random() * 8,
    h:     10 + Math.random() * 6,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    rot:   Math.random() * Math.PI * 2,
    vx:    (Math.random() - 0.5) * 3,
    vy:    2 + Math.random() * 4,
    vr:    (Math.random() - 0.5) * 0.2,
    alpha: 1,
  }));

  let animId;
  function drawConfetti() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let allDone = true;
    pieces.forEach(p => {
      p.x   += p.vx;
      p.y   += p.vy;
      p.rot += p.vr;
      if (p.y > canvas.height * 0.6) p.alpha = Math.max(0, p.alpha - 0.012);
      if (p.alpha > 0) allDone = false;

      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    if (!allDone) animId = requestAnimationFrame(drawConfetti);
  }
  animId = requestAnimationFrame(drawConfetti);

  // ── Button handlers ───────────────────────────────────────────
  function _close(continueStudying) {
    cancelAnimationFrame(animId);
    overlay.classList.remove('dtc-open');
    overlay.classList.add('dtc-closing');
    TG.Haptic.select();
    setTimeout(() => {
      overlay.remove();
      if (continueStudying) {
        loadNextCard();
      }
    }, 320);
  }

  document.getElementById('dtc-continue-btn')?.addEventListener('click', () => _close(true),  { once: true });
  document.getElementById('dtc-done-btn')    ?.addEventListener('click', () => _close(false), { once: true });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) _close(false); });
}

// ════════════════════════════════════════════════════════════════
//  PROGRESS TAB RENDERING
// ════════════════════════════════════════════════════════════════

function renderProgressTab() {
  const stats  = ls_get(LS.STATS, { streak: 0, totalSeen: 0, daysActive: 0 });
  const saved  = ls_get(LS.SAVED, []);
  const todayStr = today();

  // Date label
  const d = new Date();
  if (DOM.todayDateLabel)
    DOM.todayDateLabel.textContent = d.toLocaleDateString('en-IN', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

  // Stats
  if (DOM.statStreak) DOM.statStreak.textContent = stats.streak      || 0;
  if (DOM.statTotal)  DOM.statTotal.textContent  = stats.totalSeen   || 0;
  if (DOM.statSaved)  DOM.statSaved.textContent  = saved.length;
  if (DOM.statDays)   DOM.statDays.textContent   = stats.daysActive  || 0;

  // Refresh user count display
  _initUserCount();

  // Daily target widget
  _updateDailyTarget();

  // Weekly heatmap
  _renderHeatmap();

  // Category breakdown
  _renderCategoryBars();
}

function _renderHeatmap() {
  if (!DOM.heatmap) return;
  DOM.heatmap.innerHTML = '';

  const dayNames  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const todayDate = new Date();
  const todayStr  = today();
  const dailyDate = ls_get(LS.DAILY_DATE, '');

  // Build last 7 days
  for (let i = 6; i >= 0; i--) {
    const d   = new Date(todayDate);
    d.setDate(d.getDate() - i);
    const ds  = d.toISOString().slice(0, 10);
    const isT = ds === todayStr;
    const done = ds === dailyDate && ls_get(LS.DAILY_INDEX, 0) >= CONFIG.CARDS_PER_DAY;

    const dayEl = document.createElement('div');
    dayEl.className = 'heatmap-day';
    dayEl.innerHTML = `
      <div class="heatmap-dot${done ? ' done' : ''}${isT ? ' today' : ''}">
        ${done ? '✓' : (isT ? '·' : '')}
      </div>
      <span class="heatmap-label">${dayNames[d.getDay()]}</span>
    `;
    DOM.heatmap.appendChild(dayEl);
  }
}

function _renderCategoryBars() {
  if (!DOM.categoryBars) return;

  const seen      = ls_get(LS.SEEN_IDS, []);
  const questions = ls_get(LS.QUESTIONS, []);

  // Count seen per category
  const seenSet = new Set(seen);
  const catCounts = {};
  let   maxCount  = 0;

  questions.forEach(q => {
    if (seenSet.has(q.id)) {
      catCounts[q.category] = (catCounts[q.category] || 0) + 1;
      maxCount = Math.max(maxCount, catCounts[q.category]);
    }
  });

  DOM.categoryBars.innerHTML = '';

  if (Object.keys(catCounts).length === 0) {
    DOM.categoryBars.innerHTML = `<p style="font-size:13px;color:var(--text-muted);">No categories seen yet.</p>`;
    return;
  }

  // Sort by count desc
  Object.entries(catCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .forEach(([cat, count]) => {
      const pct = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
      const row = document.createElement('div');
      row.className = 'cat-bar-row';
      row.innerHTML = `
        <span class="cat-bar-label">${_escHtml(cat)}</span>
        <div class="cat-bar-track">
          <div class="cat-bar-fill" style="width:0%" data-pct="${pct}"></div>
        </div>
        <span class="cat-bar-count">${count}</span>
      `;
      DOM.categoryBars.appendChild(row);
    });

  // Animate bars in
  requestAnimationFrame(() => {
    DOM.categoryBars.querySelectorAll('.cat-bar-fill').forEach(el => {
      el.style.width = el.dataset.pct + '%';
    });
  });
}

// ════════════════════════════════════════════════════════════════
//  AD SYSTEM (placeholder)
// ════════════════════════════════════════════════════════════════

function _initAds() {
  // Show ad after every N completions
  const COMPLETIONS_BEFORE_AD = 5;
  const completions = parseInt(localStorage.getItem('dca_completions') || '0', 10);

  if (completions > 0 && completions % COMPLETIONS_BEFORE_AD === 0) {
    DOM.adBanner?.classList.remove('hidden');
  }

  DOM.adClose?.addEventListener('click', () => {
    DOM.adBanner?.classList.add('hidden');
    TG.Haptic.light();
  });

  // Increment completion counter when user completes daily set
  const prev = parseInt(localStorage.getItem('dca_completions') || '0', 10);
  localStorage.setItem('dca_completions', prev + 1);
}

// ════════════════════════════════════════════════════════════════
//  ACTION BUTTONS
// ════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════
//  MANUAL REFRESH  — Update button
// ════════════════════════════════════════════════════════════════

async function manualRefresh() {
  const btn = DOM.tabUpdate;
  if (!btn || btn.classList.contains('updating')) return;

  btn.classList.add('updating');
  TG.Haptic.medium();
  showToast('🔄 Fetching latest data…', 2000);

  // Clear both caches — card sheet + mock test sheet
  ls_remove(LS.QUESTIONS);
  ls_remove(LS.CACHE_TIME);
  MockData.allRows = [];   // force re-fetch next time Mock Tests is opened

  try {
    const fresh = await fetchQuestions();
    State.allQuestions = fresh;
    renderSubjectPicker();

    if (State.activeSubject) {
      const pool = State.activeSubject === '__ALL__'
        ? shuffle([...fresh])
        : shuffle(fresh.filter(q => q.category === State.activeSubject));
      if (pool.length > 0) {
        State.dailyCards   = pool;
        State.currentIndex = 0;
        _updateDailyProgress();
        _renderCard(State.dailyCards[0]);
      }
    }

    showToast(`✅ Updated! ${fresh.length} cards loaded. Mock tests will refresh on next open.`, 3000);
    TG.Haptic.success();
  } catch (err) {
    showToast('❌ Update failed — check connection', 3000);
    TG.Haptic.error();
  } finally {
    setTimeout(() => btn.classList.remove('updating'), 300);
  }
}

// ════════════════════════════════════════════════════════════════
//  REPO REFRESH — Forces fresh HTML/JS/CSS from GitHub Pages
//  Clears all SW caches + browser caches, then hard-reloads.
//  Called AFTER manualRefresh() so Google Sheets data is already
//  updated before the page reloads.
// ════════════════════════════════════════════════════════════════

async function _repoRefresh() {
  showToast('⚙️ Refreshing app files from server…', 2500);

  try {
    // 1. Clear ALL Cache Storage entries (service worker caches)
    if ('caches' in window) {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map(key => caches.delete(key)));
    }

    // 2. Tell the active service worker to update itself
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(reg => reg.update()));
    }
  } catch (e) {
    console.warn('[Repo] Cache/SW clear failed:', e);
  }

  // 3. Plain reload — keep the SAME URL so Telegram/browser never
  //    scopes localStorage to a different origin or session key.
  //    (Adding ?_v=timestamp caused Telegram's WebView to treat it
  //     as a fresh session, wiping mock-test progress from localStorage)
  setTimeout(() => location.reload(), 1800);
}

// ════════════════════════════════════════════════════════════════
//  SHARE CARD  _shareCard(question)
//  Shares the current card (Q + A) via native share sheet.
//  Falls back to WhatsApp direct if navigator.share not available.
// ════════════════════════════════════════════════════════════════

function _shareCard(question) {
  const text =
    `📚 *${question.category || 'Agriculture'}*\n\n` +
    `❓ *Q:* ${question.question}\n\n` +
    `✅ *Ans:* ${question.answer}\n\n` +
    `─────────────────────\n` +
    `🌾 Shared from *AGRIMETS* Swipe Cards\n` +
    `📲 Study smarter → ${APP_SHARE_URL}`;

  // 1. Try Telegram's own openLink (respects Mini App sandbox)
  if (window.Telegram?.WebApp?.openTelegramLink) {
    // Share via Telegram forward — not ideal for cross-app, fall through
  }

  // 2. Try Web Share API (native OS share sheet — WhatsApp, Telegram, Instagram, etc.)
  if (navigator.share) {
    navigator.share({
      title: 'AGRIMETS — ' + (question.category || 'Agriculture'),
      text,
    })
    .then(() => { TG.Haptic.success(); showToast('Shared! 🎉', 1800); })
    .catch(() => {}); // user cancelled — do nothing
    return;
  }

  // 3. Fallback: open WhatsApp share directly
  const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
  try {
    if (window.Telegram?.WebApp?.openLink) {
      window.Telegram.WebApp.openLink(waUrl);
    } else {
      window.open(waUrl, '_blank');
    }
  } catch (e) {
    window.open(waUrl, '_blank');
  }
}

function _initButtons() {
  // ── Update / Refresh data ───────────────────────────────────
  // First: refresh Google Sheets data (existing behaviour, unchanged)
  // Then:  bust GitHub Pages CDN cache and reload fresh app files
  DOM.tabUpdate?.addEventListener('click', async () => {
    await manualRefresh();
    await _repoRefresh();
  });
  // ── Back to subject picker ──────────────────────────────────
  DOM.btnBackSubjects?.addEventListener('click', () => {
    if (State.sprintMode) {
      // Cancel sprint mid-way — confirm first
      TG.confirm('Cancel this sprint?', () => _exitSprint());
    } else {
      showSubjectPicker();
    }
  });

  // ── Subcategory picker back button ─────────────────────────
  DOM.btnSubcatBack?.addEventListener('click', () => {
    TG.Haptic.light();
    DOM.subcategoryPicker?.classList.add('hidden');
    DOM.subjectPicker?.classList.remove('hidden');
    TG.popBack();
  });

  // ── Arena back / forward arrows ────────────────────────────
  DOM.btnCardBack?.addEventListener('click', () => _goCardBack());
  DOM.btnCardFwd?.addEventListener('click',  () => _goCardFwd());

  DOM.btnSkip?.addEventListener('click', () => {
    if (State.sprintMode) return;
    const q = State.dailyCards[State.currentIndex];
    if (!q) return;
    TG.Haptic.light();
    SwipeEngine.triggerSwipe('left');
  });

  DOM.btnFlip?.addEventListener('click', () => {
    if (State.sprintMode) return;
    _flipCard();
  });

  DOM.btnSave?.addEventListener('click', () => {
    if (State.sprintMode) return;
    const q = State.dailyCards[State.currentIndex];
    if (!q) return;
    TG.Haptic.medium();
    SwipeEngine.triggerSwipe('up');
  });

  DOM.btnNext?.addEventListener('click', () => {
    if (State.sprintMode) return;
    const q = State.dailyCards[State.currentIndex];
    if (!q) return;
    TG.Haptic.medium();
    _shareCard(q);
  });

  // ── Sprint: button-row Know It / Don't Know ────────────────
  // triggerSwipe fires the onSwipeRight/Left callback → _sprintCardAction
  // which handles score increment + advance. No double counting.
  DOM.btnSprintKnown?.addEventListener('click', () => {
    if (!State.sprintMode) return;
    TG.Haptic.success();
    SwipeEngine.triggerSwipe('right');
  });

  DOM.btnSprintUnknown?.addEventListener('click', () => {
    if (!State.sprintMode) return;
    TG.Haptic.light();
    SwipeEngine.triggerSwipe('left');
  });

  // ── Sprint: CTA button on subject picker ──────────────────
  DOM.btnSprintCta?.addEventListener('click', () => startSprint());

  // ── Sprint: result screen actions ─────────────────────────
  DOM.btnSprintAgain?.addEventListener('click', () => {
    TG.Haptic.medium();
    DOM.sprintResult?.classList.add('hidden');
    startSprint();
  });

  DOM.btnSprintHome?.addEventListener('click', () => {
    TG.Haptic.select();
    _exitSprint();
  });

  // ── Quiz My Saved Cards ────────────────────────────────────
  DOM.btnQuizSaved?.addEventListener('click', () => startSavedQuiz());

  // Completion → review saved
  DOM.btnReviewSaved?.addEventListener('click', () => {
    DOM.tabSaved?.click();
  });

  // Progress → reset
  DOM.btnReset?.addEventListener('click', () => {
    TG.confirm(
      'Reset all progress?\nThis will clear all seen cards, saved cards, and streak data.',
      () => {
        _resetAll();
        TG.Haptic.warning();
        showToast('🔄 Progress reset');
        setTimeout(() => location.reload(), 1000);
      }
    );
  });

  // Ad close
  DOM.adClose?.addEventListener('click', () => {
    DOM.adBanner?.classList.add('hidden');
  });
}

function _resetAll() {
  Object.values(LS).forEach(key => ls_remove(key));
}

// ════════════════════════════════════════════════════════════════
//  DEMO DATA (fallback when sheet is unreachable)
// ════════════════════════════════════════════════════════════════

function _getDemoData() {
  return [
    { id:'d1',  question:'Which country launched Chandrayaan-3?',          answer:'India',                   category:'Science' },
    { id:'d2',  question:'Who is the current RBI Governor?',               answer:'Shaktikanta Das',          category:'Economy' },
    { id:'d3',  question:'Which state is the largest producer of wheat?',  answer:'Uttar Pradesh',            category:'Geography' },
    { id:'d4',  question:'India\'s first indigenously built aircraft carrier?', answer:'INS Vikrant',         category:'Defence' },
    { id:'d5',  question:'PMGSY stands for?',                              answer:'Pradhan Mantri Gram Sadak Yojana', category:'Schemes' },
    { id:'d6',  question:'Which city hosts the BSE?',                      answer:'Mumbai',                   category:'Economy' },
    { id:'d7',  question:'Operation Sindoor target country?',              answer:'Pakistan',                 category:'Defence' },
    { id:'d8',  question:'Largest High Court in India by judges?',         answer:'Allahabad',                category:'Polity' },
    { id:'d9',  question:'National Farmers Day is observed on?',           answer:'23rd December',            category:'Agriculture' },
    { id:'d10', question:'Which district tops literacy in India?',         answer:'Serchhip, Mizoram',        category:'Education' },
    { id:'d11', question:'India\'s fastest train?',                        answer:'Vande Bharat Express',     category:'Transport' },
    { id:'d12', question:'Project Tiger was launched in?',                 answer:'1973',                     category:'Environment' },
    { id:'d13', question:'Headquarters of ISRO?',                         answer:'Bengaluru',                category:'Science' },
    { id:'d14', question:'Which river is called Ganges of South India?',   answer:'Kaveri (Cauvery)',         category:'Geography' },
    { id:'d15', question:'Who appoints India\'s Chief Justice?',           answer:'President of India',       category:'Polity' },
  ];
}

// ════════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════════

function _delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function _escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ════════════════════════════════════════════════════════════════
//  BOOT  — Entry point
// ════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════
//  CHANNEL JOIN POPUP
//  ► Change CHANNEL_URL to your actual Telegram channel/group link
// ════════════════════════════════════════════════════════════════

const CHANNEL_URL = 'https://t.me/AGRIMETS_OFFICIAL';

function _showChannelPopup() {
  const overlay = document.getElementById('channel-popup-overlay');
  const joinBtn = document.getElementById('channel-join-btn');
  const closeBtn = document.getElementById('channel-popup-close');
  const skipBtn  = document.getElementById('channel-skip-btn');

  if (!overlay) return;

  // Set the correct link
  if (joinBtn) joinBtn.href = CHANNEL_URL;

  // Show popup
  overlay.classList.remove('hidden');
  TG.Haptic.light();

  function _closePopup() {
    overlay.style.animation = 'none';
    overlay.style.opacity   = '0';
    overlay.style.transition = 'opacity 0.2s ease';
    setTimeout(() => overlay.classList.add('hidden'), 80);
    TG.Haptic.select();
  }

  // Close button (✕)
  closeBtn?.addEventListener('click', _closePopup, { once: true });

  // "Maybe later"
  skipBtn?.addEventListener('click', _closePopup, { once: true });

  // Join button — opens channel then closes popup
  joinBtn?.addEventListener('click', () => {
    TG.Haptic.medium();
    setTimeout(_closePopup, 120);
  }, { once: true });
}

// ════════════════════════════════════════════════════════════════
//  FIREBASE ENGINE — Real-time users, presence & shared leaderboard
//
//  DATA STRUCTURE in Firebase Realtime Database:
//  agrimets/
//    users/{uid}/
//      name        — display name
//      tg_id       — Telegram user ID (string) or "guest"
//      tg_username — Telegram @username (if available)
//      first_seen  — unix ms
//      last_seen   — unix ms
//    presence/{uid} — unix ms timestamp (updated every 60s while open)
//    leaderboard/{testKey}/{uid}/
//      name   — display name
//      score  — best score (number)
//      tg_id  — Telegram user ID
//      ts     — unix ms of best attempt
// ════════════════════════════════════════════════════════════════

const FB_ONLINE_TTL_MS = 3 * 60 * 1000;  // 3 min — considered "online"
const LB_MAX_ROWS      = 10;

// ── Identity helpers ──────────────────────────────────────────
//  These are required by all Firebase functions.

/** Returns a stable anonymous UID for this device.
 *  On first call generates a random ID and persists it to localStorage. */
function _getOrCreateUid() {
  const KEY = 'dca_uid';
  let uid = localStorage.getItem(KEY);
  if (!uid) {
    // Crypto-random 16-byte hex string
    uid = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    localStorage.setItem(KEY, uid);
  }
  return uid;
}

/** Returns the best available display name for the user:
 *  Telegram first_name → username → stored name → "Student" */
function _getUserDisplayName() {
  const tgUser = TG.getUser?.();
  if (tgUser?.first_name) {
    return [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ');
  }
  if (tgUser?.username) return '@' + tgUser.username;
  // Fall back to locally stored name (set during earlier sessions)
  const stored = localStorage.getItem('dca_display_name');
  if (stored) return stored;
  return 'Student';
}

// ── Low-level Firebase REST helpers ──────────────────────────

/** PATCH (merge) data at a Firebase path */
async function _fbPatch(path, data) {
  if (!CONFIG.FB_URL) return null;
  try {
    const res = await fetch(`${CONFIG.FB_URL}/${path}.json`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data),
    });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

/** PUT (overwrite) data at a Firebase path */
async function _fbPut(path, data) {
  if (!CONFIG.FB_URL) return null;
  try {
    const res = await fetch(`${CONFIG.FB_URL}/${path}.json`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data),
    });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

/** GET data at a Firebase path. Returns parsed JSON or null. */
async function _fbGet(path, params = '') {
  if (!CONFIG.FB_URL) return null;
  try {
    const res = await fetch(`${CONFIG.FB_URL}/${path}.json${params}`, {
      cache: 'no-store',
    });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

// ── User registry ─────────────────────────────────────────────
//  Registers this user on first open and updates last_seen on
//  every subsequent open. Stores Telegram ID + name.

async function _fbRegisterUser() {
  const uid     = _getOrCreateUid();
  const name    = _getUserDisplayName();
  const tgUser  = TG.getUser?.();
  const tg_id   = tgUser?.id ? String(tgUser.id) : 'guest';
  const tg_un   = tgUser?.username || '';

  const now = Date.now();

  // Check if already registered (use cached flag to avoid re-fetch every open)
  const firstSeenKey = 'fb_first_seen_' + uid;
  const alreadyReg   = ls_get(firstSeenKey, null);

  if (!alreadyReg) {
    // First time — write full record
    await _fbPatch(`agrimets/users/${uid}`, {
      name, tg_id, tg_username: tg_un,
      first_seen: now, last_seen: now,
    });
    ls_set(firstSeenKey, now);
  } else {
    // Already registered — just update last_seen + name (in case it changed)
    await _fbPatch(`agrimets/users/${uid}`, {
      name, tg_id, tg_username: tg_un, last_seen: now,
    });
  }
}

// ── Presence tracking ─────────────────────────────────────────
//  Writes uid → timestamp every 60 s while app is open.
//  Online count = entries updated within last 3 minutes.

let _presenceInterval = null;

async function _fbHeartbeat() {
  const uid = _getOrCreateUid();
  await _fbPut(`agrimets/presence/${uid}`, Date.now());
}

function _startPresence() {
  if (!CONFIG.FB_URL) return;
  _fbHeartbeat();
  clearInterval(_presenceInterval);
  _presenceInterval = setInterval(_fbHeartbeat, 60_000);

  // Clear presence when tab closes
  window.addEventListener('pagehide', () => {
    clearInterval(_presenceInterval);
    // Best-effort removal — navigator.sendBeacon is most reliable on unload
    const uid = _getOrCreateUid();
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        `${CONFIG.FB_URL}/agrimets/presence/${uid}.json`,
        JSON.stringify(null)   // DELETE via sendBeacon PUT-null trick
      );
    }
  });
}

// ── User count banner ─────────────────────────────────────────

async function _initUserCount() {
  const totalEl  = document.getElementById('user-count-val');
  const onlineEl = document.getElementById('online-count-val');

  // Show cached values immediately
  if (totalEl)  totalEl.textContent  = ls_get('fb_total_users',  '—');
  if (onlineEl) onlineEl.textContent = ls_get('fb_online_users', '—');

  if (!CONFIG.FB_URL) return;

  try {
    // Fetch presence (online) and total users in parallel
    const [presenceData, usersData] = await Promise.all([
      _fbGet('agrimets/presence'),
      _fbGet('agrimets/users', '?shallow=true'),  // shallow = keys only, fast
    ]);

    const now   = Date.now();
    let online  = 0;
    let total   = 0;

    if (presenceData && typeof presenceData === 'object') {
      Object.values(presenceData).forEach(ts => {
        if (now - Number(ts) < FB_ONLINE_TTL_MS) online++;
      });
    }

    if (usersData && typeof usersData === 'object') {
      total = Object.keys(usersData).length;
    }

    // Animate and cache
    if (totalEl)  _animateCount(totalEl,  total);
    if (onlineEl) _animateCount(onlineEl, online);
    ls_set('fb_total_users',  total);
    ls_set('fb_online_users', online);

  } catch (e) {
    console.warn('[FB] User count failed:', e.message);
    const total  = ls_get('fb_total_users',  null);
    const online = ls_get('fb_online_users', null);
    if (totalEl  && total  !== null) totalEl.textContent  = total;
    if (onlineEl && online !== null) onlineEl.textContent = online;
  }
}

function _animateCount(el, target) {
  const duration = 1200;
  const start    = Date.now();

  function tick() {
    const elapsed  = Date.now() - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased    = 1 - Math.pow(1 - progress, 3);
    const current  = Math.round(target * eased);
    el.textContent = current.toLocaleString('en-IN');
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

const APP_SHARE_URL  = 'https://t.me/Agrimets_bot/agrimets';
const APP_SHARE_TEXT = '🌾 I\'m using AGRIMETS Swipe Cards to prepare for agriculture exams! 📚\n\nJoin me and ace your exams 👇\nhttps://t.me/Agrimets_bot/agrimets';
const SHARE_INTERVAL = 200; // Show popup every N cards

function _checkShareMilestone(totalSeen) {
  if (totalSeen < SHARE_INTERVAL) return;
  if (totalSeen % SHARE_INTERVAL !== 0) return;

  // Check if we already showed popup for this milestone
  const lastMilestone = ls_get('dca_last_share_milestone', 0);
  if (totalSeen <= lastMilestone) return;

  ls_set('dca_last_share_milestone', totalSeen);
  setTimeout(() => _showSharePopup(totalSeen), 150);
}

function _showSharePopup(milestone) {
  const overlay  = document.getElementById('share-popup-overlay');
  const closeBtn = document.getElementById('share-popup-close');
  const shareBtn = document.getElementById('share-main-btn');
  const skipBtn  = document.getElementById('share-skip-btn');
  const titleEl  = overlay?.querySelector('.share-popup-title');
  const msgEl    = overlay?.querySelector('.share-popup-msg');

  if (!overlay) return;

  // Update milestone text
  if (titleEl) titleEl.textContent = `${milestone} Cards Done! 🎉`;
  if (msgEl)   msgEl.textContent   =
    `Amazing! You've studied ${milestone} cards. Share AGRIMETS with your friends and help them prepare too!`;

  overlay.classList.remove('hidden');
  TG.Haptic.success();

  function _closeShare() {
    overlay.style.opacity    = '0';
    overlay.style.transition = 'opacity 0.2s ease';
    setTimeout(() => {
      overlay.classList.add('hidden');
      overlay.style.opacity    = '';
      overlay.style.transition = '';
    }, 200);
  }

  closeBtn?.addEventListener('click', _closeShare, { once: true });
  skipBtn?.addEventListener('click',  _closeShare, { once: true });

  shareBtn?.addEventListener('click', () => {
    TG.Haptic.medium();
    _shareApp();
    setTimeout(_closeShare, 120);
  }, { once: true });
}

function _shareApp() {
  const fullText    = encodeURIComponent(APP_SHARE_TEXT);
  const waUrl       = `https://wa.me/?text=${fullText}`;

  // Try native share sheet first (Android system chooser includes WhatsApp)
  if (navigator.share) {
    navigator.share({
      title: 'AGRIMETS Swipe Cards',
      text:  APP_SHARE_TEXT,
    }).catch(() => window.open(waUrl, '_blank'));
  } else {
    // Fallback: open WhatsApp directly
    window.open(waUrl, '_blank');
  }
}

// ════════════════════════════════════════════════════════════════
//  GLOSSARY
// ════════════════════════════════════════════════════════════════

const GLOSSARY = {
  'photoperiodism': 'The response of a plant\'s flowering to the relative lengths of day and night. Plants are classified as short-day, long-day, or day-neutral.',
  'vernalisation':  'The process by which prolonged cold exposure triggers flowering in plants. Wheat and rye require vernalisation before they can produce flowers.',
  'apomixis':       'Reproduction in plants without fertilisation, producing seeds genetically identical to the mother. Studied to fix hybrid vigour permanently.',
  'allelopathy':    'The release of biochemicals by one plant that inhibit or stimulate nearby plants. Used as a natural weed suppression strategy.',
  'hydroponics':    'A method of growing plants in nutrient-rich water without soil. Roots are directly exposed to mineral solutions for faster growth.',
  'aeroponics':     'Growing plants with roots suspended in air, misted with nutrients. Uses less water than hydroponics and delivers more oxygen to roots.',
  'intercropping':  'Growing two or more crops simultaneously on the same field. Improves soil health, reduces pests, and increases overall yield.',
  'monoculture':    'Farming a single crop species over a large area. Maximises short-term yield but increases vulnerability to pests and soil depletion.',
  'phenology':      'The study of cyclic seasonal events in plants and animals, such as flowering dates and leaf fall. Critical for timing farm operations.',
  'stomata':        'Tiny pores on leaf surfaces that regulate gas exchange and water vapour loss. They open and close in response to light and humidity.',
  'transpiration':  'The process by which water travels through the plant and evaporates from leaves into the atmosphere via stomata.',
  'germination':    'The process by which a seed sprouts and begins to grow after absorbing water and receiving the right temperature conditions.',
  'dormancy':       'A state of suspended growth in seeds or buds during unfavourable conditions. Ensures survival until conditions improve.',
  'tillage':        'The mechanical preparation of soil for cultivation by ploughing or turning. Zero tillage conserves soil structure and moisture.',
  'mulching':       'Covering soil surface with organic or inorganic material to retain moisture, suppress weeds, and regulate soil temperature.',
  'fertigation':    'The technique of applying fertilisers directly through an irrigation system. Improves nutrient efficiency and reduces wastage.',
  'ratooning':      'Allowing a crop to regrow from the root or stubble after harvesting. Common in sugarcane, banana, and rice cultivation.',
  'lodging':        'The permanent displacement of crop stems from upright position due to wind or weak stems. Causes significant yield losses.',
  'etiolation':     'Abnormal elongation of plant stems and yellowing caused by insufficient light. The plant stretches towards the nearest light source.',
  'pedology':       'The branch of science dealing with study of soils in their natural environment, including formation, classification, and mapping.',
  'humus':          'The dark organic component of soil formed by decomposition of plant and animal matter. Improves structure, water retention, and fertility.',
  'leaching':       'The downward movement of soluble nutrients through the soil by water. Excessive leaching depletes essential minerals from the root zone.',
  'salinity':       'The concentration of dissolved salts in soil or water. High soil salinity reduces water availability to plants and damages root cells.',
  'sodicity':       'A soil condition caused by excess sodium, leading to poor structure, surface crusting, and reduced water infiltration capacity.',
  'laterite':       'A highly weathered soil rich in iron and aluminium oxides, common in tropical climates. Hardens on exposure to air; poor in nutrients.',
  'mycorrhizae':    'Symbiotic fungi that colonise plant roots, extending the root surface area and improving uptake of phosphorus and water.',
  'rhizobium':      'Nitrogen-fixing bacteria in root nodules of legumes. They convert atmospheric nitrogen into ammonia, reducing fertiliser needs.',
  'erosion':        'The wearing away of topsoil by wind or water. One of the leading causes of land degradation and loss of agricultural productivity.',
  'compaction':     'The compression of soil particles reducing pore space. It limits root penetration, water infiltration, and air circulation.',
  'waterlogging':   'Saturation of soil with water depleting oxygen from the root zone. Causes anaerobic conditions leading to root death in most crops.',
  'evapotranspiration': 'The combined water loss by evaporation from soil and transpiration from plants. Key for calculating crop water requirements.',
  'aquifer':        'An underground layer of permeable rock that stores groundwater. Over-extraction leads to permanent water table depletion.',
  'watershed':      'The total land area draining into a common river or water body. Critical for flood control, recharge, and irrigation planning.',
  'IPM':            'Integrated Pest Management — combining biological, cultural, physical, and chemical tools to minimise pest damage and input costs.',
  'biocontrol':     'Using living organisms such as predatory insects or beneficial pathogens to control pests, reducing dependence on chemicals.',
  'nematode':       'Microscopic roundworms in soil. Some are beneficial predators of pests; others are plant parasites causing serious root damage.',
  'pathogen':       'Any organism — fungus, bacterium, virus, or parasite — that causes disease in plants or animals.',
  'ruminant':       'A mammal that digests plant food through a multi-chambered stomach. Cattle, buffalo, sheep, and goats are ruminants.',
  'monogastric':    'An animal with a single-chambered stomach, such as pigs and poultry. They cannot digest cellulose efficiently.',
  'zoonosis':       'A disease naturally transmissible from animals to humans. Examples include rabies, avian influenza, and brucellosis.',
  'parturition':    'The process of giving birth in animals — calving in cattle, farrowing in pigs, lambing in sheep, kidding in goats.',
  'lactation':      'The production and secretion of milk by mammary glands following parturition. Influenced by breed, nutrition, and health.',
  'mastitis':       'Inflammation of the mammary gland in dairy animals, usually caused by bacterial infection. Reduces milk yield and quality.',
  'FCR':            'Feed Conversion Ratio — weight of feed consumed per unit of body weight gained. Lower FCR means better feed efficiency.',
  'aquaculture':    'The controlled farming of fish, shellfish, algae, or other aquatic organisms. The world\'s fastest-growing food production sector.',
  'eutrophication': 'Excessive enrichment of water with nutrients causing algal blooms and oxygen depletion. Primarily caused by agricultural runoff.',
  'biomass':        'The total mass of all living organisms in a given area. In aquaculture, it refers to total weight of fish being produced.',
  'MSP':            'Minimum Support Price — the guaranteed price set by the Indian government at which it procures crops from farmers.',
  'procurement':    'The process by which government agencies purchase food grains from farmers at MSP for the central food security buffer stock.',
  'subsidies':      'Financial support given by the government to reduce production costs for farmers on inputs like fertilisers and seeds.',
  'PDS':            'Public Distribution System — India\'s food security network supplying subsidised grains to eligible poor households.',
  'NABARD':         'National Bank for Agriculture and Rural Development — India\'s apex bank for agricultural credit and rural development.',
  'cooperatives':   'Farmer-owned organisations that pool resources for buying inputs, processing produce, and accessing credit on better terms.',
  'FPO':            'Farmer Producer Organisation — a company owned by farmers to improve collective bargaining power and market access.',
  'biodiversity':   'The variety of life on Earth encompassing genes, species, and ecosystems. Essential for food security and climate resilience.',
  'agroforestry':   'A land-use system integrating trees with crops or livestock. Improves soil health, biodiversity, income, and microclimate.',
  'deforestation':  'The permanent clearing of forest cover for agriculture or development. Accelerates soil erosion and destroys biodiversity.',
  'desertification':'The degradation of fertile dryland into desert caused by drought, overgrazing, or poor land management.',
  'methane':        'A potent greenhouse gas released by ruminant digestion, rice paddies, and manure. About 25–80× more warming than CO₂.',
  'GMO':            'Genetically Modified Organism — a plant or animal whose DNA has been altered using genetic engineering tools.',
  'hybrid seed':    'Seed from controlled cross-pollination of two selected parent varieties. Higher yield and vigour but seeds cannot be saved.',
  'biofortification': 'Increasing the nutritional content of crops through breeding or biotechnology. Golden Rice with vitamin A is a key example.',
  'precision farming': 'Using GPS, sensors, drones, and analytics to apply inputs only where and when needed for maximum efficiency.',
  'remote sensing': 'Acquiring information about crops or soil from a distance using satellite or aerial imagery. Used to detect crop stress.',
  'GIS':            'Geographic Information System — software capturing and analysing spatial data for soil mapping and field planning.',
  'GDP':            'Gross Domestic Product — the total monetary value of all goods and services produced in a country in a time period.',
  'inflation':      'A sustained rise in the general price level of goods and services, reducing the purchasing power of money.',
  'repo rate':      'The rate at which the RBI lends to commercial banks. Raising it curbs inflation; reducing it stimulates growth.',
  'SEBI':           'Securities and Exchange Board of India — the statutory regulator of India\'s capital and securities markets.',
  'GST':            'Goods and Services Tax — India\'s unified indirect tax applied on the supply of goods and services across the country.',
  'disinvestment':  'The government reducing its equity stake in public sector enterprises by selling shares to private investors.',
  'Kisan Credit Card': 'A revolving credit facility for Indian farmers for seeds, fertilisers, and post-harvest expenses at subsidised rates.',
};

function _linkGlossary(text) {
  if (!text) return '';
  let html = _escHtml(text);
  const keys = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length);
  keys.forEach(term => {
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re  = new RegExp(`(?<![\\w-])(${esc})(?![\\w-])`, 'gi');
    html = html.replace(re, m =>
      `<span class="glossary-term" data-term="${_escHtml(term.toLowerCase())}">${m}</span>`
    );
  });
  return html;
}

// ════════════════════════════════════════════════════════════════
//  CRAM MODE — scrollable cheat-sheet
// ════════════════════════════════════════════════════════════════

function _renderCramView() {
  const container = DOM.cramView;
  if (!container) return;

  container.innerHTML = '';
  container.classList.remove('hidden');

  // Header
  const header = document.createElement('div');
  header.className = 'cram-header';
  header.innerHTML = `
    <span class="cram-header-count">${State.dailyCards.length} questions</span>
    <span class="cram-header-hint">Tap a card to reveal the answer</span>
  `;
  container.appendChild(header);

  // Render every Q&A row
  State.dailyCards.forEach((q, i) => {
    const item = document.createElement('div');
    item.className = 'cram-item';
    item.style.setProperty('--ci', Math.min(i, 40)); // cap delay so late items don't wait forever

    const cat = q.category
      ? `<span class="cram-category">${_escHtml(q.category)}</span>` : '';

    item.innerHTML = `
      ${cat}
      <div class="cram-question">
        <span class="cram-num">Q${i + 1}</span>
        <span class="cram-question-text">${_linkGlossary(q.question)}</span>
      </div>
      <div class="cram-answer">${_escHtml(q.answer)}</div>
    `;

    item.addEventListener('click', () => {
      item.classList.toggle('cram-revealed');
      TG.Haptic.light();
      // Show hint only when no cards are revealed, hide as soon as any is revealed
      const hint = container.querySelector('.cram-header-hint');
      if (hint) {
        const anyRevealed = container.querySelectorAll('.cram-revealed').length > 0;
        hint.style.display = anyRevealed ? 'none' : '';
      }
    });

    container.appendChild(item);
  });

  const footer = document.createElement('div');
  footer.className = 'cram-footer';
  footer.innerHTML = `<p class="cram-footer-tip">Tap any card to reveal / hide the answer</p>`;
  container.appendChild(footer);
}

// ── Mode toggle ───────────────────────────────────────────────
function _initModeToggle() {
  const swipeBtn = document.getElementById('mode-btn-swipe');
  const cramBtn  = document.getElementById('mode-btn-cram');
  if (!swipeBtn || !cramBtn) return;

  function _setMode(mode) {
    State.cramMode = (mode === 'cram');
    swipeBtn.classList.toggle('active',  !State.cramMode);
    cramBtn.classList.toggle('active',    State.cramMode);
    TG.Haptic.select();
  }

  swipeBtn.addEventListener('click', () => _setMode('swipe'));
  cramBtn.addEventListener('click',  () => _setMode('cram'));
}

// ── Glossary sheet ────────────────────────────────────────────
function _initGlossarySheet() {
  const overlay  = document.getElementById('glossary-overlay');
  const termEl   = document.getElementById('glossary-term-title');
  const defEl    = document.getElementById('glossary-definition');
  const closeBtn = document.getElementById('glossary-close');
  if (!overlay) return;

  document.addEventListener('click', (e) => {
    const span = e.target.closest('.glossary-term');
    if (!span) return;
    e.stopPropagation();
    const key = span.dataset.term;
    const def = GLOSSARY[key] ||
      Object.entries(GLOSSARY).find(([k]) => k.toLowerCase() === key)?.[1];
    if (!def) return;
    termEl.textContent = span.textContent;
    defEl.textContent  = def;
    overlay.classList.remove('hidden');
    requestAnimationFrame(() => overlay.classList.add('open'));
    TG.Haptic.light();
  });

  function _close() {
    overlay.classList.remove('open');
    setTimeout(() => overlay.classList.add('hidden'), 300);
    TG.Haptic.select();
  }

  closeBtn?.addEventListener('click', _close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) _close(); });

  const sheet = document.getElementById('glossary-sheet');
  let _sy = 0;
  sheet?.addEventListener('touchstart', e => { _sy = e.touches[0].clientY; }, { passive: true });
  sheet?.addEventListener('touchend',   e => {
    if (e.changedTouches[0].clientY - _sy > 55) _close();
  }, { passive: true });
}

// ════════════════════════════════════════════════════════════════
//  MOCK TEST ENGINE  — scheduled unlocks + dynamic categories
//
//  SHEET TAB : "MockTests"
//  COLUMNS   : id | category | test_no | question |
//              opt_a | opt_b | opt_c | opt_d | opt_e | answer
//
//  SCHEDULE  :
//   • Every day   8 PM  → "Test Series"  (next sequential test unlocks)
//   • Every day   9 PM  → "NIMRAJ Sunday" (next sequential test unlocks)
//   • Every Sunday 10PM → Sunday Mega Test (60 random, never repeat)
//
//  To change unlock times → edit MOCK_SCHEDULE below.
//  To add a new daily-unlock category → add one entry to MOCK_SCHEDULE.
//  All other categories from sheet appear automatically with no schedule.
// ════════════════════════════════════════════════════════════════

// ── Schedule config — only categories listed here get daily unlock ──
// catNorm  : lowercase version of the "category" column value in sheet
// unlockHour: 24h integer (20 = 8 PM, 21 = 9 PM)
const MOCK_SCHEDULE = [
  { catNorm: 'test series',   unlockHour: 20 },
  { catNorm: 'nimraj sunday', unlockHour: 21 },
];
const SUNDAY_MEGA_HOUR  = 11;   // 11 AM every Sunday
const SUNDAY_MEGA_COUNT = 100;  // questions per Sunday Mega Test

// ── Emoji auto-assign by category name keyword ───────────────
const _CAT_EMOJI_MAP = [
  ['agronomy','🌾'],['soil','🌱'],['horticulture','🍎'],
  ['fishery','🐟'],['fish','🐟'],['forestry','🌲'],
  ['seed','🌰'],['animal','🐄'],['dairy','🥛'],
  ['poultry','🐓'],['icar','🏛'],['extension','📡'],
  ['economics','📈'],['economy','📈'],['nimraj','☀️'],
  ['sunday','📅'],['series','📋'],['special','⭐'],
  ['full','📝'],['agri','🌿'],
];
function _catEmoji(name) {
  const lower = name.toLowerCase();
  for (const [kw, em] of _CAT_EMOJI_MAP) if (lower.includes(kw)) return em;
  return '📋';
}

let MockData = {
  allRows:           [],
  currentCategory:   null,
  testList:          [],
  currentTest:       null,
  questions:         [],
  currentIndex:      0,
  history:           [],
  timerInterval:     null,
  countdownInterval: null,  // live countdown on category screen

  // ── NEW FIELDS (Features 1–4) ──────────────────────────────
  // answers[i]         : selectedText the user chose for question i (null = unattempted)
  // questionStatuses[i]: 'unattempted' | 'answered' | 'skipped' | 'review'
  // timerSecondsLeft   : seconds remaining in the 40-min countdown
  // testSubmitted      : true once the test has been submitted/auto-submitted
  answers:           [],
  questionStatuses:  [],
  timerSecondsLeft:  2400,   // 40 × 60
  testSubmitted:     false,
};

// ── Show/hide mock screens ────────────────────────────────────
function _mockShow(id) {
  ['subject-picker','mock-category-view','mock-list-view',
   'mock-arena','mock-results'].forEach(v => {
    document.getElementById(v)?.classList.toggle('hidden', v !== id);
  });
  // Restore tab bar when leaving arena or results
  if (id === 'mock-category-view' || id === 'mock-list-view') {
    _showTabBar();
  }
  // Stop countdown when leaving category screen
  if (id !== 'mock-category-view') {
    clearInterval(MockData.countdownInterval);
    MockData.countdownInterval = null;
  }
}

// ────────────────────────────────────────────────────────────
//  SCHEDULE HELPERS
// ────────────────────────────────────────────────────────────

/** Seconds until a given hour today (0 if already past) */
function _secsUntilHour(h) {
  const now = new Date();
  const t   = new Date(now);
  t.setHours(h, 0, 0, 0);
  return t <= now ? 0 : Math.floor((t - now) / 1000);
}

/** Format seconds as "2h 04m 30s" / "04m 30s" / "30s" */
function _fmtCountdown(s) {
  if (s <= 0) return 'Unlocking…';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2,'0')}m ${String(sec).padStart(2,'0')}s`;
  if (m > 0) return `${m}m ${String(sec).padStart(2,'0')}s`;
  return `${sec}s`;
}

/**
 * Returns "today's" test_no for a scheduled category.
 * Advances by one each calendar day.
 * Returns NULL when all available tests have been shown already
 * (no cycling — ensures no phantom countdown when sheet is empty).
 */
function _getDailyTestNo(catNorm, availableTestNos) {
  if (!availableTestNos || availableTestNos.length === 0) return null;

  const key      = 'dca_daily_' + catNorm.replace(/\s+/g,'_');
  const stored   = ls_get(key, { date: '', testNo: null, used: [] });
  const todayStr = today();

  // Already assigned today — return it
  if (stored.date === todayStr && stored.testNo) return stored.testNo;

  // Sort numerically/alphabetically
  const sorted = availableTestNos.slice().sort((a, b) => {
    const na = parseFloat(a), nb = parseFloat(b);
    return !isNaN(na) && !isNaN(nb) ? na - nb : String(a).localeCompare(String(b));
  });

  const used = Array.isArray(stored.used) ? stored.used : [];
  const next = sorted.find(t => !used.includes(t));

  // All tests used — no cycling, no countdown
  if (!next) return null;

  const newProgress = { date: todayStr, testNo: next, used: [...used, next] };
  ls_set(key, newProgress);

  // Mirror to Firebase so progress survives localStorage wipes
  _fbBackupTestProgress(catNorm, newProgress);

  return next;
}

/**
 * Returns 60 questions for Sunday Mega Test, never repeating
 * across Sundays. Uses question id (or question text as fallback).
 * Resets automatically when all questions have been used.
 */
function _getSundayMegaQuestions() {
  const usedKey = 'dca_sunday_used';
  const usedArr = ls_get(usedKey, []);
  const usedSet = new Set(usedArr);

  const pool = MockData.allRows.filter(r => !usedSet.has(r.id || r.question));
  const src  = pool.length >= SUNDAY_MEGA_COUNT ? pool : MockData.allRows;
  if (pool.length < SUNDAY_MEGA_COUNT) ls_set(usedKey, []); // reset cycle

  const chosen = shuffle([...src]).slice(0, SUNDAY_MEGA_COUNT);
  ls_set(usedKey, [...(pool.length >= SUNDAY_MEGA_COUNT ? usedArr : []),
                   ...chosen.map(r => r.id || r.question)]);
  return chosen;
}

// ────────────────────────────────────────────────────────────
//  OPEN CATEGORY SCREEN
// ────────────────────────────────────────────────────────────
async function _openMockCategories() {
  TG.Haptic.medium();
  _mockShow('mock-category-view');
  // Back → subject picker
  TG.pushBack(() => {
    showSubjectPicker();
  });

  const catListEl = document.getElementById('mock-category-list');
  const subEl     = document.getElementById('mock-cat-sub');
  if (catListEl) catListEl.innerHTML = '<div class="mock-list-loading">⏳ Loading…</div>';

  // Fetch once; cleared by Update button
  if (MockData.allRows.length === 0) {
    try {
      const url = `https://opensheet.elk.sh/${CONFIG.SPREADSHEET_ID}/MockTests`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const raw = await res.json();
      if (!Array.isArray(raw) || raw.length === 0) throw new Error('Empty');
      MockData.allRows = raw.map(r => {
        const n = {};
        Object.keys(r).forEach(k => {
          n[k.toLowerCase().trim()] = String(r[k] ?? '').trim();
        });
        return n;
      });
    } catch (err) {
      console.error('[Mock]', err);
      if (catListEl) catListEl.innerHTML =
        `<div class="mock-list-loading" style="color:var(--red)">
           ❌ Could not load tests.<br>
           <small>Tab must be named <strong>MockTests</strong>,
           shared as "Anyone with link – Viewer".</small>
         </div>`;
      return;
    }
  }

  // Build category map from sheet rows
  const countByNorm = {}, normToRaw = {}, testsByNorm = {};
  MockData.allRows.forEach(r => {
    const raw  = (r.category || 'Uncategorised').trim();
    const norm = raw.toLowerCase();
    countByNorm[norm] = (countByNorm[norm] || 0) + 1;
    if (!normToRaw[norm]) normToRaw[norm] = raw;
    if (!testsByNorm[norm]) testsByNorm[norm] = new Set();
    testsByNorm[norm].add(r.test_no || '1');
  });

  const cats = Object.keys(countByNorm)
    .sort((a, b) => a.localeCompare(b))
    .map(norm => ({
      key:     normToRaw[norm],
      norm,
      count:   countByNorm[norm],
      testNos: [...testsByNorm[norm]],
    }));

  if (subEl) subEl.textContent =
    `${cats.length} categor${cats.length !== 1 ? 'ies' : 'y'} · ${MockData.allRows.length} questions`;

  _renderMockCategories(cats);
  _startCategoryCountdown(cats);
}

// ────────────────────────────────────────────────────────────
//  RENDER CATEGORY SCREEN
// ────────────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════
//  SUNDAY MEGA BANNER  — lives on the home screen
//  Visible every day: shows "Next Sunday" countdown on weekdays,
//  shows live countdown on Sunday before 10 PM,
//  goes LIVE on Sunday after 10 PM.
// ════════════════════════════════════════════════════════════════

let _sundayBannerInterval = null;

function _renderSundayMegaBanner() {
  const banner = document.getElementById('sunday-mega-banner');
  if (!banner) return;

  const now      = new Date();
  const isSunday = now.getDay() === 0;
  const hour     = now.getHours();
  const isLive   = isSunday && hour >= SUNDAY_MEGA_HOUR;

  banner.classList.remove('hidden');

  if (isLive) {
    banner.className = 'sunday-mega-banner smb-live';
    banner.onclick   = _launchSundayMega;
    banner.innerHTML = `
      <div class="smb-left">
        <span class="smb-trophy">🏆</span>
        <div class="smb-body">
          <div class="smb-title">Sunday Mega Test</div>
          <div class="smb-meta">${SUNDAY_MEGA_COUNT} Qs · All topics · −0.25</div>
        </div>
      </div>
      <div class="smb-right">
        <span class="smb-live-badge">LIVE</span>
        <span class="smb-chevron">›</span>
      </div>`;
  } else {
    banner.className = 'sunday-mega-banner smb-locked';
    banner.onclick   = null;

    // Seconds to next Sunday 10 PM
    let secsLeft;
    if (isSunday && hour < SUNDAY_MEGA_HOUR) {
      secsLeft = _secsUntilHour(SUNDAY_MEGA_HOUR);
    } else {
      const daysUntil = isSunday ? 7 : (7 - now.getDay()) % 7 || 7;
      const nextSun   = new Date(now);
      nextSun.setDate(now.getDate() + daysUntil);
      nextSun.setHours(SUNDAY_MEGA_HOUR, 0, 0, 0);
      secsLeft = Math.max(0, Math.floor((nextSun - now) / 1000));
    }

    const daysLeft = Math.floor(secsLeft / 86400);
    const label    = daysLeft >= 2 ? `${daysLeft}d` : _fmtCountdown(secsLeft);

    banner.innerHTML = `
      <div class="smb-left">
        <span class="smb-trophy smb-trophy-dim">🏆</span>
        <div class="smb-body">
          <div class="smb-title">Sunday Mega Test</div>
          <div class="smb-meta">${SUNDAY_MEGA_COUNT} Qs · All topics · −0.25</div>
        </div>
      </div>
      <div class="smb-right">
        <span class="smb-countdown-badge" id="smb-countdown-text">${label}</span>
        <span class="smb-lock">🔒</span>
      </div>`;
  }
}

async function _launchSundayMega() {
  TG.Haptic.medium();
  // If mock data not yet loaded, fetch it first
  if (MockData.allRows.length === 0) {
    showToast('⏳ Loading questions…', 1500);
    try {
      const url = `https://opensheet.elk.sh/${CONFIG.SPREADSHEET_ID}/MockTests`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const raw = await res.json();
      MockData.allRows = raw.map(r => {
        const n = {};
        Object.keys(r).forEach(k => {
          n[k.toLowerCase().trim()] = String(r[k] ?? '').trim();
        });
        return n;
      });
    } catch (err) {
      showToast('❌ Could not load questions — check connection', 3000);
      TG.Haptic.error();
      return;
    }
  }
  const qs = _getSundayMegaQuestions();
  _startMockTest({ testNo: 'Sunday', name: 'Sunday Mega Test', questions: qs });
}

function _initSundayMegaBanner() {
  // Initial render
  _renderSundayMegaBanner();

  // Tick every second to update the countdown text
  clearInterval(_sundayBannerInterval);
  _sundayBannerInterval = setInterval(() => {
    const banner = document.getElementById('sunday-mega-banner');
    if (!banner) return;

    const now      = new Date();
    const isSunday = now.getDay() === 0;
    const hour     = now.getHours();
    const isLive   = isSunday && hour >= SUNDAY_MEGA_HOUR;

    if (isLive && !banner.classList.contains('smb-live')) {
      // Just flipped live — full re-render
      _renderSundayMegaBanner();
      return;
    }

    if (!isLive && banner.classList.contains('smb-live')) {
      // Midnight passed — Sunday ended, reset banner to countdown
      _renderSundayMegaBanner();
      return;
    }

    if (!isLive) {
      const ctEl = document.getElementById('smb-countdown-text');
      if (!ctEl) return;

      let secsLeft;
      if (isSunday && hour < SUNDAY_MEGA_HOUR) {
        secsLeft = _secsUntilHour(SUNDAY_MEGA_HOUR);
      } else {
        const daysUntil = isSunday ? 7 : (7 - now.getDay()) % 7 || 7;
        const nextSun   = new Date(now);
        nextSun.setDate(now.getDate() + daysUntil);
        nextSun.setHours(SUNDAY_MEGA_HOUR, 0, 0, 0);
        secsLeft = Math.max(0, Math.floor((nextSun - now) / 1000));
      }
      const daysLeft = Math.floor(secsLeft / 86400);
      ctEl.textContent = daysLeft >= 2 ? `${daysLeft}d` : _fmtCountdown(secsLeft);
    }
  }, 1000);
}

function _renderMockCategories(cats) {
  const listEl = document.getElementById('mock-category-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  const hour = new Date().getHours();

  // ── Section 1: TODAY'S SCHEDULE (daily tests only) ──────────
  const schedItems = [];

  MOCK_SCHEDULE.forEach(cfg => {
    const cat = cats.find(c => c.norm === cfg.catNorm);
    if (!cat) return;

    const testNo = _getDailyTestNo(cat.norm, cat.testNos);
    // No test available for today in this category → skip entirely, no countdown
    if (!testNo) return;

    const rows = MockData.allRows.filter(r =>
      (r.category || '').trim().toLowerCase() === cat.norm &&
      (r.test_no || '1') === testNo
    );
    // No rows found for this test_no → sheet doesn't have it yet → skip
    if (rows.length === 0) return;

    const isUnlocked = hour >= cfg.unlockHour;
    const secsLeft   = _secsUntilHour(cfg.unlockHour);

    schedItems.push({
      type: 'daily', cat, testNo, rows, isUnlocked, secsLeft,
      unlockHour: cfg.unlockHour,
      schedId: 'sched_' + cat.norm.replace(/\s+/g,'_'),
    });
  });

  // NOTE: Sunday Mega is no longer here — it lives on the home screen banner

  if (schedItems.length > 0) {
    // Section label
    listEl.appendChild(_mockSectionLabel("📌 Today's Tests"));

    schedItems.forEach(item => {
      const card = document.createElement('div');
      card.id        = item.schedId;
      card.className = 'mock-sched-card' + (item.isUnlocked ? ' unlocked' : ' locked');

      if (item.type === 'sunday') {
        card.innerHTML = _schedCardHTML({
          isUnlocked: item.isUnlocked,
          name:       '🏆 Sunday Mega Test',
          meta:       `${SUNDAY_MEGA_COUNT} random questions · All categories · −0.25`,
          secsLeft:   item.secsLeft,
          schedId:    item.schedId,
        });
        if (item.isUnlocked) {
          card.addEventListener('click', () => {
            TG.Haptic.medium();
            const qs = _getSundayMegaQuestions();
            _startMockTest({ testNo: 'Sunday', name: 'Sunday Mega Test', questions: qs });
          });
        }
      } else {
        const label = `${item.cat.key} — Test ${item.testNo}`;
        card.innerHTML = _schedCardHTML({
          isUnlocked: item.isUnlocked,
          name:       label,
          meta:       `${item.rows.length} questions · −0.25 negative marking`,
          secsLeft:   item.secsLeft,
          schedId:    item.schedId,
        });
        if (item.isUnlocked) {
          card.addEventListener('click', () => {
            _startMockTest({ testNo: item.testNo, name: label, questions: item.rows });
          });
        }
      }
      listEl.appendChild(card);
    });

    listEl.appendChild(_mockSectionLabel('📚 All Categories'));
  }

  // ── Section 2: Grand Test (always) ────────────────────────
  const grandCard = document.createElement('div');
  grandCard.className = 'mock-cat-card grand';
  grandCard.innerHTML = `
    <div class="mock-cat-icon">🏆</div>
    <div class="mock-cat-info">
      <div class="mock-cat-name">Grand Test</div>
      <div class="mock-cat-meta">100 random questions from all categories · −0.25</div>
    </div>
    <span class="mock-cat-arrow">›</span>`;
  grandCard.addEventListener('click', () => {
    TG.Haptic.medium();
    const pool = shuffle([...MockData.allRows]).slice(0, 100);
    _startMockTest({ testNo: 'Grand', name: `Grand Test (${pool.length} Qs)`, questions: pool });
  });
  listEl.appendChild(grandCard);

  // ── Section 3: All categories from sheet ──────────────────
  cats.forEach((cat, i) => {
    const card = document.createElement('div');
    card.className = 'mock-cat-card';
    card.style.animationDelay = ((i + 1) * 0.05) + 's';
    card.innerHTML = `
      <div class="mock-cat-icon">${_catEmoji(cat.key)}</div>
      <div class="mock-cat-info">
        <div class="mock-cat-name">${_escHtml(cat.key)}</div>
        <div class="mock-cat-meta">${cat.count} questions · ${cat.testNos.length} test${cat.testNos.length !== 1 ? 's' : ''}</div>
      </div>
      <span class="mock-cat-arrow">›</span>`;
    card.addEventListener('click', () => _openCategoryTests(cat));
    listEl.appendChild(card);
  });
}

// ── Build schedule card inner HTML ────────────────────────────
function _schedCardHTML({ isUnlocked, name, meta, secsLeft, schedId }) {
  const badge = isUnlocked
    ? `<div class="sched-badge badge-live">🟢 LIVE</div>`
    : `<div class="sched-badge badge-lock">🔒</div>`;

  const status = isUnlocked
    ? `<div class="sched-live-label">Tap to start now!</div>`
    : `<div class="sched-countdown" data-sched-id="${schedId}">Unlocks in ${_fmtCountdown(secsLeft)}</div>`;

  return `
    ${badge}
    <div class="sched-info">
      <div class="sched-name">${_escHtml(name)}</div>
      <div class="sched-meta">${_escHtml(meta)}</div>
      ${status}
    </div>
    <span class="sched-arrow">${isUnlocked ? '›' : '⏳'}</span>`;
}

// ── Section divider label ─────────────────────────────────────
function _mockSectionLabel(text) {
  const el = document.createElement('div');
  el.className   = 'mock-section-label';
  el.textContent = text;
  return el;
}

// ────────────────────────────────────────────────────────────
//  LIVE COUNTDOWN TICKER
// ────────────────────────────────────────────────────────────
function _startCategoryCountdown(cats) {
  clearInterval(MockData.countdownInterval);

  MockData.countdownInterval = setInterval(() => {
    const listEl = document.getElementById('mock-category-list');
    if (!listEl) { clearInterval(MockData.countdownInterval); return; }

    const hour = new Date().getHours();
    let needsRebuild = false;

    listEl.querySelectorAll('.sched-countdown[data-sched-id]').forEach(el => {
      const id   = el.dataset.schedId;
      const norm = id.replace('sched_', '').replace(/_/g, ' ');
      const unlockHour = MOCK_SCHEDULE.find(c => c.catNorm === norm)?.unlockHour;
      if (unlockHour === undefined) return;

      const secs = _secsUntilHour(unlockHour);
      if (secs <= 0) { needsRebuild = true; return; }
      el.textContent = `Unlocks in ${_fmtCountdown(secs)}`;
    });

    if (needsRebuild) {
      clearInterval(MockData.countdownInterval);
      _openMockCategories(); // re-render to show LIVE badge
    }
  }, 1000);
}

// ────────────────────────────────────────────────────────────
//  OPEN TEST LIST FOR A CATEGORY
// ────────────────────────────────────────────────────────────
function _openCategoryTests(cat) {
  TG.Haptic.medium();
  MockData.currentCategory = cat;

  const schedCfg  = MOCK_SCHEDULE.find(c => c.catNorm === cat.norm);
  const todayStr  = today();
  const hour      = new Date().getHours();

  // ── Build the set of test_nos that belong to PAST DAYS only ──
  // Rule: today's assigned test is NOT shown in the category list —
  // it lives on the Mock Tests home screen (countdown / LIVE card).
  // Only after midnight does it move into the category list.
  let allowedTestNos = null; // null = unscheduled, show everything

  if (schedCfg) {
    const key    = 'dca_daily_' + cat.norm.replace(/\s+/g,'_');
    const stored = ls_get(key, { date: '', testNo: null, used: [] });
    const usedArr = Array.isArray(stored.used) ? stored.used : [];

    let pastTests;
    if (stored.date === todayStr && stored.testNo) {
      // stored.used already contains today's testNo — exclude it
      pastTests = usedArr.filter(t => t !== stored.testNo);
    } else {
      // Today's test not yet assigned — everything in used[] is from past days
      pastTests = usedArr;
    }
    allowedTestNos = new Set(pastTests);
  }

  // ── Filter rows ──────────────────────────────────────────────
  const rows = MockData.allRows.filter(r => {
    if ((r.category || 'Uncategorised').trim().toLowerCase() !== cat.norm) return false;
    if (allowedTestNos !== null) return allowedTestNos.has(r.test_no || '1');
    return true;
  });

  const titleEl = document.querySelector('#mock-list-view .mock-list-title');
  const subEl   = document.getElementById('mock-list-sub');
  const listEl  = document.getElementById('mock-test-list');
  if (titleEl) titleEl.textContent = cat.key;

  // ── Empty state for scheduled category ───────────────────────
  if (schedCfg && rows.length === 0) {
    _mockShow('mock-list-view');
    TG.pushBack(() => { _mockShow('mock-category-view'); TG.replaceBack(() => { showSubjectPicker(); }); });

    // Work out WHY it's empty and show the right message
    const todayTestNo = _getDailyTestNoReadOnly(cat.norm);
    const hasTodayTest = todayTestNo !== null &&
      MockData.allRows.some(r =>
        (r.category || '').trim().toLowerCase() === cat.norm &&
        (r.test_no || '1') === todayTestNo
      );

    let msg, subMsg;
    if (hasTodayTest) {
      const unlockH  = schedCfg.unlockHour;
      const timeStr  = unlockH === 20 ? '8 PM' : unlockH === 21 ? '9 PM' :
                       unlockH === 22 ? '10 PM' : `${unlockH}:00`;
      const isLive   = hour >= unlockH;
      if (isLive) {
        msg    = `Today's test is LIVE on the Mock Tests screen!`;
        subMsg = `It will appear here from tomorrow onwards.`;
      } else {
        msg    = `Today's test unlocks at ${timeStr}.`;
        subMsg = `It will appear here from tomorrow. Check the Mock Tests home for the countdown.`;
      }
    } else {
      msg    = `Will be added soon!`;
      subMsg = `No test is scheduled for today. Check back tomorrow.`;
    }

    if (subEl)  subEl.textContent = hasTodayTest ? 'Unlocks today' : 'Coming soon';
    if (listEl) listEl.innerHTML = `
      <div class="mock-empty-state">
        <div class="mock-empty-icon">${hasTodayTest ? '⏳' : '📋'}</div>
        <div class="mock-empty-title">${_escHtml(msg)}</div>
        <div class="mock-empty-sub">${_escHtml(subMsg)}</div>
      </div>`;
    return;
  }

  // ── Build test list from allowed rows ────────────────────────
  const groups = {};
  rows.forEach(r => {
    const t = r.test_no || '1';
    if (!groups[t]) groups[t] = [];
    groups[t].push(r);
  });

  MockData.testList = Object.entries(groups)
    .sort(([a], [b]) => {
      const na = parseFloat(a), nb = parseFloat(b);
      return !isNaN(na) && !isNaN(nb) ? na - nb : a.localeCompare(b);
    })
    .map(([testNo, questions]) => ({
      testNo,
      name: `${cat.key} — ${testNo}`,
      questions,
    }));

  if (subEl) subEl.textContent =
    `${MockData.testList.length} test${MockData.testList.length !== 1 ? 's' : ''} available`;

  _mockShow('mock-list-view');
  TG.pushBack(() => { _mockShow('mock-category-view'); TG.replaceBack(() => { showSubjectPicker(); }); });
  _renderMockTestList();
}

/**
 * Read-only version of _getDailyTestNo — checks what test is
 * assigned today WITHOUT advancing the counter or writing to storage.
 * Used only to inspect the current state for UI messages.
 */
function _getDailyTestNoReadOnly(catNorm) {
  const key     = 'dca_daily_' + catNorm.replace(/\s+/g,'_');
  const stored  = ls_get(key, { date: '', testNo: null, used: [] });
  if (stored.date === today() && stored.testNo) return stored.testNo;
  return null; // not yet assigned today (or already assigned but different date)
}

function _renderMockTestList() {
  const listEl = document.getElementById('mock-test-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  MockData.testList.forEach((test, i) => {
    const card = document.createElement('div');
    card.className = 'mock-test-card';
    card.style.animationDelay = (i * 0.04) + 's';
    card.innerHTML = `
      <div class="mock-test-num">${test.testNo}</div>
      <div class="mock-test-info">
        <div class="mock-test-name">${_escHtml(test.name)}</div>
        <div class="mock-test-meta">${test.questions.length} questions · −0.25 negative marking</div>
      </div>
      <span class="mock-test-arrow">›</span>`;
    card.addEventListener('click', () => _startMockTest(test));
    listEl.appendChild(card);
  });
}

// ────────────────────────────────────────────────────────────
//  RUN A TEST
// ────────────────────────────────────────────────────────────
// ── Tab bar hide/show for full-screen mock test ───────────────
function _hideTabBar() {
  document.querySelector('.tab-bar')?.classList.add('tab-hidden');
}
function _showTabBar() {
  document.querySelector('.tab-bar')?.classList.remove('tab-hidden');
}

function _startMockTest(test) {
  TG.Haptic.medium();
  MockData.currentTest  = test;
  MockData.questions    = shuffle([...test.questions]);  // shuffled fresh each time
  MockData.currentIndex = 0;
  MockData.history      = [];

  // ── NEW: initialise per-question state arrays ───────────────
  const n = MockData.questions.length;
  MockData.answers          = new Array(n).fill(null);
  MockData.questionStatuses = new Array(n).fill('unattempted');
  MockData.testSubmitted    = false;
  MockData.timerSecondsLeft = 2400;   // 40 minutes

  const testLabel  = document.getElementById('mock-test-label');
  const resultName = document.getElementById('mock-result-testname');
  if (testLabel)  testLabel.textContent  = test.name;
  if (resultName) resultName.textContent = test.name;

  _mockShow('mock-arena');
  _hideTabBar();  // full-screen mode during test
  _renderQBubbles();

  // ── NEW: start 40-minute countdown timer ───────────────────
  clearInterval(MockData.timerInterval);
  _updateMockTimerUI();
  MockData.timerInterval = setInterval(_mockTimerTick, 1000);

  // Back in arena = quit confirmation
  const special = ['Grand','Sunday'].includes(test.testNo);
  TG.pushBack(() => {
    TG.confirm('Quit this test? Your progress will be lost.', () => {
      clearInterval(MockData.timerInterval);
      TG.Haptic.warning();
      if (special) {
        _mockShow('mock-category-view');
        TG.replaceBack(() => { showSubjectPicker(); });
      } else {
        _mockShow('mock-list-view');
        TG.replaceBack(() => {
          _mockShow('mock-category-view');
          TG.replaceBack(() => { showSubjectPicker(); });
        });
      }
    });
  });

  _loadMockQuestion();
}

function _loadMockQuestion() {
  const q = MockData.questions[MockData.currentIndex];
  if (!q) { _submitMockTest(); return; }

  const idx  = MockData.currentIndex;
  const total = MockData.questions.length;

  document.getElementById('mock-progress').textContent =
    `Q ${idx + 1} / ${total}`;

  // ── Update bubble navigator highlight ───────────────────────
  _highlightCurrentBubble(idx);

  // ── Prev / Next button states ────────────────────────────────
  const prevBtn = document.getElementById('btn-mock-prev');
  const nextBtn = document.getElementById('btn-mock-next');
  if (prevBtn) prevBtn.disabled = idx === 0;
  if (nextBtn) nextBtn.textContent = idx === total - 1 ? 'Review & Submit ›' : 'Next ›';

  // ── Hint label ───────────────────────────────────────────────
  const hintEl = document.getElementById('mock-nav-hint');
  if (hintEl) {
    const st = MockData.questionStatuses[idx];
    hintEl.textContent =
      st === 'answered' ? 'Selected — change any time' :
      st === 'skipped'  ? 'Skipped' :
      st === 'review'   ? '🟡 Marked for review' :
      'Tap an option to answer';
  }

  // ── Render question text ─────────────────────────────────────
  const mqEl = document.getElementById('mock-q-text');
  if (mqEl) {
    const rawQ = q.question || '';
    if (rawQ.includes('★')) {
      const lines = rawQ.split('\n').map(l => l.trim()).filter(Boolean);
      mqEl.innerHTML = lines.map(line =>
        line.startsWith('★')
          ? `<div class="mock-bullet-line"><span class="mock-bullet-star">★</span><span class="mock-bullet-text">${_escHtml(line.slice(1).trim())}</span></div>`
          : `<div class="mock-q-label">${_escHtml(line)}</div>`
      ).join('');
    } else {
      mqEl.textContent = rawQ;
    }
  }

  // ── Render options — restore previously selected choice ──────
  const selectedText = MockData.answers[idx];   // null if unattempted
  ['a','b','c','d','e'].forEach(o => {
    const btn  = document.getElementById('opt-' + o);
    if (!btn) return;
    const text = q['opt_' + o] || '';
    btn.textContent = text;
    // Remove all state classes
    btn.className   = 'mock-opt';
    btn.disabled    = false;
    btn.style.display = text ? '' : 'none';

    // Highlight previously selected option (no correct/wrong reveal yet)
    if (text && selectedText && text.trim() === selectedText.trim()) {
      btn.classList.add('mock-opt-selected');
    }

    btn.onclick = text ? () => _handleMockAnswer(text, q.answer, q, idx) : null;
  });
}

function _handleMockAnswer(selectedText, correctText, qObj, idx) {
  TG.Haptic.light();

  // ── Store the selection (overwrite previous choice freely) ──
  MockData.answers[idx] = selectedText;

  // ── Update status: if previously 'review' keep it review,
  //    else mark as answered so bubble turns green ─────────────
  if (MockData.questionStatuses[idx] !== 'review') {
    MockData.questionStatuses[idx] = 'answered';
  }
  _updateQBubble(idx);

  // ── Highlight selected option only — NO correct/wrong reveal ─
  document.querySelectorAll('.mock-opt').forEach(btn => {
    btn.className = 'mock-opt';
    if (btn.textContent.trim() === selectedText.trim()) {
      btn.classList.add('mock-opt-selected');
    }
  });

  // ── Update hint text ─────────────────────────────────────────
  const hintEl = document.getElementById('mock-nav-hint');
  if (hintEl) {
    const st = MockData.questionStatuses[idx];
    hintEl.textContent = st === 'review' ? '🟡 Marked for review' : 'Selected — change any time';
  }
}

function _finishMock() {
  if (MockData.testSubmitted) return;  // guard against double-call
  MockData.testSubmitted = true;
  clearInterval(MockData.timerInterval);

  // ── Build history from stored answers ────────────────────────
  MockData.history = [];
  MockData.questions.forEach((q, i) => {
    const selected = MockData.answers[i];
    const correct  = q.answer || '';
    const status   = MockData.questionStatuses[i];
    const opts     = { a: q.opt_a||'', b: q.opt_b||'', c: q.opt_c||'', d: q.opt_d||'', e: q.opt_e||'' };

    // Treat as skipped if: explicitly skipped, or unattempted with no answer
    const isSkipped = status === 'skipped' || (!selected && status !== 'answered' && status !== 'review');

    if (isSkipped) {
      MockData.history.push({ question: q.question, selected: 'Skipped', correct, status: 'skipped', opts });
    } else {
      // answered OR review with a selected option
      const isCorrect = (selected || '').trim() === correct.trim();
      MockData.history.push({
        question: q.question,
        selected: selected || 'Skipped',
        correct,
        status: selected ? (isCorrect ? 'correct' : 'wrong') : 'skipped',
        opts,
      });
    }
  });

  // ── Score calculation ────────────────────────────────────────
  let c = 0, w = 0, s = 0;
  MockData.history.forEach(h => {
    if      (h.status === 'correct') c++;
    else if (h.status === 'wrong')   w++;
    else                              s++;
  });

  const score = (c * 1) - (w * 0.25);
  document.getElementById('mock-final-score').textContent = score.toFixed(2);
  document.getElementById('count-correct').textContent    = c;
  document.getElementById('count-wrong').textContent      = w;
  document.getElementById('count-skip').textContent       = s;
  document.getElementById('pts-correct').textContent      = c.toFixed(2);
  document.getElementById('pts-wrong').textContent        = (w * 0.25).toFixed(2);

  document.querySelectorAll('.rev-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.rev-btn[data-filter="all"]')?.classList.add('active');

  // ── Score-based haptic fires exactly when results screen appears ──
  const pct = MockData.questions.length > 0
    ? (c / MockData.questions.length) * 100 : 0;
  if      (pct >= 60) TG.Haptic.success();   // ≥60% — gentle success pulse
  else if (pct >= 40) TG.Haptic.warning();   // 40–59% — warning buzz
  else                TG.Haptic.heavy();     // <40%  — strong thud

  _mockShow('mock-results');

  // ── Leaderboard popup ────────────────────────────────────────
  const testName = MockData.currentTest?.name || 'Mock Test';
  setTimeout(() => {
    _showLeaderboard(testName, score);
    // FEATURE 3: Show group join popup after leaderboard delay
    setTimeout(_showPostTestGroupPopup, 3000);
  }, 600);

  // Back from results
  const special = ['Grand','Sunday'].includes(MockData.currentTest?.testNo);
  TG.replaceBack(() => {
    TG.Haptic.select();
    if (special) {
      _mockShow('mock-category-view');
      TG.replaceBack(() => { showSubjectPicker(); });
    } else {
      _mockShow('mock-list-view');
      TG.replaceBack(() => {
        _mockShow('mock-category-view');
        TG.replaceBack(() => { showSubjectPicker(); });
      });
    }
  });

  _renderMockReview('all');
}

function _renderMockReview(filter) {
  const list = document.getElementById('mock-review-list');
  if (!list) return;
  list.innerHTML = '';

  const data = filter === 'all'
    ? MockData.history
    : MockData.history.filter(h => h.status === filter);

  if (!data.length) {
    list.innerHTML = `<p style="text-align:center;color:var(--text-muted);padding:20px;font-size:13px;">No items here</p>`;
    return;
  }

  data.forEach((h) => {
    const div = document.createElement('div');
    div.className = `review-item ${h.status}`;

    // ── Clean display: question + concise answer info only ──────
    // Correct: show ✓ correct answer
    // Wrong  : show ✗ what user selected + ✓ correct answer
    // Skipped: show ✓ correct answer
    let ansHtml = '';
    if (h.status === 'correct') {
      ansHtml = `<div class="rev-ans-clean">
        <div class="rev-ans-tag rev-correct-tag">✓ ${_escHtml(h.correct)}</div>
      </div>`;
    } else if (h.status === 'wrong') {
      ansHtml = `<div class="rev-ans-clean">
        <div class="rev-ans-tag rev-wrong-tag">✗ Your answer: ${_escHtml(h.selected)}</div>
        <div class="rev-ans-tag rev-correct-tag">✓ Correct: ${_escHtml(h.correct)}</div>
      </div>`;
    } else {
      // skipped
      ansHtml = `<div class="rev-ans-clean">
        <div class="rev-ans-tag rev-correct-tag">✓ ${_escHtml(h.correct)}</div>
      </div>`;
    }

    div.innerHTML = `<div class="rev-q">${_escHtml(h.question)}</div>${ansHtml}`;
    list.appendChild(div);
  });
}

// ── Wire all mock buttons ─────────────────────────────────────
function _initMockButtons() {
  // Main CTA → open category screen
  document.getElementById('btn-open-mock-list')?.addEventListener('click', _openMockCategories);

  // Back: categories → subject picker
  document.getElementById('btn-mock-cat-back')?.addEventListener('click', () => {
    showSubjectPicker();
  });

  // Back: test list → categories
  document.getElementById('btn-mock-list-back')?.addEventListener('click', () => {
    _mockShow('mock-category-view');
    TG.replaceBack(() => { showSubjectPicker(); });
  });

  // ── SKIP (Feature 1/2): mark current as skipped, move to next ─
  document.getElementById('btn-mock-skip')?.addEventListener('click', () => {
    const idx = MockData.currentIndex;
    if (idx >= MockData.questions.length) return;
    MockData.questionStatuses[idx] = 'skipped';
    MockData.answers[idx] = null;
    _updateQBubble(idx);
    TG.Haptic.light();
    // Move to next unanswered or wrap
    const next = _findNextQuestion(idx);
    MockData.currentIndex = next;
    _loadMockQuestion();
  });

  // ── REVIEW (Feature 2): mark current selection as review ──────
  document.getElementById('btn-mock-review')?.addEventListener('click', () => {
    const idx = MockData.currentIndex;
    if (idx >= MockData.questions.length) return;
    MockData.questionStatuses[idx] = 'review';
    _updateQBubble(idx);
    TG.Haptic.light();
    showToast('🟡 Marked for review', 1500);
    // Update hint
    const hintEl = document.getElementById('mock-nav-hint');
    if (hintEl) hintEl.textContent = '🟡 Marked for review';
    // Auto-advance to next
    const next = _findNextQuestion(idx);
    MockData.currentIndex = next;
    _loadMockQuestion();
  });

  // ── PREV (Feature 1) ──────────────────────────────────────────
  document.getElementById('btn-mock-prev')?.addEventListener('click', () => {
    if (MockData.currentIndex > 0) {
      MockData.currentIndex--;
      TG.Haptic.light();
      _loadMockQuestion();
    }
  });

  // ── NEXT (Feature 1) ──────────────────────────────────────────
  document.getElementById('btn-mock-next')?.addEventListener('click', () => {
    const idx   = MockData.currentIndex;
    const total = MockData.questions.length;
    if (idx < total - 1) {
      MockData.currentIndex++;
      TG.Haptic.light();
      _loadMockQuestion();
    } else {
      // Last question → trigger submit
      _confirmAndSubmitMock();
    }
  });

  // ── SUBMIT (Feature 4) ────────────────────────────────────────
  document.getElementById('btn-mock-submit')?.addEventListener('click', () => {
    _confirmAndSubmitMock();
  });

  // ── Quit arena ────────────────────────────────────────────────
  document.getElementById('btn-mock-exit')?.addEventListener('click', () => {
    TG.confirm('Quit this test? Your progress will be lost.', () => {
      clearInterval(MockData.timerInterval);
      TG.Haptic.warning();
      const special = ['Grand','Sunday'].includes(MockData.currentTest?.testNo);
      if (special) {
        _mockShow('mock-category-view');
        TG.replaceBack(() => { showSubjectPicker(); });
      } else {
        _mockShow('mock-list-view');
        TG.replaceBack(() => {
          _mockShow('mock-category-view');
          TG.replaceBack(() => { showSubjectPicker(); });
        });
      }
    });
  });

  // Results back
  document.getElementById('btn-mock-home')?.addEventListener('click', () => {
    TG.Haptic.select();
    const special = ['Grand','Sunday'].includes(MockData.currentTest?.testNo);
    if (special) {
      _mockShow('mock-category-view');
      TG.replaceBack(() => { showSubjectPicker(); });
    } else {
      _mockShow('mock-list-view');
      TG.replaceBack(() => {
        _mockShow('mock-category-view');
        TG.replaceBack(() => { showSubjectPicker(); });
      });
    }
  });

  // Review filters
  document.querySelectorAll('.rev-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rev-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _renderMockReview(btn.dataset.filter);
      TG.Haptic.select();
    });
  });
}

// ════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════
//  LEADERBOARD ENGINE — Firebase shared, real-time, all users
// ════════════════════════════════════════════════════════════════

/** Safe key from test name */
function _lbKey(testName) {
  return testName.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').slice(0, 60);
}

/**
 * Write this user's score to Firebase — only if personal best.
 * Always updates local cache too.
 */
async function _submitLbScore(testKey, score, displayName) {
  const uid    = _getOrCreateUid();
  const tgUser = TG.getUser?.();
  const tg_id  = tgUser?.id ? String(tgUser.id) : 'guest';

  // Local cache: best score per test
  const cacheKey = 'fb_lb_' + testKey;
  const cached   = ls_get(cacheKey, null);
  if (cached !== null && score <= cached) return;   // not a new best locally
  ls_set(cacheKey, score);

  if (!CONFIG.FB_URL) return;

  // Fetch existing best to avoid over-writing a higher score
  // (handles device-switch scenario)
  const existing = await _fbGet(`agrimets/leaderboard/${testKey}/${uid}`);
  if (existing && typeof existing.score === 'number' && score <= existing.score) return;

  await _fbPut(`agrimets/leaderboard/${testKey}/${uid}`, {
    name: displayName, score, tg_id, ts: Date.now(),
  });
}

/**
 * Fetch top-10 + my rank for a test from Firebase.
 * Returns { top, myRank, total } or null on failure.
 */
async function _fetchLbScores(testKey) {
  if (!CONFIG.FB_URL) return null;

  const uid  = _getOrCreateUid();
  const data = await _fbGet(`agrimets/leaderboard/${testKey}`);
  if (!data || typeof data !== 'object') return null;

  // Each key is a uid, value is { name, score, tg_id, ts }
  const entries = Object.entries(data).map(([k, v]) => ({
    uid:   k,
    name:  v.name  || 'Anonymous',
    score: typeof v.score === 'number' ? v.score : parseFloat(v.score) || 0,
    tg_id: v.tg_id || '',
    ts:    v.ts || 0,
  }));

  // Sort: highest score first, then earliest attempt wins tie
  entries.sort((a, b) => b.score - a.score || a.ts - b.ts);

  const total    = entries.length;
  const myRankIdx = entries.findIndex(e => e.uid === uid);
  const myRank    = myRankIdx >= 0 ? myRankIdx + 1 : null;

  const top = entries.slice(0, LB_MAX_ROWS).map((e, i) => ({
    rank:  i + 1,
    uid:   e.uid,
    name:  e.name,
    score: e.score,
  }));

  return { top, myRank, total };
}

/**
 * Show the leaderboard popup — submits score then fetches live rankings.
 */
async function _showLeaderboard(testName, myScore) {
  const overlay   = document.getElementById('lb-overlay');
  const listEl    = document.getElementById('lb-list');
  const myScoreEl = document.getElementById('lb-my-score');
  const titleEl   = document.getElementById('lb-title');
  const subEl     = document.getElementById('lb-sub');
  const closeBtn  = document.getElementById('lb-close');
  const contBtn   = document.getElementById('lb-continue-btn');
  if (!overlay) return;

  const uid     = _getOrCreateUid();
  const name    = _getUserDisplayName();
  const testKey = _lbKey(testName);

  // Show immediately with loading state
  if (titleEl) titleEl.textContent = '🏆 Leaderboard';
  if (subEl)   subEl.textContent   = testName;

  if (myScoreEl) {
    myScoreEl.innerHTML = `
      <div>
        <div class="lb-my-name">👤 ${_escHtml(name)}</div>
        <div class="lb-my-rank">Your score</div>
      </div>
      <div class="lb-my-pts">${myScore.toFixed(2)}</div>
    `;
  }
  if (listEl) listEl.innerHTML = '<div class="lb-loading">⏳ Fetching rankings…</div>';

  overlay.classList.remove('hidden');
  requestAnimationFrame(() => overlay.classList.add('lb-open'));
  TG.Haptic.success();

  // Submit & fetch in parallel
  const [, liveData] = await Promise.all([
    _submitLbScore(testKey, myScore, name),
    _fetchLbScores(testKey),
  ]);

  const medals = ['🥇', '🥈', '🥉'];

  if (liveData && liveData.top && liveData.top.length > 0) {
    const myRank = liveData.myRank;
    const total  = liveData.total || 0;

    // Update my-score banner with real rank
    if (myScoreEl) {
      myScoreEl.innerHTML = `
        <div>
          <div class="lb-my-name">👤 ${_escHtml(name)}</div>
          <div class="lb-my-rank">${
            myRank
              ? `Rank #${myRank} of ${total} student${total !== 1 ? 's' : ''}`
              : 'Your score'
          }</div>
        </div>
        <div class="lb-my-pts">${myScore.toFixed(2)}</div>
      `;
    }

    if (subEl) subEl.textContent = `${testName} · ${total} attempt${total !== 1 ? 's' : ''}`;

    // Render top list
    if (listEl) {
      listEl.innerHTML = '';
      liveData.top.forEach(r => {
        const isMe = r.uid === uid;
        const div  = document.createElement('div');
        div.className = 'lb-row' + (isMe ? ' lb-me' : '');
        div.innerHTML = `
          <div class="lb-rank">${medals[r.rank - 1] || '#' + r.rank}</div>
          <div class="lb-name">${_escHtml(r.name)}${isMe ? ' <span class="lb-you-tag">You</span>' : ''}</div>
          <div class="lb-score">${Number(r.score).toFixed(2)}</div>
        `;
        listEl.appendChild(div);
      });

      // Show user's entry below separator if outside top 10
      if (myRank && myRank > LB_MAX_ROWS) {
        const sep = document.createElement('div');
        sep.className = 'lb-rank-separator';
        sep.textContent = '• • •';
        listEl.appendChild(sep);

        const myDiv = document.createElement('div');
        myDiv.className = 'lb-row lb-me';
        myDiv.innerHTML = `
          <div class="lb-rank">#${myRank}</div>
          <div class="lb-name">${_escHtml(name)} <span class="lb-you-tag">You</span></div>
          <div class="lb-score">${myScore.toFixed(2)}</div>
        `;
        listEl.appendChild(myDiv);
      }
    }

  } else {
    // Firebase unreachable — show clear error with retry
    if (myScoreEl) {
      myScoreEl.innerHTML = `
        <div>
          <div class="lb-my-name">👤 ${_escHtml(name)}</div>
          <div class="lb-my-rank">Your score</div>
        </div>
        <div class="lb-my-pts">${myScore.toFixed(2)}</div>
      `;
    }
    if (listEl) {
      listEl.innerHTML = `
        <div style="text-align:center;padding:28px 16px;">
          <div style="font-size:30px;margin-bottom:10px;">⚠️</div>
          <div style="color:var(--text-secondary);font-size:13px;line-height:1.6;margin-bottom:16px;">
            Could not load rankings.<br>Check your connection and try again.
          </div>
          <button id="lb-retry-btn" style="
            background:var(--cyan-dim);border:1px solid var(--cyan);
            color:var(--cyan);border-radius:var(--r-md);padding:8px 20px;
            font-size:13px;font-weight:600;cursor:pointer;">
            🔄 Retry
          </button>
        </div>
      `;
      // Retry button re-runs the fetch
      document.getElementById('lb-retry-btn')?.addEventListener('click', async () => {
        if (listEl) listEl.innerHTML = '<div class="lb-loading">⏳ Fetching rankings…</div>';
        const retryData = await _fetchLbScores(testKey);
        if (retryData && retryData.top && retryData.top.length > 0) {
          const medals = ['🥇', '🥈', '🥉'];
          const myRank = retryData.myRank;
          const total  = retryData.total || 0;
          if (myScoreEl) {
            myScoreEl.innerHTML = `
              <div>
                <div class="lb-my-name">👤 ${_escHtml(name)}</div>
                <div class="lb-my-rank">${myRank ? `Rank #${myRank} of ${total} student${total !== 1 ? 's' : ''}` : 'Your score'}</div>
              </div>
              <div class="lb-my-pts">${myScore.toFixed(2)}</div>
            `;
          }
          if (subEl) subEl.textContent = `${testName} · ${total} attempt${total !== 1 ? 's' : ''}`;
          listEl.innerHTML = '';
          retryData.top.forEach(r => {
            const isMe = r.uid === uid;
            const div  = document.createElement('div');
            div.className = 'lb-row' + (isMe ? ' lb-me' : '');
            div.innerHTML = `
              <div class="lb-rank">${medals[r.rank - 1] || '#' + r.rank}</div>
              <div class="lb-name">${_escHtml(r.name)}${isMe ? ' <span class="lb-you-tag">You</span>' : ''}</div>
              <div class="lb-score">${Number(r.score).toFixed(2)}</div>
            `;
            listEl.appendChild(div);
          });
        } else {
          listEl.innerHTML = `<div class="lb-loading" style="color:var(--red);">Still unreachable. Check Firebase rules.</div>`;
        }
      }, { once: true });
    }
  }

  // Wire close buttons
  function _closeLb() {
    overlay.classList.remove('lb-open');
    setTimeout(() => overlay.classList.add('hidden'), 320);
    TG.Haptic.select();
  }

  closeBtn?.addEventListener('click', _closeLb, { once: true });
  contBtn?.addEventListener('click',  _closeLb, { once: true });
  overlay.addEventListener('click', e => {
    if (e.target === overlay) _closeLb();
  }, { once: true });
}

let _bootCalled = false;
async function boot() {
  // Guard: prevent double-boot (e.g. from service worker update triggers)
  if (_bootCalled) return;
  _bootCalled = true;

  // 1. Cache DOM
  _cacheDom();

  // 2. Init Telegram
  TG.init();

  // 3. Fetch questions
  let allQuestions;
  try {
    allQuestions = await fetchQuestions();
  } catch (err) {
    console.error('[Boot] Fetch error:', err);
    allQuestions = _getDemoData();
  }

  State.allQuestions = allQuestions;

  // 4. Update stats/streak
  _updateStats();

  // 5. Update saved badge
  const saved = ls_get(LS.SAVED, []);
  _updateSavedBadge(saved.length);

  // 6. Init tabs and buttons
  _initTabs();
  _initButtons();
  _initModeToggle();
  _initGlossarySheet();
  _initDailyTarget();
  _initMockButtons();
  _initSundayMegaBanner();
  _initSearch();
  _initTheme();           // ← NEW: dark/light toggle

  // 7. Dismiss splash — always runs, even if earlier steps errored
  const _dismissSplash = () => {
    DOM.splash?.classList.remove('hidden'); // ensure visible before fade
    DOM.splash?.classList.add('fade-out');
    setTimeout(() => {
      DOM.splash?.classList.add('hidden');
      DOM.app?.classList.remove('hidden');
    }, 200);
  };
  await _delay(300);
  _dismissSplash();

  // ── Channel join popup — shown right after splash clears, no Firebase wait ──
  setTimeout(() => {
    try { _showChannelPopup(); } catch(e) { console.warn('[ChannelPopup]', e); }
  }, 500);

  // 8. Show subject picker (card area hidden by default)
  DOM.cardArea?.classList.add('hidden');
  DOM.subjectPicker?.classList.remove('hidden');
  renderSubjectPicker();

  // 9. Firebase: restore test progress first (prevents unlock regression on update),
  //    then register user + start presence + load counts
  try { await _restoreTestProgressFromFirebase(); } catch(e) { console.warn('[FB] Restore failed:', e); }
  try { _fbRegisterUser(); } catch(e) { console.warn('[FB] Register failed:', e); }
  try { _startPresence();  } catch(e) { console.warn('[FB] Presence failed:', e); }
  try { _initUserCount();  } catch(e) { console.warn('[FB] UserCount failed:', e); }
  try { _fetchAnnouncements().then(() => {
    // Only show goal prompt if no announcement popup is currently visible
    setTimeout(() => {
      if (!document.getElementById('ann-popup-overlay')) {
        try { _maybeShowGoalPrompt(); } catch(e) {}
      }
    }, 400);
  }); } catch(e) { console.warn('[ANN] fetch failed:', e); }
}

// ════════════════════════════════════════════════════════════════
//  WHATSAPP DUMP  exportToWhatsApp()
//  Formats all saved cards into a WhatsApp-ready message and
//  opens wa.me so students can paste into their personal chat.
// ════════════════════════════════════════════════════════════════

function exportToWhatsApp() {
  const saved = ls_get(LS.SAVED, []);
  if (!saved.length) return;

  TG.Haptic.medium();

  const header  = '📚 *My AGRIMETS Revision Notes*';
  const footer  = '\n⚡ Practised via Agrimets Mini App\n🔗 t.me/Agrimets_bot/agrimets';

  const body = saved.map((item, i) =>
    `🔸 *Q${i + 1}:* ${item.question}\n🔹 *A:* ${item.answer}${item.category ? `\n📂 ${item.category}` : ''}`
  ).join('\n\n');

  const message    = `${header}\n\n${body}${footer}`;
  const waUrl      = `https://wa.me/?text=${encodeURIComponent(message)}`;

  // Open through Telegram (respects Mini App sandbox) or direct
  try {
    if (window.Telegram?.WebApp?.openLink) {
      window.Telegram.WebApp.openLink(waUrl);
    } else {
      window.open(waUrl, '_blank');
    }
  } catch (e) {
    window.open(waUrl, '_blank');
  }
}

// ════════════════════════════════════════════════════════════════
//  SEARCH FEATURE
//  ▸ Searches all questions by keyword
//  ▸ Shows results as a cram-style list with answers revealed
//  ▸ Tapping a result opens it as a swipe card in All Subjects mode
// ════════════════════════════════════════════════════════════════

function _initSearch() {
  const openBtn   = document.getElementById('btn-open-search');
  const closeBtn  = document.getElementById('btn-close-search');
  const clearBtn  = document.getElementById('btn-clear-search');
  const input     = document.getElementById('search-input');
  const overlay   = document.getElementById('search-overlay');

  if (!openBtn || !overlay) return;

  // Open
  openBtn.addEventListener('click', () => {
    overlay.classList.remove('hidden');
    TG.Haptic.light();
    TG.pushBack(() => _closeSearch());
    setTimeout(() => input?.focus(), 120);
  });

  // Close
  closeBtn?.addEventListener('click', () => _closeSearch());

  // Clear input
  clearBtn?.addEventListener('click', () => {
    if (input) { input.value = ''; input.focus(); }
    clearBtn.classList.add('hidden');
    _renderSearchResults('');
    TG.Haptic.light();
  });

  // Live search on input
  let _searchTimer = null;
  input?.addEventListener('input', () => {
    const q = input.value.trim();
    clearBtn?.classList.toggle('hidden', !q);
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => _renderSearchResults(q), 180);
  });

  input?.addEventListener('keydown', e => {
    if (e.key === 'Escape') _closeSearch();
  });
}

function _closeSearch() {
  const overlay = document.getElementById('search-overlay');
  const input   = document.getElementById('search-input');
  overlay?.classList.add('hidden');
  if (input) input.value = '';
  document.getElementById('btn-clear-search')?.classList.add('hidden');
  _renderSearchResults('');
  TG.popBack();
}

function _renderSearchResults(query) {
  const metaEl    = document.getElementById('search-meta');
  const resultEl  = document.getElementById('search-results');
  const emptyEl   = document.getElementById('search-empty-state');

  if (!resultEl) return;

  if (!query) {
    // Reset to empty state
    resultEl.innerHTML = '';
    if (emptyEl) {
      emptyEl.style.display = '';
      resultEl.appendChild(emptyEl);
    }
    if (metaEl) metaEl.innerHTML = '';
    return;
  }

  const qLower = query.toLowerCase();
  const terms  = qLower.split(/\s+/).filter(Boolean);

  // ── Auto-fetch mock data if not yet loaded ───────────────────
  if (MockData.allRows.length === 0) {
    const url = `https://opensheet.elk.sh/${CONFIG.SPREADSHEET_ID}/MockTests`;
    if (metaEl) metaEl.innerHTML = '⏳ Loading mock tests…';
    fetch(url, { cache: 'no-store' })
      .then(r => r.json())
      .then(raw => {
        if (!Array.isArray(raw) || raw.length === 0) return;
        MockData.allRows = raw.map(r => {
          const n = {};
          Object.keys(r).forEach(k => { n[k.toLowerCase().trim()] = String(r[k] ?? '').trim(); });
          return n;
        });
        // Re-run search now that data is loaded
        _renderSearchResults(query);
      })
      .catch(() => {
        // Silently fall through — show swipe card results only
        _renderSearchResultsCore(query, terms, metaEl, resultEl);
      });
    // Render swipe card results immediately while mock loads
    _renderSearchResultsCore(query, terms, metaEl, resultEl);
    return;
  }

  _renderSearchResultsCore(query, terms, metaEl, resultEl);
}

function _renderSearchResultsCore(query, terms, metaEl, resultEl) {
  // ── Search swipe cards ───────────────────────────────────────
  const cardMatches = State.allQuestions.filter(q => {
    const hay = (q.question + ' ' + q.answer + ' ' + q.category).toLowerCase();
    return terms.every(t => hay.includes(t));
  });

  // ── Search mock test rows ────────────────────────────────────
  const mockMatches = MockData.allRows.filter(r => {
    const hay = (
      (r.question || '') + ' ' +
      (r.answer   || '') + ' ' +
      (r.category || '') + ' ' +
      (r.opt_a || '') + ' ' + (r.opt_b || '') + ' ' +
      (r.opt_c || '') + ' ' + (r.opt_d || '') + ' ' + (r.opt_e || '')
    ).toLowerCase();
    return terms.every(t => hay.includes(t));
  });

  const total = cardMatches.length + mockMatches.length;

  if (metaEl) {
    metaEl.innerHTML = total > 0
      ? `<span class="search-meta-highlight">${total}</span> result${total !== 1 ? 's' : ''} for "<strong>${_escHtml(query)}</strong>"`
      : `No results for "<strong>${_escHtml(query)}</strong>"`;
  }

  resultEl.innerHTML = '';

  if (total === 0) {
    const noResult = document.createElement('div');
    noResult.className = 'search-empty-state';
    noResult.innerHTML = `
      <div class="search-empty-icon">😕</div>
      <p class="search-empty-title">No matches found</p>
      <p class="search-empty-sub">Try different keywords or check spelling</p>
    `;
    resultEl.appendChild(noResult);
    return;
  }

  // ── Render swipe card results ────────────────────────────────
  cardMatches.slice(0, 100).forEach((q) => {
    const item = document.createElement('div');
    item.className = 'search-result-item';

    const qHtml = _highlightTerms(_escHtml(q.question), terms);
    const aHtml = _highlightTerms(_escHtml(q.answer),   terms);

    item.innerHTML = `
      <div class="search-result-category">${_escHtml(q.category || 'General')}</div>
      <div class="search-result-question">${qHtml}</div>
      <div class="search-result-divider"></div>
      <div class="search-result-answer-wrap">
        <span class="search-result-answer-label">ANS</span>
        <span class="search-result-answer">${aHtml}</span>
      </div>
      <div class="search-result-open-hint">Tap to open as card →</div>
    `;

    item.addEventListener('click', () => _openCardFromSearch(q, cardMatches));
    resultEl.appendChild(item);
  });

  // ── Render mock test results ─────────────────────────────────
  mockMatches.slice(0, 60).forEach((r) => {
    const item = document.createElement('div');
    item.className = 'search-result-item';

    const qHtml = _highlightTerms(_escHtml(r.question || ''), terms);
    const aHtml = _highlightTerms(_escHtml(r.answer   || ''), terms);
    const cat   = _escHtml(r.category || 'Mock Test');
    const tno   = r.test_no ? ` · Test ${_escHtml(r.test_no)}` : '';

    item.innerHTML = `
      <div class="search-result-category" style="display:flex;align-items:center;gap:6px;">
        ${cat}${tno}
        <span class="search-mcq-badge">MCQ</span>
      </div>
      <div class="search-result-question">${qHtml}</div>
      <div class="search-result-divider"></div>
      <div class="search-result-answer-wrap">
        <span class="search-result-answer-label">ANS</span>
        <span class="search-result-answer">${aHtml}</span>
      </div>
      <div class="search-result-open-hint">Tap to open as card →</div>
    `;

    item.addEventListener('click', () => _openMockCardFromSearch(r));
    resultEl.appendChild(item);
  });
}

/** Wraps each matched term in a highlight span */
function _highlightTerms(html, terms) {
  let result = html;
  terms.forEach(term => {
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re  = new RegExp(`(${esc})`, 'gi');
    result = result.replace(re, '<span class="search-highlight">$1</span>');
  });
  return result;
}

/** Opens the tapped search result as a swipe card in All Subjects context */
function _openCardFromSearch(question, allMatches) {
  TG.Haptic.medium();

  // Close search overlay first
  const overlay = document.getElementById('search-overlay');
  overlay?.classList.add('hidden');
  TG.popBack();

  // Build pool: tapped question first, rest of ALL questions after (shuffled)
  const rest = shuffle(State.allQuestions.filter(q => q.id !== question.id));
  const pool = [question, ...rest];

  // Set up state as if user selected All Subjects
  State.activeSubject  = '__ALL__';
  State.currentIndex   = 0;
  State.sessionSaved   = 0;
  State.sessionSkipped = 0;
  State.sessionStack   = [];
  State.stackPos       = -1;
  State.dailyCards     = pool;

  // Label the deck
  if (DOM.activeSubjectName)
    DOM.activeSubjectName.textContent = 'All Subjects';

  // Show card area in SWIPE mode (always, regardless of cramMode setting)
  DOM.subjectPicker?.classList.add('hidden');
  DOM.cardArea?.classList.remove('hidden');

  if (DOM.cramView) {
    DOM.cramView.classList.add('hidden');
    DOM.cramView.innerHTML = '';
  }
  DOM.cardArena?.classList.remove('hidden');
  DOM.actionRow?.classList.remove('hidden');

  // Back → subject picker (standard behaviour)
  TG.pushBack(() => showSubjectPicker());

  _updateDailyProgress();
  _renderCard(pool[0]);
}

/** Opens a mock MCQ row as a swipe card. Back → home (subject picker). */
function _openMockCardFromSearch(mockRow) {
  TG.Haptic.medium();

  // Convert MCQ row to card-compatible object
  const card = {
    id:       mockRow.id || mockRow.question,
    question: mockRow.question || '',
    answer:   mockRow.answer   || '',
    category: mockRow.category || 'Mock Test',
  };

  // Close search overlay
  const overlay = document.getElementById('search-overlay');
  overlay?.classList.add('hidden');
  TG.popBack();

  // Build pool: this card first, then all swipe questions shuffled
  const rest = shuffle([...State.allQuestions]);
  const pool = [card, ...rest];

  State.activeSubject  = '__ALL__';
  State.currentIndex   = 0;
  State.sessionSaved   = 0;
  State.sessionSkipped = 0;
  State.sessionStack   = [];
  State.stackPos       = -1;
  State.dailyCards     = pool;

  if (DOM.activeSubjectName)
    DOM.activeSubjectName.textContent = 'All Subjects';

  DOM.subjectPicker?.classList.add('hidden');
  DOM.cardArea?.classList.remove('hidden');

  if (DOM.cramView) {
    DOM.cramView.classList.add('hidden');
    DOM.cramView.innerHTML = '';
  }
  DOM.cardArena?.classList.remove('hidden');
  DOM.actionRow?.classList.remove('hidden');

  // Back → home (subject picker) directly
  TG.pushBack(() => showSubjectPicker());

  _updateDailyProgress();
  _renderCard(pool[0]);
}

// ════════════════════════════════════════════════════════════════
//  NEW MOCK TEST FEATURES  (Features 1–4)
//  Added cleanly below existing code — no existing functions
//  were removed or broken above.
// ════════════════════════════════════════════════════════════════

// ── FEATURE 1+2: Question Bubble Navigator ────────────────────

/** Build the full row of numbered bubbles (called once per test start) */
function _renderQBubbles() {
  const row = document.getElementById('mock-bubble-row');
  if (!row) return;
  row.innerHTML = '';
  MockData.questions.forEach((_, i) => {
    const b = document.createElement('button');
    b.className    = 'q-bubble q-bubble-unattempted';
    b.id           = 'qb-' + i;
    b.textContent  = i + 1;
    b.setAttribute('aria-label', 'Go to question ' + (i + 1));
    b.addEventListener('click', () => {
      TG.Haptic.light();
      MockData.currentIndex = i;
      _loadMockQuestion();
    });
    row.appendChild(b);
  });
  _highlightCurrentBubble(0);
}

/** Update a single bubble's colour to match its status */
function _updateQBubble(idx) {
  const b  = document.getElementById('qb-' + idx);
  if (!b) return;
  const st = MockData.questionStatuses[idx];
  b.className = 'q-bubble q-bubble-' + (st || 'unattempted');
}

/** Highlight the current question's bubble as active */
function _highlightCurrentBubble(idx) {
  document.querySelectorAll('.q-bubble').forEach(b => b.classList.remove('q-bubble-current'));
  const cur = document.getElementById('qb-' + idx);
  if (cur) {
    cur.classList.add('q-bubble-current');
    // Auto-scroll bubble into view
    cur.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }
}

/** Find the next question index to jump to after skip/review.
 *  Prefers the next unattempted; falls back to the very next index; wraps if needed. */
function _findNextQuestion(fromIdx) {
  const total = MockData.questions.length;
  // Try forward from fromIdx+1
  for (let i = fromIdx + 1; i < total; i++) {
    if (MockData.questionStatuses[i] === 'unattempted') return i;
  }
  // Try wrapping from start
  for (let i = 0; i < fromIdx; i++) {
    if (MockData.questionStatuses[i] === 'unattempted') return i;
  }
  // All answered — stay at next or clamp to last
  return Math.min(fromIdx + 1, total - 1);
}

// ── FEATURE 4: 40-minute Countdown Timer ─────────────────────

function _updateMockTimerUI() {
  const el = document.getElementById('mock-arena-timer');
  if (!el) return;
  const s   = MockData.timerSecondsLeft;
  const min = Math.floor(s / 60).toString().padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  el.textContent = `${min}:${sec}`;
  // Turn red in last 5 minutes
  el.classList.toggle('mock-timer-urgent', s <= 300);
}

function _mockTimerTick() {
  if (MockData.timerSecondsLeft <= 0) {
    clearInterval(MockData.timerInterval);
    showToast('⏱ Time up! Auto-submitting…', 2500);
    TG.Haptic.warning();
    setTimeout(_submitMockTest, 800);
    return;
  }
  MockData.timerSecondsLeft--;
  _updateMockTimerUI();
  if (MockData.timerSecondsLeft === 300) {
    showToast('⚠️ 5 minutes left!', 2500);
    TG.Haptic.heavy();
  } else if (MockData.timerSecondsLeft === 60) {
    showToast('⏱ 1 minute remaining!', 2000);
    TG.Haptic.heavy();
  }
}

// ── Submit helpers ────────────────────────────────────────────

/**
 * Confirm before submitting — counts unanswered questions and
 * warns user, then calls _submitMockTest().
 */
function _confirmAndSubmitMock() {
  const unanswered = MockData.questionStatuses.filter(
    s => s === 'unattempted' || s === 'skipped'
  ).length;

  if (unanswered > 0) {
    TG.confirm(
      `You have ${unanswered} unanswered question${unanswered !== 1 ? 's' : ''}.\nSubmit anyway?`,
      () => _submitMockTest()
    );
  } else {
    TG.confirm('Submit the test now?', () => _submitMockTest());
  }
}

/**
 * Master submit function — called by Submit button, timer auto-submit,
 * and last-question Next press.
 */
function _submitMockTest() {
  clearInterval(MockData.timerInterval);
  _finishMock();
}

// ── FEATURE 3: Post-Test Group Join Popup ─────────────────────

function _showPostTestGroupPopup() {
  const overlay  = document.getElementById('post-test-popup-overlay');
  const joinBtn  = document.getElementById('post-test-join-btn');
  const closeBtn = document.getElementById('post-test-popup-close');
  const skipBtn  = document.getElementById('post-test-skip-btn');
  if (!overlay) return;

  overlay.classList.remove('hidden');
  TG.Haptic.light();

  function _close() {
    overlay.classList.add('hidden');
    TG.Haptic.select();
  }

  closeBtn?.addEventListener('click', _close, { once: true });
  skipBtn?.addEventListener('click',  _close, { once: true });
  joinBtn?.addEventListener('click',  () => {
    TG.Haptic.medium();
    setTimeout(_close, 200);
  }, { once: true });
}

// ════════════════════════════════════════════════════════════════
//  MOCK TEST PROGRESS — Firebase backup + restore
//
//  WHY: Telegram WebApp localStorage can be cleared when users
//  update the app or reinstall Telegram. By mirroring the daily
//  test-unlock progress to Firebase (keyed by device UID), we can
//  restore it automatically on the next boot even after a wipe.
//
//  Firebase path: agrimets/test_progress/{uid}/{cat_key}
//  Value: { date, testNo, used: [] }  — mirrors the localStorage key
// ════════════════════════════════════════════════════════════════

/**
 * Write one category's test-progress to Firebase.
 * Called every time _getDailyTestNo() picks a new test.
 * Fire-and-forget (no await needed at call site).
 */
async function _fbBackupTestProgress(catNorm, progressData) {
  if (!CONFIG.FB_URL) return;
  try {
    const uid    = _getOrCreateUid();
    const fbKey  = catNorm.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
    await _fbPut(`agrimets/test_progress/${uid}/${fbKey}`, progressData);
  } catch (e) {
    console.warn('[Progress] Firebase backup failed:', e);
  }
}

/**
 * On boot: pull any test_progress from Firebase and merge into
 * localStorage — taking whichever version has MORE used tests.
 * This restores progress after a localStorage wipe.
 */
async function _restoreTestProgressFromFirebase() {
  if (!CONFIG.FB_URL) return;
  try {
    const uid  = _getOrCreateUid();
    const data = await _fbGet(`agrimets/test_progress/${uid}`);
    if (!data || typeof data !== 'object') return;

    Object.entries(data).forEach(([fbKey, val]) => {
      if (!val || !Array.isArray(val.used)) return;

      const lsKey  = 'dca_daily_' + fbKey;
      const stored = ls_get(lsKey, { date: '', testNo: null, used: [] });
      const storedUsed = Array.isArray(stored.used) ? stored.used : [];

      // Only overwrite local if Firebase has MORE unlocked tests
      // (never downgrade — protects against accidental data loss in Firebase)
      if (val.used.length > storedUsed.length) {
        ls_set(lsKey, val);
        console.info(`[Progress] Restored ${lsKey} from Firebase (${val.used.length} tests).`);
      }
    });
  } catch (e) {
    console.warn('[Progress] Firebase restore failed:', e);
  }
}

// ════════════════════════════════════════════════════════════════
//  FEATURE: DARK / LIGHT THEME TOGGLE
// ════════════════════════════════════════════════════════════════

function _initTheme() {
  const saved = ls_get(LS.THEME, 'dark');
  _applyTheme(saved, false);

  document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    _applyTheme(next, true);
    TG.Haptic.light();
  });
}

function _applyTheme(theme, save) {
  document.documentElement.setAttribute('data-theme', theme);
  const icon = document.getElementById('theme-toggle-icon');
  if (icon) icon.textContent = theme === 'light' ? '🌙' : '☀️';
  // Update meta theme-color so browser chrome adapts
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.content = theme === 'light' ? '#f0f4ff' : '#0a0a12';
  if (save) ls_set(LS.THEME, theme);
}

// ════════════════════════════════════════════════════════════════
//  FEATURE: SHARE CARD AS IMAGE (Canvas-rendered card PNG)
// ════════════════════════════════════════════════════════════════

function _wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let lines = [];
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
  return lines.length;
}

function _shareCardAsImage(question) {
  const SIZE = 1080;
  const canvas = document.createElement('canvas');
  canvas.width  = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');

  const isLight = document.documentElement.getAttribute('data-theme') === 'light';

  // ── Background ────────────────────────────────────────────────
  const bgGrad = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  if (isLight) {
    bgGrad.addColorStop(0, '#e8f0fe');
    bgGrad.addColorStop(1, '#c7d8fa');
  } else {
    bgGrad.addColorStop(0, '#09090f');
    bgGrad.addColorStop(1, '#181826');
  }
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Accent glow (top-left)
  const glow = ctx.createRadialGradient(200, 160, 0, 200, 160, 520);
  glow.addColorStop(0, isLight ? 'rgba(0,100,255,0.10)' : 'rgba(0,229,255,0.13)');
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // ── Card box ──────────────────────────────────────────────────
  const PAD  = 64;
  const CX   = PAD;
  const CY   = 160;
  const CW   = SIZE - PAD * 2;
  const CH   = SIZE - CY - 140;
  const R    = 40;

  ctx.beginPath();
  ctx.moveTo(CX + R, CY);
  ctx.lineTo(CX + CW - R, CY);
  ctx.quadraticCurveTo(CX + CW, CY, CX + CW, CY + R);
  ctx.lineTo(CX + CW, CY + CH - R);
  ctx.quadraticCurveTo(CX + CW, CY + CH, CX + CW - R, CY + CH);
  ctx.lineTo(CX + R, CY + CH);
  ctx.quadraticCurveTo(CX, CY + CH, CX, CY + CH - R);
  ctx.lineTo(CX, CY + R);
  ctx.quadraticCurveTo(CX, CY, CX + R, CY);
  ctx.closePath();
  ctx.fillStyle = isLight ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.05)';
  ctx.fill();
  ctx.strokeStyle = isLight ? 'rgba(0,100,255,0.18)' : 'rgba(0,229,255,0.2)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // ── Header: logo + app name ───────────────────────────────────
  ctx.font = 'bold 42px DM Sans, sans-serif';
  ctx.fillStyle = '#00e5ff';
  ctx.textAlign = 'left';
  ctx.fillText('⚡ AGRIMETS', PAD, 100);

  // Category badge
  const cat = (question.category || 'Agriculture').toUpperCase();
  ctx.font = 'bold 24px DM Sans, sans-serif';
  const badgeW = ctx.measureText(cat).width + 36;
  const badgeX = SIZE - PAD - badgeW;
  const badgeY = 64;

  // roundRect not available in older WebView — use manual path
  ctx.beginPath();
  const br = 19;
  ctx.moveTo(badgeX + br, badgeY);
  ctx.lineTo(badgeX + badgeW - br, badgeY);
  ctx.quadraticCurveTo(badgeX + badgeW, badgeY, badgeX + badgeW, badgeY + br);
  ctx.lineTo(badgeX + badgeW, badgeY + 38 - br);
  ctx.quadraticCurveTo(badgeX + badgeW, badgeY + 38, badgeX + badgeW - br, badgeY + 38);
  ctx.lineTo(badgeX + br, badgeY + 38);
  ctx.quadraticCurveTo(badgeX, badgeY + 38, badgeX, badgeY + 38 - br);
  ctx.lineTo(badgeX, badgeY + br);
  ctx.quadraticCurveTo(badgeX, badgeY, badgeX + br, badgeY);
  ctx.closePath();
  ctx.fillStyle = isLight ? 'rgba(0,100,255,0.15)' : 'rgba(0,229,255,0.15)';
  ctx.fill();
  ctx.fillStyle = isLight ? '#0050cc' : '#00e5ff';
  ctx.textAlign = 'center';
  ctx.fillText(cat, badgeX + badgeW / 2, badgeY + 26);

  // ── Q label ───────────────────────────────────────────────────
  ctx.textAlign = 'left';
  ctx.font = 'bold 28px DM Sans, sans-serif';
  ctx.fillStyle = isLight ? '#0050cc' : '#00e5ff';
  ctx.fillText('Question', CX + 44, CY + 60);

  // ── Question text ─────────────────────────────────────────────
  ctx.font = '34px Times New Roman, serif';
  ctx.fillStyle = isLight ? '#1a1a2e' : '#e8eaf6';
  const qLines = _wrapText(ctx, question.question, CX + 44, CY + 110, CW - 88, 50);

  // ── Divider ───────────────────────────────────────────────────
  const divY = CY + 120 + qLines * 50;
  ctx.strokeStyle = isLight ? 'rgba(0,100,255,0.2)' : 'rgba(0,229,255,0.2)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(CX + 44, divY);
  ctx.lineTo(CX + CW - 44, divY);
  ctx.stroke();

  // ── Answer label ──────────────────────────────────────────────
  ctx.font = 'bold 28px DM Sans, sans-serif';
  ctx.fillStyle = isLight ? '#007a3d' : '#00e676';
  ctx.fillText('✅  Answer', CX + 44, divY + 50);

  // ── Answer text ───────────────────────────────────────────────
  ctx.font = '32px Times New Roman, serif';
  ctx.fillStyle = isLight ? '#1a1a2e' : '#e8eaf6';
  _wrapText(ctx, question.answer, CX + 44, divY + 96, CW - 88, 46);

  // ── Footer watermark ──────────────────────────────────────────
  ctx.font = '26px DM Sans, sans-serif';
  ctx.fillStyle = isLight ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.35)';
  ctx.textAlign = 'center';
  ctx.fillText('🌾 Study smarter with AGRIMETS · t.me/Agrimets_bot', SIZE / 2, SIZE - 56);

  // ── Share the image ───────────────────────────────────────────
  canvas.toBlob(blob => {
    if (!blob) { showToast('Could not create image', 1800); return; }
    const file = new File([blob], 'agrimets-card.png', { type: 'image/png' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: 'AGRIMETS Card' })
        .then(() => { TG.Haptic.success(); showToast('Shared! 🎉', 1800); })
        .catch(() => {});
    } else if (navigator.share) {
      // Fallback: share as text (no file support)
      _shareCard(question);
    } else {
      // Last resort: download PNG
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href = url; a.download = 'agrimets-card.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      showToast('Image saved! 📥', 2000);
    }
  }, 'image/png');
}

// ════════════════════════════════════════════════════════════════
//  FEATURE: DAILY GOAL — First-Boot Prompt
// ════════════════════════════════════════════════════════════════

function _maybeShowGoalPrompt() {
  // Show only once, if user has never set a target and has seen 0 cards
  const alreadySet = ls_get(LS.DAILY_TARGET, null);
  const hasSeenCards = (ls_get(LS.STATS, { totalSeen: 0 }).totalSeen || 0) > 0;
  if (alreadySet || hasSeenCards) return;

  const overlay = document.createElement('div');
  overlay.className = 'goal-prompt-overlay';
  overlay.innerHTML = `
    <div class="goal-prompt-card">
      <div class="goal-prompt-icon">🎯</div>
      <h2 class="goal-prompt-title">Set Your Daily Goal</h2>
      <p class="goal-prompt-sub">How many cards do you want to study each day?</p>
      <div class="goal-prompt-presets">
        <button class="goal-preset-btn" data-val="10">10 <span>Easy</span></button>
        <button class="goal-preset-btn" data-val="25">25 <span>Regular</span></button>
        <button class="goal-preset-btn" data-val="50">50 <span>Serious</span></button>
        <button class="goal-preset-btn" data-val="100">100 <span>Pro</span></button>
      </div>
      <button class="goal-prompt-skip">Skip for now</button>
    </div>
  `;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('goal-prompt-open'));

  function _setAndClose(val) {
    ls_set(LS.DAILY_TARGET, val);
    overlay.classList.remove('goal-prompt-open');
    setTimeout(() => overlay.remove(), 320);
    if (val) showToast(`Daily goal set: ${val} cards 🎯`, 2200);
    TG.Haptic.success();
  }

  overlay.querySelectorAll('.goal-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => _setAndClose(Number(btn.dataset.val)));
  });
  overlay.querySelector('.goal-prompt-skip')
    .addEventListener('click', () => _setAndClose(25)); // default 25
}

// ════════════════════════════════════════════════════════════════
//  FEATURE: ADMIN ANNOUNCEMENTS (Firebase-driven banner)
// ════════════════════════════════════════════════════════════════

async function _fetchAnnouncements() {
  if (!CONFIG.FB_URL) return;
  try {
    const data = await _fbGet('agrimets/announcements');
    if (!data || typeof data !== 'object') return;

    const now = Date.now();
    // seenMap: { [id]: seenAt_timestamp } — object so we can check timing per entry
    let seenMap = ls_get(LS.ANN_SEEN, {});
    // Migrate legacy array format (old code stored plain array of IDs)
    if (Array.isArray(seenMap)) {
      const migrated = {};
      seenMap.forEach(id => { migrated[id] = now; });
      seenMap = migrated;
      ls_set(LS.ANN_SEEN, seenMap);
    }

    let latest = null;

    Object.entries(data).forEach(([id, ann]) => {
      if (!ann || !ann.active) return;
      // Skip if the announcement's own expiry has passed
      if (ann.expiresAt && ann.expiresAt < now) return;

      // User-seen check: once a user dismisses an announcement ID, never show it
      // again until it expires and admin creates a new one (new ID = new timestamp)
      const seenAt = seenMap[id];
      if (seenAt) return;

      if (!latest || ann.createdAt > latest.createdAt) {
        latest = { ...ann, id };
      }
    });

    if (!latest) return;
    _showAnnouncementBanner(latest);
  } catch (e) {
    console.warn('[ANN] fetch failed:', e);
  }
}

function _showAnnouncementBanner(ann) {
  // ── Build center popup (same style as daily-target celebration) ──
  const existing = document.getElementById('ann-popup-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id        = 'ann-popup-overlay';
  overlay.className = 'ann-popup-overlay';

  // Pick accent colour by type
  const colours = {
    info:    { border: 'rgba(0,180,255,0.45)',  glow: 'rgba(0,180,255,0.18)',  icon: '#00b4d8' },
    success: { border: 'rgba(0,230,118,0.45)',  glow: 'rgba(0,230,118,0.18)',  icon: '#00e676' },
    warning: { border: 'rgba(255,171,0,0.45)',  glow: 'rgba(255,171,0,0.18)',  icon: '#ffab00' },
    danger:  { border: 'rgba(255,82,82,0.45)',  glow: 'rgba(255,82,82,0.18)',  icon: '#ff5252' },
  };
  const c = colours[ann.type || 'info'];

  overlay.innerHTML = `
    <div class="ann-popup-card" style="border-color:${c.border};box-shadow:0 0 40px ${c.glow},0 24px 60px rgba(0,0,0,0.6),0 0 0 1px ${c.border};">
      <div class="ann-popup-emoji">${ann.emoji || '📢'}</div>
      <div class="ann-popup-msg">${_escHtml ? _escHtml(ann.message || '') : (ann.message || '')}</div>
      <button class="ann-popup-close" id="ann-popup-close-btn">Got it ✓</button>
    </div>
  `;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('ann-popup-open'));

  function _close() {
    // Mark as seen with timestamp so interval logic works correctly
    let seenMap = ls_get(LS.ANN_SEEN, {});
    if (Array.isArray(seenMap)) seenMap = {};
    seenMap[ann.id] = Date.now();
    ls_set(LS.ANN_SEEN, seenMap);

    overlay.classList.remove('ann-popup-open');
    overlay.classList.add('ann-popup-closing');
    setTimeout(() => overlay.remove(), 300);
    TG.Haptic.select();
  }

  document.getElementById('ann-popup-close-btn')?.addEventListener('click', _close, { once: true });
  overlay.addEventListener('click', e => { if (e.target === overlay) _close(); });
}

// ── Wait for DOM ──────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
