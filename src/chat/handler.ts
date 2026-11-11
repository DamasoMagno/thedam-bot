import { chooseReplyMedia } from './media.ts';
import type { AiReplyService } from '../ai/reply-service.ts';
import { createMentionQueue } from './mention-queue.ts';
import type { Client } from 'discord.js';
import type { ChatMessage, ChatReaction, ChatUser } from './types.ts';
import type { ChatStore } from './store.ts';
import type { ActivityOptions } from './activity-timer.ts';
import { PermissionsBitField } from 'discord.js';
import { normalizeText, generateText } from './model.ts';
import { createActivityTimer } from './activity-timer.ts';
export function createChatHandler({
  client,
  store,
  channelId,
  guildId,
  random = Math.random,
  now = Date.now,
  generate = generateText,
  activityOptions = {},
  onGenerated,
  ai,
  mediaChance = 0.25,
}: {
  client: Client;
  store: ChatStore;
  channelId: string;
  guildId: string;
  random?: () => number;
  now?: () => number;
  generate?: typeof generateText;
  activityOptions?: Partial<ActivityOptions>;
  mediaChance?: number;
  ai?: AiReplyService;
  onGenerated?: (text: string, message: ChatMessage) => Promise<unknown>;
}) {
  let lastReply = 0;
  let lastSpeaker: ChatMessage | undefined;
  const recent = new Map<string, { text: string; at: number }>(),
    rejected = new Set(store.rejected()),
    voters = new Map<string, string>();
  const matches = (message: Pick<ChatMessage, 'guildId' | 'channelId'>) =>
    message.guildId === guildId && message.channelId === channelId;
  const send = async (message: Pick<ChatMessage, 'channel'>, text: string) => {
    activityTimer.noteReply();
    const payload = {
      embeds: chooseReplyMedia({ chance: mediaChance, random }),
      content: text,
      allowedMentions: { parse: [] as never[], repliedUser: false },
      ...('id' in message && typeof message.id === 'string' && message.id
        ? { reply: { messageReference: message.id, failIfNotExists: false } }
        : {}),
    };
    let reply;
    try {
      reply = await message.channel.send(payload);
    } catch (error) {
      if (
        payload.embeds &&
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 50013
      )
        reply = await message.channel.send({ ...payload, embeds: undefined });
      else throw error;
    }

    return reply;
  };
  const dispatchGeneratedMusic = (text: string, message: ChatMessage) => {
    void onGenerated?.(text, message).catch(() =>
      console.warn('Não foi possível concluir a ação musical gerada.'),
    );
  };
  const rememberReply = (result: { id: string }, text: string) => {
    store.generated(result.id, text);
    recent.set(result.id, { text, at: now() });
    for (const [id, item] of recent)
      if (now() - item.at > 86400000 || recent.size > 100) recent.delete(id);
  };
  const activityTimer = createActivityTimer({
    now,
    random,
    minDelayMs: 120000,
    maxDelayMs: 300000,
    profile: () => store.setting('conversationMode') || 'discreet',
    ...activityOptions,
    enabled: () => ['timer', 'true', 'always'].includes(store.setting('auto') || ''),
    speak: async (channel) => {
      const text =
        (await ai?.maybeReply(lastSpeaker?.content || '')) ||
        generate(store.texts(), {
          chaos: store.setting('chaos') !== 'false',
          random,
          maxLength: 160,
          excluded: [...rejected, ...[...recent.values()].map((item) => item.text)],
        });
      if (!text || text.length > 160 || !normalizeText(text) || rejected.has(text))
        return;
      const result = await send({ channel }, text);
      rememberReply(result, text);
      if (lastSpeaker) dispatchGeneratedMusic(text, lastSpeaker);
    },
  });
  const guarded =
    <Args extends unknown[]>(fn: (...args: Args) => unknown) =>
    (...args: Args) =>
      Promise.resolve(fn(...args)).catch(() =>
        console.warn('Não foi possível concluir a ação do Markov.'),
      );
  const handle = guarded(async (message: ChatMessage) => {
    if (!matches(message) || message.author?.bot || message.webhookId) return;
    const mentioned = message.mentions?.users?.has(client.user!.id);
    const learned = normalizeText(message.content);
    if (learned) store.learn(message, learned);
    if (!mentioned) {
      if (learned) {
        lastSpeaker = message;
        activityTimer.noteActivity(message.channel, message.author.id);
      }
      return;
    }
    mentions.enqueue(message);
  });
  const respondMention = async (message: ChatMessage) => {
    const mentioned = true;
    const always = false;
    if (message.requestedQuote) {
      const result = await send(message, message.requestedQuote);
      rememberReply(result, message.requestedQuote);
      return;
    }
    const command = mentioned
      ? (message.content || '').replace(/<@!?\d+>/g, '').trim()
      : '';
    const admin = message.member?.permissions?.has(
      PermissionsBitField.Flags.ManageGuild,
    );
    lastReply = now();
    if (/^(esquecer|apagar aprendizado)$/i.test(command)) {
      if (!admin) return;
      activityTimer.reset();
      store.clear();
      recent.clear();
      rejected.clear();
      return send(message, 'Aprendizado e favoritos apagados.');
    }
    if (
      /^(?:caos\s+(?:on|off)|(?:automatico|automático)\s+(?:on|off|sempre|temporizador))$/i.test(
        command,
      )
    ) {
      if (!admin) return;
      const [name, state] = command.toLowerCase().split(/\s+/);
      store.setting(
        name === 'caos' ? 'chaos' : 'auto',
        name === 'caos' ? state === 'on' : state === 'off' ? 'false' : 'timer',
      );
      if (state === 'temporizador')
        return send(
          message,
          'Vou participar ocasionalmente quando a conversa estiver movimentada.',
        );
      if (state === 'sempre')
        return send(
          message,
          'Vou participar ocasionalmente, sem responder a cada mensagem.',
        );
      return send(
        message,
        `${name === 'caos' ? 'Modo caos' : 'Respostas espontâneas'} ${state === 'on' ? 'ativado' : 'desativado'}.`,
      );
    }
    if (/^ajuda$/i.test(command))
      return send(
        message,
        'Me mencione com uma palavra para gerar uma frase. “pérolas” recupera uma favorita; “frequentes” mostra os participantes recorrentes sem notificá-los. Administradores: “caos on/off”, “automatico temporizador/off” e “esquecer”. 👍 guarda uma frase; 👎 tira dos favoritos e evita repetir essa frase.',
      );
    if (/^frequentes$/i.test(command)) {
      const ids = store.frequent();
      return send(
        message,
        ids.length
          ? 'Participantes recorrentes: ' +
              ids
                .map((id) => {
                  const name = message.guild?.members?.cache.get(id)?.displayName;
                  return name ? name.replace(/@/g, '') : 'participante ' + id.slice(-4);
                })
                .join(', ')
          : 'Ainda tenho poucas mensagens para identificar os frequentadores.',
      );
    }
    const favorites = store
      .favorites()
      .filter(
        (text) => text.length <= 160 && normalizeText(text) && !rejected.has(text),
      );
    const text = /^(pérolas|perolas)$/i.test(command)
      ? favorites[Math.floor(random() * favorites.length)]
      : (await ai?.maybeReply(message.content)) ||
        generate(store.texts(), {
          seed: command.split(/\s+/)[0],
          chaos: store.setting('chaos') !== 'false',
          random,
          excluded: [...rejected, ...[...recent.values()].map((item) => item.text)],
        });
    if (!text || rejected.has(text))
      return mentioned || always
        ? send(message, 'Ainda estou aprendendo com vocês 👀.')
        : undefined;
    if (
      !always &&
      !/^(pérolas|perolas)$/i.test(command) &&
      [...recent.values()].some((item) => item.text === text)
    )
      return;
    const result = await send(message, text);
    rememberReply(result, text);
    dispatchGeneratedMusic(text, message);
  };
  const mentions = createMentionQueue({ respond: respondMention, now });
  const remove = (message: Pick<ChatMessage, 'id' | 'guildId' | 'channelId'>) => {
    if (matches(message)) store.remove(message.id);
  };
  const edit = guarded(async (_before: unknown, message: ChatMessage) => {
    if (!matches(message)) return;
    store.remove(message.id);
    if (!message.author?.bot && !message.webhookId) {
      const text = normalizeText(message.content);
      if (text) store.learn(message, text);
    }
  });
  const react = guarded(async (reaction: ChatReaction, user: ChatUser) => {
    if (
      user.bot ||
      !matches(reaction.message) ||
      !['👍', '👎'].includes(reaction.emoji.name || '')
    )
      return;
    const item =
      recent.get(reaction.message.id) || store.generatedMessage(reaction.message.id);
    if (!item) return;
    const key = reaction.message.id + ':' + user.id;
    if (voters.get(key) === reaction.emoji.name) return;
    voters.set(key, reaction.emoji.name!);
    store.vote(reaction.message.id, user.id, reaction.emoji.name!);
    if (voters.size > 2000) voters.delete(voters.keys().next().value!);
    if (reaction.emoji.name === '👍') {
      store.unReject(item.text);
      rejected.delete(item.text);
      store.remember(reaction.message.id, item.text);
    } else {
      store.reject(reaction.message.id, item.text);
      rejected.add(item.text);
      if (rejected.size > 100) rejected.delete(rejected.values().next().value!);
    }
  });
  const unreact = guarded(async (reaction: ChatReaction, user: ChatUser) => {
    if (!matches(reaction.message) || user.bot) return;
    const key = reaction.message.id + ':' + user.id;
    if (voters.get(key) !== reaction.emoji.name) return;
    voters.delete(key);
    store.removeVote(reaction.message.id, user.id, reaction.emoji.name!);
  });
  const bulkRemove = (
    messages: ReadonlyMap<string, Pick<ChatMessage, 'id' | 'guildId' | 'channelId'>>,
  ) => {
    for (const message of messages.values()) remove(message);
  };
  client.on('messageDeleteBulk', bulkRemove);
  client.on('messageReactionRemove', unreact);
  client.on('messageCreate', handle);
  client.on('messageDelete', remove);
  client.on('messageUpdate', edit);
  client.on('messageReactionAdd', react);
  return {
    async requestQuote(message: ChatMessage, text: string) {
      if (text.length > 160) return;
      mentions.enqueue({ ...message, requestedQuote: text });
    },
    async requestPhrase(message: ChatMessage, seed = '') {
      mentions.enqueue({
        ...message,
        content: seed,
        mentions: { users: { has: () => true } },
      });
    },
    pearls() {
      return store
        .favoriteEntries()
        .filter((entry) => entry.text.length <= 160 && !rejected.has(entry.text));
    },
    weeklyPearl() {
      return store.weeklyPearl();
    },
    configure(userIsAdmin: boolean, mode?: string, chaos?: boolean) {
      if (!userIsAdmin) throw new Error('É necessário Gerenciar Servidor.');
      if (mode !== undefined) {
        if (!['mention', 'discreet', 'participative'].includes(mode))
          throw new Error('Modo inválido.');
        store.setting('auto', mode === 'mention' ? 'false' : 'timer');
        store.setting('conversationMode', mode);
        activityTimer.reset();
      }
      if (chaos !== undefined) store.setting('chaos', Boolean(chaos));
      return this.status();
    },
    status() {
      return {
        enabled: true,
        mode: !['timer', 'true', 'always'].includes(store.setting('auto') || '')
          ? 'mention'
          : store.setting('conversationMode') || 'discreet',
        chaos: store.setting('chaos') !== 'false',
        learnedMessages: store.texts().length,
        ai: ai?.status(),
      };
    },
    close() {
      client.off('messageDeleteBulk', bulkRemove);
      client.off('messageReactionRemove', unreact);
      mentions.close();
      activityTimer.close();
      client.off('messageCreate', handle);
      client.off('messageDelete', remove);
      client.off('messageUpdate', edit);
      client.off('messageReactionAdd', react);
      store.close();
    },
  };
}
