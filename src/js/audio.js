// Audio System - HTML5 Audio API with fade in/out

class AudioManager {
  constructor() {
    this.backgroundMusic = null;
    this.soundEffects = {};
    this.volume = 0.5; // Default volume 50%
    this.musicVolume = 0.5; // Default music volume 50%
    this.isFading = false;
    
    // Web Audio API context and nodes for background music fade out/in
    this.audioCtx = null;
    this.gainNode = null;
    this.trackNode = null;
    
    // Enable states for all sound effects (default true)
    this.enabledStates = {
      '1-3': true,
      '4-6': true,
      '7-9': true,
      '10': true,
      '10-hit': true,
      'chess-select': true,
      'chess-place': true,
      'chess-checkmate': true,
      'chess-wrong': true,
      'dismiss-snooze': true,
      'math-correct': true,
      'confetti': true,
      'btn-click': true,
      'checkin-success': true
    };
  }

  // Initialize audio with settings
  async initialize(settings) {
    this.volume = settings.volume !== undefined ? settings.volume : 0.5;
    this.musicVolume = settings.musicVolume !== undefined ? settings.musicVolume : 0.5;
    
    if (settings.backgroundMusic) {
      this.setBackgroundMusic(settings.backgroundMusic);
    }
    
    const loadSound = (key, path, enabled) => {
      this.enabledStates[key] = enabled !== false;
      if (path) {
        const encoded = this.encodeFilePath(path);
        console.log(`[audio] Loading SFX (${key}):`, encoded);
        this.soundEffects[key] = new Audio(encoded);
      } else {
        this.soundEffects[key] = null;
      }
    };

    loadSound('1-3', settings.soundLevel1to3, settings.soundLevel1to3Enabled);
    loadSound('4-6', settings.soundLevel4to6, settings.soundLevel4to6Enabled);
    loadSound('7-9', settings.soundLevel7to9, settings.soundLevel7to9Enabled);
    loadSound('10', settings.soundLevel10, settings.soundLevel10Enabled);
    loadSound('10-hit', settings.soundLevel10Hit, settings.soundLevel10HitEnabled);
    
    loadSound('chess-select', settings.sfxChessSelect, settings.sfxChessSelectEnabled);
    loadSound('chess-place', settings.sfxChessPlace, settings.sfxChessPlaceEnabled);
    loadSound('chess-checkmate', settings.sfxChessCheckmate, settings.sfxChessCheckmateEnabled);
    loadSound('chess-wrong', settings.sfxChessWrong, settings.sfxChessWrongEnabled);
    loadSound('dismiss-snooze', settings.sfxDismissSnooze, settings.sfxDismissSnoozeEnabled);
    loadSound('math-correct', settings.sfxMathCorrect, settings.sfxMathCorrectEnabled);
    loadSound('confetti', settings.sfxConfetti, settings.sfxConfettiEnabled);
    loadSound('btn-click', settings.sfxBtnClick, settings.sfxBtnClickEnabled);
    loadSound('checkin-success', settings.sfxCheckinSuccess, settings.sfxCheckinSuccessEnabled);
  }

  initAudioContext() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextClass();
      this.gainNode = this.audioCtx.createGain();
      this.gainNode.connect(this.audioCtx.destination);
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  setupMusicNode() {
    this.initAudioContext();
    if (this.trackNode) {
      try { this.trackNode.disconnect(); } catch (_) {}
    }
    this.trackNode = this.audioCtx.createMediaElementSource(this.backgroundMusic);
    this.trackNode.connect(this.gainNode);
  }

  // Set background music file
  setBackgroundMusic(filePath) {
    if (this.backgroundMusic) {
      this.stopBackgroundMusic();
    }
    
    this.backgroundMusic = new Audio(this.encodeFilePath(filePath));
    this.backgroundMusic.loop = true;
    this.backgroundMusic.volume = 1.0; // Media element full volume, we control it via GainNode
    
    this.setupMusicNode();
    
    if (this.gainNode) {
      this.gainNode.gain.setValueAtTime(this.musicVolume * 0.1, this.audioCtx.currentTime);
    }
  }

  // Encode file path for use in HTML5 Audio
  // RULE: Do NOT use encodeURIComponent — it breaks Turkish chars (İ, Ş, Ğ, Ü)
  // Only replace backslashes and spaces.
  encodeFilePath(filePath) {
    if (!filePath) return null;
    
    console.log('[audio] encodeFilePath input:', filePath);
    
    // Already a URL — return as-is
    if (filePath.startsWith('http://') || filePath.startsWith('https://') || filePath.startsWith('file://')) {
      console.log('[audio] encodeFilePath output (unchanged):', filePath);
      return filePath;
    }
    
    // Windows local path: add file:/// prefix, convert backslashes, replace spaces with %20
    // Turkish characters (İ, Ş, Ğ, Ü etc.) are kept raw — browser handles them correctly
    let encoded = 'file:///' + filePath.replace(/\\/g, '/').replace(/ /g, '%20');
    
    console.log('[audio] encodeFilePath output:', encoded);
    return encoded;
  }

  // Fade in background music over duration (ms)
  fadeInBackgroundMusic(duration = 500) {
    if (!this.backgroundMusic) return;
    this.initAudioContext();
    if (!this.gainNode) return;
    
    this.isFading = true;
    const currTime = this.audioCtx.currentTime;
    const durationSeconds = duration / 1000;
    const targetVolume = this.musicVolume * 0.1; // Scaled to -20dB max (0.1 ratio)
    
    this.backgroundMusic.play().catch(err => console.error('Error playing background music:', err));
    
    this.gainNode.gain.cancelScheduledValues(currTime);
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, currTime);
    this.gainNode.gain.linearRampToValueAtTime(targetVolume, currTime + durationSeconds);
    
