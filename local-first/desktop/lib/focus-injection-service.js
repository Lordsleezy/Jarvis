'use strict';

const activeWin = require('active-win');
const { exportContextString } = require('./memory-store');
const { isLikelyAiApp } = require('./ai-app-detector');
const { injectContextText } = require('./inject-via-platform');
const settings = require('./settings');

const DEFAULT_POLL_MS = 1200;

/**
 * Injects when focus *transitions* from a non-AI foreground app to an AI app.
 * Avoids spamming the focused field on every poll tick.
 */
function createFocusInjectionService(app, options = {}) {
  const pollMs = options.pollMs || DEFAULT_POLL_MS;
  let timer = null;
  let wasAi = false;
  let busy = false;

  async function tick() {
    if (!settings.isInjectEnabled() || busy) {
      return;
    }
    let win;
    try {
      win = typeof activeWin.sync === 'function' ? activeWin.sync() : await activeWin();
    } catch (e) {
      console.warn('[Jarvis] active-win:', e.message);
      return;
    }
    const isAi = isLikelyAiApp(win);
    if (isAi && !wasAi) {
      busy = true;
      try {
        const context = exportContextString(app);
        await injectContextText(context);
      } catch (e) {
        console.warn('[Jarvis] inject failed:', e.message);
      } finally {
        busy = false;
      }
    }
    wasAi = isAi;
  }

  return {
    start() {
      if (timer) {
        return;
      }
      timer = setInterval(() => {
        tick().catch((e) => console.warn('[Jarvis] focus tick:', e.message));
      }, pollMs);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      wasAi = false;
    },
  };
}

module.exports = {
  createFocusInjectionService,
};
