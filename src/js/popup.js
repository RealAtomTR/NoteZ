// Popup Window - All Dismiss Levels (1-10)

// DOM Elements
const popupContainer = document.getElementById('popup-container');
const categoryName = document.getElementById('category-name');
const categoryColor = document.getElementById('category-color');
const tipContent = document.getElementById('tip-content');
const dismissBtn = document.getElementById('dismiss-btn');
const twoMinBtn = document.getElementById('two-min-btn');
const dismissReasons = document.getElementById('dismiss-reasons');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const mathQuestion = document.getElementById('math-question');
const mathProblem = document.getElementById('math-problem');
const mathAnswer = document.getElementById('math-answer');
const mathSubmit = document.getElementById('math-submit');
const confettiCanvas = document.getElementById('confetti-canvas');
const popupActions = document.getElementById('popup-actions');
const timerScreen = document.getElementById('timer-screen');
const timerScreenTime = document.getElementById('timer-screen-time');
const timerDoneBtn = document.getElementById('timer-done-btn');

// State
let currentTip = null;
let reasonLogged = false;
let dismissLevel = 1;
let holdTimer = null;
let holdStartTime = 0;
let holdDuration = 10000; // 10 seconds for levels 4-6 and 10
let mathAnswerCorrect = null;
let confettiParticles = [];
let confettiAnimationId = null;
let confettiStartTime = 0;
let shakeAnimationId = null;
let timerInterval = null;
let isGameSuccess = false;
let notBitirildiDoneInFlight = false;
const snoozeReasonUiEnabled = false;
let popupResizeMode = 'content';

// Wordle State
let wordleSecretWord = "";
let wordleMaxAttempts = 5;
let wordleCurrentAttempt = 0;
let wordleCurrentLetterIdx = 0;
let wordleBoardState = [];
let wordleActive = false;
let wordlePhysicalKeyHandler = null;

// Chess State
let chessBoardState = {};
let chessSelectedSquare = null;
let chessValidMoves = [];
let chessActive = false;
let chessDragState = null;

const WORDLE_WORDS = [
  "ADRES", "ALARM", "AMPUL", "ARABA", "ARŞİV", "BAVUL", "BEYİN", "BİLİM", "BULUT", "CEKET",
  "CEVAP", "CÜMLE", "ÇANTA", "ÇİÇEK", "ÇOCUK", "DESTE", "DÜNYA", "EVRAK", "FİKİR", "GEÇİT",
  "GÜNEŞ", "HABER", "HEDEF", "HÜCRE", "İPLİK", "İŞLEM", "KAĞIT", "KALEM", "KASET", "KEYİF",
  "KİTAP", "KOLAY", "KÖPRÜ", "LİMAN", "MASAL", "METOT", "MÜZİK", "NEFES", "NOKTA", "ORTAK",
  "ÖRNEK", "PROJE", "RESİM", "SABUN", "SINIF", "SINAV", "SÜREÇ", "ŞARKI", "ŞEHİR", "TABLO",
  "TARİH", "TEMİZ", "YAZAR", "ZAMAN"
];

// ─── Hold SFX Manager ───────────────────────────────────────────────────────
// Web Audio API ile hold-to-dismiss sırasında SFX'i hold süresine eşitler.
// Strateji: playbackRate = audioDuration / holdDuration
//   - Ses kısaysa: playbackRate < 1 → ses yavaşlar, hold süresi kadar uzar
//   - Ses uzunsa: fade-out ile holdDuration ms'de kesilir
// Not: playbackRate değiştiğinde pitch de değişir. Hold süreleri (5-15sn)
// için bu fark kullanıcı tarafından kabul edilebilir seviyededir.
class HoldSfxManager {
  constructor() {
    this._source = null;
  }

  start(audioEl, holdMs) {
    this.stop();
    if (!audioEl || !audioEl.src) return;

    try {
      // Play audio as-is, no Web Audio API stretching or fading
      const cloned = new Audio(audioEl.src);
      
      // Calculate SFX volume
      const masterVol = window.audioManager ? window.audioManager.volume : 1;
      cloned.volume = masterVol * 0.178; // -15dB max scale
      
      this._source = cloned;
      cloned.play().catch(e => console.warn('[HoldSfx] play failed:', e.message));
    } catch (e) {
      console.warn('[HoldSfx] start error:', e.message);
    }
  }

  stop() {
    if (this._source) {
      try {
        this._source.pause();
        this._source.currentTime = 0;
      } catch (_) {}
      this._source = null;
    }
  }
}

const holdSfxManager = new HoldSfxManager();
// ────────────────────────────────────────────────────────────────────────────


// Render deadline badge in popup
function renderPopupDeadline(tipData) {
  const badge = document.getElementById('popup-deadline-badge');
  if (!badge) return;
  
  if (!tipData || !tipData.deadline) {
    badge.style.display = 'none';
    return;
  }
  
  const deadlineDate = new Date(tipData.deadline);
  const now = new Date();
  const diffTime = deadlineDate - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  badge.style.display = 'inline-block';
  badge.className = 'popup-deadline-badge'; // reset classes
  
  if (diffTime < 0) {
    badge.textContent = '⚠️ Geçti!';
    badge.classList.add('deadline-expired');
  } else if (diffDays <= 1) {
    badge.textContent = '🔴 BUGÜN!';
    badge.classList.add('deadline-today');
  } else {
    badge.textContent = `⏰ ${diffDays} gün kaldı`;
    if (diffDays <= 3) {
      badge.classList.add('deadline-3days');
    } else if (diffDays <= 7) {
      badge.classList.add('deadline-1week');
    } else {
      badge.classList.add('deadline-2weeks');
    }
  }
}

// Initialize with mock data (will be replaced by Electron IPC)
function initializePopup(tipData) {
  currentTip = tipData || {
    category: { name: 'Yapay Zeka', color: '#6C63FF' },
    content: 'Bugün AI konularında en az 30 dakika çalış.',
    importance: 7
  };
  
  dismissLevel = currentTip.effectiveImportance || currentTip.importance || 1;
  notBitirildiDoneInFlight = false;
  if (popupContainer) popupContainer.classList.remove('timer-active');
  if (timerScreen) timerScreen.style.display = 'none';
  if (timerDoneBtn) timerDoneBtn.disabled = false;
  const popupHeader = document.querySelector('.popup-header');
  const popupContent = document.querySelector('.popup-content');
  const notBitirildiScreen = document.getElementById('not-bitirildi-screen');
  const followUpQuestion = document.getElementById('follow-up-question');
  if (popupHeader) popupHeader.style.display = 'flex';
  if (popupContent) popupContent.style.display = 'flex';
  if (notBitirildiScreen) notBitirildiScreen.style.display = 'none';
  if (followUpQuestion) followUpQuestion.style.display = 'none';
  if (categoryColor) categoryColor.style.display = 'inline-block';
  
  // Set content
  categoryName.textContent = currentTip.category.name;
  categoryColor.style.background = currentTip.category.color;
  tipContent.textContent = currentTip.content;
  
  // Set importance badge
  const impBadge = document.getElementById('popup-importance-badge');
  if (impBadge) {
    impBadge.style.display = 'inline-block';
    impBadge.textContent = `● ${dismissLevel}`;
    impBadge.className = 'popup-importance-badge'; // reset class
    if (dismissLevel <= 3) {
      impBadge.classList.add('imp-green');
    } else if (dismissLevel <= 6) {
      impBadge.classList.add('imp-amber');
    } else if (dismissLevel <= 9) {
      impBadge.classList.add('imp-red');
    } else {
      impBadge.classList.add('imp-darkred');
    }
  }

  // Render deadline badge
  renderPopupDeadline(currentTip);

  // Check snooze limits
  checkSnoozeLimits(currentTip.id, dismissLevel);
  
  // Apply random layout variant
  applyLayoutVariant();
  
  // Setup dismiss mechanism based on level
  setupDismissMechanism();
  
  // Setup 2-minute button
  setupTwoMinuteButton();
  
  // Setup follow-up question handlers
  setupFollowUpHandlers();

  // Dynamic resize
  triggerPopupResize();

}

// Layout Variants (random: left, center, right)
function applyLayoutVariant() {
  const variants = ['variant-left', 'variant-center', 'variant-right'];
  const randomVariant = variants[Math.floor(Math.random() * variants.length)];
  popupContainer.classList.add(randomVariant);
}

