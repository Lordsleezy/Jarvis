#!/usr/bin/env node
'use strict';

/**
 * Chrome native messaging host (stdio, length-prefixed JSON).
 * Spec: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
 *
 * Each message: 4-byte little-endian length (message body) + UTF-8 JSON body.
 * Install the companion manifest (com.jarvis.local.memory.json) pointing at
 * launch-host.cmd (Windows) or launch-host.sh (macOS/Linux).
 */

const fs = require('fs');
const { exportMemoryContext } = require('./lib/export-context');

const STDIN_FD = 0;
const STDOUT_FD = 1;
const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

function readExact(fd, buffer, offset, length) {
  let got = 0;
  while (got < length) {
    const n = fs.readSync(fd, buffer, offset + got, length - got, null);
    if (n === 0) {
      return false;
    }
    got += n;
  }
  return true;
}

function readMessage() {
  const lenBuf = Buffer.alloc(4);
  if (!readExact(STDIN_FD, lenBuf, 0, 4)) {
    return null;
  }
  const len = lenBuf.readUInt32LE(0);
  if (len > MAX_MESSAGE_BYTES) {
    throw new Error(`message too large: ${len} bytes`);
  }
  const body = Buffer.alloc(len);
  if (!readExact(STDIN_FD, body, 0, len)) {
    return null;
  }
  return JSON.parse(body.toString('utf8'));
}

function writeMessage(obj) {
  const payload = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  fs.writeSync(STDOUT_FD, header);
  fs.writeSync(STDOUT_FD, payload);
}

function handleRequest(msg) {
  const type = msg && msg.type;
  if (type === 'EXPORT_CONTEXT') {
    try {
      const context = exportMemoryContext();
      return { ok: true, context };
    } catch (err) {
      return {
        ok: false,
        error: err && err.message ? err.message : String(err),
        context: '',
      };
    }
  }
  return {
    ok: false,
    error: `unknown type: ${type}`,
    context: '',
  };
}

function main() {
  if (process.stdin.isTTY) {
    process.stderr.write(
      'jarvis-native-host: stdin is a TTY; this process is meant to be launched by Chrome.\n'
    );
    process.exit(1);
  }

  try {
    while (true) {
      const msg = readMessage();
      if (msg === null) {
        break;
      }
      const response = handleRequest(msg);
      writeMessage(response);
    }
  } catch (err) {
    try {
      writeMessage({
        ok: false,
        error: err && err.message ? err.message : String(err),
        context: '',
      });
    } catch {
      // ignore
    }
    process.exit(1);
  }
}

main();
