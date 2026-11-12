import { createTextModel } from './models.ts';
import { AiRequestError } from './contracts.ts';
import type { TextModel, TextUsage } from './contracts.ts';
import { normalizeText } from '../chat/model.ts';
export class AiReplyService {
  private blockedUntil = 0;
  private busy = false;
  private lastStatus = 'aguardando primeira tentativa';
  constructor(
    privateConfig: {
      key: string;
      model: string;
      chance: number;
      dailyLimit: number;
      provider?: 'openai' | 'openrouter';
    },
    privateStore: TextUsage,
    privateFetch: typeof fetch = fetch,
    privateRandom: () => number = Math.random,
    privateNow: () => number = Date.now,
    model?: TextModel,
  ) {
    this.config = privateConfig;
    this.store = privateStore;
    this.model = model || createTextModel(privateConfig, privateFetch);
    this.random = privateRandom;
    this.now = privateNow;
  }
  private config: {
    key: string;
    model: string;
    chance: number;
    dailyLimit: number;
    provider?: 'openai' | 'openrouter';
  };
  private store: TextUsage;
  private model: TextModel;
  private random: () => number;
  private now: () => number;
  status() {
    return {
      enabled: Boolean(this.config.key),
      status: this.lastStatus,
      provider: this.config.provider || 'openai',
      model: this.config.model,
    };
  }
  async maybeReply(context: string): Promise<string | null> {
    if (
      !this.config.key ||
      this.busy ||
      this.now() < this.blockedUntil ||
      this.random() >= this.config.chance
    )
      return null;
    if (
      !this.store.claimAiRequest(
        new Date(this.now()).toISOString().slice(0, 10),
        this.config.provider === 'openrouter'
          ? Math.min(30, this.config.dailyLimit)
          : this.config.dailyLimit,
      )
    ) {
      this.lastStatus = 'limite diário atingido';
      return null;
    }
    this.busy = true;
    try {
      const text = normalizeText(
        await this.model.generate(
          JSON.stringify({
            contexto: normalizeText(context)?.slice(-500) || 'Conversa de amigos',
            estilo: ['humor absurdo', 'pergunta inesperada', 'observação divertida'][
              Math.floor(this.random() * 3)
            ],
          }),
        ),
      );
      if (!text) return null;
      this.lastStatus = 'pronto';
      return text.length <= 160 ? text : text.slice(0, 157).trimEnd() + '…';
    } catch (error) {
      this.lastStatus =
        error instanceof AiRequestError
          ? error.status === 0
            ? error.message
            : [402, 429].includes(error.status)
              ? 'limite ou saldo da API'
              : error.status === 401
                ? 'chave inválida'
                : 'API indisponível'
          : 'API indisponível';
      this.blockedUntil =
        this.now() +
        (error instanceof AiRequestError
          ? error.status === 0
            ? 0
            : 15 * 60000
          : 60000);
      return null;
    } finally {
      this.busy = false;
    }
  }
}
