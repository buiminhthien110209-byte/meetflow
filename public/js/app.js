// =========================================
// MeetFlow - Enterprise SaaS Landing Page Logic
// =========================================

let testerStream = null;
let testerAudioContext = null;
let testerAnalyser = null;
let testerAnimFrame = null;
let selectedRoomMode = 'classroom'; // 'classroom' | 'meeting' | 'interview'

// Khởi chạy khi tài liệu sẵn sàng
document.addEventListener('DOMContentLoaded', () => {
  initClock();
  setupEnterKeys();
  checkAuthState();
  
  // Đóng dropdown tài khoản khi click ra ngoài
  document.addEventListener('click', (e) => {
    const wrapper = document.getElementById('user-pill-wrapper');
    const dropdown = document.getElementById('user-dropdown-card');
    if (dropdown && wrapper && !wrapper.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });
});

// =========================================
// CHỌN HÌNH THỨC CUỘC HỌP (3 CHẾ ĐỘ)
// =========================================
function selectRoomMode(mode) {
  selectedRoomMode = mode;
  const modes = ['classroom', 'meeting', 'interview'];

  modes.forEach(m => {
    const card = document.getElementById(`mode-${m}`);
    if (!card) return;
    const checkIcon = card.querySelector('.mode-check i');

    if (m === mode) {
      card.classList.add('active');
      if (checkIcon) {
        checkIcon.className = 'fas fa-circle-check';
      }
    } else {
      card.classList.remove('active');
      if (checkIcon) {
        checkIcon.className = 'far fa-circle';
      }
    }
  });

  const btnText = document.getElementById('btn-create-text');
  const btnIcon = document.querySelector('#btn-create i');
  const hintEl = document.getElementById('hub-mode-hint');
  const nameInput = document.getElementById('create-name');

  if (mode === 'classroom') {
    if (btnText) btnText.textContent = 'Bắt đầu Lớp học';
    if (btnIcon) btnIcon.className = 'fas fa-video';
    if (hintEl) hintEl.innerHTML = '<i class="fas fa-info-circle text-primary"></i> Chế độ <strong>Lớp học</strong>: Giáo viên làm Chủ phòng, tự động đóng phòng khi bạn rời đi.';
    if (nameInput) nameInput.placeholder = 'Nhập tên giáo viên / chủ phòng (ví dụ: Thầy Minh, Cô Mai...)';
  } else if (mode === 'meeting') {
    if (btnText) btnText.textContent = 'Bắt đầu Cuộc họp';
    if (btnIcon) btnIcon.className = 'fas fa-video';
    if (hintEl) hintEl.innerHTML = '<i class="fas fa-info-circle text-primary"></i> Chế độ <strong>Cuộc họp</strong>: Thảo luận tự do, cuộc họp vẫn tiếp tục khi bạn rời đi.';
    if (nameInput) nameInput.placeholder = 'Nhập tên của bạn (ví dụ: Hoàng Minh, Lan Anh...)';
  } else if (mode === 'interview') {
    if (btnText) btnText.textContent = 'Bắt đầu Phỏng vấn';
    if (btnIcon) btnIcon.className = 'fas fa-video';
    if (hintEl) hintEl.innerHTML = '<i class="fas fa-info-circle text-primary"></i> Chế độ <strong>Phỏng vấn</strong>: Dành cho Người phỏng vấn và Ứng viên xin việc.';
    if (nameInput) nameInput.placeholder = 'Nhập tên người phỏng vấn (ví dụ: Chị Lan, Anh Tuấn...)';
  }
}

// =========================================
// TAB SWITCHER
// =========================================
function switchHubTab(tabName) {
  const btnCreate = document.getElementById('tab-btn-create');
  const btnJoin = document.getElementById('tab-btn-join');
  const contentCreate = document.getElementById('tab-content-create');
  const contentJoin = document.getElementById('tab-content-join');

  if (tabName === 'create') {
    btnCreate.classList.add('active');
    btnJoin.classList.remove('active');
    contentCreate.style.display = 'block';
    contentJoin.style.display = 'none';
    document.getElementById('create-name').focus();
  } else {
    btnJoin.classList.add('active');
    btnCreate.classList.remove('active');
    contentJoin.style.display = 'block';
    contentCreate.style.display = 'none';
    document.getElementById('join-name').focus();
  }
}

// =========================================
// CLOCK WIDGET
// =========================================
function initClock() {
  function updateTime() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit'
    });
    
    // Ngày tháng tiếng Việt chuẩn
    const days = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
    const dayName = days[now.getDay()];
    const dateStr = `${dayName}, ${now.getDate()} Th${now.getMonth() + 1}`;

    const timeEl = document.getElementById('clock-time');
    const dateEl = document.getElementById('clock-date');
    if (timeEl) timeEl.textContent = timeStr;
    if (dateEl) dateEl.textContent = dateStr;
  }

  updateTime();
  setInterval(updateTime, 1000);
}

