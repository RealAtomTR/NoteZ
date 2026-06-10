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

// State
let currentTip = null;
let dismissLevel = 1;
let holdTimer = null;
let holdStartTime = 0;
let holdDuration = 10000; // 10 seconds for levels 4-6 and 10
let mathAnswerCorrect = null;
let confettiParticles = [];
let confettiAnimationId = null;
let dismissReasonTimer = null;
let shakeAnimationId = null;

// Initialize with mock data (will be replaced by Electron IPC)
function initializePopup(tipData) {
  currentTip = tipData || {
    category: { name: 'Yapay Zeka', color: '#6C63FF' },
    content: 'Bugün AI konularında en az 30 dakika çalış.',
    importance: 7
  };
  
  dismissLevel = currentTip.importance || 1;
  
  // Set content
  categoryName.textContent = currentTip.category.name;
  categoryColor.style.background = currentTip.category.color;
  tipContent.textContent = currentTip.content;
  
  // Apply random layout variant
  applyLayoutVariant();
  
  // Setup dismiss mechanism based on level
  setupDismissMechanism();
  
  // Start dismiss reason timer (3 seconds)
  startDismissReasonTimer();
  
  // Setup 2-minute button
  setupTwoMinuteButton();
  
  // Setup follow-up question handlers
  setupFollowUpHandlers();
  
  // Play Level 10 build-up sound if applicable
  if (dismissLevel === 10 && window.audioManager) {
    window.audioManager.playLevel10BuildUp();
  }
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
  
  if (dismissLevel >= 1 && dismissLevel <= 3) {
    // Single click dismiss
    setupSingleClickDismiss();
  } else if (dismissLevel >= 4 && dismissLevel <= 6) {
    // Hold-to-dismiss with progress bar
    setupHoldToDismiss();
  } else if (dismissLevel >= 7 && dismissLevel <= 9) {
    // Math question
    setupMathQuestion();
  } else if (dismissLevel === 10) {
    // Hold + shake + confetti + explosion
    setupLevelTen();
  }
}

// Level 1-3: Single Click Dismiss
function setupSingleClickDismiss() {
  dismissBtn.textContent = 'Dismiss';
  dismissBtn.onclick = () => {
    dismissPopup();
  };
}

// Level 4-6: Hold-to-Dismiss with Progress Bar
function setupHoldToDismiss() {
  dismissBtn.textContent = 'Hold to Dismiss';
  progressContainer.style.display = 'block';
  progressBar.style.width = '0%';
  
  dismissBtn.onmousedown = startHold;
  dismissBtn.onmouseup = cancelHold;
  dismissBtn.onmouseleave = cancelHold;
  
  // Touch support
  dismissBtn.ontouchstart = startHold;
  dismissBtn.ontouchend = cancelHold;
}

function startHold(e) {
  e.preventDefault();
  holdStartTime = Date.now();
  dismissBtn.classList.add('holding');
  
  holdTimer = setInterval(() => {
    const elapsed = Date.now() - holdStartTime;
    const progress = Math.min((elapsed / holdDuration) * 100, 100);
    progressBar.style.width = progress + '%';
    
    if (elapsed >= holdDuration) {
      clearInterval(holdTimer);
      dismissPopup();
    }
  }, 50);
}

