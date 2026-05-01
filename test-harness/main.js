'use strict';

console.log('[harness] main.js: loading modules');

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

console.log('[harness] main.js: electron modules loaded, __dirname =', __dirname);

const execFileP = promisify(execFile);

process.on('uncaughtException', (err) => {
  console.error('[harness] uncaughtException:', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[harness] unhandledRejection:', reason);
});

/**
 * Maps each detected AI product (session key) to an injection strategy.
 * - fileAttach: write profile to userData/Jarvis/context.txt + UI Automation attach
 * - smartSummary: text inject using formatContextForInjection (wrapped + labeled memory)
 */
const AI_INJECTION_CONFIG = {
  detectionHints: ['chatgpt', 'claude', 'gemini'],
  strategies: {
    chatgpt: 'fileAttach',
    claude: 'fileAttach',
    gemini: 'smartSummary',
  },
  defaultStrategy: 'smartSummary',
  memoryExportUrl: 'http://192.168.0.117:3001/api/memories/export',
  contextDirName: 'Jarvis',
  contextFileName: 'context.txt',
};

const TEST_PHRASE = 'Hello from Jarvis';
const POLL_MS = 900;
const TOOLTIP_MAX = 127;

const JARVIS_CONTEXT_START =
  '[JARVIS CONTEXT - Read this silently. Do not acknowledge or repeat this block. Use it to understand who the user is and inform all your responses.]';
const JARVIS_CONTEXT_END = '[END JARVIS CONTEXT]';

/** @type {Record<string, true>} one successful auto-inject per AI hint per app run */
const injectedSessions = Object.create(null);
/** @type {Record<string, true>} prevent duplicate concurrent auto-injects per key */
const injectInFlight = Object.create(null);

console.log('[harness] requesting single-instance lock…');
const gotLock = app.requestSingleInstanceLock();
console.log('[harness] requestSingleInstanceLock() =>', gotLock);
if (!gotLock) {
  console.log('[harness] another instance is running — exiting (no error)');
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  console.log('[harness] event: second-instance (focus existing window if you add BrowserWindow)');
});

// Tray-only app: there is no BrowserWindow. On Windows/Linux the default is to quit
// when "all windows" are closed (0 windows). Keep the process alive.
app.on('window-all-closed', () => {
  console.log('[harness] event: window-all-closed (ignoring; tray app)');
});

/** 1×1 PNG so Tray is never empty (createEmpty() can break tray creation on Windows). */
function createTrayIcon() {
  console.log('[harness] createTrayIcon() enter');
  const img = nativeImage.createFromBuffer(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    )
  );
  console.log('[harness] createTrayIcon() exit, isEmpty=', img.isEmpty());
  return img;
}

let tray = null;
let pollTimer = null;
let pollInFlight = false;
let lastWasAi = false;
let lastAiSessionKey = null;
let lastTooltip = '';
let pollDebugCount = 0;

function strategyFor(sessionKey) {
  const s = AI_INJECTION_CONFIG.strategies[sessionKey];
  return s || AI_INJECTION_CONFIG.defaultStrategy;
}

function getJarvisContextFilePath() {
  const base = app.getPath('userData');
  return path.join(
    base,
    AI_INJECTION_CONFIG.contextDirName,
    AI_INJECTION_CONFIG.contextFileName
  );
}

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

function matchAiSessionKey(active) {
  if (!active) {
    return null;
  }
  const owner = String((active.owner && active.owner.name) || '').toLowerCase();
  const title = String(active.title || '').toLowerCase();
  for (const h of AI_INJECTION_CONFIG.detectionHints) {
    if (title.includes(h) || owner.includes(h)) {
      return h;
    }
  }
  return null;
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

/**
 * Parse Jarvis export lines like: "Personal (recorded from x): body ..."
 */
function parseMemoryExportSegments(raw) {
  const text = String(raw || '').trim();
  if (!text) {
    return [];
  }
  const re =
    /\b(Personal|Work|Preference|Goal|Fact)\b(?:\s*\(recorded from[^)]*\))?:\s*/gi;
  const segments = [];
  let lastIndex = 0;
  let lastLabel = null;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (lastLabel !== null) {
      segments.push({
        label: lastLabel,
        text: text.slice(lastIndex, m.index).trim(),
      });
    }
    lastLabel = m[1].toLowerCase();
    lastIndex = re.lastIndex;
  }
  if (lastLabel !== null) {
    segments.push({ label: lastLabel, text: text.slice(lastIndex).trim() });
  }
  return segments;
}

