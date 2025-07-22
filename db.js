const mysql = require('mysql2/promise');

// Koneksi pool MySQL
const pool = mysql.createPool({
  host: 'shortline.proxy.rlwy.net',
  port: 32221,
  user: 'root',
  password: 'NhNwIOOsTARbMlapGfVjpEOFoTVrZbde',
  database: 'railway',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = pool;