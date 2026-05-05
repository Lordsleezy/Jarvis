'use strict';

const OLLAMA_URL = 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = 'llama3.2:3b';

const SYSTEM_PROMPT = `You are a precise memory classifier for a personal AI assistant. 
Analyze the input and respond ONLY with a single valid JSON object. 
No explanation. No markdown. No extra text. Just the JSON.

RULES:
- type must be exactly one of: "fact", "signal", "both", "neither"
- fact = hard information worth storing (names, numbers, events, decisions, commitments)
- signal = behavioral/emotional pattern that reveals something about the person
- both = contains a hard fact AND reveals a behavioral pattern
- neither = greeting, filler, gibberish, or truly meaningless input

category must be exactly one of these depending on type:
- For facts: "person", "event", "decision", "number", "commitment", "preference"
- For signals: "communication", "work", "health", "financial", "social", "preferences"
- For both: use the SIGNAL category (portrait category takes priority)

dimension must be one of these exact strings (or null for pure facts):
communication: "formality", "verbosity", "directness", "humor"
work: "focus_duration", "multitasking", "morning_productivity", "deadline_urgency"
health: "sleep_regularity", "exercise_frequency", "stress_level", "diet_consistency"
financial: "spending_impulsivity", "budget_consciousness", "risk_tolerance"
social: "introversion", "relationship_depth", "conflict_avoidance", "trust_speed"
preferences: "dark_mode", "minimalism", "tech_adoption", "routine_preference"

signal_direction: 1 means increasing/positive, -1 means decreasing/negative. null for pure facts.
signal_strength: float 0.1 to 1.0 based on how strong the signal is. null for pure facts.
confidence: float 0.0 to 1.0 based on how certain you are.
entity: the main subject (person name, "self", or specific thing). Never "main subject" or "John Doe".
value: the core meaningful content extracted from input. Be specific and concise.

GARBAGE RULE: If input is gibberish, random characters, punctuation only, 
single casual words like "ok", "yoooo", "lol", greetings, or has no meaningful 
personal information — return type "neither" with empty strings and nulls.
Do NOT try to extract meaning from meaningless input.

EXAMPLES — study these carefully and follow this exact pattern:

Input: "I've been really tired lately"
Output: {"type":"fact","category":"health","entity":"self","value":"experiencing frequent tiredness","dimension":null,"signal_direction":null,"signal_strength":null,"confidence":0.8}

Input: "My energy levels are highest in the evening"
Output: {"type":"both","category":"work","entity":"self","value":"peak energy in evening not morning","dimension":"morning_productivity","signal_direction":-1,"signal_strength":0.8,"confidence":0.9}

Input: "I get overwhelmed when there are too many people around"
Output: {"type":"both","category":"social","entity":"self","value":"gets overwhelmed in crowds","dimension":"introversion","signal_direction":1,"signal_strength":0.8,"confidence":0.9}

Input: "Deep work sessions are where I do my best thinking"
Output: {"type":"both","category":"work","entity":"self","value":"best thinking during deep work","dimension":"focus_duration","signal_direction":1,"signal_strength":0.9,"confidence":0.95}

Input: "I tend to procrastinate on administrative tasks"
Output: {"type":"both","category":"work","entity":"self","value":"procrastinates on admin tasks","dimension":"multitasking","signal_direction":-1,"signal_strength":0.7,"confidence":0.85}

Input: "Met Sarah at the conference yesterday"
Output: {"type":"fact","category":"person","entity":"Sarah","value":"met at conference","dimension":null,"signal_direction":null,"signal_strength":null,"confidence":0.9}

Input: "Decided to cut the marketing budget by 30%"
Output: {"type":"fact","category":"decision","entity":"marketing budget","value":"cut by 30%","dimension":null,"signal_direction":null,"signal_strength":null,"confidence":0.95}

Input: "I love dark mode and hate bright interfaces"
Output: {"type":"both","category":"preferences","entity":"self","value":"strongly prefers dark mode","dimension":"dark_mode","signal_direction":1,"signal_strength":0.9,"confidence":0.95}

Input: "ok"
Output: {"type":"neither","category":"","entity":"","value":"","dimension":null,"signal_direction":null,"signal_strength":null,"confidence":0}

Input: "yoooo"
Output: {"type":"neither","category":"","entity":"","value":"","dimension":null,"signal_direction":null,"signal_strength":null,"confidence":0}

Input: "!!! urgent !!!"
Output: {"type":"neither","category":"","entity":"","value":"","dimension":null,"signal_direction":null,"signal_strength":null,"confidence":0}

Input: "Things have been weird this week"
Output: {"type":"signal","category":"health","entity":"self","value":"experiencing unusual stress or discomfort","dimension":"stress_level","signal_direction":-1,"signal_strength":0.5,"confidence":0.7}

Input: "The contract is worth $75,000"
Output: {"type":"fact","category":"number","entity":"contract","value":"worth $75,000","dimension":null,"signal_direction":null,"signal_strength":null,"confidence":0.95}

Input: "I promised John I would deliver by Monday"
Output: {"type":"fact","category":"commitment","entity":"John","value":"deliver by Monday","dimension":null,"signal_direction":null,"signal_strength":null,"confidence":0.95}

Now classify the following input using these exact rules and examples:
`;

