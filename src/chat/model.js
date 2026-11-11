export function safeText(value) {
  if (typeof value !== 'string' || value.length > 400) return null;
  const text = value
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (
    !text ||
    /https?:|www\.|@|<[@#]|(?:senha|password|secret|token|cpf|telefone|chave\s+pix)\b|(?:\d[ .()+-]*){8,}|[A-Za-z0-9_-]{32,}/iu.test(
      text,
    ) ||
    /^[!/.$]/.test(text)
  )
    return null;
  return text;
}
export function generateText(
  messages,
  { seed = '', chaos = false, random = Math.random, excluded = [] } = {},
) {
  const rows = [...new Set(messages.map(safeText).filter(Boolean))];
  const blocked = new Set(
    [...rows, ...excluded].map((text) => text.toLocaleLowerCase('pt-BR')),
  );
  if (!rows.length) return null;
  const order = chaos ? 1 : 2,
    chain = new Map(),
    reverse = new Map(),
    starts = [];
  for (const row of rows) {
    const words = row.split(' ');
    if (words.length < order + 1) continue;
    starts.push(words.slice(0, order));
    for (let i = 0; i <= words.length - order; i++) {
      const key = words.slice(i, i + order).join('\u0000');
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
  const pick = (items) =>
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
    .map((key) => key.split('\u0000'));
  for (let attempt = 0; attempt < 40; attempt++) {
    const words = [...pick(matching.length ? matching : starts)];
    if (matching.length)
      for (let i = 0; i < 12; i++) {
        const prefixes = reverse.get(words.slice(0, order).join('\u0000'));
        if (!prefixes) break;
        const prefix = pick(prefixes);
        if (prefix === null) break;
        words.unshift(prefix);
      }
    for (let i = 0; i < 32 && words.length < 35; i++) {
      const options = chain.get(words.slice(-order).join('\u0000'));
      if (!options) break;
      const next = pick(options);
      if (next === null) break;
      words.push(next);
    }
    const result = words.join(' ');
    if (
      words.length >= 1 &&
      result.length <= 240 &&
      safeText(result) &&
      !blocked.has(result.toLocaleLowerCase('pt-BR'))
    )
      return result;
  }
  return null;
}