// Setup Dismiss Mechanism based on importance level
function setupDismissMechanism() {
  // Hide all level-specific elements first
  progressContainer.style.display = 'none';
  mathQuestion.style.display = 'none';
  confettiCanvas.style.display = 'none';
  const wordleContainer = document.getElementById('wordle-container');
  if (wordleContainer) wordleContainer.style.display = 'none';
  const chessContainer = document.getElementById('chess-container');
  if (chessContainer) chessContainer.style.display = 'none';
  
  // Reset buttons display to default visible states
  dismissBtn.style.display = 'block';
  if (dismissReasons) dismissReasons.style.display = snoozeReasonUiEnabled ? 'grid' : 'none';
  const snoozeLimitInfo = document.getElementById('snooze-limit-info');
  if (snoozeLimitInfo) snoozeLimitInfo.style.display = snoozeReasonUiEnabled ? 'block' : 'none';
  twoMinBtn.style.display = 'block';
  
  // Re-enable buttons if they were disabled by a previous click
  dismissBtn.disabled = false;
  if (dismissReasons) {
    dismissReasons.querySelectorAll('.reason-btn').forEach(btn => btn.disabled = false);
  }
  twoMinBtn.disabled = false;
  
  // Event buckets are explicit: 1-2 direct, 3-4 chess, 5-6 hold, 7-8 Wordle, 9-10 math.
  if (dismissLevel >= 1 && dismissLevel <= 2) {
    setupSingleClickDismiss();
  } else if (dismissLevel >= 3 && dismissLevel <= 4) {
    setupLevelTen();
  } else if (dismissLevel >= 5 && dismissLevel <= 6) {
    setupHoldToDismiss();
  } else if (dismissLevel >= 7 && dismissLevel <= 8) {
    setupWordleDismiss();
  } else if (dismissLevel >= 9 && dismissLevel <= 10) {
    setupMathQuestion();
  }
}

// Level 1-3: Single Click Dismiss
function setupSingleClickDismiss() {
  dismissBtn.style.display = 'block';
  dismissBtn.textContent = 'Dismiss';
  dismissBtn.onclick = async () => {
    if (dismissBtn.disabled) return;
    dismissBtn.disabled = true;
    document.querySelectorAll('.reason-btn').forEach(b => b.disabled = true);
    if (twoMinBtn) twoMinBtn.disabled = true;
    
    try {
      reasonLogged = true;
      await logDismissReason(null);
    } catch (err) {
      console.error('Error logging default dismiss:', err);
    }
    dismissPopup();
  };
  dismissBtn.onmousedown = null;
  dismissBtn.onmouseup = null;
  dismissBtn.onmouseleave = null;
  dismissBtn.ontouchstart = null;
  dismissBtn.ontouchend = null;
  dismissBtn.ontouchcancel = null;
}

// Level 4-5: Hold-to-Dismiss with Progress Bar
function setupHoldToDismiss() {
  dismissBtn.style.display = 'block';
  dismissBtn.textContent = 'Hold to Dismiss';
  progressContainer.style.display = 'block';
  progressBar.style.width = '0%';
  
  // Set hold duration based on importance level (dismissLevel)
  if (dismissLevel === 5) {
    holdDuration = 4000;
  } else if (dismissLevel === 6) {
    holdDuration = 6000;
  } else {
    holdDuration = 10000;
  }
  
  // Clear any single click handler to prevent instant dismissal
  dismissBtn.onclick = null;
  
  dismissBtn.onmousedown = startHold;
  dismissBtn.onmouseup = cancelHold;
  dismissBtn.onmouseleave = cancelHold;
  
  // Touch support
  dismissBtn.ontouchstart = startHold;
  dismissBtn.ontouchend = cancelHold;
  dismissBtn.ontouchcancel = cancelHold;
}

function startHold(e) {
  if (e && typeof e.preventDefault === 'function') {
    e.preventDefault();
  }
  
  holdStartTime = Date.now();
  dismissBtn.classList.add('holding');

  // SFX'i hold süresine senkronize et (mousedown anında) - Riser sound plays for all holds
  if (window.audioManager) {
    const sfxEl = window.audioManager.soundEffects['10-buildup'] || window.audioManager.soundEffects['4-6'];
    if (sfxEl) holdSfxManager.start(sfxEl, holdDuration);
  }
  
  holdTimer = setInterval(() => {
    const elapsed = Date.now() - holdStartTime;
    const progress = Math.min((elapsed / holdDuration) * 100, 100);
    progressBar.style.width = progress + '%';
    
    if (elapsed >= holdDuration) {
      clearInterval(holdTimer);
      holdTimer = null;
      dismissBtn.classList.remove('holding');
      progressBar.style.width = '100%';
      // Confetti removed per spec
      isGameSuccess = true; // suppress dismiss sound effects on success
      setTimeout(() => {
        dismissPopup();
      }, 1500);
    }
  }, 50);
}


function cancelHold() {
  if (!holdTimer) return;
  clearInterval(holdTimer);
  holdTimer = null;
  holdSfxManager.stop(); // iptal edildi — hold SFX'i durdur
  dismissBtn.classList.remove('holding');
  progressBar.style.width = '0%';
}

// Level 6-9: Wordle Dismiss Game
function setupWordleDismiss() {
  const wordleContainer = document.getElementById('wordle-container');
  if (!wordleContainer) return;
  
  // Hide normal dismiss button
  dismissBtn.style.display = 'none';
  
  // Hide snooze reasons and info initially
  if (dismissReasons) dismissReasons.style.display = 'none';
  const snoozeLimitInfo = document.getElementById('snooze-limit-info');
  if (snoozeLimitInfo) snoozeLimitInfo.style.display = 'none';
  
  // Show wordle container
  wordleContainer.style.display = 'flex';
  
  // Determine number of attempts
  if (dismissLevel === 7) {
    wordleMaxAttempts = 5;
  } else if (dismissLevel === 8) {
    wordleMaxAttempts = 4;
  } else {
    wordleMaxAttempts = 5;
  }
  
  // Pick random word
  wordleSecretWord = WORDLE_WORDS[Math.floor(Math.random() * WORDLE_WORDS.length)].toUpperCase();
  console.log('[Wordle] Secret word picked:', wordleSecretWord);
  
  // Reset state
  wordleCurrentAttempt = 0;
  wordleCurrentLetterIdx = 0;
  wordleBoardState = Array(wordleMaxAttempts).fill("");
  wordleActive = true;
  
  // Reset message
  const msgEl = document.getElementById('wordle-message');
  if (msgEl) {
    msgEl.textContent = "Kelimeyi bul, dismiss et!";
    msgEl.style.color = "var(--accent-cyan)";
  }
  
  // Build Grid HTML
  const gridEl = document.getElementById('wordle-grid');
  gridEl.innerHTML = '';
  for (let r = 0; r < wordleMaxAttempts; r++) {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'wordle-row';
    rowDiv.dataset.row = r;
    
    for (let c = 0; c < 5; c++) {
      const cellDiv = document.createElement('div');
      cellDiv.className = 'wordle-cell';
      cellDiv.dataset.col = c;
      rowDiv.appendChild(cellDiv);
    }
    gridEl.appendChild(rowDiv);
  }
  
  // Build Keyboard HTML
  const kbEl = document.getElementById('wordle-keyboard');
  kbEl.innerHTML = '';
  const keyboardRows = [
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', 'Ğ', 'Ü'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ş', 'İ'],
    ['ENTER', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'Ö', 'Ç', '⌫']
  ];
  
  keyboardRows.forEach(rowKeys => {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'keyboard-row';
    
    rowKeys.forEach(key => {
      const keyBtn = document.createElement('button');
      keyBtn.className = 'key';
      keyBtn.textContent = key;
      keyBtn.dataset.key = key;
      if (key === 'ENTER' || key === '⌫') {
        keyBtn.classList.add('wide-key');
      }
      
      keyBtn.onclick = (e) => {
        e.preventDefault();
        handleWordleInput(key);
      };
      
      rowDiv.appendChild(keyBtn);
    });
    kbEl.appendChild(rowDiv);
  });
  
  // Setup physical keyboard listener
  if (wordlePhysicalKeyHandler) {
    window.removeEventListener('keydown', wordlePhysicalKeyHandler);
  }
  
  wordlePhysicalKeyHandler = (e) => {
    if (!wordleActive) return;
    
    let key = e.key;
    if (key === 'Enter') {
      handleWordleInput('ENTER');
    } else if (key === 'Backspace') {
      handleWordleInput('⌫');
    } else {
      let char = key.toUpperCase();
      if (key === 'i') char = 'İ';
      if (key === 'ı') char = 'I';
      if (key === 'ğ') char = 'Ğ';
      if (key === 'ü') char = 'Ü';
      if (key === 'ş') char = 'Ş';
      if (key === 'ö') char = 'Ö';
      if (key === 'ç') char = 'Ç';
      
      const allowedLetters = "ABCÇDEFGĞHIIİJKLMNOÖPRSŞTUÜVYZXWQ";
      if (char.length === 1 && allowedLetters.includes(char)) {
        handleWordleInput(char);
      }
    }
  };
  
  window.addEventListener('keydown', wordlePhysicalKeyHandler);
  
  triggerPopupResize();
}

