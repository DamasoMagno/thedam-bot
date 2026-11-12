# TheDam

Bot privado do servidor **Amigos**: música nas calls e conversa divertida no **geral**.
Monólito modular em **TypeScript estrito + Node.js 22.18+**, sem framework HTTP.
Usa discord.js, @discordjs/voice, SQLite, yt-dlp e FFmpeg. Recebe voz somente por solicitação explícita no botão **Comando por voz**, conforme descrito abaixo.

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

O caminho principal é **`/musica`**. Ele abre um painel compartilhado na call ou no canal de texto, com **Adicionar música**, **Pausar/Continuar**, **Pular**, **Fila** e **Playlists**. Se houver listas salvas, o seletor **Tocar uma playlist na call** inicia a lista sem passar pela edição. **Mais opções** reúne favoritas, recentes, salvar a música atual e encerrar.

Comandos curtos, sem versões musicais duplicadas em `/dam`:

- `/musica`: abrir o painel.
- `/tocar musica:nome ou link`: buscar uma faixa; por nome, escolher a versão antes de adicionar à fila.
- `/playlists`: criar, importar, ver e editar listas, mesmo sem estar em call.
- `/fila`: mover, remover, embaralhar, repetir, limpar duplicadas e salvar a fila pelos botões.
- `/pausar`, `/continuar`, `/pular`, `/parar`: atalhos das ações de reprodução.

Os antigos subcomandos musicais de `/dam` foram removidos da definição de registro. `/dam` mantém conversa, frases, pérolas, diagnóstico e ajuda. Criar/importar listas e salvar a fila ficam nos respectivos painéis, sem exigir decorar comandos adicionais.

**Playlists:** `/playlists` → **Criar playlist** ou **Importar Spotify**. Ao escolher uma lista, os botões são **Tocar**, **Adicionar músicas**, **Remover música** e **Excluir playlist**. A exclusão pede confirmação e pode ser cancelada. Remover faixa usa uma revisão da lista: um menu antigo não remove outra música caso alguém tenha editado a lista. Criador e administradores podem editar; os demais podem tocar. Editar ou excluir uma lista não altera cópias já presentes na fila da call.

**Fila:** escolha uma faixa e use **Subir**, **Descer** ou **Remover**. As navegações privadas atualizam a mesma mensagem sempre que possível. O painel compartilhado acompanha as alterações; confirmações, buscas e erros ficam privados e não notificam pessoas.

Há uma fila por servidor (até 50 próximas músicas). Outra call não pode assumir a fila. Ao terminar a fila, o bot libera os processos de áudio e aguarda **60 segundos** antes de sair da call. Se uma nova faixa começar nesse intervalo, a saída é cancelada e a conexão é reaproveitada. **Parar/Encerrar** continua saindo imediatamente. A regra de sair após 60 s sem ouvintes também permanece. Um pedido por voz pode manter a conexão temporariamente enquanto é processado, mas não mantém escuta contínua. Uma busca lenta não bloqueia parar; encerrar invalida pedidos de reprodução pendentes.

**Spotify:** opcional, exige `SPOTIFY_CLIENT_ID` e `SPOTIFY_CLIENT_SECRET`. Fornece metadados; o áudio é buscado no YouTube e a versão pode diferir. YouTube e playlists próprias funcionam sem conta Spotify.

### Adicionar músicas e importar Spotify

- `/playlists` → escolha a lista → **Adicionar músicas** → nome ou link de faixa YouTube/Spotify. Por nome, escolha uma versão. Isso salva metadados sem tocar ou mudar a fila; não precisa estar na call.
- **Importar Spotify**, na tela `/playlists`, cria uma playlist do bot com as faixas do Spotify. Também pode colar a URL de uma playlist no formulário **Adicionar músicas** para acrescentá-la a uma lista existente. Depois, use **Tocar** para acrescentar à fila da call.
- Até **50 músicas por playlist**. Duplicatas, arquivos locais e itens indisponíveis são ignorados. Se ultrapassar o limite, a operação é recusada inteira, sem salvar parte da importação. A lista salva é uma cópia das referências naquele momento; não há sincronização contínua com o Spotify.
- A conexão Spotify é compartilhada pelo bot deste grupo. Na [API em modo de desenvolvimento](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide), o conteúdo das playlists depende de uma conta autorizada que seja proprietária ou colaboradora; o dono do app também precisa cumprir os requisitos de Premium do Spotify. Não basta a lista ser pública nem apenas Client ID/Secret. Isso não altera as permissões de edição das playlists do bot: criador e administradores.

