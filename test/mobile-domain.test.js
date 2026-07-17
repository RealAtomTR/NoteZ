'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Domain = require('../src/js/mobile-domain.js');
const Repository = require('../src/js/mobile-repository.js');

test('sequential akış done ve cancelled adımları terminal sayar', function () {
  const subcategory = { id: 'seq', is_sequential: true };
  const notes = [
    { id: 'a', subcategory_id: 'seq', tip: 'A', status: 'cancelled', order_index: 0 },
    { id: 'b', subcategory_id: 'seq', tip: 'B', status: 'active', order_index: 1 },
    { id: 'c', subcategory_id: 'seq', tip: 'C', status: 'active', order_index: 2 }
  ];
  const before = Domain.getSequentialState(notes, subcategory);
  assert.equal(before.activeId, 'b');
  assert.deepEqual(before.items.map(function state(item) { return item.state; }), ['completed', 'active', 'locked']);

  notes[1].status = 'cancelled';
  const after = Domain.getSequentialState(notes, subcategory);
  assert.equal(after.activeId, 'c');
  assert.equal(after.items[2].state, 'active');
});

test('sırasız alt kategoride notlar bağımsız kalır', function () {
  const result = Domain.getSequentialState([
    { id: 'a', tip: 'A', status: 'active' },
    { id: 'b', tip: 'B', status: 'active' }
  ], { id: 'free', is_sequential: false });
  assert.equal(result.activeId, null);
  assert.deepEqual(result.items.map(function state(item) { return item.state; }), ['independent', 'independent']);
});

test('shared deadline effective deadline olur ve geçmiş durum ağırlığa yansır', function () {
  const now = new Date(2026, 6, 13, 12, 0, 0);
  const note = { id: 'n', tip: 'Kritik', status: 'active', importance: 10, deadline: '2026-07-30', subcategory_id: 's' };
  const subcategory = { id: 's', deadline_mode: 'shared', shared_deadline: '2026-07-12' };
  const effective = Domain.getEffectiveDeadline(note, subcategory);
  assert.equal(effective.value, '2026-07-12');
  assert.equal(effective.source, 'shared');
  const weight = Domain.getNoteWeight(note, subcategory, now);
  assert.equal(weight.deadlineState.state, 'past');
  assert.equal(weight.finalWeight, 0);
});

test('yaklaşan deadline final weight ve effective importance değerini artırır', function () {
  const now = new Date(2026, 6, 13, 12, 0, 0);
  const note = { id: 'n', tip: 'Yaklaşan', status: 'active', importance: 6, deadline: '2026-07-14' };
  const weighted = Domain.getNoteWeight(note, {}, now);
  const normal = Domain.getNoteWeight(Object.assign({}, note, { deadline: '2026-08-14' }), {}, now);
  assert.equal(weighted.deadlineState.state, 'approaching');
  assert.ok(weighted.deadlineMultiplier > 1);
  assert.ok(weighted.finalWeight > normal.finalWeight);
  assert.ok(weighted.effectiveImportance > note.importance);
});

test('task progress tek source of truth olarak normalize edilir', function () {
  const notes = [
    { id: 'done', tip: 'Bitti', status: 'done' },
    { id: 'active', tip: 'Bekliyor', status: 'active' },
    { id: 'paused', tip: 'Duraklatıldı', status: 'paused' },
    { id: 'cancelled', tip: 'İptal', status: 'cancelled' },
    { id: 'archived', tip: 'Arşiv', status: 'archived' }
  ];
  assert.deepEqual(Domain.getTaskProgress(notes), { completed: 1, waiting: 2, total: 3, progress: 33 });
  assert.deepEqual(Domain.getTaskProgress([]), { completed: 0, waiting: 0, total: 0, progress: 0 });
});

test('deadline tarih-only ve yerel tarih+saat olarak kayıpsız ayrılır', function () {
  assert.deepEqual(Domain.splitDeadline('2026-07-14'), { date: '2026-07-14', time: '' });
  assert.deepEqual(Domain.splitDeadline('2026-07-14T09:35'), { date: '2026-07-14', time: '09:35' });
  assert.equal(Domain.combineDeadline('2026-07-14', ''), '2026-07-14');
  assert.equal(Domain.combineDeadline('2026-07-14', '09:35'), '2026-07-14T09:35');
  assert.equal(Domain.isTimedDeadlineOnDate('2026-07-14T09:35', new Date(2026, 6, 14, 20, 0)), true);
  assert.equal(Domain.isTimedDeadlineOnDate('2026-07-14', new Date(2026, 6, 14, 20, 0)), false);
  assert.equal(Domain.isTimedDeadlineOnDate('2026-07-15T09:35', new Date(2026, 6, 14, 20, 0)), false);
  assert.equal(Domain.deadlineHour('2026-07-14T09:30'), 9.5);
});

test('local repository CRUD ve stats ready/empty/error state üretir', async function () {
  const storage = Repository.createMemoryStorage();
  const repo = new Repository.LocalMobileRepository({ storage: storage, storageKey: 'test' });
  const before = await repo.getSnapshot();
  const todo = Repository.getTodoSubcategory(before);
  assert.equal(todo.name, 'Yapılacaklar');
  assert.equal(todo.is_sequential, false);
  const quickTodo = repo.createTodo({ tip: 'Hızlı görev' });
  assert.equal(quickTodo.subcategory_id, todo.id);
  assert.equal(quickTodo.category_id, todo.category_id);
  const targetSubcategory = before.subcategories.find(function general(item) { return item.name === 'Genel'; });
  const created = repo.createNote({ tip: 'Yeni mobil not', description: 'Kaydedilebilir', importance: 6, subcategory_id: targetSubcategory.id });
  assert.equal((await repo.getSnapshot()).notes.some(function has(item) { return item.id === created.id; }), true);
  repo.updateNote(created.id, { status: 'done', description: 'Autosave tamamlandı' });
  const updated = (await repo.getSnapshot()).notes.find(function find(item) { return item.id === created.id; });
  assert.equal(updated.status, 'done');
  assert.ok(updated.completed_at);
  assert.equal(updated.description, 'Autosave tamamlandı');

  const timed = repo.createNote({ tip: 'Saatli not', deadline: '2026-07-14T18:45', subcategory_id: targetSubcategory.id });
  assert.equal(timed.deadline, '2026-07-14T18:45');
  repo.updateNote(timed.id, { deadline: '2026-07-15' });
  assert.equal((await repo.getSnapshot()).notes.find(function find(item) { return item.id === timed.id; }).deadline, '2026-07-15');

  repo.updateNote(created.id, { status: 'paused' });
  const pausedSnapshot = await repo.getSnapshot();
  assert.equal(pausedSnapshot.activityLogs.some(function paused(log) { return log.note_id === created.id && log.status === 'paused'; }), true);

  const ready = await repo.getStatistics(new Date());
  assert.equal(ready.status, 'ready');
  assert.equal(ready.empty, false);

  repo.setFailureMode('statistics');
  await assert.rejects(repo.getStatistics(new Date()), /statistics-query-failed/);
  repo.setFailureMode(null);
  repo.deleteNote(created.id);
  assert.equal((await repo.getSnapshot()).notes.some(function has(item) { return item.id === created.id; }), false);

  const empty = Domain.buildStatistics({ notes: [], categories: [], subcategories: [], activityLogs: [] }, new Date());
  assert.equal(empty.status, 'empty');
  assert.equal(empty.empty, true);
});
