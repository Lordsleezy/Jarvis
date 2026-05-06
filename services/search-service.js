'use strict';

const SEARCH_TIMEOUT_MS = 8000;

async function searchWeb(query) {
  try {
    console.log('[SEARCH] Searching for:', query);
    const encoded = encodeURIComponent(query);
    const url = `https://html.duckduckgo.com/html/?q=${encoded}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html',
      },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const html = await res.text();
    console.log('[SEARCH] HTML length:', html.length);
    console.log('[SEARCH] HTML sample:', html.slice(0, 500));

    // Extract result snippets using regex (no DOM parser in Node)
    const results = [];

    // Extract titles and snippets
    const snippetRegex =
      /class="result__snippet"[^>]*>([^<]+(?:<[^>]+>[^<]*<\/[^>]+>)*[^<]*)<\/a>/g;
    const titleRegex = /class="result__a"[^>]*>([^<]+)<\/a>/g;

    const titles = [];
    const snippets = [];

    let titleMatch;
    let snippetMatch;

    while ((titleMatch = titleRegex.exec(html)) !== null && titles.length < 5) {
      const clean = titleMatch[1].replace(/<[^>]+>/g, '').trim();
      if (clean) titles.push(clean);
    }

    while ((snippetMatch = snippetRegex.exec(html)) !== null && snippets.length < 5) {
      const clean = snippetMatch[1].replace(/<[^>]+>/g, '').trim();
      if (clean && clean.length > 20) snippets.push(clean);
    }

    // Combine titles and snippets
    for (let i = 0; i < Math.min(titles.length, snippets.length, 3); i++) {
      results.push(`${titles[i]}: ${snippets[i]}`);
    }

    // Fallback - extract any text between result classes
    if (results.length === 0) {
      const fallbackRegex = /class="result__body"[^>]*>([\s\S]*?)<\/div>/g;
      let fallbackMatch;
      while ((fallbackMatch = fallbackRegex.exec(html)) !== null && results.length < 3) {
        const clean = fallbackMatch[1]
          .replace(/<[^>]+>/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (clean && clean.length > 30) results.push(clean.slice(0, 200));
      }
    }

    console.log('[SEARCH] Results found:', results.length, results);
    return results.length > 0
      ? `Web search results for "${query}":\n${results.join('\n')}`
      : null;
  } catch (err) {
    return null;
  }
}

function needsWebSearch(message) {
  const msg = message.toLowerCase();

  // Always search for these
  const alwaysSearch = [
    'news',
    'weather',
    'price',
    'stock',
    'crypto',
    'score',
    'result',
    'update',
    'search',
    'look up',
    'find out',
    'what happened',
    'latest',
    'recent',
    'today',
    'tonight',
    'right now',
    'currently',
    'live',
    'breaking',
    'war',
    'conflict',
    'invasion',
    'attack',
    'missile',
    'sanction',
    'election',
    'president',
    'congress',
    'protest',
    'summit',
    'treaty',
    'ceasefire',
  ];

  if (alwaysSearch.some((t) => msg.includes(t))) return true;

  // Search for questions about current state of things
  const questionTriggers = [
    'who is',
    'who are',
    'what is',
    'what are',
    'where is',
    'where are',
    'when is',
    'when are',
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
  ];

  if (questionTriggers.some((t) => msg.includes(t))) return true;

  return false;
}

module.exports = { searchWeb, needsWebSearch };
