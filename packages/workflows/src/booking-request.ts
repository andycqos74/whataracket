// BookingRequestWorkflow, phase 1: notify-only (docs/DESIGN.md §4).
//
// Deterministic by construction: wall-clock time comes from the `now` local
// activity (recorded in history), timers are durable, and jitter uses the
// workflow-seeded Math.random. Nothing here reads Date, does I/O or touches
// the environment; the lint rules enforce it.

import {
  ActivityFailure,
  ApplicationFailure,
  condition,
  continueAsNew,
  defineQuery,
  defineSignal,
  log,
  proxyActivities,
  proxyLocalActivities,
  setHandler,
  workflowInfo,
} from '@temporalio/workflow';
import type { Activities } from '@whataracket/activities';
import {
  datesToSearch,
  describeSlot,
  FAILURE,
  findSlots,
  formatDate,
  isRequestExpired,
  nextRelease,
  releaseMatters,
  toLondon,
  validateRequest,
} from '@whataracket/domain';
import type { BookingRequest, LocalDate, Slot, VenueSettings } from '@whataracket/domain';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** How long to back off when Cloudflare refuses us (README rule 4). */
const BLOCKED_BACKOFF = 60 * MINUTE;
/** Settings change rarely; refresh a few times a day. */
const SETTINGS_TTL = 6 * HOUR;
/** Keep history small (DESIGN §4). */
const POLLS_PER_RUN = 500;
/** At most this many slots listed in one notification. */
const MAX_LISTED = 5;

const { getSettings, getFreeCells, notify } = proxyActivities<Activities>({
  startToCloseTimeout: '1 minute',
  retry: { initialInterval: '30 seconds', backoffCoefficient: 2, maximumAttempts: 3 },
});

const { now } = proxyLocalActivities<Activities>({ startToCloseTimeout: '5 seconds' });

export const pauseSignal = defineSignal('pause');
export const resumeSignal = defineSignal('resume');
export const cancelSignal = defineSignal('cancel');
export const updateRequestSignal = defineSignal<[BookingRequest]>('updateRequest');
export const statusQuery = defineQuery<RequestStatus>('status');

/** State carried across continueAsNew. */
export interface CarriedState {
  paused: boolean;
  totalPolls: number;
  /** Slot keys already notified, so each free slot is announced once. */
  notifiedKeys: string[];
  settings?: { value: VenueSettings; fetchedAtMs: number };
}

export interface RequestStatus {
  request: BookingRequest;
  phase: 'starting' | 'polling' | 'sleeping' | 'paused' | 'backing-off' | 'done';
  paused: boolean;
  totalPolls: number;
  lastPollAtMs?: number;
  nextWakeAtMs?: number;
  /** Matching slots seen on the last poll, best first. */
  lastMatches: Slot[];
  notifiedCount: number;
  lastError?: string;
  doneReason?: string;
}

export interface BookingRequestInput {
  request: BookingRequest;
  state?: CarriedState;
}

export interface BookingRequestResult {
  reason: string;
  totalPolls: number;
  notifiedCount: number;
}

function assertValid(request: BookingRequest): void {
  const errors = validateRequest(request);
  if (errors.length > 0) {
    throw ApplicationFailure.create({ type: 'InvalidRequest', message: errors.join('; '), nonRetryable: true });
  }
  if (request.action !== 'notify') {
    throw ApplicationFailure.create({
      type: 'InvalidRequest',
      message: 'Only action "notify" is built. Booking and payment are phase 2 (docs/BUILD-PLAN.md).',
      nonRetryable: true,
    });
  }
}

function jittered(request: BookingRequest): number {
  const jitter = request.jitterMinutes ?? 1;
  return (request.pollEveryMinutes + (Math.random() * 2 - 1) * jitter) * MINUTE;
}

function failureType(err: unknown): string | undefined {
  const cause = err instanceof ActivityFailure ? err.cause : err;
  return cause instanceof ApplicationFailure ? (cause.type ?? undefined) : undefined;
}

/** Drop keys for past dates; keys start with the date. */
function pruneKeys(keys: Set<string>, today: LocalDate): string[] {
  return [...keys].filter((k) => k.slice(0, 10) >= today);
}

function announce(request: BookingRequest, fresh: Slot[]): Parameters<Activities['notify']>[0] {
  const best = fresh[0] as Slot;
  const lines = fresh.slice(0, MAX_LISTED).map(describeSlot);
  if (fresh.length > MAX_LISTED) lines.push(`...and ${fresh.length - MAX_LISTED} more`);
  return {
    title: fresh.length === 1 ? `Court free: ${formatDate(best.date)}` : `${fresh.length} courts free (${request.name})`,
    message: lines.join('\n'),
    priority: 'high',
    tags: ['tennis'],
    bookingPage: { venue: request.venue, date: best.date },
  };
}

