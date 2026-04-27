'use strict';

/**
 * Heuristic match for native or web-wrapped AI clients from active-win metadata.
 * Browsers are only treated as AI contexts when the *title* matches (avoids plain Google Chrome).
 */
const NATIVE_OWNER_HINTS = [
  'chatgpt',
  'openai',
  'claude',
  'anthropic',
  'gemini',
  'copilot',
  'perplexity',
  'cursor',
  'windsurf',
  'ollama',
  'lm studio',
  'lmstudio',
  'chatbox',
  'jan',
];

const TITLE_HINTS = [
  'chatgpt',
  'claude',
  'gemini',
  'copilot',
  'perplexity',
  'openai',
  'anthropic',
  'ollama',
  'ai studio',
  'google ai',
];

const BROWSER_OWNER_MARKERS = [
  'chrome',
  'chromium',
  'firefox',
  'microsoft edge',
  'brave',
  'safari',
  'opera',
];

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .trim();
}

function isBrowserShell(ownerName) {
  const o = norm(ownerName);
  return BROWSER_OWNER_MARKERS.some((m) => o.includes(m));
}

function titleMatchesAi(title) {
  const t = norm(title);
  if (!t) {
    return false;
  }
  if (TITLE_HINTS.some((p) => t.includes(p))) {
    return true;
  }
  if (t.includes('chat') && (t.includes('gpt') || t.includes('gemini') || t.includes('claude'))) {
    return true;
  }
  return false;
}

function isLikelyAiApp(active) {
  if (!active) {
    return false;
  }
  const ownerName = norm(active.owner && active.owner.name);
  const title = norm(active.title);
  const bundleId = norm(active.bundleId || active.owner?.bundleId);

  if (isBrowserShell(ownerName)) {
    return titleMatchesAi(title);
  }

  for (const p of NATIVE_OWNER_HINTS) {
    if (ownerName.includes(p) || bundleId.includes(p)) {
      return true;
    }
  }
  return titleMatchesAi(title);
}

module.exports = {
  isLikelyAiApp,
};
