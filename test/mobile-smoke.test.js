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
    '#/plan': ['plan', null],
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
    [App.parseRoute('#/plan'), { stats: { status: 'idle' } }, ['Günün Planı', 'SU TÜKETİMİ', 'Saatli notlar', 'Plan blokları']],
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
  assert.match(form, /name="deadline_date"[^>]*type="date"/);
  assert.match(form, /name="deadline_time"[^>]*type="time"/);
});

test('not detayında tarih ve isteğe bağlı saat ayrı alanlardır', function () {
  const timedSnapshot = Object.assign({}, snapshot, {
    notes: snapshot.notes.map(function timed(note) { return note.id === 'note-2' ? Object.assign({}, note, { deadline: '2026-07-14T09:35' }) : note; })
  });
  const detail = App.renderNoteDetail(timedSnapshot, 'note-2');
  assert.match(detail, /name="deadline_date"[^>]*value="2026-07-14"[^>]*data-note-field/);
  assert.match(detail, /name="deadline_time"[^>]*value="09:35"[^>]*data-note-field/);
  assert.match(detail, /Saat boşsa not çarkta pin olarak gösterilmez/);
});

test('Plan v1 verisi v2 anahtarına migrate olur ve yerel gün değişiminde yalnız su sıfırlanır', function () {
  const storage = Repository.createMemoryStorage();
  storage.setItem(App.LEGACY_PLAN_STORAGE_KEY, JSON.stringify({
    date: '2026-07-14', goal: 2400, water: 1250,
    activities: [
      { title: 'Uyku', start: 23, end: 7, color: '#7b87d8' },
      { title: 'Spor', start: 15.5, end: 16.5, color: '#ee8b55' }
    ]
  }));
  const migrated = App.loadPlanState(storage, new Date(2026, 6, 14, 12, 0));
  assert.equal(migrated.version, 2);
  assert.equal(migrated.goalMl, 2400);
  assert.equal(migrated.waterMl, 1250);
  assert.deepEqual(migrated.sleep, { start: '23:00', end: '07:00' });
  assert.equal(migrated.activities[0].start, '15:30');
  assert.equal(migrated.selectedAmountMl, 250);
  assert.ok(storage.getItem(App.PLAN_STORAGE_KEY));

  const nextDay = App.loadPlanState(storage, new Date(2026, 6, 15, 0, 5));
  assert.equal(nextDay.waterMl, 0);
  assert.equal(nextDay.goalMl, 2400);
  assert.equal(nextDay.activities[0].title, 'Spor');
});

test('su presetleri, 2x üstü sayı ve hedef küçültme davranışı korunur', function () {
  const plan = App.normalizePlanState({ date: '2026-07-14', goalMl: 2000, waterMl: 3900, selectedAmountMl: 500, sleep: { start: '23:00', end: '07:00' }, activities: [] }, new Date(2026, 6, 14));
  assert.deepEqual(App.PLAN_PRESETS, [100, 250, 500]);
  assert.equal(plan.selectedAmountMl, 500);
  assert.equal(App.adjustPlanWater(plan, 500).waterMl, 4400);
  assert.equal(App.adjustPlanWater(plan, -5000).waterMl, 0);
  assert.equal(App.updatePlanGoal(Object.assign({}, plan, { waterMl: 4400 }), 1500).waterMl, 3000);
  const cappedWheel = App.planWheel({ notes: [] }, Object.assign({}, plan, { waterMl: 4400 }), new Date(2026, 6, 14));
  const basePath = cappedWheel.match(/class="wheel-water" d="([^"]+)"/)[1];
  const overPath = cappedWheel.match(/class="wheel-over" d="([^"]+)"/)[1];
  assert.equal((basePath.match(/ A /g) || []).length, 2);
  assert.equal((overPath.match(/ A /g) || []).length, 2);
});

test('Plan çarkı yalnız aynı yerel gündeki saatli notu doğru saate ve detay routeuna bağlar', function () {
  const now = new Date(2026, 6, 14, 12, 0);
  const pinSnapshot = Object.assign({}, snapshot, { notes: [
    { id: 'today-pin', tip: 'Bugünkü pin', status: 'active', deadline: '2026-07-14T06:30' },
    { id: 'date-only', tip: 'Tarihli', status: 'active', deadline: '2026-07-14' },
    { id: 'tomorrow-pin', tip: 'Yarınki pin', status: 'active', deadline: '2026-07-15T06:30' }
  ] });
  const plan = App.normalizePlanState({ date: '2026-07-14', sleep: { start: '23:30', end: '07:30' }, activities: [] }, now);
  assert.deepEqual(App.timedNotesForDay(pinSnapshot, now).map(function ids(note) { return note.id; }), ['today-pin']);
  const wheel = App.planWheel(pinSnapshot, plan, now);
  assert.match(wheel, /href="#\/note\/today-pin"/);
  assert.match(wheel, /data-note-id="today-pin"/);
  assert.doesNotMatch(wheel, /date-only|tomorrow-pin/);
  assert.match(wheel, /x1="255\.18"/);
});

