// Worker process. Runs on a residential connection: ClubSpark's Cloudflare
// blocks datacenter IPs (docs/CLUBSPARK.md §1). It connects out to Temporal,
// so nothing at home has to be exposed.

import { existsSync } from 'node:fs';
import { NativeConnection, Worker } from '@temporalio/worker';
import { createActivities, LogNotifier, NtfyNotifier } from '@whataracket/activities';
import { ClubSparkClient } from '@whataracket/clubspark';
import { connectionOptions, readConfig } from './config.js';
import { workflowBundlePath, workflowsPath } from './workflows-path.js';

const config = readConfig();

const notifier = config.ntfy ? new NtfyNotifier(config.ntfy.topicUrl, config.ntfy.token) : new LogNotifier();
if (!config.ntfy) console.warn('NTFY_TOPIC_URL is not set: notifications are only logged.');

const activities = createActivities({
  availability: new ClubSparkClient({
    host: config.clubspark.host,
    roleName: config.clubspark.roleName,
    ...(config.clubspark.userAgent ? { userAgent: config.clubspark.userAgent } : {}),
  }),
  notifier,
  host: config.clubspark.host,
});

const connection = await connectWithRetry();
const worker = await Worker.create({
  connection,
  namespace: config.temporal.namespace,
  taskQueue: config.temporal.taskQueue,
  activities,
  ...(existsSync(workflowBundlePath) ? { workflowBundle: { codePath: workflowBundlePath } } : { workflowsPath }),
  // A handful of requests polling every few minutes needs little concurrency.
  maxConcurrentActivityTaskExecutions: 4,
});

console.log(`Worker polling ${config.temporal.address} namespace=${config.temporal.namespace} queue=${config.temporal.taskQueue}`);
await worker.run(); // returns after SIGINT/SIGTERM once in-flight tasks finish
await connection.close();

/** Temporal may still be starting when the stack comes up. */
async function connectWithRetry(): Promise<NativeConnection> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await NativeConnection.connect(connectionOptions(config));
    } catch (err) {
      if (attempt >= 30) throw err;
      console.warn(`Temporal not reachable at ${config.temporal.address} (attempt ${attempt}); retrying in 5 s`);
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }
}
