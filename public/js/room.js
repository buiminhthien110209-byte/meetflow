// =========================================
// MeetFlow - Room Logic (Enterprise Grade & Low Latency)
// =========================================

// ---- Biến toàn cục ----
const roomId = window.location.pathname.split('/').pop();
let localStream = null;
let screenStream = null;
let socket = null;
let username = '';
let isHost = false;
let currentRoomMode = 'classroom'; // 'classroom' | 'meeting' | 'interview'
let peers = {}; // { peerId: { pc: RTCPeerConnection, username: string, isHost: boolean, isHandRaised: boolean } }

// Trạng thái UI cuộc gọi
let isMuted = false;
let isCameraOff = false;
let isScreenSharing = false;
let isHandRaised = false;

// Trạng thái Sidebar (Chat & Thành viên)
let isSidePanelOpen = false;
let activeSideTab = 'chat'; // 'chat' | 'participants'
let unreadCount = 0;
let callStartTime = null;
let timerInterval = null;

// Trạng thái Bảng trắng tương tác
let isWhiteboardOpen = false;
let wbCanvas = null;
let wbCtx = null;
let wbDrawing = false;
let wbTool = 'pen'; // 'pen' | 'eraser'
let wbColor = '#0f172a';
let wbSize = 3;
let lastWbX = 0;
let lastWbY = 0;

// Cấu hình WebRTC tối ưu đường truyền cực nhanh:
// Ưu tiên Google STUN & Cloudflare STUN (đặt server tại Đông Nam Á / Việt Nam)
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    // TURN fallback khi bị chặn NAT cứng
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ],
  bundlePolicy: 'max-bundle', // Gom toàn bộ Audio + Video vào 1 cổng mạng duy nhất -> giảm 50% độ trễ
  rtcpMuxPolicy: 'require',
  iceCandidatePoolSize: 2
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

  // Khởi tạo bảng vẽ
  initWhiteboard();
});

// Vào phòng
async function joinCall() {
  const nameInput = document.getElementById('modal-name-input');
  username = nameInput.value.trim() || 'Ẩn danh';

  document.getElementById('join-modal').classList.add('hidden');
  document.getElementById('room-container').style.display = 'flex';

  document.getElementById('room-id-display').textContent = roomId;
  document.getElementById('username-display').textContent = username;
  document.getElementById('local-name-tag').textContent = username + ' (Bạn)';
  document.getElementById('local-avatar').textContent = username.charAt(0).toUpperCase();

  startTimer();

  // Khởi tạo camera + mic độ trễ cực thấp
  await initMedia();

  // Áp dụng cài đặt tắt mic / cam từ trang chủ nếu có
  if (sessionStorage.getItem('meetflow-mute-mic') === 'true') {
    toggleMute();
  }
  if (sessionStorage.getItem('meetflow-mute-cam') === 'true') {
    toggleCamera();
  }

  // Kết nối socket
  connectSocket();
  updateParticipantsList();
}

// Cấu hình Camera & Mic chống lag, giảm tải CPU & băng thông
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
        channelCount: 1, // Kênh Mono (giảm 50% dữ liệu truyền tải, chống nghẽn mic)
        sampleRate: 48000,
        latency: 0 // Yêu cầu độ trễ âm thanh bằng 0
      }
    });

    const localVideo = document.getElementById('local-video');
    localVideo.srcObject = localStream;
  } catch (err) {
    console.warn('Không thể mở camera/mic:', err);
    isCameraOff = true;
    isMuted = true;
    document.getElementById('local-no-cam').style.display = 'flex';
    document.getElementById('btn-camera').classList.replace('active', 'off');
    document.getElementById('btn-camera').innerHTML = '<i class="fas fa-video-slash"></i>';
    document.getElementById('btn-mic').classList.replace('active', 'off');
    document.getElementById('btn-mic').innerHTML = '<i class="fas fa-microphone-slash"></i>';
    showToast('⚠️ Không thể truy cập Camera/Microphone');
  }
}

