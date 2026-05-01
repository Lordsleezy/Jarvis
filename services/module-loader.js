'use strict';

const path = require('path');

function createModuleLoader({ modulesPath, moduleNames, jarvisCore, settings }) {
  const loaded = new Map();

  async function initializeAll() {
    for (const name of moduleNames) {
      const modulePath = path.join(modulesPath, name, 'index.js');
      const moduleFactory = require(modulePath);
      settings.registerModuleSettings(name, {});
      await moduleFactory.initialize({ jarvisCore, settings, moduleName: name });
      loaded.set(name, moduleFactory);
    }
  }

  function getStatus() {
    const status = {};
    for (const [name, mod] of loaded.entries()) {
      status[name] = mod.getStatus();
    }
    return status;
  }

  async function shutdownAll() {
    for (const mod of loaded.values()) {
      await mod.shutdown();
    }
    loaded.clear();
  }

  return {
    initializeAll,
    getStatus,
    shutdownAll,
  };
}

module.exports = {
  createModuleLoader,
};
