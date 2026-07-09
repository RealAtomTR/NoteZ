const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const SCHEMA_VERSION = 1;

function getStorageRoot() {
  return path.join(app.getPath('documents'), 'NoteZ');
}

function ensureStorageTree() {
  const root = getStorageRoot();
  ['categories', 'subcategories', 'notes', 'settings', 'logs', 'trash/categories', 'trash/subcategories', 'trash/notes'].forEach(dir => {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  });
  return root;
}

function slugify(value, fallback) {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
  return slug || fallback;
}

function toIso(value) {
  if (!value) return null;
  if (typeof value === 'number') return new Date(value).toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function parseTriggers(raw) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw;
    if (Array.isArray(parsed)) return { apps: [], keywords: parsed };
    return {
      apps: Array.isArray(parsed?.apps) ? parsed.apps : [],
      keywords: Array.isArray(parsed?.keywords) ? parsed.keywords : []
    };
  } catch (_) {
    return { apps: [], keywords: [] };
  }
}

function yamlScalar(value) {
  if (value === null || value === undefined || value === '') return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(String(value));
}

function yamlArray(values) {
  if (!values || values.length === 0) return '[]';
  return `\n${values.map(value => `  - ${yamlScalar(value)}`).join('\n')}`;
}

function frontmatter(fields) {
  const lines = ['---'];
  Object.entries(fields).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      lines.push(`${key}: ${yamlArray(value)}`);
    } else {
      lines.push(`${key}: ${yamlScalar(value)}`);
    }
  });
  lines.push('---', '');
  return lines.join('\n');
}

function writeMarkdown(root, folder, fileName, fields, body = '') {
  const filePath = path.join(root, folder, fileName);
  fs.writeFileSync(filePath, `${frontmatter(fields)}${body.trim()}\n`, 'utf8');
  return fileName;
}

function categoryFileName(category) {
  return `${category.id}-${slugify(category.name, 'category')}.md`;
}

function subcategoryFileName(subcategory) {
  return `${subcategory.id}-${slugify(subcategory.name, 'subcategory')}.md`;
}

function noteTitle(note) {
  return String(note.content || '').split(/\r?\n/)[0].trim() || `Note ${note.id}`;
}

function noteFileName(note) {
  return `${note.id}-${slugify(noteTitle(note), 'note')}.md`;
}

function markdownLink(folder, fileName, label) {
  if (!fileName) return null;
  const target = `${folder}/${fileName.replace(/\.md$/i, '')}`;
  const safeLabel = String(label || fileName).replace(/\]/g, '');
  return `[[${target}|${safeLabel}]]`;
}

