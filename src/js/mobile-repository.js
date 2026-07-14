(function initMobileRepository(globalScope, factory) {
  const api = factory(globalScope.NoteZMobileDomain || (typeof require === 'function' ? require('./mobile-domain.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  globalScope.NoteZMobileRepository = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function mobileRepositoryFactory(Domain) {
  'use strict';

  if (!Domain) throw new Error('NoteZMobileDomain yüklenemedi.');

  const STORAGE_KEY = 'notez_mobile_repository_v3';
  const TODO_CATEGORY_ID = 'cat-tasks';
  const TODO_SUBCATEGORY_ID = 'sub-todo';

  function ensureTodoStructure(snapshot) {
    const target = snapshot || {};
    if (!Array.isArray(target.categories)) target.categories = [];
    if (!Array.isArray(target.subcategories)) target.subcategories = [];
    if (!Array.isArray(target.activityLogs)) target.activityLogs = [];
    let todoSubcategory = target.subcategories.find(function findTodo(item) {
      return String(item.name || '').toLocaleLowerCase('tr-TR') === 'yapılacaklar';
    });
    if (!todoSubcategory) {
      let category = target.categories.find(function findCategory(item) { return String(item.id) === TODO_CATEGORY_ID; });
      if (!category) {
        category = { id: TODO_CATEGORY_ID, name: 'Görevler', color: '#159b93' };
        target.categories.unshift(category);
      }
      todoSubcategory = {
        id: TODO_SUBCATEGORY_ID,
        category_id: category.id,
        name: 'Yapılacaklar',
        is_sequential: false,
        deadline_mode: null,
        shared_deadline: null
      };
      target.subcategories.unshift(todoSubcategory);
    }
    target.schemaVersion = 4;
    return target;
  }

  function getTodoSubcategory(snapshot) {
    const target = ensureTodoStructure(snapshot);
    return target.subcategories.find(function findTodo(item) {
      return String(item.name || '').toLocaleLowerCase('tr-TR') === 'yapılacaklar';
    });
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function dateOffset(days, hour) {
    const date = new Date();
    date.setHours(Number.isFinite(hour) ? hour : 18, 0, 0, 0);
    date.setDate(date.getDate() + days);
    return Domain.localDateKey(date);
  }

  function isoOffset(days, hour) {
    const date = new Date();
    date.setHours(Number.isFinite(hour) ? hour : 10, 0, 0, 0);
    date.setDate(date.getDate() + days);
    return date.toISOString();
  }

  function createSeed() {
    return {
      schemaVersion: 4,
      categories: [
        { id: TODO_CATEGORY_ID, name: 'Görevler', color: '#159b93' },
        { id: 'cat-work', name: 'Yapay Zeka', color: '#159b93' },
        { id: 'cat-personal', name: 'Kişisel', color: '#3e78d5' },
        { id: 'cat-learning', name: 'Öğrenme', color: '#d98a18' }
      ],
      subcategories: [
        { id: TODO_SUBCATEGORY_ID, category_id: TODO_CATEGORY_ID, name: 'Yapılacaklar', is_sequential: false, deadline_mode: null, shared_deadline: null },
        { id: 'sub-launch', category_id: 'cat-work', name: 'Mobil Lansman', is_sequential: true, deadline_mode: 'shared', shared_deadline: dateOffset(2) },
        { id: 'sub-ideas', category_id: 'cat-work', name: 'Fikir Havuzu', is_sequential: false, deadline_mode: null, shared_deadline: null },
        { id: 'sub-home', category_id: 'cat-personal', name: 'Genel', is_sequential: false, deadline_mode: null, shared_deadline: null },
        { id: 'sub-course', category_id: 'cat-learning', name: 'Mobil UX Kursu', is_sequential: true, deadline_mode: null, shared_deadline: null }
      ],
      notes: [
        { id: 'note-1', category_id: 'cat-work', subcategory_id: 'sub-launch', tip: 'Mobil veri modelini doğrula', description: 'Category, subcategory ve deadline alanlarını test et.', status: 'done', importance: 8, deadline: null, order_index: 0, created_at: isoOffset(-5), updated_at: isoOffset(-2), completed_at: isoOffset(-2), archived_at: null, needs_review: false },
        { id: 'note-2', category_id: 'cat-work', subcategory_id: 'sub-launch', tip: 'Navigation smoke testini çalıştır', description: 'Dört alt sekme ve detay route geçişlerini kontrol et.', status: 'active', importance: 9, deadline: null, order_index: 1, created_at: isoOffset(-4), updated_at: isoOffset(-1), completed_at: null, archived_at: null, needs_review: false },
        { id: 'note-3', category_id: 'cat-work', subcategory_id: 'sub-launch', tip: 'Android debug build al', description: 'Aktif adımdan sonra açılacak sıralı görev.', status: 'active', importance: 7, deadline: null, order_index: 2, created_at: isoOffset(-3), updated_at: isoOffset(-1), completed_at: null, archived_at: null, needs_review: false },
        { id: 'note-4', category_id: 'cat-work', subcategory_id: 'sub-ideas', tip: 'Sırasız görev görünümünü incele', description: 'Sırasız alt kategoride bağımsız çalışır.', status: 'active', importance: 6, deadline: dateOffset(6), order_index: 0, created_at: isoOffset(-2), updated_at: isoOffset(-1), completed_at: null, archived_at: null, needs_review: false },
        { id: 'note-5', category_id: 'cat-personal', subcategory_id: 'sub-home', tip: 'Haftalık alışveriş listesini hazırla', description: 'Temel ihtiyaçları not et.', status: 'paused', importance: 4, deadline: dateOffset(1), order_index: 0, created_at: isoOffset(-3), updated_at: isoOffset(-1), completed_at: null, archived_at: null, needs_review: false },
        { id: 'note-6', category_id: 'cat-personal', subcategory_id: 'sub-home', tip: 'Eski deadline örneği', description: 'Geçmiş deadline durumu açıkça gösterilmelidir.', status: 'active', importance: 10, deadline: dateOffset(-2), order_index: 1, created_at: isoOffset(-8), updated_at: isoOffset(-4), completed_at: null, archived_at: null, needs_review: true },
        { id: 'note-7', category_id: 'cat-learning', subcategory_id: 'sub-course', tip: 'Dokunma alanı kontrolü', description: 'Minimum 44px etkileşim hedeflerini doğrula.', status: 'cancelled', importance: 5, deadline: null, order_index: 0, created_at: isoOffset(-4), updated_at: isoOffset(-1), completed_at: isoOffset(-1), archived_at: null, needs_review: false },
        { id: 'note-8', category_id: 'cat-learning', subcategory_id: 'sub-course', tip: 'Bottom sheet taşma testini yap', description: 'İptal edilen adım sonrası aktif olmalıdır.', status: 'active', importance: 7, deadline: dateOffset(3), order_index: 1, created_at: isoOffset(-2), updated_at: isoOffset(-1), completed_at: null, archived_at: null, needs_review: false }
      ],
      activityLogs: [
        { id: 'activity-1', note_id: 'note-4', action: 'status-change', status: 'paused', created_at: isoOffset(-2, 14) },
        { id: 'activity-2', note_id: 'note-5', action: 'status-change', status: 'paused', created_at: isoOffset(-1, 16) }
      ]
    };
  }

  function createMemoryStorage() {
    const values = new Map();
    return {
      getItem: function getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem: function setItem(key, value) { values.set(key, String(value)); },
      removeItem: function removeItem(key) { values.delete(key); }
    };
  }

  class LocalMobileRepository {
    constructor(options) {
      const config = options || {};
      this.storage = config.storage || (typeof localStorage !== 'undefined' ? localStorage : createMemoryStorage());
      this.storageKey = config.storageKey || STORAGE_KEY;
      this.failureMode = null;
      this.listeners = new Set();
      this.snapshot = this.read();
    }

    read() {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) {
        const seed = createSeed();
        this.storage.setItem(this.storageKey, JSON.stringify(seed));
        return seed;
      }
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed.notes) || !Array.isArray(parsed.subcategories)) throw new Error('invalid');
        const migrated = ensureTodoStructure(parsed);
        this.storage.setItem(this.storageKey, JSON.stringify(migrated));
        return migrated;
      } catch (error) {
        const seed = createSeed();
        this.storage.setItem(this.storageKey, JSON.stringify(seed));
        return seed;
      }
    }

    persist() {
      this.storage.setItem(this.storageKey, JSON.stringify(this.snapshot));
      const value = this.getSnapshotSync();
      this.listeners.forEach(function notify(listener) { listener(value); });
      return value;
    }

    subscribe(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    getSnapshotSync() {
      return deepClone(this.snapshot);
    }

    async getSnapshot() {
      if (this.failureMode === 'load') throw new Error('mobile-repository-load-failed');
      return this.getSnapshotSync();
    }

    async getStatistics(nowValue) {
      if (this.failureMode === 'statistics') throw new Error('statistics-query-failed');
      return Domain.buildStatistics(this.getSnapshotSync(), nowValue);
    }

    setFailureMode(mode) {
      this.failureMode = mode || null;
    }

    reset() {
      this.snapshot = createSeed();
      return this.persist();
    }

    createNote(input) {
      const values = input || {};
      ensureTodoStructure(this.snapshot);
      const subcategory = this.snapshot.subcategories.find(function findSubcategory(item) { return String(item.id) === String(values.subcategory_id); }) || this.snapshot.subcategories[0];
      const siblings = this.snapshot.notes.filter(function sibling(note) { return String(note.subcategory_id) === String(subcategory.id); });
      const now = new Date().toISOString();
      const note = Domain.normalizeNote({
        id: 'note-' + Date.now() + '-' + Math.random().toString(16).slice(2, 7),
        category_id: values.category_id || subcategory.category_id,
        subcategory_id: subcategory.id,
        tip: values.tip || values.title,
        description: values.description || '',
        status: values.status || 'active',
        importance: values.importance || 5,
        deadline: values.deadline || null,
        order_index: values.order_index === undefined ? siblings.length : values.order_index,
        created_at: now,
        updated_at: now,
        needs_review: false
      });
      if (!note.tip) throw new Error('note-title-required');
      this.snapshot.notes.unshift(note);
      this.persist();
      return deepClone(note);
    }

    createTodo(input) {
      const todoSubcategory = getTodoSubcategory(this.snapshot);
      return this.createNote(Object.assign({}, input || {}, {
        subcategory_id: todoSubcategory.id,
        category_id: todoSubcategory.category_id
      }));
    }

    updateNote(id, patch) {
      const index = this.snapshot.notes.findIndex(function findNote(note) { return String(note.id) === String(id); });
      if (index < 0) throw new Error('note-not-found');
      const previous = this.snapshot.notes[index];
      const now = new Date().toISOString();
      const next = Domain.normalizeNote(Object.assign({}, previous, patch || {}, { id: previous.id, updated_at: now }));
      if (Domain.isTerminalStatus(next.status) && !Domain.isTerminalStatus(previous.status)) next.completed_at = now;
      if (!Domain.isTerminalStatus(next.status)) next.completed_at = null;
      if (next.status === 'archived') next.archived_at = previous.archived_at || now;
      if (next.status !== 'archived') next.archived_at = null;
      if (!next.tip) throw new Error('note-title-required');
      this.snapshot.notes[index] = next;
      if (previous.status !== next.status) {
        if (!Array.isArray(this.snapshot.activityLogs)) this.snapshot.activityLogs = [];
        this.snapshot.activityLogs.push({
          id: 'activity-' + Date.now() + '-' + Math.random().toString(16).slice(2, 6),
          note_id: String(previous.id),
          action: 'status-change',
          status: next.status,
          created_at: now
        });
      }
      this.persist();
      return deepClone(next);
    }

    deleteNote(id) {
      const before = this.snapshot.notes.length;
      this.snapshot.notes = this.snapshot.notes.filter(function keepNote(note) { return String(note.id) !== String(id); });
      if (this.snapshot.notes.length === before) throw new Error('note-not-found');
      this.snapshot.activityLogs = (this.snapshot.activityLogs || []).filter(function keepLog(log) { return String(log.note_id) !== String(id); });
      return this.persist();
    }
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    TODO_CATEGORY_ID: TODO_CATEGORY_ID,
    TODO_SUBCATEGORY_ID: TODO_SUBCATEGORY_ID,
    LocalMobileRepository: LocalMobileRepository,
    createMemoryStorage: createMemoryStorage,
    createSeed: createSeed,
    ensureTodoStructure: ensureTodoStructure,
    getTodoSubcategory: getTodoSubcategory
  };
});
