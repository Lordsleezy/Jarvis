'use strict';

const DIMENSIONS = {
  communication: ['formality', 'verbosity', 'directness', 'humor'],
  work: [
    'focus_duration',
    'multitasking',
    'morning_productivity',
    'deadline_urgency',
  ],
  health: [
    'sleep_regularity',
    'exercise_frequency',
    'stress_level',
    'diet_consistency',
  ],
  financial: [
    'spending_impulsivity',
    'budget_consciousness',
    'risk_tolerance',
  ],
  social: [
    'introversion',
    'relationship_depth',
    'conflict_avoidance',
    'trust_speed',
  ],
  preferences: [
    'dark_mode',
    'minimalism',
    'tech_adoption',
    'routine_preference',
  ],
};

function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}

function createInitialPortrait() {
  const out = {};
  for (const [category, dims] of Object.entries(DIMENSIONS)) {
    out[category] = {};
    for (const d of dims) {
      out[category][d] = { value: 0.5, confidence: 0.0 };
    }
  }
  return out;
}

let portrait = createInitialPortrait();

function getPortrait() {
  return JSON.parse(JSON.stringify(portrait));
}

/**
 * Observation value for one update: move from current value in the direction of signal,
 * scaled by strength (both in [0,1] sense for magnitude).
 */
function computeNewSignal(oldWeight, signal, strength) {
  const magnitude = strength * 0.2;
  return clamp01(oldWeight + signal * magnitude);
}

function updateDimension(category, dimension, signal, strength) {
  if (!DIMENSIONS[category] || !DIMENSIONS[category].includes(dimension)) {
    throw new Error(`Unknown dimension: ${category}.${dimension}`);
  }
  if (signal !== 1 && signal !== -1) {
    throw new Error('signal must be 1 or -1');
  }
  if (typeof strength !== 'number' || strength < 0 || strength > 1) {
    throw new Error('strength must be a number from 0.0 to 1.0');
  }

  const cell = portrait[category][dimension];
  const oldWeight = cell.value;
  const oldConfidence = cell.confidence;

  const newSignal = computeNewSignal(oldWeight, signal, strength);
  const newWeight =
    oldWeight * oldConfidence + newSignal * (1 - oldConfidence);

  cell.value = clamp01(newWeight);
  cell.confidence = clamp01(Math.min(0.95, oldConfidence + 0.05));
}

function getContext() {
  const rows = [];
  for (const [category, dims] of Object.entries(DIMENSIONS)) {
    for (const d of dims) {
      const { value, confidence } = portrait[category][d];
      rows.push({ category, dimension: d, value, confidence });
    }
  }
  rows.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.value - a.value;
  });

  const notable = rows.filter((r) => r.confidence > 0);
  if (notable.length === 0) {
    return 'No confident signals yet; all dimensions are neutral (0.5) at 0.0 confidence.';
  }

  const lines = notable.map(
    (r) =>
      `${r.category}.${r.dimension}: ${r.value.toFixed(2)} (confidence ${r.confidence.toFixed(2)})`
  );
  return lines.join('\n');
}

function serialize() {
  return JSON.stringify(portrait);
}

function deserialize(json) {
  const parsed = JSON.parse(json);
  const next = createInitialPortrait();

  for (const [category, dims] of Object.entries(DIMENSIONS)) {
    const bucket = parsed[category];
    if (!bucket || typeof bucket !== 'object') continue;
    for (const d of dims) {
      const cell = bucket[d];
      if (!cell || typeof cell !== 'object') continue;
      if (typeof cell.value === 'number' && typeof cell.confidence === 'number') {
        next[category][d] = {
          value: clamp01(cell.value),
          confidence: clamp01(cell.confidence),
        };
      }
    }
  }

  portrait = next;
}

module.exports = {
  getPortrait,
  updateDimension,
  getContext,
  serialize,
  deserialize,
};
