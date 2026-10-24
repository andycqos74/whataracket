// Release-window maths: which days are bookable now, and when the next day
// opens. Mirrors the rule in ClubSpark's own comp-booking.js
// (docs/CLUBSPARK.md §3).

import { addDays, daysBetween, fromLondon, toLondon, weekdayOf } from './calendar.js';
import type { LocalDate } from './calendar.js';
import type { BookingRequest } from './request.js';
import type { VenueSettings } from './types.js';

/** A day is bookable when 0 ≤ daysAhead ≤ period, the furthest day only from the release minute. */
export function isDateBookable(date: LocalDate, nowMs: number, settings: VenueSettings): boolean {
  const now = toLondon(nowMs);
  const ahead = daysBetween(now.date, date);
  if (ahead < 0 || ahead > settings.advancedBookingDays) return false;
  return ahead < settings.advancedBookingDays || now.minute >= settings.releaseMinute;
}

/** The furthest day that is bookable right now. */
export function furthestBookableDate(nowMs: number, settings: VenueSettings): LocalDate {
  const now = toLondon(nowMs);
  const released = now.minute >= settings.releaseMinute;
  return addDays(now.date, settings.advancedBookingDays - (released ? 0 : 1));
}

export interface NextRelease {
  /** The instant the next day opens. */
  atMs: number;
  /** The day that opens then. */
  opens: LocalDate;
}

export function nextRelease(nowMs: number, settings: VenueSettings): NextRelease {
  const now = toLondon(nowMs);
  const day = now.minute < settings.releaseMinute ? now.date : addDays(now.date, 1);
  return {
    atMs: fromLondon({ date: day, minute: settings.releaseMinute }),
    opens: addDays(day, settings.advancedBookingDays),
  };
}

/** Matching dates that are bookable now. */
export function datesToSearch(request: BookingRequest, nowMs: number, settings: VenueSettings): LocalDate[] {
  const today = toLondon(nowMs).date;
  const first = request.dateRange.from > today ? request.dateRange.from : today;
  const furthest = furthestBookableDate(nowMs, settings);
  const last = request.dateRange.to < furthest ? request.dateRange.to : furthest;
  const dates: LocalDate[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) {
    if (request.days.includes(weekdayOf(d))) dates.push(d);
  }
  return dates;
}

/** Whether the next release opens a day the request wants. */
export function releaseMatters(request: BookingRequest, release: NextRelease): boolean {
  const d = release.opens;
  return d >= request.dateRange.from && d <= request.dateRange.to && request.days.includes(weekdayOf(d));
}

/** True once every date in the request is in the past. */
export function isRequestExpired(request: BookingRequest, nowMs: number): boolean {
  return toLondon(nowMs).date > request.dateRange.to;
}
