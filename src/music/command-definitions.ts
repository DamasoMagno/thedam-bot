import type {
  Client,
  ApplicationCommandOptionData,
  ChatInputApplicationCommandData,
  ApplicationCommandSubCommandData,
  ApplicationCommandOptionChoiceData,
} from 'discord.js';
import { ApplicationCommandOptionType as Option } from 'discord.js';
const text = (
  name: string,
  description: string,
  required = false,
  max_length = 60,
) => ({
  name,
  description,
  type: Option.String as const,
  required,
  max_length,
});
const sub = (
  name: string,
  description: string,
  options: ApplicationCommandOptionData[] = [],
): ApplicationCommandSubCommandData => ({
  name,
  description,
  type: Option.Subcommand,
  options: options as ApplicationCommandSubCommandData['options'],
});
const track = text('musica', 'Nome ou link de faixa do YouTube ou Spotify', true, 240);
const choices = (
  name: string,
  description: string,
  values: [string, string][],
  required = false,
) => ({
  ...text(name, description, required),
  choices: values.map(([name, value]) => ({ name, value })),
});
export const musicCommands: ChatInputApplicationCommandData[] = [
  {
    name: 'dam',
    description: 'Música e conversa do TheDam',
    options: [
      sub('tocar', 'Buscar ou tocar uma música', [track]),
      sub('pausar', 'Pausar a música da call'),
      sub('continuar', 'Continuar a música pausada'),
      sub('pular', 'Pular para a próxima música'),
      sub('parar', 'Encerrar a reprodução e limpar a fila'),
      sub('painel', 'Abrir o painel musical compartilhado'),
      sub('fila', 'Ver e organizar a fila'),
      sub('playlists', 'Escolher uma playlist salva'),
      sub('salvar-fila', 'Salvar a música atual e a fila como playlist', [
        text('nome', 'Nome da playlist', true),
        text('categoria', 'Rock, Eletrônica, Jogando...', false, 40),
      ]),
      sub('criar-playlist', 'Criar uma playlist vazia', [
        text('nome', 'Nome da playlist', true),
        text('categoria', 'Gênero ou ocasião', false, 40),
      ]),
      sub('favoritas', 'Ver suas músicas favoritas'),
      sub('recentes', 'Tocar novamente uma música recente'),
      sub('embaralhar', 'Embaralhar as próximas músicas'),
      sub('remover-musica', 'Escolher uma música para remover da fila'),
      sub('limpar-duplicadas', 'Remover músicas duplicadas da fila'),
      sub('repetir', 'Ativar ou desligar a repetição da música atual', [
        choices(
          'modo',
          'Repetir a música atual',
          [
            ['Ativar', 'on'],
            ['Desativar', 'off'],
          ],
          true,
        ),
      ]),
      sub('diagnostico', 'Ver conexão, configuração e módulos'),
      sub('conversa', 'Configurar as respostas do Markov', [
        choices('modo', 'Participação no geral', [
          ['Só por menção', 'mention'],
          ['Discreto', 'discreet'],
          ['Mais participativo', 'participative'],
        ]),
        choices('caos', 'Combinações mais imprevisíveis', [
          ['Ativar', 'on'],
          ['Desativar', 'off'],
        ]),
      ]),
      sub('ajuda', 'Ver os comandos principais'),
    ],
  },
  {
    name: 'tocar',
    description: 'Tocar uma música ou adicionar à fila da sua call',
    options: [track],
  },
  ...[
    ['fila', 'Ver a música atual e as próximas da sua call'],
    ['pausar', 'Pausar a música da sua call'],
    ['continuar', 'Continuar a música da sua call'],
    ['pular', 'Pular para a próxima música da sua call'],
    ['parar', 'Limpar a fila e desconectar o bot da sua call'],
  ].map(([name, description]) => ({ name, description })),
];
export async function registerMusicCommands(client: Client) {
  const guild = '1379585303295299714';
  const current = await client.application!.commands.fetch({ guildId: guild });
  for (const command of musicCommands) {
    const existing = current.find((value) => value.name === command.name);
    if (!existing?.equals(command, true))
      await client.application!.commands.create(command, guild);
  }
}
