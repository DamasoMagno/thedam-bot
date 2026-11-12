import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { MusicError } from '../shared/music-error.ts';
export class LastFmError extends MusicError {
  code: number;
  constructor(code: number) {
    super(
      503,
      code === 14
        ? 'Autorize no Last.fm antes de confirmar.'
        : code === 9
          ? 'Vínculo Last.fm expirado. Conecte novamente.'
          : 'Last.fm indisponível. Tente novamente em instantes.',
    );
    this.code = code;
  }
}
export function signLastFm(parameters: Record<string, string>, secret: string) {
  const input = Object.keys(parameters)
    .filter((key) => !['format', 'callback', 'api_sig'].includes(key))
    .sort()
    .map((key) => key + parameters[key])
    .join('');
  return createHash('md5')
    .update(input + secret, 'utf8')
    .digest('hex');
}
export interface LastFmTrack {
  name?: string;
  artist?: { name?: string };
}
export interface LastFmResponse {
  token?: string;
  session?: { name?: string; key?: string };
  user?: { playcount?: string | number };
  toptracks?: { track?: LastFmTrack[] };
  similartracks?: { track?: LastFmTrack[] };
  similarartists?: { artist?: { name?: string }[] };
  scrobbles?: { '@attr'?: { accepted?: string; ignored?: string } };
}
export class LastFmClient {
  private key: string;
  private secret: string;
  private fetch: typeof fetch;
  private tail: Promise<unknown> = Promise.resolve();
  private nextRequest = 0;
  private pending = 0;
  private controller = new AbortController();
  close() {
    this.controller.abort();
  }
  constructor(key: string, secret: string, fetchImpl = fetch) {
    this.key = key;
    this.secret = secret;
    this.fetch = fetchImpl;
  }
  authorizationUrl(token: string) {
    return (
      'https://www.last.fm/api/auth/?' +
      new URLSearchParams({ api_key: this.key, token })
    );
  }
  request(
    method: string,
    input: Record<string, string> = {},
    signed = false,
  ): Promise<LastFmResponse> {
    if (this.pending >= 100)
      return Promise.reject(new MusicError(429, 'Aguarde os pedidos do Last.fm.'));
    this.pending++;
    const task = this.tail
      .catch(() => {})
      .then(async () => {
        this.controller.signal.throwIfAborted();
        await delay(Math.max(0, this.nextRequest - Date.now()), undefined, {
          signal: this.controller.signal,
        });
        this.nextRequest = Date.now() + 300;
        const params: Record<string, string> = { ...input, method, api_key: this.key };
        if (signed) params.api_sig = signLastFm(params, this.secret);
        params.format = 'json';
        const response = await this.fetch('https://ws.audioscrobbler.com/2.0/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(params),
          signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(8000)]),
        });
        if (!response.ok) throw new LastFmError(response.status === 429 ? 29 : 11);
        const data = await response.json();
        if (data.error) throw new LastFmError(Number(data.error));
        return data as LastFmResponse;
      })
      .finally(() => {
        this.pending--;
      });
    this.tail = task;
    return task;
  }
}
