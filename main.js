'use strict';

require('dotenv').config();

const path = require('path');
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  Notification,
} = require('electron');
const AutoLaunch = require('auto-launch');
const log = require('electron-log/main');
const { autoUpdater } = require('electron-updater');
const memoryStore = require('./memory/db');
const { createChatService } = require('./services/chat-service');
const { createSettingsManager } = require('./services/settings');
const { createModuleLoader } = require('./services/module-loader');
const { JarvisCore } = require('./core/jarvis-core');

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

function createTrayIcon() {
  return nativeImage.createEmpty();
}

function createMainWindow() {
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

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      win.hide();
    }
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
    { label: 'Check for Updates', click: () => autoUpdater.checkForUpdates().catch((err) => log.error(err)) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

function configureAutoUpdater() {
  autoUpdater.on('error', (err) => {
    log.error('Auto updater error:', err);
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
  });
}

function wireIpc() {
  ipcMain.handle('jarvis:chat', async (_event, payload) => {
    const message = typeof payload?.message === 'string' ? payload.message : '';
    return chatService.generateResponse(message);
  });

  ipcMain.handle('jarvis:memory', async (_event, payload = {}) => {
    const action = payload.action;
    if (action === 'save') {
      return memoryApi.saveMemory(payload.category, payload.content, payload.source);
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
  });

  ipcMain.handle('jarvis:search', async (_event, payload = {}) => {
    return memoryApi.findRelevantMemories(payload.query || '', payload.limit || 5);
  });

  ipcMain.handle('jarvis:status', async () => {
    return modules.getStatus();
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
}

app.on('second-instance', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  settings = createSettingsManager(app.getPath('userData'));
  memoryApi = await memoryStore.initializeMemoryStore(app.getPath('userData'));
  chatService = createChatService({ memoryApi });
  modules = createModuleLoader({
    modulesPath: path.join(__dirname, 'modules'),
    moduleNames,
    jarvisCore,
    settings,
  });

  await modules.initializeAll();

  autoLauncher = new AutoLaunch({ name: 'Jarvis' });
  autoLauncher.enable().catch((err) => log.error('Auto-launch setup failed:', err));

  mainWindow = createMainWindow();
  tray = new Tray(createTrayIcon());
  tray.setToolTip('Jarvis');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', toggleWindow);

  wireIpc();
  configureAutoUpdater();
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
  }
});

app.on('before-quit', async () => {
  app.isQuiting = true;
  if (modules) {
    await modules.shutdownAll();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Keep running as tray app.
  }
});
