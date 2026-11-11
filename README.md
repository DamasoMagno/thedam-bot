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
- **fila / remover-musica / embaralhar / limpar-duplicadas / repetir**: organização da reprodução.
- **salvar-fila**: guarda música atual + fila como playlist. Informe nome e categoria
  (Rock, Eletrônica, Jogando, Relax...). Até 50 faixas são salvas por lista.
- **criar-playlist / playlists**: criar lista vazia, selecionar uma lista, adicionar a música atual,
  tocar a lista ou excluir com confirmação. Criador e administradores podem editar.
- **favoritas**: suas músicas salvas pelo botão Favoritar.
- **recentes**: últimas 50 reproduções do servidor, com opção de tocar novamente.
- **diagnostico / ajuda**: diagnóstico e instruções. Status não exige estar em call.

Os controles `/dam pausar`, `/dam continuar`, `/dam pular` e `/dam parar` também estão disponíveis.
Os atalhos `/tocar`, `/fila`, `/pausar`, `/continuar`, `/pular` e `/parar` continuam.
Escolha o comando do **TheDam**, pois outros bots podem ter nomes iguais. Não há
integração que chame o Jockie. O painel tem controles para o grupo e todas as ações
que alteram a reprodução verificam a call real do usuário novamente.

Há uma fila por servidor (até 50 próximas músicas). Outra call não pode assumir a fila.
Ao terminar, encerrar ou ficar 60 s sem ouvintes, o bot libera conexão e processos.
Uma busca lenta não bloqueia parar; encerrar invalida os pedidos pendentes.
O extrator usa o transporte HTTP compatível (`urllib`) para evitar falhas de resolução
observadas no cliente padrão. A preparação do áudio depende da rede e da fonte; as mensagens indicam a etapa atual.

**Spotify:** opcional, exige `SPOTIFY_CLIENT_ID` e `SPOTIFY_CLIENT_SECRET`. Ele fornece
metadados: o áudio é buscado no YouTube, e a versão pode diferir. Sem credenciais,
YouTube funciona normalmente. Playlists próprias não dependem do Spotify.

## Markov e IA ocasional

Aprende com os textos do geral, **incluindo mensagens que mencionam o TheDam**.
O conteúdo não é filtrado por assunto: links, gírias, comandos e frases repetitivas
podem entrar no corpus. Marcações de pessoas/cargos/everyone/here são neutralizadas.
Todas as respostas bloqueiam notificações. Não processa áudio nem aprende com bots.

O gerador é uma cadeia de Markov de primeira ordem por padrão: combina palavras
considerando as transições aprendidas e suas frequências. Une contextos com diferenças
de maiúsculas/pontuação e pode começar em trechos variados. `caos off` usa duas palavras
de contexto para mais coerência. Respostas têm até **160 caracteres e 24 palavras**.
Não exige mínimo de mensagens para tentar gerar; pode reaproveitar frases aprendidas.

- **Menções:** cada pessoa recebe sua resposta em uma fila, com **1 segundo** entre
  respostas. Cada pessoa mantém só um pedido pendente (o mais recente), evitando
  acúmulo ao repetir a menção. O bot referencia a mensagem respondida sem notificar.
- **Espontâneo:** duas pessoas conversando já podem ativar uma resposta agendada.
  Uma pessoa sozinha também ativa após oito mensagens em três minutos (seis no modo
  participativo). A espera é sorteada: 2–5 minutos no discreto, 2–3 no participativo.
  Existe só um envio pendente; se não houver mensagem humana no último minuto ou a
  conversa esfriar, ele é cancelado. Menções cancelam o envio automático pendente.
- **GIFs:** sorteio entre 18 reações, sem repetir as últimas oito. Em aproximadamente 25% das respostas, no máximo um junto da mensagem,
  sem temporizadores ou mensagens extras. `MARKOV_MEDIA_CHANCE=0` desliga.

Comandos no geral:

