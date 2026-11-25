// =========================================
// MeetFlow - Enterprise SaaS Landing Page Logic
// =========================================

let testerStream = null;
let testerAudioContext = null;
let testerAnalyser = null;
let testerAnimFrame = null;

// Khởi chạy khi tài liệu sẵn sàng
document.addEventListener('DOMContentLoaded', () => {
  initClock();
  setupEnterKeys();
});

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

  // Lưu tuỳ chọn tắt mic/cam khi vào
  const muteMic = document.getElementById('create-mute-mic')?.checked || false;
  const muteCam = document.getElementById('create-mute-cam')?.checked || false;
  sessionStorage.setItem('meetflow-mute-mic', muteMic ? 'true' : 'false');
  sessionStorage.setItem('meetflow-mute-cam', muteCam ? 'true' : 'false');

  try {
    const res = await fetch('/api/room/create', { method: 'POST' });
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
