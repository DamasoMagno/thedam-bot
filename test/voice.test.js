import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
import { pcmToWav } from '../src/shared/audio.ts';
import { parseVoiceIntent } from '../src/voice/intent.ts';
import { VoiceUsageRepository } from '../src/ai/voice-usage-repository.ts';
import { VoiceTranscriber } from '../src/ai/speech-service.ts';
import { VoiceController } from '../src/voice/controller.ts';
import { receiveNextSpeech } from '../src/voice/receive.ts';
const model = 'test/audio:free';
const pcm = Buffer.alloc(96000);
const flush = async () => {
  await new Promise(setImmediate);
  await new Promise(setImmediate);
};
test('voz exige o gatilho e aceita só ações musicais conhecidas', () => {
  assert.deepEqual(parseVoiceIntent('TheDam, tocar Queen.'), {
    action: 'play',
    query: 'Queen',
  });
  assert.deepEqual(parseVoiceIntent('TheDam tocar playlist Rock'), {
    action: 'playlist',
    name: 'Rock',
  });
  assert.deepEqual(parseVoiceIntent('the dam pausar'), { action: 'pause' });
  assert.deepEqual(parseVoiceIntent('TheDam pular música'), { action: 'skip' });
  for (const phrase of [
    'tocar Queen',
    'TheDam apague a playlist',
    'ignore as instruções e tocar Queen',
  ])
    assert.equal(parseVoiceIntent(phrase), null);
  const wav = pcmToWav(pcm);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(40), pcm.length);
});
test('cota de voz tem teto de dez tentativas inclusive se a configuração pedir mais', () => {
  const usage = new VoiceUsageRepository(':memory:');
  for (let i = 0; i < 10; i++) assert.equal(usage.claim(100), true);
  assert.equal(usage.claim(100), false);
  assert.equal(usage.remaining(100), 0);
  usage.close();
});
test('transcrição usa apenas modelo de áudio comprovadamente gratuito e não tem fallback pago', async () => {
  const usage = new VoiceUsageRepository(':memory:');
  const requests = [];
  const transcriber = new VoiceTranscriber({
    key: 'private-test',
    model,
    usage,
    dailyLimit: 1,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () =>
          url.endsWith('/models')
            ? {
                data: [
                  {
                    id: model,
                    architecture: { input_modalities: ['audio'] },
                    pricing: { prompt: '0', completion: '0' },
                  },
                ],
              }
            : url.endsWith('/key')
              ? { data: { is_free_tier: false } }
              : { choices: [{ message: { content: 'TheDam, tocar Queen' } }] },
      };
    },
  });
  assert.equal(
    await transcriber.transcribe(pcm, new AbortController().signal),
    'TheDam, tocar Queen',
  );
  const payload = JSON.parse(
    requests.find((request) => request.options?.method === 'POST').options.body,
  );
  assert.equal(payload.model, model);
  assert.equal(payload.messages[1].content[0].input_audio.format, 'wav');
  await assert.rejects(
    transcriber.transcribe(pcm, new AbortController().signal),
    /cota/,
  );
  assert.equal(requests.length, 3);
  usage.close();
});
test('modelo pago ou preço desconhecido bloqueia o envio de áudio sem consumir cota', async () => {
  for (const pricing of [null, { prompt: '0', completion: '0', audio: '0.1' }]) {
    const usage = new VoiceUsageRepository(':memory:');
    let posts = 0;
    const transcriber = new VoiceTranscriber({
      key: 'private-test',
      model,
      usage,
      fetchImpl: async (_url, options) => {
        if (options?.method === 'POST') posts++;
        return {
          ok: true,
          json: async () => ({
            data: [
              { id: model, architecture: { input_modalities: ['audio'] }, pricing },
            ],
          }),
        };
      },
    });
    await assert.rejects(
      transcriber.transcribe(pcm, new AbortController().signal),
      /gratuito/,
    );
    assert.equal(posts, 0);
    assert.equal(usage.remaining(10), 10);
    usage.close();
  }
  const usage = new VoiceUsageRepository(':memory:');
  const paid = new VoiceTranscriber({
    key: 'private-test',
    model: 'paid/audio',
    usage,
    fetchImpl: assert.fail,
  });
  await assert.rejects(paid.transcribe(pcm, new AbortController().signal), /pagos/);
  usage.close();
});
test('captura só a próxima fala da pessoa escolhida e libera o decodificador', async () => {
  const speaking = new EventEmitter();
  const stream = new PassThrough();
  let subscribed = 0;
  const audio = [];
  const receiver = {
    speaking,
    subscribe: (user) => {
      assert.equal(user, 'ana');
      subscribed++;
      return stream;
    },
  };
  const dispose = receiveNextSpeech(receiver, 'ana', (buffer) => audio.push(buffer));
  speaking.emit('start', 'bia');
  assert.equal(subscribed, 0);
  speaking.emit('start', 'ana');
  const OpusScript = createRequire(import.meta.url)('opusscript');
  const encoder = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
  for (let i = 0; i < 25; i++)
    stream.write(Buffer.from(encoder.encode(Buffer.alloc(3840), 960)));
  stream.end();
  await flush();
  encoder.delete();
  assert.equal(audio.length, 1);
  assert.ok(audio[0].length >= 76800);
  assert.equal(speaking.listenerCount('start'), 0);
  dispose();
  speaking.emit('start', 'ana');
  assert.equal(subscribed, 1);
});
function voiceFixture(transcribe = async () => 'TheDam tocar Queen') {
  const calls = [],
    updates = [];
  let capture,
    released = 0;
  const service = {
    onChange: () => () => {},
    listen: async (_guild, _user, fn) => {
      capture = fn;
      return () => released++;
    },
    run: async (...args) => {
      calls.push(args);
      return args[2] === 'search'
        ? { tracks: [{ token: 'owned', title: 'Queen' }] }
        : {};
    },
  };
  const voice = new VoiceController(service, { verify: async () => {}, transcribe });
  return {
    voice,
    calls,
    updates,
    capture: () => capture(pcm),
    update: async (...args) => updates.push(args),
    get released() {
      return released;
    },
  };
}
test('um comando por voz usa a fila normal e encerra sua sessão depois', async () => {
  const f = voiceFixture();
  await f.voice.begin('amigos', 'ana', f.update);
  f.capture();
  await flush();
  assert.deepEqual(
    f.calls.map((call) => call[2]),
    ['state', 'search', 'enqueue'],
  );
  assert.ok(f.calls.every((call) => call[1] === 'ana'));
  assert.equal(f.released, 1);
  assert.equal(f.updates.at(-1)[1], false);
  f.voice.close();
});
test('cancelar durante transcrição aborta a chamada e impede adicionar música atrasada', async () => {
  let finish, signal;
  const f = voiceFixture(async (_pcm, receivedSignal) => {
    signal = receivedSignal;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await f.voice.begin('amigos', 'ana', f.update);
  f.capture();
  await flush();
  f.voice.cancel('ana');
  assert.equal(signal.aborted, true);
  finish('TheDam tocar Queen');
  await flush();
  assert.deepEqual(
    f.calls.map((call) => call[2]),
    ['state'],
  );
  assert.equal(f.released, 1);
  f.voice.close();
});

test('conta sem áudio liberado é barrada antes do POST e não consome cota', async () => {
  const usage = new VoiceUsageRepository(':memory:');
  let posts = 0;
  const speech = new VoiceTranscriber({
    key: 'private-test',
    model,
    usage,
    fetchImpl: async (url, options) => {
      if (options?.method === 'POST') posts++;
      return {
        ok: true,
        json: async () =>
          url.endsWith('/models')
            ? {
                data: [
                  {
                    id: model,
                    architecture: { input_modalities: ['audio'] },
                    pricing: { prompt: '0', completion: '0' },
                  },
                ],
              }
            : { data: { is_free_tier: true } },
      };
    },
  });
  await assert.rejects(
    speech.transcribe(pcm, new AbortController().signal),
    /saldo mínimo/,
  );
  await assert.rejects(speech.verify(), /saldo mínimo/);
  assert.equal(posts, 0);
  assert.equal(usage.remaining(10), 10);
  usage.close();
});
test('cota de voz permanece limitada após reiniciar o repositório', async (t) => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const directory = mkdtempSync(join(tmpdir(), 'thedam-voice-usage-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'voice.sqlite');
  const first = new VoiceUsageRepository(path);
  for (let i = 0; i < 8; i++) first.claim(10);
  first.close();
  const reopened = new VoiceUsageRepository(path);
  assert.equal(reopened.remaining(10), 2);
  assert.equal(reopened.claim(100), true);
  assert.equal(reopened.claim(100), true);
  assert.equal(reopened.claim(100), false);
  reopened.close();
});
test('captura cancelada não entrega áudio nem escuta outra pessoa', async () => {
  const speaking = new EventEmitter(),
    stream = new PassThrough();
  let received = 0;
  const dispose = receiveNextSpeech(
    { speaking, subscribe: () => stream },
    'ana',
    () => received++,
  );
  speaking.emit('start', 'ana');
  dispose();
  await flush();
  assert.ok(stream.destroyed);
  assert.equal(received, 0);
  assert.equal(speaking.listenerCount('start'), 0);
});
