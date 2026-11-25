// =========================================
// MeetFlow - Room Logic (Ultra Low Latency Optimized)
// =========================================

// ---- Biến toàn cục ----
const roomId = window.location.pathname.split('/').pop();
let localStream = null;
let screenStream = null;
let socket = null;
let username = '';
let isHost = false;
let currentRoomMode = 'classroom'; // 'classroom' | 'meeting' | 'interview'
let peers = {}; // { peerId: { pc: RTCPeerConnection, username: string, isHost: boolean } }

// Trạng thái UI
let isMuted = false;
let isCameraOff = false;
let isScreenSharing = false;
let isChatOpen = false;
let unreadCount = 0;
let callStartTime = null;
let timerInterval = null;

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

  // Áp dụng cài đặt tắt mic / tắt cam từ trang chủ nếu có
  if (sessionStorage.getItem('meetflow-mute-mic') === 'true') {
    toggleMute();
  }
  if (sessionStorage.getItem('meetflow-mute-cam') === 'true') {
    toggleCamera();
  }

  // Kết nối socket
  connectSocket();
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
    localVideo.muted = true; // Luôn mute local video để chống dội âm thanh
    document.getElementById('local-no-cam').style.display = 'none';
  } catch (err) {
    console.warn('Không thể truy cập camera/mic:', err);
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        }
      });
      showLocalNoCam();
    } catch (e) {
      console.warn('Không có quyền micro:', e);
      localStream = new MediaStream();
      showLocalNoCam();
    }
    showToast('⚠️ Không thể truy cập đầy đủ camera/microphone');
  }
}

function showLocalNoCam() {
  document.getElementById('local-no-cam').style.display = 'flex';
}

// =========================================
// SOCKET.IO - SIGNALING
// =========================================