// =========================================
// SOCKET.IO SIGNALING & SỰ KIỆN PHÒNG
// =========================================

function connectSocket() {
  socket = io();

  const isCreator = sessionStorage.getItem('meetflow-creator') === 'true';
  const savedMode = sessionStorage.getItem('meetflow-room-mode') || 'classroom';

  socket.emit('join-room', {
    roomId,
    username,
    isCreator,
    roomMode: savedMode
  });

  socket.on('role-assignment', (data) => {
    isHost = data.isHost;
    currentRoomMode = data.roomMode || 'classroom';

    const modeBadge = document.getElementById('mode-badge');
    const modeIcon = document.getElementById('mode-icon');
    const modeText = document.getElementById('mode-text');
    const roleBadge = document.getElementById('role-badge');
    const roleIcon = document.getElementById('role-icon');
    const roleText = document.getElementById('role-text');
    const leaveBtn = document.getElementById('btn-leave');

    // Cập nhật giao diện & Tab title
    if (currentRoomMode === 'classroom') {
      document.title = `MeetFlow — Lớp học: ${roomId}`;
      if (modeIcon) modeIcon.className = 'fas fa-graduation-cap';
      if (modeText) modeText.textContent = 'Lớp học trực tuyến';
      if (modeBadge) {
        modeBadge.style.background = 'rgba(79, 70, 229, 0.1)';
        modeBadge.style.color = '#4f46e5';
        modeBadge.style.borderColor = 'rgba(79, 70, 229, 0.25)';
      }
      if (isHost) {
        if (roleBadge) {
          roleBadge.style.display = 'flex';
          roleText.textContent = 'Giáo viên';
          if (roleIcon) roleIcon.className = 'fas fa-chalkboard-teacher';
        }
        document.getElementById('local-name-tag').innerHTML = `👑 ${escapeHtml(username)} (Giáo viên)`;
        if (leaveBtn) leaveBtn.title = 'Giải tán & Kết thúc lớp học';
        showToast('👨‍🏫 Bạn là Giáo viên (Chủ phòng)');
      } else {
        document.getElementById('local-name-tag').innerHTML = `👩‍🎓 ${escapeHtml(username)} (Học viên)`;
      }
    } else if (currentRoomMode === 'meeting') {
      document.title = `MeetFlow — Cuộc họp: ${roomId}`;
      if (modeIcon) modeIcon.className = 'fas fa-users-rectangle';
      if (modeText) modeText.textContent = 'Cuộc họp nhóm';
      if (modeBadge) {
        modeBadge.style.background = 'rgba(2, 132, 199, 0.1)';
        modeBadge.style.color = '#0284c7';
        modeBadge.style.borderColor = 'rgba(2, 132, 199, 0.25)';
      }
      if (isHost) {
        if (roleBadge) {
          roleBadge.style.display = 'flex';
          roleText.textContent = 'Người tổ chức';
          if (roleIcon) roleIcon.className = 'fas fa-star';
        }
        document.getElementById('local-name-tag').innerHTML = `⭐ ${escapeHtml(username)} (Người tổ chức)`;
        if (leaveBtn) leaveBtn.title = 'Rời hoặc kết thúc cuộc họp';
        showToast('⭐ Bạn là Người tổ chức cuộc họp');
      } else {
        document.getElementById('local-name-tag').innerHTML = `${escapeHtml(username)} (Thành viên)`;
      }
    } else if (currentRoomMode === 'interview') {
      document.title = `MeetFlow — Phỏng vấn: ${roomId}`;
      if (modeIcon) modeIcon.className = 'fas fa-user-tie';
      if (modeText) modeText.textContent = 'Phỏng vấn tuyển dụng';
      if (modeBadge) {
        modeBadge.style.background = 'rgba(217, 119, 6, 0.1)';
        modeBadge.style.color = '#d97706';
        modeBadge.style.borderColor = 'rgba(217, 119, 6, 0.25)';
      }
      if (isHost) {
        if (roleBadge) {
          roleBadge.style.display = 'flex';
          roleText.textContent = 'Nhà tuyển dụng';
          if (roleIcon) roleIcon.className = 'fas fa-briefcase';
        }
        document.getElementById('local-name-tag').innerHTML = `👔 ${escapeHtml(username)} (Nhà tuyển dụng)`;
        if (leaveBtn) leaveBtn.title = 'Hoàn tất phỏng vấn & Đóng phòng';
        showToast('👔 Bạn là Nhà tuyển dụng (Interviewer)');
      } else {
        document.getElementById('local-name-tag').innerHTML = `🎯 ${escapeHtml(username)} (Ứng viên)`;
        showToast('🎯 Chế độ Phỏng vấn: Bạn là Ứng viên');
      }
    }

    updateParticipantsList();
  });

  socket.on('room-ended', ({ message }) => {
    handleRoomTerminated(message);
  });

  socket.on('existing-users', (users) => {
    users.forEach(user => {
      createPeerConnection(user.userId, user.username, user.isHost, true);
    });
    updateParticipantCount();
    updateParticipantsList();
  });

  socket.on('user-joined', ({ userId, username: peerName, isHost: peerIsHost }) => {
    createPeerConnection(userId, peerName, peerIsHost, false);
    addSystemMessage(`${peerIsHost ? '👑 Chủ phòng' : 'Thành viên'} ${peerName} đã tham gia`);
    updateParticipantCount();
    updateParticipantsList();
    showToast(`👋 ${peerName} đã tham gia`);
  });

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
      console.error('Lỗi offer:', err);
    }
  });

  socket.on('answer', async ({ from, answer }) => {
    try {
      if (peers[from] && peers[from].pc.signalingState === 'have-local-offer') {
        await peers[from].pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    } catch (err) {
      console.error('Lỗi answer:', err);
    }
  });

  socket.on('ice-candidate', async ({ from, candidate }) => {
    try {
      if (peers[from] && peers[from].pc.remoteDescription) {
        await peers[from].pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (err) {}
  });

  socket.on('user-left', ({ userId, username: peerName }) => {
    removePeer(userId);
    addSystemMessage(`${peerName} đã rời phòng`);
    updateParticipantCount();
    updateParticipantsList();
    showToast(`${peerName} đã rời phòng`);
  });

  socket.on('chat-message', ({ userId, username: senderName, isHost: msgIsHost, message, timestamp }) => {
    const isMe = (userId === socket.id);
    addChatMessage(senderName, msgIsHost, message, timestamp, isMe);
  });

  // Nhận thông báo giơ tay
  socket.on('user-raise-hand', ({ userId, username: senderName, raised }) => {
    if (peers[userId]) {
      peers[userId].isHandRaised = raised;
      const handBadge = document.getElementById(`hand-${userId}`);
      if (handBadge) {
        handBadge.style.display = raised ? 'inline-flex' : 'none';
      }
    }
    if (raised) {
      playChime('hand');
      showToast(`✋ ${senderName} vừa giơ tay phát biểu`);
    }
    updateParticipantsList();
  });

  // Nhận nét vẽ từ bảng trắng
  socket.on('whiteboard-draw', (data) => {
    handleRemoteDraw(data);
  });

  socket.on('whiteboard-clear', () => {
    clearWhiteboard(false);
  });
}

// Xử lý khi phòng kết thúc
function handleRoomTerminated(message) {
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (screenStream) screenStream.getTracks().forEach(t => t.stop());

  const roomContainer = document.getElementById('room-container');
  const endedModal = document.getElementById('ended-modal');
  const endedMsg = document.getElementById('ended-message');

  if (roomContainer) roomContainer.style.display = 'none';
  if (endedMsg && message) endedMsg.textContent = message;
  if (endedModal) {
    endedModal.classList.remove('hidden');
    endedModal.style.display = 'flex';
  }

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
// WebRTC - TỐI ƯU HÓA PEER CONNECTION
// =========================================

function createPeerConnection(peerId, peerUsername, peerIsHost, isInitiator) {
  const pc = new RTCPeerConnection(rtcConfig);
  peers[peerId] = { pc, username: peerUsername, isHost: peerIsHost, isHandRaised: false };

  // Audio track
  if (localStream) {
    localStream.getAudioTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }

  // Video track
  if (isScreenSharing && screenStream && screenStream.getVideoTracks().length > 0) {
    screenStream.getVideoTracks().forEach(track => {
      pc.addTrack(track, screenStream);
    });
  } else if (localStream) {
    localStream.getVideoTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }

  // Ưu tiên Codec H.264
  optimizeCodecPreferences(pc);

  // Khi nhận video từ người khác
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
    videoEl.play().catch(() => {});
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
        .catch(err => console.error('ICE restart:', err));
    }
    if (state === 'connected') {
      tuneSenderParameters(pc);
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

// Ưu tiên Codec H.264 phần cứng
function optimizeCodecPreferences(pc) {
  try {
    if ('RTCRtpReceiver' in window && 'getCapabilities' in RTCRtpReceiver) {
      const capabilities = RTCRtpReceiver.getCapabilities('video');
      if (capabilities && capabilities.codecs) {
        const h264Codecs = capabilities.codecs.filter(c => c.mimeType.toLowerCase() === 'video/h264');
        const otherCodecs = capabilities.codecs.filter(c => c.mimeType.toLowerCase() !== 'video/h264');
        const sortedCodecs = [...h264Codecs, ...otherCodecs];

        const transceivers = pc.getTransceivers();
        for (const transceiver of transceivers) {
          if (transceiver.receiver && transceiver.receiver.track && transceiver.receiver.track.kind === 'video') {
            if ('setCodecPreferences' in transceiver) {
              transceiver.setCodecPreferences(sortedCodecs);
            }
          }
        }
      }
    }
  } catch (e) {}
}

// Cấu hình bitrate mượt mà
async function tuneSenderParameters(pc) {
  try {
    const senders = pc.getSenders();
    for (const sender of senders) {
      if (!sender.track) continue;
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }

      if (sender.track.kind === 'video') {
        params.degradationPreference = 'maintain-framerate';
        params.encodings[0].maxBitrate = 350000;
        params.encodings[0].maxFramerate = 24;
      } else if (sender.track.kind === 'audio') {
        params.encodings[0].maxBitrate = 32000;
      }
      await sender.setParameters(params);
    }
  } catch (err) {}
}

function createVideoElement(peerId, peerUsername, peerIsHost) {
  const grid = document.getElementById('video-grid');

  const container = document.createElement('div');
  container.className = 'video-container';
  container.id = `container-${peerId}`;

  const video = document.createElement('video');
  video.id = `video-${peerId}`;
  video.autoplay = true;
  video.playsInline = true;

  let peerLabel = escapeHtml(peerUsername);
  if (currentRoomMode === 'classroom') {
    peerLabel = peerIsHost
      ? `👑 ${escapeHtml(peerUsername)} <span style="font-size:11px; color:#a78bfa;">(Giáo viên)</span>`
      : `👩‍🎓 ${escapeHtml(peerUsername)} <span style="font-size:11px; color:#cbd5e1;">(Học viên)</span>`;
  } else if (currentRoomMode === 'meeting') {
    peerLabel = peerIsHost
      ? `⭐ ${escapeHtml(peerUsername)} <span style="font-size:11px; color:#38bdf8;">(Người tổ chức)</span>`
      : `${escapeHtml(peerUsername)}`;
  } else if (currentRoomMode === 'interview') {
    peerLabel = peerIsHost
      ? `👔 ${escapeHtml(peerUsername)} <span style="font-size:11px; color:#fbbf24;">(Nhà tuyển dụng)</span>`
      : `🎯 ${escapeHtml(peerUsername)} <span style="font-size:11px; color:#34d399;">(Ứng viên)</span>`;
  }

  const nameTag = document.createElement('div');
  nameTag.className = 'video-name-tag';
  nameTag.innerHTML = peerLabel;

  const handBadge = document.createElement('div');
  handBadge.className = 'hand-raised-badge';
  handBadge.id = `hand-${peerId}`;
  handBadge.style.display = 'none';
  handBadge.innerHTML = '<i class="fas fa-hand"></i> Đang giơ tay';

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
  container.appendChild(handBadge);
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
    container.classList.add('removing');
    setTimeout(() => {
      container.remove();
      updateGridLayout();
    }, 200);
  }
}

// =========================================
// ĐIỀU KHIỂN RỜI PHÒNG & GIẢI TÁN
// =========================================

function handleLeaveButtonClick() {
  if (isHost) {
    if (currentRoomMode === 'classroom') {
      const confirmEnd = confirm(
        '⚠️ BẠN LÀ GIÁO VIÊN (CHỦ PHÒNG)\n\n' +
        'Nếu bạn rời đi, toàn bộ lớp học sẽ ĐƯỢC GIẢI TÁN và tất cả học viên sẽ tự động văng về trang chủ.\n\n' +
        'Bạn có chắc chắn muốn kết thúc buổi học này không?'
      );
      if (confirmEnd) {
        socket.emit('end-room');
        leaveCall();
      }
    } else if (currentRoomMode === 'interview') {
      const confirmEnd = confirm(
        '👔 BẠN LÀ NHÀ TUYỂN DỤNG\n\n' +
        'Bạn có muốn hoàn tất buổi phỏng vấn và đóng phòng họp này không?'
      );
      if (confirmEnd) {
        socket.emit('end-room');
        leaveCall();
      }
    } else if (currentRoomMode === 'meeting') {
      const choice = confirm(
        '💼 TÙY CHỌN RỜI CUỘC HỌP:\n\n' +
        '• Bấm OK: Để KẾT THÚC cuộc họp cho tất cả mọi người.\n' +
        '• Bấm CANCEL (HỦY): Để chỉ MỘT MÌNH BẠN rời đi (cuộc họp vẫn tiếp tục cho thành viên khác).'
      );
      if (choice) {
        socket.emit('end-room');
        leaveCall();
      } else {
        leaveCall();
      }
    }
  } else {
    const confirmLeave = confirm('Bạn có chắc chắn muốn rời khỏi phòng họp không?');
    if (confirmLeave) {
      leaveCall();
    }
  }
}

function leaveCall() {
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (screenStream) screenStream.getTracks().forEach(t => t.stop());
  for (const peerId of Object.keys(peers)) {
    peers[peerId].pc.close();
  }
  peers = {};
  if (socket) socket.disconnect();
  if (timerInterval) clearInterval(timerInterval);
  window.location.href = '/';
}

// =========================================
// CONTROLS: MIC, CAMERA, SCREEN, HAND, REACTIONS
// =========================================

function toggleMute() {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(track => {
    track.enabled = !isMuted;
  });
  const btn = document.getElementById('btn-mic');
  if (isMuted) {
    btn.classList.remove('active');
    btn.classList.add('off');
    btn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
    showToast('🔇 Đã tắt Micro');
  } else {
    btn.classList.remove('off');
    btn.classList.add('active');
    btn.innerHTML = '<i class="fas fa-microphone"></i>';
    showToast('🎙️ Đã bật Micro');
  }
  updateParticipantsList();
}

function toggleCamera() {
  if (!localStream) return;
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
    showToast('📷 Đã tắt Camera');
  } else {
    btn.classList.remove('off');
    btn.classList.add('active');
    btn.innerHTML = '<i class="fas fa-video"></i>';
    document.getElementById('local-no-cam').style.display = 'none';
    showToast('📷 Đã bật Camera');
  }
}

async function toggleScreenShare() {
  if (!isScreenSharing) {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          width: { ideal: 1280, max: 1280 },
          height: { ideal: 720, max: 720 },
          frameRate: { ideal: 15, max: 15 }
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

  const videoTrack = localStream ? localStream.getVideoTracks()[0] : null;

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

// Giơ tay phát biểu
function toggleHandRaise() {
  isHandRaised = !isHandRaised;
  const btn = document.getElementById('btn-hand');
  const localBadge = document.getElementById('local-hand-badge');

  if (isHandRaised) {
    btn.classList.add('hand-raised');
    if (localBadge) localBadge.style.display = 'inline-flex';
    playChime('hand');
    showToast('✋ Bạn đang giơ tay phát biểu');
  } else {
    btn.classList.remove('hand-raised');
    if (localBadge) localBadge.style.display = 'none';
    showToast('Đã hạ tay');
  }

  if (socket) {
    socket.emit('raise-hand', { roomId, raised: isHandRaised });
  }

  updateParticipantsList();
}

// =========================================
// BẢNG TRẮNG TƯƠNG TÁC (Collaborative Whiteboard)
// =========================================

function initWhiteboard() {
  wbCanvas = document.getElementById('whiteboard-canvas');
  if (!wbCanvas) return;
  wbCtx = wbCanvas.getContext('2d');

  function resizeCanvas() {
    if (!wbCanvas || !wbCanvas.parentElement) return;
    const rect = wbCanvas.parentElement.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      // Sao lưu nội dung cũ trước khi resize
      const imgData = wbCtx.getImageData(0, 0, wbCanvas.width, wbCanvas.height);
      wbCanvas.width = rect.width;
      wbCanvas.height = rect.height;
      wbCtx.putImageData(imgData, 0, 0);
    }
  }

  window.addEventListener('resize', resizeCanvas);

  // Sự kiện vẽ bằng chuột
  wbCanvas.addEventListener('mousedown', (e) => {
    wbDrawing = true;
    const { x, y } = getCanvasPos(e);
    lastWbX = x;
    lastWbY = y;
  });

  wbCanvas.addEventListener('mousemove', (e) => {
    if (!wbDrawing) return;
    const { x, y } = getCanvasPos(e);
    drawStroke(lastWbX, lastWbY, x, y, wbColor, wbSize, wbTool, true);
    lastWbX = x;
    lastWbY = y;
  });

  window.addEventListener('mouseup', () => {
    wbDrawing = false;
  });

  // Hỗ trợ cảm ứng (Touch / iPad / Điện thoại)
  wbCanvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    wbDrawing = true;
    const touch = e.touches[0];
    const { x, y } = getCanvasPos(touch);
    lastWbX = x;
    lastWbY = y;
  }, { passive: false });

  wbCanvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (!wbDrawing) return;
    const touch = e.touches[0];
    const { x, y } = getCanvasPos(touch);
    drawStroke(lastWbX, lastWbY, x, y, wbColor, wbSize, wbTool, true);
    lastWbX = x;
    lastWbY = y;
  }, { passive: false });

  window.addEventListener('touchend', () => {
    wbDrawing = false;
  });
}

