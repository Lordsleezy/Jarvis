'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { memoryDbPath } = require('./paths');

function exportContextFromDbFile(dbFile) {
  if (!fs.existsSync(dbFile)) {
    return 'No memories stored yet.';
  }
  let db;
  try {
    db = new Database(dbFile, { readonly: true, fileMustExist: true });
  } catch {
    return 'No memories stored yet.';
  }
  try {
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
      const label =
        String(m.category).charAt(0).toUpperCase() + String(m.category).slice(1);
      const src =
        m.source && String(m.source).trim()
          ? ` (recorded from ${String(m.source).trim()})`
          : '';
      const body = String(m.content).trim().replace(/\s+/g, ' ');
      return `${label}${src}: ${body}`;
    });
    return `Context about this user, from the Jarvis memory store: ${sentences.join(' ')}`;
  } finally {
    db.close();
  }
}

function exportMemoryContext() {
  const dbFile = memoryDbPath();
  const dir = path.dirname(dbFile);
  if (!fs.existsSync(dir)) {
    return 'No memories stored yet.';
  }
  return exportContextFromDbFile(dbFile);
}

module.exports = {
  exportMemoryContext,
  exportContextFromDbFile,
};
