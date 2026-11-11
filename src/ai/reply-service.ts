import { buildAiRequest, extractAiText } from './transport.ts';
import { normalizeText } from '../chat/model.ts';
import type { ChatStore } from '../chat/store.ts';
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
    privateStore: ChatStore,
    privateFetch: typeof fetch = fetch,
    privateRandom: () => number = Math.random,
    privateNow: () => number = Date.now,
  ) {
    this.config = privateConfig;
    this.store = privateStore;
    this.fetch = privateFetch;
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
  private store: ChatStore;
  private fetch: typeof fetch;
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
      const request = buildAiRequest(
        this.config,
        JSON.stringify({
          contexto: normalizeText(context)?.slice(-500) || 'Conversa de amigos',
          estilo: ['humor absurdo', 'pergunta inesperada', 'observação divertida'][
            Math.floor(this.random() * 3)
          ],
        }),
      );
      if (!request) {
        this.lastStatus = 'modelo pago bloqueado';
        return null;
      }
      const response = await this.fetch(request.url, {
        ...request.options,
        signal: AbortSignal.timeout(
          this.config.provider === 'openrouter' ? 10000 : 6000,
        ),
      });
      if (!response.ok) {
        this.lastStatus = [402, 429].includes(response.status)
          ? 'limite ou saldo da API'
          : response.status === 401
            ? 'chave inválida'
            : 'API indisponível';
        this.blockedUntil = this.now() + 15 * 60000;
        return null;
      }
      const text = normalizeText(
        extractAiText(this.config.provider || 'openai', await response.json()),
      );
      if (!text) return null;
      this.lastStatus = 'pronto';
      return text.length <= 160 ? text : text.slice(0, 157).trimEnd() + '…';
    } catch {
      this.lastStatus = 'API indisponível';
      this.blockedUntil = this.now() + 60000;
      return null;
    } finally {
      this.busy = false;
    }
  }
}
