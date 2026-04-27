'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileP = promisify(execFile);

const PLATFORM_ROOT = path.join(__dirname, '..', 'platform');

function writePayloadFile(text) {
  const tmp = path.join(
    os.tmpdir(),
    `jarvis-context-${process.pid}-${Date.now()}.txt`
  );
  fs.writeFileSync(tmp, text, 'utf8');
  return tmp;
}

async function injectContextText(text) {
  const payloadPath = writePayloadFile(text);
  try {
    if (process.platform === 'win32') {
      const ps = path.join(PLATFORM_ROOT, 'windows', 'Inject-UiAutomation.ps1');
      await execFileP(
        'powershell.exe',
        ['-NoProfile', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', ps, payloadPath],
        { timeout: 20000, windowsHide: true }
      );
      return;
    }
    if (process.platform === 'darwin') {
      const scr = path.join(PLATFORM_ROOT, 'darwin', 'inject.applescript');
      await execFileP('osascript', [scr, payloadPath], { timeout: 20000 });
      return;
    }
    // Linux: AT-SPI first, then X11 clipboard fallback
    const py = path.join(PLATFORM_ROOT, 'linux', 'inject_atspi.py');
    try {
      await execFileP('python3', [py, payloadPath], { timeout: 20000 });
    } catch (e) {
      const sh = path.join(PLATFORM_ROOT, 'linux', 'inject-x11-fallback.sh');
      await execFileP('bash', [sh, payloadPath], { timeout: 20000 });
    }
  } finally {
    try {
      fs.unlinkSync(payloadPath);
    } catch {
      // ignore
    }
  }
}

module.exports = {
  injectContextText,
};
