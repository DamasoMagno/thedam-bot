# TheDam

Bot privado do servidor **Amigos**: música nas calls e conversa divertida no **geral**.
Monólito modular em **TypeScript estrito + Node.js 22.18+**, sem framework HTTP.
Usa discord.js, @discordjs/voice, SQLite, yt-dlp e FFmpeg. Não recebe voz dos membros.

## Instalação rápida

1. Instale Docker com Compose. Copie `.env.example` para `.env`.
2. Preencha `DISCORD_BOT_TOKEN` e `MUSIC_SHARED_SECRET` (`openssl rand -hex 32`).
3. No Developer Portal, ative **Message Content Intent** se usar o Markov e configure
   `MARKOV_ENABLED=true`. O canal autorizado já está indicado no exemplo.
4. Convide o bot com escopos `bot` e `applications.commands`. Permita ver canais,
   conectar/falar na call e enviar mensagens no canal do painel. Para Markov, permita
   enviar mensagens e ler histórico no geral. Não precisa de Administrador.
5. Execute:

```sh
docker compose up --build -d
docker compose logs --tail 30 music-bot
# Parar sem apagar dados:
docker compose stop music-bot
```

Convite, substituindo o ID se usar outra aplicação:

```text
https://discord.com/oauth2/authorize?client_id=1569590221689982986&scope=bot%20applications.commands&permissions=3214336
```

O bot só funciona no Amigos (`1379585303295299714`) e o Markov só aprende no geral
(`1379585304029171805`). Não basta mudar o canal no `.env` para ampliar o acesso.
Token, segredo e bancos locais ficam fora do Git e da imagem Docker.

## Música no Discord

Entre na call, digite `/dam` e escolha a ação:

- **tocar**: nome ou link de faixa do YouTube/Spotify. Busca por nome apresenta versões
  para escolher; link individual vai direto à fila. Playlists externas não são importadas.
- **painel**: publica uma mensagem compartilhada com música atual, fila e botões.
  O painel é atualizado; as confirmações, buscas e erros ficam privados.
- **fila / remover / embaralhar / duplicadas / repetir**: organização da reprodução.
- **salvar**: guarda música atual + fila como playlist. Informe nome e categoria
  (Rock, Eletrônica, Jogando, Relax...). Até 50 faixas são salvas por lista.
- **criar / playlists**: criar lista vazia, selecionar uma lista, adicionar a música atual,
  tocar a lista ou excluir com confirmação. Criador e administradores podem editar.
- **favoritos**: suas músicas salvas pelo botão Favoritar.
- **historico**: últimas 50 reproduções do servidor, com opção de tocar novamente.
- **status / ajuda**: diagnóstico e instruções. Status não exige estar em call.

Os atalhos `/tocar`, `/fila`, `/pausar`, `/continuar`, `/pular` e `/parar` continuam.
Escolha o comando do **TheDam**, pois outros bots podem ter nomes iguais. Não há
integração que chame o Jockie. O painel tem controles para o grupo e todas as ações
que alteram a reprodução verificam a call real do usuário novamente.

Há uma fila por servidor (até 50 próximas músicas). Outra call não pode assumir a fila.
Ao terminar, encerrar ou ficar 60 s sem ouvintes, o bot libera conexão e processos.
Uma busca lenta não bloqueia parar; encerrar invalida os pedidos pendentes.
A preparação do áudio depende da rede e da fonte; as mensagens indicam a etapa atual.

**Spotify:** opcional, exige `SPOTIFY_CLIENT_ID` e `SPOTIFY_CLIENT_SECRET`. Ele fornece
metadados: o áudio é buscado no YouTube, e a versão pode diferir. Sem credenciais,
YouTube funciona normalmente. Playlists próprias não dependem do Spotify.

## Markov: livre, curto e sem spam

Mistura trechos das mensagens do geral, sem LLM, GPU ou API de IA. Combinações repetitivas
ou sem sentido são permitidas. Não exige quantidade mínima de mensagens para tentar
responder; sem combinações novas, pode avisar que ainda está aprendendo por menção.

- `@TheDam palavra`: tenta gerar uma frase com essa palavra.
- `@TheDam ajuda`, `@TheDam pérolas`, `@TheDam frequentes`.
- 👍 guarda uma resposta; 👎 rejeita. É possível trocar a reação.
- `/dam conversa`: configuração por administradores com Gerenciar Servidor.

Modos: **Só por menção** (padrão em instalação nova), **Discreto** e **Mais participativo**.
Os modos espontâneos não respondem a cada mensagem:

1. O discreto identifica pelo menos seis mensagens de duas pessoas em três minutos.
   O participativo usa quatro mensagens de duas pessoas.
2. Agenda **uma única resposta** com espera sorteada a partir da mensagem que ativou
   a condição: 2–5 minutos no discreto; 2–3 minutos no participativo.
3. Antes de falar, confere a atividade. Se não houver mensagem humana válida no último
   minuto, o chat não estiver mais movimentado ou o modo foi desligado, cancela.
4. Menções cancelam o envio pendente; há intervalo mínimo entre falas espontâneas.
   O bot não mantém sua própria atividade e não agenda vários envios para um mesmo pico.

Respostas geradas têm até **160 caracteres** e até 24 palavras. Regras de segurança
continuam: ignora bots, mensagens vazias, links, menções e padrões comuns de segredos.
O filtro não identifica todo conteúdo sensível. Todas as respostas bloqueiam pings
para everyone, here, cargos e pessoas.

