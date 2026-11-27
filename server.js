const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const nodemailer = require('nodemailer');
const fs = require('fs');

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

// =========================================
// QUẢN LÝ TÀI KHOẢN GMAIL & XÁC THỰC OTP
// =========================================

const USERS_FILE = path.join(__dirname, 'data', 'users.json');
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}

let users = {};
try {
  if (fs.existsSync(USERS_FILE)) {
    users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  }
} catch (e) {
  users = {};
}

function saveUsers() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
  } catch (e) {
    console.error('Lỗi ghi file users.json:', e);
  }
}

// Lưu trữ mã OTP tạm thời trong RAM: email -> { code, name, expiresAt }
const pendingOtps = new Map();

// Cấu hình Nodemailer gửi Gmail
let mailTransporter = null;
if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
  mailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });
  console.log(`📧 Đã kích hoạt Gmail SMTP: ${process.env.GMAIL_USER}`);
} else {
  console.log('ℹ️ GMAIL_USER và GMAIL_APP_PASSWORD chưa được cấu hình. Hệ thống sẽ hiển thị mã OTP trực tiếp để thử nghiệm thuận tiện.');
}

// API 1: Gửi mã OTP xác nhận đến Gmail (chỉ chấp nhận @gmail.com)
app.post('/api/auth/send-otp', async (req, res) => {
  try {
    const { email, name } = req.body || {};
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Vui lòng nhập địa chỉ Gmail.' });
    }

    const cleanEmail = email.trim().toLowerCase();

    // KIỂM TRA NGHIÊM NGẶT: Chỉ cho phép tài khoản có đuôi @gmail.com
    if (!cleanEmail.endsWith('@gmail.com') || !/^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'Hệ thống chỉ chấp nhận địa chỉ email @gmail.com hợp lệ!' });
    }

    // Tạo mã 6 số ngẫu nhiên
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // Hiệu lực 5 phút

    pendingOtps.set(cleanEmail, {
      code: otpCode,
      name: name ? name.trim() : '',
      expiresAt
    });

    console.log(`\n=========================================`);
    console.log(`🔑 [MÃ XÁC THỰC MEETFLOW GMAIL]`);
    console.log(`   Địa chỉ: ${cleanEmail}`);
    console.log(`   Mã OTP:  ${otpCode}`);
    console.log(`   Hết hạn: 5 phút`);
    console.log(`=========================================\n`);

    let mailSent = false;
    if (mailTransporter) {
      try {
        await mailTransporter.sendMail({
          from: `"MeetFlow" <${process.env.GMAIL_USER}>`,
          to: cleanEmail,
          subject: `[MeetFlow] Mã xác nhận tạo tài khoản / đăng nhập: ${otpCode}`,
          html: `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 480px; margin: 0 auto; padding: 28px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px;">
              <div style="text-align: center; margin-bottom: 24px;">
                <h2 style="color: #4f46e5; margin: 0; font-size: 26px;">MeetFlow</h2>
                <p style="color: #64748b; font-size: 14px; margin: 4px 0 0;">Nền tảng họp & lớp học trực tuyến</p>
              </div>
              <p style="font-size: 15px; color: #1e293b; margin-bottom: 8px;">Xin chào <strong>${name ? name.trim() : 'bạn'}</strong>,</p>
              <p style="font-size: 14px; color: #475569; line-height: 1.6; margin-bottom: 20px;">
                Bạn vừa yêu cầu mã xác nhận để đăng nhập / tạo tài khoản MeetFlow bằng địa chỉ Gmail này.
              </p>
              <div style="text-align: center; margin: 28px 0;">
                <div style="display: inline-block; font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #4f46e5; background: #e0e7ff; padding: 14px 32px; border-radius: 12px; border: 1px dashed #6366f1;">
                  ${otpCode}
                </div>
              </div>
              <p style="font-size: 13px; color: #64748b; text-align: center; line-height: 1.5;">
                Mã xác nhận có hiệu lực trong vòng <strong>5 phút</strong>.<br>
                Tuyệt đối không chia sẻ mã này cho bất kỳ ai khác.
              </p>
              <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0;">
              <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0;">
                Nếu bạn không gửi yêu cầu này, vui lòng bỏ qua email.
              </p>
            </div>
          `
        });
        mailSent = true;
      } catch (err) {
        console.error('Lỗi gửi email thực tế qua Gmail SMTP:', err.message);
      }
    }

    res.json({
      success: true,
      message: mailSent 
        ? 'Mã xác nhận 6 chữ số đã được gửi vào Gmail của bạn!' 
        : 'Mã xác nhận đã được tạo thành công!',
      mailSent,
      // Trả về demoCode nếu chưa cấu hình Gmail App Password trên server để có thể test ngay
      demoCode: !mailSent ? otpCode : undefined
    });
  } catch (error) {
    console.error('Lỗi send-otp:', error);
    res.status(500).json({ error: 'Đã có lỗi xảy ra khi tạo mã xác nhận.' });
  }
});

// API 2: Xác thực mã OTP và Tạo tài khoản / Đăng nhập
app.post('/api/auth/verify-otp', (req, res) => {
  try {
    const { email, code, name } = req.body || {};
    if (!email || !code) {
      return res.status(400).json({ error: 'Vui lòng cung cấp Gmail và mã xác nhận.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const record = pendingOtps.get(cleanEmail);

    if (!record) {
      return res.status(400).json({ error: 'Mã xác nhận không tồn tại hoặc bạn chưa yêu cầu gửi mã.' });
    }

    if (Date.now() > record.expiresAt) {
      pendingOtps.delete(cleanEmail);
      return res.status(400).json({ error: 'Mã xác nhận đã hết hạn (5 phút). Vui lòng yêu cầu mã mới.' });
    }

    if (record.code !== code.toString().trim()) {
      return res.status(400).json({ error: 'Mã xác nhận không chính xác. Vui lòng thử lại.' });
    }

    // Xác thực thành công -> Hủy mã OTP
    pendingOtps.delete(cleanEmail);

    // Tìm hoặc tạo tài khoản mới
    let user = users[cleanEmail];
    const finalName = (name && name.trim()) || record.name || (user ? user.name : cleanEmail.split('@')[0]);

    if (!user) {
      user = {
        id: uuidv4().substring(0, 10),
        email: cleanEmail,
        name: finalName,
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString()
      };
      users[cleanEmail] = user;
      saveUsers();
      console.log(`🎉 [TẠO TÀI KHOẢN MỚI THÀNH CÔNG] ${user.name} (${user.email})`);
    } else {
      user.name = finalName;
      user.lastLogin = new Date().toISOString();
      saveUsers();
      console.log(`👋 [ĐĂNG NHẬP GMAIL THÀNH CÔNG] ${user.name} (${user.email})`);
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    });
  } catch (error) {
    console.error('Lỗi verify-otp:', error);
    res.status(500).json({ error: 'Đã có lỗi xảy ra khi xác thực mã.' });
  }
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