test('Plan çarkı ortak saat açısıyla 00 üstte, saat yönünde ve gerçek saat sınırlarında çizilir', function () {
  const epsilon = 1e-10;
  assert.ok(Math.abs(App.hourToAngle(0) + Math.PI / 2) < epsilon);
  assert.ok(Math.abs(App.hourToAngle(6)) < epsilon);
  assert.ok(Math.abs(App.hourToAngle(12) - Math.PI / 2) < epsilon);
  assert.ok(Math.abs(App.hourToAngle(18) - Math.PI) < epsilon);
  assert.deepEqual(App.polarPoint(160, 160, 100, 0), { x: 160, y: 60 });
  assert.deepEqual(App.polarPoint(160, 160, 100, 6), { x: 260, y: 160 });
  assert.deepEqual(App.splitHourRange(13, 14), [{ start: 13, end: 14 }]);
  assert.deepEqual(App.splitHourRange(15, 16), [{ start: 15, end: 16 }]);
  assert.deepEqual(App.splitHourRange(23, 7), [{ start: 23, end: 24 }, { start: 0, end: 7 }]);

  const plan = App.normalizePlanState({
    date: '2026-07-14',
    sleep: { start: '23:00', end: '07:00' },
    activities: [
      { id: 'lunch', title: 'Öğle', start: '13:00', end: '14:00', category: 'food' },
      { id: 'sport', title: 'Spor', start: '15:00', end: '16:00', category: 'health' }
    ]
  }, new Date(2026, 6, 14));
  const wheel = App.planWheel({ notes: [] }, plan, new Date(2026, 6, 14, 12, 0));
  assert.equal((wheel.match(/data-hour-label=/g) || []).length, 24);
  assert.match(wheel, /data-activity-id="sleep"[\s\S]*data-start-hour="23" data-end-hour="24"[\s\S]*data-start-hour="0" data-end-hour="7"/);
  assert.match(wheel, /data-activity-id="lunch"[\s\S]*data-start-hour="13" data-end-hour="14"/);
  assert.match(wheel, /data-activity-id="sport"[\s\S]*data-start-hour="15" data-end-hour="16"/);
  assert.equal((wheel.match(/A 113 113/g) || []).length, 4);
  assert.ok(wheel.includes(App.arcPath(160, 160, App.WHEEL_GEOMETRY.segmentRadius, 13, 14)));
  assert.ok(wheel.includes(App.arcPath(160, 160, App.WHEEL_GEOMETRY.segmentRadius, 15, 16)));
});

test('Plan içi su aksiyonları route renderı yerine kısmi DOM güncellemesi ve scroll koruması kullanır', function () {
  const root = path.resolve(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'src', 'js', 'mobile.js'), 'utf8');
  const waterActions = source.match(/if \(action === 'water-cycle'\)[\s\S]*?if \(action === 'water-goal'\)/)[0];
  assert.match(waterActions, /updatePlanWaterView\(plan\)/);
  assert.doesNotMatch(waterActions, /renderCurrentRoute|location\.(?:hash|reload|assign|replace)/);
  assert.doesNotMatch(source, /location\.reload\s*\(/);
  assert.match(source, /const scrollTop = screen\.scrollTop;[\s\S]*currentContent\.replaceWith\(nextContent\);[\s\S]*screen\.scrollTop = scrollTop;/);
  const rendered = App.renderPlan(snapshot, new Date(2026, 6, 14, 12, 0));
  const buttons = rendered.match(/<button\b[^>]*>/g) || [];
  assert.ok(buttons.length > 0);
  buttons.forEach(function hasSafeType(button) { assert.match(button, /type="(?:button|submit)"/); });
});

