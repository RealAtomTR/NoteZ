// Settings Panel - Category and Tip CRUD

// Use real SQLite data via IPC
let categories = [];
let tips = [];

// DOM Elements
const categoriesList = document.getElementById('categories-list');
const tipsList = document.getElementById('tips-list');
const addCategoryBtn = document.getElementById('add-category-btn');
const addTipBtn = document.getElementById('add-tip-btn');
const categoryModal = document.getElementById('category-modal');
const tipModal = document.getElementById('tip-modal');
const categoryForm = document.getElementById('category-form');
const tipForm = document.getElementById('tip-form');
const cancelCategoryBtn = document.getElementById('cancel-category-btn');
const cancelTipBtn = document.getElementById('cancel-tip-btn');
const categoryModalTitle = document.getElementById('category-modal-title');
const tipModalTitle = document.getElementById('tip-modal-title');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadCategories();
  await loadTips();
  await loadAudioSettings();
  await loadStatistics();
  setupEventListeners();
  setupAudioIPCPListeners();
});

// Setup IPC listeners for audio controls from main process
function setupAudioIPCPListeners() {
  if (window.electronAPI) {
    // Listen for audio fade-in command from main process
    window.electronAPI.onAudioFadeIn(() => {
      if (window.audioManager) {
        window.audioManager.fadeInBackgroundMusic();
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

// Load categories from database
async function loadCategories() {
  try {
    categories = await window.electronAPI.dbQuery(`
      SELECT * FROM categories ORDER BY created_at DESC
    `);
    renderCategories();
  } catch (error) {
    console.error('Error loading categories:', error);
  }
}

// Load tips from database
async function loadTips() {
  try {
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
  try {
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
    if (settingsMap['background_music']) {
      document.getElementById('background-music').value = settingsMap['background_music'];
    }
    if (settingsMap['sound_level_1_3']) {
      document.getElementById('sound-level-1-3').value = settingsMap['sound_level_1_3'];
    }
    if (settingsMap['sound_level_4_6']) {
      document.getElementById('sound-level-4-6').value = settingsMap['sound_level_4_6'];
    }
    if (settingsMap['sound_level_7_9']) {
      document.getElementById('sound-level-7-9').value = settingsMap['sound_level_7_9'];
    }
    if (settingsMap['sound_level_10']) {
      document.getElementById('sound-level-10').value = settingsMap['sound_level_10'];
    }
    if (settingsMap['sound_level_10_buildup']) {
      document.getElementById('sound-level-10-buildup').value = settingsMap['sound_level_10_buildup'];
    }
    if (settingsMap['sound_level_10_hit']) {
      document.getElementById('sound-level-10-hit').value = settingsMap['sound_level_10_hit'];
    }
    
    // Initialize audio manager with settings
    if (window.audioManager) {
      await window.audioManager.initialize({
        volume: (parseInt(settingsMap['audio_volume']) || 50) / 100,
        backgroundMusic: settingsMap['background_music'],
        soundLevel1to3: settingsMap['sound_level_1_3'],
        soundLevel4to6: settingsMap['sound_level_4_6'],
        soundLevel7to9: settingsMap['sound_level_7_9'],
        soundLevel10: settingsMap['sound_level_10'],
        soundLevel10BuildUp: settingsMap['sound_level_10_buildup'],
        soundLevel10Hit: settingsMap['sound_level_10_hit']
      });
    }
  } catch (error) {
    console.error('Error loading audio settings:', error);
  }
}

// Setup Event Listeners
function setupEventListeners() {
  addCategoryBtn.addEventListener('click', () => openCategoryModal());
  addTipBtn.addEventListener('click', () => openTipModal());
  cancelCategoryBtn.addEventListener('click', () => closeCategoryModal());
  cancelTipBtn.addEventListener('click', () => closeTipModal());
  categoryForm.addEventListener('submit', handleCategorySubmit);
  tipForm.addEventListener('submit', handleTipSubmit);
  
  // Audio settings
  const volumeSlider = document.getElementById('audio-volume');
  const volumeValue = document.getElementById('volume-value');
  const saveAudioBtn = document.getElementById('save-audio-settings');
  
  if (volumeSlider && volumeValue) {
    volumeSlider.addEventListener('input', () => {
      volumeValue.textContent = volumeSlider.value + '%';
    });
  }
  
  if (saveAudioBtn) {
    saveAudioBtn.addEventListener('click', saveAudioSettings);
  }
  
  // Statistics refresh button
  const refreshStatsBtn = document.getElementById('refresh-stats');
  if (refreshStatsBtn) {
    refreshStatsBtn.addEventListener('click', loadStatistics);
  }
  
  // Close modals when clicking outside
  categoryModal.addEventListener('click', (e) => {
    if (e.target === categoryModal) closeCategoryModal();
  });
  tipModal.addEventListener('click', (e) => {
    if (e.target === tipModal) closeTipModal();
  });
}

// Category CRUD Functions
function renderCategories() {
  if (categories.length === 0) {
    categoriesList.innerHTML = '<p>Henüz kategori yok.</p>';
    return;
  }
  
  categoriesList.innerHTML = categories.map(category => `
    <div class="item-card" style="border-left: 4px solid ${category.color}">
      <div class="item-header">
        <h3>${category.name}</h3>
        <div class="item-actions">
          <button class="btn-small btn-edit" onclick="editCategory(${category.id})">Düzenle</button>
          <button class="btn-small btn-delete" onclick="deleteCategory(${category.id})">Sil</button>
        </div>
      </div>
      <div class="item-details">
        <span class="tag">Trigger: ${category.triggers.join(', ')}</span>
      </div>
    </div>
  `).join('');
  
  // Update tip category dropdown
  updateTipCategoryDropdown();
}

function openCategoryModal(category = null) {
  if (category) {
    categoryModalTitle.textContent = 'Kategori Düzenle';
    document.getElementById('category-id').value = category.id;
    document.getElementById('category-name').value = category.name;
    document.getElementById('category-color').value = category.color;
    document.getElementById('category-triggers').value = category.triggers.join(', ');
  } else {
    categoryModalTitle.textContent = 'Kategori Ekle';
    categoryForm.reset();
    document.getElementById('category-id').value = '';
    document.getElementById('category-color').value = '#6C63FF';
  }
  categoryModal.classList.add('active');
}

function closeCategoryModal() {
  categoryModal.classList.remove('active');
  categoryForm.reset();
}

async function handleCategorySubmit(e) {
  e.preventDefault();
  
  const id = document.getElementById('category-id').value;
  const name = document.getElementById('category-name').value.trim();
  const color = document.getElementById('category-color').value;
  const triggersStr = document.getElementById('category-triggers').value.trim();
  const triggers = triggersStr ? triggersStr.split(',').map(t => t.trim()).filter(t => t) : [];
  
  try {
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
    await loadCategories();
  } catch (error) {
    console.error('Error saving category:', error);
    alert('Kategori kaydedilirken hata oluştu.');
  }
}

function editCategory(id) {
  const category = categories.find(c => c.id === id);
  if (category) {
    openCategoryModal(category);
  }
}

async function deleteCategory(id) {
  if (confirm('Bu kategoriyi silmek istediğinize emin misiniz? İlişkili tipler de silinecek.')) {
    try {
      await window.electronAPI.dbRun(`DELETE FROM categories WHERE id = ?`, [id]);
      await loadCategories();
      await loadTips();
    } catch (error) {
      console.error('Error deleting category:', error);
      alert('Kategori silinirken hata oluştu.');
    }
  }
}

// Tip CRUD Functions
function renderTips() {
  if (tips.length === 0) {
    tipsList.innerHTML = '<p>Henüz tip yok.</p>';
    return;
  }
  
  tipsList.innerHTML = tips.map(tip => {
    // Use joined category data if available, otherwise fallback to categories array
    const categoryName = tip.category_name || (categories.find(c => c.id === tip.category_id)?.name) || 'Silinmiş Kategori';
    const categoryColor = tip.category_color || (categories.find(c => c.id === tip.category_id)?.color) || '#666';
    
    return `
      <div class="item-card" style="border-left: 4px solid ${categoryColor}">
        <div class="item-header">
          <h3>${tip.content.substring(0, 50)}${tip.content.length > 50 ? '...' : ''}</h3>
          <div class="item-actions">
            <button class="btn-small btn-edit" onclick="editTip(${tip.id})">Düzenle</button>
            <button class="btn-small btn-delete" onclick="deleteTip(${tip.id})">Sil</button>
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

function updateTipCategoryDropdown() {
  const select = document.getElementById('tip-category');
  select.innerHTML = '<option value="">Kategori Seçin</option>' + 
    categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}

function openTipModal(tip = null) {
  updateTipCategoryDropdown();
  
  if (tip) {
    tipModalTitle.textContent = 'Tip Düzenle';
    document.getElementById('tip-id').value = tip.id;
    document.getElementById('tip-category').value = tip.category_id;
    document.getElementById('tip-content').value = tip.content;
    document.getElementById('tip-importance').value = tip.importance;
    document.getElementById('tip-status').value = tip.status;
  } else {
    tipModalTitle.textContent = 'Tip Ekle';
    tipForm.reset();
    document.getElementById('tip-id').value = '';
    document.getElementById('tip-importance').value = 5;
    document.getElementById('tip-status').value = 'active';
  }
  tipModal.classList.add('active');
}

function closeTipModal() {
  tipModal.classList.remove('active');
  tipForm.reset();
}

async function handleTipSubmit(e) {
  e.preventDefault();
  
  const id = document.getElementById('tip-id').value;
  const category_id = parseInt(document.getElementById('tip-category').value);
  const content = document.getElementById('tip-content').value.trim();
  const importance = parseInt(document.getElementById('tip-importance').value);
  const status = document.getElementById('tip-status').value;
  
  try {
    if (id) {
      // Edit existing tip
      await window.electronAPI.dbRun(`
        UPDATE tips 
        SET category_id = ?, content = ?, importance = ?, status = ?
        WHERE id = ?
      `, [category_id, content, importance, status, parseInt(id)]);
    } else {
      // Add new tip
      await window.electronAPI.dbRun(`
        INSERT INTO tips (category_id, content, importance, show_count, status, last_shown, created_at)
        VALUES (?, ?, ?, 0, ?, NULL, ?)
      `, [category_id, content, importance, status, Date.now()]);
    }
    
    closeTipModal();
    await loadTips();
  } catch (error) {
    console.error('Error saving tip:', error);
    alert('Tip kaydedilirken hata oluştu.');
  }
}

function editTip(id) {
  const tip = tips.find(t => t.id === id);
  if (tip) {
    openTipModal(tip);
  }
}

async function deleteTip(id) {
  if (confirm('Bu tipi silmek istediğinize emin misiniz?')) {
    try {
      await window.electronAPI.dbRun(`DELETE FROM tips WHERE id = ?`, [id]);
      await loadTips();
    } catch (error) {
      console.error('Error deleting tip:', error);
      alert('Tip silinirken hata oluştu.');
    }
  }
}

// Save audio settings
async function saveAudioSettings() {
  try {
    const volume = document.getElementById('audio-volume').value;
    const backgroundMusic = document.getElementById('background-music').value.trim();
    const soundLevel1to3 = document.getElementById('sound-level-1-3').value.trim();
    const soundLevel4to6 = document.getElementById('sound-level-4-6').value.trim();
    const soundLevel7to9 = document.getElementById('sound-level-7-9').value.trim();
    const soundLevel10 = document.getElementById('sound-level-10').value.trim();
    const soundLevel10BuildUp = document.getElementById('sound-level-10-buildup').value.trim();
    const soundLevel10Hit = document.getElementById('sound-level-10-hit').value.trim();
    
    // Save each setting to database
    const settings = [
      { key: 'audio_volume', value: volume },
      { key: 'background_music', value: backgroundMusic },
      { key: 'sound_level_1_3', value: soundLevel1to3 },
      { key: 'sound_level_4_6', value: soundLevel4to6 },
      { key: 'sound_level_7_9', value: soundLevel7to9 },
      { key: 'sound_level_10', value: soundLevel10 },
      { key: 'sound_level_10_buildup', value: soundLevel10BuildUp },
      { key: 'sound_level_10_hit', value: soundLevel10Hit }
    ];
    
    for (const setting of settings) {
      if (setting.value) {
        // Use INSERT OR REPLACE to upsert the setting
        await window.electronAPI.dbRun(`
          INSERT OR REPLACE INTO settings (key, value)
          VALUES (?, ?)
        `, [setting.key, setting.value]);
      }
    }
    
    // Reinitialize audio manager with new settings
    if (window.audioManager) {
      await window.audioManager.initialize({
        volume: parseInt(volume) / 100,
        backgroundMusic: backgroundMusic || null,
        soundLevel1to3: soundLevel1to3 || null,
        soundLevel4to6: soundLevel4to6 || null,
        soundLevel7to9: soundLevel7to9 || null,
        soundLevel10: soundLevel10 || null,
        soundLevel10BuildUp: soundLevel10BuildUp || null,
        soundLevel10Hit: soundLevel10Hit || null
      });
    }
    
    alert('Ses ayarları kaydedildi!');
  } catch (error) {
    console.error('Error saving audio settings:', error);
    alert('Ses ayarları kaydedilirken hata oluştu.');
  }
}

// Helper Functions
function getStatusText(status) {
  const statusMap = {
    'active': 'Aktif',
    'retired': 'Emekli',
    'done': 'Tamamlandı'
  };
  return statusMap[status] || status;
}

// Statistics Functions
async function loadStatistics() {
  try {
    await loadPatternWarnings();
    await loadCategoryStatistics();
    await loadTipStatistics();
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
            <th>Tip Sayısı</th>
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
      tipStatsContainer.innerHTML = '<p>Henüz tip istatistiği yok.</p>';
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
window.editTip = editTip;
window.deleteTip = deleteTip;
