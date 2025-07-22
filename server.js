const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const dbPromise = require('./db');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const SECRET = 'chatappsecret';
const onlineUsers = {}; // socket.id: username
// Helper: get user info by socket id (ASYNC, gunakan callback)
function getUserList(callback) {
  dbPromise.then(db => db.all('SELECT username, lastSeen FROM users', [])).then(rows => {
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
    const db = await dbPromise;
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
      const db = await dbPromise;
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
      const db = await dbPromise;
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
      const db = await dbPromise;
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
      const db = await dbPromise;
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
