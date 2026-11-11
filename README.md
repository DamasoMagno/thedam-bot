# Coffee Music Bot

Bot separado do Coffee Live. O site busca músicas no YouTube ou Spotify e controla uma
fila que toca **na call de voz do Discord**. Nenhum áudio passa pelo navegador ou LiveKit.

## Fluxo

1. Usuário entra no Coffee Live com Discord e permanece em uma call do mesmo servidor.
2. Abre **Músicas**, escolhe YouTube/Spotify e busca nome, artista ou link de uma faixa.
3. Seleciona **Adicionar**. O backend valida sessão, CSRF, presença na sala e associação
   ao servidor. Envia apenas a identidade autenticada à API privada deste projeto.
4. O bot verifica a call do usuário, conecta e toca. Pausar, continuar, próxima e encerrar
   ficam no painel. Uma fila por servidor; outra call não pode assumir uma fila ativa.

**Spotify fornece metadados, não o áudio completo.** Uma faixa do Spotify é procurada
no YouTube; a versão encontrada pode diferir. A fila mostra o título realmente reproduzido.
Não há integração com Jockie. Este é um bot próprio, independente.

## Instalar no Discord

No [Developer Portal](https://discord.com/developers/applications), crie uma aplicação
(ou adicione um bot à aplicação de vocês), gere o token em **Bot** e copie para `.env`.
Não coloque o token no site, no frontend ou no Git. Não são necessários intents de
conteúdo de mensagens nem presença. Usamos apenas `Guilds` e `GuildVoiceStates`.

Convide com escopos **bot** e **applications.commands** e permissões **View Channels**, **Connect**, **Speak**.
Exemplo, substituindo o ID da aplicação:

```text
https://discord.com/oauth2/authorize?client_id=SEU_APPLICATION_ID&scope=bot%20applications.commands&permissions=3146752
```

O bot só envia música, fica ensurdecido (`selfDeaf`) e não recebe voz dos participantes.
A biblioteca de voz inclui suporte ao protocolo DAVE do Discord.

## Rodar com Docker

```sh
cp .env.example .env
openssl rand -hex 32
# Preencha DISCORD_BOT_TOKEN e MUSIC_SHARED_SECRET com o segredo gerado.
docker compose up --build -d
```

O Docker instala Node, FFmpeg e yt-dlp com suas dependências de JavaScript. Não precisa
Java/Lavalink nem banco. A API publica somente `127.0.0.1:3031` e requer o segredo em
todas as rotas. **Não abra 3031 no firewall da VPS.** O bot precisa de saída HTTPS e UDP
para os servidores de voz do Discord.

Para Spotify, configure também `SPOTIFY_CLIENT_ID` e `SPOTIFY_CLIENT_SECRET`, obtidos
no [painel Spotify](https://developer.spotify.com/dashboard). Sem eles, YouTube continua
funcionando e a busca Spotify informa que falta configuração.

## Conectar ao site existente

Suba o bot primeiro; ele cria a rede privada Docker `coffee-music`. Na pasta do site,
preencha seu `.env`:

```dotenv
MUSIC_BOT_URL=http://music-bot:3031
MUSIC_SHARED_SECRET=mesmo-segredo-de-64-caracteres-do-bot
```

Na VPS já existente, recrie **somente o app** com o complemento de rede:

```sh
cd ../discord-cam
sudo docker compose -p dc-cam -f compose.production.yml -f compose.music.yml config --quiet
sudo docker compose -p dc-cam -f compose.production.yml -f compose.music.yml up --build -d --wait app
```

O complemento mantém a rede padrão do app e acrescenta a rede do bot. Não inicia outro
LiveKit/Caddy. Use esses dois arquivos também nas próximas atualizações do site.
No Compose de desenvolvimento, combine `docker-compose.yml` com `compose.music.yml`.
Com as duas variáveis vazias no site, o botão Músicas fica desativado/oculto.

## Desenvolvimento local sem Docker

Requisitos: Node >=22.13, FFmpeg no PATH, Python >=3.10 e yt-dlp atual com suporte a Node.

```sh
npm ci
python3 -m venv .venv
.venv/bin/pip install 'yt-dlp[default]'
cp .env.example .env
# Preencha token e segredo; configure YTDLP_PATH para o caminho absoluto de .venv/bin/yt-dlp.
npm start
```

O site executado fora de Docker usa `MUSIC_BOT_URL=http://127.0.0.1:3031`.
A configuração é obrigatória antes de iniciar; não há token fictício nem login alternativo.

## API privada

Todas as chamadas usam `Authorization: Bearer MUSIC_SHARED_SECRET`. Rotas:

- `GET /health`: prontidão da conexão Discord.
- `POST /v1/guilds/:guildId/search`: `{userId, provider: "youtube"|"spotify", query}`.
- `POST /v1/guilds/:guildId/enqueue`: `{userId, token}`; token da busca, válido por 10 minutos.
- `POST /v1/guilds/:guildId/state|pause|resume|skip|stop`: `{userId}`.

O segredo fica entre backends. O navegador nunca o recebe. O bot resolve o canal pelo
estado de voz do Discord; não aceita um canal informado livremente pelo usuário.
Resultados da busca são vinculados a servidor e usuário e não podem ser forjados ou
reutilizados. Apenas links YouTube/Spotify de faixas individuais são aceitos; não há
fetch arbitrário para endereços locais. Comandos não usam shell. Há limites de pedido,
fila e tempo de busca. Não há recebimento de microfone, arquivo persistido ou banco.

## Testar

```sh
npm test
npm run format:check
```

Os testes não usam credenciais nem entram em calls. Para validar de ponta a ponta,
convide o bot, entre na call, abra o site e teste busca, adicionar duas músicas, pausar,
continuar e próxima. Teste outra pessoa na mesma call e outra em call diferente.
Ao encerrar ou terminar a fila, a conexão e os processos de áudio são liberados.
Ao ficar sem ouvintes por `EMPTY_TIMEOUT_MS` (60 s), o bot limpa a fila e sai.

A reprodução depende da disponibilidade do YouTube e do extrator. Em caso de mudança
na plataforma, atualize/reconstrua o bot; não é necessário alterar o LiveKit.

## Estrutura

```text
src/
  index.js             Composição, login e encerramento
  config.js            Variáveis de ambiente
  http.js              API privada e limites
  catalog.js           Busca YouTube/Spotify e seleção de áudio
  discord-gateway.js   Autorização por call e conexão de voz
  player-service.js    Fila, concorrência por servidor e limpeza
  music-commands.js    Comandos slash de música, sem depender do Markov
  audio-source.js      Pipeline yt-dlp → FFmpeg → Discord
 test/                 Testes sem credenciais
```

## Markov: conversa leve no geral

O módulo aprende **somente** no canal `🎄┃geral` (`1379585304029171805`) do servidor
Amigos (`1379585303295299714`). Não importa histórico automaticamente ao reiniciar nem aprende
com bots, comandos, imagens ou outros canais. As respostas são apenas texto.

No Developer Portal → Bot → Privileged Gateway Intents, ative **Message Content Intent**.
Também permita ao bot ver/enviar mensagens e ler histórico de mensagens no geral.
Configure `MARKOV_ENABLED=true` e `MARKOV_CHANNEL_ID=1379585304029171805` no `.env`,
e reinicie com `docker compose up --build -d`. Sem a intent, o Markov se desativa com
aviso, preservando o serviço de música. Não é necessário dar Administrador ao bot.

Comandos no próprio geral:

- `@bot ajuda`: instruções.
- `@bot dragão`: tenta criar uma frase usando essa palavra como ponto de partida.
- `@bot pérolas`: recupera uma frase favorita.
- Reagir com 👍 a uma frase do bot guarda nos favoritos; 👎 remove e evita repeti-la.
- `@bot frequentes`: mostra nomes recorrentes **sem notificar ninguém**. Considera os
  cinco autores com mais mensagens no corpus, com pelo menos cinco mensagens.
- Administradores com Gerenciar Servidor: `@bot caos on/off`, `@bot automatico on/off/sempre`
  e `@bot esquecer` (apaga mensagens, favoritos e preferências).

O padrão é responder somente por menção, com no máximo uma resposta a cada 15 segundos.
O automático é opcional: 1% das mensagens elegíveis, com intervalo mínimo de cinco minutos.
Com `@bot automatico sempre`, tenta responder a cada mensagem válida, sem sorteio nem
intervalo de cinco minutos; `@bot automatico off` desliga. Esse modo mantém os filtros,
não responde a bots e não executa comandos escritos sem menção.
Não exige quantidade mínima de mensagens nem tamanho mínimo de texto. Recusa copiar
uma mensagem original inteira. Enquanto não há combinações novas, responde que ainda
está aprendendo no modo sempre. Mensagens vazias e conteúdo filtrado são ignorados.
O modo caos usa combinações de uma palavra; o padrão usa duas para maior coerência.

Não há LLM, API de IA, GPU ou processamento de imagens. SQLite local mantém até 2.000
mensagens, descarta mensagens com mais de 30 dias ao aprender e limita favoritos/rejeitadas
a cem cada. O volume `markov_data` persiste após reiniciar o container. Apagar ou editar
uma mensagem remove/atualiza sua contribuição quando o evento chega ao bot.

Padrões comuns de segredos, emails, telefones, links e menções são descartados antes de
armazenar. Esse filtro não consegue identificar todo conteúdo sensível: não publiquem
segredos no geral. O texto não sai da hospedagem do bot. Todas as respostas usam
`allowedMentions: {parse: [], repliedUser: false}`: não notificam everyone, here, cargos
ou pessoas. A listagem de frequentes usa nomes, sem pings. Nenhuma música toca sozinha.

## Restrição da música

Música só funciona no servidor Amigos (`1379585303295299714`). O frontend esconde o
botão nos outros servidores; backend e bot rejeitam qualquer ação para outro servidor,
inclusive uma requisição manual. O bot pode estar instalado em outros servidores,
mas não reproduz música neles.

## Música pelo chat do Discord

No servidor **Amigos**, entre em uma call e use:

- `/tocar musica:nome ou link` — busca e adiciona o primeiro resultado à reprodução.
  Para escolher uma versão exata, envie o link do YouTube ou Spotify.
- `/fila` — música atual e próximas (mostra até dez).
- `/pausar`, `/continuar`, `/pular`, `/parar` — controles da call.

Os comandos são registrados somente no Amigos ao iniciar. Não dependem de Message
Content Intent nem de Markov. Respostas são privadas para quem executou, sem pings.
Site e chat compartilham a mesma fila e as mesmas verificações de call. Quem estiver
em outra call não pode controlar a fila ativa. Links Spotify dependem das credenciais
Spotify configuradas. Há limite de uma ação por pessoa a cada três segundos.
Se os comandos não aparecerem, confira o escopo `applications.commands` na instalação.

## Melhorar o aprendizado do Markov

É possível importar, por manutenção, até 2.000 mensagens válidas dos últimos 30 dias
exclusivamente do geral do Amigos usando `importGeneralHistory` em `src/chat/history.js`.
A importação exige permissão de ler o histórico, preserva as datas e não envia respostas.
Ignora bots, menções e conteúdo sensível. Repetições de palavras são permitidas. Reiniciar não reimporta.
O gerador deduplica textos para evitar que mensagens idênticas dominem o aprendizado,
evita repetir as respostas recentes, mas permite combinações repetitivas e sem sentido.
O aprendizado já armazenado é preservado.

## Temporizador discreto do Markov

Um administrador pode usar `@bot automatico temporizador` para substituir as respostas
por mensagem por uma fala espontânea, no máximo a cada cinco minutos. Só funciona
quando alguém escreveu texto válido no geral nos últimos dez minutos; bots, imagens,
mensagens filtradas e a própria fala do bot não renovam a atividade. Não fala ao iniciar
nem imediatamente após outra resposta, não notifica membros e não envia aviso de
aprendizado pelo temporizador. `@bot automatico off` desliga. O estado fica salvo.
