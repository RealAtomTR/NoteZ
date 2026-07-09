const { contextBridge, ipcRenderer } = require('electron');

// Expose safe APIs to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Database operations
  dbQuery: (sql, params) => ipcRenderer.invoke('db-query', sql, params),
  dbRun: (sql, params) => {
    return ipcRenderer.invoke('db-run', sql, params);
  },

  // Window operations
  showPopup: (tipData, options) => ipcRenderer.invoke('show-popup', tipData, options),
  closePopup: () => ipcRenderer.invoke('close-popup'),
  showSettings: () => ipcRenderer.invoke('show-settings'),
  getPopupData: () => ipcRenderer.invoke('get-popup-data'),
  quickCaptureSave: (content) => ipcRenderer.invoke('quick-capture-save', content),

  // Data update event listeners
  onDataUpdated: (callback) => ipcRenderer.on('data-updated', (event, data) => callback(data)),
  removeDataUpdatedListener: () => ipcRenderer.removeAllListeners('data-updated'),

  // Platform info
  platform: process.platform,

  // Listen for tip data from main process (popup window)
  onShowTip: (callback) => ipcRenderer.on('show-tip', (event, data) => callback(data)),

  // Remove listener
  removeShowTipListener: () => ipcRenderer.removeAllListeners('show-tip'),

  // Log dismiss reason
  logDismissReason: (tipId, reason) => ipcRenderer.invoke('log-dismiss-reason', tipId, reason),

  // Audio controls (SFX only — background music removed)
  audioStop: () => ipcRenderer.invoke('audio-stop'),
  audioSetVolume: (volume) => ipcRenderer.invoke('audio-set-volume', volume),
  getAudioSettings: () => ipcRenderer.invoke('get-audio-settings'),
  getPopupQueue: () => ipcRenderer.invoke('get-popup-queue'),

  // Audio control listeners (SFX only)
  onAudioFadeIn: (callback) => ipcRenderer.on('audio-fade-in', () => callback()),
  onAudioFadeOut: (callback) => ipcRenderer.on('audio-fade-out', () => callback()),
  onAudioStop: (callback) => ipcRenderer.on('audio-stop', () => callback()),
  onAudioSetVolume: (callback) => ipcRenderer.on('audio-set-volume', (_, vol) => callback(vol)),
  // Fired by main on did-finish-load — contains the raw DB settings map (music keys excluded)
  onAudioSettingsReady: (callback) => ipcRenderer.on('audio-settings-ready', (_event, settings) => callback(settings)),

  // Remove audio listeners
  removeAudioListeners: () => {
    ipcRenderer.removeAllListeners('audio-stop');
    ipcRenderer.removeAllListeners('audio-set-volume');
  },

  // Timer controls (for popup window)
  showTimer: (tipData) => ipcRenderer.invoke('show-timer', tipData),

  // Timer controls (for timer window)
  timerEnded: () => ipcRenderer.invoke('timer-ended'),
  closeTimer: () => ipcRenderer.invoke('close-timer'),
  onTimerStart: (callback) => ipcRenderer.on('timer-start', (event) => callback()),
  onTimerStop: (callback) => ipcRenderer.on('timer-stop', (event) => callback()),
  onTimerWin: (callback) => ipcRenderer.on('timer-win-trigger', () => callback()),

  // Follow-up popup listener
  onShowFollowUp: (callback) => ipcRenderer.on('show-follow-up', (event, data) => callback(data)),

  // Focus mode controls
  getFocusMode: () => ipcRenderer.invoke('get-focus-mode'),
  activateFocusMode: (categoryId, categoryName, categoryColor) => ipcRenderer.invoke('activate-focus-mode', categoryId, categoryName, categoryColor),
  deactivateFocusMode: () => ipcRenderer.invoke('deactivate-focus-mode'),

  // Deadline controls
  deadlineSet: (tipId, deadline) => ipcRenderer.invoke('deadline-set', tipId, deadline),
  deadlineClear: (tipId) => ipcRenderer.invoke('deadline-clear', tipId),
  deadlineGetEffective: (tipId) => ipcRenderer.invoke('deadline-get-effective', tipId),

  // Snooze controls
  snoozeCheck: (tipId) => ipcRenderer.invoke('snooze-check', tipId),
  snoozeApply: (tipId, reason) => ipcRenderer.invoke('snooze-apply', tipId, reason),


  // FIX 2: Popup dynamic resize — called by popup.js after content renders
  popupResize: (height, options = {}) => ipcRenderer.invoke('popup-resize', height, options),

  // Check-in controls
  checkinStatus: () => ipcRenderer.invoke('checkin-status'),
  checkinDo: () => ipcRenderer.invoke('checkin-do'),
  checkinHistory: () => ipcRenderer.invoke('checkin-history'),
  closeCheckin: () => ipcRenderer.invoke('close-checkin'),
  closeQuickCapture: () => window.close(),

  // App Tracking — get open windows list (for category/note modal dropdown)
  getActiveWindows: () => ipcRenderer.invoke('get-active-windows'),

  // Subcategory controls
  subcategoryList: (categoryId) => ipcRenderer.invoke('subcategory-list', categoryId),
  subcategoryCreate: (params) => ipcRenderer.invoke('subcategory-create', params),
  subcategoryUpdate: (params) => ipcRenderer.invoke('subcategory-update', params),
  subcategoryDelete: (id) => ipcRenderer.invoke('subcategory-delete', id),
  tipAssignSubcategory: (params) => ipcRenderer.invoke('tip-assign-subcategory', params),
  subcategoryReorderTips: (params) => ipcRenderer.invoke('subcategory-reorder-tips', params),

  debugSetCheckinMissed: () => ipcRenderer.invoke('debug-set-checkin-missed'),
  debugSimulateDeadline: (type, id, daysFromNow) => ipcRenderer.invoke('debug-simulate-deadline', type, id, daysFromNow),
  debugResetSnoozeLimits: () => ipcRenderer.invoke('debug-reset-snooze-limits'),
  debugGetActiveWindow: () => ipcRenderer.invoke('debug-get-active-window'),
  debugStartPopupInterval: () => ipcRenderer.invoke('debug-start-popup-interval'),
  debugStopPopupInterval: () => ipcRenderer.invoke('debug-stop-popup-interval'),

  // Listen for debug popup count updates from main process
  onDebugPopupCountUpdate: (callback) => ipcRenderer.on('debug-popup-count-update', (_event, data) => callback(data)),

  // SFX trigger events from main process
  onPopupSfxTrigger: (callback) => ipcRenderer.on('popup-sfx-trigger', (_event) => callback()),

  // Markdown import
  importMarkdownFile: () => ipcRenderer.invoke('import-markdown-file'),
  markdownRefresh: () => ipcRenderer.invoke('markdown-refresh'),
  markdownReadBack: () => ipcRenderer.invoke('markdown-read-back'),
});

