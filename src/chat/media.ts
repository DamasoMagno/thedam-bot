const gifIds = [
  'JIX9t2j0ZTN9S',
  '13CoXDiaCcCoyk',
  'mlvseq9yvZhba',
  'VbnUQpnihPSIgIXuZv',
  '3oriO0OEd9QIDdllqo',
  'GeimqsH0TLDt4tScGw',
  '11s7Ke7jcNxCHS',
  'nR4L10XlJcSeQ',
  '6VoDJzfRjJNbG',
  'duzpaTbCUy9Vu',
  'ZqlvCTNHpqrio',
  '26BRv0ThflsHCqDrG',
  'l0HlUxcWRsqROFYuk',
  'Dh5q0sShxgp13DwrvG',
  'l3q2K5jinAlChoCLS',
  'Od0QRnzwRBYmDU3eEO',
  '3o7TKTDn976rzVgky4',
  'l41lVsYDBC0UVQJCE',
];
const categories = [
  { pattern: /\b(gato|gatinho|miau|felino)\b/u, indexes: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
  {
    pattern: /\b(codigo|bug|programar|trabalho|computador|deploy)\b/u,
    indexes: [0, 3, 13],
  },
  { pattern: /\b(dormir|sono|cansado|preguica|soneca)\b/u, indexes: [4, 6] },
  { pattern: /\b(amor|amo|fofo|carinho|coracao)\b/u, indexes: [4, 5, 7, 11] },
  { pattern: /\b(desculpa|perdao|errei)\b/u, indexes: [9] },
  { pattern: /\b(confuso|entendi|entendo|como|duvida)\b/u, indexes: [13, 14] },
  { pattern: /\b(rir|risada|kkkk+|haha+|engracado|zoeira)\b/u, indexes: [10, 15, 16] },
  { pattern: /\b(telefone|ligar|call|chamada)\b/u, indexes: [17] },
];
export function createReplyMediaPicker() {
  const recent: string[] = [];
  return ({
    chance = 0.25,
    random = Math.random,
    context = '',
  }: { chance?: number; random?: () => number; context?: string } = {}) => {
    if (random() >= chance) return undefined;
    const normalized = context
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLocaleLowerCase('pt-BR');
    const available = gifIds.filter((id) => !recent.includes(id));
    const matching = new Set(
      categories
        .filter((category) => category.pattern.test(normalized))
        .flatMap((category) => category.indexes.map((index) => gifIds[index])),
    );
    const related = available.filter((id) => matching.has(id));
    const candidates = related.length ? related : available;
    const id =
      candidates[
        Math.min(candidates.length - 1, Math.floor(random() * candidates.length))
      ]!;
    recent.push(id);
    if (recent.length > Math.min(8, gifIds.length - 1)) recent.shift();
    return [{ image: { url: `https://media.giphy.com/media/${id}/giphy.gif` } }];
  };
}
export const chooseReplyMedia = createReplyMediaPicker();
