import { MusicError } from '../shared/music-error.ts';
import { pcmToWav } from '../shared/audio.ts';
import { createSpeechModel } from './models.ts';
import { AiRequestError } from './contracts.ts';
import type { SpeechModel, SpeechUsage, SpeechTranscriber } from './contracts.ts';
export class VoiceTranscriber implements SpeechTranscriber {
  private model: SpeechModel;
  private usage: SpeechUsage;
  private dailyLimit: number;
  constructor(options: {
    key: string;
    model: string;
    usage: SpeechUsage;
    dailyLimit?: number;
    fetchImpl?: typeof fetch;
    adapter?: SpeechModel;
  }) {
    this.model = options.adapter || createSpeechModel(options, options.fetchImpl);
    this.usage = options.usage;
    this.dailyLimit = Math.max(0, Math.min(10, Math.floor(options.dailyLimit ?? 10)));
  }
  async verify(signal?: AbortSignal) {
    if (!this.usage.remaining(this.dailyLimit))
      throw new MusicError(429, 'A cota gratuita de voz de hoje acabou. Use /tocar.');
    try {
      await this.model.verify(signal);
    } catch (error) {
      throw this.translate(error);
    }
  }
  async transcribe(pcm: Buffer, signal: AbortSignal) {
    if (pcm.length < 76800 || pcm.length > 1536000 || pcm.length % 4)
      throw new MusicError(400, 'Fale um comando curto, com até oito segundos.');
    await this.verify(signal);
    signal.throwIfAborted();
    if (!this.usage.claim(this.dailyLimit))
      throw new MusicError(429, 'A cota gratuita de voz de hoje acabou. Use /tocar.');
    try {
      return await this.model.transcribe(pcmToWav(pcm), signal);
    } catch (error) {
      throw this.translate(error);
    }
  }
  private translate(error: unknown) {
    return error instanceof AiRequestError
      ? new MusicError(error.status, error.message)
      : error;
  }
}