Conexão inicial (administrador, no computador que contém o `.env`):

1. No [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), cadastre o Redirect URI `http://127.0.0.1:8890/callback` no mesmo app das credenciais.
2. Execute `npm run spotify:connect` no host com Node 22.18+ e abra o link impresso. Autorize a conta que disponibilizará suas playlists ao grupo. O callback escuta apenas o loopback durante cinco minutos e usa `state` de uso único.
3. O comando grava `SPOTIFY_REFRESH_TOKEN` no `.env` com permissão privada, sem imprimir a credencial. Na próxima atualização autorizada, reinicie o bot para carregar o ambiente. Se o Spotify revogar a autorização, repita a conexão. Não altere a VPS se estiver testando localmente.

A importação é testada automaticamente com respostas simuladas da API. O teste real depende dessa autorização interativa; as credenciais Client Credentials existentes não substituem o consentimento da conta. Não são baixados arquivos de áudio do Spotify.

### Desempenho e recuperação de música

- Ao buscar um link YouTube, o bot reaproveita os dados do formato de áudio retornados pelo extrator. Para buscas por nome, resolve somente a faixa escolhida. O cache privado de fontes tem até 100 itens, expira em até 90 segundos (ou antes de vencer o link) e aceita somente HTTPS Googlevideo, cabeçalhos e formatos permitidos.
- O caminho de reprodução continua **yt-dlp → FFmpeg → Discord**. Usa `--load-info-json` por stdin quando há metadados compatíveis; formatos sem esse suporte seguem o extrator normal. Erros invalidam a fonte antes da recuperação. Não há arquivos de áudio ou manifests temporários em disco.
- Após validar o pedido, prepara o primeiro áudio e conecta à call em paralelo. Só começa a reprodução depois das duas etapas e de revalidar a call, o pedido e as permissões. Cancelar/parar libera a preparação; uma falha de conexão não deixa um download tocando sozinho. A pré-carga é limitada por backpressure, sem baixar a fila inteira.

- Buscas bem-sucedidas ficam em cache por **5 minutos**, com até **100 buscas** na memória. Cada pessoa continua recebendo tokens próprios; permissões são verificadas em cada ação. Não armazena áudio. URLs temporárias de streaming ficam somente no cache privado em memória descrito abaixo; nunca são gravadas em playlists ou retornadas pela API. Buscas canceladas, vazias e falhas não são salvas.
- `/dam diagnostico` mostra o tempo da última busca, quantas foram reaproveitadas e o tempo até o primeiro áudio PCM da fonte. Esse tempo não inclui a conexão de voz nem representa quando o usuário efetivamente ouviu a música. Uma busca inédita continua dependendo do YouTube/Spotify.
- Uma falha da **fonte de áudio** permite **uma nova tentativa da mesma música, desde o início**. O painel avisa e a fonte anterior é encerrada. Se falhar novamente, segue para a próxima faixa. Isso não adiciona chamadas de IA. Falhas da conexão de voz continuam seguindo o tratamento do gateway.
- Pausar é preservado durante a recuperação. Pular ou encerrar cancela a tentativa pendente e libera os processos. Não há download antecipado de toda a fila. Listas Spotify resolvem a primeira faixa antes de iniciar; as demais são preparadas quando chegam à vez, sem aguardar a resolução de toda a lista.

## Last.fm opcional