// =========================================
// TẠO PHÒNG & THAM GIA
// =========================================
async function createRoom() {
  const nameInput = document.getElementById('create-name');
  const name = nameInput.value.trim();

  if (!name) {
    nameInput.focus();
    nameInput.style.borderColor = '#ef4444';
    setTimeout(() => nameInput.style.borderColor = '', 1500);
    return;
  }

  const btn = document.getElementById('btn-create');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang tạo lớp học...';

  // Lưu tuỳ chọn tắt mic/cam khi vào & chế độ phòng
  const muteMic = document.getElementById('create-mute-mic')?.checked || false;
  const muteCam = document.getElementById('create-mute-cam')?.checked || false;
  sessionStorage.setItem('meetflow-mute-mic', muteMic ? 'true' : 'false');
  sessionStorage.setItem('meetflow-mute-cam', muteCam ? 'true' : 'false');
  sessionStorage.setItem('meetflow-room-mode', selectedRoomMode);

  try {
    const res = await fetch('/api/room/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomMode: selectedRoomMode })
    });
    const data = await res.json();

    // Lưu quyền chủ phòng
    sessionStorage.setItem('meetflow-username', name);
    sessionStorage.setItem('meetflow-is-creator', 'true');

    window.location.href = `/room/${data.roomId}`;
  } catch (err) {
    console.error('Lỗi tạo phòng:', err);
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-plus-circle"></i> Bắt đầu cuộc họp mới';
    alert('Không thể tạo phòng lúc này. Vui lòng kiểm tra lại mạng!');
  }
}

function joinRoom() {
  const nameInput = document.getElementById('join-name');
  const codeInput = document.getElementById('join-code');
  const name = nameInput.value.trim();
  let code = codeInput.value.trim();

  if (!name) {
    nameInput.focus();
    nameInput.style.borderColor = '#ef4444';
    setTimeout(() => nameInput.style.borderColor = '', 1500);
    return;
  }

  if (!code) {
    codeInput.focus();
    codeInput.style.borderColor = '#ef4444';
    setTimeout(() => codeInput.style.borderColor = '', 1500);
    return;
  }

  // Nếu người dùng dán nguyên đường link (vd: https://meetflow.../room/a1b2c3d4)
  if (code.includes('/room/')) {
    code = code.split('/room/').pop().split('?')[0];
  }

  const muteMic = document.getElementById('join-mute-mic')?.checked || false;
  const muteCam = document.getElementById('join-mute-cam')?.checked || false;
  sessionStorage.setItem('meetflow-mute-mic', muteMic ? 'true' : 'false');
  sessionStorage.setItem('meetflow-mute-cam', muteCam ? 'true' : 'false');

  sessionStorage.setItem('meetflow-username', name);
  sessionStorage.setItem('meetflow-is-creator', 'false');

  window.location.href = `/room/${code}`;
}

function setupEnterKeys() {
  const createInput = document.getElementById('create-name');
  const joinName = document.getElementById('join-name');
  const joinCode = document.getElementById('join-code');

  if (createInput) {
    createInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') createRoom();
    });
  }

  if (joinName) {
    joinName.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') document.getElementById('join-code').focus();
    });
  }

  if (joinCode) {
    joinCode.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') joinRoom();
    });
  }
}

// =========================================
// DEVICE TESTER MODAL (Kiểm tra Camera & Mic)
// =========================================
async function openDeviceTester() {
  const modal = document.getElementById('device-modal');
  if (modal) modal.style.display = 'flex';

  await startDeviceTest();
}

function closeDeviceTester() {
  const modal = document.getElementById('device-modal');
  if (modal) modal.style.display = 'none';

  stopDeviceTest();
}

