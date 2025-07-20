const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const SECRET = 'chatappsecret';
const onlineUsers = {}; // socket.id: username
// Helper: get user info by socket id (ASYNC, gunakan callback)
function getUserList(callback) {
    db.all('SELECT username, lastSeen FROM users', [], (err, rows) => {
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
const db = new sqlite3.Database('chatapp.db');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        passwordHash TEXT NOT NULL,
        lastSeen TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fromUser TEXT NOT NULL,
        toUser TEXT NOT NULL,
        text TEXT,
        time TEXT
    )`);
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Register
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ success: false, message: 'Lengkapi data!' });
    db.get('SELECT username FROM users WHERE username = ?', [username], async (err, row) => {
        if (row) return res.json({ success: false, message: 'Username sudah terdaftar!' });
        const passwordHash = await bcrypt.hash(password, 10);
        db.run('INSERT INTO users (username, passwordHash) VALUES (?, ?)', [username, passwordHash], (err) => {
            if (err) return res.json({ success: false, message: 'Gagal register.' });
            res.json({ success: true });
        });
    });
});

// Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (!user) return res.json({ success: false, message: 'Username tidak ditemukan!' });
        const match = await bcrypt.compare(password, user.passwordHash);
        if (!match) return res.json({ success: false, message: 'Password salah!' });
        const token = jwt.sign({ username }, SECRET, { expiresIn: '2h' });
        res.json({ success: true, token });
    });
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

    socket.on('join', ({ token }) => {
        const payload = verifyToken(token);
        if (!payload) {
            socket.emit('forceLogout');
            return;
        }
        const username = payload.username;
        onlineUsers[socket.id] = username;
        db.run('UPDATE users SET lastSeen = NULL WHERE username = ?', [username]);
        getUserList(Object.assign(function(userList) {
            io.emit('userList', userList);
            socket.emit('userList', userList); // pastikan user yang baru login langsung dapat userList
        }, { currentUsername: username }));
        socket.emit('message', { user: 'System', text: 'Welcome to the chat!', time: new Date().toLocaleTimeString() });
        socket.broadcast.emit('message', { user: 'System', text: `${username} bergabung ke chat.`, time: new Date().toLocaleTimeString() });
    });


    // Private message
    socket.on('privateMessage', ({ to, text }) => {
        const fromName = onlineUsers[socket.id];
        if (!fromName || !to) return;
        const time = new Date().toLocaleTimeString();
        // Simpan pesan ke database
        let toName = null;
        for (const [sid, uname] of Object.entries(onlineUsers)) {
            if (sid === to) toName = uname;
        }
        // Jika user tujuan offline, gunakan to sebagai username
        if (!toName) toName = to;
        db.run('INSERT INTO messages (fromUser, toUser, text, time) VALUES (?, ?, ?, ?)', [fromName, toName, text, time]);
        // Send to target only jika online
        if (onlineUsers[to]) {
            socket.to(to).emit('privateMessage', { user: fromName, text, time });
        }
    });

    // Ambil riwayat chat privat
    socket.on('getHistory', ({ withUser }) => {
        const fromName = onlineUsers[socket.id];
        if (!fromName || !withUser) return;
        db.all('SELECT * FROM messages WHERE (fromUser = ? AND toUser = ?) OR (fromUser = ? AND toUser = ?) ORDER BY id ASC',
            [fromName, withUser, withUser, fromName], (err, rows) => {
                if (!err && rows) {
                    socket.emit('chatHistory', rows);
                }
            });
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


    socket.on('logout', () => {
        const username = onlineUsers[socket.id];
        if (username) {
            // Simpan lastSeen
            const lastSeen = new Date().toLocaleTimeString();
            db.run('UPDATE users SET lastSeen = ? WHERE username = ?', [lastSeen, username]);
            delete onlineUsers[socket.id];
            getUserList(Object.assign(function(userList) {
                io.emit('userList', userList);
            }, { currentUsername: username }));
            io.emit('message', { user: 'System', text: `${username} keluar dari chat.`, time: lastSeen });
        }
    });

    socket.on('disconnect', () => {
        const username = onlineUsers[socket.id];
        if (username) {
            // Simpan lastSeen
            const lastSeen = new Date().toLocaleTimeString();
            db.run('UPDATE users SET lastSeen = ? WHERE username = ?', [lastSeen, username]);
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