function handleWordleInput(key) {
  if (!wordleActive) return;
  
  const msgEl = document.getElementById('wordle-message');
  const cells = document.querySelectorAll(`.wordle-row[data-row="${wordleCurrentAttempt}"] .wordle-cell`);
  
  if (key === '⌫') {
    if (wordleCurrentLetterIdx > 0) {
      wordleCurrentLetterIdx--;
      cells[wordleCurrentLetterIdx].textContent = '';
      cells[wordleCurrentLetterIdx].classList.remove('active');
    }
  } else if (key === 'ENTER') {
    if (wordleCurrentLetterIdx < 5) {
      if (msgEl) {
        msgEl.textContent = "Kelimeyi tamamlayın!";
        msgEl.style.color = "var(--accent-amber)";
      }
      return;
    }
    submitWordleGuess();
  } else {
    if (wordleCurrentLetterIdx < 5) {
      cells[wordleCurrentLetterIdx].textContent = key;
      cells[wordleCurrentLetterIdx].classList.add('active');
      wordleCurrentLetterIdx++;
    }
  }
}

function submitWordleGuess() {
  const rowCells = document.querySelectorAll(`.wordle-row[data-row="${wordleCurrentAttempt}"] .wordle-cell`);
  let guess = "";
  rowCells.forEach(cell => {
    guess += cell.textContent;
  });
  
  const secretLetters = wordleSecretWord.split('');
  const guessLetters = guess.split('');
  
  const cellStates = Array(5).fill('absent');
  const letterCount = {};
  
  secretLetters.forEach(l => {
    letterCount[l] = (letterCount[l] || 0) + 1;
  });
  
  for (let i = 0; i < 5; i++) {
    if (guessLetters[i] === secretLetters[i]) {
      cellStates[i] = 'correct';
      letterCount[guessLetters[i]]--;
    }
  }
  
  for (let i = 0; i < 5; i++) {
    if (cellStates[i] !== 'correct') {
      const l = guessLetters[i];
      if (letterCount[l] && letterCount[l] > 0) {
        cellStates[i] = 'present';
        letterCount[l]--;
      }
    }
  }
  
  for (let i = 0; i < 5; i++) {
    const cell = rowCells[i];
    const state = cellStates[i];
    const letter = guessLetters[i];
    
    cell.classList.remove('active');
    cell.classList.add(state);
    
    const keyBtn = document.querySelector(`.key[data-key="${letter}"]`);
    if (keyBtn) {
      if (state === 'correct') {
        keyBtn.classList.remove('present', 'absent');
        keyBtn.classList.add('correct');
      } else if (state === 'present') {
        if (!keyBtn.classList.contains('correct')) {
          keyBtn.classList.remove('absent');
          keyBtn.classList.add('present');
        }
      } else {
        if (!keyBtn.classList.contains('correct') && !keyBtn.classList.contains('present')) {
          keyBtn.classList.add('absent');
        }
      }
    }
  }
  
  if (guess === wordleSecretWord) {
    wordleActive = false;
    const msgEl = document.getElementById('wordle-message');
    if (msgEl) {
      msgEl.textContent = "Tebrikler! Kelimeyi buldunuz.";
      msgEl.style.color = "#22c55e";
    }
    
    if (wordlePhysicalKeyHandler) {
      window.removeEventListener('keydown', wordlePhysicalKeyHandler);
      wordlePhysicalKeyHandler = null;
    }
    
    isGameSuccess = true;
    
    setTimeout(() => {
      dismissPopup();
    }, 1500);
    return;
  }
  
  wordleCurrentAttempt++;
  wordleCurrentLetterIdx = 0;
  
  if (wordleCurrentAttempt >= wordleMaxAttempts) {
    wordleActive = false;
    const msgEl = document.getElementById('wordle-message');
    if (msgEl) {
      msgEl.innerHTML = `Maalesef bulamadınız! <br> Doğru kelime: <strong style="color: #22c55e;">${wordleSecretWord}</strong>`;
      msgEl.style.color = "var(--danger-color)";
    }
    
    if (wordlePhysicalKeyHandler) {
      window.removeEventListener('keydown', wordlePhysicalKeyHandler);
      wordlePhysicalKeyHandler = null;
    }
    
    setTimeout(() => {
      if (snoozeReasonUiEnabled && dismissReasons) {
        dismissReasons.style.display = 'grid';
        dismissReasons.classList.add('show');
      }
      checkSnoozeLimits(currentTip.id, dismissLevel);
    }, 1000);
  }
}


// Level 7-9: Math Question
function setupMathQuestion() {
  dismissBtn.style.display = 'none';
  mathQuestion.style.display = 'block';
  
  // Generate simple math problem
  const num1 = Math.floor(Math.random() * 50) + 10;
  const num2 = Math.floor(Math.random() * 50) + 10;
  const operation = Math.random() > 0.5 ? '+' : '-';
  
  if (operation === '+') {
    mathAnswerCorrect = num1 + num2;
    mathProblem.textContent = `Soruyu çöz: ${num1} + ${num2} = ?`;
  } else {
    const larger = Math.max(num1, num2);
    const smaller = Math.min(num1, num2);
    mathAnswerCorrect = larger - smaller;
    mathProblem.textContent = `Soruyu çöz: ${larger} - ${smaller} = ?`;
  }
  
  mathSubmit.onclick = () => {
    const userAnswer = parseInt(mathAnswer.value);
    if (userAnswer === mathAnswerCorrect) {
      // Math correct win sfx removed per spec
      isGameSuccess = true;
      dismissPopup();
    } else {
      mathAnswer.style.borderColor = 'var(--danger-color)';
      mathAnswer.value = '';
      mathAnswer.placeholder = 'Yanlış! Tekrar deneyin.';
    }
  };
  
  mathAnswer.onkeypress = (e) => {
    if (e.key === 'Enter') {
      mathSubmit.click();
    }
  };
}

// Level 10: Chess Game Dismiss (Şah Mat Oyunu)
function setupLevelTen() {
  // Hide normal dismiss button
  dismissBtn.style.display = 'none';
  
  // Ensure snooze buttons and info are hidden for importance 10 to avoid conflict
  const dismissReasons = document.getElementById('dismiss-reasons');
  const snoozeLimitInfo = document.getElementById('snooze-limit-info');
  if (dismissReasons) dismissReasons.style.display = 'none';
  if (snoozeLimitInfo) snoozeLimitInfo.style.display = 'none';
  
  const chessContainer = document.getElementById('chess-container');
  if (chessContainer) chessContainer.style.display = 'flex';
  
  // Setup confetti canvas for end game explosion
  confettiCanvas.style.display = 'block';
  const ctx = confettiCanvas.getContext('2d');
  confettiCanvas.width = popupContainer.offsetWidth;
  confettiCanvas.height = popupContainer.offsetHeight;
  
  initializeChessGame();
  
  triggerPopupResize();
}

function initializeChessGame() {
  chessBoardState = {
    '7,7': { type: 'K', color: 'w' }, // White King at h1 (7,7)
    '6,6': { type: 'Q', color: 'w' }, // White Queen at g2 (6,6)
    '7,0': { type: 'K', color: 'b' }  // Black King at h8 (7,0)
  };
  
  chessSelectedSquare = null;
  chessValidMoves = [];
  chessActive = true;
  
  const msgEl = document.getElementById('chess-message');
  if (msgEl) {
    msgEl.textContent = "Şah mat et, dismiss et! (Beyaz Hamle Yapar)";
    msgEl.style.color = "var(--accent-cyan)";
  }
  
  renderChessBoard();
}

