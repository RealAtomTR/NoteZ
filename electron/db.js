const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let db = null;
let SQL = null;
let inTransaction = false;

function getDatabasePath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'notez.db');
}

async function initialize() {
  SQL = await initSqlJs();
  const dbPath = getDatabasePath();

  // Load existing database or create new one
  try {
    if (fs.existsSync(dbPath)) {
      const fileBuffer = fs.readFileSync(dbPath);
      db = new SQL.Database(fileBuffer);
      createTables();
      runMigrations(); // incremental schema changes
      saveDatabase();
    } else {
      db = new SQL.Database();
      createTables();
      runMigrations();
      saveDatabase();
    }
  } catch (error) {
    console.error('Critical Error during database initialization/migrations:', error);
    // Allow process to continue even if db initialization partially fails
  }

  console.log('Database initialized at:', dbPath);
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
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'retired', 'done', 'cancelled')),
      last_shown INTEGER,
      archived_at TEXT DEFAULT NULL,
      recurring_type TEXT DEFAULT 'none',
      recurring_interval INTEGER DEFAULT 1,
      recurring_days TEXT DEFAULT NULL,
      next_due_at TEXT DEFAULT NULL,
      last_completed_at TEXT DEFAULT NULL,
      needs_review INTEGER DEFAULT 0,
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

  // Sessions table (for Focus/Hot Mode)
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    )
  `);

  // Checkins table (for Android)
  db.run(`
    CREATE TABLE IF NOT EXISTS checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE CHECK(date = strftime('%Y-%m-%d', date)),
      completed INTEGER DEFAULT 0 CHECK(completed IN (0, 1)),
      streak INTEGER DEFAULT 0
    )
  `);

  // Subcategories table (alt kategoriler + adım sistemi)
  db.run(`
    CREATE TABLE IF NOT EXISTS subcategories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      order_index INTEGER DEFAULT 0,
      is_sequential INTEGER DEFAULT 0,
      deadline_mode TEXT DEFAULT NULL,
      shared_deadline TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Settings table (for audio and other app settings)
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  console.log('[DB] All tables created/verified');
}

