'use strict';

const express = require('express');
const { saveMemory } = require('../memory/db');

const router = express.Router();

const MEMORY_EXPORT_URL =
  process.env.MEMORY_EXPORT_URL || 'http://localhost:3001/api/memories/export';
const OLLAMA_GENERATE_URL =
  process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3';
const OLLAMA_TIMEOUT_MS = process.env.OLLAMA_TIMEOUT_MS
  ? Number(process.env.OLLAMA_TIMEOUT_MS)
  : 120000;

router.post('/chat', async (req, res, next) => {
  const message = req.body?.message;

  if (typeof message !== 'string' || message.trim() === '') {
    res.status(400).json({ error: 'Request body must include a non-empty string "message" field' });
    return;
  }

  try {
    const memoryRes = await fetch(MEMORY_EXPORT_URL);
    if (!memoryRes.ok) {
      const body = await memoryRes.text().catch(() => '');
      res.status(502).json({
        error: 'Failed to fetch memory context',
        status: memoryRes.status,
        details: body.slice(0, 500),
      });
      return;
    }

    const context = (await memoryRes.text()).trimEnd();
    const userMessage = message.trim();
    const prompt =
      context.length > 0 ? `${context}\n\n${userMessage}` : userMessage;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

    let ollamaRes;
    try {
      ollamaRes = await fetch(OLLAMA_GENERATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt,
          stream: false,
        }),
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!ollamaRes.ok) {
      const details = await ollamaRes.text().catch(() => '');
      res.status(502).json({
        error: 'Ollama request failed',
        status: ollamaRes.status,
        details: details.slice(0, 500),
      });
      return;
    }

    const data = await ollamaRes.json();
    const text =
      typeof data.response === 'string' ? data.response : String(data.response ?? '');

    res.json({ response: text });

    setImmediate(() => {
      try {
        saveMemory('fact', userMessage, 'conversation');
        const jarvisText = text.trim();
        if (jarvisText) {
          saveMemory('fact', jarvisText, 'jarvis');
        }
      } catch (err) {
        console.error('Failed to persist conversation:', err);
      }
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      res.status(504).json({ error: 'Ollama request timed out' });
      return;
    }
    next(err);
  }
});

module.exports = router;
