import test from 'node:test';
import assert from 'node:assert/strict';
import { AiReplyService } from '../src/ai/reply-service.ts';
import { VoiceTranscriber } from '../src/ai/speech-service.ts';
test('modelo de texto pode ser trocado sem HTTP e preserva cota e limite de resposta', async () => {
  let claims = 0;
  const service = new AiReplyService(
    { key: 'test', model: 'custom', chance: 1, dailyLimit: 1 },
    { claimAiRequest: () => ++claims <= 1 },
    assert.fail,
    () => 0,
    Date.now,
    { generate: async () => 'x'.repeat(300) },
  );
  assert.equal((await service.maybeReply('contexto')).length, 158);
  assert.equal(await service.maybeReply('contexto'), null);
  assert.equal(claims, 2);
});
test('adaptador de fala recebe WAV depois da validação e da cota', async () => {
  let remaining = 1,
    received;
  const transcriber = new VoiceTranscriber({
    key: 'test',
    model: 'custom',
    usage: { remaining: () => remaining, claim: () => Boolean(remaining--) },
    fetchImpl: assert.fail,
    adapter: {
      verify: async () => {},
      transcribe: async (wav) => {
        received = wav;
        return 'TheDam tocar Queen';
      },
    },
  });
  const signal = new AbortController().signal;
  assert.equal(
    await transcriber.transcribe(Buffer.alloc(96000), signal),
    'TheDam tocar Queen',
  );
  assert.equal(received.toString('ascii', 0, 4), 'RIFF');
  await assert.rejects(transcriber.transcribe(Buffer.alloc(96000), signal), /cota/);
});
