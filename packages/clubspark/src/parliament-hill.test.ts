// Against real, public responses captured at home on 2026-10-24 by
// `pnpm capture fixtures` (booking names stripped).

import { readFileSync } from 'node:fs';
import { findSlots, toLondon } from '@whataracket/domain';
import type { BookingRequest } from '@whataracket/domain';
import { describe, expect, it } from 'vitest';
import { parseSettings, parseVenueSessions } from './parse.js';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/ParliamentHillFieldsTennisCourts/${name}.json`, import.meta.url), 'utf8'));

const settings = parseSettings(fixture('GetSettings'));
const cells = parseVenueSessions(fixture('GetVenueSessions-2026-10-24'));
/** `ServerDateTime` in the capture: 23:16 UTC, which is 00:16 BST on Sunday 25 Oct. */
const capturedAt = Date.UTC(2026, 9, 24, 23, 16);

describe('Parliament Hill Fields (real capture)', () => {
  it('reads the guest booking rules', () => {
    expect(settings).toEqual({ timeZone: 'Europe/London', advancedBookingDays: 2, releaseMinute: 0, maxBookingMinutes: 60 });
  });

  it('finds free hour cells on the ten tennis courts only, with no logged-out price', () => {
    expect(new Set(cells.map((c) => c.courtName)).size).toBe(10);
    expect(cells.every((c) => c.courtName.startsWith('Court ') && c.end - c.start === 60 && c.pricePence === null)).toBe(true);
    // Court 1 on Monday 26 Oct: free 07:00–13:00 and 14:00–18:00.
    const monday = cells.filter((c) => c.courtName === 'Court 1' && c.date === '2026-10-26').map((c) => c.start / 60);
    expect(monday).toEqual([7, 8, 9, 10, 11, 12, 14, 15, 16, 17]);
  });

  it('matches early hours on Monday and Tuesday, the two days ahead, and nothing longer than an hour', () => {
    const request: BookingRequest = {
      name: 'mornings',
      venue: 'ParliamentHillFieldsTennisCourts',
      courts: ['Court 1'],
      days: ['Mon', 'Tue'],
      window: { earliestStart: '07:00', latestEnd: '09:00' },
      durationMinutes: 60,
      dateRange: { from: '2026-10-24', to: '2026-10-31' },
      maxPricePence: 1200,
      mode: 'once',
      action: 'notify',
      pollEveryMinutes: 5,
    };
    const slots = findSlots(cells, request, settings, capturedAt);
    expect(slots.map((s) => `${s.date} ${s.start / 60}`)).toEqual(['2026-10-26 7', '2026-10-26 8', '2026-10-27 7', '2026-10-27 8']);
    expect(findSlots(cells, { ...request, durationMinutes: 120 }, settings, capturedAt)).toEqual([]);
  });

  it('reads the capture time as Sunday in London', () => {
    expect(toLondon(capturedAt)).toEqual({ date: '2026-10-25', minute: 16 });
  });
});