function renderChessBoard() {
  const boardEl = document.getElementById('chess-board');
  if (!boardEl) return;
  boardEl.innerHTML = '';
  
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const square = document.createElement('div');
      const isDark = (r + c) % 2 === 1;
      square.className = `chess-square ${isDark ? 'dark' : 'light'}`;
      square.dataset.col = c;
      square.dataset.row = r;
      
      const posKey = `${c},${r}`;
      const piece = chessBoardState[posKey];
      
      if (piece) {
        const pieceSpan = document.createElement('span');
        pieceSpan.className = `chess-piece ${piece.color === 'w' ? 'white-piece' : 'black-piece'}`;
        if (piece.type === 'K') {
          pieceSpan.textContent = '♚';
        } else if (piece.type === 'Q') {
          pieceSpan.textContent = '♛';
        }
        square.appendChild(pieceSpan);
      }
      
      // Highlights
      if (chessSelectedSquare === posKey) {
        square.classList.add('selected');
      }
      
      if (chessValidMoves.includes(posKey)) {
        square.classList.add('valid-move');
      }
      
      square.onclick = (e) => {
        e.preventDefault();
        if (!chessDragState) handleChessSquareClick(c, r);
      };
      square.onpointerdown = (e) => startChessDrag(e, posKey, square);
      
      boardEl.appendChild(square);
    }
  }
  
  triggerPopupResize();
}

function startChessDrag(event, fromKey, square) {
  const piece = chessBoardState[fromKey];
  if (!chessActive || !piece || piece.color !== 'w') return;
  event.preventDefault();
  const preview = document.createElement('span');
  preview.className = `chess-drag-preview ${piece.color === 'w' ? 'white-piece' : 'black-piece'}`;
  preview.textContent = piece.type === 'Q' ? '♛' : '♚';
  document.body.appendChild(preview);
  chessDragState = { fromKey, preview, board: square.closest('.chess-board') };
  moveChessDragPreview(event);
  window.addEventListener('pointermove', moveChessDragPreview);
  window.addEventListener('pointerup', finishChessDrag, { once: true });
  window.addEventListener('pointercancel', cancelChessDrag, { once: true });
}
function moveChessDragPreview(event) { if (chessDragState) chessDragState.preview.style.transform = `translate3d(${event.clientX - 16}px, ${event.clientY - 16}px, 0)`; }
function finishChessDrag(event) {
  const drag = chessDragState; cleanupChessDrag();
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.chess-square');
  if (!drag || !target || target.closest('.chess-board') !== drag.board) return;
  const toKey = `${target.dataset.col},${target.dataset.row}`;
  if (toKey === drag.fromKey) return handleChessSquareClick(Number(target.dataset.col), Number(target.dataset.row));
  if (chessSelectedSquare !== drag.fromKey) { const [fromCol, fromRow] = drag.fromKey.split(',').map(Number); handleChessSquareClick(fromCol, fromRow); }
  if (chessValidMoves.includes(toKey)) executeChessMove(drag.fromKey, toKey);
}
function cancelChessDrag() { cleanupChessDrag(); }
function cleanupChessDrag() { if (!chessDragState) return; chessDragState.preview.remove(); chessDragState = null; window.removeEventListener('pointermove', moveChessDragPreview); }

function handleChessSquareClick(col, row) {
  if (!chessActive) return;
  
  const clickPos = `${col},${row}`;
  const piece = chessBoardState[clickPos];
  
  if (chessValidMoves.includes(clickPos) && chessSelectedSquare) {
    executeChessMove(chessSelectedSquare, clickPos);
    return;
  }
  
  if (piece && piece.color === 'w') {
    chessSelectedSquare = clickPos;
    if (piece.type === 'Q') {
      chessValidMoves = getQueenMoves(col, row);
    } else if (piece.type === 'K') {
      chessValidMoves = getKingMoves(col, row);
    }
  } else {
    chessSelectedSquare = null;
    chessValidMoves = [];
  }
  
  renderChessBoard();
}

function getQueenMoves(col, row) {
  const moves = [];
  const directions = [
    [0, 1], [0, -1], [1, 0], [-1, 0],
    [1, 1], [1, -1], [-1, 1], [-1, -1]
  ];
  
  directions.forEach(([dc, dr]) => {
    let c = col + dc;
    let r = row + dr;
    while (c >= 0 && c < 8 && r >= 0 && r < 8) {
      const piece = chessBoardState[`${c},${r}`];
      if (piece) {
        if (piece.color !== 'w') {
          moves.push(`${c},${r}`);
        }
        break; // blocked
      }
      moves.push(`${c},${r}`);
      c += dc;
      r += dr;
    }
  });
  return moves;
}

function getKingMoves(col, row) {
  const moves = [];
  const offsets = [
    [0, 1], [0, -1], [1, 0], [-1, 0],
    [1, 1], [1, -1], [-1, 1], [-1, -1]
  ];
  
  offsets.forEach(([dc, dr]) => {
    const c = col + dc;
    const r = row + dr;
    if (c >= 0 && c < 8 && r >= 0 && r < 8) {
      const piece = chessBoardState[`${c},${r}`];
      if (!piece || piece.color !== 'w') {
        moves.push(`${c},${r}`);
      }
    }
  });
  return moves;
}

function executeChessMove(fromKey, toKey) {
  const piece = chessBoardState[fromKey];
  delete chessBoardState[fromKey];
  chessBoardState[toKey] = piece;
  
  chessSelectedSquare = null;
  chessValidMoves = [];
  
  renderChessBoard();
  
  if (piece.type === 'Q' && toKey === '6,1') {
    // Win! Queen moved to g7 (6,1)
    chessActive = false;
    const msgEl = document.getElementById('chess-message');
    if (msgEl) {
      msgEl.textContent = "Tebrikler! Şah mat!";
      msgEl.style.color = "#22c55e";
    }
    
    // Checkmate sound and confetti removed per spec
    isGameSuccess = true;
    
    setTimeout(() => {
      dismissPopup();
    }, 1500);
  } else {
    // Wrong move!
    chessActive = false;
    const msgEl = document.getElementById('chess-message');
    if (msgEl) {
      msgEl.textContent = "Yanlış Hamle! Tekrar Deneyin.";
      msgEl.style.color = "var(--danger-color)";
    }
    
    setTimeout(() => {
      initializeChessGame();
    }, 1500);
  }
}

function startLevelTenHold(e) {
  e.preventDefault();
  holdStartTime = Date.now();
  dismissBtn.classList.add('holding');
  
  // Start with subtle shake
  popupContainer.classList.add('shake-subtle');
  
  // Confetti build-up removed per spec
  
  // Show progress bar for level 10
  progressContainer.style.display = 'block';
  progressBar.style.width = '0%';

  // SFX'i hold süresine senkronize et (mousedown anında)
  // 10-buildup varsa onu kullan, yoksa '10' veya genel dismiss SFX
  if (window.audioManager) {
    const sfxEl = window.audioManager.soundEffects['10-buildup']
               || window.audioManager.soundEffects['10'];
    if (sfxEl) holdSfxManager.start(sfxEl, holdDuration);
  }
  
  holdTimer = setInterval(() => {
    const elapsed = Date.now() - holdStartTime;
    const progress = Math.min((elapsed / holdDuration) * 100, 100);
    
    // Update progress bar
    progressBar.style.width = progress + '%';
    
    // Apply level-10 class and progress-based color classes
    progressBar.classList.add('level-10');
    progressBar.classList.remove('progress-low', 'progress-medium', 'progress-high', 'progress-critical');
    
    if (progress < 25) {
      progressBar.classList.add('progress-low');
    } else if (progress < 50) {
      progressBar.classList.add('progress-medium');
    } else if (progress < 75) {
      progressBar.classList.add('progress-high');
    } else {
      progressBar.classList.add('progress-critical');
    }
    
    // Progressive shake intensity
    if (progress < 25) {
      // Subtle shake (0-25%)
      popupContainer.classList.remove('shake-moderate', 'shake-intense', 'shake-extreme');
      popupContainer.classList.add('shake-subtle');
      popupContainer.style.animationDuration = '0.5s';
      dismissBtn.classList.remove('shake-subtle', 'shake-moderate', 'shake-intense', 'shake-extreme');
    } else if (progress < 50) {
      // Moderate shake (25-50%)
      popupContainer.classList.remove('shake-subtle', 'shake-intense', 'shake-extreme');
      popupContainer.classList.add('shake-moderate');
      popupContainer.style.animationDuration = '0.4s';
      dismissBtn.classList.remove('shake-subtle', 'shake-moderate', 'shake-intense', 'shake-extreme');
      dismissBtn.classList.add('shake-moderate');
    } else if (progress < 75) {
      // Intense shake (50-75%)
      popupContainer.classList.remove('shake-subtle', 'shake-moderate', 'shake-extreme');
      popupContainer.classList.add('shake-intense');
      popupContainer.style.animationDuration = '0.3s';
      dismissBtn.classList.remove('shake-subtle', 'shake-moderate', 'shake-intense', 'shake-extreme');
      dismissBtn.classList.add('shake-intense');
    } else {
      // Extreme shake (75-100%)
      popupContainer.classList.remove('shake-subtle', 'shake-moderate', 'shake-intense');
      popupContainer.classList.add('shake-extreme');
      popupContainer.style.animationDuration = '0.2s';
      dismissBtn.classList.remove('shake-subtle', 'shake-moderate', 'shake-intense', 'shake-extreme');
      dismissBtn.classList.add('shake-extreme');
    }
    
    if (elapsed >= holdDuration) {
      clearInterval(holdTimer);
      // Confetti removed per spec
      isGameSuccess = true;
      setTimeout(() => dismissPopup(), 1500);
    }
  }, 50);
}