function getCanvasPos(e) {
  const rect = wbCanvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  };
}

function drawStroke(x0, y0, x1, y1, color, size, tool, emit) {
  if (!wbCtx) return;
  wbCtx.beginPath();
  wbCtx.moveTo(x0, y0);
  wbCtx.lineTo(x1, y1);
  wbCtx.lineCap = 'round';
  wbCtx.lineJoin = 'round';

  if (tool === 'eraser') {
    wbCtx.strokeStyle = '#ffffff';
    wbCtx.lineWidth = size * 3;
  } else {
    wbCtx.strokeStyle = color;
    wbCtx.lineWidth = size;
  }

  wbCtx.stroke();
  wbCtx.closePath();

  if (emit && socket) {
    socket.emit('whiteboard-draw', {
      roomId,
      drawData: {
        x0: x0 / wbCanvas.width,
        y0: y0 / wbCanvas.height,
        x1: x1 / wbCanvas.width,
        y1: y1 / wbCanvas.height,
        color,
        size,
        tool
      }
    });
  }
}

function handleRemoteDraw(data) {
  if (!wbCanvas) return;
  const x0 = data.x0 * wbCanvas.width;
  const y0 = data.y0 * wbCanvas.height;
  const x1 = data.x1 * wbCanvas.width;
  const y1 = data.y1 * wbCanvas.height;
  drawStroke(x0, y0, x1, y1, data.color, data.size, data.tool, false);
}