const PREFERENCE_DIMENSION_MAP = {
  night: { category: 'work', dimension: 'morning_productivity', signal: -1 },
  late: { category: 'work', dimension: 'morning_productivity', signal: -1 },
  morning: { category: 'work', dimension: 'morning_productivity', signal: 1 },
  meeting: { category: 'work', dimension: 'focus_duration', signal: 1 },
  meetings: { category: 'work', dimension: 'focus_duration', signal: 1 },
  'dark mode': { category: 'preferences', dimension: 'dark_mode', signal: 1 },
  dark: { category: 'preferences', dimension: 'dark_mode', signal: 1 },
  alone: { category: 'social', dimension: 'introversion', signal: 1 },
  social: { category: 'social', dimension: 'introversion', signal: -1 },
  focus: { category: 'work', dimension: 'focus_duration', signal: 1 },
  exercise: { category: 'health', dimension: 'exercise_frequency', signal: 1 },
  coffee: { category: 'health', dimension: 'diet_consistency', signal: 1 },
};

const PREFERENCE_MAP_KEY_ORDER = Object.keys(PREFERENCE_DIMENSION_MAP).sort(
  (a, b) => b.length - a.length
);

const ENTITY_TRAILING_STOP_WORDS = new Set([
  'at',
  'about',
  'from',
  'to',
  'with',
  'and',
  'the',
  'a',
  'of',
]);

const STAGE1_TYPES = new Set(['fact', 'signal', 'both', 'neither']);
const STAGE2_CATEGORIES = new Set([
  'person',
  'event',
  'decision',
  'number',
  'commitment',
  'preference',
  'communication',
  'work',
  'health',
  'financial',
  'social',
  'preferences',
]);

const FETCH_TIMEOUT_MS = 60_000;

