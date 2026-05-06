'use strict';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.1-8b-instant';
const GROQ_TIMEOUT_MS = 30000;

const { searchWeb, needsWebSearch } = require('./search-service');

const conversationHistory = [];
const MAX_HISTORY = 10;

function addToHistory(role, content) {
  conversationHistory.push({ role, content });
  if (conversationHistory.length > MAX_HISTORY * 2) {
    conversationHistory.splice(0, 2);
  }
}

function getHistoryMessages() {
  return conversationHistory.map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content
  }));
}

function createGroqChatService({ settings } = {}) {
  const apiKey = process.env.GROQ_API_KEY;

  async function generateResponse(userMessage) {
    if (!userMessage || !userMessage.trim()) {
      throw new TypeError('message must be a non-empty string');
    }

    const msg = userMessage.trim();
    addToHistory('user', msg);

    const currentDate = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    let webContext = '';
    if (needsWebSearch(msg, conversationHistory)) {
      try {
        const searchResult = await searchWeb(msg);
        if (searchResult) {
          webContext = `\n\n<web_context>\n${searchResult}\n</web_context>`;
        }
      } catch (_) {}
    }

    const systemPrompt = `You are Jarvis, a helpful personal AI assistant on the Sentinel Prime website. Today is ${currentDate}.

Rules:
- Be concise and direct. Answer the question.
- When web search data is provided in <web_context> tags, use it as your primary source and report it naturally without mentioning the tags.
- Never say "according to real-time web data" or repeat tag names. Just answer naturally.
- If web data is provided, trust it over your training data.
- If you genuinely have no information, say so briefly.
- Do not add unnecessary suggestions or lists unless asked.
- You have access to conversation history. Use it to understand follow-up questions.`;

    const messages = [
      { role: 'system', content: systemPrompt + webContext },
      ...getHistoryMessages().slice(0, -1),
      { role: 'user', content: msg }
    ];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);

    try {
      const res = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages,
          max_tokens: 1024,
          temperature: 0.7,
          stream: false
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Groq API error ${res.status}: ${err}`);
      }

      const data = await res.json();
      const responseText = data.choices?.[0]?.message?.content || '';
      addToHistory('assistant', responseText);
      return { response: responseText };

    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  return { generateResponse };
}

module.exports = { createGroqChatService };