Preencha `LASTFM_API_KEY` e `LASTFM_API_SECRET` obtidos em [criar aplicação Last.fm](https://www.last.fm/api/account/create).
`LASTFM_DB_PATH` usa `/app/data/lastfm.sqlite` no volume existente. Sem as duas credenciais,
não abre banco, não faz chamadas e não mostra a opção no painel. Não precisa de novo domínio,
callback público ou porta de firewall: utiliza o [fluxo de autorização desktop](https://www.last.fm/api/authspec).

**Vincular:** `/musica` → **Mais opções** → **Last.fm · perfil e sugestões** → **Conectar minha conta**.
Abra o link privado, autorize no Last.fm e clique em **Já autorizei**. O pedido expira em dez
minutos, pertence à pessoa que o iniciou e pode ser cancelado. Nunca cole sua senha no Discord.
O consentimento permite registrar as músicas que você ouvir na call do bot. Cada integrante
vincula a própria conta; não registra ouvintes sem vínculo.

**Perfil e descobertas:** o painel pessoal mostra o total de reproduções e permite escolher
**Músicas parecidas** ou **Artistas parecidos**. Usa a faixa atual com artista identificado; se
ela não estiver disponível, usa sua faixa mais ouvida do mês. As sugestões abrem a busca de
versões YouTube e só entram na fila após a seleção, com as mesmas permissões da reprodução.
Não inicia rádio ou autoplay. As sugestões do contexto atual funcionam sem conta pessoal.

**Scrobble:** envia Now Playing e registra uma vez por reprodução/usuário após ouvir metade da
faixa ou quatro minutos, o que vier primeiro. Faixas de até 30 segundos, duração desconhecida
ou artista não identificável não são registradas. Prioriza os metadados Spotify; no YouTube,
só aceita títulos explícitos `Artista — Música`, sem tratar o uploader como artista. A
identificação pode falhar em títulos fora desse padrão; é preferível não registrar a inventar.

O tempo é contado quando o player Discord está efetivamente em `Playing`, com a pessoa na
mesma call e sem estar ensurdecida. Pausas, buffering e ausência não acumulam tempo. O bot
não consegue detectar volume zero no dispositivo. Eventos de voz/player e um pulso leve a
cada dez segundos atualizam a contagem, sem capturar áudio. Um atraso do processo é limitado
a 20 segundos por atualização para evitar atribuir um período longo não observado.

**Privacidade e falhas:** sessões são criptografadas com AES-256-GCM, usando chave derivada de
`MUSIC_SHARED_SECRET`. Preserve esse segredo junto ao backup; se trocá-lo, as contas precisarão
ser reconectadas. **Desconectar** remove o vínculo e os registros pendentes locais, sem apagar
o histórico já enviado ao Last.fm. Para revogar a autorização externa, remova o aplicativo nas
configurações Last.fm. Um envio já iniciado pode concluir durante a desconexão.

As chamadas são serializadas com intervalo mínimo de 300 ms e timeout de oito segundos.
Recomendações têm cache de dez minutos/100 consultas; escolhas são pessoais, expiram em cinco
minutos e têm teto de 500 entradas. Scrobbles pendentes ficam em SQLite (máximo 500), tentam
novamente com espera progressiva em falhas transitórias, no máximo cinco tentativas, e expiram
em sete dias. Erros de sessão invalidam o vínculo. IDs locais evitam reenvio normal, mas uma
falha entre a aceitação remota e a confirmação local não oferece garantia absoluta de envio
único. A reprodução não aguarda o Last.fm nem depende da disponibilidade dele.

A implementação segue a [documentação de scrobbling](https://www.last.fm/api/scrobbling) e
[faixas similares](https://www.last.fm/api/show/track.getSimilar). Os testes locais simulam a
API: a validação real depende das credenciais e do consentimento individual, ainda pendentes.

## Comando por voz opcional (experimental)

1. Entre na call e abra `/musica`.
2. Clique em **Comando por voz**. Só a sua próxima fala será capturada. Há 20 segundos para o pedido, com trecho de até 8 segundos; **Cancelar escuta** interrompe a captura ou a transcrição pendente.
3. Diga **“TheDam, tocar Queen”** ou **“TheDam, tocar playlist Rock”**. Também aceita **“TheDam, pausar”**, **“TheDam, continuar”** e **“TheDam, pular”**.
4. A captura termina antes da transcrição. O pedido é aplicado à mesma fila, com nova verificação da sua call. Enquanto está interpretando, o bot pode manter a conexão; concluído o pedido, segue o comportamento normal da música. Se não houver música nem pedido pendente, aguarda 60 segundos antes de sair da call.

Não existe escuta contínua ou ativação somente pela palavra TheDam: é preciso clicar novamente para cada fala. Somente a stream de voz da pessoa que clicou é recebida; as streams dos demais participantes não são assinadas. A primeira versão usa a primeira correspondência da busca musical; use `/tocar` quando quiser escolher uma versão específica.

O trecho solicitado é enviado ao OpenRouter. O bot não grava áudio em disco, não salva a transcrição no banco e não a usa no aprendizado Markov. O decodificador é carregado apenas durante uma captura. Máximo de dois pedidos simultâneos e **10 tentativas de transcrição/dia UTC para o grupo**, incluindo falhas, com contador SQLite persistente. O teto não pode ser aumentado por ambiente; `VOICE_DAILY_LIMIT` permite diminuí-lo. É separado das 30 tentativas de texto.

Somente modelos identificados como `:free`, com suporte a áudio e preços declarados iguais a zero, são aceitos. A disponibilidade/gratuidade é conferida antes do envio. Não há fallback pago; sem modelo gratuito confirmado ou sem cota, use os botões ou `/tocar`. Não há TTS nem respostas faladas.

`VOICE_COMMANDS_ENABLED=false` é o padrão e mantém o recurso desligado. Ative explicitamente com `true` apenas quando a conta/provedor estiverem liberados e o teste de call for autorizado. Sem `OPENROUTER_API_KEY`, o recurso também fica indisponível. `VOICE_MODEL` indica o modelo gratuito de áudio e `VOICE_USAGE_DB_PATH` guarda apenas contadores, sem conteúdo de voz. O modelo gratuito pode ter fila/latência ou ficar indisponível. No teste isolado com áudio sintético desta versão, a conta atual retornou HTTP 402 exigindo saldo mínimo de US$ 0,50 para enviar áudio, apesar do modelo `:free`. Não foi adicionado saldo nem usado modelo pago. A verificação da conta gratuita ocorre antes de abrir a captura; essa conta permanece impedida de usar a voz. O módulo está preparado e testado localmente, mas a transcrição real ainda não foi validada com sucesso.

O [SDK de voz](https://discord.js.org/docs/packages/voice/stable) informa que a recepção não é documentada oficialmente pelo Discord e não garante estabilidade. Os testes locais verificam Opus real, isolamento por usuário, cancelamento, orçamento e despacho musical. A validação de captura numa call real continua necessária antes de habilitar em produção.

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
- **Espontâneo:** ligado por padrão, inclusive após a atualização para esta versão. Fala no geral **sem menção, mínimo de pessoas ou quantidade de mensagens**, mesmo quando o chat está parado. Intervalo aleatório de 2–5 minutos no discreto e 2–3 no mais participativo. Mantém apenas um envio pendente; respostas por menção reiniciam a espera. `/dam conversa` → **Só por menção** desliga, e a preferência é preservada nos próximos reinícios. O bot pode não enviar se o corpus não produzir uma frase disponível; falhas não geram loops rápidos.
- **Referências e brincadeiras:** o gerador prioriza palavras do assunto atual também presentes em mensagens de dias anteriores, permitindo recombinações entre épocas. Ocasionalmente transforma a frase em uma pergunta absurda, na mesma oportunidade de resposta. Sem novas chamadas à IA.
- **GIFs:** seleção local por palavras do contexto em 19 categorias (incluindo música/dança, comemoração, surpresa, tristeza, comida e filmes), com sorteio entre 42 reações e fallback aleatório, sem repetir as últimas oito. Em aproximadamente 17,5% das respostas (redução de 30% sobre os 25% anteriores), no máximo um junto da mensagem,
  sem temporizadores ou mensagens extras. O catálogo contém apenas URLs; o bot não baixa os arquivos nem consulta uma API para escolher GIFs durante a conversa. `MARKOV_MEDIA_CHANCE=0` desliga.

Comandos no geral:

- `@TheDam palavra` ou `/dam frase palavra:dragão`: gera uma frase para o grupo.
- `/dam perolas`: menu das favoritas; `/dam perola-da-semana`: melhor saldo de votos
  dos últimos sete dias, sob comando, sem publicação automática.
- 👍 guarda uma resposta; 👎 rejeita. Troca e remoção de voto atualizam o placar.
- `@TheDam nostalgia`: sorteia uma frase real com mais de 24 horas, dentro dos 30 dias de retenção. Não executa comandos musicais da lembrança.
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
MARKOV_MEDIA_CHANCE=0.175
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
aciona Jockie nem outros bots. Mensagens como `m!p` podem ser aprendidas como texto, mas não constituem integração com o Jockie: não há uma API pública documentada de controle entre bots. Mensagens de erro dessa brincadeira não são repetidas.

SQLite mantém até 5.000 mensagens por 30 dias, favoritas e rejeitadas (100 cada),
300 respostas geradas com votos e o contador diário da IA. Exclusões/edições recebidas,
inclusive em lote, atualizam o corpus. O histórico não é reimportado ao reiniciar.
A função `chat/history.ts` permite importar até 5.000 mensagens dos últimos 30 dias.

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
- Organização: `move {id,direction}` (`up`/`down`, usando queueId), `remove {id}` (queueId), `shuffle`, `deduplicate`, `repeat {enabled}`.
- Biblioteca: `playlists`, `favorites`, `history`, `favorite`, `status`.
- Remover de playlist: `playlist {id}` retorna a revisão; `playlistRemoveTrack {id,position,revision}` remove só se o menu ainda corresponder à lista atual.
- Salvar sem tocar: `playlistSearch {id,query,provider}` → tokens pessoais; `playlistAddTrack {id,token}` consome o resultado uma vez.
- Importação: `importPlaylist {query,name?,id?}` cria uma lista ou acrescenta à lista indicada, respeitando permissões e capacidade. A edição da biblioteca exige associação ao servidor, sem exigir call.
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
    catalog.ts               Busca, resolução e métricas YouTube/Spotify
    search-cache.ts          Cache em memória com TTL e limite
    recoverable-source.ts    Uma tentativa de recuperação e limpeza da fonte
    prepared-source.ts       Primeiro áudio em paralelo com conexão
    audio-location-cache.ts  Fontes HTTPS temporárias, privadas e limitadas
    resolved-source.ts       Resolução Spotify por faixa, com cancelamento
    playlist-interactions.ts Formulário, edição e remoção de faixas
    playlist-presentation.ts Lista, detalhes e remoção com revisão
    input-modals.ts          Formulários de música e biblioteca
    spotify-playlists.ts     Leitura paginada de listas Spotify autorizadas
    spotify-connect.ts       Autorização local do administrador
    audio-source.ts          yt-dlp → FFmpeg → Discord
    types.ts                 Contratos internos do módulo
  chat/                      Markov, fila de menções, atividade, mídia, votos e dados
  ai/
    contracts.ts             Portas de texto, fala e uso; erros normalizados
    models.ts                Seleção/composição dos adaptadores
    providers/               HTTP OpenAI/OpenRouter e áudio OpenRouter
    transport.ts             Formatos de requisição e resposta de texto
    reply-service.ts         Chance, cota, cooldown e resposta curta
    speech-service.ts        Validação PCM/WAV e cota de transcrição
    voice-usage-repository.ts Contadores SQLite persistentes
  lastfm/
    client.ts                API assinada, limites e timeout
    repository.ts            Sessões criptografadas e fila de scrobbles SQLite
    service.ts               Autorização pessoal, recomendações e reenvio
    metadata.ts              Identificação conservadora de artista/faixa
    scrobbler.ts              Tempo ouvido, consentimento e deduplicação
    interactions.ts          Painel privado no Discord
  voice/                     Captura da próxima fala, Opus, cancelamento e intenção
  shared/                    Erros de domínio e conversão PCM/WAV
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

O volume `markov_data` mantém `markov.sqlite`, `music.sqlite` e, quando habilitados, `voice.sqlite` e `lastfm.sqlite`. Faça backup antes de
atualizar. Publicar no GitHub não transfere esses bancos: uma VPS nova começa sem o
aprendizado e as listas locais. A fila ativa e o painel em memória não sobrevivem a
reinícios; as bibliotecas e preferências sim. Após reiniciar, use `/musica` para
publicar novamente os controles. Nunca rode `docker compose down -v` para atualizar.

Teste em uma call real: duas pessoas, escolha por nome/link, painel visível para todos,
listas e favoritas, pausa/próxima/parar, mover faixas, outra call impedida de controlar e participação automática mesmo sem novas mensagens. Os testes automatizados não publicam mensagens reais.

## Trocar o provedor de IA

O módulo `src/ai` concentra contratos, adaptadores HTTP, cotas e serviços. O Markov usa
`AiReplyService`; os comandos de voz dependem da interface `SpeechTranscriber`, sem conhecer
endpoints, SDKs ou formatos da API. Os repositórios recebem contratos mínimos de uso;
o contador de texto permanece na tabela existente, sem migrar ou zerar o orçamento.

Para trocar HTTP por SDK, implemente `TextModel.generate()` ou `SpeechModel.verify()` e
`transcribe(wav, signal)` em `src/ai/providers`, depois selecione o adaptador em `models.ts`.
Mantenha cancelamento, timeouts, política de custo e tradução para `AiRequestError` no
adaptador. Os serviços preservam chance, cooldown, tamanho de resposta, validação de áudio
e cota antes do envio. Testes injetam um adaptador em memória sem fazer chamadas externas.
Não há nova dependência de SDK nem modelo de IA carregado localmente.

## Relatório desta revisão local

Base publicada anterior: `71ea984`. Após autorização, a revisão foi aplicada ao **bot local**: imagem reconstruída, container reiniciado e comandos registrados no Amigos. Um backup consistente dos bancos foi criado no volume antes da atualização. A publicação no GitHub foi autorizada posteriormente. O bot local foi encerrado a pedido, com bancos e configurações preservados; a VPS não foi alterada.

1. **Acesso à música:** comandos curtos, sem duplicatas musicais em `/dam`, painel único
   compartilhado e confirmações/buscas privadas. A fila permite mover faixas e mantém
   permissões de quem está na call; menus privados reutilizam a mensagem.
2. **Playlists:** criar, importar, acrescentar músicas sem tocar, remover faixa com revisão
   contra menu antigo e excluir com confirmação. Atalho direto para tocar na call;
   permissões de criador/administrador preservadas. Importações atômicas de até 50 faixas.
3. **Spotify:** autorização local pelo navegador para playlists permitidas pela API,
   credencial persistida no `.env` privado e leitura paginada sem seguir hosts externos.
   Usa metadados; o áudio continua vindo do YouTube. A autorização real ainda é necessária.
4. **Início e estabilidade:** cache de busca, reutilização privada do formato extraído,
   preparação de áudio/conexão em paralelo, cancelamento e uma recuperação por faixa.
   A fila vazia aguarda um minuto na call e reaproveita a conexão se houver novo pedido.
5. **Markov:** aprendizado e respostas restritos ao geral do Amigos; menções entram no
   aprendizado com notificações neutralizadas. Mantidos 5.000 textos/30 dias, mistura
   contextual/nostalgia e limites de tamanho. Participação sem menção continua com espera
   espaçada; o intervalo não vira resposta a cada mensagem. Catálogo de GIFs mantido e
   chance padrão reduzida de 25% para 17,5% (30% a menos); o ambiente do processo atual não
   foi recarregado. URLs aprendidas no texto podem exibir embeds independentemente disso.
6. **IA modular:** portas e adaptadores de texto/fala separados das regras de conversa e
   música. Preservados orçamento persistente, modelos gratuitos OpenRouter e fallback para
   Markov quando a IA falha. Não há fallback de voz para modelo pago.
7. **Voz opcional:** botão captura só a próxima fala de quem pediu, com cancelamento,
   limites e encaminhamento à fila existente. Desligada por padrão. O teste sintético real
   retornou HTTP 402 por exigência de saldo mínimo; nenhuma transcrição real bem-sucedida
   ou captura em call foi validada. Nenhum saldo foi adicionado.
8. **Last.fm:** vínculo individual, perfil, sugestões musicais/artistas e scrobbling com
   tempo ouvido, consentimento, sessão criptografada e reenvio limitado. API simulada nos
   testes; chaves e autorização pessoal pendentes para validação externa.
9. **Organização:** monólito modular TypeScript, responsabilidades por pasta, SQL em
   repositórios e composição em `index.ts`. Nenhuma dependência nova nesta finalização.

**Medição isolada de início:** mesma faixa YouTube, mesma imagem de ferramentas e primeira
porção PCM, sem login Discord ou uso do ambiente de produção. Antes: 4.795 ms de metadados +
8.065 ms de áudio = **12.860 ms**. Caminho novo sem cache: 5.964 + 476 = **6.441 ms**; repetição
com cache: **323 ms** no total. É uma execução por cenário: depende de rede, YouTube e fonte,
não inclui a conexão Discord nem comprova comparação com outros bots. O objetivo verificado
é eliminar a extração duplicada quando o formato já está disponível.

**Validação concluída:** **126 testes passaram**, sem falhas ou testes ignorados.
`npm run typecheck`, `npm run build`, `npm run format:check`, `git diff --check` e
verificação dos arquivos alterados contra credenciais locais passaram. O build Docker
foi aprovado na imagem isolada `thedam-bot:local-validation`, sem iniciar containers
ou substituir a imagem do serviço em execução. Os testes não registram slash commands nem enviam mensagens
ao Discord. Após uma implantação futuramente autorizada, ainda devem ser conferidos em call:
visibilidade para dois usuários, controle da fila, saída após um minuto, importação Spotify
autorizada e scrobbles Last.fm pessoais. A voz exige resolver a limitação da conta antes de
qualquer ativação. A atualização local foi autorizada e aplicada posteriormente; a validação externa de Spotify/Last.fm e a ativação de voz continuam pendentes.
