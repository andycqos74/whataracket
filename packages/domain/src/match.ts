// Slot matching: turn free cells into bookable blocks that satisfy a request.

import { parseTimeOfDay, toLondon, weekdayOf } from './calendar.js';
import type { LocalDate } from './calendar.js';
import type { BookingRequest } from './request.js';
import type { FreeCell, Slot, VenueSettings } from './types.js';
import { isDateBookable } from './window.js';

export function slotKey(date: LocalDate, courtId: string, start: number): string {
  return `${date}|${courtId}|${start}`;
}

/**
 * Every slot that satisfies the request, best first: earliest date, then
 * earliest start, then court preference order.
 *
 * A slot is a run of adjacent free cells on one court that exactly fills
 * `durationMinutes` (and the venue's longest booking), inside the time window,
 * at or under the price cap when the price is known, on a
 * wanted weekday inside the date range, on a day bookable now, not already in
 * the past, and not on a date in `excludeDates` (already booked or notified).
 */
export function findSlots(
  cells: readonly FreeCell[],
  request: BookingRequest,
  settings: VenueSettings,
  nowMs: number,
  excludeDates: ReadonlySet<LocalDate> = new Set(),
): Slot[] {
  const earliest = parseTimeOfDay(request.window.earliestStart);
  const latest = parseTimeOfDay(request.window.latestEnd);
  const now = toLondon(nowMs);
  const preference = request.courts === 'any' ? undefined : request.courts.map(normaliseCourt);
  if (settings.maxBookingMinutes !== undefined && request.durationMinutes > settings.maxBookingMinutes) return [];

  const byCourtDay = new Map<string, FreeCell[]>();
  for (const cell of cells) {
    if (cell.date < request.dateRange.from || cell.date > request.dateRange.to) continue;
    if (excludeDates.has(cell.date)) continue;
    if (preference && !preference.includes(normaliseCourt(cell.courtName))) continue;
    const k = `${cell.date}|${cell.courtId}`;
    const list = byCourtDay.get(k);
    if (list) list.push(cell);
    else byCourtDay.set(k, [cell]);
  }

  const slots: Slot[] = [];
  for (const list of byCourtDay.values()) {
    const first = list[0];
    if (!first) continue;
    if (!request.days.includes(weekdayOf(first.date))) continue;
    if (!isDateBookable(first.date, nowMs, settings)) continue;

    const sorted = [...list].sort((a, b) => a.start - b.start);
    for (let i = 0; i < sorted.length; i++) {
      const head = sorted[i] as FreeCell;
      if (head.start < earliest) continue;
      if (head.date === now.date && head.start <= now.minute) continue;
      let end = head.start;
      let price: number | null = 0;
      for (let j = i; j < sorted.length; j++) {
        const cell = sorted[j] as FreeCell;
        if (cell.start !== end) break; // gap: not adjacent
        end = cell.end;
        price = price === null || cell.pricePence === null ? null : price + cell.pricePence;
        if (end - head.start >= request.durationMinutes) break;
      }
      if (end - head.start !== request.durationMinutes) continue;
      if (end > latest || (price !== null && price > request.maxPricePence)) continue;
      slots.push({
        key: slotKey(head.date, head.courtId, head.start),
        date: head.date,
        courtId: head.courtId,
        courtName: head.courtName,
        start: head.start,
        end,
        pricePence: price,
      });
    }
  }

  const rank = (s: Slot): number => (preference ? preference.indexOf(normaliseCourt(s.courtName)) : 0);
  return slots.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start || rank(a) - rank(b) || cmp(a.courtName, b.courtName)));
}

/** The best slot, if any. */
export function pickSlot(...args: Parameters<typeof findSlots>): Slot | undefined {
  return findSlots(...args)[0];
}

function normaliseCourt(name: string): string {
  return name.trim().toLowerCase();
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
