'use strict';

const path = require('path');
const { randomUUID } = require('crypto');
const Database = require('better-sqlite3');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.resolve(PROJECT_ROOT, 'jarvis.db');

const VALID_CATEGORIES = new Set([
  'personal',
  'work',
  'preference',
  'goal',
  'fact',
]);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY NOT NULL,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT ''
  );
`);

const insertMemory = db.prepare(`
  INSERT INTO memories (id, category, content, source)
  VALUES (?, ?, ?, ?)
  RETURNING id, timestamp, category, content, source
`);

const selectAll = db.prepare(`
  SELECT id, timestamp, category, content, source
  FROM memories
  ORDER BY timestamp ASC, id ASC
`);

const searchMemoriesStmt = db.prepare(`
  SELECT id, timestamp, category, content, source
  FROM memories
  WHERE INSTR(LOWER(content), LOWER(?)) > 0
  ORDER BY timestamp ASC, id ASC
`);

const getMemoriesByCategoryStmt = db.prepare(`
  SELECT id, timestamp, category, content, source
  FROM memories
  WHERE category = ?
  ORDER BY timestamp ASC, id ASC
`);

const deleteMemoryStmt = db.prepare(`
  DELETE FROM memories WHERE id = ?
`);

function normalizeCategory(category) {
  if (category === undefined || category === null) {
    throw new TypeError('category is required');
  }
  const c = String(category).trim().toLowerCase();
  if (!VALID_CATEGORIES.has(c)) {
    throw new TypeError(
      `category must be one of: ${[...VALID_CATEGORIES].sort().join(', ')}`
    );
  }
  return c;
}

function saveMemory(category, content, source = '') {
  const cat = normalizeCategory(category);
  if (content === undefined || content === null) {
    throw new TypeError('content is required');
  }
  const text = String(content).trim();
  if (!text) {
    throw new TypeError('content must not be empty');
  }
  const src =
    source === undefined || source === null ? '' : String(source).trim();

  const id = randomUUID();
  return insertMemory.get(id, cat, text, src);
}

function getAllMemories() {
  return selectAll.all();
}

function searchMemories(keyword) {
  if (keyword === undefined || keyword === null) {
    return [];
  }
  const k = String(keyword).trim();
  if (!k) {
    return [];
  }
  return searchMemoriesStmt.all(k);
}

function getMemoriesByCategory(category) {
  const cat = normalizeCategory(category);
  return getMemoriesByCategoryStmt.all(cat);
}

function deleteMemory(id) {
  if (id === undefined || id === null) {
    return false;
  }
  const result = deleteMemoryStmt.run(String(id).trim());
  return result.changes > 0;
}

function exportContextString() {
  const rows = getAllMemories();
  if (rows.length === 0) {
    return 'No memories stored yet.';
  }

  const sentences = rows.map((m) => {
    const label = m.category.charAt(0).toUpperCase() + m.category.slice(1);
    const src =
      m.source && String(m.source).trim()
        ? ` (recorded from ${String(m.source).trim()})`
        : '';
    const body = String(m.content).trim().replace(/\s+/g, ' ');
    return `${label}${src}: ${body}`;
  });

  return `Context about this user, from the Jarvis memory store: ${sentences.join(' ')}`;
}

module.exports = {
  saveMemory,
  getAllMemories,
  searchMemories,
  getMemoriesByCategory,
  deleteMemory,
  exportContextString,
};