- `@TheDam palavra` ou `/dam frase palavra:dragão`: gera uma frase para o grupo.
- `/dam perolas`: menu das favoritas; `/dam perola-da-semana`: melhor saldo de votos
  dos últimos sete dias, sob comando, sem publicação automática.
- 👍 guarda uma resposta; 👎 rejeita. Troca e remoção de voto atualizam o placar.
- `@TheDam frequentes`: mostra nomes recorrentes sem pings.
- `/dam conversa`: modos Só por menção, Discreto, Mais participativo e caos.
  Configurações exigem Gerenciar Servidor.
- `@TheDam esquecer`: administrador apaga aprendizado, favoritas e preferências.

Com uma chave de IA configurada, **15% das oportunidades de resposta** podem usar IA
para comentários ou perguntas curtas, engraçadas e irreverentes. A IA não cria uma
nova oportunidade de envio: usa a mesma fila e o mesmo controle de atividade.
Envia apenas a mensagem de contexto (até 500 caracteres), sem importar o histórico
inteiro à API. OpenAI usa Responses API com `store:false`; OpenRouter usa Chat Completions com modelos
gratuitos. Há limite de tokens de saída e timeout
curto e até **30 tentativas/dia**, contadas no SQLite mesmo após reiniciar. Pode haver
retenção operacional pelo provedor conforme a política da conta. Saldo, permissões
ou rede indisponíveis fazem voltar ao Markov, com espera antes de tentar a API de novo.

```dotenv
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=
OPENROUTER_MODEL=openrouter/free
# Opcional: AI_PROVIDER=openai para usar a chave e o modelo abaixo.
OPENAI_API_KEY=
OPENAI_MODEL=gpt-6-luna
OPENAI_REPLY_CHANCE=0.15
OPENAI_DAILY_LIMIT=30
MARKOV_MEDIA_CHANCE=0.25
```

As chaves ficam privadas. OpenAI requer saldo; o OpenRouter pode usar a cota gratuita
com `openrouter/free` ou modelos terminados em `:free`. Outros modelos são bloqueados
nesse provedor para evitar cobrança acidental. OpenRouter tem teto interno de 30 tentativas por dia UTC, mesmo se a variável pedir mais; falhas também contam. Não há fallback para modelos pagos nem para OpenAI. Ao atingir o teto, continua só com Markov. Sem chave, não há chamadas de IA.
`HTTP-Referer` é opcional e não foi preenchido com um endereço fictício; o nome do
aplicativo é enviado como `TheDam`. Cotas e disponibilidade são do provedor.
`/dam diagnostico` informa o estado. O limite de chamadas não é um teto financeiro
fornecido pela OpenAI; configure também o orçamento do projeto no painel da API.

Se uma frase gerada começar com `/tocar`, `/dam tocar`, `!tocar` ou `!play`, o bot
pode adicionar a faixa diretamente à sua própria fila. Usa a identidade da pessoa que
provocou a resposta, exige a call correta e aceita só tocar (nunca executar código ou
comandos destrutivos). Limite: uma ação musical gerada a cada dez minutos. Isso não
aciona Jockie nem outros bots. Mensagens de erro dessa brincadeira não são repetidas.

SQLite mantém até 2.000 mensagens por 30 dias, favoritas e rejeitadas (100 cada),
300 respostas geradas com votos e o contador diário da IA. Exclusões/edições recebidas,
inclusive em lote, atualizam o corpus. O histórico não é reimportado ao reiniciar.
A função `chat/history.ts` permite importar até 2.000 mensagens dos últimos 30 dias.

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
  chat/                      Markov, fila de menções, atividade, mídia, votos e dados
  ai/                        OpenAI opcional, limite diário e fallback
  shared/                    Erros de domínio
```

Entradas Discord e HTTP reutilizam `PlayerService`; SQL fica nos repositórios.
Não há Redis nem microserviços. A IA opcional usa API externa e não carrega modelos na VPS. As tabelas musicais são criadas em banco
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
