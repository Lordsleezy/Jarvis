'use strict';

async function isUrlReachable(url, timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    return response.ok;
  } catch (_err) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function detectRuntimeMode(settings) {
  const configuredRemoteBaseUrl =
    settings.get('remoteServerUrl', 'http://192.168.0.117:3001');
  const remoteHealthUrl = `${configuredRemoteBaseUrl.replace(/\/$/, '')}/`;
  const localOllamaHealthUrl = settings.get('localOllamaHealthUrl', 'http://localhost:11434');

  const remoteReachable = await isUrlReachable(remoteHealthUrl);
  const localReachable = await isUrlReachable(localOllamaHealthUrl);

  const activeMode = remoteReachable ? 'power' : 'local';
  settings.set('runtimeMode', activeMode);
  settings.set('remoteServerUrl', configuredRemoteBaseUrl);
  settings.set('localOllamaHealthUrl', localOllamaHealthUrl);

  return {
    activeMode,
    remoteReachable,
    localReachable,
    remoteServerUrl: configuredRemoteBaseUrl,
    localOllamaHealthUrl,
  };
}

module.exports = {
  detectRuntimeMode,
  isUrlReachable,
};
