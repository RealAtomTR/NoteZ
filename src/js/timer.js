const timerDisplay = document.getElementById('timer-display');
const progressBar = document.getElementById('timer-progress-bar');

let timerInterval = null;
let remainingTime = 120; // 2 minutes in seconds
const totalTime = 120;

// Initialize timer
function initTimer() {
  updateDisplay();
  startTimer();
}

function updateDisplay() {
  const minutes = Math.floor(remainingTime / 60);
  const seconds = remainingTime % 60;
  timerDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  
  // Update progress bar
  const progress = (remainingTime / totalTime) * 100;
  progressBar.style.width = progress + '%';
}

function startTimer() {
  timerInterval = setInterval(() => {
    remainingTime--;
    updateDisplay();
    
    if (remainingTime <= 0) {
      clearInterval(timerInterval);
      timerEnded();
    }
  }, 1000);
}

function timerEnded() {
  // Notify main process that timer ended
  if (window.electronAPI && window.electronAPI.timerEnded) {
    window.electronAPI.timerEnded();
  }
  
  // Close timer window
  if (window.electronAPI && window.electronAPI.closeTimer) {
    window.electronAPI.closeTimer();
  }
}

// Listen for timer start command from main process
if (window.electronAPI && window.electronAPI.onTimerStart) {
  window.electronAPI.onTimerStart(() => {
    remainingTime = totalTime;
    updateDisplay();
    startTimer();
  });
}

// Listen for timer stop command from main process
if (window.electronAPI && window.electronAPI.onTimerStop) {
  window.electronAPI.onTimerStop(() => {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  });
}

// Initialize on load
initTimer();
