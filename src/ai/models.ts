import { HttpTextModel } from './providers/http-text-model.ts';
import { OpenRouterSpeechModel } from './providers/openrouter-speech-model.ts';
import type { TextModel, SpeechModel } from './contracts.ts';
import type { AiProvider } from './transport.ts';
export function createTextModel(
  config: { key: string; model: string; provider?: AiProvider },
  fetchImpl = fetch,
): TextModel {
  return new HttpTextModel(config, fetchImpl);
}
export function createSpeechModel(
  config: { key: string; model: string },
  fetchImpl = fetch,
): SpeechModel {
  return new OpenRouterSpeechModel({ ...config, fetchImpl });
}