function trashName(fileName) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${stamp}-${fileName}`;
}

function moveStaleFilesToTrash(root, folder, liveFileNames) {
  const folderPath = path.join(root, folder);
  const trashPath = path.join(root, 'trash', folder);
  if (!fs.existsSync(folderPath)) return 0;

  fs.mkdirSync(trashPath, { recursive: true });
  let moved = 0;
  fs.readdirSync(folderPath).forEach(fileName => {
    if (!fileName.toLowerCase().endsWith('.md')) return;
    if (liveFileNames.has(fileName)) return;

    const source = path.join(folderPath, fileName);
    const target = path.join(trashPath, trashName(fileName));
    fs.renameSync(source, target);
    moved += 1;
  });

  return moved;
}

function parseScalar(value) {
  const trimmed = String(value || '').trim();
  if (trimmed === 'null' || trimmed === '') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    return trimmed;
  }
}

function parseFrontmatterFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  if (!raw.startsWith('---')) return { fields: {}, body: raw.trim() };

  const lines = raw.split(/\r?\n/);
  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (endIndex === -1) return { fields: {}, body: raw.trim() };

  const fields = {};
  for (let i = 1; i < endIndex; i += 1) {
    const line = lines[i];
    const match = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!match) continue;

    const key = match[1];
    const inlineValue = match[2] || '';
    if (inlineValue.trim() !== '') {
      fields[key] = parseScalar(inlineValue);
      continue;
    }

    const values = [];
    while (i + 1 < endIndex && /^\s+-\s+/.test(lines[i + 1])) {
      i += 1;
      values.push(parseScalar(lines[i].replace(/^\s+-\s+/, '')));
    }
    fields[key] = values;
  }

  return {
    fields,
    body: lines.slice(endIndex + 1).join('\n').trim()
  };
}

function numericEntityId(value, entityType) {
  const match = String(value || '').match(new RegExp(`^${entityType}-(\\d+)$`));
  return match ? Number(match[1]) : null;
}

function listMarkdownFiles(root, folder) {
  const dir = path.join(root, folder);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => name.toLowerCase().endsWith('.md'))
    .map(name => path.join(dir, name));
}

function syncCategories(root, db) {
  const categories = db.query('SELECT * FROM categories ORDER BY id ASC');
  const notesByCategory = db.query(`
    SELECT id, content, category_id
    FROM tips
    ORDER BY category_id ASC, order_index ASC, id ASC
  `).reduce((acc, note) => {
    if (!acc.has(note.category_id)) acc.set(note.category_id, []);
    acc.get(note.category_id).push(note);
    return acc;
  }, new Map());

  const liveFileNames = new Set();
  categories.forEach(category => {
    const triggers = parseTriggers(category.triggers);
    const noteLinks = (notesByCategory.get(category.id) || []).map(note => (
      `- ${markdownLink('notes', noteFileName(note), noteTitle(note))}`
    ));
    const body = [
      category.name || '',
      '',
      '## Notes',
      noteLinks.length > 0 ? noteLinks.join('\n') : '- No notes'
    ].join('\n');

    const fileName = writeMarkdown(
      root,
      'categories',
      categoryFileName(category),
      {
        id: `category-${category.id}`,
        schema_version: SCHEMA_VERSION,
        entity_type: 'category',
        name: category.name,
        color: category.color,
        context_apps: triggers.apps,
        keywords: triggers.keywords,
        popup_enabled: true,
        default_importance: 5,
        created_at: toIso(category.created_at)
      },
      body
    );
    liveFileNames.add(fileName);
  });
  return liveFileNames;
}

function syncSubcategories(root, db) {
  const subcategories = db.query(`
    SELECT sc.*, c.name as category_name
    FROM subcategories sc
    LEFT JOIN categories c ON c.id = sc.category_id
    ORDER BY sc.category_id ASC, sc.order_index ASC, sc.id ASC
  `);

  const liveFileNames = new Set();
  subcategories.forEach(subcategory => {
    const fileName = writeMarkdown(
      root,
      'subcategories',
      subcategoryFileName(subcategory),
      {
        id: `subcategory-${subcategory.id}`,
        schema_version: SCHEMA_VERSION,
        entity_type: 'subcategory',
        name: subcategory.name,
        category_id: subcategory.category_id,
        category: subcategory.category_name,
        order_index: subcategory.order_index || 0,
        is_sequential: Boolean(subcategory.is_sequential),
        deadline_mode: subcategory.deadline_mode || null,
        shared_deadline: subcategory.shared_deadline || null,
        created_at: toIso(subcategory.created_at)
      },
      subcategory.name || ''
    );
    liveFileNames.add(fileName);
  });
  return liveFileNames;
}

function syncNotes(root, db) {
  const notes = db.query(`
    SELECT t.*, c.name as category_name, sc.id as subcategory_ref_id, sc.name as subcategory_name
    FROM tips t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN subcategories sc ON sc.id = t.subcategory_id
    ORDER BY t.category_id ASC, t.subcategory_id ASC, t.order_index ASC, t.id ASC
  `);

  const liveFileNames = new Set();
  notes.forEach(note => {
    const title = noteTitle(note);
    const categoryFile = note.category_id && note.category_name
      ? categoryFileName({ id: note.category_id, name: note.category_name })
      : null;
    const subcategoryFile = note.subcategory_ref_id && note.subcategory_name
      ? subcategoryFileName({ id: note.subcategory_ref_id, name: note.subcategory_name })
      : null;
    const fileName = writeMarkdown(
      root,
      'notes',
      noteFileName(note),
      {
        id: `note-${note.id}`,
        schema_version: SCHEMA_VERSION,
        entity_type: 'note',
        title,
        category_id: note.category_id,
        category: note.category_name,
        category_file: categoryFile,
        category_link: markdownLink('categories', categoryFile, note.category_name),
        subcategory_id: note.subcategory_id || null,
        subcategory: note.subcategory_name || null,
        subcategory_file: subcategoryFile,
        subcategory_link: markdownLink('subcategories', subcategoryFile, note.subcategory_name),
        importance: note.importance,
        status: note.status,
        archived_at: toIso(note.archived_at),
        deadline: note.deadline || null,
        created_at: toIso(note.created_at),
        updated_at: new Date().toISOString(),
        context_apps: note.tip_tracking_app ? [note.tip_tracking_app] : [],
        estimated_minutes: note.focus_duration || 5,
        recurring_type: note.recurring_type || 'none',
        recurring_interval: note.recurring_interval || 1,
        recurring_days: note.recurring_days || null,
        next_due_at: toIso(note.next_due_at),
        last_completed_at: toIso(note.last_completed_at),
        needs_review: Boolean(note.needs_review),
        last_shown_at: toIso(note.last_shown),
        snooze_until: toIso(note.snoozed_until),
        show_count: note.show_count || 0,
        prerequisite_tip_id: note.prerequisite_tip_id || null
      },
      note.content || ''
    );
    liveFileNames.add(fileName);
  });
  return liveFileNames;
}

function syncFromDatabase(db, reason = 'manual') {
  const root = ensureStorageTree();
  const liveCategories = syncCategories(root, db);
  const liveSubcategories = syncSubcategories(root, db);
  const liveNotes = syncNotes(root, db);
  const trashed = {
    categories: moveStaleFilesToTrash(root, 'categories', liveCategories),
    subcategories: moveStaleFilesToTrash(root, 'subcategories', liveSubcategories),
    notes: moveStaleFilesToTrash(root, 'notes', liveNotes)
  };
  fs.writeFileSync(
    path.join(root, 'logs', 'last-sync.json'),
    JSON.stringify({ reason, synced_at: new Date().toISOString(), trashed }, null, 2),
    'utf8'
  );
  return { root, trashed };
}

function readBackCategories(root, db) {
  let updated = 0;
  listMarkdownFiles(root, 'categories').forEach(filePath => {
    const { fields } = parseFrontmatterFile(filePath);
    if (fields.entity_type !== 'category') return;
    const id = numericEntityId(fields.id, 'category');
    if (!id || !db.get('SELECT id FROM categories WHERE id = ?', [id])) return;

    const current = db.get('SELECT triggers FROM categories WHERE id = ?', [id]) || {};
    const triggers = parseTriggers(current.triggers);
    const nextTriggers = {
      apps: Array.isArray(fields.context_apps) ? fields.context_apps : triggers.apps,
      keywords: Array.isArray(fields.keywords) ? fields.keywords : triggers.keywords
    };

    db.run(
      `UPDATE categories
       SET name = COALESCE(?, name),
           color = COALESCE(?, color),
           triggers = ?
       WHERE id = ?`,
      [
        fields.name || null,
        fields.color || null,
        JSON.stringify(nextTriggers),
        id
      ]
    );
    updated += 1;
  });
  return updated;
}

function readBackSubcategories(root, db) {
  let updated = 0;
  listMarkdownFiles(root, 'subcategories').forEach(filePath => {
    const { fields } = parseFrontmatterFile(filePath);
    if (fields.entity_type !== 'subcategory') return;
    const id = numericEntityId(fields.id, 'subcategory');
    if (!id || !db.get('SELECT id FROM subcategories WHERE id = ?', [id])) return;

    db.run(
      `UPDATE subcategories
       SET name = COALESCE(?, name),
           order_index = COALESCE(?, order_index),
           is_sequential = COALESCE(?, is_sequential),
           deadline_mode = COALESCE(?, deadline_mode),
           shared_deadline = ?
       WHERE id = ?`,
      [
        fields.name || null,
        Number.isFinite(fields.order_index) ? fields.order_index : null,
        typeof fields.is_sequential === 'boolean' ? (fields.is_sequential ? 1 : 0) : null,
        fields.deadline_mode || null,
        fields.shared_deadline || null,
        id
      ]
    );
    updated += 1;
  });
  return updated;
}

function readBackNotes(root, db) {
  const validStatuses = new Set(['active', 'retired', 'done', 'cancelled']);
  let updated = 0;

  listMarkdownFiles(root, 'notes').forEach(filePath => {
    const { fields, body } = parseFrontmatterFile(filePath);
    if (fields.entity_type !== 'note') return;
    const id = numericEntityId(fields.id, 'note');
    if (!id || !db.get('SELECT id FROM tips WHERE id = ?', [id])) return;

    const status = validStatuses.has(fields.status) ? fields.status : null;
    const importance = Number.isFinite(fields.importance)
      ? Math.max(1, Math.min(10, Math.round(fields.importance)))
      : null;
    const focusDuration = Number.isFinite(fields.estimated_minutes)
      ? Math.max(1, Math.round(fields.estimated_minutes))
      : null;
    const recurringDays = Array.isArray(fields.recurring_days)
      ? JSON.stringify(fields.recurring_days)
      : (fields.recurring_days || null);

    db.run(
      `UPDATE tips
       SET content = COALESCE(?, content),
           importance = COALESCE(?, importance),
           status = COALESCE(?, status),
           deadline = ?,
           focus_duration = COALESCE(?, focus_duration),
           recurring_type = COALESCE(?, recurring_type),
           recurring_interval = COALESCE(?, recurring_interval),
           recurring_days = ?,
           next_due_at = ?,
           needs_review = COALESCE(?, needs_review)
       WHERE id = ?`,
      [
        body || fields.title || null,
        importance,
        status,
        fields.deadline || null,
        focusDuration,
        fields.recurring_type || null,
        Number.isFinite(fields.recurring_interval) ? fields.recurring_interval : null,
        recurringDays,
        fields.next_due_at || null,
        typeof fields.needs_review === 'boolean' ? (fields.needs_review ? 1 : 0) : null,
        id
      ]
    );
    updated += 1;
  });

  return updated;
}

function readBackToDatabase(db, reason = 'manual-read-back') {
  const root = ensureStorageTree();
  db.exec('BEGIN TRANSACTION');
  try {
    const categoriesUpdated = readBackCategories(root, db);
    const subcategoriesUpdated = readBackSubcategories(root, db);
    const notesUpdated = readBackNotes(root, db);
    db.exec('COMMIT');
    fs.writeFileSync(
      path.join(root, 'logs', 'last-read-back.json'),
      JSON.stringify({
        reason,
        read_at: new Date().toISOString(),
        categoriesUpdated,
        subcategoriesUpdated,
        notesUpdated
      }, null, 2),
      'utf8'
    );
    return { root, categoriesUpdated, subcategoriesUpdated, notesUpdated };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

module.exports = {
  getStorageRoot,
  ensureStorageTree,
  syncFromDatabase,
  readBackToDatabase
};
