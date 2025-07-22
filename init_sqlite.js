// init_sqlite.js
// Jalankan file ini sekali untuk inisialisasi/migrasi database SQLite
const dbPromise = require('./db');

(async () => {
  const db = await dbPromise;
  await db.run(`CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    passwordHash TEXT NOT NULL,
    lastSeen TEXT
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fromUser TEXT NOT NULL,
    toUser TEXT NOT NULL,
    text TEXT,
    time TEXT
  )`);
  console.log('Database chatapp.db siap!');
  await db.close();
})();
