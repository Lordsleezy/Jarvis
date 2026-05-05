'use strict';

const path = require('path');
const { app, Tray, Menu, nativeImage, shell, systemPreferences } = require('electron');
const { openMemoryDb, exportContextString } = require('./lib/memory-store');
const { createFocusInjectionService } = require('./lib/focus-injection-service');
const settings = require('./lib/settings');
const { spawn, execFile } = require('child_process');
const net = require('net');

// Check if a port is in use
function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port);
  });
}

// Start Ollama if not already running
async function ensureOllama() {
  const running = await isPortInUse(11434);
  if (running) {
    console.log('Ollama already running');
    return;
  }
  console.log('Starting Ollama...');
  const proc = spawn('ollama', ['serve'], {
    detached: true,
    stdio: 'ignore',
    shell: true
  });
  proc.unref();
}

// Start Jarvis Node server if not already running
async function ensureJarvisServer() {
  const running = await isPortInUse(3001);
  if (running) {
    console.log('Jarvis server already running');
    return;
  }
  console.log('Starting Jarvis server...');
  const jarvisPath = path.resolve(__dirname, '..', '..', 'index.js');
  const proc = spawn(process.execPath, [jarvisPath], {
    detached: true,
    stdio: 'ignore',
    cwd: path.resolve(__dirname, '..', '..')
  });
  proc.unref();
}

const SINGLE_INSTANCE_LOCK = 'jarvis-local-core';

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let tray = null;
let focusService = null;

function createTrayIcon() {
  return nativeImage.createEmpty();
}

function buildMenu() {
  const template = [
    {
      label: 'Jarvis (local)',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Automatic AI context injection',
      type: 'checkbox',
      checked: settings.isInjectEnabled(),
      click(menuItem) {
        settings.setInjectEnabled(menuItem.checked);
      },
    },
    { type: 'separator' },
    {
      label: 'Memory DB folder',
      click: () => {
        shell.openPath(path.dirname(openMemoryDb(app).name));
      },
    },
    {
      label: 'Copy context preview',
      click: () => {
        const { clipboard } = require('electron');
        clipboard.writeText(exportContextString(app));
      },
    },
  ];

  if (process.platform === 'darwin') {
    template.push({
      label: 'Open Accessibility settings…',
      click: () => {
        shell.openExternal(
          'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
        );
      },
    });
  }

  template.push(
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit(),
    }
  );

  return Menu.buildFromTemplate(template);
}

app.whenReady().then(async () => {
  await ensureOllama();
  await ensureJarvisServer();
  openMemoryDb(app);

  if (process.platform === 'darwin') {
    const trusted = systemPreferences.isTrustedAccessibilityClient(false);
    if (!trusted) {
      systemPreferences.isTrustedAccessibilityClient(true);
    }
  }

  focusService = createFocusInjectionService(app);
  focusService.start();

  tray = new Tray(createTrayIcon());
  tray.setToolTip('Jarvis — local memory + AI focus injection');
  tray.setContextMenu(buildMenu());
});

app.on('before-quit', () => {
  if (focusService) {
    focusService.stop();
  }
});

app.on('window-all-closed', () => {});
