// electron-mock.js - Safe fallback for mobile environments (Capacitor) where electronAPI is undefined
if (typeof window !== 'undefined' && !window.electronAPI) {
  console.log('[Mock] window.electronAPI is undefined. Initializing mock for mobile compatibility.');
  
  window.electronAPI = {
    // Database Operations (Mocked to return empty/success to prevent crashes)
    dbQuery: async (sql, params) => {
      console.log(`[Mock dbQuery] sql: ${sql}, params:`, params);
      return []; // Return empty array for queries to prevent iteration errors
    },
    dbRun: async (sql, params) => {
      console.log(`[Mock dbRun] sql: ${sql}, params:`, params);
      return { lastInsertRowid: 0, changes: 0 };
    },
    
    // Window Operations
    showPopup: async (tipData, options) => console.log('[Mock showPopup]', tipData, options),
    closePopup: async () => console.log('[Mock closePopup]'),
    showSettings: async () => console.log('[Mock showSettings]'),
    getPopupData: async () => null,
    
    // Listeners (Mocked to do nothing or simulate if needed)
    onDataUpdated: (callback) => { console.log('[Mock onDataUpdated] listener registered'); },
    removeDataUpdatedListener: () => {},
    onShowTip: (callback) => { console.log('[Mock onShowTip] listener registered'); },
    removeShowTipListener: () => {},
    
    // Audio Controls
    audioFadeIn: async () => console.log('[Mock audioFadeIn]'),
    audioFadeOut: async () => console.log('[Mock audioFadeOut]'),
    audioStop: async () => console.log('[Mock audioStop]'),
    audioSetVolume: async (vol) => console.log('[Mock audioSetVolume]', vol),
    getAudioSettings: async () => ({}),
    getPopupQueue: async () => [],
    
    onAudioFadeIn: () => {},
    onAudioFadeOut: () => {},
    onAudioStop: () => {},
    onAudioSetVolume: () => {},
    onAudioSettingsReady: () => {},
    removeAudioListeners: () => {},
    
    // Timer Controls
    showTimer: async (tipData) => console.log('[Mock showTimer]', tipData),
    timerEnded: async () => console.log('[Mock timerEnded]'),
    closeTimer: async () => console.log('[Mock closeTimer]'),
    onTimerStart: () => {},
    onTimerStop: () => {},
    onTimerWin: () => {},
    
    // Other specific mocks
    logDismissReason: async (tipId, reason) => console.log('[Mock logDismissReason]', tipId, reason),
    platform: 'mobile'
  };
}
