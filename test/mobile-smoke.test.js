'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Domain = require('../src/js/mobile-domain.js');
const Repository = require('../src/js/mobile-repository.js');
const App = require('../src/js/mobile.js');

const snapshot = Repository.createSeed();

test('navigation route parser tüm mobil ekranları çözer', function () {
  const cases = {
    '#/today': ['today', null],
    '#/notes': ['notes', null],
    '#/stats': ['stats', null],
    '#/account': ['account', null],
    '#/subcategory/sub-launch': ['subcategory', 'sub-launch'],
    '#/note/note-2': ['note', 'note-2']
  };
  Object.entries(cases).forEach(function verify(entry) {
    const route = App.parseRoute(entry[0]);
    assert.deepEqual([route.name, route.id], entry[1]);
  });
  assert.equal(App.parseRoute('#/unknown').name, 'today');
  assert.equal(App.parseRoute('#/popup').name, 'today');
});

test('Anasayfa, Notlar, alt kategori, detay, haftalık stats ve hesap ekranları render olur', function () {
  const stats = Domain.buildStatistics(snapshot, new Date());
  const screens = [
    [App.parseRoute('#/today'), { stats: { status: 'idle' } }, ['Anasayfa', 'Hızlı not', 'Tümü', 'Aktif', 'Tamamlanan', 'Deadline yaklaşanlar', 'Haftalık ilerleme']],
    [App.parseRoute('#/notes'), { stats: { status: 'idle' } }, ['Notlar', 'Durum filtresi', 'Sıralı']],
    [App.parseRoute('#/subcategory/sub-launch'), { stats: { status: 'idle' } }, ['Mobil Lansman', 'Aktif adım', 'Ortak deadline', 'Kilitli']],
    [App.parseRoute('#/note/note-2'), { stats: { status: 'idle' } }, ['Not Detayı', 'Açıklama', 'Kaydedildi', 'Arşivle']],
    [App.parseRoute('#/stats'), { stats: { status: 'ready', data: stats } }, ['Yalnız haftalık görünüm', 'Duraklatma trendi', 'Kategori dağılımı']],
    [App.parseRoute('#/account'), { stats: { status: 'idle' } }, ['Hesap özellikleri yakında', 'login, profil, sync']]
  ];
  screens.forEach(function renderCase(entry) {
    const html = App.renderScreen(entry[0], snapshot, entry[1]);
    entry[2].forEach(function contains(text) { assert.match(html, new RegExp(text, 'i')); });
  });
});

test('progress ring, yüzde ve bar aynı normalize edilmiş değeri kullanır', function () {
  const progressSnapshot = Object.assign({}, snapshot, {
    notes: [
      { id: 'p1', category_id: 'cat-tasks', subcategory_id: 'sub-todo', tip: 'Tamam', status: 'done', importance: 5, order_index: 0, completed_at: new Date().toISOString() },
      { id: 'p2', category_id: 'cat-tasks', subcategory_id: 'sub-todo', tip: 'Aktif', status: 'active', importance: 5, order_index: 1 }
    ]
  });
  const html = App.renderToday(progressSnapshot);
  assert.match(html, /data-progress="50"/);
  assert.match(html, /İlerleme yüzde 50/);
  assert.match(html, /stroke-dashoffset="50"/);
  assert.match(html, /aria-valuenow="50"/);
  assert.match(html, /style="width:50%"/);
  assert.match(html, /1\/2 tamamlandı/);
  assert.match(html, />1<\/strong><span>Bitti/);
  assert.doesNotMatch(html, /Günün odak notu|focus-card/i);
});

test('görev filtreleri ve completion checkbox gerçek status state kullanır', function () {
  assert.deepEqual(App.filterTodayNotes(snapshot.notes, 'active').every(function active(note) { return note.status === 'active'; }), true);
  assert.deepEqual(App.filterTodayNotes(snapshot.notes, 'done').every(function done(note) { return note.status === 'done'; }), true);
  assert.equal(App.nextCompletionStatus({ status: 'active' }), 'done');
  assert.equal(App.nextCompletionStatus({ status: 'done' }), 'active');

  App.state.todayFilter = 'all';
  const html = App.renderToday(snapshot);
  assert.match(html, /class="completion-checkbox"[^>]*data-note-id="note-1"[^>]*checked/);
  assert.match(html, /class="completion-checkbox"[^>]*data-note-id="note-2"/);
  assert.match(html, /class="completion-checkbox"[^>]*data-note-id="note-3"[^>]*disabled/);
  assert.match(html, /note-row completed/);
  assert.match(html, /class="note-title">Mobil veri modelini doğrula/);
  assert.doesNotMatch(html, /chevron-link|>›</);
  assert.equal(App.filterTodayNotes(snapshot.notes, 'all').length, Domain.getTaskProgress(snapshot.notes).total);

  const unlockedSnapshot = Object.assign({}, snapshot, {
    notes: snapshot.notes.map(function unlock(note) { return note.id === 'note-2' ? Object.assign({}, note, { status: 'done' }) : note; })
  });
  const sequentialHtml = App.renderSubcategory(unlockedSnapshot, 'sub-launch');
  const androidCheckbox = sequentialHtml.match(/<input class="completion-checkbox"[^>]*data-note-id="note-3"[^>]*>/)[0];
  assert.doesNotMatch(androidCheckbox, /disabled/);
});

