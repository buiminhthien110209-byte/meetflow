// =========================================
// MeetFlow - Room Logic (WebRTC + UI + Host Role)
// =========================================

// ---- Biến toàn cục ----
const roomId = window.location.pathname.split('/').pop();
let localStream = null;
let screenStream = null;
let socket = null;
let username = '';
let isHost = false;
let peers = {}; // { peerId: { pc: RTCPeerConnection, username: string, isHost: boolean } }

// Trạng thái UI
let isMuted = false;
let isCameraOff = false;
let isScreenSharing = false;
let isChatOpen = false;
let unreadCount = 0;
let callStartTime = null;
let timerInterval = null;

// Cấu hình WebRTC - STUN + TURN servers miễn phí
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ],
  iceCandidatePoolSize: 10
};

// =========================================
// KHỞI TẠO
// =========================================

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('modal-room-id').textContent = roomId;

  const savedName = sessionStorage.getItem('meetflow-username');
  if (savedName) {
    document.getElementById('modal-name-input').value = savedName;
  }

  document.getElementById('modal-name-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinCall();
  });

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

  // Cập nhật UI cơ bản
  document.getElementById('room-id-display').textContent = roomId;
  document.getElementById('username-display').textContent = username;
  document.getElementById('local-name-tag').textContent = username + ' (Bạn)';
  document.getElementById('local-avatar').textContent = username.charAt(0).toUpperCase();

  startTimer();

  // Khởi tạo micro + camera
  await initMedia();

  // Kết nối Socket.IO
  connectSocket();
}