function cancelLevelTenHold() {
  clearInterval(holdTimer);
  dismissBtn.classList.remove('holding');
  
  // Remove all shake classes
  popupContainer.classList.remove('shake-subtle', 'shake-moderate', 'shake-intense', 'shake-extreme');
  popupContainer.style.animationDuration = '';
  
  // Remove button shake classes
  dismissBtn.classList.remove('shake-subtle', 'shake-moderate', 'shake-intense', 'shake-extreme');
  
  // Reset progress bar
  progressBar.style.width = '0%';
  progressBar.classList.remove('level-10', 'progress-low', 'progress-medium', 'progress-high', 'progress-critical');
  progressContainer.style.display = 'none';
  
  // Stop confetti
  stopConfetti();
  
  // Stop hold SFX (Web Audio source)
  holdSfxManager.stop();
}


// Confetti System for Level 10
function drawStar(ctx, cx, cy, spikes, outerRadius, innerRadius) {
  let rot = Math.PI / 2 * 3;
  let x = cx;
  let y = cy;
  let step = Math.PI / spikes;

  ctx.beginPath();
  ctx.moveTo(cx, cy - outerRadius);
  for (let i = 0; i < spikes; i++) {
    x = cx + Math.cos(rot) * outerRadius;
    y = cy + Math.sin(rot) * outerRadius;
    ctx.lineTo(x, y);
    rot += step;

    x = cx + Math.cos(rot) * innerRadius;
    y = cy + Math.sin(rot) * innerRadius;
    ctx.lineTo(x, y);
    rot += step;
  }
  ctx.lineTo(cx, cy - outerRadius);
  ctx.closePath();
  ctx.fill();
}

let isBuildingUp = false;
let buildUpStartTime = 0;

function addConfettiParticle(isExplosion = false) {
  const colors = ['#6C63FF', '#00D9FF', '#00FF88', '#FFA502', '#FF4757', '#FFD700', '#FF69B4', '#FFFFFF'];
  const size = Math.random() * 8 + 6;
  
  confettiParticles.push({
    x: Math.random() * confettiCanvas.width,
    y: -Math.random() * 30 - 10, // above top edge
    vx: (Math.random() - 0.5) * 2, // subtle horizontal drift
    vy: Math.random() * 1 + 0.5, // slow initial speed
    gravity: Math.random() * 0.01 + 0.03, // slow gravity fall (0.03 to 0.04)
    maxVy: Math.random() * 1.5 + 1.5,
    rotation: Math.random() * Math.PI * 2,
    rotationSpeed: Math.random() * 0.04 - 0.02, // slow rotation
    color: colors[Math.floor(Math.random() * colors.length)],
    size: size,
    width: size,
    height: size * (Math.random() * 0.4 + 0.8),
    opacity: 1,
    life: 1.0,
    isExplosion: isExplosion
  });
}

function animateConfetti() {
  if (!confettiCanvas) return;
  const ctx = confettiCanvas.getContext('2d');
  ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  
  const elapsed = Date.now() - (isBuildingUp ? buildUpStartTime : confettiStartTime);
  const duration = 4500;
  
  if (isBuildingUp) {
    const progress = Math.min(elapsed / holdDuration, 1);
    const spawnRate = 0.3 + (progress * 0.6);
    if (Math.random() < spawnRate) {
      addConfettiParticle(false);
    }
  } else {
    // Normal falling confetti - spawn particles over time
    if (elapsed < duration * 0.7 && confettiParticles.length < 150 && Math.random() < 0.3) {
      addConfettiParticle(true);
    }
  }
  
  confettiParticles.forEach((particle, index) => {
    particle.vy += particle.gravity || 0.035;
    if (particle.maxVy && particle.vy > particle.maxVy) {
      particle.vy = particle.maxVy;
    }
    particle.x += particle.vx;
    particle.y += particle.vy;
    particle.rotation += particle.rotationSpeed || 0.02;
    
    const particleElapsed = Date.now() - (particle.isExplosion ? confettiStartTime : buildUpStartTime);
    particle.opacity = Math.max(0, 1 - (particleElapsed / duration));
    
    ctx.save();
    ctx.translate(particle.x, particle.y);
    ctx.rotate(particle.rotation);
    ctx.fillStyle = particle.color;
    ctx.globalAlpha = particle.opacity;
    
    const w = particle.width || particle.size;
    const h = particle.height || particle.size;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    
    ctx.restore();
    
    if (particle.opacity <= 0 || particle.y > confettiCanvas.height + 50) {
      confettiParticles.splice(index, 1);
    }
  });
  
  if (confettiParticles.length > 0 || isBuildingUp || (!isBuildingUp && elapsed < duration)) {
    confettiAnimationId = requestAnimationFrame(animateConfetti);
  } else {
    confettiAnimationId = null;
    ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    confettiCanvas.style.display = 'none';
  }
}

function startConfettiBuildUp() {
  if (!confettiCanvas) return;
  confettiCanvas.style.display = 'block';
  confettiCanvas.width = popupContainer.offsetWidth;
  confettiCanvas.height = popupContainer.offsetHeight;
  isBuildingUp = true;
  buildUpStartTime = Date.now();
  if (!confettiAnimationId) {
    animateConfetti();
  }
}

function triggerConfettiExplosion() {
  if (!confettiCanvas) return;
  confettiCanvas.style.display = 'block';
  confettiCanvas.width = popupContainer.offsetWidth;
  confettiCanvas.height = popupContainer.offsetHeight;
  
  confettiStartTime = Date.now();
  confettiParticles = [];
  
  const initialCount = 80;
  for (let i = 0; i < initialCount; i++) {
    addConfettiParticle(true);
  }
  
  if (window.audioManager) {
    if (dismissLevel === 10) {
      window.audioManager.playLevel10Hit();
    }
    window.audioManager.playConfetti();
  }

  if (!confettiAnimationId) {
    animateConfetti();
  }
}

function stopConfetti() {
  isBuildingUp = false;
  if (confettiAnimationId) {
    cancelAnimationFrame(confettiAnimationId);
    confettiAnimationId = null;
  }
  confettiParticles = [];
  if (confettiCanvas) {
    const ctx = confettiCanvas.getContext('2d');
    ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    confettiCanvas.style.display = 'none';
  }
}

// Check snooze limits and update buttons/badge
async function checkSnoozeLimits(tipId, importance) {
  const snoozeLimitInfo = document.getElementById('snooze-limit-info');
  const dismissReasons = document.getElementById('dismiss-reasons');
  if (!snoozeLimitInfo || !dismissReasons) return;
  if (!snoozeReasonUiEnabled) {
    dismissReasons.style.display = 'none';
    snoozeLimitInfo.style.display = 'none';
    triggerPopupResize();
    return;
  }

  if (importance === 10) {
    dismissReasons.style.display = 'none';
    snoozeLimitInfo.style.display = 'none';
    triggerPopupResize();
    return;
  }

  dismissReasons.style.display = 'grid';

  if (window.electronAPI && window.electronAPI.snoozeCheck) {
    try {
      const { canSnooze, remaining } = await window.electronAPI.snoozeCheck(tipId);
      if (canSnooze === false) {
        dismissReasons.querySelectorAll('.reason-btn').forEach(btn => {
          btn.disabled = true;
          btn.style.opacity = '0.5';
          btn.style.textDecoration = 'line-through';
          btn.style.pointerEvents = 'none';
        });
      } else {
        dismissReasons.querySelectorAll('.reason-btn').forEach(btn => {
          btn.disabled = false;
          btn.style.opacity = '';
          btn.style.textDecoration = '';
          btn.style.pointerEvents = '';
        });
      }

      if (remaining === null) {
        snoozeLimitInfo.textContent = 'Erteleme limiti: Sınırsız';
      } else {
        snoozeLimitInfo.textContent = `${remaining} erteleme hakkın kaldı`;
      }
      snoozeLimitInfo.style.display = 'block';
    } catch (e) {
      console.error('Error checking snooze limits:', e);
      snoozeLimitInfo.style.display = 'none';
    } finally {
      triggerPopupResize();
    }
  } else {
    snoozeLimitInfo.textContent = 'Erteleme limiti: 3 hakkın kaldı (Mock)';
    snoozeLimitInfo.style.display = 'block';
    triggerPopupResize();
  }
}

