# Jarvis Desktop Foundation

Jarvis is a local-first Electron desktop assistant by Sentinel Prime.  
This foundation is production-focused and intended to be the baseline your team builds on.

## What This Includes

- Cross-platform Electron desktop shell (Windows/macOS/Linux)
- System tray app with single-instance lock and toggleable main window
- Auto-start on boot
- Local-first storage only (`app.getPath('userData')`)
- SQLite memory store for canonical memory records
- LanceDB vector memory for semantic memory search
- Ollama embedding integration (`http://localhost:11434`)
- Safe IPC bridge (`preload.js`) for chat/memory/search/status/settings
- Modular runtime with `JarvisCore` event bus and module lifecycle contracts
- Auto-updater with `electron-updater` (GitHub Releases)
- Installer packaging with `electron-builder` (`.exe`, `.dmg`, `.AppImage`)

## Folder Structure

`main.js` Electron main process, tray, updater, module bootstrap, IPC handlers  
`preload.js` secure renderer bridge  
`renderer/` desktop chat UI (dark sci-fi)  
`core/jarvis-core.js` central event emitter used by modules  
`modules/*/index.js` module lifecycle stubs (`initialize/getStatus/shutdown`)  
`memory/db.js` SQLite + LanceDB + Ollama embedding integration  
`services/chat-service.js` chat orchestration and memory-aware prompt creation  
`services/settings.js` JSON settings manager in userData  
`services/module-loader.js` module discovery and lifecycle orchestration  
`routes/` Express routes that reuse the same memory/chat services  
`index.js` optional standalone API server entrypoint

## Prerequisites

- Node.js 20+
- npm 10+
- Ollama installed and running locally

Recommended Ollama models:

- Chat model: `llama3` (or your preferred chat model)
- Embedding model: `nomic-embed-text`

Example:

```bash
ollama pull llama3
ollama pull nomic-embed-text
ollama serve
```

## Quick Start (Under 10 Minutes)

```bash
git clone https://github.com/Lordsleezy/Jarvis.git
cd Jarvis
npm install
npm run dev
```

That launches the Electron desktop app and system tray process.

## Local-First Storage Paths

All runtime data is kept local in Electron userData:

- SQLite DB: `<userData>/jarvis.db`
- LanceDB vectors: `<userData>/vector-memory/`
- Settings JSON: `<userData>/settings.json`

No backend server is required for desktop mode and no cloud storage is used.

## IPC Contract

Exposed via `window.jarvis` in renderer:

- `jarvis.chat(message)` -> `{ response }`
- `jarvis.memory.save(category, content, source?)`
- `jarvis.memory.list()`
- `jarvis.memory.remove(id)`
- `jarvis.memory.exportContext(query)`
- `jarvis.search(query, limit?)` semantic memory search
- `jarvis.status()` module runtime status
- `jarvis.settings.getAll()`
- `jarvis.settings.get(key, defaultValue?)`
- `jarvis.settings.set(key, value)`
- `jarvis.settings.registerModule(moduleName, defaults)`

## Module Contract

Each module in `/modules/<name>/index.js` exports:

- `initialize({ jarvisCore, settings, moduleName })`
- `getStatus()`
- `shutdown()`

Included stubs:

- `voice`
- `injection`
- `calendar`
- `security`
- `health`
- `financial`
- `messaging`
- `smarthome`
- `people`

All modules are initialized at startup and report status through `jarvis:status`.

## Vector Memory API

`memory/db.js` provides:

- `saveMemory(category, content, source)`  
  Saves text in SQLite and embedding vector in LanceDB.
- `findRelevantMemories(query, limit)`  
  Semantic retrieval by meaning using LanceDB vector search.
- `exportSmartContext(query)`  
  Returns top 10 relevant memories formatted for context injection.

## Optional API Server Mode

If you also want HTTP APIs (for browser/mobile clients):

```bash
npm run start:api
```

Server routes remain in `/routes` and reuse the same core logic.

## Build Installers

```bash
npm run dist
```

Artifacts:

- Windows: NSIS `.exe`
- macOS: `.dmg`
- Linux: `.AppImage`

## Auto Updates

Auto updates use GitHub Releases from:

- `https://github.com/Lordsleezy/Jarvis`

On startup, Jarvis checks for updates in the background.  
When an update is downloaded, Jarvis installs and restarts.

## Environment Variables

Optional runtime configuration:

- `OLLAMA_URL` (default `http://localhost:11434/api/generate`)
- `OLLAMA_MODEL` (default `llama3`)
- `OLLAMA_TIMEOUT_MS` (default `120000`)
- `OLLAMA_EMBED_URL` (default `http://localhost:11434/api/embeddings`)
- `OLLAMA_EMBED_MODEL` (default `nomic-embed-text`)
- `JARVIS_USER_DATA_PATH` (API mode override only)

## Production Notes

- Desktop mode is fully local-first and offline-capable except model inference calls to local Ollama.
- The tray icon currently uses an empty native image and can be replaced with branded assets in `build/`.
- Sign/notarize binaries as part of your CI release workflow for enterprise distribution.