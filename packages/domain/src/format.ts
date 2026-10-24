import { formatTimeOfDay, weekdayOf } from './calendar.js';
import type { LocalDate } from './calendar.js';
import type { Slot } from './types.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(date: LocalDate): string {
  const month = MONTHS[Number(date.slice(5, 7)) - 1] ?? '';
  return `${weekdayOf(date)} ${Number(date.slice(8, 10))} ${month}`;
}

export function formatPence(pence: number | null): string {
  if (pence === null) return 'price unknown';
  return `£${Math.floor(pence / 100)}.${String(pence % 100).padStart(2, '0')}`;
}

/** e.g. `Tue 27 Oct 19:00–20:00, Crt 2, £10.40` */
export function describeSlot(slot: Slot): string {
  return `${formatDate(slot.date)} ${formatTimeOfDay(slot.start)}–${formatTimeOfDay(slot.end)}, ${slot.courtName}, ${formatPence(slot.pricePence)}`;
}

/**
 * The venue's public booking grid for a date.
 * ❓ URL form taken from the public site; confirm with a capture.
 */
export function bookingPageUrl(host: string, venue: string, date: LocalDate): string {
  return `https://${host}/${venue}/Booking/BookByDate#?date=${date}`;
}
