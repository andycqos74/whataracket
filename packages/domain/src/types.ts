import type { LocalDate } from './calendar.js';

/** Venue-wide booking rules from ClubSpark's `GetSettings`. */
export interface VenueSettings {
  timeZone: string;
  /** Days ahead a booking may be made (`Roles[].AdvancedBookingPeriod`). */
  advancedBookingDays: number;
  /** Minute of the day the furthest day opens (`NewDayBookingAvailabilityTime`). */
  releaseMinute: number;
  /** Longest single booking for the role (`MaximumBookingIntervals` × `DefaultInterval`). */
  maxBookingMinutes?: number;
}

/**
 * One free, bookable cell on one court. ClubSpark grids are made of cells of
 * the venue's interval (30 or 60 minutes). Taken, coaching, closed and
 * unpriced cells never reach the domain: the parser drops them.
 */
export interface FreeCell {
  courtId: string;
  courtName: string;
  date: LocalDate;
  /** Minutes from local midnight. */
  start: number;
  end: number;
  /**
   * Court plus lighting, integer pence. `null` when ClubSpark does not say:
   * logged out, Parliament Hill Fields shows no price on free cells.
   */
  pricePence: number | null;
}

/** A bookable block: one or more adjacent cells on one court. */
export interface Slot {
  /** Stable identity: `date|courtId|start`. */
  key: string;
  date: LocalDate;
  courtId: string;
  courtName: string;
  start: number;
  end: number;
  /** `null` if any cell's price is unknown. */
  pricePence: number | null;
}

/** Activity failure types the workflow reacts to (set by packages/activities). */
export const FAILURE = {
  /** Cloudflare refused the request. Back off for a long time. */
  blocked: 'ClubSparkBlocked',
  /** ClubSpark answered in an unexpected shape. Needs a human. */
  parse: 'ClubSparkParse',
} as const;
