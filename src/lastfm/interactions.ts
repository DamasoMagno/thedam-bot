import type { Interaction } from 'discord.js';
import type { PlayerService } from '../music/player-service.ts';
import {
  button,
  row,
  messagePayload,
  safeTitle,
  selection,
} from '../music/presentation.ts';
import { MusicError } from '../shared/music-error.ts';
import type { LastFmService } from './service.ts';
export async function handleLastFmInteraction(
  interaction: Interaction,
  name: string,
  value: string | undefined,
  music: PlayerService,
  lastfm?: LastFmService,
) {
  if (!name.startsWith('lastfm')) return false;
  if (!lastfm) throw new MusicError(503, 'Last.fm não configurado neste bot.');
  if (!interaction.isButton() && !interaction.isStringSelectMenu()) return false;
  const user = interaction.user.id,
    guild = interaction.guildId!;
  // Membership is required, but linking a personal account does not require a call.
  await music.gateway.member?.(guild, user);
  if (name === 'lastfmConnect') {
    const auth = await lastfm.connect(user);
    const payload = messagePayload(
      'Autorize o TheDam no Last.fm. Ao confirmar, você permite registrar as músicas que ouvir nesta call; pode desconectar quando quiser.',
    );
    await interaction.editReply({
      ...payload,
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 5, label: 'Autorizar no Last.fm', url: auth.url },
          ],
        },
        row(
          button('Já autorizei', 'lastfmConfirm:' + auth.id, 1),
          button('Cancelar', 'lastfmCancel'),
        ),
      ],
    });
  } else if (name === 'lastfmCancel') {
    lastfm.cancelConnect(user);
    await interaction.editReply(messagePayload('Autorização cancelada.'));
  } else if (name.startsWith('lastfmConfirm:')) {
    const account = await lastfm.confirm(user, name.slice('lastfmConfirm:'.length));
    await interaction.editReply(
      messagePayload(
        'Conectado como **' +
          safeTitle(account) +
          '**. O registro começa nas músicas que você ouvir a partir de agora.',
      ),
    );
  } else if (name === 'lastfmUnlink') {
    lastfm.unlink(user);
    await interaction.editReply(
      messagePayload(
        'Last.fm desconectado. Registros pendentes locais foram removidos. Para revogar o acesso no Last.fm, remova o TheDam nas configurações de aplicativos da sua conta.',
      ),
    );
  } else if (name === 'lastfmSimilar' || name === 'lastfmArtists') {
    const items = await lastfm.recommendations(
      user,
      music.state(guild).current,
      name === 'lastfmArtists',
    );
    await interaction.editReply(
      messagePayload(
        items.length
          ? 'Escolha uma sugestão do Last.fm para buscar no YouTube.'
          : 'Sem sugestões para esta faixa.',
        selection(
          'lastfmTrack',
          'Escolher sugestão',
          items.map((item) => ({
            label: item.track,
            description: item.artist,
            value: item.token,
          })),
        ),
      ),
    );
  } else if (name === 'lastfmTrack' && value) {
    const choice = lastfm.choice(user, value);
    const result = await music.run(guild, user, 'search', {
      query: choice.artist + ' ' + choice.track,
      provider: 'youtube',
    });
    await interaction.editReply(
      messagePayload(
        'Escolha a versão para adicionar à fila.',
        selection(
          'track',
          'Selecionar música',
          (result.tracks || []).map((track) => ({
            label: track.title,
            description: track.artist,
            value: track.token,
          })),
        ),
      ),
    );
  } else {
    const profile = await lastfm.profile(user);
    await interaction.editReply(
      messagePayload(
        profile
          ? '**Last.fm · ' +
              safeTitle(profile.name) +
              '**\n' +
              profile.plays +
              ' reproduções no perfil. Scrobble ativo enquanto você ouve na call.'
          : '**Last.fm**\nConecte sua conta para registrar o que ouvir. Recomendações da música atual também funcionam sem vínculo pessoal.',
        [
          row(
            button(profile ? 'Reconectar' : 'Conectar minha conta', 'lastfmConnect', 1),
            ...(profile ? [button('Desconectar', 'lastfmUnlink')] : []),
          ),
          row(
            button('Músicas parecidas', 'lastfmSimilar'),
            button('Artistas parecidos', 'lastfmArtists'),
          ),
        ],
      ),
    );
  }
  return true;
}
