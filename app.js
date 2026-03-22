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
      <div style="color:#5c6bc0;font-size:10px;margin-top:
