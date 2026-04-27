'use strict';

/**
 * Site-specific DOM wiring belongs here (or in per-host modules).
 * This stub proves the channel: page -> extension -> native host -> local SQLite.
 */
(async function jarvisLocalBridge() {
  const { ok, context, error } = await chrome.runtime.sendMessage({
    type: 'GET_CONTEXT',
  });
  if (!ok) {
    console.warn('[Jarvis Local]', error || 'native host unavailable');
    return;
  }
  window.dispatchEvent(
    new CustomEvent('jarvis-local-context', {
      detail: { context: context || '' },
    })
  );
})();
