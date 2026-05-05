'use strict';

const express = require('express');
const memoryDb = require('../memory/db');

const router = express.Router();

let cachedMemoryApi = null;
let memoryApiInitPromise = null;

async function getApi() {
  if (cachedMemoryApi) {
    return cachedMemoryApi;
  }
  if (!memoryApiInitPromise) {
    memoryApiInitPromise = memoryDb.initializeMemoryStore();
  }
  cachedMemoryApi = await memoryApiInitPromise;
  return cachedMemoryApi;
}

router.post('/memories', async (req, res, next) => {
  const { category, content, source } = req.body ?? {};
  try {
    const memoryApi = await getApi();
    const memory = await memoryApi.saveMemory(category, content, source);
    res.status(201).json(memory);
  } catch (err) {
    if (err instanceof TypeError) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

router.get('/memories', async (req, res, next) => {
  try {
    const memoryApi = await getApi();
    res.json(memoryApi.getAllMemories());
  } catch (err) {
    next(err);
  }
});

router.get('/memories/search', async (req, res, next) => {
  try {
    const memoryApi = await getApi();
    const keyword = req.query.keyword;
    res.json(memoryApi.searchMemories(keyword));
  } catch (err) {
    next(err);
  }
});

router.get('/memories/semantic', async (req, res, next) => {
  try {
    const memoryApi = await getApi();
    const query = String(req.query.query || '');
    const limit = Number(req.query.limit || 5);
    res.json(await memoryApi.findRelevantMemories(query, limit));
  } catch (err) {
    next(err);
  }
});

router.get('/memories/category/:category', async (req, res, next) => {
  try {
    const memoryApi = await getApi();
    res.json(memoryApi.getMemoriesByCategory(req.params.category));
  } catch (err) {
    if (err instanceof TypeError) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

router.delete('/memories/:id', async (req, res, next) => {
  try {
    const memoryApi = await getApi();
    const removed = memoryApi.deleteMemory(req.params.id);
    if (!removed) {
      res.status(404).json({ error: 'Memory not found' });
      return;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.get('/memories/export', async (req, res, next) => {
  try {
    const memoryApi = await getApi();
    res.type('text/plain; charset=utf-8').send(memoryApi.exportContextString());
  } catch (err) {
    next(err);
  }
});

router.post('/memory/enqueue', async (req, res) => {
  try {
    const { input, source } = req.body ?? {};
    memoryDb.enqueueMemory(input, source);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

router.get('/memory/portrait', (req, res) => {
  try {
    res.json(memoryDb.getPortrait());
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

router.get('/memory/portrait/context', (req, res) => {
  try {
    res.json({ context: memoryDb.getPortraitContext() });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

router.get('/memory/ledger', (req, res) => {
  try {
    res.json(memoryDb.getAtoms());
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

router.get('/memory/ledger/search', (req, res) => {
  try {
    const q = req.query.q;
    res.json(memoryDb.searchAtoms(q));
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

router.get('/memory/export/full', async (req, res) => {
  try {
    const fullContext = await memoryDb.exportFullContext();
    res.json({ fullContext });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

router.get('/memory/queue/status', (req, res) => {
  try {
    res.json(memoryDb.getQueueStatus());
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

module.exports = router;
