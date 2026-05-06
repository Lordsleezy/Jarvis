'use strict';

const TIMEOUT = 6000;

function timedFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { 'User-Agent': 'Mozilla/5.0', ...(options.headers || {}) },
  });
}

// STOCK PRICES - Yahoo Finance (free, no key, real-time)
async function getStockPrice(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker.toUpperCase()}?interval=1d&range=1d`;
    const res = await timedFetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) return null;
    const price = meta.regularMarketPrice.toFixed(2);
    const change = (meta.regularMarketChangePercent || 0).toFixed(2);
    const name = meta.shortName || ticker.toUpperCase();
    return `${name} (${ticker.toUpperCase()}): $${price} ${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}% today`;
  } catch {
    return null;
  }
}

// WEATHER - wttr.in (free, no key, real-time)
async function getWeather(location) {
  try {
    const encoded = encodeURIComponent(location);
    const url = `https://wttr.in/${encoded}?format=3`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: {
        'User-Agent': 'curl/7.68.0',
        Accept: 'text/plain',
      },
    });
    if (!res.ok) {
      console.log('[SEARCH] wttr.in status:', res.status);
      return null;
    }
    const text = await res.text();
    console.log('[SEARCH] wttr.in raw response:', text);
    if (!text || text.includes('Unknown location')) return null;
    return `Current weather: ${text.trim()}`;
  } catch (err) {
    console.log('[SEARCH] Weather error:', err.message);
    return null;
  }
}

// CRYPTOCURRENCY - CoinGecko (free, no key, real-time)
async function getCryptoPrice(coin) {
  try {
    const coinMap = {
      bitcoin: 'bitcoin',
      btc: 'bitcoin',
      ethereum: 'ethereum',
      eth: 'ethereum',
      solana: 'solana',
      sol: 'solana',
      dogecoin: 'dogecoin',
      doge: 'dogecoin',
      cardano: 'cardano',
      ada: 'cardano',
      xrp: 'ripple',
      ripple: 'ripple',
    };
    const coinId = coinMap[coin.toLowerCase()] || coin.toLowerCase();
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`;
    const res = await timedFetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const coinData = data[coinId];
    if (!coinData) return null;
    const price = coinData.usd?.toLocaleString();
    const change = coinData.usd_24h_change?.toFixed(2);
    return `${coinId.charAt(0).toUpperCase() + coinId.slice(1)}: $${price} (${change >= 0 ? '+' : ''}${change}% 24h)`;
  } catch {
    return null;
  }
}

// CURRENCY EXCHANGE - ExchangeRate-API (free, no key)
async function getCurrencyRate(from, to) {
  try {
    const url = `https://open.er-api.com/v6/latest/${from.toUpperCase()}`;
    const res = await timedFetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const rate = data?.rates?.[to.toUpperCase()];
    if (!rate) return null;
    return `1 ${from.toUpperCase()} = ${rate.toFixed(4)} ${to.toUpperCase()} (live rate)`;
  } catch {
    return null;
  }
}

// SPORTS - ESPN API (free, no key)
async function getSportsScores(sport) {
  try {
    const sportMap = {
      nba: 'basketball/nba',
      nfl: 'football/nfl',
      mlb: 'baseball/mlb',
      nhl: 'hockey/nhl',
      soccer: 'soccer/usa.1',
    };
    const endpoint = sportMap[sport.toLowerCase()] || 'basketball/nba';
    const url = `https://site.api.espn.com/apis/site/v2/sports/${endpoint}/scoreboard`;
    const res = await timedFetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const events = data?.events?.slice(0, 3);
    if (!events?.length) return null;
    const scores = events.map((e) => {
      const comps = e.competitions?.[0]?.competitors;
      if (!comps) return e.name;
      const home = comps.find((c) => c.homeAway === 'home');
      const away = comps.find((c) => c.homeAway === 'away');
      const status = e.status?.type?.shortDetail || '';
      return `${away?.team?.abbreviation} ${away?.score} @ ${home?.team?.abbreviation} ${home?.score} (${status})`;
    });
    return `${sport.toUpperCase()} scores: ${scores.join(' | ')}`;
  } catch {
    return null;
  }
}