export async function bookingRequestWorkflow(input: BookingRequestInput): Promise<BookingRequestResult> {
  assertValid(input.request);

  let request = input.request;
  const carried: CarriedState = input.state ?? { paused: false, totalPolls: 0, notifiedKeys: [] };
  const notified = new Set(carried.notifiedKeys);
  let settings = carried.settings;
  let cancelled = false;
  let woken = false;
  let pollsThisRun = 0;
  let lastErrorType: string | undefined;

  const status: RequestStatus = {
    request,
    phase: 'starting',
    paused: carried.paused,
    totalPolls: carried.totalPolls,
    lastMatches: [],
    notifiedCount: notified.size,
  };

  setHandler(pauseSignal, () => {
    status.paused = true;
    woken = true;
  });
  setHandler(resumeSignal, () => {
    status.paused = false;
    woken = true;
  });
  setHandler(cancelSignal, () => {
    cancelled = true;
    woken = true;
  });
  setHandler(updateRequestSignal, (next) => {
    const errors = validateRequest(next);
    if (errors.length > 0 || next.action !== 'notify') {
      status.lastError = `updateRequest ignored: ${errors.length > 0 ? errors.join('; ') : 'only action "notify" is built'}`;
      return;
    }
    request = next;
    status.request = next;
    woken = true;
  });
  setHandler(statusQuery, () => status);

  /** Sleeps until the deadline, or until a signal wakes us. */
  async function sleepUntil(nowMs: number, wakeAtMs: number, phase: RequestStatus['phase']): Promise<void> {
    status.phase = phase;
    status.nextWakeAtMs = wakeAtMs;
    woken = false;
    await condition(() => woken || cancelled, Math.max(1_000, wakeAtMs - nowMs));
  }

  const finish = (reason: string): BookingRequestResult => {
    status.phase = 'done';
    status.doneReason = reason;
    delete status.nextWakeAtMs;
    return { reason, totalPolls: status.totalPolls, notifiedCount: notified.size };
  };

  for (;;) {
    if (cancelled) return finish('cancelled');

    if (status.paused) {
      status.phase = 'paused';
      delete status.nextWakeAtMs;
      await condition(() => !status.paused || cancelled);
      continue;
    }

    const nowMs = await now();
    if (isRequestExpired(request, nowMs)) {
      await notify({ title: `Finished: ${request.name}`, message: 'The date range has passed.', tags: ['checkered_flag'] });
      return finish('date range passed');
    }

    if (pollsThisRun >= POLLS_PER_RUN || workflowInfo().continueAsNewSuggested) {
      return continueAsNew<typeof bookingRequestWorkflow>({
        request,
        state: {
          paused: status.paused,
          totalPolls: status.totalPolls,
          notifiedKeys: pruneKeys(notified, toLondon(nowMs).date),
          ...(settings ? { settings } : {}),
        },
      });
    }

    let pollDelay = jittered(request);
    try {
      if (!settings || nowMs - settings.fetchedAtMs > SETTINGS_TTL) {
        settings = { value: await getSettings(request.venue), fetchedAtMs: nowMs };
      }

      const longest = settings.value.maxBookingMinutes;
      if (longest !== undefined && request.durationMinutes > longest) {
        status.lastError = `durationMinutes ${request.durationMinutes} is longer than the venue allows (${longest}); nothing can match`;
      }

      const dates = datesToSearch(request, nowMs, settings.value);
      if (dates.length > 0) {
        status.phase = 'polling';
        const cells = await getFreeCells(request.venue, dates[0] as LocalDate, dates[dates.length - 1] as LocalDate);
        pollsThisRun++;
        status.totalPolls++;
        status.lastPollAtMs = nowMs;

        const slots = findSlots(cells, request, settings.value, nowMs);
        status.lastMatches = slots.slice(0, 20);
        const fresh = slots.filter((s) => !notified.has(s.key));
        if (fresh.length > 0) {
          await notify(announce(request, fresh));
          for (const s of fresh) notified.add(s.key);
          status.notifiedCount = notified.size;
        }
      } else {
        // Nothing wanted is bookable yet: send no request, wait for the next release.
        pollDelay = Number.POSITIVE_INFINITY;
      }
      if (lastErrorType !== undefined) log.info('ClubSpark is answering again');
      lastErrorType = undefined;
      if (!status.lastError?.startsWith('durationMinutes')) delete status.lastError;
    } catch (err) {
      const type = failureType(err) ?? 'other';
      status.lastError = err instanceof Error ? err.message : String(err);
      if (type !== lastErrorType) {
        await notify({
          title: `Problem: ${request.name}`,
          message: type === FAILURE.blocked ? 'ClubSpark (Cloudflare) refused the request. Backing off for an hour.' : `Poll failed: ${status.lastError}`,
          priority: 'high',
          tags: ['warning'],
        });
      }
      lastErrorType = type;
      if (type === FAILURE.blocked) pollDelay = BLOCKED_BACKOFF;
      if (!settings) {
        await sleepUntil(nowMs, nowMs + pollDelay, 'backing-off');
        continue;
      }
    }

    // Wake for the next release instead, if it opens a day we want and comes sooner.
    const release = nextRelease(nowMs, settings.value);
    const releasePollAt = release.atMs + (request.releaseDelaySeconds ?? 3) * 1_000;
    let wakeAt = nowMs + pollDelay;
    if (releaseMatters(request, release) && releasePollAt < wakeAt) wakeAt = releasePollAt;
    // Nothing bookable yet and the next release is not ours: check again after that release.
    if (!Number.isFinite(wakeAt)) wakeAt = releasePollAt;
    await sleepUntil(nowMs, wakeAt, lastErrorType === FAILURE.blocked ? 'backing-off' : 'sleeping');
  }
}
