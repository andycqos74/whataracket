import { describe, expect, it } from 'vitest';
import { fromLondon } from './calendar.js';
import { findSlots, pickSlot } from './match.js';
import type { BookingRequest } from './request.js';
import { validateRequest } from './request.js';
import type { FreeCell, VenueSettings } from './types.js';
import { datesToSearch, furthestBookableDate, isDateBookable, nextRelease, releaseMatters } from './window.js';

const settings: VenueSettings = { timeZone: 'Europe/London', advancedBookingDays: 7, releaseMinute: 1200 };

const request: BookingRequest = {
  name: 'tue-thu-evenings',
  venue: 'ParliamentHillFieldsTennisCourts',
  courts: 'any',
  days: ['Tue', 'Thu'],
  window: { earliestStart: '18:00', latestEnd: '20:00' },
  durationMinutes: 60,
  dateRange: { from: '2026-10-01', to: '2026-12-20' },
  maxPricePence: 1500,
  mode: 'recurring',
  action: 'notify',
  pollEveryMinutes: 5,
};

/** Saturday 2026-10-24, 12:00 London (BST). */
const NOW = fromLondon({ date: '2026-10-24', minute: 720 });

function cells(courtName: string, date: string, starts: number[], interval = 30, pricePence = 520): FreeCell[] {
  return starts.map((start) => ({ courtId: `id-${courtName}`, courtName, date, start, end: start + interval, pricePence }));
}

describe('release window', () => {
  it('opens the furthest day at the release minute', () => {
    expect(isDateBookable('2026-10-31', NOW, settings)).toBe(false);
    expect(isDateBookable('2026-10-30', NOW, settings)).toBe(true);
    const evening = fromLondon({ date: '2026-10-24', minute: 1200 });
    expect(isDateBookable('2026-10-31', evening, settings)).toBe(true);
    expect(isDateBookable('2026-10-23', NOW, settings)).toBe(false);
    expect(furthestBookableDate(NOW, settings)).toBe('2026-10-30');
    expect(furthestBookableDate(evening, settings)).toBe('2026-10-31');
  });

  it('finds the next release instant, across the clock change', () => {
    expect(nextRelease(NOW, settings)).toEqual({ atMs: fromLondon({ date: '2026-10-24', minute: 1200 }), opens: '2026-10-31' });
    const after = fromLondon({ date: '2026-10-24', minute: 1201 });
    const next = nextRelease(after, settings);
    expect(next.opens).toBe('2026-11-01');
    // 25 Oct is the day BST ends: 20:00 GMT is 20:00 UTC.
    expect(next.atMs).toBe(Date.UTC(2026, 9, 25, 20, 0));
  });

  it('lists matching bookable dates', () => {
    expect(datesToSearch(request, NOW, settings)).toEqual(['2026-10-27', '2026-10-29']);
    expect(releaseMatters(request, { atMs: 0, opens: '2026-10-31' })).toBe(false); // Saturday
    expect(releaseMatters(request, { atMs: 0, opens: '2026-11-03' })).toBe(true); // Tuesday
  });
});

describe('findSlots', () => {
  it('merges adjacent 30-minute cells into an hour', () => {
    const slot = pickSlot(cells('Crt 1', '2026-10-27', [1080, 1110]), request, settings, NOW);
    expect(slot).toMatchObject({ courtName: 'Crt 1', date: '2026-10-27', start: 1080, end: 1140, pricePence: 1040 });
  });

  it('does not merge across a gap', () => {
    expect(findSlots(cells('Crt 1', '2026-10-27', [1080, 1140]), request, settings, NOW)).toEqual([]);
  });

  it('respects the time window', () => {
    expect(findSlots(cells('Crt 1', '2026-10-27', [1020, 1050]), request, settings, NOW)).toEqual([]);
    expect(findSlots(cells('Crt 1', '2026-10-27', [1170, 1200]), request, settings, NOW)).toEqual([]);
    expect(findSlots(cells('Crt 1', '2026-10-27', [1140, 1170]), request, settings, NOW)).toHaveLength(1);
  });

  it('respects the price cap', () => {
    expect(findSlots(cells('Crt 1', '2026-10-27', [1080, 1110], 30, 800), request, settings, NOW)).toEqual([]);
  });

  it('skips unwanted weekdays, unreleased days and excluded dates', () => {
    expect(findSlots(cells('Crt 1', '2026-10-28', [1080, 1110]), request, settings, NOW)).toEqual([]); // Wed
    const later = { ...request, days: ['Sat' as const] };
    expect(findSlots(cells('Crt 1', '2026-10-31', [1080, 1110]), later, settings, NOW)).toEqual([]);
    expect(findSlots(cells('Crt 1', '2026-10-27', [1080, 1110]), request, settings, NOW, new Set(['2026-10-27']))).toEqual([]);
  });

  it('skips slots already started today', () => {
    const tuesday = fromLondon({ date: '2026-10-27', minute: 1090 });
    const slots = findSlots(cells('Crt 1', '2026-10-27', [1080, 1110, 1140]), request, settings, tuesday);
    expect(slots.map((s) => s.start)).toEqual([1110]);
  });

  it('orders by date, start, then court preference', () => {
    const preferred = { ...request, courts: ['Crt 4', 'crt 2'] };
    const all = [
      ...cells('Crt 2', '2026-10-27', [1080, 1110]),
      ...cells('Crt 4', '2026-10-27', [1080, 1110]),
      ...cells('Crt 1', '2026-10-27', [1080, 1110]),
      ...cells('Crt 4', '2026-10-29', [1080, 1110]),
    ];
    const slots = findSlots(all, preferred, settings, NOW);
    expect(slots.map((s) => `${s.date} ${s.courtName}`)).toEqual(['2026-10-27 Crt 4', '2026-10-27 Crt 2', '2026-10-29 Crt 4']);
  });

  it('handles 60-minute cells', () => {
    const slots = findSlots(cells('Crt 1', '2026-10-27', [1080, 1140], 60, 1040), request, settings, NOW);
    expect(slots.map((s) => s.start)).toEqual([1080, 1140]);
  });
});

describe('validateRequest', () => {
  it('accepts a good request', () => {
    expect(validateRequest(request)).toEqual([]);
  });

  it('rejects impolite polling and broken fields', () => {
    const bad = { ...request, pollEveryMinutes: 0.5, days: ['Funday'], dateRange: { from: '2026-12-01', to: '2026-11-01' } } as unknown as BookingRequest;
    const errors = validateRequest(bad);
    expect(errors.some((e) => e.startsWith('pollEveryMinutes'))).toBe(true);
    expect(errors.some((e) => e.startsWith('days'))).toBe(true);
    expect(errors.some((e) => e.startsWith('dateRange'))).toBe(true);
  });

  it('rejects a window shorter than the duration', () => {
    expect(validateRequest({ ...request, durationMinutes: 180 })).toContain('window: too short for durationMinutes');
  });
});
