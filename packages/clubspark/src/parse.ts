// Parsers from ClubSpark JSON to domain types. This is the boundary where
// decimal pounds become integer pence (CLAUDE.md) and where everything that
// is not a free, priced cell is dropped (docs/CLUBSPARK.md §2).

import { SUPPORTED_TIME_ZONE } from '@whataracket/domain';
import type { FreeCell, VenueSettings } from '@whataracket/domain';

export class ClubSparkParseError extends Error {
  override readonly name = 'ClubSparkParseError';
}

/** Session category for a free cell. Taken cells are 1000, despite the name "Booking". */
const FREE = 0;
/** Resource category for a tennis court (9 is a cricket net). */
export const TENNIS_COURT = 1;

export function poundsToPence(pounds: unknown): number {
  if (pounds === null || pounds === undefined) return 0;
  if (typeof pounds !== 'number' || !Number.isFinite(pounds) || pounds < 0) {
    throw new ClubSparkParseError(`Not a price in pounds: ${String(pounds)}`);
  }
  return Math.round(pounds * 100);
}

function obj(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ClubSparkParseError(`${what}: expected an object`);
  return value as Record<string, unknown>;
}

function arr(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new ClubSparkParseError(`${what}: expected an array`);
  return value;
}

function int(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new ClubSparkParseError(`${what}: expected an integer`);
  return value;
}

function str(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new ClubSparkParseError(`${what}: expected a string`);
  return value;
}

export interface ParseSettingsOptions {
  /**
   * Which role's booking period applies to the account. Unknown until the
   * login capture (docs/CLUBSPARK.md §3). Without it the shortest period is
   * used, which never shows a day the account cannot book.
   */
  roleName?: string | undefined;
}

/** `GetSettings` → booking horizon and daily release minute. */
export function parseSettings(json: unknown, options: ParseSettingsOptions = {}): VenueSettings {
  const root = obj(json, 'GetSettings');
  const roles = arr(root['Roles'], 'GetSettings.Roles').map((r, i) => {
    const role = obj(r, `GetSettings.Roles[${i}]`);
    return {
      name: typeof role['Name'] === 'string' ? role['Name'] : undefined,
      period: int(role['AdvancedBookingPeriod'], `GetSettings.Roles[${i}].AdvancedBookingPeriod`),
      maxIntervals: typeof role['MaximumBookingIntervals'] === 'number' && role['MaximumBookingIntervals'] > 0 ? role['MaximumBookingIntervals'] : undefined,
    };
  });
  if (roles.length === 0) throw new ClubSparkParseError('GetSettings.Roles: empty');

  let chosen: (typeof roles)[number];
  if (options.roleName !== undefined) {
    const role = roles.find((r) => r.name?.toLowerCase() === options.roleName?.toLowerCase());
    if (!role) throw new ClubSparkParseError(`GetSettings.Roles: no role named ${options.roleName}`);
    chosen = role;
  } else {
    chosen = roles.reduce((a, b) => (b.period < a.period ? b : a));
  }
  const period = chosen.period;

  const releaseMinute = int(root['NewDayBookingAvailabilityTime'], 'GetSettings.NewDayBookingAvailabilityTime');
  if (releaseMinute < 0 || releaseMinute >= 24 * 60) throw new ClubSparkParseError('GetSettings.NewDayBookingAvailabilityTime: out of range');
  const timeZone = typeof root['TimeZone'] === 'string' ? root['TimeZone'] : SUPPORTED_TIME_ZONE;
  assertTimeZone(timeZone);
  const settings: VenueSettings = { timeZone, advancedBookingDays: period, releaseMinute };
  const interval = root['DefaultInterval'];
  if (chosen.maxIntervals !== undefined && typeof interval === 'number' && interval > 0) {
    settings.maxBookingMinutes = chosen.maxIntervals * interval;
  }
  return settings;
}

function assertTimeZone(timeZone: string): void {
  if (timeZone !== SUPPORTED_TIME_ZONE) {
    throw new ClubSparkParseError(`Time zone ${timeZone} is not supported; only ${SUPPORTED_TIME_ZONE}`);
  }
}

/**
 * `GetVenueSessions` → free cells on tennis courts.
 *
 * A free session can span several cells (e.g. 07:00–10:00 with a 60-minute
 * interval); its prices are per cell, so it is split at its `Interval`.
 * ❓ Per-cell pricing is the community projects' reading; confirm it against a
 * Parliament Hill Fields capture.
 */
export function parseVenueSessions(json: unknown): FreeCell[] {
  const root = obj(json, 'GetVenueSessions');
  if (typeof root['TimeZone'] === 'string') assertTimeZone(root['TimeZone']);
  const minimumInterval = typeof root['MinimumInterval'] === 'number' ? root['MinimumInterval'] : 30;

  const cells: FreeCell[] = [];
  for (const [ri, r] of arr(root['Resources'], 'Resources').entries()) {
    const resource = obj(r, `Resources[${ri}]`);
    if (resource['Category'] !== TENNIS_COURT) continue;
    const courtId = str(resource['ID'], `Resources[${ri}].ID`);
    const courtName = str(resource['Name'], `Resources[${ri}].Name`);

    for (const [di, d] of arr(resource['Days'], `Resources[${ri}].Days`).entries()) {
      const day = obj(d, `Resources[${ri}].Days[${di}]`);
      const date = str(day['Date'], `Resources[${ri}].Days[${di}].Date`).slice(0, 10);

      for (const [si, s] of arr(day['Sessions'] ?? [], `Resources[${ri}].Days[${di}].Sessions`).entries()) {
        const where = `Resources[${ri}].Days[${di}].Sessions[${si}]`;
        const session = obj(s, where);
        if (session['Category'] !== FREE) continue;
        // ❓ Other venues leave unbookable category-0 cells unpriced. Parliament
        // Hill Fields shows no price on any free cell when logged out, so an
        // unpriced free cell is kept with an unknown price (docs/CLUBSPARK.md §2).
        const cost = poundsToPence(session['CourtCost']) + poundsToPence(session['LightingCost']);
        const pricePence = cost > 0 ? cost : null;

        const start = int(session['StartTime'], `${where}.StartTime`);
        const end = int(session['EndTime'], `${where}.EndTime`);
        const rawInterval = session['Interval'];
        const interval = typeof rawInterval === 'number' && rawInterval > 0 ? rawInterval : minimumInterval;
        if (end <= start) throw new ClubSparkParseError(`${where}: EndTime before StartTime`);
        for (let t = start; t + interval <= end; t += interval) {
          cells.push({ courtId, courtName, date, start: t, end: t + interval, pricePence });
        }
      }
    }
  }
  return cells;
}