function toggleWhiteboard() {
  const modal = document.getElementById('whiteboard-modal');
  const btn = document.getElementById('btn-whiteboard');
  isWhiteboardOpen = !isWhiteboardOpen;

  if (isWhiteboardOpen) {
    modal.style.display = 'flex';
    btn.classList.add('active');
    setTimeout(() => {
      const rect = wbCanvas.parentElement.getBoundingClientRect();
      wbCanvas.width = rect.width;
      wbCanvas.height = rect.height;
    }, 50);
  } else {
    modal.style.display = 'none';
    btn.classList.remove('active');
  }
}

function setWbTool(tool) {
  wbTool = tool;
  document.getElementById('wb-tool-pen').classList.toggle('active', tool === 'pen');
  document.getElementById('wb-tool-eraser').classList.toggle('active', tool === 'eraser');
}

function setWbColor(color) {
  wbColor = color;
  setWbTool('pen');
  document.querySelectorAll('.wb-color-dot').forEach(dot => {
    dot.classList.toggle('active', dot.style.background === color || dot.style.backgroundColor === color);
  });
}

function setWbSize(size) {
  wbSize = parseInt(size, 10);
}

function clearWhiteboard(emit) {
  if (!wbCtx || !wbCanvas) return;
  wbCtx.clearRect(0, 0, wbCanvas.width, wbCanvas.height);
  if (emit && socket) {
    socket.emit('whiteboard-clear', { roomId });
    showToast('🧹 Đã xóa toàn bộ bảng trắng');
  }
}

