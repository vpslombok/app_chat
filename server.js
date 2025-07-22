const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const SECRET = 'chatappsecret';
const onlineUsers = {}; // socket.id: username
// Helper: get user info by socket id (ASYNC, gunakan callback)
function getUserList(callback) {
  db.all('SELECT username, lastSeen FROM users', []).then(rows => {
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
  });
}

// SQLite setup
let db;
(async () => {
  db = await sqlite.open({
    filename: 'chatapp.db',
    driver: sqlite3.Database
  });
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
})();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Register
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ success: false, message: 'Lengkapi data!' });
  const row = await db.get('SELECT username FROM users WHERE username = ?', [username]);
  if (row) return res.json({ success: false, message: 'Username sudah terdaftar!' });
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    await db.run('INSERT INTO users (username, passwordHash) VALUES (?, ?)', [username, passwordHash]);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: 'Gagal register.' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user) return res.json({ success: false, message: 'Username tidak ditemukan!' });
  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.json({ success: false, message: 'Password salah!' });
  const token = jwt.sign({ username }, SECRET, { expiresIn: '2h' });
  res.json({ success: true, token });
});

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
        await db.run('UPDATE users SET lastSeen = NULL WHERE username = ?', [username]);
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
        await db.run('INSERT INTO messages (fromUser, toUser, text, time) VALUES (?, ?, ?, ?)', [fromName, toName, text, time]);
        if (onlineUsers[to]) {
            socket.to(to).emit('privateMessage', { user: fromName, text, time });
        }
    });

    // Ambil riwayat chat privat
    socket.on('getHistory', async ({ withUser }) => {
        const fromName = onlineUsers[socket.id];
        if (!fromName || !withUser) return;
        const rows = await db.all('SELECT * FROM messages WHERE (fromUser = ? AND toUser = ?) OR (fromUser = ? AND toUser = ?) ORDER BY id ASC', [fromName, withUser, withUser, fromName]);
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
            await db.run('UPDATE users SET lastSeen = ? WHERE username = ?', [lastSeen, username]);
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
            await db.run('UPDATE users SET lastSeen = ? WHERE username = ?', [lastSeen, username]);
            delete onlineUsers[socket.id];
            getUserList(Object.assign(function(userList) {
                io.emit('userList', userList);
            }, { currentUsername: username }));
            io.emit('message', { user: 'System', text: `${username} keluar dari chat.`, time: lastSeen });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on port ' + PORT));
