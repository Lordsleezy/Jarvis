'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const Database = require('better-sqlite3');

const portrait = require('./portrait.js');
const ledger = require('./ledger.js');
// Loaded for queue pipeline; classify is used via queue → classifier.
// eslint-disable-next-line no-unused-vars
const classifier = require('./classifier.js');
const queue = require('./queue.js');

function resolveEmbeddingDim() {
  const n = Number(process.env.JARVIS_EMBEDDING_DIM);
  if (Number.isFinite(n) && n > 0 && n <= 8192) {
    return Math.floor(n);
  }
  return 384;
}

/** Default 384 floats per BLOB; set JARVIS_EMBEDDING_DIM if your model returns a different width */
const EMBEDDING_DIM = resolveEmbeddingDim();
const EMBEDDING_BYTES = EMBEDDING_DIM * 4;

const OLLAMA_EMBED_URL =
  process.env.OLLAMA_EMBED_URL || 'http://localhost:11434/api/embeddings';
const OLLAMA_EMBED_MODEL =
  process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';

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

function tryLoadSqliteVec(db) {
  try {
    try {
      db.pragma('enable_load_extension = true');
    } catch (_e) {
      /* optional */
    }
    require('sqlite-vec').load(db);
    db.prepare('SELECT vec_version() AS v').get();
    return true;
  } catch (_err) {
    return false;
  }
}