function cancelHold() {
  clearInterval(holdTimer);
  dismissBtn.classList.remove('holding');
  progressBar.style.width = '0%';
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

// Level 10: Hold + Shake + Confetti + Explosion
function setupLevelTen() {
  dismissBtn.textContent = 'Hold to Dismiss';
  confettiCanvas.style.display = 'block';
  
  // Setup canvas
  const ctx = confettiCanvas.getContext('2d');
  confettiCanvas.width = popupContainer.offsetWidth;
  confettiCanvas.height = popupContainer.offsetHeight;
  
  dismissBtn.onmousedown = startLevelTenHold;
  dismissBtn.onmouseup = cancelLevelTenHold;
  dismissBtn.onmouseleave = cancelLevelTenHold;
  
  // Touch support
  dismissBtn.ontouchstart = startLevelTenHold;
  dismissBtn.ontouchend = cancelLevelTenHold;
}

function startLevelTenHold(e) {
  e.preventDefault();
  holdStartTime = Date.now();
  dismissBtn.classList.add('holding');
  
  // Start with subtle shake
  popupContainer.classList.add('shake-subtle');
  
  // Start confetti build-up
  startConfettiBuildUp();
  
  // Show progress bar for level 10
  progressContainer.style.display = 'block';
  progressBar.style.width = '0%';
  
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
      triggerConfettiExplosion();
      setTimeout(() => dismissPopup(), 500);
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
  
  // Stop Level 10 build-up sound if playing
  if (window.audioManager) {
    window.audioManager.stopLevel10BuildUp();
  }
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

function startConfettiBuildUp() {
  const ctx = confettiCanvas.getContext('2d');
  let buildUpStartTime = Date.now();
  let spawnRate = 0.3; // Start with 30% chance to spawn per frame
  
  function addConfettiParticle() {
    const colors = ['#6C63FF', '#00D9FF', '#00FF88', '#FFA502', '#FF4757', '#FFD700', '#FF69B4'];
    
    // Spawn from edges of the canvas
    let x, y, vx, vy;
    const edge = Math.floor(Math.random() * 4); // 0: top, 1: right, 2: bottom, 3: left
    
    switch(edge) {
      case 0: // Top edge
        x = Math.random() * confettiCanvas.width;
        y = -10;
        vx = (Math.random() - 0.5) * 4;
        vy = Math.random() * 3 + 1;
        break;
      case 1: // Right edge
        x = confettiCanvas.width + 10;
        y = Math.random() * confettiCanvas.height;
        vx = -Math.random() * 3 - 1;
        vy = (Math.random() - 0.5) * 4;
        break;
      case 2: // Bottom edge
        x = Math.random() * confettiCanvas.width;
        y = confettiCanvas.height + 10;
        vx = (Math.random() - 0.5) * 4;
        vy = -Math.random() * 3 - 1;
        break;
      case 3: // Left edge
        x = -10;
        y = Math.random() * confettiCanvas.height;
        vx = Math.random() * 3 + 1;
        vy = (Math.random() - 0.5) * 4;
        break;
    }
    
    confettiParticles.push({
      x: x,
      y: y,
      vx: vx,
      vy: vy,
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 10,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: Math.random() * 12 + 6,
      opacity: 1,
      life: 1.0
    });
  }
  
  function animateConfetti() {
    ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    
    // Calculate progress (0 to 1) over 10 seconds
    const elapsed = Date.now() - buildUpStartTime;
    const progress = Math.min(elapsed / holdDuration, 1);
    
    // Increase spawn rate as progress increases (from 30% to 90%)
    spawnRate = 0.3 + (progress * 0.6);
    
    // Add new particles based on spawn rate
    if (Math.random() < spawnRate) {
      addConfettiParticle();
    }
    
    confettiParticles.forEach((particle, index) => {
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vy += 0.15; // gravity
      particle.rotation += particle.rotationSpeed;
      
      // Explosion particles fade faster
      if (particle.isExplosion) {
        particle.life -= 0.01;
      } else {
        particle.life -= 0.002;
      }
      particle.opacity = Math.max(0, particle.life);
      
      // Draw particle
      ctx.save();
      ctx.translate(particle.x, particle.y);
      ctx.rotate(particle.rotation * Math.PI / 180);
      ctx.fillStyle = particle.color;
      ctx.globalAlpha = particle.opacity;
      
      if (particle.isStar) {
        // Draw star shape
        drawStar(ctx, 0, 0, 5, particle.size, particle.size / 2);
      } else {
        // Draw square confetti
        ctx.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size);
      }
      
      ctx.restore();
      
      // Remove dead particles or those far off screen
      if (particle.life <= 0 || 
          particle.y > confettiCanvas.height + 100 || 
          particle.y < -100 ||
          particle.x > confettiCanvas.width + 100 ||
          particle.x < -100) {
        confettiParticles.splice(index, 1);
      }
    });
    
    confettiAnimationId = requestAnimationFrame(animateConfetti);
  }
  
  animateConfetti();
}

function triggerConfettiExplosion() {
  const ctx = confettiCanvas.getContext('2d');
  const centerX = confettiCanvas.width / 2;
  const centerY = confettiCanvas.height / 2;
  const colors = ['#6C63FF', '#00D9FF', '#00FF88', '#FFA502', '#FF4757', '#FFD700', '#FF69B4', '#FFFFFF'];
  
  // Create massive explosion particles - 300 particles for dramatic effect
  for (let i = 0; i < 300; i++) {
    const angle = (Math.PI * 2 * i) / 300;
    const speed = Math.random() * 15 + 8; // Faster and more varied speeds
    confettiParticles.push({
      x: centerX,
      y: centerY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 20, // More rotation
      color: colors[Math.floor(Math.random() * colors.length)],
      size: Math.random() * 16 + 8, // Larger particles
      opacity: 1,
      life: 1.0,
      isExplosion: true // Mark as explosion particle
    });
  }
  
  // Add some star-shaped particles for extra visual appeal
  for (let i = 0; i < 50; i++) {
    const angle = (Math.PI * 2 * i) / 50;
    const speed = Math.random() * 20 + 10;
    confettiParticles.push({
      x: centerX,
      y: centerY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 30,
      color: '#FFD700', // Gold stars
      size: Math.random() * 20 + 10,
      opacity: 1,
      life: 1.0,
      isStar: true,
      isExplosion: true
    });
  }
  
  // Play Level 10 hit sound
  if (window.audioManager) {
    window.audioManager.playLevel10Hit();
  }
}

function stopConfetti() {
  if (confettiAnimationId) {
    cancelAnimationFrame(confettiAnimationId);
    confettiAnimationId = null;
  }
  confettiParticles = [];
  const ctx = confettiCanvas.getContext('2d');
  ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
}

// Dismiss Reason Buttons (appear after 3 seconds)
function startDismissReasonTimer() {
  dismissReasonTimer = setTimeout(() => {
    dismissReasons.classList.add('show');
  }, 3000);
}

function hideDismissReasons() {
  dismissReasons.classList.remove('show');
}

// Setup dismiss reason buttons
document.querySelectorAll('.reason-btn').forEach(btn => {
  btn.onclick = () => {
    const reason = btn.dataset.reason;
    logDismissReason(reason);
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
  twoMinBtn.onclick = () => {
    dismissPopup();
    startTwoMinuteTimer();
  };
}

function startTwoMinuteTimer() {
  // Trigger timer window via IPC
  if (window.electronAPI && window.electronAPI.showTimer && currentTip) {
    window.electronAPI.showTimer(currentTip);
  }
}

// Follow-up question handlers
function setupFollowUpHandlers() {
  const followUpYesBtn = document.getElementById('follow-up-yes');
  const followUpNoBtn = document.getElementById('follow-up-no');
  
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
      
      // Show dismiss reason buttons immediately
      dismissReasons.classList.add('show');
      
      // Hide content temporarily (optional, for emphasis)
      tipContent.style.display = 'none';
      
      // Show content after a short delay
      setTimeout(() => {
        tipContent.style.display = 'block';
      }, 500);
    };
  }
}

function showFollowUpQuestion() {
  const followUpQuestion = document.getElementById('follow-up-question');
  if (followUpQuestion) {
    followUpQuestion.style.display = 'block';
    // Hide normal actions
    popupActions.style.display = 'none';
  }
}

function hideFollowUpQuestion() {
  const followUpQuestion = document.getElementById('follow-up-question');
  if (followUpQuestion) {
    followUpQuestion.style.display = 'none';
    // Show normal actions
    popupActions.style.display = 'flex';
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
    showFollowUpQuestion();
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

function showContinuePopup() {
  // Will be implemented to show "Devam ettin mi?" popup
  alert('2 dakika doldu! Devam ettin mi?');
}

// Dismiss Popup
function dismissPopup() {
  // Play sound effect for dismiss level
  if (window.audioManager && dismissLevel) {
    window.audioManager.playSoundEffect(dismissLevel);
  }
  
  // Clean up
  if (holdTimer) clearInterval(holdTimer);
  if (dismissReasonTimer) clearTimeout(dismissReasonTimer);
  if (confettiAnimationId) cancelAnimationFrame(confettiAnimationId);
  
  // Close popup window via IPC
  if (window.electronAPI && window.electronAPI.closePopup) {
    window.electronAPI.closePopup();
  } else {
    // Fallback for testing
    console.log('Popup dismissed');
    window.location.reload();
  }
}

// Initialize on load (for testing)
document.addEventListener('DOMContentLoaded', () => {
  // Listen for tip data from main process via IPC
  if (window.electronAPI && window.electronAPI.onShowTip) {
    window.electronAPI.onShowTip((tipData) => {
      initializePopup(tipData);
    });
  } else {
    // Fallback for testing without Electron
    const testTip = {
      category: { name: 'Yapay Zeka', color: '#6C63FF' },
      content: 'Bugün AI konularında en az 30 dakika çalış.',
      importance: Math.floor(Math.random() * 10) + 1
    };
    
    initializePopup(testTip);
  }
});
