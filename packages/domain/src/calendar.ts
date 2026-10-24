// Calendar maths on plain values. No `Date`: this module is imported by
// workflow code, and the determinism lint bans the global outright.
//
// A local date is an ISO `YYYY-MM-DD` string in the venue's time zone. A time
// of day is minutes from local midnight, as ClubSpark reports it.

export type LocalDate = string;

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const MS_PER_MINUTE = 60_000;
export const MS_PER_DAY = 86_400_000;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLocalDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

function parse(date: LocalDate): [number, number, number] {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Not a YYYY-MM-DD date: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 0;
}

/** Days since 1970-01-01 (Howard Hinnant's days_from_civil). */
export function toEpochDay(date: LocalDate): number {
  const [y0, m, d] = parse(date);
  const y = m <= 2 ? y0 - 1 : y0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Inverse of {@link toEpochDay}. */
export function fromEpochDay(epochDay: number): LocalDate {
  const z = epochDay + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromEpochDay(toEpochDay(date) + days);
}

export function daysBetween(from: LocalDate, to: LocalDate): number {
  return toEpochDay(to) - toEpochDay(from);
}

export function weekdayOf(date: LocalDate): Weekday {
  // 1970-01-01 was a Thursday (index 3).
  const index = (((toEpochDay(date) + 3) % 7) + 7) % 7;
  return WEEKDAYS[index] as Weekday;
}

/** `HH:MM` → minutes from midnight (24:00 allowed as an end time). */
export function parseTimeOfDay(value: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m || Number(m[2]) > 59) throw new Error(`Not an HH:MM time: ${value}`);
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  if (minutes > 24 * 60) throw new Error(`Not an HH:MM time: ${value}`);
  return minutes;
}

export function formatTimeOfDay(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

// --- Europe/London ----------------------------------------------------------
//
// ClubSpark reports `TimeZone: "Europe/London"` for UK venues. The UK rule has
// been fixed since 1996: BST (UTC+1) from 01:00 UTC on the last Sunday of March
// to 01:00 UTC on the last Sunday of October. Encoding it here keeps the
// conversion pure, with no dependency on the host's time-zone database.

export const SUPPORTED_TIME_ZONE = 'Europe/London';

function lastSunday(year: number, month: number): number {
  const last = toEpochDay(`${year}-${String(month).padStart(2, '0')}-${daysInMonth(year, month)}`);
  const weekdayIndex = (((last + 3) % 7) + 7) % 7; // 0 = Mon … 6 = Sun
  return last - ((weekdayIndex + 1) % 7);
}

/** UTC offset in minutes for Europe/London at the given instant. */
export function londonOffsetMinutes(epochMs: number): number {
  const year = Number(fromEpochDay(Math.floor(epochMs / MS_PER_DAY)).slice(0, 4));
  const start = lastSunday(year, 3) * MS_PER_DAY + 60 * MS_PER_MINUTE;
  const end = lastSunday(year, 10) * MS_PER_DAY + 60 * MS_PER_MINUTE;
  return epochMs >= start && epochMs < end ? 60 : 0;
}

export interface LocalDateTime {
  date: LocalDate;
  /** Minutes from local midnight. */
  minute: number;
}

export function toLondon(epochMs: number): LocalDateTime {
  const localMs = epochMs + londonOffsetMinutes(epochMs) * MS_PER_MINUTE;
  const day = Math.floor(localMs / MS_PER_DAY);
  return { date: fromEpochDay(day), minute: Math.floor((localMs - day * MS_PER_DAY) / MS_PER_MINUTE) };
}

/**
 * Local London wall time → instant. In the autumn overlap the earlier (BST)
 * instant wins; a time in the spring gap resolves to the instant an hour later.
 */
export function fromLondon({ date, minute }: LocalDateTime): number {
  const naive = toEpochDay(date) * MS_PER_DAY + minute * MS_PER_MINUTE;
  const bst = naive - 60 * MS_PER_MINUTE;
  if (londonOffsetMinutes(bst) === 60) return bst;
  return naive;
}
