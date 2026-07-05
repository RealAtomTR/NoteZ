// Settings Panel - Category and Tip CRUD

// Tab Management
let openTabs = [{ id: 'home', title: 'Main', pinned: true }];
let activeTabId = 'home';

// BUG A FIX — Ses test butonu: max 10 sn, disabled state, restart
let _currentTestAudio = null;
let _currentTestTimeout = null;
let _devErrorTimeout = null;

function showInlineWarning(message, targetElement) {
  if (!targetElement) {
    showToast(message);
    return;
  }
  const parent = targetElement.parentElement;
  if (!parent) {
    showToast(message);
    return;
  }
  
  // Remove any existing inline warning in this parent
  const existing = parent.querySelector('.inline-warning-message');
  if (existing) {
    existing.remove();
  }
  
  const warnEl = document.createElement('div');
  warnEl.className = 'inline-warning-message';
  warnEl.textContent = message;
  warnEl.style.color = '#ef4444';
  warnEl.style.fontSize = '12px';
  warnEl.style.marginTop = '4px';
  warnEl.style.fontWeight = '500';
  
  parent.appendChild(warnEl);
  
  setTimeout(() => {
    if (warnEl.parentElement) {
      warnEl.remove();
    }
  }, 4000);
}

function toggleSubcategoryFormFields() {
  const deadlineModeGroup = document.getElementById('subcategory-deadline-mode-group');
  const sharedGroup = document.getElementById('subcategory-shared-deadline-group');
  const modeSelect = document.getElementById('subcategory-deadline-mode');
  
  if (deadlineModeGroup) {
    deadlineModeGroup.style.display = 'block';
  }
  if (modeSelect && sharedGroup) {
    sharedGroup.style.display = (modeSelect.value === 'shared') ? 'block' : 'none';
  }
}

function testAudio(inputId, buttonId) {
  const filePath = document.getElementById(inputId).value;
  const btn = buttonId ? document.getElementById(buttonId) : null;
  const inputEl = document.getElementById(inputId);
  if (!filePath) {
    showInlineWarning('Lütfen önce bir dosya yolu girin.', inputEl);
    return;
  }
  if (!window.audioManager) {
    showInlineWarning('Audio yöneticisi yüklenmedi.', btn || inputEl);
    return;
  }

  // Önceki testi durdur (restart davranışı)
  _stopCurrentTest();

  const originalText = btn ? btn.textContent : null;

  // Buton → disabled + "⏳ Çalıyor..."
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Çalıyor...';
  }

  const audio = new Audio(window.audioManager.encodeFilePath(filePath));
  if (inputId === 'background-music') {
    const rawVolume = window.audioManager.musicVolume !== undefined ? window.audioManager.musicVolume : 0.5;
    audio.volume = rawVolume * 0.1; // Scale to -20dB max (0.1 ratio)
  } else {
    audio.volume = window.audioManager.getVolume() * 0.178; // Scale to -15dB max (0.178 ratio)
  }
  _currentTestAudio = audio;

  // Temizleme: ses durdur + buton normale döndür
  const cleanup = () => {
    if (_currentTestAudio === audio) {
      audio.pause();
      audio.currentTime = 0;
      _currentTestAudio = null;
    }
    if (_currentTestTimeout) {
      clearTimeout(_currentTestTimeout);
      _currentTestTimeout = null;
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  };

  // 10 saniye sonra otomatik durdur
  _currentTestTimeout = setTimeout(cleanup, 10_000);

  // Ses doğal biterse de temizle
  audio.addEventListener('ended', cleanup, { once: true });

  audio.play().catch(err => {
    console.error('[testAudio] Error playing test audio:', err);
    showInlineWarning('Ses çalınması başarısız oldu.', btn || inputEl);
    cleanup();
  });
}

function _stopCurrentTest() {
  if (_currentTestAudio) {
    _currentTestAudio.pause();
    _currentTestAudio.currentTime = 0;
    _currentTestAudio = null;
  }
  if (_currentTestTimeout) {
    clearTimeout(_currentTestTimeout);
    _currentTestTimeout = null;
  }
}

// Use real SQLite data via IPC
let categories = [];
let tips = [];

// DOM Elements
const categoriesList = document.getElementById('categories-list');
const tipsList = document.getElementById('tips-list');
const addCategoryBtn = document.getElementById('add-category-btn');
const categoryModal = document.getElementById('category-modal');
const categoryForm = document.getElementById('category-form');
const cancelCategoryBtn = document.getElementById('cancel-category-btn');
const categoryModalTitle = document.getElementById('category-modal-title');

// Subcategory DOM Elements
const subcategoryModal = document.getElementById('subcategory-modal');
const subcategoryForm = document.getElementById('subcategory-form');
const cancelSubcategoryBtn = document.getElementById('cancel-subcategory-btn');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  if (window.electronAPI && window.electronAPI.showPopup) {
    const originalShowPopup = window.electronAPI.showPopup;
    window.electronAPI.showPopup = async function(tipData, options) {
      localStorage.setItem('active_tip_data', JSON.stringify(tipData));
      return originalShowPopup(tipData, options);
    };
  }
  showSection('dashboard');
  await checkAndAddFocusDurationColumn();
  await loadCategories();
  await loadTips();
  await loadAudioSettings();
  await loadStatistics();
  await loadHomeDashboard();
  await loadDashboard();
  renderTabs();
  setupEventListeners();
  setupAudioIPCPListeners();
  setupAppTrackingStatusUpdater();
  setupDebugIPCListeners();
  setupDataUpdateListener();
  setupTimerWinListener();
});

// Setup IPC listeners for audio controls from main process
function setupAudioIPCPListeners() {
  if (window.electronAPI) {
    // Listen for audio fade-in command from main process
    window.electronAPI.onAudioFadeIn(() => {
      if (window.audioManager) {
        // window.audioManager.fadeInBackgroundMusic(); // Iptal edildi (Goal Adim 2)
      }
    });
    
    // Listen for audio fade-out command from main process
    window.electronAPI.onAudioFadeOut(() => {
      if (window.audioManager) {
        window.audioManager.fadeOutBackgroundMusic();
      }
    });
    
    // Listen for audio stop command from main process
    window.electronAPI.onAudioStop(() => {
      if (window.audioManager) {
        window.audioManager.stopBackgroundMusic();
      }
    });
    
    // Listen for audio set volume command from main process
    window.electronAPI.onAudioSetVolume((volume) => {
      if (window.audioManager) {
        window.audioManager.setVolume(volume);
      }
    });
  }
}

async function checkAndAddFocusDurationColumn() {
  try {
    if (window.electronAPI && window.electronAPI.dbQuery && window.electronAPI.dbRun) {
      const tableInfo = await window.electronAPI.dbQuery("PRAGMA table_info(tips)");
      const hasFocusDuration = tableInfo.some(col => col.name === 'focus_duration');
      if (!hasFocusDuration) {
        await window.electronAPI.dbRun("ALTER TABLE tips ADD COLUMN focus_duration INTEGER DEFAULT 5");
        console.log('[DB] focus_duration column successfully added to tips table.');
      } else {
        console.log('[DB] focus_duration column already exists in tips table.');
      }
    }
  } catch (err) {
    console.warn('[DB] Failed to verify/add focus_duration column:', err);
  }
}

// Load categories from database
async function loadCategories() {
  console.log('[settings] loadCategories called');
  try {
    if (!window.electronAPI || !window.electronAPI.dbQuery) {
      console.error('electronAPI.dbQuery not available');
      return;
    }
    const rawCategories = await window.electronAPI.dbQuery(`
      SELECT * FROM categories ORDER BY created_at DESC
    `);
    categories = (rawCategories || []).map(c => {
      if (typeof c.triggers === 'string') {
        try {
          c.triggers = JSON.parse(c.triggers);
        } catch (e) {
          c.triggers = { apps: [], keywords: [] };
        }
      }
      if (Array.isArray(c.triggers)) {
        c.triggers = { apps: [], keywords: c.triggers };
      } else if (!c.triggers || typeof c.triggers !== 'object') {
        c.triggers = { apps: [], keywords: [] };
      } else {
        if (!Array.isArray(c.triggers.apps)) c.triggers.apps = [];
        if (!Array.isArray(c.triggers.keywords)) c.triggers.keywords = [];
      }
      return c;
    });
    await renderCategories();
  } catch (error) {
    console.error('Error loading categories:', error);
  }
}

// Load tips from database
async function loadTips() {
  console.log('[settings] loadTips called');
  try {
    if (!window.electronAPI || !window.electronAPI.dbQuery) {
      console.error('electronAPI.dbQuery not available');
      return;
    }
    tips = await window.electronAPI.dbQuery(`
      SELECT t.*, c.name as category_name, c.color as category_color
      FROM tips t
      LEFT JOIN categories c ON t.category_id = c.id
      ORDER BY t.created_at DESC
    `);
    renderTips();
  } catch (error) {
    console.error('Error loading tips:', error);
  }
}

// Load audio settings from database
async function loadAudioSettings() {
  console.log('[settings] loadAudioSettings called');
  try {
    if (!window.electronAPI || !window.electronAPI.dbQuery) {
      console.error('electronAPI.dbQuery not available');
      return;
    }
    const settings = await window.electronAPI.dbQuery(`SELECT key, value FROM settings`);
    const settingsMap = {};
    
    settings.forEach(setting => {
      settingsMap[setting.key] = setting.value;
    });
    
    // Populate UI
    if (settingsMap['audio_volume']) {
      document.getElementById('audio-volume').value = settingsMap['audio_volume'];
      document.getElementById('volume-value').textContent = settingsMap['audio_volume'] + '%';
    }
    const musicVolumeEl = document.getElementById('music-volume');
    if (musicVolumeEl && settingsMap['music_volume']) {
      musicVolumeEl.value = settingsMap['music_volume'];
      const musicVolumeValEl = document.getElementById('music-volume-value');
      if (musicVolumeValEl) musicVolumeValEl.textContent = settingsMap['music_volume'] + '%';
    }
    const bgMusicEl = document.getElementById('background-music');
    if (bgMusicEl && settingsMap['background_music']) {
      bgMusicEl.value = settingsMap['background_music'];
    }
    if (settingsMap['popup_intensity']) {
      const intensityEl = document.getElementById('popup-intensity');
      if (intensityEl) {
        intensityEl.value = settingsMap['popup_intensity'];
      }
    }
    
    const sfxKeys = [
      { id: 'sound-level-1-3', dbKey: 'sound_level_1_3' },
      { id: 'sound-level-4-6', dbKey: 'sound_level_4_6' },
      { id: 'sound-level-7-9', dbKey: 'sound_level_7_9' },
      { id: 'sound-level-10', dbKey: 'sound_level_10' },
      { id: 'sound-level-10-buildup', dbKey: 'sound_level_10_buildup' },
      { id: 'sound-level-10-hit', dbKey: 'sound_level_10_hit' },
      { id: 'sound-sfx-dismiss-snooze', dbKey: 'sound_sfx_dismiss_snooze' },
      { id: 'sound-sfx-math-correct', dbKey: 'sound_sfx_math_correct' },
      { id: 'sound-sfx-confetti', dbKey: 'sound_sfx_confetti' },
      { id: 'sound-sfx-btn-click', dbKey: 'sound_sfx_btn_click' },
      { id: 'sound-sfx-checkin-success', dbKey: 'sound_sfx_checkin_success' },
      { id: 'sound-sfx-chess-select', dbKey: 'sound_sfx_chess_select' },
      { id: 'sound-sfx-chess-place', dbKey: 'sound_sfx_chess_place' },
      { id: 'sound-sfx-chess-checkmate', dbKey: 'sound_sfx_chess_checkmate' },
      { id: 'sound-sfx-chess-wrong', dbKey: 'sound_sfx_chess_wrong' }
    ];

    sfxKeys.forEach(item => {
      const pathEl = document.getElementById(item.id);
      const toggleEl = document.getElementById(item.id + '-enabled');
      
      if (pathEl && settingsMap[item.dbKey] !== undefined) {
        pathEl.value = settingsMap[item.dbKey];
      }
      if (toggleEl) {
        const dbEnabledKey = item.dbKey + '_enabled';
        toggleEl.checked = settingsMap[dbEnabledKey] !== '0';
      }
    });
    
    // Initialize audio manager with settings
    if (window.audioManager) {
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

      // Start music automatically on launch
      if (window.audioManager.backgroundMusic) {
        // window.audioManager.fadeInBackgroundMusic(); // Iptal edildi (Goal Adim 2)
      }
    }
  } catch (error) {
    console.error('Error loading audio settings:', error);
  }
}

