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

// Phục vụ file tĩnh có bộ nhớ đệm (Cache) để tải siêu tốc
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: true
}));
app.use(express.json());

// Quản lý phòng: roomId -> { hostSocketId, hostUsername }
const rooms = new Map();

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

  // Hàm xử lý khi chủ phòng kết thúc hoặc thoát
  function handleHostLeave(roomId, hostUsername) {
    if (rooms.has(roomId)) {
      rooms.delete(roomId);
      console.log(`🛑 Lớp học ${roomId} đã đóng bởi chủ phòng (${hostUsername}). Đang đẩy tất cả người tham gia ra.`);
      
      // Báo cho tất cả người trong phòng biết lớp học đã kết thúc
      io.to(roomId).emit('room-ended', {
        message: `Người tạo lớp (${hostUsername}) đã thoát. Lớp học đã chính thức kết thúc!`
      });

      // Rút tất cả socket ra khỏi phòng
      const roomSockets = io.sockets.adapter.rooms.get(roomId);
      if (roomSockets) {
        for (const id of roomSockets) {
          const s = io.sockets.sockets.get(id);
          if (s) {
            s.leave(roomId);
            s.roomId = null;
          }
        }
      }
    }
  }

  // Tham gia phòng
  socket.on('join-room', ({ roomId, username, isCreator }) => {
    socket.join(roomId);
    socket.roomId = roomId;
    socket.username = username || 'Ẩn danh';

    // Xác định ai là chủ phòng / người tạo lớp
    let roomInfo = rooms.get(roomId);
    if (!roomInfo) {
      // Người đầu tiên vào hoặc người tạo
      roomInfo = { hostSocketId: socket.id, hostUsername: socket.username };
      rooms.set(roomId, roomInfo);
      socket.isHost = true;
    } else if (isCreator && (!roomInfo.hostSocketId || !io.sockets.sockets.has(roomInfo.hostSocketId))) {
      // Chủ phòng cũ vào lại hoặc người tạo claim quyền
      roomInfo.hostSocketId = socket.id;
      roomInfo.hostUsername = socket.username;
      socket.isHost = true;
    } else {
      socket.isHost = (roomInfo.hostSocketId === socket.id);
    }

    // Thông báo cho socket này biết họ có phải là Host không
    socket.emit('role-assignment', {
      isHost: socket.isHost,
      hostUsername: roomInfo.hostUsername
    });

    // Gửi danh sách user đã có trong phòng cho người mới
    const usersInRoom = [];
    const roomSockets = io.sockets.adapter.rooms.get(roomId);
    if (roomSockets) {
      for (const id of roomSockets) {
        if (id !== socket.id) {
          const s = io.sockets.sockets.get(id);
          if (s) {
            usersInRoom.push({
              userId: id,
              username: s.username || 'Ẩn danh',
              isHost: s.isHost || false
            });
          }
        }
      }
    }
    socket.emit('existing-users', usersInRoom);

    // Thông báo cho người khác biết có người mới
    socket.to(roomId).emit('user-joined', {
      userId: socket.id,
      username: socket.username,
      isHost: socket.isHost
    });

    const count = io.sockets.adapter.rooms.get(roomId)?.size || 0;
    console.log(`👤 ${socket.username} (${socket.isHost ? '👑 Chủ phòng' : 'Học viên'}) vào phòng ${roomId} (${count} người)`);
  });

  // Chủ phòng chủ động ấn "Kết thúc lớp học"
  socket.on('end-room', () => {
    if (socket.isHost && socket.roomId) {
      handleHostLeave(socket.roomId, socket.username);
    }
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
      isHost: socket.isHost,
      message,
      timestamp: new Date().toISOString()
    });
  });

  // ---- Ngắt kết nối ----

  socket.on('disconnect', () => {
    if (socket.roomId) {
      if (socket.isHost) {
        console.log(`❌ Chủ phòng ${socket.username} đã thoát/đóng trình duyệt -> Giải tán lớp học ${socket.roomId}`);
        handleHostLeave(socket.roomId, socket.username);
      } else {
        socket.to(socket.roomId).emit('user-left', {
          userId: socket.id,
          username: socket.username
        });
        console.log(`❌ Học viên ${socket.username} rời phòng ${socket.roomId}`);
      }
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