test('Plan uyku, aktivite ve su hedefi düzenleme formları bottom sheet sözleşmesine uygundur', function () {
  const plan = App.normalizePlanState({ date: '2026-07-14', sleep: { start: '23:30', end: '07:30' }, activities: [{ id: 'a1', title: 'Odak', start: '09:15', end: '10:45', category: 'work' }] }, new Date(2026, 6, 14));
  assert.match(App.planSleepForm(plan), /data-form="plan-sleep"/);
  assert.match(App.planSleepForm(plan), /value="23:30"/);
  assert.match(App.planActivityForm(plan, 'a1'), /data-form="plan-activity"/);
  assert.match(App.planActivityForm(plan, 'a1'), /data-action="delete-plan-activity"/);
  assert.match(App.waterGoalForm(plan), /data-form="water-goal"/);
  const rendered = App.renderPlan(snapshot, new Date(2026, 6, 14, 12, 0));
  assert.match(rendered, /data-action="edit-plan-sleep"/);
  assert.match(rendered, /data-action="new-plan-activity"/);
  assert.match(rendered, /aria-pressed="true">250 ml/);
  assert.match(rendered, /SU TÜKETİMİ/);
  assert.match(rendered, /gün \/ 2\.00 L hedef/);
  assert.match(rendered, /class="card plan-legend-card"/);
  assert.match(rendered, /class="water-goal-button"/);
  assert.match(rendered, /class="wheel-water-level" transform="translate\(0 /);
  assert.equal((rendered.match(/class="wheel-wave-layer/g) || []).length, 2);
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
  assert.match(html, /<span class="nav-label">Anasayfa<\/span>/);
  assert.doesNotMatch(html, /aria-label="Bugün"|>Bugün<\/span>/);
  assert.match(html, /Notlar/);
  assert.match(html, /Plan/);
  assert.match(html, /İstatistikler/);
  assert.match(html, /Hesap/);
  assert.equal((html.match(/class="nav-icon"/g) || []).length, 5);
  ['home', 'file-text', 'clock', 'chart', 'user'].forEach(function hasNavIcon(icon) { assert.match(html, new RegExp('href="#icon-' + icon + '"')); });
  assert.doesNotMatch(html, /⌂|▤|◷|▥/);
  assert.doesNotMatch(html, /Ayarlar/);
  const renderedStats = App.renderStats(snapshot, { status: 'ready', data: Domain.buildStatistics(snapshot, new Date()) });
  assert.doesNotMatch(renderedStats, /Aylık/);
  assert.equal((renderedStats.match(/class="stat-icon /g) || []).length, 4);
  ['check-circle', 'pause-circle', 'calendar-clock', 'activity'].forEach(function hasStatIcon(icon) { assert.match(renderedStats, new RegExp('href="#icon-' + icon + '"')); });
  assert.match(renderedStats, /stat-label">Tamamlanan/);
  assert.match(renderedStats, /stat-label">Duraklatılan/);
  assert.match(renderedStats, /stat-label">Deadline yaklaşan/);
  assert.match(renderedStats, /stat-label">Aktif/);
});

test('navigation ve özet ikonları aynı outline ölçü ve stroke sözleşmesini kullanır', function () {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'src', 'mobile.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src', 'styles', 'mobile.css'), 'utf8');
  assert.equal((html.match(/class="nav-icon" viewBox="0 0 24 24" width="21" height="21"/g) || []).length, 5);
  assert.match(html, /class="icon-sprite" width="0" height="0"/);
  assert.match(css, /\.bottom-nav > a > svg\.nav-icon[^}]*width:\s*21px[^}]*max-width:\s*21px[^}]*height:\s*21px[^}]*max-height:\s*21px[^}]*stroke-width:\s*1\.8/s);
  assert.match(css, /\.stat-icon[^}]*width:\s*17px[^}]*height:\s*17px[^}]*stroke-width:\s*1\.8/s);
  assert.match(css, /\.bottom-nav > a[^}]*width:\s*100%[^}]*min-height:\s*58px[^}]*gap:\s*4px/s);
  assert.match(css, /\.nav-label[^}]*text-overflow:\s*ellipsis/s);
  assert.doesNotMatch(css, /\.bottom-nav a\[aria-current="page"\] \.nav-icon[^}]*scale\(/s);
});

test('scroll güvenli alanı son görev ve FAB için bottom navigation yüksekliğini aşar', function () {
  const root = path.resolve(__dirname, '..');
  const css = fs.readFileSync(path.join(root, 'src', 'styles', 'mobile.css'), 'utf8');
  assert.match(css, /--content-bottom-clearance:\s*calc\(var\(--fab-size\).*var\(--fab-gap\)/);
  assert.match(css, /padding-bottom:\s*calc\(var\(--nav-height\).*var\(--content-bottom-clearance\)\)/);
  assert.match(css, /scroll-padding-bottom:\s*calc\(var\(--nav-height\).*var\(--content-bottom-clearance\)\)/);
  assert.match(css, /\.fab[^}]*bottom:\s*calc\(var\(--nav-height\)/s);
  assert.doesNotMatch(css, /100vw/);
  assert.match(css, /\.fab[^}]*right:\s*max\(var\(--fab-gap\),\s*calc\(\(100% - 480px\)/s);
  assert.match(css, /\.fab-icon[^}]*width:\s*24px[^}]*max-width:\s*24px[^}]*height:\s*24px[^}]*max-height:\s*24px/s);
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
