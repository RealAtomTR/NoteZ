const { app, BrowserWindow, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');
const db = require('./db');
const activeWin = require('active-win');

let mainWindow = null;
let tray = null;
let popupWindow = null;
let timerWindow = null;
let titleCheckInterval = null;
let randomPopupInterval = null;
let lastShownTips = new Map(); // Track tips shown in last hour
let audioSettings = null; // Cache audio settings
let currentTipForTimer = null; // Store tip data for timer follow-up
let focusMode = null; // Focus mode state: { categoryId, categoryName, categoryColor } or null

// Initialize database (async)
async function initApp() {
  await db.initialize();
  loadAudioSettings();
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

function createPopupWindow() {
  if (popupWindow) {
    popupWindow.focus();
    return;
  }

  popupWindow = new BrowserWindow({
    width: 400,
    height: 300,
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

  popupWindow.loadFile(path.join(__dirname, '../src/popup.html'));

  popupWindow.on('closed', () => {
    popupWindow = null;
  });
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

function createTray() {
  // Create a simple tray icon (will be replaced with actual icon later)
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);

  updateTrayMenu();
  tray.setToolTip('NoteZ - Popup Reminder System');
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
        if (!mainWindow) createMainWindow();
        mainWindow.show();
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
      if (!mainWindow) createMainWindow();
      mainWindow.show();
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
  // Create a colored tray icon
  if (color) {
    // Create a simple colored icon (16x16 pixels)
    const size = 16;
    const buffer = Buffer.alloc(size * size * 4);
    
    // Fill with the category color
    for (let i = 0; i < buffer.length; i += 4) {
      // Parse hex color to RGB
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      
      buffer[i] = r;     // Red
      buffer[i + 1] = g; // Green
      buffer[i + 2] = b; // Blue
      buffer[i + 3] = 255; // Alpha
    }
    
    const coloredIcon = nativeImage.createFromBuffer(buffer, { width: size, height: size });
    tray.setImage(coloredIcon);
  } else {
    // Reset to empty icon
    const emptyIcon = nativeImage.createEmpty();
    tray.setImage(emptyIcon);
  }
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

    const windowTitle = activeWindow.title.toLowerCase();
    
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

      const triggers = JSON.parse(category.triggers);
      
      // Check if any trigger matches the window title (case-insensitive)
      const match = triggers.some(trigger => 
        windowTitle.includes(trigger.toLowerCase())
      );

      if (match) {
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
      const [winX, winY, winWidth, winHeight] = win.getBounds();
      if (winWidth >= width && winHeight >= height) {
        return true;
      }
    }
  }
  return false;
}

function selectTipFromCategory(categoryId) {
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  
  // Get active tips from this category, excluding those shown in last hour
  const tips = db.query(`
    SELECT t.*, c.name as category_name, c.color as category_color
    FROM tips t
    JOIN categories c ON t.category_id = c.id
    WHERE t.category_id = ? 
      AND t.status = 'active'
      AND (t.last_shown IS NULL OR t.last_shown < ?)
  `, [categoryId, oneHourAgo]);

  if (tips.length === 0) {
    // No active tips available, check for retired tips
    const retiredTips = db.query(`
      SELECT t.*, c.name as category_name, c.color as category_color
      FROM tips t
      JOIN categories c ON t.category_id = c.id
      WHERE t.category_id = ? 
        AND t.status = 'retired'
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

  // Importance-weighted random selection
  // Higher importance = higher chance of being selected
  const totalImportance = tips.reduce((sum, tip) => sum + tip.importance, 0);
  let random = Math.random() * totalImportance;
  
  for (const tip of tips) {
    random -= tip.importance;
    if (random <= 0) {
      return tip;
    }
  }
  
  // Fallback to random if weighting fails
  return tips[Math.floor(Math.random() * tips.length)];
}

function showPopupWithTip(tip, category) {
  // Update tip's show_count and last_shown
  if (!tip.isRetiredCheck) {
    db.run(`
      UPDATE tips 
      SET show_count = show_count + 1, 
          last_shown = ?
      WHERE id = ?
    `, [Date.now(), tip.id]);
  }

  // Create or focus popup window
  if (!popupWindow) {
    createPopupWindow();
  }

  // Send tip data to popup via IPC
  popupWindow.webContents.send('show-tip', {
    category: {
      name: category.name,
      color: category.color
    },
    content: tip.content,
    importance: tip.importance,
    isRetiredCheck: tip.isRetiredCheck || false
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
      AND (t.last_shown IS NULL OR t.last_shown < ?)
  `;
  
  let params = [oneHourAgo];
  
  // If focus mode is active, only select tips from focus category
  if (focusMode) {
    query += ` AND t.category_id = ?`;
    params.push(focusMode.categoryId);
  }
  
  query += ` ORDER BY RANDOM() LIMIT 1`;
  
  const tips = db.query(query, params);

  if (tips.length > 0) {
    const tip = tips[0];
    const category = {
      name: tip.category_name,
      color: tip.category_color
    };

    // Update tip's show_count and last_shown
    db.run(`
      UPDATE tips 
      SET show_count = show_count + 1, 
          last_shown = ?
      WHERE id = ?
    `, [Date.now(), tip.id]);

    showPopupWithTip(tip, category);
  }
}

app.whenReady().then(async () => {
  await initApp();
  createTray();
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
  if (db) {
    db.close();
  }
});

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
  try {
    return db.run(sql, params);
  } catch (error) {
    console.error('Database run error:', error);
    throw error;
  }
});

ipcMain.handle('show-popup', async () => {
  createPopupWindow();
});

ipcMain.handle('close-popup', async () => {
  if (popupWindow) {
    popupWindow.close();
  }
});

ipcMain.handle('show-settings', async () => {
  if (!mainWindow) createMainWindow();
  mainWindow.show();
});

ipcMain.handle('log-dismiss-reason', async (event, tipId, reason) => {
  try {
    return db.run(`
      INSERT INTO dismiss_log (tip_id, reason, dismissed_at)
      VALUES (?, ?, ?)
    `, [tipId, reason, Date.now()]);
  } catch (error) {
    console.error('Error logging dismiss reason:', error);
    throw error;
  }
});

// Audio control IPC handlers
ipcMain.handle('audio-fade-in', async () => {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('audio-fade-in');
  }
});

ipcMain.handle('audio-fade-out', async () => {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('audio-fade-out');
  }
});

ipcMain.handle('audio-stop', async () => {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('audio-stop');
  }
});

