'use strict';

const express = require('express');

module.exports = function createChatRouter({ chatService }) {
  const router = express.Router();

  router.post('/chat', async (req, res, next) => {
    const message = req.body?.message;
    if (typeof message !== 'string' || message.trim() === '') {
      res.status(400).json({ error: 'Request body must include a non-empty string "message" field' });
      return;
    }

    try {
      res.json(await chatService.generateResponse(message));
    } catch (err) {
      if (err instanceof TypeError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err.statusCode) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      if (err.name === 'AbortError') {
        res.status(504).json({ error: 'Ollama request timed out' });
        return;
      }
      next(err);
    }
  });

  return router;
};
