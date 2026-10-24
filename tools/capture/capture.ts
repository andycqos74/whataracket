// Phase 0 capture tool (docs/BUILD-PLAN.md). Run it AT HOME: ClubSpark's
// Cloudflare blocks datacenter IPs, and nothing here tries to get around that.
//
//   pnpm capture fixtures [venue] [days]   public availability JSON → packages/clubspark/fixtures/<venue>/
//   pnpm capture flow [venue]              visible browser; you log in and book by hand while
//                                          requests are recorded, redacted, to captures/ (git-ignored)
//
// Review every capture before sharing it. Redaction is best-effort.

import { mkdir, writeFile } from 'node:fs/promises';
import { getJson } from '@whataracket/clubspark';
import { chromium } from 'playwright';
import type { Request } from 'playwright';
import { PAYMENT_HOST, redactBody, redactHeaders, redactUrl, redactValue } from './redact.ts';

const HOST = process.env['CLUBSPARK_HOST'] ?? 'clubspark.lta.org.uk';
const [mode, venueArg, daysArg] = process.argv.slice(2);
const venue = venueArg ?? process.env['CLUBSPARK_VENUE'] ?? 'ParliamentHillFieldsTennisCourts';
const root = new URL('../../', import.meta.url);

const http = { userAgent: 'Mozilla/5.0 (compatible; whataracket-capture/0.1)', timeoutMs: 20_000 };

/** Keep only the session fields the parser reads; booking names could identify people. */
function sanitiseSessions(json: unknown): unknown {
  const SESSION_KEYS = ['ID', 'Category', 'SubCategory', 'StartTime', 'EndTime', 'Interval', 'CourtCost', 'LightingCost', 'MemberPrice', 'GuestPrice', 'Recurrence'];
  const root = json as { Resources?: Array<{ Days?: Array<{ Sessions?: Array<Record<string, unknown>> }> }> };
  for (const resource of root.Resources ?? []) {
    for (const day of resource.Days ?? []) {
      day.Sessions = (day.Sessions ?? []).map((s) => {
        const kept = Object.fromEntries(SESSION_KEYS.filter((k) => k in s).map((k) => [k, s[k]]));
        return { ...kept, Name: s['Category'] === 0 ? '' : '[category]' };
      });
    }
  }
  return root;
}

async function fixtures(): Promise<void> {
  const days = Number(daysArg ?? 8);
  const dir = new URL(`packages/clubspark/fixtures/${venue}/`, root);
  await mkdir(dir, { recursive: true });
  const base = `https://${HOST}/v0/VenueBooking/${encodeURIComponent(venue)}`;

  const settings = await getJson(new URL(`${base}/GetSettings`), http);
  await writeFile(new URL('GetSettings.json', dir), JSON.stringify(redactValue(settings), null, 2) + '\n');

  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const url = new URL(`${base}/GetVenueSessions`);
  url.search = new URLSearchParams({ resourceID: '', startDate: today, endDate: end, roleId: '' }).toString();
  const sessions = sanitiseSessions(await getJson(url, http));
  await writeFile(new URL(`GetVenueSessions-${today}.json`, dir), JSON.stringify(sessions, null, 2) + '\n');

  console.log(`Wrote GetSettings.json and GetVenueSessions-${today}.json (${today} → ${end}) to ${dir.pathname}`);
  console.log('These are public, logged-out responses with booking names stripped. Review, then commit.');
}

interface Entry {
  at: string;
  method: string;
  url: string;
  resourceType: string;
  requestHeaders?: Record<string, string>;
  requestBody?: unknown;
  status?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: unknown;
  note?: string;
}

async function flow(): Promise<void> {
  const entries: Entry[] = [];
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  const record = async (request: Request): Promise<void> => {
    const url = new URL(request.url());
    if (['image', 'font', 'stylesheet', 'media'].includes(request.resourceType())) return;
    if (PAYMENT_HOST.test(url.hostname)) {
      entries.push({ at: new Date().toISOString(), method: request.method(), url: `${url.origin}${url.pathname}`, resourceType: request.resourceType(), note: 'payment host: URL only' });
      return;
    }
    const entry: Entry = {
      at: new Date().toISOString(),
      method: request.method(),
      url: redactUrl(request.url()),
      resourceType: request.resourceType(),
      requestHeaders: redactHeaders(await request.allHeaders()),
      requestBody: redactBody(request.postData(), (await request.headerValue('content-type')) ?? ''),
    };
    const response = await request.response();
    if (response) {
      entry.status = response.status();
      entry.responseHeaders = redactHeaders(await response.allHeaders());
      const type = (await response.headerValue('content-type')) ?? '';
      if (/json|text\/plain/.test(type) && url.hostname.endsWith(HOST.split('.').slice(-3).join('.'))) {
        try {
          const text = await response.text();
          entry.responseBody = text.length > 500_000 ? `[${text.length} bytes omitted]` : redactBody(text, type);
        } catch {
          entry.note = 'body unavailable';
        }
      }
    }
    entries.push(entry);
  };
  page.on('requestfinished', (r) => void record(r));
  page.on('requestfailed', (r) => void record(r));

  console.log('A browser window is open. Log in, pick a slot and go as far through checkout as you are happy to.');
  console.log('Close the browser window when done. Nothing is recorded from payment-provider frames beyond their URLs.');
  await page.goto(`https://${HOST}/${venue}/Booking/BookByDate`);
  await new Promise<void>((resolve) => browser.on('disconnected', () => resolve()));

  const dir = new URL('captures/', root);
  await mkdir(dir, { recursive: true });
  const file = new URL(`flow-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, dir);
  await writeFile(file, JSON.stringify(entries, null, 2) + '\n');
  console.log(`Recorded ${entries.length} requests to ${file.pathname}. Review it before sharing; captures/ is git-ignored.`);
}

if (mode === 'fixtures') await fixtures();
else if (mode === 'flow') await flow();
else {
  console.log('usage: pnpm capture fixtures [venue] [days] | pnpm capture flow [venue]');
  process.exit(mode ? 1 : 0);
}
