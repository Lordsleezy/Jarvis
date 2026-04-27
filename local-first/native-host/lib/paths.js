'use strict';

const os = require('os');
const path = require('path');

/** Must match Electron app `package.json` name in local-first/desktop. */
const APP_DIR_NAME = 'jarvis-local-core';

/**
 * Mirrors Electron's default `app.getPath('userData')` for a packaged app name,
 * so this host reads the same SQLite file as the desktop daemon.
 */
function electronLikeUserDataDir() {
  if (process.env.JARVIS_USER_DATA) {
    return path.resolve(process.env.JARVIS_USER_DATA);
  }
  const home = os.homedir();
  switch (process.platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', APP_DIR_NAME);
    case 'win32':
      return path.join(
        process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
        APP_DIR_NAME
      );
    default:
      return path.join(
        process.env.XDG_CONFIG_HOME || path.join(home, '.config'),
        APP_DIR_NAME
      );
  }
}

function memoryDbPath() {
  return path.join(electronLikeUserDataDir(), 'jarvis-memory', 'memory.db');
}

module.exports = {
  electronLikeUserDataDir,
  memoryDbPath,
  APP_DIR_NAME,
};