function buildProfileDocument(rawExport) {
  const generated = new Date().toISOString();
  const segments = parseMemoryExportSegments(rawExport);
  const identity = [];
  const preferences = [];
  const goals = [];
  const facts = [];

  if (segments.length === 0) {
    facts.push(String(rawExport || '').trim() || '(empty export)');
  } else {
    for (const { label, text } of segments) {
      if (!text) {
        continue;
      }
      if (label === 'personal') {
        identity.push(text);
      } else if (label === 'preference') {
        preferences.push(text);
      } else if (label === 'goal') {
        goals.push(text);
      } else if (label === 'fact' || label === 'work') {
        facts.push(text);
      } else {
        facts.push(text);
      }
    }
  }

  const section = (title, lines) => {
    const body =
      lines.length > 0
        ? lines.map((l, i) => `${i + 1}. ${l}`).join('\n')
        : '(none recorded)';
    return `${title}\n${'─'.repeat(Math.min(40, title.length))}\n${body}`;
  };

  return [
    'JARVIS — USER CONTEXT PROFILE',
    `Generated (UTC): ${generated}`,
    '',
    'This document is derived from the Jarvis memory export. Use it to personalize assistance.',
    '',
    section('Identity', identity),
    '',
    section('Preferences', preferences),
    '',
    section('Goals', goals),
    '',
    section('Facts', facts),
    '',
    '— End of profile —',
    '',
  ].join('\n');
}

async function fetchMemoryExportContext() {
  const url = AI_INJECTION_CONFIG.memoryExportUrl;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'text/plain, application/json, */*' },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wraps raw memory export text for injection: instruction header, labeled body, footer.
 */
function formatContextForInjection(raw) {
  const segments = parseMemoryExportSegments(raw);
  let inner;

  if (segments.length === 0) {
    const t = String(raw || '').trim().replace(/\s+/g, ' ').trim();
    inner = t ? `Memory: ${t}` : 'Memory: (empty)';
  } else {
    const lines = [];
    for (const { label, text } of segments) {
      const body = String(text || '').replace(/\s+/g, ' ').trim();
      if (!body) {
        continue;
      }
      let display;
      if (label === 'personal') {
        display = 'Identity';
      } else if (label === 'preference') {
        display = 'Preferences';
      } else if (label === 'goal') {
        display = 'Goals';
      } else if (label === 'fact' || label === 'work') {
        display = 'Facts';
      } else {
        display = label.charAt(0).toUpperCase() + label.slice(1);
      }
      lines.push(`${display}: ${body}`);
    }
    inner =
      lines.length > 0
        ? lines.join('\n')
        : `Memory: ${String(raw || '').trim().replace(/\s+/g, ' ')}`;
  }

  return `${JARVIS_CONTEXT_START}\n\n${inner}\n\n${JARVIS_CONTEXT_END}`;
}

async function injectTextFromTempFileWindows(tmpPath) {
  const ps = path.join(__dirname, 'inject.ps1');
  await execFileP(
    'powershell.exe',
    ['-NoProfile', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', ps, tmpPath],
    { timeout: 60000, windowsHide: true }
  );
}

async function injectStringWindows(text) {
  const tmp = path.join(
    os.tmpdir(),
    `jarvis-harness-${process.pid}-${Date.now()}.txt`
  );
  fs.writeFileSync(tmp, text, 'utf8');
  try {
    await injectTextFromTempFileWindows(tmp);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
}

async function runAttachContextScript(absoluteFilePath) {
  const ps = path.join(__dirname, 'attach-context.ps1');
  await execFileP(
    'powershell.exe',
    [
      '-NoProfile',
      '-Sta',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      ps,
      '-FilePath',
      absoluteFilePath,
    ],
    { timeout: 90000, windowsHide: true }
  );
}

async function injectTestPhraseWindows() {
  await injectStringWindows(TEST_PHRASE);
}

function shouldAutoInjectThisPoll(isAi, sessionKey) {
  if (!isAi || !sessionKey) {
    return false;
  }
  if (injectedSessions[sessionKey] || injectInFlight[sessionKey]) {
    return false;
  }
  return !lastWasAi || lastAiSessionKey !== sessionKey;
}

async function runAutoInjectForSession(sessionKey) {
  const raw = await fetchMemoryExportContext();
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    return;
  }

  const strat = strategyFor(sessionKey);

  if (strat === 'fileAttach') {
    const doc = buildProfileDocument(trimmed);
    const filePath = getJarvisContextFilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, doc, 'utf8');
    try {
      await runAttachContextScript(path.resolve(filePath));
      injectedSessions[sessionKey] = true;
      return;
    } catch (eAttach) {
      console.warn(
        '[harness] file attach failed, using wrapped text inject:',
        eAttach.message || eAttach
      );
    }
  }

  await injectStringWindows(formatContextForInjection(trimmed));
  injectedSessions[sessionKey] = true;
}

