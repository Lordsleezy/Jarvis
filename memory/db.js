'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const Database = require('better-sqlite3');
const lancedb = require('@lancedb/lancedb');

const OLLAMA_EMBED_URL =
  process.env.OLLAMA_EMBED_URL || 'http://localhost:11434/api/embeddings';
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';

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

async function getEmbedding(input) {
  const text = String(input || '').trim();
  if (!text) {
    throw new TypeError('Embedding input must not be empty');
  }
  const response = await fetch(OLLAMA_EMBED_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_EMBED_MODEL,
      prompt: text,
    }),
  });
  if (!response.ok) {
    throw new Error(`Ollama embedding request failed (${response.status})`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload.embedding) || payload.embedding.length === 0) {
    throw new Error('Ollama embedding payload missing embedding array');
  }
  return payload.embedding;
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
  const vectorPath = path.join(dataRoot, 'vector-memory');
  fs.mkdirSync(vectorPath, { recursive: true });

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

  const vectorDb = await lancedb.connect(vectorPath);
  const tableNames = await vectorDb.tableNames();
  let hasVectorTable = tableNames.includes('memories');
  let vectorTable = null;

  if (hasVectorTable) {
    vectorTable = await vectorDb.openTable('memories');
  }

  async function ensureVectorTable(firstRow) {
    if (vectorTable) {
      return vectorTable;
    }
    vectorTable = await vectorDb.createTable('memories', [firstRow]);
    hasVectorTable = true;
    return vectorTable;
  }

  async function saveMemory(category, content, source = '', options = {}) {
    const cat = normalizeCategory(category);
    const text = String(content || '').trim();
    if (!text) {
      throw new TypeError('content must not be empty');
    }
    const src = source === undefined || source === null ? '' : String(source).trim();
    const id = randomUUID();
    const row = insertMemory.get(id, cat, text, src);

    const shouldSkipEmbedding = Boolean(options && options.skipEmbedding);
    if (!shouldSkipEmbedding) {
      try {
        const embedding = await getEmbedding(text);
        const vectorRow = {
          id: row.id,
          vector: embedding,
          content: row.content,
          category: row.category,
          source: row.source,
          timestamp: row.timestamp,
        };
        if (!hasVectorTable) {
          await ensureVectorTable(vectorRow);
        } else {
          await vectorTable.add([vectorRow]);
        }
      } catch (err) {
        // Keep SQLite as source of truth even if vectorization is unavailable.
        console.warn('Vector embedding unavailable for memory save:', err.message || err);
      }
    }

    return row;
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
    if (vectorTable) {
      vectorTable.delete(`id = '${memoryId.replace(/'/g, "''")}'`).catch(() => {});
    }
    return result.changes > 0;
  }

  async function findRelevantMemories(query, limit = 5) {
    const q = String(query || '').trim();
    const max = Number(limit) > 0 ? Number(limit) : 5;
    if (!q) {
      return [];
    }
    if (!vectorTable) {
      return [];
    }
    let embedding;
    try {
      embedding = await getEmbedding(q);
    } catch (_err) {
      return [];
    }
    const rows = await vectorTable.search(embedding).limit(max).toArray();
    return rows.map((row) => ({
      id: row.id,
      content: row.content,
      category: row.category,
      source: row.source,
      timestamp: row.timestamp,
      score: row._distance,
    }));
  }

  async function exportSmartContext(query) {
    const relevant = await findRelevantMemories(query, 10);
    if (relevant.length === 0) {
      return 'No relevant Jarvis memories found.';
    }
    const contextLines = relevant.map((m, index) => {
      const src = m.source ? ` [${m.source}]` : '';
      return `${index + 1}. (${m.category}${src}) ${m.content}`;
    });
    return `Jarvis Relevant Memory Context:\n${contextLines.join('\n')}`;
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
    exportSmartContext,
  };

  return memoryApi;
}

module.exports = {
  initializeMemoryStore,
};