Os comandos antigos `@TheDam automatico on/sempre/temporizador` ativam participação
por atividade; `automatico off` deixa somente menções. `caos on/off` muda a combinação
para palavras mais imprevisíveis. `esquecer` apaga aprendizado, favoritos e configurações.

SQLite guarda até 2.000 mensagens válidas, descarta textos com mais de 30 dias e limita
favoritas/rejeitadas a 100. A limpeza ocorre na abertura e nas leituras/aprendizado.
Edições e exclusões recebidas, inclusive exclusão em lote, atualizam o corpus.
O histórico não é reimportado a cada reinício. A função de manutenção
`chat/history.ts` permite importar até 2.000 mensagens válidas dos últimos 30 dias,
exclusivamente do geral. Favoritos antigos não mantêm reações ligadas após reiniciar.

## Integração com o site

O navegador nunca acessa a API do bot diretamente. O backend do site valida a sessão
Discord e encaminha o usuário autenticado. Bot e site devem usar o mesmo segredo:

```dotenv
MUSIC_BOT_URL=http://music-bot:3031
MUSIC_SHARED_SECRET=mesmo-segredo-do-bot
```

O Compose cria a rede `coffee-music`. O app do site deve participar dela, pelo complemento
`compose.music.yml` do projeto do site. A nova biblioteca está disponível pela API;
os novos menus do frontend do site ainda precisam ser conectados a esses endpoints.

API privada, sempre com `Authorization: Bearer MUSIC_SHARED_SECRET`:

- `GET /health`: conexão com Discord pronta (`200`) ou não (`503`).
- `POST /v1/guilds/:guildId/:action`: corpo JSON com `userId` e parâmetros da ação.
- Busca: `search {query,provider}` → resultados com token pessoal de uso único (10 min).
- Reprodução: `enqueue {token}`, `state`, `pause`, `resume`, `skip`, `stop`.
- Organização: `remove {id}` (queueId), `shuffle`, `deduplicate`, `repeat {enabled}`.
- Biblioteca: `playlists`, `favorites`, `history`, `favorite`, `status`.
- Listas: `createPlaylist/savePlaylist {name,category}`, `addToPlaylist/deletePlaylist {id}`.
- Tocar salvas: `playlistEnqueue/favoriteEnqueue/historyEnqueue {id}`.

Listagem e status exigem pertencer ao Amigos; reprodução exige a mesma call da fila.
Limites: pedido de 2 KB, 90 chamadas/minuto por usuário na API, limite de cliques no
Discord, 30 playlists/servidor, 50 faixas/lista e 100 favoritas/usuário.
Playlists e favoritas guardam referências, nunca arquivos de áudio.

## Arquitetura e desenvolvimento

```text
src/
  index.ts                   Composição e encerramento
  config/                    Ambiente e IDs autorizados
  discord/                   Login, permissões, voz e verificação de intents
  http/                      API privada, autenticação e limites
  music/
    commands.ts              Adaptação das interações Discord
    command-definitions.ts   Contratos dos comandos e registro
    presentation.ts          Menus e painel compartilhado
    player-service.ts        Autorização, fila, cancelamento e orquestração
    library-repository.ts    Playlists, favoritas e histórico SQLite
    catalog.ts               Busca e resolução YouTube/Spotify
    audio-source.ts          yt-dlp → FFmpeg → Discord
    types.ts                 Contratos internos do módulo
  chat/                      Geração, atividade, persistência, histórico e reações
  shared/                    Erros de domínio
```

Entradas Discord e HTTP reutilizam `PlayerService`; SQL fica nos repositórios.
Não há Redis, microserviços ou servidor de IA. As tabelas musicais são criadas em banco
separado, sem alterar o banco existente de aprendizado.

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run format:check
# Desenvolvimento: preencha .env e instale FFmpeg/yt-dlp no host antes de executar.
MUSIC_DB_PATH=./data/music.sqlite MARKOV_DB_PATH=./data/markov.sqlite npm run dev
```

A CI executa tipos, testes, compilação, formatação e build Docker. A imagem final contém
JavaScript compilado e dependências de produção. O extrator está fixado no Dockerfile;
para atualizá-lo, teste e reconstrua com outro `YTDLP_VERSION`.

## VPS e dados

O mesmo Compose pode rodar na VPS. Não precisa de domínio para comandos Discord.
A porta 3031 é ligada somente ao loopback: não a abra no firewall. São necessárias
conexões de saída HTTPS e UDP para Discord e fontes de música.

O volume `markov_data` mantém `markov.sqlite` e `music.sqlite`. Faça backup antes de
atualizar. Publicar no GitHub não transfere esses bancos: uma VPS nova começa sem o
aprendizado e as listas locais. A fila ativa e o painel em memória não sobrevivem a
reinícios; as bibliotecas e preferências sim. Após reiniciar, use `/dam painel` para
publicar novamente os controles. Nunca rode `docker compose down -v` para atualizar.

Teste em uma call real: duas pessoas, escolha por nome/link, painel visível para todos,
listas e favoritas, pausa/próxima/parar, outra call impedida de controlar e conversa que
esfria antes do envio espontâneo. Os testes automatizados não publicam mensagens reais.
