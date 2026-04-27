'use strict';

/**
 * Peer-to-peer sync (no central server holding user data).
 *
 * Intended direction:
 * - Encrypted replication of SQLite change sets or CRDT-backed documents.
 * - Transport: libp2p / Noise + mDNS (LAN) + optional relay that never sees plaintext.
 * - Pairing: short codes or QR on same LAN; device identity = long-lived keypair.
 *
 * This module is a placeholder; wire it once the desktop daemon exposes a stable IPC API.
 */

function startSync(_opts) {
  throw new Error('P2P sync not implemented yet — see architecture notes in repo discussion.');
}

function stopSync() {}

module.exports = {
  startSync,
  stopSync,
};