// Lấy camera và microphone tối ưu chống giật lag
async function initMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640, max: 640 },
        height: { ideal: 360, max: 360 },
        frameRate: { ideal: 24, max: 24 },
        facingMode: 'user'
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 44100
      }
    });
    document.getElementById('local-video').srcObject = localStream;
    document.getElementById('local-no-cam').style.display = 'none';
  } catch (err) {
    console.warn('Không thể truy cập camera/mic:', err);
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
  socket = io({
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000
  });

  socket.on('connect', () => {
    console.log('🔌 Đã kết nối Socket.IO:', socket.id);
    const isCreator = sessionStorage.getItem('meetflow-is-creator') === 'true';
    socket.emit('join-room', { roomId, username, isCreator });
  });

  // Nhận chỉ định vai trò từ server (Chủ phòng / Học viên)
  socket.on('role-assignment', (data) => {
    isHost = data.isHost;
    console.log(`👑 Vai trò của bạn: ${isHost ? 'Chủ phòng (Người tạo lớp)' : 'Học viên'}`);

    if (isHost) {
      const roleBadge = document.getElementById('role-badge');
      if (roleBadge) roleBadge.style.display = 'flex';

      const leaveBtn = document.getElementById('btn-leave');
      if (leaveBtn) {
        leaveBtn.title = 'Kết thúc lớp học (Đóng phòng cho tất cả học viên)';
      }

      document.getElementById('local-name-tag').innerHTML = `👑 ${escapeHtml(username)} (Chủ phòng)`;
      showToast('👑 Bạn là người tạo lớp học');
    }
  });

  // Sự kiện khi phòng bị giải tán (Chủ phòng thoát)
  socket.on('room-ended', ({ message }) => {
    console.log('🛑 Nhận thông báo phòng kết thúc:', message);
    handleRoomTerminated(message);
  });

  // Nhận danh sách user đã có trong phòng
  socket.on('existing-users', (users) => {
    console.log('👥 Người đang trong phòng:', users);
    users.forEach(user => {
      createPeerConnection(user.userId, user.username, user.isHost, true);
    });
    updateParticipantCount();
  });

  // Có người mới vào
  socket.on('user-joined', ({ userId, username: peerName, isHost: peerIsHost }) => {
    console.log(`✅ ${peerName} đã vào phòng`);
    createPeerConnection(userId, peerName, peerIsHost, false);
    addSystemMessage(`${peerIsHost ? '👑 Chủ phòng' : 'Học viên'} ${peerName} đã tham gia`);
    updateParticipantCount();
    showToast(`👋 ${peerName} đã tham gia`);
  });

  // Nhận offer
  socket.on('offer', async ({ from, offer, username: peerName }) => {
    if (!peers[from]) {
      createPeerConnection(from, peerName, false, false);
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
    try {
      if (peers[from] && peers[from].pc.signalingState === 'have-local-offer') {
        await peers[from].pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    } catch (err) {
      console.error('Lỗi xử lý answer:', err);
    }
  });

  // Nhận ICE candidate
  socket.on('ice-candidate', async ({ from, candidate }) => {
    try {
      if (peers[from] && peers[from].pc.remoteDescription) {
        await peers[from].pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (err) {}
  });

  // Có người rời phòng (học viên thường)
  socket.on('user-left', ({ userId, username: peerName }) => {
    console.log(`❌ ${peerName} đã rời phòng`);
    removePeer(userId);
    addSystemMessage(`${peerName} đã rời phòng`);
    updateParticipantCount();
    showToast(`${peerName} đã rời phòng`);
  });

  // Chat
  socket.on('chat-message', ({ userId, username: senderName, isHost: msgIsHost, message, timestamp }) => {
    addChatMessage(senderName, msgIsHost, message, timestamp, userId === socket.id);
  });

  socket.on('disconnect', () => {
    showToast('⚠️ Đang ngắt kết nối...');
  });

  socket.on('reconnect', () => {
    showToast('✅ Đã kết nối lại');
    const isCreator = sessionStorage.getItem('meetflow-is-creator') === 'true';
    socket.emit('join-room', { roomId, username, isCreator });
  });
}

// Xử lý khi phòng bị đóng bởi chủ phòng
function handleRoomTerminated(reasonText) {
  // Dừng toàn bộ camera, mic, chia sẻ màn hình ngay lập tức
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
  }
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
  }

  // Đóng toàn bộ peer connection
  Object.values(peers).forEach(({ pc }) => pc.close());
  peers = {};

  if (timerInterval) clearInterval(timerInterval);

  // Hiển thị modal văng ra ngoài
  const endedModal = document.getElementById('ended-modal');
  const endedMsg = document.getElementById('ended-message');
  if (endedMsg && reasonText) {
    endedMsg.innerHTML = `${escapeHtml(reasonText)}<br><br>Bạn sẽ tự động văng về trang chủ trong <strong id="countdown-sec" style="color: #ff4757;">3</strong>s...`;
  }
  if (endedModal) {
    endedModal.style.display = 'flex';
  }

  // Đếm ngược 3 giây rồi văng ra trang chủ
  let count = 3;
  const countEl = document.getElementById('countdown-sec');
  const cdTimer = setInterval(() => {
    count--;
    if (countEl) countEl.textContent = count;
    if (count <= 0) {
      clearInterval(cdTimer);
      window.location.href = '/';
    }
  }, 1000);
}

// =========================================
// WebRTC - PEER CONNECTION
// =========================================

function createPeerConnection(peerId, peerUsername, peerIsHost, isInitiator) {
  const pc = new RTCPeerConnection(rtcConfig);
  peers[peerId] = { pc, username: peerUsername, isHost: peerIsHost };

  // Audio track
  if (localStream) {
    localStream.getAudioTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }

  // Video track (screen share hoặc camera)
  if (isScreenSharing && screenStream && screenStream.getVideoTracks().length > 0) {
    screenStream.getVideoTracks().forEach(track => {
      pc.addTrack(track, screenStream);
    });
  } else if (localStream) {
    localStream.getVideoTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }

  // Khi nhận video từ peer
  pc.ontrack = (event) => {
    let videoEl = document.getElementById(`video-${peerId}`);
    if (!videoEl) {
      videoEl = createVideoElement(peerId, peerUsername, peerIsHost);
    }
    if (event.streams && event.streams[0]) {
      videoEl.srcObject = event.streams[0];
    } else {
      let stream = videoEl.srcObject;
      if (!stream) {
        stream = new MediaStream();
        videoEl.srcObject = stream;
      }
      stream.addTrack(event.track);
    }
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', {
        to: peerId,
        candidate: event.candidate
      });
    }
  };

  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    if (state === 'failed') {
      pc.createOffer({ iceRestart: true })
        .then(offer => pc.setLocalDescription(offer))
        .then(() => {
          socket.emit('offer', { to: peerId, offer: pc.localDescription });
        })
        .catch(err => console.error('ICE restart failed:', err));
    }
    if (state === 'connected') {
      limitBandwidth(pc);
    }
  };

  if (isInitiator) {
    pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true
    })
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

// Giới hạn bandwidth tối ưu đường truyền
async function limitBandwidth(pc) {
  try {
    const senders = pc.getSenders();
    for (const sender of senders) {
      if (!sender.track) continue;
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      if (sender.track.kind === 'video') {
        params.encodings[0].maxBitrate = 500000;
        params.encodings[0].maxFramerate = 24;
      } else if (sender.track.kind === 'audio') {
        params.encodings[0].maxBitrate = 64000;
      }
      await sender.setParameters(params);
    }
  } catch (err) {}
}

