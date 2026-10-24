#!/usr/bin/env node
// whataracket CLI: start, inspect and stop booking requests.
//
//   <request.json> is a file path or the JSON itself.
//
//   whataracket check  <request.json>   validate, then show matches right now (talks to ClubSpark, not Temporal)
//   whataracket start  <request.json>   start watching
//   whataracket list                    running requests
//   whataracket status <name>
//   whataracket pause|resume|cancel <name>
//   whataracket update <name> <request.json>

import { readFile } from 'node:fs/promises';
import { Client, Connection, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import { ClubSparkClient } from '@whataracket/clubspark';
import { datesToSearch, describeSlot, findSlots, formatTimeOfDay, nextRelease, toLondon, validateRequest } from '@whataracket/domain';
import type { BookingRequest } from '@whataracket/domain';
import type { RequestStatus } from '@whataracket/workflows';
import { connectionOptions, readConfig } from './config.js';

const WORKFLOW_TYPE = 'bookingRequestWorkflow';
const config = readConfig();

const workflowId = (name: string): string => (name.startsWith('request-') ? name : `request-${name}`);

/** A path to a JSON file, or the JSON itself (handy in a container console). */
async function loadRequest(source: string): Promise<BookingRequest> {
  const text = source.trimStart().startsWith('{') ? source : await readFile(source, 'utf8');
  const request = JSON.parse(text) as BookingRequest;
  const errors = validateRequest(request);
  if (errors.length > 0) fail(`Invalid request:\n  ${errors.join('\n  ')}`);
  return request;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function client(): Promise<Client> {
  const connection = await Connection.connect(connectionOptions(config));
  return new Client({ connection, namespace: config.temporal.namespace });
}

const when = (ms: number | undefined): string => {
  if (ms === undefined) return '-';
  const local = toLondon(ms);
  return `${local.date} ${formatTimeOfDay(local.minute)}`;
};

function printStatus(id: string, s: RequestStatus): void {
  console.log(`${id}: ${s.phase}${s.paused ? ' (paused)' : ''}`);
  console.log(`  polls ${s.totalPolls}, last ${when(s.lastPollAtMs)}, next ${when(s.nextWakeAtMs)}, notified ${s.notifiedCount}`);
  if (s.lastError) console.log(`  last error: ${s.lastError}`);
  if (s.doneReason) console.log(`  finished: ${s.doneReason}`);
  for (const slot of s.lastMatches.slice(0, 10)) console.log(`  match: ${describeSlot(slot)}`);
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'check': {
    const request = await loadRequest(args[0] ?? fail('usage: check <request.json>'));
    const clubspark = new ClubSparkClient({ host: config.clubspark.host, roleName: config.clubspark.roleName });
    const settings = await clubspark.getSettings(request.venue);
    const now = Date.now();
    const dates = datesToSearch(request, now, settings);
    console.log(`Bookable ${settings.advancedBookingDays} days ahead; new day opens at ${formatTimeOfDay(settings.releaseMinute)}.`);
    if (settings.maxBookingMinutes !== undefined) console.log(`Longest single booking: ${settings.maxBookingMinutes} minutes.`);
    const release = nextRelease(now, settings);
    console.log(`Next release ${when(release.atMs)} opens ${release.opens}.`);
    if (dates.length === 0) {
      console.log('No wanted date is bookable yet.');
      break;
    }
    const cells = await clubspark.getFreeCells(request.venue, dates[0] as string, dates[dates.length - 1] as string);
    const slots = findSlots(cells, request, settings, now);
    console.log(`Searched ${dates.join(', ')}: ${cells.length} free cells, ${slots.length} matching slots.`);
    for (const slot of slots) console.log(`  ${describeSlot(slot)}`);
    break;
  }

  case 'start': {
    const request = await loadRequest(args[0] ?? fail('usage: start <request.json>'));
    if (request.action !== 'notify') fail('Only action "notify" is built so far.');
    const c = await client();
    const id = workflowId(request.name);
    try {
      await c.workflow.start(WORKFLOW_TYPE, { taskQueue: config.temporal.taskQueue, workflowId: id, args: [{ request }] });
    } catch (err) {
      if (err instanceof WorkflowExecutionAlreadyStartedError) fail(`${id} is already running. Use "update" to change it.`);
      throw err;
    }
    console.log(`Started ${id}`);
    break;
  }

  case 'list': {
    const c = await client();
    const query = `WorkflowType = '${WORKFLOW_TYPE}' AND ExecutionStatus = 'Running'`;
    let any = false;
    for await (const wf of c.workflow.list({ query })) {
      any = true;
      console.log(`${wf.workflowId}  started ${wf.startTime.toISOString()}`);
    }
    if (!any) console.log('No running requests.');
    break;
  }

  case 'status': {
    const id = workflowId(args[0] ?? fail('usage: status <name>'));
    printStatus(id, await (await client()).workflow.getHandle(id).query<RequestStatus>('status'));
    break;
  }

  case 'pause':
  case 'resume':
  case 'cancel': {
    const id = workflowId(args[0] ?? fail(`usage: ${command} <name>`));
    await (await client()).workflow.getHandle(id).signal(command);
    console.log(`Sent ${command} to ${id}`);
    break;
  }

  case 'update': {
    const id = workflowId(args[0] ?? fail('usage: update <name> <request.json>'));
    const request = await loadRequest(args[1] ?? fail('usage: update <name> <request.json>'));
    await (await client()).workflow.getHandle(id).signal('updateRequest', request);
    console.log(`Sent updated request to ${id}. Check "status" for "updateRequest ignored" errors.`);
    break;
  }

  default:
    console.log('usage: whataracket check|start|list|status|pause|resume|cancel|update ... (see apps/worker/src/cli.ts)');
    process.exit(command ? 1 : 0);
}
process.exit(0);