function saveWhiteboardImage() {
  if (!wbCanvas) return;
  const link = document.createElement('a');
  link.download = `MeetFlow-Whiteboard-${roomId}.png`;
  link.href = wbCanvas.toDataURL('image/png');
  link.click();
  showToast('📥 Đã tải ảnh bảng vẽ về máy!');
}

// =========================================
// SIDEBAR (CHAT & PARTICIPANTS)
// =========================================

function toggleSidePanel() {
  isSidePanelOpen = !isSidePanelOpen;
  const panel = document.getElementById('side-panel');
  const btn = document.getElementById('btn-chat');

  panel.classList.toggle('open', isSidePanelOpen);
  btn.classList.toggle('active', isSidePanelOpen);

  if (isSidePanelOpen) {
    unreadCount = 0;
    const badge = document.getElementById('chat-badge');
    const btnBadge = document.getElementById('chat-badge-btn');
    if (badge) badge.style.display = 'none';
    if (btnBadge) btnBadge.style.display = 'none';
    if (activeSideTab === 'chat') {
      setTimeout(() => document.getElementById('chat-input').focus(), 250);
    }
  }
}

function switchSideTab(tab) {
  activeSideTab = tab;
  const chatTabBtn = document.getElementById('tab-btn-chat');
  const partTabBtn = document.getElementById('tab-btn-participants');
  const chatContent = document.getElementById('panel-content-chat');
  const partContent = document.getElementById('panel-content-participants');

  if (tab === 'chat') {
    chatTabBtn.classList.add('active');
    partTabBtn.classList.remove('active');
    chatContent.classList.add('active');
    partContent.classList.remove('active');
    setTimeout(() => document.getElementById('chat-input').focus(), 150);
  } else {
    chatTabBtn.classList.remove('active');
    partTabBtn.classList.add('active');
    chatContent.classList.remove('active');
    partContent.classList.add('active');
    updateParticipantsList();
  }
}