async function startDeviceTest(videoDeviceId = null, audioDeviceId = null) {
  stopDeviceTest();

  const constraints = {
    video: videoDeviceId ? { deviceId: { exact: videoDeviceId } } : { width: { ideal: 640 }, height: { ideal: 360 } },
    audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true
  };

  try {
    testerStream = await navigator.mediaDevices.getUserMedia(constraints);
    const videoEl = document.getElementById('test-video');
    const noCamEl = document.getElementById('test-no-cam');
    
    if (videoEl) {
      videoEl.srcObject = testerStream;
      if (noCamEl) noCamEl.style.display = 'none';
    }

    // Liệt kê danh sách camera và mic
    await populateDeviceLists();

    // Khởi tạo máy đo âm lượng Micro (Audio VU Meter)
    setupAudioMeter(testerStream);

  } catch (err) {
    console.warn('Không thể truy cập camera/mic trong bộ kiểm tra:', err);
    const noCamEl = document.getElementById('test-no-cam');
    if (noCamEl) noCamEl.style.display = 'flex';
  }
}

function stopDeviceTest() {
  if (testerStream) {
    testerStream.getTracks().forEach(t => t.stop());
    testerStream = null;
  }
  if (testerAudioContext) {
    testerAudioContext.close().catch(() => {});
    testerAudioContext = null;
  }
  if (testerAnimFrame) {
    cancelAnimationFrame(testerAnimFrame);
    testerAnimFrame = null;
  }
  const meterFill = document.getElementById('audio-level-fill');
  if (meterFill) meterFill.style.width = '0%';
}

async function populateDeviceLists() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;

  const devices = await navigator.mediaDevices.enumerateDevices();
  const camSelect = document.getElementById('camera-select');
  const micSelect = document.getElementById('mic-select');

  if (camSelect) camSelect.innerHTML = '';
  if (micSelect) micSelect.innerHTML = '';

  let camIndex = 1;
  let micIndex = 1;

  devices.forEach(device => {
    const opt = document.createElement('option');
    opt.value = device.deviceId;

    if (device.kind === 'videoinput') {
      opt.text = device.label || `Camera ${camIndex++}`;
      if (camSelect) camSelect.appendChild(opt);
    } else if (device.kind === 'audioinput') {
      opt.text = device.label || `Microphone ${micIndex++}`;
      if (micSelect) micSelect.appendChild(opt);
    }
  });
}

function changeDevice() {
  const camSelect = document.getElementById('camera-select');
  const micSelect = document.getElementById('mic-select');

  const videoId = camSelect ? camSelect.value : null;
  const audioId = micSelect ? micSelect.value : null;

  startDeviceTest(videoId, audioId);
}

function setupAudioMeter(stream) {
  try {
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) return;

    window.AudioContext = window.AudioContext || window.webkitAudioContext;
    testerAudioContext = new AudioContext();
    const source = testerAudioContext.createMediaStreamSource(stream);
    testerAnalyser = testerAudioContext.createAnalyser();
    testerAnalyser.fftSize = 64;

    source.connect(testerAnalyser);
    const dataArray = new Uint8Array(testerAnalyser.frequencyBinCount);

    const meterFill = document.getElementById('audio-level-fill');
    const statusText = document.getElementById('audio-status-text');

    function checkLevel() {
      if (!testerAnalyser) return;
      testerAnalyser.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const avg = sum / dataArray.length;
      const levelPercent = Math.min(100, Math.round((avg / 128) * 100));

      if (meterFill) {
        meterFill.style.width = `${levelPercent}%`;
        if (levelPercent > 10) {
          if (statusText) statusText.textContent = 'Âm thanh tốt!';
          meterFill.style.background = '#10b981';
        } else {
          if (statusText) statusText.textContent = 'Nói thử để kiểm tra mic...';
        }
      }

      testerAnimFrame = requestAnimationFrame(checkLevel);
    }

    checkLevel();
  } catch (err) {
    console.warn('Lỗi AudioContext VU meter:', err);
  }
}

// =========================================
// XÁC THỰC TÀI KHOẢN GMAIL & MÃ OTP
// =========================================
let authPendingEmail = '';
let authPendingName = '';

