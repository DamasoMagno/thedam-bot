export interface TextModel {
  generate(input: string): Promise<string | null>;
}
export interface SpeechModel {
  verify(signal?: AbortSignal): Promise<void>;
  transcribe(wav: Buffer, signal: AbortSignal): Promise<string>;
}
export interface SpeechTranscriber {
  verify(signal?: AbortSignal): Promise<void>;
  transcribe(pcm: Buffer, signal: AbortSignal): Promise<string>;
}
export interface TextUsage {
  claimAiRequest(day: string, limit: number): boolean;
}
export interface SpeechUsage {
  claim(limit: number): boolean;
  remaining(limit: number): number;
}
export class AiRequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
