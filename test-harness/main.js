'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');
const {
  app,
  Tray,
  Menu,
  nativeImage,
  Notification,
  globalShortcut,
} = require('electron');

const execFileP = promisify(execFile);

const TEST_PHRASE = 'Hello from Jarvis';
const POLL_MS = 900;
const TOOLTIP_MAX = 127;
const AI_HINTS = ['chatgpt', 'claude', 'gemini'];

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let tray = null;
let pollTimer = null;
let pollInFlight = false;
let lastWasAi = false;
let lastTooltip = '';

async function getActiveWindowViaPowerShell() {
  if (process.platform !== 'win32') {
    return null;
  }
  const scriptPath = path.join(__dirname, 'get-active-window.ps1');
  const { stdout } = await execFileP(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    { timeout: 5000, windowsHide: true }
  );
  const out = String(stdout || '').trim();
  if (!out) {
    return null;
  }
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

function isAiSurface(active) {
  if (!active) {
    return false;
  }
  const owner = String((active.owner && active.owner.name) || '').toLowerCase();
  const title = String(active.title || '').toLowerCase();
  const hay = `${owner} ${title}`;
  return AI_HINTS.some((h) => hay.includes(h));
}

function aiLabelForNotification(active) {
  if (!active) {
    return 'Unknown';
  }
  if (active.owner && active.owner.name) {
    return active.owner.name;
  }
  const t = String(active.title || '').trim();
  return t || 'Unknown';
}

function tooltipLine(active) {
  if (!active) {
    return 'Focus: (none)';
  }
  const owner = (active.owner && active.owner.name) || '';
  const title = String(active.title || '').trim() || '—';
  const line = owner ? `${owner} — ${title}` : title;
  const full = `Focus: ${line}`;
  return full.length > TOOLTIP_MAX ? `${full.slice(0, TOOLTIP_MAX - 1)}…` : full;
}

async function injectTestPhraseWindows() {
  const tmp = path.join(os.tmpdir(), `jarvis-harness-${process.pid}-${Date.now()}.txt`);
  fs.writeFileSync(tmp, TEST_PHRASE, 'utf8');
  try {
    const ps = path.join(__dirname, 'inject.ps1');
    await execFileP(
      'powershell.exe',
      ['-NoProfile', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', ps, tmp],
      { timeout: 15000, windowsHide: true }
    );
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
}

async function poll() {
  if (pollInFlight) {
    return;
  }
  pollInFlight = true;
  try {
    const active = await getActiveWindowViaPowerShell();

    const tip = tooltipLine(active);
    if (tip !== lastTooltip && tray) {
      lastTooltip = tip;
      tray.setToolTip(tip);
    }

    const isAi = isAiSurface(active);
    if (isAi && !lastWasAi && Notification.isSupported()) {
      const label = aiLabelForNotification(active);
      new Notification({
        title: 'Jarvis test harness',
        body: `Jarvis detected AI tool: ${label}`,
      }).show();
    }
    lastWasAi = isAi;
  } catch (e) {
    console.warn('[harness] poll failed:', e.message || e);
  } finally {
    pollInFlight = false;
  }
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.jarvis.testharness');
  }

  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('Jarvis test harness');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Jarvis test harness', enabled: false },
      { label: 'Window detection: PowerShell', enabled: false },
      { label: `Hotkey: inject "${TEST_PHRASE}"`, enabled: false },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ])
  );

  pollTimer = setInterval(() => {
    poll().catch(() => {});
  }, POLL_MS);
  poll().catch(() => {});

  const registered = globalShortcut.register('CommandOrControl+Shift+J', () => {
    if (process.platform !== 'win32') {
      return;
    }
    injectTestPhraseWindows().catch((err) => {
      console.error('[harness] inject failed:', err.message || err);
    });
  });

  if (!registered) {
    console.error('[harness] Could not register Ctrl+Shift+J');
  }
});

app.on('will-quit', () => {
  if (pollTimer) {
    clearInterval(pollTimer);
  }
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {});