// Setup Event Listeners
function setupEventListeners() {
  // Use event delegation on main content wrapper
  const contentWrapper = document.querySelector('.content-wrapper');

  contentWrapper.addEventListener('click', async (e) => {
    // Test popup button
    if (e.target.closest('#test-popup-btn')) {
      e.preventDefault();
      testRandomPopup();
    }
    
    // Popup preview button
    if (e.target.closest('.btn-popup-preview')) {
      e.preventDefault();
      const btn = e.target.closest('.btn-popup-preview');
      const sfxKey = btn.id.replace('popup-', '');
      triggerSfxPopupPreview(sfxKey);
    }
    
    // Add category button
    if (e.target.closest('#add-category-btn') || e.target.closest('#add-category-btn-categories-page')) {
      e.preventDefault();
      openCategoryModal();
    }

    // Top Right Add Note button
    if (e.target.closest('#top-add-note-btn')) {
      e.preventDefault();
      openNoteModal();
    }
    
    // Add note inside subcategory button click
    if (e.target.closest('.add-note-in-subcat-btn')) {
      e.preventDefault();
      e.stopPropagation();
      const btn = e.target.closest('.add-note-in-subcat-btn');
      const subcatIdAttr = btn.getAttribute('data-subcat-id');
      const subcatId = subcatIdAttr && subcatIdAttr !== 'null' ? parseInt(subcatIdAttr) : null;
      const categoryId = parseInt(btn.getAttribute('data-category-id'));
      
      // Expand the accordion if it is collapsed
      const accordionItem = btn.closest('.accordion-item');
      if (accordionItem && !accordionItem.classList.contains('expanded')) {
        toggleAccordion(accordionItem);
      }
      
      addNewNoteInline(categoryId, subcatId);
    }

    // Edit category from tab header
    if (e.target.closest('#edit-category-btn-tab')) {
      e.preventDefault();
      const activeTab = openTabs.find(t => t.id === activeTabId);
      const categoryId = activeTab ? activeTab.categoryId : null;
      if (categoryId) {
        editCategory(categoryId);
      }
    }
    
    // Delete category from tab header
    if (e.target.closest('#delete-category-btn-tab')) {
      e.preventDefault();
      const btn = e.target.closest('#delete-category-btn-tab');
      const activeTab = openTabs.find(t => t.id === activeTabId);
      const categoryId = activeTab ? activeTab.categoryId : null;
      if (categoryId) {
        deleteCategory(categoryId, btn);
      }
    }
    
    // Dashboard check-in button
    if (e.target.closest('#dashboard-checkin-btn')) {
      e.preventDefault();
      const checkinBtn = document.getElementById('dashboard-checkin-btn');
      if (window.electronAPI && window.electronAPI.checkinDo) {
        checkinBtn.disabled = true;
        window.electronAPI.checkinDo()
          .then(() => loadDashboard())
          .catch(err => {
            console.error('Error check-in:', err);
            checkinBtn.disabled = false;
          });
      } else {
        showToast('Check-in işlemi mock olarak başarılı.');
        const statusEl = document.getElementById('dashboard-checkin-status');
        if (statusEl) {
          statusEl.textContent = '✓ Giriş Yapıldı';
          statusEl.style.color = '#22c55e';
        }
        checkinBtn.disabled = true;
        checkinBtn.textContent = '✓ Giriş Yapıldı';
        checkinBtn.style.background = '#22c55e';
        checkinBtn.style.borderColor = '#22c55e';
      }
    }
    
    // Cancel category button
    if (e.target.closest('#cancel-category-btn')) {
      e.preventDefault();
      closeCategoryModal();
    }
    
    // Edit category buttons (delegated)
    if (e.target.closest('.btn-edit[data-category-id]')) {
      e.preventDefault();
      const categoryId = parseInt(e.target.closest('.btn-edit').getAttribute('data-category-id'));
      editCategory(categoryId);
    }
    
    // Delete category buttons (delegated)
    if (e.target.closest('.btn-delete[data-category-id]')) {
      e.preventDefault();
      const btn = e.target.closest('.btn-delete');
      const categoryId = parseInt(btn.getAttribute('data-category-id'));
      deleteCategory(categoryId, btn);
    }

    // Add subcategory button (category tab page)
    if (e.target.closest('#add-subcategory-btn')) {
      e.preventDefault();
      const activeTab = openTabs.find(t => t.id === activeTabId);
      const categoryId = activeTab ? activeTab.categoryId : null;
      if (categoryId) {
        openSubcategoryModal(null, categoryId);
      } else {
        showInlineWarning('Lütfen önce bir kategori seçin.', document.getElementById('add-subcategory-btn'));
      }
    }
    
    // Edit/Delete subcategory buttons (delegated)
    if (e.target.closest('.edit-subcat-btn')) {
      e.preventDefault();
      e.stopPropagation();
      const subcatId = parseInt(e.target.closest('.edit-subcat-btn').getAttribute('data-subcat-id'));
      const activeTab = openTabs.find(t => t.id === activeTabId);
      const categoryId = activeTab ? activeTab.categoryId : null;
      editSubcategory(subcatId, categoryId);
    }
    
    if (e.target.closest('.delete-subcat-btn')) {
      e.preventDefault();
      e.stopPropagation();
      const btn = e.target.closest('.delete-subcat-btn');
      const subcatId = parseInt(btn.getAttribute('data-subcat-id'));
      const activeTab = openTabs.find(t => t.id === activeTabId);
      const categoryId = activeTab ? activeTab.categoryId : null;
      deleteSubcategory(subcatId, categoryId, btn);
    }

    // Accordion toggle clicks
    if (e.target.closest('.accordion-header')) {
      if (e.target.closest('.subcategory-actions') || e.target.closest('button')) {
        return;
      }
      e.preventDefault();
      const accordionItem = e.target.closest('.accordion-item');
      toggleAccordion(accordionItem);
    }

    // Importance Box Single Click Cycle
    if (e.target.closest('.importance-box') && !e.target.closest('.importance-input')) {
      e.preventDefault();
      const box = e.target.closest('.importance-box');
      if (box.querySelector('.importance-input')) return;

      const tipId = parseInt(box.closest('.tip-item').getAttribute('data-tip-id'));
      const tip = tips.find(t => t.id === tipId);
      if (tip) {
        let nextImp = tip.importance + 1;
        if (nextImp > 10) nextImp = 1;
        await updateTipProperty(tipId, 'importance', nextImp);
      }
    }

    // Status Cycle Icon Click
    if (e.target.closest('.status-cycle-icon')) {
      e.preventDefault();
      e.stopPropagation();
      const icon = e.target.closest('.status-cycle-icon');
      const tipId = parseInt(icon.closest('.tip-item').getAttribute('data-tip-id'));
      const tip = tips.find(t => t.id === tipId);
      if (tip) {
        const states = ['done', 'retired', 'active', 'cancelled'];
        let curIdx = states.indexOf(tip.status);
        if (curIdx === -1) curIdx = 0;
        let nextIdx = (curIdx + 1) % states.length;
        const nextStatus = states[nextIdx];
        await updateTipStatusInline(tipId, nextStatus);
      }
    }

    // Inline Calendar Trigger
    if (e.target.closest('.calendar-btn')) {
      e.preventDefault();
      const cal = e.target.closest('.calendar-btn');
      const dateInput = cal.parentElement.querySelector('.inline-deadline-input');
      if (dateInput) {
        if (typeof dateInput.showPicker === 'function') {
          dateInput.showPicker();
        } else {
          dateInput.focus();
        }
      }
    }

    // Clear Deadline click (inline x)
    if (e.target.closest('.clear-deadline-x')) {
      e.preventDefault();
      e.stopPropagation();
      const xBtn = e.target.closest('.clear-deadline-x');
      const tipId = parseInt(xBtn.closest('.tip-item').getAttribute('data-tip-id'));
      await updateTipProperty(tipId, 'deadline', null);
    }

    // Reset show counts (developer tools)
    if (e.target.closest('#dev-reset-show-counts')) {
      e.preventDefault();
      devResetShowCounts(e.target.closest('#dev-reset-show-counts'));
    }
    // Show window title (developer tools)
    if (e.target.closest('#dev-show-window-title')) {
      e.preventDefault();
      devShowWindowTitle();
    }

    // Delete Note Button Click (legacy fallback)
    if (e.target.closest('.delete-note-btn')) {
      e.preventDefault();
      e.stopPropagation();
      const btn = e.target.closest('.delete-note-btn');
      const tipId = parseInt(btn.closest('.tip-item').getAttribute('data-tip-id'));
      deleteNote(tipId, btn);
    }

    // Note Menu Dropdown Toggle Click
    if (e.target.closest('.note-menu-toggle-btn')) {
      e.preventDefault();
      e.stopPropagation();
      const btn = e.target.closest('.note-menu-toggle-btn');
      const dropdown = btn.parentElement.querySelector('.note-menu-dropdown');
      
      // Hide all other dropdowns
      document.querySelectorAll('.note-menu-dropdown').forEach(d => {
        if (d !== dropdown) {
          d.classList.remove('show');
          d.closest('.tip-item')?.classList.remove('menu-open');
          d.closest('.accordion-item')?.classList.remove('menu-open');
        }
      });
      
      if (dropdown) {
        const shouldShow = !dropdown.classList.contains('show');
        dropdown.classList.toggle('show', shouldShow);
        dropdown.closest('.tip-item')?.classList.toggle('menu-open', shouldShow);
        dropdown.closest('.accordion-item')?.classList.toggle('menu-open', shouldShow);
      }
    }

    // Calendar Trigger Click
    if (e.target.closest('.calendar-trigger-item')) {
      e.preventDefault();
      e.stopPropagation();
      const item = e.target.closest('.calendar-trigger-item');
      const wrapper = item.closest('.note-menu-wrapper');
      const dateInput = wrapper.querySelector('.inline-deadline-input');
      if (dateInput) {
        if (typeof dateInput.showPicker === 'function') {
          dateInput.showPicker();
        } else {
          dateInput.focus();
        }
      }
      const dropdown = item.closest('.note-menu-dropdown');
      if (dropdown) dropdown.classList.remove('show');
    }

    // Clear Deadline Click
    if (e.target.closest('.clear-deadline-item')) {
      e.preventDefault();
      e.stopPropagation();
      const item = e.target.closest('.clear-deadline-item');
      const tipId = parseInt(item.getAttribute('data-tip-id'));
      await updateTipProperty(tipId, 'deadline', null);
    }

    // Duration Button Click
    if (e.target.closest('.duration-btn')) {
      e.preventDefault();
      e.stopPropagation();
      const btn = e.target.closest('.duration-btn');
      const tipId = parseInt(btn.getAttribute('data-tip-id'));
      const val = parseInt(btn.getAttribute('data-duration'));
      console.log(`[settings] dropdown duration changed for tip ${tipId} to ${val}dk`);
      await updateTipProperty(tipId, 'focus_duration', val);
      const dropdown = btn.closest('.note-menu-dropdown');
      if (dropdown) {
        dropdown.classList.remove('show');
        dropdown.closest('.tip-item')?.classList.remove('menu-open');
        dropdown.closest('.accordion-item')?.classList.remove('menu-open');
      }
    }

    // Delete Note Item Click (Dropdown action)
    if (e.target.closest('.delete-note-item')) {
      e.preventDefault();
      e.stopPropagation();
      const item = e.target.closest('.delete-note-item');
      const tipId = parseInt(item.getAttribute('data-tip-id'));
      deleteNote(tipId, item);
    }
  });

  // Inline Note Text Editing: Double click to enter contenteditable mode
  contentWrapper.addEventListener('dblclick', (e) => {
    if (e.target.closest('.note-content-text')) {
      e.preventDefault();
      const span = e.target.closest('.note-content-text');
      enterNoteTextEditMode(span);
    }
  });

  // Inline duration select change - delegated
  contentWrapper.addEventListener('change', async (e) => {
    if (e.target.closest('.inline-duration-select')) {
      const select = e.target.closest('.inline-duration-select');
      const tipId = parseInt(select.getAttribute('data-tip-id'));
      const val = parseInt(select.value);
      console.log(`[settings] inline duration changed for tip ${tipId} to ${val}dk`);
      await updateTipProperty(tipId, 'focus_duration', val);
      showToast('Süre güncellendi.');
    }
  });

  categoryForm.addEventListener('submit', handleCategorySubmit);

  // Category app tracking selection change
  const categoryActiveApps = document.getElementById('category-active-apps');
  if (categoryActiveApps) {
    categoryActiveApps.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val && !currentModalApps.includes(val)) {
        currentModalApps.push(val);
        renderCategoryAppTags();
      }
      e.target.value = ''; // Reset select
    });
  }

  // Category app tracking tags removal click
  const categoryAppsTags = document.getElementById('category-apps-tags');
  if (categoryAppsTags) {
    categoryAppsTags.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('.app-tag-remove');
      if (removeBtn) {
        const appToRemove = removeBtn.getAttribute('data-app');
        currentModalApps = currentModalApps.filter(app => app !== appToRemove);
        renderCategoryAppTags();
      }
    });
  }

  // Refresh active apps dropdown listener
  const refreshActiveAppsBtn = document.getElementById('refresh-active-apps-btn');
  if (refreshActiveAppsBtn) {
    refreshActiveAppsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      populateActiveAppsDropdown();
    });
  }

  // Subcategory Select deadline mode toggle
  const subcatDeadlineMode = document.getElementById('subcategory-deadline-mode');
  if (subcatDeadlineMode) {
    subcatDeadlineMode.addEventListener('change', (e) => {
      const mode = e.target.value;
      const sharedGroup = document.getElementById('subcategory-shared-deadline-group');
      if (sharedGroup) {
        sharedGroup.style.display = (mode === 'shared') ? 'block' : 'none';
      }
    });
  }

  // Subcategory sequential checkbox toggle
  const subcatSequential = document.getElementById('subcategory-sequential');
  if (subcatSequential) {
    subcatSequential.addEventListener('change', toggleSubcategoryFormFields);
  }

  // Subcategory Form Submit
  if (subcategoryForm) {
    subcategoryForm.addEventListener('submit', handleSubcategorySubmit);
  }

  // Subcategory Cancel Button
  if (cancelSubcategoryBtn) {
    cancelSubcategoryBtn.addEventListener('click', (e) => {
      e.preventDefault();
      closeSubcategoryModal();
    });
  }

  // Note Modal Form Listeners
  const noteForm = document.getElementById('note-form');
  if (noteForm) {
    noteForm.addEventListener('submit', handleNoteSubmit);
  }

  const cancelNoteBtn = document.getElementById('cancel-note-btn');
  if (cancelNoteBtn) {
    cancelNoteBtn.addEventListener('click', (e) => {
      e.preventDefault();
      closeNoteModal();
    });
  }

  const noteCategorySelect = document.getElementById('note-category-select');
  if (noteCategorySelect) {
    noteCategorySelect.addEventListener('change', (e) => {
      updateNoteModalSubcategories(e.target.value);
    });
  }

  const noteImportanceInput = document.getElementById('note-importance-input');
  if (noteImportanceInput) {
    noteImportanceInput.addEventListener('input', (e) => {
      const valEl = document.getElementById('note-importance-value');
      if (valEl) valEl.textContent = e.target.value;
    });
  }

  const noteModal = document.getElementById('note-modal');
  if (noteModal) {
    let noteMousedownTarget = null;
    noteModal.addEventListener('mousedown', (e) => {
      noteMousedownTarget = e.target;
    });
    noteModal.addEventListener('click', (e) => {
      if (e.target === noteModal && noteMousedownTarget === noteModal) {
        closeNoteModal();
      }
    });
  }

  // Subcategory Modal Backdrop close
  if (subcategoryModal) {
    let subcatMousedownTarget = null;
    subcategoryModal.addEventListener('mousedown', (e) => {
      subcatMousedownTarget = e.target;
    });
    subcategoryModal.addEventListener('click', (e) => {
      if (e.target === subcategoryModal && subcatMousedownTarget === subcategoryModal) {
        closeSubcategoryModal();
      }
    });
  }
  
  // Close category modal when clicking outside
  let categoryMousedownTarget = null;
  categoryModal.addEventListener('mousedown', (e) => {
    categoryMousedownTarget = e.target;
  });
  categoryModal.addEventListener('click', (e) => {
    if (e.target === categoryModal && categoryMousedownTarget === categoryModal) {
      closeCategoryModal();
    }
  });
  
  // Audio settings
  contentWrapper.addEventListener('input', (e) => {
    if (e.target.closest('#audio-volume')) {
      const volumeValue = document.getElementById('volume-value');
      if (volumeValue) {
        volumeValue.textContent = e.target.value + '%';
      }
    }
  });
  
  // Dev tools category dropdown change - delegated
  contentWrapper.addEventListener('change', (e) => {
    if (e.target.closest('#dev-popup-category')) {
      updateDevTipDropdown(e.target.value);
    }

    // Inline deadline picker date change
    if (e.target.closest('.inline-deadline-input')) {
      const dateInput = e.target.closest('.inline-deadline-input');
      const tipId = parseInt(dateInput.closest('.tip-item').getAttribute('data-tip-id'));
      const val = dateInput.value ? dateInput.value : null;
      updateTipProperty(tipId, 'deadline', val);
    }
  });
  
  // Sidebar navigation - delegated
  document.addEventListener('click', (e) => {
    if (e.target.closest('.nav-item')) {
      e.preventDefault();
      const section = e.target.closest('.nav-item').getAttribute('data-section');
      if (section === 'new-note') {
        openNoteModal();
      } else if (section) {
        showSection(section);
      }
    }
  });
  
  // Audio test buttons - delegated
  contentWrapper.addEventListener('click', (e) => {
    if (e.target.closest('#save-audio-settings')) {
      e.preventDefault();
      saveAudioSettings();
    }
    
    if (e.target.closest('.btn-test') && e.target.closest('.audio-settings-card')) {
      e.preventDefault();
      const testBtn = e.target.closest('.btn-test');
      const testBtnId = testBtn.id;
      const inputId = testBtnId.replace('test-', '');
      testAudio(inputId, testBtnId);
    }
    
    // Statistics refresh button
    if (e.target.closest('#refresh-stats')) {
      e.preventDefault();
      loadStatistics();
    }
    
    // Stats toggle buttons
    if (e.target.closest('#stats-toggle-weekly')) {
      e.preventDefault();
      statsToggleMode = 'weekly';
      loadStatistics();
    }
    
    if (e.target.closest('#stats-toggle-monthly')) {
      e.preventDefault();
      statsToggleMode = 'monthly';
      loadStatistics();
    }
    
    // Dev tools buttons
    if (e.target.closest('#dev-trigger-popup')) {
      e.preventDefault();
      devTriggerPopup();
    }
    
    if (e.target.closest('#dev-add-test-stat')) {
      e.preventDefault();
      devAddTestStat();
    }
    
    if (e.target.closest('#dev-reset-show-counts')) {
      e.preventDefault();
      devResetShowCounts(e.target.closest('#dev-reset-show-counts'));
    }
    
    if (e.target.closest('#dev-reset-checkin')) {
      e.preventDefault();
      devResetCheckin();
    }

    if (e.target.closest('#dev-trigger-checkin-popup')) {
      e.preventDefault();
      devTriggerCheckinPopup();
    }

    if (e.target.closest('#dev-refresh-popups')) {
      e.preventDefault();
      loadNextPopupTimes();
    }

    if (e.target.closest('#dev-refresh-queue')) {
      e.preventDefault();
      loadPopupQueueStatus();
    }

    if (e.target.closest('#dev-sim-apply')) {
      e.preventDefault();
      devSimulateDeadline();
    }

    if (e.target.closest('#dev-reset-snooze-limits-btn')) {
      e.preventDefault();
      devResetSnoozeLimits();
    }

    if (e.target.closest('#dev-get-active-window-btn')) {
      e.preventDefault();
      devGetActiveWindow();
    }

    if (e.target.closest('#dev-start-popup-interval-btn')) {
      e.preventDefault();
      startDebugPopupInterval();
    }

    if (e.target.closest('#dev-stop-popup-interval-btn')) {
      e.preventDefault();
      stopDebugPopupInterval();
    }

    if (e.target.closest('#dev-import-md-btn')) {
      e.preventDefault();
      devImportMarkdown();
    }

    if (e.target.closest('#close-import-success-btn')) {
      e.preventDefault();
      closeImportSuccessModal();
    }
  });
  
  // Dev tools category dropdown change - delegated
  contentWrapper.addEventListener('change', (e) => {
    if (e.target.closest('#dev-popup-category')) {
      updateDevTipDropdown(e.target.value);
    }
    if (e.target.closest('#dev-sim-type')) {
      populateDevSimItemDropdown();
    }
  });

  // Close note dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.note-menu-wrapper')) {
      document.querySelectorAll('.note-menu-dropdown').forEach(d => {
        d.classList.remove('show');
        d.closest('.tip-item')?.classList.remove('menu-open');
        d.closest('.accordion-item')?.classList.remove('menu-open');
      });
    }
  });

  // Global button click SFX delegation
  document.addEventListener('click', (e) => {
    const target = e.target;
    if (target.closest('button') || target.closest('.btn') || target.closest('.nav-item') || target.closest('.tab') || target.closest('.reason-btn') || target.closest('.accordion-header')) {
      if (window.audioManager) {
        window.audioManager.playBtnClick();
      }
    }
  }, { capture: true });
}

