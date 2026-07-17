(function initMobileDomain(globalScope, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  globalScope.NoteZMobileDomain = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function mobileDomainFactory() {
  'use strict';

  const TERMINAL_STATUSES = new Set(['done', 'cancelled']);
  const VISIBLE_STATUSES = new Set(['active', 'paused', 'done', 'cancelled', 'archived']);
  const DAY_MS = 24 * 60 * 60 * 1000;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value) || 0));
  }

  function parseLocalDate(value, endOfDay) {
    if (!value) return null;
    if (value instanceof Date) return new Date(value.getTime());
    if (typeof value === 'number') return new Date(value);
    const text = String(value);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (match) {
      return new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        endOfDay ? 23 : 0,
        endOfDay ? 59 : 0,
        endOfDay ? 59 : 0,
        endOfDay ? 999 : 0
      );
    }
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function localDateKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function splitDeadline(value) {
    if (!value) return { date: '', time: '' };
    const text = String(value);
    const localMatch = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?/.exec(text);
    if (localMatch && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) {
      return {
        date: localMatch[1],
        time: localMatch[2] ? localMatch[2] + ':' + localMatch[3] : ''
      };
    }
    const parsed = parseLocalDate(text, false);
    if (!parsed) return { date: '', time: '' };
    return {
      date: localDateKey(parsed),
      time: String(parsed.getHours()).padStart(2, '0') + ':' + String(parsed.getMinutes()).padStart(2, '0')
    };
  }

  function combineDeadline(dateValue, timeValue) {
    const date = String(dateValue || '').trim();
    const time = String(timeValue || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    if (!time) return date;
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return date;
    return date + 'T' + time;
  }

  function isTimedDeadlineOnDate(value, dateValue) {
    const parts = splitDeadline(value);
    if (!parts.date || !parts.time) return false;
    return parts.date === localDateKey(dateValue instanceof Date ? dateValue : new Date(dateValue || Date.now()));
  }

  function deadlineHour(value) {
    const parts = splitDeadline(value);
    if (!parts.time) return null;
    const values = parts.time.split(':').map(Number);
    return values[0] + values[1] / 60;
  }

  function normalizeNote(note) {
    const source = note || {};
    return {
      id: String(source.id || ''),
      category_id: String(source.category_id || source.categoryId || ''),
      subcategory_id: String(source.subcategory_id || source.subcategoryId || ''),
      tip: String(source.tip || source.title || source.content || '').trim(),
      description: String(source.description || ''),
      status: VISIBLE_STATUSES.has(source.status) ? source.status : 'active',
      importance: clamp(source.importance || 5, 1, 10),
      deadline: source.deadline || null,
      order_index: Number.isFinite(Number(source.order_index)) ? Number(source.order_index) : 0,
      created_at: source.created_at || new Date().toISOString(),
      updated_at: source.updated_at || new Date().toISOString(),
      completed_at: source.completed_at || null,
      archived_at: source.archived_at || null,
      needs_review: Boolean(source.needs_review)
    };
  }

  function normalizeSubcategory(subcategory) {
    const source = subcategory || {};
    return {
      id: String(source.id || ''),
      category_id: String(source.category_id || source.categoryId || ''),
      name: String(source.name || 'Genel'),
      is_sequential: Boolean(source.is_sequential || source.isSequential),
      deadline_mode: source.deadline_mode === 'shared' || source.deadlineMode === 'shared' ? 'shared' : null,
      shared_deadline: source.shared_deadline || source.sharedDeadline || null
    };
  }

  function isTerminalStatus(status) {
    return TERMINAL_STATUSES.has(status);
  }

  function sortByOrder(notes) {
    return notes.slice().sort(function byOrder(a, b) {
      return Number(a.order_index || 0) - Number(b.order_index || 0) || String(a.id).localeCompare(String(b.id));
    });
  }

  function getSequentialState(notes, subcategory) {
    const normalizedSubcategory = normalizeSubcategory(subcategory);
    const ordered = sortByOrder((notes || []).map(normalizeNote));
    if (!normalizedSubcategory.is_sequential) {
      return {
        activeId: null,
        items: ordered.map(function independent(note) {
          return { id: note.id, state: isTerminalStatus(note.status) ? 'completed' : 'independent' };
        })
      };
    }

    const active = ordered.find(function firstNonTerminal(note) {
      return !isTerminalStatus(note.status) && note.status !== 'archived';
    });
    const activeId = active ? active.id : null;
    return {
      activeId: activeId,
      items: ordered.map(function stepState(note) {
        if (isTerminalStatus(note.status)) return { id: note.id, state: 'completed' };
        if (note.id === activeId) return { id: note.id, state: 'active' };
        return { id: note.id, state: 'locked' };
      })
    };
  }

  function getEffectiveDeadline(note, subcategory) {
    const normalizedSubcategory = normalizeSubcategory(subcategory);
    if (normalizedSubcategory.deadline_mode === 'shared' && normalizedSubcategory.shared_deadline) {
      return { value: normalizedSubcategory.shared_deadline, source: 'shared' };
    }
    return { value: normalizeNote(note).deadline, source: note && note.deadline ? 'note' : 'none' };
  }

  function getDeadlineState(deadline, nowValue) {
    if (!deadline) return { state: 'none', daysRemaining: null, label: 'Deadline yok' };
    const now = nowValue instanceof Date ? nowValue : new Date(nowValue || Date.now());
    const end = parseLocalDate(deadline, true);
    if (!end) return { state: 'invalid', daysRemaining: null, label: 'Geçersiz deadline' };
    const diff = end.getTime() - now.getTime();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const deadlineStart = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const daysRemaining = Math.round((deadlineStart.getTime() - todayStart.getTime()) / DAY_MS);
    if (diff < 0) return { state: 'past', daysRemaining: daysRemaining, label: 'Deadline geçti' };
    if (localDateKey(now) === localDateKey(end)) return { state: 'approaching', daysRemaining: 0, label: 'Bugün' };
    if (daysRemaining <= 3) return { state: 'approaching', daysRemaining: daysRemaining, label: daysRemaining + ' gün kaldı' };
    return { state: 'normal', daysRemaining: daysRemaining, label: daysRemaining + ' gün kaldı' };
  }

  function getDeadlineMultiplier(deadlineState) {
    if (!deadlineState || deadlineState.state === 'none' || deadlineState.state === 'normal') return 1;
    if (deadlineState.state === 'past' || deadlineState.state === 'invalid') return 0;
    if (deadlineState.daysRemaining === 0) return 1.75;
    if (deadlineState.daysRemaining === 1) return 1.55;
    return 1.3;
  }

  function getNoteWeight(note, subcategory, nowValue) {
    const normalized = normalizeNote(note);
    const effective = getEffectiveDeadline(normalized, subcategory);
    const deadlineState = getDeadlineState(effective.value, nowValue);
    const deadlineMultiplier = getDeadlineMultiplier(deadlineState);
    const importanceWeight = Math.pow(normalized.importance, 1.35);
    const finalWeight = deadlineMultiplier === 0 ? 0 : Number((importanceWeight * deadlineMultiplier).toFixed(3));
    return {
      importance: normalized.importance,
      importanceWeight: Number(importanceWeight.toFixed(3)),
      deadlineMultiplier: deadlineMultiplier,
      effectiveImportance: deadlineMultiplier === 0 ? normalized.importance : clamp(Math.round(normalized.importance * deadlineMultiplier), 1, 10),
      finalWeight: finalWeight,
      deadline: effective.value,
      deadlineSource: effective.source,
      deadlineState: deadlineState
    };
  }

  function getTaskProgress(notes) {
    const trackable = (notes || []).map(normalizeNote).filter(function trackableStatus(note) {
      return note.status !== 'archived' && note.status !== 'cancelled';
    });
    const completed = trackable.filter(function completedStatus(note) { return note.status === 'done'; }).length;
    const total = trackable.length;
    const waiting = Math.max(0, total - completed);
    const progress = total ? Math.min(100, Math.max(0, Math.round(completed / total * 100))) : 0;
    return { completed: completed, waiting: waiting, total: total, progress: progress };
  }

  function startOfWeek(nowValue) {
    const now = nowValue instanceof Date ? new Date(nowValue.getTime()) : new Date(nowValue || Date.now());
    now.setHours(0, 0, 0, 0);
    const mondayOffset = (now.getDay() + 6) % 7;
    now.setDate(now.getDate() - mondayOffset);
    return now;
  }

  function buildWeeklyProgress(notes, nowValue) {
    const labels = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
    const start = startOfWeek(nowValue);
    const rows = labels.map(function makeDay(label, index) {
      const date = new Date(start.getTime() + index * DAY_MS);
      return { day: label, date: localDateKey(date), completed: 0, total: 0 };
    });
    (notes || []).map(normalizeNote).forEach(function aggregate(note) {
      const created = parseLocalDate(note.created_at, false);
      const completed = parseLocalDate(note.completed_at, false);
      rows.forEach(function count(row, index) {
        const end = new Date(start.getTime() + (index + 1) * DAY_MS);
        if (created && created < end) row.total += 1;
      });
      if (completed) {
        const index = Math.floor((new Date(completed.getFullYear(), completed.getMonth(), completed.getDate()).getTime() - start.getTime()) / DAY_MS);
        if (index >= 0 && index < 7) rows[index].completed += 1;
      }
    });
    return rows;
  }

  function buildStatistics(snapshot, nowValue) {
    if (!snapshot || !Array.isArray(snapshot.notes)) throw new Error('statistics-invalid-snapshot');
    const notes = snapshot.notes.map(normalizeNote);
    const categories = Array.isArray(snapshot.categories) ? snapshot.categories : [];
    const subcategories = Array.isArray(snapshot.subcategories) ? snapshot.subcategories : [];
    const logs = Array.isArray(snapshot.activityLogs) ? snapshot.activityLogs : [];
    const weekly = buildWeeklyProgress(notes, nowValue);
    const weekStart = startOfWeek(nowValue);
    const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS);
    const completed = notes.filter(function completedNote(note) {
      const completedAt = parseLocalDate(note.completed_at, false);
      return note.status === 'done' && completedAt && completedAt >= weekStart && completedAt < weekEnd;
    }).length;
    const paused = logs.filter(function paused(log) {
      const createdAt = parseLocalDate(log.created_at, false);
      return log.action === 'status-change' && log.status === 'paused' && createdAt && createdAt >= weekStart && createdAt < weekEnd;
    }).length;
    const upcoming = notes.filter(function upcomingNote(note) {
      const subcategory = subcategories.find(function match(item) { return String(item.id) === note.subcategory_id; });
      return getDeadlineState(getEffectiveDeadline(note, subcategory).value, nowValue).state === 'approaching';
    }).length;
    const categoryDistribution = categories.map(function categoryRow(category) {
      const categoryNotes = notes.filter(function inCategory(note) { return note.category_id === String(category.id); });
      return { id: String(category.id), name: category.name, total: categoryNotes.length, completed: categoryNotes.filter(function done(note) { return note.status === 'done'; }).length };
    }).filter(function nonEmpty(row) { return row.total > 0; });
    const start = weekStart;
    const pauseTrend = weekly.map(function dayRow(day, index) {
      const key = localDateKey(new Date(start.getTime() + index * DAY_MS));
      return { day: day.day, count: logs.filter(function logOnDay(log) { return log.action === 'status-change' && log.status === 'paused' && localDateKey(log.created_at) === key; }).length };
    });
    return {
      status: notes.length || logs.length ? 'ready' : 'empty',
      empty: notes.length === 0 && logs.length === 0,
      weekly: weekly,
      pauseTrend: pauseTrend,
      categoryDistribution: categoryDistribution,
      totals: { completed: completed, paused: paused, upcoming: upcoming, active: notes.filter(function active(note) { return note.status === 'active'; }).length }
    };
  }

  return {
    DAY_MS: DAY_MS,
    TERMINAL_STATUSES: TERMINAL_STATUSES,
    normalizeNote: normalizeNote,
    normalizeSubcategory: normalizeSubcategory,
    isTerminalStatus: isTerminalStatus,
    getSequentialState: getSequentialState,
    getEffectiveDeadline: getEffectiveDeadline,
    getDeadlineState: getDeadlineState,
    getNoteWeight: getNoteWeight,
    getTaskProgress: getTaskProgress,
    buildWeeklyProgress: buildWeeklyProgress,
    buildStatistics: buildStatistics,
    localDateKey: localDateKey,
    parseLocalDate: parseLocalDate,
    splitDeadline: splitDeadline,
    combineDeadline: combineDeadline,
    isTimedDeadlineOnDate: isTimedDeadlineOnDate,
    deadlineHour: deadlineHour
  };
});
