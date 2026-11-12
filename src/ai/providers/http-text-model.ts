import { buildAiRequest, extractAiText } from '../transport.ts';
import type { AiProvider } from '../transport.ts';
import { AiRequestError } from '../contracts.ts';
import type { TextModel } from '../contracts.ts';
export class HttpTextModel implements TextModel {
  private config: { key: string; model: string; provider?: AiProvider };
  private fetch: typeof fetch;
  constructor(
    config: { key: string; model: string; provider?: AiProvider },
    fetchImpl = fetch,
  ) {
    this.config = config;
    this.fetch = fetchImpl;
  }
  async generate(input: string) {
    const request = buildAiRequest(this.config, input);
    if (!request) throw new AiRequestError(0, 'modelo pago bloqueado');
    const response = await this.fetch(request.url, {
      ...request.options,
      signal: AbortSignal.timeout(this.config.provider === 'openrouter' ? 10000 : 6000),
    });
    if (!response.ok) throw new AiRequestError(response.status, 'API indisponível');
    return extractAiText(this.config.provider || 'openai', await response.json());
  }
}