// WIKIPEDIA - facts and general knowledge (free, no key)
async function getWikipedia(query) {
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`;
    const res = await timedFetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.extract) return null;
    return data.extract.slice(0, 300);
  } catch {
    return null;
  }
}

// DUCKDUCKGO - general web search (free, no key, current)
async function searchDuckDuckGo(query) {
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://html.duckduckgo.com/html/?q=${encoded}`;
    const res = await timedFetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const results = [];
    const titleRegex = /class="result__a"[^>]*>([^<]+)<\/a>/g;
    const snippetRegex = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    const titles = [];
    const snippets = [];
    let m;
    while ((m = titleRegex.exec(html)) !== null && titles.length < 4) {
      const clean = m[1].replace(/<[^>]+>/g, '').trim();
      if (clean) titles.push(clean);
    }
    while ((m = snippetRegex.exec(html)) !== null && snippets.length < 4) {
      const clean = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (clean && clean.length > 20) snippets.push(clean);
    }
    for (let i = 0; i < Math.min(titles.length, snippets.length, 3); i++) {
      results.push(`${titles[i]}: ${snippets[i]}`);
    }
    return results.length > 0 ? results.join('\n') : null;
  } catch {
    return null;
  }
}

// SMART ROUTER - picks best API for query
async function searchWeb(query) {
  const q = query.toLowerCase();
  console.log('[SEARCH] Routing query:', query);

  // Stock price
  const companyNames = {
    tesla: 'TSLA',
    apple: 'AAPL',
    google: 'GOOGL',
    googl: 'GOOGL',
    alphabet: 'GOOGL',
    amazon: 'AMZN',
    microsoft: 'MSFT',
    nvidia: 'NVDA',
    meta: 'META',
    netflix: 'NFLX',
    disney: 'DIS',
    uber: 'UBER',
    airbnb: 'ABNB',
    spotify: 'SPOT',
  };

  const stockMatch =
    query.match(/\b([A-Z]{2,5})\b.*(stock|price|shares|trading|at today|stock price)/i) ||
    query.match(/(stock|price|shares).+\b([A-Z]{2,5})\b/i);

  const companyMatch = Object.keys(companyNames).find((name) => q.includes(name));

  if (stockMatch || companyMatch) {
    let ticker = companyMatch
      ? companyNames[companyMatch]
      : (stockMatch[1] || stockMatch[2]).toUpperCase();
    if (companyNames[ticker?.toLowerCase()]) ticker = companyNames[ticker.toLowerCase()];
    const result = await getStockPrice(ticker);
    if (result) {
      console.log('[SEARCH] Stock result:', result);
      return result;
    }
  }

  // Weather
  if (
    q.includes('weather') ||
    q.includes('temperature') ||
    q.includes('forecast') ||
    q.includes('raining') ||
    q.includes('snowing')
  ) {
    const locationMatch =
      query.match(/weather\s+(?:in|for|at)?\s+(.+?)(?:\s+today|\s+right now|\s+currently|\s+forecast|$)/i) ||
      query.match(/(?:temperature|forecast|raining|snowing)\s+(?:in|at)?\s+(.+?)(?:\s+today|$)/i);
    const location = locationMatch?.[1]?.trim() || 'current location';
    const result = await getWeather(location);
    if (result) {
      console.log('[SEARCH] Weather result:', result);
      return result;
    }
  }

  // Crypto
  if (
    q.includes('bitcoin') ||
    q.includes('btc') ||
    q.includes('ethereum') ||
    q.includes('eth') ||
    q.includes('crypto') ||
    q.includes('solana') ||
    q.includes('doge') ||
    q.includes('xrp')
  ) {
    const cryptoMatch = query.match(
      /\b(bitcoin|btc|ethereum|eth|solana|sol|dogecoin|doge|cardano|ada|xrp|ripple)\b/i
    );
    const coin = cryptoMatch?.[1] || 'bitcoin';
    const result = await getCryptoPrice(coin);
    if (result) {
      console.log('[SEARCH] Crypto result:', result);
      return result;
    }
  }

  // Currency exchange
  const currencyMatch =
    query.match(/(\w{3})\s+to\s+(\w{3})/i) || query.match(/exchange rate.+?(\w{3}).+?(\w{3})/i);
  if (
    currencyMatch &&
    (q.includes('convert') || q.includes('exchange') || q.includes('rate'))
  ) {
    const result = await getCurrencyRate(currencyMatch[1], currencyMatch[2]);
    if (result) {
      console.log('[SEARCH] Currency result:', result);
      return result;
    }
  }

  // Sports scores
  if (
    q.includes('nba') ||
    q.includes('nfl') ||
    q.includes('mlb') ||
    q.includes('nhl') ||
    q.includes('score') ||
    q.includes('game') ||
    q.includes('match')
  ) {
    const sport = q.includes('nfl')
      ? 'nfl'
      : q.includes('mlb')
        ? 'mlb'
        : q.includes('nhl')
          ? 'nhl'
          : 'nba';
    const result = await getSportsScores(sport);
    if (result) {
      console.log('[SEARCH] Sports result:', result);
      return result;
    }
  }

  // Wikipedia for biographical and factual queries
  if (
    q.includes('who is') ||
    q.includes('who was') ||
    q.includes('what is') ||
    q.includes('history of') ||
    q.includes('tell me about') ||
    q.includes('biography')
  ) {
    const wikiTopic = query
      .replace(/who is|who was|what is|tell me about|history of|biography of/gi, '')
      .trim();
    const wikiResult = await getWikipedia(wikiTopic || query);
    if (wikiResult) {
      console.log('[SEARCH] Wiki result:', wikiResult);
      return wikiResult;
    }
  }

  // Default: DuckDuckGo for everything else
  console.log('[SEARCH] Using DuckDuckGo');
  const ddgResult = await searchDuckDuckGo(query);
  if (ddgResult) {
    console.log('[SEARCH] DDG result found');
    return ddgResult;
  }

  return null;
}

