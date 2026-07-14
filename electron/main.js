const { app, BrowserWindow, Tray, Menu, nativeImage, screen, dialog, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const activeWin = require('active-win');
const markdownStorage = require('./markdown-storage');

const HOUR_MS = 60 * 60 * 1000;
const AUDIO_DISABLED = true;
const SEQUENTIAL_TERMINAL_STATUSES = Object.freeze(['done', 'cancelled']);
const SEQUENTIAL_TERMINAL_STATUS_SQL = SEQUENTIAL_TERMINAL_STATUSES.map(status => `'${status}'`).join(', ');
const ALLOWED_SNOOZE_REASONS = Object.freeze(['not_today', 'remind_1h', 'no_motivation', 'not_now']);
const AUDIO_DISABLED_SETTINGS = Object.freeze({
  audioDisabled: true,
  audioSuppressed: true,
  audio_volume: '0',
  music_volume: '0',
  background_music: null
});

const CHESS_MATE_FIXTURES = Object.freeze([
  {
    id: 'mate-1', turn: 'black', move: 'Rf8-f1#', from: 'f8', to: 'f1',
    pieces: ['wK:h1','wR:f1','wR:b1','wB:d3','wP:h2','wP:a3','wP:b4','wP:c4','wP:c5','wP:g4','bK:h8','bQ:d4','bR:f8','bN:c7','bN:g7','bP:a7','bP:h7','bP:b6','bP:c6','bP:e6','bP:g6']
  },
  {
    id: 'mate-2', turn: 'black', move: 'Bc8-b7#', from: 'c8', to: 'b7',
    pieces: ['wK:g1','wQ:g4','wR:a1','wR:e1','wB:b2','wN:d2','wP:a3','wP:b4','wP:c5','wP:e3','wP:f2','wP:g2','wP:h3','bK:g8','bQ:d8','bR:a8','bR:f8','bB:e7','bB:c8','bP:a6','bP:b5','bP:c6','bP:d5','bP:e6','bP:f7','bP:g7','bP:h6']
  },
  {
    id: 'mate-3', turn: 'black', move: 'Qf6-f3#', from: 'f6', to: 'f3',
    pieces: ['wK:h1','wQ:c2','wR:a1','wR:f1','wB:b1','wN:a3','wP:a2','wP:b2','wP:c3','wP:d4','wP:f3','bK:g8','bQ:f6','bR:a8','bR:f8','bB:h2','bN:c6','bP:a6','bP:b7','bP:c4','bP:d5','bP:f7','bP:g7','bP:h7']
  },
  {
    id: 'mate-4', turn: 'black', move: 'd5-d4#', from: 'd5', to: 'd4',
    pieces: ['wK:c1','wQ:e2','wR:a1','wR:d1','wB:b2','wB:g2','wN:c3','wP:a4','wP:b3','wP:c2','wP:d2','wP:f2','wP:g4','wP:h4','bK:g8','bQ:f6','bR:a8','bR:e8','bB:c8','bB:d4','bN:c6','bP:a6','bP:b7','bP:c7','bP:d5','bP:f7','bP:g7','bP:h7']
  },
  {
    id: 'mate-5', turn: 'black', move: 'Rd8-d1#', from: 'd8', to: 'd1',
    pieces: ['wK:a1','wQ:h5','wR:d1','wB:c3','wN:f3','wP:a2','wP:b2','wP:e5','wP:f4','wP:h2','bK:c8','bR:d8','bR:f8','bN:e7','bP:a7','bP:c7','bP:f7','bP:h7']
  }
]);

function normalizePopupBudget(value) {
  const budget = Math.floor(Number(value));
  return Number.isFinite(budget) && budget > 0 ? budget : 1;
}

function calculateNextPopupSchedule({
  now = Date.now(),
  schedulerStartedAt = now,
  lastPopupAt = null,
  recentPopupTimestamps = [],
  maxPopupsPerHour
}) {
  const budget = normalizePopupBudget(maxPopupsPerHour);
  const slotIntervalMs = HOUR_MS / budget;
  const currentTime = Number(now);
  const startedAt = Number(schedulerStartedAt);
  const lastShownAt = Number(lastPopupAt);
  const anchorAt = Number.isFinite(lastShownAt) && lastShownAt >= currentTime - HOUR_MS && lastShownAt <= currentTime
    ? lastShownAt
    : startedAt;
  const recentWindowStart = currentTime - HOUR_MS;
  const recent = recentPopupTimestamps
    .map(Number)
    .filter(timestamp => Number.isFinite(timestamp) && timestamp >= recentWindowStart && timestamp <= currentTime)
    .sort((a, b) => a - b);
  const elapsedSlots = Math.floor(Math.max(0, currentTime - anchorAt) / slotIntervalMs);
  let slotNumber = elapsedSlots + 1;
  let nextPopupAt = anchorAt + slotNumber * slotIntervalMs;
  let rollingWindowAvailableAt = null;

  if (recent.length >= budget) {
    const expirationsNeeded = recent.length - budget + 1;
    rollingWindowAvailableAt = recent[expirationsNeeded - 1] + HOUR_MS;
    if (nextPopupAt < rollingWindowAvailableAt) {
      slotNumber = Math.ceil((rollingWindowAvailableAt - anchorAt) / slotIntervalMs);
      nextPopupAt = anchorAt + Math.max(1, slotNumber) * slotIntervalMs;
    }
  }

  return {
    nextPopupAt,
    delayMs: Math.max(0, nextPopupAt - currentTime),
    slotIntervalMs,
    maxPopupsPerHour: budget,
    usedPopupCount: recent.length,
    rollingWindowAvailableAt,
    anchorAt,
    windowStartAt: recentWindowStart,
    windowEndAt: currentTime
  };
}

function validateChessFixtureMove(fixture) {
  const board = new Map(fixture.pieces.map(entry => {
    const [piece, square] = String(entry).split(':');
    return [square, piece];
  }));
  const movingPiece = board.get(fixture.from);
  const targetPiece = board.get(fixture.to);
  const expectedColor = fixture.turn === 'black' ? 'b' : 'w';
  if (!movingPiece || !movingPiece.startsWith(expectedColor)) return { legal: false, reason: 'missing-or-wrong-turn-piece' };
  if (targetPiece && targetPiece[0] === movingPiece[0]) return { legal: false, reason: 'target-occupied-by-own-piece' };
  return { legal: true, reason: 'fixture-basic-legality-passed' };
}

function getPopupEventRoute(importanceValue, tipId = null) {
  const importance = Math.max(1, Math.min(10, Number(importanceValue) || 1));
  if (importance <= 2) return { eventType: 'dismiss', importanceBucket: '1-2', routeReason: 'importance-1-2-dismiss-only' };
  if (importance <= 4) {
    const numericId = Number(tipId);
    const fixtureIndex = Number.isFinite(numericId) ? Math.abs(Math.trunc(numericId)) % CHESS_MATE_FIXTURES.length : 0;
    const fixture = CHESS_MATE_FIXTURES[fixtureIndex];
    const verification = validateChessFixtureMove(fixture);
    return {
      eventType: 'chess-one-move-mate',
      importanceBucket: '3-4',
      routeReason: 'importance-3-4-chess',
      chessFixture: { ...fixture, legalMoveVerified: verification.legal, validationReason: verification.reason, checkmateClaimed: fixture.move.endsWith('#') }
    };
  }
  if (importance <= 6) return { eventType: 'hold-to-dismiss', importanceBucket: '5-6', routeReason: 'importance-5-6-hold' };
  if (importance <= 8) return { eventType: 'wordle', importanceBucket: '7-8', routeReason: 'importance-7-8-wordle' };
  return { eventType: 'math', importanceBucket: '9-10', routeReason: 'importance-9-10-math-no-dismiss-or-snooze' };
}

let mainWindow = null;
let tray = null;
let popupWindow = null;
let timerWindow = null;
let pendingTipData = null;
let checkinWindow = null;
let quickCaptureWindow = null;
let popupQueue = [];
let popupQueuedKeys = new Set();
let activePopupKey = null;
let titleCheckInterval = null;
let randomPopupInterval = null;
let randomPopupSchedulerStartedAt = null;
let debugPopupInterval = null;
let debugPopupCount = 0;
let popupSelectionSequence = 0;
let lastShownTips = new Map(); // Track tips shown in last hour
let audioSettings = null; // Cache audio settings
let currentTipForTimer = null; // Store tip data for timer follow-up
let focusMode = null; // Focus mode state: { categoryId, categoryName, categoryColor } or null
let lastActiveProcessName = '';
let markdownWatcher = null;
let markdownWatchDebounce = null;
let lastMarkdownWriteAt = 0;
let isApplyingMarkdownReadBack = false;
let popupDebugState = {
  activeWindow: null,
  lastTrackedMatch: null,
  nextTrigger: null,
  lastScoring: null,
  lastCandidate: null,
  lastSuppression: null,
  lastSchedulerAttempt: null,
  lastSequentialProgression: null,
  lastSnoozeValidation: null,
  activePopupKey: null,
  queueLength: 0,
  updatedAt: null
};

// Initialize database (async)
async function initApp() {
  await db.initialize();
  ensureGeneralSubcategoriesForAll();
  loadAudioSettings();
  syncMarkdownStorageSafe('startup');
  setupMarkdownStorageWatcher();
}

function syncMarkdownStorageSafe(reason) {
  try {
    lastMarkdownWriteAt = Date.now();
    const result = markdownStorage.syncFromDatabase(db, reason);
    lastMarkdownWriteAt = Date.now();
    console.log(`[MarkdownStorage] Synced (${reason}) to ${result.root}`);
  } catch (error) {
    console.error(`[MarkdownStorage] Sync failed (${reason}):`, error.message);
  }
}

function setupMarkdownStorageWatcher() {
  if (markdownWatcher) return;

  try {
    const root = markdownStorage.ensureStorageTree();
    markdownWatcher = fs.watch(root, { recursive: true }, (eventType, fileName) => {
      const changedFile = String(fileName || '');
      const normalized = changedFile.replace(/\\/g, '/').toLowerCase();
      if (!normalized.endsWith('.md')) return;
      if (normalized.startsWith('trash/') || normalized.startsWith('logs/') || normalized.startsWith('settings/')) return;
      if (isApplyingMarkdownReadBack) return;
      if (Date.now() - lastMarkdownWriteAt < 2000) return;

      clearTimeout(markdownWatchDebounce);
      markdownWatchDebounce = setTimeout(() => {
        if (Date.now() - lastMarkdownWriteAt < 2000 || isApplyingMarkdownReadBack) return;

        isApplyingMarkdownReadBack = true;
        try {
          const result = markdownStorage.readBackToDatabase(db, 'watcher-read-back');
          syncMarkdownStorageSafe('after-watcher-read-back');
          notifyDataUpdated('categories');
          notifyDataUpdated('tips');
          updateTrayMenu();
          console.log(
            `[MarkdownStorage] Watcher read-back applied: ${result.categoriesUpdated} categories, ` +
            `${result.subcategoriesUpdated} subcategories, ${result.notesUpdated} notes`
          );
        } catch (error) {
          console.error('[MarkdownStorage] Watcher read-back failed:', error.message);
        } finally {
          isApplyingMarkdownReadBack = false;
        }
      }, 1200);
    });

    console.log(`[MarkdownStorage] Watching ${root}`);
  } catch (error) {
    console.error('[MarkdownStorage] Watcher setup failed:', error.message);
  }
}

// Load audio settings from database
function loadAudioSettings() {
  audioSettings = { ...AUDIO_DISABLED_SETTINGS };
}

function updatePopupDebugState(patch = {}) {
  popupDebugState = {
    ...popupDebugState,
    ...patch,
    activePopupKey,
    queueLength: popupQueue.length,
    updatedAt: new Date().toISOString()
  };

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('popup-debug-updated', getPopupDebugStateSnapshot());
  }
}

function summarizeTipForDebug(tip) {
  if (!tip) return null;
  const deadlineInfo = getEffectiveDeadlineInfo(tip);
  const mappedEventRoute = getPopupEventRoute(tip.importance, tip.id);
  const eventRoute = deadlineInfo.deadlineState === 'overdue'
    ? { eventType: null, importanceBucket: mappedEventRoute.importanceBucket, routeReason: 'deadline-expired-before-route' }
    : mappedEventRoute;
  return {
    id: tip.id,
    categoryId: tip.category_id,
    categoryName: tip.category_name,
    content: tip.content,
    importance: tip.importance,
    status: tip.status,
    deadline: tip.deadline || null,
    effectiveDeadline: tip.effectiveDeadline ?? deadlineInfo.effectiveDeadline,
    deadlineSource: tip.deadlineSource ?? deadlineInfo.deadlineSource,
    deadlineState: tip.deadlineState ?? deadlineInfo.deadlineState,
    deadlineDaysRemaining: tip.deadlineDaysRemaining ?? deadlineInfo.deadlineDaysRemaining,
    deadlineMultiplier: tip.deadlineMultiplier ?? null,
    deadlineBoostApplied: tip.deadlineBoostApplied ?? null,
    isSequential: tip.isSequential ?? deadlineInfo.isSequential,
    sequentialActiveTipId: tip.sequentialActiveTipId ?? deadlineInfo.sequentialActiveTipId,
    isSequentialActiveStep: tip.isSequentialActiveStep ?? deadlineInfo.isSequentialActiveStep,
    tipTrackingApp: tip.tip_tracking_app || null,
    score: tip.score !== undefined ? tip.score : calculateTipScore(tip),
    ...eventRoute
  };
}

function normalizeActiveWindow(activeWindow, source) {
  if (!activeWindow) return null;

  const title = String(activeWindow.title || '').trim();
  const processName = activeWindow.owner && activeWindow.owner.name
    ? String(activeWindow.owner.name).trim()
    : 'Unknown';

  return {
    title,
    owner: processName,
    process: processName,
    label: title ? `${processName} — ${title}` : processName,
    checkedAt: new Date().toISOString(),
    source
  };
}

function getDebugTipScore(data) {
  if (!data) return null;
  if (data.score !== undefined && data.score !== null) return data.score;

  const tipId = data.tipId || data.id;
  if (!tipId) return null;

  try {
    const tip = db.get('SELECT * FROM tips WHERE id = ?', [tipId]);
    return tip ? calculateTipScore(tip) : null;
  } catch {
    return null;
  }
}

function getCooldownRemainingMinutes(tip, budget, now = Date.now(), lastPopupAt = null) {
  const tipLastShown = Number(tip.last_shown || 0);
  const snoozedUntil = tip.snoozed_until ? new Date(tip.snoozed_until).getTime() : 0;
  const sameTaskUntil = tipLastShown ? tipLastShown + budget.sameTaskCooldownMinutes * 60 * 1000 : 0;
  const randomUntil = tipLastShown ? tipLastShown + 60 * 60 * 1000 : 0;
  const minimumIntervalUntil = lastPopupAt ? Number(lastPopupAt) + budget.minimumPopupIntervalMinutes * 60 * 1000 : 0;
  const blockedUntil = Math.max(snoozedUntil || 0, sameTaskUntil, randomUntil, minimumIntervalUntil);
  return blockedUntil > now ? Math.ceil((blockedUntil - now) / 60000) : 0;
}

