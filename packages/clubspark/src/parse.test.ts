import { readFileSync } from 'node:fs';
import { fromLondon, pickSlot } from '@whataracket/domain';
import type { BookingRequest } from '@whataracket/domain';
import { describe, expect, it } from 'vitest';
import { ClubSparkClient } from './client.js';
import { ClubSparkParseError, parseSettings, parseVenueSessions, poundsToPence } from './parse.js';

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../fixtures/synthetic/${name}.json`, import.meta.url), 'utf8'));

describe('poundsToPence', () => {
  it('rounds decimal pounds to whole pence', () => {
    expect(poundsToPence(10.4)).toBe(1040);
    expect(poundsToPence(0.1 + 0.2)).toBe(30);
    expect(poundsToPence(null)).toBe(0);
    expect(() => poundsToPence(-1)).toThrow(ClubSparkParseError);
    expect(() => poundsToPence('10.40')).toThrow(ClubSparkParseError);
  });
});

describe('parseSettings', () => {
  it('uses the shortest role period unless a role is named', () => {
    expect(parseSettings(fixture('GetSettings'))).toEqual({ timeZone: 'Europe/London', advancedBookingDays: 7, releaseMinute: 1200 });
    expect(parseSettings(fixture('GetSettings'), { roleName: 'member' }).advancedBookingDays).toBe(14);
    expect(() => parseSettings(fixture('GetSettings'), { roleName: 'coach' })).toThrow(/no role named coach/);
  });

  it('rejects other time zones', () => {
    expect(() => parseSettings({ ...(fixture('GetSettings') as object), TimeZone: 'Europe/Paris' })).toThrow(/not supported/);
  });
});

describe('parseVenueSessions', () => {
  const cells = parseVenueSessions(fixture('GetVenueSessions'));

  it('keeps only free cells on tennis courts, split at the interval', () => {
    const court1 = { courtId: 'court-1', courtName: 'Crt 1', date: '2026-10-27', pricePence: 670 };
    const court2 = { courtId: 'court-2', courtName: 'Crt 2', date: '2026-10-27', pricePence: 1040 };
    expect(cells).toEqual([
      { ...court1, start: 1080, end: 1110 },
      { ...court1, start: 1110, end: 1140 },
      { ...court1, start: 1140, end: 1170 },
      { ...court1, start: 1170, end: 1200 },
      { ...court1, date: '2026-10-28', start: 420, end: 480, pricePence: null },
      { ...court1, date: '2026-10-28', start: 480, end: 540, pricePence: null },
      { ...court2, start: 1140, end: 1200 },
      { ...court2, start: 1200, end: 1260 },
    ]);
  });

  it('feeds pickSlot end to end', () => {
    const request: BookingRequest = {
      name: 'tue',
      venue: 'ParliamentHillFieldsTennisCourts',
      courts: 'any',
      days: ['Tue'],
      window: { earliestStart: '18:00', latestEnd: '20:00' },
      durationMinutes: 60,
      dateRange: { from: '2026-10-01', to: '2026-12-31' },
      maxPricePence: 1200,
      mode: 'once',
      action: 'notify',
      pollEveryMinutes: 5,
    };
    const settings = parseSettings(fixture('GetSettings'));
    const now = fromLondon({ date: '2026-10-24', minute: 720 });
    // Crt 1 with lighting costs 1340p for the hour, over the cap; Crt 2 19:00-20:00 costs 1040p.
    expect(pickSlot(cells, request, settings, now)).toMatchObject({ courtName: 'Crt 2', start: 1140, end: 1200, pricePence: 1040 });
  });

  it('fails loudly on an unexpected shape', () => {
    expect(() => parseVenueSessions({ Resources: 'nope' })).toThrow(ClubSparkParseError);
  });
});

describe('ClubSparkClient', () => {
  it('builds the documented URLs', async () => {
    const seen: string[] = [];
    const client = new ClubSparkClient({
      fetchJson: (url) => {
        seen.push(url.toString());
        return Promise.resolve(url.pathname.endsWith('GetSettings') ? fixture('GetSettings') : fixture('GetVenueSessions'));
      },
    });
    await client.getSettings('ParliamentHillFieldsTennisCourts');
    await client.getFreeCells('ParliamentHillFieldsTennisCourts', '2026-10-27', '2026-10-31');
    expect(seen).toEqual([
      'https://clubspark.lta.org.uk/v0/VenueBooking/ParliamentHillFieldsTennisCourts/GetSettings',
      'https://clubspark.lta.org.uk/v0/VenueBooking/ParliamentHillFieldsTennisCourts/GetVenueSessions?resourceID=&startDate=2026-10-27&endDate=2026-10-31&roleId=',
    ]);
  });
});
