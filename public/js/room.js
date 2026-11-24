// =========================================
// MeetFlow - Room Logic (WebRTC + UI)
// =========================================

// ---- Biến toàn cục ----
const roomId = window.location.pathname.split('/').pop();
let localStream = null;
let screenStream = null;
let socket = null;
let username = '';
let peers = {}; // { peerId: { pc: RTCPeerConnection, username: string } }

// Trạng thái UI
let isMuted = false;
let isCameraOff = false;
let isScreenSharing = false;
let isChatOpen = false;
let unreadCount = 0;
let callStartTime = null;
let timerInterval = null;

// Cấu hình WebRTC - sử dụng STUN server miễn phí của Google
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
  ]
};

// =========================================
// KHỞI TẠO
// =========================================

document.addEventListener('DOMContentLoaded', () => {
  // Hiển thị room ID trên modal
  document.getElementById('modal-room-id').textContent = roomId;

  // Kiểm tra nếu đã có tên từ landing page
  const savedName = sessionStorage.getItem('meetflow-username');
  if (savedName) {
    document.getElementById('modal-name-input').value = savedName;
  }

  // Enter key trên modal
  document.getElementById('modal-name-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinCall();
  });

  // Enter key trên chat
  document.getElementById('chat-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
});

// Vào phòng (từ modal)
async function joinCall() {
  const nameInput = document.getElementById('modal-name-input');
  username = nameInput.value.trim() || 'Ẩn danh';

  // Ẩn modal, hiện phòng
  document.getElementById('join-modal').classList.add('hidden');
  document.getElementById('room-container').style.display = 'flex';

  // Cập nhật UI
  document.getElementById('room-id-display').textContent = roomId;
  document.getElementById('username-display').textContent = username;
  document.getElementById('local-name-tag').textContent = username + ' (Bạn)';
  document.getElementById('local-avatar').textContent = username.charAt(0).toUpperCase();

  // Bắt đầu timer
  startTimer();

  // Lấy camera & micro
  await initMedia();

  // Kết nối Socket.IO
  connectSocket();
}

// Lấy camera và microphone
async function initMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user'
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    document.getElementById('local-video').srcObject = localStream;
    document.getElementById('local-no-cam').style.display = 'none';
  } catch (err) {
    console.warn('Không thể truy cập camera/mic:', err);
    // Thử chỉ audio
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      showLocalNoCam();
    } catch (e) {
      console.warn('Không thể truy cập micro:', e);
      localStream = new MediaStream();
      showLocalNoCam();
    }
    showToast('⚠️ Không thể truy cập camera/microphone');
  }
}

function showLocalNoCam() {
  document.getElementById('local-no-cam').style.display = 'flex';
}

// =========================================
// SOCKET.IO - KẾT NỐI & SIGNALING
// =========================================

function connectSocket() {
  socket = io();

  socket.on('connect', () => {
    console.log('🔌 Đã kết nối Socket.IO:', socket.id);
    socket.emit('join-room', { roomId, username });
  });

  // Nhận danh sách user đã có trong phòng
  socket.on('existing-users', (users) => {
    console.log('👥 Người đang trong phòng:', users);
    users.forEach(user => {
      createPeerConnection(user.userId, user.username, true);
    });
    updateParticipantCount();
  });

  // Có người mới vào
  socket.on('user-joined', ({ userId, username: peerName }) => {
    console.log(`✅ ${peerName} đã vào phòng`);
    createPeerConnection(userId, peerName, false);
    addSystemMessage(`${peerName} đã tham gia phòng`);
    updateParticipantCount();
    showToast(`👋 ${peerName} đã tham gia`);
  });

  // Nhận offer từ peer khác
  socket.on('offer', async ({ from, offer, username: peerName }) => {
    console.log(`📨 Nhận offer từ ${peerName}`);
    if (!peers[from]) {
      createPeerConnection(from, peerName, false);
    }
    try {
      await peers[from].pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peers[from].pc.createAnswer();
      await peers[from].pc.setLocalDescription(answer);
      socket.emit('answer', { to: from, answer });
    } catch (err) {
      console.error('Lỗi xử lý offer:', err);
    }
  });

  // Nhận answer
  socket.on('answer', async ({ from, answer }) => {
    console.log(`📨 Nhận answer từ ${from}`);
    try {
      await peers[from].pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (err) {
      console.error('Lỗi xử lý answer:', err);
    }
  });

  // Nhận ICE candidate
  socket.on('ice-candidate', async ({ from, candidate }) => {
    try {
      if (peers[from]) {
        await peers[from].pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (err) {
      console.error('Lỗi ICE candidate:', err);
    }
  });

  // Có người rời phòng
  socket.on('user-left', ({ userId, username: peerName }) => {
    console.log(`❌ ${peerName} đã rời phòng`);
    removePeer(userId);
    addSystemMessage(`${peerName} đã rời phòng`);
    updateParticipantCount();
    showToast(`${peerName} đã rời phòng`);
  });

  // Chat
  socket.on('chat-message', ({ userId, username: senderName, message, timestamp }) => {
    addChatMessage(senderName, message, timestamp, userId === socket.id);
  });

  socket.on('disconnect', () => {
    console.log('🔌 Mất kết nối');
    showToast('⚠️ Mất kết nối server...');
  });

  socket.on('reconnect', () => {
    showToast('✅ Đã kết nối lại');
  });
}

// =========================================
// WebRTC - PEER CONNECTION
// =========================================

function createPeerConnection(peerId, peerUsername, isInitiator) {
  console.log(`🔗 Tạo kết nối với ${peerUsername} (initiator: ${isInitiator})`);

  const pc = new RTCPeerConnection(rtcConfig);
  peers[peerId] = { pc, username: peerUsername };

  // Thêm track local vào connection
  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }

  // Khi nhận được media từ peer
  pc.ontrack = (event) => {
    console.log(`🎬 Nhận video từ ${peerUsername}`);
    let videoEl = document.getElementById(`video-${peerId}`);
    if (!videoEl) {
      videoEl = createVideoElement(peerId, peerUsername);
    }
    videoEl.srcObject = event.streams[0];
  };

  // Gửi ICE candidate
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', {
        to: peerId,
        candidate: event.candidate
      });
    }
  };

  // Theo dõi trạng thái kết nối
  pc.onconnectionstatechange = () => {
    console.log(`📡 Trạng thái với ${peerUsername}: ${pc.connectionState}`);
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      // Có thể thử reconnect ở đây
    }
  };

  // Nếu là người khởi tạo -> tạo offer
  if (isInitiator) {
    pc.createOffer()
      .then(offer => pc.setLocalDescription(offer))
      .then(() => {
        socket.emit('offer', {
          to: peerId,
          offer: pc.localDescription
        });
      })
      .catch(err => console.error('Lỗi tạo offer:', err));
  }

  return pc;
}

