const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const pool = require('./db');



const app = express();
const server = http.createServer(app);
const io = new Server(server);

const path = require('path');
app.use(express.static(path.join(__dirname, 'public')));

// Redirect root to login.html (atau index.html jika sudah login)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Inisialisasi tabel MySQL jika belum ada
async function initTables() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS users (
      username VARCHAR(64) PRIMARY KEY,
      passwordHash VARCHAR(255) NOT NULL,
      lastSeen VARCHAR(64)
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      fromUser VARCHAR(64) NOT NULL,
      toUser VARCHAR(64) NOT NULL,
      text TEXT,
      time VARCHAR(64)
    )`);
    console.log('Tabel users dan messages siap!');
  } catch (e) {
    console.error('Gagal inisialisasi tabel:', e.message);
  }
}
initTables();

// Middleware untuk parsing JSON body
app.use(express.json());
// Route: Register
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username dan password wajib diisi.' });
  }
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
    if (rows.length > 0) {
      return res.status(409).json({ success: false, message: 'Username sudah terdaftar.' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (username, passwordHash) VALUES (?, ?)', [username, passwordHash]);
    return res.json({ success: true, message: 'Register berhasil.' });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

// Route: Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username dan password wajib diisi.' });
  }
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Username tidak ditemukan.' });
    }
    const user = rows[0];
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Password salah.' });
    }
    const token = jwt.sign({ username }, SECRET, { expiresIn: '2d' });
    return res.json({ success: true, token });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

const SECRET = 'chatappsecret';
const onlineUsers = {}; // socket.id: username
// Helper: get user info by socket id (ASYNC, gunakan callback)
async function getUserList(callback) {
  try {
    const [rows] = await pool.query('SELECT username, lastSeen FROM users');
    const userList = [];
    let currentUsername = null;
    if (typeof callback.currentUsername === 'string') {
      currentUsername = callback.currentUsername;
    }
    if (rows) {
      rows.forEach(row => {
        // Cari socket id jika online
        let onlineId = null;
        for (const [sid, uname] of Object.entries(onlineUsers)) {
          if (uname === row.username) onlineId = sid;
        }
        // Jangan tampilkan diri sendiri
        if (currentUsername && row.username === currentUsername) return;
        userList.push({
          id: onlineId || row.username,
          name: row.username,
          online: !!onlineId,
          lastSeen: row.lastSeen || null
        });
      });
    }
    callback(userList);
  } catch (e) {
    callback([]);
  }
}

// Middleware Auth
function verifyToken(token) {
    try {
        return jwt.verify(token, SECRET);
    } catch {
        return null;
    }
}

// Socket.io
io.on('connection', (socket) => {
  socket.on('join', async ({ token }) => {
    const payload = verifyToken(token);
    if (!payload) {
      socket.emit('forceLogout');
      return;
    }
    const username = payload.username;
    onlineUsers[socket.id] = username;
    await pool.query('UPDATE users SET lastSeen = NULL WHERE username = ?', [username]);
    getUserList(Object.assign(function(userList) {
      io.emit('userList', userList);
      socket.emit('userList', userList);
    }, { currentUsername: username }));
    socket.emit('message', { user: 'System', text: 'Welcome to the chat!', time: new Date().toLocaleTimeString() });
    socket.broadcast.emit('message', { user: 'System', text: `${username} bergabung ke chat.`, time: new Date().toLocaleTimeString() });
  });


    // Private message
    socket.on('privateMessage', async ({ to, text }) => {
      const fromName = onlineUsers[socket.id];
      if (!fromName || !to) return;
      const time = new Date().toLocaleTimeString();
      let toName = null;
      for (const [sid, uname] of Object.entries(onlineUsers)) {
        if (sid === to) toName = uname;
      }
      if (!toName) toName = to;
      await pool.query('INSERT INTO messages (fromUser, toUser, text, time) VALUES (?, ?, ?, ?)', [fromName, toName, text, time]);
      if (onlineUsers[to]) {
        socket.to(to).emit('privateMessage', { user: fromName, text, time });
      }
    });

    // Ambil riwayat chat privat
    socket.on('getHistory', async ({ withUser }) => {
      const fromName = onlineUsers[socket.id];
      if (!fromName || !withUser) return;
      const [rows] = await pool.query('SELECT * FROM messages WHERE (fromUser = ? AND toUser = ?) OR (fromUser = ? AND toUser = ?) ORDER BY id ASC', [fromName, withUser, withUser, fromName]);
      socket.emit('chatHistory', rows);
    });

    // WebRTC signaling
    socket.on('webrtc-offer', (data) => {
        // broadcast to target only (private call)
        if (data.to) {
            // Kirim offer hanya ke user tujuan
            for (const [sid, uname] of Object.entries(onlineUsers)) {
                if (uname === data.to) {
                    io.to(sid).emit('webrtc-offer', { ...data, from: socket.id });
                }
            }
        } else {
            // fallback: broadcast ke semua
            socket.broadcast.emit('webrtc-offer', { ...data, from: socket.id });
        }
    });
    socket.on('webrtc-answer', (data) => {
        socket.broadcast.emit('webrtc-answer', { ...data, from: socket.id });
    });
    socket.on('webrtc-candidate', (data) => {
        socket.broadcast.emit('webrtc-candidate', { ...data, from: socket.id });
    });
    socket.on('webrtc-end', () => {
        // Kirim end ke lawan bicara saja
        for (const [sid, uname] of Object.entries(onlineUsers)) {
            if (sid !== socket.id) {
                io.to(sid).emit('webrtc-end', { from: socket.id });
            }
        }
    });


    socket.on('logout', async () => {
      const username = onlineUsers[socket.id];
      if (username) {
        const lastSeen = new Date().toLocaleTimeString();
        await pool.query('UPDATE users SET lastSeen = ? WHERE username = ?', [lastSeen, username]);
        delete onlineUsers[socket.id];
        getUserList(Object.assign(function(userList) {
          io.emit('userList', userList);
        }, { currentUsername: username }));
        io.emit('message', { user: 'System', text: `${username} keluar dari chat.`, time: lastSeen });
      }
    });
    socket.on('disconnect', async () => {
      const username = onlineUsers[socket.id];
      if (username) {
        const lastSeen = new Date().toLocaleTimeString();
        await pool.query('UPDATE users SET lastSeen = ? WHERE username = ?', [lastSeen, username]);
        delete onlineUsers[socket.id];
        getUserList(Object.assign(function(userList) {
          io.emit('userList', userList);
        }, { currentUsername: username }));
        io.emit('message', { user: 'System', text: `${username} keluar dari chat.`, time: lastSeen });
      }
    });
});

app.use(cors({
  origin: ['https://vc_nodejs.me', 'http://localhost:3000'],
  credentials: true
}));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on port ' + PORT));
