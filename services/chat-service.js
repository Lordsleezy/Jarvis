'use strict';

const {
  isLegionReachable,
  DEFAULT_REMOTE_SERVER_URL,
} = require('./mode-manager');
const { searchWeb, needsWebSearch } = require('./search-service');

const OLLAMA_GENERATE_URL =
  process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';
const OLLAMA_TIMEOUT_MS = process.env.OLLAMA_TIMEOUT_MS
  ? Number(process.env.OLLAMA_TIMEOUT_MS)
  : 120000;

function createChatService({ memoryApi, settings }) {
  function resolveMode() {
    return settings.get('runtimeMode', 'local') === 'power' ? 'power' : 'local';
  }

  function setLocalMode() {
    settings.set('runtimeMode', 'local');
  }

  async function buildPrompt(userMessage) {
    const context = memoryApi.exportContextString();

    let webContext = '';
    if (needsWebSearch(userMessage)) {
      const searchResult = await searchWeb(userMessage);
      if (searchResult) {
        webContext = `\n\n[REAL-TIME WEB DATA - use this as primary source, ignore training cutoff]:\n${searchResult}\n[END WEB DATA]`;
      }
    }

    const currentDate = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const systemInstruction = `You are Jarvis, a personal AI assistant. Today is ${currentDate}. 
CRITICAL: When web search results are provided above marked with ⚠️, you MUST use that information as your primary source. Do NOT say "as of my knowledge cutoff" when real-time data is available. Answer directly using the web data provided.`;

    const prompt = `${systemInstruction}\n\n${context.length > 0 ? 'Memory context:\n' + context + '\n\n' : ''}${
      webContext ? webContext + '\n\n' : ''
    }User: ${userMessage}\nJarvis:`;

    return prompt;
  }

  async function queryPowerMode(userMessage) {
    const message = await buildPrompt(userMessage);

    const remoteServerUrl = settings.get('remoteServerUrl', DEFAULT_REMOTE_SERVER_URL);
    const response = await fetch(`${remoteServerUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (!response.ok) {
      const details = await response.text().catch(() => '');
      const err = new Error(`Remote Jarvis request failed (${response.status}) ${details.slice(0, 120)}`);
      err.statusCode = 502;
      throw err;
    }
    const payload = await response.json();
    return typeof payload.response === 'string' ? payload.response : '';
  }

  async function queryLocalMode(userMessage) {
    const prompt = await buildPrompt(userMessage);

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
    return typeof data.response === 'string' ? data.response : String(data.response || '');
  }

  async function generateResponse(message) {
    const userMessage = String(message || '').trim();
    if (!userMessage) {
      throw new TypeError('message must be a non-empty string');
    }

    const mode = resolveMode();
    let text = '';

    if (mode === 'power') {
      const remoteServerUrl = settings.get('remoteServerUrl', DEFAULT_REMOTE_SERVER_URL);
      const reachable = await isLegionReachable(remoteServerUrl);
      if (reachable) {
        try {
          text = await queryPowerMode(userMessage);
        } catch (_err) {
          setLocalMode();
          text = await queryLocalMode(userMessage);
        }
      } else {
        setLocalMode();
        text = await queryLocalMode(userMessage);
      }
    } else {
      text = await queryLocalMode(userMessage);
    }

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
