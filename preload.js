'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvis', {
  getVersion: () => ipcRenderer.invoke('jarvis:getVersion'),
  checkForUpdates: () => ipcRenderer.invoke('jarvis:checkForUpdates'),
  chat: (payload) => ipcRenderer.invoke('jarvis:chat', payload),
  memory: {
    save: (category, content, source = '') =>
      ipcRenderer.invoke('jarvis:memory', { action: 'save', category, content, source }),
    list: () => ipcRenderer.invoke('jarvis:memory', { action: 'list' }),
    remove: (id) => ipcRenderer.invoke('jarvis:memory', { action: 'delete', id }),
    exportContext: (query) =>
      ipcRenderer.invoke('jarvis:memory', { action: 'exportContext', query }),
  },
  search: (query, limit = 5) => ipcRenderer.invoke('jarvis:search', { query, limit }),
  status: () => ipcRenderer.invoke('jarvis:status'),
  settings: {
    getAll: () => ipcRenderer.invoke('jarvis:settings', { action: 'getAll' }),
    get: (key, defaultValue) =>
      ipcRenderer.invoke('jarvis:settings', { action: 'get', key, defaultValue }),
    set: (key, value) => ipcRenderer.invoke('jarvis:settings', { action: 'set', key, value }),
    registerModule: (moduleName, defaults) =>
      ipcRenderer.invoke('jarvis:settings', { action: 'registerModule', moduleName, defaults }),
  },
  bootstrap: {
    getState: () => ipcRenderer.invoke('jarvis:bootstrap', { action: 'getState' }),
    completeSetup: (profile) => ipcRenderer.invoke('jarvis:bootstrap', { action: 'completeSetup', profile }),
    onProgress: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('jarvis:bootstrap-progress', handler);
      return () => ipcRenderer.removeListener('jarvis:bootstrap-progress', handler);
    },
  },
});
