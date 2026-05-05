'use strict';

const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(process.cwd(), 'ledger.db');

const CATEGORIES = [
  'person',
  'event',
  'decision',
  'number',
  'commitment',
  'preference',
];

const CATEGORY_SET = new Set(CATEGORIES);

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS atoms (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    category TEXT NOT NULL,
    entity TEXT NOT NULL,
    value TEXT NOT NULL,
    source TEXT NOT NULL,
    confidence REAL NOT NULL
  );
`);

const insertStmt = db.prepare(`
  INSERT INTO atoms (id, timestamp, category, entity, value, source, confidence)
  VALUES (@id, @timestamp, @category, @entity, @value, @source, @confidence)
`);

const selectAllStmt = db.prepare(
  'SELECT id, timestamp, category, entity, value, source, confidence FROM atoms ORDER BY timestamp DESC'
);

const selectByEntityStmt = db.prepare(
  'SELECT id, timestamp, category, entity, value, source, confidence FROM atoms WHERE entity = ? ORDER BY timestamp DESC'
);

const searchStmt = db.prepare(`
  SELECT id, timestamp, category, entity, value, source, confidence FROM atoms
  WHERE instr(lower(entity), lower(@needle)) > 0
     OR instr(lower(value), lower(@needle)) > 0
  ORDER BY timestamp DESC
`);

const deleteStmt = db.prepare('DELETE FROM atoms WHERE id = ?');

function rowToAtom(row) {
  return {
    id: row.id,
    timestamp: row.timestamp,
    category: row.category,
    entity: row.entity,
    value: row.value,
    source: row.source,
    confidence: row.confidence,
  };
}

function assertNonEmptyString(name, v) {
  if (typeof v !== 'string' || v.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function assertConfidence(confidence) {
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) {
    throw new Error('confidence must be a number');
  }
  if (confidence < 0 || confidence > 1) {
    throw new Error('confidence must be between 0.0 and 1.0');
  }
}

function addAtom(category, entity, value, source, confidence) {
  if (!CATEGORY_SET.has(category)) {
    throw new Error(
      `Invalid category "${category}". Must be one of: ${CATEGORIES.join(', ')}`
    );
  }
  assertNonEmptyString('entity', entity);
  assertNonEmptyString('value', value);
  assertNonEmptyString('source', source);
  assertConfidence(confidence);

  const atom = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    category,
    entity: entity.trim(),
    value: value.trim(),
    source: source.trim(),
    confidence,
  };

  insertStmt.run(atom);
  return { ...atom };
}

function getAtoms(entity) {
  const rows =
    entity === undefined || entity === null
      ? selectAllStmt.all()
      : selectByEntityStmt.all(entity);
  return rows.map(rowToAtom);
}

function searchAtoms(query) {
  if (query === undefined || query === null) {
    throw new Error('query is required');
  }
  if (typeof query !== 'string') {
    throw new Error('query must be a string');
  }
  const needle = query.trim();
  if (needle === '') {
    return [];
  }
  const rows = searchStmt.all({ needle });
  return rows.map(rowToAtom);
}

function deleteAtom(id) {
  if (typeof id !== 'string' || id.trim() === '') {
    throw new Error('id must be a non-empty string');
  }
  const info = deleteStmt.run(id);
  return info.changes > 0;
}

function exportLedger() {
  const rows = selectAllStmt.all();
  if (rows.length === 0) {
    return 'No atoms in the ledger.';
  }

  const groups = Object.create(null);
  for (const row of rows) {
    if (!groups[row.category]) {
      groups[row.category] = [];
    }
    groups[row.category].push(row);
  }

  const extras = Object.keys(groups)
    .filter((c) => !CATEGORIES.includes(c))
    .sort();
  const categoryOrder = [...CATEGORIES, ...extras];

  const lines = [];
  for (const cat of categoryOrder) {
    const items = groups[cat];
    if (!items || items.length === 0) continue;
    lines.push(String(cat).toUpperCase());
    lines.push('—'.repeat(Math.max(String(cat).length, 3)));
    for (const r of items) {
      lines.push(`  [${r.timestamp}] ${r.entity} — ${r.value}`);
      lines.push(
        `    source: ${r.source} · confidence: ${r.confidence} · id: ${r.id}`
      );
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

module.exports = {
  addAtom,
  getAtoms,
  searchAtoms,
  deleteAtom,
  exportLedger,
};
