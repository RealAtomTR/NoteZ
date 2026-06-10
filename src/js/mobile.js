// Mobile App - Capacitor Android
const { LocalNotifications } = require('@capacitor/local-notifications');
const { Capacitor } = require('@capacitor/core');

// Database (SQLite for mobile - using sql.js)
const SQL = require('sql.js');
let db = null;
let SQLInstance = null;

// App State
let notificationSettings = {
  dailyCount: 5,
  timeWindowStart: '09:00',
  timeWindowEnd: '22:00'
};

let scheduledNotifications = [];

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await initializeDatabase();
  await loadNotificationSettings();
  await initializeNotifications();
  setupEventListeners();
  checkDailyCheckin();
});

// Initialize SQLite Database
async function initializeDatabase() {
  try {
    SQLInstance = await SQL();
    
    // Check if database exists in localStorage
    const dbData = localStorage.getItem('notez_mobile_db');
    
    if (dbData) {
      db = new SQLInstance.Database(new Uint8Array(JSON.parse(dbData)));
    } else {
      db = new SQLInstance.Database();
      createTables();
      saveDatabase();
    }
    
    console.log('Mobile database initialized');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}

function createTables() {
  // Categories table
  db.run(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      triggers TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  // Tips table
  db.run(`
    CREATE TABLE IF NOT EXISTS tips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      importance INTEGER NOT NULL CHECK(importance >= 1 AND importance <= 10),
      show_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'retired', 'done')),
      last_shown INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    )
  `);

  // Dismiss log table
  db.run(`
    CREATE TABLE IF NOT EXISTS dismiss_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tip_id INTEGER NOT NULL,
      reason TEXT CHECK(reason IN ('no_time', 'dont_know_how', 'no_motivation', 'not_now') OR reason IS NULL),
      dismissed_at INTEGER NOT NULL,
      FOREIGN KEY (tip_id) REFERENCES tips(id) ON DELETE CASCADE
    )
  `);

  // Checkins table
  db.run(`
    CREATE TABLE IF NOT EXISTS checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE CHECK(date = strftime('%Y-%m-%d', date)),
      completed INTEGER DEFAULT 0 CHECK(completed IN (0, 1)),
      streak INTEGER DEFAULT 0
    )
  `);

  // Settings table
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Insert sample data if empty
  const categories = db.query(`SELECT COUNT(*) as count FROM categories`);
  if (categories[0].count === 0) {
    insertSampleData();
  }

  console.log('Mobile database tables created');
}

function insertSampleData() {
  // Insert sample categories
  db.run(`INSERT INTO categories (name, color, triggers, created_at) VALUES (?, ?, ?, ?)`,
    ['Yapay Zeka', '#6C63FF', JSON.stringify(['Claude', 'ChatGPT', 'Gemini']), Date.now()]);
  
  db.run(`INSERT INTO categories (name, color, triggers, created_at) VALUES (?, ?, ?, ?)`,
    ['Programlama', '#00D9FF', JSON.stringify(['VS Code', 'IntelliJ', 'PyCharm']), Date.now()]);
  
  db.run(`INSERT INTO categories (name, color, triggers, created_at) VALUES (?, ?, ?, ?)`,
    ['Spor', '#00FF88', JSON.stringify(['Gym', 'Fitness', 'Workout']), Date.now()]);

  // Insert sample tips
  db.run(`INSERT INTO tips (category_id, content, importance, show_count, status, last_shown, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [1, 'Bugün AI konularında en az 30 dakika çalış.', 7, 0, 'active', null, Date.now()]);
  
  db.run(`INSERT INTO tips (category_id, content, importance, show_count, status, last_shown, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [2, 'Kod yazma pratiği yap - en az 100 satır.', 8, 0, 'active', null, Date.now()]);
  
  db.run(`INSERT INTO tips (category_id, content, importance, show_count, status, last_shown, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [3, 'Bugün spor yap - en az 30 dakika.', 9, 0, 'active', null, Date.now()]);

  saveDatabase();
}

function saveDatabase() {
  const data = db.export();
  const buffer = new Uint8Array(data);
  localStorage.setItem('notez_mobile_db', JSON.stringify(Array.from(buffer)));
}

// Local Notifications
async function initializeNotifications() {
  try {
    const permission = await LocalNotifications.requestPermissions();
    if (permission.display === 'granted') {
      console.log('Notification permission granted');
      await scheduleDailyNotifications();
    } else {
      console.log('Notification permission denied');
    }
  } catch (error) {
    console.error('Error initializing notifications:', error);
  }
}

async function scheduleDailyNotifications() {
  try {
    // Cancel existing notifications
    await LocalNotifications.cancel();
    scheduledNotifications = [];

    const count = notificationSettings.dailyCount;
    const startTime = parseTime(notificationSettings.timeWindowStart);
    const endTime = parseTime(notificationSettings.timeWindowEnd);
    const windowDuration = endTime - startTime;
    const interval = windowDuration / (count + 1);

    for (let i = 1; i <= count; i++) {
      const notificationTime = startTime + (interval * i);
      const schedule = {
        id: i,
        title: 'NoteZ Hatırlatma',
        body: 'Zaman ayırdığın konulara bir göz at!',
        schedule: {
          at: new Date(new Date().setHours(notificationTime.hours, notificationTime.minutes, 0, 0)),
          repeats: true,
          every: 'day'
        },
        sound: 'default',
        smallIcon: 'ic_stat_icon_config_sample',
        largeIcon: 'ic_launcher'
      };

      await LocalNotifications.schedule(schedule);
      scheduledNotifications.push(schedule);
    }

    console.log(`Scheduled ${count} daily notifications`);
  } catch (error) {
    console.error('Error scheduling notifications:', error);
  }
}

function parseTime(timeString) {
  const [hours, minutes] = timeString.split(':').map(Number);
  return { hours, minutes };
}

// Load notification settings from database
async function loadNotificationSettings() {
  try {
    const settings = db.query(`SELECT key, value FROM settings WHERE key LIKE 'notification_%'`);
    
    settings.forEach(setting => {
      if (setting.key === 'notification_daily_count') {
        notificationSettings.dailyCount = parseInt(setting.value);
      } else if (setting.key === 'notification_time_start') {
        notificationSettings.timeWindowStart = setting.value;
      } else if (setting.key === 'notification_time_end') {
        notificationSettings.timeWindowEnd = setting.value;
      }
    });

    // Update UI
    document.getElementById('daily-count').value = notificationSettings.dailyCount;
    document.getElementById('time-window-start').value = notificationSettings.timeWindowStart;
    document.getElementById('time-window-end').value = notificationSettings.timeWindowEnd;
  } catch (error) {
    console.error('Error loading notification settings:', error);
  }
}

// Save notification settings to database
async function saveNotificationSettings() {
  try {
    const dailyCount = document.getElementById('daily-count').value;
    const timeStart = document.getElementById('time-window-start').value;
    const timeEnd = document.getElementById('time-window-end').value;

    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`,
      ['notification_daily_count', dailyCount]);
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`,
      ['notification_time_start', timeStart]);
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`,
      ['notification_time_end', timeEnd]);

    notificationSettings.dailyCount = parseInt(dailyCount);
    notificationSettings.timeWindowStart = timeStart;
    notificationSettings.timeWindowEnd = timeEnd;

    saveDatabase();
    await scheduleDailyNotifications();

    alert('Ayarlar kaydedildi!');
  } catch (error) {
    console.error('Error saving notification settings:', error);
    alert('Ayarlar kaydedilirken hata oluştu.');
  }
}

// Check-in System
function checkDailyCheckin() {
  const today = new Date().toISOString().split('T')[0];
  const checkin = db.query(`SELECT * FROM checkins WHERE date = ?`, [today]);

  if (checkin.length === 0) {
    // No checkin for today, show checkin button
    document.getElementById('checkin-btn').style.display = 'block';
  } else {
    // Already checked in today
    document.getElementById('checkin-btn').style.display = 'none';
  }
}

async function handleCheckin(completed) {
  const today = new Date().toISOString().split('T')[0];
  
  try {
    // Get current streak
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const yesterdayCheckin = db.query(`SELECT * FROM checkins WHERE date = ?`, [yesterday]);
    
    let streak = 0;
    if (yesterdayCheckin.length > 0 && yesterdayCheckin[0].completed === 1) {
      streak = yesterdayCheckin[0].streak;
    }

    if (completed) {
      streak += 1;
      
      // Insert/update checkin
      db.run(`INSERT OR REPLACE INTO checkins (date, completed, streak) VALUES (?, ?, ?)`,
        [today, 1, streak]);
      
      saveDatabase();
      
      // Show reward message
      const rewardDiv = document.getElementById('checkin-reward');
      rewardDiv.textContent = `Tebrikler! Bugün popuplar %20 daha az agresif. Seri: ${streak} gün`;
      rewardDiv.style.display = 'block';
      
      // Apply importance offset for the day
      localStorage.setItem('importance_offset', '-2');
    } else {
      streak = 0;
      
      // Insert/update checkin
      db.run(`INSERT OR REPLACE INTO checkins (date, completed, streak) VALUES (?, ?, ?)`,
        [today, 0, streak]);
      
      saveDatabase();
      
      document.getElementById('checkin-reward').style.display = 'none';
    }

    // Update streak display
    document.getElementById('streak-count').textContent = streak;
    
    // Hide checkin button
    document.getElementById('checkin-btn').style.display = 'none';
    
    // Go back to main view
    showMainView();
  } catch (error) {
    console.error('Error handling checkin:', error);
  }
}

function updateStreakDisplay() {
  const today = new Date().toISOString().split('T')[0];
  const checkin = db.query(`SELECT * FROM checkins WHERE date = ?`, [today]);
  
  if (checkin.length > 0) {
    document.getElementById('streak-count').textContent = checkin[0].streak;
  } else {
    document.getElementById('streak-count').textContent = '0';
  }
}

// View Management
function showMainView() {
  document.getElementById('main-view').style.display = 'flex';
  document.getElementById('settings-view').style.display = 'none';
  document.getElementById('checkin-view').style.display = 'none';
}

function showSettingsView() {
  document.getElementById('main-view').style.display = 'none';
  document.getElementById('settings-view').style.display = 'block';
  document.getElementById('checkin-view').style.display = 'none';
}

function showCheckinView() {
  document.getElementById('main-view').style.display = 'none';
  document.getElementById('settings-view').style.display = 'none';
  document.getElementById('checkin-view').style.display = 'block';
  updateStreakDisplay();
}

// Show Popup (reusing dismiss level system from popup.js)
function showPopup() {
  // Get a random tip
  const tips = db.query(`
    SELECT t.*, c.name as category_name, c.color as category_color
    FROM tips t
    JOIN categories c ON t.category_id = c.id
    WHERE t.status = 'active'
    ORDER BY RANDOM()
    LIMIT 1
  `);

  if (tips.length > 0) {
    const tip = tips[0];
    
    // Apply importance offset if any
    let importance = tip.importance;
    const offset = localStorage.getItem('importance_offset');
    if (offset) {
      importance = Math.max(1, importance + parseInt(offset));
    }

    // Show alert with tip (simplified for mobile)
    alert(`[${tip.category_name}] ${tip.content}\n\nÖnem: ${importance}/10`);
    
    // Update show count
    db.run(`UPDATE tips SET show_count = show_count + 1, last_shown = ? WHERE id = ?`,
      [Date.now(), tip.id]);
    saveDatabase();
  } else {
    alert('Henüz aktif tip yok.');
  }
}

// Event Listeners
function setupEventListeners() {
  document.getElementById('show-popup-btn').addEventListener('click', showPopup);
  document.getElementById('settings-btn').addEventListener('click', showSettingsView);
  document.getElementById('checkin-btn').addEventListener('click', showCheckinView);
  
  document.getElementById('save-settings-btn').addEventListener('click', saveNotificationSettings);
  document.getElementById('back-btn').addEventListener('click', showMainView);
  
  document.getElementById('checkin-yes-btn').addEventListener('click', () => handleCheckin(true));
  document.getElementById('checkin-no-btn').addEventListener('click', () => handleCheckin(false));
  document.getElementById('checkin-back-btn').addEventListener('click', showMainView);
}
