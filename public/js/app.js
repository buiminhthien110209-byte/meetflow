// =========================================
// MeetFlow - Landing Page Logic
// =========================================

// Tạo phòng mới
async function createRoom() {
  const nameInput = document.getElementById('create-name');
  const name = nameInput.value.trim();

  if (!name) {
    nameInput.focus();
    nameInput.style.borderColor = '#ff4757';
    setTimeout(() => nameInput.style.borderColor = '', 1500);
    return;
  }

  const btn = document.getElementById('btn-create');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang tạo...';

  try {
    const res = await fetch('/api/room/create', { method: 'POST' });
    const data = await res.json();

    // Lưu tên và đánh dấu là người tạo lớp học (Chủ phòng)
    sessionStorage.setItem('meetflow-username', name);
    sessionStorage.setItem('meetflow-is-creator', 'true');

    // Chuyển đến phòng
    window.location.href = `/room/${data.roomId}`;
  } catch (err) {
    console.error('Lỗi tạo phòng:', err);
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-video"></i> Tạo phòng';
    alert('Không thể tạo phòng. Vui lòng thử lại!');
  }
}

// Tham gia phòng có sẵn
function joinRoom() {
  const nameInput = document.getElementById('join-name');
  const codeInput = document.getElementById('join-code');
  const name = nameInput.value.trim();
  const code = codeInput.value.trim();

  if (!name) {
    nameInput.focus();
    nameInput.style.borderColor = '#ff4757';
    setTimeout(() => nameInput.style.borderColor = '', 1500);
    return;
  }

  if (!code) {
    codeInput.focus();
    codeInput.style.borderColor = '#ff4757';
    setTimeout(() => codeInput.style.borderColor = '', 1500);
    return;
  }

  // Lưu tên vào sessionStorage (người tham gia thường)
  sessionStorage.setItem('meetflow-username', name);
  sessionStorage.setItem('meetflow-is-creator', 'false');

  // Chuyển đến phòng
  window.location.href = `/room/${code}`;
}

// Enter key để submit
document.addEventListener('DOMContentLoaded', () => {
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
});