function needsWebSearch(message, conversationHistory = []) {
  const q = message.toLowerCase();

  const hardTriggers = [
    'weather',
    'temperature',
    'forecast',
    'stock',
    'price',
    'crypto',
    'bitcoin',
    'ethereum',
    'news',
    'today',
    'tonight',
    'right now',
    'currently',
    'latest',
    'recent',
    'score',
    'result',
    'winner',
    'election',
    'war',
    'iran',
    'russia',
    'ukraine',
    'israel',
    'china',
    'trump',
    'biden',
    'president',
    'congress',
    'senate',
    'nba',
    'nfl',
    'mlb',
    'nhl',
    'game',
    'match',
    'tesla',
    'apple',
    'google',
    'amazon',
    '2025',
    '2026',
    'update',
    'updates',
    'breaking',
    'live',
  ];

  if (hardTriggers.some((t) => q.includes(t))) return true;

  const followUpTriggers = [
    'elaborate',
    'tell me more',
    'why',
    'how',
    'what about',
    'explain',
    'more details',
    'and',
    'also',
    'what else',
  ];

  if (followUpTriggers.some((t) => q.includes(t)) && conversationHistory.length > 0) {
    return true;
  }

  const questionTriggers = [
    'who is',
    'who are',
    'what is',
    'what are',
    'where is',
    'where are',
    'when is',
    'when did',
    'when will',
    'how much',
    'how many',
    'is there',
    'are there',
    'did they',
    'have they',
    'has he',
    'has she',
    'does it',
    'can it',
    'will it',
    'should i',
    'is it',
  ];

  if (questionTriggers.some((t) => q.includes(t))) return true;

  return false;
}

module.exports = {
  searchWeb,
  needsWebSearch,
  getStockPrice,
  getWeather,
  getCryptoPrice,
  getCurrencyRate,
  getSportsScores,
  getWikipedia,
};