// Setup dismiss reason buttons
document.querySelectorAll('.reason-btn').forEach(btn => {
  btn.onclick = async () => {
    if (btn.disabled) return;
    
    // Disable all buttons immediately to prevent duplicate clicks
    document.querySelectorAll('.reason-btn').forEach(b => b.disabled = true);
    if (dismissBtn) dismissBtn.disabled = true;
    if (twoMinBtn) twoMinBtn.disabled = true;
    
    const reason = btn.dataset.reason;
    try {
      reasonLogged = true;
      if (window.electronAPI && window.electronAPI.snoozeApply && currentTip) {
        await window.electronAPI.snoozeApply(currentTip.id, reason);
      } else {
        console.log('Snooze applied (mock):', currentTip.id, reason);
      }
    } catch (error) {
      console.error('Error applying snooze:', error);
    }
    dismissPopup();
  };
});

async function logDismissReason(reason) {
  // Log to dismiss_log table via IPC
  if (window.electronAPI && window.electronAPI.logDismissReason && currentTip) {
    try {
      await window.electronAPI.logDismissReason(currentTip.id, reason);
    } catch (error) {
      console.error('Error logging dismiss reason:', error);
    }
  } else {
    console.log('Dismiss reason:', reason);
  }
}

// Two Minute Button
function setupTwoMinuteButton() {
  const focusDuration = currentTip?.focus_duration || 5;
  if (twoMinBtn) {
    twoMinBtn.textContent = `${focusDuration} Dakika Yap`;
  }
  twoMinBtn.onclick = () => {
    if (twoMinBtn.disabled) return;
    twoMinBtn.disabled = true;
    if (dismissBtn) dismissBtn.disabled = true;
    document.querySelectorAll('.reason-btn').forEach(b => b.disabled = true);
    
    localStorage.setItem('active_timer_duration', focusDuration);
    if (currentTip) localStorage.setItem('active_timer_tip_id', currentTip.id);
    reasonLogged = true; // timer flow has its own completion/continue handling
    startFiveMinuteTimer();
  };
}

function formatAudioPath(filePath) {
  if (!filePath) return '';
  if (filePath.startsWith('http://') || filePath.startsWith('https://') || filePath.startsWith('file://')) {
    return filePath;
  }
  if (filePath.startsWith('.') || filePath.startsWith('/') || !filePath.includes(':')) {
    return filePath;
  }
  return 'file:///' + filePath.replace(/\\/g, '/').replace(/ /g, '%20');
}

function startFiveMinuteTimer() {
  const timerPill = document.getElementById('popup-timer-pill');
  const catName = document.getElementById('category-name');
  const deadlineBadge = document.getElementById('popup-deadline-badge');
  const impBadge = document.getElementById('popup-importance-badge');
  const snoozeLimitInfo = document.getElementById('snooze-limit-info');
  const mathQuestion = document.getElementById('math-question');
  const progressContainer = document.getElementById('progress-container');
  const header = document.querySelector('.popup-header');
  const content = document.querySelector('.popup-content');
  const wordleContainer = document.getElementById('wordle-container');
  const chessContainer = document.getElementById('chess-container');
  const followUpQuestion = document.getElementById('follow-up-question');
  const notBitirildiScreen = document.getElementById('not-bitirildi-screen');
  
  if (timerInterval) {
    clearInterval(timerInterval);
  }
  
  // Hide the normal popup and show only the compact timer window.
  if (header) header.style.display = 'none';
  if (content) content.style.display = 'none';
  if (popupActions) popupActions.style.display = 'none';
  if (dismissReasons) dismissReasons.style.display = 'none';
  if (snoozeLimitInfo) snoozeLimitInfo.style.display = 'none';
  if (mathQuestion) mathQuestion.style.display = 'none';
  if (progressContainer) progressContainer.style.display = 'none';
  if (wordleContainer) wordleContainer.style.display = 'none';
  if (chessContainer) chessContainer.style.display = 'none';
  if (followUpQuestion) followUpQuestion.style.display = 'none';
  if (notBitirildiScreen) notBitirildiScreen.style.display = 'none';
  
  const isDebugMode = localStorage.getItem('timer_debug_mode') === 'true';
  popupResizeMode = 'timer';
  if (popupContainer) popupContainer.classList.add('timer-active');
  if (timerScreen) timerScreen.style.display = 'flex';
  if (timerPill) timerPill.style.display = 'none';
  if (catName) catName.style.display = 'none';
  if (deadlineBadge) deadlineBadge.style.display = 'none';
  if (impBadge) impBadge.style.display = 'none';
  if (categoryColor) categoryColor.style.display = 'none';
  if (window.electronAPI && window.electronAPI.popupResize) {
    window.electronAPI.popupResize(150, { mode: 'timer' });
  }
  if (timerDoneBtn) {
    timerDoneBtn.disabled = false;
    timerDoneBtn.onclick = () => {
      if (timerDoneBtn.disabled) return;
      timerDoneBtn.disabled = true;
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      showNotBitirildiScreen();
    };
  }
  
  triggerPopupResize();
  
  let remaining = isDebugMode ? 10 : 300; // 10 seconds or 5 minutes
  const renderTimer = () => {
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    const text = `${mins}:${secs.toString().padStart(2, '0')}`;
    if (timerScreenTime) timerScreenTime.textContent = text;
  };
  renderTimer();

  timerInterval = setInterval(() => {
    remaining--;
    renderTimer();
    
    if (remaining <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      
      // Play sound
      try {
        const defaultSound = '../SoundFX/1-3 Bubble effect - Epidemic Sound.mp3';
        const rawPath = currentTip?.soundPath || currentTip?.sound || currentTip?.audioPath || currentTip?.audio || defaultSound;
        const soundPath = formatAudioPath(rawPath);
        console.log('[timer] Playing sound from:', soundPath);
        const audio = new Audio(soundPath);
        audio.play().catch(e => console.error('Error playing notification sound:', e));
      } catch (err) {
        console.error('Failed to play sound:', err);
      }
      
      showNotBitirildiScreen();
    }
  }, 1000);
}
function showNotBitirildiScreen() {
  popupResizeMode = 'content';
  if (popupContainer) popupContainer.classList.remove('timer-active');
  if (timerScreen) timerScreen.style.display = 'none';
  if (timerDoneBtn) timerDoneBtn.disabled = false;
  const notBitirildiScreen = document.getElementById('not-bitirildi-screen');
  const notBitirildiContent = document.getElementById('not-bitirildi-content');
  
  if (notBitirildiContent && currentTip) {
    notBitirildiContent.textContent = currentTip.content;
  }
  
  // Hide all normal containers/elements
  const header = document.querySelector('.popup-header');
  const content = document.querySelector('.popup-content');
  const progressContainer = document.getElementById('progress-container');
  const wordleContainer = document.getElementById('wordle-container');
  const chessContainer = document.getElementById('chess-container');
  const mathQuestion = document.getElementById('math-question');
  const followUpQuestion = document.getElementById('follow-up-question');
  const popupActions = document.getElementById('popup-actions');
  const snoozeLimitInfo = document.getElementById('snooze-limit-info');
  const dismissReasons = document.getElementById('dismiss-reasons');
  
  if (header) header.style.display = 'none';
  if (content) content.style.display = 'none';
  if (progressContainer) progressContainer.style.display = 'none';
  if (wordleContainer) wordleContainer.style.display = 'none';
  if (chessContainer) chessContainer.style.display = 'none';
  if (mathQuestion) mathQuestion.style.display = 'none';
  if (followUpQuestion) followUpQuestion.style.display = 'none';
  if (popupActions) popupActions.style.display = 'none';
  if (snoozeLimitInfo) snoozeLimitInfo.style.display = 'none';
  if (dismissReasons) dismissReasons.style.display = 'none';
  
  if (notBitirildiScreen) {
    notBitirildiScreen.style.display = 'flex';
  }
  
  notBitirildiDoneInFlight = false;
  
  // Change button texts
  const notBitirildiDoneBtn = document.getElementById('not-bitirildi-done');
  const notBitirildiContinueBtn = document.getElementById('not-bitirildi-continue');

  if (dismissLevel === 10) {
    if (notBitirildiDoneBtn) notBitirildiDoneBtn.textContent = 'Hallettim';
    if (notBitirildiContinueBtn) notBitirildiContinueBtn.textContent = 'Hayır';
  } else {
    if (notBitirildiDoneBtn) notBitirildiDoneBtn.textContent = 'Tamamlandı';
    if (notBitirildiContinueBtn) notBitirildiContinueBtn.textContent = 'Hayır';
  }

  if (notBitirildiDoneBtn) {
    notBitirildiDoneBtn.disabled = false;
    notBitirildiDoneBtn.removeAttribute('aria-busy');
  }
  if (notBitirildiContinueBtn) notBitirildiContinueBtn.disabled = false;
  
  triggerPopupResize();
}

