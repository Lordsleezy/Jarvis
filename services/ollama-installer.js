'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const OLLAMA_HEALTH_URL = 'http://localhost:11434';
const OLLAMA_DOWNLOAD_URL = 'https://ollama.com/download/windows';
const OLLAMA_MODEL = 'llama3';

async function isOllamaReachable() {
  try {
    const response = await fetch(OLLAMA_HEALTH_URL, { method: 'GET' });
    return response.ok;
  } catch (_err) {
    return false;
  }
}

async function installOllamaOnWindows(progress) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$installer = Join-Path $env:TEMP 'ollama-installer.exe'",
    `Invoke-WebRequest -Uri '${OLLAMA_DOWNLOAD_URL}' -OutFile $installer`,
    'Start-Process -FilePath $installer -ArgumentList \'/S\' -Wait',
  ].join('; ');

  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ]);
  progress('Installing AI brain');
}

async function pullLlamaModel(progress) {
  progress('Downloading Llama 3');
  const response = await fetch('http://localhost:11434/api/pull', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: OLLAMA_MODEL, stream: false }),
  });
  if (!response.ok) {
    throw new Error(`Failed to pull ${OLLAMA_MODEL} (${response.status})`);
  }
  progress('Almost ready');
}

async function ensureOllamaReady({ platform, progress }) {
  if (await isOllamaReachable()) {
    return { installed: true, reason: 'already-installed' };
  }

  if (platform === 'win32') {
    progress('Installing AI brain');
    await installOllamaOnWindows(progress);
  } else {
    throw new Error('Ollama is not installed. Install Ollama manually for this platform.');
  }

  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i += 1) {
    if (await isOllamaReachable()) {
      await pullLlamaModel(progress);
      return { installed: true, reason: 'installed-now' };
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error('Ollama did not become reachable after installation.');
}

module.exports = {
  ensureOllamaReady,
  isOllamaReachable,
};
