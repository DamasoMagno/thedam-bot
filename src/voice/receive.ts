import { createRequire } from 'node:module';
import { EndBehaviorType, type VoiceReceiver } from '@discordjs/voice';
const require = createRequire(import.meta.url);
// O decodificador só é carregado quando a pessoa solicita um comando por voz.
export function receiveNextSpeech(
  receiver: VoiceReceiver,
  user: string,
  onAudio: (pcm: Buffer) => void,
) {
  let closed = false;
  let capture: (() => void) | undefined;
  function dispose() {
    if (closed) return;
    closed = true;
    receiver.speaking.off('start', start);
    capture?.();
  }
  function start(speaker: string) {
    if (closed || capture || speaker !== user) return;
    const decoder = (() => {
      try {
        const OpusScript = require('opusscript') as {
          new (
            rate: number,
            channels: number,
            application: number,
          ): { decode(packet: Buffer): Buffer; delete(): void };
          Application: { AUDIO: number };
        };
        return new OpusScript(48000, 2, OpusScript.Application.AUDIO);
      } catch {
        return null;
      }
    })();
    if (!decoder) {
      dispose();
      return;
    }
    let input: ReturnType<VoiceReceiver['subscribe']>;
    try {
      input = receiver.subscribe(user, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: 800 },
      });
    } catch {
      decoder.delete();
      dispose();
      return;
    }
    const chunks: Buffer[] = [];
    let length = 0,
      finished = false;
    const finish = (send: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      input.destroy();
      decoder.delete();
      dispose();
      if (send && length >= 76800) onAudio(Buffer.concat(chunks, length));
    };
    const timeout = setTimeout(() => finish(true), 8000);
    timeout.unref();
    capture = () => finish(false);
    input.on('data', (packet: Buffer) => {
      try {
        const decoded = Buffer.from(decoder.decode(packet));
        const chunk = decoded.subarray(0, Math.max(0, 1536000 - length));
        chunks.push(chunk);
        length += chunk.length;
        if (length >= 1536000) finish(true);
      } catch {
        finish(false);
      }
    });
    input.once('end', () => finish(true));
    input.once('error', () => finish(false));
    input.once('close', () => finish(false));
  }
  receiver.speaking.on('start', start);
  return dispose;
}
