'use strict';

const OLLAMA_GENERATE_URL =
  process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3';
const OLLAMA_TIMEOUT_MS = process.env.OLLAMA_TIMEOUT_MS
  ? Number(process.env.OLLAMA_TIMEOUT_MS)
  : 120000;

function createChatService({ memoryApi }) {
  async function generateResponse(message) {
    const userMessage = String(message || '').trim();
    if (!userMessage) {
      throw new TypeError('message must be a non-empty string');
    }

    const context = await memoryApi.exportSmartContext(userMessage);
    const prompt = context.length > 0 ? `${context}\n\nUser: ${userMessage}` : userMessage;

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
      const err = new Error(`Ollama request failed (${ollamaRes.status}) ${details.slice(0, 120)}`);
      err.statusCode = 502;
      throw err;
    }

    const data = await ollamaRes.json();
    const text = typeof data.response === 'string' ? data.response : String(data.response || '');

    await memoryApi.saveMemory('fact', userMessage, 'conversation');
    if (text.trim()) {
      await memoryApi.saveMemory('fact', text.trim(), 'jarvis');
    }

    return { response: text };
  }

  return {
    generateResponse,
  };
}

module.exports = {
  createChatService,
};
