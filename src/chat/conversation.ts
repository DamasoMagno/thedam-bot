import { normalizeText, generateText } from './model.ts';

const commonWords = new Set(
  'para como isso essa esse esta estou voce voces gente mesmo muito mais menos hoje agora porque quando onde quem qual uma umas uns nao sim aqui comigo sobre ainda tambem tem foi vai que dos das por pra com'.split(
    ' ',
  ),
);
const words = (text: string) =>
  normalizeText(text)
    ?.toLocaleLowerCase('pt-BR')
    .match(/[\p{L}\p{N}]+/gu) || [];
const pick = <T>(items: T[], random: () => number) =>
  items[Math.min(items.length - 1, Math.floor(random() * items.length))];

export function generateConversationReply(
  messages: string[],
  context: string,
  {
    olderMessages = [] as string[],
    random = Math.random,
    generate = generateText,
    ...options
  }: Parameters<typeof generateText>[1] & {
    olderMessages?: string[];
    generate?: typeof generateText;
  } = {},
) {
  const topics = [
    ...new Set(
      words(context).filter((word) => word.length >= 3 && !commonWords.has(word)),
    ),
  ];
  const historicalWords = new Set(olderMessages.flatMap(words));
  const sharedTopics = topics.filter((word) => historicalWords.has(word));
  const seed = pick(sharedTopics.length ? sharedTopics : topics, random) || '';
  const text = generate(messages, { ...options, seed, random });
  if (!text) return text;
  // A brincadeira ocupa a resposta normal; nunca agenda uma mensagem extra.
  if (
    !/^[/!]|^m!/i.test(text) &&
    text.length <= 150 &&
    text.split(/\s+/u).length <= 22 &&
    random() < 0.1
  ) {
    const question = `E se ${text.replace(/[.!?]+$/u, '')}?`;
    if (!options.excluded?.includes(question)) return question;
  }
  return text;
}

export function recallMemory(
  messages: string[],
  excluded: string[] = [],
  random = Math.random,
) {
  const blocked = new Set(excluded.map((text) => text.toLocaleLowerCase('pt-BR')));
  const available = messages
    .map(normalizeText)
    .filter((text): text is string =>
      Boolean(
        text && text.length <= 160 && !blocked.has(text.toLocaleLowerCase('pt-BR')),
      ),
    );
  return pick(available, random) || null;
}
