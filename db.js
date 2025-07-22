const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, '..', 'db.sqlite');

// Export promise db agar bisa di-import dengan await di file lain
module.exports = sqlite.open({ filename: dbPath, driver: sqlite3.Database });