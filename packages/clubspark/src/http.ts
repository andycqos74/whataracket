// Plain `node:https`, not global `fetch`: community projects found `fetch` is
// challenged by ClubSpark's Cloudflare while `node:https` is not
// (docs/CLUBSPARK.md §1). Nothing here tries to get past a challenge.

import { request } from 'node:https';

export class ClubSparkHttpError extends Error {
  override readonly name: string = 'ClubSparkHttpError';
  constructor(
    message: string,
    readonly status: number | undefined,
  ) {
    super(message);
  }
}

/** Cloudflare refused us. Retrying harder is impolite; the caller should back off. */
export class ClubSparkBlockedError extends ClubSparkHttpError {
  override readonly name: string = 'ClubSparkBlockedError';
}

export interface HttpOptions {
  userAgent: string;
  timeoutMs: number;
}

const MAX_BODY_BYTES = 20 * 1024 * 1024;

export function getJson(url: URL, options: HttpOptions): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Accept-Language': 'en-GB,en;q=0.9',
          'User-Agent': options.userAgent,
        },
        timeout: options.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            req.destroy(new ClubSparkHttpError(`Response from ${url.pathname} exceeded ${MAX_BODY_BYTES} bytes`, res.statusCode));
            return;
          }
          chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          const body = Buffer.concat(chunks).toString('utf8');
          const contentType = String(res.headers['content-type'] ?? '');
          const looksBlocked = status === 403 || status === 429 || status === 503 || /cloudflare|cf-ray|attention required|you have been blocked/i.test(contentType.includes('html') ? body.slice(0, 4000) : '');
          if (looksBlocked) {
            reject(new ClubSparkBlockedError(`ClubSpark refused ${url.pathname} (HTTP ${status}); likely Cloudflare. Back off rather than retry.`, status));
            return;
          }
          if (status < 200 || status >= 300) {
            reject(new ClubSparkHttpError(`ClubSpark ${url.pathname} returned HTTP ${status}`, status));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new ClubSparkHttpError(`ClubSpark ${url.pathname} did not return JSON (${contentType || 'no content type'})`, status));
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new ClubSparkHttpError(`ClubSpark ${url.pathname} timed out after ${options.timeoutMs} ms`, undefined)));
    req.on('error', reject);
    req.end();
  });
}