function getPopupCandidateDiagnostics(triggerTime) {
  try {
    const now = Date.now();
    const budget = getNotificationBudget();
    const fullscreenOrGameMode = isFullscreenActive() || isGameModeActive();
    const quietHours = isQuietHoursActive(budget);
    const lastPopup = db.get(
      'SELECT MAX(last_shown) as last_shown FROM tips WHERE last_shown IS NOT NULL AND archived_at IS NULL'
    );
    const recent = db.get(
      'SELECT COUNT(*) as count, MIN(last_shown) as oldest FROM tips WHERE last_shown IS NOT NULL AND archived_at IS NULL AND last_shown >= ?',
      [now - 60 * 60 * 1000]
    );
    const hourlyBudgetExhausted = Boolean(recent && recent.count >= budget.maxPopupsPerHour);
    const hourlyBudget = {
      exhausted: hourlyBudgetExhausted,
      currentCount: recent?.count || 0,
      maxPopupsPerHour: budget.maxPopupsPerHour,
      nextAllowedAt: hourlyBudgetExhausted && recent?.oldest
        ? new Date(Number(recent.oldest) + 60 * 60 * 1000).toISOString()
        : null
    };
    const tips = db.query(
      'SELECT t.*, c.name as category_name, c.color as category_color, '
      + 's.is_sequential AS subcategory_is_sequential, s.deadline_mode AS subcategory_deadline_mode, '
      + 's.shared_deadline AS subcategory_shared_deadline, '
      + '(SELECT active_tip.id FROM tips active_tip WHERE active_tip.subcategory_id = t.subcategory_id '
      + `AND active_tip.status NOT IN (${SEQUENTIAL_TERMINAL_STATUS_SQL}) AND active_tip.archived_at IS NULL `
      + 'ORDER BY COALESCE(active_tip.order_index, 2147483647), active_tip.id LIMIT 1) AS sequential_active_tip_id '
      + 'FROM tips t JOIN categories c ON t.category_id = c.id '
      + 'LEFT JOIN subcategories s ON s.id = t.subcategory_id '
      + "WHERE t.status = 'active' AND t.archived_at IS NULL"
    );

    const candidates = tips.map(tip => {
      const importance = Number(tip.importance || 1);
      const factors = getPopupSelectionFactors(tip, budget, now);
      let suppressionReason = null;

      if (factors.deadlineState === 'overdue') {
        suppressionReason = 'deadline-expired';
      } else if (tip.next_due_at && new Date(tip.next_due_at).getTime() > now) {
        suppressionReason = 'not-due-yet';
      } else if (tip.snoozed_until && new Date(tip.snoozed_until).getTime() > now) {
        suppressionReason = 'snoozed';
      } else if (tip.last_shown && now - Number(tip.last_shown) < 60 * 60 * 1000) {
        suppressionReason = 'random-one-hour-cooldown';
      } else if (factors.isSequential && !factors.isSequentialActiveStep) {
        suppressionReason = 'sequential-step-locked';
      } else if (importance < 9 && fullscreenOrGameMode) {
        suppressionReason = 'fullscreen-or-game-mode';
      } else if (importance < 10 && quietHours) {
        suppressionReason = 'quiet-hours';
      } else if (tip.last_shown && now - Number(tip.last_shown) < budget.sameTaskCooldownMinutes * 60 * 1000) {
        suppressionReason = 'same-task-cooldown';
      } else if (
        importance < 10
        && lastPopup?.last_shown
        && now - Number(lastPopup.last_shown) < budget.minimumPopupIntervalMinutes * 60 * 1000
      ) {
        suppressionReason = 'minimum-popup-interval';
      }

      return {
        ...summarizeTipForDebug({ ...tip, score: calculateTipScore(tip) }),
        plannedTriggerAt: triggerTime,
        eligibility: suppressionReason ? 'ineligible' : (hourlyBudgetExhausted ? 'deferred' : 'eligible'),
        suppressionReason,
        schedulerReason: hourlyBudgetExhausted ? 'hourly-budget-exhausted' : null,
        hourlyBudget,
        finalWeight: factors.importanceWeight * factors.stalenessBoost * factors.deadlineMultiplier,
        probability: 0,
        finalProbability: 0,
        importanceWeight: factors.importanceWeight,
        contextMatch: factors.contextMatch,
        stalenessBoost: factors.stalenessBoost,
        deadlineMultiplier: factors.deadlineMultiplier,
        deadlineBoostApplied: factors.deadlineBoostApplied,
        effectiveDeadline: factors.effectiveDeadline,
        deadlineSource: factors.deadlineSource,
        deadlineState: factors.deadlineState,
        deadlineDaysRemaining: factors.deadlineDaysRemaining,
        isSequential: factors.isSequential,
        sequentialActiveTipId: factors.sequentialActiveTipId,
        isSequentialActiveStep: factors.isSequentialActiveStep,
        cooldownRemaining: getCooldownRemainingMinutes(tip, budget, now, lastPopup?.last_shown)
      };
    });

    const eligible = candidates.filter(candidate => candidate.eligibility === 'eligible');
    const contextCandidates = eligible.filter(candidate => candidate.contextMatch);
    const generalCandidates = eligible.filter(candidate => !candidate.contextMatch);
    const contextShare = contextCandidates.length && generalCandidates.length
      ? budget.contextMatchPercent / 100
      : (contextCandidates.length ? 1 : 0);
    const generalShare = generalCandidates.length
      ? (contextCandidates.length ? 1 - contextShare : 1)
      : 0;
    const assignProbability = (pool, groupShare) => {
      const totalWeight = pool.reduce((sum, candidate) => sum + candidate.finalWeight, 0);
      pool.forEach(candidate => {
        candidate.probability = totalWeight > 0 ? groupShare * candidate.finalWeight / totalWeight : 0;
        candidate.finalProbability = candidate.probability;
      });
    };
    assignProbability(contextCandidates, contextShare);
    assignProbability(generalCandidates, generalShare);

    return candidates.sort((a, b) => {
      if (a.eligibility !== b.eligibility) return a.eligibility === 'eligible' ? -1 : 1;
      return Number(b.finalWeight || 0) - Number(a.finalWeight || 0);
    });
  } catch (error) {
    return [{
      title: 'Popup candidate diagnostics unavailable',
      plannedTriggerAt: triggerTime,
      eligibility: 'unknown',
      suppressionReason: 'candidate-diagnostics-error',
      diagnosticError: error.message
    }];
  }
}
function buildPopupExitOrder(triggerTime) {
  const attempt = popupDebugState.lastSchedulerAttempt;
  const suppression = popupDebugState.lastSuppression;
  const scoringCandidates = popupDebugState.lastScoring?.candidates || [];
  const rows = [];
  const seenTipIds = new Set();

  const addRow = (data, state, key = null, plannedTriggerAt = null, reason = null) => {
    if (!data) return;
    const tipId = data.tipId || data.id || null;
    if (tipId && seenTipIds.has(tipId)) return;
    if (tipId) seenTipIds.add(tipId);

    const deadlineExpired = data.deadlineState === 'overdue' || reason === 'deadline-expired';
    const mappedEventRoute = getPopupEventRoute(data.importance, tipId);
    rows.push({
      rank: rows.length + 1,
      key,
      tipId,
      title: data.content || data.title || null,
      importance: data.importance ?? null,
      plannedTriggerAt,
      queueScore: getDebugTipScore(data),
      rawScore: getDebugTipScore(data),
      finalWeight: data.finalWeight ?? null,
      probability: data.probability ?? null,
      importanceWeight: data.importanceWeight ?? null,
      contextMatch: data.contextMatch ?? null,
      stalenessBoost: data.stalenessBoost ?? null,
      deadlineMultiplier: data.deadlineMultiplier ?? null,
      cooldownRemaining: data.cooldownRemaining ?? null,
      eligibility: state,
      eligible: state === 'active' || state === 'queued' || state === 'eligible'
        ? true
        : (state === 'ineligible' || state === 'suppressed' || state === 'deferred' ? false : null),
      suppressionReason: reason,
      schedulerReason: data.schedulerReason ?? null,
      hourlyBudget: data.hourlyBudget ?? null,
      eventType: deadlineExpired ? null : (data.eventType ?? mappedEventRoute.eventType),
      importanceBucket: data.importanceBucket ?? mappedEventRoute.importanceBucket,
      routeReason: deadlineExpired ? 'deadline-expired-before-route' : (data.routeReason ?? mappedEventRoute.routeReason)
    });
  };

  if (activePopupKey && pendingTipData) {
    addRow(pendingTipData, 'active', activePopupKey, attempt?.attemptedAt || null, null);
  }

  popupQueue.forEach(item => {
    const itemTipId = item.data && (item.data.tipId || item.data.id);
    const isAttemptedCandidate = itemTipId && attempt?.candidate?.id === itemTipId;
    addRow(item.data, 'queued', item.key, isAttemptedCandidate ? attempt.attemptedAt : null, null);
  });

  if (rows.length === 0 && attempt?.result === 'no-eligible-tip') {
    addRow(
      { title: 'No eligible popup candidate' },
      'ineligible',
      'scheduler:no-eligible-tip',
      attempt.attemptedAt,
      suppression?.reason || 'no-eligible-candidate'
    );
    return rows;
  }

  scoringCandidates.forEach(candidate => {
    const isAttemptedCandidate = attempt?.candidate?.id === candidate.id;
    const isSuppressed = isAttemptedCandidate && attempt?.result === 'suppressed';
    addRow(
      candidate,
      isSuppressed ? 'suppressed' : 'candidate',
      candidate.id ? 'candidate:' + candidate.id : null,
      isAttemptedCandidate ? attempt.attemptedAt : triggerTime,
      isSuppressed ? (attempt.reason || suppression?.reason || null) : null
    );
  });

  getPopupCandidateDiagnostics(triggerTime).forEach(candidate => {
    addRow(
      candidate,
      candidate.eligibility,
      candidate.id ? 'diagnostic:' + candidate.id : 'scheduler:candidate-diagnostics',
      candidate.plannedTriggerAt,
      candidate.suppressionReason
    );
  });

  if (rows.length === 0) {
    addRow(
      { title: 'No active popup candidate' },
      'ineligible',
      'scheduler:no-active-tip',
      triggerTime,
      'no-active-tip'
    );
  }

  return rows;
}

