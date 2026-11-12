import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from 'discord.js';
export function musicInputModal() {
  return new ModalBuilder()
    .setCustomId('dam:musicInput')
    .setTitle('Adicionar música à fila')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('query')
          .setLabel('Nome ou link do YouTube/Spotify')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(240),
      ),
    );
}
export function libraryInputModal(
  action: 'createPlaylist' | 'importPlaylist' | 'savePlaylist',
) {
  const modal = new ModalBuilder()
    .setCustomId('dam:libraryInput:' + action)
    .setTitle(
      action === 'importPlaylist'
        ? 'Importar playlist do Spotify'
        : action === 'savePlaylist'
          ? 'Salvar fila como playlist'
          : 'Criar playlist',
    );
  if (action === 'importPlaylist')
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('link')
          .setLabel('Link completo da playlist do Spotify')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(240),
      ),
    );
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('name')
        .setLabel('Nome da playlist')
        .setStyle(TextInputStyle.Short)
        .setRequired(action !== 'importPlaylist')
        .setMaxLength(60),
    ),
  );
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('category')
        .setLabel('Categoria (opcional)')
        .setPlaceholder('Rock, eletrônica, relax...')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(40),
    ),
  );
  return modal;
}
