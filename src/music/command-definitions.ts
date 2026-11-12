import type {
  Client,
  ApplicationCommandOptionData,
  ChatInputApplicationCommandData,
  ApplicationCommandSubCommandData,
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
    description: 'Conversa, ajuda e diagnóstico do TheDam',
    options: [
      sub('diagnostico', 'Ver conexão, configuração e módulos'),
      sub('conversa', 'Configurar as respostas do Markov', [
        choices('modo', 'Participação no geral', [
          ['Só por menção', 'mention'],
          ['Automático · discreto', 'discreet'],
          ['Automático · mais participativo', 'participative'],
        ]),
        choices('caos', 'Combinações mais imprevisíveis', [
          ['Ativar', 'on'],
          ['Desativar', 'off'],
        ]),
      ]),
      sub('frase', 'Gerar uma frase para o geral', [
        text('palavra', 'Palavra para inspirar a frase', false, 40),
      ]),
      sub('perolas', 'Escolher uma frase favorita'),
      sub('perola-da-semana', 'Ver a frase mais bem avaliada da semana'),
      sub('ajuda', 'Ver os comandos principais'),
    ],
  },
  { name: 'musica', description: 'Abrir os controles de música da call' },
  { name: 'playlists', description: 'Tocar e organizar as playlists do grupo' },
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
