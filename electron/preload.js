const { contextBridge, ipcRenderer } = require('electron');

// Expose safe APIs to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Database operations
  dbQuery: (sql, params) => ipcRenderer.invoke('db-query', sql, params),
  dbRun: (sql, params) => ipcRenderer.invoke('db-run', sql, params),
  
  // Window operations
  showPopup: () => ipcRenderer.invoke('show-popup'),
  closePopup: () => ipcRenderer.invoke('close-popup'),
  showSettings: () => ipcRenderer.invoke('show-settings'),
  
  // Platform info
  platform: process.platform,
  
  // Listen for tip data from main process (popup window)
  onShowTip: (callback) => ipcRenderer.on('show-tip', (event, data) => callback(data)),
  
  // Remove listener
  removeShowTipListener: () => ipcRenderer.removeAllListeners('show-tip'),
  
  // Log dismiss reason
  logDismissReason: (tipId, reason) => ipcRenderer.invoke('log-dismiss-reason', tipId, reason),
  
  // Audio controls (invoke methods)
  audioFadeIn: () => ipcRenderer.invoke('audio-fade-in'),
  audioFadeOut: () => ipcRenderer.invoke('audio-fade-out'),
  audioStop: () => ipcRenderer.invoke('audio-stop'),
  audioSetVolume: (volume) => ipcRenderer.invoke('audio-set-volume', volume),
  
  // Audio control listeners (for messages from main process)
  onAudioFadeIn: (callback) => ipcRenderer.on('audio-fade-in', (event) => callback()),
  onAudioFadeOut: (callback) => ipcRenderer.on('audio-fade-out', (event) => callback()),
  onAudioStop: (callback) => ipcRenderer.on('audio-stop', (event) => callback()),
  onAudioSetVolume: (callback) => ipcRenderer.on('audio-set-volume', (event, volume) => callback(volume)),
  
  // Remove audio listeners
  removeAudioListeners: () => {
    ipcRenderer.removeAllListeners('audio-fade-in');
    ipcRenderer.removeAllListeners('audio-fade-out');
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
  
  // Follow-up popup listener
  onShowFollowUp: (callback) => ipcRenderer.on('show-follow-up', (event, data) => callback(data)),
  
  // Focus mode controls
  getFocusMode: () => ipcRenderer.invoke('get-focus-mode'),
  activateFocusMode: (categoryId, categoryName, categoryColor) => ipcRenderer.invoke('activate-focus-mode', categoryId, categoryName, categoryColor),
  deactivateFocusMode: () => ipcRenderer.invoke('deactivate-focus-mode')
});
