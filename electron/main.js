const { app, BrowserWindow, Tray, Menu, nativeImage, screen, dialog, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const activeWin = require('active-win');
const markdownStorage = require('./markdown-storage');

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
let debugPopupInterval = null;
let debugPopupCount = 0;
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
  try {
    const settings = db.query(`SELECT key, value FROM settings`);
    audioSettings = {};
    settings.forEach(setting => {
      audioSettings[setting.key] = setting.value;
    });
  } catch (error) {
    console.error('Error loading audio settings:', error);
    audioSettings = {};
  }
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
  return {
    id: tip.id,
    categoryId: tip.category_id,
    categoryName: tip.category_name,
    content: tip.content,
    importance: tip.importance,
    status: tip.status,
    deadline: tip.deadline || null,
    tipTrackingApp: tip.tip_tracking_app || null,
    score: tip.score !== undefined ? tip.score : calculateTipScore(tip)
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

  return {
    ...popupDebugState,
    activePopupKey,
    queueLength: popupQueue.length,
    queuedItems,
    trackedApplication: popupDebugState.lastTrackedMatch || popupDebugState.activeWindow,
    nextPopup,
    triggerTime,
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
  maxPopupsPerHour: 3,
  minimumPopupIntervalMinutes: 15,
  sameTaskCooldownMinutes: 45,
  quietHoursEnabled: false,
  quietHoursStart: '00:00',
  quietHoursEnd: '10:00'
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
    quietHoursEnd: (db.get('SELECT value FROM settings WHERE key = ?', ['notification_quiet_hours_end']) || {}).value || DEFAULT_NOTIFICATION_BUDGET.quietHoursEnd
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

  if (tip.deadline) {
    const deadlineTime = new Date(tip.deadline).getTime();
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
  const sqlUpper = String(sql || '').toUpperCase();
  if (!sqlUpper.includes('UPDATE TIPS') || !sqlUpper.includes('STATUS')) return null;

  let tipId = null;
  const statusParamIndex = params.findIndex(value => String(value).toLowerCase() === 'done');
  if (statusParamIndex !== -1) {
    tipId = params[statusParamIndex + 1] || params[params.length - 1];
  } else if (sqlUpper.includes("STATUS = 'DONE'") || sqlUpper.includes('STATUS = "DONE"')) {
    tipId = params[params.length - 1];
  }

  return tipId || null;
}

function markCompletionTimestampIfNeeded(sql, params = [], recurringRescheduled = false) {
  if (recurringRescheduled) return false;

  const tipId = getCompletedStatusTipId(sql, params);
  if (!tipId) return false;

  db.run('UPDATE tips SET last_completed_at = ? WHERE id = ?', [new Date().toISOString(), tipId]);
  return true;
}

function canShowPopupForTip(tip) {
  if (!tip || tip.isRetiredCheck) return true;
  const budget = getNotificationBudget();
  const now = Date.now();
  const importance = Number(tip.importance || 1);

  if (importance < 9 && (isFullscreenActive() || isGameModeActive())) {
    updatePopupDebugState({ lastSuppression: { reason: 'fullscreen-or-game-mode', tip: summarizeTipForDebug(tip) } });
    return false;
  }

  if (importance < 10 && isQuietHoursActive(budget)) {
    updatePopupDebugState({ lastSuppression: { reason: 'quiet-hours', tip: summarizeTipForDebug(tip) } });
    return false;
  }

  if (tip.last_shown && now - Number(tip.last_shown) < budget.sameTaskCooldownMinutes * 60 * 1000) {
    updatePopupDebugState({ lastSuppression: { reason: 'same-task-cooldown', tip: summarizeTipForDebug(tip) } });
    return false;
  }

  const lastPopup = db.get(`
    SELECT MAX(last_shown) as last_shown
    FROM tips
    WHERE last_shown IS NOT NULL AND archived_at IS NULL
  `);
  if (importance < 10 && lastPopup?.last_shown && now - Number(lastPopup.last_shown) < budget.minimumPopupIntervalMinutes * 60 * 1000) {
    updatePopupDebugState({ lastSuppression: { reason: 'minimum-popup-interval', tip: summarizeTipForDebug(tip) } });
    return false;
  }

  const recent = db.get(`
    SELECT COUNT(*) as count
    FROM tips
    WHERE last_shown IS NOT NULL AND archived_at IS NULL AND last_shown >= ?
  `, [now - 60 * 60 * 1000]);
  if (importance < 10 && recent && recent.count >= budget.maxPopupsPerHour) {
    updatePopupDebugState({ lastSuppression: { reason: 'max-popups-per-hour', tip: summarizeTipForDebug(tip), recentCount: recent.count } });
    return false;
  }

  return true;
}

function selectTipFromCategory(categoryId) {
  const budget = getNotificationBudget();
  const cooldownAgo = Date.now() - (budget.sameTaskCooldownMinutes * 60 * 1000);

  // Get active tips from this category, excluding recently shown or snoozed notes.
  const tips = db.query(`
    SELECT t.*, c.name as category_name, c.color as category_color
    FROM tips t
    JOIN categories c ON t.category_id = c.id
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

    if (retiredTips.length === 0) {
      return null;
    }

    // Return a retired tip with "Hâlâ yapıyor musun?" message
    const retiredTip = retiredTips[Math.floor(Math.random() * retiredTips.length)];
    return {
      ...retiredTip,
      content: `Hâlâ "${retiredTip.category_name}" konusuyla ilgileniyor musun?`,
      isRetiredCheck: true
    };
  }

  const scoredTips = tips
    .map(tip => ({ ...tip, score: calculateTipScore(tip) }))
    .sort((a, b) => b.score - a.score);
  const selectedTip = scoredTips[0];

  updatePopupDebugState({
    lastScoring: {
      source: 'category-title-match',
      categoryId,
      candidateCount: scoredTips.length,
      selected: summarizeTipForDebug(selectedTip),
      candidates: scoredTips.slice(0, 10).map(summarizeTipForDebug),
      scoredAt: new Date().toISOString()
    }
  });

  return selectedTip;
}

function showPopupWithTip(tip, category) {
  if (!canShowPopupForTip(tip)) {
    console.log('[NotificationBudget] Popup suppressed by budget rules', { tipId: tip && tip.id });
    return false;
  }

  const tipData = {
    id: tip.id,
    tipId: tip.id,
    category: {
      name: category.name,
      color: category.color
    },
    content: tip.content,
    importance: tip.importance,
    isRetiredCheck: tip.isRetiredCheck || false
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
  scheduleRandomPopup();
}

function scheduleRandomPopup() {
  // Random interval between 30-90 minutes (15-45 minutes if focus mode is active)
  const minInterval = focusMode ? 15 * 60 * 1000 : 30 * 60 * 1000;
  const maxInterval = focusMode ? 45 * 60 * 1000 : 90 * 60 * 1000;
  const randomInterval = Math.floor(Math.random() * (maxInterval - minInterval + 1)) + minInterval;
  updatePopupDebugState({
    nextTrigger: {
      randomPopupAt: new Date(Date.now() + randomInterval).toISOString(),
      randomIntervalMs: randomInterval,
      titleCheckIntervalMs: focusMode ? 2500 : 5000,
      focusMode: focusMode ? { categoryId: focusMode.categoryId, categoryName: focusMode.categoryName } : null
    }
  });

  randomPopupInterval = setTimeout(() => {
    // Check if fullscreen is active before showing
    if (!isFullscreenActive()) {
      showRandomPopup();
    }
    // Schedule next popup
    scheduleRandomPopup();
  }, randomInterval);
}

function showRandomPopup() {
  // Get any active tip that hasn't been shown in the last hour
  const oneHourAgo = Date.now() - (60 * 60 * 1000);

  let query = `
    SELECT t.*, c.name as category_name, c.color as category_color
    FROM tips t
    JOIN categories c ON t.category_id = c.id
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

  query += ` ORDER BY RANDOM() LIMIT 1`;

  const tips = db.query(query, params);

  if (tips.length > 0) {
    const tip = { ...tips[0], score: calculateTipScore(tips[0]) };
    updatePopupDebugState({
      lastScoring: {
        source: 'random-popup',
        candidateCount: tips.length,
        selected: summarizeTipForDebug(tip),
        candidates: [summarizeTipForDebug(tip)],
        scoredAt: new Date().toISOString()
      }
    });
    const category = {
      name: tip.category_name,
      color: tip.category_color
    };

    showPopupWithTip(tip, category);
  }
}

app.whenReady().then(async () => {
  await initApp();
  createTray();
  showCheckinWindowIfNeeded();
  const quickCaptureRegistered = globalShortcut.register('Control+Alt+N', showQuickCaptureWindow);
  console.log(`[QuickCapture] Ctrl+Alt+N shortcut ${quickCaptureRegistered ? 'registered' : 'could not be registered'}`);
  startWindowTitleTracking();
  startRandomPopupTracking();

  // Fade in background music if configured
  if (audioSettings && audioSettings.background_music && mainWindow) {
    // Wait for settings window to be ready, then trigger fade in
    setTimeout(() => {
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('audio-fade-in');
      }
    }, 1000);
  }

  // Don't create main window initially, app lives in tray
});

app.on('window-all-closed', () => {
  // Don't quit on Windows when all windows are closed
  // App lives in system tray
});

app.on('before-quit', () => {
  // Fade out background music before quit
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('audio-fade-out');
  }

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

ipcMain.handle('db-run', async (event, sql, params) => {
  console.log('DEBUG: main.js db-run handler called', { sql, params });
  try {
    const result = db.run(sql, params);
    console.log('DEBUG: main.js db-run result', result);
    const recurringRescheduled = maybeApplyRecurringCompletion(sql, params);
    const completionTimestamped = markCompletionTimestampIfNeeded(sql, params, recurringRescheduled);

    // Check if it's a mutation and notify data updated
    const sqlUpper = sql.toUpperCase();
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
      notifyDataUpdated('tips', recurringRescheduled || completionTimestamped
        ? { recurringRescheduled, completionTimestamped }
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
  if (importance === 9) return 1;
  return 0; // importance 10
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
    const tip = db.get('SELECT importance FROM tips WHERE id = ?', [tipId]);
    if (!tip) return { canSnooze: false, remaining: 0 };

    const limit = getDailySnoozeLimit(tip.importance);
    if (limit === Infinity) return { canSnooze: true, remaining: Infinity };
    if (limit === 0) return { canSnooze: false, remaining: 0 };

    const count = await getTodaySnoozeCount(tipId);
    const remaining = Math.max(0, limit - count);
    return { canSnooze: remaining > 0, remaining };
  } catch (error) {
    console.error('Error in snooze-check:', error);
    return { canSnooze: false, remaining: 0 };
  }
});

ipcMain.handle('snooze-apply', async (event, tipId, reason) => {
  try {
    // reason: not_today, no_motivation, remind_1h, not_now
    let durationHours = 0;
    if (reason === 'not_today' || reason === 'no_motivation') durationHours = 24;
    else if (reason === 'remind_1h') durationHours = 1;
    else if (reason === 'not_now') durationHours = 2;
    else if (reason === 'task_too_big' || reason === 'unclear') durationHours = 24;

    const snoozedUntil = new Date(Date.now() + durationHours * 3600000).toISOString();

    db.exec('BEGIN TRANSACTION');

    db.run('UPDATE tips SET snoozed_until = ? WHERE id = ?', [snoozedUntil, tipId]);
    db.run(
      `INSERT INTO dismiss_log (tip_id, reason, dismissed_at) VALUES (?, ?, ?)`,
      [tipId, reason, Date.now()]
    );

    if (reason === 'no_motivation') {
      db.run('UPDATE tips SET importance = MIN(importance + 1, 10) WHERE id = ?', [tipId]);
    }

    const problemReasons = ['not_today', 'no_motivation', 'not_now', 'task_too_big', 'unclear'];
    if (problemReasons.includes(reason)) {
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
    notifyDataUpdated('tips');
    syncMarkdownStorageSafe('snooze-apply');
    return { success: true };
  } catch (error) {
    db.exec('ROLLBACK');
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
      enqueuePopup({
        channel: 'show-tip',
        data: tipData,
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
  try {
    if (!audioSettings) loadAudioSettings();
    return audioSettings || {};
  } catch (error) {
    console.error('Error in get-audio-settings:', error);
    return {};
  }
});

// Audio control IPC handlers
ipcMain.handle('audio-fade-in', async () => {
  try {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('audio-fade-in');
    }
    return { success: true };
  } catch (error) {
    console.error('Error in audio-fade-in:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('audio-fade-out', async () => {
  try {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('audio-fade-out');
    }
    return { success: true };
  } catch (error) {
    console.error('Error in audio-fade-out:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('audio-stop', async () => {
  try {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('audio-stop');
    }
    return { success: true };
  } catch (error) {
    console.error('Error in audio-stop:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('audio-set-volume', async (event, volume) => {
  try {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('audio-set-volume', volume);
    }
    return { success: true };
  } catch (error) {
    console.error('Error in audio-set-volume:', error);
    return { success: false, error: error.message };
  }
});

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
        showRandomPopup();
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
       WHERE reason IN ('not_today','remind_1h','no_motivation','not_now','too_big','unclear')
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

// Subcategory handlers
ipcMain.handle('subcategory-list', async (event, categoryId) => {
  try {
    return db.query('SELECT * FROM subcategories WHERE category_id = ? ORDER BY order_index ASC', [categoryId]);
  } catch (error) {
    console.error('Error fetching subcategories:', error);
    return [];
  }
});

ipcMain.handle('subcategory-create', async (event, categoryId, name, orderIndex) => {
  try {
    db.run('INSERT INTO subcategories (category_id, name, order_index) VALUES (?, ?, ?)', [categoryId, name, orderIndex]);
    notifyDataUpdated('categories');
    syncMarkdownStorageSafe('subcategory-create');
    return { success: true };
  } catch (error) {
    console.error('Error creating subcategory:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('subcategory-update', async (event, id, name) => {
  try {
    db.run('UPDATE subcategories SET name = ? WHERE id = ?', [name, id]);
    notifyDataUpdated('categories');
    syncMarkdownStorageSafe('subcategory-update');
    return { success: true };
  } catch (error) {
    console.error('Error updating subcategory:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('subcategory-delete', async (event, id) => {
  try {
    db.run('DELETE FROM subcategories WHERE id = ?', [id]);
    db.run('UPDATE tips SET subcategory_id = NULL WHERE subcategory_id = ?', [id]);
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
