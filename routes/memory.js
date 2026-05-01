'use strict';

const express = require('express');

module.exports = function createMemoryRouter({ memoryApi }) {
  const router = express.Router();

  router.post('/memories', async (req, res, next) => {
    const { category, content, source } = req.body ?? {};
    try {
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

  router.get('/memories', (req, res) => {
    res.json(memoryApi.getAllMemories());
  });

  router.get('/memories/search', (req, res) => {
    const keyword = req.query.keyword;
    res.json(memoryApi.searchMemories(keyword));
  });

  router.get('/memories/semantic', async (req, res, next) => {
    try {
      const query = String(req.query.query || '');
      const limit = Number(req.query.limit || 5);
      res.json(await memoryApi.findRelevantMemories(query, limit));
    } catch (err) {
      next(err);
    }
  });

  router.get('/memories/category/:category', (req, res, next) => {
    try {
      res.json(memoryApi.getMemoriesByCategory(req.params.category));
    } catch (err) {
      if (err instanceof TypeError) {
        res.status(400).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  router.delete('/memories/:id', (req, res) => {
    const removed = memoryApi.deleteMemory(req.params.id);
    if (!removed) {
      res.status(404).json({ error: 'Memory not found' });
      return;
    }
    res.status(204).send();
  });

  router.get('/memories/export', async (req, res, next) => {
    try {
      res.type('text/plain; charset=utf-8').send(await memoryApi.exportSmartContext('general'));
    } catch (err) {
      next(err);
    }
  });

  return router;
};
