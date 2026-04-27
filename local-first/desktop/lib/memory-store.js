'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

let dbInstance = null;

function dbDir(app) {
  return path.join(app.getPath('userData'), 'jarvis-memory');
}

function dbPath(app) {
  return path.join(dbDir(app), 'memory.db');
}

function openMemoryDb(app) {
  if (dbInstance) {
    return dbInstance;
  }
  const dir = dbDir(app);
  fs.mkdirSync(dir, { recursive: true });
  const file = dbPath(app);
  const db = new Database(file);
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
  dbInstance = db;
  return db;
}

function exportContextString(app) {
  const db = openMemoryDb(app);
  const rows = db
    .prepare(
      `
      SELECT category, content, source
      FROM memories
      ORDER BY timestamp ASC, id ASC
    `
    )
    .all();
  if (rows.length === 0) {
    return 'No memories stored yet.';
  }
  const sentences = rows.map((m) => {
    const label = String(m.category).charAt(0).toUpperCase() + String(m.category).slice(1);
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
  openMemoryDb,
  exportContextString,
  dbPath,
};
