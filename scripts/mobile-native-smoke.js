#!/usr/bin/env node

/* eslint-disable no-console */

const port = process.env.NOTEZ_CDP_PORT || '9222';
const targetListUrl = `http://127.0.0.1:${port}/json`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function connect() {
  let target = null;
  for (let attempt = 0; attempt < 50 && !target; attempt += 1) {
    try {
      const targets = await fetch(targetListUrl).then((response) => response.json());
      target = targets.find((item) => item.type === 'page' && item.title === 'NoteZ Mobile');
    } catch (error) {
      if (attempt === 49) throw error;
    }
    if (!target) await delay(100);
  }
  assert(target && target.webSocketDebuggerUrl, 'NoteZ Mobile WebView debug target bulunamadı.');

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;

  socket.addEventListener('message', async (event) => {
    const payload = typeof event.data === 'string' ? event.data : await event.data.text();
    const message = JSON.parse(payload);
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });

  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  function send(method, params = {}) {
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  }

  return { socket, evaluate, send };
}

async function main() {
  const client = await connect();
  const { evaluate, send } = client;

  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true
  });

  let readyHeading = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    readyHeading = await evaluate(`document.querySelector('h1')?.textContent.trim() || null`);
    if (readyHeading === 'Anasayfa') break;
    await delay(100);
  }
  assert(readyHeading === 'Anasayfa', 'Anasayfa açılmadı.');

  const initial = await evaluate(`(() => ({
    heading: document.querySelector('h1')?.textContent.trim(),
    ring: document.querySelector('.progress-ring-wrap strong')?.textContent.trim(),
    percent: document.querySelector('.progress-summary strong')?.textContent.trim(),
    bar: document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow'),
    summary: document.querySelector('.progress-summary')?.textContent.trim(),
    total: document.querySelector('.result-count')?.textContent.trim(),
    nav: [...document.querySelectorAll('.bottom-nav a')].map((item) => item.getAttribute('aria-label')),
    checkboxCount: document.querySelectorAll('.task-list .completion-checkbox').length,
    nextStepLocked: [...document.querySelectorAll('.task-list .note-row')].find((row) => row.querySelector('.note-title')?.textContent.includes('Android debug build al'))?.querySelector('.completion-checkbox')?.disabled,
    body: document.body.innerText
  }))()`);

  assert(initial.heading === 'Anasayfa', 'Anasayfa başlangıç state’i kayboldu.');
  assert(initial.ring === '14%' && initial.percent === '14%' && initial.bar === '14', 'İlerleme kaynakları başlangıçta senkron değil.');
  assert(initial.summary.includes('1/7') && initial.total === '7 görev', 'Başlangıç görev sayıları yanlış.');
  assert(initial.nav.join('|') === 'Anasayfa|Notlar|Plan|İstatistikler|Hesap', 'Alt navigasyon etiketleri yanlış.');
  assert(initial.checkboxCount === 7 && initial.nextStepLocked === true, 'Checkbox veya sıralı başlangıç kilidi yanlış.');
  assert(initial.body.includes('Deadline geçti'), 'Geçmiş deadline görünmüyor.');
  assert(initial.body.includes('Ortak · 2 gün kaldı'), 'Ortak deadline görünmüyor.');

  await evaluate(`(() => {
    const input = document.querySelector('[data-form="quick-add"] input[name="tip"]');
    input.value = 'NativeSmoke';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.closest('form').requestSubmit();
  })()`);
  await delay(150);

  const created = await evaluate(`(() => {
    const row = [...document.querySelectorAll('.task-list .note-row')].find((item) => item.querySelector('.note-title')?.textContent === 'NativeSmoke');
    return {
      exists: Boolean(row),
      category: [...(row?.querySelectorAll('.badge') || [])].map((item) => item.textContent.trim()),
      total: document.querySelector('.result-count')?.textContent.trim()
    };
  })()`);
  assert(created.exists && created.category.includes('Görevler') && created.total === '8 görev', 'Hızlı görev Yapılacaklar hedefine eklenmedi.');

  const completionAnimationStart = await evaluate(`(() => {
    const row = [...document.querySelectorAll('.task-list .note-row')].find((item) => item.querySelector('.note-title')?.textContent === 'NativeSmoke');
    const checkbox = row.querySelector('.completion-checkbox');
    checkbox.click();
    return { checked: checkbox.checked, transitioning: row.classList.contains('completion-transitioning'), busy: row.getAttribute('aria-busy') };
  })()`);
  assert(completionAnimationStart.checked && completionAnimationStart.transitioning && completionAnimationStart.busy === 'true', 'Completion ileri animasyonu başlamadı.');
  await delay(400);

  const completed = await evaluate(`(() => {
    const row = [...document.querySelectorAll('.task-list .note-row')].find((item) => item.querySelector('.note-title')?.textContent === 'NativeSmoke');
    return {
      checked: row?.querySelector('.completion-checkbox')?.checked,
      decoration: getComputedStyle(row?.querySelector('.note-title')).textDecorationLine,
      ring: document.querySelector('.progress-ring-wrap strong')?.textContent.trim(),
      percent: document.querySelector('.progress-summary strong')?.textContent.trim(),
      bar: document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')
    };
  })()`);
  assert(completed.checked && completed.decoration.includes('line-through'), 'Tamamlama checkbox veya görsel durumu güncellenmedi.');
  assert(completed.ring === '25%' && completed.percent === '25%' && completed.bar === '25', 'Tamamlama sonrası ilerleme kaynakları senkron değil.');

  const reverseAnimationStart = await evaluate(`(() => {
    const row = [...document.querySelectorAll('.task-list .note-row')].find((item) => item.querySelector('.note-title')?.textContent === 'NativeSmoke');
    const checkbox = row.querySelector('.completion-checkbox');
    checkbox.click();
    return { checked: checkbox.checked, transitioning: row.classList.contains('completion-transitioning'), busy: row.getAttribute('aria-busy') };
  })()`);
  assert(!reverseAnimationStart.checked && reverseAnimationStart.transitioning && reverseAnimationStart.busy === 'true', 'Completion ters animasyonu başlamadı.');
  await delay(400);
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('.task-list .note-row')].find((item) => item.querySelector('.note-title')?.textContent === 'NativeSmoke');
    row.querySelector('.completion-checkbox').click();
  })()`);
  await delay(400);

  await evaluate(`(() => {
    const row = [...document.querySelectorAll('.task-list .note-row')].find((item) => item.querySelector('.note-title')?.textContent.includes('Navigation smoke testini'));
    row.querySelector('.completion-checkbox').click();
  })()`);
  await delay(400);

  const unlocked = await evaluate(`(() => {
    const row = [...document.querySelectorAll('.task-list .note-row')].find((item) => item.querySelector('.note-title')?.textContent.includes('Android debug build al'));
    return { disabled: row?.querySelector('.completion-checkbox')?.disabled, lockedBadge: [...(row?.querySelectorAll('.badge') || [])].some((item) => item.textContent.trim() === 'Kilitli') };
  })()`);
  assert(unlocked.disabled === false && unlocked.lockedBadge === false, 'Sıralı akış sonraki adımı açmadı.');

  await evaluate(`(() => {
    const row = [...document.querySelectorAll('.task-list .note-row')].find((item) => item.querySelector('.note-title')?.textContent.includes('Android debug build al'));
    row.querySelector('.completion-checkbox').click();
  })()`);
  await delay(400);

  const filters = await evaluate(`(async () => {
    const clickFilter = (label) => [...document.querySelectorAll('.task-filter-tabs button')].find((button) => button.textContent.trim() === label).click();
    clickFilter('Tamamlanan');
    await new Promise((resolve) => setTimeout(resolve, 25));
    const done = { count: document.querySelectorAll('.task-list .note-row').length, allChecked: [...document.querySelectorAll('.task-list .completion-checkbox')].every((item) => item.checked) };
    clickFilter('Aktif');
    await new Promise((resolve) => setTimeout(resolve, 25));
    const active = { count: document.querySelectorAll('.task-list .note-row').length, noneChecked: [...document.querySelectorAll('.task-list .completion-checkbox')].every((item) => !item.checked) };
    clickFilter('Tümü');
    return { done, active };
  })()`);
  assert(filters.done.count === 4 && filters.done.allChecked, 'Tamamlanan filtresi yanlış.');
  assert(filters.active.count === 3 && filters.active.noneChecked, 'Aktif filtresi yanlış.');

  async function route(hash) {
    await evaluate(`location.hash = '${hash}'`);
    await delay(100);
    return evaluate(`({ heading: document.querySelector('h1')?.textContent.trim(), body: document.body.innerText })`);
  }

  const notes = await route('#/notes');
  const noteFilters = await evaluate(`(async () => {
    const search = document.querySelector('[data-filter="search"]');
    search.value = 'Mobil veri';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    const searchCount = document.querySelector('.filters + .note-description')?.textContent.trim();
    const status = document.querySelector('[data-filter="status"]');
    status.value = 'done';
    status.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    const combinedCount = document.querySelector('.filters + .note-description')?.textContent.trim();
    document.querySelector('[data-action="clear-filters"]').click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const clearedCount = document.querySelector('.filters + .note-description')?.textContent.trim();
    return { searchCount, combinedCount, clearedCount };
  })()`);
  const stats = await route('#/stats');
  const account = await route('#/account');
  assert(notes.heading === 'Notlar', 'Notlar ekranı açılmadı.');
  assert(noteFilters.searchCount === '1 eşleşen not' && noteFilters.combinedCount === '1 eşleşen not', 'Not arama/durum filtresi yanlış.');
  assert(/^9 eşleşen not$/.test(noteFilters.clearedCount), 'Not filtrelerini temizleme akışı yanlış.');
  assert(stats.heading === 'İstatistikler' && stats.body.includes('Yalnız haftalık görünüm') && !stats.body.toLocaleLowerCase('tr-TR').includes('aylık'), 'Haftalık istatistik ekranı yanlış.');
  assert(account.heading === 'Hesap' && account.body.toLocaleLowerCase('tr-TR').includes('placeholder'), 'Hesap placeholder ekranı yanlış.');

  await route('#/today');
  const safeArea = await evaluate(`(() => {
    const screen = document.querySelector('.screen');
    const nav = document.querySelector('.bottom-nav');
    return { paddingBottom: parseFloat(getComputedStyle(screen).paddingBottom), navHeight: nav.getBoundingClientRect().height, scrollPaddingBottom: parseFloat(getComputedStyle(screen).scrollPaddingBottom) };
  })()`);
  assert(safeArea.paddingBottom > safeArea.navHeight && safeArea.scrollPaddingBottom > safeArea.navHeight, 'Alt güvenli kaydırma alanı navigasyon yüksekliğini aşmıyor.');

  await evaluate(`document.querySelector('[data-action="new-todo"]').click()`);
  await delay(100);
  const fabForm = await evaluate(`(() => ({
    context: document.querySelector('.bottom-sheet .form-context strong')?.textContent.trim(),
    selectCount: document.querySelectorAll('.bottom-sheet select').length,
    importanceType: document.querySelector('#todo-importance')?.type,
    importanceValue: document.querySelector('[for="todo-importance"][data-importance-output]')?.textContent.trim(),
    stepperCount: document.querySelectorAll('.bottom-sheet [data-action="adjust-importance"]').length
  }))()`);
  assert(fabForm.context === 'Yapılacaklar' && fabForm.selectCount === 0, 'FAB formu Yapılacaklar hedefini sabitlemedi.');
  assert(fabForm.importanceType === 'range' && fabForm.importanceValue === '5' && fabForm.stepperCount === 2, 'FAB importance slider/stepper yanlış.');

  const sliderBounds = await evaluate(`(() => {
    const rect = document.querySelector('#todo-importance').getBoundingClientRect();
    return { left: rect.left, right: rect.right, y: rect.top + (rect.height / 2) };
  })()`);
  const dragStartX = sliderBounds.left + ((sliderBounds.right - sliderBounds.left) * 0.5);
  const dragEndX = sliderBounds.left + ((sliderBounds.right - sliderBounds.left) * 0.8);
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: dragStartX, y: sliderBounds.y, radiusX: 6, radiusY: 6, force: 1, id: 0 }]
  });
  for (let step = 1; step <= 6; step += 1) {
    const x = dragStartX + (((dragEndX - dragStartX) * step) / 6);
    await send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: sliderBounds.y, radiusX: 6, radiusY: 6, force: 1, id: 0 }]
    });
    await delay(20);
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await delay(100);
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  const draggedImportance = await evaluate(`(() => ({
    value: Number(document.querySelector('#todo-importance')?.value),
    output: Number(document.querySelector('[for="todo-importance"][data-importance-output]')?.textContent.trim()),
    aria: document.querySelector('#todo-importance')?.getAttribute('aria-valuetext')
  }))()`);
  assert(
    draggedImportance.value > 5 && draggedImportance.output === draggedImportance.value && draggedImportance.aria === `${draggedImportance.value} / 10`,
    `Importance touch-drag state’i güncellenmedi: ${JSON.stringify({ sliderBounds, draggedImportance })}`
  );

  await evaluate(`(() => {
    const input = document.querySelector('.bottom-sheet [name="tip"]');
    input.value = 'NativeFab';
    input.closest('form').requestSubmit();
  })()`);
  await delay(150);
  const fabCreated = await evaluate(`(() => {
    const row = [...document.querySelectorAll('.task-list .note-row')].find((item) => item.querySelector('.note-title')?.textContent === 'NativeFab');
    return { exists: Boolean(row), category: [...(row?.querySelectorAll('.badge') || [])].map((item) => item.textContent.trim()), total: document.querySelector('.result-count')?.textContent.trim() };
  })()`);
  assert(fabCreated.exists && fabCreated.category.includes('Görevler') && fabCreated.total === '9 görev', 'FAB görevi Yapılacaklar hedefine eklenmedi.');

  await evaluate(`(() => {
    const row = [...document.querySelectorAll('.task-list .note-row')].find((item) => item.querySelector('.note-title')?.textContent === 'NativeFab');
    row.querySelector('.note-main-link').click();
  })()`);
  await delay(100);
  await evaluate(`(() => {
    const title = document.querySelector('#detail-title');
    const description = document.querySelector('#detail-description');
    const importance = document.querySelector('#detail-importance');
    const deadlineDate = document.querySelector('#detail-deadline-date');
    const deadlineTime = document.querySelector('#detail-deadline-time');
    title.value = 'NativeFabEdited';
    description.value = 'Native detail autosave';
    importance.value = '7';
    deadlineDate.value = '2026-07-20';
    deadlineTime.value = '18:45';
    [title, description, importance, deadlineDate, deadlineTime].forEach((control) => control.dispatchEvent(new Event('input', { bubbles: true })));
    document.querySelector('[data-importance-target="detail-importance"][data-importance-delta="1"]').click();
  })()`);
  await delay(800);
  const edited = await evaluate(`(() => ({
    heading: document.querySelector('h1')?.textContent.trim(),
    title: document.querySelector('#detail-title')?.value,
    description: document.querySelector('#detail-description')?.value,
    importance: document.querySelector('#detail-importance')?.value,
    importanceType: document.querySelector('#detail-importance')?.type,
    importanceText: document.querySelector('#detail-importance')?.getAttribute('aria-valuetext'),
    importanceOutput: document.querySelector('[for="detail-importance"][data-importance-output]')?.textContent.trim(),
    deadlineDate: document.querySelector('#detail-deadline-date')?.value,
    deadlineTime: document.querySelector('#detail-deadline-time')?.value,
    autosave: document.querySelector('#autosave-state')?.textContent.trim()
  }))()`);
  assert(edited.heading === 'Not Detayı' && edited.title === 'NativeFabEdited' && edited.description === 'Native detail autosave', 'Not detay düzenleme akışı yanlış.');
  assert(edited.importance === '8' && edited.importanceType === 'range' && edited.importanceText === '8 / 10' && edited.importanceOutput === '8', 'Not importance slider/stepper state’i yanlış.');
  assert(edited.deadlineDate === '2026-07-20' && edited.deadlineTime === '18:45' && edited.autosave === 'Kaydedildi', 'Not detay autosave alanları kaydedilmedi.');

  await evaluate(`document.querySelector('[data-action="archive-note"]').click()`);
  await delay(100);
  const archived = await evaluate(`({ hash: location.hash, body: document.body.innerText })`);
  assert(archived.hash === '#/notes' && !archived.body.includes('NativeFabEdited'), 'Not arşivleme akışı yanlış.');

  await route('#/today');
  await evaluate(`(() => {
    const input = document.querySelector('[data-form="quick-add"] input[name="tip"]');
    input.value = 'NativeDelete';
    input.closest('form').requestSubmit();
  })()`);
  await delay(100);
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('.task-list .note-row')].find((item) => item.querySelector('.note-title')?.textContent === 'NativeDelete');
    row.querySelector('.note-main-link').click();
  })()`);
  await delay(100);
  await evaluate(`(() => {
    window.confirm = () => true;
    document.querySelector('[data-action="delete-note"]').click();
  })()`);
  await delay(100);
  const deleted = await evaluate(`({ hash: location.hash, body: document.body.innerText })`);
  assert(deleted.hash === '#/notes' && !deleted.body.includes('NativeDelete'), 'Not silme akışı yanlış.');

  await route('#/today');
  await evaluate(`document.querySelector('[data-action="new-todo"]').click()`);
  await delay(100);
  await evaluate(`(() => {
    const now = new Date();
    const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
    document.querySelector('.bottom-sheet [name="tip"]').value = 'NativeTimed';
    document.querySelector('.bottom-sheet [name="deadline_date"]').value = date;
    document.querySelector('.bottom-sheet [name="deadline_time"]').value = '06:30';
    document.querySelector('.bottom-sheet form').requestSubmit();
  })()`);
  await delay(150);

  const planScreen = await route('#/plan');
  const planInitial = await evaluate(`(() => {
    const screen = document.querySelector('.screen');
    const navPlan = document.querySelector('[data-nav="plan"]');
    const interactive = [...document.querySelectorAll('.water-presets button, .plan-controls button, .water-action-row button, .plan-task button, .section-head button, .bottom-nav a')].filter((item) => item.getClientRects().length);
    const pin = document.querySelector('.wheel-pin-link');
    return {
      heading: document.querySelector('h1')?.textContent.trim(),
      activeNav: navPlan?.getAttribute('aria-current'),
      width: innerWidth,
      height: innerHeight,
      overflow: screen.scrollWidth - screen.clientWidth,
      minTouch: Math.min(...interactive.map((item) => Math.min(item.getBoundingClientRect().width, item.getBoundingClientRect().height))),
      pinCount: document.querySelectorAll('.wheel-pin-link').length,
      pinHref: pin?.getAttribute('href'),
      pinLabel: pin?.getAttribute('aria-label')
    };
  })()`);
  assert(planScreen.heading === 'Günün Planı' && planInitial.heading === 'Günün Planı' && planInitial.activeNav === 'page', 'Plan route veya aktif sekme açılmadı.');
  assert(planInitial.width === 390 && planInitial.height === 844 && planInitial.overflow <= 0, `390x844 Plan viewport taşması: ${JSON.stringify(planInitial)}`);
  assert(planInitial.minTouch >= 43.9, `Plan dokunma hedefi 44px altında: ${planInitial.minTouch}`);
  assert(planInitial.pinCount === 1 && /^#\/note\//.test(planInitial.pinHref) && planInitial.pinLabel.includes('NativeTimed'), 'Saatli not pini doğru gün veya route ile oluşmadı.');

  await evaluate(`document.querySelector('.wheel-pin-link').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))`);
  await delay(100);
  const pinDetail = await evaluate(`({ hash: location.hash, heading: document.querySelector('h1')?.textContent.trim() })`);
  assert(pinDetail.heading === 'Not Detayı' && /^#\/note\//.test(pinDetail.hash), 'Pin not detayını açmadı.');
  await evaluate(`history.back()`);
  await delay(100);
  const planBack = await evaluate(`({ hash: location.hash, heading: document.querySelector('h1')?.textContent.trim() })`);
  assert(planBack.hash === '#/plan' && planBack.heading === 'Günün Planı', 'Pin detayından geri navigasyon Plan ekranına dönmedi.');
  await evaluate(`history.forward()`);
  await delay(100);
  const planForward = await evaluate(`({ hash: location.hash, heading: document.querySelector('h1')?.textContent.trim() })`);
  assert(/^#\/note\//.test(planForward.hash) && planForward.heading === 'Not Detayı', 'İleri navigasyon not detayını açmadı.');
  await route('#/plan');

  const planMutationBaseline = await evaluate(`(() => {
    const screen = document.querySelector('.screen');
    screen.scrollTop = Math.min(620, screen.scrollHeight - screen.clientHeight);
    window.__planScreenNode = screen;
    window.__planContentNode = document.querySelector('.plan-content');
    return { scrollTop: screen.scrollTop, maxScroll: screen.scrollHeight - screen.clientHeight };
  })()`);
  assert(planMutationBaseline.scrollTop > 0 && planMutationBaseline.maxScroll >= planMutationBaseline.scrollTop, 'Plan scroll regresyon testi için kaydırılamadı.');

  await evaluate(`document.querySelector('[data-action="water-goal"]').click()`);
  await delay(80);
  await evaluate(`(() => { const goal = document.querySelector('.bottom-sheet [name="goal"]'); goal.value = '500'; goal.closest('form').requestSubmit(); })()`);
  await delay(80);
  const goalMutation = await evaluate(`(() => ({
    scrollTop: document.querySelector('.screen').scrollTop,
    sameScreen: window.__planScreenNode === document.querySelector('.screen'),
    sameContent: window.__planContentNode === document.querySelector('.plan-content'),
    sheetClosed: document.querySelector('.bottom-sheet').hidden
  }))()`);
  assert(goalMutation.scrollTop === planMutationBaseline.scrollTop && goalMutation.sameScreen && goalMutation.sameContent && goalMutation.sheetClosed, `Su hedefi değişiminde Plan yeniden render/scroll hatası: ${JSON.stringify(goalMutation)}`);
  await evaluate(`document.querySelector('[data-action="water-cycle"][data-water-step="1"]').click()`);
  await delay(60);
  await evaluate(`document.querySelector('[data-action="water-cycle"][data-water-step="-1"]').click()`);
  await delay(60);
  await evaluate(`document.querySelector('[data-action="water-adjust"][data-water-delta="250"]').click()`);
  await delay(60);
  await evaluate(`document.querySelector('[data-action="water-select"][data-water-value="500"]').click()`);
  await delay(60);
  await evaluate(`document.querySelector('[data-action="water-adjust"][data-water-delta="500"]').click()`);
  await delay(80);
  const waterOver = await evaluate(`(() => ({
    total: document.querySelector('.water-summary strong')?.textContent.trim(),
    status: document.querySelector('.water-summary .note-description')?.textContent.trim(),
    selected: document.querySelector('.water-preset[aria-pressed="true"]')?.textContent.trim(),
    overWidth: document.querySelector('.water-progress.over span')?.style.width,
    scrollTop: document.querySelector('.screen').scrollTop,
    sameScreen: window.__planScreenNode === document.querySelector('.screen'),
    sameContent: window.__planContentNode === document.querySelector('.plan-content'),
    stored: JSON.parse(localStorage.getItem('notez_plan_state_v2'))
  }))()`);
  assert(waterOver.total === '0.75 L' && waterOver.status.includes('ek tüketim ayrı izleniyor') && waterOver.selected === '500 ml', 'Su hedef aşımı veya preset görünümü yanlış.');
  assert(waterOver.overWidth === '50%' && waterOver.stored.waterMl === 750 && waterOver.stored.goalMl === 500, 'Su hedef üstü ölçeği veya localStorage yanlış.');
  assert(waterOver.scrollTop === planMutationBaseline.scrollTop && waterOver.sameScreen && waterOver.sameContent, `Su aksiyonları Plan DOM/scroll state'ini bozdu: ${JSON.stringify(waterOver)}`);

  await evaluate(`document.querySelector('[data-action="edit-plan-sleep"]').click()`);
  await delay(80);
  await evaluate(`(() => { const form = document.querySelector('.bottom-sheet [data-form="plan-sleep"]'); form.elements.start.value = '22:45'; form.elements.end.value = '06:45'; form.requestSubmit(); })()`);
  await delay(80);
  const sleepEdited = await evaluate(`(() => ({
    updated: document.body.innerText.includes('22:45 – 06:45'),
    scrollTop: document.querySelector('.screen').scrollTop,
    sameScreen: window.__planScreenNode === document.querySelector('.screen'),
    contentReplaced: window.__planContentNode !== document.querySelector('.plan-content')
  }))()`);
  assert(sleepEdited.updated, 'Uyku saatleri güncellenmedi.');
  assert(sleepEdited.scrollTop === planMutationBaseline.scrollTop && sleepEdited.sameScreen && sleepEdited.contentReplaced, `Uyku düzenlemede scroll/ekran state'i korunmadı: ${JSON.stringify(sleepEdited)}`);

  await evaluate(`document.querySelector('[data-action="new-plan-activity"]').click()`);
  await delay(80);
  await evaluate(`(() => { const form = document.querySelector('.bottom-sheet [data-form="plan-activity"]'); form.elements.title.value = 'Gece odak'; form.elements.start.value = '23:30'; form.elements.end.value = '01:00'; form.elements.category.value = 'work'; form.requestSubmit(); })()`);
  await delay(80);
  const activityAdded = await evaluate(`(() => ({ updated: document.body.innerText.includes('Gece odak') && document.body.innerText.includes('23:30 – 01:00'), scrollTop: document.querySelector('.screen').scrollTop }))()`);
  assert(activityAdded.updated && activityAdded.scrollTop === planMutationBaseline.scrollTop, `Gece yarısını aşan aktivite veya scroll state'i yanlış: ${JSON.stringify(activityAdded)}`);
  await evaluate(`(() => { const row = [...document.querySelectorAll('.plan-task')].find((item) => item.textContent.includes('Gece odak')); row.querySelector('[data-action="edit-plan-activity"]').click(); })()`);
  await delay(80);
  await evaluate(`(() => { const form = document.querySelector('.bottom-sheet [data-form="plan-activity"]'); form.elements.title.value = 'Gece odak güncel'; form.requestSubmit(); })()`);
  await delay(80);
  const activityEdited = await evaluate(`(() => ({ updated: document.body.innerText.includes('Gece odak güncel'), scrollTop: document.querySelector('.screen').scrollTop }))()`);
  assert(activityEdited.updated && activityEdited.scrollTop === planMutationBaseline.scrollTop, `Aktivite düzenleme veya scroll state'i yanlış: ${JSON.stringify(activityEdited)}`);
  await evaluate(`(() => { window.confirm = () => true; const row = [...document.querySelectorAll('.plan-task')].find((item) => item.textContent.includes('Gece odak güncel')); row.querySelector('[data-action="edit-plan-activity"]').click(); })()`);
  await delay(80);
  await evaluate(`document.querySelector('.bottom-sheet [data-action="delete-plan-activity"]').click()`);
  await delay(80);
  const activityDeleted = await evaluate(`(() => ({ updated: !document.body.innerText.includes('Gece odak güncel'), scrollTop: document.querySelector('.screen').scrollTop }))()`);
  assert(activityDeleted.updated && activityDeleted.scrollTop === planMutationBaseline.scrollTop, `Aktivite silme veya scroll state'i yanlış: ${JSON.stringify(activityDeleted)}`);

  await evaluate(`location.reload()`);
  let reloadedPlanHeading = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await delay(100);
    reloadedPlanHeading = await evaluate(`document.querySelector('h1')?.textContent.trim() || null`);
    if (reloadedPlanHeading === 'Günün Planı') break;
  }
  assert(reloadedPlanHeading === 'Günün Planı', 'Yenileme sonrası Plan ekranı hazır olmadı.');
  const planPersisted = await evaluate(`(() => ({
    heading: document.querySelector('h1')?.textContent.trim(),
    total: document.querySelector('.water-summary strong')?.textContent.trim(),
    selected: document.querySelector('.water-preset[aria-pressed="true"]')?.textContent.trim(),
    sleep: document.body.innerText.includes('22:45 – 06:45'),
    overflow: document.querySelector('.screen').scrollWidth - document.querySelector('.screen').clientWidth
  }))()`);
  assert(planPersisted.heading === 'Günün Planı' && planPersisted.total === '0.75 L' && planPersisted.selected === '500 ml' && planPersisted.sleep, 'Plan localStorage yenileme sonrası korunmadı.');
  assert(planPersisted.overflow <= 0, 'Yenileme sonrası Plan ekranında yatay taşma oluştu.');

  const forbidden = await evaluate(`(() => {
    const sources = [document.documentElement.innerHTML.toLocaleLowerCase('tr-TR')];
    return ['popup', 'wordle', 'satranç', 'snooze', 'hold to dismiss', 'ayarlar', 'ses sistemi'].filter((term) => sources.some((source) => source.includes(term)));
  })()`);
  assert(forbidden.length === 0, `Kapsam dışı mobil içerik bulundu: ${forbidden.join(', ')}`);

  client.socket.close();
  console.log(JSON.stringify({
    status: 'passed',
    initialProgress: initial.ring,
    completedProgress: completed.ring,
    completionAnimation: { forward: true, reverse: true },
    sequentialUnlocked: true,
    filters,
    navigation: [notes.heading, planInitial.heading, stats.heading, account.heading],
    noteFilters,
    safeArea,
    planViewport: { width: planInitial.width, height: planInitial.height, overflow: planInitial.overflow, minTouch: planInitial.minTouch },
    planNavigation: { pinDetail: true, back: true, forward: true },
    planEditing: { sleep: sleepEdited.updated, activityAdded: activityAdded.updated, activityEdited: activityEdited.updated, activityDeleted: activityDeleted.updated },
    planScrollPreserved: { water: waterOver.scrollTop, planContent: activityDeleted.scrollTop },
    water: { persisted: true, targetOverflow: true, selectedPreset: waterOver.selected },
    todoTargets: ['NativeSmoke', 'NativeFab'],
    noteCrud: { edited: true, archived: true, deleted: true }
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
