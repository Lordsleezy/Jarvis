'use strict';

const {
  isLegionReachable,
  DEFAULT_REMOTE_SERVER_URL,
} = require('./mode-manager');
const { searchWeb, needsWebSearch } = require('./search-service');

const conversationHistory = [];
const MAX_HISTORY = 10;

function addToHistory(role, content) {
  conversationHistory.push({ role, content });
  if (conversationHistory.length > MAX_HISTORY * 2) {
    conversationHistory.splice(0, 2);
  }
}

function getHistoryAsText() {
  if (conversationHistory.length === 0) return '';
  return conversationHistory
    .map((m) => `${m.role === 'user' ? 'User' : 'Jarvis'}: ${m.content}`)
    .join('\n');
}

/** Prior turns only — current user message is appended separately in the prompt. */
function getHistoryAsTextForPrompt(currentUserMessage) {
  let entries = conversationHistory;
  const last = entries[entries.length - 1];
  if (last && last.role === 'user' && last.content === currentUserMessage) {
    entries = entries.slice(0, -1);
  }
  if (entries.length === 0) return '';
  return entries
    .map((m) => `${m.role === 'user' ? 'User' : 'Jarvis'}: ${m.content}`)
    .join('\n');
}

function enrichQueryWithContext(userMessage, history) {
  const q = userMessage.toLowerCase().trim();

  const isFollowUp =
    q.startsWith('what about') ||
    q.startsWith('how about') ||
    q.startsWith('and ') ||
    q === 'why' ||
    q === 'elaborate' ||
    q.startsWith('tell me more') ||
    q.startsWith('what of');

  if (!isFollowUp || history.length === 0) return userMessage;

  const lastMessages = history
    .slice(-4)
    .map((m) => m.content)
    .join(' ')
    .toLowerCase();

  const stripped = userMessage.replace(/what about|how about|and|what of/gi, '').trim();

  if (
    lastMessages.includes('weather') ||
    lastMessages.includes('temperature') ||
    lastMessages.includes('forecast')
  ) {
    return `weather ${stripped}`;
  }
  if (
    lastMessages.includes('stock') ||
    lastMessages.includes('price') ||
    lastMessages.includes('shares')
  ) {
    return `stock price ${stripped}`;
  }
  if (
    lastMessages.includes('bitcoin') ||
    lastMessages.includes('crypto') ||
    lastMessages.includes('ethereum')
  ) {
    return `crypto price ${stripped}`;
  }
  if (
    lastMessages.includes('nba') ||
    lastMessages.includes('nfl') ||
    lastMessages.includes('score')
  ) {
    return `sports score ${stripped}`;
  }

  return userMessage;
}

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
    let context = '';
    const memories = memoryApi.getAllMemories().slice(0, 5);
    if (memories.length > 0) {
      const sentences = memories.map((m) => {
        const label = m.category.charAt(0).toUpperCase() + m.category.slice(1);
        const src = m.source ? ` (recorded from ${m.source})` : '';
        const body = String(m.content).trim().replace(/\s+/g, ' ');
        return `${label}${src}: ${body}`;
      });
      context = `Context about this user, from the Jarvis memory store: ${sentences.join(' ')}`;
    }
    if (context && context.length > 1000) {
      context = context.slice(-1000);
    }

    let webContext = '';
    if (needsWebSearch(userMessage, conversationHistory)) {
      const enrichedQuery = enrichQueryWithContext(userMessage, conversationHistory);
      const searchResult = await searchWeb(enrichedQuery);
      if (searchResult) {
        webContext = `\n\n<web_context>\n${searchResult}\n</web_context>`;
      }
    }

    const currentDate = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const systemInstruction = `You are Jarvis, a helpful personal AI assistant. Today is ${currentDate}.

Rules:
- Be concise and direct. Answer the question. Do not ramble.
- When web search data is provided in the context between <web_context> tags, use it as your primary source and report it naturally without mentioning the tags.
- Never say "according to real-time web data" or repeat tag names. Just answer naturally.
- If web data is provided, trust it over your training data.
- If you genuinely have no information, say so briefly.
- Do not add unnecessary suggestions or lists unless asked.
- You have access to the conversation history above. Use it to understand follow-up questions like "elaborate", "why", "tell me more", "what about X".
- When user says "elaborate", "tell me more", "explain more", or "why" — expand on your previous answer using the conversation history.
- When user references something from earlier in the conversation, use the history to understand what they mean.
- Always search the web for current information when the question involves anything time-sensitive.`;

    const historyText = getHistoryAsTextForPrompt(userMessage);

    const prompt = `${systemInstruction}

${context.length > 0 ? 'Memory context:\n' + context + '\n\n' : ''}${webContext ? webContext + '\n\n' : ''}${
      historyText ? 'Conversation so far:\n' + historyText + '\n\n' : ''
    }User: ${userMessage}
Jarvis:`;

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

    addToHistory('user', userMessage);

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

    const responseText = typeof text === 'string' ? text : String(text || '');
    addToHistory('assistant', responseText);

    await memoryApi.saveMemory('fact', userMessage, 'conversation');
    if (responseText.trim()) {
      await memoryApi.saveMemory('fact', responseText.trim(), 'jarvis');
    }

    return { response: responseText };
  }

  return {
    generateResponse,
  };
}

module.exports = {
  createChatService,
};