function getPopupDebugStateSnapshot() {
  const queuedItems = popupQueue.map(item => ({
    key: item.key,
    channel: item.channel,
    tipId: item.data && (item.data.tipId || item.data.id),
    content: item.data && item.data.content,
    importance: item.data && item.data.importance,
    tipTrackingApp: item.data && (item.data.tipTrackingApp || item.data.tip_tracking_app),
    score: item.data && item.data.score !== undefined ? item.data.score : null
  }));
  const scoredCandidate = popupDebugState.lastScoring && popupDebugState.lastScoring.selected
    ? popupDebugState.lastScoring.selected
    : null;
  const nextPopup = queuedItems[0]
    || (popupDebugState.lastCandidate && popupDebugState.lastCandidate.data)
    || scoredCandidate
    || null;
  const nextTrigger = popupDebugState.nextTrigger || {};
  const triggerTime = nextTrigger.debugPopupNextAt || nextTrigger.randomPopupAt || null;
  const triggerTimestamp = triggerTime ? new Date(triggerTime).getTime() : NaN;
  const triggerOverdue = Number.isFinite(triggerTimestamp) && triggerTimestamp <= Date.now();
  const attemptTimestamp = popupDebugState.lastSchedulerAttempt?.attemptedAt
    ? new Date(popupDebugState.lastSchedulerAttempt.attemptedAt).getTime()
    : NaN;
  const hasAttemptForTrigger = triggerOverdue
    && Number.isFinite(attemptTimestamp)
    && attemptTimestamp >= triggerTimestamp;
  const budget = getNotificationBudget();
  const hourlyRecent = db.get(
    'SELECT COUNT(*) as count, MIN(last_shown) as oldest FROM tips WHERE last_shown IS NOT NULL AND archived_at IS NULL AND last_shown >= ?',
    [Date.now() - 60 * 60 * 1000]
  );
  const hourlyBudget = {
    exhausted: Boolean(hourlyRecent && hourlyRecent.count >= budget.maxPopupsPerHour),
    currentCount: hourlyRecent?.count || 0,
    maxPopupsPerHour: budget.maxPopupsPerHour,
    nextAllowedAt: hourlyRecent?.count >= budget.maxPopupsPerHour && hourlyRecent?.oldest ? new Date(Number(hourlyRecent.oldest) + 60 * 60 * 1000).toISOString() : null
  };
  const waitingReason = triggerOverdue
    ? (
        hasAttemptForTrigger
          ? (
              popupDebugState.lastSchedulerAttempt.reason
              || popupDebugState.lastSchedulerAttempt.result
              || popupDebugState.lastSuppression?.reason
              || 'trigger-attempt-recorded'
            )
          : 'timer-callback-pending'
      )
    : (triggerTime ? 'waiting-for-scheduled-trigger' : 'scheduler-not-scheduled');

  return {
    ...popupDebugState,
    activePopupKey,
    queueLength: popupQueue.length,
    queuedItems,
    trackedApplication: popupDebugState.lastTrackedMatch || popupDebugState.activeWindow,
    nextPopup,
    triggerTime,
    popupExitOrder: buildPopupExitOrder(triggerTime),
    usedPopupCount: hourlyBudget.currentCount,
    hourlyLimit: hourlyBudget.maxPopupsPerHour,
    nextAllowedAt: hourlyBudget.nextAllowedAt,
    waitingReason: hourlyBudget.exhausted ? 'hourly-budget-exhausted' : waitingReason,
    hourlyBudget,
    selectionSettings: {
      contextWeight: budget.contextMatchPercent / 100,
      randomWeight: 1 - budget.contextMatchPercent / 100,
      contextActive: Boolean(popupDebugState.lastTrackedMatch || lastActiveProcessName)
    },
    schedulerState: {
      status: nextTrigger.schedulerStatus || (triggerTime ? 'scheduled' : 'idle'),
      triggerTime,
      overdue: triggerOverdue,
      waitingReason: hourlyBudget.exhausted ? 'hourly-budget-exhausted' : waitingReason,
      hourlyBudget,
      lastAttempt: popupDebugState.lastSchedulerAttempt,
      budgetLimit: nextTrigger.budgetLimit ?? hourlyBudget.maxPopupsPerHour,
      budgetUsed: nextTrigger.budgetUsed ?? hourlyBudget.currentCount,
      baseSlotMinutes: nextTrigger.baseSlotMinutes ?? null,
      lastPopupAt: nextTrigger.lastPopupAt ?? null,
      nextSlotAt: nextTrigger.nextSlotAt ?? triggerTime,
      jitterMinutes: nextTrigger.jitterMinutes ?? 0,
      scheduleReason: nextTrigger.scheduleReason ?? waitingReason,
      budgetWindowStartAt: nextTrigger.budgetWindowStartAt ?? null,
      budgetWindowEndAt: nextTrigger.budgetWindowEndAt ?? null
    },
    budgetLimit: nextTrigger.budgetLimit ?? hourlyBudget.maxPopupsPerHour,
    budgetUsed: nextTrigger.budgetUsed ?? hourlyBudget.currentCount,
    baseSlotMinutes: nextTrigger.baseSlotMinutes ?? null,
    lastPopupAt: nextTrigger.lastPopupAt ?? null,
    nextSlotAt: nextTrigger.nextSlotAt ?? triggerTime,
    jitterMinutes: nextTrigger.jitterMinutes ?? 0,
    scheduleReason: nextTrigger.scheduleReason ?? waitingReason,
    audioDisabled: AUDIO_DISABLED,
    audioSuppressed: AUDIO_DISABLED,
    queueScore: nextPopup && nextPopup.score !== undefined && nextPopup.score !== null
      ? nextPopup.score
      : (scoredCandidate ? scoredCandidate.score : null)
  };
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseStoredTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function getLocalStatisticsRange(mode = 'weekly', now = new Date()) {
  const normalizedMode = mode === 'monthly' ? 'monthly' : 'weekly';
  const current = new Date(now);
  let start;
  let endExclusive;
  let rangeKind;
  if (normalizedMode === 'monthly') {
    start = new Date(current.getFullYear(), current.getMonth(), 1);
    endExclusive = new Date(current.getFullYear(), current.getMonth() + 1, 1);
    rangeKind = 'calendar-month';
  } else {
    endExclusive = new Date(current);
    endExclusive.setHours(0, 0, 0, 0);
    endExclusive.setDate(endExclusive.getDate() + 1);
    start = new Date(endExclusive);
    start.setDate(start.getDate() - 7);
    rangeKind = 'rolling-local-days';
  }
  const dateKeys = [];
  for (const cursor = new Date(start); cursor < endExclusive; cursor.setDate(cursor.getDate() + 1)) {
    dateKeys.push(getLocalDateKey(cursor));
  }
  const days = dateKeys.length;
  return {
    mode: normalizedMode,
    rangeKind,
    days,
    startAt: start.getTime(),
    endAt: endExclusive.getTime(),
    startDateKey: dateKeys[0],
    endDateKey: dateKeys[dateKeys.length - 1],
    dateKeys
  };
}

function bucketLocalTimestamps(values, range) {
  const counts = new Map(range.dateKeys.map(key => [key, 0]));
  values.forEach(value => {
    const timestamp = parseStoredTimestamp(value);
    if (timestamp === null || timestamp < range.startAt || timestamp >= range.endAt) return;
    const key = getLocalDateKey(new Date(timestamp));
    if (counts.has(key)) counts.set(key, counts.get(key) + 1);
  });
  return range.dateKeys.map(date => ({ date, count: counts.get(date) || 0 }));
}

function buildStatisticsSnapshot(mode = 'weekly', now = new Date()) {
  const range = getLocalStatisticsRange(mode, now);
  const nowTimestamp = new Date(now).getTime();
  const completionRows = db.query('SELECT last_completed_at FROM tips WHERE last_completed_at IS NOT NULL');
  const dismissRows = db.query(
    'SELECT reason, dismissed_at FROM dismiss_log WHERE dismissed_at >= ? AND dismissed_at < ? ORDER BY dismissed_at ASC',
    [range.startAt, range.endAt]
  );
  const sessionRows = db.query(
    'SELECT started_at, ended_at FROM sessions WHERE started_at < ? AND COALESCE(ended_at, started_at) >= ?',
    [range.endAt, range.startAt]
  );
  const deadlineRows = db.query(`
    SELECT t.id, t.subcategory_id, t.deadline,
           s.is_sequential AS subcategory_is_sequential,
           s.deadline_mode AS subcategory_deadline_mode,
           s.shared_deadline AS subcategory_shared_deadline,
           (
             SELECT active_tip.id FROM tips active_tip
             WHERE active_tip.subcategory_id = t.subcategory_id
               AND active_tip.status NOT IN (${SEQUENTIAL_TERMINAL_STATUS_SQL}) AND active_tip.archived_at IS NULL
             ORDER BY COALESCE(active_tip.order_index, 2147483647), active_tip.id LIMIT 1
           ) AS sequential_active_tip_id
    FROM tips t
    LEFT JOIN subcategories s ON s.id = t.subcategory_id
    WHERE t.status = 'active' AND t.archived_at IS NULL
  `);
  const categoryRows = db.query(`
    SELECT c.id AS category_id, c.name AS category_name, c.color AS category_color,
           t.id AS tip_id, t.status AS tip_status, t.last_completed_at
    FROM categories c
    LEFT JOIN tips t ON t.category_id = c.id AND t.archived_at IS NULL
    ORDER BY c.name ASC, t.id ASC
  `);
  const completionTrend = bucketLocalTimestamps(completionRows.map(row => row.last_completed_at), range);
  const snoozeTrend = bucketLocalTimestamps(dismissRows.map(row => row.dismissed_at), range);
  const reasonCounts = new Map();
  dismissRows.forEach(row => {
    const reason = row.reason || 'unspecified';
    reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
  });
  const totalFocusMs = sessionRows.reduce((sum, row) => {
    const startedAt = parseStoredTimestamp(row.started_at);
    const endedAt = parseStoredTimestamp(row.ended_at);
    return startedAt !== null && endedAt !== null && endedAt > startedAt
      ? sum + (endedAt - startedAt)
      : sum;
  }, 0);
  const completedInRange = completionTrend.reduce((sum, day) => sum + day.count, 0);
  const deadlineItems = deadlineRows.map(row => {
    const info = getEffectiveDeadlineInfo(row, nowTimestamp);
    return {
      tipId: row.id,
      effectiveDeadline: info.effectiveDeadline,
      deadlineSource: info.deadlineSource,
      deadlineState: info.deadlineState,
      isSequential: info.isSequential,
      sequentialActiveTipId: info.sequentialActiveTipId,
      isSequentialActiveStep: info.isSequentialActiveStep
    };
  });
  const deadlineStateCounts = deadlineItems.reduce((counts, item) => {
    counts[item.deadlineState] = (counts[item.deadlineState] || 0) + 1;
    return counts;
  }, {});
  const categoryMap = new Map();
  categoryRows.forEach(row => {
    if (!categoryMap.has(row.category_id)) {
      categoryMap.set(row.category_id, {
        categoryId: row.category_id,
        name: row.category_name,
        color: row.category_color,
        totalTips: 0,
        activeTips: 0,
        doneTips: 0,
        cancelledTips: 0,
        periodCompletedTips: 0
      });
    }
    const category = categoryMap.get(row.category_id);
    if (row.tip_id === null || row.tip_id === undefined) return;
    category.totalTips += 1;
    if (row.tip_status === 'active') category.activeTips += 1;
    if (row.tip_status === 'done') category.doneTips += 1;
    if (row.tip_status === 'cancelled') category.cancelledTips += 1;
    const completedAt = parseStoredTimestamp(row.last_completed_at);
    if (completedAt !== null && completedAt >= range.startAt && completedAt < range.endAt) {
      category.periodCompletedTips += 1;
    }
  });
  const categoryDistribution = Array.from(categoryMap.values()).map(category => ({
    ...category,
    completionRate: category.totalTips > 0 ? category.doneTips / category.totalTips : 0
  }));
  const snoozeReasons = Array.from(reasonCounts, ([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  const averageFocusMinutes = sessionRows.length ? Math.round(totalFocusMs / sessionRows.length / 60000) : 0;
  const hasData = completedInRange > 0 || dismissRows.length > 0 || sessionRows.length > 0 || categoryDistribution.length > 0;
  const status = hasData ? 'ready' : 'empty';
  const completed = { period: completedInRange, total: completionRows.length, trend: completionTrend };
  const deadlines = { counts: deadlineStateCounts, items: deadlineItems };
  const data = {
    completed,
    procrastinationTrend: snoozeTrend,
    snoozeTrend,
    snoozeReasons,
    categoryDistribution,
    deadlines,
    averageFocusMinutes
  };

  return {
    ok: true,
    status,
    loading: false,
    empty: !hasData,
    error: null,
    mode: range.mode,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    range: {
      days: range.days,
      kind: range.rangeKind,
      startAt: range.startAt,
      endAt: range.endAt,
      startDateKey: range.startDateKey,
      endDateKey: range.endDateKey
    },
    completed,
    procrastinationTrend: snoozeTrend,
    snoozeTrend,
    snoozeReasons,
    categoryDistribution,
    deadlines,
    averageFocusMinutes,
    hasData,
    data
  };
}

function buildStatisticsErrorResponse(mode, error) {
  const normalizedMode = mode === 'monthly' ? 'monthly' : 'weekly';
  return {
    ok: false,
    status: 'error',
    loading: false,
    empty: true,
    mode: normalizedMode,
    range: null,
    completed: null,
    procrastinationTrend: [],
    snoozeTrend: [],
    snoozeReasons: [],
    categoryDistribution: [],
    deadlines: { counts: {}, items: [] },
    averageFocusMinutes: 0,
    hasData: false,
    data: null,
    error: { code: 'statistics-query-failed', message: error.message }
  };
}

function buildDashboardWeeklyProgress(now = new Date()) {
  const current = new Date(now);
  current.setHours(0, 0, 0, 0);
  const mondayOffset = (current.getDay() + 6) % 7;
  const start = new Date(current);
  start.setDate(start.getDate() - mondayOffset);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const range = {
    startAt: start.getTime(),
    endAt: end.getTime(),
    dateKeys: Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(date.getDate() + index);
      return getLocalDateKey(date);
    })
  };
  const rows = db.query('SELECT last_completed_at FROM tips WHERE last_completed_at IS NOT NULL');
  const trend = bucketLocalTimestamps(rows.map(row => row.last_completed_at), range);
  return {
    ok: true,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    range: { startAt: range.startAt, endAt: range.endAt, startDateKey: range.dateKeys[0], endDateKey: range.dateKeys[6] },
    trend,
    total: trend.reduce((sum, day) => sum + day.count, 0),
    hasData: trend.some(day => day.count > 0)
  };
}

function createCheckinWindow() {
  if (checkinWindow && !checkinWindow.isDestroyed()) {
    checkinWindow.show();
    checkinWindow.focus();
    return checkinWindow;
  }

  checkinWindow = new BrowserWindow({
    width: 400,
    height: 500,
    show: false,
    frame: false,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  checkinWindow.once('ready-to-show', () => {
    checkinWindow.show();
  });

  checkinWindow.loadFile(path.join(__dirname, '../src/checkin.html'));
  checkinWindow.on('closed', () => {
    checkinWindow = null;
  });

  return checkinWindow;
}

function showCheckinWindowIfNeeded() {
  const dateStr = getLocalDateKey();
  const todayCheckin = db.query('SELECT completed FROM checkins WHERE date = ?', [dateStr]);
  const isCompleted = todayCheckin.length > 0 && Number(todayCheckin[0].completed) === 1;

  if (!isCompleted) {
    createCheckinWindow();
  }

  return !isCompleted;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    show: false // Initially hidden, only show when needed
  });

  mainWindow.loadFile(path.join(__dirname, '../src/index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showMainWindow() {
  if (!mainWindow) {
    createMainWindow();
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function createPopupWindow() {
  if (popupWindow) {
    popupWindow.focus();
    return popupWindow;
  }

  popupWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  popupWindow.loadFile(path.join(__dirname, '../src/popup.html'));

  popupWindow.on('closed', () => {
    popupWindow = null;
    pendingTipData = null;
    activePopupKey = null;
    updatePopupDebugState({ activePopupKey: null });
    setImmediate(showNextPopupFromQueue);
  });

  return popupWindow;
}

function createQuickCaptureWindow() {
  if (quickCaptureWindow) {
    quickCaptureWindow.show();
    quickCaptureWindow.focus();
    return quickCaptureWindow;
  }

  quickCaptureWindow = new BrowserWindow({
    width: 420,
    height: 220,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  quickCaptureWindow.loadFile(path.join(__dirname, '../src/quick-capture.html'));

  quickCaptureWindow.on('closed', () => {
    quickCaptureWindow = null;
  });

  quickCaptureWindow.once('ready-to-show', () => {
    quickCaptureWindow.show();
    quickCaptureWindow.focus();
  });

  return quickCaptureWindow;
}

function showQuickCaptureWindow() {
  createQuickCaptureWindow();
}

function getPopupKey(item) {
  if (item.key) return item.key;
  const data = item.data || {};
  if (data.tipId || data.id) return `${item.channel}:${data.tipId || data.id}`;
  const categoryName = data.category && data.category.name ? data.category.name : 'uncategorized';
  return `${item.channel}:${categoryName}:${data.content || JSON.stringify(data)}`;
}

function enqueuePopup(item) {
  const queuedItem = {
    channel: item.channel || 'show-tip',
    data: item.data || {},
    markShownTipId: item.markShownTipId || null,
    key: null
  };
  queuedItem.key = getPopupKey({ ...queuedItem, key: item.key });

  if (popupQueuedKeys.has(queuedItem.key) || activePopupKey === queuedItem.key) {
    updatePopupDebugState({ lastSuppression: { reason: 'duplicate-popup-key', key: queuedItem.key } });
    return false;
  }

  popupQueuedKeys.add(queuedItem.key);
  popupQueue.push(queuedItem);
  updatePopupDebugState({ lastCandidate: { key: queuedItem.key, channel: queuedItem.channel, data: queuedItem.data } });
  showNextPopupFromQueue();
  return true;
}

function sendPopupItem(win, item) {
  if (!win || win.isDestroyed()) return;

  activePopupKey = item.key;
  updatePopupDebugState({ activePopupKey });
  pendingTipData = item.channel === 'show-tip' ? item.data : null;

  if (item.markShownTipId) {
    db.run(`
      UPDATE tips
      SET show_count = show_count + 1,
          last_shown = ?
      WHERE id = ?
    `, [Date.now(), item.markShownTipId]);
    rescheduleRandomPopup();
  }

  win.show();
  win.focus();
  win.webContents.send(item.channel, item.data);
}

function showNextPopupFromQueue() {
  if (popupWindow || popupQueue.length === 0) {
    return;
  }

  const item = popupQueue.shift();
  popupQueuedKeys.delete(item.key);
  updatePopupDebugState({ lastCandidate: { key: item.key, channel: item.channel, data: item.data } });

  const win = createPopupWindow();
  if (!win) return;

  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => sendPopupItem(win, item));
  } else {
    sendPopupItem(win, item);
  }
}

function createTimerWindow() {
  if (timerWindow) {
    timerWindow.focus();
    return;
  }

  timerWindow = new BrowserWindow({
    width: 200,
    height: 100,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  timerWindow.loadFile(path.join(__dirname, '../src/timer.html'));

  timerWindow.on('closed', () => {
    timerWindow = null;
  });
}

function createTrayIcon(color = '#00c2d1') {
  const iconPath = path.join(__dirname, '../src/assets/icon.png');
  if (!color && fs.existsSync(iconPath)) {
    const image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) return image.resize({ width: 16, height: 16 });
  }

  const size = 16;
  const normalized = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#00c2d1';
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  const buffer = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const border = x === 0 || y === 0 || x === size - 1 || y === size - 1;
      buffer[idx] = border ? 255 : r;
      buffer[idx + 1] = border ? 255 : g;
      buffer[idx + 2] = border ? 255 : b;
      buffer[idx + 3] = 255;
    }
  }

  return nativeImage.createFromBuffer(buffer, { width: size, height: size });
}

function createTray() {
  if (tray) return;

  tray = new Tray(createTrayIcon(null));
  tray.setToolTip('NoteZ - Popup Reminder System');
  tray.on('double-click', showMainWindow);
  tray.on('click', showMainWindow);

  updateTrayMenu();
}

function updateTrayMenu() {
  // Get all categories from database
  const categories = db.query(`
    SELECT id, name, color
    FROM categories
    ORDER BY name
  `);

  // Build Focus Mode submenu
  const focusModeSubmenuItems = categories.map(category => ({
    label: category.name,
    click: () => {
      activateFocusMode(category.id, category.name, category.color);
    }
  }));

  // Build main menu template
  const menuTemplate = [
    {
      label: 'Kategorileri Yönet',
      click: () => {
        showMainWindow();
      }
    },
    {
      label: 'Quick Capture',
      accelerator: 'Ctrl+Alt+N',
      click: () => {
        showQuickCaptureWindow();
      }
    },
    {
      label: 'Focus Modu',
      submenu: focusModeSubmenuItems.length > 0 ? focusModeSubmenuItems : [{ label: 'Henüz kategori yok', enabled: false }]
    }
  ];

  // Add "Focus Modu Kapat" if focus mode is active
  if (focusMode) {
    menuTemplate.splice(2, 0, {
      label: `Focus Modu Kapat (${focusMode.categoryName})`,
      click: () => {
        deactivateFocusMode();
      }
    });
  }

  menuTemplate.push({ type: 'separator' });
  menuTemplate.push({
    label: 'Ayarlar',
    click: () => {
        showMainWindow();
      }
  });
  menuTemplate.push({
    label: 'Çıkış',
    click: () => {
      app.quit();
    }
  });

  const contextMenu = Menu.buildFromTemplate(menuTemplate);
  tray.setContextMenu(contextMenu);
}

function activateFocusMode(categoryId, categoryName, categoryColor) {
  focusMode = {
    categoryId,
    categoryName,
    categoryColor
  };

  // Update tray icon color
  updateTrayIconColor(categoryColor);

  // Update tray menu
  updateTrayMenu();

  // Show notification
  showFocusModeNotification(categoryName, true);

  // Restart tracking with new focus mode settings
  restartTracking();

  console.log(`Focus mode activated for category: ${categoryName}`);
}

function deactivateFocusMode() {
  const categoryName = focusMode.categoryName;
  focusMode = null;

  // Reset tray icon color
  updateTrayIconColor(null);

  // Update tray menu
  updateTrayMenu();

  // Show notification
  showFocusModeNotification(categoryName, false);

  // Restart tracking with normal settings
  restartTracking();

  console.log(`Focus mode deactivated for category: ${categoryName}`);
}

function updateTrayIconColor(color) {
  if (!tray) return;
  tray.setImage(createTrayIcon(color || null));
}

function showFocusModeNotification(categoryName, activating) {
  const message = activating
    ? `${categoryName} moduna girildi`
    : `${categoryName} modundan çıkıldı`;

  // Show a native notification
  const { Notification } = require('electron');

  if (Notification.isSupported()) {
    new Notification({
      title: 'NoteZ - Focus Modu',
      body: message,
      silent: true
    }).show();
  } else {
    // Fallback to console if notifications not supported
    console.log(`Focus Mode: ${message}`);
  }
}

function restartTracking() {
  // Clear existing intervals
  if (titleCheckInterval) clearInterval(titleCheckInterval);
  if (randomPopupInterval) clearTimeout(randomPopupInterval);

  // Restart tracking with new focus mode settings
  startWindowTitleTracking();
  startRandomPopupTracking();
}

// Window Title Tracking
function startWindowTitleTracking() {
  // Check every 5 seconds (2.5 seconds if focus mode is active for selected category)
  const interval = focusMode ? 2500 : 5000;
  titleCheckInterval = setInterval(checkWindowTitle, interval);
}

async function checkWindowTitle() {
  try {
    // Check if fullscreen window is active
    if (isFullscreenActive()) {
      return; // Don't trigger if fullscreen app is running
    }

    // Get active window title
    const activeWindow = await activeWin();
    if (!activeWindow || !activeWindow.title) {
      return;
    }

    const activeWindowData = normalizeActiveWindow(activeWindow, 'window-title-tracking');
    lastActiveProcessName = activeWindowData.process.toLowerCase();
    const windowTitle = activeWindowData.title.toLowerCase();
    updatePopupDebugState({ activeWindow: activeWindowData });

    // Get all categories with their triggers
    const categories = db.query(`
      SELECT id, name, color, triggers
      FROM categories
    `);

    // Check each category's triggers
    for (const category of categories) {
      // If focus mode is active, skip non-focus categories
      if (focusMode && category.id !== focusMode.categoryId) {
        continue;
      }

      let triggers = [];
      try {
        const parsed = JSON.parse(category.triggers);
        if (Array.isArray(parsed)) {
          triggers = parsed;
        } else if (parsed && typeof parsed === 'object') {
          triggers = [...(parsed.apps || []), ...(parsed.keywords || [])];
        }
      } catch (e) {
        console.warn('Bozuk trigger verisi pas geciliyor:', category.triggers);
      }

      if (!Array.isArray(triggers)) {
        triggers = [];
      }

      // Check if any trigger matches the window title (case-insensitive)
      const match = triggers.some(trigger =>
        windowTitle.includes(trigger.toLowerCase())
      );

      if (match) {
        updatePopupDebugState({
          lastTrackedMatch: {
            categoryId: category.id,
            categoryName: category.name,
            triggers,
            windowTitle: activeWindowData.title,
            owner: activeWindowData.owner,
            process: activeWindowData.process,
            label: activeWindowData.label,
            matchedAt: new Date().toISOString()
          }
        });

        // Select a tip from this category
        const tip = selectTipFromCategory(category.id);

        if (tip) {
          // Show popup with this tip
          showPopupWithTip(tip, category);
          break; // Only show one popup per check
        }
      }
    }
  } catch (error) {
    console.error('Error checking window title:', error);
  }
}

function isFullscreenActive() {
  const displays = screen.getAllDisplays();
  for (const display of displays) {
    const { width, height } = display.workArea;
    // If a window is using the full display area, consider it fullscreen
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
 const bounds = win.getBounds();
      if (!bounds) continue;
      const { x: winX, y: winY, width: winWidth, height: winHeight } = bounds;
      if (winWidth >= width && winHeight >= height) {
        return true;
      }
    }
  }
  return false;
}

const DEFAULT_NOTIFICATION_BUDGET = {
  maxPopupsPerHour: 5,
  minimumPopupIntervalMinutes: 15,
  sameTaskCooldownMinutes: 45,
  quietHoursEnabled: false,
  quietHoursStart: '00:00',
  quietHoursEnd: '10:00',
  contextMatchPercent: 70,
  importanceExponent: 1.35,
  stalenessHours: 24,
  stalenessMaxBoost: 2,
  deadlineBoost: 1
};

function getSettingNumber(key, fallback) {
  const row = db.get('SELECT value FROM settings WHERE key = ?', [key]);
  const value = Number(row && row.value);
  return Number.isFinite(value) ? value : fallback;
}

function getSettingBool(key, fallback) {
  const row = db.get('SELECT value FROM settings WHERE key = ?', [key]);
  if (!row) return fallback;
  return row.value === '1' || row.value === 'true';
}

function getNotificationBudget() {
  return {
    maxPopupsPerHour: getSettingNumber('notification_max_popups_per_hour', DEFAULT_NOTIFICATION_BUDGET.maxPopupsPerHour),
    minimumPopupIntervalMinutes: getSettingNumber('notification_minimum_popup_interval_minutes', DEFAULT_NOTIFICATION_BUDGET.minimumPopupIntervalMinutes),
    sameTaskCooldownMinutes: getSettingNumber('notification_same_task_cooldown_minutes', DEFAULT_NOTIFICATION_BUDGET.sameTaskCooldownMinutes),
    quietHoursEnabled: getSettingBool('notification_quiet_hours_enabled', DEFAULT_NOTIFICATION_BUDGET.quietHoursEnabled),
    quietHoursStart: (db.get('SELECT value FROM settings WHERE key = ?', ['notification_quiet_hours_start']) || {}).value || DEFAULT_NOTIFICATION_BUDGET.quietHoursStart,
    quietHoursEnd: (db.get('SELECT value FROM settings WHERE key = ?', ['notification_quiet_hours_end']) || {}).value || DEFAULT_NOTIFICATION_BUDGET.quietHoursEnd,
    contextMatchPercent: Math.max(0, Math.min(100, getSettingNumber('popup_selection_context_match_percent', DEFAULT_NOTIFICATION_BUDGET.contextMatchPercent))),
    importanceExponent: Math.max(0.1, getSettingNumber('popup_selection_importance_exponent', DEFAULT_NOTIFICATION_BUDGET.importanceExponent)),
    stalenessHours: Math.max(1, getSettingNumber('popup_selection_staleness_hours', DEFAULT_NOTIFICATION_BUDGET.stalenessHours)),
    stalenessMaxBoost: Math.max(0, getSettingNumber('popup_selection_staleness_max_boost', DEFAULT_NOTIFICATION_BUDGET.stalenessMaxBoost)),
    deadlineBoost: Math.max(0, getSettingNumber('popup_selection_deadline_boost', DEFAULT_NOTIFICATION_BUDGET.deadlineBoost))
  };
}

function getGameModeApps() {
  const row = db.get('SELECT value FROM settings WHERE key = ?', ['notification_game_mode_apps']);
  return String(row?.value || '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
}

function isGameModeActive() {
  if (!lastActiveProcessName) return false;
  const gameModeApps = getGameModeApps();
  return gameModeApps.some(appName => lastActiveProcessName.includes(appName));
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function parseClockMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function isQuietHoursActive(budget, now = new Date()) {
  if (!budget.quietHoursEnabled) return false;
  const start = parseClockMinutes(budget.quietHoursStart);
  const end = parseClockMinutes(budget.quietHoursEnd);
  if (start === null || end === null || start === end) return false;
  const current = minutesSinceMidnight(now);
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
}

function calculateTipScore(tip, now = Date.now()) {
  let score = Number(tip.importance || 1) * 10;
  const taskContextApp = String(tip.tip_tracking_app || '').trim().toLowerCase();
  if (taskContextApp && lastActiveProcessName.includes(taskContextApp)) {
    score += 30;
  }

  const deadlineInfo = getEffectiveDeadlineInfo(tip);
  if (deadlineInfo.effectiveDeadline) {
    const deadlineTime = new Date(deadlineInfo.effectiveDeadline).getTime();
    if (!Number.isNaN(deadlineTime)) {
      const daysLeft = (deadlineTime - now) / (24 * 60 * 60 * 1000);
      if (daysLeft <= 1) score += 45;
      else if (daysLeft <= 3) score += 30;
      else if (daysLeft <= 7) score += 15;
    }
  }
  if (tip.snoozed_until && new Date(tip.snoozed_until).getTime() > now) {
    score -= 100;
  }
  return score;
}

function getTipSelectionMetadata(tip) {
  if (!tip) return { isSequential: false, sequentialActiveTipId: null };
  const hasJoinedMetadata = Object.prototype.hasOwnProperty.call(tip, 'subcategory_is_sequential');
  let metadata = tip;
  if (!hasJoinedMetadata && tip.id) {
    metadata = db.get(`
      SELECT t.id,
             t.subcategory_id,
             t.deadline,
             s.is_sequential AS subcategory_is_sequential,
             s.deadline_mode AS subcategory_deadline_mode,
             s.shared_deadline AS subcategory_shared_deadline,
             (
               SELECT active_tip.id
               FROM tips active_tip
               WHERE active_tip.subcategory_id = t.subcategory_id
                 AND active_tip.status NOT IN (${SEQUENTIAL_TERMINAL_STATUS_SQL})
                 AND active_tip.archived_at IS NULL
               ORDER BY COALESCE(active_tip.order_index, 2147483647), active_tip.id
               LIMIT 1
             ) AS sequential_active_tip_id
      FROM tips t
      LEFT JOIN subcategories s ON s.id = t.subcategory_id
      WHERE t.id = ?
    `, [tip.id]) || tip;
  }

  const isSequential = Number(metadata.subcategory_is_sequential || 0) === 1;
  const sequentialActiveTipId = metadata.sequential_active_tip_id === null || metadata.sequential_active_tip_id === undefined
    ? null
    : Number(metadata.sequential_active_tip_id);
  return {
    isSequential,
    sequentialActiveTipId,
    isSequentialActiveStep: !isSequential || sequentialActiveTipId === Number(tip.id),
    deadlineMode: metadata.subcategory_deadline_mode || null,
    sharedDeadline: metadata.subcategory_shared_deadline || null
  };
}

function getEffectiveDeadlineInfo(tip, now = Date.now()) {
  const metadata = getTipSelectionMetadata(tip);
  const usesSharedDeadline = metadata.deadlineMode === 'shared' && Boolean(metadata.sharedDeadline);
  const effectiveDeadline = usesSharedDeadline ? metadata.sharedDeadline : (tip?.deadline || null);
  const deadlineTime = effectiveDeadline ? new Date(effectiveDeadline).getTime() : NaN;
  let deadlineState = 'none';
  let deadlineDaysRemaining = null;
  if (effectiveDeadline && !Number.isFinite(deadlineTime)) {
    deadlineState = 'invalid';
  } else if (Number.isFinite(deadlineTime)) {
    deadlineDaysRemaining = (deadlineTime - now) / 86400000;
    if (deadlineDaysRemaining < 0) deadlineState = 'overdue';
    else if (deadlineDaysRemaining <= 1) deadlineState = 'due-today';
    else if (deadlineDaysRemaining <= 3) deadlineState = 'due-soon';
    else if (deadlineDaysRemaining <= 7) deadlineState = 'due-this-week';
    else deadlineState = 'due-later';
  }
  return {
    ...metadata,
    effectiveDeadline,
    deadlineSource: usesSharedDeadline ? 'subcategory-shared' : (effectiveDeadline ? 'tip' : 'none'),
    deadlineState,
    deadlineDaysRemaining
  };
}

function calculateNextRecurringDue(tip, from = new Date()) {
  const type = tip && tip.recurring_type;
  if (!type || type === 'none') return null;

  const interval = Math.max(1, Number(tip.recurring_interval || 1));
  const next = new Date(from);

  if (type === 'daily') {
    next.setDate(next.getDate() + interval);
  } else if (type === 'weekly') {
    next.setDate(next.getDate() + (7 * interval));
  } else if (type === 'monthly') {
    next.setMonth(next.getMonth() + interval);
  } else {
    return null;
  }

  return next.toISOString();
}

function maybeApplyRecurringCompletion(sql, params = []) {
  const sqlUpper = String(sql || '').toUpperCase();
  const tipId = getCompletedStatusTipId(sql, params);
  if (!tipId) return false;

  const tip = db.get('SELECT * FROM tips WHERE id = ?', [tipId]);
  const nextDue = calculateNextRecurringDue(tip);
  if (!nextDue) return false;

  db.run(`
    UPDATE tips
    SET status = 'active',
        last_completed_at = ?,
        next_due_at = ?,
        deadline = ?
    WHERE id = ?
  `, [new Date().toISOString(), nextDue, nextDue, tipId]);
  return true;
}

function getCompletedStatusTipId(sql, params = []) {
  const mutation = getTipStatusMutation(sql, params);
  return mutation?.status === 'done' ? mutation.tipId : null;
}

function getTipStatusMutation(sql, params = []) {
  const sqlText = String(sql || '');
  const sqlUpper = sqlText.toUpperCase();
  if (!sqlUpper.includes('UPDATE TIPS') || !sqlUpper.includes('STATUS')) return null;
  const allowedStatuses = ['active', 'retired', ...SEQUENTIAL_TERMINAL_STATUSES];
  const statusParamIndex = params.findIndex(value => allowedStatuses.includes(String(value).toLowerCase()));
  let status = statusParamIndex >= 0 ? String(params[statusParamIndex]).toLowerCase() : null;
  if (!status) {
    const literalMatch = /STATUS\s*=\s*['"](active|retired|done|cancelled)['"]/i.exec(sqlText);
    status = literalMatch ? literalMatch[1].toLowerCase() : null;
  }
  if (!status) return null;
  const tipId = params[params.length - 1];
  return tipId === null || tipId === undefined ? null : { tipId, status };
}

function applySequentialStatusProgression(sql, params = [], recurringRescheduled = false) {
  const mutation = getTipStatusMutation(sql, params);
  if (!mutation || recurringRescheduled || !SEQUENTIAL_TERMINAL_STATUSES.includes(mutation.status)) return null;
  const tip = db.get(`
    SELECT t.id, t.subcategory_id, s.is_sequential
    FROM tips t
    LEFT JOIN subcategories s ON s.id = t.subcategory_id
    WHERE t.id = ?
  `, [mutation.tipId]);
  if (!tip || !tip.subcategory_id || Number(tip.is_sequential || 0) !== 1) return null;

  const removedQueueItems = [];
  popupQueue = popupQueue.filter(item => {
    const queuedTipId = item.data && (item.data.tipId || item.data.id);
    if (Number(queuedTipId) !== Number(mutation.tipId)) return true;
    popupQueuedKeys.delete(item.key);
    removedQueueItems.push(item.key);
    return false;
  });
  const nextStep = db.get(`
    SELECT id, status, order_index
    FROM tips
    WHERE subcategory_id = ?
      AND archived_at IS NULL
      AND status NOT IN (${SEQUENTIAL_TERMINAL_STATUS_SQL})
    ORDER BY COALESCE(order_index, 2147483647), id
    LIMIT 1
  `, [tip.subcategory_id]);
  const progression = {
    subcategoryId: tip.subcategory_id,
    terminalTipId: Number(mutation.tipId),
    terminalStatus: mutation.status,
    nextStepId: nextStep?.id || null,
    nextStepStatus: nextStep?.status || null,
    nextActiveTipId: nextStep?.status === 'active' ? nextStep.id : null,
    removedQueueItems,
    progressedAt: new Date().toISOString()
  };
  updatePopupDebugState({ lastSequentialProgression: progression });
  return progression;
}

function markCompletionTimestampIfNeeded(sql, params = [], recurringRescheduled = false) {
  if (recurringRescheduled) return false;

  const tipId = getCompletedStatusTipId(sql, params);
  if (!tipId) return false;

  db.run('UPDATE tips SET last_completed_at = ? WHERE id = ?', [new Date().toISOString(), tipId]);
  return true;
}

function getSelectionEligibility(tip, budget, now = Date.now()) {
  const metadata = getTipSelectionMetadata(tip);
  if (metadata.isSequential && !metadata.isSequentialActiveStep) return 'sequential-step-locked';
  const deadlineInfo = getEffectiveDeadlineInfo(tip, now);
  if (deadlineInfo.deadlineState === 'overdue') return 'deadline-expired';
  const importance = Number(tip.importance || 1);
  if (importance < 9 && (isFullscreenActive() || isGameModeActive())) return 'fullscreen-or-game-mode';
  if (importance < 10 && isQuietHoursActive(budget)) return 'quiet-hours';
  if (tip.last_shown && now - Number(tip.last_shown) < budget.sameTaskCooldownMinutes * 60 * 1000) return 'same-task-cooldown';
  const lastPopup = db.get('SELECT MAX(last_shown) as last_shown FROM tips WHERE last_shown IS NOT NULL AND archived_at IS NULL');
  if (importance < 10 && lastPopup?.last_shown && now - Number(lastPopup.last_shown) < budget.minimumPopupIntervalMinutes * 60 * 1000) return 'minimum-popup-interval';
  const recent = db.get('SELECT COUNT(*) as count FROM tips WHERE last_shown IS NOT NULL AND archived_at IS NULL AND last_shown >= ?', [now - 60 * 60 * 1000]);
  if (importance < 10 && recent && recent.count >= budget.maxPopupsPerHour) return 'hourly-budget-exhausted';
  return null;
}

function getPopupSelectionFactors(tip, budget, now = Date.now()) {
  const importanceWeight = Math.pow(Math.max(1, Number(tip.importance || 1)), budget.importanceExponent);
  const trackingApp = String(tip.tip_tracking_app || '').trim().toLowerCase();
  const contextMatch = Boolean((popupDebugState.lastTrackedMatch && tip.category_id === popupDebugState.lastTrackedMatch.categoryId) || (trackingApp && lastActiveProcessName.includes(trackingApp)));
  const lastShown = Number(tip.last_shown || 0);
  const staleHours = lastShown > 0 ? Math.max(0, (now - lastShown) / 3600000) : budget.stalenessHours * budget.stalenessMaxBoost;
  const stalenessBoost = 1 + Math.min(budget.stalenessMaxBoost, staleHours / budget.stalenessHours);
  const deadlineInfo = getEffectiveDeadlineInfo(tip, now);
  let deadlineMultiplier = 1;
  if (deadlineInfo.deadlineState === 'due-today') {
    deadlineMultiplier += budget.deadlineBoost;
  } else if (deadlineInfo.deadlineState === 'due-soon') {
    deadlineMultiplier += budget.deadlineBoost * 0.6;
  } else if (deadlineInfo.deadlineState === 'due-this-week') {
    deadlineMultiplier += budget.deadlineBoost * 0.3;
  }
  return {
    importanceWeight,
    contextMatch,
    stalenessBoost,
    deadlineMultiplier,
    deadlineBoostApplied: deadlineMultiplier - 1,
    ...deadlineInfo
  };
}

function selectWeightedPopupCandidate(tips, source) {
  const budget = getNotificationBudget();
  const now = Date.now();
  const diagnosed = tips.map(tip => {
    const suppressionReason = getSelectionEligibility(tip, budget, now);
    const factors = getPopupSelectionFactors(tip, budget, now);
    return { ...tip, ...factors, suppressionReason, finalWeight: factors.importanceWeight * factors.stalenessBoost * factors.deadlineMultiplier };
  });
  const eligible = diagnosed.filter(tip => !tip.suppressionReason);
  const contextCandidates = eligible.filter(tip => tip.contextMatch);
  const generalCandidates = eligible.filter(tip => !tip.contextMatch);
  const debugSeed = getSettingNumber('popup_selection_debug_seed', -1);
  const nextRandom = () => {
    if (debugSeed < 0) return Math.random();
    popupSelectionSequence += 1;
    const value = Math.sin(debugSeed + popupSelectionSequence) * 10000;
    return value - Math.floor(value);
  };
  const contextRoll = nextRandom();
  const chooseContext = contextCandidates.length > 0 && (generalCandidates.length === 0 || contextRoll < budget.contextMatchPercent / 100);
  const pool = chooseContext ? contextCandidates : (generalCandidates.length ? generalCandidates : contextCandidates);
  const totalWeight = pool.reduce((sum, tip) => sum + tip.finalWeight, 0);
  const contextTotalWeight = contextCandidates.reduce((sum, tip) => sum + tip.finalWeight, 0);
  const generalTotalWeight = generalCandidates.reduce((sum, tip) => sum + tip.finalWeight, 0);
  const contextShare = contextCandidates.length && generalCandidates.length
    ? budget.contextMatchPercent / 100
    : (contextCandidates.length ? 1 : 0);
  const generalShare = generalCandidates.length
    ? (contextCandidates.length ? 1 - contextShare : 1)
    : 0;
  const expectedProbability = tip => {
    if (tip.suppressionReason) return 0;
    if (tip.contextMatch) return contextTotalWeight > 0 ? contextShare * tip.finalWeight / contextTotalWeight : 0;
    return generalTotalWeight > 0 ? generalShare * tip.finalWeight / generalTotalWeight : 0;
  };
  const lastPopup = db.get('SELECT MAX(last_shown) as last_shown FROM tips WHERE last_shown IS NOT NULL AND archived_at IS NULL');
  const weightRoll = nextRandom();
  let roll = weightRoll * totalWeight;
  let selected = pool[pool.length - 1] || null;
  for (const tip of pool) { roll -= tip.finalWeight; if (roll <= 0) { selected = tip; break; } }
  updatePopupDebugState({
    lastScoring: {
      source,
      candidateCount: diagnosed.length,
      selected: summarizeTipForDebug(selected),
      candidates: diagnosed.slice().sort((a, b) => b.finalWeight - a.finalWeight).slice(0, 20).map(tip => {
        const probability = expectedProbability(tip);
        return {
          ...summarizeTipForDebug(tip),
          finalWeight: tip.finalWeight,
          probability,
          finalProbability: probability,
          importanceWeight: tip.importanceWeight,
          contextMatch: tip.contextMatch,
          stalenessBoost: tip.stalenessBoost,
          deadlineMultiplier: tip.deadlineMultiplier,
          deadlineBoostApplied: tip.deadlineBoostApplied,
          effectiveDeadline: tip.effectiveDeadline,
          deadlineSource: tip.deadlineSource,
          deadlineState: tip.deadlineState,
          deadlineDaysRemaining: tip.deadlineDaysRemaining,
          isSequential: tip.isSequential,
          sequentialActiveTipId: tip.sequentialActiveTipId,
          isSequentialActiveStep: tip.isSequentialActiveStep,
          cooldownRemaining: getCooldownRemainingMinutes(tip, budget, now, lastPopup?.last_shown),
          suppressionReason: tip.suppressionReason
        };
      }),
      selection: { contextRoll, weightRoll, selectedGroup: chooseContext ? 'context' : 'general', contextMatchPercent: budget.contextMatchPercent, debugSeed: debugSeed >= 0 ? debugSeed : null, sequence: popupSelectionSequence },
      scoredAt: new Date().toISOString()
    }
  });
  if (!selected && diagnosed.length && diagnosed.every(tip => tip.suppressionReason === 'hourly-budget-exhausted')) {
    const recent = db.get('SELECT COUNT(*) as count, MIN(last_shown) as oldest FROM tips WHERE last_shown IS NOT NULL AND archived_at IS NULL AND last_shown >= ?', [now - 60 * 60 * 1000]);
    updatePopupDebugState({ lastSuppression: { reason: 'hourly-budget-exhausted', source, currentCount: recent?.count || 0, maxPopupsPerHour: budget.maxPopupsPerHour, nextAllowedAt: recent?.count >= budget.maxPopupsPerHour && recent?.oldest ? new Date(Number(recent.oldest) + 3600000).toISOString() : null } });
  }
  return selected;
}
function canShowPopupForTip(tip) {
  if (!tip || tip.isRetiredCheck) return true;
  const budget = getNotificationBudget();
  const suppressionReason = getSelectionEligibility(tip, budget, Date.now());
  if (!suppressionReason) return true;
  updatePopupDebugState({ lastSuppression: { reason: suppressionReason, tip: summarizeTipForDebug(tip) } });
  return false;
}

function selectTipFromCategory(categoryId) {
  const budget = getNotificationBudget();
  const cooldownAgo = Date.now() - (budget.sameTaskCooldownMinutes * 60 * 1000);

  // Get active tips from this category, excluding recently shown or snoozed notes.
  const tips = db.query(`
    SELECT t.*, c.name as category_name, c.color as category_color,
           s.is_sequential AS subcategory_is_sequential,
           s.deadline_mode AS subcategory_deadline_mode,
           s.shared_deadline AS subcategory_shared_deadline,
           (
             SELECT active_tip.id FROM tips active_tip
             WHERE active_tip.subcategory_id = t.subcategory_id
               AND active_tip.status NOT IN (${SEQUENTIAL_TERMINAL_STATUS_SQL}) AND active_tip.archived_at IS NULL
             ORDER BY COALESCE(active_tip.order_index, 2147483647), active_tip.id LIMIT 1
           ) AS sequential_active_tip_id
    FROM tips t
    JOIN categories c ON t.category_id = c.id
    LEFT JOIN subcategories s ON s.id = t.subcategory_id
    WHERE t.category_id = ?
      AND t.status = 'active'
      AND t.archived_at IS NULL
      AND (t.next_due_at IS NULL OR t.next_due_at <= ?)
      AND (t.last_shown IS NULL OR t.last_shown < ?)
      AND (t.snoozed_until IS NULL OR t.snoozed_until < ?)
  `, [categoryId, new Date().toISOString(), cooldownAgo, new Date().toISOString()]);

  if (tips.length === 0) {
    // No active tips available, check for retired tips
    const retiredTips = db.query(`
      SELECT t.*, c.name as category_name, c.color as category_color
      FROM tips t
      JOIN categories c ON t.category_id = c.id
      WHERE t.category_id = ?
        AND t.status = 'retired'
        AND t.archived_at IS NULL
    `, [categoryId]);

    const eligibleRetiredTips = retiredTips.filter(tip => getEffectiveDeadlineInfo(tip).deadlineState !== 'overdue');
    if (eligibleRetiredTips.length === 0) {
      return null;
    }

    // Return a retired tip with "Hâlâ yapıyor musun?" message
    const retiredTip = eligibleRetiredTips[Math.floor(Math.random() * eligibleRetiredTips.length)];
    return {
      ...retiredTip,
      content: `Hâlâ "${retiredTip.category_name}" konusuyla ilgileniyor musun?`,
      isRetiredCheck: true
    };
  }

  return selectWeightedPopupCandidate(tips, 'category-title-match');
}

function showPopupWithTip(tip, category) {
  if (!canShowPopupForTip(tip)) {
    return false;
  }

  const eventRoute = getPopupEventRoute(tip.importance, tip.id);
  const deadlineInfo = getEffectiveDeadlineInfo(tip);
  const tipData = {
    id: tip.id,
    tipId: tip.id,
    category: {
      name: category.name,
      color: category.color
    },
    content: tip.content,
    importance: tip.importance,
    isRetiredCheck: tip.isRetiredCheck || false,
    deadline: deadlineInfo.effectiveDeadline,
    effectiveDeadline: deadlineInfo.effectiveDeadline,
    deadlineSource: deadlineInfo.deadlineSource,
    deadlineState: deadlineInfo.deadlineState,
    isSequential: deadlineInfo.isSequential,
    sequentialActiveTipId: deadlineInfo.sequentialActiveTipId,
    isSequentialActiveStep: deadlineInfo.isSequentialActiveStep,
    ...eventRoute
  };

  return enqueuePopup({
    channel: 'show-tip',
    data: tipData,
    markShownTipId: tip.isRetiredCheck ? null : tip.id,
    key: `tip:${tip.id || `${category.name}:${tip.content}`}`
  });
}

// Random "N'aber?" Popup
function startRandomPopupTracking() {
  if (!randomPopupSchedulerStartedAt) {
    randomPopupSchedulerStartedAt = Date.now();
  }
  scheduleRandomPopup();
}

function rescheduleRandomPopup() {
  if (!randomPopupSchedulerStartedAt) return;
  if (randomPopupInterval) clearTimeout(randomPopupInterval);
  randomPopupInterval = null;
  scheduleRandomPopup();
}

function scheduleRandomPopup() {
  const now = Date.now();
  const budget = getNotificationBudget();
  const recentPopupRows = db.query(`
    SELECT last_shown
    FROM tips
    WHERE last_shown IS NOT NULL
      AND archived_at IS NULL
      AND last_shown >= ?
    ORDER BY last_shown ASC
  `, [now - 60 * 60 * 1000]);
  const lastPopup = db.get(`
    SELECT MAX(last_shown) as last_shown
    FROM tips
    WHERE last_shown IS NOT NULL AND archived_at IS NULL
  `);
  const schedule = calculateNextPopupSchedule({
    now,
    schedulerStartedAt: randomPopupSchedulerStartedAt || now,
    lastPopupAt: lastPopup?.last_shown,
    recentPopupTimestamps: recentPopupRows.map(row => row.last_shown),
    maxPopupsPerHour: budget.maxPopupsPerHour
  });
  const lastPopupAt = lastPopup?.last_shown ? Number(lastPopup.last_shown) : null;
  const previousAttempt = popupDebugState.lastSchedulerAttempt;
  const scheduleReason = schedule.rollingWindowAvailableAt
    ? 'hourly-budget-exhausted'
    : (previousAttempt?.result === 'no-eligible-tip' ? 'no-eligible-candidate-retry' : 'budget-slot');
  const schedulerScheduledAt = new Date(now).toISOString();
  updatePopupDebugState({
    nextTrigger: {
      ...(popupDebugState.nextTrigger || {}),
      randomPopupAt: new Date(schedule.nextPopupAt).toISOString(),
      randomIntervalMs: schedule.delayMs,
      slotIntervalMs: schedule.slotIntervalMs,
      schedulerAnchorAt: new Date(schedule.anchorAt).toISOString(),
      schedulerStartedAt: new Date(randomPopupSchedulerStartedAt || now).toISOString(),
      usedPopupCount: schedule.usedPopupCount,
      maxPopupsPerHour: schedule.maxPopupsPerHour,
      rollingWindowAvailableAt: schedule.rollingWindowAvailableAt
        ? new Date(schedule.rollingWindowAvailableAt).toISOString()
        : null,
      budgetLimit: schedule.maxPopupsPerHour,
      budgetUsed: schedule.usedPopupCount,
      baseSlotMinutes: schedule.slotIntervalMs / 60000,
      lastPopupAt: lastPopupAt ? new Date(lastPopupAt).toISOString() : null,
      nextSlotAt: new Date(schedule.nextPopupAt).toISOString(),
      jitterMinutes: 0,
      scheduleReason,
      budgetWindowStartAt: new Date(schedule.windowStartAt).toISOString(),
      budgetWindowEndAt: new Date(schedule.windowEndAt).toISOString(),
      schedulerStatus: 'scheduled',
      schedulerScheduledAt,
      titleCheckIntervalMs: focusMode ? 2500 : 5000,
      focusMode: focusMode ? { categoryId: focusMode.categoryId, categoryName: focusMode.categoryName } : null
    }
  });

  randomPopupInterval = setTimeout(() => {
    const triggeredAt = new Date().toISOString();
    updatePopupDebugState({
      nextTrigger: {
        ...(popupDebugState.nextTrigger || {}),
        randomPopupAt: null,
        schedulerStatus: 'triggering',
        schedulerTriggeredAt: triggeredAt
      },
      lastSchedulerAttempt: {
        source: 'random-scheduler',
        result: 'triggering',
        attemptedAt: triggeredAt
      }
    });

    try {
      // Check if fullscreen is active before showing
      if (!isFullscreenActive()) {
        showRandomPopup('random-scheduler', triggeredAt);
      } else {
        updatePopupDebugState({
          lastSuppression: {
            reason: 'fullscreen-random-schedule',
            source: 'random-scheduler',
            suppressedAt: triggeredAt
          },
          lastSchedulerAttempt: {
            source: 'random-scheduler',
            result: 'suppressed',
            reason: 'fullscreen-random-schedule',
            attemptedAt: triggeredAt
          }
        });
      }
    } catch (error) {
      console.error('Error in random popup scheduler:', error);
      updatePopupDebugState({
        lastSuppression: {
          reason: 'random-scheduler-error',
          error: error.message,
          failedAt: new Date().toISOString()
        },
        lastSchedulerAttempt: {
          source: 'random-scheduler',
          result: 'error',
          error: error.message,
          attemptedAt: triggeredAt
        }
      });
    } finally {
      randomPopupInterval = null;
      // Budget suppression only skips this attempt; it must never stop the scheduler.
      scheduleRandomPopup();
    }
  }, schedule.delayMs);
}

function showRandomPopup(source = 'random-scheduler', attemptedAt = new Date().toISOString()) {
  // Get any active tip that hasn't been shown in the last hour
  const oneHourAgo = Date.now() - (60 * 60 * 1000);

  let query = `
    SELECT t.*, c.name as category_name, c.color as category_color,
           s.is_sequential AS subcategory_is_sequential,
           s.deadline_mode AS subcategory_deadline_mode,
           s.shared_deadline AS subcategory_shared_deadline,
           (
             SELECT active_tip.id FROM tips active_tip
             WHERE active_tip.subcategory_id = t.subcategory_id
               AND active_tip.status NOT IN (${SEQUENTIAL_TERMINAL_STATUS_SQL}) AND active_tip.archived_at IS NULL
             ORDER BY COALESCE(active_tip.order_index, 2147483647), active_tip.id LIMIT 1
           ) AS sequential_active_tip_id
    FROM tips t
    JOIN categories c ON t.category_id = c.id
    LEFT JOIN subcategories s ON s.id = t.subcategory_id
    WHERE t.status = 'active'
      AND t.archived_at IS NULL
      AND (t.next_due_at IS NULL OR t.next_due_at <= ?)
      AND (t.last_shown IS NULL OR t.last_shown < ?)
  `;

  let params = [new Date().toISOString(), oneHourAgo];

  // If focus mode is active, only select tips from focus category
  if (focusMode) {
    query += ` AND t.category_id = ?`;
    params.push(focusMode.categoryId);
  }

  const tips = db.query(query, params);
  const tip = selectWeightedPopupCandidate(tips, source);

  if (tip) {
    const category = {
      name: tip.category_name,
      color: tip.category_color
    };

    const queued = showPopupWithTip(tip, category);
    const lastSuppression = popupDebugState.lastSuppression;
    updatePopupDebugState({
      lastSchedulerAttempt: {
        source,
        result: queued ? 'queued' : 'suppressed',
        candidate: summarizeTipForDebug(tip),
        reason: queued || !lastSuppression ? null : lastSuppression.reason,
        attemptedAt
      },
      lastSuppression: queued || !lastSuppression
        ? popupDebugState.lastSuppression
        : {
            ...lastSuppression,
            source: lastSuppression.source || source,
            suppressedAt: lastSuppression.suppressedAt || attemptedAt
          }
    });
    return { queued, tip };
  }

  const schedulerSuppression = popupDebugState.lastSuppression;
  const suppressionReason = schedulerSuppression?.reason === 'hourly-budget-exhausted'
    ? schedulerSuppression
    : {
        reason: 'no-eligible-candidate',
        source,
        suppressedAt: attemptedAt
      };
  updatePopupDebugState({
    lastSuppression: suppressionReason,
    lastSchedulerAttempt: {
      source,
      result: 'no-eligible-tip',
      reason: suppressionReason.reason,
      attemptedAt
    }
  });
  return { queued: false, tip: null };
}

app.whenReady().then(async () => {
  await initApp();
  createTray();
  showCheckinWindowIfNeeded();
  const quickCaptureRegistered = globalShortcut.register('Control+Alt+N', showQuickCaptureWindow);
  console.log(`[QuickCapture] Ctrl+Alt+N shortcut ${quickCaptureRegistered ? 'registered' : 'could not be registered'}`);
  startWindowTitleTracking();
  startRandomPopupTracking();

  // Don't create main window initially, app lives in tray
});

app.on('window-all-closed', () => {
  // Don't quit on Windows when all windows are closed
  // App lives in system tray
});

app.on('before-quit', () => {
  // Cleanup before quit
  if (titleCheckInterval) clearInterval(titleCheckInterval);
  if (randomPopupInterval) clearTimeout(randomPopupInterval);
  if (debugPopupInterval) clearInterval(debugPopupInterval);
  if (markdownWatchDebounce) clearTimeout(markdownWatchDebounce);
  if (markdownWatcher) {
    markdownWatcher.close();
    markdownWatcher = null;
  }
  globalShortcut.unregisterAll();
  if (db) {
    db.close();
  }
});

function normalizeMarkdownLine(line) {
  return line.replace(/^\s*[-*+]\s+/, '').replace(/^\s*\d+[.)]\s+/, '').trim();
}

function parseMarkdownTasks(markdown) {
  const withoutBom = markdown.replace(/^\uFEFF/, '');
  const lines = withoutBom.split(/\r?\n/);
  const tasks = [];
  let currentCategory = null;
  let currentSubcategory = null;
  let inFrontmatter = false;

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;

    if (index === 0 && line === '---') {
      inFrontmatter = true;
      return;
    }
    if (inFrontmatter) {
      if (line === '---') inFrontmatter = false;
      return;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2].trim();
      if (level === 1) {
        currentCategory = title;
        currentSubcategory = null;
      } else if (level === 2) {
        currentSubcategory = title;
      }
      return;
    }

    if (/^\s*([-*+]|\d+[.)])\s+/.test(rawLine)) {
      const content = normalizeMarkdownLine(rawLine);
      if (content) {
        tasks.push({
          categoryName: currentCategory || 'Imported',
          subcategoryName: currentSubcategory,
          content
        });
      }
    }
  });

  return tasks;
}

function categoryColorForName(name) {
  const palette = ['#00c2d1', '#22c55e', '#f5a623', '#8b5cf6', '#ef4444', '#3b82f6'];
  let hash = 0;
  for (const char of name) hash = ((hash << 5) - hash) + char.charCodeAt(0);
  return palette[Math.abs(hash) % palette.length];
}

function findOrCreateCategory(name) {
  const existing = db.get('SELECT id FROM categories WHERE name = ? ORDER BY id LIMIT 1', [name]);
  if (existing) {
    ensureGeneralSubcategory(existing.id);
    return existing.id;
  }

  const result = db.run(
    'INSERT INTO categories (name, color, triggers, created_at) VALUES (?, ?, ?, ?)',
    [name, categoryColorForName(name), JSON.stringify({ apps: [], keywords: [] }), Date.now()]
  );
  ensureGeneralSubcategory(result.lastID);
  return result.lastID;
}

function ensureGeneralSubcategory(categoryId) {
  if (!categoryId) return null;

  const existing = db.get(
    "SELECT id FROM subcategories WHERE category_id = ? AND lower(name) = lower('Genel') ORDER BY id LIMIT 1",
    [categoryId]
  );
  if (existing) return existing.id;

  const result = db.run(
    'INSERT INTO subcategories (category_id, name, order_index) VALUES (?, ?, ?)',
    [categoryId, 'Genel', 0]
  );
  return result.lastID;
}

function ensureGeneralSubcategoriesForAll() {
  const rows = db.query('SELECT id FROM categories ORDER BY id ASC');
  rows.forEach(category => ensureGeneralSubcategory(category.id));
}

function findOrCreateSubcategory(categoryId, name) {
  if (!name) return null;

  const existing = db.get(
    'SELECT id FROM subcategories WHERE category_id = ? AND name = ? ORDER BY id LIMIT 1',
    [categoryId, name]
  );
  if (existing) return existing.id;

  const maxOrder = db.get(
    'SELECT COALESCE(MAX(order_index), 0) as max_order FROM subcategories WHERE category_id = ?',
    [categoryId]
  );
  const result = db.run(
    'INSERT INTO subcategories (category_id, name, order_index) VALUES (?, ?, ?)',
    [categoryId, name, (maxOrder ? maxOrder.max_order : 0) + 1]
  );
  return result.lastID;
}

function importMarkdownContent(markdown) {
  const tasks = parseMarkdownTasks(markdown);
  if (tasks.length === 0) {
    return { success: false, error: 'Markdown içinde içe aktarılacak madde bulunamadı.' };
  }

  db.exec('BEGIN TRANSACTION');
  try {
    let imported = 0;
    const categoryCache = new Map();
    const subcategoryCache = new Map();

    for (const task of tasks) {
      let categoryId = categoryCache.get(task.categoryName);
      if (!categoryId) {
        categoryId = findOrCreateCategory(task.categoryName);
        categoryCache.set(task.categoryName, categoryId);
      }

      const subcategoryKey = `${categoryId}:${task.subcategoryName || ''}`;
      let subcategoryId = subcategoryCache.get(subcategoryKey);
      if (subcategoryId === undefined) {
        subcategoryId = findOrCreateSubcategory(categoryId, task.subcategoryName);
        subcategoryCache.set(subcategoryKey, subcategoryId);
      }

      const maxOrder = db.get(
        'SELECT COALESCE(MAX(order_index), 0) as max_order FROM tips WHERE category_id = ? AND ((? IS NULL AND subcategory_id IS NULL) OR subcategory_id = ?)',
        [categoryId, subcategoryId, subcategoryId]
      );

      db.run(
        `INSERT INTO tips (category_id, content, importance, show_count, status, last_shown, created_at, subcategory_id, order_index)
         VALUES (?, ?, 5, 0, 'active', NULL, ?, ?, ?)`,
        [categoryId, task.content, Date.now(), subcategoryId, (maxOrder ? maxOrder.max_order : 0) + 1]
      );
      imported++;
    }

    db.exec('COMMIT');
    notifyDataUpdated('categories');
    notifyDataUpdated('tips');
    updateTrayMenu();
    syncMarkdownStorageSafe('markdown-import');
    return { success: true, imported };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// IPC handlers for renderer process
const { ipcMain } = require('electron');

ipcMain.handle('db-query', async (event, sql, params) => {
  try {
    return db.query(sql, params);
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
});

ipcMain.handle('statistics-get', async (event, mode) => {
  try {
    return buildStatisticsSnapshot(mode);
  } catch (error) {
    console.error('Statistics query error:', error);
    return buildStatisticsErrorResponse(mode, error);
  }
});

ipcMain.handle('dashboard-weekly-progress', async () => {
  try {
    return buildDashboardWeeklyProgress();
  } catch (error) {
    console.error('Dashboard weekly progress error:', error);
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('db-run', async (event, sql, params) => {
  console.log('DEBUG: main.js db-run handler called', { sql, params });
  try {
    const result = db.run(sql, params);
    console.log('DEBUG: main.js db-run result', result);
    const recurringRescheduled = maybeApplyRecurringCompletion(sql, params);
    const completionTimestamped = markCompletionTimestampIfNeeded(sql, params, recurringRescheduled);
    const sequentialProgression = applySequentialStatusProgression(sql, params, recurringRescheduled);

    // Check if it's a mutation and notify data updated
    const sqlUpper = sql.toUpperCase();
    const notificationBudgetChanged = sqlUpper.includes('SETTINGS')
      && Array.isArray(params)
      && params.includes('notification_max_popups_per_hour');
    if (notificationBudgetChanged && randomPopupSchedulerStartedAt) {
      rescheduleRandomPopup();
    }
    const popupSelectionChanged = sqlUpper.includes('TIPS')
      && (sqlUpper.includes('STATUS') || sqlUpper.includes('SUBCATEGORY_ID') || sqlUpper.includes('ORDER_INDEX'));
    if (popupSelectionChanged && randomPopupSchedulerStartedAt) {
      rescheduleRandomPopup();
    }
    if (sqlUpper.includes('INSERT INTO CATEGORIES')) {
      ensureGeneralSubcategory(result.lastID);
    }
    if (sqlUpper.includes('DELETE FROM SUBCATEGORIES')) {
      ensureGeneralSubcategoriesForAll();
    }

    if (sqlUpper.includes('DELETE FROM CATEGORIES') || sqlUpper.includes('UPDATE CATEGORIES') || sqlUpper.includes('INSERT INTO CATEGORIES')) {
      notifyDataUpdated('categories');
    }
    if (sqlUpper.includes('DELETE FROM TIPS') || sqlUpper.includes('UPDATE TIPS') || sqlUpper.includes('INSERT INTO TIPS')) {
      notifyDataUpdated('tips', recurringRescheduled || completionTimestamped || sequentialProgression
        ? { recurringRescheduled, completionTimestamped, sequentialProgression }
        : {}
      );
    }
    if (sqlUpper.includes('DELETE FROM CATEGORIES') ||
        sqlUpper.includes('UPDATE CATEGORIES') ||
        sqlUpper.includes('INSERT INTO CATEGORIES') ||
        sqlUpper.includes('DELETE FROM TIPS') ||
        sqlUpper.includes('UPDATE TIPS') ||
        sqlUpper.includes('INSERT INTO TIPS') ||
        sqlUpper.includes('DELETE FROM SUBCATEGORIES') ||
        sqlUpper.includes('UPDATE SUBCATEGORIES') ||
        sqlUpper.includes('INSERT INTO SUBCATEGORIES')) {
      syncMarkdownStorageSafe('db-run');
    }

    return result;
  } catch (error) {
    console.error('Database run error in db-run:', error);
    // Suppress duplicate column errors on ALTER TABLE
    if (sql.toUpperCase().includes('ALTER TABLE') && error.message && error.message.includes('duplicate column')) {
      console.warn('Ignoring duplicate column error during db-run');
      return { success: false, ignored: true, error: error.message };
    }
    throw error;
  }
});

ipcMain.handle('import-markdown-file', async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Markdown dosyası içe aktar',
      properties: ['openFile'],
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown'] },
        { name: 'Text', extensions: ['txt'] }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, cancelled: true };
    }

    const filePath = result.filePaths[0];
    const markdown = fs.readFileSync(filePath, 'utf8');
    return importMarkdownContent(markdown);
  } catch (error) {
    console.error('Error importing markdown:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('markdown-refresh', async () => {
  try {
    const result = markdownStorage.syncFromDatabase(db, 'manual-refresh');
    return { success: true, root: result.root };
  } catch (error) {
    console.error('Error refreshing markdown storage:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('markdown-read-back', async () => {
  try {
    const result = markdownStorage.readBackToDatabase(db, 'manual-read-back');
    syncMarkdownStorageSafe('after-read-back');
    notifyDataUpdated('categories');
    notifyDataUpdated('tips');
    updateTrayMenu();
    return { success: true, ...result };
  } catch (error) {
    console.error('Error reading markdown storage:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('popup-resize', async (event, contentHeight, options = {}) => {
  try {
    if (!popupWindow) return { success: false };
    const isTimerMode = options && options.mode === 'timer';
    const width = isTimerMode ? 240 : 400;
    const minHeight = isTimerMode ? 132 : 450;
    const maxHeight = isTimerMode ? 180 : 650;
    const clamped = Math.min(maxHeight, Math.max(minHeight, Math.round(contentHeight)));
    popupWindow.setSize(width, clamped);

    if (isTimerMode) {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const workArea = display.workArea;
      popupWindow.setPosition(
        workArea.x + workArea.width - width - 16,
        workArea.y + 16
      );
    }

    return { success: true };
  } catch (error) {
    console.error('Error in popup-resize:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('category-delete', async (event, id) => {
  try {
    const result = db.run(`DELETE FROM categories WHERE id = ?`, [id]);
    notifyDataUpdated('categories');
    syncMarkdownStorageSafe('category-delete');
    return { success: true, result };
  } catch (error) {
    console.error('Error in category-delete:', error);
    return { success: false, error: error.message };
  }
});

function getDailySnoozeLimit(importance) {
  if (importance <= 2) return Infinity;
  if (importance <= 4) return 4;
  if (importance <= 6) return 3;
  if (importance <= 8) return 2;
  return 0; // importance 9-10 math route does not allow snooze
}

async function getTodaySnoozeCount(tipId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const result = db.get(
    `SELECT COUNT(*) as count FROM dismiss_log
     WHERE tip_id = ? AND reason IN ('not_today','remind_1h','no_motivation','not_now')
     AND dismissed_at >= ?`,
    [tipId, today.getTime()]
  );
  return result ? result.count : 0;
}

ipcMain.handle('snooze-check', async (event, tipId) => {
  try {
    const tip = db.get('SELECT * FROM tips WHERE id = ?', [tipId]);
    if (!tip) return { canSnooze: false, remaining: 0, reason: 'tip-not-found', allowedReasons: [...ALLOWED_SNOOZE_REASONS] };
    const deadlineInfo = getEffectiveDeadlineInfo(tip);
    if (deadlineInfo.deadlineState === 'overdue') {
      const validation = {
        accepted: false,
        tipId,
        reason: 'deadline-expired',
        effectiveDeadline: deadlineInfo.effectiveDeadline,
        validatedAt: new Date().toISOString()
      };
      updatePopupDebugState({ lastSnoozeValidation: validation });
      return { canSnooze: false, remaining: 0, reason: 'deadline-expired', allowedReasons: [...ALLOWED_SNOOZE_REASONS] };
    }

    const limit = getDailySnoozeLimit(tip.importance);
    if (limit === Infinity) return { canSnooze: true, remaining: Infinity, allowedReasons: [...ALLOWED_SNOOZE_REASONS] };
    if (limit === 0) return { canSnooze: false, remaining: 0, reason: 'importance-limit', allowedReasons: [...ALLOWED_SNOOZE_REASONS] };

    const count = await getTodaySnoozeCount(tipId);
    const remaining = Math.max(0, limit - count);
    return { canSnooze: remaining > 0, remaining, reason: remaining > 0 ? null : 'daily-limit-exhausted', allowedReasons: [...ALLOWED_SNOOZE_REASONS] };
  } catch (error) {
    console.error('Error in snooze-check:', error);
    return { canSnooze: false, remaining: 0, reason: 'snooze-check-error', allowedReasons: [...ALLOWED_SNOOZE_REASONS] };
  }
});

ipcMain.handle('snooze-apply', async (event, tipId, reason) => {
  let transactionStarted = false;
  try {
    const normalizedReason = String(reason || '').trim().toLowerCase();
    const tip = db.get('SELECT * FROM tips WHERE id = ?', [tipId]);
    if (!tip) {
      const validation = { accepted: false, tipId, reason: normalizedReason, validationReason: 'tip-not-found', validatedAt: new Date().toISOString() };
      updatePopupDebugState({ lastSnoozeValidation: validation });
      return { success: false, error: 'tip-not-found', allowedReasons: [...ALLOWED_SNOOZE_REASONS] };
    }
    const deadlineInfo = getEffectiveDeadlineInfo(tip);
    if (deadlineInfo.deadlineState === 'overdue') {
      const validation = { accepted: false, tipId, reason: normalizedReason, validationReason: 'deadline-expired', effectiveDeadline: deadlineInfo.effectiveDeadline, validatedAt: new Date().toISOString() };
      updatePopupDebugState({ lastSnoozeValidation: validation });
      return { success: false, error: 'deadline-expired', allowedReasons: [...ALLOWED_SNOOZE_REASONS] };
    }
    if (!ALLOWED_SNOOZE_REASONS.includes(normalizedReason)) {
      const validation = { accepted: false, tipId, reason: normalizedReason, validationReason: 'invalid-snooze-reason', validatedAt: new Date().toISOString() };
      updatePopupDebugState({ lastSnoozeValidation: validation });
      return { success: false, error: 'invalid-snooze-reason', allowedReasons: [...ALLOWED_SNOOZE_REASONS] };
    }
    const snoozeLimit = getDailySnoozeLimit(tip.importance);
    if (snoozeLimit === 0) {
      const validation = { accepted: false, tipId, reason: normalizedReason, validationReason: 'snooze-disabled-for-event-route', validatedAt: new Date().toISOString() };
      updatePopupDebugState({ lastSnoozeValidation: validation });
      return { success: false, error: 'snooze-disabled-for-event-route', allowedReasons: [...ALLOWED_SNOOZE_REASONS] };
    }
    if (snoozeLimit !== Infinity) {
      const usedSnoozes = await getTodaySnoozeCount(tipId);
      if (usedSnoozes >= snoozeLimit) {
        const validation = { accepted: false, tipId, reason: normalizedReason, validationReason: 'daily-limit-exhausted', validatedAt: new Date().toISOString() };
        updatePopupDebugState({ lastSnoozeValidation: validation });
        return { success: false, error: 'daily-limit-exhausted', allowedReasons: [...ALLOWED_SNOOZE_REASONS] };
      }
    }

    let durationHours = 0;
    if (normalizedReason === 'not_today' || normalizedReason === 'no_motivation') durationHours = 24;
    else if (normalizedReason === 'remind_1h') durationHours = 1;
    else if (normalizedReason === 'not_now') durationHours = 2;

    const snoozedUntil = new Date(Date.now() + durationHours * 3600000).toISOString();

    db.exec('BEGIN TRANSACTION');
    transactionStarted = true;

    db.run('UPDATE tips SET snoozed_until = ? WHERE id = ?', [snoozedUntil, tipId]);
    db.run(
      `INSERT INTO dismiss_log (tip_id, reason, dismissed_at) VALUES (?, ?, ?)`,
      [tipId, normalizedReason, Date.now()]
    );

    if (normalizedReason === 'no_motivation') {
      db.run('UPDATE tips SET importance = MIN(importance + 1, 10) WHERE id = ?', [tipId]);
    }

    const problemReasons = ['not_today', 'no_motivation', 'not_now'];
    if (problemReasons.includes(normalizedReason)) {
      const problemCount = db.get(`
        SELECT COUNT(*) as count
        FROM dismiss_log
        WHERE tip_id = ? AND reason IN ('not_today', 'no_motivation', 'not_now', 'task_too_big', 'unclear')
      `, [tipId]);
      if (problemCount && problemCount.count >= 3) {
        db.run('UPDATE tips SET needs_review = 1 WHERE id = ?', [tipId]);
      }
    }

    db.exec('COMMIT');
    transactionStarted = false;
    updatePopupDebugState({
      lastSnoozeValidation: {
        accepted: true,
        tipId,
        reason: normalizedReason,
        snoozedUntil,
        validatedAt: new Date().toISOString()
      }
    });
    notifyDataUpdated('tips');
    syncMarkdownStorageSafe('snooze-apply');
    return { success: true, reason: normalizedReason, snoozedUntil };
  } catch (error) {
    if (transactionStarted) {
      try { db.exec('ROLLBACK'); } catch {}
    }
    console.error('Error in snooze-apply:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-popup-data', async () => {
  return pendingTipData;
});

ipcMain.handle('show-popup', async (event, tipData = null) => {
  try {
    if (tipData) {
      const tipId = tipData.tipId || tipData.id || null;
      const storedTip = tipId ? db.get('SELECT * FROM tips WHERE id = ?', [tipId]) : null;
      const sourceTip = storedTip ? { ...storedTip, ...tipData, id: storedTip.id } : tipData;
      const deadlineInfo = getEffectiveDeadlineInfo(sourceTip);
      if (deadlineInfo.deadlineState === 'overdue') {
        updatePopupDebugState({
          lastSuppression: {
            reason: 'deadline-expired',
            source: 'manual-show-popup',
            tip: summarizeTipForDebug(sourceTip),
            suppressedAt: new Date().toISOString()
          }
        });
        return { success: false, error: 'deadline-expired' };
      }
      const route = getPopupEventRoute(sourceTip.importance, tipId);
      const queuedData = {
        ...tipData,
        effectiveDeadline: deadlineInfo.effectiveDeadline,
        deadlineSource: deadlineInfo.deadlineSource,
        deadlineState: deadlineInfo.deadlineState,
        ...route
      };
      enqueuePopup({
        channel: 'show-tip',
        data: queuedData,
        key: `manual:${tipData.tipId || tipData.id || tipData.content || Date.now()}`
      });
    } else {
      createPopupWindow();
      if (popupWindow) popupWindow.show();
    }
    return { success: true };
  } catch (error) {
    console.error('Error in show-popup:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('close-popup', async () => {
  try {
    if (popupWindow) {
      popupWindow.close();
    }
    return { success: true };
  } catch (error) {
    console.error('Error in close-popup:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('show-settings', async () => {
  try {
    showMainWindow();
    return { success: true };
  } catch (error) {
    console.error('Error in show-settings:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('quick-capture-save', async (event, content) => {
  try {
    const text = String(content || '').trim();
    if (!text) {
      return { success: false, error: 'Not içeriği boş olamaz.' };
    }

    const categoryId = findOrCreateCategory('Yapılacaklar');
    const maxOrder = db.get(
      'SELECT COALESCE(MAX(order_index), 0) as max_order FROM tips WHERE category_id = ? AND subcategory_id IS NULL',
      [categoryId]
    );

    const result = db.run(
      `INSERT INTO tips (category_id, content, importance, show_count, status, last_shown, created_at, subcategory_id, order_index, focus_duration)
       VALUES (?, ?, 5, 0, 'active', NULL, ?, NULL, ?, 5)`,
      [categoryId, text, Date.now(), (maxOrder ? maxOrder.max_order : 0) + 1]
    );

    notifyDataUpdated('categories');
    notifyDataUpdated('tips');
    updateTrayMenu();
    syncMarkdownStorageSafe('quick-capture');

    if (quickCaptureWindow) {
      quickCaptureWindow.hide();
    }

    return { success: true, id: result.lastID };
  } catch (error) {
    console.error('Error in quick-capture-save:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('log-dismiss-reason', async (event, tipId, reason) => {
  try {
    db.run(`
      INSERT INTO dismiss_log (tip_id, reason, dismissed_at)
      VALUES (?, ?, ?)
    `, [tipId, reason, Date.now()]);
    return { success: true };
  } catch (error) {
    console.error('Error logging dismiss reason:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-audio-settings', async () => {
  if (!audioSettings) loadAudioSettings();
  return { ...AUDIO_DISABLED_SETTINGS };
});

// Audio control IPC handlers
const suppressAudioIpc = async () => ({ success: false, audioDisabled: true, audioSuppressed: true });
ipcMain.handle('audio-fade-in', suppressAudioIpc);
ipcMain.handle('audio-fade-out', suppressAudioIpc);
ipcMain.handle('audio-stop', suppressAudioIpc);
ipcMain.handle('audio-set-volume', suppressAudioIpc);

// Timer IPC handlers
ipcMain.handle('show-timer', async (event, tipData) => {
  try {
    currentTipForTimer = tipData;
    createTimerWindow();
    if (timerWindow) {
      timerWindow.webContents.send('timer-start');
    }
    return { success: true };
  } catch (error) {
    console.error('Error in show-timer:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('timer-ended', async () => {
  try {
    // Close timer window
    if (timerWindow) {
      timerWindow.close();
    }

    // Show follow-up popup asking "Devam ettin mi?"
    if (currentTipForTimer) {
      showFollowUpPopup(currentTipForTimer);
    }
    return { success: true };
  } catch (error) {
    console.error('Error in timer-ended:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('close-timer', async () => {
  try {
    if (timerWindow) {
      timerWindow.close();
    }
    return { success: true };
  } catch (error) {
    console.error('Error in close-timer:', error);
    return { success: false, error: error.message };
  }
});

// Focus Mode IPC handlers
ipcMain.handle('get-focus-mode', async () => {
  try {
    return focusMode;
  } catch (error) {
    console.error('Error in get-focus-mode:', error);
    return null;
  }
});

ipcMain.handle('activate-focus-mode', async (event, categoryId, categoryName, categoryColor) => {
  try {
    activateFocusMode(categoryId, categoryName, categoryColor);
    return focusMode;
  } catch (error) {
    console.error('Error in activate-focus-mode:', error);
    return null;
  }
});

ipcMain.handle('deactivate-focus-mode', async () => {
  try {
    deactivateFocusMode();
    return null;
  } catch (error) {
    console.error('Error in deactivate-focus-mode:', error);
    return null;
  }
});

// Follow-up popup for timer end
function showFollowUpPopup(tipData) {
  enqueuePopup({
    channel: 'show-follow-up',
    data: tipData,
    key: `follow-up:${tipData.tipId || tipData.id || tipData.content || Date.now()}`
  });
}


// Notify data updated
function notifyDataUpdated(type, data = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('data-updated', { type, ...data });
  }
}

// Check-in IPC handlers
ipcMain.handle('checkin-status', async () => {
  const dateStr = getLocalDateKey();
  try {
    const todayCheckin = db.query('SELECT * FROM checkins WHERE date = ?', [dateStr]);
    const isCompleted = todayCheckin.length > 0 && todayCheckin[0].completed === 1;
    const latest = db.query('SELECT streak FROM checkins ORDER BY date DESC LIMIT 1');
    const streak = latest.length > 0 ? latest[0].streak : 0;
    return { completed: isCompleted, streak: streak };
  } catch (error) {
    console.error('Error in checkin-status:', error);
    return { completed: false, streak: 0 };
  }
});

ipcMain.handle('checkin-do', async () => {
  const today = new Date();
  const dateStr = getLocalDateKey(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = getLocalDateKey(yesterday);

  try {
    const todayCheckin = db.query('SELECT * FROM checkins WHERE date = ?', [dateStr]);
    if (todayCheckin.length > 0 && todayCheckin[0].completed === 1) {
      if (checkinWindow) checkinWindow.close();
      return true;
    }
    const yesterdayCheckin = db.query('SELECT * FROM checkins WHERE date = ?', [yesterdayStr]);
    let newStreak = 1;
    if (yesterdayCheckin.length > 0 && yesterdayCheckin[0].completed === 1) {
      newStreak = yesterdayCheckin[0].streak + 1;
    }
    if (todayCheckin.length > 0) {
      db.run('UPDATE checkins SET completed = 1, streak = ? WHERE date = ?', [newStreak, dateStr]);
    } else {
      db.run('INSERT INTO checkins (date, completed, streak) VALUES (?, 1, ?)', [dateStr, newStreak]);
    }
    if (checkinWindow) checkinWindow.close();
    return true;
  } catch (error) {
    console.error('Error in checkin-do:', error);
    return false;
  }
});

ipcMain.handle('checkin-history', async () => {
  const today = new Date();
  today.setDate(today.getDate() - 30);
  const thirtyDaysAgoStr = getLocalDateKey(today);
  try {
    return db.query('SELECT date, completed, streak FROM checkins WHERE date >= ? ORDER BY date ASC', [thirtyDaysAgoStr]);
  } catch (error) {
    console.error('Error in checkin-history:', error);
    return [];
  }
});

ipcMain.handle('close-checkin', async () => {
  if (checkinWindow) checkinWindow.close();
});

// Debug IPC handlers
ipcMain.handle('get-popup-queue', async () => popupQueue);

ipcMain.handle('get-popup-debug-state', async () => getPopupDebugStateSnapshot());

ipcMain.handle('debug-get-next-popups', async () => {
  const snapshot = getPopupDebugStateSnapshot();
  return {
    candidates: snapshot.popupExitOrder,
    items: snapshot.popupExitOrder,
    schedulerState: snapshot.schedulerState,
    triggerTime: snapshot.triggerTime,
    trackedApplication: snapshot.trackedApplication,
    usedPopupCount: snapshot.usedPopupCount,
    hourlyLimit: snapshot.hourlyLimit,
    nextAllowedAt: snapshot.nextAllowedAt,
    waitingReason: snapshot.waitingReason,
    hourlyBudget: snapshot.hourlyBudget,
    selectionSettings: snapshot.selectionSettings,
    context: snapshot.selectionSettings,
    budgetLimit: snapshot.budgetLimit,
    budgetUsed: snapshot.budgetUsed,
    baseSlotMinutes: snapshot.baseSlotMinutes,
    lastPopupAt: snapshot.lastPopupAt,
    nextSlotAt: snapshot.nextSlotAt,
    jitterMinutes: snapshot.jitterMinutes,
    scheduleReason: snapshot.scheduleReason,
    audioDisabled: snapshot.audioDisabled,
    audioSuppressed: snapshot.audioSuppressed
  };
});

ipcMain.handle('debug-start-popup-interval', async () => {
  try {
    if (debugPopupInterval) {
      clearInterval(debugPopupInterval);
    }

    debugPopupCount = 0;
    const intervalMs = 10000;
    debugPopupInterval = setInterval(() => {
      try {
        debugPopupCount++;
        updatePopupDebugState({
          nextTrigger: {
            ...(popupDebugState.nextTrigger || {}),
            debugPopupIntervalMs: intervalMs,
            debugPopupNextAt: new Date(Date.now() + intervalMs).toISOString(),
            debugPopupCount
          }
        });
        showRandomPopup('debug-popup-interval');
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('debug-popup-count-update', { count: debugPopupCount, intervalMs });
        }
      } catch (error) {
        console.error('Error in debug popup interval tick:', error);
        updatePopupDebugState({
          lastSuppression: {
            reason: 'debug-interval-error',
            error: error.message,
            failedAt: new Date().toISOString()
          }
        });
      }
    }, intervalMs);

    updatePopupDebugState({
      nextTrigger: {
        ...(popupDebugState.nextTrigger || {}),
        debugPopupIntervalMs: intervalMs,
        debugPopupNextAt: new Date(Date.now() + intervalMs).toISOString(),
        debugPopupCount
      }
    });

    return { ok: true, success: true, running: true, intervalMs, count: debugPopupCount };
  } catch (error) {
    console.error('Error in debug-start-popup-interval:', error);
    return { ok: false, success: false, running: false, error: error.message };
  }
});

ipcMain.handle('debug-stop-popup-interval', async () => {
  try {
    if (debugPopupInterval) {
      clearInterval(debugPopupInterval);
      debugPopupInterval = null;
    }

    updatePopupDebugState({
      nextTrigger: {
        ...(popupDebugState.nextTrigger || {}),
        debugPopupIntervalMs: null,
        debugPopupNextAt: null,
        debugPopupCount
      }
    });

    return { ok: true, success: true, running: false, count: debugPopupCount };
  } catch (error) {
    console.error('Error in debug-stop-popup-interval:', error);
    return { ok: false, success: false, running: Boolean(debugPopupInterval), error: error.message };
  }
});

ipcMain.handle('debug-set-checkin-missed', async () => {
  try {
    const today = getLocalDateKey();
    db.run('DELETE FROM checkins WHERE date = ?', [today]);
    notifyDataUpdated('checkins');
    syncMarkdownStorageSafe('debug-set-checkin-missed');
    return { ok: true, success: true, date: today };
  } catch (error) {
    console.error('Error in debug-set-checkin-missed:', error);
    return { ok: false, success: false, error: error.message };
  }
});

ipcMain.handle('debug-trigger-checkin-popup', async () => {
  try {
    const window = createCheckinWindow();
    return { ok: true, success: true, visible: window.isVisible() };
  } catch (error) {
    console.error('Error in debug-trigger-checkin-popup:', error);
    return { ok: false, success: false, error: error.message };
  }
});

ipcMain.handle('debug-simulate-deadline', async (event, type, id, daysFromNow) => {
  try {
    const days = Number(daysFromNow || 0);
    const deadline = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    const normalizedType = String(type || '').toLowerCase();

    if (normalizedType === 'subcategory') {
      db.run('UPDATE subcategories SET shared_deadline = ?, deadline_mode = ? WHERE id = ?', [deadline, 'shared', id]);
      notifyDataUpdated('categories');
    } else {
      db.run('UPDATE tips SET deadline = ? WHERE id = ?', [deadline, id]);
      notifyDataUpdated('tips');
    }

    if (randomPopupSchedulerStartedAt) rescheduleRandomPopup();

    syncMarkdownStorageSafe('debug-simulate-deadline');
    return { ok: true, success: true, type: normalizedType || 'tip', id, deadline };
  } catch (error) {
    console.error('Error in debug-simulate-deadline:', error);
    return { ok: false, success: false, error: error.message };
  }
});

ipcMain.handle('debug-reset-snooze-limits', async () => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    db.run(
      `DELETE FROM dismiss_log
       WHERE reason IN ('not_today','remind_1h','no_motivation','not_now')
       AND dismissed_at >= ?`,
      [today.getTime()]
    );
    db.run('UPDATE tips SET snoozed_until = NULL WHERE snoozed_until IS NOT NULL');
    notifyDataUpdated('tips');
    syncMarkdownStorageSafe('debug-reset-snooze-limits');
    return { ok: true, success: true };
  } catch (error) {
    console.error('Error in debug-reset-snooze-limits:', error);
    return { ok: false, success: false, error: error.message };
  }
});

ipcMain.handle('debug-get-active-window', async () => {
  try {
    const activeWindow = await activeWin();
    if (!activeWindow) return null;

    const data = normalizeActiveWindow(activeWindow, 'debug-get-active-window');
    lastActiveProcessName = data.process.toLowerCase();
    updatePopupDebugState({ activeWindow: data });
    return data;
  } catch (error) {
    console.error('Error getting active window:', error);
    return null;
  }
});
// Active Windows Handler
ipcMain.handle('get-active-windows', async () => {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    const cmd = [
      'powershell', '-NoProfile', '-NonInteractive', '-Command',
      `"Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object ProcessName,MainWindowTitle | ConvertTo-Json"`
    ].join(' ');

    exec(cmd, { timeout: 6000 }, (error, stdout) => {
      if (error || !stdout || !stdout.trim()) {
        resolve([]);
        return;
      }
      try {
        let raw = JSON.parse(stdout.trim());
        if (!Array.isArray(raw)) raw = [raw];
        const windows = raw
          .filter(w => w && w.ProcessName && w.MainWindowTitle)
          .map(w => ({
            processName: w.ProcessName + '.exe',
            windowTitle: w.MainWindowTitle,
            display: `${w.ProcessName}.exe — ${w.MainWindowTitle}`
          }));
        resolve(windows);
      } catch {
        resolve([]);
      }
    });
  });
});

ipcMain.handle('deadline-set', async (event, tipId, deadline) => {
  try {
    const normalizedDeadline = deadline ? new Date(deadline).toISOString() : null;
    db.run('UPDATE tips SET deadline = ? WHERE id = ?', [normalizedDeadline, tipId]);
    if (randomPopupSchedulerStartedAt) rescheduleRandomPopup();
    notifyDataUpdated('tips');
    syncMarkdownStorageSafe('deadline-set');
    return { ok: true, success: true, tipId, deadline: normalizedDeadline };
  } catch (error) {
    return { ok: false, success: false, error: error.message };
  }
});

ipcMain.handle('deadline-clear', async (event, tipId) => {
  try {
    db.run('UPDATE tips SET deadline = NULL WHERE id = ?', [tipId]);
    if (randomPopupSchedulerStartedAt) rescheduleRandomPopup();
    notifyDataUpdated('tips');
    syncMarkdownStorageSafe('deadline-clear');
    return { ok: true, success: true, tipId, deadline: null };
  } catch (error) {
    return { ok: false, success: false, error: error.message };
  }
});

ipcMain.handle('deadline-get-effective', async (event, tipId) => {
  try {
    const row = db.get(`
      SELECT t.id, t.subcategory_id, t.deadline,
             s.is_sequential AS subcategory_is_sequential,
             s.deadline_mode AS subcategory_deadline_mode,
             s.shared_deadline AS subcategory_shared_deadline,
             (
               SELECT active_tip.id FROM tips active_tip
               WHERE active_tip.subcategory_id = t.subcategory_id
                 AND active_tip.status NOT IN (${SEQUENTIAL_TERMINAL_STATUS_SQL}) AND active_tip.archived_at IS NULL
               ORDER BY COALESCE(active_tip.order_index, 2147483647), active_tip.id LIMIT 1
             ) AS sequential_active_tip_id
      FROM tips t
      LEFT JOIN subcategories s ON s.id = t.subcategory_id
      WHERE t.id = ?
    `, [tipId]);
    if (!row) return { ok: false, success: false, error: 'tip-not-found' };
    const deadlineInfo = getEffectiveDeadlineInfo(row);
    return {
      ok: true,
      success: true,
      tipId,
      deadline: deadlineInfo.effectiveDeadline,
      effectiveDeadline: deadlineInfo.effectiveDeadline,
      source: deadlineInfo.deadlineSource,
      deadlineState: deadlineInfo.deadlineState,
      popupEligible: deadlineInfo.deadlineState !== 'overdue',
      suppressionReason: deadlineInfo.deadlineState === 'overdue' ? 'deadline-expired' : null,
      isSequential: deadlineInfo.isSequential,
      sequentialActiveTipId: deadlineInfo.sequentialActiveTipId,
      isSequentialActiveStep: deadlineInfo.isSequentialActiveStep
    };
  } catch (error) {
    return { ok: false, success: false, error: error.message };
  }
});

// Subcategory handlers
ipcMain.handle('subcategory-list', async (event, categoryId) => {
  try {
    return db.query('SELECT * FROM subcategories WHERE category_id = ? ORDER BY order_index ASC', [categoryId])
      .map(row => ({
        ...row,
        isSequential: Number(row.is_sequential || 0) === 1,
        deadlineMode: row.deadline_mode || null,
        sharedDeadline: row.shared_deadline || null
      }));
  } catch (error) {
    console.error('Error fetching subcategories:', error);
    return [];
  }
});

ipcMain.handle('subcategory-create', async (event, input, legacyName, legacyOrderIndex) => {
  try {
    const params = input && typeof input === 'object'
      ? input
      : { categoryId: input, name: legacyName, orderIndex: legacyOrderIndex };
    const nextOrder = Number.isFinite(Number(params.orderIndex))
      ? Number(params.orderIndex)
      : Number(db.get('SELECT COALESCE(MAX(order_index), -1) + 1 AS next_order FROM subcategories WHERE category_id = ?', [params.categoryId])?.next_order || 0);
    const deadlineMode = params.deadlineMode === 'shared' ? 'shared' : null;
    const sharedDeadline = deadlineMode && params.sharedDeadline ? new Date(params.sharedDeadline).toISOString() : null;
    const result = db.run(`
      INSERT INTO subcategories (category_id, name, order_index, is_sequential, deadline_mode, shared_deadline)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [params.categoryId, params.name, nextOrder, params.isSequential ? 1 : 0, deadlineMode, sharedDeadline]);
    if (randomPopupSchedulerStartedAt) rescheduleRandomPopup();
    notifyDataUpdated('categories');
    syncMarkdownStorageSafe('subcategory-create');
    return { ok: true, success: true, id: result.lastID };
  } catch (error) {
    return { ok: false, success: false, error: error.message };
  }
});

ipcMain.handle('subcategory-update', async (event, input, legacyName) => {
  try {
    const params = input && typeof input === 'object' ? input : { id: input, name: legacyName };
    const deadlineMode = params.deadlineMode === 'shared' ? 'shared' : null;
    const sharedDeadline = deadlineMode && params.sharedDeadline ? new Date(params.sharedDeadline).toISOString() : null;
    db.run(`
      UPDATE subcategories
      SET name = ?, is_sequential = ?, deadline_mode = ?, shared_deadline = ?
      WHERE id = ?
    `, [params.name, params.isSequential ? 1 : 0, deadlineMode, sharedDeadline, params.id]);
    if (randomPopupSchedulerStartedAt) rescheduleRandomPopup();
    notifyDataUpdated('categories');
    syncMarkdownStorageSafe('subcategory-update');
    return { ok: true, success: true };
  } catch (error) {
    return { ok: false, success: false, error: error.message };
  }
});

ipcMain.handle('subcategory-delete', async (event, id) => {
  try {
    db.run('DELETE FROM subcategories WHERE id = ?', [id]);
    db.run('UPDATE tips SET subcategory_id = NULL WHERE subcategory_id = ?', [id]);
    if (randomPopupSchedulerStartedAt) rescheduleRandomPopup();
    ensureGeneralSubcategoriesForAll();
    notifyDataUpdated('categories');
    notifyDataUpdated('tips');
    syncMarkdownStorageSafe('subcategory-delete');
    return { success: true };
  } catch (error) {
    console.error('Error deleting subcategory:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('tip-assign-subcategory', async (event, input) => {
  try {
    const { tipId, subcategoryId, orderIndex = 0 } = input || {};
    db.run('UPDATE tips SET subcategory_id = ?, order_index = ? WHERE id = ?', [subcategoryId || null, Number(orderIndex) || 0, tipId]);
    if (randomPopupSchedulerStartedAt) rescheduleRandomPopup();
    notifyDataUpdated('tips');
    syncMarkdownStorageSafe('tip-assign-subcategory');
    return { ok: true, success: true };
  } catch (error) {
    return { ok: false, success: false, error: error.message };
  }
});

ipcMain.handle('subcategory-reorder-tips', async (event, input) => {
  const { subcategoryId, tipIds = [] } = input || {};
  try {
    db.exec('BEGIN');
    tipIds.forEach((tipId, orderIndex) => {
      db.run('UPDATE tips SET subcategory_id = ?, order_index = ? WHERE id = ?', [subcategoryId, orderIndex, tipId]);
    });
    db.exec('COMMIT');
    if (randomPopupSchedulerStartedAt) rescheduleRandomPopup();
    notifyDataUpdated('tips');
    syncMarkdownStorageSafe('subcategory-reorder-tips');
    return { ok: true, success: true, count: tipIds.length };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    return { ok: false, success: false, error: error.message };
  }
});
