'use strict';

const { classify } = require('./classifier.js');
const portrait = require('./portrait.js');
const ledger = require('./ledger.js');

const LEDGER_CATEGORIES = new Set([
  'person',
  'event',
  'decision',
  'number',
  'commitment',
  'preference',
]);

const PORTRAIT_CATEGORIES = new Set([
  'communication',
  'work',
  'health',
  'financial',
  'social',
  'preferences',
]);

const queue = [];
let workerPromise = null;
const processedListeners = [];

function getStatus() {
  return { pending: queue.length, processing: workerPromise != null };
}

function onProcessed(callback) {
  if (typeof callback === 'function') {
    processedListeners.push(callback);
  }
}

function emitProcessed(classification) {
  for (const fn of processedListeners) {
    try {
      fn(classification);
    } catch (err) {
      console.error('[QUEUE] onProcessed callback error', err);
    }
  }
}

function logLedgerAdd(category, entity) {
  console.log(
    `[QUEUE] ledger.addAtom category=${category} entity=${JSON.stringify(entity)}`
  );
}

function logPortraitUpdate(category, dimension, direction, strength) {
  console.log(
    `[QUEUE] portrait.updateDimension ${category}.${dimension} direction=${direction} strength=${strength}`
  );
}

function applyLedger(classification, source, type) {
  const category = classification.category;

  if (type === 'both') {
    const entity = typeof classification.entity === 'string' ? classification.entity : '';
    const value = typeof classification.value === 'string' ? classification.value : '';
    const conf =
      typeof classification.confidence === 'number' && !Number.isNaN(classification.confidence)
        ? classification.confidence
        : 0;
    try {
      ledger.addAtom('preference', entity, value, source, conf);
      logLedgerAdd('preference', entity);
    } catch (err) {
      console.error('[QUEUE] ledger.addAtom failed', err);
    }
    return;
  }

  if (!LEDGER_CATEGORIES.has(category)) {
    if (type === 'fact') {
      console.log(`[QUEUE] ledger skipped (category not in ledger set: ${category || '(empty)'})`);
    }
    return;
  }
  const entity = typeof classification.entity === 'string' ? classification.entity : '';
  const value = typeof classification.value === 'string' ? classification.value : '';
  const conf =
    typeof classification.confidence === 'number' && !Number.isNaN(classification.confidence)
      ? classification.confidence
      : 0;

  try {
    ledger.addAtom(category, entity, value, source, conf);
    logLedgerAdd(category, entity);
  } catch (err) {
    console.error('[QUEUE] ledger.addAtom failed', err);
  }
}

function applyPortrait(classification, type) {
  const category = classification.category;
  const dimensionRaw = classification.dimension;
  const dimension =
    dimensionRaw === null || dimensionRaw === undefined
      ? ''
      : String(dimensionRaw).trim();

  if (!PORTRAIT_CATEGORIES.has(category) || !dimension) {
    if (type === 'signal') {
      console.log(
        `[QUEUE] portrait skipped (need portrait category + dimension; got ${category || '(empty)'}.${dimension || '(empty)'})`
      );
    }
    return;
  }

  const dir = classification.signal_direction;
  const strength = classification.signal_strength;
  if ((dir !== 1 && dir !== -1) || typeof strength !== 'number' || Number.isNaN(strength)) {
    if (type === 'signal') {
      console.log('[QUEUE] portrait skipped: invalid signal_direction or signal_strength');
    }
    return;
  }

  const strengthClamped = Math.min(1, Math.max(0, strength));

  try {
    portrait.updateDimension(category, dimension, dir, strengthClamped);
    logPortraitUpdate(category, dimension, dir, strengthClamped);
  } catch (err) {
    console.error('[QUEUE] portrait.updateDimension failed', err);
  }
}

async function processOneItem(item) {
  let classification;
  try {
    classification = await classify(item.input);
  } catch (err) {
    console.error('[QUEUE] classify failed', err);
    classification = {
      type: 'neither',
      category: '',
      entity: '',
      value: '',
      dimension: null,
      signal_direction: null,
      signal_strength: null,
      confidence: 0,
    };
  }

  const type = classification.type;
  const source = item.source;

  try {
    if (type === 'fact' || type === 'both') {
      applyLedger(classification, source, type);
    }

    if (type === 'signal' || type === 'both') {
      applyPortrait(classification, type);
    }
  } catch (err) {
    console.error('[QUEUE] processing error', err);
  }

  try {
    emitProcessed(classification);
  } catch (err) {
    console.error('[QUEUE] emitProcessed error', err);
  }
}

async function runWorkerLoop() {
  while (queue.length > 0) {
    const item = queue.shift();
    try {
      await processOneItem(item);
    } catch (err) {
      console.error('[QUEUE] item handler error', err);
    }
  }
}

function ensureWorker() {
  if (workerPromise) {
    return workerPromise;
  }
  workerPromise = (async () => {
    try {
      await runWorkerLoop();
    } finally {
      workerPromise = null;
      if (queue.length > 0) {
        void ensureWorker();
      }
    }
  })();
  return workerPromise;
}

function enqueue(input, source) {
  try {
    queue.push({
      input: input == null ? '' : String(input),
      source: source == null ? '' : String(source),
    });
    void ensureWorker();
  } catch (err) {
    console.error('[QUEUE] enqueue error', err);
  }
}

function process() {
  return ensureWorker();
}

module.exports = {
  enqueue,
  process,
  getStatus,
  onProcessed,
};
