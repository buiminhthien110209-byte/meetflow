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

// Endpoint phục vụ favicon.ico chuẩn cho mọi trình duyệt (Chrome, Edge, Safari)
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'favicon.svg'));
});

// Quản lý phòng: roomId -> { hostSocketId, hostUsername, roomMode }
// roomMode: 'classroom' (Lớp học) | 'meeting' (Cuộc họp) | 'interview' (Phỏng vấn)
const rooms = new Map();

// ========== API ==========

// Tạo phòng mới
app.post('/api/room/create', (req, res) => {
  const roomId = uuidv4().substring(0, 8);
  const roomMode = req.body && req.body.roomMode ? req.body.roomMode : 'classroom';
  rooms.set(roomId, { hostSocketId: null, hostUsername: null, roomMode });
  res.json({ roomId, roomMode });
});

// Phục vụ trang phòng họp
app.get('/room/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

// ========== SOCKET.IO - Signaling Server ==========

io.on('connection', (socket) => {
  console.log(`✅ Kết nối mới: ${socket.id}`);

  // Hàm xử lý khi chủ phòng kết thúc hoặc thoát
  function handleHostLeave(roomId, hostUsername, forced = false) {
    const roomInfo = rooms.get(roomId);
    if (!roomInfo) return;

    const mode = roomInfo.roomMode || 'classroom';

    // Nếu là chế độ Cuộc họp nhóm và chỉ thoát bình thường (không phải bấm Kết thúc tất cả):
    // Cuộc họp vẫn duy trì cho các thành viên còn lại!
    if (mode === 'meeting' && !forced) {
      console.log(`💼 Người tổ chức (${hostUsername}) đã rời cuộc họp ${roomId}. Cuộc họp vẫn tiếp tục.`);
      socket.to(roomId).emit('user-left', {
        userId: socket.id,
        username: hostUsername
      });
      return;
    }

    // Với Lớp học (classroom) hoặc Phỏng vấn (interview) hoặc khi bấm Kết thúc tất cả:
    rooms.delete(roomId);
    
    let endMessage = `Lớp học đã chính thức kết thúc do Giáo viên (${hostUsername}) đóng phòng.`;
    if (mode === 'interview') {
      endMessage = `Buổi phỏng vấn đã hoàn tất bởi Người phỏng vấn (${hostUsername}). Cảm ơn ứng viên đã tham gia!`;
    } else if (mode === 'meeting') {
      endMessage = `Cuộc họp đã được kết thúc cho tất cả thành viên bởi người tổ chức (${hostUsername}).`;
    }

    console.log(`🛑 Phòng ${roomId} [Chế độ: ${mode}] đã đóng bởi (${hostUsername}). Đang giải tán phòng.`);

    io.to(roomId).emit('room-ended', {
      message: endMessage,
      roomMode: mode
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

  // Tham gia phòng
  socket.on('join-room', ({ roomId, username, isCreator, roomMode }) => {
    socket.join(roomId);
    socket.roomId = roomId;
    socket.username = username || 'Ẩn danh';

    let roomInfo = rooms.get(roomId);
    if (!roomInfo) {
      roomInfo = {
        hostSocketId: socket.id,
        hostUsername: socket.username,
        roomMode: roomMode || 'classroom'
      };
      rooms.set(roomId, roomInfo);
      socket.isHost = true;
    } else if (isCreator && (!roomInfo.hostSocketId || !io.sockets.sockets.has(roomInfo.hostSocketId))) {
      roomInfo.hostSocketId = socket.id;
      roomInfo.hostUsername = socket.username;
      if (roomMode) roomInfo.roomMode = roomMode;
      socket.isHost = true;
    } else {
      socket.isHost = (roomInfo.hostSocketId === socket.id);
    }

    socket.roomMode = roomInfo.roomMode || 'classroom';

    // Báo vai trò và chế độ phòng cho người dùng
    socket.emit('role-assignment', {
      isHost: socket.isHost,
      hostUsername: roomInfo.hostUsername,
      roomMode: socket.roomMode
    });

    // Gửi danh sách user đang có trong phòng
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
              isHost: s.isHost || false,
              roomMode: socket.roomMode
            });
          }
        }
      }
    }
    socket.emit('existing-users', usersInRoom);

    // Thông báo cho người khác trong phòng
    socket.to(roomId).emit('user-joined', {
      userId: socket.id,
      username: socket.username,
      isHost: socket.isHost,
      roomMode: socket.roomMode
    });

    const count = io.sockets.adapter.rooms.get(roomId)?.size || 0;
    console.log(`👤 ${socket.username} [${socket.isHost ? 'Host' : 'Member'}] vào phòng ${roomId} [${socket.roomMode}] (${count} người)`);
  });

  // Chủ phòng chủ động ấn "Kết thúc cuộc họp/lớp học"
  socket.on('end-room', () => {
    if (socket.isHost && socket.roomId) {
      handleHostLeave(socket.roomId, socket.username, true);
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
      roomMode: socket.roomMode,
      message,
      timestamp: new Date().toISOString()
    });
  });

  // ---- Bảng vẽ tương tác (Interactive Whiteboard) ----

  socket.on('whiteboard-draw', ({ roomId, drawData }) => {
    socket.to(roomId).emit('whiteboard-draw', drawData);
  });

  socket.on('whiteboard-clear', ({ roomId }) => {
    socket.to(roomId).emit('whiteboard-clear');
  });

  // ---- Giơ tay phát biểu (Raise Hand) ----

  socket.on('raise-hand', ({ roomId, raised }) => {
    io.to(roomId).emit('user-raise-hand', {
      userId: socket.id,
      username: socket.username,
      raised: !!raised
    });
  });

  // ---- Ngắt kết nối ----

  socket.on('disconnect', () => {
    if (socket.roomId) {
      if (socket.isHost) {
        handleHostLeave(socket.roomId, socket.username, false);
      } else {
        socket.to(socket.roomId).emit('user-left', {
          userId: socket.id,
          username: socket.username
        });
        console.log(`❌ Thành viên ${socket.username} rời phòng ${socket.roomId}`);
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
