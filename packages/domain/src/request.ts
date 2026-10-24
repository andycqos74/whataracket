import { isLocalDate, parseTimeOfDay, WEEKDAYS } from './calendar.js';
import type { LocalDate, Weekday } from './calendar.js';

/**
 * What to look for. This is the workflow input, so it must never carry
 * credentials, card data or notification secrets (README rule 3).
 */
export interface BookingRequest {
  /** Short human label; also used in the workflow id. */
  name: string;
  /** ClubSpark venue segment, e.g. `ParliamentHillFieldsTennisCourts`. */
  venue: string;
  /** `any`, or court names in preference order (e.g. `["Crt 3", "Crt 4"]`). */
  courts: 'any' | string[];
  days: Weekday[];
  window: {
    /** Earliest start, `HH:MM`. */
    earliestStart: string;
    /** Latest end, `HH:MM`. */
    latestEnd: string;
  };
  durationMinutes: number;
  dateRange: { from: LocalDate; to: LocalDate };
  /** Court plus lighting, per booking. */
  maxPricePence: number;
  /** `once`: one booking in total. `recurring`: one booking per matching date. */
  mode: 'once' | 'recurring';
  /** Phase 1 only notifies. `book` is reserved for phase 2 (docs/BUILD-PLAN.md). */
  action: 'notify' | 'book';
  pollEveryMinutes: number;
  /** Random ± spread on each poll interval. Default 1. */
  jitterMinutes?: number;
  /** How long after the daily release to poll, allowing for clock skew. Default 3. */
  releaseDelaySeconds?: number;
}

/** Polling faster than this is impolite (README rule 4). */
export const MIN_POLL_MINUTES = 2;

/** Returns every problem with the request; empty means valid. */
export function validateRequest(request: BookingRequest): string[] {
  const errors: string[] = [];
  const r = request as Partial<BookingRequest>;

  if (typeof r.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(r.name)) {
    errors.push('name: 1–64 letters, digits, dot, dash or underscore');
  }
  if (typeof r.venue !== 'string' || !/^[A-Za-z0-9-]+$/.test(r.venue)) {
    errors.push('venue: the ClubSpark venue segment, e.g. ParliamentHillFieldsTennisCourts');
  }
  if (r.courts !== 'any' && !(Array.isArray(r.courts) && r.courts.length > 0 && r.courts.every((c) => typeof c === 'string' && c.length > 0))) {
    errors.push('courts: "any" or a non-empty list of court names');
  }
  if (!Array.isArray(r.days) || r.days.length === 0 || !r.days.every((d) => (WEEKDAYS as readonly string[]).includes(d))) {
    errors.push(`days: a non-empty list of ${WEEKDAYS.join(', ')}`);
  }

  let earliest: number | undefined;
  let latest: number | undefined;
  try {
    earliest = parseTimeOfDay(r.window?.earliestStart ?? '');
    latest = parseTimeOfDay(r.window?.latestEnd ?? '');
  } catch {
    errors.push('window: earliestStart and latestEnd as HH:MM');
  }
  if (!Number.isInteger(r.durationMinutes) || (r.durationMinutes ?? 0) <= 0 || (r.durationMinutes ?? 0) > 480) {
    errors.push('durationMinutes: a whole number of minutes, 1–480');
  } else if (earliest !== undefined && latest !== undefined && latest - earliest < (r.durationMinutes ?? 0)) {
    errors.push('window: too short for durationMinutes');
  }

  const from = r.dateRange?.from;
  const to = r.dateRange?.to;
  if (typeof from !== 'string' || typeof to !== 'string' || !isLocalDate(from) || !isLocalDate(to)) {
    errors.push('dateRange: from and to as YYYY-MM-DD');
  } else if (to < from) {
    errors.push('dateRange: to is before from');
  }

  if (!Number.isInteger(r.maxPricePence) || (r.maxPricePence ?? -1) < 0) {
    errors.push('maxPricePence: a whole number of pence, 0 or more');
  }
  if (r.mode !== 'once' && r.mode !== 'recurring') errors.push('mode: "once" or "recurring"');
  if (r.action !== 'notify' && r.action !== 'book') errors.push('action: "notify" or "book"');
  if (typeof r.pollEveryMinutes !== 'number' || !(r.pollEveryMinutes >= MIN_POLL_MINUTES)) {
    errors.push(`pollEveryMinutes: at least ${MIN_POLL_MINUTES}`);
  }
  const jitter = r.jitterMinutes ?? 1;
  if (typeof jitter !== 'number' || jitter < 0 || jitter >= (r.pollEveryMinutes ?? 0)) {
    errors.push('jitterMinutes: 0 or more, and less than pollEveryMinutes');
  }
  const delay = r.releaseDelaySeconds ?? 3;
  if (typeof delay !== 'number' || delay < 0 || delay > 600) errors.push('releaseDelaySeconds: 0–600');

  return errors;
}
