export function normalizeText(value: unknown) {
  if (typeof value !== 'string') return null;
  const text = value
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/<@!?\d+>|<@&\d+>|@everyone\b|@here\b/giu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}
const tokenKey = (word: string) =>
  word.toLocaleLowerCase('pt-BR').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '') ||
  word.toLocaleLowerCase('pt-BR');
const contextKey = (words: string[]) => words.map(tokenKey).join('\u0000');
export function generateText(
  messages: string[],
  {
    seed = '',
    chaos = true,
    random = Math.random,
    excluded = [] as string[],
    maxLength = 160,
  } = {},
) {
  const rows = messages
    .map(normalizeText)
    .filter((text): text is string => Boolean(text));
  const blocked = new Set(excluded.map((text) => text.toLocaleLowerCase('pt-BR')));
  if (!rows.length) return null;
  const order = chaos ? 1 : 2,
    chain = new Map<string, (string | null)[]>(),
    reverse = new Map<string, (string | null)[]>(),
    starts: string[][] = [];
  const contexts = new Map<string, string[]>();
  for (const row of rows) {
    const words = row.split(' ');
    if (words.length < order + 1) continue;
    starts.push(words.slice(0, order));
    for (let i = 0; i <= words.length - order; i++) {
      const key = contextKey(words.slice(i, i + order));
      contexts.set(key, words.slice(i, i + order));
      const next = words[i + order] ?? null;
      const options = chain.get(key) || [];
      options.push(next);
      chain.set(key, options);
      const prefixes = reverse.get(key) || [];
      prefixes.push(words[i - 1] ?? null);
      reverse.set(key, prefixes);
    }
  }
  if (!starts.length) return null;
  const pick = <T>(items: T[]): T =>
    items[Math.min(items.length - 1, Math.floor(random() * items.length))];
  const seedWord = seed.toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]/gu, '');
  const matching = [...chain.keys()]
    .filter(
      (key) =>
        seedWord &&
        key
          .split('\u0000')
          .some(
            (w) =>
              w.toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]/gu, '') === seedWord,
          ),
    )
    .map((key) => contexts.get(key)!);
  for (let attempt = 0; attempt < 40; attempt++) {
    const beginnings = matching.length
      ? matching
      : chaos
        ? [...chain.keys()].map((key) => contexts.get(key)!)
        : starts;
    const words = [...pick(beginnings)];
    if (matching.length || chaos)
      for (let i = 0; i < 12; i++) {
        const prefixes = reverse.get(contextKey(words.slice(0, order)));
        if (!prefixes) break;
        const prefix = pick(prefixes);
        if (prefix === null) break;
        words.unshift(prefix);
      }
    for (let i = 0; i < 32 && words.length < 24; i++) {
      const options = chain.get(contextKey(words.slice(-order)));
      if (!options) break;
      const next = pick(options);
      if (next === null) break;
      words.push(next);
    }
    const result = words.join(' ');
    if (
      words.length >= 1 &&
      result.length <= maxLength &&
      normalizeText(result) &&
      !blocked.has(result.toLocaleLowerCase('pt-BR'))
    )
      return result;
  }
  return null;
}
