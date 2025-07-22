// init_sqlite.js
// Jalankan file ini sekali untuk inisialisasi/migrasi database SQLite
const Database = require('better-sqlite3');
const db = new Database('chatapp.db');

// Buat tabel users jika belum ada
const createUsers = `CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    passwordHash TEXT NOT NULL,
    lastSeen TEXT
);`;
db.prepare(createUsers).run();

// Buat tabel messages jika belum ada
const createMessages = `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fromUser TEXT NOT NULL,
    toUser TEXT NOT NULL,
    text TEXT,
    time TEXT
);`;
db.prepare(createMessages).run();

console.log('Database chatapp.db siap!');
db.close();
