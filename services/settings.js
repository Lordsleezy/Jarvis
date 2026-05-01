'use strict';

const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = 'settings.json';

function createSettingsManager(userDataPath) {
  const settingsPath = path.join(userDataPath, SETTINGS_FILE);
  let state = { core: {}, modules: {} };

  function load() {
    if (!fs.existsSync(settingsPath)) {
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(settingsPath, JSON.stringify(state, null, 2));
      return;
    }
    const raw = fs.readFileSync(settingsPath, 'utf8').trim();
    if (!raw) {
      return;
    }
    state = JSON.parse(raw);
  }

  function persist() {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(state, null, 2));
  }

  function get(key, defaultValue = null) {
    return Object.prototype.hasOwnProperty.call(state.core, key)
      ? state.core[key]
      : defaultValue;
  }

  function set(key, value) {
    state.core[key] = value;
    persist();
  }

  function registerModuleSettings(moduleName, defaults = {}) {
    if (!state.modules[moduleName]) {
      state.modules[moduleName] = defaults;
    } else {
      state.modules[moduleName] = {
        ...defaults,
        ...state.modules[moduleName],
      };
    }
    persist();
  }

  load();

  return {
    get,
    set,
    getAll: () => JSON.parse(JSON.stringify(state)),
    registerModuleSettings,
    path: settingsPath,
  };
}

module.exports = {
  createSettingsManager,
};