// Run incremental migrations — idempotent, safe to call on every start
function runMigrations() {
  // Migration 001: deadline column on tips
  try {
    db.exec(`ALTER TABLE tips ADD COLUMN deadline TEXT DEFAULT NULL`);
    console.log('[DB] Migration 001: deadline column added to tips');
  } catch (e) {
    if (e.message && e.message.includes('duplicate column name')) {
      console.log('[DB] Migration 001: deadline column already exists, skipping');
    } else {
      console.error('[DB] Migration 001 FAILED:', e.message);
    }
  }

  // Migration 002: snoozed_until column on tips
  try {
    db.exec(`ALTER TABLE tips ADD COLUMN snoozed_until TEXT DEFAULT NULL`);
    console.log('[DB] Migration 002: snoozed_until column added to tips');
  } catch (e) {
    if (e.message && e.message.includes('duplicate column name')) {
      console.log('[DB] Migration 002: snoozed_until already exists, skipping');
    } else {
      console.error('[DB] Migration 002 FAILED:', e.message);
    }
  }

  // Migration 003: rebuild dismiss_log with extended reason constraint
  // Adds new reason values while keeping old ones (no_time, dont_know_how)
  // Data is preserved via INSERT INTO ... SELECT
  try {
    const tableExists = db.exec(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='dismiss_log_new'`
    );
    // Only rebuild if the new table doesn't already exist (idempotency guard)
    db.exec(`
      CREATE TABLE IF NOT EXISTS dismiss_log_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tip_id INTEGER NOT NULL,
          reason TEXT CHECK(
          reason IN ('no_time','dont_know_how','no_motivation','not_now',
                     'not_today','remind_1h','task_too_big','unclear')
          OR reason IS NULL
        ),
        dismissed_at INTEGER NOT NULL,
        FOREIGN KEY (tip_id) REFERENCES tips(id) ON DELETE CASCADE
      )
    `);
    // Copy existing data (old reason values kept as-is)
    db.exec(`INSERT OR IGNORE INTO dismiss_log_new SELECT * FROM dismiss_log`);
    db.exec(`DROP TABLE dismiss_log`);
    db.exec(`ALTER TABLE dismiss_log_new RENAME TO dismiss_log`);
    console.log('[DB] Migration 003: dismiss_log rebuilt with extended reason constraint');
  } catch (e) {
    // If dismiss_log_new still exists from a failed run, clean up
    if (e.message && e.message.includes('already exists')) {
      console.log('[DB] Migration 003: dismiss_log already has new schema, skipping');
    } else {
      console.error('[DB] Migration 003 FAILED:', e.message);
    }
  }

  // Migration 004: prerequisite_tip_id column on tips (chain system)
  try {
    db.exec(`ALTER TABLE tips ADD COLUMN prerequisite_tip_id INTEGER DEFAULT NULL`);
    console.log('[DB] Migration 004: prerequisite_tip_id column added to tips');
  } catch (e) {
    if (e.message && e.message.includes('duplicate column name')) {
      console.log('[DB] Migration 004: prerequisite_tip_id already exists, skipping');
    } else {
      console.error('[DB] Migration 004 FAILED:', e.message);
    }
  }

  // Migration 005: categories.triggers format upgrade
  // Old: ["keyword1", "keyword2"]  →  New: {"apps":[], "keywords":["keyword1","keyword2"]}
  try {
    const cats = query(`SELECT id, triggers FROM categories`);
    let migrated = 0;
    for (const cat of cats) {
      let parsed;
      try { parsed = JSON.parse(cat.triggers || '[]'); } catch { parsed = []; }
      if (Array.isArray(parsed)) {
        // Still old format — convert to new object format
        const newFormat = JSON.stringify({ apps: [], keywords: parsed });
        run(`UPDATE categories SET triggers = ? WHERE id = ?`, [newFormat, cat.id]);
        migrated++;
      }
      // If already object format (has apps/keywords keys), skip
    }
    if (migrated > 0) {
      console.log(`[DB] Migration 005: converted ${migrated} category triggers to {apps,keywords} format`);
    } else {
      console.log('[DB] Migration 005: all categories already in new triggers format, skipping');
    }
  } catch (e) {
    console.error('[DB] Migration 005 FAILED:', e.message);
  }

  // Migration 006: tip_tracking_app column on tips (individual note app trigger)
  // Logic deferred — UI Agent will wire the note modal; column ready in DB
  try {
    db.exec(`ALTER TABLE tips ADD COLUMN tip_tracking_app TEXT DEFAULT NULL`);
    console.log('[DB] Migration 006: tip_tracking_app column added to tips');
  } catch (e) {
    if (e.message && e.message.includes('duplicate column name')) {
      console.log('[DB] Migration 006: tip_tracking_app already exists, skipping');
    } else {
      console.error('[DB] Migration 006 FAILED:', e.message);
    }
  }

  // Migration 007a: subcategory_id column on tips
  try {
    db.exec(`ALTER TABLE tips ADD COLUMN subcategory_id INTEGER DEFAULT NULL`);
    console.log('[DB] Migration 007a: subcategory_id column added to tips');
  } catch (e) {
    if (e.message && e.message.includes('duplicate column name')) {
      console.log('[DB] Migration 007a: subcategory_id already exists, skipping');
    } else {
      console.error('[DB] Migration 007a FAILED:', e.message);
    }
  }

  // Migration 007b: order_index column on tips (position within sequential subcategory)
  try {
    db.exec(`ALTER TABLE tips ADD COLUMN order_index INTEGER DEFAULT 0`);
    console.log('[DB] Migration 007b: order_index column added to tips');
  } catch (e) {
    if (e.message && e.message.includes('duplicate column name')) {
      console.log('[DB] Migration 007b: order_index already exists, skipping');
    } else {
      console.error('[DB] Migration 007b FAILED:', e.message);
    }
  }



  // Migration 008: Create default 'Genel' subcategory — DISABLED
  // Auto-creation of 'Genel' subcategory is removed. Subcategories are now
  // created only when the user explicitly adds one.
  try {
    console.log('[DB] Migration 008: auto-Genel creation disabled, skipping');
  } catch (e) {
    console.error('[DB] Migration 008 FAILED:', e.message);
  }

  // Migration 009: deadline_mode column on subcategories
  try {
    db.exec(`ALTER TABLE subcategories ADD COLUMN deadline_mode TEXT DEFAULT NULL`);
    console.log('[DB] Migration 009: deadline_mode column added to subcategories');
  } catch (e) {
    if (e.message && e.message.includes('duplicate column name')) {
      console.log('[DB] Migration 009: deadline_mode already exists, skipping');
    } else {
      console.error('[DB] Migration 009 FAILED:', e.message);
    }
  }

  // Migration 010: shared_deadline column on subcategories
  try {
    db.exec(`ALTER TABLE subcategories ADD COLUMN shared_deadline TEXT DEFAULT NULL`);
    console.log('[DB] Migration 010: shared_deadline column added to subcategories');
  } catch (e) {
    if (e.message && e.message.includes('duplicate column name')) {
      console.log('[DB] Migration 010: shared_deadline already exists, skipping');
    } else {
      console.error('[DB] Migration 010 FAILED:', e.message);
    }
  }

  // Migration 011: Remove background music settings
  try {
    const changes = db.run(`DELETE FROM settings WHERE key IN ('background_music', 'music_volume')`);
    console.log('[DB] Migration 011: Removed background music settings');
  } catch (e) {
    console.error('[DB] Migration 011 FAILED:', e.message);
  }

  // Migration 012: update tips status constraint to include 'cancelled'
  try {
    const tableSqlResult = db.exec(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='tips'`
    );
    const tableSql = tableSqlResult?.[0]?.values?.[0]?.[0] || '';
    if (!tableSql.includes("'cancelled'")) {
      const columns = query(`PRAGMA table_info(tips)`).map(col => col.name);
      const hasFocusDuration = columns.includes('focus_duration');

      db.exec('BEGIN TRANSACTION');

      db.exec(`
        CREATE TABLE IF NOT EXISTS tips_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category_id INTEGER NOT NULL,
          content TEXT NOT NULL,
          importance INTEGER NOT NULL CHECK(importance >= 1 AND importance <= 10),
          show_count INTEGER DEFAULT 0,
          status TEXT DEFAULT 'active' CHECK(status IN ('active', 'retired', 'done', 'cancelled')),
          last_shown INTEGER,
          archived_at TEXT DEFAULT NULL,
          recurring_type TEXT DEFAULT 'none',
          recurring_interval INTEGER DEFAULT 1,
          recurring_days TEXT DEFAULT NULL,
          next_due_at TEXT DEFAULT NULL,
          last_completed_at TEXT DEFAULT NULL,
          needs_review INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          deadline TEXT DEFAULT NULL,
          snoozed_until TEXT DEFAULT NULL,
          tip_tracking_app TEXT DEFAULT NULL,
          subcategory_id INTEGER DEFAULT NULL,
          order_index INTEGER DEFAULT 0,
          prerequisite_tip_id INTEGER DEFAULT NULL REFERENCES tips(id),
          focus_duration INTEGER DEFAULT 5,
          FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
        )
      `);

      db.exec(`
        INSERT INTO tips_new (id, category_id, content, importance, show_count, status, last_shown, archived_at, recurring_type, recurring_interval, recurring_days, next_due_at, last_completed_at, needs_review, created_at, deadline, snoozed_until, tip_tracking_app, subcategory_id, order_index, prerequisite_tip_id, focus_duration)
        SELECT id, category_id, content, importance, show_count, status, last_shown, ${columns.includes('archived_at') ? 'archived_at' : 'NULL'}, ${columns.includes('recurring_type') ? 'recurring_type' : "'none'"}, ${columns.includes('recurring_interval') ? 'recurring_interval' : '1'}, ${columns.includes('recurring_days') ? 'recurring_days' : 'NULL'}, ${columns.includes('next_due_at') ? 'next_due_at' : 'NULL'}, ${columns.includes('last_completed_at') ? 'last_completed_at' : 'NULL'}, ${columns.includes('needs_review') ? 'needs_review' : '0'}, created_at, deadline, snoozed_until, tip_tracking_app, subcategory_id, order_index, prerequisite_tip_id, ${hasFocusDuration ? 'focus_duration' : '5'}
        FROM tips
      `);

      db.exec(`DROP TABLE tips`);
      db.exec(`ALTER TABLE tips_new RENAME TO tips`);

      db.exec('COMMIT');
      console.log('[DB] Migration 011: tips table recreated with cancelled status constraint');
    } else {
      console.log('[DB] Migration 011: cancelled status constraint already exists, skipping');
    }
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('[DB] Migration 011 FAILED:', e.message);
  }

  // Migration 013: focus_duration column on tips
  try {
    db.exec(`ALTER TABLE tips ADD COLUMN focus_duration INTEGER DEFAULT 5`);
    console.log('[DB] Migration 013: focus_duration column added to tips');
  } catch (e) {
    if (e.message && e.message.includes('duplicate column')) {
      console.log('[DB] Migration 013: focus_duration already exists, skipping');
    } else {
      console.error('[DB] Migration 013 FAILED:', e.message);
    }
  }

  // Migration 014: archived_at column on tips
  try {
    db.exec(`ALTER TABLE tips ADD COLUMN archived_at TEXT DEFAULT NULL`);
    console.log('[DB] Migration 014: archived_at column added to tips');
  } catch (e) {
    if (e.message && e.message.includes('duplicate column')) {
      console.log('[DB] Migration 014: archived_at already exists, skipping');
    } else {
      console.error('[DB] Migration 014 FAILED:', e.message);
    }
  }

  const recurringColumns = [
    ['recurring_type', "TEXT DEFAULT 'none'"],
    ['recurring_interval', 'INTEGER DEFAULT 1'],
    ['recurring_days', 'TEXT DEFAULT NULL'],
    ['next_due_at', 'TEXT DEFAULT NULL'],
    ['last_completed_at', 'TEXT DEFAULT NULL']
  ];
  recurringColumns.forEach(([column, definition]) => {
    try {
      db.exec(`ALTER TABLE tips ADD COLUMN ${column} ${definition}`);
      console.log(`[DB] Migration 015: ${column} column added to tips`);
    } catch (e) {
      if (e.message && e.message.includes('duplicate column')) {
        console.log(`[DB] Migration 015: ${column} already exists, skipping`);
      } else {
        console.error(`[DB] Migration 015 ${column} FAILED:`, e.message);
      }
    }
  });

  try {
    db.exec(`ALTER TABLE tips ADD COLUMN needs_review INTEGER DEFAULT 0`);
    console.log('[DB] Migration 016: needs_review column added to tips');
  } catch (e) {
    if (e.message && e.message.includes('duplicate column')) {
      console.log('[DB] Migration 016: needs_review already exists, skipping');
    } else {
      console.error('[DB] Migration 016 FAILED:', e.message);
    }
  }
}