ipcMain.handle('audio-set-volume', async (event, volume) => {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('audio-set-volume', volume);
  }
});

// Timer IPC handlers
ipcMain.handle('show-timer', async (event, tipData) => {
  currentTipForTimer = tipData;
  createTimerWindow();
  if (timerWindow) {
    timerWindow.webContents.send('timer-start');
  }
});

ipcMain.handle('timer-ended', async () => {
  // Close timer window
  if (timerWindow) {
    timerWindow.close();
  }
  
  // Show follow-up popup asking "Devam ettin mi?"
  if (currentTipForTimer) {
    showFollowUpPopup(currentTipForTimer);
  }
});

ipcMain.handle('close-timer', async () => {
  if (timerWindow) {
    timerWindow.close();
  }
});

// Focus Mode IPC handlers
ipcMain.handle('get-focus-mode', async () => {
  return focusMode;
});

ipcMain.handle('activate-focus-mode', async (event, categoryId, categoryName, categoryColor) => {
  activateFocusMode(categoryId, categoryName, categoryColor);
  return focusMode;
});

ipcMain.handle('deactivate-focus-mode', async () => {
  deactivateFocusMode();
  return null;
});

// Follow-up popup for timer end
function showFollowUpPopup(tipData) {
  if (!popupWindow) {
    createPopupWindow();
  }
  
  // Send follow-up data to popup
  popupWindow.webContents.send('show-follow-up', tipData);
  popupWindow.show();
}
