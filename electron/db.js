const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let db = null;
let SQL = null;

function getDatabasePath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'notez.db');
}

async function initialize() {
  SQL = await initSqlJs();
  const dbPath = getDatabasePath();
  
  // Load existing database or create new one
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
    // Ensure all tables exist (for migrations)
    createTables();
    saveDatabase();
  } else {
    db = new SQL.Database();
    createTables();
    saveDatabase();
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

  // Settings table (for audio and other app settings)
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  console.log('All database tables created successfully');
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
  stmt.free();
  
  // Save after each write operation
  saveDatabase();
  
  return {
    lastID: db.exec("SELECT last_insert_rowid() as id")[0].id,
    changes: 1
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

module.exports = {
  initialize,
  query,
  run,
  get,
  close
};
