const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Phục vụ file tĩnh
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ========== API ==========

// Tạo phòng mới
app.post('/api/room/create', (req, res) => {
  const roomId = uuidv4().substring(0, 8);
  res.json({ roomId });
});

// Phục vụ trang phòng họp
app.get('/room/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

// ========== SOCKET.IO - Signaling Server ==========

io.on('connection', (socket) => {
  console.log(`✅ Kết nối mới: ${socket.id}`);

  // Tham gia phòng
  socket.on('join-room', ({ roomId, username }) => {
    socket.join(roomId);
    socket.roomId = roomId;
    socket.username = username || 'Ẩn danh';

    // Gửi danh sách user đã có trong phòng cho người mới
    const usersInRoom = [];
    const roomSockets = io.sockets.adapter.rooms.get(roomId);
    if (roomSockets) {
      for (const id of roomSockets) {
        if (id !== socket.id) {
          const s = io.sockets.sockets.get(id);
          if (s) {
            usersInRoom.push({ userId: id, username: s.username || 'Ẩn danh' });
          }
        }
      }
    }
    socket.emit('existing-users', usersInRoom);

    // Thông báo cho người khác biết có người mới
    socket.to(roomId).emit('user-joined', {
      userId: socket.id,
      username: socket.username
    });

    const count = io.sockets.adapter.rooms.get(roomId)?.size || 0;
    console.log(`👤 ${socket.username} vào phòng ${roomId} (${count} người)`);
  });

  // ---- WebRTC Signaling ----

  socket.on('offer', ({ to, offer }) => {
    io.to(to).emit('offer', {
      from: socket.id,
      offer,
      username: socket.username
    });
  });

  socket.on('answer', ({ to, answer }) => {
    io.to(to).emit('answer', { from: socket.id, answer });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('ice-candidate', { from: socket.id, candidate });
  });

  // ---- Chat ----

  socket.on('chat-message', ({ roomId, message }) => {
    io.to(roomId).emit('chat-message', {
      userId: socket.id,
      username: socket.username,
      message,
      timestamp: new Date().toISOString()
    });
  });

  // ---- Ngắt kết nối ----

  socket.on('disconnect', () => {
    if (socket.roomId) {
      socket.to(socket.roomId).emit('user-left', {
        userId: socket.id,
        username: socket.username
      });
      console.log(`❌ ${socket.username} rời phòng ${socket.roomId}`);
    }
  });
});

// ========== Khởi động server ==========

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║        🚀 MeetFlow Server            ║');
  console.log(`║   http://localhost:${PORT}              ║`);
  console.log('║   Sẵn sàng nhận kết nối!             ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');
});