    setTimeout(() => {
      this.isFading = false;
    }, duration);
  }

  // Fade out background music over duration (ms)
  fadeOutBackgroundMusic(duration = 500) {
    if (!this.backgroundMusic || !this.gainNode) return;
    this.initAudioContext();
    
    this.isFading = true;
    const currTime = this.audioCtx.currentTime;
    const durationSeconds = duration / 1000;
    
    this.gainNode.gain.cancelScheduledValues(currTime);
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, currTime);
    this.gainNode.gain.linearRampToValueAtTime(0, currTime + durationSeconds);
    
    setTimeout(() => {
      if (this.gainNode.gain.value <= 0.01) {
        this.backgroundMusic.pause();
      }
      this.isFading = false;
    }, duration);
  }

  // Stop background music immediately
  stopBackgroundMusic() {
    if (this.backgroundMusic) {
      this.backgroundMusic.pause();
      this.backgroundMusic.currentTime = 0;
      if (this.gainNode && this.audioCtx) {
        this.gainNode.gain.setValueAtTime(0, this.audioCtx.currentTime);
      }
    }
  }

  // Play sound effect for dismiss level
  playSoundEffect(level) {
    console.log('[audio] playSoundEffect called', level);
    let soundKey;
    
    if (level >= 1 && level <= 3) {
      soundKey = '1-3';
    } else if (level >= 4 && level <= 6) {
      soundKey = '4-6';
    } else if (level >= 7 && level <= 9) {
      soundKey = '7-9';
    } else if (level === 10) {
      soundKey = '10';
    }
    
    if (soundKey && this.enabledStates[soundKey] && this.soundEffects[soundKey]) {
      const sound = this.soundEffects[soundKey];
      sound.volume = this.volume * 0.178; // Scaled to -15dB max (0.178 ratio)
      sound.currentTime = 0;
      sound.play().catch(err => console.error('Error playing sound effect:', err));
    }
  }

  // Play Level 10 build-up sound (removed)
  playLevel10BuildUp() {
    // No-op
  }

  // Play Level 10 hit sound
  playLevel10Hit() {
    if (this.enabledStates['10-hit'] && this.soundEffects['10-hit']) {
      const sound = this.soundEffects['10-hit'];
      sound.volume = this.volume * 0.178; // Scaled to -15dB max (0.178 ratio)
      sound.currentTime = 0;
      sound.play().catch(err => console.error('Error playing hit sound:', err));
    }
  }

  // Stop Level 10 build-up sound (removed)
  stopLevel10BuildUp() {
    // No-op
  }

  // Set master volume (0-1)
  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
  }

  // Set background music volume (0-1)
  setMusicVolume(volume) {
    this.musicVolume = Math.max(0, Math.min(1, volume));
    if (this.gainNode && this.audioCtx && !this.isFading) {
      this.gainNode.gain.setValueAtTime(this.musicVolume * 0.1, this.audioCtx.currentTime);
    }
  }

  // Get current volume
  getVolume() {
    return this.volume;
  }

  // Play custom SFX helper
  playPopupOpen() {
    // Overridden by preload.js in popup window to be level-based.
    // Fallback:
    const level = this._currentImportanceLevel || 1;
    this.playSoundEffect(level);
  }
  playDismissSnooze() { this.playCustomSFX('dismiss-snooze'); }
  playMathCorrect() { this.playCustomSFX('math-correct'); }
  playConfetti() { this.playCustomSFX('confetti'); }
  playBtnClick() { this.playCustomSFX('btn-click'); }
  playCheckinSuccess() { this.playCustomSFX('checkin-success'); }
  playChessSelect() { this.playCustomSFX('chess-select'); }
  playChessPlace() { this.playCustomSFX('chess-place'); }
  playChessCheckmate() { this.playCustomSFX('chess-checkmate'); }
  playChessWrong() { this.playCustomSFX('chess-wrong'); }

  playCustomSFX(key) {
    if (this.enabledStates[key] && this.soundEffects[key]) {
      const sound = this.soundEffects[key];
      sound.volume = this.volume * 0.178; // Scaled to -15dB max (0.178 ratio)
      sound.currentTime = 0;
      sound.play().catch(err => console.log(`[audio] Error playing custom SFX (${key}):`, err));
    }
  }

  // Update sound effect file
  updateSoundEffect(level, filePath) {
    let soundKey;
    
    if (level >= 1 && level <= 3) {
      soundKey = '1-3';
    } else if (level >= 4 && level <= 6) {
      soundKey = '4-6';
    } else if (level >= 7 && level <= 9) {
      soundKey = '7-9';
    } else if (level === '10-hit') {
      soundKey = '10-hit';
    } else if (level === 10) {
      soundKey = '10';
    } else {
      soundKey = level; // Support custom keys directly
    }
    
    if (soundKey) {
      const encodedPath = this.encodeFilePath(filePath);
      console.log('[audio] updateSoundEffect key:', soundKey, 'path:', encodedPath);
      this.soundEffects[soundKey] = new Audio(encodedPath);
    }
  }
}

// Create singleton instance
const audioManager = new AudioManager();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = audioManager;
} else {
  window.audioManager = audioManager;
}