// Tạo phần tử video cho peer
function createVideoElement(peerId, peerUsername, peerIsHost) {
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
  nameTag.innerHTML = peerIsHost
    ? `👑 ${escapeHtml(peerUsername)} <span style="font-size:11px; color:#ff9f43;">(Chủ phòng)</span>`
    : escapeHtml(peerUsername);

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
// ĐIỀU KHIỂN & RỜI PHÒNG
// =========================================

// Xử lý khi bấm nút Rời phòng / Kết thúc phòng
function handleLeaveButtonClick() {
  if (isHost) {
    // Nếu là chủ phòng -> Hỏi xác nhận kết thúc lớp học
    const confirmEnd = confirm(
      "⚠️ BẠN LÀ NGƯỜI TẠO LỚP HỌC!\n\n" +
      "Nếu bạn thoát, buổi học này sẽ KẾT THÚC và TẤT CẢ mọi người sẽ tự động bị văng ra ngoài.\n\n" +
      "Bạn có chắc chắn muốn kết thúc lớp học không?"
    );

    if (confirmEnd) {
      if (socket) {
        socket.emit('end-room');
      }
      cleanupAndExit();
    }
  } else {
    // Học viên thường rời phòng
    const confirmLeave = confirm("Bạn có muốn rời khỏi lớp học này không?");
    if (confirmLeave) {
      cleanupAndExit();
    }
  }
}

function cleanupAndExit() {
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (screenStream) screenStream.getTracks().forEach(t => t.stop());
  Object.values(peers).forEach(({ pc }) => pc.close());
  peers = {};
  if (socket) socket.disconnect();
  if (timerInterval) clearInterval(timerInterval);
  window.location.href = '/';
}

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

async function toggleScreenShare() {
  if (!isScreenSharing) {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { max: 15 }
        },
        audio: false
      });
      const screenTrack = screenStream.getVideoTracks()[0];

      for (const [peerId, { pc }] of Object.entries(peers)) {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
          try {
            await sender.replaceTrack(screenTrack);
          } catch (err) {}
        }
      }

      document.getElementById('local-video').srcObject = screenStream;
      document.getElementById('local-no-cam').style.display = 'none';
      isScreenSharing = true;

      document.getElementById('btn-screen').classList.add('sharing');
      showToast('🖥️ Đang chia sẻ màn hình');

      screenTrack.onended = () => stopScreenShare();
    } catch (err) {
      console.log('Hủy chia sẻ màn hình');
    }
  } else {
    stopScreenShare();
  }
}

async function stopScreenShare() {
  if (!isScreenSharing) return;

  const videoTrack = localStream.getVideoTracks()[0];

  for (const [peerId, { pc }] of Object.entries(peers)) {
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender && videoTrack) {
      try {
        await sender.replaceTrack(videoTrack);
      } catch (err) {}
    }
  }

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

function toggleChat() {
  isChatOpen = !isChatOpen;
  document.getElementById('chat-panel').classList.toggle('open', isChatOpen);
  const btn = document.getElementById('btn-chat');

  if (isChatOpen) {
    btn.classList.add('active');
    unreadCount = 0;
    document.getElementById('chat-badge').style.display = 'none';
    setTimeout(() => {
      document.getElementById('chat-input').focus();
    }, 300);
  } else {
    btn.classList.remove('active');
  }
}

function sendMessage() {
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;

  socket.emit('chat-message', { roomId, message });
  input.value = '';
  input.focus();
}

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

// =========================================
// CHAT UI
// =========================================

function addChatMessage(name, msgIsHost, message, timestamp, isMe) {
  const empty = document.querySelector('.chat-empty');
  if (empty) empty.remove();

  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `chat-message ${isMe ? 'me' : ''}`;

  const time = new Date(timestamp).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit'
  });

  const senderLabel = isMe
    ? (isHost ? 'Bạn (👑 Chủ phòng)' : 'Bạn')
    : (msgIsHost ? `👑 ${escapeHtml(name)}` : escapeHtml(name));

  div.innerHTML = `
    <div class="chat-message-header">
      <span class="chat-name">${senderLabel}</span>
      <span class="chat-time">${time}</span>
    </div>
    <div class="chat-text">${escapeHtml(message)}</div>
  `;

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;

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

function updateGridLayout() {
  const grid = document.getElementById('video-grid');
  const count = grid.children.length;
  grid.setAttribute('data-count', Math.min(count, 6));
}

function updateParticipantCount() {
  const count = Object.keys(peers).length + 1;
  document.getElementById('participant-count').textContent = count;
}

function startTimer() {
  callStartTime = Date.now();
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    document.getElementById('call-timer').textContent = `${mins}:${secs}`;
  }, 1000);
}

function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

window.addEventListener('beforeunload', () => {
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (screenStream) screenStream.getTracks().forEach(t => t.stop());
});