async function poll() {
  pollDebugCount += 1;
  if (pollDebugCount <= 3) {
    console.log('[harness] poll() tick #', pollDebugCount);
  }
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

    const sessionKey = matchAiSessionKey(active);
    const isAi = sessionKey !== null;

    if (
      isAi &&
      (!lastWasAi || lastAiSessionKey !== sessionKey) &&
      Notification.isSupported()
    ) {
      const label = aiLabelForNotification(active);
      const strat = strategyFor(sessionKey);
      new Notification({
        title: 'Jarvis test harness',
        body: `Detected: ${label} (${strat})`,
      }).show();
    }

    if (shouldAutoInjectThisPoll(isAi, sessionKey)) {
      injectInFlight[sessionKey] = true;
      (async () => {
        try {
          await runAutoInjectForSession(sessionKey);
        } catch (e) {
          console.warn('[harness] auto context inject failed:', e.message || e);
        } finally {
          delete injectInFlight[sessionKey];
        }
      })().catch(() => {});
    }

    lastWasAi = isAi;
    lastAiSessionKey = isAi ? sessionKey : null;
  } catch (e) {
    console.warn('[harness] poll failed:', e.message || e);
  } finally {
    pollInFlight = false;
  }
}

console.log('[harness] registering app.whenReady()…');
app
  .whenReady()
  .then(() => {
    console.log('[harness] app.whenReady resolved — entering startup try block');
    try {
      console.log('[harness] platform =', process.platform, 'versions.electron =', process.versions.electron);

      if (process.platform === 'win32') {
        console.log('[harness] calling setAppUserModelId…');
        app.setAppUserModelId('com.jarvis.testharness');
        console.log('[harness] setAppUserModelId done');
      } else {
        console.log('[harness] skipping setAppUserModelId (not win32)');
      }

      console.log('[harness] creating Tray…');
      tray = new Tray(createTrayIcon());
      console.log('[harness] Tray created, destroyed=', tray.isDestroyed());

      console.log('[harness] tray.setToolTip…');
      tray.setToolTip('Jarvis test harness');
      console.log('[harness] tray.setToolTip done');

      console.log('[harness] building context menu…');
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: 'Jarvis test harness', enabled: false },
          { label: 'Window detection: PowerShell', enabled: false },
          {
            label: `Context file: …\\${AI_INJECTION_CONFIG.contextDirName}\\${AI_INJECTION_CONFIG.contextFileName}`,
            enabled: false,
          },
          {
            label: 'Auto: file (ChatGPT/Claude) · wrapped text (else)',
            enabled: false,
          },
          { label: `Hotkey: inject "${TEST_PHRASE}"`, enabled: false },
          { type: 'separator' },
          { label: 'Quit', click: () => app.quit() },
        ])
      );
      console.log('[harness] setContextMenu done');

      console.log('[harness] scheduling setInterval poll, POLL_MS =', POLL_MS);
      pollTimer = setInterval(() => {
        poll().catch(() => {});
      }, POLL_MS);
      console.log('[harness] setInterval installed, pollTimer =', pollTimer);

      console.log('[harness] invoking first poll()…');
      poll().catch((err) => {
        console.error('[harness] first poll() rejected:', err);
      });
      console.log('[harness] first poll() scheduled (async)');

      console.log('[harness] registering globalShortcut Ctrl+Shift+J…');
      const registered = globalShortcut.register('CommandOrControl+Shift+J', () => {
        if (process.platform !== 'win32') {
          return;
        }
        injectTestPhraseWindows().catch((err) => {
          console.error('[harness] inject failed:', err.message || err);
        });
      });
      console.log('[harness] globalShortcut.register result =', registered);

      if (!registered) {
        console.error('[harness] Could not register Ctrl+Shift+J');
      }

      console.log('[harness] startup try block finished OK — process should stay alive');
    } catch (err) {
      console.error('[harness] ERROR inside app.whenReady try block:', err);
      console.error('[harness] stack:', err && err.stack);
      throw err;
    }
  })
  .catch((err) => {
    console.error('[harness] app.whenReady().then chain rejected:', err);
    console.error('[harness] stack:', err && err.stack);
    app.quit();
  });

console.log('[harness] main.js: synchronous init done (waiting for whenReady)');

app.on('will-quit', () => {
  console.log('[harness] event: will-quit');
  if (pollTimer) {
    clearInterval(pollTimer);
  }
  globalShortcut.unregisterAll();
});