// Kiểm tra trạng thái đăng nhập từ localStorage
function checkAuthState() {
  const userStr = localStorage.getItem('meetflow-user');
  const loginBtn = document.getElementById('btn-login-nav');
  const userPill = document.getElementById('user-pill-wrapper');
  
  if (userStr) {
    try {
      const user = JSON.parse(userStr);
      if (loginBtn) loginBtn.style.display = 'none';
      if (userPill) userPill.style.display = 'block';

      const avatarEl = document.getElementById('nav-user-avatar');
      const nameEl = document.getElementById('nav-user-name');
      const dropName = document.getElementById('dropdown-name');
      const dropEmail = document.getElementById('dropdown-email');

      const displayName = user.name || user.email.split('@')[0];
      const initial = displayName.charAt(0).toUpperCase();

      if (avatarEl) avatarEl.textContent = initial;
      if (nameEl) nameEl.textContent = displayName;
      if (dropName) dropName.textContent = displayName;
      if (dropEmail) dropEmail.textContent = user.email;

      // Điền sẵn tên vào các ô tạo và tham gia phòng
      const createName = document.getElementById('create-name');
      const joinName = document.getElementById('join-name');
      if (createName && !createName.value.trim()) createName.value = displayName;
      if (joinName && !joinName.value.trim()) joinName.value = displayName;

      sessionStorage.setItem('meetflow-username', displayName);
    } catch (e) {
      console.warn('Lỗi phân tích thông tin user:', e);
    }
  } else {
    if (loginBtn) loginBtn.style.display = 'inline-flex';
    if (userPill) userPill.style.display = 'none';
  }
}

// Mở modal đăng nhập
function openAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (!modal) return;

  // Reset về bước 1
  document.getElementById('auth-step-email').style.display = 'block';
  document.getElementById('auth-step-otp').style.display = 'none';
  
  const errEmail = document.getElementById('auth-email-error');
  const errOtp = document.getElementById('auth-otp-error');
  if (errEmail) errEmail.style.display = 'none';
  if (errOtp) errOtp.style.display = 'none';

  modal.style.display = 'flex';
  const nameInput = document.getElementById('auth-name-input');
  if (nameInput) nameInput.focus();
}

// Đóng modal đăng nhập
function closeAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.style.display = 'none';
}

// Bật/tắt dropdown tài khoản
function toggleUserDropdown(e) {
  if (e) e.stopPropagation();
  const dropdown = document.getElementById('user-dropdown-card');
  if (!dropdown) return;
  dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
}

// Đăng xuất tài khoản
function logoutUser() {
  localStorage.removeItem('meetflow-user');
  const dropdown = document.getElementById('user-dropdown-card');
  if (dropdown) dropdown.style.display = 'none';
  checkAuthState();
  showAuthToast('Đã đăng xuất tài khoản.', 'info');
}

// Bước 1: Gửi mã OTP về Gmail
async function handleSendOtp(e) {
  if (e) e.preventDefault();
  
  const nameInput = document.getElementById('auth-name-input');
  const emailInput = document.getElementById('auth-email-input');
  const errEmail = document.getElementById('auth-email-error');
  const btnSend = document.getElementById('btn-send-otp');

  const name = nameInput ? nameInput.value.trim() : '';
  const email = emailInput ? emailInput.value.trim().toLowerCase() : '';

  if (errEmail) errEmail.style.display = 'none';

  // Kiểm tra chỉ chấp nhận Gmail
  if (!email.endsWith('@gmail.com')) {
    if (errEmail) {
      errEmail.textContent = 'Chỉ chấp nhận địa chỉ email kết thúc bằng @gmail.com';
      errEmail.style.display = 'block';
    }
    emailInput.focus();
    return;
  }

  btnSend.disabled = true;
  btnSend.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang gửi mã...';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch('/api/auth/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Không thể gửi mã xác nhận.');
    }

    authPendingEmail = email;
    authPendingName = name || email.split('@')[0];

    // Chuyển sang bước 2
    document.getElementById('auth-step-email').style.display = 'none';
    document.getElementById('auth-step-otp').style.display = 'block';

    const targetEmailEl = document.getElementById('auth-target-email');
    if (targetEmailEl) targetEmailEl.textContent = email;

    // Nếu môi trường chưa cấu hình SMTP, hiển thị mã gợi ý để kiểm thử mượt mà
    const demoBox = document.getElementById('auth-demo-hint');
    if (demoBox) {
      if (data.demoCode) {
        demoBox.innerHTML = `<i class="fas fa-key"></i> Mã xác nhận thử nghiệm của bạn: <strong>${data.demoCode}</strong>`;
        demoBox.style.display = 'block';
      } else {
        demoBox.style.display = 'none';
      }
    }

    const otpInput = document.getElementById('auth-otp-input');
    if (otpInput) {
      otpInput.value = '';
      otpInput.focus();
    }

    showAuthToast('Đã gửi mã xác thực về Gmail!', 'success');
  } catch (err) {
    clearTimeout(timeoutId);
    if (errEmail) {
      if (err.name === 'AbortError') {
        errEmail.textContent = 'Máy chủ đang khởi động lại hoặc kết nối mạng chậm. Vui lòng bấm thử lại sau 5 giây!';
      } else {
        errEmail.textContent = err.message || 'Lỗi gửi mã OTP.';
      }
      errEmail.style.display = 'block';
    }
  } finally {
    btnSend.disabled = false;
    btnSend.innerHTML = '<i class="fas fa-paper-plane"></i> <span>Gửi mã xác nhận qua Gmail</span>';
  }
}

