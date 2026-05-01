'use strict';

let state = { initialized: false, lastStartedAt: null };

async function initialize({ jarvisCore, settings, moduleName }) {
  settings.registerModuleSettings(moduleName, { enabled: true });
  state = { initialized: true, lastStartedAt: new Date().toISOString() };
  jarvisCore.emit('module:initialized', { module: moduleName });
}

function getStatus() {
  return { module: 'people', ...state };
}

async function shutdown() {
  state.initialized = false;
}

module.exports = { initialize, getStatus, shutdown };
