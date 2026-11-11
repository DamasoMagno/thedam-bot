import { PermissionsBitField } from 'discord.js';
import { safeText, generateText } from './model.js';
import { createActivityTimer } from './activity-timer.js';
export function createChatHandler({
  client,
  store,
  channelId,
  guildId,
  random = Math.random,
  now = Date.now,
  generate = generateText,
}) {
  let lastReply = 0,
    lastAuto = 0;
  const recent = new Map(),
    rejected = new Set(store.rejected()),
    voters = new Set();
  const matches = (message) =>
    message.guildId === guildId && message.channelId === channelId;
  const send = async (message, text) => {
    activityTimer.noteReply();
    const reply = await message.channel.send({
      content: text,
      allowedMentions: { parse: [], repliedUser: false },
    });
    return reply;
  };
  const rememberReply = (result, text) => {
    recent.set(result.id, { text, at: now() });
    for (const [id, item] of recent)
      if (now() - item.at > 86400000 || recent.size > 100) recent.delete(id);
  };
  const activityTimer = createActivityTimer({
    now,
    enabled: () => store.setting('auto') === 'timer',
    speak: async (channel) => {
      const text = generate(store.texts(), {
        chaos: store.setting('chaos') === 'true',
        random,
        excluded: [...rejected, ...[...recent.values()].map((item) => item.text)],
      });
      if (!text || !safeText(text) || rejected.has(text)) return;
      const result = await send({ channel }, text);
      rememberReply(result, text);
    },
  });
  const guarded =
    (fn) =>
    (...args) =>
      Promise.resolve(fn(...args)).catch(() =>
        console.warn('Não foi possível concluir a ação do Markov.'),
      );
  const handle = guarded(async (message) => {
    if (!matches(message) || message.author?.bot || message.webhookId) return;
    const mentioned = message.mentions?.users?.has(client.user.id);
    if (!mentioned) {
      const text = safeText(message.content);
      if (text) {
        store.learn(message, text);
        activityTimer.noteActivity(message.channel);
      } else return;
    }
    const auto = store.setting('auto');
    const always = auto === 'always';
    if (
      !mentioned &&
      !always &&
      (auto !== 'true' || now() - lastAuto < 300000 || random() > 0.01)
    )
      return;
    const command = mentioned
      ? (message.content || '').replace(/<@!?\d+>/g, '').trim()
      : '';
    const admin = message.member?.permissions?.has(
      PermissionsBitField.Flags.ManageGuild,
    );
    if (
      !always &&
      now() - lastReply < 15000 &&
      !(admin && /^(automatico|automático)\s+off$/i.test(command))
    )
      return;
    lastReply = now();
    if (!mentioned) lastAuto = now();
    if (/^(esquecer|apagar aprendizado)$/i.test(command)) {
      if (!admin) return;
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
        state === 'temporizador'
          ? 'timer'
          : state === 'sempre'
            ? 'always'
            : state === 'on',
      );
      if (state === 'temporizador')
        return send(
          message,
          'Vou falar no máximo a cada 5 minutos, só com conversa recente no geral.',
        );
      if (state === 'sempre')
        return send(
          message,
          'Vou responder a cada nova mensagem de texto válida no geral.',
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
      .filter((text) => safeText(text) && !rejected.has(text));
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
  const remove = (message) => {
    if (matches(message)) store.remove(message.id);
  };
  const edit = guarded(async (_before, message) => {
    if (!matches(message)) return;
    store.remove(message.id);
    if (!message.author?.bot && !message.webhookId) {
      const text = safeText(message.content);
      if (text) store.learn(message, text);
    }
  });
  const react = guarded(async (reaction, user) => {
    if (
      user.bot ||
      !matches(reaction.message) ||
      !['👍', '👎'].includes(reaction.emoji.name)
    )
      return;
    const item = recent.get(reaction.message.id);
    if (!item) return;
    const key = reaction.message.id + ':' + user.id;
    if (voters.has(key)) return;
    voters.add(key);
    if (voters.size > 2000) voters.delete(voters.values().next().value);
    if (reaction.emoji.name === '👍') store.remember(reaction.message.id, item.text);
    else {
      store.reject(reaction.message.id, item.text);
      rejected.add(item.text);
      if (rejected.size > 100) rejected.delete(rejected.values().next().value);
    }
  });
  client.on('messageCreate', handle);
  client.on('messageDelete', remove);
  client.on('messageUpdate', edit);
  client.on('messageReactionAdd', react);
  return {
    close() {
      activityTimer.close();
      client.off('messageCreate', handle);
      client.off('messageDelete', remove);
      client.off('messageUpdate', edit);
      client.off('messageReactionAdd', react);
      store.close();
    },
  };
}
