import { ApplicationFailure } from '@temporalio/activity';
import { ClubSparkBlockedError, ClubSparkParseError } from '@whataracket/clubspark';
import type { AvailabilitySource } from '@whataracket/clubspark';
import { bookingPageUrl, FAILURE } from '@whataracket/domain';
import type { FreeCell, LocalDate, VenueSettings } from '@whataracket/domain';
import type { Notification, Notifier } from './notify.js';

export interface ActivityDeps {
  availability: AvailabilitySource;
  notifier: Notifier;
  /** ClubSpark host, for links in notifications. */
  host?: string;
  clock?: () => number | Promise<number>;
}

export interface NotifyInput extends Notification {
  /** Adds a tap-through link to the venue's booking grid for that date. */
  bookingPage?: { venue: string; date: LocalDate };
}

export function createActivities(deps: ActivityDeps) {
  const clock = deps.clock ?? Date.now;

  return {
    /** Wall-clock time for workflow decisions. Run as a local activity; the result is recorded in history. */
    async now(): Promise<number> {
      return clock();
    },

    async getSettings(venue: string): Promise<VenueSettings> {
      return translate(() => deps.availability.getSettings(venue));
    },

    async getFreeCells(venue: string, from: LocalDate, to: LocalDate): Promise<FreeCell[]> {
      return translate(() => deps.availability.getFreeCells(venue, from, to));
    },

    async notify({ bookingPage, ...notification }: NotifyInput): Promise<void> {
      const host = deps.host ?? 'clubspark.lta.org.uk';
      await deps.notifier.send(bookingPage ? { clickUrl: bookingPageUrl(host, bookingPage.venue, bookingPage.date), ...notification } : notification);
    },
  };
}

export type Activities = ReturnType<typeof createActivities>;

/** Blocks and unexpected shapes do not get better by retrying immediately. */
async function translate<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ClubSparkBlockedError) {
      throw ApplicationFailure.create({ type: FAILURE.blocked, message: err.message, nonRetryable: true });
    }
    if (err instanceof ClubSparkParseError) {
      throw ApplicationFailure.create({ type: FAILURE.parse, message: err.message, nonRetryable: true });
    }
    throw err;
  }
}