function saveDatabase() {
  const dbPath = getDatabasePath();
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

function query(sql, params = []) {
  if (!db) {
    throw new Error('Database not initialized');
  }

  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function run(sql, params = []) {
  if (!db) {
    throw new Error('Database not initialized');
  }

  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  const changes = db.getRowsModified();
  stmt.free();

  const lastIdResult = db.exec("SELECT last_insert_rowid() as id");
  const lastID = lastIdResult.length > 0 && lastIdResult[0].values.length > 0
    ? lastIdResult[0].values[0][0]
    : null;

  if (!inTransaction) {
    saveDatabase();
  }

  return {
    lastID,
    changes
  };
}

function get(sql, params = []) {
  if (!db) {
    throw new Error('Database not initialized');
  }

  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const result = stmt.getAsObject();
    stmt.free();
    return result;
  }
  stmt.free();
  return null;
}

function close() {
  if (db) {
    saveDatabase();
    db.close();
    db = null;
    console.log('Database closed');
  }
}

function exec(sql) {
  if (!db) {
    throw new Error('Database not initialized');
  }
  const upperSql = sql.trim().toUpperCase();
  const isEnd = upperSql.startsWith('COMMIT') || upperSql.startsWith('ROLLBACK');

  try {
    db.exec(sql);
    if (upperSql.startsWith('BEGIN')) {
      inTransaction = true;
    }
  } catch (e) {
    if (isEnd) inTransaction = false;
    throw e;
  }

  if (isEnd) {
    inTransaction = false;
    saveDatabase();
  } else if (!inTransaction) {
    saveDatabase();
  }
}

module.exports = {
  initialize,
  query,
  run,
  get,
  exec,
  close
};
