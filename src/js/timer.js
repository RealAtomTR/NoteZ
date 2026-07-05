const timerDisplay = document.getElementById('timer-display');
const progressBar = document.getElementById('timer-progress-bar');
const cancelBtn = document.getElementById('cancel-btn');
const doneBtn = document.getElementById('done-btn');
const runningView = document.getElementById('timer-running-view');
const followupView = document.getElementById('timer-followup-view');
const followupMoreBtn = document.getElementById('followup-more');
const followupYesBtn = document.getElementById('followup-yes');

let timerInterval = null;
let focusDuration = parseInt(localStorage.getItem('active_timer_duration')) || 5;
const isDebugMode = localStorage.getItem('timer_debug_mode') === 'true';
let totalTime = isDebugMode ? (focusDuration * 2) : (focusDuration * 60);
let remainingTime = totalTime;

function updateDisplay() {
  const minutes = Math.floor(remainingTime / 60);
  const seconds = remainingTime % 60;
  timerDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  const progress = (remainingTime / totalTime) * 100;
  progressBar.style.width = progress + '%';
}

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    remainingTime--;
    updateDisplay();
    if (remainingTime <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      showFollowUp();
    }
  }, 1000);
}

function showFollowUp() {
  runningView.style.display = 'none';
  followupView.style.display = 'flex';
  if (followupMoreBtn) {
    followupMoreBtn.textContent = `${focusDuration} dk daha`;
  }
}

// ─── "Bitti" button: mark tip as done, trigger confetti + win SFX, close ────
if (doneBtn) {
  doneBtn.addEventListener('click', async () => {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    // Mark tip as done in DB via IPC
    const tipId = localStorage.getItem('active_timer_tip_id');
    if (tipId && window.electronAPI && window.electronAPI.dbRun) {
      try {
        await window.electronAPI.dbRun(
          `UPDATE tips SET status = 'done', last_shown = ? WHERE id = ?`,
          [Date.now(), parseInt(tipId)]
        );
      } catch (e) {
        console.error('[timer] Error marking tip as done:', e);
      }
    }
    // Notify main process → triggers confetti + win SFX
    if (window.electronAPI && window.electronAPI.timerEnded) {
      window.electronAPI.timerEnded();
    }
    if (window.electronAPI && window.electronAPI.closeTimer) {
      window.electronAPI.closeTimer();
    }
  });
}

// ─── Cancel button: stop timer and close window ───────────────────────────────
if (cancelBtn) {
  cancelBtn.addEventListener('click', () => {
    if (timerInterval) clearInterval(timerInterval);
    if (window.electronAPI && window.electronAPI.closeTimer) {
      window.electronAPI.closeTimer();
    }
  });
}

// ─── Follow-up "Evet" (done): notify + close ─────────────────────────────────
if (followupYesBtn) {
  followupYesBtn.addEventListener('click', async () => {
    const tipId = localStorage.getItem('active_timer_tip_id');
    if (tipId && window.electronAPI && window.electronAPI.dbRun) {
      try {
        await window.electronAPI.dbRun(
          `UPDATE tips SET status = 'done', last_shown = ? WHERE id = ?`,
          [Date.now(), parseInt(tipId)]
        );
      } catch (e) {
        console.error('[timer] Error marking tip as done from follow-up:', e);
      }
    }
    if (window.electronAPI && window.electronAPI.timerEnded) {
      window.electronAPI.timerEnded();
    }
    if (window.electronAPI && window.electronAPI.closeTimer) {
      window.electronAPI.closeTimer();
    }
  });
}

// ─── Follow-up "X dk daha": restart ──────────────────────────────────────────
if (followupMoreBtn) {
  followupMoreBtn.addEventListener('click', () => {
    followupView.style.display = 'none';
    runningView.style.display = 'flex';
    const isDebugMode = localStorage.getItem('timer_debug_mode') === 'true';
    totalTime = isDebugMode ? (focusDuration * 2) : (focusDuration * 60);
    remainingTime = totalTime;
    updateDisplay();
    startTimer();
  });
}

// ─── IPC: timer-start from main process ──────────────────────────────────────
if (window.electronAPI && window.electronAPI.onTimerStart) {
  window.electronAPI.onTimerStart(() => {
    const isDebugMode = localStorage.getItem('timer_debug_mode') === 'true';
    focusDuration = parseInt(localStorage.getItem('active_timer_duration')) || 5;
    totalTime = isDebugMode ? (focusDuration * 2) : (focusDuration * 60);
    remainingTime = totalTime;

    if (followupMoreBtn) {
      followupMoreBtn.textContent = `${focusDuration} dk daha`;
    }

    // Ensure running view is shown
    runningView.style.display = 'flex';
    followupView.style.display = 'none';

    updateDisplay();
    startTimer();
  });
}

// ─── IPC: timer-stop from main process ───────────────────────────────────────
if (window.electronAPI && window.electronAPI.onTimerStop) {
  window.electronAPI.onTimerStop(() => {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  });
}

// Initialize display
updateDisplay();