function openParticipantsTab() {
  if (!isSidePanelOpen) {
    toggleSidePanel();
  }
  switchSideTab('participants');
}

function updateParticipantsList() {
  const container = document.getElementById('participants-list');
  if (!container) return;

  const totalCount = Object.keys(peers).length + 1;
  const countEl = document.getElementById('panel-participant-count');
  if (countEl) countEl.textContent = totalCount;

  container.innerHTML = '';

  // 1. Thêm bản thân (Local user)
  let myRoleName = 'Thành viên';
  if (currentRoomMode === 'classroom') {
    myRoleName = isHost ? 'Giáo viên (Chủ phòng)' : 'Học viên';
  } else if (currentRoomMode === 'meeting') {
    myRoleName = isHost ? 'Người tổ chức' : 'Thành viên';
  } else if (currentRoomMode === 'interview') {
    myRoleName = isHost ? 'Nhà tuyển dụng' : 'Ứng viên';
  }

  const myItem = document.createElement('div');
  myItem.className = 'participant-item';
  myItem.innerHTML = `
    <div class="participant-info">
      <div class="participant-avatar-badge">${username.charAt(0).toUpperCase()}</div>
      <div class="participant-name-wrap">
        <span class="participant-name-text">${escapeHtml(username)} (Bạn)</span>
        <span class="participant-role-pill ${isHost ? 'host' : 'member'}">${myRoleName}</span>
      </div>
    </div>
    <div class="participant-status-icons">
      ${isHandRaised ? '<span class="participant-hand-icon" title="Đang giơ tay">✋</span>' : ''}
      <i class="fas ${isMuted ? 'fa-microphone-slash text-danger' : 'fa-microphone text-success'}"></i>
    </div>
  `;
  container.appendChild(myItem);

  // 2. Thêm các peers
  for (const [peerId, peer] of Object.entries(peers)) {
    let peerRoleName = 'Thành viên';
    if (currentRoomMode === 'classroom') {
      peerRoleName = peer.isHost ? 'Giáo viên' : 'Học viên';
    } else if (currentRoomMode === 'meeting') {
      peerRoleName = peer.isHost ? 'Người tổ chức' : 'Thành viên';
    } else if (currentRoomMode === 'interview') {
      peerRoleName = peer.isHost ? 'Nhà tuyển dụng' : 'Ứng viên';
    }

    const item = document.createElement('div');
    item.className = 'participant-item';
    item.innerHTML = `
      <div class="participant-info">
        <div class="participant-avatar-badge">${peer.username.charAt(0).toUpperCase()}</div>
        <div class="participant-name-wrap">
          <span class="participant-name-text">${escapeHtml(peer.username)}</span>
          <span class="participant-role-pill ${peer.isHost ? 'host' : 'member'}">${peerRoleName}</span>
        </div>
      </div>
      <div class="participant-status-icons">
        ${peer.isHandRaised ? '<span class="participant-hand-icon" title="Đang giơ tay">✋</span>' : ''}
        <i class="fas fa-microphone text-success"></i>
      </div>
    `;
    container.appendChild(item);
  }
}