// Follow-up question handlers
function setupFollowUpHandlers() {
  const followUpYesBtn = document.getElementById('follow-up-yes');
  const followUpNoBtn = document.getElementById('follow-up-no');
  const catName = document.getElementById('category-name');
  const deadlineBadge = document.getElementById('popup-deadline-badge');
  
  if (followUpYesBtn) {
    followUpYesBtn.onclick = async () => {
      // Evet: log show, increment tip show_count, normal flow continues
      if (currentTip) {
        try {
          // Increment show_count in database
          await window.electronAPI.dbRun(`
            UPDATE tips
            SET show_count = show_count + 1,
            last_shown = ?
            WHERE id = ?
          `, [Date.now(), currentTip.id]);
          
          // Log to dismiss_log as "completed"
          reasonLogged = true;
          await window.electronAPI.logDismissReason(currentTip.id, 'completed');
        } catch (error) {
          console.error('Error logging completion:', error);
        }
      }
      
      // Hide follow-up and dismiss popup
      hideFollowUpQuestion();
      dismissPopup();
    };
  }
  
  if (followUpNoBtn) {
    followUpNoBtn.onclick = () => {
      // Hayır: same tip re-shows immediately, dismiss reason buttons appear first before content
      hideFollowUpQuestion();
      
      // Restore header content and styles
      if (catName) catName.style.display = 'inline-block';
      if (deadlineBadge && currentTip && currentTip.deadline) {
        deadlineBadge.style.display = 'inline-block';
      }
      
      // Show dismiss reason buttons immediately
      if (snoozeReasonUiEnabled && dismissReasons) {
        dismissReasons.style.display = 'grid';
        dismissReasons.classList.add('show');
      }
      
      // Hide content temporarily (optional, for emphasis)
      tipContent.style.display = 'none';
      
      // Show content after a short delay
      setTimeout(() => {
        tipContent.style.display = 'block';
        triggerPopupResize();
      }, 500);
      
      triggerPopupResize();
    };
  }
}

function showFollowUpQuestion() {
  const followUpQuestion = document.getElementById('follow-up-question');
  if (followUpQuestion) {
    followUpQuestion.style.display = 'block';
    // Hide normal actions
    popupActions.style.display = 'none';
    triggerPopupResize();
  }
}

function hideFollowUpQuestion() {
  const followUpQuestion = document.getElementById('follow-up-question');
  if (followUpQuestion) {
    followUpQuestion.style.display = 'none';
    // Show normal actions
    popupActions.style.display = 'flex';
    triggerPopupResize();
  }
}

// Listen for follow-up event from main process (timer end)
if (window.electronAPI && window.electronAPI.onShowFollowUp) {
  window.electronAPI.onShowFollowUp((tipData) => {
    currentTip = tipData;
    dismissLevel = currentTip.importance || 1;
    
    // Set content
    categoryName.textContent = currentTip.category.name;
    categoryColor.style.background = currentTip.category.color;
    tipContent.textContent = currentTip.content;
    
    // Show follow-up question
    showNotBitirildiScreen();
  });
}

function makeDraggable(element) {
  let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
  
  element.onmousedown = dragMouseDown;
  
  function dragMouseDown(e) {
    e.preventDefault();
    pos3 = e.clientX;
    pos4 = e.clientY;
    document.onmouseup = closeDragElement;
    document.onmousemove = elementDrag;
  }
  
  function elementDrag(e) {
    e.preventDefault();
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;
    element.style.top = (element.offsetTop - pos2) + "px";
    element.style.left = (element.offsetLeft - pos1) + "px";
  }
  
  function closeDragElement() {
    document.onmouseup = null;
    document.onmousemove = null;
  }
}

function triggerPopupResize() {
  if (window.electronAPI && window.electronAPI.popupResize) {
    const runResize = () => {
      const height = document.documentElement.scrollHeight || document.body.scrollHeight;
      const mode = popupResizeMode;
      window.electronAPI.popupResize(height + 20, { mode }); // 20px padding payı ekle
    };
    
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        runResize();
        setTimeout(runResize, 100);
      });
    });
  }
}

function showContinuePopup() {
  // Will be implemented to show "Devam ettin mi?" popup
  alert('2 dakika doldu! Devam ettin mi?');
}

// Dismiss Popup
async function dismissPopup() {
  console.log('[popup] dismissPopup called', dismissLevel);
  if (popupContainer) popupContainer.classList.remove('timer-active');
  if (timerScreen) timerScreen.style.display = 'none';
  
  if (!reasonLogged && currentTip) {
    reasonLogged = true;
    try {
      await logDismissReason(null);
    } catch (err) {
      console.error('Error logging default dismiss:', err);
    }
  }
  
  if (window.audioManager && currentTip && currentTip.previewSfx) {
    const psfx = currentTip.previewSfx;
    if (psfx === 'checkin-success') {
      window.audioManager.playCheckinSuccess();
    } else if (psfx === 'dismiss-snooze') {
      window.audioManager.playDismissSnooze();
    } else if (psfx === 'btn-click') {
      window.audioManager.playBtnClick();
    } else if (psfx === 'math-correct') {
      window.audioManager.playMathCorrect();
    } else if (psfx === 'confetti') {
      window.audioManager.playConfetti();
    } else if (psfx === '1-3') {
      window.audioManager.playSoundEffect(2);
    } else if (psfx === '4-6') {
      window.audioManager.playSoundEffect(5);
    } else if (psfx === '7-9') {
      window.audioManager.playSoundEffect(8);
    } else if (psfx === '10') {
      window.audioManager.playSoundEffect(10);
    } else if (psfx === '10-hit') {
      window.audioManager.playLevel10Hit();
    }
  } else {
    if (!isGameSuccess) {
      // Play sound effect for dismiss level
      if (window.audioManager && dismissLevel) {
        window.audioManager.playSoundEffect(dismissLevel);
      }
      
      // Play dismiss/snooze custom SFX
      if (window.audioManager) {
        window.audioManager.playDismissSnooze();
      }
    }
  }
  
  // Clean up
  if (holdTimer) clearInterval(holdTimer);
  if (confettiAnimationId) cancelAnimationFrame(confettiAnimationId);
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if (wordlePhysicalKeyHandler) {
    window.removeEventListener('keydown', wordlePhysicalKeyHandler);
    wordlePhysicalKeyHandler = null;
  }
  
  // Close popup window via IPC with immediate fallback
  if (window.electronAPI && window.electronAPI.closePopup) {
    window.electronAPI.closePopup()
      .then(() => {
        console.log('Popup closed via IPC');
      })
      .catch(err => {
        console.error('Error closing popup via IPC:', err);
        // Immediate fallback
        window.close();
      });
    // Immediate fallback in case IPC hangs
    setTimeout(() => {
      window.close();
    }, 1000);
  } else {
    // Immediate fallback for testing
    console.log('Popup dismissed');
    window.close();
  }
}