async function fetchEmbeddingVector(text) {
  const prompt = String(text || '').trim();
  if (!prompt) {
    return null;
  }
  const response = await fetch(OLLAMA_EMBED_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_EMBED_MODEL,
      prompt,
    }),
  });
  if (!response.ok) {
    return null;
  }
  const payload = await response.json();
  const arr = payload.embedding;
  if (!Array.isArray(arr) || arr.length < EMBEDDING_DIM) {
    return null;
  }
  return Float32Array.from(arr.slice(0, EMBEDDING_DIM));
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

  const vecLoaded = tryLoadSqliteVec(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT ''
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_vectors (
      id TEXT PRIMARY KEY NOT NULL,
      embedding BLOB NOT NULL,
      CHECK (length(embedding) = ${EMBEDDING_BYTES})
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

  const deleteVectorStmt = db.prepare(`
    DELETE FROM memory_vectors WHERE id = ?
  `);

  const upsertVectorStmt = db.prepare(`
    INSERT INTO memory_vectors (id, embedding)
    VALUES (?, ?)
    ON CONFLICT(id) DO UPDATE SET embedding = excluded.embedding
  `);

  const countVectorsStmt = db.prepare(`
    SELECT COUNT(*) AS c FROM memory_vectors
  `);

  let vectorKnnStmt = null;
  if (vecLoaded) {
    try {
      vectorKnnStmt = db.prepare(`
        SELECT
          m.id,
          m.timestamp,
          m.category,
          m.content,
          m.source
        FROM memory_vectors v
        INNER JOIN memories m ON m.id = v.id
        WHERE vec_length(v.embedding) = ?
        ORDER BY vec_distance_cosine(v.embedding, ?) ASC
        LIMIT ?
      `);
    } catch (_e) {
      vectorKnnStmt = null;
    }
  }

  async function saveMemory(category, content, source = '', _options = {}) {
    const cat = normalizeCategory(category);
    const text = String(content || '').trim();
    if (!text) {
      throw new TypeError('content must not be empty');
    }
    const src = source === undefined || source === null ? '' : String(source).trim();
    const id = randomUUID();
    const row = insertMemory.get(id, cat, text, src);

    if (vecLoaded && upsertVectorStmt) {
      try {
        const emb = await fetchEmbeddingVector(text);
        if (emb && emb.length === EMBEDDING_DIM) {
          upsertVectorStmt.run(row.id, Buffer.from(emb.buffer, emb.byteOffset, emb.byteLength));
        }
      } catch (_err) {
        /* silent: SQLite row remains without vector */
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
    try {
      deleteVectorStmt.run(memoryId);
    } catch (_e) {
      /* silent */
    }
    const result = deleteMemoryStmt.run(memoryId);
    return result.changes > 0;
  }

  function keywordRelevantMemories(query, limit) {
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

  async function findRelevantMemories(query, limit = 5) {
    const max = Number(limit) > 0 ? Number(limit) : 5;
    const q = String(query || '').trim();
    if (!q) {
      return [];
    }

    let vectorCount = 0;
    if (vecLoaded && vectorKnnStmt) {
      try {
        vectorCount = Number(countVectorsStmt.get().c) || 0;
      } catch (_e) {
        vectorCount = 0;
      }
    }

    if (vecLoaded && vectorKnnStmt && vectorCount > 0) {
      try {
        const qEmb = await fetchEmbeddingVector(q);
        if (qEmb && qEmb.length === EMBEDDING_DIM) {
          const qBuf = new Float32Array(qEmb);
          const rows = vectorKnnStmt.all(EMBEDDING_DIM, qBuf, max);
          if (rows.length > 0) {
            return rows.map((row) => ({
              id: row.id,
              content: row.content,
              category: row.category,
              source: row.source,
              timestamp: row.timestamp,
            }));
          }
        }
      } catch (_err) {
        /* fall through to keyword */
      }
    }

    return keywordRelevantMemories(q, max);
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

  function exportFullContext() {
    const legacy = exportContextString();
    return (
      `[JARVIS LEGACY MEMORIES]\n${legacy}\n\n` +
      `[JARVIS ATOMIC FACTS]\n${ledger.exportLedger()}\n\n` +
      `[JARVIS BEHAVIORAL PORTRAIT]\n${portrait.getContext()}`
    );
  }

  memoryApi = {
    saveMemory,
    getAllMemories,
    searchMemories,
    getMemoriesByCategory,
    deleteMemory,
    exportContextString,
    findRelevantMemories,
    getPortrait: () => portrait.getPortrait(),
    updatePortrait: (category, dimension, signal, strength) =>
      portrait.updateDimension(category, dimension, signal, strength),
    getPortraitContext: () => portrait.getContext(),
    serializePortrait: () => portrait.serialize(),
    addAtom: (category, entity, value, source, confidence) =>
      ledger.addAtom(category, entity, value, source, confidence),
    getAtoms: (entity) => ledger.getAtoms(entity),
    searchAtoms: (query) => ledger.searchAtoms(query),
    exportLedger: () => ledger.exportLedger(),
    enqueueMemory: (input, source) => queue.enqueue(input, source),
    getQueueStatus: () => queue.getStatus(),
    exportFullContext,
  };

  return memoryApi;
}

async function saveMemory(category, content, source) {
  const api = await initializeMemoryStore();
  return api.saveMemory(category, content, source);
}

function getPortrait() {
  return portrait.getPortrait();
}

function updatePortrait(category, dimension, signal, strength) {
  return portrait.updateDimension(category, dimension, signal, strength);
}

function getPortraitContext() {
  return portrait.getContext();
}

function serializePortrait() {
  return portrait.serialize();
}

function addAtom(category, entity, value, source, confidence) {
  return ledger.addAtom(category, entity, value, source, confidence);
}

function getAtoms(entity) {
  return ledger.getAtoms(entity);
}

function searchAtoms(query) {
  return ledger.searchAtoms(query);
}

function exportLedger() {
  return ledger.exportLedger();
}

function enqueueMemory(input, source) {
  queue.enqueue(input, source);
}

function getQueueStatus() {
  return queue.getStatus();
}

async function exportFullContext() {
  const api = await initializeMemoryStore();
  return api.exportFullContext();
}

module.exports = {
  initializeMemoryStore,
  saveMemory,
  getPortrait,
  updatePortrait,
  getPortraitContext,
  serializePortrait,
  addAtom,
  getAtoms,
  searchAtoms,
  exportLedger,
  enqueueMemory,
  getQueueStatus,
  exportFullContext,
};
