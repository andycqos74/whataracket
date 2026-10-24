import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  fromEpochDay,
  fromLondon,
  isLocalDate,
  londonOffsetMinutes,
  parseTimeOfDay,
  toEpochDay,
  toLondon,
  weekdayOf,
} from './calendar.js';

const londonParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function intlLondon(ms: number): { date: string; minute: number } {
  const p = Object.fromEntries(londonParts.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p['year']}-${p['month']}-${p['day']}`, minute: Number(p['hour']) * 60 + Number(p['minute']) };
}

describe('epoch days', () => {
  it('round-trips and agrees with Date', () => {
    fc.assert(
      fc.property(fc.integer({ min: -50_000, max: 100_000 }), (day) => {
        const date = fromEpochDay(day);
        expect(toEpochDay(date)).toBe(day);
        expect(new Date(day * 86_400_000).toISOString().slice(0, 10)).toBe(date);
      }),
    );
  });

  it('knows weekdays', () => {
    expect(weekdayOf('2026-10-24')).toBe('Sat');
    expect(weekdayOf('1970-01-01')).toBe('Thu');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('validates dates', () => {
    expect(isLocalDate('2026-02-29')).toBe(false);
    expect(isLocalDate('2028-02-29')).toBe(true);
    expect(isLocalDate('2026-13-01')).toBe(false);
  });

  it('parses times of day', () => {
    expect(parseTimeOfDay('18:30')).toBe(1110);
    expect(parseTimeOfDay('24:00')).toBe(1440);
    expect(() => parseTimeOfDay('7:00')).toThrow();
    expect(() => parseTimeOfDay('18:60')).toThrow();
  });
});

describe('Europe/London', () => {
  it('matches the platform time-zone database', () => {
    const from = Date.UTC(2000, 0, 1);
    const to = Date.UTC(2060, 0, 1);
    fc.assert(
      fc.property(fc.integer({ min: from, max: to }), (ms) => {
        expect(toLondon(ms)).toEqual(intlLondon(ms));
      }),
      { numRuns: 5000 },
    );
  });

  it('switches at 01:00 UTC on the last Sundays of March and October', () => {
    expect(londonOffsetMinutes(Date.UTC(2026, 2, 29, 0, 59))).toBe(0);
    expect(londonOffsetMinutes(Date.UTC(2026, 2, 29, 1, 0))).toBe(60);
    expect(londonOffsetMinutes(Date.UTC(2026, 9, 25, 0, 59))).toBe(60);
    expect(londonOffsetMinutes(Date.UTC(2026, 9, 25, 1, 0))).toBe(0);
  });

  it('round-trips wall times outside the transitions', () => {
    fc.assert(
      fc.property(fc.integer({ min: 10_957, max: 32_872 }), fc.integer({ min: 0, max: 1439 }), (day, minute) => {
        const date = fromEpochDay(day);
        const local = { date, minute };
        const back = toLondon(fromLondon(local));
        if (minute >= 60 && minute < 120) return; // 01:xx can fall in a gap or overlap
        expect(back).toEqual(local);
      }),
    );
  });

  it('resolves the autumn overlap to BST and the spring gap forward', () => {
    expect(fromLondon({ date: '2026-10-25', minute: 90 })).toBe(Date.UTC(2026, 9, 25, 0, 30));
    expect(toLondon(fromLondon({ date: '2026-03-29', minute: 90 }))).toEqual({ date: '2026-03-29', minute: 150 });
  });
});
