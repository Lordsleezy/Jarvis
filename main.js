'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  Notification,
  dialog,
} = require('electron');
const AutoLaunch = require('auto-launch');
const log = require('electron-log/main');
const { autoUpdater } = require('electron-updater');
const memoryStore = require('./memory/db');
const { createChatService } = require('./services/chat-service');
const { createSettingsManager } = require('./services/settings');
const { createModuleLoader } = require('./services/module-loader');
const { JarvisCore } = require('./core/jarvis-core');
const { detectRuntimeMode, isUrlReachable } = require('./services/mode-manager');
const { ensureOllamaReady } = require('./services/ollama-installer');

console.log('[Jarvis][startup] main.js loaded');
log.initialize();
autoUpdater.logger = log;
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

const SINGLE_INSTANCE_LOCK = 'jarvis-desktop-single-instance-lock';
const moduleNames = [
  'voice',
  'injection',
  'calendar',
  'security',
  'health',
  'financial',
  'messaging',
  'smarthome',
  'people',
];

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const jarvisCore = new JarvisCore();
let tray = null;
let mainWindow = null;
let memoryApi = null;
let chatService = null;
let settings = null;
let modules = null;
let autoLauncher = null;
let bootstrapState = {
  mode: 'local',
  remoteReachable: false,
  localReachable: false,
  ollamaReady: false,
  setupComplete: false,
  setupRequired: true,
  setupInProgress: true,
  statusMessage: 'Booting Jarvis',
};
let startupPhase = 'boot';
let fatalDialogShown = false;

function getCrashLogPath() {
  try {
    const baseDir = app.isReady()
      ? app.getPath('userData')
      : path.join(process.cwd(), 'jarvis-crash-logs');
    fs.mkdirSync(baseDir, { recursive: true });
    return path.join(baseDir, 'startup-errors.log');
  } catch (_err) {
    return path.join(process.cwd(), 'jarvis-startup-errors.log');
  }
}

function serializeError(err) {
  if (!err) {
    return 'Unknown error';
  }
  if (err instanceof Error) {
    return `${err.name}: ${err.message}\n${err.stack || ''}`;
  }
  try {
    return JSON.stringify(err, null, 2);
  } catch (_jsonErr) {
    return String(err);
  }
}

function writeCrashLog(title, err) {
  const payload = [
    '============================================================',
    `[${new Date().toISOString()}] ${title}`,
    `phase=${startupPhase}`,
    `platform=${process.platform} arch=${process.arch}`,
    serializeError(err),
    '',
  ].join('\n');

  try {
    const filePath = getCrashLogPath();
    fs.appendFileSync(filePath, payload, 'utf8');
    console.error(`[Jarvis][fatal] ${title}. Logged to ${filePath}`);
  } catch (writeErr) {
    console.error('[Jarvis][fatal] Failed to write crash log:', writeErr);
    console.error(payload);
  }
}

async function showFatalStartupDialog(title, err) {
  if (fatalDialogShown) {
    return;
  }
  fatalDialogShown = true;
  const message = `${title}\n\n${serializeError(err).slice(0, 4000)}`;
  try {
    if (app.isReady()) {
      await dialog.showMessageBox({
        type: 'error',
        title: 'Jarvis Startup Crash',
        message: 'Jarvis failed during startup.',
        detail: message,
      });
    }
  } catch (dialogErr) {
    console.error('[Jarvis][fatal] Could not show startup dialog:', dialogErr);
  }
}

function installGlobalCrashHandlers() {
  process.on('unhandledRejection', async (reason) => {
    writeCrashLog('Unhandled Rejection', reason);
    await showFatalStartupDialog('Unhandled Rejection', reason);
  });

  process.on('uncaughtException', async (error) => {
    writeCrashLog('Uncaught Exception', error);
    await showFatalStartupDialog('Uncaught Exception', error);
  });
}

installGlobalCrashHandlers();

function setBootstrapState(patch) {
  bootstrapState = { ...bootstrapState, ...patch };
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('jarvis:bootstrap-progress', bootstrapState);
  }
}

function createTrayIcon() {
  return nativeImage.createEmpty();
}

function createMainWindow() {
  console.log('[Jarvis][startup] createMainWindow');
  const win = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 920,
    minHeight: 600,
    show: false,
    title: 'Jarvis',
    backgroundColor: '#060a11',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html')).catch((err) => {
    writeCrashLog('Renderer load failed', err);
  });
  win.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    writeCrashLog('Renderer process gone', details);
  });
  win.webContents.on('did-fail-load', (_event, code, desc, url) => {
    writeCrashLog('did-fail-load', { code, desc, url });
  });
  return win;
}

