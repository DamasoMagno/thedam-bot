import { gifCatalog, gifCategoryPatterns, type GifCategory } from './gif-catalog.ts';

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
    const available = gifCatalog.filter((gif) => !recent.includes(gif.id));
    const matching = new Set<GifCategory>(
      (Object.entries(gifCategoryPatterns) as [GifCategory, RegExp][])
        .filter(([, pattern]) => pattern.test(normalized))
        .map(([category]) => category),
    );
    const related = available.filter((gif) =>
      gif.categories.some((category) => matching.has(category)),
    );
    const candidates = related.length ? related : available;
    const gif =
      candidates[
        Math.min(candidates.length - 1, Math.floor(random() * candidates.length))
      ]!;
    recent.push(gif.id);
    if (recent.length > Math.min(8, gifCatalog.length - 1)) recent.shift();
    return [{ image: { url: `https://media.giphy.com/media/${gif.id}/giphy.gif` } }];
  };
}
export const chooseReplyMedia = createReplyMediaPicker();