test('hızlı görev formu kategori seçtirmeden Yapılacaklar hedefini gösterir', function () {
  const form = App.newTodoForm();
  assert.match(form, /data-form="new-todo"/);
  assert.match(form, /Yapılacaklar/);
  assert.match(form, /id="todo-importance"[^>]*type="range"[^>]*min="1"[^>]*max="10"/);
  assert.match(form, /data-action="adjust-importance"/);
  assert.match(form, /data-importance-output[^>]*>5</);
  assert.doesNotMatch(form, /name="importance"[^>]*type="number"/);
  assert.doesNotMatch(form, /name="subcategory_id"|<select/i);
});

test('importance slider ve mikro animasyonlar erişilebilir/reduced-motion uyumludur', function () {
  const detail = App.renderNoteDetail(snapshot, 'note-2');
  assert.match(detail, /id="detail-importance"[^>]*type="range"[^>]*data-note-field/);
  assert.match(detail, /aria-valuetext="9 \/ 10"/);
  assert.match(detail, /aria-label="Importance azalt"/);
  assert.match(detail, /aria-label="Importance artır"/);
  assert.equal(App.normalizeImportance(0), 1);
  assert.equal(App.normalizeImportance(7.4), 7);
  assert.equal(App.normalizeImportance(99), 10);

  const root = path.resolve(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'src', 'js', 'mobile.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src', 'styles', 'mobile.css'), 'utf8');
  assert.match(source, /sheet\.addEventListener\('input', handleInput\)/);
  assert.match(source, /sheet\.addEventListener\('change', handleChange\)/);
  assert.match(css, /\.completion-check path[^}]*stroke-dasharray:\s*1[^}]*stroke-dashoffset:\s*1/s);
  assert.match(css, /\.completion-checkbox:checked \+ \.completion-check path[^}]*stroke-dashoffset:\s*0/s);
  assert.match(css, /@keyframes completion-pulse/);
  assert.match(css, /@keyframes ring-progress/);
  assert.match(css, /@keyframes content-enter/);
  assert.match(css, /\.fab:active[^}]*scale\(\.91\)/s);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*animation-iteration-count:\s*1\s*!important/);
});

test('istatistik loading, empty ve error state ekranları ayrı render edilir', function () {
  const route = App.parseRoute('#/stats');
  assert.match(App.renderScreen(route, snapshot, { stats: { status: 'loading' } }), /skeleton/);
  assert.match(App.renderScreen(route, snapshot, { stats: { status: 'empty', data: { empty: true } } }), /Bu hafta veri yok/);
  assert.match(App.renderScreen(route, snapshot, { stats: { status: 'error', error: 'statistics-query-failed' } }), /İstatistikler yüklenemedi/);
});

test('mobil entrypoint plan dahil beş alt navigation sekmesi içerir; ayarlar ve aylık istatistik içermez', function () {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'src', 'mobile.html'), 'utf8');
  assert.equal((html.match(/data-nav=/g) || []).length, 5);
  assert.match(html, /aria-label="Anasayfa"/);
  assert.match(html, /<span>Anasayfa<\/span>/);
  assert.doesNotMatch(html, /aria-label="Bugün"|<span>Bugün<\/span>/);
  assert.match(html, /Notlar/);
  assert.match(html, /Plan/);
  assert.match(html, /İstatistikler/);
  assert.match(html, /Hesap/);
  assert.doesNotMatch(html, /Ayarlar/);
  assert.doesNotMatch(App.renderStats(snapshot, { status: 'ready', data: Domain.buildStatistics(snapshot, new Date()) }), /Aylık/);
});

test('scroll güvenli alanı son görev ve FAB için bottom navigation yüksekliğini aşar', function () {
  const root = path.resolve(__dirname, '..');
  const css = fs.readFileSync(path.join(root, 'src', 'styles', 'mobile.css'), 'utf8');
  assert.match(css, /--scroll-safe-bottom:\s*112px/);
  assert.match(css, /padding-bottom:\s*calc\(var\(--nav-height\).*var\(--scroll-safe-bottom\)\)/);
  assert.match(css, /scroll-padding-bottom:\s*calc\(var\(--nav-height\).*var\(--scroll-safe-bottom\)\)/);
  assert.match(css, /\.fab[^}]*bottom:\s*calc\(var\(--nav-height\)/s);
});

test('mobil runtime popup, event, snooze, budget, ayar veya ses sistemi içermez', function () {
  const root = path.resolve(__dirname, '..');
  const mobileSource = [
    fs.readFileSync(path.join(root, 'src', 'js', 'mobile.js'), 'utf8'),
    fs.readFileSync(path.join(root, 'src', 'js', 'mobile-domain.js'), 'utf8'),
    fs.readFileSync(path.join(root, 'src', 'js', 'mobile-repository.js'), 'utf8'),
    fs.readFileSync(path.join(root, 'src', 'mobile.html'), 'utf8')
  ].join('\n');
  [
    /#\/popup/i,
    /popup/i,
    /chess|satranç/i,
    /wordle/i,
    /math-answer|matematik eventi/i,
    /hold-button|hold to dismiss/i,
    /snooze/i,
    /maxPopupsPerHour|hourly-budget|popupBudget/i,
    /new\s+Audio\s*\(/,
    /\.play\s*\(/,
    /LocalNotifications/,
    /Ayarlar/
  ].forEach(function forbidden(pattern) { assert.doesNotMatch(mobileSource, pattern); });
});
