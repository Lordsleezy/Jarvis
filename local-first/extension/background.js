'use strict';

const NATIVE_HOST = 'com.jarvis.local.memory';

function connectNative() {
  return chrome.runtime.connectNative(NATIVE_HOST);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'GET_CONTEXT') {
    return;
  }
  try {
    const port = connectNative();
    port.onMessage.addListener((payload) => {
      if (payload && payload.ok === false) {
        sendResponse({
          ok: false,
          error: payload.error || 'Native host returned an error',
        });
      } else {
        sendResponse({ ok: true, context: payload?.context ?? '' });
      }
      port.disconnect();
    });
    port.onDisconnect.addListener(() => {
      if (chrome.runtime.lastError) {
        sendResponse({
          ok: false,
          error: chrome.runtime.lastError.message,
        });
      }
    });
    port.postMessage({ type: 'EXPORT_CONTEXT' });
  } catch (e) {
    sendResponse({ ok: false, error: String(e.message || e) });
  }
  return true;
});
