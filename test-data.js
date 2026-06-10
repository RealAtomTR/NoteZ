const SQL = require('sql.js');
const fs = require('fs');
const path = require('path');

async function insertTestData() {
  const sql = await SQL();
  const dbPath = path.join('C:\\Users\\Mali\\AppData\\Roaming\\notez', 'notez.db');
  
  if (!fs.existsSync(dbPath)) {
    console.log('Database not found');
    return;
  }
  
  const buffer = fs.readFileSync(dbPath);
  const db = new sql.Database(buffer);
  
  // Insert categories
  db.run(`INSERT INTO categories (name, color, triggers, created_at) VALUES (?, ?, ?, ?)`, 
    ['Yapay Zeka', '#6C63FF', JSON.stringify(['Claude', 'ChatGPT', 'Gemini']), Date.now()]);
  
  db.run(`INSERT INTO categories (name, color, triggers, created_at) VALUES (?, ?, ?, ?)`, 
    ['Programlama', '#00D9FF', JSON.stringify(['VS Code', 'IntelliJ', 'PyCharm']), Date.now()]);
  
  db.run(`INSERT INTO categories (name, color, triggers, created_at) VALUES (?, ?, ?, ?)`, 
    ['Spor', '#00FF88', JSON.stringify(['Gym', 'Fitness', 'Workout']), Date.now()]);
  
  // Insert tips
  db.run(`INSERT INTO tips (category_id, content, importance, show_count, status, last_shown, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
    [1, 'Bugün AI konularında en az 30 dakika çalış.', 7, 5, 'active', Date.now(), Date.now()]);
  
  db.run(`INSERT INTO tips (category_id, content, importance, show_count, status, last_shown, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
    [1, 'Yeni bir AI modeli araştır.', 5, 3, 'active', Date.now(), Date.now()]);
  
  db.run(`INSERT INTO tips (category_id, content, importance, show_count, status, last_shown, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
    [2, 'Kod yazma pratiği yap - en az 100 satır.', 8, 7, 'active', Date.now(), Date.now()]);
  
  db.run(`INSERT INTO tips (category_id, content, importance, show_count, status, last_shown, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
    [2, 'Yeni bir programlama dili öğren.', 6, 2, 'active', Date.now(), Date.now()]);
  
  db.run(`INSERT INTO tips (category_id, content, importance, show_count, status, last_shown, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
    [3, 'Bugün spor yap - en az 30 dakika.', 9, 10, 'active', Date.now(), Date.now()]);
  
  // Insert dismiss logs with patterns
  // Tip 1 (AI) - multiple "no_time" dismisses (pattern)
  for (let i = 0; i < 5; i++) {
    db.run(`INSERT INTO dismiss_log (tip_id, reason, dismissed_at) VALUES (?, ?, ?)`, 
      [1, 'no_time', Date.now() - (i * 3600000)]);
  }
  
  // Tip 2 (AI research) - multiple "no_motivation" dismisses (pattern)
  for (let i = 0; i < 4; i++) {
    db.run(`INSERT INTO dismiss_log (tip_id, reason, dismissed_at) VALUES (?, ?, ?)`, 
      [2, 'no_motivation', Date.now() - (i * 3600000)]);
  }
  
  // Tip 3 (Coding) - mixed reasons
  db.run(`INSERT INTO dismiss_log (tip_id, reason, dismissed_at) VALUES (?, ?, ?)`, [3, 'no_time', Date.now()]);
  db.run(`INSERT INTO dismiss_log (tip_id, reason, dismissed_at) VALUES (?, ?, ?)`, [3, 'dont_know_how', Date.now()]);
  db.run(`INSERT INTO dismiss_log (tip_id, reason, dismissed_at) VALUES (?, ?, ?)`, [3, 'not_now', Date.now()]);
  
  // Tip 4 (New language) - single dismiss
  db.run(`INSERT INTO dismiss_log (tip_id, reason, dismissed_at) VALUES (?, ?, ?)`, [4, 'dont_know_how', Date.now()]);
  
  // Tip 5 (Sport) - multiple "not_now" dismisses (pattern)
  for (let i = 0; i < 6; i++) {
    db.run(`INSERT INTO dismiss_log (tip_id, reason, dismissed_at) VALUES (?, ?, ?)`, 
      [5, 'not_now', Date.now() - (i * 3600000)]);
  }
  
  // Save database
  const data = db.export();
  const outBuffer = Buffer.from(data);
  fs.writeFileSync(dbPath, outBuffer);
  
  console.log('Test data inserted successfully');
}

insertTestData().catch(console.error);