function neitherResult() {
  return {
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

function factFromRules(category, entity, value) {
  return {
    type: 'fact',
    category,
    entity: entity || '',
    value: value || '',
    dimension: null,
    signal_direction: null,
    signal_strength: null,
    confidence: 0.7,
  };
}

function firstCapitalizedWord(text) {
  const m = text.match(/\b[A-Z][a-z]+\b/);
  return m ? m[0] : '';
}

function stripTrailingStopWordsFromEntity(entity) {
  if (!entity || typeof entity !== 'string') {
    return '';
  }
  const parts = entity.trim().split(/\s+/);
  while (parts.length > 0) {
    const last = parts[parts.length - 1].toLowerCase();
    if (ENTITY_TRAILING_STOP_WORDS.has(last)) {
      parts.pop();
    } else {
      break;
    }
  }
  return parts.join(' ');
}

function tryPerson(text) {
  const patterns = [
    /\b(?:met|called|talked\s+to|talked\s+with)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i,
    /\bwith\s+([A-Z][a-z]+)\b/i,
    /\b([A-Z][a-z]+)\s+(?:met|called)\b/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) {
      const entity = stripTrailingStopWordsFromEntity(m[1].trim());
      return factFromRules('person', entity, text.trim());
    }
  }
  return null;
}

function tryNumber(text) {
  const re =
    /\$[\d,]+\.?\d*|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+\.\d+\b|\b\d+\s*%|\b%\s*\d+|\d+%|\bdollars?\b|\b(?:USD|EUR|GBP)\b|\b\d{1,4}\s*(?:kg|lb|lbs|miles?|km|mph|kph|hours?|hr|hrs|minutes?|mins?|seconds?|feet|ft|inches?|in|cm|mm|oz|g|grams?)\b/i;
  if (!re.test(text)) return null;
  const hit = text.match(re);
  const entity = hit ? hit[0].trim() : '';
  return factFromRules('number', entity || 'numeric', text.trim());
}

function tryDecision(text) {
  const re =
    /\b(?:decided|agreed|chose|choosing|going\s+to|will|won't|wont|will\s+not|never)\b/i;
  if (!re.test(text)) return null;
  const entity = firstCapitalizedWord(text) || 'self';
  return factFromRules('decision', entity, text.trim());
}

function tryCommitment(text) {
  const re =
    /\b(?:promised|committed|deadline)\b|\bdue\b(?:\s+(?:on|by|the|\d))?|\bby\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
  if (!re.test(text)) return null;
  const entity = firstCapitalizedWord(text) || 'self';
  return factFromRules('commitment', entity, text.trim());
}

function tryEvent(text) {
  const re =
    /\b(?:yesterday|today|tomorrow|last\s+week|next\s+week|last\s+month|next\s+month)\b|\b(?:meeting|appointment)\b/i;
  if (!re.test(text)) return null;
  const entity = firstCapitalizedWord(text) || 'schedule';
  return factFromRules('event', entity, text.trim());
}

function detectSentiment(input) {
  const t = input
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .replace(/\u2018/g, "'");

  const negativePatterns = [
    /\bcan't\s+stand\b/,
    /\bcannot\s+stand\b/,
    /\bdon't\s+like\b/,
    /\bdont\s+like\b/,
    /\btired\s+of\b/,
    /\bsick\s+of\b/,
    /\bbad\s+at\b/,
    /\bhates?\b/,
    /\bhated\b/,
    /\bdislikes?\b/,
    /\bdisliked\b/,
    /\bavoids?\b/,
    /\bavoid\b/,
    /\bawful\b/,
    /\bterrible\b/,
    /\bworst\b/,
    /\bnever\b/,
    /\bannoyed\b/,
    /\bfrustrating\b/,
    /\bfrustrates\b/,
    /\bstruggles?\b/,
    /\bstruggling\b/,
  ];

  for (const re of negativePatterns) {
    if (re.test(t)) {
      return -1;
    }
  }

  const positivePatterns = [
    /\bgood\s+at\b/,
    /\bthrives?\b/,
    /\bthrive\b/,
    /\bloves?\b/,
    /\bloved\b/,
    /\blikes?\b/,
    /\bliked\b/,
    /\benjoys?\b/,
    /\benjoyed\b/,
    /\bprefer(?:s|red)?\b/,
    /\bgreat\b/,
    /\bbest\b/,
    /\bfavorites?\b/,
    /\bfavourites?\b/,
    /\bamazing\b/,
    /\bexcellent\b/,
    /\balways\b/,
  ];

  for (const re of positivePatterns) {
    if (re.test(t)) {
      return 1;
    }
  }

  return 0;
}

function tryPreference(text) {
  const re =
    /\b(?:hate|loves?|prefer|preferred|always|never|favorite|favourite|can't\s+stand|cant\s+stand)\b/i;
  if (!re.test(text)) return null;
  const entity = firstCapitalizedWord(text) || 'self';
  const value = text.trim();
  const lower = value.toLowerCase();
  for (const key of PREFERENCE_MAP_KEY_ORDER) {
    if (lower.includes(key.toLowerCase())) {
      const hit = PREFERENCE_DIMENSION_MAP[key];
      const sentiment = detectSentiment(text);
      let signal_direction = hit.signal;
      if (sentiment === 1 || sentiment === -1) {
        if (sentiment !== hit.signal) {
          console.log(
            `[CLASSIFIER] Sentiment override: direction changed from ${hit.signal} to ${sentiment}`
          );
        }
        signal_direction = sentiment;
      }
      return {
        type: 'both',
        category: hit.category,
        entity,
        value,
        dimension: hit.dimension,
        signal_direction,
        signal_strength: 0.7,
        confidence: 0.7,
      };
    }
  }
  return factFromRules('preference', entity, value);
}

const STAGE1_CHAIN = [tryPerson, tryNumber, tryDecision, tryCommitment, tryEvent, tryPreference];

function runStage1(text) {
  for (const fn of STAGE1_CHAIN) {
    const hit = fn(text);
    if (hit) return hit;
  }
  return null;
}

function extractJsonObject(text) {
  if (!text || typeof text !== 'string') return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = text.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

function clamp01(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function normalizeDirection(v) {
  if (v === 1 || v === '1') return 1;
  if (v === -1 || v === '-1') return -1;
  return null;
}

function normalizeStrength(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return null;
  return Math.min(1, Math.max(0.1, v));
}

function normalizeOllamaPayload(raw, fallbackInput) {
  if (!raw || typeof raw !== 'object') return null;

  const type = typeof raw.type === 'string' ? raw.type.toLowerCase() : '';
  if (!STAGE1_TYPES.has(type)) return null;

  const category =
    typeof raw.category === 'string' ? raw.category.toLowerCase() : '';
  if (category && !STAGE2_CATEGORIES.has(category)) return null;

  const entity =
    typeof raw.entity === 'string' ? raw.entity : String(raw.entity ?? '');
  const value =
    typeof raw.value === 'string' ? raw.value : String(raw.value ?? '');
  const dimension =
    raw.dimension === null || raw.dimension === undefined
      ? null
      : String(raw.dimension);

  const signal_direction = normalizeDirection(raw.signal_direction);
  let signal_strength = normalizeStrength(raw.signal_strength);

  if (
    (type === 'signal' || type === 'both') &&
    signal_strength === null &&
    typeof raw.signal_strength === 'number'
  ) {
    signal_strength = 0.5;
  }

  const confidence = clamp01(
    typeof raw.confidence === 'number' ? raw.confidence : Number(raw.confidence)
  );

  const needsSignalFields = type === 'signal' || type === 'both';
  if (needsSignalFields) {
    if (signal_direction === null) return null;
    if (signal_strength === null) return null;
  }

  return {
    type,
    category: category || '',
    entity: entity.trim() || (fallbackInput ? fallbackInput.trim() : ''),
    value: value.trim() || (fallbackInput ? fallbackInput.trim() : ''),
    dimension: needsSignalFields ? dimension : null,
    signal_direction: needsSignalFields ? signal_direction : null,
    signal_strength: needsSignalFields ? signal_strength : null,
    confidence: Number.isFinite(confidence) ? confidence : 0,
  };
}

async function classifyOllama(text) {
  try {
    const res = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: text,
        system: SYSTEM_PROMPT,
        stream: false,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const responseText =
      typeof data.response === 'string' ? data.response : '';
    const parsed = extractJsonObject(responseText);
    return normalizeOllamaPayload(parsed, text);
  } catch {
    return null;
  }
}

async function classify(input) {
  try {
    const text =
      typeof input === 'string' ? input : input == null ? '' : String(input);
    const trimmed = text.trim();
    if (!trimmed) {
      return { ...neitherResult(), stage: 1 };
    }

    const stage1 = runStage1(trimmed);
    if (stage1) {
      return { ...stage1, stage: 1 };
    }

    const stage2 = await classifyOllama(trimmed);
    if (stage2) {
      if (stage2.confidence < 0.5) {
        console.log(
          `[CLASSIFIER] Ollama result discarded - confidence too low (${Number(
            stage2.confidence
          ).toFixed(1)})`
        );
        return { ...neitherResult(), stage: 2 };
      }
      return { ...stage2, stage: 2 };
    }

    return { ...neitherResult(), stage: 2 };
  } catch {
    return { ...neitherResult(), stage: 2 };
  }
}

async function classifyBatch(inputs) {
  if (!Array.isArray(inputs)) {
    return [];
  }
  return Promise.all(inputs.map((x) => classify(x)));
}

module.exports = {
  classify,
  classifyBatch,
};