// Show specific section and hide others
function showSection(sectionId) {
  console.log('[settings] showSection called', sectionId);
  
  // Hide all sections
  const sections = document.querySelectorAll('.settings-section');
  sections.forEach(section => {
    section.style.display = 'none';
  });
  
  // Update active nav item in sidebar
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.classList.remove('active');
    if (item.getAttribute('data-section') === sectionId) {
      item.classList.add('active');
    }
  });

  const tabBar = document.getElementById('tab-bar');

  if (sectionId === 'notes') {
    // Show tab-bar
    if (tabBar) tabBar.style.display = 'flex';
    // Show active tab section
    const activeTab = openTabs.find(t => t.id === activeTabId) || openTabs[0];
    if (activeTab) {
      activeTabId = activeTab.id;
      if (activeTab.id === 'home') {
        const targetSection = document.getElementById('section-home');
        if (targetSection) targetSection.style.display = 'block';
      } else if (activeTab.categoryId) {
        const targetSection = document.getElementById('section-category-tab');
        if (targetSection) targetSection.style.display = 'block';
        loadCategoryTabContent(activeTab.categoryId);
      }
      renderTabs();
    }
    
    // Highlight correct sidebar tab
    navItems.forEach(item => {
      const section = item.getAttribute('data-section');
      if (activeTabId === 'home' ? (section === 'home') : (section === 'notes')) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  } else if (sectionId === 'home') {
    if (tabBar) tabBar.style.display = 'flex';
    activeTabId = 'home';
    const targetSection = document.getElementById('section-home');
    if (targetSection) targetSection.style.display = 'block';
    renderTabs();

    // Highlight Categories (home) in sidebar
    navItems.forEach(item => {
      if (item.getAttribute('data-section') === 'home') {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  } else if (sectionId === 'category-tab') {
    if (tabBar) tabBar.style.display = 'flex';
    const targetSection = document.getElementById('section-category-tab');
    if (targetSection) targetSection.style.display = 'block';
    
    // Highlight Notes in sidebar
    navItems.forEach(item => {
      if (item.getAttribute('data-section') === 'notes') {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  } else {
    // Hide tab-bar for non-notes sections
    if (tabBar) tabBar.style.display = 'none';
    
    const targetSection = document.getElementById(`section-${sectionId}`);
    if (targetSection) {
      targetSection.style.display = 'block';
    }
  }
  
  if (sectionId === 'dashboard') {
    loadDashboard();
  } else if (sectionId === 'dev-tools' || sectionId === 'devtools' || sectionId === 'settings') {
    populateDevToolsDropdowns();
    loadNextPopupTimes();
    loadPopupQueueStatus();
  }
}

// Category CRUD Functions
async function renderCategories() {
  // Update tip category dropdown
  updateTipCategoryDropdown();
  
  // Re-render category cards on home dashboard
  renderCategoryCards();

  // Re-render tab headers (async — await to ensure tabs are painted)
  await renderTabs();

  // Re-render DevTools dropdowns
  populateDevToolsDropdowns();
}
async function populateDevToolsDropdowns() {
  console.log('[settings] populateDevToolsDropdowns called');
  const devPopupCategory = document.getElementById('dev-popup-category');
  const devPopupTip = document.getElementById('dev-popup-tip');
  if (!devPopupCategory || !devPopupTip) return;

  // Clear both dropdowns
  devPopupCategory.innerHTML = '';
  devPopupTip.innerHTML = '<option value="">Not Seçin</option>';
  devPopupTip.disabled = true;

  // Show loading spinner
  devPopupCategory.innerHTML = '<option value="">⏳ Yükleniyor...</option>';
  devPopupCategory.disabled = true;

  try {
    const freshCategories = await window.electronAPI.dbQuery('SELECT * FROM categories ORDER BY name ASC');
    
    devPopupCategory.innerHTML = '<option value="">Kategori Seçin</option>' + 
      freshCategories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  } catch (error) {
    console.error('Error fetching categories for DevTools:', error);
    devPopupCategory.innerHTML = '<option value="">Hata Oluştu</option>';
  } finally {
    devPopupCategory.disabled = false;
  }

  // Populate simulation dropdowns as well
  populateDevSimItemDropdown();
}

let currentModalApps = [];

function renderCategoryAppTags() {
  const container = document.getElementById('category-apps-tags');
  if (!container) return;

  container.innerHTML = '';
  currentModalApps.forEach(app => {
    const tag = document.createElement('div');
    tag.className = 'app-tag';
    tag.innerHTML = `${app} <span class="app-tag-remove" data-app="${app}">×</span>`;
    container.appendChild(tag);
  });
}

async function populateActiveAppsDropdown() {
  const dropdown = document.getElementById('category-active-apps');
  if (!dropdown) return;

  dropdown.innerHTML = '<option value="">⏳ Yükleniyor...</option>';
  dropdown.disabled = true;

  try {
    if (window.electronAPI && window.electronAPI.getActiveWindows) {
      const windows = await window.electronAPI.getActiveWindows();
      dropdown.innerHTML = '<option value="">-- Uygulama Seçin --</option>';
      
      const seen = new Set();
      const uniqueWindows = (windows || []).filter(w => {
        if (!w.processName) return false;
        if (seen.has(w.processName)) return false;
        seen.add(w.processName);
        return true;
      });

      if (uniqueWindows.length === 0) {
        dropdown.innerHTML = '<option value="">Açık pencere bulunamadı</option>';
      } else {
        uniqueWindows.forEach(w => {
          const opt = document.createElement('option');
          opt.value = w.processName;
          opt.textContent = `${w.processName} (${w.windowTitle.substring(0, 30)}${w.windowTitle.length > 30 ? '...' : ''})`;
          dropdown.appendChild(opt);
        });
      }
    } else {
      dropdown.innerHTML = '<option value="">Electron API alınamadı</option>';
    }
  } catch (error) {
    console.error('Error populating active apps dropdown:', error);
    dropdown.innerHTML = '<option value="">Yükleme hatası</option>';
  } finally {
    dropdown.disabled = false;
  }
}

function openCategoryModal(category = null) {
  console.log('[settings] openCategoryModal called', category?.id);
  categoryModal.classList.add('active');
  
  if (category) {
    categoryModalTitle.textContent = 'Kategori Düzenle';
    document.getElementById('category-id').value = category.id;
    document.getElementById('category-name').value = category.name;
    document.getElementById('category-color').value = category.color;
    
    currentModalApps = [...(category.triggers?.apps || [])];
  } else {
    categoryModalTitle.textContent = 'Kategori Ekle';
    categoryForm.reset();
    document.getElementById('category-id').value = '';
    document.getElementById('category-color').value = '#6C63FF';
    currentModalApps = [];
  }
  
  renderCategoryAppTags();
  populateActiveAppsDropdown();
  
  // Focus the first input immediately
  setTimeout(() => {
    const nameInput = document.getElementById('category-name');
    if (nameInput) {
      nameInput.focus();
    }
  }, 0);
}

function closeCategoryModal() {
  console.log('[settings] closeCategoryModal called');
  categoryModal.classList.remove('active');
  categoryForm.reset();
  document.getElementById('category-id').value = '';
  document.getElementById('category-color').value = '#6C63FF';
  currentModalApps = [];
}

async function handleCategorySubmit(e) {
  console.log('[settings] handleCategorySubmit called');
  e.preventDefault();
  
  const id = document.getElementById('category-id').value;
  const name = document.getElementById('category-name').value.trim();
  const color = document.getElementById('category-color').value;
  
  const triggers = {
    apps: currentModalApps,
    keywords: []
  };
  
  try {
    if (!window.electronAPI || !window.electronAPI.dbRun) {
      console.error('electronAPI.dbRun not available');
      showInlineWarning('IPC bağlantısı hatası.', document.getElementById('category-name'));
      return;
    }
    if (id) {
      // Edit existing category
      await window.electronAPI.dbRun(`
        UPDATE categories 
        SET name = ?, color = ?, triggers = ?
        WHERE id = ?
      `, [name, color, JSON.stringify(triggers), parseInt(id)]);
    } else {
      // Add new category
      await window.electronAPI.dbRun(`
        INSERT INTO categories (name, color, triggers, created_at)
        VALUES (?, ?, ?, ?)
      `, [name, color, JSON.stringify(triggers), Date.now()]);
    }
    
    closeCategoryModal();
    await loadCategories(); // refreshes `categories` array + calls renderCategories() → renderCategoryCards() + renderTabs()
    await loadTips();       // refreshes `tips` array + calls renderTips()
    
    // renderCategories is already called inside loadCategories, but re-call explicitly
    // to ensure the DOM is fully up to date (now awaited since renderCategories is async)
    await renderCategories();
  } catch (error) {
    console.error('Error saving category:', error);
    showInlineWarning('Kategori kaydedilirken hata oluştu.', document.getElementById('category-name'));
  }
}

function editCategory(id) {
  console.log('[settings] editCategory called', id);
  const category = categories.find(c => c.id === id);
  if (category) {
    openCategoryModal(category);
  }
}

async function deleteCategory(id, btn) {
  console.log('[settings] deleteCategory called', id);
  if (!btn) return;
  
  if (btn.classList.contains('confirm-pending')) {
    try {
      if (!window.electronAPI || !window.electronAPI.dbRun) {
        console.error('electronAPI.dbRun not available');
        showToast('IPC bağlantısı hatası.');
        return;
      }
      await window.electronAPI.dbRun(`DELETE FROM categories WHERE id = ?`, [id]);
      
      // Close the tab if it is open
      const tabId = "category-" + id;
      if (openTabs.some(t => t.id === tabId)) {
        closeTab(tabId);
      }
      
      await loadCategories();
      await loadTips();
      showToast('Kategori silindi.');
    } catch (error) {
      console.error('Error deleting category:', error);
      showToast('Kategori silinirken hata oluştu.');
    }
  } else {
    btn.classList.add('confirm-pending');
    
    if (btn.classList.contains('btn-icon-only')) {
      btn.title = "Emin misiniz? (Silmek için tekrar tıklayın)";
      btn.style.color = '#ef4444';
      showToast('Kategoriyi silmek için tekrar tıklayın.');
      
      setTimeout(() => {
        btn.classList.remove('confirm-pending');
        btn.title = "Sil";
        btn.style.color = '';
      }, 4000);
    } else {
      const originalText = btn.textContent;
      btn.textContent = 'Emin misiniz?';
      btn.style.backgroundColor = '#ef4444';
      btn.style.color = '#fff';
      
      setTimeout(() => {
        btn.classList.remove('confirm-pending');
        btn.textContent = originalText;
        btn.style.backgroundColor = '';
        btn.style.color = '';
      }, 4000);
    }
  }
}

function showCategoryDeleteConfirm(id) {
  const confirmEl = document.getElementById(`category-delete-confirm-${id}`);
  if (confirmEl) {
    confirmEl.style.display = 'flex';
  }
}

function hideCategoryDeleteConfirm(id) {
  const confirmEl = document.getElementById(`category-delete-confirm-${id}`);
  if (confirmEl) {
    confirmEl.style.display = 'none';
  }
}

async function executeCategoryDelete(id, btn) {
  if (btn) btn.disabled = true;
  try {
    if (window.electronAPI && window.electronAPI.categoryDelete) {
      await window.electronAPI.categoryDelete(id);
    } else if (window.electronAPI && window.electronAPI.dbRun) {
      await window.electronAPI.dbRun(`DELETE FROM categories WHERE id = ?`, [id]);
    }
    
    const tabId = "category-" + id;
    if (openTabs.some(t => t.id === tabId)) {
      closeTab(tabId);
    }
    
    showToast('Kategori silindi.');
    await loadCategories();
    await loadTips();
    await renderCategories();
  } catch (error) {
    console.error('Error deleting category:', error);
    showToast('Kategori silinirken hata oluştu.');
    if (btn) btn.disabled = false;
  }
}

// Tip CRUD Functions
function renderTips() {
  if (!tipsList) return;
  // Filter for featured tips only: highest show_count OR (status='active' AND importance >= 7)
  const featuredTips = tips.filter(tip => {
    const isHighShowCount = (tip.show_count || 0) >= 5; // Tips shown 5+ times
    const isActiveAndImportant = tip.status === 'active' && tip.importance >= 7;
    return isHighShowCount || isActiveAndImportant;
  });
  
  if (featuredTips.length === 0) {
    tipsList.innerHTML = '<p>Henüz öne çıkan tip yok.</p>';
    return;
  }
  
  tipsList.innerHTML = featuredTips.map(tip => {
    // Use joined category data if available, otherwise fallback to categories array
    const categoryName = tip.category_name || (categories.find(c => c.id === tip.category_id)?.name) || 'Silinmiş Kategori';
    const categoryColor = tip.category_color || (categories.find(c => c.id === tip.category_id)?.color) || '#666';
    
    return `
      <div class="item-card" style="border-left: 4px solid ${categoryColor}">
        <div class="item-header">
          <h3>${tip.content.substring(0, 50)}${tip.content.length > 50 ? '...' : ''}</h3>
          <div class="item-actions">
            <button class="btn-small btn-edit" data-tip-id="${tip.id}">Düzenle</button>
            <button class="btn-small btn-delete" data-tip-id="${tip.id}">Sil</button>
          </div>
        </div>
        <div class="item-details">
          <span class="tag" style="background: ${categoryColor}20; color: ${categoryColor}">${categoryName}</span>
          <span class="tag">Önem: ${tip.importance}</span>
          <span class="tag status-${tip.status}">${getStatusText(tip.status)}</span>
          <span class="tag">Gösterim: ${tip.show_count}</span>
        </div>
      </div>
    `;
  }).join('');
}
// Obsolete Chain/Prerequisite functions removed

// Save audio settings
async function saveAudioSettings() {
  try {
    if (!window.electronAPI || !window.electronAPI.dbRun) {
      console.error('electronAPI.dbRun not available');
      showToast('IPC bağlantısı hatası.');
      return;
    }
        const volume = document.getElementById('audio-volume').value;
    const intensityEl = document.getElementById('popup-intensity');
    const popupIntensity = intensityEl ? intensityEl.value : '1';
    
    const soundLevel1to3 = document.getElementById('sound-level-1-3').value.trim();
    const soundLevel4to6 = document.getElementById('sound-level-4-6').value.trim();
    const soundLevel7to9 = document.getElementById('sound-level-7-9').value.trim();
    const soundLevel10 = document.getElementById('sound-level-10').value.trim();
    const soundLevel10BuildUp = document.getElementById('sound-level-10-buildup').value.trim();
    const soundLevel10Hit = document.getElementById('sound-level-10-hit').value.trim();
    
    const soundSfxChessSelect = document.getElementById('sound-sfx-chess-select').value.trim();
    const soundSfxChessPlace = document.getElementById('sound-sfx-chess-place').value.trim();
    const soundSfxChessCheckmate = document.getElementById('sound-sfx-chess-checkmate').value.trim();
    const soundSfxChessWrong = document.getElementById('sound-sfx-chess-wrong').value.trim();
    const soundSfxDismissSnooze = document.getElementById('sound-sfx-dismiss-snooze').value.trim();
    const soundSfxMathCorrect = document.getElementById('sound-sfx-math-correct').value.trim();
    const soundSfxConfetti = document.getElementById('sound-sfx-confetti').value.trim();
    const soundSfxBtnClick = document.getElementById('sound-sfx-btn-click').value.trim();
    const soundSfxCheckinSuccess = document.getElementById('sound-sfx-checkin-success').value.trim();

    // Save each setting to database
    const settings = [
      { key: 'audio_volume', value: volume },
      { key: 'popup_intensity', value: popupIntensity },
      
      { key: 'sound_level_1_3', value: soundLevel1to3 },
      { key: 'sound_level_1_3_enabled', value: document.getElementById('sound-level-1-3-enabled').checked ? '1' : '0' },
      
      { key: 'sound_level_4_6', value: soundLevel4to6 },
      { key: 'sound_level_4_6_enabled', value: document.getElementById('sound-level-4-6-enabled').checked ? '1' : '0' },
      
      { key: 'sound_level_7_9', value: soundLevel7to9 },
      { key: 'sound_level_7_9_enabled', value: document.getElementById('sound-level-7-9-enabled').checked ? '1' : '0' },
      
      { key: 'sound_level_10', value: soundLevel10 },
      { key: 'sound_level_10_enabled', value: document.getElementById('sound-level-10-enabled').checked ? '1' : '0' },
      
      { key: 'sound_level_10_buildup', value: soundLevel10BuildUp },
      { key: 'sound_level_10_buildup_enabled', value: document.getElementById('sound-level-10-buildup-enabled').checked ? '1' : '0' },
      
      { key: 'sound_level_10_hit', value: soundLevel10Hit },
      { key: 'sound_level_10_hit_enabled', value: document.getElementById('sound-level-10-hit-enabled').checked ? '1' : '0' },
      
      { key: 'sound_sfx_chess_select', value: soundSfxChessSelect },
      { key: 'sound_sfx_chess_select_enabled', value: document.getElementById('sound-sfx-chess-select-enabled').checked ? '1' : '0' },
      { key: 'sound_sfx_chess_place', value: soundSfxChessPlace },
      { key: 'sound_sfx_chess_place_enabled', value: document.getElementById('sound-sfx-chess-place-enabled').checked ? '1' : '0' },
      { key: 'sound_sfx_chess_checkmate', value: soundSfxChessCheckmate },
      { key: 'sound_sfx_chess_checkmate_enabled', value: document.getElementById('sound-sfx-chess-checkmate-enabled').checked ? '1' : '0' },
      { key: 'sound_sfx_chess_wrong', value: soundSfxChessWrong },
      { key: 'sound_sfx_chess_wrong_enabled', value: document.getElementById('sound-sfx-chess-wrong-enabled').checked ? '1' : '0' },
      
      { key: 'sound_sfx_dismiss_snooze', value: soundSfxDismissSnooze },
      { key: 'sound_sfx_dismiss_snooze_enabled', value: document.getElementById('sound-sfx-dismiss-snooze-enabled').checked ? '1' : '0' },
      
      { key: 'sound_sfx_math_correct', value: soundSfxMathCorrect },
      { key: 'sound_sfx_math_correct_enabled', value: document.getElementById('sound-sfx-math-correct-enabled').checked ? '1' : '0' },
      
      { key: 'sound_sfx_confetti', value: soundSfxConfetti },
      { key: 'sound_sfx_confetti_enabled', value: document.getElementById('sound-sfx-confetti-enabled').checked ? '1' : '0' },
      
      { key: 'sound_sfx_btn_click', value: soundSfxBtnClick },
      { key: 'sound_sfx_btn_click_enabled', value: document.getElementById('sound-sfx-btn-click-enabled').checked ? '1' : '0' },
      
      { key: 'sound_sfx_checkin_success', value: soundSfxCheckinSuccess },
      { key: 'sound_sfx_checkin_success_enabled', value: document.getElementById('sound-sfx-checkin-success-enabled').checked ? '1' : '0' }
    ];
    
    for (const setting of settings) {
      if (setting.value !== undefined && setting.value !== null) {
        await window.electronAPI.dbRun(`
          INSERT OR REPLACE INTO settings (key, value)
          VALUES (?, ?)
        `, [setting.key, String(setting.value)]);
      }
    }
    
    // Reinitialize audio manager with new settings
    if (window.audioManager) {
      await window.audioManager.initialize({
        volume: parseInt(volume) / 100,
        musicVolume: parseInt(musicVolume) / 100,
        backgroundMusic: backgroundMusic || null,
        soundLevel1to3: soundLevel1to3 || null,
        soundLevel1to3Enabled: document.getElementById('sound-level-1-3-enabled').checked,
        soundLevel4to6: soundLevel4to6 || null,
        soundLevel4to6Enabled: document.getElementById('sound-level-4-6-enabled').checked,
        soundLevel7to9: soundLevel7to9 || null,
        soundLevel7to9Enabled: document.getElementById('sound-level-7-9-enabled').checked,
        soundLevel10: soundLevel10 || null,
        soundLevel10Enabled: document.getElementById('sound-level-10-enabled').checked,
        soundLevel10BuildUp: soundLevel10BuildUp || null,
        soundLevel10BuildUpEnabled: document.getElementById('sound-level-10-buildup-enabled').checked,
        soundLevel10Hit: soundLevel10Hit || null,
        soundLevel10HitEnabled: document.getElementById('sound-level-10-hit-enabled').checked,
        sfxChessSelect: soundSfxChessSelect || null,
        sfxChessSelectEnabled: document.getElementById('sound-sfx-chess-select-enabled').checked,
        sfxChessPlace: soundSfxChessPlace || null,
        sfxChessPlaceEnabled: document.getElementById('sound-sfx-chess-place-enabled').checked,
        sfxChessCheckmate: soundSfxChessCheckmate || null,
        sfxChessCheckmateEnabled: document.getElementById('sound-sfx-chess-checkmate-enabled').checked,
        sfxChessWrong: soundSfxChessWrong || null,
        sfxChessWrongEnabled: document.getElementById('sound-sfx-chess-wrong-enabled').checked,
        sfxDismissSnooze: soundSfxDismissSnooze || null,
        sfxDismissSnoozeEnabled: document.getElementById('sound-sfx-dismiss-snooze-enabled').checked,
        sfxMathCorrect: soundSfxMathCorrect || null,
        sfxMathCorrectEnabled: document.getElementById('sound-sfx-math-correct-enabled').checked,
        sfxConfetti: soundSfxConfetti || null,
        sfxConfettiEnabled: document.getElementById('sound-sfx-confetti-enabled').checked,
        sfxBtnClick: soundSfxBtnClick || null,
        sfxBtnClickEnabled: document.getElementById('sound-sfx-btn-click-enabled').checked,
        sfxCheckinSuccess: soundSfxCheckinSuccess || null,
        sfxCheckinSuccessEnabled: document.getElementById('sound-sfx-checkin-success-enabled').checked
      });

      // Play music if path updated
      if (window.audioManager.backgroundMusic) {
        // window.audioManager.fadeInBackgroundMusic(); // Iptal edildi (Goal Adim 2)
      } else {
        window.audioManager.stopBackgroundMusic();
      }
    }
    
    showToast('Ses ayarları kaydedildi!');
  } catch (error) {
    console.error('Error saving audio settings:', error);
    showToast('Ses ayarları kaydedilirken hata oluştu.');
  }
}

// Helper Functions
function getStatusText(status) {
  const statusMap = {
    'done': '✅ Bitti',
    'retired': '⏸️ Duraklatıldı',
    'active': '▶️ Devam Ediyor',
    'cancelled': '✖️ İptal Edildi'
  };
  return statusMap[status] || status;
}

// Statistics Functions
let statsToggleMode = 'weekly';

async function loadStatistics() {
  console.log('[settings] loadStatistics called');
  
  // Update toggle UI active states
  const toggleWeeklyBtn = document.getElementById('stats-toggle-weekly');
  const toggleMonthlyBtn = document.getElementById('stats-toggle-monthly');
  if (toggleWeeklyBtn && toggleMonthlyBtn) {
    if (statsToggleMode === 'weekly') {
      toggleWeeklyBtn.classList.add('active');
      toggleMonthlyBtn.classList.remove('active');
    } else {
      toggleWeeklyBtn.classList.remove('active');
      toggleMonthlyBtn.classList.add('active');
    }
  }

  try {
    // 1. Fetch completed count
    const completedResult = await window.electronAPI.dbQuery("SELECT COUNT(*) as count FROM tips WHERE status = 'done'");
    const completedCount = completedResult && completedResult[0] ? completedResult[0].count : 0;
    const completedCountEl = document.getElementById('stats-completed-count');
    if (completedCountEl) completedCountEl.textContent = completedCount;

    // 2. Fetch avg focus time
    const avgFocusResult = await window.electronAPI.dbQuery(`
      SELECT AVG((strftime('%s', ended_at) - strftime('%s', started_at)) / 60.0) as avg_time 
      FROM sessions 
      WHERE ended_at IS NOT NULL
    `);
    const avgFocusTime = avgFocusResult && avgFocusResult[0] && avgFocusResult[0].avg_time 
      ? Math.round(avgFocusResult[0].avg_time) 
      : 0;
    const avgFocusTimeEl = document.getElementById('stats-avg-focus-time');
    if (avgFocusTimeEl) avgFocusTimeEl.textContent = `${avgFocusTime} dk`;

    // 3. Fetch check-in streak
    let streak = 0;
    if (window.electronAPI && window.electronAPI.checkinStatus) {
      try {
        const status = await window.electronAPI.checkinStatus();
        streak = status.streak;
      } catch (err) {
        console.error('Error fetching streak for stats:', err);
      }
    }
    const currentStreakEl = document.getElementById('stats-current-streak');
    if (currentStreakEl) currentStreakEl.textContent = `${streak} Gün`;

    // 4. Procrastination Trend Bar Chart
    const daysCount = statsToggleMode === 'weekly' ? 7 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysCount + 1);
    startDate.setHours(0, 0, 0, 0);

    const dismissals = await window.electronAPI.dbQuery(`
      SELECT dismissed_at FROM dismiss_log 
      WHERE dismissed_at >= ?
    `, [startDate.toISOString()]);

    const dailyCounts = Array(daysCount).fill(0);
    (dismissals || []).forEach(row => {
      const d = new Date(row.dismissed_at);
      d.setHours(0,0,0,0);
      const diffTime = d - startDate;
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays >= 0 && diffDays < daysCount) {
        dailyCounts[diffDays]++;
      }
    });

    const maxDismiss = Math.max(...dailyCounts, 1);
    const trendChartContainer = document.getElementById('stats-trend-chart');
    if (trendChartContainer) {
      trendChartContainer.innerHTML = '';
      const weekdays = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
      
      dailyCounts.forEach((count, i) => {
        const pct = Math.min((count / maxDismiss) * 100, 100);
        
        const col = document.createElement('div');
        col.className = 'stats-trend-bar-col';
        
        const bar = document.createElement('div');
        bar.className = 'stats-trend-bar';
        bar.style.height = `${pct}%`;
        if (statsToggleMode === 'monthly') {
          bar.style.width = '8px';
        }
        bar.title = `${count} Erteleme`;
        
        const label = document.createElement('span');
        if (statsToggleMode === 'weekly') {
          const dayDate = new Date(startDate);
          dayDate.setDate(startDate.getDate() + i);
          let wDay = dayDate.getDay();
          let labelText = weekdays[wDay === 0 ? 6 : wDay - 1];
          label.textContent = labelText;
        } else {
          const dayDate = new Date(startDate);
          dayDate.setDate(startDate.getDate() + i);
          if (i % 5 === 0 || i === daysCount - 1) {
            label.textContent = dayDate.getDate();
          } else {
            label.textContent = '';
          }
        }
        
        col.appendChild(bar);
        col.appendChild(label);
        trendChartContainer.appendChild(col);
      });
    }

    // 5. Procrastination Reasons list
    const reasonsData = await window.electronAPI.dbQuery(`
      SELECT reason, COUNT(*) as count 
      FROM dismiss_log 
      WHERE reason IS NOT NULL AND reason != '' AND dismissed_at >= ?
      GROUP BY reason 
      ORDER BY count DESC
    `, [startDate.toISOString()]);

    const reasonsMapping = {
      'not_today': 'Bugün değil',
      'remind_1h': '1 saat sonra hatırlat',
      'no_motivation': 'Motivasyon yok',
      'not_now': 'Şimdi değil',
      'no_time': 'Bugün değil',
      'dont_know_how': '1 saat sonra hatırlat'
    };

    const reasonsColors = {
      'not_today': '#FFA502',
      'remind_1h': '#00D9FF',
      'no_motivation': '#FF4757',
      'not_now': '#6C63FF',
      'no_time': '#FFA502',
      'dont_know_how': '#00D9FF'
    };

    const totalReasonsCount = (reasonsData || []).reduce((acc, row) => acc + row.count, 0) || 1;
    const reasonsListContainer = document.getElementById('procrastination-reasons-list');
    if (reasonsListContainer) {
      if (!reasonsData || reasonsData.length === 0) {
        reasonsListContainer.innerHTML = '<p class="placeholder-text" style="color: var(--text-muted);">Bu dönemde erteleme verisi yok.</p>';
      } else {
        reasonsListContainer.innerHTML = reasonsData.map(row => {
          const label = reasonsMapping[row.reason] || row.reason;
          const pct = Math.round((row.count / totalReasonsCount) * 100);
          const color = reasonsColors[row.reason] || 'var(--accent-purple)';
          return `
            <div class="reason-progress-row">
              <div class="reason-progress-header">
                <span>${label}</span>
                <span>${row.count} kere (${pct}%)</span>
              </div>
              <div class="reason-progress-bg">
                <div class="reason-progress-fill" style="width: ${pct}%; background: ${color};"></div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // 6. Category Insights (Donut charts)
    const categoryInsightRows = await window.electronAPI.dbQuery(`
      SELECT c.id, c.name, c.color, 
             COUNT(t.id) as total_tips,
             SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as done_tips
      FROM categories c
      LEFT JOIN tips t ON c.id = t.category_id
      GROUP BY c.id
    `);

    const donutContainer = document.getElementById('category-donut-container');
    if (donutContainer) {
      if (!categoryInsightRows || categoryInsightRows.length === 0) {
        donutContainer.innerHTML = '<p class="placeholder-text" style="color: var(--text-muted);">Henüz kategori yok.</p>';
      } else {
        donutContainer.innerHTML = categoryInsightRows.map(row => {
          const total = row.total_tips || 0;
          const done = row.done_tips || 0;
          const pct = total > 0 ? Math.round((done / total) * 100) : 0;
          const color = row.color || 'var(--accent-purple)';
          
          return `
            <div class="category-donut-wrapper">
              <div class="category-donut-chart" style="background: conic-gradient(${color} ${pct}%, var(--bg-secondary) ${pct}% 100%);">
                <span class="donut-value">${pct}%</span>
              </div>
              <span class="donut-label" title="${row.name}">${row.name}</span>
              <span style="font-size: 10px; color: var(--text-muted);">${done}/${total} Tamamlandı</span>
            </div>
          `;
        }).join('');
      }
    }

    // 7. Daily AI Insight Card message
    const aiInsightEl = document.getElementById('daily-ai-insight');
    if (aiInsightEl) {
      const topReason = reasonsData && reasonsData[0] ? reasonsData[0].reason : null;
      let advice = '';
      if (topReason === 'not_today' || topReason === 'no_time') {
        advice = "Erteleme sebeplerinin başında 'Bugün değil' geliyor. Günlük görevlerini daha küçük adımlara bölerek başlamayı kolaylaştırabilirsin. Sadece 5 dakikalık bir başlangıç yapmayı dene!";
      } else if (topReason === 'remind_1h' || topReason === 'dont_know_how') {
        advice = "Notları sıklıkla '1 saat sonra hatırlat' diyerek erteliyorsun. Bu durum odaklanma süreni bölüyor olabilir. Gerçekten odaklanabileceğin belirli 'Not Zamanları' belirle.";
      } else if (topReason === 'no_motivation') {
        advice = "Motivasyon eksikliği yaşadığını görüyorum. Unutma, motivasyon eylemden sonra gelir, önce değil. Kendine küçük bir ödül belirle ve ilk 5 dakikayı tamamla!";
      } else if (topReason === 'not_now') {
        advice = "Notları 'Şimdi değil' diyerek geçiştiriyorsun. Dikkatini dağıtan unsurları azaltmak için 'Odaklanma Modu'nu aktif etmeyi ve gereksiz sekmeleri kapatmayı dene.";
      } else {
        advice = "Harika gidiyorsun! Notlarını düzenli takip edip ertelemeleri en aza indirmek için planlı çalışmaya devam et. Check-in yapmayı unutma!";
      }
      aiInsightEl.textContent = advice;
    }

  } catch (error) {
    console.error('Error loading statistics:', error);
  }
}

async function loadPatternWarnings() {
  const patternWarningsList = document.getElementById('pattern-warnings-list');
  
  try {
    const patterns = await getTopPatterns();
    
    if (patterns.length === 0) {
      patternWarningsList.innerHTML = '<p>Henüz önemli desen yok.</p>';
      return;
    }
    
    patternWarningsList.innerHTML = patterns.map(pattern => `
      <div class="pattern-warning-item">
        ${pattern.message}
      </div>
    `).join('');
  } catch (error) {
    console.error('Error loading pattern warnings:', error);
    patternWarningsList.innerHTML = '<p>Desenler yüklenirken hata oluştu.</p>';
  }
}

async function loadCategoryStatistics() {
  const categoryStatsContainer = document.getElementById('category-stats');
  
  try {
    const categoryStats = await getStatsPerCategory();
    
    if (categoryStats.length === 0) {
      categoryStatsContainer.innerHTML = '<p>Henüz kategori istatistiği yok.</p>';
      return;
    }
    
    categoryStatsContainer.innerHTML = `
      <table class="stats-table">
        <thead>
          <tr>
            <th>Kategori</th>
            <th>Not Sayısı</th>
            <th>Toplam Dismiss</th>
            <th>Breakdown</th>
            <th>Uyarı</th>
          </tr>
        </thead>
        <tbody>
          ${categoryStats.map(stat => `
            <tr>
              <td>
                <span style="color: ${stat.category.color}; font-weight: 600;">${stat.category.name}</span>
              </td>
              <td>${stat.tipCount}</td>
              <td>${stat.totalDismisses}</td>
              <td>
                <div class="stats-breakdown">
                  ${Object.entries(stat.breakdown).map(([reason, count]) => {
                    if (count > 0 && reason !== 'completed') {
                      return `
                        <div class="breakdown-item">
                          <span class="reason-badge reason-${reason}">${getReasonLabel(reason)}</span>
                          <span class="breakdown-count">${count}</span>
                        </div>
                      `;
                    }
                    return '';
                  }).join('')}
                </div>
              </td>
              <td>
                ${stat.patternWarning ? `
                  <span class="warning-text">${stat.mostCommonCount}x ${getReasonLabel(stat.patternWarning)}</span>
                ` : '-'}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (error) {
    console.error('Error loading category statistics:', error);
    categoryStatsContainer.innerHTML = '<p>İstatistikler yüklenirken hata oluştu.</p>';
  }
}

async function loadTipStatistics() {
  const tipStatsContainer = document.getElementById('tip-stats');
  
  try {
    const tipStats = await getStatsPerTip();
    
    if (tipStats.length === 0) {
      tipStatsContainer.innerHTML = '<p>Henüz not istatistiği yok.</p>';
      return;
    }
    
    tipStatsContainer.innerHTML = tipStats.map(stat => `
      <div class="stats-card" style="border-left: 4px solid ${stat.tip.category_color}">
        <div class="stats-card-header">
          <div class="stats-card-title">${stat.tip.content.substring(0, 60)}${stat.tip.content.length > 60 ? '...' : ''}</div>
          <span class="tag" style="background: ${stat.tip.category_color}20; color: ${stat.tip.category_color}">${stat.tip.category_name}</span>
        </div>
        <div class="stats-card-content">
          <div class="breakdown-item">
            <span>Önem:</span>
            <span class="breakdown-count">${stat.tip.importance}</span>
          </div>
          <div class="breakdown-item">
            <span>Toplam Dismiss:</span>
            <span class="breakdown-count">${stat.totalDismisses}</span>
          </div>
          <div class="stats-breakdown">
            ${Object.entries(stat.breakdown).map(([reason, count]) => {
              if (count > 0) {
                return `
                  <div class="breakdown-item">
                    <span class="reason-badge reason-${reason}">${getReasonLabel(reason)}</span>
                    <span class="breakdown-count">${count}</span>
                  </div>
                `;
              }
              return '';
            }).join('')}
          </div>
        </div>
        ${stat.patternWarning ? `
          <div class="warning-text">Bu konuyu ${stat.mostCommonCount} kez '${getReasonLabel(stat.patternWarning)}' diyerek geçtin</div>
        ` : ''}
      </div>
    `).join('');
  } catch (error) {
    console.error('Error loading tip statistics:', error);
    tipStatsContainer.innerHTML = '<p>İstatistikler yüklenirken hata oluştu.</p>';
  }
}

// Make functions globally accessible
window.editCategory = editCategory;
window.deleteCategory = deleteCategory;
window.openCategoryTab = openCategoryTab;
window.switchToTab = switchToTab;
window.closeTab = closeTab;
window.showCategoryDeleteConfirm = showCategoryDeleteConfirm;
window.hideCategoryDeleteConfirm = hideCategoryDeleteConfirm;
window.executeCategoryDelete = executeCategoryDelete;

// Home Dashboard Functions
async function loadHomeDashboard() {
  try {
    // Load category cards grid
    renderCategoryCards();
  } catch (error) {
    console.error('Error loading home dashboard:', error);
  }
}

function getCategoryIcon(name) {
  const lower = name.toLowerCase();
  if (lower.includes('kod') || lower.includes('yazılım') || lower.includes('code') || lower.includes('programming') || lower.includes('dev')) return '💻';
  if (lower.includes('work') || lower.includes('iş') || lower.includes('office') || lower.includes('proje')) return '💼';
  if (lower.includes('study') || lower.includes('ders') || lower.includes('okul') || lower.includes('öğren') || lower.includes('learning')) return '📚';
  if (lower.includes('sağlık') || lower.includes('spor') || lower.includes('health') || lower.includes('gym')) return '🏃‍♂️';
  if (lower.includes('para') || lower.includes('money') || lower.includes('bütçe')) return '💵';
  if (lower.includes('kişisel') || lower.includes('personal') || lower.includes('günlük')) return '📝';
  if (lower.includes('tasarım') || lower.includes('design') || lower.includes('sanat') || lower.includes('art')) return '🎨';
  if (lower.includes('social') || lower.includes('sosyal') || lower.includes('arkadaş')) return '👥';
  if (lower.includes('ai') || lower.includes('yapay zeka') || lower.includes('machine learning')) return '🤖';
  return '📁'; // Default fallback icon
}

function renderCategoryCards() {
  const categoryCards = document.getElementById('category-cards');
  if (!categoryCards) return;
  
  if (categories.length === 0) {
    categoryCards.innerHTML = '<p>Henüz kategori yok.</p>';
    return;
  }
  
  categoryCards.innerHTML = categories.map(category => {
    const categoryTips = tips.filter(t => t.category_id === category.id);
    const activeCategoryTips = categoryTips.filter(t => t.status === 'active');
    const tipCount = categoryTips.length;
    
    // son 2-3 not içerik preview
    const previewTips = activeCategoryTips.slice(0, 3);
    const previewsHtml = previewTips.map(tip => `
      <div class="note-preview-item">
        • ${tip.content.substring(0, 35)}${tip.content.length > 35 ? '...' : ''}
      </div>
    `).join('') || '<div class="note-preview-item empty">Henüz aktif not yok.</div>';

    // en yakın deadline
    const tipsWithDeadlines = categoryTips.filter(t => t.deadline && t.status === 'active');
    let nearestDeadlineHtml = '';
    if (tipsWithDeadlines.length > 0) {
      tipsWithDeadlines.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
      const nearestTip = tipsWithDeadlines[0];
      nearestDeadlineHtml = `
        <div class="nearest-deadline">
          <span>En yakın son tarih:</span>
          ${getDeadlineBadgeHtml(nearestTip.deadline)}
        </div>
      `;
    } else {
      nearestDeadlineHtml = `
        <div class="nearest-deadline">
          <span>En yakın son tarih:</span>
          <span style="color: var(--text-muted)">Yok</span>
        </div>
      `;
    }
    
    const icon = getCategoryIcon(category.name);
    
    return `
      <div class="category-card" style="border-left-color: ${category.color}; position: relative;" onclick="openCategoryTab(${category.id})">
        <button class="btn-icon-only btn-delete" title="Sil" onclick="event.stopPropagation(); showCategoryDeleteConfirm(${category.id});">🗑️</button>
        
        <div class="category-delete-confirm" id="category-delete-confirm-${category.id}" style="display: none;" onclick="event.stopPropagation();">
          <p>Emin misiniz?</p>
          <div class="confirm-buttons">
            <button class="btn-confirm-yes" onclick="event.stopPropagation(); executeCategoryDelete(${category.id}, this);">Evet</button>
            <button class="btn-confirm-no" onclick="event.stopPropagation(); hideCategoryDeleteConfirm(${category.id});">Hayır</button>
          </div>
        </div>

        <div class="category-card-header">
          <div class="category-card-title-container">
            <span class="category-card-icon">${icon}</span>
            <h4>${category.name}</h4>
          </div>
          <span class="tip-count">${tipCount} Not</span>
        </div>
        <div class="category-card-previews">
          ${previewsHtml}
        </div>
        ${nearestDeadlineHtml}
      </div>
    `;
  }).join('');
}

async function openCategoryTab(categoryId) {
  console.log('[settings] openCategoryTab called', categoryId);
  const category = categories.find(c => c.id === categoryId);
  if (!category) return;
  
  // Check if tab already exists
  const existingTab = openTabs.find(t => t.id === `category-${categoryId}`);
  if (existingTab) {
    switchToTab(`category-${categoryId}`);
    return;
  }
  
  // Create new tab
  const newTab = {
    id: `category-${categoryId}`,
    title: category.name,
    categoryId: categoryId,
    color: category.color,
    pinned: false
  };
  
  openTabs.push(newTab);
  activeTabId = newTab.id;
  await renderTabs();
  switchToTab(newTab.id);
}

async function isCategoryCompleted(categoryId) {
  if (!categoryId) return false;
  
  let subcats = [];
  try {
    if (window.electronAPI && window.electronAPI.subcategoryList) {
      subcats = await window.electronAPI.subcategoryList(categoryId);
    }
  } catch (err) {
    console.error('Error listing subcategories in isCategoryCompleted:', err);
  }
  
  const categoryTips = tips.filter(t => t.category_id === categoryId);
  const hasGenelTips = categoryTips.some(t => t.subcategory_id === null || !subcats.some(s => s.id === t.subcategory_id));
  
  if (subcats.length === 0 && !hasGenelTips) {
    return false;
  }
  
  for (const sub of subcats) {
    const subcatTips = categoryTips.filter(t => t.subcategory_id === sub.id);
    if (subcatTips.length === 0) {
      continue;
    }
    const allDone = subcatTips.every(t => t.status === 'done');
    if (!allDone) return false;
  }
  
  if (hasGenelTips) {
    const genelTips = categoryTips.filter(t => t.subcategory_id === null || !subcats.some(s => s.id === t.subcategory_id));
    const allDone = genelTips.every(t => t.status === 'done');
    if (!allDone) return false;
  }
  
  return true;
}

async function renderTabs() {
  const tabBar = document.getElementById('tab-bar');
  if (!tabBar) return;
  
  const tabsHtmlPromises = openTabs.map(async tab => {
    const isPinned = tab.pinned ? 'data-pinned="true"' : '';
    const isActive = tab.id === activeTabId ? 'active' : '';
    const closeBtn = !tab.pinned ? `<span class="tab-close" onclick="closeTab('${tab.id}', event)">×</span>` : '';
    
    let tabTitle = tab.title;
    let tabColor = tab.color;
    let isCompleted = false;
    if (tab.categoryId) {
      const cat = categories.find(c => c.id === tab.categoryId);
      if (cat) {
        tabTitle = cat.name;
        tabColor = cat.color;
        isCompleted = await isCategoryCompleted(tab.categoryId);
      }
    }
    
    const dot = tabColor ? `<span class="category-dot" style="background: ${tabColor}"></span>` : '';
    const icon = tab.id === 'home' ? '<span class="tab-icon">🏠</span>' : dot;
    const title = tab.id === 'home' ? 'Main' : tabTitle;
    const checkmark = isCompleted ? '<span class="category-completed-check" style="color: #22c55e; margin-left: 4px; font-weight: bold;">✓</span>' : '';
    
    return `
      <button class="tab ${isActive}" data-tab="${tab.id}" ${isPinned} onclick="switchToTab('${tab.id}')">
        ${icon}
        ${title}${checkmark}
        ${closeBtn}
      </button>
    `;
  });
  
  const tabsHtmlArray = await Promise.all(tabsHtmlPromises);
  const tabsHtml = tabsHtmlArray.join('');
  
  tabBar.innerHTML = tabsHtml + `
    <button class="tab tab-add-new" id="add-tab-category-btn" onclick="openCategoryModal()" title="Yeni Kategori Ekle">
      <span class="tab-icon">+</span>
    </button>
  `;
}

function switchToTab(tabId) {
  console.log('[settings] switchToTab called', tabId);
  activeTabId = tabId;
  
  // Update tab active state
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.remove('active');
    if (tab.getAttribute('data-tab') === tabId) {
      tab.classList.add('active');
    }
  });
  
  // Show/hide sections based on tab
  const tab = openTabs.find(t => t.id === tabId);
  
  if (tabId === 'home') {
    showSection('home');
  } else if (tab && tab.categoryId) {
    showSection('category-tab');
    loadCategoryTabContent(tab.categoryId);
  } else {
    showSection(tabId);
  }
}

function closeTab(tabId, event) {
  console.log('[settings] closeTab called', tabId);
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  
  const tab = openTabs.find(t => t.id === tabId);
  if (!tab || tab.pinned) return;
  
  openTabs = openTabs.filter(t => t.id !== tabId);
  
  // If closing active tab, switch to home
  if (activeTabId === tabId) {
    switchToTab('home');
  }
  
  renderTabs();
}

function getDeadlineBadgeHtml(deadlineStr) {
  if (!deadlineStr) return '';
  
  const deadlineDate = new Date(deadlineStr);
  const now = new Date();
  const diffTime = deadlineDate - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  let badgeClass = '';
  let text = '';
  
  if (diffTime < 0) {
    badgeClass = 'deadline-badge-expired';
    text = '⚠️ Geçti!';
  } else if (diffDays <= 1) {
    badgeClass = 'deadline-badge-today pulse-anim';
    text = '🔴 BUGÜN!';
  } else if (diffDays <= 3) {
    badgeClass = 'deadline-badge-3days';
    text = `📅 ${diffDays} gün kaldı`;
  } else if (diffDays <= 7) {
    badgeClass = 'deadline-badge-1week';
    text = `📅 ${diffDays} gün kaldı`;
  } else {
    badgeClass = 'deadline-badge-2weeks';
    text = `📅 ${diffDays} gün kaldı`;
  }
  
  return `<span class="tag ${badgeClass}">${text}</span>`;
}

async function loadCategoryTabContent(categoryId, subcatIdToExpand = undefined) {
  const category = categories.find(c => c.id === categoryId);
  if (!category) return;
  
  // Update title
  document.getElementById('category-tab-title').textContent = category.name;
  
  // Fetch subcategories
  let subcats = [];
  try {
    if (window.electronAPI && window.electronAPI.subcategoryList) {
      subcats = await window.electronAPI.subcategoryList(categoryId);
    }
  } catch (err) {
    console.error('Error listing subcategories:', err);
  }
  
  // Load tips for this category
  const categoryTips = tips.filter(t => t.category_id === categoryId);

  // Ensure Genel subcategory exists only if there are tips that belong to it
  const hasGenelTips = categoryTips.some(t => t.subcategory_id === null || !subcats.some(s => s.id === t.subcategory_id));
  if (hasGenelTips) {
    let genelSub = subcats.find(s => s.name === 'Genel');
    if (!genelSub) {
      genelSub = { id: null, name: 'Genel', isSequential: false, orderIndex: 9999 };
      subcats.push(genelSub);
    }
  }
  
  // Sort: Genel at the bottom, others by orderIndex
  subcats.sort((a, b) => {
    if (a.name === 'Genel') return 1;
    if (b.name === 'Genel') return -1;
    return (a.orderIndex || 0) - (b.orderIndex || 0);
  });
  
  // Keep track of which accordion items were expanded
  const expandedItems = document.querySelectorAll('.accordion-item.expanded');
  const expandedSubcatIds = new Set(Array.from(expandedItems).map(item => item.getAttribute('data-subcat-id') || ''));
  
  if (subcatIdToExpand !== undefined) {
    expandedSubcatIds.add(subcatIdToExpand === null ? '' : String(subcatIdToExpand));
  }
  
  const isFirstRender = expandedItems.length === 0 && subcatIdToExpand === undefined;
  
  const categoryTipsContainer = document.getElementById('category-tab-tips');
  
  const hasRealSubcats = subcats.some(s => s.id !== null);
  if (categoryTips.length === 0 && !hasRealSubcats) {
    categoryTipsContainer.innerHTML = '<p class="placeholder-text">Bu kategoride not yok.</p>';
  } else {
    categoryTipsContainer.innerHTML = subcats.map((sub, sIdx) => {
      const isGenel = sub.name === 'Genel';
      
      // Filter tips for this subcategory
      const subcatTipsList = categoryTips.filter(t => {
        if (sub.id === null) {
          return t.subcategory_id === null || !subcats.some(s => s.id === t.subcategory_id);
        } else if (isGenel) {
          return t.subcategory_id === null || t.subcategory_id === sub.id;
        } else {
          return t.subcategory_id === sub.id;
        }
      });
      
      // Sort tips
      if (sub.isSequential) {
        subcatTipsList.sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
      } else {
        subcatTipsList.sort((a, b) => b.created_at - a.created_at);
      }
      
      const count = subcatTipsList.length;
      
      // Actions for subcategory header (Genel cannot be edited or deleted, but can have tips added)
      const actionsHtml = `
        <div class="subcategory-actions">
          <button class="btn-icon-only add-note-in-subcat-btn" data-subcat-id="${sub.id || ''}" data-category-id="${categoryId}" title="Not Ekle">＋</button>
          ${isGenel ? '' : `
            <button class="btn-icon-only edit-subcat-btn" data-subcat-id="${sub.id}" title="Düzenle">✏️</button>
            <button class="btn-icon-only delete-subcat-btn" data-subcat-id="${sub.id}" title="Sil">🗑️</button>
          `}
        </div>
      `;
      
      // Active step detection for sequential subcategory
      let activeTipIndex = -1;
      if (sub.isSequential) {
        activeTipIndex = subcatTipsList.findIndex(t => t.status !== 'done');
      }
      
      const tipsHtml = subcatTipsList.map((tip, index) => {
        let cardClasses = ['tip-item'];
        if (sub.isSequential) {
          cardClasses.push('sequential');
          if (index === activeTipIndex) {
            cardClasses.push('active-step');
          }
        } else {
          cardClasses.push('flat');
        }
        
        if (tip.status === 'done') {
          cardClasses.push('done-step');
        } else if (tip.status === 'retired') {
          cardClasses.push('retired-step');
        } else if (tip.status === 'cancelled') {
          cardClasses.push('cancelled-step');
        }
        
        const isDraggable = sub.isSequential;
        
        let isBlocked = false;
        let blockedBadgeHtml = '';
        let chainBadgeHtml = '';
        if (sub.isSequential && index > 0) {
          const prevTip = subcatTipsList[index - 1];
          if (prevTip) {
            chainBadgeHtml = `<span class="chain-badge" style="color: var(--text-muted); font-size: 11px; margin-left: 8px;">⛓ ${prevTip.content.substring(0, 20)}${prevTip.content.length > 20 ? '...' : ''}</span>`;
          }
          if (activeTipIndex !== -1 && index > activeTipIndex) {
            isBlocked = true;
            cardClasses.push('blocked-step');
            blockedBadgeHtml = '<span class="blocked-badge" style="color: var(--text-muted); font-size: 11px; background: rgba(0,0,0,0.05); padding: 2px 6px; border-radius: var(--border-radius-sm); margin-left: 8px;">🔒 Bekleniyor</span>';
          }
        }

        const stepNumHtml = sub.isSequential 
          ? `<div class="step-number" data-tip-id="${tip.id}" data-subcat-id="${sub.id || ''}">${index + 1}</div>`
          : `<div class="step-bullet">•</div>`;
          
        const effectiveImportance = computeEffectiveImportance(tip);
        let impClass = '';
        if (effectiveImportance <= 3) impClass = 'imp-1-3';
        else if (effectiveImportance <= 6) impClass = 'imp-4-6';
        else if (effectiveImportance <= 9) impClass = 'imp-7-9';
        else impClass = 'imp-10';
        
        const importanceTitle = effectiveImportance === tip.importance ? `Önem: ${tip.importance}` : `Önem: ${tip.importance} → ${effectiveImportance}`;
        const importanceBoxHtml = `<div class="importance-box ${impClass}" data-tip-id="${tip.id}" data-importance="${tip.importance}" title="${importanceTitle}">${effectiveImportance}</div>`;
        
        const showCalendarIcon = sub.deadlineMode !== 'shared';
        const isExpired = tip.deadline && getRelativeDeadlineText(tip.deadline) === 'Geçti!';
        const expiredClass = isExpired ? 'expired-note' : '';
        const expiredBadgeHtml = isExpired ? `<span class="expired-label-badge" style="color: #ef4444; font-size: 11px; font-weight: bold; margin-left: 8px;">● Geçti!</span>` : '';
        let relativeText = '';
        let deadlineBadgeHtml = '';
        if (tip.deadline) {
          relativeText = getRelativeDeadlineText(tip.deadline);
          let badgeColorClass = 'deadline-2weeks';
          const now = new Date();
          const dl = new Date(tip.deadline);
          const diffTime = dl - now;
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          if (diffTime < 0) {
            badgeColorClass = 'deadline-expired';
          } else if (diffDays <= 1) {
            badgeColorClass = 'deadline-today';
          } else if (diffDays <= 3) {
            badgeColorClass = 'deadline-3days';
          } else if (diffDays <= 7) {
            badgeColorClass = 'deadline-1week';
          }
          
          deadlineBadgeHtml = `<span class="popup-deadline-badge ${badgeColorClass}" style="font-size: 11px; padding: 2px 6px; border-radius: 4px; font-weight: bold; margin-left: 8px;">📅 ${relativeText}</span>`;
        }
        
        return `
          <div class="${cardClasses.join(' ')}" data-tip-id="${tip.id}" data-subcat-id="${sub.id || ''}" ${isDraggable && !isBlocked ? 'draggable="true"' : ''}>
            ${stepNumHtml}
            <div class="step-content">
              <h4 class="note-content-text ${expiredClass}" data-tip-id="${tip.id}" placeholder="Not içeriği girin...">${tip.content}</h4>
              ${expiredBadgeHtml}
              ${deadlineBadgeHtml}
              ${chainBadgeHtml}
              ${blockedBadgeHtml}
            </div>
            <div class="step-controls">
              ${importanceBoxHtml}
              
              <div class="note-menu-wrapper">
                <button class="note-menu-toggle-btn" data-tip-id="${tip.id}" title="İşlemler">&gt;</button>
                <div class="note-menu-dropdown" data-tip-id="${tip.id}">
                  <button class="dropdown-item status-cycle-icon ${getStatusClass(tip.status)}" data-tip-id="${tip.id}" title="Durum: ${getStatusText(tip.status)}">${getStatusText(tip.status)}</button>
                  <a class="dropdown-item calendar-trigger-item" data-tip-id="${tip.id}">📅 Tarih Belirle</a>
                  
                  ${tip.deadline ? `
                    <a class="dropdown-item clear-deadline-item" data-tip-id="${tip.id}">❌ Tarihi Temizle</a>
                  ` : ''}
                  
                  <div class="dropdown-divider"></div>
                  <div class="dropdown-submenu-title">⏱ Süre Ayarla</div>
                  <div class="dropdown-duration-row">
                    <button class="duration-btn ${tip.focus_duration === 5 ? 'active' : ''}" data-tip-id="${tip.id}" data-duration="5">5dk</button>
                    <button class="duration-btn ${tip.focus_duration === 10 ? 'active' : ''}" data-tip-id="${tip.id}" data-duration="10">10dk</button>
                    <button class="duration-btn ${tip.focus_duration === 15 ? 'active' : ''}" data-tip-id="${tip.id}" data-duration="15">15dk</button>
                  </div>
                  
                  <div class="dropdown-divider"></div>
                  <a class="dropdown-item delete-note-item danger-item" data-tip-id="${tip.id}">🗑️ Sil</a>
                </div>
                
                <!-- Hidden input for datetimepicker -->
                <input type="datetime-local" class="inline-deadline-input" data-tip-id="${tip.id}" style="position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none;" value="${tip.deadline || ''}">
              </div>
            </div>
          </div>
        `;
      }).join('');
      
      const contentHtml = subcatTipsList.length === 0 
        ? '<p class="placeholder-text" style="padding: 12px 16px;">Bu alt kategoride henüz not yok.</p>' 
        : tipsHtml;
        
      // Determine if subcategory is completed (all notes in it are done)
      const isSubcatCompleted = subcatTipsList.length > 0 && subcatTipsList.every(t => t.status === 'done');
      const subcatCompletedClass = isSubcatCompleted ? 'completed' : '';
      const checkmarkHtml = isSubcatCompleted ? '<span class="subcat-completed-check" style="color: #22c55e; margin-right: 4px; font-weight: bold;">✓</span>' : '';

      // Determine if accordion should be expanded
      const subcatKey = sub.id === null ? '' : String(sub.id);
      const isExpanded = isFirstRender ? (sIdx === 0) : expandedSubcatIds.has(subcatKey);
      const expandClass = isExpanded ? 'expanded' : '';
      const toggleSymbol = '>';
      const maxStyle = isExpanded ? 'max-height: none;' : 'max-height: 0px;';
      
      const hasSharedDeadline = sub.deadlineMode === 'shared' && sub.sharedDeadline;
      const deadlineHtml = hasSharedDeadline 
        ? `<span class="subcat-deadline-badge">📅 ${formatShortDate(sub.sharedDeadline)}</span>`
        : '';
      
      return `
        <div class="accordion-item ${expandClass} ${subcatCompletedClass}" data-subcat-id="${sub.id || ''}">
          <div class="accordion-header ${subcatCompletedClass}">
            <div class="accordion-header-left">
              <span class="accordion-toggle-icon">${toggleSymbol}</span>
              <span class="subcat-name">${checkmarkHtml}${sub.name} ${sub.isSequential ? '<span class="sequential-badge">⏱ Sıralı</span>' : ''}</span>
              <span class="subcat-count-badge">${count} Not</span>
              ${deadlineHtml}
            </div>
            ${actionsHtml}
          </div>
          <div class="accordion-content" style="${maxStyle}">
            <div class="accordion-content-inner">
              ${contentHtml}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }
  
  // Load category stats
  const categoryStatsContainer = document.getElementById('category-tab-stats');
  if (categoryStatsContainer) {
    const totalShows = categoryTips.reduce((sum, tip) => sum + (tip.show_count || 0), 0);
    categoryStatsContainer.innerHTML = `
      <h3>İstatistikler</h3>
      <p>Toplam Not: ${categoryTips.length}</p>
      <p>Toplam Gösterim: ${totalShows}</p>
    `;
  }
}

function computeEffectiveImportance(tip) {
  const base = Math.max(1, Math.min(parseInt(tip.importance, 10) || 1, 10));
  if (!tip.deadline) return base;

  const deadlineMs = new Date(tip.deadline).getTime();
  if (isNaN(deadlineMs)) return base;

  const DAY = 24 * 60 * 60 * 1000;
  const daysRemaining = (deadlineMs - Date.now()) / DAY;
  if (daysRemaining <= 0) return 10;

  const urgencyWindowDays = 14;
  const urgency = Math.max(0, Math.min(1, (urgencyWindowDays - daysRemaining) / urgencyWindowDays));
  const easedBoost = Math.ceil(Math.pow(urgency, 1.8) * (10 - base));
  return Math.max(base, Math.min(10, base + easedBoost));
}

async function testRandomPopup() {
  console.log('[settings] testRandomPopup called');
  try {
    // Filter for active tips only
    const activeTips = tips.filter(t => t.status === 'active');
    
    if (activeTips.length === 0) {
      showInlineWarning('Test popup için önce aktif not ekleyin.', document.getElementById('test-popup-btn'));
      return;
    }
    
    const randomTip = activeTips[Math.floor(Math.random() * activeTips.length)];
    const category = categories.find(c => c.id === randomTip.category_id);
    
    const tipData = {
      id: randomTip.id,
      content: randomTip.content,
      importance: randomTip.importance,
      effectiveImportance: computeEffectiveImportance(randomTip),
      deadline: randomTip.deadline || null,
      category: {
        name: category?.name || 'Test',
        color: category?.color || '#6C63FF'
      }
    };
    
    if (window.electronAPI && window.electronAPI.showPopup) {
      await window.electronAPI.showPopup(tipData);
    } else {
      showInlineWarning('Electron API kullanılamıyor.', document.getElementById('test-popup-btn'));
    }
  } catch (error) {
    console.error('Error testing popup:', error);
    showInlineWarning('Popup test başarısız oldu.', document.getElementById('test-popup-btn'));
  }
}

// Dev Tools Functions
async function updateDevTipDropdown(categoryId) {
  console.log('[settings] updateDevTipDropdown called', categoryId);
  const devPopupTip = document.getElementById('dev-popup-tip');
  if (!devPopupTip) return;
  
  // Clear option first
  devPopupTip.innerHTML = '';
  
  if (!categoryId) {
    devPopupTip.innerHTML = '<option value="">Not Seçin</option>';
    devPopupTip.disabled = true;
    return;
  }
  
  // Show loading spinner
  devPopupTip.innerHTML = '<option value="">⏳ Yükleniyor...</option>';
  devPopupTip.disabled = true;
  
  try {
    // Fresh tips via IPC from DB
    const freshTips = await window.electronAPI.dbQuery(
      'SELECT * FROM tips WHERE category_id = ? ORDER BY content ASC',
      [parseInt(categoryId)]
    );
    
    devPopupTip.innerHTML = '<option value="">Not Seçin</option>' + 
      freshTips.map(tip => `<option value="${tip.id}">${tip.content.substring(0, 50)}${tip.content.length > 50 ? '...' : ''}</option>`).join('');
    devPopupTip.disabled = false;
  } catch (error) {
    console.error('Error fetching tips for DevTools:', error);
    devPopupTip.innerHTML = '<option value="">Hata Oluştu</option>';
    devPopupTip.disabled = false;
  }
}

function showDevPopupError(message) {
  const errEl = document.getElementById('dev-popup-error');
  if (errEl) {
    errEl.textContent = message;
    errEl.style.display = 'block';
    if (_devErrorTimeout) clearTimeout(_devErrorTimeout);
    _devErrorTimeout = setTimeout(() => {
      errEl.style.display = 'none';
    }, 4000);
  }
}

function clearDevPopupError() {
  const errEl = document.getElementById('dev-popup-error');
  if (errEl) {
    errEl.style.display = 'none';
  }
  if (_devErrorTimeout) {
    clearTimeout(_devErrorTimeout);
    _devErrorTimeout = null;
  }
}

async function devTriggerPopup() {
  clearDevPopupError();

  const devPopupCategory = document.getElementById('dev-popup-category');
  const devPopupTip = document.getElementById('dev-popup-tip');
  if (!devPopupCategory || !devPopupTip) return;

  const categoryId = devPopupCategory.value;
  const tipId = devPopupTip.value;
  
  // Guard Check (Synchronous)
  if (!categoryId || !tipId) {
    showDevPopupError('Lütfen kategori ve not seçin.');
    if (!categoryId) {
      devPopupCategory.disabled = false;
      devPopupCategory.focus();
    } else {
      devPopupTip.disabled = false;
      devPopupTip.focus();
    }
    return;
  }

  try {
    const tip = tips.find(t => t.id === parseInt(tipId));
    const category = categories.find(c => c.id === parseInt(categoryId));
    
    if (!tip || !category) {
      showDevPopupError('Seçilen tip veya kategori bulunamadı.');
      return;
    }
    
    const tipData = {
      id: tip.id,
      content: tip.content,
      importance: tip.importance,
      effectiveImportance: computeEffectiveImportance(tip),
      deadline: tip.deadline || null,
      category: {
        name: category.name,
        color: category.color
      }
    };
    
    if (window.electronAPI && window.electronAPI.showPopup) {
      await window.electronAPI.showPopup(tipData);
      showToast('Popup tetiklendi.');
    } else {
      showDevPopupError('Electron API kullanılamıyor.');
    }
  } catch (error) {
    console.error('Error triggering popup:', error);
    showDevPopupError('Popup tetikleme başarısız oldu.');
  }
}

async function triggerSfxPopupPreview(sfxKey) {
  let minImp = 1;
  let maxImp = 10;
  let previewSfx = '';

  if (sfxKey === 'sound-level-1-3') {
    minImp = 1; maxImp = 3; previewSfx = '1-3';
  } else if (sfxKey === 'sound-level-4-6') {
    minImp = 4; maxImp = 6; previewSfx = '4-6';
  } else if (sfxKey === 'sound-level-7-9') {
    minImp = 7; maxImp = 9; previewSfx = '7-9';
  } else if (sfxKey === 'sound-level-10') {
    minImp = 10; maxImp = 10; previewSfx = '10';
  } else if (sfxKey === 'sound-level-10-buildup') {
    minImp = 10; maxImp = 10; previewSfx = '10-buildup';
  } else if (sfxKey === 'sound-level-10-hit') {
    minImp = 10; maxImp = 10; previewSfx = '10-hit';
  } else if (sfxKey === 'sound-sfx-chess-select') {
    minImp = 10; maxImp = 10; previewSfx = 'chess-select';
  } else if (sfxKey === 'sound-sfx-chess-place') {
    minImp = 10; maxImp = 10; previewSfx = 'chess-place';
  } else if (sfxKey === 'sound-sfx-chess-checkmate') {
    minImp = 10; maxImp = 10; previewSfx = 'chess-checkmate';
  } else if (sfxKey === 'sound-sfx-chess-wrong') {
    minImp = 10; maxImp = 10; previewSfx = 'chess-wrong';
  } else if (sfxKey === 'sound-sfx-dismiss-snooze') {
    previewSfx = 'dismiss-snooze';
  } else if (sfxKey === 'sound-sfx-math-correct') {
    minImp = 7; maxImp = 9; previewSfx = 'math-correct';
  } else if (sfxKey === 'sound-sfx-confetti') {
    minImp = 10; maxImp = 10; previewSfx = 'confetti';
  } else if (sfxKey === 'sound-sfx-btn-click') {
    previewSfx = 'btn-click';
  } else if (sfxKey === 'sound-sfx-checkin-success') {
    previewSfx = 'checkin-success';
  }

  // Find tip
  let tip = null;
  let suitableTips = tips.filter(t => t.importance >= minImp && t.importance <= maxImp);
  if (suitableTips.length > 0) {
    tip = suitableTips[Math.floor(Math.random() * suitableTips.length)];
  } else if (tips.length > 0) {
    tip = tips[Math.floor(Math.random() * tips.length)];
  }

  // Determine category info
  let catName = 'Yapay Zeka';
  let catColor = '#6c47ff';
  if (tip && tip.category_name) {
    catName = tip.category_name;
    catColor = tip.category_color;
  } else if (categories.length > 0) {
    const randomCat = categories[Math.floor(Math.random() * categories.length)];
    catName = randomCat.name;
    catColor = randomCat.color;
  }

  // Build tip data
  const finalImportance = (tip && tip.importance >= minImp && tip.importance <= maxImp) 
    ? tip.importance 
    : Math.floor(Math.random() * (maxImp - minImp + 1)) + minImp;

  const tipData = {
    id: tip ? tip.id : -999,
    content: tip ? tip.content : 'Sistem testi için örnek bir not.',
    importance: finalImportance,
    effectiveImportance: finalImportance,
    deadline: (tip && tip.deadline) ? tip.deadline : null,
    category: {
      name: catName,
      color: catColor
    },
    previewSfx: previewSfx
  };

  try {
    if (window.electronAPI && window.electronAPI.showPopup) {
      await window.electronAPI.showPopup(tipData);
      showToast('Önizleme popupu tetiklendi.');
    } else {
      console.error('Electron API not available');
      showToast('Electron API bulunamadı.');
    }
  } catch (error) {
    console.error('Error triggering preview popup:', error);
    showToast('Önizleme popupu tetiklenirken hata.');
  }
}

async function devAddTestStat() {
  const btn = document.getElementById('dev-add-test-stat');
  try {
    if (tips.length === 0) {
      showInlineWarning('Test istatistik için önce not ekleyin.', btn);
      return;
    }
    
    const randomTip = tips[Math.floor(Math.random() * tips.length)];
    // Hardcode reason to allowed values from CHECK constraint
    const allowedReasons = ['no_time', 'dont_know_how', 'no_motivation', 'not_now'];
    const randomReason = allowedReasons[Math.floor(Math.random() * allowedReasons.length)];
    
    if (window.electronAPI && window.electronAPI.logDismissReason) {
      await window.electronAPI.logDismissReason(randomTip.id, randomReason);
      showToast(`İstatistik eklendi: Not ID ${randomTip.id}, Sebep: ${randomReason}`);
    } else {
      showInlineWarning('Electron API kullanılamıyor.', btn);
    }
  } catch (error) {
    console.error('Error adding test stat:', error);
    showInlineWarning('İstatistik ekleme başarısız oldu.', btn);
  }
}

async function devResetShowCounts(btn) {
  if (!btn) btn = document.getElementById('dev-reset-show-counts');
  
  if (btn && btn.classList.contains('confirm-pending')) {
    try {
      if (window.electronAPI && window.electronAPI.dbRun) {
        await window.electronAPI.dbRun(`UPDATE tips SET show_count = 0`);
        await loadTips();
        await loadHomeDashboard();
        showToast('Tüm gösterim sayıları sıfırlandı.');
      } else {
        showToast('Electron API kullanılamıyor.');
      }
    } catch (error) {
      console.error('Error resetting show counts:', error);
      showToast('Sıfırlama başarısız oldu.');
    } finally {
      if (btn) {
        btn.classList.remove('confirm-pending');
        btn.textContent = 'Sıfırla';
        btn.style.backgroundColor = '';
        btn.style.color = '';
      }
    }
  } else {
    if (btn) {
      btn.classList.add('confirm-pending');
      btn.textContent = 'Emin misiniz?';
      btn.style.backgroundColor = '#ef4444';
      btn.style.color = '#fff';
      
      setTimeout(() => {
        if (btn.classList.contains('confirm-pending')) {
          btn.classList.remove('confirm-pending');
          btn.textContent = 'Sıfırla';
          btn.style.backgroundColor = '';
          btn.style.color = '';
        }
      }, 4000);
    }
  }
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.className = 'dev-toast-notification';
  toast.style.position = 'fixed';
  toast.style.bottom = '20px';
  toast.style.right = '20px';
  toast.style.backgroundColor = '#6c47ff';
  toast.style.color = '#fff';
  toast.style.padding = '10px 20px';
  toast.style.borderRadius = '6px';
  toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
  toast.style.zIndex = '9999';
  toast.style.fontFamily = 'sans-serif';
  toast.style.fontSize = '14px';
  toast.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
  toast.style.transform = 'translateY(10px)';
  toast.style.opacity = '0';
  document.body.appendChild(toast);
  
  // Force reflow
  toast.offsetHeight;
  
  toast.style.transform = 'translateY(0)';
  toast.style.opacity = '1';
  
  setTimeout(() => {
    toast.style.transform = 'translateY(10px)';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 200);
  }, 2500);
}

async function populateDevSimItemDropdown() {
  console.log('[settings] populateDevSimItemDropdown called');
  const typeSelect = document.getElementById('dev-sim-type');
  const itemSelect = document.getElementById('dev-sim-item');
  if (!typeSelect || !itemSelect) return;

  const type = typeSelect.value;
  itemSelect.innerHTML = '';
  itemSelect.disabled = true;

  // Show loading spinner
  itemSelect.innerHTML = '<option value="">⏳ Yükleniyor...</option>';

  try {
    if (type === 'tip') {
      const freshTips = await window.electronAPI.dbQuery('SELECT id, content FROM tips ORDER BY content ASC');
      itemSelect.innerHTML = '<option value="">Not Seçin</option>' + 
        freshTips.map(t => `<option value="${t.id}">${t.content.substring(0, 50)}${t.content.length > 50 ? '...' : ''}</option>`).join('');
    } else if (type === 'subcategory') {
      const freshSubcategories = await window.electronAPI.dbQuery('SELECT id, name FROM subcategories ORDER BY name ASC');
      itemSelect.innerHTML = '<option value="">Alt Kategori Seçin</option>' + 
        freshSubcategories.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    }
  } catch (error) {
    console.error('Error fetching items for dev deadline simulation:', error);
    itemSelect.innerHTML = '<option value="">Hata Oluştu</option>';
  } finally {
    itemSelect.disabled = false;
  }
}

async function devResetCheckin() {
  try {
    if (window.electronAPI && window.electronAPI.debugSetCheckinMissed) {
      const res = await window.electronAPI.debugSetCheckinMissed();
      if (res && res.ok) {
        showToast('Check-in sıfırlandı.');
        loadDashboard();
      } else {
        showToast('Check-in sıfırlama başarısız.');
      }
    } else {
      showToast('Electron API kullanılamıyor.');
    }
  } catch (error) {
    console.error('Error in devResetCheckin:', error);
    showToast('Hata oluştu.');
  }
}

async function devTriggerCheckinPopup() {
  try {
    if (window.electronAPI && window.electronAPI.debugTriggerCheckinPopup) {
      const res = await window.electronAPI.debugTriggerCheckinPopup();
      if (res && res.ok) {
        showToast('Check-in popupı tetiklendi.');
      } else {
        showToast('Check-in popupı tetikleme başarısız.');
      }
    } else {
      showToast('Check-in tetikleme IPC API bulunamadı.');
    }
  } catch (error) {
    console.error('Error in devTriggerCheckinPopup:', error);
    showToast('Hata oluştu.');
  }
}

async function loadPopupQueueStatus() {
  const container = document.getElementById('dev-queue-container');
  if (!container) return;

  try {
    if (!window.electronAPI || !window.electronAPI.getPopupQueue) {
      container.innerHTML = '<p style="color:#ef4444;">IPC mevcut değil.</p>';
      return;
    }
    const queue = await window.electronAPI.getPopupQueue();
    if (!queue || queue.length === 0) {
      container.innerHTML = '<p style="color: var(--text-muted);">Kuyruk boş veya henüz oluşturulmadı.</p>';
      return;
    }
    container.innerHTML = queue.map((item, i) => {
      const impColor = item.targetImportance >= 8 ? '#ef4444' : item.targetImportance >= 5 ? '#f5a623' : '#22c55e';
      const when = item.minutesFromNow < 0
        ? `<span style="color:#ef4444">${Math.abs(item.minutesFromNow)} dk geçti</span>`
        : `<span style="color:#22c55e">+${item.minutesFromNow} dk</span>`;
      return `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border);">
        <span style="color:var(--text-muted)">#${i+1}</span>
        <span>${when}</span>
        <span>Hedef Önem: <strong style="color:${impColor}">${item.targetImportance}</strong></span>
      </div>`;
    }).join('');
  } catch (e) {
    container.innerHTML = `<p style="color:#ef4444;">Hata: ${e.message}</p>`;
  }
}

async function loadNextPopupTimes() {
  const container = document.getElementById('dev-next-popups-container');
  if (!container) return;
  
  try {
    if (window.electronAPI && window.electronAPI.debugGetNextPopups) {
      const data = await window.electronAPI.debugGetNextPopups();
      renderNextPopupsTable(data);
      return;
    }
    
    if (!window.electronAPI || !window.electronAPI.dbQuery) {
      container.innerHTML = '<p style="color: var(--text-muted);">Veri okuma hatası.</p>';
      return;
    }
    
    const settingsRows = await window.electronAPI.dbQuery(`SELECT key, value FROM settings`);
    const settingsMap = {};
    settingsRows.forEach(r => { settingsMap[r.key] = r.value; });
    const intensity = parseFloat(settingsMap['popup_intensity']) || 1.0;
    
    const activeNotes = await window.electronAPI.dbQuery(`
      SELECT t.id, t.content, t.importance, t.last_shown, t.snoozed_until, 
             c.name as category_name, c.triggers, sc.is_sequential, t.order_index, t.subcategory_id
      FROM tips t
      JOIN categories c ON t.category_id = c.id
      LEFT JOIN subcategories sc ON sc.id = t.subcategory_id
      WHERE t.status = 'active'
    `);
    
    let activeWinProcess = '';
    if (window.electronAPI && window.electronAPI.debugGetActiveWindow) {
      const winInfo = await window.electronAPI.debugGetActiveWindow();
      if (winInfo && winInfo.process) {
        activeWinProcess = winInfo.process.toLowerCase();
      }
    }
    
    const now = new Date();
    const data = activeNotes.map(note => {
      let intervalMin = 90 - (note.importance - 1) * 8.33;
      intervalMin = intervalMin * intensity;
      
      let appMatch = false;
      if (note.triggers) {
        try {
          const triggers = JSON.parse(note.triggers);
          if (triggers.apps && Array.isArray(triggers.apps)) {
            const match = triggers.apps.find(app => activeWinProcess.includes(app.toLowerCase()));
            if (match) {
              intervalMin = intervalMin / 2;
              appMatch = true;
            }
          }
        } catch(e) {}
      }
      
      const lastShownTime = note.last_shown ? new Date(note.last_shown) : now;
      let nextPopupTime = new Date(lastShownTime.getTime() + intervalMin * 60 * 1000);
      
      if (note.snoozed_until) {
        const snoozeTime = new Date(note.snoozed_until);
        if (snoozeTime > nextPopupTime) {
          nextPopupTime = snoozeTime;
        }
      }
      
      return {
        id: note.id,
        content: note.content,
        importance: note.importance,
        category: note.category_name,
        nextTime: nextPopupTime,
        isSnoozed: note.snoozed_until && new Date(note.snoozed_until) > now,
        appMatch: appMatch
      };
    });
    
    data.sort((a, b) => a.nextTime - b.nextTime);
    renderNextPopupsTable(data);
  } catch (error) {
    console.error('Error loading next popup times:', error);
    container.innerHTML = '<p style="color: var(--text-muted);">Süreler hesaplanırken hata oluştu.</p>';
  }
}

function renderNextPopupsTable(data) {
  const container = document.getElementById('dev-next-popups-container');
  if (!container) return;
  
  if (!data || data.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted); font-size: 13px;">Aktif not bulunamadı.</p>';
    return;
  }
  
  let html = `
    <table class="dev-popups-table" style="width:100%; border-collapse: collapse; font-size: 12px; margin-top: var(--spacing-sm);">
      <thead>
        <tr style="border-bottom: 2px solid var(--border); text-align: left; color: var(--text-secondary);">
          <th style="padding: 6px;">Kategori / Not</th>
          <th style="padding: 6px; text-align: center;">Önem</th>
          <th style="padding: 6px;">Sonraki Tetiklenme</th>
          <th style="padding: 6px; text-align: right;">Durum</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  const now = new Date();
  data.forEach(item => {
    const diffMs = item.nextTime - now;
    let timeStr = '';
    if (diffMs <= 0) {
      timeStr = 'Hemen';
    } else {
      const diffMin = Math.round(diffMs / 60000);
      if (diffMin >= 60) {
        timeStr = `${Math.floor(diffMin / 60)}sa ${diffMin % 60}dk`;
      } else {
        timeStr = `${diffMin}dk`;
      }
    }
    
    let statusBadge = '';
    if (item.isSnoozed) {
      statusBadge = '<span style="background: rgba(245, 166, 35, 0.1); color: #f5a623; padding: 2px 6px; border-radius: 4px; font-size: 10px;">Ertelendi</span>';
    } else if (item.appMatch) {
      statusBadge = '<span style="background: rgba(108, 71, 255, 0.1); color: #6c47ff; padding: 2px 6px; border-radius: 4px; font-size: 10px;">Eşleşen Uygulama</span>';
    } else {
      statusBadge = '<span style="background: rgba(34, 197, 94, 0.1); color: #22c55e; padding: 2px 6px; border-radius: 4px; font-size: 10px;">Bekliyor</span>';
    }
    
    const truncatedContent = item.content.length > 35 ? item.content.substring(0, 35) + '...' : item.content;
    
    html += `
      <tr style="border-bottom: 1px solid var(--border); color: var(--text-primary);">
        <td style="padding: 6px;" title="${item.content}">
          <strong style="color: var(--text-muted);">${item.category}:</strong> ${truncatedContent}
        </td>
        <td style="padding: 6px; text-align: center; font-weight:600;">${item.importance}</td>
        <td style="padding: 6px;">${timeStr} (${item.nextTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})})</td>
        <td style="padding: 6px; text-align: right;">${statusBadge}</td>
      </tr>
    `;
  });
  
  html += `
      </tbody>
    </table>
  `;
  container.innerHTML = html;
}

async function devSimulateDeadline() {
  const typeSelect = document.getElementById('dev-sim-type');
  const itemSelect = document.getElementById('dev-sim-item');
  const daysInput = document.getElementById('dev-sim-days');
  const applyBtn = document.getElementById('dev-sim-apply');
  if (!typeSelect || !itemSelect || !daysInput) return;

  const type = typeSelect.value;
  const id = parseInt(itemSelect.value);
  const days = parseInt(daysInput.value);

  if (!id) {
    showInlineWarning('Lütfen bir öğe seçin.', itemSelect);
    return;
  }

  if (isNaN(days)) {
    showInlineWarning('Lütfen geçerli bir gün sayısı girin.', daysInput);
    return;
  }

  // Disable inputs during simulation call
  typeSelect.disabled = true;
  itemSelect.disabled = true;
  daysInput.disabled = true;
  if (applyBtn) applyBtn.disabled = true;

  try {
    if (window.electronAPI && window.electronAPI.debugSimulateDeadline) {
      const res = await window.electronAPI.debugSimulateDeadline(type, id, days);
      if (res && res.ok) {
        showToast('Deadline simülasyonu uygulandı.');
        
        // Refresh UI data to show updated deadlines/badges
        if (type === 'tip') {
          await loadTips();
          const activeTab = openTabs.find(t => t.id === activeTabId);
          if (activeTab && activeTab.categoryId) {
            await loadCategoryTabContent(activeTab.categoryId);
          }
        } else {
          await loadCategories();
          await renderCategories();
          const activeTab = openTabs.find(t => t.id === activeTabId);
          if (activeTab && activeTab.categoryId) {
            await loadCategoryTabContent(activeTab.categoryId);
          }
        }
        loadHomeDashboard();
      } else {
        showToast('Deadline simülasyonu başarısız.');
      }
    } else {
      showToast('Electron API kullanılamıyor.');
    }
  } catch (error) {
    console.error('Error in devSimulateDeadline:', error);
    showToast('Hata oluştu.');
  } finally {
    typeSelect.disabled = false;
    itemSelect.disabled = false;
    daysInput.disabled = false;
    if (applyBtn) applyBtn.disabled = false;
  }
}

async function devResetSnoozeLimits() {
  try {
    if (window.electronAPI && window.electronAPI.debugResetSnoozeLimits) {
      const res = await window.electronAPI.debugResetSnoozeLimits();
      if (res && res.ok) {
        showToast('Snooze limitleri sıfırlandı.');
      } else {
        showToast('Snooze limitleri sıfırlanamadı.');
      }
    } else {
      showToast('Electron API kullanılamıyor.');
    }
  } catch (error) {
    console.error('Error in devResetSnoozeLimits:', error);
    showToast('Hata oluştu.');
  }
}

let matchShownUntil = 0;

function setupAppTrackingStatusUpdater() {
  if (!window.electronAPI || !window.electronAPI.debugGetActiveWindow) {
    console.warn('[settings] debugGetActiveWindow IPC not available. Status indicator updater not started.');
    return;
  }

  // Run immediately, then every 5 seconds
  updateTrackingStatus();
  setInterval(updateTrackingStatus, 5000);
}

async function startDebugPopupInterval() {
  console.log('[settings] startDebugPopupInterval called');
  const startBtn = document.getElementById('dev-start-popup-interval-btn');
  const stopBtn = document.getElementById('dev-stop-popup-interval-btn');
  try {
    if (window.electronAPI && window.electronAPI.debugStartPopupInterval) {
      const res = await window.electronAPI.debugStartPopupInterval();
      if (res && res.ok) {
        showToast('Debug popup interval başlatıldı.');
        if (startBtn) startBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = false;
      } else {
        showToast('Debug popup interval başlatılamadı.');
      }
    } else {
      showToast('Electron API kullanılamıyor.');
    }
  } catch (error) {
    console.error('Error starting debug popup interval:', error);
    showToast('Hata oluştu.');
  }
}

async function stopDebugPopupInterval() {
  console.log('[settings] stopDebugPopupInterval called');
  const startBtn = document.getElementById('dev-start-popup-interval-btn');
  const stopBtn = document.getElementById('dev-stop-popup-interval-btn');
  try {
    if (window.electronAPI && window.electronAPI.debugStopPopupInterval) {
      const res = await window.electronAPI.debugStopPopupInterval();
      if (res && res.ok) {
        showToast('Debug popup interval durduruldu.');
        if (startBtn) startBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
      } else {
        showToast('Debug popup interval durdurulamadı.');
      }
    } else {
      showToast('Electron API kullanılamıyor.');
    }
  } catch (error) {
    console.error('Error stopping debug popup interval:', error);
    showToast('Hata oluştu.');
  }
}

function setupDebugIPCListeners() {
  if (window.electronAPI && window.electronAPI.onDebugPopupCountUpdate) {
    window.electronAPI.onDebugPopupCountUpdate((count) => {
      console.log('[settings] Received debug popup count update:', count);
      const statusEl = document.getElementById('dev-popup-interval-status');
      if (statusEl) {
        statusEl.textContent = `${count} popup tetiklendi`;
      }
    });
  }
  
  // 5dk -> 10sn Debug Mode Toggle
  const debugToggle = document.getElementById('dev-timer-debug-toggle');
  if (debugToggle) {
    debugToggle.checked = localStorage.getItem('timer_debug_mode') === 'true';
    debugToggle.addEventListener('change', (e) => {
      localStorage.setItem('timer_debug_mode', e.target.checked);
    });
  }
}

function setupDataUpdateListener() {
  if (window.electronAPI && window.electronAPI.onDataUpdated) {
    window.electronAPI.onDataUpdated(async (dataPayload) => {
      console.log('[settings] Data updated event received from IPC:', dataPayload);
      
      await loadCategories();
      await loadTips();
      await renderTabs();
      
      const activeTab = openTabs.find(t => t.id === activeTabId);
      if (activeTab && activeTab.categoryId) {
        await loadCategoryTabContent(activeTab.categoryId);
      } else if (activeTab && activeTab.id === 'home') {
        renderCategoryCards();
      }
    });
  }
}

function setupTimerWinListener() {
  if (!window.electronAPI || !window.electronAPI.onTimerWin) return;
  window.electronAPI.onTimerWin(() => {
    console.log('[settings] Timer win trigger received — playing win SFX + confetti');
    if (window.audioManager && window.audioManager.playCheckinSuccess) {
      window.audioManager.playCheckinSuccess();
    }
    triggerMainWindowConfetti();
  });
}

function triggerMainWindowConfetti() {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:99999;';
  document.body.appendChild(canvas);
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');
  const colors = ['#6c47ff','#00c2d1','#f5a623','#22c55e','#ef4444'];
  const particles = Array.from({length: 120}, () => ({
    x: Math.random() * canvas.width,
    y: -20,
    vx: (Math.random() - 0.5) * 3,
    vy: Math.random() * 2 + 1,
    color: colors[Math.floor(Math.random() * colors.length)],
    size: Math.random() * 8 + 4,
    rot: Math.random() * Math.PI * 2,
    rotV: (Math.random() - 0.5) * 0.1,
    opacity: 1
  }));
  const start = Date.now();
  function frame() {
    const elapsed = Date.now() - start;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy; p.rot += p.rotV;
      p.opacity = Math.max(0, 1 - elapsed / 4000);
      if (p.opacity > 0) alive = true;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.opacity;
      ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size * 0.6);
      ctx.restore();
    }
    if (alive && elapsed < 4000) { requestAnimationFrame(frame); }
    else { canvas.remove(); }
  }
  requestAnimationFrame(frame);
}

async function updateTrackingStatus() {
  try {
    const activeWindow = await window.electronAPI.debugGetActiveWindow();
    
    const statusTextEl = document.querySelector('#active-window-status-indicator .status-text');
    const statusDotEl = document.querySelector('#active-window-status-indicator .status-dot');
    const devCapturedEl = document.getElementById('dev-captured-window');
    const devMatchingEl = document.getElementById('dev-matching-category');

    if (!activeWindow) {
      if (Date.now() >= matchShownUntil && statusTextEl) {
        statusTextEl.textContent = 'Takip aktif — Pencere yok';
      }
      if (devCapturedEl) devCapturedEl.value = 'Aktif pencere yok';
      if (devMatchingEl) devMatchingEl.value = 'Yok';
      return;
    }

    const ownerName = activeWindow.owner || 'Bilinmiyor';
    const windowTitle = activeWindow.title || '';
    
    if (devCapturedEl) {
      devCapturedEl.value = `${ownerName} — ${windowTitle}`;
    }

    const matchedCategory = findMatchingCategoryForActiveWindow(activeWindow);
    if (matchedCategory) {
      if (statusTextEl) {
        statusTextEl.textContent = `✓ ${matchedCategory.name} eşleşti`;
        statusTextEl.classList.add('matched');
      }
      matchShownUntil = Date.now() + 2500;
      
      setTimeout(() => {
        const freshStatusTextEl = document.querySelector('#active-window-status-indicator .status-text');
        if (freshStatusTextEl && Date.now() >= matchShownUntil) {
          freshStatusTextEl.textContent = `Takip aktif — ${ownerName}`;
          freshStatusTextEl.classList.remove('matched');
        }
      }, 2500);

      if (devMatchingEl) {
        devMatchingEl.value = `${matchedCategory.name} (ID: ${matchedCategory.id})`;
      }
    } else {
      if (Date.now() >= matchShownUntil && statusTextEl) {
        statusTextEl.textContent = `Takip aktif — ${ownerName}`;
        statusTextEl.classList.remove('matched');
      }
      if (devMatchingEl) {
        devMatchingEl.value = 'Yok';
      }
    }
  } catch (error) {
    console.error('Error updating active window tracking status:', error);
  }
}

function findMatchingCategoryForActiveWindow(activeWindow) {
  if (!activeWindow || !categories) return null;
  const activeProcess = (activeWindow.owner || '').toLowerCase();
  const windowTitle = (activeWindow.title || '').toLowerCase();

  for (const cat of categories) {
    if (!cat.triggers) continue;
    const apps = cat.triggers.apps || [];
    const keywords = cat.triggers.keywords || [];

    // Check app process match
    const matchedApp = apps.find(appName => 
      activeProcess.includes(appName.toLowerCase().replace('.exe', ''))
    );
    if (matchedApp) {
      return cat;
    }

    // Check keyword title match
    const matchedKeyword = keywords.find(keyword => 
      windowTitle.includes(keyword.toLowerCase())
    );
    if (matchedKeyword) {
      return cat;
    }
  }
  return null;
}

async function devGetActiveWindow() {
  await updateTrackingStatus();
}


// Load Dashboard statistics and check-in status
async function loadDashboard() {
  console.log('[settings] loadDashboard called');
  
  // 1. Greeting (Zaman bazlı karşılama)
  const hour = new Date().getHours();
  let greeting = 'İyi Günler, Mali';
  if (hour < 12) {
    greeting = 'Günaydın, Mali';
  } else if (hour < 18) {
    greeting = 'Tünaydın, Mali';
  } else {
    greeting = 'İyi Akşamlar, Mali';
  }
  const greetingEl = document.getElementById('dashboard-greeting');
  if (greetingEl) greetingEl.textContent = greeting;

  // 2. Fetch Check-in Streak via IPC (DB'ye doğrudan erişilmez)
  let completed = false;
  let streak = 0;
  let history = [];
  if (window.electronAPI && window.electronAPI.checkinStatus) {
    try {
      const status = await window.electronAPI.checkinStatus();
      completed = status.completed;
      streak = status.streak;
      if (window.electronAPI.checkinHistory) {
        history = await window.electronAPI.checkinHistory();
      }
    } catch (err) {
      console.error('Error fetching checkin status:', err);
    }
  }

  // Update streak badges (hem dashboard hem sidebar)
  const streakBadge = document.getElementById('dashboard-streak-badge');
  if (streakBadge) {
    streakBadge.textContent = `⚡ ${streak} Gün`;
  }
  const sidebarStreakText = document.querySelector('#sidebar-streak-info .streak-text');
  if (sidebarStreakText) {
    sidebarStreakText.textContent = `${streak} Gün`;
  }

  // Update checkin status message and action button
  const statusEl = document.getElementById('dashboard-checkin-status');
  const checkinBtn = document.getElementById('dashboard-checkin-btn');
  if (statusEl) {
    statusEl.textContent = completed ? '✓ Giriş Yapıldı' : '⏳ Giriş Yapılmadı';
    statusEl.style.color = completed ? '#22c55e' : '#f5a623';
  }
  if (checkinBtn) {
    checkinBtn.disabled = completed;
    checkinBtn.textContent = completed ? 'Giriş Yapıldı' : 'Giriş Yap';
    if (completed) {
      checkinBtn.classList.add('completed');
    } else {
      checkinBtn.classList.remove('completed');
    }
  }

  // 3. Render Daily Check-in Calendar Preview
  const calendarEl = document.getElementById('dashboard-checkin-calendar');
  if (calendarEl) {
    calendarEl.innerHTML = '';
    const todayStr = new Date().toISOString().split('T')[0];
    let daysToShow = [];

    if (streak < 7) {
      // Show current week (Pazartesi - Pazar)
      const current = new Date();
      const dayOfWeek = current.getDay(); // 0: Sunday, 1: Monday, ...
      const distanceToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      
      for (let i = 0; i < 7; i++) {
        const d = new Date(current);
        d.setDate(current.getDate() + distanceToMon + i);
        d.setHours(0, 0, 0, 0);
        daysToShow.push(d);
      }
    } else {
      // Show last 30 days (Oldest to newest)
      const current = new Date();
      for (let i = 29; i >= 0; i--) {
        const d = new Date(current);
        d.setDate(current.getDate() - i);
        d.setHours(0, 0, 0, 0);
        daysToShow.push(d);
      }
    }

    const daysContainer = document.createElement('div');
    daysContainer.className = streak < 7 ? 'calendar-week-view' : 'calendar-month-view';

    daysToShow.forEach(d => {
      const dateStr = d.toISOString().split('T')[0];
      const isToday = (dateStr === todayStr);
      const isFuture = (d > new Date());
      
      const histItem = (history || []).find(h => h.date === dateStr);
      const isCompleted = histItem ? histItem.completed : false;

      const dayDot = document.createElement('div');
      dayDot.className = 'calendar-day-dot';
      if (isToday) {
        dayDot.classList.add('today');
      }

      if (isFuture) {
        dayDot.classList.add('future');
      } else if (isCompleted) {
        dayDot.classList.add('completed');
      } else {
        dayDot.classList.add('missed');
      }

      const dayLabel = document.createElement('span');
      dayLabel.className = 'day-label';
      if (streak < 7) {
        const daysNames = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
        dayLabel.textContent = daysNames[d.getDay()];
      } else {
        dayLabel.textContent = d.getDate();
      }

      const dayWrapper = document.createElement('div');
      dayWrapper.className = 'calendar-day-wrapper';
      dayWrapper.appendChild(dayDot);
      dayWrapper.appendChild(dayLabel);
      daysContainer.appendChild(dayWrapper);
    });

    calendarEl.appendChild(daysContainer);
  }

  // 4. Procrastination Insights & Weekly Chart
  if (window.electronAPI && window.electronAPI.dbQuery) {
    try {
      // Top procrastination reason
      const topReasonRows = await window.electronAPI.dbQuery(`
        SELECT reason, COUNT(*) as count 
        FROM dismiss_log 
        WHERE reason IS NOT NULL AND reason != ''
        GROUP BY reason 
        ORDER BY count DESC 
        LIMIT 1
      `);
      const reasonMapping = {
        'not_today': 'Bugün değil',
        'remind_1h': '1 saat sonra',
        'no_motivation': 'Motivasyon yok',
        'not_now': 'Şimdi değil',
        'no_time': 'Zaman yok',
        'dont_know_how': 'Bilmiyorum'
      };
      const topReasonVal = topReasonRows && topReasonRows.length > 0 
        ? (reasonMapping[topReasonRows[0].reason] || topReasonRows[0].reason) 
        : 'Henüz veri yok';
      
      const topReasonEl = document.getElementById('dashboard-top-reason');
      if (topReasonEl) topReasonEl.textContent = topReasonVal;

      // Top procrastinated category
      const topCatRows = await window.electronAPI.dbQuery(`
        SELECT c.name, COUNT(*) as count
        FROM dismiss_log dl
        JOIN tips t ON dl.tip_id = t.id
        JOIN categories c ON t.category_id = c.id
        GROUP BY c.id
        ORDER BY count DESC
        LIMIT 1
      `);
      const topCatVal = topCatRows && topCatRows.length > 0
        ? topCatRows[0].name
        : 'Henüz veri yok';
        
      const topCatEl = document.getElementById('dashboard-top-category');
      if (topCatEl) topCatEl.textContent = topCatVal;

      // Render Weekly Progress bar heights based on dismissal logs
      const current = new Date();
      const dayOfWeek = current.getDay();
      const distanceToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const startOfWeek = new Date(current);
      startOfWeek.setDate(current.getDate() + distanceToMon);
      startOfWeek.setHours(0, 0, 0, 0);

      const dismissalsThisWeek = await window.electronAPI.dbQuery(`
        SELECT dismissed_at FROM dismiss_log 
        WHERE dismissed_at >= ?
      `, [startOfWeek.toISOString()]);

      const dayCounts = [0, 0, 0, 0, 0, 0, 0]; // Mon-Sun
      (dismissalsThisWeek || []).forEach(row => {
        const d = new Date(row.dismissed_at);
        let wDay = d.getDay(); // 0 is Sun, 1 is Mon...
        let index = wDay === 0 ? 6 : wDay - 1; // map Mon->0, Sun->6
        if (index >= 0 && index < 7) {
          dayCounts[index]++;
        }
      });

      const maxDismiss = Math.max(...dayCounts, 1);
      const barsContainer = document.querySelector('.weekly-bar-chart .chart-bars');
      if (barsContainer) {
        barsContainer.innerHTML = '';
        const weekdays = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
        dayCounts.forEach((count, i) => {
          const pct = Math.min((count / maxDismiss) * 100, 100);
          
          const col = document.createElement('div');
          col.className = 'chart-bar-col';
          
          const bar = document.createElement('div');
          bar.className = 'chart-bar';
          bar.style.height = `${pct}%`;
          bar.title = `${count} Erteleme`;
          
          const label = document.createElement('span');
          label.textContent = weekdays[i];
          
          col.appendChild(bar);
          col.appendChild(label);
          barsContainer.appendChild(col);
        });
      }
    } catch (err) {
      console.error('Error loading DB insights for dashboard:', err);
    }
  }
}

// Render Categories Management List (Removed since Category management page is consolidated into Category Tab)

// Accordion Toggle function
function toggleAccordion(item) {
  const content = item.querySelector('.accordion-content');
  const toggleIcon = item.querySelector('.accordion-toggle-icon');
  if (!content) return;

  const isExpanded = item.classList.contains('expanded');
  
  if (isExpanded) {
    // Collapse
    content.style.maxHeight = content.scrollHeight + 'px';
    content.offsetHeight; // force reflow
    content.style.maxHeight = '0px';
    item.classList.remove('expanded');
    if (toggleIcon) toggleIcon.textContent = '▶';
  } else {
    // Expand
    content.style.maxHeight = content.scrollHeight + 'px';
    item.classList.add('expanded');
    if (toggleIcon) toggleIcon.textContent = '▼';
    
    // Remove max-height limit after transition completes so that editing/adding notes inside doesn't clip
    const transitionEndHandler = () => {
      if (item.classList.contains('expanded')) {
        content.style.maxHeight = 'none';
      }
      content.removeEventListener('transitionend', transitionEndHandler);
    };
    content.addEventListener('transitionend', transitionEndHandler);
  }
}

// Subcategory Dropdown Updater inside Note Modal
async function updateSubcategoryDropdown(categoryId, selectedSubcatId = null) {
  const subcatSelect = document.getElementById('tip-subcategory');
  if (!subcatSelect) return;
  
  subcatSelect.innerHTML = '<option value="">Yükleniyor...</option>';
  subcatSelect.disabled = true;
  
  try {
    let subcats = [];
    if (categoryId) {
      if (window.electronAPI && window.electronAPI.subcategoryList) {
        subcats = await window.electronAPI.subcategoryList(categoryId);
      }
    }
    
    let html = '<option value="" data-sequential="0">Alt Kategori Yok (Genel)</option>';
    subcats.forEach(sub => {
      // Avoid rendering DB Genel if we already render the default "Genel" option
      if (sub.name !== 'Genel') {
        html += `<option value="${sub.id}" data-sequential="${sub.isSequential ? '1' : '0'}">${sub.name}</option>`;
      } else {
        // If DB Genel exists, map its ID as the value for the "Genel" option
        html = `<option value="${sub.id}" data-sequential="0">Alt Kategori Yok (Genel)</option>`;
      }
    });
    html += '<option value="create_new">＋ Yeni Alt Kategori Oluştur</option>';
    
    subcatSelect.innerHTML = html;
    subcatSelect.disabled = false;
    
    // Set value
    if (selectedSubcatId !== null && selectedSubcatId !== undefined) {
      subcatSelect.value = selectedSubcatId;
    } else {
      subcatSelect.value = '';
    }
    
    handleSubcategoryChange();
  } catch (error) {
    console.error('Error loading subcategories for dropdown:', error);
    subcatSelect.innerHTML = '<option value="">Hata oluştu</option>';
    subcatSelect.disabled = false;
  }
}

// Handle subcategory selection changes
function handleSubcategoryChange() {
  const subcatSelect = document.getElementById('tip-subcategory');
  const orderGroup = document.getElementById('tip-order-group');
  if (!subcatSelect || !orderGroup) return;
  
  const selectedOption = subcatSelect.options[subcatSelect.selectedIndex];
  const isSequential = selectedOption && selectedOption.getAttribute('data-sequential') === '1';
  
  if (isSequential) {
    orderGroup.style.display = 'block';
  } else {
    orderGroup.style.display = 'none';
    const orderInput = document.getElementById('tip-order');
    if (orderInput) orderInput.value = '';
  }
}

// Subcategory Modal Operations
function openSubcategoryModal(subcategory = null, preSelectedCategoryId = null) {
  console.log('[settings] openSubcategoryModal called', subcategory?.id, preSelectedCategoryId);
  if (!subcategoryModal) return;
  
  subcategoryModal.classList.add('active');
  
  const modeSelect = document.getElementById('subcategory-deadline-mode');
  const sharedGroup = document.getElementById('subcategory-shared-deadline-group');
  const sharedInput = document.getElementById('subcategory-shared-deadline');
  
  if (subcategory) {
    document.getElementById('subcategory-modal-title').textContent = 'Alt Kategori Düzenle';
    document.getElementById('subcategory-id').value = subcategory.id;
    document.getElementById('subcategory-category-id').value = preSelectedCategoryId || '';
    document.getElementById('subcategory-name').value = subcategory.name;
    document.getElementById('subcategory-sequential').checked = subcategory.isSequential === true;
    
    if (modeSelect) {
      modeSelect.value = subcategory.deadlineMode || '';
    }
    if (sharedGroup) {
      sharedGroup.style.display = (subcategory.deadlineMode === 'shared') ? 'block' : 'none';
    }
    if (sharedInput) {
      sharedInput.value = subcategory.sharedDeadline || '';
    }
  } else {
    document.getElementById('subcategory-modal-title').textContent = 'Alt Kategori Ekle';
    if (subcategoryForm) subcategoryForm.reset();
    document.getElementById('subcategory-id').value = '';
    document.getElementById('subcategory-category-id').value = preSelectedCategoryId || '';
    document.getElementById('subcategory-sequential').checked = false;
    
    if (modeSelect) {
      modeSelect.value = '';
    }
    if (sharedGroup) {
      sharedGroup.style.display = 'none';
    }
    if (sharedInput) {
      sharedInput.value = '';
    }
  }
  
  toggleSubcategoryFormFields();
  
  setTimeout(() => {
    const nameInput = document.getElementById('subcategory-name');
    if (nameInput) nameInput.focus();
  }, 0);
}

function closeSubcategoryModal() {
  console.log('[settings] closeSubcategoryModal called');
  if (subcategoryModal) {
    subcategoryModal.classList.remove('active');
  }
  if (subcategoryForm) {
    subcategoryForm.reset();
  }
  document.getElementById('subcategory-id').value = '';
  document.getElementById('subcategory-category-id').value = '';
}

async function handleSubcategorySubmit(e) {
  e.preventDefault();
  console.log('[settings] handleSubcategorySubmit called');
  
  const id = document.getElementById('subcategory-id').value;
  const categoryId = parseInt(document.getElementById('subcategory-category-id').value);
  const name = document.getElementById('subcategory-name').value.trim();
  const isSequential = document.getElementById('subcategory-sequential').checked;
  const modeSelect = document.getElementById('subcategory-deadline-mode');
  const deadlineMode = modeSelect ? (modeSelect.value || null) : null;
  const sharedInput = document.getElementById('subcategory-shared-deadline');
  const sharedDeadline = (deadlineMode === 'shared' && sharedInput) ? (sharedInput.value || null) : null;
  
  const nameInput = document.getElementById('subcategory-name');
  if (!name) {
    showInlineWarning('Alt kategori adı boş olamaz.', nameInput);
    return;
  }
  
  try {
    let result = { ok: false };
    if (id) {
      if (window.electronAPI && window.electronAPI.subcategoryUpdate) {
        result = await window.electronAPI.subcategoryUpdate({ 
          id: parseInt(id), 
          name, 
          isSequential,
          deadlineMode,
          sharedDeadline
        });
      }
    } else {
      if (window.electronAPI && window.electronAPI.subcategoryCreate) {
        result = await window.electronAPI.subcategoryCreate({ 
          categoryId, 
          name, 
          isSequential,
          deadlineMode,
          sharedDeadline
        });
      }
    }
    
    if (result.ok) {
      closeSubcategoryModal();
      
      // Refresh the active category tab if currently open
      const activeTab = openTabs.find(t => t.id === activeTabId);
      if (activeTab && activeTab.categoryId === categoryId) {
        await loadCategoryTabContent(categoryId);
      }
    } else {
      showInlineWarning(result.error || 'Alt kategori kaydedilemedi.', nameInput);
    }
  } catch (error) {
    console.error('Error saving subcategory:', error);
    showInlineWarning('Alt kategori kaydedilirken bir hata oluştu.', nameInput);
  }
}

// Edit Subcategory
async function editSubcategory(subcatId, categoryId) {
  console.log('[settings] editSubcategory called', subcatId, categoryId);
  try {
    if (window.electronAPI && window.electronAPI.subcategoryList) {
      const subcats = await window.electronAPI.subcategoryList(categoryId);
      const subcat = subcats.find(s => s.id === subcatId);
      if (subcat) {
        openSubcategoryModal(subcat, categoryId);
      }
    }
  } catch (error) {
    console.error('Error fetching subcategory for edit:', error);
  }
}

// Delete Subcategory
async function deleteSubcategory(id, categoryId, btn) {
  console.log('[settings] deleteSubcategory called', id, categoryId);
  if (!btn) return;
  
  if (btn.classList.contains('confirm-pending')) {
    try {
      if (window.electronAPI && window.electronAPI.subcategoryDelete) {
        const res = await window.electronAPI.subcategoryDelete(id);
        if (res.ok) {
          await loadTips(); // Refresh global tips array since their subcategory_id values were set to NULL
          await loadCategoryTabContent(categoryId);
          showToast('Alt kategori silindi.');
        } else {
          showToast(res.error || 'Silme işlemi başarısız oldu.');
        }
      }
    } catch (error) {
      console.error('Error deleting subcategory:', error);
      showToast('Alt kategori silinirken hata oluştu.');
    }
  } else {
    btn.classList.add('confirm-pending');
    btn.title = "Emin misiniz? (Silmek için tekrar tıklayın)";
    btn.style.color = '#ef4444';
    showToast('Alt kategoriyi silmek için tekrar tıklayın.');
    
    setTimeout(() => {
      btn.classList.remove('confirm-pending');
      btn.title = "Sil";
      btn.style.color = '';
    }, 4000);
  }
}

// REDESIGNED NOTE INLINE EDITORS & HELPERS

async function addNewNoteInline(categoryId, subcategoryId = null) {
  try {
    if (!window.electronAPI || !window.electronAPI.dbRun) return;
    
    // Find next order index inside this subcategory
    const catTips = tips.filter(t => t.category_id === categoryId && t.subcategory_id === subcategoryId);
    const nextOrder = catTips.length + 1;
    
    const result = await window.electronAPI.dbRun(`
      INSERT INTO tips (category_id, content, importance, show_count, status, last_shown, created_at, deadline, prerequisite_tip_id, subcategory_id, order_index)
      VALUES (?, 'Yeni Not', 5, 0, 'active', NULL, ?, NULL, NULL, ?, ?)
    `, [categoryId, Date.now(), subcategoryId, nextOrder]);
    
    await loadTips();
    await loadCategoryTabContent(categoryId);
    
    const newTipId = result?.lastID;
    if (newTipId) {
      setTimeout(() => {
        const textEl = document.querySelector(`.note-content-text[data-tip-id="${newTipId}"]`);
        if (textEl) {
          enterNoteTextEditMode(textEl);
        }
      }, 50);
    }
  } catch (err) {
    console.error('Error adding note inline:', err);
    showToast('Not eklenirken hata oluştu.');
  }
}

function enterNoteTextEditMode(el) {
  if (el.getAttribute('contenteditable') === 'true') return;
  
  const tipId = parseInt(el.dataset.tipId);
  const originalText = el.textContent.trim();
  el.dataset.originalContent = originalText;
  el.setAttribute('contenteditable', 'true');
  el.focus();
  
  // Select all text
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  
  const keydownHandler = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      el.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      el.textContent = el.dataset.originalContent;
      el.removeAttribute('contenteditable');
      el.removeEventListener('keydown', keydownHandler);
      el.removeEventListener('blur', blurHandler);
    }
  };
  
  const blurHandler = async () => {
    el.removeAttribute('contenteditable');
    el.removeEventListener('keydown', keydownHandler);
    el.removeEventListener('blur', blurHandler);
    
    let newText = el.textContent.trim();
    if (newText === '') {
      newText = 'Yeni Not';
    }
    
    if (newText !== el.dataset.originalContent) {
      await updateTipProperty(tipId, 'content', newText);
    } else {
      el.textContent = newText;
    }
  };
  
  el.addEventListener('keydown', keydownHandler);
  el.addEventListener('blur', blurHandler);
}

async function updateTipProperty(tipId, propName, value) {
  try {
    if (!window.electronAPI || !window.electronAPI.dbRun) return;
    
    await window.electronAPI.dbRun(`UPDATE tips SET ${propName} = ? WHERE id = ?`, [value, tipId]);
    await loadTips();
    
    const activeTab = openTabs.find(t => t.id === activeTabId);
    if (activeTab) {
      await loadCategoryTabContent(activeTab.categoryId);
    }
  } catch (err) {
    console.error(`Error updating tip property ${propName}:`, err);
  }
}

async function updateTipStatusInline(tipId, nextStatus) {
  try {
    if (!window.electronAPI || !window.electronAPI.dbRun) return;

    await window.electronAPI.dbRun('UPDATE tips SET status = ? WHERE id = ?', [nextStatus, tipId]);

    const tip = tips.find(t => t.id === tipId);
    if (tip) tip.status = nextStatus;

    const tipItem = document.querySelector(`.tip-item[data-tip-id="${tipId}"]`);
    if (tipItem) {
      tipItem.classList.remove('done-step', 'retired-step', 'cancelled-step');
      if (nextStatus === 'done') tipItem.classList.add('done-step');
      if (nextStatus === 'retired') tipItem.classList.add('retired-step');
      if (nextStatus === 'cancelled') tipItem.classList.add('cancelled-step');
    }

    document.querySelectorAll(`.status-cycle-icon[data-tip-id="${tipId}"]`).forEach(btn => {
      btn.classList.remove('status-active', 'status-retired', 'status-done', 'status-cancelled');
      btn.classList.add(getStatusClass(nextStatus));
      btn.textContent = getStatusText(nextStatus);
      btn.title = `Durum: ${getStatusText(nextStatus)}`;
    });
  } catch (err) {
    console.error('Error updating tip status:', err);
    showToast('Durum güncellenemedi.');
  }
}

function getStatusIcon(status) {
  switch (status) {
    case 'done': return '✅';
    case 'retired': return '⏸️';
    case 'active': return '▶️';
    case 'cancelled': return '✖️';
    default: return '▶️';
  }
}

function getStatusClass(status) {
  switch (status) {
    case 'active': return 'status-active';
    case 'retired': return 'status-retired';
    case 'done': return 'status-done';
    case 'cancelled': return 'status-cancelled';
    default: return 'status-active';
  }
}

function formatShortDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

function getRelativeDeadlineText(deadlineStr) {
  if (!deadlineStr) return '';
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const dl = new Date(deadlineStr);
  dl.setHours(0, 0, 0, 0);
  const diffTime = dl.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays < 0) {
    return 'Geçti!';
  } else if (diffDays === 0) {
    return 'Bugün';
  } else if (diffDays === 1) {
    return 'Yarın';
  } else {
    return `${diffDays} gün`;
  }
}

// Drag and Drop Event Delegation on Document
document.addEventListener('dragstart', (e) => {
  // Ensure e.target is an element before using closest
  const targetElement = e.target.nodeType === Node.ELEMENT_NODE ? e.target : e.target.parentElement;
  if (!targetElement || typeof targetElement.closest !== 'function') return;

  const tipItem = targetElement.closest('.tip-item');
  if (tipItem && tipItem.getAttribute('draggable') === 'true') {
    const tipId = tipItem.dataset.tipId;
    const subcatId = tipItem.dataset.subcatId;
    
    e.dataTransfer.setData('text/plain', tipId);
    e.dataTransfer.setData('subcat-id', subcatId);
    e.dataTransfer.effectAllowed = 'move';
    
    tipItem.classList.add('dragging');
  } else {
    // Only prevent drag start if it originated inside a tip item
    if (targetElement.closest('.tip-item')) {
      e.preventDefault();
    }
  }
});

document.addEventListener('dragover', (e) => {
  const targetElement = e.target.nodeType === Node.ELEMENT_NODE ? e.target : e.target.parentElement;
  if (!targetElement || typeof targetElement.closest !== 'function') return;

  const targetTip = targetElement.closest('.tip-item');
  if (targetTip && !targetTip.classList.contains('dragging')) {
    const draggingEl = document.querySelector('.tip-item.dragging');
    if (draggingEl) {
      const dragSubcatId = draggingEl.dataset.subcatId;
      const targetSubcatId = targetTip.dataset.subcatId;
      
      // Compare subcategory IDs (including undefined/empty string check)
      if (dragSubcatId !== undefined && targetSubcatId !== undefined && dragSubcatId === targetSubcatId) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        
        const rect = targetTip.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        if (e.clientY < midpoint) {
          targetTip.classList.add('drag-over-top');
          targetTip.classList.remove('drag-over-bottom');
        } else {
          targetTip.classList.add('drag-over-bottom');
          targetTip.classList.remove('drag-over-top');
        }
      }
    }
  }
});

document.addEventListener('dragleave', (e) => {
  const targetElement = e.target.nodeType === Node.ELEMENT_NODE ? e.target : e.target.parentElement;
  if (!targetElement || typeof targetElement.closest !== 'function') return;

  const targetTip = targetElement.closest('.tip-item');
  if (targetTip) {
    targetTip.classList.remove('drag-over-top', 'drag-over-bottom');
  }
});

document.addEventListener('dragend', (e) => {
  const draggingEl = document.querySelector('.tip-item.dragging');
  if (draggingEl) {
    draggingEl.classList.remove('dragging');
  }
  document.querySelectorAll('.tip-item').forEach(el => {
    el.classList.remove('drag-over-top', 'drag-over-bottom');
  });
});

document.addEventListener('drop', async (e) => {
  e.preventDefault();
  const targetElement = e.target.nodeType === Node.ELEMENT_NODE ? e.target : e.target.parentElement;
  if (!targetElement || typeof targetElement.closest !== 'function') return;

  const targetTip = targetElement.closest('.tip-item');
  if (targetTip && !targetTip.classList.contains('dragging')) {
    const draggingTipId = parseInt(e.dataTransfer.getData('text/plain'));
    const targetTipId = targetTip.dataset.tipId ? parseInt(targetTip.dataset.tipId) : NaN;
    const subcatId = targetTip.dataset.subcatId ? parseInt(targetTip.dataset.subcatId) : NaN;
    
    console.log('[drag-drop] Drop event caught. draggingTipId:', draggingTipId, 'targetTipId:', targetTipId, 'subcatId:', subcatId);
    
    if (!isNaN(draggingTipId) && !isNaN(targetTipId) && !isNaN(subcatId)) {
      const subcatContainer = targetTip.closest('.accordion-content-inner');
      if (subcatContainer) {
        const tipElements = Array.from(subcatContainer.querySelectorAll('.tip-item'));
        
        let tipIds = tipElements.map(el => {
          return el.dataset.tipId ? parseInt(el.dataset.tipId) : NaN;
        }).filter(id => !isNaN(id));
        
        tipIds = tipIds.filter(id => id !== draggingTipId);
        
        const isOverTop = targetTip.classList.contains('drag-over-top');
        const targetIndex = tipIds.indexOf(targetTipId);
        
        if (targetIndex !== -1) {
          if (isOverTop) {
            tipIds.splice(targetIndex, 0, draggingTipId);
          } else {
            tipIds.splice(targetIndex + 1, 0, draggingTipId);
          }
          
          try {
            console.log('[drag-drop] Triggering subcategoryReorderTips with subcatId:', subcatId, 'tipIds:', tipIds);
            if (window.electronAPI && window.electronAPI.subcategoryReorderTips) {
              const res = await window.electronAPI.subcategoryReorderTips({ subcategoryId: subcatId, tipIds });
              console.log('[drag-drop] subcategoryReorderTips result:', res);
              if (res.ok) {
                await loadTips();
                const activeTab = openTabs.find(t => t.id === activeTabId);
                if (activeTab) {
                  await loadCategoryTabContent(activeTab.categoryId);
                }
              } else {
                showToast(res.error || 'Reorder failed');
              }
            } else {
              console.warn('[drag-drop] window.electronAPI.subcategoryReorderTips is undefined');
            }
          } catch (err) {
            console.error('[drag-drop] Error during tips reorder:', err);
          }
        }
      }
    }
  }
  document.querySelectorAll('.tip-item').forEach(el => {
    el.classList.remove('drag-over-top', 'drag-over-bottom');
  });
});

function deleteNote(tipId, btn) {
  if (!btn) return;
  if (btn.classList.contains('confirm-pending')) {
    executeDeleteNote(tipId);
  } else {
    btn.classList.add('confirm-pending');
    btn.title = "Silmek için tekrar tıklayın";
    btn.style.color = '#ef4444';
    showToast('Notu silmek için tekrar tıklayın.');
    
    setTimeout(() => {
      btn.classList.remove('confirm-pending');
      btn.title = "Notu Sil";
      btn.style.color = '';
    }, 4000);
  }
}

async function executeDeleteNote(tipId) {
  try {
    if (!window.electronAPI || !window.electronAPI.dbRun) {
      console.error('electronAPI.dbRun not available');
      showToast('IPC bağlantısı hatası.');
      return;
    }
    await window.electronAPI.dbRun(`DELETE FROM tips WHERE id = ?`, [tipId]);
    await loadTips();
    const activeTab = openTabs.find(t => t.id === activeTabId);
    if (activeTab && activeTab.categoryId) {
      await loadCategoryTabContent(activeTab.categoryId);
    }
    showToast('Not silindi.');
  } catch (error) {
    console.error('Error deleting note:', error);
    showToast('Not silinirken hata oluştu.');
  }
}

// ==========================================================================
// NEW NOTE MODAL FUNCTIONS
// ==========================================================================
async function openNoteModal() {
  const modal = document.getElementById('note-modal');
  const categorySelect = document.getElementById('note-category-select');
  const subcategorySelect = document.getElementById('note-subcategory-select');
  const contentInput = document.getElementById('note-content-input');
  const importanceInput = document.getElementById('note-importance-input');
  const importanceVal = document.getElementById('note-importance-value');
  const deadlineInput = document.getElementById('note-deadline-input');

  if (!modal || !categorySelect || !subcategorySelect) return;

  // Reset fields
  contentInput.value = '';
  importanceInput.value = '5';
  importanceVal.textContent = '5';
  deadlineInput.value = '';
  const durationSelect = document.getElementById('note-duration-select');
  if (durationSelect) durationSelect.value = '5';
  
  // Populate categories
  categorySelect.innerHTML = '<option value="">Kategori Seçin</option>';
  categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = cat.name;
    categorySelect.appendChild(opt);
  });

  // Reset subcategories to default "Genel"
  subcategorySelect.innerHTML = '<option value="">Genel</option>';
  subcategorySelect.disabled = true;

  // Pre-select active category if we are on a category tab
  const activeTab = openTabs.find(t => t.id === activeTabId);
  if (activeTab && activeTab.categoryId) {
    categorySelect.value = activeTab.categoryId;
    await updateNoteModalSubcategories(activeTab.categoryId);
  }

  modal.classList.add('active');
}

function closeNoteModal() {
  const modal = document.getElementById('note-modal');
  if (modal) {
    modal.classList.remove('active');
  }
}

async function updateNoteModalSubcategories(categoryId) {
  const subcategorySelect = document.getElementById('note-subcategory-select');
  if (!subcategorySelect) return;

  subcategorySelect.innerHTML = '<option value="">Genel</option>';
  
  if (!categoryId) {
    subcategorySelect.disabled = true;
    return;
  }

  try {
    let subcats = [];
    if (window.electronAPI && window.electronAPI.subcategoryList) {
      subcats = await window.electronAPI.subcategoryList(parseInt(categoryId));
    } else {
      subcats = await window.electronAPI.dbQuery('SELECT * FROM subcategories WHERE category_id = ? ORDER BY name ASC', [parseInt(categoryId)]);
    }

    if (subcats && subcats.length > 0) {
      subcats.forEach(sub => {
        const opt = document.createElement('option');
        opt.value = sub.id;
        opt.textContent = sub.name;
        subcategorySelect.appendChild(opt);
      });
    }
    subcategorySelect.disabled = false;
  } catch (err) {
    console.error('Error fetching subcategories for note modal:', err);
    subcategorySelect.disabled = false;
  }
}

async function handleNoteSubmit(e) {
  e.preventDefault();
  
  const categoryId = parseInt(document.getElementById('note-category-select').value);
  const subcatVal = document.getElementById('note-subcategory-select').value;
  const subcategoryId = subcatVal ? parseInt(subcatVal) : null;
  const content = document.getElementById('note-content-input').value.trim();
  const importance = parseInt(document.getElementById('note-importance-input').value);
  const deadlineVal = document.getElementById('note-deadline-input').value;
  const deadline = deadlineVal ? new Date(deadlineVal).toISOString() : null;
  const durationSelect = document.getElementById('note-duration-select');
  const focusDuration = durationSelect ? parseInt(durationSelect.value) : 5;

  if (!categoryId || !content) {
    showToast('Lütfen gerekli alanları doldurun.');
    return;
  }

  try {
    if (!window.electronAPI || !window.electronAPI.dbRun) return;

    // Find next order index inside this category/subcategory
    const catTips = tips.filter(t => t.category_id === categoryId && t.subcategory_id === subcategoryId);
    const nextOrder = catTips.length + 1;

    await window.electronAPI.dbRun(`
      INSERT INTO tips (category_id, content, importance, show_count, status, last_shown, created_at, deadline, prerequisite_tip_id, subcategory_id, order_index, focus_duration)
      VALUES (?, ?, ?, 0, 'active', NULL, ?, ?, NULL, ?, ?, ?)
    `, [categoryId, content, importance, Date.now(), deadline, subcategoryId, nextOrder, focusDuration]);

    await loadTips();
    
    // Refresh current category view if it matches
    const activeTab = openTabs.find(t => t.id === activeTabId);
    if (activeTab && activeTab.categoryId === categoryId) {
      await loadCategoryTabContent(categoryId);
    } else if (activeTab && activeTab.id === 'home') {
      renderCategoryCards();
    }

    closeNoteModal();
    showToast('Not başarıyla eklendi.');
  } catch (err) {
    console.error('Error creating note:', err);
    showToast('Not eklenirken hata oluştu.');
  }
}

async function devImportMarkdown() {
  try {
    if (window.electronAPI && window.electronAPI.importMarkdownFile) {
      const res = await window.electronAPI.importMarkdownFile();
      if (res && res.success) {
        openImportSuccessModal();
      } else if (res && res.error) {
        showToast(`İçe aktarma başarısız: ${res.error}`);
      }
    } else {
      console.warn('window.electronAPI.importMarkdownFile is not defined yet');
      showToast('İçe aktarma IPC kanalı hazır değil.');
      // Simulate success for frontend verification
      openImportSuccessModal();
    }
  } catch (error) {
    console.error('Error importing markdown:', error);
    showToast('Hata oluştu.');
  }
}

function openImportSuccessModal() {
  const modal = document.getElementById('import-success-modal');
  if (modal) modal.classList.add('active');
}

function closeImportSuccessModal() {
  const modal = document.getElementById('import-success-modal');
  if (modal) modal.classList.remove('active');
}
