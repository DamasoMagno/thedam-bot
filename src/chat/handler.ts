import type { Client } from 'discord.js';
import type { ChatMessage, ChatReaction, ChatUser } from './types.ts';
import type { ChatStore } from './store.ts';
import type { ActivityOptions } from './activity-timer.ts';
import { PermissionsBitField } from 'discord.js';
import { safeText, generateText } from './model.ts';
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
}: {
  client: Client;
  store: ChatStore;
  channelId: string;
  guildId: string;
  random?: () => number;
  now?: () => number;
  generate?: typeof generateText;
  activityOptions?: Partial<ActivityOptions>;
}) {
  let lastReply = 0,
    lastAuto = 0;
  const recent = new Map<string, { text: string; at: number }>(),
    rejected = new Set(store.rejected()),
    voters = new Map<string, string>();
  const matches = (message: Pick<ChatMessage, 'guildId' | 'channelId'>) =>
    message.guildId === guildId && message.channelId === channelId;
  const send = async (message: Pick<ChatMessage, 'channel'>, text: string) => {
    activityTimer.noteReply();
    const reply = await message.channel.send({
      content: text,
      allowedMentions: { parse: [], repliedUser: false },
    });
    return reply;
  };
  const rememberReply = (result: { id: string }, text: string) => {
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
      const text = generate(store.texts(), {
        chaos: store.setting('chaos') === 'true',
        random,
        maxLength: 160,
        excluded: [...rejected, ...[...recent.values()].map((item) => item.text)],
      });
      if (!text || text.length > 160 || !safeText(text) || rejected.has(text)) return;
      const result = await send({ channel }, text);
      rememberReply(result, text);
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
    if (!mentioned) {
      const text = safeText(message.content);
      if (text) {
        store.learn(message, text);
        activityTimer.noteActivity(message.channel, message.author.id);
      } else return;
    }
    const auto = store.setting('auto');
    const always = auto === 'always';
    if (!mentioned) return;
    const command = mentioned
      ? (message.content || '').replace(/<@!?\d+>/g, '').trim()
      : '';
    const admin = message.member?.permissions?.has(
      PermissionsBitField.Flags.ManageGuild,
    );
    if (
      now() - lastReply < 15000 &&
      !(admin && /^(automatico|automático)\s+off$/i.test(command))
    )
      return;
    lastReply = now();
    if (!mentioned) lastAuto = now();
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
      .filter((text) => text.length <= 160 && safeText(text) && !rejected.has(text));
    const text = /^(pérolas|perolas)$/i.test(command)
      ? favorites[Math.floor(random() * favorites.length)]
      : generate(store.texts(), {
          seed: command.split(/\s+/)[0],
          chaos: store.setting('chaos') === 'true',
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
  });
  const remove = (message: Pick<ChatMessage, 'id' | 'guildId' | 'channelId'>) => {
    if (matches(message)) store.remove(message.id);
  };
  const edit = guarded(async (_before: unknown, message: ChatMessage) => {
    if (!matches(message)) return;
    store.remove(message.id);
    if (!message.author?.bot && !message.webhookId) {
      const text = safeText(message.content);
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
    const item = recent.get(reaction.message.id);
    if (!item) return;
    const key = reaction.message.id + ':' + user.id;
    if (voters.get(key) === reaction.emoji.name) return;
    voters.set(key, reaction.emoji.name!);
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
        chaos: store.setting('chaos') === 'true',
        learnedMessages: store.texts().length,
      };
    },
    close() {
      client.off('messageDeleteBulk', bulkRemove);
      client.off('messageReactionRemove', unreact);
      activityTimer.close();
      client.off('messageCreate', handle);
      client.off('messageDelete', remove);
      client.off('messageUpdate', edit);
      client.off('messageReactionAdd', react);
      store.close();
    },
  };
}
