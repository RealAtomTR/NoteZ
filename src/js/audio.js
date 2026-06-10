// Audio System - HTML5 Audio API with fade in/out

class AudioManager {
  constructor() {
    this.backgroundMusic = null;
    this.soundEffects = {};
    this.volume = 0.5; // Default volume 50%
    this.isFading = false;
  }

  // Initialize audio with settings
  async initialize(settings) {
    this.volume = settings.volume || 0.5;
    
    if (settings.backgroundMusic) {
      this.setBackgroundMusic(settings.backgroundMusic);
    }
    
    // Load sound effects for each level
    if (settings.soundLevel1to3) {
      this.soundEffects['1-3'] = new Audio(settings.soundLevel1to3);
    }
    if (settings.soundLevel4to6) {
      this.soundEffects['4-6'] = new Audio(settings.soundLevel4to6);
    }
    if (settings.soundLevel7to9) {
      this.soundEffects['7-9'] = new Audio(settings.soundLevel7to9);
    }
    if (settings.soundLevel10) {
      this.soundEffects['10'] = new Audio(settings.soundLevel10);
    }
    if (settings.soundLevel10BuildUp) {
      this.soundEffects['10-buildup'] = new Audio(settings.soundLevel10BuildUp);
    }
    if (settings.soundLevel10Hit) {
      this.soundEffects['10-hit'] = new Audio(settings.soundLevel10Hit);
    }
  }

  // Set background music file
  setBackgroundMusic(filePath) {
    if (this.backgroundMusic) {
      this.stopBackgroundMusic();
    }
    
    this.backgroundMusic = new Audio(filePath);
    this.backgroundMusic.loop = true;
    this.backgroundMusic.volume = 0;
  }

  // Fade in background music over duration (ms)
  fadeInBackgroundMusic(duration = 1000) {
    if (!this.backgroundMusic) return;
    
    this.isFading = true;
    this.backgroundMusic.play().catch(err => console.error('Error playing background music:', err));
    
    const steps = 20;
    const stepDuration = duration / steps;
    const volumeIncrement = this.volume / steps;
    
    let currentStep = 0;
    
    const fadeInterval = setInterval(() => {
      currentStep++;
      this.backgroundMusic.volume = Math.min(currentStep * volumeIncrement, this.volume);
      
      if (currentStep >= steps) {
        clearInterval(fadeInterval);
        this.isFading = false;
      }
    }, stepDuration);
  }

  // Fade out background music over duration (ms)
  fadeOutBackgroundMusic(duration = 1000) {
    if (!this.backgroundMusic || this.backgroundMusic.volume === 0) return;
    
    this.isFading = true;
    const startVolume = this.backgroundMusic.volume;
    const steps = 20;
    const stepDuration = duration / steps;
    const volumeDecrement = startVolume / steps;
    
    let currentStep = 0;
    
    const fadeInterval = setInterval(() => {
      currentStep++;
      this.backgroundMusic.volume = Math.max(startVolume - (currentStep * volumeDecrement), 0);
      
      if (currentStep >= steps) {
        clearInterval(fadeInterval);
        this.backgroundMusic.pause();
        this.backgroundMusic.volume = 0;
        this.isFading = false;
      }
    }, stepDuration);
  }

  // Stop background music immediately
  stopBackgroundMusic() {
    if (this.backgroundMusic) {
      this.backgroundMusic.pause();
      this.backgroundMusic.currentTime = 0;
      this.backgroundMusic.volume = 0;
    }
  }

  // Play sound effect for dismiss level
  playSoundEffect(level) {
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
    
    if (soundKey && this.soundEffects[soundKey]) {
      const sound = this.soundEffects[soundKey];
      sound.volume = this.volume;
      sound.currentTime = 0;
      sound.play().catch(err => console.error('Error playing sound effect:', err));
    }
  }

  // Play Level 10 build-up sound
  playLevel10BuildUp() {
    if (this.soundEffects['10-buildup']) {
      const sound = this.soundEffects['10-buildup'];
      sound.volume = this.volume;
      sound.currentTime = 0;
      sound.play().catch(err => console.error('Error playing build-up sound:', err));
    }
  }

  // Play Level 10 hit sound
  playLevel10Hit() {
    if (this.soundEffects['10-hit']) {
      const sound = this.soundEffects['10-hit'];
      sound.volume = this.volume;
      sound.currentTime = 0;
      sound.play().catch(err => console.error('Error playing hit sound:', err));
    }
  }

  // Stop Level 10 build-up sound
  stopLevel10BuildUp() {
    if (this.soundEffects['10-buildup']) {
      this.soundEffects['10-buildup'].pause();
      this.soundEffects['10-buildup'].currentTime = 0;
    }
  }

  // Set master volume (0-1)
  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    
    // Update background music volume if playing
    if (this.backgroundMusic && !this.isFading) {
      this.backgroundMusic.volume = this.volume;
    }
  }

  // Get current volume
  getVolume() {
    return this.volume;
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
    } else if (level === '10-buildup') {
      soundKey = '10-buildup';
    } else if (level === '10-hit') {
      soundKey = '10-hit';
    } else if (level === 10) {
      soundKey = '10';
    }
    
    if (soundKey) {
      this.soundEffects[soundKey] = new Audio(filePath);
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
