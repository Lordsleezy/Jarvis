'use strict';

const express = require('express');
const {
  saveMemory,
  getAllMemories,
  searchMemories,
  getMemoriesByCategory,
  deleteMemory,
  exportContextString,
} = require('../memory/db');

const router = express.Router();

router.post('/memories', (req, res, next) => {
  const { category, content, source } = req.body ?? {};
  try {
    const memory = saveMemory(category, content, source);
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
  res.json(getAllMemories());
});

router.get('/memories/search', (req, res) => {
  const keyword = req.query.keyword;
  res.json(searchMemories(keyword));
});

router.get('/memories/category/:category', (req, res, next) => {
  try {
    res.json(getMemoriesByCategory(req.params.category));
  } catch (err) {
    if (err instanceof TypeError) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

router.delete('/memories/:id', (req, res) => {
  const removed = deleteMemory(req.params.id);
  if (!removed) {
    res.status(404).json({ error: 'Memory not found' });
    return;
  }
  res.status(204).send();
});

router.get('/memories/export', (req, res) => {
  res.type('text/plain; charset=utf-8').send(exportContextString());
});

module.exports = router;
