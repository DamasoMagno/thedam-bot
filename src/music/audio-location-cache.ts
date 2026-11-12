export interface AudioFormat {
  ext?: string;
  protocol?: string;
  format_id?: string;
  acodec?: string;
  vcodec?: string;
  filesize?: number;
  duration?: number;
  downloader_options?: { http_chunk_size?: number };
}
export interface AudioLocation {
  url: string;
  headers: Record<string, string>;
  format?: AudioFormat;
}
export function trustedAudioLocation(
  value: unknown,
  headers: Record<string, string> = {},
  metadata: AudioFormat = {},
): AudioLocation | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      !(
        url.hostname === 'googlevideo.com' || url.hostname.endsWith('.googlevideo.com')
      ) ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    const safeHeaders: Record<string, string> = {};
    for (const name of ['User-Agent', 'Referer', 'Origin']) {
      if (typeof headers[name] === 'string' && !/[\r\n]/u.test(headers[name]))
        safeHeaders[name] = headers[name];
    }
    let format: AudioFormat | undefined;
    if (
      metadata.protocol === 'https' &&
      typeof metadata.ext === 'string' &&
      /^[a-z0-9]{1,10}$/u.test(metadata.ext)
    ) {
      format = { protocol: 'https', ext: metadata.ext };
      for (const key of ['format_id', 'acodec', 'vcodec'] as const)
        if (typeof metadata[key] === 'string' && metadata[key]!.length < 100)
          format[key] = metadata[key];
      for (const key of ['filesize', 'duration'] as const)
        if (Number.isFinite(metadata[key]) && metadata[key]! > 0)
          format[key] = metadata[key];
      const chunk = metadata.downloader_options?.http_chunk_size;
      if (Number.isFinite(chunk) && chunk! > 0)
        format.downloader_options = { http_chunk_size: Math.min(chunk!, 10485760) };
    }
    return { url: url.href, headers: safeHeaders, format };
  } catch {
    return null;
  }
}
export class AudioLocationCache {
  private entries = new Map<string, { location: AudioLocation; expiresAt: number }>();
  private now: () => number;
  constructor(now = Date.now) {
    this.now = now;
  }
  get(id: string) {
    const found = this.entries.get(id);
    if (!found || found.expiresAt <= this.now()) {
      this.entries.delete(id);
      return null;
    }
    return structuredClone(found.location);
  }
  set(id: string, location: AudioLocation) {
    const expiry = Number(new URL(location.url).searchParams.get('expire')) * 1000;
    const expiresAt = Math.min(
      this.now() + 90000,
      expiry > 0 ? expiry - 30000 : Infinity,
    );
    if (expiresAt <= this.now()) return;
    this.entries.delete(id);
    this.entries.set(id, {
      location: structuredClone(location),
      expiresAt,
    });
    while (this.entries.size > 100)
      this.entries.delete(this.entries.keys().next().value!);
  }
  delete(id: string) {
    this.entries.delete(id);
  }
}