// Tạo phần tử video cho peer
function createVideoElement(peerId, peerUsername) {
  const grid = document.getElementById('video-grid');

  const container = document.createElement('div');
  container.className = 'video-container';
  container.id = `container-${peerId}`;

  const video = document.createElement('video');
  video.id = `video-${peerId}`;
  video.autoplay = true;
  video.playsInline = true;

  const nameTag = document.createElement('div');
  nameTag.className = 'video-name-tag';
  nameTag.textContent = peerUsername;

  // Avatar khi tắt cam
  const noCam = document.createElement('div');
  noCam.className = 'video-no-cam';
  noCam.id = `no-cam-${peerId}`;
  noCam.style.display = 'none';
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = peerUsername.charAt(0).toUpperCase();
  noCam.appendChild(avatar);

  container.appendChild(video);
  container.appendChild(noCam);
  container.appendChild(nameTag);
  grid.appendChild(container);

  updateGridLayout();
  return video;
}

// Xóa peer khi rời phòng
function removePeer(peerId) {
  if (peers[peerId]) {
    peers[peerId].pc.close();
    delete peers[peerId];
  }
  const container = document.getElementById(`container-${peerId}`);
  if (container) {
    container.style.animation = 'msg-in 0.2s ease reverse';
    setTimeout(() => {
      container.remove();
      updateGridLayout();
    }, 200);
  }
}

// =========================================
// ĐIỀU KHIỂN (Controls)
// =========================================

// Tắt/Bật micro
function toggleMute() {
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(track => {
    track.enabled = !isMuted;
  });
  const btn = document.getElementById('btn-mic');
  if (isMuted) {
    btn.classList.remove('active');
    btn.classList.add('off');
    btn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
  } else {
    btn.classList.remove('off');
    btn.classList.add('active');
    btn.innerHTML = '<i class="fas fa-microphone"></i>';
  }
}

// Tắt/Bật camera
function toggleCamera() {
  isCameraOff = !isCameraOff;
  localStream.getVideoTracks().forEach(track => {
    track.enabled = !isCameraOff;
  });

  const btn = document.getElementById('btn-camera');
  if (isCameraOff) {
    btn.classList.remove('active');
    btn.classList.add('off');
    btn.innerHTML = '<i class="fas fa-video-slash"></i>';
    document.getElementById('local-no-cam').style.display = 'flex';
  } else {
    btn.classList.remove('off');
    btn.classList.add('active');
    btn.innerHTML = '<i class="fas fa-video"></i>';
    document.getElementById('local-no-cam').style.display = 'none';
  }
}

