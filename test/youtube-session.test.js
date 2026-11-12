import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  statSync,
  chmodSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createYoutubeSession } from '../src/music/youtube-session.ts';
import { youtubeError } from '../src/music/youtube-error.ts';
import { runExtractor, Catalog } from '../src/music/catalog.ts';
import { createAudioSource } from '../src/music/audio-source.ts';
const cookies =
  '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t2147483647\tTEST\tprivate-test-session\n';
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'thedam-cookie-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'cookies.txt');
  writeFileSync(path, cookies, { mode: 0o400 });
  const trace = join(directory, 'trace.json');
  const binary = join(directory, 'extractor.mjs');
  writeFileSync(
    binary,
    `#!/usr/bin/env node\nimport fs from 'node:fs';\nconst args=process.argv.slice(2);const index=args.indexOf('--cookies');const path=args[index+1];fs.writeFileSync(${JSON.stringify(trace)},JSON.stringify({path,args}));if(index>=0){if(!fs.readFileSync(path,'utf8').includes('private-test-session'))process.exit(9);fs.appendFileSync(path,'# updated\\n');}if(args.includes('--simulate-error')){console.error("Sign in to confirm you’re not a bot: private-test-session");process.exit(1);}if(args.includes('--wait'))setTimeout(()=>{},10000);else console.log(JSON.stringify({id:'abcdefghijk',title:'Song'}));\n`,
    { mode: 0o700 },
  );
  return { directory, path, trace, binary };
}
test('sem cookies configurados não cria arquivo nem argumentos', () => {
  const session = createYoutubeSession();
  assert.deepEqual(session.args, []);
  session.close();
});
test('cookies de origem somente leitura usam cópia privada temporária e são limpos', (t) => {
  const f = fixture(t),
    session = createYoutubeSession(f.path),
    temporary = session.args[1];
  assert.notEqual(temporary, f.path);
  assert.equal(statSync(temporary).mode & 0o777, 0o600);
  assert.equal(statSync(join(temporary, '..')).mode & 0o777, 0o700);
  assert.equal(readFileSync(temporary, 'utf8'), cookies);
  writeFileSync(temporary, 'changed');
  assert.equal(readFileSync(f.path, 'utf8'), cookies);
  session.close();
  session.close();
  assert.equal(existsSync(temporary), false);
});
test('arquivo ausente ou formato inválido gera erro seguro sem revelar conteúdo', (t) => {
  const f = fixture(t);
  chmodSync(f.path, 0o600);
  writeFileSync(f.path, 'private-test-session');
  for (const path of [f.path, join(f.directory, 'missing'), f.directory])
    assert.throws(
      () => createYoutubeSession(path),
      (error) =>
        error.status === 503 && !error.message.includes('private-test-session'),
    );
});
test('extração lê cookies temporários, permite atualização e remove no sucesso', async (t) => {
  const f = fixture(t);
  assert.equal(
    (await runExtractor(f.binary, [], { cookiesFile: f.path })).id,
    'abcdefghijk',
  );
  const trace = JSON.parse(readFileSync(f.trace, 'utf8'));
  assert.equal(existsSync(trace.path), false);
  assert.equal(readFileSync(f.path, 'utf8'), cookies);
});
test('falha de login preserva o motivo, esconde stderr sensível e limpa os cookies', async (t) => {
  const f = fixture(t);
  await assert.rejects(
    runExtractor(f.binary, ['--simulate-error'], { cookiesFile: f.path }),
    (error) =>
      /autenticação/.test(error.message) &&
      !error.message.includes('private-test-session'),
  );
  assert.equal(existsSync(JSON.parse(readFileSync(f.trace, 'utf8')).path), false);
});
test('cancelamento encerra extração, preserva AbortError e remove os cookies', async (t) => {
  const f = fixture(t),
    controller = new AbortController();
  const pending = runExtractor(f.binary, ['--wait'], {
    cookiesFile: f.path,
    signal: controller.signal,
  });
  const assertion = assert.rejects(pending, { name: 'AbortError' });
  for (let i = 0; i < 100 && !existsSync(f.trace); i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  controller.abort();
  await assertion;
  const trace = JSON.parse(readFileSync(f.trace, 'utf8'));
  assert.equal(existsSync(trace.path), false);
});
test('catálogo aplica a mesma configuração de sessão na busca e na resolução de áudio', async () => {
  const options = [];
  const catalog = new Catalog(
    { ytdlp: 'yt-dlp', youtubeCookiesFile: '/private/cookies.txt' },
    {
      extract: async (_binary, _args, input) => {
        options.push(input);
        return {
          id: 'abcdefghijk',
          title: 'Song',
          url: 'https://r1.googlevideo.com/audio',
        };
      },
    },
  );
  const tracks = await catalog.search('https://youtu.be/abcdefghijk');
  catalog.invalidateAudio('abcdefghijk');
  await catalog.audioLocation(tracks[0]);
  assert.equal(options.length, 2);
  assert.ok(options.every((value) => value.cookiesFile === '/private/cookies.txt'));
});
test('download também usa cookies, mantém a origem e libera a cópia ao parar', async (t) => {
  const f = fixture(t),
    encoder = join(f.directory, 'encoder.mjs');
  writeFileSync(encoder, '#!/usr/bin/env node\nprocess.stdin.pipe(process.stdout);\n', {
    mode: 0o700,
  });
  let rejectFailure;
  const failure = new Promise((_resolve, reject) => {
    rejectFailure = reject;
  });
  const source = createAudioSource(
    { ytdlp: f.binary, ffmpeg: encoder, youtubeCookiesFile: f.path },
    { id: 'abcdefghijk', title: 'Song', provider: 'youtube' },
    rejectFailure,
  );
  t.after(() => source.stop());
  await Promise.race([
    new Promise((resolve) => source.stream.once('data', resolve)),
    failure,
  ]);
  const trace = JSON.parse(readFileSync(f.trace, 'utf8'));
  assert.equal(trace.args[trace.args.indexOf('--cookies') + 1], trace.path);
  source.stop();
  assert.equal(existsSync(trace.path), false);
  assert.equal(readFileSync(f.path, 'utf8'), cookies);
});
test('classificação distingue autenticação, limite e rede sem reproduzir URLs privadas', () => {
  assert.match(
    youtubeError('Sign in to confirm you’re not a bot; https://private?key=secret')
      .message,
    /autenticação/,
  );
  assert.match(youtubeError('HTTP Error 403: Forbidden').message, /403/);
  assert.match(youtubeError('HTTP Error 429').message, /limitou/);
  assert.match(youtubeError('EAI_AGAIN').message, /DNS/);
  assert.match(youtubeError('ENOENT').message, /executável/);
  assert.ok(
    !youtubeError('HTTP Error 403: https://private?key=secret').message.includes(
      'secret',
    ),
  );
});