// Intercept audio settings initialization to fix the volume = 0 fallback to 50 bug
// And auto-save settings when changed
window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('click', (event) => {
    const closeButton = event.target && event.target.closest && event.target.closest('#close-import-success-btn');
    if (!closeButton) return;

    const modal = document.getElementById('import-success-modal');
    if (modal) {
      event.preventDefault();
      modal.classList.remove('active');
    }
  });

  // 1. Monkeypatch window.audioManager.initialize if available
  if (window.audioManager) {
    const originalInitialize = window.audioManager.initialize;

    // ── FIX #FixThis 15 Madde 1 & 2: Race condition ──────────────────────────
    // audioManager.initialize() is async. popup.js registers onShowTip at the
    // same DOMContentLoaded, but the IPC show-tip event can arrive before
    // initialize() resolves, leaving soundEffects['10-buildup'] / ['popup-open']
    // still null when initializePopup() first runs. We create a Promise that
    // resolves only after initialize() completes, then wrap onShowTip to await
    // it before delivering the tip data to initializePopup().
    let _audioInitResolve;
    window._audioInitPromise = new Promise((resolve) => { _audioInitResolve = resolve; });

    window.audioManager.initialize = async function(settings) {
      try {
        // Query the database directly for original settings values to override any || 50 fallbacks
        const settingsList = await ipcRenderer.invoke('db-query', 'SELECT key, value FROM settings');
        const settingsMap = {};
        if (Array.isArray(settingsList)) {
          settingsList.forEach(s => {
            settingsMap[s.key] = s.value;
          });
        }

        // Override volumes if they exist in the settings table
        if (settingsMap['audio_volume'] !== undefined && settingsMap['audio_volume'] !== '') {
          const volVal = parseInt(settingsMap['audio_volume']);
          if (!isNaN(volVal)) {
            settings.volume = volVal / 100;
          }
        }
        if (settingsMap['music_volume'] !== undefined && settingsMap['music_volume'] !== '') {
          const musVal = parseInt(settingsMap['music_volume']);
          if (!isNaN(musVal)) {
            settings.musicVolume = musVal / 100;
          }
        }
      } catch (err) {
        console.error('[preload] Error fetching settings for audioManager override:', err);
      }
      const result = await originalInitialize.call(this, settings);
      // Signal: audio is fully initialized, soundEffects map is populated
      if (_audioInitResolve) { _audioInitResolve(); _audioInitResolve = null; }
      console.log('[preload] audioManager.initialize complete — _audioInitPromise resolved');
      return result;
    };

    // Wrap onShowTip so tip delivery is deferred until audio init is done.
    // This prevents playPopupOpen() / playLevel10BuildUp() from firing while
    // soundEffects are still null.
    // Note: contextBridge freezes the electronAPI object, but we can wrap the
    // IPC listener registration itself. We override onShowTip on electronAPI
    // via Object.defineProperty to bypass the freeze.
    try {
      const origOnShowTip = window.electronAPI.onShowTip.bind(window.electronAPI);
      Object.defineProperty(window.electronAPI, 'onShowTip', {
        configurable: true,
        writable: true,
        value: function(callback) {
          origOnShowTip(async (data) => {
            if (window._audioInitPromise) {
              await window._audioInitPromise;
            }

            // ── FIX #FixThis 16 Madde 2 & 3: SFX rewiring + 50/50 dismiss ──────
            // Apply popup.js global patches once (after audio is ready, globals exist).
            // Guard with _preloadPopupPatchesApplied so we only wire up once.
            if (!window._preloadPopupPatchesApplied) {
              window._preloadPopupPatchesApplied = true;

              // ── Madde 2a: playPopupOpen → level-based SFX slot ───────────────
              // popup.js calls audioManager.playPopupOpen() unconditionally inside
              // initializePopup(). We override it to play the slot matching the
              // tip's importance level instead of the generic 'popup-open' slot.
              if (window.audioManager) {
                window.audioManager.playPopupOpen = function() {
                  const level = window.audioManager._currentImportanceLevel || 1;
                  let sfxKey;
                  if      (level >= 1 && level <= 3) sfxKey = '1-3';
                  else if (level >= 4 && level <= 6) sfxKey = '4-6';
                  else if (level >= 7 && level <= 9) sfxKey = '7-9';
                  else if (level === 10)             sfxKey = '10';
                  else                               sfxKey = '1-3';
                  console.log(`[preload] playPopupOpen → level ${level} → sfxKey '${sfxKey}'`);
                  this.playCustomSFX(sfxKey);
                };
                console.log('[preload] audioManager.playPopupOpen overridden (level-based)');
              }

              // ── Madde 2b: startHold override (Removed) ──────
              // Previously swapped hold sound to 10-buildup. 10-buildup is now removed.

              // ── Madde 3: setupDismissMechanism → random hold/math/chess for 4-6 ─────
              if (typeof window.setupDismissMechanism === 'function') {
                const origSetupDismiss = window.setupDismissMechanism;
                window.setupDismissMechanism = function() {
                  const level = window.audioManager._currentImportanceLevel || 1;
                  if (level >= 4 && level <= 6) {
                    // Pick mode once per popup (undefined = not yet picked)
                    if (window._popup46mode === undefined) {
                      const rand = Math.random();
                      if (rand < 0.33) window._popup46mode = 'hold';
                      else if (rand < 0.66) window._popup46mode = 'math';
                      else window._popup46mode = 'chess';
                      console.log(`[preload] Level ${level} dismiss mode chosen: ${window._popup46mode}`);
                    }
                    // Reset all UI sections first (replicates popup.js hide-all logic)
                    if (window.progressContainer) window.progressContainer.style.display = 'none';
                    if (window.mathQuestion)      window.mathQuestion.style.display = 'none';
                    if (window.confettiCanvas)    window.confettiCanvas.style.display = 'none';
                    const wc = document.getElementById('wordle-container');
                    if (wc) wc.style.display = 'none';
                    const cc = document.getElementById('chess-container');
                    if (cc) cc.style.display = 'none';

                    if (window._popup46mode === 'hold') {
                      if (typeof window.setupHoldToDismiss === 'function') {
                        window.setupHoldToDismiss();
                      }
                    } else if (window._popup46mode === 'math') {
                      if (typeof window.setupMathQuestion === 'function') {
                        window.setupMathQuestion();
                      }
                    } else if (window._popup46mode === 'chess') {
                      // Chess is setupLevelTen in popup.js for levels 4-9
                      if (typeof window.setupLevelTen === 'function') {
                        window.setupLevelTen();
                      }
                    }
                    return;
                  }
                  // Levels 1-3, 7-9, 10 → use original unchanged logic
                  return origSetupDismiss.call(this);
                };
                console.log('[preload] setupDismissMechanism overridden → hold/math/chess for levels 4-6');
              }

              // ── FIX #FixThis 17 Madde 1 & 2: Suppress riser at popup open ────
              // popup.js initializePopup() calls playLevel10BuildUp() unconditionally
              // when dismissLevel === 10 (line ~191). This fires the riser immediately
              // on every chess popup — wrong. The riser must ONLY play via
              // holdSfxManager.start() (called in startLevelTenHold for level-10 hold,
              // and in our startHold patch above for levels 4-6 hold).
              // Chess game SFX (select/place/checkmate/wrong) are wired directly in
              // popup.js via playChessSelect/Place/Checkmate/Wrong → playCustomSFX().
              // No other changes needed for chess SFX — the UI agent's wiring is correct.
              if (window.audioManager && typeof window.audioManager.playLevel10BuildUp === 'function') {
                window.audioManager.playLevel10BuildUp = function() {
                  // Intentional no-op: riser plays via holdSfxManager.start() inside
                  // startLevelTenHold() and startHold() only — not at popup open.
                  console.log('[preload] playLevel10BuildUp suppressed (riser plays via holdSfxManager only)');
                };
                console.log('[preload] audioManager.playLevel10BuildUp overridden → no-op (riser via holdSfxManager)');
              }

              // ── FIX #FixThis 18 Madde 1: Audio Fade In Burst ─────────────────
              // audio.js fadeInBackgroundMusic creates a GainNode with default value 1.0,
              // then ramps down to target volume. This causes a loud burst for a split second.
              if (window.audioManager && typeof window.audioManager.fadeInBackgroundMusic === 'function') {
                const origFadeIn = window.audioManager.fadeInBackgroundMusic;
                window.audioManager.fadeInBackgroundMusic = function(duration = 500) {
                  if (this.gainNode) {
                    // Force starting gain to 0 before ramping
                    this.gainNode.gain.setValueAtTime(0, this.audioCtx.currentTime);
                  }
                  return origFadeIn.call(this, duration);
                };
                console.log('[preload] audioManager.fadeInBackgroundMusic overridden → fixes loud burst');
              }
              // ─────────────────────────────────────────────────────────────────

            }

            // Store current importance level for playPopupOpen to use
            if (window.audioManager) {
              window.audioManager._currentImportanceLevel =
                (data && (data.effectiveImportance || data.importance)) || 1;
            }
            // Reset per-popup 50/50 mode so each new popup gets a fresh roll
            window._popup46mode = undefined;

            callback(data);
          });
        }
      });
      console.log('[preload] onShowTip wrapped — will await _audioInitPromise before delivery');
    } catch (wrapErr) {
      console.warn('[preload] Could not wrap onShowTip:', wrapErr.message);
    }
    // ─────────────────────────────────────────────────────────────────────────

  }

  // 2. Add change event listener for audio settings UI elements to auto-save them
  document.addEventListener('change', (e) => {
    const target = e.target;
    if (target && target.closest('.audio-settings-card') && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) {
      const saveBtn = document.getElementById('save-audio-settings');
      if (saveBtn) {
        console.log('[preload] Auto-saving audio settings due to change in:', target.id);
        saveBtn.click();
      }
    }
  });
});