function toggleWindow() {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isVisible()) {
    mainWindow.hide();
    return;
  }

  mainWindow.show();
  mainWindow.focus();
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Jarvis', enabled: false },
    { type: 'separator' },
    { label: 'Toggle Window', click: () => toggleWindow() },
    { label: 'Mode: ' + String(settings?.get('runtimeMode', 'local')).toUpperCase(), enabled: false },
    { label: 'Check for Updates', click: () => autoUpdater.checkForUpdates().catch((err) => log.error(err)) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

function configureAutoUpdater() {
  console.log('[Jarvis][startup] configureAutoUpdater');
  autoUpdater.on('error', (err) => {
    log.error('Auto updater error:', err);
    writeCrashLog('Auto updater error', err);
  });

  autoUpdater.on('update-downloaded', () => {
    const note = new Notification({
      title: 'Jarvis Updated',
      body: 'Update installed successfully. Restart Jarvis to use the latest build.',
    });
    note.show();
    autoUpdater.quitAndInstall(false, true);
  });

  autoUpdater.checkForUpdates().catch((err) => {
    log.error('Update check failed:', err);
    writeCrashLog('Update check failed', err);
  });
}

function wireIpc() {
  console.log('[Jarvis][startup] wireIpc');
  ipcMain.handle('jarvis:chat', async (_event, payload) => {
    try {
      if (bootstrapState.setupRequired || bootstrapState.setupInProgress) {
        throw new Error('Jarvis setup is not complete yet.');
      }
      const message = typeof payload?.message === 'string' ? payload.message : '';
      return await chatService.generateResponse(message);
    } catch (err) {
      writeCrashLog('IPC jarvis:chat failed', err);
      throw err;
    }
  });

  ipcMain.handle('jarvis:memory', async (_event, payload = {}) => {
    const action = payload.action;
    try {
      if (action === 'save') {
        return await memoryApi.saveMemory(payload.category, payload.content, payload.source);
      }
      if (action === 'list') {
        return memoryApi.getAllMemories();
      }
      if (action === 'delete') {
        return { removed: memoryApi.deleteMemory(payload.id) };
      }
      if (action === 'exportContext') {
        return { context: await memoryApi.exportSmartContext(payload.query || '') };
      }
      throw new TypeError('Unsupported memory action');
    } catch (err) {
      writeCrashLog('IPC jarvis:memory failed', err);
      throw err;
    }
  });

  ipcMain.handle('jarvis:search', async (_event, payload = {}) => {
    return memoryApi.findRelevantMemories(payload.query || '', payload.limit || 5);
  });

  ipcMain.handle('jarvis:status', async () => {
    return {
      modules: modules.getStatus(),
      runtimeMode: settings.get('runtimeMode', 'local'),
      remoteServerUrl: settings.get('remoteServerUrl', 'http://192.168.0.117:3001'),
    };
  });

  ipcMain.handle('jarvis:settings', async (_event, payload = {}) => {
    const action = payload.action;
    if (action === 'getAll') {
      return settings.getAll();
    }
    if (action === 'get') {
      return settings.get(payload.key, payload.defaultValue);
    }
    if (action === 'set') {
      settings.set(payload.key, payload.value);
      return { ok: true };
    }
    if (action === 'registerModule') {
      settings.registerModuleSettings(payload.moduleName, payload.defaults || {});
      return { ok: true };
    }
    throw new TypeError('Unsupported settings action');
  });

  ipcMain.handle('jarvis:bootstrap', async (_event, payload = {}) => {
    const action = payload.action;
    if (action === 'getState') {
      return bootstrapState;
    }
    if (action === 'completeSetup') {
      const profile = payload.profile || {};
      const onboardingPayload = profile.onboarding || {};
      const userName = String(onboardingPayload.name || '').trim();
      const transcript = Array.isArray(onboardingPayload.transcript)
        ? onboardingPayload.transcript
        : [];
      if (!userName) {
        throw new TypeError('name is required');
      }

      await memoryApi.saveMemory(
        'personal',
        `User name is ${userName}.`,
        'first-run-setup',
        { skipEmbedding: true }
      );

      for (const entry of transcript) {
        const answer = String(entry?.answer || '').trim();
        if (!answer) {
          continue;
        }
        const question = String(entry?.question || '').trim();
        const memoryText = question
          ? `Q: ${question}\nA: ${answer}`
          : answer;
        await memoryApi.saveMemory(
          'fact',
          memoryText,
          'first-run-chat',
          { skipEmbedding: true }
        );
      }

      settings.set('setupComplete', true);
      settings.set('profileName', userName);
      settings.set('setupTranscriptCount', transcript.length);
      setBootstrapState({
        setupComplete: true,
        setupRequired: false,
        setupInProgress: false,
        statusMessage: 'Jarvis ready',
      });
      return bootstrapState;
    }
    throw new TypeError('Unsupported bootstrap action');
  });
}

async function runBootstrap() {
  console.log('[Jarvis][startup] runBootstrap');
  settings.registerModuleSettings('core', {
    remoteServerUrl: 'http://192.168.0.117:3001',
  });
  if (!settings.get('remoteServerUrl', null)) {
    settings.set('remoteServerUrl', 'http://192.168.0.117:3001');
  }
  if (!settings.get('localOllamaHealthUrl', null)) {
    settings.set('localOllamaHealthUrl', 'http://localhost:11434');
  }

  const setupComplete = settings.get('setupComplete', false);
  if (!setupComplete) {
    settings.set('runtimeMode', settings.get('runtimeMode', 'local'));
    setBootstrapState({
      mode: settings.get('runtimeMode', 'local'),
      remoteReachable: false,
      localReachable: false,
      ollamaReady: false,
      setupComplete: false,
      setupRequired: true,
      setupInProgress: false,
      statusMessage: 'First run setup required',
    });
    return;
  }

  setBootstrapState({
    statusMessage: 'Detecting brain mode',
    setupInProgress: true,
  });
  const modeState = await detectRuntimeMode(settings);
  setBootstrapState({
    mode: modeState.activeMode,
    remoteReachable: modeState.remoteReachable,
    localReachable: modeState.localReachable,
  });

  if (modeState.activeMode === 'local') {
    setBootstrapState({ statusMessage: 'Checking local AI brain' });
    try {
      await ensureOllamaReady({
        platform: process.platform,
        progress: (message) => setBootstrapState({ statusMessage: message }),
      });
      setBootstrapState({ ollamaReady: true });
    } catch (err) {
      log.error('Ollama setup failed:', err);
      writeCrashLog('Ollama setup failed', err);
      setBootstrapState({
        ollamaReady: false,
        statusMessage: 'Local AI setup failed. Install Ollama and restart Jarvis.',
      });
    }
  } else {
    setBootstrapState({
      ollamaReady: await isUrlReachable(settings.get('localOllamaHealthUrl', 'http://localhost:11434')),
      statusMessage: 'Power Mode connected',
    });
  }

  setBootstrapState({
    setupComplete,
    setupRequired: !setupComplete,
    setupInProgress: false,
    statusMessage: setupComplete ? 'Jarvis ready' : 'First run setup required',
  });
}

app.on('second-instance', () => {
  console.log('[Jarvis] second-instance event');
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  try {
    startupPhase = 'settings-init';
    console.log('[Jarvis][startup] app ready');
    console.log('[Jarvis][startup] userData path:', app.getPath('userData'));

    settings = createSettingsManager(app.getPath('userData'));
    console.log('[Jarvis][startup] settings ready');

    startupPhase = 'memory-init';
    memoryApi = await memoryStore.initializeMemoryStore(app.getPath('userData'));
    console.log('[Jarvis][startup] memory store ready');

    startupPhase = 'chat-service-init';
    chatService = createChatService({ memoryApi, settings });
    console.log('[Jarvis][startup] chat service ready');

    startupPhase = 'module-loader-init';
    modules = createModuleLoader({
      modulesPath: path.join(__dirname, 'modules'),
      moduleNames,
      jarvisCore,
      settings,
    });
    await modules.initializeAll();
    console.log('[Jarvis][startup] modules initialized');

    startupPhase = 'auto-launch-init';
    autoLauncher = new AutoLaunch({ name: 'Jarvis' });
    autoLauncher.enable().catch((err) => {
      writeCrashLog('Auto-launch setup failed', err);
      log.error('Auto-launch setup failed:', err);
    });
    console.log('[Jarvis][startup] auto-launch configured');

    startupPhase = 'window-init';
    mainWindow = createMainWindow();
    mainWindow.show();
    console.log('[Jarvis][startup] main window shown');

    startupPhase = 'tray-init';
    tray = new Tray(createTrayIcon());
    tray.setToolTip('Jarvis');
    tray.setContextMenu(buildTrayMenu());
    tray.on('click', toggleWindow);
    console.log('[Jarvis][startup] tray ready');

    startupPhase = 'ipc-init';
    wireIpc();
    console.log('[Jarvis][startup] ipc ready');

    startupPhase = 'bootstrap-run';
    await runBootstrap();
    tray.setContextMenu(buildTrayMenu());
    console.log('[Jarvis][startup] bootstrap complete');

    startupPhase = 'updater-init';
    configureAutoUpdater();
    console.log('[Jarvis][startup] updater configured');

    startupPhase = 'ready';
    console.log('[Jarvis][startup] startup completed successfully');
  } catch (err) {
    writeCrashLog('Fatal startup failure', err);
    await showFatalStartupDialog('Fatal startup failure', err);
    app.quit();
  }
}).catch(async (err) => {
  writeCrashLog('app.whenReady rejection', err);
  await showFatalStartupDialog('app.whenReady rejection', err);
  app.quit();
});

app.on('activate', () => {
  try {
    console.log('[Jarvis] activate event');
    if (mainWindow) {
      mainWindow.show();
    }
  } catch (err) {
    writeCrashLog('activate handler failed', err);
  }
});

app.on('before-quit', async () => {
  try {
    console.log('[Jarvis] before-quit event');
    app.isQuiting = true;
    if (modules) {
      await modules.shutdownAll();
    }
  } catch (err) {
    writeCrashLog('before-quit handler failed', err);
  }
});

app.on('window-all-closed', () => {
  try {
    console.log('[Jarvis] window-all-closed event');
    if (process.platform !== 'darwin') {
      // Keep running as tray app.
    }
  } catch (err) {
    writeCrashLog('window-all-closed handler failed', err);
  }
});
