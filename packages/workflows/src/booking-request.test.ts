import { fileURLToPath } from 'node:url';
import { ApplicationFailure } from '@temporalio/workflow';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { createActivities } from '@whataracket/activities';
import type { Notification } from '@whataracket/activities';
import { FAILURE, fromLondon } from '@whataracket/domain';
import type { BookingRequest, FreeCell, LocalDate, VenueSettings } from '@whataracket/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bookingRequestWorkflow, cancelSignal, statusQuery } from './booking-request.js';

const settings: VenueSettings = { timeZone: 'Europe/London', advancedBookingDays: 7, releaseMinute: 1200 };
/** Saturday 2026-10-24, 12:00 London. Test time starts here. */
const BASE = fromLondon({ date: '2026-10-24', minute: 720 });
const MINUTE = 60_000;

const request: BookingRequest = {
  name: 'tue-evenings',
  venue: 'ParliamentHillFieldsTennisCourts',
  courts: 'any',
  days: ['Tue'],
  window: { earliestStart: '18:00', latestEnd: '20:00' },
  durationMinutes: 60,
  dateRange: { from: '2026-10-01', to: '2026-12-20' },
  maxPricePence: 1500,
  mode: 'recurring',
  action: 'notify',
  pollEveryMinutes: 5,
  jitterMinutes: 0,
};

const tuesdayCells: FreeCell[] = [1080, 1110].map((start) => ({
  courtId: 'c1',
  courtName: 'Crt 1',
  date: '2026-10-27',
  start,
  end: start + 30,
  pricePence: 520,
}));

let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
});

afterAll(async () => {
  await env?.teardown();
});

interface Harness {
  notifications: Notification[];
  fetches: Array<{ from: LocalDate; to: LocalDate }>;
}

async function run(
  input: BookingRequest,
  getFreeCells: (from: LocalDate, to: LocalDate) => Promise<FreeCell[]>,
  body: (h: Harness, handle: Handle) => Promise<void>,
): Promise<void> {
  const h: Harness = { notifications: [], fetches: [] };
  // The server clock leaps ahead whenever a test awaits a result, so each test starts its own.
  const testStart = await env.currentTimeMs();
  const taskQueue = `test-${Math.random().toString(36).slice(2)}`;
  const activities = createActivities({
    availability: {
      getSettings: () => Promise.resolve(settings),
      getFreeCells: (_venue, from, to) => {
        h.fetches.push({ from, to });
        return getFreeCells(from, to);
      },
    },
    notifier: { send: (n) => (h.notifications.push(n), Promise.resolve()) },
    clock: async () => BASE + ((await env.currentTimeMs()) - testStart),
  });
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowsPath: fileURLToPath(new URL('./index.ts', import.meta.url)),
    activities,
  });
  await worker.runUntil(async () => {
    const handle = await env.client.workflow.start(bookingRequestWorkflow, {
      taskQueue,
      workflowId: `wf-${taskQueue}`,
      args: [{ request: input }],
    });
    await body(h, handle);
  });
}

type Handle = Awaited<ReturnType<typeof env.client.workflow.start>>;

/** Real-time wait for a condition; time-skipping does not wait for the worker. */
async function until(check: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** Waits until the workflow is parked on a timer or a pause. */
async function settled(handle: Handle): Promise<void> {
  await until(async () => ['sleeping', 'backing-off', 'paused', 'done'].includes((await handle.query(statusQuery)).phase), 'the workflow to settle');
}

describe('bookingRequestWorkflow (notify-only)', () => {
  it('announces a free slot once, then keeps polling quietly', async () => {
    await run(request, () => Promise.resolve(tuesdayCells), async (h, handle) => {
      await settled(handle);
      await env.sleep(12 * MINUTE);
      await until(() => h.fetches.length >= 3, 'three polls');
      await settled(handle);
      const status = await handle.query(statusQuery);
      expect(status.totalPolls).toBeGreaterThanOrEqual(3);
      expect(h.notifications).toHaveLength(1);
      expect(h.notifications[0]).toMatchObject({ title: 'Court free: Tue 27 Oct', clickUrl: expect.stringContaining('2026-10-27') });
      expect(h.notifications[0]?.message).toContain('18:00–19:00, Crt 1, £10.40');
      expect(h.fetches[0]).toEqual({ from: '2026-10-27', to: '2026-10-27' });
      await handle.signal(cancelSignal);
      expect(await handle.result()).toMatchObject({ reason: 'cancelled', notifiedCount: 1 });
    });
  });

  it('backs off for an hour when ClubSpark blocks us, and says so once', async () => {
    const blocked = () => Promise.reject(ApplicationFailure.create({ type: FAILURE.blocked, message: 'blocked', nonRetryable: true }));
    await run(request, blocked, async (h, handle) => {
      await settled(handle);
      await env.sleep(30 * MINUTE);
      await settled(handle);
      expect(h.fetches).toHaveLength(1);
      expect((await handle.query(statusQuery)).phase).toBe('backing-off');
      await env.sleep(35 * MINUTE);
      await until(() => h.fetches.length === 2, 'the retry after backing off');
      expect(h.notifications.map((n) => n.title)).toEqual(['Problem: tue-evenings']);
      await handle.signal(cancelSignal);
      await handle.result();
    });
  });

  it('sends nothing until the release that opens a wanted day, then polls right after it', async () => {
    const saturdayOnly: BookingRequest = { ...request, days: ['Sat'], dateRange: { from: '2026-10-31', to: '2026-10-31' } };
    await run(saturdayOnly, () => Promise.resolve([]), async (h, handle) => {
      await settled(handle);
      await env.sleep(7 * 60 * MINUTE + 55 * MINUTE); // 19:55
      await settled(handle);
      expect(h.fetches).toHaveLength(0);
      const status = await handle.query(statusQuery);
      expect(status.nextWakeAtMs).toBe(fromLondon({ date: '2026-10-24', minute: 1200 }) + 3_000);
      await env.sleep(10 * MINUTE);
      await until(() => h.fetches.length > 0, 'the poll after release');
      expect(h.fetches[0]).toEqual({ from: '2026-10-31', to: '2026-10-31' });
      await handle.signal(cancelSignal);
      await handle.result();
    });
  });

  it('finishes when the date range has passed', async () => {
    const past: BookingRequest = { ...request, dateRange: { from: '2026-10-01', to: '2026-10-20' } };
    await run(past, () => Promise.resolve([]), async (h, handle) => {
      expect(await handle.result()).toMatchObject({ reason: 'date range passed' });
      expect(h.notifications.map((n) => n.title)).toEqual(['Finished: tue-evenings']);
    });
  });

  it('refuses to book (phase 2)', async () => {
    await run({ ...request, action: 'book' }, () => Promise.resolve([]), async (_h, handle) => {
      await expect(handle.result()).rejects.toThrow();
    });
  });
});
