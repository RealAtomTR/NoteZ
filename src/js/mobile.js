(function initMobileApp(globalScope, factory) {
  const api = factory(
    globalScope.NoteZMobileDomain || (typeof require === 'function' ? require('./mobile-domain.js') : null),
    globalScope.NoteZMobileRepository || (typeof require === 'function' ? require('./mobile-repository.js') : null),
    globalScope
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  globalScope.NoteZMobileApp = api;
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', api.boot);
})(typeof globalThis !== 'undefined' ? globalThis : this, function mobileAppFactory(Domain, RepositoryModule, globalScope) {
  'use strict';

  if (!Domain || !RepositoryModule) throw new Error('Mobil uygulama bağımlılıkları yüklenemedi.');

  const ROUTES = Object.freeze(['today', 'notes', 'stats', 'account', 'subcategory', 'note']);
  const STATUS_LABELS = { active: 'Aktif', paused: 'Duraklatıldı', done: 'Tamamlandı', cancelled: 'İptal edildi', archived: 'Arşivlendi' };
  const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

  let repository = null;
  let screen = null;
  let sheet = null;
  let sheetContent = null;
  let sheetTitle = null;
  let sheetBackdrop = null;
  let toast = null;
  let autosaveTimer = null;
  let toastTimer = null;

  const state = {
    snapshot: null,
    filters: { search: '', status: 'all', importance: 'all', deadline: 'all' },
    todayFilter: 'all',
    stats: { status: 'idle', data: null, error: null },
    autosave: 'Kaydedildi',
    lastProgress: null
  };

  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function parseRoute(hashValue) {
    const clean = String(hashValue || '#/today').replace(/^#\/?/, '').split('?')[0];
    const parts = clean.split('/').filter(Boolean);
    const name = ROUTES.includes(parts[0]) ? parts[0] : 'today';
    return { name: name, id: parts[1] ? decodeURIComponent(parts[1]) : null };
  }

  function routeHash(name, id) {
    return '#/' + name + (id ? '/' + encodeURIComponent(id) : '');
  }

  function activeTabForRoute(route) {
    if (route.name === 'subcategory' || route.name === 'note') return 'notes';
    return route.name;
  }

  function formatDate(value) {
    const date = Domain.parseLocalDate(value, false);
    if (!date) return '—';
    return date.getDate() + ' ' + MONTHS[date.getMonth()] + ' ' + date.getFullYear();
  }

  function header(title, subtitle, compact, metricHtml) {
    return [
      '<header class="app-header', compact ? ' compact' : '', '">',
      '<div class="header-row"><div><p class="eyebrow">NoteZ Mobile</p><h1>', escapeHtml(title), '</h1>',
      subtitle ? '<p>' + escapeHtml(subtitle) + '</p>' : '', '</div>', metricHtml || '', '</div></header>'
    ].join('');
  }

  function dashboardHeader(snapshot, now) {
    const metrics = Domain.getTaskProgress(snapshot.notes);
    const progress = metrics.progress;
    const ringOffset = 100 - progress;
    const previousProgress = Number.isFinite(state.lastProgress) ? state.lastProgress : progress;
    const previousRingOffset = 100 - previousProgress;
    state.lastProgress = progress;
    const dateLabel = DAYS[now.getDay()] + ', ' + formatDate(now);
    return [
      '<header class="app-header dashboard-header" data-progress="', progress, '" style="--progress-from-offset:', previousRingOffset, ';--progress-to-offset:', ringOffset, ';--progress-from-width:', previousProgress, '%;--progress-to-width:', progress, '%">',
      '<div class="header-row"><div><p class="eyebrow">NoteZ Mobile</p><h1>Anasayfa</h1><p>', escapeHtml(dateLabel), '</p></div>',
      '<div class="progress-ring-wrap" aria-label="İlerleme yüzde ', progress, '">',
      '<svg class="progress-ring" viewBox="0 0 100 100" aria-hidden="true">',
      '<circle class="progress-ring-track" cx="50" cy="50" r="42" pathLength="100"></circle>',
      '<circle class="progress-ring-value" cx="50" cy="50" r="42" pathLength="100" stroke-dasharray="100" stroke-dashoffset="', ringOffset, '"></circle>',
      '</svg><strong>', progress, '%</strong></div></div>',
      '<div class="progress-summary"><span>', metrics.completed, '/', metrics.total, ' tamamlandı</span><strong>', progress, '%</strong></div>',
      '<div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="', progress, '"><span style="width:', progress, '%"></span></div>',
      '<div class="header-chips">',
      '<div class="header-chip"><strong>', metrics.waiting, '</strong><span>Bekliyor</span></div>',
      '<div class="header-chip"><strong>', metrics.completed, '</strong><span>Bitti</span></div>',
      '<div class="header-chip"><strong>', metrics.total, '</strong><span>Toplam</span></div>',
      '</div></header>'
    ].join('');
  }

  function badge(text, variant) {
    return '<span class="badge ' + escapeHtml(variant || '') + '">' + escapeHtml(text) + '</span>';
  }

  function deadlineBadge(note, subcategory, nowValue) {
    const effective = Domain.getEffectiveDeadline(note, subcategory);
    const info = Domain.getDeadlineState(effective.value, nowValue);
    if (info.state === 'none') return '';
    const variant = info.state === 'past' ? 'rose' : info.state === 'approaching' ? 'amber' : '';
    const prefix = effective.source === 'shared' ? 'Ortak · ' : '';
    return badge(prefix + info.label, variant);
  }

  function statusBadge(status) {
    const variant = status === 'done' ? 'teal' : status === 'cancelled' ? 'rose' : status === 'paused' ? 'amber' : 'blue';
    return badge(STATUS_LABELS[status] || status, variant);
  }

  function normalizeImportance(value) {
    const numeric = Number(value);
    return Math.min(10, Math.max(1, Math.round(Number.isFinite(numeric) ? numeric : 5)));
  }

  function importanceVariant(value) {
    const normalized = normalizeImportance(value);
    if (normalized >= 8) return 'importance-high';
    if (normalized >= 5) return 'importance-medium';
    return 'importance-low';
  }

  function importanceControl(id, value, options) {
    const config = options || {};
    const normalized = normalizeImportance(value);
    const progress = Math.round((normalized - 1) / 9 * 100);
    const noteField = config.noteField ? ' data-note-field' : '';
    const label = config.label || 'Importance';
    return [
      '<div class="field importance-field ', importanceVariant(normalized), '" data-importance-control>',
      '<div class="importance-label-row"><label for="', escapeHtml(id), '">', escapeHtml(label), ' (1–10)</label>',
      '<output id="', escapeHtml(id), '-output" class="importance-value" for="', escapeHtml(id), '" data-importance-output aria-live="polite">', normalized, '</output></div>',
      '<div class="importance-control-row">',
      '<button class="importance-step" type="button" data-action="adjust-importance" data-importance-target="', escapeHtml(id), '" data-importance-delta="-1" aria-label="Importance azalt">−</button>',
      '<input id="', escapeHtml(id), '" class="importance-slider" name="importance" type="range" min="1" max="10" step="1" value="', normalized, '" data-importance-slider', noteField,
      ' aria-label="Importance 1 ile 10 arasında" aria-valuetext="', normalized, ' / 10" style="--importance-progress:', progress, '%">',
      '<button class="importance-step" type="button" data-action="adjust-importance" data-importance-target="', escapeHtml(id), '" data-importance-delta="1" aria-label="Importance artır">+</button>',
      '</div><div class="importance-scale" aria-hidden="true"><span>1</span><span>10</span></div></div>'
    ].join('');
  }

  function syncImportanceControl(input, animate) {
    if (!input) return;
    const value = normalizeImportance(input.value);
    const progress = Math.round((value - 1) / 9 * 100);
    const control = input.closest('[data-importance-control]');
    input.value = String(value);
    input.style.setProperty('--importance-progress', progress + '%');
    input.setAttribute('aria-valuetext', value + ' / 10');
    if (!control) return;
    control.classList.remove('importance-low', 'importance-medium', 'importance-high', 'importance-changed');
    control.classList.add(importanceVariant(value));
    const output = control.querySelector('[data-importance-output]');
    if (output) {
      output.value = String(value);
      output.textContent = String(value);
    }
    if (animate) {
      void control.offsetWidth;
      control.classList.add('importance-changed');
    }
  }

  function noteRow(note, snapshot, options) {
    const config = options || {};
    const subcategory = snapshot.subcategories.find(function findSub(item) { return String(item.id) === String(note.subcategory_id); });
    const category = snapshot.categories.find(function findCategory(item) { return String(item.id) === String(note.category_id); });
    let stepState = config.stepState;
    if (!stepState && subcategory && subcategory.is_sequential) {
      const siblings = snapshot.notes.filter(function sameSubcategory(item) { return String(item.subcategory_id) === String(note.subcategory_id) && item.status !== 'archived'; });
      const sequential = Domain.getSequentialState(siblings, subcategory);
      const current = sequential.items.find(function currentStep(item) { return String(item.id) === String(note.id); });
      stepState = current && current.state;
    }
    const locked = stepState === 'locked';
    const completed = note.status === 'done';
    const checkbox = '<span class="completion-control"><input class="completion-checkbox" type="checkbox" data-action="toggle-completion" data-note-id="' + escapeHtml(note.id) + '" aria-label="' + escapeHtml(completed ? 'Görevi aktif yap' : locked ? 'Kilitli görev' : 'Görevi tamamla') + '"' + (completed ? ' checked' : '') + (locked ? ' disabled' : '') + '><svg class="completion-check" viewBox="0 0 24 24" aria-hidden="true"><path pathLength="1" d="m5 12 4 4L19 7"></path></svg></span>';
    return [
      '<article class="note-row', locked ? ' locked' : '', completed ? ' completed' : '', '">', checkbox,
      '<a class="note-main-link" href="', routeHash('note', note.id), '" aria-label="Not detayını aç: ', escapeHtml(note.tip), '"><h3 class="note-title">', escapeHtml(note.tip), '</h3>',
      note.description ? '<p class="note-description">' + escapeHtml(note.description) + '</p>' : '',
      '<div class="meta-row">', statusBadge(note.status), badge('Önem ' + note.importance, note.importance >= 8 ? 'rose' : note.importance >= 5 ? 'amber' : ''),
      category ? badge(category.name, '') : '', stepState === 'active' ? badge('Aktif adım', 'teal') : '', stepState === 'locked' ? badge('Kilitli', 'locked') : '',
      deadlineBadge(note, subcategory), '</div></a></article>'
    ].join('');
  }

  function filterTodayNotes(notes, filterValue) {
    const visible = (notes || []).filter(function visibleNote(note) { return note.status !== 'archived' && note.status !== 'cancelled'; });
    if (filterValue === 'active') return visible.filter(function activeNote(note) { return note.status === 'active'; });
    if (filterValue === 'done') return visible.filter(function completedNote(note) { return note.status === 'done'; });
    return visible;
  }

  function nextCompletionStatus(note) {
    return note && note.status === 'done' ? 'active' : 'done';
  }

  function renderToday(snapshot) {
    const now = new Date();
    const taskNotes = filterTodayNotes(snapshot.notes, state.todayFilter);
    const approaching = snapshot.notes.filter(function dueSoon(note) {
      const sub = snapshot.subcategories.find(function match(item) { return String(item.id) === String(note.subcategory_id); });
      return (note.status === 'active' || note.status === 'paused') && Domain.getDeadlineState(Domain.getEffectiveDeadline(note, sub).value, now).state === 'approaching';
    });
    const weekly = Domain.buildWeeklyProgress(snapshot.notes, now);
    const weeklyCompleted = weekly.reduce(function sum(total, day) { return total + day.completed; }, 0);
    const filterButtons = [
      { value: 'all', label: 'Tümü' },
      { value: 'active', label: 'Aktif' },
      { value: 'done', label: 'Tamamlanan' }
    ].map(function filterButton(item) {
      const selected = state.todayFilter === item.value;
      return '<button type="button" data-action="set-today-filter" data-filter-value="' + item.value + '" aria-pressed="' + selected + '"' + (selected ? ' class="active"' : '') + '>' + item.label + '</button>';
    }).join('');

    return [
      dashboardHeader(snapshot, now),
      '<div class="content">',
      '<section class="section"><div class="section-head"><h2>Hızlı not</h2></div><form class="card quick-add" data-form="quick-add"><input name="tip" required maxlength="160" placeholder="Aklındaki işi yaz…" aria-label="Hızlı not başlığı"><button class="button primary" type="submit">Ekle</button></form></section>',
      '<section class="section task-list-section"><div class="section-head"><h2>Görevler</h2><span class="result-count">' + taskNotes.length + ' görev</span></div>',
      '<div class="task-filter-tabs" role="group" aria-label="Görev filtresi">' + filterButtons + '</div>',
      taskNotes.length ? '<div class="card task-list">' + taskNotes.map(function render(note) { return noteRow(note, snapshot); }).join('') + '</div>' : '<div class="card state"><p>Bu filtrede görev yok.</p></div>',
      '</section>',
      '<section class="section"><div class="section-head"><h2>Deadline yaklaşanlar</h2></div>',
      approaching.length ? '<div class="card">' + approaching.slice(0, 3).map(function render(note) { return noteRow(note, snapshot); }).join('') + '</div>' : '<div class="card card-pad"><p class="note-description">Önümüzdeki üç gün için yaklaşan deadline yok.</p></div>',
      '</section>',
      '<section class="section"><div class="section-head"><h2>Haftalık ilerleme</h2><a href="#/stats">Detaylar</a></div><div class="card card-pad"><strong>' + weeklyCompleted + ' tamamlanan not</strong><div class="bar-chart">',
      weekly.map(function bar(day) { const height = Math.max(3, Math.min(100, day.completed * 22)); return '<div class="bar-item"><div class="bar-track"><div class="bar-fill" style="height:' + height + '%"></div></div><small>' + day.day + '</small></div>'; }).join(''),
      '</div></div></section><button class="fab" type="button" data-action="new-todo" aria-label="Yapılacaklar listesine görev ekle">+</button></div>'
    ].join('');
  }

  function filterNotes(snapshot) {
    const query = state.filters.search.trim().toLocaleLowerCase('tr-TR');
    return snapshot.notes.filter(function filter(note) {
      if (note.status === 'archived') return false;
      const category = snapshot.categories.find(function categoryMatch(item) { return String(item.id) === String(note.category_id); });
      const subcategory = snapshot.subcategories.find(function subMatch(item) { return String(item.id) === String(note.subcategory_id); });
      const searchable = [note.tip, note.description, category && category.name, subcategory && subcategory.name].join(' ').toLocaleLowerCase('tr-TR');
      if (query && !searchable.includes(query)) return false;
      if (state.filters.status !== 'all' && note.status !== state.filters.status) return false;
      if (state.filters.importance === 'high' && Number(note.importance) < 8) return false;
      if (state.filters.importance === 'medium' && (Number(note.importance) < 5 || Number(note.importance) > 7)) return false;
      if (state.filters.importance === 'low' && Number(note.importance) > 4) return false;
      if (state.filters.deadline !== 'all') {
        const deadlineState = Domain.getDeadlineState(Domain.getEffectiveDeadline(note, subcategory).value, new Date()).state;
        if (deadlineState !== state.filters.deadline) return false;
      }
      return true;
    });
  }

  function renderNotes(snapshot) {
    const filtered = filterNotes(snapshot);
    const categoryCards = snapshot.categories.map(function renderCategory(category) {
      const subs = snapshot.subcategories.filter(function inCategory(item) { return String(item.category_id) === String(category.id); });
      const rows = subs.map(function renderSub(subcategory) {
        const notes = filtered.filter(function inSub(note) { return String(note.subcategory_id) === String(subcategory.id); });
        const mode = subcategory.is_sequential ? 'Sıralı' : 'Sırasız';
        return '<a class="subcategory-link" href="' + routeHash('subcategory', subcategory.id) + '"><span><strong>' + escapeHtml(subcategory.name) + '</strong><small>' + mode + ' · ' + notes.length + ' not</small></span><span aria-hidden="true">›</span></a>';
      }).join('');
      return '<section class="card category-card"><div class="category-head"><span class="category-icon">' + escapeHtml(category.name.charAt(0)) + '</span><div><h3>' + escapeHtml(category.name) + '</h3><p>' + subs.length + ' alt kategori</p></div><span aria-hidden="true">⌄</span></div><div class="subcategory-list">' + rows + '</div></section>';
    }).join('');
    return [
      header('Notlar', snapshot.notes.filter(function visible(note) { return note.status !== 'archived'; }).length + ' görünür görev', false),
      '<div class="content"><section class="section"><div class="card card-pad"><div class="filters">',
      '<input class="search" type="search" data-filter="search" value="', escapeHtml(state.filters.search), '" placeholder="Başlık, açıklama, kategori ara…" aria-label="Not ara">',
      '<select data-filter="status" aria-label="Durum filtresi"><option value="all">Tüm durumlar</option><option value="active">Aktif</option><option value="paused">Duraklatıldı</option><option value="done">Tamamlandı</option><option value="cancelled">İptal edildi</option></select>',
      '<select data-filter="importance" aria-label="Önem filtresi"><option value="all">Tüm önemler</option><option value="high">Yüksek (8-10)</option><option value="medium">Orta (5-7)</option><option value="low">Düşük (1-4)</option></select>',
      '<select data-filter="deadline" aria-label="Deadline filtresi"><option value="all">Tüm deadline</option><option value="approaching">Yaklaşan</option><option value="normal">Normal</option><option value="past">Geçmiş</option><option value="none">Deadline yok</option></select>',
      '<button class="button ghost" type="button" data-action="clear-filters">Filtreleri temizle</button></div><p class="note-description" style="margin-top:10px">', filtered.length, ' eşleşen not</p></div></section>',
      categoryCards ? '<div class="stack">' + categoryCards + '</div>' : '<div class="card state"><p>Kategori bulunamadı.</p></div>',
      '<button class="fab" type="button" data-action="new-todo" aria-label="Yapılacaklar listesine görev ekle">+</button></div>'
    ].join('');
  }

  function renderSubcategory(snapshot, id) {
    const subcategory = snapshot.subcategories.find(function find(item) { return String(item.id) === String(id); });
    if (!subcategory) return renderNotFound('Alt kategori bulunamadı');
    const category = snapshot.categories.find(function findCategory(item) { return String(item.id) === String(subcategory.category_id); });
    const notes = snapshot.notes.filter(function inSub(note) { return String(note.subcategory_id) === String(subcategory.id) && note.status !== 'archived'; }).sort(function byOrder(a, b) { return a.order_index - b.order_index; });
    const sequential = Domain.getSequentialState(notes, subcategory);
    const stateById = new Map(sequential.items.map(function mapState(item) { return [String(item.id), item.state]; }));
    const shared = subcategory.deadline_mode === 'shared' ? '<div class="card card-pad" style="margin-bottom:14px"><strong>Ortak deadline</strong><p class="note-description">' + escapeHtml(formatDate(subcategory.shared_deadline)) + ' · Tüm notlarda effective deadline olarak kullanılır.</p></div>' : '';
    const items = notes.map(function renderStep(note, index) {
      const stepState = stateById.get(String(note.id));
      if (!subcategory.is_sequential) return noteRow(note, snapshot, { stepState: stepState });
      return '<div class="step-line ' + escapeHtml(stepState) + '"><div class="step-rail"><span class="step-dot">' + (stepState === 'completed' ? '✓' : index + 1) + '</span></div><div class="card">' + noteRow(note, snapshot, { stepState: stepState }) + '</div></div>';
    }).join('');
    return [
      header(subcategory.name, (category ? category.name + ' · ' : '') + (subcategory.is_sequential ? 'Sıralı adımlar' : 'Bağımsız notlar'), true),
      '<div class="content"><a class="button ghost" href="#/notes" style="margin-bottom:14px">‹ Notlara dön</a>', shared,
      subcategory.is_sequential && sequential.activeId ? '<div class="card card-pad" style="margin-bottom:14px">' + badge('Aktif adım', 'teal') + '<p class="note-description" style="margin-top:8px">Yalnız aktif adım ilerletilebilir; done veya cancelled olduğunda sonraki adım açılır.</p></div>' : '',
      notes.length ? '<div class="stack">' + items + '</div>' : '<div class="card state"><div class="state-icon">＋</div><h3>Henüz not yok</h3><p>Bu alt kategoriye ilk notu ekleyin.</p></div>',
      '<button class="button primary full subcategory-add" type="button" data-action="new-note" data-subcategory-id="' + escapeHtml(subcategory.id) + '">Bu alt kategoriye not ekle</button></div>'
    ].join('');
  }

  function options(items, selected, valueKey, labelKey) {
    return items.map(function option(item) { const value = String(item[valueKey]); return '<option value="' + escapeHtml(value) + '"' + (value === String(selected) ? ' selected' : '') + '>' + escapeHtml(item[labelKey]) + '</option>'; }).join('');
  }

  function renderNoteDetail(snapshot, id) {
    const note = snapshot.notes.find(function find(item) { return String(item.id) === String(id); });
    if (!note) return renderNotFound('Not bulunamadı');
    const subcategory = snapshot.subcategories.find(function findSub(item) { return String(item.id) === String(note.subcategory_id); });
    const weight = Domain.getNoteWeight(note, subcategory, new Date());
    return [
      header('Not Detayı', 'Değişiklikler otomatik kaydedilir', true),
      '<div class="content"><a class="button ghost" href="', routeHash('subcategory', note.subcategory_id), '" style="margin-bottom:14px">‹ Alt kategoriye dön</a>',
      '<form id="note-detail-form" class="card card-pad form-grid" data-note-id="', escapeHtml(note.id), '">',
      '<div class="field"><label for="detail-title">Başlık</label><input id="detail-title" name="tip" data-note-field value="', escapeHtml(note.tip), '" required></div>',
      '<div class="field"><label for="detail-description">Açıklama</label><textarea id="detail-description" name="description" data-note-field placeholder="Bir açıklama yazın">', escapeHtml(note.description), '</textarea></div>',
      '<div class="field"><label for="detail-status">Durum</label><select id="detail-status" name="status" data-note-field>',
      ['active', 'paused', 'done', 'cancelled'].map(function statusOption(status) { return '<option value="' + status + '"' + (note.status === status ? ' selected' : '') + '>' + STATUS_LABELS[status] + '</option>'; }).join(''), '</select></div>',
      importanceControl('detail-importance', note.importance, { noteField: true }),
      '<div class="field"><label for="detail-deadline">Deadline</label><input id="detail-deadline" name="deadline" data-note-field type="date" value="', escapeHtml(note.deadline || ''), '"></div>',
      '<div class="field"><label for="detail-category">Kategori</label><select id="detail-category" name="category_id" data-note-field>', options(snapshot.categories, note.category_id, 'id', 'name'), '</select></div>',
      '<div class="field"><label for="detail-subcategory">Alt kategori</label><select id="detail-subcategory" name="subcategory_id" data-note-field>', options(snapshot.subcategories, note.subcategory_id, 'id', 'name'), '</select></div>',
      '<div class="card card-pad"><div class="meta-row">', deadlineBadge(note, subcategory), badge('Final weight ' + weight.finalWeight, 'teal'), badge('Effective importance ' + weight.effectiveImportance, 'amber'), '</div></div>',
      '<div id="autosave-state" class="autosave" role="status">', escapeHtml(state.autosave), '</div>',
      '</form><div class="danger-zone stack"><button class="button full" type="button" data-action="archive-note" data-note-id="', escapeHtml(note.id), '">Arşivle</button><button class="button danger full" type="button" data-action="delete-note" data-note-id="', escapeHtml(note.id), '">Notu sil</button></div></div>'
    ].join('');
  }

  function renderStats(snapshot, statsState) {
    const shell = header('İstatistikler', 'Yalnız haftalık görünüm', false);
    if (statsState.status === 'loading' || statsState.status === 'idle') return shell + '<div class="content stack"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>';
    if (statsState.status === 'error') return shell + '<div class="content"><div class="card state"><div class="state-icon">!</div><h2>İstatistikler yüklenemedi</h2><p>' + escapeHtml(statsState.error || 'Bilinmeyen hata') + '</p><button class="button primary" type="button" data-action="retry-stats">Tekrar dene</button></div></div>';
    const data = statsState.data;
    if (!data || data.empty) return shell + '<div class="content"><div class="card state"><div class="state-icon">▥</div><h2>Bu hafta veri yok</h2><p>Notlar tamamlandığında haftalık ilerleme burada oluşacak.</p></div></div>';
    const maxTrend = Math.max.apply(null, data.pauseTrend.map(function count(item) { return item.count; }).concat([1]));
    const maxCategory = Math.max.apply(null, data.categoryDistribution.map(function total(item) { return item.total; }).concat([1]));
    return [shell, '<div class="content">',
      '<section class="section"><div class="section-head"><h2>Haftalık özet</h2></div><div class="stat-grid">',
      '<div class="card stat-card"><span>Tamamlanan</span><strong>', data.totals.completed, '</strong></div>',
      '<div class="card stat-card"><span>Duraklatılan</span><strong>', data.totals.paused, '</strong></div>',
      '<div class="card stat-card"><span>Deadline yaklaşan</span><strong>', data.totals.upcoming, '</strong></div>',
      '<div class="card stat-card"><span>Aktif</span><strong>', data.totals.active, '</strong></div></div></section>',
      '<section class="section"><div class="section-head"><h2>Haftalık ilerleme</h2></div><div class="card card-pad"><div class="bar-chart">',
      data.weekly.map(function bar(day) { const height = Math.max(3, Math.min(100, day.completed * 22)); return '<div class="bar-item"><div class="bar-track"><div class="bar-fill" style="height:' + height + '%"></div></div><small>' + day.day + '</small></div>'; }).join(''),
      '</div></div></section>',
      '<section class="section"><div class="section-head"><h2>Duraklatma trendi</h2></div><div class="card card-pad stack">',
      data.pauseTrend.map(function trend(item) { return '<div class="trend-row"><span>' + item.day + '</span><div class="mini-track"><div class="mini-fill amber" style="width:' + Math.round(item.count / maxTrend * 100) + '%"></div></div><strong>' + item.count + '</strong></div>'; }).join(''),
      '</div></section>',
      '<section class="section"><div class="section-head"><h2>Kategori dağılımı</h2></div><div class="card card-pad stack">',
      data.categoryDistribution.length ? data.categoryDistribution.map(function category(item) { return '<div class="distribution-row"><span>' + escapeHtml(item.name) + '</span><div class="mini-track"><div class="mini-fill" style="width:' + Math.round(item.total / maxCategory * 100) + '%"></div></div><strong>' + item.total + '</strong></div>'; }).join('') : '<p class="note-description">Kategori verisi yok.</p>',
      '</div></section></div>'].join('');
  }

  function renderAccount() {
    return header('Hesap', 'Pasif placeholder', true) + '<div class="content"><div class="card state" style="min-height:420px"><div class="state-icon">○</div><h2>Hesap özellikleri yakında</h2><p>Bu aşamada login, profil, sync veya auth backend entegrasyonu bulunmuyor.</p>' + badge('Yakında', 'teal') + '</div></div>';
  }

  function renderNotFound(message) {
    return header('Bulunamadı', message, true) + '<div class="content"><div class="card state"><a class="button primary" href="#/today">Bugüne dön</a></div></div>';
  }

  function renderScreen(route, snapshot, renderState) {
    if (!snapshot) return '<div class="content"><div class="skeleton"></div></div>';
    if (route.name === 'today') return renderToday(snapshot);
    if (route.name === 'notes') return renderNotes(snapshot);
    if (route.name === 'subcategory') return renderSubcategory(snapshot, route.id);
    if (route.name === 'note') return renderNoteDetail(snapshot, route.id);
    if (route.name === 'stats') return renderStats(snapshot, renderState && renderState.stats || state.stats);
    if (route.name === 'account') return renderAccount();
    return renderNotFound('Ekran bulunamadı');
  }

  function updateNav(route) {
    if (typeof document === 'undefined') return;
    const active = activeTabForRoute(route);
    document.querySelectorAll('[data-nav]').forEach(function setNav(link) {
      if (link.getAttribute('data-nav') === active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  async function refreshSnapshot() {
    state.snapshot = await repository.getSnapshot();
    return state.snapshot;
  }

  async function renderCurrentRoute() {
    const route = parseRoute(globalScope.location && globalScope.location.hash);
    updateNav(route);
    screen.innerHTML = renderScreen(route, state.snapshot, state);
    screen.scrollTop = 0;
    syncFilterControls();
    if (route.name === 'stats' && state.stats.status === 'idle') loadStatistics();
  }

  function syncFilterControls() {
    if (!screen) return;
    Object.keys(state.filters).forEach(function sync(key) {
      const control = screen.querySelector('[data-filter="' + key + '"]');
      if (control) control.value = state.filters[key];
    });
  }

  async function loadStatistics() {
    state.stats = { status: 'loading', data: null, error: null };
    await renderCurrentRoute();
    try {
      const data = await repository.getStatistics(new Date());
      state.stats = { status: data.empty ? 'empty' : 'ready', data: data, error: null };
    } catch (error) {
      state.stats = { status: 'error', data: null, error: error.message || 'statistics-query-failed' };
    }
    if (parseRoute(globalScope.location.hash).name === 'stats') await renderCurrentRoute();
  }

  function showToast(message) {
    if (!toast) return;
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = setTimeout(function hideToast() { toast.hidden = true; }, 2600);
  }

  function closeSheet() {
    if (!sheet) return;
    sheet.hidden = true;
    sheetBackdrop.hidden = true;
    sheetContent.innerHTML = '';
  }

  function newNoteForm(snapshot, subcategoryId) {
    const selectedSubcategory = snapshot.subcategories.find(function find(item) { return String(item.id) === String(subcategoryId); }) || RepositoryModule.getTodoSubcategory(snapshot);
    return '<form class="form-grid" data-form="new-note"><input type="hidden" name="subcategory_id" value="' + escapeHtml(selectedSubcategory.id) + '"><div class="form-context"><span>Alt kategori</span><strong>' + escapeHtml(selectedSubcategory.name) + '</strong></div><div class="field"><label for="new-title">Başlık *</label><input id="new-title" name="tip" required maxlength="180" autofocus></div><div class="field"><label for="new-description">Açıklama</label><textarea id="new-description" name="description"></textarea></div>' + importanceControl('new-importance', 5) + '<div class="field"><label for="new-deadline">Deadline</label><input id="new-deadline" name="deadline" type="date"></div><button class="button primary full" type="submit">Notu ekle</button></form>';
  }

  function newTodoForm() {
    return '<form class="form-grid" data-form="new-todo"><div class="form-context"><span>Alt kategori</span><strong>Yapılacaklar</strong></div><div class="field"><label for="todo-title">Başlık *</label><input id="todo-title" name="tip" required maxlength="180" autofocus></div><div class="field"><label for="todo-description">Açıklama</label><textarea id="todo-description" name="description"></textarea></div>' + importanceControl('todo-importance', 5) + '<div class="field"><label for="todo-deadline">Deadline</label><input id="todo-deadline" name="deadline" type="date"></div><button class="button primary full" type="submit">Görevi ekle</button></form>';
  }

  function openSheet(title, content) {
    sheetTitle.textContent = title;
    sheetContent.innerHTML = content;
    sheetBackdrop.hidden = false;
    sheet.hidden = false;
    setTimeout(function focusFirst() { const first = sheetContent.querySelector('[autofocus], input, select, textarea, button'); if (first) first.focus(); }, 20);
  }

  async function afterMutation(message) {
    await refreshSnapshot();
    state.stats = { status: 'idle', data: null, error: null };
    await renderCurrentRoute();
    if (message) showToast(message);
  }

  async function animateCompletion(input, completed) {
    const row = input && input.closest('.note-row');
    if (!input || !row) return;
    input.checked = completed;
    input.setAttribute('aria-label', completed ? 'Görevi aktif yap' : 'Görevi tamamla');
    row.classList.toggle('completed', completed);
    row.classList.add('completion-transitioning');
    row.setAttribute('aria-busy', 'true');
    const reducedMotion = typeof globalScope.matchMedia === 'function' && globalScope.matchMedia('(prefers-reduced-motion: reduce)').matches;
    await new Promise(function waitForCompletionAnimation(resolve) { setTimeout(resolve, reducedMotion ? 0 : 280); });
    row.classList.remove('completion-transitioning');
    row.removeAttribute('aria-busy');
  }

  async function handleSubmit(event) {
    const form = event.target.closest('form');
    if (!form) return;
    if (form.matches('[data-form="quick-add"]')) {
      event.preventDefault();
      const values = new FormData(form);
      repository.createTodo({ tip: values.get('tip'), importance: 5 });
      form.reset();
      await afterMutation('Görev Yapılacaklar listesine eklendi');
    }
    if (form.matches('[data-form="new-todo"]')) {
      event.preventDefault();
      const values = new FormData(form);
      repository.createTodo({ tip: values.get('tip'), description: values.get('description'), importance: values.get('importance'), deadline: values.get('deadline') || null });
      closeSheet();
      await afterMutation('Görev Yapılacaklar listesine eklendi');
    }
    if (form.matches('[data-form="new-note"]')) {
      event.preventDefault();
      const values = new FormData(form);
      const subcategory = state.snapshot.subcategories.find(function find(item) { return String(item.id) === String(values.get('subcategory_id')); });
      repository.createNote({ tip: values.get('tip'), description: values.get('description'), importance: values.get('importance'), deadline: values.get('deadline') || null, subcategory_id: subcategory.id, category_id: subcategory.category_id });
      closeSheet();
      await afterMutation('Not oluşturuldu');
    }
  }

  async function handleClick(event) {
    const actionTarget = event.target.closest('[data-action]');
    if (!actionTarget) return;
    const action = actionTarget.getAttribute('data-action');
    if (action === 'close-sheet') return closeSheet();
    if (action === 'new-todo') return openSheet('Yeni Görev', newTodoForm());
    if (action === 'new-note') return openSheet('Yeni Not', newNoteForm(state.snapshot, actionTarget.getAttribute('data-subcategory-id')));
    if (action === 'adjust-importance') {
      const input = document.getElementById(actionTarget.getAttribute('data-importance-target'));
      if (!input) return;
      input.value = String(normalizeImportance(Number(input.value) + Number(actionTarget.getAttribute('data-importance-delta') || 0)));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (action === 'set-today-filter') {
      state.todayFilter = actionTarget.getAttribute('data-filter-value') || 'all';
      return renderCurrentRoute();
    }
    if (action === 'clear-filters') {
      state.filters = { search: '', status: 'all', importance: 'all', deadline: 'all' };
      return renderCurrentRoute();
    }
    if (action === 'toggle-completion') {
      const id = actionTarget.getAttribute('data-note-id');
      const note = state.snapshot.notes.find(function find(item) { return String(item.id) === String(id); });
      if (!note || actionTarget.disabled) return;
      const nextStatus = nextCompletionStatus(note);
      repository.updateNote(id, { status: nextStatus });
      await animateCompletion(actionTarget, nextStatus === 'done');
      return afterMutation(note.status === 'done' ? 'Görev yeniden aktifleştirildi' : 'Görev tamamlandı');
    }
    if (action === 'archive-note') {
      repository.updateNote(actionTarget.getAttribute('data-note-id'), { status: 'archived' });
      globalScope.location.hash = '#/notes';
      return afterMutation('Not arşivlendi');
    }
    if (action === 'delete-note') {
      if (typeof globalScope.confirm === 'function' && !globalScope.confirm('Bu not silinsin mi?')) return;
      repository.deleteNote(actionTarget.getAttribute('data-note-id'));
      globalScope.location.hash = '#/notes';
      return afterMutation('Not silindi');
    }
    if (action === 'retry-stats') { state.stats = { status: 'idle', data: null, error: null }; return loadStatistics(); }
  }

  function scheduleAutosave(form) {
    clearTimeout(autosaveTimer);
    state.autosave = 'Kaydediliyor…';
    const output = document.getElementById('autosave-state');
    if (output) output.textContent = state.autosave;
    autosaveTimer = setTimeout(async function saveDetail() {
      const values = new FormData(form);
      const patch = {
        tip: values.get('tip'),
        description: values.get('description'),
        status: values.get('status'),
        importance: Number(values.get('importance')),
        deadline: values.get('deadline') || null,
        category_id: values.get('category_id'),
        subcategory_id: values.get('subcategory_id')
      };
      try {
        repository.updateNote(form.getAttribute('data-note-id'), patch);
        state.snapshot = await repository.getSnapshot();
        state.autosave = 'Kaydedildi';
      } catch (error) {
        state.autosave = 'Kaydetme hatası: ' + error.message;
      }
      const current = document.getElementById('autosave-state');
      if (current) current.textContent = state.autosave;
    }, 650);
  }

  function handleInput(event) {
    if (event.target.matches && event.target.matches('[data-importance-slider]')) syncImportanceControl(event.target, true);
    const filter = event.target.getAttribute && event.target.getAttribute('data-filter');
    if (filter) {
      state.filters[filter] = event.target.value;
      if (filter === 'search') renderCurrentRoute();
      return;
    }
    if (event.target.matches && event.target.matches('[data-note-field]')) {
      const form = event.target.closest('#note-detail-form');
      if (form) scheduleAutosave(form);
    }
  }

  function handleChange(event) {
    if (event.target.matches && event.target.matches('[data-importance-slider]')) syncImportanceControl(event.target, true);
    const filter = event.target.getAttribute && event.target.getAttribute('data-filter');
    if (filter) {
      state.filters[filter] = event.target.value;
      return renderCurrentRoute();
    }
    if (event.target.matches && event.target.matches('[data-note-field]')) {
      const form = event.target.closest('#note-detail-form');
      if (form) scheduleAutosave(form);
    }
  }

  async function boot() {
    screen = document.getElementById('screen');
    sheet = document.getElementById('bottom-sheet');
    sheetContent = document.getElementById('sheet-content');
    sheetTitle = document.getElementById('sheet-title');
    sheetBackdrop = document.getElementById('sheet-backdrop');
    toast = document.getElementById('toast');
    repository = new RepositoryModule.LocalMobileRepository();
    try {
      await refreshSnapshot();
    } catch (error) {
      state.snapshot = RepositoryModule.createSeed();
      showToast('Yerel veri yüklenemedi; güvenli başlangıç verisi açıldı.');
    }
    screen.addEventListener('click', handleClick);
    screen.addEventListener('submit', handleSubmit);
    screen.addEventListener('input', handleInput);
    screen.addEventListener('change', handleChange);
    sheet.addEventListener('click', handleClick);
    sheet.addEventListener('submit', handleSubmit);
    sheet.addEventListener('input', handleInput);
    sheet.addEventListener('change', handleChange);
    sheetBackdrop.addEventListener('click', closeSheet);
    globalScope.addEventListener('hashchange', renderCurrentRoute);
    if (!globalScope.location.hash) globalScope.location.hash = '#/today';
    await renderCurrentRoute();
  }

  return {
    ROUTES: ROUTES,
    parseRoute: parseRoute,
    routeHash: routeHash,
    activeTabForRoute: activeTabForRoute,
    renderScreen: renderScreen,
    renderToday: renderToday,
    renderNotes: renderNotes,
    renderSubcategory: renderSubcategory,
    renderNoteDetail: renderNoteDetail,
    renderStats: renderStats,
    renderAccount: renderAccount,
    dashboardHeader: dashboardHeader,
    importanceControl: importanceControl,
    normalizeImportance: normalizeImportance,
    filterTodayNotes: filterTodayNotes,
    nextCompletionStatus: nextCompletionStatus,
    newTodoForm: newTodoForm,
    boot: boot,
    state: state
  };
});