// Bước 2: Xác thực mã OTP
async function handleVerifyOtp(e) {
  if (e) e.preventDefault();

  const otpInput = document.getElementById('auth-otp-input');
  const errOtp = document.getElementById('auth-otp-error');
  const btnVerify = document.getElementById('btn-verify-otp');

  const code = otpInput ? otpInput.value.trim() : '';
  if (errOtp) errOtp.style.display = 'none';

  if (!code || code.length !== 6) {
    if (errOtp) {
      errOtp.textContent = 'Vui lòng nhập đủ 6 chữ số mã xác nhận.';
      errOtp.style.display = 'block';
    }
    otpInput.focus();
    return;
  }

  btnVerify.disabled = true;
  btnVerify.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang xác thực...';

  try {
    const res = await fetch('/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: authPendingEmail,
        code,
        name: authPendingName
      })
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Mã xác nhận không chính xác.');
    }

    // Lưu thông tin người dùng vào LocalStorage
    localStorage.setItem('meetflow-user', JSON.stringify(data.user));
    closeAuthModal();
    checkAuthState();
    showAuthToast(`Xin chào ${data.user.name || 'bạn'}! Đăng nhập thành công.`, 'success');
  } catch (err) {
    if (errOtp) {
      errOtp.textContent = err.message || 'Mã xác thực không hợp lệ hoặc đã hết hạn.';
      errOtp.style.display = 'block';
    }
  } finally {
    btnVerify.disabled = false;
    btnVerify.innerHTML = '<i class="fas fa-check-circle"></i> <span>Xác nhận & Hoàn tất</span>';
  }
}

// Gửi lại mã OTP
async function resendOtp() {
  if (!authPendingEmail) {
    backToEmailStep();
    return;
  }
  const emailInput = document.getElementById('auth-email-input');
  const nameInput = document.getElementById('auth-name-input');
  if (emailInput) emailInput.value = authPendingEmail;
  if (nameInput) nameInput.value = authPendingName;
  await handleSendOtp();
}

// Quay lại bước nhập email
function backToEmailStep() {
  document.getElementById('auth-step-otp').style.display = 'none';
  document.getElementById('auth-step-email').style.display = 'block';
  const emailInput = document.getElementById('auth-email-input');
  if (emailInput) emailInput.focus();
}

// Hiển thị thông báo Toast nhẹ
function showAuthToast(msg, type = 'info') {
  let toast = document.getElementById('meetflow-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'meetflow-toast';
    toast.style.position = 'fixed';
    toast.style.bottom = '24px';
    toast.style.right = '24px';
    toast.style.padding = '12px 20px';
    toast.style.borderRadius = '12px';
    toast.style.color = '#fff';
    toast.style.fontSize = '14px';
    toast.style.fontWeight = '600';
    toast.style.zIndex = '99999';
    toast.style.boxShadow = '0 10px 25px -5px rgba(0,0,0,0.3)';
    toast.style.transition = 'all 0.3s ease';
    document.body.appendChild(toast);
  }

  if (type === 'success') {
    toast.style.background = '#10b981';
  } else if (type === 'error') {
    toast.style.background = '#ef4444';
  } else {
    toast.style.background = '#3b82f6';
  }

  toast.textContent = msg;
  toast.style.opacity = '1';
  toast.style.transform = 'translateY(0)';

  clearTimeout(window.__toastTimeout);
  window.__toastTimeout = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
  }, 3500);
}