// =========================================
// CHAT UI
// =========================================

function sendMessage() {
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;

  socket.emit('chat-message', { roomId, message });
  input.value = '';
  input.focus();
}

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

  let senderLabel = isMe ? 'Bạn' : escapeHtml(name);
  if (msgIsHost) {
    if (currentRoomMode === 'classroom') senderLabel += ' 👨‍🏫';
    else if (currentRoomMode === 'interview') senderLabel += ' 👔';
    else senderLabel += ' 👑';
  }

  div.innerHTML = `
    <div class="chat-message-header">
      <span class="chat-name">${senderLabel}</span>
      <span class="chat-time">${time}</span>
    </div>
    <div class="chat-text">${escapeHtml(message)}</div>
  `;

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;

  if (!isSidePanelOpen && !isMe) {
    unreadCount++;
    const badge = document.getElementById('chat-badge');
    const btnBadge = document.getElementById('chat-badge-btn');
    if (badge) {
      badge.style.display = 'inline-block';
      badge.textContent = unreadCount;
    }
    if (btnBadge) {
      btnBadge.style.display = 'flex';
      btnBadge.textContent = unreadCount;
    }
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
// TIỆN ÍCH & ÂM THANH WEB AUDIO API
// =========================================

function playChime(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.frequency.setValueAtTime(440, ctx.currentTime); // A4
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.25); // A5
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (e) {}
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