// Initialize on load (for testing)
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize audio manager with settings
  let settingsMap = {};
  try {
    if (window.electronAPI && window.electronAPI.dbQuery) {
      const settings = await window.electronAPI.dbQuery(`SELECT key, value FROM settings`);
      settings.forEach(setting => {
        settingsMap[setting.key] = setting.value;
      });
    }
  } catch (err) {
    console.error('Error loading settings for audio in popup:', err);
  }

  if (window.audioManager) {
    try {
      await window.audioManager.initialize({
        volume: (parseInt(settingsMap['audio_volume']) || 50) / 100,
        musicVolume: (parseInt(settingsMap['music_volume']) || 50) / 100,
        backgroundMusic: settingsMap['background_music'],
        soundLevel1to3: settingsMap['sound_level_1_3'],
        soundLevel1to3Enabled: settingsMap['sound_level_1_3_enabled'] !== '0',
        soundLevel4to6: settingsMap['sound_level_4_6'],
        soundLevel4to6Enabled: settingsMap['sound_level_4_6_enabled'] !== '0',
        soundLevel7to9: settingsMap['sound_level_7_9'],
        soundLevel7to9Enabled: settingsMap['sound_level_7_9_enabled'] !== '0',
        soundLevel10: settingsMap['sound_level_10'],
        soundLevel10Enabled: settingsMap['sound_level_10_enabled'] !== '0',
        soundLevel10BuildUp: settingsMap['sound_level_10_buildup'],
        soundLevel10BuildUpEnabled: settingsMap['sound_level_10_buildup_enabled'] !== '0',
        soundLevel10Hit: settingsMap['sound_level_10_hit'],
        soundLevel10HitEnabled: settingsMap['sound_level_10_hit_enabled'] !== '0',
        sfxChessSelect: settingsMap['sound_sfx_chess_select'],
        sfxChessSelectEnabled: settingsMap['sound_sfx_chess_select_enabled'] !== '0',
        sfxChessPlace: settingsMap['sound_sfx_chess_place'],
        sfxChessPlaceEnabled: settingsMap['sound_sfx_chess_place_enabled'] !== '0',
        sfxChessCheckmate: settingsMap['sound_sfx_chess_checkmate'],
        sfxChessCheckmateEnabled: settingsMap['sound_sfx_chess_checkmate_enabled'] !== '0',
        sfxChessWrong: settingsMap['sound_sfx_chess_wrong'],
        sfxChessWrongEnabled: settingsMap['sound_sfx_chess_wrong_enabled'] !== '0',
        sfxDismissSnooze: settingsMap['sound_sfx_dismiss_snooze'],
        sfxDismissSnoozeEnabled: settingsMap['sound_sfx_dismiss_snooze_enabled'] !== '0',
        sfxMathCorrect: settingsMap['sound_sfx_math_correct'],
        sfxMathCorrectEnabled: settingsMap['sound_sfx_math_correct_enabled'] !== '0',
        sfxConfetti: settingsMap['sound_sfx_confetti'],
        sfxConfettiEnabled: settingsMap['sound_sfx_confetti_enabled'] !== '0',
        sfxBtnClick: settingsMap['sound_sfx_btn_click'],
        sfxBtnClickEnabled: settingsMap['sound_sfx_btn_click_enabled'] !== '0',
        sfxCheckinSuccess: settingsMap['sound_sfx_checkin_success'],
        sfxCheckinSuccessEnabled: settingsMap['sound_sfx_checkin_success_enabled'] !== '0'
      });
    } catch (audioErr) {
      console.error('Error initializing audio manager in popup:', audioErr);
    }
  }

  // Global button click SFX delegation in popup
  document.addEventListener('click', (e) => {
    const target = e.target;
    if (target.closest('button') || target.closest('.btn') || target.closest('.reason-btn') || target.closest('.btn-cyan') || target.closest('.btn-primary') || target.closest('.btn-secondary')) {
      if (window.audioManager) {
        window.audioManager.playBtnClick();
      }
    }
  }, { capture: true });

  // Bind "Not Bitirildi" Screen Buttons
  const notBitirildiDoneBtn = document.getElementById('not-bitirildi-done');
  const notBitirildiContinueBtn = document.getElementById('not-bitirildi-continue');
  
  if (notBitirildiDoneBtn) {
    notBitirildiDoneBtn.onclick = async () => {
      if (notBitirildiDoneInFlight) return;
      notBitirildiDoneInFlight = true;

      notBitirildiDoneBtn.disabled = true;
      notBitirildiDoneBtn.setAttribute('aria-busy', 'true');
      reasonLogged = true;
      if (notBitirildiContinueBtn) notBitirildiContinueBtn.disabled = true;

      if (currentTip && window.electronAPI && window.electronAPI.dbRun) {
        try {
          await window.electronAPI.dbRun(`
            UPDATE tips
            SET status = 'done',
                last_shown = ?
            WHERE id = ?
          `, [Date.now(), currentTip.id]);
          await window.electronAPI.logDismissReason(currentTip.id, 'completed');
        } catch (error) {
          console.error('Error marking tip as completed:', error);
        }
      }
      
      // Trigger success SFX and Confetti ONLY here!
      if (window.audioManager) {
        window.audioManager.playCheckinSuccess();
      }
      triggerConfettiExplosion();
      
      // Close popup after some delay to let confetti show
      setTimeout(() => {
        dismissPopup();
      }, 4000);
    };
  }
  
  if (notBitirildiContinueBtn) {
    notBitirildiContinueBtn.onclick = async () => {
      dismissPopup();
    };
  }

  // Listen for tip data from main process via IPC
  if (window.electronAPI && window.electronAPI.onShowTip) {
    window.electronAPI.onShowTip((tipData) => {
      console.log('[popup] onShowTip received:', tipData);
      initializePopup(tipData);
    });
  }

  // Fetch pending tip data immediately to avoid race conditions
  let tipData = null;
  try {
    // 1. Try localStorage first (manual triggers and previews)
    const stored = localStorage.getItem('active_tip_data');
    if (stored) {
      try {
        tipData = JSON.parse(stored);
        localStorage.removeItem('active_tip_data');
        console.log('[popup] Found active tip data in localStorage:', tipData);
      } catch (e) {
        console.error('[popup] Error parsing localStorage active_tip_data:', e);
      }
    }
    
    // Helper function to show UI warning
    const showUIError = (message) => {
      const categoryNameEl = document.getElementById('category-name');
      const tipContentEl = document.getElementById('tip-content');
      if (categoryNameEl) categoryNameEl.textContent = 'Hata';
      if (tipContentEl) {
        tipContentEl.innerHTML = `<span style="color: #ef4444; font-weight: bold;">${message}</span>`;
      }
    };

    // 2. Try the getPopupData IPC call
    if (!tipData && window.electronAPI && window.electronAPI.getPopupData) {
      try {
        tipData = await window.electronAPI.getPopupData();
        console.log('[popup] Fetched tip data via getPopupData IPC:', tipData);
      } catch (ipcErr) {
        console.error('[popup] getPopupData IPC failed:', ipcErr);
        showUIError('Hata: Not verisi getirilemedi.');
      }
    }
    
    // 3. Fallback to querying the database for the most recently shown active tip
    if (!tipData && window.electronAPI && window.electronAPI.dbQuery) {
      try {
        const lastTips = await window.electronAPI.dbQuery(`
          SELECT t.*, c.name as category_name, c.color as category_color 
          FROM tips t 
          JOIN categories c ON t.category_id = c.id 
          ORDER BY t.last_shown DESC LIMIT 1
        `);
        if (lastTips && lastTips.length > 0) {
          const dbTip = lastTips[0];
          tipData = {
            id: dbTip.id,
            content: dbTip.content,
            importance: dbTip.importance,
            effectiveImportance: dbTip.importance,
            deadline: dbTip.deadline || null,
            category: {
              name: dbTip.category_name,
              color: dbTip.category_color
            }
          };
          
          // Calculate effectiveImportance based on deadline
          if (tipData.deadline) {
            const now = Date.now();
            const deadlineMs = new Date(tipData.deadline).getTime();
            if (!isNaN(deadlineMs)) {
              const remainingMs = deadlineMs - now;
              const DAY = 24 * 60 * 60 * 1000;
              const base = tipData.importance;
              if (remainingMs <= 0)          tipData.effectiveImportance = 10;
              else if (remainingMs <= DAY)   tipData.effectiveImportance = 10;
              else if (remainingMs <= 3 * DAY) tipData.effectiveImportance = Math.min(base + 4, 10);
              else if (remainingMs <= 7 * DAY) tipData.effectiveImportance = Math.min(base + 2, 10);
            }
          }
          console.log('[popup] Loaded most recently shown tip from database:', tipData);
        }
      } catch (dbErr) {
        console.error('[popup] Database fallback query failed:', dbErr);
      }
    }
    
    if (tipData) {
      initializePopup(tipData);
    } else {
      console.error('[popup] No tip data available from any source.');
      showUIError('Hata: Gösterilecek not verisi bulunamadı.');
    }
  } catch (err) {
    console.error('Error in popup data retrieval flow:', err);
  }
});