// Chia sẻ màn hình
async function toggleScreenShare() {
  if (!isScreenSharing) {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
        audio: false
      });
      const screenTrack = screenStream.getVideoTracks()[0];

      // Thay thế video track trong tất cả peer connection
      Object.values(peers).forEach(({ pc }) => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(screenTrack);
      });

      // Hiển thị screen share trên local video
      document.getElementById('local-video').srcObject = screenStream;
      document.getElementById('local-no-cam').style.display = 'none';
      isScreenSharing = true;

      document.getElementById('btn-screen').classList.add('sharing');
      showToast('🖥️ Đang chia sẻ màn hình');

      // Khi người dùng dừng chia sẻ từ browser
      screenTrack.onended = () => stopScreenShare();

    } catch (err) {
      console.log('Hủy chia sẻ màn hình');
    }
  } else {
    stopScreenShare();
  }
}

function stopScreenShare() {
  if (!isScreenSharing) return;

  const videoTrack = localStream.getVideoTracks()[0];
  Object.values(peers).forEach(({ pc }) => {
    const sender = pc.getSenders().find(s => s.track?.kind === 'video');
    if (sender && videoTrack) sender.replaceTrack(videoTrack);
  });

  document.getElementById('local-video').srcObject = localStream;
  if (isCameraOff) {
    document.getElementById('local-no-cam').style.display = 'flex';
  }

  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }

  isScreenSharing = false;
  document.getElementById('btn-screen').classList.remove('sharing');
  showToast('Đã dừng chia sẻ màn hình');
}

// Mở/Đóng chat
function toggleChat() {
  isChatOpen = !isChatOpen;
  document.getElementById('chat-panel').classList.toggle('open', isChatOpen);
  const btn = document.getElementById('btn-chat');

  if (isChatOpen) {
    btn.classList.add('active');
    unreadCount = 0;
    document.getElementById('chat-badge').style.display = 'none';
    // Focus vào input
    setTimeout(() => {
      document.getElementById('chat-input').focus();
    }, 300);
  } else {
    btn.classList.remove('active');
  }
}

// Gửi tin nhắn
function sendMessage() {
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;

  socket.emit('chat-message', { roomId, message });
  input.value = '';
  input.focus();
}

// Copy link phòng
function copyRoomLink() {
  navigator.clipboard.writeText(window.location.href).then(() => {
    const btn = document.getElementById('btn-copy');
    btn.innerHTML = '<i class="fas fa-check"></i>';
    btn.classList.add('active');
    showToast('📋 Đã copy link phòng!');
    setTimeout(() => {
      btn.innerHTML = '<i class="fas fa-link"></i>';
      btn.classList.remove('active');
    }, 2000);
  });
}

// Rời phòng
function leaveRoom() {
  // Dừng tất cả media
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (screenStream) screenStream.getTracks().forEach(t => t.stop());

  // Đóng tất cả peer connection
  Object.values(peers).forEach(({ pc }) => pc.close());
  peers = {};

  // Ngắt socket
  if (socket) socket.disconnect();

  // Dừng timer
  if (timerInterval) clearInterval(timerInterval);

  // Về trang chủ
  window.location.href = '/';
}

// =========================================
// CHAT UI
// =========================================

function addChatMessage(name, message, timestamp, isMe) {
  // Xóa placeholder "Chưa có tin nhắn"
  const empty = document.querySelector('.chat-empty');
  if (empty) empty.remove();

  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `chat-message ${isMe ? 'me' : ''}`;

  const time = new Date(timestamp).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit'
  });

  div.innerHTML = `
    <div class="chat-message-header">
      <span class="chat-name">${isMe ? 'Bạn' : escapeHtml(name)}</span>
      <span class="chat-time">${time}</span>
    </div>
    <div class="chat-text">${escapeHtml(message)}</div>
  `;

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;

  // Badge thông báo nếu chat đang đóng
  if (!isChatOpen && !isMe) {
    unreadCount++;
    const badge = document.getElementById('chat-badge');
    badge.style.display = 'flex';
    badge.textContent = unreadCount;
  }
}

function addSystemMessage(text) {
  const empty = document.querySelector('.chat-empty');
  if (empty) empty.remove();

  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-system-message';
  div.textContent = `— ${text} —`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// =========================================
// TIỆN ÍCH
// =========================================

// Cập nhật grid layout dựa vào số người
function updateGridLayout() {
  const grid = document.getElementById('video-grid');
  const count = grid.children.length;
  grid.setAttribute('data-count', Math.min(count, 6));
}

// Cập nhật số người tham gia
function updateParticipantCount() {
  const count = Object.keys(peers).length + 1;
  document.getElementById('participant-count').textContent = count;
}

// Timer cuộc gọi
function startTimer() {
  callStartTime = Date.now();
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    document.getElementById('call-timer').textContent = `${mins}:${secs}`;
  }, 1000);
}

// Toast notification
function showToast(message) {
  // Xóa toast cũ nếu có
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  // Hiện
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  // Ẩn sau 3 giây
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Escape HTML để tránh XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Xử lý khi đóng tab
window.addEventListener('beforeunload', () => {
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (screenStream) screenStream.getTracks().forEach(t => t.stop());
});
