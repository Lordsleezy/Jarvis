'use strict';

const DEFAULT_REMOTE_SERVER_URL = 'http://192.168.0.117:3001';
const DEFAULT_LOCAL_OLLAMA_HEALTH_URL = 'http://localhost:11434';

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

async function isLegionReachable(remoteBaseUrl) {
  const url = `${String(remoteBaseUrl || DEFAULT_REMOTE_SERVER_URL).replace(/\/$/, '')}/`;
  return isUrlReachable(url, 2000);
}

async function detectRuntimeMode(settings) {
  const configuredRemoteBaseUrl =
    settings.get('remoteServerUrl', DEFAULT_REMOTE_SERVER_URL);
  const remoteHealthUrl = `${configuredRemoteBaseUrl.replace(/\/$/, '')}/`;
  const localOllamaHealthUrl = settings.get(
    'localOllamaHealthUrl',
    DEFAULT_LOCAL_OLLAMA_HEALTH_URL
  );

  // Local mode is always the safe default. Power mode only when Legion is truly reachable.
  const remoteReachable = await isUrlReachable(remoteHealthUrl);
  const localReachable = await isUrlReachable(localOllamaHealthUrl);
  let activeMode = 'local';
  if (remoteReachable) {
    activeMode = 'power';
  }
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
  isLegionReachable,
  DEFAULT_REMOTE_SERVER_URL,
  DEFAULT_LOCAL_OLLAMA_HEALTH_URL,
};
