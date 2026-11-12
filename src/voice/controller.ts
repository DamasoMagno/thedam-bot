import type { PlayerService } from '../music/player-service.ts';
import type { SpeechTranscriber } from '../ai/contracts.ts';
import { parseVoiceIntent } from './intent.ts';
import { MusicError } from '../shared/music-error.ts';
type VoiceUpdate = (message: string, cancellable: boolean) => Promise<unknown>;
interface Request {
  guild: string;
  user: string;
  controller: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  release?: () => void;
  update: VoiceUpdate;
  busy: boolean;
  committing: boolean;
}
export class VoiceController {
  private service: PlayerService;
  private transcriber: SpeechTranscriber;
  private requests = new Map<string, Request>();
  private closed = false;
  private unsubscribe: () => void;
  constructor(service: PlayerService, transcriber: SpeechTranscriber) {
    this.service = service;
    this.transcriber = transcriber;
    this.unsubscribe = service.onChange((guild, state) => {
      if (!state.channelId)
        for (const request of [...this.requests.values()])
          if (request.guild === guild && request.release) {
            this.finish(request);
            void request
              .update(
                'A conexão da call foi encerrada. Comando por voz cancelado.',
                false,
              )
              .catch(() => {});
          }
    });
  }
  async begin(guild: string, user: string, update: VoiceUpdate) {
    if (this.closed || this.requests.has(user))
      throw new MusicError(409, 'Você já tem um comando por voz em andamento.');
    if (this.requests.size >= 2)
      throw new MusicError(
        429,
        'Há dois comandos por voz em andamento. Tente em instantes.',
      );
    const request: Request = {
      guild,
      user,
      update,
      controller: new AbortController(),
      busy: false,
      committing: false,
    };
    this.requests.set(user, request);
    try {
      await update('Preparando escuta opcional. Verificando o modelo gratuito…', true);
      await this.service.run(guild, user, 'state');
      request.controller.signal.throwIfAborted();
      await this.transcriber.verify(request.controller.signal);
      request.controller.signal.throwIfAborted();
      request.release = await this.service.listen(guild, user, (pcm) => {
        void this.process(request, pcm);
      });
      if (request.controller.signal.aborted) {
        request.release();
        return;
      }
      request.timer = setTimeout(() => {
        this.finish(request);
        void update(
          'Não ouvi um comando. Clique em Comando por voz para tentar novamente.',
          false,
        ).catch(() => {});
      }, 20000);
      request.timer.unref();
      await update(
        'Vou ouvir apenas sua próxima fala. Diga “TheDam, tocar nome da música” (até 8 segundos). A janela fecha em 20 segundos.',
        true,
      );
    } catch (error) {
      const cancelled = request.controller.signal.aborted;
      this.finish(request);
      if (!cancelled) throw error;
    }
  }
  private async process(request: Request, pcm: Buffer) {
    if (request.busy || this.requests.get(request.user) !== request) return;
    request.busy = true;
    clearTimeout(request.timer);
    try {
      await request.update('Escuta encerrada. Interpretando seu comando…', true);
      const transcript = await this.transcriber.transcribe(
        pcm,
        request.controller.signal,
      );
      request.controller.signal.throwIfAborted();
      const intent = parseVoiceIntent(transcript);
      if (!intent)
        throw new MusicError(
          400,
          'Não reconheci um pedido. Tente “TheDam, tocar Queen”, “TheDam, pausar”, “continuar” ou “pular”.',
        );
      if (intent.action === 'play') {
        await request.update('Comando reconhecido. Buscando a música…', true);
        const result = await this.service.run(request.guild, request.user, 'search', {
          query: intent.query,
          provider: 'youtube',
        });
        request.controller.signal.throwIfAborted();
        const track = result.tracks?.[0];
        if (!track)
          throw new MusicError(
            404,
            'Não encontrei a música. Tente outro nome ou use /tocar.',
          );
        request.committing = true;
        await request.update('Preparando a música para a call…', false);
        await this.service.run(request.guild, request.user, 'enqueue', {
          token: track.token,
        });
        await request.update(
          'Música adicionada à fila. Use o painel para controlar a reprodução.',
          false,
        );
      } else if (intent.action === 'playlist') {
        const lists = await this.service.run(request.guild, request.user, 'playlists');
        request.controller.signal.throwIfAborted();
        const normalize = (value: string) =>
          value
            .normalize('NFD')
            .replace(/\p{M}/gu, '')
            .toLocaleLowerCase('pt-BR')
            .trim();
        const found =
          lists.playlists?.filter(
            (list) => normalize(list.name) === normalize(intent.name),
          ) || [];
        if (found.length !== 1)
          throw new MusicError(
            404,
            'Não encontrei essa playlist. Confira o nome em /playlists.',
          );
        request.committing = true;
        await request.update('Preparando a playlist para a call…', false);
        await this.service.run(request.guild, request.user, 'playlistEnqueue', {
          id: found[0].id,
        });
        await request.update('Playlist adicionada à fila da call.', false);
      } else {
        const state = await this.service.run(request.guild, request.user, 'state');
        request.controller.signal.throwIfAborted();
        if (!state.current) throw new MusicError(409, 'Nenhuma música está tocando.');
        request.committing = true;
        await this.service.run(request.guild, request.user, intent.action);
        await request.update(
          intent.action === 'pause'
            ? 'Música pausada.'
            : intent.action === 'resume'
              ? 'Reprodução retomada.'
              : 'Próxima música.',
          false,
        );
      }
    } catch (error) {
      if (!request.controller.signal.aborted)
        await request
          .update(
            error instanceof MusicError
              ? error.message
              : 'Não foi possível interpretar a voz agora. Use /tocar ou os botões.',
            false,
          )
          .catch(() => {});
    } finally {
      this.finish(request);
    }
  }
  cancel(user: string) {
    const request = this.requests.get(user);
    if (!request) return;
    if (request.committing)
      throw new MusicError(
        409,
        'O pedido já está sendo aplicado à fila. Use os controles de música.',
      );
    this.finish(request);
  }
  private finish(request: Request) {
    if (this.requests.get(request.user) !== request) return;
    this.requests.delete(request.user);
    clearTimeout(request.timer);
    request.controller.abort();
    request.release?.();
  }
  close() {
    this.closed = true;
    for (const request of [...this.requests.values()]) this.finish(request);
    this.unsubscribe();
  }
}
