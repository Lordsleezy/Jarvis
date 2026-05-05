'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const Database = require('better-sqlite3');

const VALID_CATEGORIES = new Set([
  'personal',
  'work',
  'preference',
  'goal',
  'fact',
]);

let memoryApi = null;

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

function uniqueQueryTokens(query) {
  const seen = new Set();
  const tokens = [];
  for (const t of String(query || '')
    .trim()
    .split(/\s+/)) {
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push(t);
  }
  return tokens;
}

async function initializeMemoryStore(basePath) {
  if (memoryApi) {
    return memoryApi;
  }

  const dataRoot =
    basePath ||
    process.env.JARVIS_USER_DATA_PATH ||
    path.resolve(__dirname, '..');

  fs.mkdirSync(dataRoot, { recursive: true });
  const sqlitePath = path.join(dataRoot, 'jarvis.db');

  const db = new Database(sqlitePath);
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
    ORDER BY timestamp DESC, id DESC
  `);

  const searchMemoriesStmt = db.prepare(`
    SELECT id, timestamp, category, content, source
    FROM memories
    WHERE INSTR(LOWER(content), LOWER(?)) > 0
    ORDER BY timestamp DESC, id DESC
  `);

  const getMemoriesByCategoryStmt = db.prepare(`
    SELECT id, timestamp, category, content, source
    FROM memories
    WHERE category = ?
    ORDER BY timestamp DESC, id DESC
  `);

  const deleteMemoryStmt = db.prepare(`
    DELETE FROM memories WHERE id = ?
  `);

  function saveMemory(category, content, source = '', _options = {}) {
    const cat = normalizeCategory(category);
    const text = String(content || '').trim();
    if (!text) {
      throw new TypeError('content must not be empty');
    }
    const src = source === undefined || source === null ? '' : String(source).trim();
    const id = randomUUID();
    return insertMemory.get(id, cat, text, src);
  }

  function getAllMemories() {
    return selectAll.all();
  }

  function searchMemories(keyword) {
    const k = String(keyword || '').trim();
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
    const memoryId = String(id).trim();
    const result = deleteMemoryStmt.run(memoryId);
    return result.changes > 0;
  }

  function findRelevantMemories(query, limit = 5) {
    const max = Number(limit) > 0 ? Number(limit) : 5;
    const tokens = uniqueQueryTokens(query);
    if (tokens.length === 0) {
      return [];
    }

    const conditions = tokens.map(() => 'INSTR(LOWER(content), LOWER(?)) > 0').join(' AND ');
    const sql = `
      SELECT id, timestamp, category, content, source
      FROM memories
      WHERE ${conditions}
      ORDER BY timestamp DESC, id DESC
      LIMIT ?
    `;
    const stmt = db.prepare(sql);
    const rows = stmt.all(...tokens, max);
    return rows.map((row) => ({
      id: row.id,
      content: row.content,
      category: row.category,
      source: row.source,
      timestamp: row.timestamp,
    }));
  }

  function exportContextString() {
    const rows = getAllMemories();
    if (rows.length === 0) {
      return 'No memories stored yet.';
    }
    const sentences = rows.map((m) => {
      const label = m.category.charAt(0).toUpperCase() + m.category.slice(1);
      const src = m.source ? ` (recorded from ${m.source})` : '';
      const body = String(m.content).trim().replace(/\s+/g, ' ');
      return `${label}${src}: ${body}`;
    });
    return `Context about this user, from the Jarvis memory store: ${sentences.join(' ')}`;
  }

  memoryApi = {
    saveMemory,
    getAllMemories,
    searchMemories,
    getMemoriesByCategory,
    deleteMemory,
    exportContextString,
    findRelevantMemories,
  };

  return memoryApi;
}

module.exports = {
  initializeMemoryStore,
};