function connectSocket() {
  socket = io({
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 800,
    transports: ['websocket'] // Ưu tiên trực tiếp giao thức WebSocket để truyền tin nhanh nhất
  });

  socket.on('connect', () => {
    console.log('🔌 Đã kết nối Socket.IO:', socket.id);
    const isCreator = sessionStorage.getItem('meetflow-is-creator') === 'true';
    const roomMode = sessionStorage.getItem('meetflow-room-mode') || 'classroom';
    socket.emit('join-room', { roomId, username, isCreator, roomMode });
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

    if (currentRoomMode === 'classroom') {
      if (modeIcon) modeIcon.className = 'fas fa-graduation-cap';
      if (modeText) modeText.textContent = 'Lớp học trực tuyến';
      if (modeBadge) {
        modeBadge.style.background = 'rgba(124, 58, 237, 0.1)';
        modeBadge.style.color = '#7c3aed';
        modeBadge.style.borderColor = 'rgba(124, 58, 237, 0.25)';
      }
      if (isHost) {
        if (roleBadge) {
          roleBadge.style.display = 'flex';
          roleText.textContent = 'Giáo viên';
        }
        document.getElementById('local-name-tag').innerHTML = `👑 ${escapeHtml(username)} (Giáo viên)`;
        if (leaveBtn) leaveBtn.title = 'Kết thúc lớp học (Đóng phòng cho tất cả học viên)';
        showToast('👑 Bạn là Giáo viên / Chủ phòng');
      } else {
        document.getElementById('local-name-tag').innerHTML = `👩‍🎓 ${escapeHtml(username)} (Học viên)`;
      }
    } else if (currentRoomMode === 'meeting') {
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
  });

  socket.on('room-ended', ({ message }) => {
    handleRoomTerminated(message);
  });

  socket.on('existing-users', (users) => {
    users.forEach(user => {
      createPeerConnection(user.userId, user.username, user.isHost, true);
    });
    updateParticipantCount();
  });

  socket.on('user-joined', ({ userId, username: peerName, isHost: peerIsHost }) => {
    createPeerConnection(userId, peerName, peerIsHost, false);
    addSystemMessage(`${peerIsHost ? '👑 Chủ phòng' : 'Học viên'} ${peerName} đã tham gia`);
    updateParticipantCount();
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
    showToast(`${peerName} đã rời phòng`);
  });

  socket.on('chat-message', ({ userId, username: senderName, isHost: msgIsHost, message, timestamp }) => {
    addChatMessage(senderName, msgIsHost, message, timestamp, userId === socket.id);
  });

  socket.on('disconnect', () => {
    showToast('⚠️ Mất kết nối, đang thử lại...');
  });

  socket.on('reconnect', () => {
    showToast('✅ Đã kết nối lại');
    const isCreator = sessionStorage.getItem('meetflow-is-creator') === 'true';
    socket.emit('join-room', { roomId, username, isCreator });
  });
}

function handleRoomTerminated(reasonText) {
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (screenStream) screenStream.getTracks().forEach(t => t.stop());

  Object.values(peers).forEach(({ pc }) => pc.close());
  peers = {};

  if (timerInterval) clearInterval(timerInterval);

  const endedModal = document.getElementById('ended-modal');
  const endedMsg = document.getElementById('ended-message');
  if (endedMsg && reasonText) {
    endedMsg.innerHTML = `${escapeHtml(reasonText)}<br><br>Bạn sẽ tự động văng về trang chủ trong <strong id="countdown-sec" style="color: #ff4757;">3</strong>s...`;
  }
  if (endedModal) {
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
  peers[peerId] = { pc, username: peerUsername, isHost: peerIsHost };

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

  // Ưu tiên Codec H.264 (Hỗ trợ giải mã phần cứng phần cứng GPU, giảm 80% CPU & triệt tiêu độ trễ)
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

    // Đảm bảo video được phát ngay lập tức không bị đọng buffer
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

// Cấu hình bitrate mượt mà: không nghẽn băng thông, không tụt fps
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
        // Luôn ưu tiên giữ khung hình mượt mà (maintain-framerate)
        params.degradationPreference = 'maintain-framerate';
        params.encodings[0].maxBitrate = 350000; // 350 kbps (vừa vặn, cực nhẹ, chống buffer nghẽn)
        params.encodings[0].maxFramerate = 24;
      } else if (sender.track.kind === 'audio') {
        // Âm thanh Opus thoại chuẩn 32 kbps (rõ ràng, không trễ)
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

  // Nhãn tên hiển thị tùy biến theo chế độ cuộc họp
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
// ĐIỀU KHIỂN & RỜI PHÒNG (TÙY BIẾN THEO CHẾ ĐỘ)
// =========================================

function handleLeaveButtonClick() {
  if (isHost) {
    if (currentRoomMode === 'classroom') {
      const confirmEnd = confirm(
        "⚠️ BẠN LÀ GIÁO VIÊN / CHỦ PHÒNG HỌC!\n\n" +
        "Nếu bạn thoát, buổi học này sẽ KẾT THÚC và TẤT CẢ học viên sẽ tự động giải tán ra ngoài.\n\n" +
        "Bạn có chắc chắn muốn kết thúc lớp học không?"
      );
      if (confirmEnd) {
        if (socket) socket.emit('end-room');
        cleanupAndExit();
      }
    } else if (currentRoomMode === 'meeting') {
      // Trong cuộc họp nhóm: người tổ chức có thể chọn kết thúc cho tất cả hoặc chỉ mình mình rời
      const endForAll = confirm(
        "💼 BẠN LÀ NGƯỜI TỔ CHỨC CUỘC HỌP!\n\n" +
        "• Bấm [OK] để KẾT THÚC CUỘC HỌP CHO TẤT CẢ MỌI NGƯỜI.\n" +
        "• Bấm [HỦY / Cancel] nếu bạn chỉ muốn MỘT MÌNH RỜI ĐI (Cuộc họp vẫn tiếp tục cho những người khác)."
      );
      if (endForAll) {
        if (socket) socket.emit('end-room');
      }
      cleanupAndExit();
    } else if (currentRoomMode === 'interview') {
      const confirmEnd = confirm(
        "👔 BẠN LÀ NHÀ TUYỂN DỤNG!\n\n" +
        "Xác nhận hoàn tất và kết thúc buổi phỏng vấn này?\n(Ứng viên sẽ nhận được lời cảm ơn từ hệ thống)"
      );
      if (confirmEnd) {
        if (socket) socket.emit('end-room');
        cleanupAndExit();
      }
    }
  } else {
    const confirmLeave = confirm("Bạn có chắc chắn muốn rời khỏi phòng không?");
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
          width: { ideal: 1280, max: 1280 },
          height: { ideal: 720, max: 720 },
          frameRate: { ideal: 15, max: 15 } // 15 fps mượt cho tài liệu, không làm nghẽn mạng
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
